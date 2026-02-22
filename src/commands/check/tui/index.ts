import * as readline from 'node:readline'
import type { ResolvedDepChange } from '../../../types'
import { handleKeypress } from './keymap'
import { eraseLines, renderFrame } from './renderer'
import { createInitialState, resize, type TuiState } from './state'

interface InteractiveTUIOptions {
  explain: boolean
}

interface NodeKey {
  name?: string
  sequence?: string
  ctrl?: boolean
  shift?: boolean
}

const HIDE_CURSOR = '\u001B[?25l'
const SHOW_CURSOR = '\u001B[?25h'

function getRows(): number {
  return process.stdout.rows ?? 24
}

function getCols(): number {
  return process.stdout.columns ?? 80
}

function countFrameLines(frame: string): number {
  const parts = frame.split('\n')
  return frame.endsWith('\n') ? parts.length - 1 : parts.length
}

function getSelectedUpdates(state: TuiState, updates: ResolvedDepChange[]): ResolvedDepChange[] {
  return updates.filter((dep) => state.selectedNames.has(dep.name))
}

export async function createInteractiveTUI(
  updates: ResolvedDepChange[],
  options: InteractiveTUIOptions,
): Promise<ResolvedDepChange[]> {
  if (updates.length === 0) return []

  const input = process.stdin
  const output = process.stdout
  if (typeof input.setRawMode !== 'function') {
    return []
  }

  return new Promise<ResolvedDepChange[]>((resolve, reject) => {
    let state = createInitialState(updates, {
      termRows: getRows(),
      termCols: getCols(),
      explain: options.explain,
    })

    let lastFrameLineCount = 0
    let finished = false

    const render = () => {
      const frame = renderFrame(state)
      if (lastFrameLineCount > 0) {
        output.write(eraseLines(lastFrameLineCount))
      }
      output.write(frame)
      lastFrameLineCount = countFrameLines(frame)
    }

    const cleanup = () => {
      input.off('keypress', onKeypress)
      output.off('resize', onResize)

      if (lastFrameLineCount > 0) {
        output.write(eraseLines(lastFrameLineCount))
      }
      output.write(SHOW_CURSOR)

      input.setRawMode(false)
      input.pause()
    }

    const finish = (result: ResolvedDepChange[]) => {
      if (finished) return
      finished = true
      cleanup()
      resolve(result)
    }

    const onResize = () => {
      state = resize(state, getRows(), getCols())
      render()
    }

    const onKeypress = (_sequence: string, key: NodeKey) => {
      state = handleKeypress(state, key)
      render()

      if (state.cancelled) {
        finish([])
        return
      }

      if (state.confirmed) {
        finish(getSelectedUpdates(state, updates))
      }
    }

    try {
      readline.emitKeypressEvents(input)
      input.setRawMode(true)
      input.resume()
      output.write(HIDE_CURSOR)
      render()
      input.on('keypress', onKeypress)
      output.on('resize', onResize)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
