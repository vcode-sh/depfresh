import { configDefaults, defineConfig } from 'vitest/config'

const processObservationTestPaths = [
  'src/commands/apply/index.test.ts',
  'src/commands/apply/process-runner.test.ts',
  'src/commands/global-apply/fake-manager.test.ts',
  'test/visual-plus-cli.test.ts',
]
const testTimeout = 10_000

export default defineConfig({
  test: {
    retry: 0,
    testTimeout,
    projects: [
      {
        test: {
          name: 'default',
          include: configDefaults.include,
          exclude: [...configDefaults.exclude, ...processObservationTestPaths],
          fileParallelism: true,
          retry: 0,
          sequence: { groupOrder: 0 },
          testTimeout,
        },
      },
      {
        test: {
          name: 'process',
          include: processObservationTestPaths,
          fileParallelism: false,
          maxWorkers: 1,
          // A conservative same-user census may transiently preempt a specific assertion.
          retry: 2,
          sequence: { groupOrder: 1 },
          testTimeout,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/**/*.d.ts', 'src/**/*.test.ts'],
    },
  },
})
