/**
 * The node fields a block's config Save writes, for the save itself and for a run of the unsaved config.
 */

import type { SaveData } from '@/features/workbench/common/element-config/types'
import { getInputParams } from '@/features/workbench/lib/node-parameters'
import { PYTHON_KEYWORD_SET } from '@/features/workbench/lib/python-builtins'
import { isSealedSecret, MASK_PLACEHOLDER } from '@/lib/secret-envelope'
import { isTableShape } from '@/lib/variable-table-model'
import { numberValueProblem, sameNumber } from '@/lib/number-rule'

export interface SavedBlockFields {
  data: Pick<
    SaveData,
    | 'description'
    | 'version'
    | 'expressionFields'
    | 'templateFields'
    | 'variableExpressionKeys'
    | 'variableTemplateKeys'
    | 'variableTypes'
    | 'variableElementTypes'
    | 'elementTypes'
  >
  config: Pick<SaveData, 'values' | 'outputBindings' | 'profileBindings' | 'variableSecretKeys' | 'outputSecretFields'> & {
    unmasked_secret_fields: SaveData['unmaskedSecretFields']
    secret_masking: SaveData['secretMasking']
  }
}

export function savedBlockFields(saveData: SaveData): SavedBlockFields {
  return {
    data: {
      description: saveData.description,
      version: saveData.version,
      expressionFields: saveData.expressionFields,
      templateFields: saveData.templateFields,
      variableExpressionKeys: saveData.variableExpressionKeys,
      variableTemplateKeys: saveData.variableTemplateKeys,
      variableTypes: saveData.variableTypes,
      variableElementTypes: saveData.variableElementTypes,
      elementTypes: saveData.elementTypes,
    },
    config: {
      values: saveData.values,
      outputBindings: saveData.outputBindings,
      profileBindings: saveData.profileBindings,
      variableSecretKeys: saveData.variableSecretKeys,
      outputSecretFields: saveData.outputSecretFields,
      // Snake_case: the backend runtime reads these two config keys.
      unmasked_secret_fields: saveData.unmaskedSecretFields,
      secret_masking: saveData.secretMasking,
    },
  }
}

// ---------------------------------------------------------------------------
// Name sites: every place a saved block names a variable (VMGR-105)
// ---------------------------------------------------------------------------

/** A saved block as the canvas holds it. */
export interface NamedBlock {
  data: object
}

/** Maps a variable name to the name it should read as. */
export type NameRename = (name: string) => string

type SiteKind = 'expression' | 'template'
type Rec = Record<string, unknown>

interface TextSite {
  path: string[]
  kind: SiteKind
  /** A name the site binds for itself, never a variable (a filter condition's `_cell`). */
  local?: string
}

interface NameSpan {
  name: string
  start: number
  end: number
}

const SETTER_ELEMENT = 'variable-setter'
const CONDITION_LIST_KEYS = ['assertions', 'conditions'] as const
const FILTER_CELL = '_cell'
const STRING_PREFIXES = new Set(['r', 'u', 'b', 'f', 'br', 'rb', 'fr', 'rf'])
const IDENT_START = /[A-Za-z_]/
const IDENT_PART = /\w/
const DIGIT = /\d/
const SPACE = /\s/

function isQuote(ch: string): boolean {
  return ch === '"' || ch === "'"
}

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function getIn(root: unknown, path: string[]): unknown {
  let current: unknown = root
  for (const key of path) {
    if (Array.isArray(current)) current = current[Number(key)]
    else if (isRec(current)) current = current[key]
    else return undefined
  }
  return current
}

function setIn(root: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) return value
  const [head, ...rest] = path
  if (Array.isArray(root)) {
    const copy = root.slice()
    copy[Number(head)] = setIn(root[Number(head)], rest, value)
    return copy
  }
  const rec = root as Rec
  return { ...rec, [head]: setIn(rec[head], rest, value) }
}

// --- Expression scanner: the names an expression reads, with their offsets ---

interface ScanState {
  source: string
  base: number
  spans: NameSpan[]
  bound: Set<string>
}

