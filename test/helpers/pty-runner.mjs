import { spawn, spawnSync } from 'node:child_process'
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeSync,
} from 'node:fs'
import { constants as osConstants, tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { visualLength } from '../../src/utils/format/width.ts'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_OUTPUT_LIMIT = 4 * 1024 * 1024
const PROCESS_SCAN_OUTPUT_LIMIT = 1024 * 1024
const PROCESS_SCAN_TIMEOUT_MS = 5_000
const CONFIG_LIMIT = 256 * 1024
const SIDECAR_LIMIT = 4 * 1024
const TIMEOUT_READINESS_ENV = 'DEPFRESH_PTY_TIMEOUT_READINESS_PATH'
const TIMEOUT_READINESS_SIDECAR = 'timeout-readiness.pid'
const TIMEOUT_PHASE = Symbol('PTY timeout phase')
const TRANSCRIPT_FAILURE_PHASE = Symbol('PTY transcript failure phase')
const TRANSCRIPT_NAME = 'typescript.raw'
const CHILD_WRITE_DIAGNOSTIC_NAME = 'child-write-diagnostic.mjs'
const CHILD_WRITE_EVIDENCE_NAME = 'child-write.json'
const INNER_MODE_EVIDENCE_NAME = 'inner-modes.json'
const TEST_FAULTS = new Set([
  'child-write-evidence-malformed',
  'child-write-evidence-missing',
  'child-write-evidence-unclosed',
  'inner-hostile-output-modes',
  'start-evidence-failure',
  'malformed-start',
  'malformed-completion',
  'start-readiness-missing',
  'start-readiness-malformed',
  'outer-transport-missing',
  'outer-transport-malformed',
  'outer-transport-ambiguous',
  'outer-release-publication-delay',
  'outer-release-pre-spawn-signal',
  'outer-release-ready-malformed',
  'outer-release-ready-ambiguous',
  'wrapper-ready-marker-malformed',
  'wrapper-ready-marker-nonoverwriting',
  'outer-output-processing',
  'outer-post-proof-output-processing',
  'typescript-missing',
  'typescript-oversize',
  'typescript-replaced',
  'typescript-symlink',
  'typescript-unstable',
  'typescript-wrong-mode',
])
const OUTER_TRANSPORT_FAULTS = new Set([
  'outer-transport-missing',
  'outer-transport-malformed',
  'outer-transport-ambiguous',
  'outer-release-publication-delay',
  'outer-release-pre-spawn-signal',
  'outer-release-ready-malformed',
  'outer-release-ready-ambiguous',
  'wrapper-ready-marker-malformed',
  'wrapper-ready-marker-nonoverwriting',
  'outer-output-processing',
  'outer-post-proof-output-processing',
])
const CLEANUP_FAULTS = new Set(['observation-ambiguity', 'signaling-failure', 'survivor'])
const TRANSCRIPT_FAULTS = new Set([
  'typescript-missing',
  'typescript-oversize',
  'typescript-replaced',
  'typescript-symlink',
  'typescript-unstable',
  'typescript-wrong-mode',
])
const CHILD_WRITE_FAULTS = new Set([
  'child-write-evidence-malformed',
  'child-write-evidence-missing',
  'child-write-evidence-unclosed',
])
const EVIDENCE_ROLES = new Set(['cli', 'unclassified', 'wrapper'])
const IDENTITY_CHANGE_DIAGNOSTICS = new Map([
  ['group', 'group-only'],
  ['parent', 'parent-only'],
  ['group-parent', 'parent-group'],
  ['group-parent-start', 'parent-group-start'],
  ['parent-start', 'parent-start'],
  ['start', 'start-only'],
  ['group-start', 'group-start'],
])
const KNOWN_SIGNALS = new Set(Object.keys(osConstants.signals))
const START_KEYS = [
  'cliGroup',
  'cliParent',
  'cliPid',
  'cliStart',
  'columns',
  'nodeVersion',
  'records',
  'stderr',
  'stdin',
  'stdout',
  'wrapperGroup',
  'wrapperParent',
  'wrapperPid',
  'wrapperStart',
]
const COMPLETION_KEYS = ['exitCode', 'records', 'signal']
const OUTER_TRANSPORT_KEYS = ['outerRaw', 'records']
const OUTER_TRANSPORT_READY_KEYS = ['evidenceClosed', 'records']
const START_READINESS_KEYS = ['records', 'startPublished']
const WRAPPER_READY_KEYS = [
  'columns',
  'nodeVersion',
  'records',
  'stderr',
  'stdin',
  'stdout',
  'wrapperGroup',
  'wrapperParent',
  'wrapperPid',
  'wrapperStart',
]
const WRAPPER_READY_MARKER_KEYS = ['evidenceClosed', 'records']
const LINE_ENDING_KEYS = [
  'bareLf',
  'beforeEscape',
  'beforeOtherControl',
  'beforeText',
  'doubleCrlf',
  'singleCrlf',
  'trailing',
]
const OUTPUT_MODE_KEYS = [
  'available',
  'canonicalInput',
  'carriageReturnMapping',
  'carriageReturnSuppression',
  'echo',
  'newlineMapping',
  'newlineReturn',
  'outputProcessing',
]
const WRITE_MODE_KEYS = [
  'available',
  'canonicalInput',
  'carriageReturnMapping',
  'carriageReturnSuppression',
  'echo',
  'newlineMapping',
  'newlineReturn',
  'observed',
  'outputProcessing',
  'stateChanged',
]

function createExpectSource(fault) {
  const transportFault = OUTER_TRANSPORT_FAULTS.has(fault) ? fault : 'none'
  const readinessWaitMs = fault === 'outer-transport-missing' ? 100 : 5_000
  return `#!/usr/bin/expect -f
set timeout -1
log_user 0
fconfigure stdout -translation binary -encoding binary
set transport_fault "${transportFault}"
set stty_init {raw -echo -opost}
proc token_count {tokens expected} {
  set count 0
  foreach token $tokens {
    if {$token eq $expected} {
      incr count
    }
  }
  return $count
}
spawn -noecho /usr/bin/script -q -e -F ./${TRANSCRIPT_NAME} ./run
fconfigure $spawn_id -translation binary -encoding binary
set channel [open "./script-pid" {WRONLY CREAT EXCL} 0600]
puts $channel [exp_pid]
close $channel
set transport_configured 0
if {[info exists spawn_out(slave,name)]} {
  set slave $spawn_out(slave,name)
  set transport_configured [expr {![catch {exec /bin/stty raw -echo -opost < $slave}]}]
  set wrapper_ready 0
  set wrapper_deadline [expr {[clock milliseconds] + ${readinessWaitMs}}]
  while {[clock milliseconds] < $wrapper_deadline} {
    if {[file exists "./wrapper-ready-complete.json"]} {
      set wrapper_ready 1
      break
    }
    after 10
  }
  if {$wrapper_ready} {
    set transport_configured [expr {![catch {exec /bin/stty raw -echo -opost < $slave}]}]
    if {$transport_fault eq "outer-output-processing"} {
      if {[catch {exec /bin/stty opost onlcr < $slave}]} {
        set transport_configured 0
      }
    }
  } else {
    set transport_configured 0
  }
  if {$transport_configured && ![catch {set modes [exec /bin/stty -a < $slave]}]} {
    set tokens [split [string map {";" " " ":" " "} $modes]]
    if {$transport_fault eq "outer-transport-ambiguous"} {
      lappend tokens "-opost"
    }
    set canonical_off [token_count $tokens "-icanon"]
    set canonical_on [token_count $tokens "icanon"]
    set echo_off [token_count $tokens "-echo"]
    set echo_on [token_count $tokens "echo"]
    set output_processing_off [token_count $tokens "-opost"]
    set output_processing_on [token_count $tokens "opost"]
    set transport_valid [expr {
      $canonical_off == 1 && $canonical_on == 0 &&
      $echo_off == 1 && $echo_on == 0 &&
      $output_processing_off == 1 && $output_processing_on == 0
    }]
    if {$transport_fault ne "outer-transport-missing"} {
      set transport_channel [open "./outer-transport.json" {WRONLY CREAT EXCL} 0600]
      if {$transport_fault eq "outer-transport-malformed"} {
        puts $transport_channel {"records":1}
      } else {
        set outer_raw_json [expr {$transport_valid ? "true" : "false"}]
        puts $transport_channel "{\\"records\\":1,\\"outerRaw\\":$outer_raw_json}"
      }
      close $transport_channel
      set release_channel [open "./outer-transport-ready.pending" {WRONLY CREAT EXCL} 0600]
      if {$transport_fault eq "outer-release-ready-malformed"} {
        puts $release_channel "{\\"records\\":1}"
      } elseif {$transport_fault eq "outer-release-ready-ambiguous"} {
        puts $release_channel "{\\"records\\":1,\\"evidenceClosed\\":true,\\"ambiguous\\":true}"
      } else {
        puts $release_channel "{\\"records\\":1,\\"evidenceClosed\\":true}"
      }
      close $release_channel
      if {$transport_fault eq "outer-post-proof-output-processing"} {
        if {[catch {exec /bin/stty opost onlcr < $slave}]} {
          exit 123
        }
      }
      if {$transport_fault eq "outer-release-pre-spawn-signal"} {
        set wrapper_channel [open "./wrapper-ready.json" r]
        set wrapper_record [read $wrapper_channel]
        close $wrapper_channel
        if {![regexp {"wrapperPid":([0-9]+)} $wrapper_record -> wrapper_pid]} {
          exit 124
        }
        exec /bin/kill -TERM $wrapper_pid
        after 100
      }
      if {$transport_fault eq "outer-release-publication-delay"} {
        after 250
      }
      file rename -- "./outer-transport-ready.pending" "./outer-transport-ready.json"
    }
  }
}
expect {
  -re {(?s).+} {
    puts -nonewline stdout $expect_out(buffer)
    flush stdout
    exp_continue
  }
  eof
}
set result [wait]
exit [lindex $result 3]
`
}

export function detectScriptAdapter() {
  const scriptPath = requireExecutable('/usr/bin/script', 'script')
  const probe = spawnSync(scriptPath, ['--version'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024,
    timeout: 2_000,
  })
  const family = classifyScriptProbe(probe)
  if (family === 'util-linux') return Object.freeze({ family, scriptPath })
  if (family === 'bsd') {
    const expectPath = requireExecutable('/usr/bin/expect', 'expect')
    return Object.freeze({ family, scriptPath, expectPath })
  }
  throw new Error('Unsupported script implementation: expected BSD or util-linux')
}

export function classifyScriptProbe(probe) {
  if (
    !probe ||
    typeof probe !== 'object' ||
    (probe.status !== null && !Number.isSafeInteger(probe.status)) ||
    (probe.signal !== null && typeof probe.signal !== 'string') ||
    typeof probe.stdout !== 'string' ||
    typeof probe.stderr !== 'string' ||
    Buffer.byteLength(probe.stdout) + Buffer.byteLength(probe.stderr) > 16 * 1024 ||
    probe.error
  ) {
    throw new Error('Unsupported script implementation: capability probe failed')
  }
  const evidence = `${probe.stdout}${probe.stderr}`
  if (
    probe.status === 0 &&
    probe.signal === null &&
    /script from util-linux(?:\s|$)/iu.test(evidence)
  ) {
    return 'util-linux'
  }
  if (
    probe.status !== 0 &&
    probe.signal === null &&
    /usage: script \[-aeFkpqr\] \[-t time\] \[file \[command \.\.\.\]\]/u.test(evidence)
  ) {
    return 'bsd'
  }
  throw new Error('Unsupported script implementation: expected BSD or util-linux')
}

export function createDetachedGroupMonitor(pid) {
  validatePid(pid)
  const observed = new Map()
  observed.probeSucceeded = false
  observed.probeFailed = false
  observed.probeFailure = null
  observed.ambiguous = false
  observed.cleanupFault = null
  observed.missing = new Set()
  observed.reappeared = new Set()
  observed.requiredGroups = new Set([pid])
  const current = scanProcesses(observed)
  const leader = current?.get(pid)
  if (!leader || leader.group !== pid) {
    throw new Error(
      `Detached process-group identity was unavailable or ambiguous: ${observed.probeFailure ?? 'identity'}`,
    )
  }
  observed.set(pid, leader)
  observed.probeSucceeded = true
  observeRequiredGroups(current, observed)
  return Object.freeze({
    observe: () => {
      const snapshot = scanProcesses(observed)
      if (!snapshot) {
        observed.probeFailed = true
        return
      }
      observed.probeSucceeded = true
      observeIdentitySnapshot(observed, snapshot)
      observeRequiredGroups(snapshot, observed)
    },
    cleanup: () => cleanupObserved(observed),
  })
}

export function normalizeTerminalCapture(bytes, options) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Terminal capture must be a Buffer')
  const columns = requireColumns(options?.columns)
  const limit = options?.limit ?? DEFAULT_OUTPUT_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || bytes.byteLength > limit) {
    throw new Error('Terminal capture exceeds the configured bound')
  }
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Terminal capture is not valid UTF-8')
  }

  const rows = 24
  const screen = Array.from({ length: rows }, () => Array(columns).fill(' '))
  const scrollback = []
  let row = 0
  let column = 0
  let wrapPending = false
  let finalCursorVisible = true
  const controls = {
    carriageReturn: 0,
    crlf: 0,
    cursorUp: 0,
    eraseLine: 0,
    cursorHide: 0,
    cursorShow: 0,
    sgr: 0,
  }

  const scroll = () => {
    scrollback.push(projectLine(screen.shift()))
    screen.push(Array(columns).fill(' '))
    row = rows - 1
  }
  const newline = () => {
    row += 1
    if (row >= rows) scroll()
  }
  const writeCharacter = (character) => {
    const width = visualLength(character)
    if (width === 0) {
      const target = Math.max(0, column - 1)
      screen[row][target] = `${screen[row][target]}${character}`
      return
    }
    if (wrapPending || column + width > columns) {
      column = 0
      newline()
      wrapPending = false
    }
    clearCell(screen[row], column)
    screen[row][column] = character
    if (width === 2) {
      clearCell(screen[row], column + 1)
      screen[row][column + 1] = null
    }
    column += width
    if (column === columns) {
      column = columns - 1
      wrapPending = true
    }
  }

  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index)
    const character = String.fromCodePoint(codePoint)
    if (character === '\r') {
      if (text[index + 1] === '\n') {
        controls.crlf += 1
        column = 0
        wrapPending = false
        newline()
        index += 2
        continue
      }
      controls.carriageReturn += 1
      column = 0
      wrapPending = false
      index += 1
      continue
    }
    if (character === '\n') {
      newline()
      wrapPending = false
      index += 1
      continue
    }
    if (character === '\u001b') {
      if (text[index + 1] === ']') throw new Error('Terminal capture contains unknown OSC')
      if (text[index + 1] !== '[') throw new Error('Terminal capture contains unknown ESC')
      const rest = text.slice(index)
      const matched = /^([0-9;?]*)([A-Za-z])/u.exec(rest.slice(2))
      if (!matched) throw new Error('Terminal capture contains malformed CSI')
      const [body, parameters, command] = matched
      if (command === 'A' && /^\d*$/u.test(parameters)) {
        const count = parameters === '' ? 1 : Number(parameters)
        if (!(Number.isSafeInteger(count) && count >= 1 && count <= row)) {
          throw new Error('Terminal capture contains impossible cursor movement')
        }
        row -= count
        controls.cursorUp += 1
      } else if (command === 'K' && parameters === '2') {
        screen[row] = Array(columns).fill(' ')
        controls.eraseLine += 1
      } else if (command === 'm' && /^\d*(?:;\d*)*$/u.test(parameters)) {
        controls.sgr += 1
      } else if (command === 'h' && parameters === '?25') {
        finalCursorVisible = true
        controls.cursorShow += 1
      } else if (command === 'l' && parameters === '?25') {
        finalCursorVisible = false
        controls.cursorHide += 1
      } else {
        throw new Error('Terminal capture contains unknown CSI')
      }
      index += body.length + 2
      continue
    }
    if (
      codePoint < 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x061c ||
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      codePoint === 0x2060 ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      codePoint === 0xfeff
    ) {
      throw new Error(`Terminal capture contains unknown control U+${codePoint.toString(16)}`)
    }
    const grapheme = nextGrapheme(text, index)
    writeCharacter(grapheme)
    index += grapheme.length
  }

  const visible = screen.map(projectLine)
  while (visible.at(-1) === '') visible.pop()
  const projected = [...scrollback, ...visible]
  while (projected.at(-1) === '') projected.pop()
  return Object.freeze({
    transcript: projected.length > 0 ? `${projected.join('\n')}\n` : '',
    finalCursorVisible,
    controls: Object.freeze(controls),
  })
}

