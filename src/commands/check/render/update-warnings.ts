import type { ResolvedDepChange } from '../../../types'
import { sanitizeTerminalText } from '../../../utils/format'
import { normalizeVersion } from '../../../utils/versions'

export function collectUpdateWarnings(
  inputs: readonly { owner: string; updates: readonly ResolvedDepChange[] }[],
): string[] {
  const groups = new Map<string, { label: string; owners: Set<string>; messages: Set<string> }>()
  for (const { owner, updates } of inputs) {
    for (const update of updates) {
      if (update.diff === 'none' || update.diff === 'error') continue
      const current = normalizeVersion(update.currentVersion)
      const target = normalizeVersion(update.targetVersion)
      if (!(current && target)) continue
      const data = update.pkgData
      const messages: string[] = []
      const currentNode = data.engines?.[current]
      const targetNode = data.engines?.[target]
      if (targetNode && currentNode && targetNode !== currentNode) {
        messages.push(`Node requirement changed: ${currentNode} → ${targetNode}`)
      } else if (targetNode && data.engineMetadata?.[current] === 'absent') {
        messages.push(`Node requirement added: ${targetNode}`)
      }
      const currentPeers =
        data.peerDependencies?.[current] ??
        (data.peerMetadata?.[current] === 'absent' ? {} : undefined)
      if (
        currentPeers &&
        data.peerMetadata?.[current] !== 'unknown' &&
        data.peerMetadata?.[target] !== 'unknown'
      ) {
        const optionalCurrent = data.optionalPeerDependencies?.[current] ?? []
        const optionalTarget = data.optionalPeerDependencies?.[target] ?? []
        for (const [name, range] of Object.entries(data.peerDependencies?.[target] ?? {})) {
          if (optionalTarget.includes(name)) continue
          const before = currentPeers[name]
          if (before === undefined) messages.push(`Required peer added: ${name} ${range}`)
          else if (optionalCurrent.includes(name)) {
            messages.push(`Peer now required: ${name} ${range}`)
          } else if (before !== range) {
            messages.push(`Required peer changed: ${name} ${before} → ${range}`)
          }
        }
      }
      if (data.deprecated?.[target]) messages.push(`Deprecated: ${data.deprecated[target]}`)
      if (update.diff === 'major') {
        messages.push('Major update may require code changes')
        const link = safeInfoUrl(data.repository) ?? safeInfoUrl(data.homepage)
        if (link) messages.push(`Project info: ${link}`)
      }
      const key = JSON.stringify([update.name, update.currentVersion, update.targetVersion])
      let group = groups.get(key)
      if (!group) {
        group = {
          label: sanitizeTerminalText(
            `${update.name} ${update.currentVersion} → ${update.targetVersion}`,
          ),
          owners: new Set(),
          messages: new Set(),
        }
        groups.set(key, group)
      }
      group.owners.add(sanitizeTerminalText(owner))
      for (const message of messages) group.messages.add(sanitizeTerminalText(message))
    }
  }
  return [...groups.values()]
    .filter((group) => group.messages.size > 0)
    .map(
      (group) =>
        `${group.label} (${[...group.owners].join(', ')}): ${[...group.messages].join('; ')}`,
    )
}

function safeInfoUrl(value: string | undefined): string | undefined {
  if (!value || sanitizeTerminalText(value) !== value) return undefined
  try {
    const url = new URL(value)
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined
    }
    return url.href
  } catch {
    return undefined
  }
}
