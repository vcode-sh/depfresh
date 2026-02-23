import type { ArgsDef, CommandDef } from 'citty'
import { renderUsage } from 'citty'

export const DOCUMENTATION_URL = 'https://github.com/vcode-sh/depfresh/tree/main/docs'
export const REPOSITORY_URL = 'https://github.com/vcode-sh/depfresh'

export function withHelpLinks(usage: string): string {
  return `${usage}\n\nDocs: ${DOCUMENTATION_URL}\nGitHub: ${REPOSITORY_URL}\n`
}

export async function showUsageWithLinks<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>,
): Promise<void> {
  try {
    const usage = await renderUsage(cmd, parent)
    // biome-ignore lint/suspicious/noConsole: intentional CLI help output
    console.log(withHelpLinks(usage))
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: intentional CLI help error output
    console.error(error)
  }
}
