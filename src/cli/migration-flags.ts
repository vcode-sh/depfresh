import type { ArgsDef } from 'citty'

export const migrationParityArgs: ArgsDef = {
  'ignore-paths': {
    type: 'string',
    description: 'Additional ignore glob patterns (comma-separated)',
  },
  'refresh-cache': {
    type: 'boolean',
    description: 'Bypass cache reads and fetch fresh registry metadata',
    default: false,
  },
  'no-cache': {
    type: 'boolean',
    description: 'Alias for --refresh-cache (cache bypass for this run)',
    default: false,
  },
}
