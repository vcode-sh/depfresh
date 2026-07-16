const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g')
const TERMINAL_STRING_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal sanitization recognizes encoded control sequences.
  /(?:\u001B[PX^_]|[\u0090\u0098\u009E\u009F])[\s\S]*?(?:\u001B\\|\u009C|$)/gu
const TERMINAL_OSC_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal sanitization recognizes encoded control sequences.
  /(?:\u001B\]|\u009D)[^\u0007\u001B\u009C]*(?:\u0007|\u001B\\|\u009C|$)/gu
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal sanitization recognizes encoded control sequences.
const TERMINAL_CSI_PATTERN = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal sanitization recognizes encoded control sequences.
const TERMINAL_ESCAPE_PATTERN = /\u001B[@-_]?/gu
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal sanitization recognizes encoded control ranges.
const TERMINAL_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu
const TERMINAL_DIRECTION_PATTERN = /[\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu

export function stripAnsi(str: string): string {
  return str.replace(ANSI_PATTERN, '')
}

export function sanitizeTerminalText(str: string): string {
  return str
    .replace(TERMINAL_STRING_PATTERN, '')
    .replace(TERMINAL_OSC_PATTERN, '')
    .replace(TERMINAL_CSI_PATTERN, '')
    .replace(TERMINAL_ESCAPE_PATTERN, '')
    .replace(/[\t\n\r]/gu, ' ')
    .replace(TERMINAL_CONTROL_PATTERN, '')
    .replace(TERMINAL_DIRECTION_PATTERN, '')
}