export function hasDoubleCarriageReturnLineFeed(bytes) {
  return classifyRawTerminalTransport(bytes).doubleCrlf
}

export function classifyRawTerminalTransport(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Terminal capture must be a Buffer')
  if (bytes.byteLength > DEFAULT_OUTPUT_LIMIT) {
    throw new Error('Terminal capture exceeds the configured bound')
  }
  let doubleCrlf = false
  let beforeEscape = false
  let beforeText = false
  let beforeOtherControl = false
  let trailing = false
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] !== 13) continue
    const next = bytes[index + 1]
    if (next === 13 && bytes[index + 2] === 10) {
      doubleCrlf = true
      index += 2
      continue
    }
    if (next === 10) {
      index += 1
      continue
    }
    if (next === undefined) trailing = true
    else if (next === 27) beforeEscape = true
    else if (next < 0x20 || (next >= 0x7f && next <= 0x9f)) beforeOtherControl = true
    else beforeText = true
  }
  return Object.freeze({
    doubleCrlf,
    beforeEscape,
    beforeText,
    beforeOtherControl,
    trailing,
  })
}

export function readPtyTimeoutPhase(error) {
  if (!(error instanceof Error)) return undefined
  return error[TIMEOUT_PHASE]
}

export function readPtyTranscriptFailurePhase(error) {
  if (!(error instanceof Error)) return undefined
  return error[TRANSCRIPT_FAILURE_PHASE]
}

function projectLine(line) {
  return line
    .filter((cell) => cell !== null)
    .join('')
    .replace(/ +$/u, '')
}

function clearCell(line, column) {
  if (column < 0 || column >= line.length) return
  if (line[column] === null && column > 0) line[column - 1] = ' '
  if (line[column + 1] === null) line[column + 1] = ' '
  line[column] = ' '
}

function nextGrapheme(text, index) {
  let end = index
  let regionalIndicators = 0
  while (end < text.length) {
    const codePoint = text.codePointAt(end)
    const character = String.fromCodePoint(codePoint)
    const regional = codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff
    const extension = /\p{Mark}/u.test(character) || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    if (end === index) {
      regionalIndicators = regional ? 1 : 0
      end += character.length
      continue
    }
    if (extension) {
      end += character.length
      continue
    }
    if (regional && regionalIndicators === 1) {
      end += character.length
      regionalIndicators += 1
    }
    break
  }
  return text.slice(index, end)
}

