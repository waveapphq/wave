import { randomBytes } from 'node:crypto'
import type { LogEntry } from '../../helpers/log-reader'

const TOKEN_PLACEHOLDER = '__TOKEN__'

// A console row's copy text: "HH:MM:SS.mmm ZONE LEVEL [source] message".
const COPY_TEXT_ROW = /^\d{2}:\d{2}:\d{2}\.\d{3} \S+ (DEBUG|INFO|WARN|ERROR|FATAL) +\[(.*?)\] ([\s\S]*)$/

const ALIVE_OR_GONE =
  `if kill -0 "$pid" 2>/dev/null && [ "$(awk '{print $3}' /proc/$pid/stat)" != Z ]; ` +
  'then printf alive; else printf gone; fi'

function pidFile(n: number, name: string): string {
  return `f="$WAVE_ARTIFACTS_DIR/sh-${n}-${TOKEN_PLACEHOLDER}/${name}"`
}

function guardedProbe(n: number, name: string): string {
  return `${pidFile(n, name)}; if [ -s "$f" ]; then pid=$(cat "$f"); ${ALIVE_OR_GONE}; else printf missing; fi`
}

/** A fresh per-run token: "sh" plus 8 lowercase hex characters. */
export function newToken(): string {
  return `sh${randomBytes(4).toString('hex')}`
}

/** A deep copy of the fixture with every __TOKEN__ in every string (keys included) replaced. */
export function withToken<T>(fixture: T, token: string): T {
  return JSON.parse(JSON.stringify(fixture).split(TOKEN_PLACEHOLDER).join(token)) as T
}

/** The tree probe for the pid file `name` (for example `bg.pid`) under sh-<n>-__TOKEN__: prints alive, gone or missing. */
export function treeProbeCommand(n: number, name: string): string {
  return `${pidFile(n, name)}; [ -s "$f" ] || { printf missing; exit 0; }; pid=$(cat "$f"); ${ALIVE_OR_GONE}`
}

/** The two-file tree probe: prints "<a result> <b result>", each half guarded so both always run. */
export function pairTreeProbeCommand(n: number, a: string, b: string): string {
  return `${guardedProbe(n, a)}; printf ' '; ${guardedProbe(n, b)}`
}

/** The block type a row's source names, ahead of the block Name the source may carry after it. */
export function sourcePlugin(source: string): string {
  return source.split(' : ')[0]
}

// Catalog names that count as the type's own name beside the palette name (EXEC-25).
const CATALOG_NAMES: Record<string, string> = {
  HTTP: 'HTTP Client',
  CSV: 'CSV Parser',
  Excel: 'Excel Parser',
  JSON: 'JSON Parser',
  XML: 'XML Parser',
  'If / Else': 'If/Else',
  Switch: 'Switch/Case',
  'Try / Catch': 'Try/Catch/Finally',
  'Var Setter': 'Variable Setter',
}

/** The source a block writes: its type's palette name, then its Name when that is not the type's own (EXEC-25). */
export function blockSource(type: string, name = ''): string {
  const typed = name.trim()
  return typed === '' || typed === type || typed === CATALOG_NAMES[type] ? type : `${type} : ${typed}`
}

/** Console entries read from each row's copy text, which keeps the full source the source column cuts to its width. */
export function consoleEntriesFromCopy(copyTexts: string[]): LogEntry[] {
  return copyTexts.map((text) => {
    const row = COPY_TEXT_ROW.exec(text)
    return row
      ? { level: row[1], source: row[2], message: row[3].trim() }
      : { level: '', source: '', message: text }
  })
}

/** The stream with one trailing newline removed, if it has one. */
export function stripOneNewline(s: string): string {
  return s.endsWith('\n') ? s.slice(0, -1) : s
}
