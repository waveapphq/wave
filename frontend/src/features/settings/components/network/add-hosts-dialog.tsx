/**
 * Add Hosts dialog (NET-4): reads host keys from a host or from pasted lines, marks them
 * against the page's staged hosts and hands the checked ones to the page; it writes nothing.
 */

import { useId, useMemo, useState, type SubmitEvent } from 'react'
import type { RowSelectionState } from '@tanstack/react-table'
import { EditorView } from '@codemirror/view'
import { Button } from '@/components/ui/button'
import { EditDialog } from '@/components/ui/edit-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/components/shared/segmented-control'
import { FillCodeMirror } from '@/components/shared/variable-bodies/fill-code-mirror'
import { createPlainTextEditorExtensions } from '@/lib/codemirror/plain-text-editor'
import { toFailureDetail } from '@/lib/failure-detail'
import { acceptsNumericInput, compareNumbers, numberTextProblem } from '@/lib/number-rule'
import {
  HostKeyPreviewTable,
  type HostKeyMarker,
  type HostKeyPreviewRow,
} from '@/features/settings/components/network/host-key-preview-table'
import {
  useDebouncedParse,
  type DebouncedParse,
} from '@/features/settings/container/use-debounced-parse'
import {
  detectHostKeys,
  parseHostLines,
  type DetectedHostKey,
  type HostKeyType,
  type HostLinesParse,
  type NewTrustedHostEntry,
  type StagedTrustedHost,
} from '@/features/settings/api/ssh-hosts'

type AddMode = 'detect' | 'paste'

const MODE_OPTIONS: readonly SegmentedControlOption<AddMode>[] = [
  { value: 'detect', label: 'Detect from host' },
  { value: 'paste', label: 'Paste lines' },
]

const DEFAULT_PORT = '22'
const MAX_PORT = 65535
const PORT_RULE = { negative: false } as const

const NO_ROWS: HostKeyPreviewRow[] = []
const NO_LINES: string[] = []

// The extensions draw the line numbers; the basic setup adds no second gutter, completion or auto-closed brackets.
const PASTE_EXTENSIONS = [
  ...createPlainTextEditorExtensions({ valueColor: false }),
  EditorView.contentAttributes.of({ 'aria-label': 'Host key lines' }),
]
const PASTE_SETUP = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  autocompletion: false,
  closeBrackets: false,
  bracketMatching: false,
}

type DetectState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'failed'; error: string }
  | { status: 'done'; keys: DetectedHostKey[] }

interface DetectTarget {
  host: string
  port: number
}

const DETECT_IDLE: DetectState = { status: 'idle' }

type PreviewDraft = Omit<HostKeyPreviewRow, 'marker'>

/** Fingerprints known per host name, port and key type. */
type KnownKeys = Map<string, Set<string>>

function parsePort(text: string): number | null {
  if (numberTextProblem(text, 'integer') !== null) return null
  return compareNumbers(text, 1) >= 0 && compareNumbers(text, MAX_PORT) <= 0 ? Number(text) : null
}

function slotOf(name: string, port: number, keyType: HostKeyType): string {
  return `${name}\n${port}\n${keyType}`
}

function remember(known: KnownKeys, slot: string, fingerprint: string): void {
  const prints = known.get(slot)
  if (prints) prints.add(fingerprint)
  else known.set(slot, new Set([fingerprint]))
}

function knownKeysOf(hosts: StagedTrustedHost[]): KnownKeys {
  const known: KnownKeys = new Map()
  for (const host of hosts) remember(known, slotOf(host.host, host.port, host.key_type), host.fingerprint)
  return known
}

function markerFor(draft: PreviewDraft, known: KnownKeys): HostKeyMarker {
  let everyNameTrusted = true
  for (const name of draft.hostNames) {
    const prints = known.get(slotOf(name, draft.port, draft.keyType))
    if (prints === undefined) {
      everyNameTrusted = false
    } else if (prints.size > 1 || !prints.has(draft.fingerprint)) {
      return 'key-changed'
    }
  }
  return everyNameTrusted ? 'already-trusted' : 'none'
}

/** Marks each row against the staged hosts and the rows above it; an earlier row wins. */
function markRows(drafts: PreviewDraft[], stagedHosts: StagedTrustedHost[]): HostKeyPreviewRow[] {
  const known = knownKeysOf(stagedHosts)
  return drafts.map((draft) => {
    const marker = markerFor(draft, known)
    for (const name of draft.hostNames) {
      remember(known, slotOf(name, draft.port, draft.keyType), draft.fingerprint)
    }
    return { ...draft, marker }
  })
}