export async function runInPty(options) {
  const cliPath = requireAbsoluteRegularFile(options?.cliPath, 'CLI')
  const args = requireStringArray(options?.args, 'arguments')
  const diagnoseChildWrites = options?.diagnoseChildWrites ?? false
  if (typeof diagnoseChildWrites !== 'boolean') {
    throw new Error('PTY child-write diagnostic option must be boolean')
  }
  if (diagnoseChildWrites && cliPath !== realpathSync(process.execPath)) {
    throw new Error('PTY child-write diagnostics require the current Node executable')
  }
  const env = requireEnvironment(options?.env)
  const columns = requireColumns(options?.columns)
  const input = options?.input ?? Buffer.alloc(0)
  if (!Buffer.isBuffer(input) || input.byteLength !== 0) {
    throw new Error('PTY input must be an explicitly empty Buffer')
  }
  const timeoutMs = requireBound(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeout')
  const timeoutAfterReadyMs =
    options?.timeoutAfterReadyMs === undefined
      ? undefined
      : requireBound(options.timeoutAfterReadyMs, 'timeout after readiness')
  const outputLimit = requireBound(options?.outputLimit ?? DEFAULT_OUTPUT_LIMIT, 'output limit')
  const fault = requireTestFault(options?.fault)
  const cleanupFault = requireCleanupFault(options?.cleanupFault)
  const adapter = detectScriptAdapter()
  if (adapter.family !== 'bsd' && OUTER_TRANSPORT_FAULTS.has(fault)) {
    throw new Error('PTY outer transport fault is not applicable')
  }
  if (adapter.family !== 'bsd' && TRANSCRIPT_FAULTS.has(fault)) {
    throw new Error('PTY transcript fault is not applicable')
  }
  if (CHILD_WRITE_FAULTS.has(fault) && !diagnoseChildWrites) {
    throw new Error('PTY child-write diagnostic fault is not applicable')
  }
  const directory = mkdtempSync(join(tmpdir(), 'depfresh-pty-'))
  chmodSync(directory, 0o700)
  let transcriptEvidence
  let primaryError
  let outcome
  const observed = new Map()
  observed.allowWrapperPromotion = true
  observed.probeSucceeded = false
  observed.probeFailed = false
  observed.probeFailure = null
  observed.ambiguous = false
  observed.authoritative = new Set()
  observed.cleanupFault = cleanupFault
  observed.missing = new Set()
  observed.provisionalGroupChanges = new Map()
  observed.reappeared = new Set()
  try {
    if (adapter.family === 'bsd') {
      transcriptEvidence = createPrivateTranscript(directory)
    }
    if (timeoutAfterReadyMs !== undefined && Object.hasOwn(env, TIMEOUT_READINESS_ENV)) {
      throw new Error('PTY timeout readiness environment is reserved')
    }
    const invocationEnv =
      timeoutAfterReadyMs === undefined
        ? env
        : { ...env, [TIMEOUT_READINESS_ENV]: join(directory, TIMEOUT_READINESS_SIDECAR) }
    const diagnosticPath = join(directory, CHILD_WRITE_DIAGNOSTIC_NAME)
    const invocationArgs = diagnoseChildWrites
      ? ['--import', pathToFileURL(diagnosticPath).href, ...args]
      : args
    const config = Buffer.from(
      `${JSON.stringify({
        cliPath,
        args: invocationArgs,
        diagnoseChildWrites,
        env: invocationEnv,
        columns,
        fault,
        mvPath: '/bin/mv',
        psPath: '/bin/ps',
        releaseWaitMs: fault === 'outer-transport-missing' ? 100 : 5_000,
        requiresOuterTransport: adapter.family === 'bsd',
        sttyPath: '/bin/stty',
      })}\n`,
    )
    if (config.byteLength > CONFIG_LIMIT) throw new Error('PTY config exceeds 256 KiB')
    writeExclusive(join(directory, 'config.json'), config, 0o600)
    writeExclusive(join(directory, 'run'), Buffer.from(createWrapperSource()), 0o700)
    if (diagnoseChildWrites) {
      writeExclusive(diagnosticPath, Buffer.from(createChildWriteDiagnosticSource(fault)), 0o600)
    }
    if (adapter.family === 'bsd')
      writeExclusive(join(directory, 'bootstrap'), Buffer.from(createExpectSource(fault)), 0o700)

    const command =
      adapter.family === 'util-linux'
        ? { path: adapter.scriptPath, args: ['-q', '-e', '-c', 'exec ./run', '/dev/null'] }
        : { path: adapter.expectPath, args: ['./bootstrap'] }
    const captured = await captureBounded(command.path, command.args, {
      cwd: directory,
      timeoutMs,
      timeoutAfterReadyMs,
      timeoutReadinessSidecar:
        timeoutAfterReadyMs === undefined ? undefined : TIMEOUT_READINESS_SIDECAR,
      outputLimit,
      env: minimalOuterEnvironment(),
      directory,
      observed,
      transcriptEvidence,
      transcriptFault: fault,
    })
    const wrapperReady = requireWrapperReadyEvidence(directory)
    if (adapter.family === 'bsd') requireOuterTransportEvidence(directory)
    requireStartReadinessEvidence(directory)
    const start = readSidecar(directory, 'start.json')
    const completion = readSidecar(directory, 'completion.json')
    validateStart(start)
    validateCompletion(completion)
    requireWrapperIdentityAgreement(wrapperReady, start)
    if (!observed.probeSucceeded || observed.probeFailed) {
      throw new Error(`PTY descendant observation failed: ${observed.probeFailure ?? 'unknown'}`)
    }
    const scriptPid =
      adapter.family === 'bsd' ? readPidSidecar(directory, 'script-pid') : captured.pid
    const evidence = start
    if (
      evidence.stdin !== true ||
      evidence.stdout !== true ||
      evidence.stderr !== true ||
      evidence.columns !== columns ||
      evidence.nodeVersion !== process.version
    ) {
      throw new Error('PTY evidence does not prove all streams and requested columns')
    }
    requireObservedIdentity(observed, captured.pid, { group: captured.pid })
    requireObservedIdentity(observed, scriptPid)
    registerEvidenceIdentity(observed, 'wrapper', wrapperReady.wrapperPid, {
      parent: wrapperReady.wrapperParent,
      group: wrapperReady.wrapperGroup,
      start: wrapperReady.wrapperStart,
    })
    registerEvidenceIdentity(observed, 'cli', start.cliPid, {
      parent: start.cliParent,
      group: start.cliGroup,
      start: start.cliStart,
    })
    await confirmIdentitiesGone(observed)
    if (adapter.family === 'bsd') {
      applyClosedTranscriptFault(transcriptEvidence, fault)
    }
    const innerTerminal =
      adapter.family === 'bsd'
        ? readValidatedTranscript(transcriptEvidence, outputLimit, fault)
        : captured.stdout
    const rawTerminal = applyOwnedLineEndings(innerTerminal)
    const normalized = normalizeTerminalCapture(rawTerminal, { columns, limit: outputLimit })
    const writeBoundary = diagnoseChildWrites
      ? requireWriteBoundaryEvidence(directory, innerTerminal)
      : undefined
    outcome = Object.freeze({
      adapter,
      rawTerminal,
      ...(adapter.family === 'bsd'
        ? { outerTransportDoubleCrlf: hasDoubleCarriageReturnLineFeed(captured.stdout) }
        : {}),
      diagnostics: captured.stderr,
      ...(writeBoundary === undefined ? {} : { writeBoundary }),
      transcript: normalized.transcript,
      controls: normalized.controls,
      finalCursorVisible: normalized.finalCursorVisible,
      evidence: Object.freeze({
        stdin: evidence.stdin,
        stdout: evidence.stdout,
        stderr: evidence.stderr,
        columns: evidence.columns,
        nodeVersion: evidence.nodeVersion,
      }),
      exitCode: completion.exitCode,
      signal: completion.signal,
    })
  } catch (error) {
    primaryError = error
  }
  let cleanupError
  try {
    await cleanupObserved(observed)
  } catch (error) {
    cleanupError = error
  } finally {
    if (transcriptEvidence) {
      try {
        closeSync(transcriptEvidence.descriptor)
      } catch {
        cleanupError ??= new Error('PTY transcript evidence is invalid')
      }
    }
    rmSync(directory, { recursive: true, force: true })
  }
  if (primaryError && cleanupError) {
    throw new AggregateError([primaryError, cleanupError], primaryError.message)
  }
  if (primaryError) throw primaryError
  if (cleanupError) throw cleanupError
  return outcome
}

function createChildWriteDiagnosticSource(fault) {
  const diagnosticFault = CHILD_WRITE_FAULTS.has(fault) ? fault : 'none'
  return `import { execFileSync } from 'node:child_process'
import { closeSync, constants, openSync, renameSync, writeSync } from 'node:fs'
const fault = ${JSON.stringify(diagnosticFault)}
const emptyFlags = () => ({ bareLf: false, beforeEscape: false, beforeOtherControl: false, beforeText: false, doubleCrlf: false, singleCrlf: false, trailing: false })
const emptyState = () => ({ flags: emptyFlags(), pendingCarriageReturns: 0 })
const states = { combined: emptyState(), stderr: emptyState(), stdout: emptyState() }
const writes = { available: true, canonicalInput: false, carriageReturnMapping: false, carriageReturnSuppression: false, echo: false, newlineMapping: false, newlineReturn: false, observed: false, outputProcessing: false, stateChanged: false }
let closed = false
let firstLineFeedSampled = false
let lastPublished = ''
const tokenCount = (tokens, expected) => tokens.filter((token) => token === expected).length
const readOutputModes = () => {
  try {
    const output = execFileSync('/bin/stty', ['-a'], { encoding: 'utf8', maxBuffer: 4096, stdio: [1, 'pipe', 'ignore'], timeout: 1000 })
    const tokens = output.replaceAll(';', ' ').replaceAll(':', ' ').split(/\\s+/u)
    const outputOn = tokenCount(tokens, 'opost')
    const outputOff = tokenCount(tokens, '-opost')
    const mappingOn = tokenCount(tokens, 'onlcr')
    const mappingOff = tokenCount(tokens, '-onlcr')
    const canonicalOn = tokenCount(tokens, 'icanon')
    const canonicalOff = tokenCount(tokens, '-icanon')
    const echoOn = tokenCount(tokens, 'echo')
    const echoOff = tokenCount(tokens, '-echo')
    const carriageReturnMappingOn = tokenCount(tokens, 'ocrnl')
    const carriageReturnMappingOff = tokenCount(tokens, '-ocrnl')
    const carriageReturnSuppressionOn = tokenCount(tokens, 'onocr')
    const carriageReturnSuppressionOff = tokenCount(tokens, '-onocr')
    const newlineReturnOn = tokenCount(tokens, 'onlret')
    const newlineReturnOff = tokenCount(tokens, '-onlret')
    if (
      outputOn + outputOff !== 1 ||
      mappingOn + mappingOff !== 1 ||
      canonicalOn + canonicalOff !== 1 ||
      echoOn + echoOff !== 1 ||
      (process.platform === 'darwin'
        ? carriageReturnMappingOn + carriageReturnMappingOff > 1
        : carriageReturnMappingOn + carriageReturnMappingOff !== 1) ||
      carriageReturnSuppressionOn + carriageReturnSuppressionOff !== 1 ||
      newlineReturnOn + newlineReturnOff !== 1
    ) throw new Error()
    return {
      available: true,
      canonicalInput: canonicalOn === 1,
      carriageReturnMapping: carriageReturnMappingOn === 1,
      carriageReturnSuppression: carriageReturnSuppressionOn === 1,
      echo: echoOn === 1,
      newlineMapping: mappingOn === 1,
      newlineReturn: newlineReturnOn === 1,
      outputProcessing: outputOn === 1,
    }
  } catch {
    return { available: false, canonicalInput: false, carriageReturnMapping: false, carriageReturnSuppression: false, echo: false, newlineMapping: false, newlineReturn: false, outputProcessing: false }
  }
}
const observeModes = (modes) => {
  writes.observed = true
  writes.available &&= modes.available
  writes.canonicalInput ||= modes.canonicalInput
  writes.carriageReturnMapping ||= modes.carriageReturnMapping
  writes.carriageReturnSuppression ||= modes.carriageReturnSuppression
  writes.echo ||= modes.echo
  writes.newlineMapping ||= modes.newlineMapping
  writes.newlineReturn ||= modes.newlineReturn
  writes.outputProcessing ||= modes.outputProcessing
  writes.stateChanged ||=
    !modes.available ||
    modes.canonicalInput ||
    modes.carriageReturnMapping ||
    modes.carriageReturnSuppression ||
    modes.echo ||
    modes.newlineMapping ||
    modes.newlineReturn ||
    modes.outputProcessing
}
const classifyPending = (state, next) => {
  if (state.pendingCarriageReturns > 1) state.flags.beforeOtherControl = true
  if (next === 27) state.flags.beforeEscape = true
  else if (next < 0x20 || (next >= 0x7f && next <= 0x9f)) state.flags.beforeOtherControl = true
  else state.flags.beforeText = true
  state.pendingCarriageReturns = 0
}
const accept = (state, bytes) => {
  for (const byte of bytes) {
    if (byte === 13) {
      state.pendingCarriageReturns = Math.min(2, state.pendingCarriageReturns + 1)
      continue
    }
    if (byte === 10) {
      if (state.pendingCarriageReturns > 1) state.flags.doubleCrlf = true
      else if (state.pendingCarriageReturns === 1) state.flags.singleCrlf = true
      else state.flags.bareLf = true
      state.pendingCarriageReturns = 0
      continue
    }
    if (state.pendingCarriageReturns > 0) classifyPending(state, byte)
  }
}
const toBytes = (chunk, encoding) => {
  if (typeof chunk === 'string') return Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined)
  if (ArrayBuffer.isView(chunk)) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  return undefined
}
const record = () => ({ closed, combined: states.combined.flags, stderr: states.stderr.flags, stdout: states.stdout.flags, writes })
const writeAll = (descriptor, bytes) => {
  let offset = 0
  while (offset < bytes.byteLength) offset += writeSync(descriptor, bytes, offset, bytes.byteLength - offset)
}
const publish = () => {
  if (fault === 'child-write-evidence-missing') return
  const value = fault === 'child-write-evidence-malformed'
    ? { ...record(), combined: { ...states.combined.flags, ambiguous: true } }
    : record()
  const text = JSON.stringify(value) + '\\n'
  if (text === lastPublished) return
  const pending = new URL('./child-write.pending', import.meta.url)
  const final = new URL('./${CHILD_WRITE_EVIDENCE_NAME}', import.meta.url)
  const descriptor = openSync(pending, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  try { writeAll(descriptor, Buffer.from(text)) } finally { closeSync(descriptor) }
  renameSync(pending, final)
  lastPublished = text
}
const install = (stream, name) => {
  const original = stream.write
  stream.write = function (chunk, encoding, callback) {
    const bytes = toBytes(chunk, encoding)
    let modes
    if (bytes) {
      const hasCarriageReturn = bytes.includes(13)
      const hasLineFeed = bytes.includes(10)
      if (hasCarriageReturn || (hasLineFeed && !firstLineFeedSampled)) {
        modes = readOutputModes()
        if (hasLineFeed) firstLineFeedSampled = true
      }
    }
    const result = Reflect.apply(original, this, arguments)
    if (bytes) {
      if (modes) observeModes(modes)
      accept(states[name], bytes)
      accept(states.combined, bytes)
      publish()
    }
    return result
  }
}
install(process.stdout, 'stdout')
install(process.stderr, 'stderr')
publish()
process.once('exit', () => {
  closed = fault !== 'child-write-evidence-unclosed'
  for (const state of Object.values(states)) {
    if (state.pendingCarriageReturns > 1) state.flags.beforeOtherControl = true
    if (state.pendingCarriageReturns > 0) state.flags.trailing = true
    state.pendingCarriageReturns = 0
  }
  publish()
})
`
}

function createWrapperSource() {
  return `#!${realpathSync(process.execPath)}
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, writeSync } from 'node:fs'
const fail = (message) => { process.stderr.write('PTY wrapper failure: ' + message + '\\n'); process.exit(125) }
const configPath = new URL('./config.json', import.meta.url)
const stats = lstatSync(configPath)
if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o600 || stats.size > ${CONFIG_LIMIT}) fail('invalid config')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
if (!Number.isSafeInteger(config.columns) || config.columns < 1 || config.columns > 1000) fail('invalid columns')
if (typeof config.diagnoseChildWrites !== 'boolean') fail('invalid child-write diagnostic option')
if (config.mvPath !== '/bin/mv') fail('invalid marker publisher')
if (typeof config.requiresOuterTransport !== 'boolean') fail('invalid transport requirement')
if (!Number.isSafeInteger(config.releaseWaitMs) || config.releaseWaitMs < 1 || config.releaseWaitMs > 5000) fail('invalid release wait')
if (config.fault === 'inner-hostile-output-modes') {
  execFileSync(config.sttyPath, ['ocrnl', 'onocr', 'onlret'], { stdio: 'inherit' })
}
execFileSync(
  config.sttyPath,
  ['raw', '-echo', '-opost', '-onlcr', '-ocrnl', '-onocr', '-onlret', 'rows', '24', 'cols', String(config.columns)],
  { stdio: 'inherit' },
)
const tokenCount = (tokens, expected) => tokens.filter((token) => token === expected).length
const readOutputModes = () => {
  try {
    const output = execFileSync(config.sttyPath, ['-a'], { encoding: 'utf8', maxBuffer: 4096, stdio: ['inherit', 'pipe', 'ignore'], timeout: 1000 })
    const tokens = output.replaceAll(';', ' ').replaceAll(':', ' ').split(/\\s+/u)
    const outputOn = tokenCount(tokens, 'opost')
    const outputOff = tokenCount(tokens, '-opost')
    const mappingOn = tokenCount(tokens, 'onlcr')
    const mappingOff = tokenCount(tokens, '-onlcr')
    const canonicalOn = tokenCount(tokens, 'icanon')
    const canonicalOff = tokenCount(tokens, '-icanon')
    const echoOn = tokenCount(tokens, 'echo')
    const echoOff = tokenCount(tokens, '-echo')
    const carriageReturnMappingOn = tokenCount(tokens, 'ocrnl')
    const carriageReturnMappingOff = tokenCount(tokens, '-ocrnl')
    const carriageReturnSuppressionOn = tokenCount(tokens, 'onocr')
    const carriageReturnSuppressionOff = tokenCount(tokens, '-onocr')
    const newlineReturnOn = tokenCount(tokens, 'onlret')
    const newlineReturnOff = tokenCount(tokens, '-onlret')
    if (
      outputOn + outputOff !== 1 ||
      mappingOn + mappingOff !== 1 ||
      canonicalOn + canonicalOff !== 1 ||
      echoOn + echoOff !== 1 ||
      (process.platform === 'darwin'
        ? carriageReturnMappingOn + carriageReturnMappingOff > 1
        : carriageReturnMappingOn + carriageReturnMappingOff !== 1) ||
      carriageReturnSuppressionOn + carriageReturnSuppressionOff !== 1 ||
      newlineReturnOn + newlineReturnOff !== 1
    ) throw new Error()
    return {
      available: true,
      canonicalInput: canonicalOn === 1,
      carriageReturnMapping: carriageReturnMappingOn === 1,
      carriageReturnSuppression: carriageReturnSuppressionOn === 1,
      echo: echoOn === 1,
      newlineMapping: mappingOn === 1,
      newlineReturn: newlineReturnOn === 1,
      outputProcessing: outputOn === 1,
    }
  } catch {
    return { available: false, canonicalInput: false, carriageReturnMapping: false, carriageReturnSuppression: false, echo: false, newlineMapping: false, newlineReturn: false, outputProcessing: false }
  }
}
const innerModeStart = config.diagnoseChildWrites ? readOutputModes() : undefined
const processIdentity = (pid) => {
  const value = execFileSync(config.psPath, ['-o', 'ppid=', '-o', 'pgid=', '-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', maxBuffer: 4096, timeout: 1000 })
  const match = /^\\s*(\\d+)\\s+(\\d+)\\s+(.+?)\\s*$/.exec(value)
  if (!match) throw new Error('invalid process identity')
  return { parent: Number(match[1]), group: Number(match[2]), start: match[3] }
}
const writeRecord = (name, value) => {
  const descriptor = openSync(new URL('./' + name, import.meta.url), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  try { writeSync(descriptor, JSON.stringify(value) + '\\n') } finally { closeSync(descriptor) }
}
const publishRecord = (pendingName, finalName, value) => {
  writeRecord(pendingName, value)
  try {
    execFileSync(config.mvPath, ['-n', pendingName, finalName], { stdio: 'ignore' })
    try { lstatSync(pendingName); throw new Error() } catch (error) { if (error?.code !== 'ENOENT') throw error }
  } catch {
    fail('marker publication failure')
  }
}
const readRecord = (name, keys) => {
  const path = new URL('./' + name, import.meta.url)
  let descriptor
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const recordStats = fstatSync(descriptor)
    if (!recordStats.isFile() || (recordStats.mode & 0o777) !== 0o600 || recordStats.size < 1 || recordStats.size > ${SIDECAR_LIMIT}) throw new Error()
    const text = readFileSync(descriptor, 'utf8')
    if (!/^[^\\n]+\\n$/u.test(text)) throw new Error()
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    const actualKeys = Object.keys(value).sort()
    if (actualKeys.length !== keys.length || actualKeys.some((key, index) => key !== keys[index])) throw new Error()
    return value
  } catch {
    throw new Error('invalid transport release')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}
const waitForRecord = (name) => {
  const path = new URL('./' + name, import.meta.url)
  const deadline = Date.now() + config.releaseWaitMs
  while (Date.now() < deadline) {
    try { lstatSync(path); return } catch {}
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
  }
  throw new Error('transport release timeout')
}
let child
let childClosed = false
let forwarded = false
const killChild = (signal) => { if (!child?.pid || childClosed) return; try { process.kill(-child.pid, signal) } catch {} }
const forward = (signal) => { if (forwarded) return; forwarded = true; killChild(signal) }
const wrapperIdentity = processIdentity(process.pid)
writeRecord('wrapper-ready.json', { records: 1, wrapperPid: process.pid, wrapperParent: wrapperIdentity.parent, wrapperGroup: wrapperIdentity.group, wrapperStart: wrapperIdentity.start, stdin: Boolean(process.stdin.isTTY), stdout: Boolean(process.stdout.isTTY), stderr: Boolean(process.stderr.isTTY), columns: process.stdout.columns, nodeVersion: process.version })
if (config.fault === 'wrapper-ready-marker-nonoverwriting') {
  writeRecord('wrapper-ready-complete.json', { records: 1 })
}
publishRecord(
  'wrapper-ready-complete.pending',
  'wrapper-ready-complete.json',
  config.fault === 'wrapper-ready-marker-malformed'
    ? { records: 1 }
    : { records: 1, evidenceClosed: true },
)
try {
  const wrapperReadyMarker = readRecord('wrapper-ready-complete.json', ['evidenceClosed', 'records'])
  if (wrapperReadyMarker.records !== 1 || wrapperReadyMarker.evidenceClosed !== true) throw new Error()
} catch {
  fail('wrapper readiness marker failure')
}
if (config.requiresOuterTransport) {
  try {
    waitForRecord('outer-transport-ready.json')
    const releaseReady = readRecord('outer-transport-ready.json', ['evidenceClosed', 'records'])
    if (releaseReady.records !== 1 || releaseReady.evidenceClosed !== true) throw new Error()
    const release = readRecord('outer-transport.json', ['outerRaw', 'records'])
    if (release.records !== 1 || release.outerRaw !== true) throw new Error()
  } catch {
    fail('transport release failure')
  }
}
process.once('SIGTERM', () => forward('SIGTERM'))
process.once('SIGHUP', () => forward('SIGHUP'))
process.once('exit', () => killChild('SIGKILL'))
try {
  child = spawn(config.cliPath, config.args, { cwd: '/', detached: true, env: config.env, stdio: 'inherit' })
  child.once('error', (error) => { killChild('SIGKILL'); fail(error.code ?? 'spawn error') })
  const childIdentity = processIdentity(child.pid)
  if (config.fault === 'start-evidence-failure') throw new Error('injected start evidence failure')
  const start = config.fault === 'malformed-start'
    ? { records: 1, wrapperPid: 'invalid' }
    : { records: 1, wrapperPid: process.pid, wrapperParent: wrapperIdentity.parent, wrapperGroup: wrapperIdentity.group, wrapperStart: wrapperIdentity.start, cliPid: child.pid, cliParent: childIdentity.parent, cliGroup: childIdentity.group, cliStart: childIdentity.start, stdin: Boolean(process.stdin.isTTY), stdout: Boolean(process.stdout.isTTY), stderr: Boolean(process.stderr.isTTY), columns: process.stdout.columns, nodeVersion: process.version }
  writeRecord('start.json', start)
  if (config.fault !== 'start-readiness-missing') {
    writeRecord(
      'start-ready.json',
      config.fault === 'start-readiness-malformed'
        ? { records: 1 }
        : { records: 1, startPublished: true },
    )
  }
} catch {
  killChild('SIGKILL')
  fail('start evidence failure')
}
child.once('close', (exitCode, signal) => {
  childClosed = true
  if (config.diagnoseChildWrites) {
    writeRecord('${INNER_MODE_EVIDENCE_NAME}', { start: innerModeStart, end: readOutputModes() })
  }
  const completion = config.fault === 'malformed-completion'
    ? { records: 1, exitCode: 'invalid', signal: null }
    : { records: 1, exitCode, signal }
  writeRecord('completion.json', completion)
  process.exit(exitCode ?? (signal ? 128 : 125))
})
`
}

function captureBounded(path, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(path, args, {
      cwd: options.cwd,
      detached: true,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let bytes = 0
    let settled = false
    let hardTimer
    let readyTimer
    let observer
    let transcriptOversizeInjected = false
    const fail = async (error) => {
      if (settled) return
      settled = true
      if (hardTimer) clearTimeout(hardTimer)
      if (readyTimer) clearTimeout(readyTimer)
      if (observer) clearInterval(observer)
      observe()
      try {
        child.kill('SIGTERM')
      } catch {}
      try {
        await cleanupObserved(options.observed)
        rejectPromise(error)
      } catch (cleanupError) {
        rejectPromise(new AggregateError([error, cleanupError], error.message))
      }
    }
    const observe = () => {
      const current = observeProcessTree(child.pid, options.directory, options.observed)
      if (!settled && options.transcriptEvidence) {
        if (options.transcriptFault === 'typescript-oversize' && !transcriptOversizeInjected) {
          let wrapperReady = false
          try {
            requireWrapperReadyEvidence(options.directory)
            wrapperReady = true
          } catch {}
          if (wrapperReady) {
            try {
              mutatePrivateTranscript(options.transcriptEvidence, (descriptor) => {
                ftruncateSync(descriptor, options.outputLimit + 1)
              })
              transcriptOversizeInjected = true
            } catch {
              void fail(new Error('PTY transcript evidence is invalid'))
              return
            }
          }
        }
        try {
          if (fstatSync(options.transcriptEvidence.descriptor).size > options.outputLimit) {
            void fail(
              createTranscriptFailure(
                'PTY transcript exceeded output limit',
                transcriptOversizeInjected ? 'after-wrapper-readiness' : undefined,
              ),
            )
            return
          }
        } catch {
          void fail(new Error('PTY transcript evidence is invalid'))
          return
        }
      }
      if (
        settled ||
        options.timeoutAfterReadyMs === undefined ||
        options.timeoutReadinessSidecar === undefined ||
        readyTimer !== undefined
      ) {
        return
      }
      try {
        const readyPid = readPidSidecar(options.directory, options.timeoutReadinessSidecar)
        if (!canArmTimeoutAfterReadiness(readyPid, current, options.observed)) return
        readyTimer = setTimeout(
          () => void fail(createPtyTimeoutError('readiness')),
          options.timeoutAfterReadyMs,
        )
      } catch {}
    }
    hardTimer = setTimeout(() => void fail(createPtyTimeoutError('hard')), options.timeoutMs)
    observe()
    observer = setInterval(observe, 20)
    const collect = (target) => (chunk) => {
      bytes += chunk.byteLength
      if (bytes > options.outputLimit) void fail(new Error('PTY capture exceeded output limit'))
      else target.push(chunk)
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.once(
      'error',
      (error) => void fail(new Error(`PTY adapter failed: ${error.code ?? 'spawn'}`)),
    )
    child.once('close', (status, signal) => {
      if (settled) return
      settled = true
      if (hardTimer) clearTimeout(hardTimer)
      if (readyTimer) clearTimeout(readyTimer)
      if (observer) clearInterval(observer)
      observe()
      resolvePromise({
        pid: child.pid,
        outerStatus: status,
        outerSignal: signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      })
    })
  })
}

function createPtyTimeoutError(phase) {
  const error = new Error('PTY capture timed out')
  Object.defineProperty(error, TIMEOUT_PHASE, { value: phase })
  return error
}

function createTranscriptFailure(message, phase) {
  const error = new Error(message)
  if (phase !== undefined) Object.defineProperty(error, TRANSCRIPT_FAILURE_PHASE, { value: phase })
  return error
}

function createPrivateTranscript(directory) {
  const path = join(directory, TRANSCRIPT_NAME)
  let descriptor
  try {
    descriptor = openSync(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    const stats = fstatSync(descriptor, { bigint: true })
    if (
      !stats.isFile() ||
      (stats.mode & 0o777n) !== 0o600n ||
      stats.nlink !== 1n ||
      stats.size !== 0n
    ) {
      throw new Error()
    }
    return Object.freeze({
      descriptor,
      dev: stats.dev,
      ino: stats.ino,
      mode: stats.mode & 0o777n,
      nlink: stats.nlink,
      path,
    })
  } catch {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {}
    }
    throw new Error('PTY transcript evidence is invalid')
  }
}

function applyClosedTranscriptFault(evidence, fault) {
  if (fault === 'typescript-missing') rmSync(evidence.path, { force: true })
  else if (fault === 'typescript-replaced') {
    rmSync(evidence.path, { force: true })
    writeExclusive(evidence.path, Buffer.alloc(0), 0o600)
  } else if (fault === 'typescript-symlink') {
    rmSync(evidence.path, { force: true })
    symlinkSync('config.json', evidence.path)
  } else if (fault === 'typescript-wrong-mode') chmodSync(evidence.path, 0o644)
}

function readValidatedTranscript(evidence, limit, fault) {
  let beforeDescriptor
  let beforePath
  try {
    beforeDescriptor = fstatSync(evidence.descriptor, { bigint: true })
    beforePath = lstatSync(evidence.path, { bigint: true })
  } catch {
    throw new Error('PTY transcript evidence is invalid')
  }
  if (
    !(
      samePrivateTranscript(evidence, beforeDescriptor, beforePath) &&
      sameTranscriptSnapshot(beforeDescriptor, beforePath)
    )
  ) {
    throw new Error('PTY transcript evidence is invalid')
  }
  if (beforeDescriptor.size > BigInt(limit)) {
    throw new Error('PTY transcript exceeded output limit')
  }
  if (fault === 'typescript-unstable') {
    try {
      if (beforeDescriptor.size < 1n) throw new Error()
      const changed = Buffer.alloc(1)
      if (readSync(evidence.descriptor, changed, 0, 1, 0) !== 1) throw new Error()
      changed[0] ^= 1
      mutatePrivateTranscript(evidence, (descriptor) => {
        if (writeSync(descriptor, changed, 0, 1, 0) !== 1) throw new Error()
      })
    } catch {
      throw new Error('PTY transcript evidence is invalid')
    }
  }
  const bytes = Buffer.alloc(Number(beforeDescriptor.size))
  let read = 0
  try {
    while (read < bytes.byteLength) {
      const length = readSync(evidence.descriptor, bytes, read, bytes.byteLength - read, read)
      if (length === 0) throw new Error()
      read += length
    }
    const afterDescriptor = fstatSync(evidence.descriptor, { bigint: true })
    const afterPath = lstatSync(evidence.path, { bigint: true })
    if (
      !(
        samePrivateTranscript(evidence, afterDescriptor, afterPath) &&
        sameTranscriptSnapshot(afterDescriptor, afterPath)
      ) ||
      afterDescriptor.size !== beforeDescriptor.size ||
      afterDescriptor.mtimeNs !== beforeDescriptor.mtimeNs ||
      afterDescriptor.ctimeNs !== beforeDescriptor.ctimeNs ||
      afterPath.size !== beforePath.size ||
      afterPath.mtimeNs !== beforePath.mtimeNs ||
      afterPath.ctimeNs !== beforePath.ctimeNs
    ) {
      throw new Error()
    }
  } catch {
    throw new Error('PTY transcript evidence is invalid')
  }
  return bytes
}

function samePrivateTranscript(evidence, descriptorStats, pathStats) {
  return (
    descriptorStats.isFile() &&
    pathStats.isFile() &&
    !pathStats.isSymbolicLink() &&
    descriptorStats.dev === evidence.dev &&
    descriptorStats.ino === evidence.ino &&
    pathStats.dev === evidence.dev &&
    pathStats.ino === evidence.ino &&
    (descriptorStats.mode & 0o777n) === evidence.mode &&
    (pathStats.mode & 0o777n) === evidence.mode &&
    descriptorStats.nlink === evidence.nlink &&
    pathStats.nlink === evidence.nlink &&
    evidence.mode === 0o600n &&
    evidence.nlink === 1n
  )
}

function sameTranscriptSnapshot(descriptorStats, pathStats) {
  return (
    descriptorStats.size === pathStats.size &&
    descriptorStats.mtimeNs === pathStats.mtimeNs &&
    descriptorStats.ctimeNs === pathStats.ctimeNs
  )
}

function mutatePrivateTranscript(evidence, mutation) {
  let descriptor
  let failure
  try {
    descriptor = openSync(evidence.path, constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0))
    const beforeDescriptor = fstatSync(descriptor, { bigint: true })
    const beforePath = lstatSync(evidence.path, { bigint: true })
    if (!samePrivateTranscript(evidence, beforeDescriptor, beforePath)) throw new Error()
    mutation(descriptor)
    const afterDescriptor = fstatSync(descriptor, { bigint: true })
    const afterPath = lstatSync(evidence.path, { bigint: true })
    if (!samePrivateTranscript(evidence, afterDescriptor, afterPath)) throw new Error()
  } catch {
    failure = new Error('PTY transcript evidence is invalid')
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        failure ??= new Error('PTY transcript evidence is invalid')
      }
    }
  }
  if (failure) throw failure
}

