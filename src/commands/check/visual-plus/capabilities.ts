import { normalizeVisualPlusWidth, visualPlusLayoutForWidth } from '../render-layout'

export interface VisualPlusCapabilityInput {
  stdoutIsTTY: boolean
  stderrIsTTY: boolean
  columns?: number
  ci?: string
  term?: string
  noColor?: string
  reducedMotion?: boolean
}

export interface VisualPlusCapabilities {
  interactive: boolean
  color: boolean
  unicode: boolean
  motion: boolean
  cursorControl: boolean
  width: number
  layout: 'wide' | 'medium' | 'narrow' | 'plain'
}

export function detectVisualPlusCapabilities(
  input: VisualPlusCapabilityInput,
): VisualPlusCapabilities {
  const width = normalizeVisualPlusWidth(input.columns)
  const dumbTerminal = input.term?.trim().toLowerCase() === 'dumb'
  const ciValue = input.ci?.trim()
  const ciActive = ciValue !== undefined && ciValue !== '' && ciValue.toLowerCase() !== 'false'
  const constrained = !(input.stdoutIsTTY && input.stderrIsTTY) || ciActive || dumbTerminal
  const interactive = !constrained
  const motion = interactive && !input.reducedMotion

  return {
    interactive,
    color: interactive && input.noColor === undefined,
    unicode: !dumbTerminal,
    motion,
    cursorControl: motion,
    width,
    layout: constrained ? 'plain' : visualPlusLayoutForWidth(width),
  }
}
