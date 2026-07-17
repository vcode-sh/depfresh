import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  applyResultSchema,
  commandErrorSchema,
  inspectResultSchema,
  planResultSchema,
  planResultV2Schema,
} from '../src/contracts/schemas'
import { capabilitiesSchema, capabilitiesV2Schema } from '../src/contracts/capabilities-schema'
import { globalApplySchema, globalPlanSchema } from '../src/contracts/global-schemas'

const root = resolve(import.meta.dirname, '..')
const artifacts = [
  ['schemas/capabilities-v1.json', capabilitiesSchema],
  ['schemas/capabilities-v2.json', capabilitiesV2Schema],
  ['schemas/inspect-v1.json', inspectResultSchema],
  ['schemas/plan-v1.json', planResultSchema],
  ['schemas/plan-v2.json', planResultV2Schema],
  ['schemas/apply-v1.json', applyResultSchema],
  ['schemas/error-v1.json', commandErrorSchema],
  ['schemas/global-plan-v1.json', globalPlanSchema],
  ['schemas/global-apply-v1.json', globalApplySchema],
] as const
const check = process.argv.includes('--check')

for (const [relativePath, schema] of artifacts) {
  const path = resolve(root, relativePath)
  const expected = `${JSON.stringify(schema, null, 2)}\n`
  if (check) {
    let actual = ''
    try {
      actual = await readFile(path, 'utf8')
    } catch {}
    if (actual !== expected) {
      throw new Error(`Generated schema artifact is stale: ${relativePath}`)
    }
    continue
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, expected)
}