async function cleanupObserved(observed) {
  const errors = []
  if (observed.cleanupFault === 'observation-ambiguity') {
    errors.push(new Error('Injected PTY cleanup observation ambiguity'))
  }
  const termSnapshot = scanProcesses(observed)
  if (!termSnapshot) {
    errors.push(
      new Error(`PTY cleanup process observation failed before TERM: ${observed.probeFailure}`),
    )
  } else {
    observeIdentitySnapshot(observed, termSnapshot)
    observeRequiredGroups(termSnapshot, observed)
    signalMatchingIdentities(termSnapshot, observed, 'SIGTERM', errors)
  }

  await delay(100)
  if (observed.cleanupFault === 'signaling-failure') {
    errors.push(new Error('Injected PTY cleanup signaling failure'))
  }
  const killSnapshot = scanProcesses(observed)
  if (!killSnapshot) {
    errors.push(
      new Error(`PTY cleanup process observation failed before KILL: ${observed.probeFailure}`),
    )
  } else {
    observeIdentitySnapshot(observed, killSnapshot)
    observeRequiredGroups(killSnapshot, observed)
    signalMatchingIdentities(killSnapshot, observed, 'SIGKILL', errors)
  }

  try {
    await confirmIdentitiesGone(observed)
  } catch (error) {
    errors.push(error)
  }
  if (observed.cleanupFault === 'survivor') {
    errors.push(new Error('Injected PTY cleanup survivor'))
  }
  if (!observed.probeSucceeded || observed.probeFailed) {
    errors.push(
      new Error(`PTY descendant observation failed: ${observed.probeFailure ?? 'unknown'}`),
    )
  }
  if (observed.ambiguous || (observed.provisionalGroupChanges?.size ?? 0) > 0) {
    errors.push(new Error('PTY descendant identity observation was ambiguous'))
  }
  if (errors.length > 0) throw new AggregateError(errors, 'PTY cleanup evidence is ambiguous')
}