function detectedDrafts(keys: DetectedHostKey[]): PreviewDraft[] {
  return keys.map((key, index) => ({
    id: `detected-${index + 1}`,
    hostNames: [key.host],
    port: key.port,
    keyType: key.key_type,
    key: key.key,
    fingerprint: key.fingerprint,
  }))
}

function pastedDrafts(parse: HostLinesParse): PreviewDraft[] {
  return parse.entries.map((entry, index) => ({
    id: `pasted-${index + 1}`,
    hostNames: entry.host_names,
    port: entry.port,
    keyType: entry.key_type,
    key: entry.key,
    fingerprint: entry.fingerprint,
  }))
}

function defaultSelection(rows: HostKeyPreviewRow[]): RowSelectionState {
  return Object.fromEntries(rows.filter((row) => row.marker === 'none').map((row) => [row.id, true]))
}

function isChecked(row: HostKeyPreviewRow, selected: RowSelectionState): boolean {
  return row.marker === 'none' && selected[row.id] === true
}

/** One entry per name of each checked row, leaving out names already trusted with that key. */
function entriesFor(
  rows: HostKeyPreviewRow[],
  selected: RowSelectionState,
  stagedHosts: StagedTrustedHost[],
): NewTrustedHostEntry[] {
  const known = knownKeysOf(stagedHosts)
  const entries: NewTrustedHostEntry[] = []
  for (const row of rows.filter((candidate) => isChecked(candidate, selected))) {
    for (const name of row.hostNames) {
      const slot = slotOf(name, row.port, row.keyType)
      if (known.get(slot)?.has(row.fingerprint)) continue
      remember(known, slot, row.fingerprint)
      entries.push({ host: name, port: row.port, key_type: row.keyType, key: row.key, fingerprint: row.fingerprint })
    }
  }
  return entries
}

function pasteErrorLines(parse: DebouncedParse<HostLinesParse>): string[] {
  if (parse.error !== undefined) return [parse.error]
  return parse.result?.errors.map((error) => `Line ${error.line}: ${error.message}`) ?? NO_LINES
}

/** The checked rows of one result: its default until the admin changes them, reset by a new result. */
function useResultSelection(
  source: object | undefined,
  rows: HostKeyPreviewRow[],
): [RowSelectionState, (next: RowSelectionState) => void] {
  const [changed, setChanged] = useState<{ source: object; selected: RowSelectionState } | null>(null)
  const initial = useMemo(() => defaultSelection(rows), [rows])
  const selected = source !== undefined && changed?.source === source ? changed.selected : initial
  const onChange = (next: RowSelectionState) => {
    if (source !== undefined) setChanged({ source, selected: next })
  }
  return [selected, onChange]
}

interface DetectFieldsProps {
  host: string
  port: string
  busy: boolean
  /** Null while Detect cannot run. */
  target: DetectTarget | null
  onHostChange: (host: string) => void
  onPortChange: (port: string) => void
  onDetect: (target: DetectTarget) => void
}

function DetectFields({
  host,
  port,
  busy,
  target,
  onHostChange,
  onPortChange,
  onDetect,
}: Readonly<DetectFieldsProps>) {
  const id = useId()
  const hostId = `${id}-host`
  const portId = `${id}-port`

  // Enter in Host or Port submits through the Detect button, which is disabled without a target.
  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (target) onDetect(target)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-[minmax(0,1fr)_96px_max-content] items-center gap-x-3 gap-y-2"
    >
      <Label htmlFor={hostId}>Host</Label>
      <Label htmlFor={portId}>Port</Label>
      <span aria-hidden="true" />
      <Input
        id={hostId}
        name="host"
        value={host}
        disabled={busy}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onHostChange(event.target.value)}
      />
      <Input
        id={portId}
        name="port"
        value={port}
        disabled={busy}
        inputMode="numeric"
        autoComplete="off"
        onChange={(event) => {
          if (acceptsNumericInput(event.target.value, 'integer', PORT_RULE)) onPortChange(event.target.value)
        }}
      />
      <Button type="submit" variant="secondary" disabled={target === null} loading={busy}>
        Detect
      </Button>
    </form>
  )
}

/** What the dialog shows and adds for the visible mode. */
interface ModeView {
  rows: HostKeyPreviewRow[]
  selected: RowSelectionState
  onSelectedChange: (next: RowSelectionState) => void
  /** False while a request runs or before any result. */
  ready: boolean
  errorLines: string[]
}

