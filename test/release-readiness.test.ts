import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { parse } from 'yaml'
import type {
  ArtifactTrustDimensionResult,
  ArtifactTrustResult,
  ArtifactVerificationTarget,
} from '../src/index'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

interface WorkflowStep {
  name?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
}

interface WorkflowJob {
  'runs-on'?: unknown
  steps?: WorkflowStep[]
}

interface Workflow {
  jobs?: Record<string, WorkflowJob>
}

const workflowPaths = [
  '.github/workflows/ci.yml',
  '.github/workflows/pr-validation.yml',
  '.github/workflows/dependency-freshness.yml',
  '.github/workflows/release.yml',
] as const

function workflow(path: string): Workflow {
  return parse(read(path)) as Workflow
}

function steps(path: string): WorkflowStep[] {
  return Object.values(workflow(path).jobs ?? {}).flatMap((job) => job.steps ?? [])
}

describe('2.0 release readiness', () => {
  it('couples all current package and runner surfaces to 2.0.0', () => {
    const packageJson = JSON.parse(read('package.json')) as { version: string }
    expect(packageJson.version).toBe('2.0.0')
    expect(read('.nvmrc')).toBe('24.15.0\n')

    expect(read('README.md')).toContain('depfresh@2.0.0')
    for (const path of ['docs/agents/README.md', 'skills/depfresh/recipes/runners.md']) {
      expect(read(path), path).toContain('DEPFRESH_VERSION=2.0.0')
      expect(read(path), path).toContain('depfresh@$DEPFRESH_VERSION')
      expect(read(path), path).not.toContain('depfresh@1.2.0')
    }
  })

  it('uses exact Node and immutable external actions in every release-facing workflow', () => {
    for (const path of workflowPaths) {
      const content = read(path)
      expect(content, path).not.toMatch(/node-version:\s*24(?:\.x)?\s*$/mu)
      expect(content, path).not.toContain('npm@latest')
      for (const step of steps(path)) {
        if (step.uses?.startsWith('actions/setup-node@')) {
          expect(step.with?.['node-version'], `${path}: ${step.name ?? step.uses}`).toBe('24.15.0')
        }
        if (step.uses) expect(step.uses, path).toMatch(/@[a-f0-9]{40}(?:\s|$)/u)
      }
    }
  })

  it('runs permission-sensitive repository evidence tests as an unprivileged hosted user', () => {
    expect(workflow('.github/workflows/ci.yml').jobs?.test?.['runs-on']).toBe('ubuntu-latest')
  })

  it('runs the complete release gate before publishing the exact verified tarball', () => {
    const release = read('.github/workflows/release.yml')
    for (const gate of [
      'pnpm schemas:check',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test:run --coverage',
      'pnpm build',
      'pnpm test:smoke',
      'npm pack --dry-run --json',
      'scripts/verify-packed-package.mjs',
    ]) {
      expect(release, gate).toContain(gate)
    }
    expect(release).toContain('npm@11.12.0')
    expect(release).toContain('refs/tags/v$' + '{PACKAGE_VERSION}')
    expect(release).toContain('npm publish "$PACKAGE_TARBALL" --access public --ignore-scripts')
    expect(release).toContain('body_path: docs/releases/v2.0.0.md')
    expect(release).toContain('npm view "depfresh@$' + '{PACKAGE_VERSION}" dist.integrity')
    expect(release).toContain('--install-spec "depfresh@$PACKAGE_VERSION"')
    expect(release).toContain('package-integrity: $' + '{{ steps.pack.outputs.package-integrity }}')
    expect(release).toContain(
      'PACKAGE_INTEGRITY: $' + '{{ needs.verify.outputs.package-integrity }}',
    )
    expect(release.match(/NPM_CONFIG_USERCONFIG=/gu)).toHaveLength(2)
    expect(release.match(/NPM_CONFIG_GLOBALCONFIG=/gu)).toHaveLength(2)
    expect(release.match(/NPM_CONFIG_REGISTRY=https:\/\/registry\.npmjs\.org\//gu)).toHaveLength(2)
    expect(release).toContain(
      'pnpm install --frozen-lockfile --store-dir "$NPM_TOOL_ROOT/pnpm-store"',
    )
    const npmInstallBlocks = release.split('- name: Install exact isolated npm').slice(1)
    expect(npmInstallBlocks).toHaveLength(2)
    for (const block of npmInstallBlocks) {
      expect(block.indexOf("printf 'NPM_TOOL_ROOT=%s\\n'")).toBeGreaterThanOrEqual(0)
      expect(block.indexOf("printf 'NPM_TOOL_ROOT=%s\\n'")).toBeLessThan(
        block.indexOf('install --global'),
      )
    }
    expect(release).toContain('runs-on: ubuntu-24.04')
    expect(release).toContain('environment: release-hosted')
  })

  it('never runs a floating depfresh package in dependency freshness automation', () => {
    const freshness = read('.github/workflows/dependency-freshness.yml')
    expect(freshness).not.toContain('npx --yes depfresh')
    expect(freshness).toContain('pnpm exec depfresh')
    expect(freshness).not.toContain('continue-on-error: true')
    expect(freshness).toContain('case "$EXIT_CODE" in')
    expect(freshness).toContain('0|1)')
    expect(freshness).toContain('exit "$EXIT_CODE"')
  })

  it('keeps exact artifact trust types available from the public entry point', () => {
    expectTypeOf<ArtifactVerificationTarget>().toBeObject()
    expectTypeOf<ArtifactTrustDimensionResult>().toBeObject()
    expectTypeOf<ArtifactTrustResult>().toBeObject()
  })
})