/** Index of the closing quote run, or the end of the source when unterminated. */
function skipQuoted(source: string, start: number, onPlaceholder?: (open: number) => number): number {
  const quote = source[start]
  const delim = source.startsWith(quote.repeat(3), start) ? quote.repeat(3) : quote
  let i = start + delim.length
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2
    } else if (source.startsWith(delim, i)) {
      return i + delim.length
    } else if (onPlaceholder && source[i] === '{') {
      i = source[i + 1] === '{' ? i + 2 : onPlaceholder(i)
    } else {
      i += 1
    }
  }
  return i
}

const OPENERS = new Set(['(', '[', '{'])
const CLOSERS = new Set([')', ']', '}'])

/** Where an f-string placeholder's expression ends (before `!r`, `:spec`) and where the placeholder closes. */
function placeholderBounds(source: string, open: number): { exprEnd: number; close: number } {
  let depth = 0
  let exprEnd = -1
  let i = open + 1
  while (i < source.length) {
    const ch = source[i]
    if (isQuote(ch)) {
      i = skipQuoted(source, i)
      continue
    }
    if (OPENERS.has(ch)) depth += 1
    else if (depth > 0 && CLOSERS.has(ch)) depth -= 1
    else if (ch === '}') return { exprEnd: exprEnd === -1 ? i : exprEnd, close: i }
    else if (depth === 0 && exprEnd === -1 && (ch === ':' || (ch === '!' && source[i + 1] !== '='))) exprEnd = i
    i += 1
  }
  return { exprEnd: exprEnd === -1 ? i : exprEnd, close: i }
}

function scanString(state: ScanState, quoteAt: number, prefix: string): number {
  if (!prefix.includes('f')) return skipQuoted(state.source, quoteAt)
  return skipQuoted(state.source, quoteAt, (open) => {
    const { exprEnd, close } = placeholderBounds(state.source, open)
    scanExpression({ ...state, source: state.source.slice(open + 1, exprEnd), base: state.base + open + 1 })
    return close + 1
  })
}

function skipNumber(source: string, start: number): number {
  let i = start + 1
  while (i < source.length && (IDENT_PART.test(source[i]) || source[i] === '.')) i += 1
  return i
}

/** A name followed by a single `=` is a keyword argument, not a read. */
function isKeywordArgument(source: string, end: number): boolean {
  let i = end
  while (i < source.length && SPACE.test(source[i])) i += 1
  return source[i] === '=' && source[i + 1] !== '='
}

function previousSignificant(source: string, start: number): string {
  let i = start - 1
  while (i >= 0 && SPACE.test(source[i])) i -= 1
  return i >= 0 ? source[i] : ''
}

type Binding = 'for' | 'lambda' | null

function scanWord(state: ScanState, start: number, end: number, binding: Binding): Binding {
  const word = state.source.slice(start, end)
  if (PYTHON_KEYWORD_SET.has(word)) {
    if (word === 'for' || word === 'lambda') return word
    return word === 'in' && binding === 'for' ? null : binding
  }
  if (binding) {
    state.bound.add(word)
  } else if (previousSignificant(state.source, start) !== '.' && !isKeywordArgument(state.source, end)) {
    state.spans.push({ name: word, start: state.base + start, end: state.base + end })
  }
  return binding
}

function identifierEnd(source: string, start: number): number {
  let end = start + 1
  while (end < source.length && IDENT_PART.test(source[end])) end += 1
  return end
}

/** A word, or a prefixed string literal such as `f"..."`: where scanning resumes and the binding after it. */
function scanIdentifier(state: ScanState, start: number, binding: Binding): { next: number; binding: Binding } {
  const { source } = state
  const end = identifierEnd(source, start)
  const prefix = source.slice(start, end).toLowerCase()
  if (isQuote(source[end]) && STRING_PREFIXES.has(prefix)) {
    return { next: scanString(state, end, prefix), binding }
  }
  return { next: end, binding: scanWord(state, start, end, binding) }
}

function scanExpression(state: ScanState): void {
  const { source } = state
  let binding: Binding = null
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (isQuote(ch)) {
      i = scanString(state, i, '')
    } else if (DIGIT.test(ch)) {
      i = skipNumber(source, i)
    } else if (IDENT_START.test(ch)) {
      const scanned = scanIdentifier(state, i, binding)
      i = scanned.next
      binding = scanned.binding
    } else {
      if (ch === ':' && binding === 'lambda') binding = null
      i += 1
    }
  }
}

