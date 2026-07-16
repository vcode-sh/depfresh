import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectRepository } from '../repository/inspect'
import { createPolicyContexts } from './index'

function writeJson(filepath: string, value: unknown): void {
  writeFileSync(filepath, `${JSON.stringify(value, null, 2)}\n`)
}

describe('repository policy context', () => {
  let root: string

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('derives normalized specifier, catalog, workspace, and confirmed manager context', async () => {
    root = mkdtempSync(join(tmpdir(), 'depfresh-policy-context-'))
    mkdirSync(join(root, 'apps', 'web'), { recursive: true })
    writeJson(join(root, 'package.json'), {
      name: 'root',
      private: true,
      packageManager: 'bun@1.2.0',
      workspaces: {
        packages: ['apps/*'],
        catalogs: {
          native: {
            stable: '^1.2.3',
            prerelease: '=2.0.0-beta.3',
          },
        },
      },
      dependencies: {
        direct: '1.2.3',
        exactEquals: '=1.2.3',
        range: '>=1.0.0 <2.0.0',
        xRange: '1.2.x',
        unionRange: '^1.0.0 || ^2.0.0',
        tag: 'latest',
        fileRef: 'file:../fixture',
        linkRef: 'link:../fixture',
        gitRef: 'git+https://example.invalid/repository.git',
        httpRef: 'https://example.invalid/archive.tgz',
        githubRef: 'github:example/repository#v1.2.3',
        malformedGithub: 'github:example/repository#main',
        malformedAlias: 'npm:react',
        malformed: 'not a valid spec!',
      },
    })
    writeJson(join(root, 'apps', 'web', 'package.json'), {
      name: '@example/web',
      dependencies: {
        stable: 'catalog:native',
        unresolved: 'catalog:missing',
        alias: 'npm:direct@^1.2.3',
        jsrAlias: 'jsr:@scope/pkg@~1.2.3',
        workspace: 'workspace:^1.0.0',
        workspaceBare: 'workspace:*',
      },
    })

    const model = await inspectRepository({ cwd: root })
    const contexts = createPolicyContexts(model)
    const find = (role: string, name: string) =>
      contexts.find((context) => context.role === role && context.dependencyName === name)

    expect(contexts).toHaveLength(model.occurrences.length)
    expect(find('dependency', 'direct')).toMatchObject({
      workspacePath: '.',
      packageName: 'root',
      manager: 'bun',
      managerEvidenceStatus: 'confirmed',
      currentVersion: '1.2.3',
      currentChannel: 'stable',
      specifierStatus: 'locked',
      catalogRole: 'direct',
    })
    expect(find('dependency', 'range')).toMatchObject({
      currentVersion: '1.0.0',
      currentChannel: 'stable',
      specifierStatus: 'range',
    })
    expect(find('dependency', 'exactEquals')).toMatchObject({
      currentVersion: '1.2.3',
      specifierStatus: 'locked',
    })
    for (const name of ['xRange', 'unionRange']) {
      expect(find('dependency', name)).toMatchObject({ specifierStatus: 'range' })
    }
    const tag = find('dependency', 'tag')
    expect(tag).toMatchObject({ specifierStatus: 'dynamic' })
    expect(tag).not.toHaveProperty('currentVersion')
    expect(tag).not.toHaveProperty('currentChannel')
    expect(find('dependency', 'malformed')).toMatchObject({
      specifierStatus: 'invalid',
    })
    for (const name of ['fileRef', 'linkRef', 'gitRef', 'httpRef']) {
      const dynamic = find('dependency', name)
      expect(dynamic).toMatchObject({ specifierStatus: 'dynamic' })
      expect(dynamic).not.toHaveProperty('currentVersion')
    }
    expect(find('dependency', 'githubRef')).toMatchObject({
      currentVersion: '1.2.3',
      specifierStatus: 'locked',
    })
    for (const name of ['malformedGithub', 'malformedAlias']) {
      expect(find('dependency', name)).toMatchObject({ specifierStatus: 'invalid' })
    }
    expect(find('dependency', 'alias')).toMatchObject({
      workspacePath: 'apps/web',
      packageName: '@example/web',
      currentVersion: '1.2.3',
      specifierStatus: 'range',
    })
    expect(find('dependency', 'workspace')).toMatchObject({
      currentVersion: '1.0.0',
      specifierStatus: 'range',
    })
    expect(find('dependency', 'jsrAlias')).toMatchObject({
      currentVersion: '1.2.3',
      specifierStatus: 'range',
    })
    expect(find('dependency', 'workspaceBare')).toMatchObject({
      specifierStatus: 'dynamic',
    })
    expect(find('catalog-consumer', 'stable')).toMatchObject({
      catalogName: 'native',
      catalogRole: 'consumer',
      manager: 'bun',
      specifierStatus: 'dynamic',
    })
    const unresolved = find('catalog-consumer', 'unresolved')
    expect(unresolved).toMatchObject({
      catalogName: 'missing',
      catalogRole: 'consumer',
      managerEvidenceStatus: 'missing',
    })
    expect(unresolved).not.toHaveProperty('manager')
    expect(find('catalog-owner', 'prerelease')).toMatchObject({
      catalogName: 'native',
      catalogRole: 'owner',
      manager: 'bun',
      currentVersion: '2.0.0-beta.3',
      currentChannel: 'beta',
      specifierStatus: 'locked',
    })
  })

  it('retains missing and ambiguous manager evidence instead of guessing', async () => {
    root = mkdtempSync(join(tmpdir(), 'depfresh-policy-manager-'))
    writeJson(join(root, 'package.json'), {
      name: 'root',
      dependencies: { react: '^18.0.0' },
    })
    writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n')
    writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")

    const contexts = createPolicyContexts(await inspectRepository({ cwd: root }))

    const react = contexts.find((context) => context.dependencyName === 'react')
    expect(react).toMatchObject({ managerEvidenceStatus: 'ambiguous' })
    expect(react).not.toHaveProperty('manager')
  })

  it('retains ambiguous catalog manager identity instead of falling back to the package boundary', async () => {
    root = mkdtempSync(join(tmpdir(), 'depfresh-policy-catalog-ambiguous-'))
    writeJson(join(root, 'package.json'), {
      name: 'root',
      private: true,
      packageManager: 'bun@1.2.0',
      workspaces: {
        packages: ['.'],
        catalogs: { native: { react: '^18.0.0' } },
      },
      dependencies: { react: 'catalog:native' },
    })
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      "packages: ['.']\ncatalogs:\n  native:\n    react: ^18.0.0\n",
    )

    const contexts = createPolicyContexts(await inspectRepository({ cwd: root }))
    const consumer = contexts.find((context) => context.role === 'catalog-consumer')

    expect(consumer).toMatchObject({
      catalogName: 'native',
      managerEvidenceStatus: 'ambiguous',
    })
    expect(consumer).not.toHaveProperty('manager')
  })
})
