import { isDeepStrictEqual } from 'node:util'
import type { CheckRunController } from '../run-controller'
import type { CheckRunPhase, CheckRunSnapshot } from '../run-model'
import type { VisualPlusCapabilities } from './capabilities'
import {
  createVisualPlusSectionInput,
  type DeepReadonly,
  VisualPlusInputError,
  type VisualPlusRunMetadata,
  type VisualPlusSectionInput,
} from './input'
import { buildVisualPlusInsights, VisualPlusInsightError } from './insights'
import { renderVisualPlusChanges } from './sections/changes'
import { renderVisualPlusCompactReview } from './sections/compact'
import { renderVisualPlusDistribution } from './sections/distribution'
import { renderVisualPlusHeader } from './sections/header'
import { renderVisualPlusImpact } from './sections/impact'
import {
  renderVisualPlusLifecycleHeading,
  renderVisualPlusLifecyclePhase,
} from './sections/lifecycle'
import { renderVisualPlusReceipt } from './sections/receipt'
import { renderVisualPlusRisk } from './sections/risk'
import { renderVisualPlusShared } from './sections/shared'
import { renderVisualPlusTopology } from './sections/topology'
import { renderVisualPlusTransaction } from './sections/transaction'

const REFRESH_DELAY_MS = 50
const TERMINAL_PHASE_STATUSES = new Set(['passed', 'skipped', 'blocked', 'failed', 'unknown'])
const PHASE_ORDER = [
  'discover',
  'inspect',
  'resolve',
  'review',
  'preflight',
  'stage',
  'apply',
  'observe',
  'recover',
  'complete',
] as const

export interface VisualPlusOutputWriter {
  write(chunk: string): void
}

export interface VisualPlusScheduler {
  schedule(callback: () => void, delayMs: number): () => void
}

export interface CreateVisualPlusRendererOptions {
  capabilities: VisualPlusCapabilities
  writer: VisualPlusOutputWriter
  scheduler: VisualPlusScheduler
  onError(error: unknown): void
}

export interface VisualPlusRenderer {
  start(controller: CheckRunController, run: VisualPlusRunMetadata): void
  writeReview(input: VisualPlusSectionInput): void
  finalize(input: VisualPlusSectionInput): void
  suspend<T>(write: () => T): T
  suspendAsync<T>(write: () => Promise<T>): Promise<T>
  dispose(): void
}

type RendererState = 'idle' | 'live' | 'review-written' | 'finalized' | 'failed' | 'disposed'

interface PendingFrame {
  active: boolean
  cancel?: () => void
}

class VisualPlusRendererContractError extends Error {
  constructor(message: string) {
    super(`Visual+ renderer: ${message}`)
  }
}