/** Free names an expression reads; names bound by a comprehension or lambda are left out. */
function expressionSpans(source: string, base = 0): NameSpan[] {
  const state: ScanState = { source, base, spans: [], bound: new Set() }
  scanExpression(state)
  return state.spans.filter((span) => !state.bound.has(span.name))
}

/** Only the text inside each {{ }} marker names a variable. */
function templateSpans(value: string): NameSpan[] {
  const spans: NameSpan[] = []
  let from = 0
  while (from < value.length) {
    const open = value.indexOf('{{', from)
    if (open === -1) break
    const close = value.indexOf('}}', open + 2)
    if (close === -1) break
    spans.push(...expressionSpans(value.slice(open + 2, close), open + 2))
    from = close + 2
  }
  return spans
}

function textSpans(text: string, kind: SiteKind): NameSpan[] {
  return kind === 'template' ? templateSpans(text) : expressionSpans(text)
}

/** The names an expression or template text reads. */
export function namesInText(text: string, kind: SiteKind): string[] {
  return textSpans(text, kind).map((span) => span.name)
}

/** The text with every name it reads passed through `rename`; string literals and attributes stay. */
export function renameNamesInText(text: string, kind: SiteKind, rename: NameRename): string {
  let out = ''
  let from = 0
  for (const span of textSpans(text, kind)) {
    const next = rename(span.name)
    if (next === span.name) continue
    out += text.slice(from, span.start) + next
    from = span.end
  }
  return from === 0 ? text : out + text.slice(from)
}

// --- Site enumeration ---

function fieldPath(field: string, values: Rec): string[] {
  return Object.hasOwn(values, field) ? [field] : field.split('.')
}

function referenceFields(elementType: unknown): string[] {
  if (typeof elementType !== 'string') return []
  return (getInputParams(elementType) ?? []).filter((p) => p.variableRef).map((p) => p.name)
}

function conditionSites(items: unknown, path: string[], sites: TextSite[], local?: string): void {
  if (!Array.isArray(items)) return
  const site = (at: string[]): TextSite => ({ path: at, kind: 'expression', local })
  items.forEach((item, index) => {
    if (!isRec(item)) return
    const at = [...path, String(index)]
    if (item.type === 'literal') {
      sites.push(site([...at, 'variable']))
      if (item.reference_is_expression) sites.push(site([...at, 'reference_value']))
    } else if (item.type === 'expression') {
      sites.push(site([...at, 'expression']))
    } else if (item.type === 'group') {
      conditionSites(item.items, [...at, 'items'], sites, local)
    }
  })
}

/** CSV / Excel filter conditions read like check rows, the cell they test bound as `_cell`. */
function filterSites(filters: unknown, path: string[], sites: TextSite[]): void {
  if (!Array.isArray(filters)) return
  filters.forEach((filter, index) => {
    conditionSites(isRec(filter) ? filter.conditions : undefined, [...path, String(index), 'conditions'], sites, FILTER_CELL)
  })
}

function valueSites(data: Rec, values: Rec, sites: TextSite[]): void {
  const valuesPath = ['config', 'values']
  for (const field of stringList(data.expressionFields)) {
    sites.push({ path: [...valuesPath, ...fieldPath(field, values)], kind: 'expression' })
  }
  for (const field of stringList(data.templateFields)) {
    sites.push({ path: [...valuesPath, ...fieldPath(field, values)], kind: 'template' })
  }
  for (const field of referenceFields(data.elementType)) {
    sites.push({ path: [...valuesPath, field], kind: 'expression' })
  }
  for (const key of CONDITION_LIST_KEYS) conditionSites(values[key], [...valuesPath, key], sites)
  filterSites(values.filters, [...valuesPath, 'filters'], sites)
  if (Array.isArray(values.branches)) {
    values.branches.forEach((branch, index) => {
      conditionSites(isRec(branch) ? branch.conditions : undefined, [...valuesPath, 'branches', String(index), 'conditions'], sites)
    })
  }
  if (data.elementType === SETTER_ELEMENT) {
    const setterPath = [...valuesPath, 'variables']
    for (const key of stringList(data.variableExpressionKeys)) sites.push({ path: [...setterPath, key], kind: 'expression' })
    for (const key of stringList(data.variableTemplateKeys)) sites.push({ path: [...setterPath, key], kind: 'template' })
  }
}

