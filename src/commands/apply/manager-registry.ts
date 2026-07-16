export const MANAGER_PHASE_SUPPORT = [
  {
    name: 'npm',
    versionRange: '>=10.0.0 <12.0.0',
    lockfiles: ['package-lock.json', 'npm-shrinkwrap.json'],
  },
  {
    name: 'pnpm',
    versionRange: '>=10.0.0 <12.0.0',
    lockfiles: ['pnpm-lock.yaml'],
  },
  {
    name: 'bun',
    versionRange: '>=1.2.0 <2.0.0',
    lockfiles: ['bun.lock'],
  },
] as const

export type SupportedManagerName = (typeof MANAGER_PHASE_SUPPORT)[number]['name']

export function getManagerPhaseSupport(manager: string) {
  return MANAGER_PHASE_SUPPORT.find((entry) => entry.name === manager)
}
