const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g')

export function stripAnsi(str: string): string {
  return str.replace(ANSI_PATTERN, '')
}