/** Every text in a saved block that reads variables, as a path from the block data. */
function readSites(data: Rec): TextSite[] {
  const sites: TextSite[] = []
  const config = isRec(data.config) ? data.config : {}
  if (isRec(config.values)) valueSites(data, config.values, sites)
  return sites
}

function siteText(data: Rec, site: TextSite): string | null {
  const value = getIn(data, site.path)
  return typeof value === 'string' && !isSealedSecret(value) ? value : null
}

/** The rename a site applies: its own bound name stays as it is. */
function siteRename(site: TextSite, rename: NameRename): NameRename {
  const { local } = site
  return local === undefined ? rename : (name) => (name === local ? name : rename(name))
}

function outputBindingsOf(data: Rec): Rec | null {
  const config = data.config
  return isRec(config) && isRec(config.outputBindings) ? config.outputBindings : null
}

function setterVariablesOf(data: Rec): Rec | null {
  if (data.elementType !== SETTER_ELEMENT || !isRec(data.config)) return null
  const values = data.config.values
  return isRec(values) && isRec(values.variables) ? values.variables : null
}

/** The names a saved block reads: settings (Function Block inputs included), condition and filter rows, Setter rows. */
export function blockReads(block: NamedBlock): Set<string> {
  const data = block.data as Rec
  const names = new Set<string>()
  for (const site of readSites(data)) {
    const text = siteText(data, site)
    if (text === null) continue
    for (const name of namesInText(text, site.kind)) if (name !== site.local) names.add(name)
  }
  return names
}

/** The names a saved block writes: output binding targets and Variable Setter targets. */
export function blockWrites(block: NamedBlock): Set<string> {
  const data = block.data as Rec
  const names = new Set<string>()
  for (const target of Object.values(outputBindingsOf(data) ?? {})) {
    if (typeof target === 'string' && target) names.add(target)
  }
  for (const target of Object.keys(setterVariablesOf(data) ?? {})) names.add(target)
  return names
}

// --- Rewrite ---

function renameKeys<T>(record: Record<string, T>, rename: NameRename): Record<string, T> {
  const next: Record<string, T> = {}
  for (const [key, value] of Object.entries(record)) next[rename(key)] = value
  return next
}

function renameEach(list: unknown, rename: NameRename): string[] {
  return stringList(list).map(rename)
}

/** Output binding targets, plus the key of a parser query alias bound to itself. */
function rewriteOutputBindings(data: Rec, rename: NameRename): Rec {
  const bindings = outputBindingsOf(data)
  if (!bindings) return data
  const config = data.config as Rec
  const values = isRec(config.values) ? config.values : {}
  const queries = isRec(values.queries) ? values.queries : {}
  const renamedAliases = Object.keys(queries).some((alias) => rename(alias) !== alias)
  const nextBindings: Rec = {}
  let changed = false
  for (const [key, target] of Object.entries(bindings)) {
    const nextKey = Object.hasOwn(queries, key) ? rename(key) : key
    const nextTarget = typeof target === 'string' && target ? rename(target) : target
    changed ||= nextKey !== key || nextTarget !== target
    nextBindings[nextKey] = nextTarget
  }
  if (!changed && !renamedAliases) return data
  let nextConfig: Rec = { ...config, outputBindings: nextBindings }
  if (renamedAliases) {
    const types = isRec(values.query_output_types) ? values.query_output_types : {}
    nextConfig = {
      ...nextConfig,
      values: { ...values, queries: renameKeys(queries, rename), query_output_types: renameKeys(types, rename) },
    }
  }
  return { ...data, config: nextConfig }
}

/** A renamed Variable Setter target moves across its value map, kind keys, types and secret keys. */
function rewriteSetterTargets(data: Rec, rename: NameRename): Rec {
  const variables = setterVariablesOf(data)
  if (!variables || !Object.keys(variables).some((key) => rename(key) !== key)) return data
  const config = data.config as Rec
  const values = config.values as Rec
  const nextConfig: Rec = { ...config, values: { ...values, variables: renameKeys(variables, rename) } }
  if (Array.isArray(config.variableSecretKeys)) nextConfig.variableSecretKeys = renameEach(config.variableSecretKeys, rename)
  const next: Rec = {
    ...data,
    config: nextConfig,
    variableExpressionKeys: renameEach(data.variableExpressionKeys, rename),
    variableTemplateKeys: renameEach(data.variableTemplateKeys, rename),
    variableTypes: renameKeys(isRec(data.variableTypes) ? data.variableTypes : {}, rename),
  }
  if (isRec(data.variableElementTypes)) next.variableElementTypes = renameKeys(data.variableElementTypes, rename)
  return next
}

