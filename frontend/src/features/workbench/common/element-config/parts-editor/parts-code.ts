/**
 * Parts Code-view codec: the Code view is a JSON array of part
 * objects - {kind, name, value} for text, {kind, name, source} for file. A
 * text-part value is a quoted string (literal) or a bare {{ expr }} (unquoted
 * expression, sharing the string-map grammar); name / source stay quoted
 * strings only. Structure is fixed: unknown keys / kinds / bad fields reject
 * with exact messages; duplicate part names are legal. Order is preserved and
 * expression-ness returns as a sidecar list of emitted-array indices.
 */

import { EXPR_SENTINEL, extractBareExpressions } from '@/lib/variable-validation'
import type { Part } from './parts-editor-sheet'

const TEXT_KEYS = new Set(['kind', 'name', 'value'])
const FILE_KEYS = new Set(['kind', 'name', 'source'])
const EMPTY_INDICES: ReadonlySet<number> = new Set()

function isSentinel(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(EXPR_SENTINEL)
}

function resolveExpr(sentinel: string, exprs: string[]): string {
  return exprs[Number(sentinel.slice(EXPR_SENTINEL.length))]
}

function nonStringNameMessage(index: number, field: string): string {
  return `Part #${index}: "${field}" must be a string`
}

function badValueMessage(index: number): string {
  return `Part #${index}: "value" must be a quoted string or a {{ expression }}`
}

/** Serialize one part: a text expression value renders as a bare {{ expr }},
 *  every other field as a JSON-quoted string. */
function serializePart(part: Part, isExpr: boolean): string {
  const head = `{"kind":${JSON.stringify(part.kind)},"name":${JSON.stringify(part.name)},`
  if (part.kind === 'file') return `${head}"source":${JSON.stringify(part.source)}}`
  const valueToken = isExpr ? `{{ ${part.value} }}` : JSON.stringify(part.value)
  return `${head}"value":${valueToken}}`
}

/** Serialize parts to Code JSON with a fixed key order; the given text-part
 *  indices render their value as a bare {{ expression }}. */
export function serializePartsForCode(
  parts: Part[],
  exprIndices: ReadonlySet<number> = EMPTY_INDICES,
): string {
  if (parts.length === 0) return '[]'
  const body = parts.map((part, index) => `  ${serializePart(part, exprIndices.has(index))}`).join(',\n')
  return `[\n${body}\n]`
}

/** Structural checks for one part of a known kind, in strip order: unknown
 *  keys, bad fields (name / source must be quoted strings; a text value may be
 *  a literal or a bare expression), missing required fields. */
function partStructureErrors(
  entry: Record<string, unknown>,
  kind: 'text' | 'file',
  index: number,
): string[] {
  const errors: string[] = []
  const allowed = kind === 'text' ? TEXT_KEYS : FILE_KEYS
  for (const key of Object.keys(entry)) {
    if (!allowed.has(key)) errors.push(`Part #${index}: unknown key "${key}"`)
  }
  const contentField = kind === 'text' ? 'value' : 'source'
  // name and a file source must be plain quoted strings (a bare {{ }} = sentinel rejects).
  const nameLike = kind === 'text' ? ['name'] : ['name', 'source']
  for (const field of nameLike) {
    const raw = entry[field]
    if (raw !== undefined && (typeof raw !== 'string' || isSentinel(raw))) {
      errors.push(nonStringNameMessage(index, field))
    }
  }
  // a text value may be a literal string OR a bare {{ }} (sentinel string); else rejects.
  if (kind === 'text' && entry.value !== undefined && typeof entry.value !== 'string') {
    errors.push(badValueMessage(index))
  }
  if (entry.name === undefined || entry[contentField] === undefined) {
    errors.push(
      kind === 'text'
        ? `Part #${index}: text parts need "name" and "value"`
        : `Part #${index}: file parts need "name" and "source"`,
    )
  }
  return errors
}

function collectPart(
  entry: Record<string, unknown>,
  index: number,
  exprs: string[],
  errors: string[],
): { part: Part; isExpr: boolean } | null {
  const kind = entry.kind
  if (kind !== 'text' && kind !== 'file') {
    errors.push(`Part #${index}: kind must be "text" or "file"`)
    return null
  }
  const structureErrors = partStructureErrors(entry, kind, index)
  errors.push(...structureErrors)
  if (structureErrors.length > 0) return null
  if (kind === 'file') {
    return { part: { kind, name: entry.name as string, source: entry.source as string }, isExpr: false }
  }
  if (isSentinel(entry.value)) {
    return { part: { kind, name: entry.name as string, value: resolveExpr(entry.value, exprs) }, isExpr: true }
  }
  return { part: { kind, name: entry.name as string, value: entry.value as string }, isExpr: false }
}

/** Parse parts Code JSON; structural problems collect exact per-part errors and
 *  the offending parts are dropped. Bare {{ }} text values become expression
 *  parts whose emitted-array index is returned in exprIndices. Throws on invalid
 *  JSON (the caller renders the syntax error). */
export function parsePartsCode(text: string): { parts: Part[]; exprIndices: number[]; errors: string[] } {
  const { transformed, exprs } = extractBareExpressions(text)
  const parsed: unknown = JSON.parse(transformed)
  const errors: string[] = []
  if (!Array.isArray(parsed)) {
    return { parts: [], exprIndices: [], errors: ['Parts must be a JSON array of part objects'] }
  }
  const parts: Part[] = []
  const exprIndices: number[] = []
  parsed.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`Part #${index}: must be an object`)
      return
    }
    const result = collectPart(entry as Record<string, unknown>, index, exprs, errors)
    if (result) {
      if (result.isExpr) exprIndices.push(parts.length)
      parts.push(result.part)
    }
  })
  return { parts, exprIndices, errors }
}