function observeRequiredGroups(current, observed) {
  for (const group of observed.requiredGroups ?? []) {
    for (const [pid, identity] of current) {
      if (identity.group !== group) continue
      observeIdentity(observed, pid, identity)
    }
  }
}

function signalMatchingIdentities(current, observed, signal, errors) {
  const matching = matchingObservedIdentities(current, observed)
  const groups = new Set([...matching.values()].map((identity) => identity.group))
  for (const group of groups) {
    if (!(Number.isSafeInteger(group) && group > 1)) continue
    const currentMembers = [...current].filter(([_pid, identity]) => identity.group === group)
    const groupIsExact =
      currentMembers.length > 0 &&
      currentMembers.every(([pid, identity]) => sameProcessIdentity(matching.get(pid), identity))
    if (groupIsExact) {
      try {
        process.kill(-group, signal)
        continue
      } catch (error) {
        if (error.code !== 'EPERM' && error.code !== 'ESRCH') errors.push(error)
      }
    }
    for (const [pid, identity] of currentMembers) {
      if (!sameProcessIdentity(matching.get(pid), identity)) continue
      try {
        process.kill(pid, signal)
      } catch (error) {
        if (error.code !== 'ESRCH') errors.push(error)
      }
    }
  }
}

function observeProcessTree(outerPid, directory, observed) {
  const roots = new Set([outerPid])
  const publishedWrapper = readPublishedWrapperIdentity(directory)
  const publishedCli = readPublishedCliIdentity(directory)
  for (const name of ['script-pid', 'wrapper-ready.json', 'start.json']) {
    try {
      if (name === 'script-pid') roots.add(readPidSidecar(directory, name))
      else {
        const evidence = readSidecar(directory, name)
        if (Number.isSafeInteger(evidence.wrapperPid)) roots.add(evidence.wrapperPid)
        if (Number.isSafeInteger(evidence.cliPid)) roots.add(evidence.cliPid)
      }
    } catch {}
  }
  const current = scanProcesses(observed)
  if (!current) {
    observed.probeFailed = true
    return undefined
  }
  observed.probeSucceeded = true
  observeIdentitySnapshot(observed, current)
  for (const published of [
    { pid: outerPid, identity: current.get(outerPid) },
    publishedWrapper,
    publishedCli,
  ]) {
    if (
      published?.identity &&
      observed.provisionalGroupChanges?.has(published.pid) &&
      !observed.authoritative?.has(published.pid)
    ) {
      promoteWrapperIdentity(
        observed,
        published.pid,
        published.identity,
        current.get(published.pid),
      )
    }
  }
  const descendants = new Set(roots)
  let changed = true
  while (changed) {
    changed = false
    for (const [pid, identity] of current) {
      if (!descendants.has(pid) && descendants.has(identity.parent)) {
        descendants.add(pid)
        changed = true
      }
    }
  }
  for (const pid of descendants) {
    const identity = current.get(pid)
    if (!identity) continue
    observeIdentity(observed, pid, identity)
  }
  return current
}

