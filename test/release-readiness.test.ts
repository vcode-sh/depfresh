import { existsSync, readFileSync } from 'node:fs'
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
  strategy?: {
    matrix?: {
      os?: unknown
    }
  }
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
const matrixRunnerExpression = '$' + '{{ matrix.os }}'
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

describe('2.1.1 release readiness', () => {
  it('moves compact Visual+ work into the dated 2.1.1 changelog section', () => {
    const changelog = read('CHANGELOG.md')
    const unreleased = changelog.slice(
      changelog.indexOf('## Unreleased') + '## Unreleased'.length,
      changelog.indexOf('## [2.1.1]'),
    )
    const candidateRelease = changelog.slice(
      changelog.indexOf('## [2.1.1]'),
      changelog.indexOf('## [2.1.0]'),
    )
    const minorRelease = changelog.slice(
      changelog.indexOf('## [2.1.0]'),
      changelog.indexOf('## [2.0.2]'),
    )
    const hotfixRelease = changelog.slice(
      changelog.indexOf('## [2.0.2]'),
      changelog.indexOf('## [2.0.1]'),
    )
    const patchRelease = changelog.slice(
      changelog.indexOf('## [2.0.1]'),
      changelog.indexOf('## [2.0.0]'),
    )
    const historicalRelease = changelog.slice(
      changelog.indexOf('## [2.0.0]'),
      changelog.indexOf('## [1.2.0]'),
    )

    const compactVisualPlusEntry = 'Historical compact semantic contract'
    const visualPlusEntry = 'Visual+ local result journeys'
    const commandApplyEntry = 'Command-level local write safety'
    const workspaceCatalogEntry = 'First-class exact workspace and catalog exclusions'
    const groupedReceiptEntry = 'Truthful grouped legacy write receipts'

    expect(unreleased.trim()).toBe('')
    expect(candidateRelease).toContain(compactVisualPlusEntry)
    expect(minorRelease).toContain(visualPlusEntry)
    expect(minorRelease).toContain(commandApplyEntry)
    expect(candidateRelease).not.toContain(visualPlusEntry)
    expect(unreleased).not.toContain(groupedReceiptEntry)
    expect(changelog).toContain('## [2.1.1] - 2026-07-20')
    expect(changelog).toContain('## [2.1.0] - 2026-07-19')
    expect(hotfixRelease).toContain(groupedReceiptEntry)
    expect(patchRelease).toContain(workspaceCatalogEntry)
    expect(historicalRelease).toContain('Portable isolated npm bootstrap in the release workflow')
    expect(changelog).toContain(
      '[Unreleased]: https://github.com/vcode-sh/depfresh/compare/v2.1.1...HEAD',
    )
    expect(changelog).toContain(
      '[2.1.1]: https://github.com/vcode-sh/depfresh/compare/v2.1.0...v2.1.1',
    )
    expect(changelog).toContain(
      '[2.1.0]: https://github.com/vcode-sh/depfresh/compare/v2.0.2...v2.1.0',
    )
    expect(changelog).toContain(
      '[2.0.2]: https://github.com/vcode-sh/depfresh/compare/v2.0.1...v2.0.2',
    )
  })

  it('preserves historical README anchors referenced by the 2.0.0 release record', () => {
    expect(read('README.md')).toContain('<a id="skip-native-or-expo-updates-in-a-monorepo"></a>')
  })

  it('couples all current package and runner surfaces to 2.1.1', () => {
    const packageJson = JSON.parse(read('package.json')) as { version: string }
    expect(packageJson.version).toBe('2.1.1')
    expect(read('.nvmrc')).toBe('24.15.0\n')

    expect(read('README.md')).toContain('[2.1.1 release notes](docs/releases/v2.1.1.md)')
    expect(read('README.md')).toContain('[2.1.0 release notes](docs/releases/v2.1.0.md)')
    expect(read('docs/README.md')).toContain('[2.1.1 Release Notes](./releases/v2.1.1.md)')
    for (const path of ['docs/agents/README.md', 'skills/depfresh/recipes/runners.md']) {
      expect(read(path), path).toContain('DEPFRESH_VERSION=2.1.1')
      expect(read(path), path).not.toContain('DEPFRESH_VERSION=2.1.0')
      expect(read(path), path).not.toContain('DEPFRESH_VERSION=2.0.2')
      expect(read(path), path).toContain('depfresh@$DEPFRESH_VERSION')
      expect(read(path), path).not.toContain('depfresh@1.2.0')
    }
    expect(read('docs/integrations/README.md')).toContain('capabilities-v2.json` in 2.1.1')
    expect(read('.github/ISSUE_TEMPLATE/bug_report.yml')).toContain('placeholder: "2.1.1"')
    expect(read('test/wun-demo-proof.mjs')).toContain("capabilities.version, '2.1.1'")
  })

  it('pins every maintained README runner command to 2.1.1', () => {
    const readme = read('README.md')
    const currentInstructions = readme.slice(
      readme.indexOf('## Try it'),
      readme.indexOf('## Everyday commands'),
    )

    expect(currentInstructions.match(/depfresh@2\.1\.1/gu)).toHaveLength(5)
    expect(currentInstructions).not.toContain('depfresh@2.1.0')
  })

  it('pins both maintained WUN published-runner commands to 2.1.1', () => {
    const demo = read('test/wun-demo-proof.mjs')
    const currentInstructions = demo.slice(
      demo.indexOf('Run from this directory after depfresh 2.1.1 is available:'),
      demo.indexOf('The `native` catalog'),
    )

    expect(currentInstructions.match(/bunx depfresh@2\.1\.1/gu)).toHaveLength(2)
    expect(currentInstructions).not.toContain('bunx depfresh@2.1.0')
  })

  it('keeps the 2.1.1 local evidence scoped to the completed compact semantic contract', () => {
    expect(existsSync(join(root, 'docs/releases/v2.1.1.md'))).toBe(true)
    const release = read('docs/releases/v2.1.1.md')

    expect(release).toContain('# depfresh 2.1.1: historical compact Visual+ evidence')
    for (const bullet of [
      'Plan 037 completed the compact semantic contract for the then-current default projection.',
      'Plan 038 owns the in-progress hybrid human default and requires independent replacement evidence.',
      '`--long` preserves complete operation, owner, shared-dependency, occurrence, and physical-target membership.',
    ]) {
      expect(release, bullet).toContain(`- ${bullet}`)
    }
    expect(release).toContain(
      '../superpowers/specs/2026-07-20-visual-plus-hybrid-default-design.md',
    )
    expect(release).toContain('../../plans/038-visual-plus-hybrid-default.md')
    expect(release).toContain('Existing tarball, Bun, and Spreadoo evidence proves Plan 037 only.')
    expect(release).toContain('It is not Plan 038 proof.')
    expect(release).toContain(
      'Status: corrected local source candidate; artifact regeneration pending.',
    )
    expect(release).toContain('Superseded local artifact evidence from `41f0002`')
    expect(release).toContain('none of the historical evidence below describes the corrected HEAD')
    expect(release.replace(/\s+/gu, ' ')).toContain(
      'did not rebuild, repack, reinstall, publish, tag, push, run hosted workflows, or repeat the live',
    )
    expect(release).toContain(
      'No npm publication, Git tag, GitHub release, hosted workflow, or public artifact is claimed.',
    )
    expect(release).not.toMatch(
      /npm exposes|published to npm|hosted run .*passed|public .*byte-identical/iu,
    )
    expect(release).not.toContain('TBD')
    expect(release).not.toContain('TODO')
  })

  it('documents the in-progress five-region hybrid default without retired compact caps', () => {
    const table = read('docs/output-formats/table.md')
    const normalizedTable = table.replace(/\s+/gu, ' ')
    const currentDocs = [
      'README.md',
      'CHANGELOG.md',
      'docs/output-formats/table.md',
      'docs/troubleshooting.md',
      'docs/releases/v2.1.1.md',
    ].map((path) => ({ path, content: read(path) }))

    expect(read('docs/superpowers/specs/2026-07-18-safe-write-visual-plus-design.md')).toContain(
      '[approved hybrid amendment](./2026-07-20-visual-plus-hybrid-default-design.md)',
    )
    expect(
      read('docs/superpowers/specs/2026-07-20-visual-plus-hybrid-default-design.md'),
    ).toContain('**Status:** Implementation in progress under Plan 038.')
    expect(normalizedTable).toContain(
      'five ordered regions: context, overview, risk focus, update ledger, and receipt',
    )
    expect(normalizedTable).toContain('every selected update exactly once')
    expect(table).toContain('`diff-asc`  | Major, then Minor, then Patch.')
    expect(table).toContain('`diff-desc` | Patch, then Minor, then Major.')
    expect(normalizedTable).toContain('`--long` remains the exhaustive Visual+ audit')
    expect(normalizedTable).toContain('no durable lifecycle rail')
    expect(normalizedTable).toContain(
      'Plain, pipes, CI, and `TERM=dumb` retain the same five regions',
    )
    expect(normalizedTable).toContain('`--group`, `--sort`, `--timediff`, and `--nodecompat`')

    for (const { path, content } of currentDocs) {
      expect(content, path).not.toMatch(/80 durable projected lines|80-line cap/iu)
      expect(content, path).not.toMatch(/bounded owner\/shared\/update\/target previews/iu)
      expect(content, path).not.toMatch(/not-attempted.*preview.*bounded/iu)
    }

    for (const path of [
      'README.md',
      'CHANGELOG.md',
      'docs/troubleshooting.md',
      'docs/superpowers/specs/2026-07-20-visual-plus-compact-2.1.1-design.md',
    ]) {
      const content = read(path)
      expect(content.toLowerCase(), path).toContain('historical compact semantic contract')
      expect(content, path).toContain('Plan 038')
    }

    const plan037 = read('plans/037-visual-plus-compact-2.1.1.md')
    const plan038 = read('plans/038-visual-plus-hybrid-default.md')
    const registry = read('plans/README.md')
    expect(plan037).toContain('historically complete compact semantic contract')
    expect(plan037).toContain('visual-composition objective moved to Plan 038')
    expect(plan038).toContain('**Status:** IN PROGRESS')
    expect(plan038).toContain('Task 6 and the final evidence review')
    expect(registry).toContain(
      '| [038](./038-visual-plus-hybrid-default.md) | Hybrid Visual+ human default | P1 | L | 037 | IN PROGRESS |',
    )
  })

  it('preserves the dedicated published 2.1.0 release record', () => {
    const release = read('docs/releases/v2.1.0.md')

    expect(release).toContain('# depfresh 2.1.0')
    for (const bullet of [
      'Command-level preflight covers every selected physical target before the first replacement.',
      'Visual+ hierarchy keeps topology, severity, major risk, owner impact, shared dependencies, and final receipts legible.',
      'Complete fallbacks preserve append-only output in pipes, CI, and TERM=dumb without terminal control leakage.',
      'Replacement is atomic per file only; a repository is not an atomic transaction, and recovery remains best effort.',
      'Incomplete or unobservable recovery remains unknown and exits non-successfully.',
    ]) {
      expect(release, bullet).toContain(`- ${bullet}`)
    }
    expect(release).toContain('v2.1.0')
    expect(release).toContain('Current retained Visual+ verifier contract: `54` tests')
    expect(release).not.toContain('TBD')
    expect(release).not.toContain('TODO')
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
        if (path === '.github/workflows/ci.yml' && jobName === 'visual-plus-pty') {
          expect(job['runs-on'], `${path}: ${jobName}`).toBe(matrixRunnerExpression)
          expect(job.strategy?.matrix?.os, `${path}: ${jobName}`).toEqual([
            'ubuntu-24.04',
            'macos-15',
          ])
        } else {
          expect(job['runs-on'], `${path}: ${jobName}`).toBe('ubuntu-24.04')
        }
      }
    }
  })

  it('defines the exact two-platform Visual Plus PTY release gate', () => {
    const job = workflow('.github/workflows/ci.yml').jobs?.['visual-plus-pty']
    expect(job).toBeDefined()
    expect(job?.['runs-on']).toBe(matrixRunnerExpression)
    expect(job?.strategy?.matrix?.os).toEqual(['ubuntu-24.04', 'macos-15'])
    const steps = job?.steps ?? []
    const isolatedNpm = steps.find((step) => step.name === 'Install exact isolated npm')?.run
    expect(isolatedNpm).toContain('depfresh-visual-plus-npm.XXXXXX')
    expect(isolatedNpm).toContain('npm@11.12.0')
    expect(isolatedNpm).toContain('"$NPM_TOOL_ROOT/prefix/bin/npm" --version)" == \'11.12.0\'')
    expect(isolatedNpm).toContain('printf \'%s\\n\' "$NPM_TOOL_ROOT/prefix/bin" >> "$GITHUB_PATH"')
    expect(isolatedNpm).toContain('NPM_CONFIG_USERCONFIG')
    expect(isolatedNpm).toContain('NPM_CONFIG_GLOBALCONFIG')
    expect(steps.find((step) => step.name === 'Test Visual Plus PTY and fallbacks')?.run).toBe(
      'pnpm exec vitest run test/visual-plus-cli.test.ts --retry=0',
    )
    const replay = steps.find(
      (step) => step.name === 'Replay Visual Plus against the installed packed artifact',
    )?.run
    expect(replay).toContain(
      'node scripts/verify-packed-package.mjs artifacts/visual-plus-pack.json --visual-plus',
    )
    const cleanup = steps.find((step) => step.name === 'Clean isolated npm')
    expect(cleanup?.if).toBe(['$', '{{ always() }}'].join(''))
    expect(cleanup?.run).toContain('rm -rf -- "$NPM_TOOL_ROOT"')
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

  it('uses a self-contained local package gate while hosted workflows retain manifests', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>
    }
    const ci = read('.github/workflows/ci.yml')
    const release = read('.github/workflows/release.yml')
    const explicitVerifier = 'node scripts/verify-packed-package.mjs artifacts/pack.json'
    const explicitPack =
      'npm pack --json --ignore-scripts --pack-destination artifacts > artifacts/pack.json'

    expect(packageJson.scripts?.['verify:package']).toBe('node scripts/verify-local-package.mjs')
    expect(ci).toContain(explicitPack)
    expect(ci).toContain(explicitVerifier)
    expect(release).toContain(explicitPack)
    expect(release).toContain(explicitVerifier)
    expect(release).toContain(`${explicitVerifier} --visual-plus`)
    expect(ci).not.toContain('scripts/verify-local-package.mjs')
    expect(release).not.toContain('scripts/verify-local-package.mjs')
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
    expect(release).toContain('body_path: docs/releases/v2.1.1.md')
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