function useDetectMode(stagedHosts: StagedTrustedHost[]) {
  const [host, setHost] = useState('')
  const [port, setPort] = useState(DEFAULT_PORT)
  const [detect, setDetect] = useState<DetectState>(DETECT_IDLE)

  const keys = detect.status === 'done' ? detect.keys : undefined
  const rows = useMemo(
    () => (keys ? markRows(detectedDrafts(keys), stagedHosts) : NO_ROWS),
    [keys, stagedHosts],
  )
  const [selected, onSelectedChange] = useResultSelection(keys, rows)

  const portNumber = parsePort(port)
  const busy = detect.status === 'running'
  const target =
    !busy && host.trim() !== '' && portNumber !== null ? { host: host.trim(), port: portNumber } : null

  const run = (next: DetectTarget) => {
    setDetect({ status: 'running' })
    detectHostKeys(next.host, next.port).then(
      (found) => setDetect({ status: 'done', keys: found }),
      (error: unknown) => setDetect({ status: 'failed', error: toFailureDetail(error).message }),
    )
  }

  // Editing the host or port drops the previous answer.
  const changeHost = (next: string) => {
    setHost(next)
    setDetect(DETECT_IDLE)
  }
  const changePort = (next: string) => {
    setPort(next)
    setDetect(DETECT_IDLE)
  }

  const view: ModeView = {
    rows,
    selected,
    onSelectedChange,
    ready: detect.status === 'done',
    errorLines: detect.status === 'failed' ? [detect.error] : NO_LINES,
  }
  return { host, port, busy, target, run, changeHost, changePort, view }
}

function usePasteMode(stagedHosts: StagedTrustedHost[]) {
  const [text, setText] = useState('')
  const parse = useDebouncedParse(text, parseHostLines)

  const result = parse.result
  const rows = useMemo(
    () => (result ? markRows(pastedDrafts(result), stagedHosts) : NO_ROWS),
    [result, stagedHosts],
  )
  const [selected, onSelectedChange] = useResultSelection(result, rows)

  const view: ModeView = {
    rows,
    selected,
    onSelectedChange,
    ready: parse.status === 'done',
    errorLines: pasteErrorLines(parse),
  }
  return { text, setText, view }
}

export interface AddHostsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The page's staged table: rows are marked against it. */
  stagedHosts: StagedTrustedHost[]
  onAdd: (entries: NewTrustedHostEntry[]) => void
}

function AddHostsSession({ open, onOpenChange, stagedHosts, onAdd }: Readonly<AddHostsDialogProps>) {
  const [mode, setMode] = useState<AddMode>('detect')
  const detect = useDetectMode(stagedHosts)
  const paste = usePasteMode(stagedHosts)

  // Each mode keeps its own input and result; only the visible one shows and counts for Add.
  const inDetect = mode === 'detect'
  const view = inDetect ? detect.view : paste.view
  const canAdd = view.ready && view.rows.some((row) => isChecked(row, view.selected))

  const handleAdd = () => {
    onAdd(entriesFor(view.rows, view.selected, stagedHosts))
    return Promise.resolve()
  }

  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add Hosts"
      isDirty={false}
      closeOnEscape
      saveLabel="Add"
      saveDisabled={!canAdd}
      onSave={handleAdd}
      className="max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl
          options={MODE_OPTIONS}
          value={mode}
          onChange={setMode}
          aria-label="Add hosts by"
          className="w-fit"
        />
        {inDetect ? (
          <DetectFields
            host={detect.host}
            port={detect.port}
            busy={detect.busy}
            target={detect.target}
            onHostChange={detect.changeHost}
            onPortChange={detect.changePort}
            onDetect={detect.run}
          />
        ) : (
          <div className="relative h-44 overflow-hidden rounded-md border">
            <FillCodeMirror
              value={paste.text}
              onChange={paste.setText}
              extensions={PASTE_EXTENSIONS}
              basicSetup={PASTE_SETUP}
              autoFocus
            />
          </div>
        )}
        {view.rows.length > 0 && (
          <div className="flex max-h-60 flex-col">
            <HostKeyPreviewTable
              key={mode}
              rows={view.rows}
              showHost={!inDetect}
              selected={view.selected}
              onSelectedChange={view.onSelectedChange}
            />
          </div>
        )}
        {/* The negative margin cancels the column gap while the region is empty. */}
        <div
          aria-live="polite"
          className={view.errorLines.length > 0 ? '-mt-2 flex flex-col gap-1' : '-mt-4'}
        >
          {view.errorLines.map((line) => (
            <p key={line} className="text-sm text-error">
              {line}
            </p>
          ))}
        </div>
      </div>
    </EditDialog>
  )
}

export function AddHostsDialog(props: Readonly<AddHostsDialogProps>) {
  // Each opening starts a new session, so the dialog opens fresh in Detect from host.
  const [session, setSession] = useState(0)
  const [lastOpen, setLastOpen] = useState(props.open)
  if (props.open !== lastOpen) {
    setLastOpen(props.open)
    if (props.open) setSession((count) => count + 1)
  }
  return <AddHostsSession key={session} {...props} />
}
