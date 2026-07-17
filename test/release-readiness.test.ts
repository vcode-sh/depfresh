import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'tinyglobby'
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
  environment?: unknown
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
  '.github/workflows/dependabot-automerge.yml',
  '.github/workflows/release.yml',
] as const

const checkoutV7Commit = '9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0'
const checkoutConsumerPaths = [
  '.github/workflows/ci.yml',
  '.github/workflows/pr-validation.yml',
  '.github/workflows/dependency-freshness.yml',
  '.github/workflows/release.yml',
  'docs/integrations/README.md',
  'docs/integrations/github-action.md',
  'skills/depfresh/examples/protected-apply.yml',
  'skills/depfresh/examples/read-only-gate.yml',
] as const

function workflow(path: string): Workflow {
  return parse(read(path)) as Workflow
}

function steps(path: string): WorkflowStep[] {
  return Object.values(workflow(path).jobs ?? {}).flatMap((job) => job.steps ?? [])
}

describe('2.0 release readiness', () => {
  it('keeps every shipped release fix inside the 2.0.0 changelog section', () => {
    const changelog = read('CHANGELOG.md')
    const unreleased = changelog.slice(
      changelog.indexOf('## Unreleased') + '## Unreleased'.length,
      changelog.indexOf('## [2.0.0]'),
    )
    const release = changelog.slice(
      changelog.indexOf('## [2.0.0]'),
      changelog.indexOf('## [1.2.0]'),
    )

    expect(unreleased).toContain('First-class exact workspace and catalog exclusions')
    expect(release).toContain('Portable isolated npm bootstrap in the release workflow')
  })

  it('preserves historical README anchors referenced by the 2.0.0 release record', () => {
    expect(read('README.md')).toContain('<a id="skip-native-or-expo-updates-in-a-monorepo"></a>')
  })

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

  it('pins every maintained checkout consumer to the exact checkout v7 commit', () => {
    for (const path of checkoutConsumerPaths) {
      const references = [...read(path).matchAll(/actions\/checkout@([^\s]+)/gu)].map(
        (match) => match[1],
      )

      expect(references.length, path).toBeGreaterThan(0)
      expect(new Set(references), path).toEqual(new Set([checkoutV7Commit]))
    }
  })

  it('runs every workflow on the exact hosted image without third-party coverage upload', () => {
    for (const path of workflowPaths) {
      const content = read(path)
      expect(content, path).not.toContain('self-hosted')
      expect(content, path).not.toMatch(/codecov|CODECOV_TOKEN/iu)
      for (const [jobName, job] of Object.entries(workflow(path).jobs ?? {})) {
        expect(job['runs-on'], `${path}: ${jobName}`).toBe('ubuntu-24.04')
      }
    }
  })

  it.each([
    ['.github/workflows/ci.yml', 'test', ['pnpm test:run --coverage']],
    ['.github/workflows/pr-validation.yml', 'validate', ['pnpm test:run']],
    ['.github/workflows/release.yml', 'verify', ['pnpm test:release', 'pnpm test:run --coverage']],
  ] as const)('builds the distribution before tests in %s', (path, job, testCommands) => {
    const jobSteps = workflow(path).jobs?.[job]?.steps ?? []
    const buildIndex = jobSteps.findIndex((step) => step.run === 'pnpm build')

    expect(buildIndex).toBeGreaterThanOrEqual(0)
    for (const testCommand of testCommands) {
      expect(jobSteps.findIndex((step) => step.run === testCommand)).toBeGreaterThan(buildIndex)
    }
  })

  it('retains the repository-evidence phase notification in the built CLI', () => {
    const builtJavaScript = globSync('dist/**/*.mjs', { cwd: root, absolute: true })
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    expect(builtJavaScript).toMatch(/activeProgress\.onRepositoryInspectionStart\(\)/u)
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
      'pnpm test:demo',
      'npm pack --dry-run --json',
      'scripts/verify-packed-package.mjs',
    ]) {
      expect(release, gate).toContain(gate)
    }
    expect(release).toContain('npm@11.12.0')
    expect(release).toContain('refs/tags/v$' + '{PACKAGE_VERSION}')
    expect(release).toContain(
      'npm publish "file:$GITHUB_WORKSPACE/$PACKAGE_TARBALL" --access public --ignore-scripts',
    )
    expect(release).not.toContain('npm publish "$PACKAGE_TARBALL" --access public --ignore-scripts')
    expect(release).toContain('body_path: docs/releases/v2.0.0.md')
    expect(release).toContain('npm view "depfresh@$' + '{PACKAGE_VERSION}" dist.integrity')
    expect(release).toContain('--install-spec "depfresh@$PACKAGE_VERSION"')
    expect(release).toContain(
      'DEPFRESH_CLI_PATH="$DEMO_INSTALL_ROOT/node_modules/depfresh/dist/cli.mjs"',
    )
    expect(release).toContain(
      '"file:$GITHUB_WORKSPACE/artifacts/$' + '{{ steps.pack.outputs.package-tarball }}"',
    )
    expect(release).toContain('package-integrity: $' + '{{ steps.pack.outputs.package-integrity }}')
    expect(release).toContain(
      'PACKAGE_INTEGRITY: $' + '{{ needs.verify.outputs.package-integrity }}',
    )
    expect(release.match(/NPM_CONFIG_USERCONFIG=/gu)).toHaveLength(2)
    expect(release.match(/NPM_CONFIG_GLOBALCONFIG=/gu)).toHaveLength(2)
    expect(release.match(/NPM_CONFIG_REGISTRY=https:\/\/registry\.npmjs\.org\//gu)).toHaveLength(2)
    expect(release).not.toContain('dirname "$(realpath "$NODE_CLI")"')
    expect(release.match(/"\$NODE_CLI" --version\)" == 'v24\.15\.0'/gu)).toHaveLength(2)
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
  })

  it('keeps OIDC publishing coupled to the workflow without undeclared environments', () => {
    const releaseJobs = workflow('.github/workflows/release.yml').jobs

    expect(releaseJobs?.publish?.environment).toBeUndefined()
    expect(releaseJobs?.release?.environment).toBeUndefined()
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
