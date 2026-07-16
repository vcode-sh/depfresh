import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Process-supervision tests observe every new same-user process group and must not race workers.
    fileParallelism: false,
    // A conservative same-user census may transiently preempt a later, more specific assertion.
    retry: 2,
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/**/*.d.ts', 'src/**/*.test.ts'],
    },
  },
})