export function canArmTimeoutAfterReadiness(pid, current, observed) {
  const liveIdentity = current?.get(pid)
  const observedIdentity = observed.get(pid)
  return Boolean(
    liveIdentity &&
      observedIdentity &&
      observed.probeSucceeded === true &&
      !observed.probeFailed &&
      !observed.ambiguous &&
      !observed.missing?.has(pid) &&
      (observed.reappeared?.size ?? 0) === 0 &&
      (observed.provisionalGroupChanges?.size ?? 0) === 0 &&
      identityChangeDiagnostic(liveIdentity, observedIdentity) === undefined,
  )
}

function readPublishedWrapperIdentity(directory) {
  try {
    const wrapperReady = requireWrapperReadyEvidence(directory)
    return {
      pid: wrapperReady.wrapperPid,
      identity: {
        parent: wrapperReady.wrapperParent,
        group: wrapperReady.wrapperGroup,
        start: wrapperReady.wrapperStart,
      },
    }
  } catch {
    return undefined
  }
}

function readPublishedCliIdentity(directory) {
  try {
    requireStartReadinessEvidence(directory)
    const start = readSidecar(directory, 'start.json')
    validateStart(start)
    return {
      pid: start.cliPid,
      identity: {
        parent: start.cliParent,
        group: start.cliGroup,
        start: start.cliStart,
      },
    }
  } catch {
    return undefined
  }
}

