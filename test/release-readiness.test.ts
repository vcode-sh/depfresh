import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

interface WorkflowStep {
  name?: string
  run?: string
  uses?: string
  with?: Record<string, unknown>
}

interface WorkflowJob {
  needs?: string | string[]
  steps?: WorkflowStep[]
}

interface Workflow {
  jobs?: Record<string, WorkflowJob>
}

function workflow(path: string): Workflow {
  return parse(read(path)) as Workflow
}

function steps(document: Workflow): WorkflowStep[] {
  return Object.values(document.jobs ?? {}).flatMap((job) => job.steps ?? [])
}

describe('release safety', () => {
  it('pins external workflow actions immutably and avoids third-party coverage uploads', () => {
    const paths = readdirSync(join(root, '.github/workflows'))
      .filter((path) => /\.ya?ml$/u.test(path))
      .map((path) => `.github/workflows/${path}`)

    for (const path of [...paths, 'action.yml']) {
      const content = read(path)
      expect(content, path).not.toMatch(/codecov|CODECOV_TOKEN/iu)
      for (const [, action, revision] of content.matchAll(/uses:\s+([^@\s]+)@([^\s]+)/gu)) {
        expect(revision, `${path}: ${action}`).toMatch(/^[a-f0-9]{40}$/u)
      }
    }
  })

  it('publishes the verified tarball with lifecycle scripts disabled', () => {
    const release = read('.github/workflows/release.yml')
    const jobs = workflow('.github/workflows/release.yml').jobs
    expect(jobs?.publish?.needs).toContain('verify')
    expect(release).toContain('scripts/verify-packed-package.mjs')
    expect(release).toContain(
      'npm publish "file:$GITHUB_WORKSPACE/$PACKAGE_TARBALL" --access public --ignore-scripts',
    )
    expect(release).toContain('refs/tags/v$' + '{PACKAGE_VERSION}')
    expect(release).toContain('npm view "depfresh@$' + '{PACKAGE_VERSION}" dist.integrity')
    expect(release).toContain(
      'PACKAGE_INTEGRITY: $' + '{{ needs.verify.outputs.package-integrity }}',
    )
    const packageJson = JSON.parse(read('package.json')) as { version: string }
    expect(release).toContain(`body_path: docs/releases/v${packageJson.version}.md`)
    expect(read(`docs/releases/v${packageJson.version}.md`)).toContain(
      `# depfresh ${packageJson.version}`,
    )
  })

  it('passes the tested distribution to downstream CI jobs and the exact tarball to Windows', () => {
    const ci = workflow('.github/workflows/ci.yml')
    expect(steps(ci).filter((step) => step.run === 'pnpm build')).toHaveLength(1)
    const testSteps = ci.jobs?.test?.steps ?? []
    const buildIndex = testSteps.findIndex((step) => step.run === 'pnpm build')
    const suiteIndex = testSteps.findIndex((step) =>
      /^pnpm test:run\b.*--coverage/u.test(step.run ?? ''),
    )
    expect(buildIndex).toBeGreaterThanOrEqual(0)
    expect(suiteIndex).toBeGreaterThan(buildIndex)
    for (const job of ['build', 'visual-plus-pty', 'distribution-smoke']) {
      const download = ci.jobs?.[job]?.steps?.find((step) =>
        step.uses?.startsWith('actions/download-artifact@'),
      )
      expect(download?.with, job).toMatchObject({ name: 'depfresh-tested-dist', path: 'dist' })
    }
    const windows = ci.jobs?.['windows-installed']
    expect(windows?.needs).toBe('distribution-smoke')
    expect(
      windows?.steps?.find((step) => step.uses?.startsWith('actions/download-artifact@'))?.with,
    ).toMatchObject({ name: 'depfresh-tested-package', path: 'artifacts' })
    const install = windows?.steps?.find((step) => step.name === 'Install exact tested tarball')
    expect(install?.run).toContain('--ignore-scripts')
    expect(install?.run).toContain('node_modules/.bin/depfresh.cmd')
  })
})
