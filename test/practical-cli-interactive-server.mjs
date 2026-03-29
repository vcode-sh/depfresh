#!/usr/bin/env node

import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpRoot = mkdtempSync(join(tmpdir(), 'depfresh-interactive-'))
const repoDir = join(tmpRoot, 'app')
const homeDir = join(tmpRoot, 'home')
const binDir = join(tmpRoot, 'bin')

for (const dir of [repoDir, homeDir, binDir]) {
  mkdirSync(dir, { recursive: true })
}

writeFileSync(
  join(repoDir, 'package.json'),
  `${JSON.stringify(
    {
      name: 'interactive-app',
      private: true,
      dependencies: {
        alpha: '^1.0.0',
      },
    },
    null,
    2,
  )}\n`,
  'utf8',
)
writeFileSync(join(repoDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf8')

const registryData = {
  alpha: ['1.0.0', '1.1.0', '2.0.0'],
}

const server = createServer((req, res) => {
  const packageName = decodeURIComponent(
    new URL(req.url ?? '/', 'http://127.0.0.1').pathname.slice(1),
  )
  const versions = registryData[packageName]

  if (!versions) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }

  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({
      name: packageName,
      versions: Object.fromEntries(versions.map((version) => [version, {}])),
      'dist-tags': {
        latest: versions[versions.length - 1],
      },
    }),
  )
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') {
  throw new Error('Failed to start interactive mock registry')
}

writeFileSync(join(repoDir, '.npmrc'), `registry=http://127.0.0.1:${address.port}/\n`, 'utf8')

function writeExecutable(name, body) {
  const filepath = join(binDir, name)
  writeFileSync(filepath, body, 'utf8')
  chmodSync(filepath, 0o755)
}

writeExecutable(
  'pnpm',
  `#!/usr/bin/env node
if (process.argv[2] === '--version') {
  process.stdout.write('10.33.0\\n')
}
process.exit(0)
`,
)

// biome-ignore lint/suspicious/noConsole: intentional smoke-test output
console.log(
  JSON.stringify(
    {
      repoDir,
      homeDir,
      binDir,
      registryUrl: `http://127.0.0.1:${address.port}/`,
    },
    null,
    2,
  ),
)

const shutdown = () => {
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