function scanProcesses(observed) {
  const uid = process.getuid?.()
  if (!Number.isSafeInteger(uid) || uid < 0) {
    recordProcessScanFailure(observed, 'uid')
    return undefined
  }
  const probe = spawnSync('/bin/ps', processScanArguments(uid), {
    encoding: 'utf8',
    env: minimalOuterEnvironment(),
    maxBuffer: PROCESS_SCAN_OUTPUT_LIMIT,
    timeout: PROCESS_SCAN_TIMEOUT_MS,
  })
  const failure = processScanFailureReason({
    uid,
    error: probe.error,
    status: probe.status,
    stdout: probe.stdout,
  })
  if (failure) {
    recordProcessScanFailure(observed, failure)
    return undefined
  }
  const current = new Map()
  for (const line of probe.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/u.exec(line)
    if (!match) continue
    current.set(Number(match[1]), {
      parent: Number(match[2]),
      group: Number(match[3]),
      start: match[4],
    })
  }
  return current
}

export function processScanFailureReason(options) {
  if (!Number.isSafeInteger(options?.uid) || options.uid < 0) return 'uid'
  if (options.error) return options.error.code === 'ETIMEDOUT' ? 'timeout' : 'spawn'
  if (options.status !== 0) return 'status'
  if (
    typeof options.stdout !== 'string' ||
    Buffer.byteLength(options.stdout) >= PROCESS_SCAN_OUTPUT_LIMIT
  ) {
    return 'oversize'
  }
  return undefined
}

function recordProcessScanFailure(observed, failure) {
  if (!observed) return
  observed.probeFailed = true
  observed.probeFailure ??= failure
}

async function confirmIdentitiesGone(observed) {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    const current = scanProcesses(observed)
    if (!current) {
      throw new Error(
        `PTY cleanup process observation failed during confirmation: ${observed.probeFailure}`,
      )
    }
    observeIdentitySnapshot(observed, current)
    const survivors = [...matchingObservedIdentities(current, observed)]
    const survivingGroups = [...(observed.requiredGroups ?? [])].filter((group) =>
      [...current.values()].some((identity) => identity.group === group),
    )
    if (survivors.length === 0 && survivingGroups.length === 0) return
    await delay(10)
  }
  throw new Error('PTY observed process identity survived cleanup')
}

export function sameProcessIdentity(left, right) {
  return Boolean(
    left &&
      right &&
      left.group === right.group &&
      typeof left.start === 'string' &&
      left.start === right.start,
  )
}

function readSidecar(directory, name) {
  const path = join(directory, name)
  let stats
  try {
    stats = lstatSync(path)
  } catch {
    throw new Error('PTY sidecar is missing or malformed')
  }
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    (stats.mode & 0o777) !== 0o600 ||
    stats.size < 1 ||
    stats.size > SIDECAR_LIMIT
  ) {
    throw new Error('PTY sidecar is missing or malformed')
  }
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n')
  if (lines.length !== 1) throw new Error('PTY sidecar must contain exactly one record')
  try {
    const value = JSON.parse(lines[0])
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value
  } catch {
    throw new Error('PTY sidecar is missing or malformed')
  }
}

function requireWriteBoundaryEvidence(directory, rawTerminal) {
  try {
    const child = readSidecar(directory, CHILD_WRITE_EVIDENCE_NAME)
    requireExactKeys(
      child,
      ['closed', 'combined', 'stderr', 'stdout', 'writes'],
      'child write evidence',
    )
    if (child.closed !== true) throw new Error()
    const combined = requireBooleanRecord(child.combined, LINE_ENDING_KEYS)
    const stderr = requireBooleanRecord(child.stderr, LINE_ENDING_KEYS)
    const stdout = requireBooleanRecord(child.stdout, LINE_ENDING_KEYS)
    const writes = requireBooleanRecord(child.writes, WRITE_MODE_KEYS)
    const modes = readSidecar(directory, INNER_MODE_EVIDENCE_NAME)
    requireExactKeys(modes, ['end', 'start'], 'inner mode evidence')
    const start = requireBooleanRecord(modes.start, OUTPUT_MODE_KEYS)
    const end = requireBooleanRecord(modes.end, OUTPUT_MODE_KEYS)
    const stateChanged =
      writes.stateChanged || OUTPUT_MODE_KEYS.some((key) => start[key] !== end[key])
    return Object.freeze({
      child: Object.freeze({ combined, stderr, stdout }),
      inner: classifyLineEndingEvidence(rawTerminal),
      modes: Object.freeze({ end, start, stateChanged, writes }),
    })
  } catch {
    throw new Error('PTY child write evidence is invalid')
  }
}

function requireBooleanRecord(value, keys) {
  requireExactKeys(value, keys, 'boolean evidence')
  if (keys.some((key) => typeof value[key] !== 'boolean')) throw new Error()
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, value[key]])))
}

function applyOwnedLineEndings(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Terminal capture must be a Buffer')
  let bareLineFeeds = 0
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] === 10 && bytes[index - 1] !== 13) bareLineFeeds += 1
  }
  if (bareLineFeeds === 0) return bytes
  const mapped = Buffer.allocUnsafe(bytes.byteLength + bareLineFeeds)
  let target = 0
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index]
    if (byte === 10 && bytes[index - 1] !== 13) mapped[target++] = 13
    mapped[target++] = byte
  }
  return mapped
}

function classifyLineEndingEvidence(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Terminal capture must be a Buffer')
  const evidence = {
    bareLf: false,
    beforeEscape: false,
    beforeOtherControl: false,
    beforeText: false,
    doubleCrlf: false,
    singleCrlf: false,
    trailing: false,
  }
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] === 10) {
      evidence.bareLf = true
      continue
    }
    if (bytes[index] !== 13) continue
    let end = index
    while (bytes[end + 1] === 13) end += 1
    const carriageReturns = end - index + 1
    const next = bytes[end + 1]
    if (next === 10) {
      if (carriageReturns > 1) evidence.doubleCrlf = true
      else evidence.singleCrlf = true
      index = end + 1
      continue
    }
    if (carriageReturns > 1) evidence.beforeOtherControl = true
    if (next === undefined) evidence.trailing = true
    else if (next === 27) evidence.beforeEscape = true
    else if (next < 0x20 || (next >= 0x7f && next <= 0x9f)) {
      evidence.beforeOtherControl = true
    } else evidence.beforeText = true
    index = end
  }
  return Object.freeze(evidence)
}

function readPidSidecar(directory, name) {
  const path = join(directory, name)
  let stats
  try {
    stats = lstatSync(path)
  } catch {
    throw new Error('PTY PID sidecar is missing or malformed')
  }
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    (stats.mode & 0o777) !== 0o600 ||
    stats.size < 2 ||
    stats.size > SIDECAR_LIMIT
  ) {
    throw new Error('PTY PID sidecar is missing or malformed')
  }
  const text = readFileSync(path, 'utf8')
  if (!/^\d+\n$/u.test(text)) throw new Error('PTY PID sidecar is missing or malformed')
  const pid = Number(text.trim())
  validatePid(pid)
  return pid
}

function validateCompletion(completion) {
  requireExactKeys(completion, COMPLETION_KEYS, 'completion')
  const validExit =
    completion.exitCode === null ||
    (Number.isSafeInteger(completion.exitCode) &&
      completion.exitCode >= 0 &&
      completion.exitCode <= 255)
  const validSignal = completion.signal === null || KNOWN_SIGNALS.has(completion.signal)
  if (
    completion.records !== 1 ||
    !(validExit && validSignal) ||
    (completion.exitCode === null) === (completion.signal === null)
  ) {
    throw new Error('PTY completion evidence is malformed')
  }
}

function requireStartReadinessEvidence(directory) {
  try {
    const evidence = readSidecar(directory, 'start-ready.json')
    requireExactKeys(evidence, START_READINESS_KEYS, 'start readiness')
    if (evidence.records !== 1 || evidence.startPublished !== true) throw new Error()
  } catch {
    throw new Error('PTY start readiness evidence is invalid')
  }
}

function requireOuterTransportEvidence(directory) {
  try {
    const ready = readSidecar(directory, 'outer-transport-ready.json')
    requireExactKeys(ready, OUTER_TRANSPORT_READY_KEYS, 'outer transport readiness')
    if (ready.records !== 1 || ready.evidenceClosed !== true) throw new Error()
    const evidence = readSidecar(directory, 'outer-transport.json')
    requireExactKeys(evidence, OUTER_TRANSPORT_KEYS, 'outer transport')
    if (evidence.records !== 1 || evidence.outerRaw !== true) {
      throw new Error()
    }
  } catch {
    throw new Error('PTY outer transport evidence is invalid')
  }
}

