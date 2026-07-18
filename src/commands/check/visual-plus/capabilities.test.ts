import { describe, expect, it } from 'vitest'
import {
  detectVisualPlusCapabilities,
  type VisualPlusCapabilities,
  type VisualPlusCapabilityInput,
} from './capabilities'

const capableInput: VisualPlusCapabilityInput = {
  stdoutIsTTY: true,
  stderrIsTTY: true,
  columns: 118,
  term: 'xterm-256color',
}

const capableResult: VisualPlusCapabilities = {
  interactive: true,
  color: true,
  unicode: true,
  motion: true,
  cursorControl: true,
  width: 118,
  layout: 'wide',
}

describe('detectVisualPlusCapabilities', () => {
  it('detects one fully capable color TTY from an immutable startup snapshot', () => {
    const input = Object.freeze({ ...capableInput })

    expect(detectVisualPlusCapabilities(input)).toEqual(capableResult)
    expect(input).toEqual(capableInput)
  })

  it.each(['', '1'])('lets NO_COLOR=%j change only color', (noColor) => {
    expect(detectVisualPlusCapabilities({ ...capableInput, noColor })).toEqual({
      ...capableResult,
      color: false,
    })
  })

  it('lets reduced motion change only motion and cursor control', () => {
    expect(detectVisualPlusCapabilities({ ...capableInput, reducedMotion: true })).toEqual({
      ...capableResult,
      motion: false,
      cursorControl: false,
    })
  })

  it.each([
    { columns: 8, width: 8, layout: 'narrow' },
    { columns: 10, width: 10, layout: 'narrow' },
    { columns: 40, width: 40, layout: 'narrow' },
    { columns: 59, width: 59, layout: 'narrow' },
    { columns: 60, width: 60, layout: 'medium' },
    { columns: 80, width: 80, layout: 'medium' },
    { columns: 99, width: 99, layout: 'medium' },
    { columns: 100, width: 100, layout: 'wide' },
    { columns: 118, width: 118, layout: 'wide' },
    { columns: 0.5, width: 1, layout: 'narrow' },
    { columns: 1.9, width: 1, layout: 'narrow' },
    { columns: 60.9, width: 60, layout: 'medium' },
  ] as const)('normalizes columns=$columns to $width/$layout', ({ columns, width, layout }) => {
    expect(detectVisualPlusCapabilities({ ...capableInput, columns })).toMatchObject({
      width,
      layout,
    })
  })

  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'uses the 80-column medium fallback for columns=%s',
    (columns) => {
      expect(detectVisualPlusCapabilities({ ...capableInput, columns })).toMatchObject({
        width: 80,
        layout: 'medium',
      })
    },
  )

  it.each(['1', '0', 'true', 'yes'])(
    'makes active CI=%j plain and motionless without removing Unicode',
    (ci) => {
      expect(detectVisualPlusCapabilities({ ...capableInput, ci })).toEqual({
        interactive: false,
        color: false,
        unicode: true,
        motion: false,
        cursorControl: false,
        width: 118,
        layout: 'plain',
      })
    },
  )

  it.each([undefined, '', '   ', 'false', ' FALSE '])('keeps CI=%j inactive', (ci) => {
    expect(detectVisualPlusCapabilities({ ...capableInput, ci })).toEqual(capableResult)
  })

  it.each(['dumb', ' DUMB '])('forces ASCII plain output for TERM=%j', (term) => {
    expect(detectVisualPlusCapabilities({ ...capableInput, term })).toEqual({
      interactive: false,
      color: false,
      unicode: false,
      motion: false,
      cursorControl: false,
      width: 118,
      layout: 'plain',
    })
  })

  it.each([
    { stdoutIsTTY: false, stderrIsTTY: true },
    { stdoutIsTTY: true, stderrIsTTY: false },
    { stdoutIsTTY: false, stderrIsTTY: false },
  ])('makes redirected output $stdoutIsTTY/$stderrIsTTY plain', (tty) => {
    expect(detectVisualPlusCapabilities({ ...capableInput, ...tty })).toEqual({
      interactive: false,
      color: false,
      unicode: true,
      motion: false,
      cursorControl: false,
      width: 118,
      layout: 'plain',
    })
  })

  it('keeps constrained width truth while forcing the layout to plain', () => {
    expect(
      detectVisualPlusCapabilities({
        ...capableInput,
        columns: 8,
        stdoutIsTTY: false,
      }),
    ).toMatchObject({ width: 8, layout: 'plain' })
  })
})
