export function detectLineEnding(content: string): '\n' | '\r\n' {
  return content.includes('\r\n') ? '\r\n' : '\n'
}