function requireWrapperReadyEvidence(directory) {
  try {
    const marker = readSidecar(directory, 'wrapper-ready-complete.json')
    requireExactKeys(marker, WRAPPER_READY_MARKER_KEYS, 'wrapper readiness marker')
    if (marker.records !== 1 || marker.evidenceClosed !== true) throw new Error()
    const evidence = readSidecar(directory, 'wrapper-ready.json')
    requireExactKeys(evidence, WRAPPER_READY_KEYS, 'wrapper readiness')
    validatePid(evidence.wrapperPid)
    validateProcessIdentity({
      parent: evidence.wrapperParent,
      group: evidence.wrapperGroup,
      start: evidence.wrapperStart,
    })
    if (
      evidence.records !== 1 ||
      evidence.stdin !== true ||
      evidence.stdout !== true ||
      evidence.stderr !== true ||
      !Number.isSafeInteger(evidence.columns) ||
      evidence.columns < 1 ||
      typeof evidence.nodeVersion !== 'string'
    ) {
      throw new Error()
    }
    return evidence
  } catch {
    throw new Error('PTY wrapper readiness evidence is invalid')
  }
}

function requireWrapperIdentityAgreement(wrapperReady, start) {
  for (const key of [
    'wrapperPid',
    'wrapperParent',
    'wrapperGroup',
    'wrapperStart',
    'stdin',
    'stdout',
    'stderr',
    'columns',
    'nodeVersion',
  ]) {
    if (wrapperReady[key] !== start[key]) {
      throw new Error('PTY wrapper readiness evidence disagrees with start evidence')
    }
  }
}

function validateStart(start) {
  requireExactKeys(start, START_KEYS, 'start')
  for (const pid of [start.wrapperPid, start.cliPid]) validatePid(pid)
  for (const parent of [start.wrapperParent, start.cliParent]) {
    if (!Number.isSafeInteger(parent) || parent < 0)
      throw new Error('PTY start evidence is malformed')
  }
  for (const group of [start.wrapperGroup, start.cliGroup]) {
    if (!Number.isSafeInteger(group) || group <= 1)
      throw new Error('PTY start evidence is malformed')
  }
  for (const value of [start.wrapperStart, start.cliStart]) {
    if (
      typeof value !== 'string' ||
      value.length < 1 ||
      value.length > 128 ||
      /[\r\n]/u.test(value)
    ) {
      throw new Error('PTY start evidence is malformed')
    }
  }
  if (
    start.records !== 1 ||
    typeof start.stdin !== 'boolean' ||
    typeof start.stdout !== 'boolean' ||
    typeof start.stderr !== 'boolean' ||
    !Number.isSafeInteger(start.columns) ||
    typeof start.nodeVersion !== 'string'
  ) {
    throw new Error('PTY start evidence is malformed')
  }
}

function requireExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`PTY ${label} sidecar schema is malformed`)
  }
}

export function registerEvidenceIdentity(observed, roleOrPid, pidOrIdentity, maybeIdentity) {
  const { identity, pid, role } = normalizeEvidenceRegistration(
    roleOrPid,
    pidOrIdentity,
    maybeIdentity,
  )
  validatePid(pid)
  validateProcessIdentity(identity)
  const previous = observed.get(pid)
  const diagnostic = previous && identityChangeDiagnostic(previous, identity)
  if (diagnostic) {
    observed.ambiguous = true
    throw new Error(`PTY process identity evidence changed [${role}-${diagnostic}]`)
  }
  if (observed.provisionalGroupChanges?.has(pid)) {
    const promoted =
      (role === 'cli' || role === 'wrapper') &&
      promoteWrapperIdentity(observed, pid, identity, identity)
    if (!promoted) {
      observed.ambiguous = true
      throw new Error(`PTY process identity evidence changed [${role}-group-only]`)
    }
    return
  }
  observed.set(pid, identity)
}

function normalizeEvidenceRegistration(roleOrPid, pidOrIdentity, maybeIdentity) {
  if (typeof roleOrPid === 'string') {
    if (!EVIDENCE_ROLES.has(roleOrPid)) throw new Error('PTY evidence role is not recognized')
    return { identity: maybeIdentity, pid: pidOrIdentity, role: roleOrPid }
  }
  return { identity: pidOrIdentity, pid: roleOrPid, role: 'unclassified' }
}

function identityChangeDiagnostic(previous, identity) {
  const axes = []
  if (previous.parent !== identity.parent) axes.push('parent')
  if (previous.group !== identity.group) axes.push('group')
  if (previous.start !== identity.start) axes.push('start')
  return IDENTITY_CHANGE_DIAGNOSTICS.get(axes.sort().join('-'))
}

export function observeIdentity(observed, pid, identity) {
  const previous = observed.get(pid)
  if (!previous) {
    observed.set(pid, identity)
    return
  }
  if (sameProcessIdentity(previous, identity)) return
  const provisionalGroupChange =
    observed.allowWrapperPromotion === true &&
    !observed.authoritative?.has(pid) &&
    previous.parent === identity.parent &&
    previous.start === identity.start &&
    previous.group !== identity.group &&
    !observed.missing?.has(pid) &&
    !observed.reappeared?.has(pid)
  if (!provisionalGroupChange) {
    observed.ambiguous = true
    return
  }
  observed.provisionalGroupChanges ??= new Map()
  if (observed.provisionalGroupChanges.has(pid)) {
    observed.ambiguous = true
    return
  }
  observed.provisionalGroupChanges.set(pid, {
    fromGroup: previous.group,
    parent: previous.parent,
    start: previous.start,
    toGroup: identity.group,
  })
  observed.set(pid, { ...previous, group: identity.group })
}

export function observeIdentitySnapshot(observed, current) {
  observed.missing ??= new Set()
  observed.reappeared ??= new Set()
  for (const [pid] of observed) {
    const currentIdentity = current.get(pid)
    if (!currentIdentity) {
      observed.missing.add(pid)
      continue
    }
    if (observed.missing.has(pid)) {
      observed.ambiguous = true
      observed.reappeared.add(pid)
    }
    observeIdentity(observed, pid, currentIdentity)
  }
}

export function promoteWrapperIdentity(observed, pid, evidence, freshIdentity) {
  validatePid(pid)
  validateProcessIdentity(evidence)
  const previous = observed.get(pid)
  const change = observed.provisionalGroupChanges?.get(pid)
  const exactFreshEvidence =
    freshIdentity && identityChangeDiagnostic(freshIdentity, evidence) === undefined
  const exactStoredEvidence = previous && identityChangeDiagnostic(previous, evidence) === undefined
  const stateIsContinuous = !(
    observed.missing?.has(pid) ||
    observed.reappeared?.has(pid) ||
    observed.ambiguous
  )
  const validChange =
    change !== undefined &&
    change.parent === evidence.parent &&
    change.start === evidence.start &&
    change.toGroup === evidence.group &&
    evidence.group === pid
  if (
    observed.allowWrapperPromotion !== true ||
    !previous ||
    !freshIdentity ||
    !exactFreshEvidence ||
    !exactStoredEvidence ||
    !stateIsContinuous ||
    !validChange
  ) {
    observed.ambiguous = true
    return false
  }
  observed.authoritative ??= new Set()
  observed.authoritative.add(pid)
  observed.provisionalGroupChanges?.delete(pid)
  observed.set(pid, evidence)
  return true
}

export function matchingObservedIdentities(current, observed) {
  return new Map(
    [...observed].filter(
      ([pid, identity]) =>
        !observed.reappeared?.has(pid) && sameProcessIdentity(current.get(pid), identity),
    ),
  )
}

export function processScanArguments(uid) {
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error('PTY process UID is unavailable')
  return ['-U', String(uid), '-x', '-o', 'pid=', '-o', 'ppid=', '-o', 'pgid=', '-o', 'lstart=']
}

function requireObservedIdentity(observed, pid, expected = {}) {
  validatePid(pid)
  const identity = observed.get(pid)
  validateProcessIdentity(identity)
  if (expected.group !== undefined && identity.group !== expected.group) {
    observed.ambiguous = true
    throw new Error('PTY process-group evidence changed')
  }
  return identity
}

function validateProcessIdentity(identity) {
  if (
    !(identity && Number.isSafeInteger(identity.parent)) ||
    identity.parent < 0 ||
    !Number.isSafeInteger(identity.group) ||
    identity.group <= 1 ||
    typeof identity.start !== 'string' ||
    identity.start.length < 1
  ) {
    throw new Error('PTY process identity evidence is malformed')
  }
}

function validatePid(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('PTY evidence contains invalid PID')
}

function writeExclusive(path, bytes, mode) {
  const descriptor = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, mode)
  try {
    writeSync(descriptor, bytes)
  } finally {
    closeSync(descriptor)
  }
  chmodSync(path, mode)
}

function minimalOuterEnvironment() {
  const path = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter)
  return { PATH: path, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TERM: 'xterm-256color' }
}

function requireExecutable(path, label) {
  try {
    const stats = statSync(path)
    if (!stats.isFile()) throw new Error()
    accessSync(path, constants.X_OK)
    return realpathSync(path)
  } catch {
    throw new Error(`Missing required ${label} executable at ${path}`)
  }
}

function requireAbsoluteRegularFile(path, label) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) {
    throw new Error(`${label} path must be canonical and absolute`)
  }
  const stats = lstatSync(path)
  if (!stats.isFile() || stats.isSymbolicLink() || realpathSync.native(path) !== path) {
    throw new Error(`${label} path must be a canonical regular file`)
  }
  return path
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`PTY ${label} must be a string array`)
  }
  return [...value]
}

function requireEnvironment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PTY environment must be an object')
  }
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || typeof item !== 'string' || item.includes('\0')) {
      throw new Error('PTY environment contains an invalid entry')
    }
    result[key] = item
  }
  return result
}

function requireColumns(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) {
    throw new Error('PTY columns must be an integer between 1 and 1000')
  }
  return value
}

function requireBound(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`PTY ${label} must be positive`)
  return value
}

function requireTestFault(value) {
  if (value === undefined) return null
  if (typeof value !== 'string' || !TEST_FAULTS.has(value)) {
    throw new Error('PTY test fault is not recognized')
  }
  return value
}

function requireCleanupFault(value) {
  if (value === undefined) return null
  if (typeof value !== 'string' || !CLEANUP_FAULTS.has(value)) {
    throw new Error('PTY cleanup test fault is not recognized')
  }
  return value
}

const delay = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