export function createVisualPlusRenderer(
  options: CreateVisualPlusRendererOptions,
): VisualPlusRenderer {
  const capabilities = Object.freeze({ ...options.capabilities })
  const cursorMode = capabilities.motion && capabilities.cursorControl
  let state: RendererState = 'idle'
  let unsubscribe: (() => void) | undefined
  let latestSnapshot: CheckRunSnapshot | undefined
  let startupRun: DeepReadonly<VisualPlusRunMetadata> | undefined
  let reviewInput: DeepReadonly<VisualPlusSectionInput> | undefined
  let finalInput: DeepReadonly<VisualPlusSectionInput> | undefined
  let pendingFrame: PendingFrame | undefined
  let ownedLines = 0
  let suspensionDepth = 0
  let errorReported = false
  let firstFailure: unknown
  let writerActive = false
  let cleanupActive = false
  let cleanupDeferred = false
  let deferredReentrantError: VisualPlusRendererContractError | undefined
  const durablePhases = new Map<string, string>()
  let plainCurrentPhase = ''

  const writeChunk = (chunk: string, onAccepted?: () => void): void => {
    if (writerActive) rejectReentrant('reentrant output write')
    writerActive = true
    let writerThrew = false
    let writerError: unknown
    try {
      options.writer.write(chunk)
    } catch (error) {
      writerThrew = true
      writerError = error
    }
    writerActive = false
    if (!writerThrew) onAccepted?.()

    const reentrantError = deferredReentrantError
    if (reentrantError) {
      deferredReentrantError = undefined
      if (cleanupActive) {
        if (writerThrew && writerError === reentrantError) {
          writerThrew = false
          writerError = undefined
        }
      } else {
        fail(reentrantError, false)
        throw reentrantError
      }
    }
    if (cleanupDeferred && !cleanupActive) {
      cleanupDeferred = false
      try {
        clearOwnedForCleanup()
      } catch {
        // The retained renderer failure remains authoritative.
      }
    }
    if (writerThrew) throw writerError
    if (!cleanupActive && state === 'failed' && firstFailure !== undefined) throw firstFailure
  }

  const writeDurableLines = (lines: readonly string[]): void => {
    for (const line of lines) writeChunk(`${line}\n`)
  }

  const clearFrame = (): void => {
    if (!cursorMode || ownedLines === 0) return
    const count = ownedLines
    const erase = '\r\x1B[2K\n'.repeat(count)
    writeChunk(`\x1B[${count}A${erase}\x1B[${count}A`, () => {
      ownedLines = 0
    })
  }

  const drawFrame = (lines: readonly string[]): void => {
    if (!cursorMode) return
    if (lines.length === 0) {
      ownedLines = 0
      return
    }
    const frame = lines.map((line) => `\r\x1B[2K${line}\n`).join('')
    writeChunk(frame, () => {
      ownedLines = lines.length
    })
  }

  const clearOwnedForCleanup = (): void => {
    cleanupActive = true
    try {
      clearFrame()
    } finally {
      cleanupActive = false
      deferredReentrantError = undefined
    }
  }

  const cancelPending = (): void => {
    const pending = pendingFrame
    if (!pending) return
    pendingFrame = undefined
    pending.active = false
    pending.cancel?.()
  }

  const unsubscribeOnce = (): void => {
    const current = unsubscribe
    unsubscribe = undefined
    current?.()
  }

  const cleanup = (): void => {
    let firstError: unknown
    try {
      cancelPending()
    } catch (error) {
      firstError = error
    }
    try {
      if (writerActive) cleanupDeferred = true
      else {
        cleanupDeferred = false
        clearOwnedForCleanup()
      }
    } catch (error) {
      firstError ??= error
    }
    try {
      unsubscribeOnce()
    } catch (error) {
      firstError ??= error
    }
    if (firstError !== undefined) throw firstError
  }

  const reportInternal = (error: unknown): void => {
    if (errorReported) return
    errorReported = true
    try {
      options.onError(error)
    } catch {
      // The first renderer failure remains authoritative.
    }
  }

  const fail = (error: unknown, internal: boolean): void => {
    firstFailure ??= error
    state = 'failed'
    try {
      cleanup()
    } catch {
      // Cleanup failures never replace the first failure.
    }
    if (internal) reportInternal(error)
  }

  const contractFailure = (message: string): never => {
    const error = new VisualPlusRendererContractError(message)
    fail(error, false)
    throw error
  }

  const internalFailure = (error: unknown): never => {
    fail(error, true)
    throw error
  }

  const isContractError = (error: unknown): boolean =>
    error instanceof VisualPlusRendererContractError ||
    error instanceof VisualPlusInputError ||
    error instanceof VisualPlusInsightError

  const explicitFailure = (error: unknown): never => {
    if (isContractError(error)) {
      if (state !== 'failed') fail(error, false)
      throw error
    }
    return internalFailure(error)
  }

  const rejectReentrant = (message: string): never => {
    const error = new VisualPlusRendererContractError(message)
    deferredReentrantError ??= error
    throw error
  }

  const assertNotReentrant = (): void => {
    if (writerActive) rejectReentrant('reentrant renderer method during output')
  }

  const currentActivePhase = (snapshot: CheckRunSnapshot): CheckRunPhase | undefined =>
    snapshot.phases.find((phase) => phase.status === 'active')

  const terminalPhases = (snapshot: CheckRunSnapshot): readonly CheckRunPhase[] =>
    PHASE_ORDER.flatMap((name) => {
      const phase = snapshot.phases.find((candidate) => candidate.name === name)
      return phase &&
        TERMINAL_PHASE_STATUSES.has(phase.status) &&
        !(phase.name === 'complete' && snapshot.exitCode !== null)
        ? [phase]
        : []
    })

  const appendTerminalFacts = (snapshot: CheckRunSnapshot): boolean => {
    const fresh: string[] = []
    for (const phase of terminalPhases(snapshot)) {
      const signature = semanticSignature(phase)
      const previous = durablePhases.get(phase.name)
      if (previous === signature) continue
      if (previous !== undefined) contractFailure(`terminal phase ${phase.name} changed`)
      fresh.push(...renderVisualPlusLifecyclePhase(phase, capabilities))
      durablePhases.set(phase.name, signature)
    }
    if (fresh.length === 0) return false
    if (cursorMode) clearFrame()
    writeDurableLines(fresh)
    return true
  }

  const renderLatest = (): void => {
    if (!(state === 'live' || state === 'review-written') || suspensionDepth > 0) return
    const snapshot = latestSnapshot
    if (!snapshot) return
    appendTerminalFacts(snapshot)
    const active = currentActivePhase(snapshot)
    const lines = active ? renderVisualPlusLifecyclePhase(active, capabilities) : []
    const signature = semanticSignature(lines)
    if (cursorMode) {
      const currentSignature = plainCurrentPhase
      if (signature === currentSignature && ownedLines > 0) return
      clearFrame()
      drawFrame(lines)
      plainCurrentPhase = signature
      return
    }
    if (active && signature !== plainCurrentPhase) {
      writeDurableLines(lines)
      plainCurrentPhase = signature
    }
  }

  const handleObserverFailure = (error: unknown): void => {
    fail(error, !isContractError(error))
  }

  const scheduleLatest = (): void => {
    if (!cursorMode || pendingFrame || suspensionDepth > 0) return
    const token: PendingFrame = { active: true }
    pendingFrame = token
    try {
      const cancel = options.scheduler.schedule(() => {
        if (!token.active || pendingFrame !== token) return
        token.active = false
        pendingFrame = undefined
        try {
          renderLatest()
        } catch (error) {
          handleObserverFailure(error)
        }
      }, REFRESH_DELAY_MS)
      if (token.active && pendingFrame === token) token.cancel = cancel
      else cancel()
    } catch (error) {
      token.active = false
      if (pendingFrame === token) pendingFrame = undefined
      handleObserverFailure(error)
    }
  }

  const observe = (snapshot: CheckRunSnapshot, initial: boolean): void => {
    if (!(state === 'live' || state === 'review-written')) return
    latestSnapshot = snapshot
    if (suspensionDepth > 0) return
    try {
      if (initial || !cursorMode) renderLatest()
      else scheduleLatest()
    } catch (error) {
      handleObserverFailure(error)
    }
  }

  const requireOperationalState = (): void => {
    if (!(state === 'live' || state === 'review-written')) {
      contractFailure('suspension requires a live renderer')
    }
  }

  const beginSuspension = (): void => {
    requireOperationalState()
    if (suspensionDepth === 0) {
      try {
        cancelPending()
        if (latestSnapshot) appendTerminalFacts(latestSnapshot)
        clearFrame()
      } catch (error) {
        explicitFailure(error)
      }
    }
    suspensionDepth += 1
  }

  const endSuspension = (): void => {
    suspensionDepth = Math.max(0, suspensionDepth - 1)
    if (suspensionDepth !== 0 || !(state === 'live' || state === 'review-written')) return
    try {
      renderLatest()
    } catch (error) {
      explicitFailure(error)
    }
  }

  const callbackFailure = (error: unknown): never => {
    state = 'failed'
    try {
      cleanup()
    } catch {
      // A caller callback error remains authoritative.
    }
    throw error
  }

  const assertMatchingCapabilities = (input: VisualPlusSectionInput): void => {
    if (!isDeepStrictEqual(input.capabilities, capabilities)) {
      contractFailure('capabilities differ from startup')
    }
  }

  const assertLatestSnapshot = (input: VisualPlusSectionInput): void => {
    if (!(latestSnapshot && isDeepStrictEqual(input.snapshot, latestSnapshot))) {
      contractFailure('input snapshot differs from the subscribed controller')
    }
  }

  const validateInput = (source: VisualPlusSectionInput): DeepReadonly<VisualPlusSectionInput> => {
    try {
      assertMatchingCapabilities(source)
      assertLatestSnapshot(source)
      const validated = createVisualPlusSectionInput(source)
      if (!isDeepStrictEqual(validated.run, startupRun)) {
        contractFailure('run metadata differs from startup')
      }
      return validated
    } catch (error) {
      if (state !== 'failed') fail(error, false)
      throw error
    }
  }

  const validateFinalSelection = (input: DeepReadonly<VisualPlusSectionInput>): void => {
    if (input.snapshot.exitCode === null) contractFailure('final input lacks an exit code')
    const complete = input.snapshot.phases.find((phase) => phase.name === 'complete')
    if (!(complete && TERMINAL_PHASE_STATUSES.has(complete.status))) {
      contractFailure('final input lacks a terminal complete phase')
    }
    if (input.snapshot.counts.operations > 0 && !reviewInput) {
      contractFailure('nonempty finalization requires a prior review')
    }
    if (input.snapshot.write && input.snapshot.counts.operations > 0 && !input.writeReceipt) {
      contractFailure('nonempty write finalization requires canonical receipt evidence')
    }
    if (!reviewInput) return
    if (
      !(
        isDeepStrictEqual(input.run, reviewInput.run) &&
        isDeepStrictEqual(input.capabilities, reviewInput.capabilities) &&
        isDeepStrictEqual(input.snapshot.changes, reviewInput.snapshot.changes) &&
        isDeepStrictEqual(input.snapshot.targets, reviewInput.snapshot.targets) &&
        isDeepStrictEqual(input.changes, reviewInput.changes)
      )
    ) {
      contractFailure('final selection differs from review')
    }
  }

  const start = (controller: CheckRunController, run: VisualPlusRunMetadata): void => {
    assertNotReentrant()
    if (state !== 'idle') contractFailure('start may be called exactly once')
    const initialSnapshot = controller.snapshot()
    if (
      initialSnapshot.counts.operations !== 0 ||
      initialSnapshot.counts.targets !== 0 ||
      initialSnapshot.changes.length !== 0 ||
      initialSnapshot.targets.length !== 0 ||
      hasResultEvidence(initialSnapshot)
    ) {
      contractFailure('late start has selection or result evidence')
    }
    state = 'live'
    let starting = true
    let deliveredSnapshot: CheckRunSnapshot | undefined
    let deliveredCount = 0
    try {
      unsubscribe = controller.subscribe((snapshot) => {
        if (starting) {
          deliveredCount += 1
          deliveredSnapshot = snapshot
          return
        }
        observe(snapshot, false)
      })
    } catch (error) {
      internalFailure(error)
    }
    starting = false
    if (deliveredCount !== 1) {
      contractFailure('synchronous initial notification does not match the controller snapshot')
    }
    const reconciledSnapshot =
      deliveredSnapshot ??
      contractFailure('synchronous initial notification does not match the controller snapshot')
    if (!isDeepStrictEqual(reconciledSnapshot, initialSnapshot)) {
      contractFailure('synchronous initial notification does not match the controller snapshot')
    }
    if (
      reconciledSnapshot.counts.operations !== 0 ||
      reconciledSnapshot.counts.targets !== 0 ||
      reconciledSnapshot.changes.length !== 0 ||
      reconciledSnapshot.targets.length !== 0 ||
      hasResultEvidence(reconciledSnapshot)
    ) {
      contractFailure('late synchronous initial notification has selection or result evidence')
    }

    let initialInput: DeepReadonly<VisualPlusSectionInput>
    try {
      initialInput = createVisualPlusSectionInput({
        snapshot: reconciledSnapshot,
        capabilities,
        run,
        changes: [],
      })
      startupRun = initialInput.run
      latestSnapshot = reconciledSnapshot
      writeDurableLines(renderVisualPlusHeader(initialInput))
      writeDurableLines(renderVisualPlusLifecycleHeading(capabilities))
      renderLatest()
    } catch (error) {
      explicitFailure(error)
    }
  }

  const writeReview = (source: VisualPlusSectionInput): void => {
    assertNotReentrant()
    if (suspensionDepth > 0) contractFailure('review is unavailable during suspension')
    if (!(state === 'live' || state === 'review-written')) {
      contractFailure('review requires a live renderer')
    }
    if (state === 'review-written') {
      if (reviewInput && isDeepStrictEqual(source, reviewInput)) return
      contractFailure('review retry differs')
    }
    const input = validateInput(source)
    if (input.writeReceipt !== undefined) contractFailure('review cannot contain a write receipt')
    const insights = (() => {
      try {
        return buildVisualPlusInsights(input.snapshot)
      } catch (error) {
        return explicitFailure(error)
      }
    })()
    try {
      cancelPending()
      if (latestSnapshot) appendTerminalFacts(latestSnapshot)
      clearFrame()
      if (input.run.detailLevel === 'compact') {
        writeDurableLines(renderVisualPlusCompactReview(input, insights))
      } else {
        writeDurableLines(renderVisualPlusTopology(insights, capabilities))
        writeDurableLines(renderVisualPlusDistribution(insights, capabilities))
        writeDurableLines(renderVisualPlusRisk(insights, capabilities))
        writeDurableLines(renderVisualPlusImpact(insights, capabilities))
        writeDurableLines(renderVisualPlusShared(insights, capabilities))
        writeDurableLines(renderVisualPlusChanges(input))
      }
      reviewInput = input
      state = 'review-written'
      renderLatest()
    } catch (error) {
      explicitFailure(error)
    }
  }

  const finalize = (source: VisualPlusSectionInput): void => {
    assertNotReentrant()
    if (state === 'finalized') {
      if (finalInput && isDeepStrictEqual(source, finalInput)) return
      contractFailure('final retry differs')
    }
    if (suspensionDepth > 0) contractFailure('finalization is unavailable during suspension')
    if (!(state === 'live' || state === 'review-written')) {
      contractFailure('finalization requires a live renderer')
    }
    try {
      cancelPending()
    } catch (error) {
      explicitFailure(error)
    }
    const input = validateInput(source)
    validateFinalSelection(input)
    try {
      if (latestSnapshot) appendTerminalFacts(latestSnapshot)
      clearFrame()
      const complete = input.snapshot.phases.find((phase) => phase.name === 'complete')
      if (complete && TERMINAL_PHASE_STATUSES.has(complete.status)) {
        writeDurableLines(renderVisualPlusLifecyclePhase(complete, capabilities))
        durablePhases.set(complete.name, semanticSignature(complete))
      }
      if (input.snapshot.counts.operations > 0 || input.snapshot.counts.targets > 0) {
        writeDurableLines(renderVisualPlusTransaction(input))
      }
      writeDurableLines(renderVisualPlusReceipt(input))
      finalInput = input
      state = 'finalized'
      cancelPending()
      unsubscribeOnce()
    } catch (error) {
      explicitFailure(error)
    }
  }

  const suspend = <T>(write: () => T): T => {
    assertNotReentrant()
    beginSuspension()
    try {
      const value = write()
      endSuspension()
      return value
    } catch (error) {
      return callbackFailure(error)
    }
  }

  const suspendAsync = async <T>(write: () => Promise<T>): Promise<T> => {
    assertNotReentrant()
    beginSuspension()
    try {
      const value = await write()
      endSuspension()
      return value
    } catch (error) {
      return callbackFailure(error)
    }
  }

  const dispose = (): void => {
    assertNotReentrant()
    if (state === 'disposed' || state === 'finalized' || state === 'failed') return
    state = 'disposed'
    try {
      cleanup()
    } catch (error) {
      reportInternal(error)
      throw error
    }
  }

  return { start, writeReview, finalize, suspend, suspendAsync, dispose }
}

function semanticSignature(value: unknown): string {
  return JSON.stringify(value)
}

function hasResultEvidence(snapshot: CheckRunSnapshot): boolean {
  return (
    snapshot.results.operations.length !== 0 ||
    snapshot.results.targets.length !== 0 ||
    Object.values(snapshot.results.totals).some((value) => value !== 0) ||
    Object.values(snapshot.results.targetTotals).some((value) => value !== 0)
  )
}