/** A new block with every name site passed through `rename`; the given block is left unchanged. */
export function rewriteBlockNames<T extends NamedBlock>(block: T, rename: NameRename): T {
  let data = block.data as Rec
  for (const site of readSites(data)) {
    const text = siteText(data, site)
    if (text === null) continue
    const next = renameNamesInText(text, site.kind, siteRename(site, rename))
    if (next !== text) data = setIn(data, site.path, next) as Rec
  }
  data = rewriteSetterTargets(rewriteOutputBindings(data, rename), rename)
  return data === block.data ? block : { ...block, data }
}

// ---------------------------------------------------------------------------
// Field rewrites: a declared input or output renamed, dropped or added (REQ-3.1.2.1, FNCFG-9)
// ---------------------------------------------------------------------------

/** A declared input as the field rewrites read it; an input with no type skips the fit check. */
export interface BlockFieldInput {
  name: string
  type?: string
  enumValues?: readonly unknown[]
  default?: unknown
  required?: boolean
}

/** The inputs and outputs a Block's fields must match. */
export interface BlockFieldContract {
  inputs: readonly BlockFieldInput[]
  outputs: readonly { name: string }[]
}

/** True when a flag (whole `name` or a dotted entry `name.<key>`) belongs to the field `name`. */
function flagOf(flag: string, name: string): boolean {
  return flag === name || flag.startsWith(`${name}.`)
}

function fieldOfFlag(flag: string): string {
  const dot = flag.indexOf('.')
  return dot === -1 ? flag : flag.slice(0, dot)
}

/** `list` with every element passed through `next`; the same list when none changes. */
function mapList(list: unknown, next: (item: string) => string | null): string[] | undefined {
  if (!Array.isArray(list)) return undefined
  const kept = stringList(list).flatMap((item) => {
    const mapped = next(item)
    return mapped === null ? [] : [mapped]
  })
  return kept.length === list.length && kept.every((item, index) => item === list[index]) ? (list as string[]) : kept
}

/** `record` with each key passed through `next`, entry order kept; the same record when no key changes. */
function mapKeys(record: unknown, next: (key: string) => string | null): Rec | undefined {
  if (!isRec(record)) return undefined
  const out: Rec = {}
  let changed = false
  for (const [key, value] of Object.entries(record)) {
    const mapped = next(key)
    changed ||= mapped !== key
    if (mapped !== null) out[mapped] = value
  }
  return changed ? out : record
}

interface FieldEdits {
  values: (key: string) => string | null
  flags: (flag: string) => string | null
  outputs: (key: string) => string | null
}

/** `target` with each listed key set to `edit(target[key])`; the same object when no key changes. */
function editKeys(target: Rec, keys: readonly string[], edit: (key: string, value: unknown) => unknown): Rec {
  let next: Rec | undefined
  for (const key of keys) {
    const after = edit(key, target[key])
    if (after !== target[key]) {
      next ??= { ...target }
      next[key] = after
    }
  }
  return next ?? target
}

/** One pass over every place a Block keeps a field: values, whole and dotted flags, item types, outputs. */
function editFields<T extends object>(block: T, edits: FieldEdits): T {
  const data = block as Rec
  let next = editKeys(data, ['expressionFields', 'templateFields', 'elementTypes'], (key, value) =>
    key === 'elementTypes' ? mapKeys(value, edits.values) : mapList(value, edits.flags),
  )
  if (isRec(data.config)) {
    const config = editKeys(data.config, ['values', 'outputBindings', 'outputSecretFields'], (key, value) => {
      if (key === 'values') return mapKeys(value, edits.values)
      return key === 'outputBindings' ? mapKeys(value, edits.outputs) : mapList(value, edits.outputs)
    })
    if (config !== data.config) next = { ...next, config }
  }
  return next === data ? block : (next as T)
}

/** A Block field renamed with everything it carries; names are unique across a Function's inputs and outputs. */
export function renameBlockField<T extends object>(block: T, oldName: string, newName: string): T {
  if (oldName === newName) return block
  const rename = (key: string) => (key === oldName ? newName : key)
  return editFields(block, {
    values: rename,
    flags: (flag) => (flagOf(flag, oldName) ? newName + flag.slice(oldName.length) : flag),
    outputs: rename,
  })
}

const FIT_CHECKS: Record<string, (value: unknown) => boolean> = {
  string: (value) => typeof value === 'string',
  integer: (value) => numberValueProblem(value, 'integer') === null,
  float: (value) => numberValueProblem(value, 'float') === null,
  boolean: (value) => typeof value === 'boolean',
  array: Array.isArray,
  map: isRec,
  table: isTableShape,
}

function sameAllowedValue(item: unknown, value: unknown, type: string | undefined): boolean {
  if (type !== 'integer' && type !== 'float') return item === value
  // The value already fits its number type; an allowed value that does not is never picked.
  return numberValueProblem(item, type) === null && sameNumber(item as number | string, value as number | string)
}

/** True when a stored literal still fits its input: null and an untyped input always do (FNCFG-9). */
function literalFits(value: unknown, input: BlockFieldInput): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && (isSealedSecret(value) || value === MASK_PLACEHOLDER)) return true
  const fits = input.type === undefined ? undefined : FIT_CHECKS[input.type]
  if (fits && !fits(value)) return false
  if (input.enumValues === undefined) return true
  return input.enumValues.some((item) => sameAllowedValue(item, value, input.type))
}

/** Drop the fields a contract no longer declares and the literals that no longer fit, never switching a value. */
export function dropBlockFields<T extends object>(block: T, contract: BlockFieldContract): T {
  const data = block as Rec
  const inputs = new Map(contract.inputs.map((input) => [input.name, input]))
  const outputNames = new Set(contract.outputs.map((output) => output.name))
  const values = isRec(data.config) && isRec(data.config.values) ? data.config.values : {}
  const written = new Set([...stringList(data.expressionFields), ...stringList(data.templateFields)])
  const dropped = new Set<string>()
  for (const name of new Set([...Object.keys(values), ...Object.keys(isRec(data.elementTypes) ? data.elementTypes : {})])) {
    const input = inputs.get(name)
    // An expression or template stays as written: the save check reads it.
    if (input === undefined || (!written.has(name) && !literalFits(values[name], input))) dropped.add(name)
  }
  const keepField = (name: string) => inputs.has(name) && !dropped.has(name)
  return editFields(block, {
    values: (key) => (keepField(key) ? key : null),
    flags: (flag) => {
      const field = inputs.has(flag) ? flag : fieldOfFlag(flag)
      return keepField(field) ? flag : null
    },
    outputs: (key) => (outputNames.has(key) ? key : null),
  })
}

function isChoiceInput(input: BlockFieldInput): boolean {
  return input.enumValues !== undefined || input.type === 'boolean'
}

/** The default of each choice-list and true / false input that declares one; the first of two same-named rows wins. */
export function choiceDefaults(inputs: readonly BlockFieldInput[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const input of inputs) {
    if (!isChoiceInput(input) || input.default === null || input.default === undefined) continue
    if (!Object.hasOwn(values, input.name)) values[input.name] = input.default
  }
  return values
}

/** Write the default of each choice-list or true / false input `nextInputs` adds, never over a held value (REQ-3.1.2.10). */
export function writeNewChoiceInputs<T extends object>(
  block: T,
  previousInputs: readonly BlockFieldInput[],
  nextInputs: readonly BlockFieldInput[],
): T {
  const data = block as Rec
  const config = isRec(data.config) ? data.config : {}
  const values = isRec(config.values) ? config.values : {}
  const previous = new Set(previousInputs.map((input) => input.name))
  const added = Object.entries(choiceDefaults(nextInputs.filter((input) => !previous.has(input.name)))).filter(
    ([name]) => !Object.hasOwn(values, name),
  )
  if (added.length === 0) return block
  return { ...data, config: { ...config, values: { ...values, ...Object.fromEntries(added) } } } as T
}
