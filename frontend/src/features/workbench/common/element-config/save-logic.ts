/**
 * Save logic for ElementConfigModal
 *
 * Pure functions for building save data and validating output bindings.
 * Extracted from useConfigModalState to keep the hook under 300 lines.
 */

import { OUTPUT_TYPE_COMPAT } from '@/features/workbench/lib/node-parameters/types'
import { describeBindingRejection } from '@/features/workbench/lib/validation/output-binding-rules'
import { isParameterVisible, matchesCondition, type Parameter as TableParameter } from './parameters/parameter-table-types'
import { dropUnusedCompareTo, type AssertionItem } from '../config/assertion-builder/types'
import { conditionListsOf } from '@/features/workbench/lib/validation/condition-checks'
import type { SecretMaskingSetting } from '@/features/workbench/lib/node-parameters/secret-reveal'
import type { ProfileBinding } from './dialogs/profile-binding-modal'
import type { Parameter, SaveData, EnrichedVariable } from './types'
import type { ElementTypes } from '@/lib/variable-validation'
import { wireNumber, type NumberType } from '@/lib/number-rule'
import { canonicalEqual } from '@/features/workbench/lib/canonical-workflow'

export interface SaveContext {
  elementId: string
  /** The Block type: it decides the condition lists, the lanes and the Setter rows the Save shapes. */
  elementType: string
  selectedVersion: string
  values: Record<string, unknown>
  outputBindings: Record<string, string>
  outputParameters: { name: string; type: string; required: false }[]
  versionParameters: Parameter[]
  name: string
  description: string
  profileBindings: ProfileBinding[]
  expressionFields: string[]
  templateFields: string[]
  outputSecretFields: string[]
  /** The schema seed the Secret boxes show while the Block stores no list; Save writes the list only once it differs. */
  seededOutputSecretFields?: string[]
  unmaskedSecretFields?: string[]
  secretMasking?: SecretMaskingSetting
  variables: EnrichedVariable[]
  /** Variable Setter rows marked secret, `variables.<row>` (REQ-3.4.1.14). */
  secretFields?: string[]
  /** Variable Setter: the type picked for each row; a row of an undeclared target is typed by it. */
  newTargetTypes?: Record<string, string>
  /** Typed block settings' element types, a Setter list or map row's at `variables.<row>` (REQ-3.1.3.19). */
  settingElementTypes?: Record<string, ElementTypes>
  /** The block runs on the execution host, where a remote-locked row shows no stored choice (HTTP-13). */
  runsOnRemoteHost?: boolean
}

interface SaveResult {
  data: SaveData | null
  errors: Record<string, string>
}

// ============================================================================
// Validation helpers
// ============================================================================

/** Validate output binding name + type compatibility */
export function validateOutputBindings(
  outputParameters: SaveContext['outputParameters'],
  outputBindings: Record<string, string>,
  variables: EnrichedVariable[],
): Record<string, string> {
  const varsByName = new Map(variables.map((v) => [v.name, v]))
  const errors: Record<string, string> = {}
  for (const out of outputParameters) {
    const varName = outputBindings[out.name]
    if (!varName) continue
    // Reject namespace references and invalid identifiers up front - these
    // can never be valid output targets regardless of type.
    const rejection = describeBindingRejection(varName)
    if (rejection) {
      errors[out.name] = rejection
      continue
    }
    const variable = varsByName.get(varName)
    if (!variable) continue
    const compat = OUTPUT_TYPE_COMPAT[out.type]
    if (compat && compat.size > 0 && !compat.has(variable.type)) {
      errors[out.name] = `Type mismatch: "${varName}" is ${variable.type}, expected ${[...compat].join(' or ')}`
    }
  }
  return errors
}

/** The rows the remote-host lock replaces: a Save stores nothing for them (HTTP-13). */
function remoteLockedNames(ctx: SaveContext): ReadonlySet<string> {
  if (!ctx.runsOnRemoteHost) return new Set()
  const tableParams = ctx.versionParameters as TableParameter[]
  return new Set(
    tableParams.filter((param) => param.lockedOnRemoteHost).map((param) => param.name),
  )
}

/** The field names left without the given rows and their dotted entries. */
function withoutRows(fields: string[], rows: ReadonlySet<string>): string[] {
  return fields.filter((field) => !rows.has(field.split('.')[0]))
}

/** Text that holds something, or any other value that is there. */
function holdsValue(value: unknown): boolean {
  return typeof value === 'string' ? value.trim() !== '' : value !== undefined
}

/** The number type of a row name every descriptor of which is a number row, else null. */
function numberRowType(parameters: readonly Parameter[], name: string): NumberType | null {
  const descriptors = parameters.filter((param) => param.name === name)
  if (descriptors.length === 0) return null
  if (!descriptors.every((param) => param.type === 'integer' || param.type === 'float')) return null
  return descriptors.some((param) => param.type === 'float') ? 'float' : 'integer'
}

/** A number text stored as the JSON number it stands for, when that number keeps every digit (REQ-3.1.3.14). */
function wireIfNumber(value: unknown, type: string | null | undefined): unknown {
  return typeof value === 'string' && (type === 'integer' || type === 'float') ? wireNumber(value, type) : value
}

/** A literal number row's text stored as the JSON number the Block takes. */
function storedValue(ctx: SaveContext, name: string, value: unknown): unknown {
  if (ctx.expressionFields.includes(name) || ctx.templateFields.includes(name)) return value
  return wireIfNumber(value, numberRowType(ctx.versionParameters, name))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A Setter row's type: its declared variable's, else the type picked for its new target (REQ-3.4.1.14). */
function setterRowType(ctx: SaveContext, row: string): string | undefined {
  return ctx.variables.find((variable) => variable.name === row)?.type ?? ctx.newTargetTypes?.[row]
}

/** The Setter rows with each plain literal number row in the number wire form of its row type; a secret row stays as typed. */
function storedSetterRows(ctx: SaveContext, rows: unknown): unknown {
  if (!isRecord(rows)) return rows
  const asWritten = new Set([...ctx.expressionFields, ...ctx.templateFields, ...(ctx.secretFields ?? [])])
  return Object.fromEntries(
    Object.entries(rows).map(([row, value]) => [
      row,
      asWritten.has(`variables.${row}`) ? value : wireIfNumber(value, setterRowType(ctx, row)),
    ]),
  )
}

/** The Parallel lanes as stored: a literal limit in the number wire form, no limit key while unset (REQ-3.2.3.7). */
function storedLanes(ctx: SaveContext, lanes: unknown): unknown {
  if (!Array.isArray(lanes)) return lanes
  return lanes.map((lane: unknown, index) => {
    if (!isRecord(lane)) return lane
    const { time_limit: limit, ...rest } = lane
    if (limit === undefined) return rest
    const literal = !ctx.expressionFields.includes(`branches.${index}.time_limit`)
    return { ...rest, time_limit: literal ? wireIfNumber(limit, 'integer') : limit }
  })
}

/** A setting value as the Block stores it: the Setter rows and the Parallel lanes have their own number rows. */
function storedSetting(ctx: SaveContext, name: string, value: unknown): unknown {
  if (ctx.elementType === 'variable-setter' && name === 'variables') return storedSetterRows(ctx, value)
  if (ctx.elementType === 'parallel' && name === 'branches') return storedLanes(ctx, value)
  return storedValue(ctx, name, value)
}

/** The items with each operator-hidden compare value dropped, at every depth; the same list when nothing goes. */
function withoutHiddenCompareValues(items: readonly AssertionItem[]): readonly AssertionItem[] {
  let changed = false
  const cleaned = items.map((item) => {
    let next = item
    if (item.type === 'literal') next = dropUnusedCompareTo(item)
    else if (item.type === 'group' && Array.isArray(item.items)) {
      const inner = withoutHiddenCompareValues(item.items)
      if (inner !== item.items) next = { ...item, items: [...inner] }
    }
    changed ||= next !== item
    return next
  })
  return changed ? cleaned : items
}

/** The value with `value` written at a dotted place of lists and records, copying only along the way. */
function withAtPlace(target: unknown, place: readonly string[], value: unknown): unknown {
  if (place.length === 0) return value
  const [key, ...rest] = place
  if (Array.isArray(target)) {
    const copy = [...target]
    copy[Number(key)] = withAtPlace(target[Number(key)], rest, value)
    return copy
  }
  const record = target as Record<string, unknown>
  return { ...record, [key]: withAtPlace(record[key], rest, value) }
}

/** Every condition list of a Block with the compare values their operators hide dropped (REQ-3.5.1.5). */
export function normalizeConditionLists(
  elementType: string,
  values: Record<string, unknown>,
): Record<string, unknown> {
  let normalized = values
  for (const { items, place } of conditionListsOf(elementType, values)) {
    const cleaned = withoutHiddenCompareValues(items)
    if (cleaned !== items) {
      normalized = withAtPlace(normalized, place.split('.'), cleaned) as Record<string, unknown>
    }
  }
  return normalized
}

/** The values the user set: a locked row and a blank whole-field expression store nothing. */
function buildEffectiveValues(
  ctx: SaveContext,
  locked: ReadonlySet<string>,
): Record<string, unknown> {
  const effectiveValues: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(ctx.values)) {
    if (value === undefined || locked.has(name)) continue
    // A whole-field expression left blank means not set: the default applies (REQ-3.1.1.5).
    if (ctx.expressionFields.includes(name) && !holdsValue(value)) continue
    effectiveValues[name] = storedSetting(ctx, name, value)
  }
  return normalizeConditionLists(ctx.elementType, effectiveValues)
}

/** Build output type map from output parameters */
function buildOutputTypes(outputParameters: SaveContext['outputParameters']): Record<string, string> {
  const outputTypes: Record<string, string> = {}
  for (const out of outputParameters) {
    outputTypes[out.name] = out.type
  }
  return outputTypes
}

/** Build effective bindings for XML/JSON parser individual mode */
function buildParserBindings(
  ctx: SaveContext,
  effectiveValues: Record<string, unknown>,
  outputTypes: Record<string, string>,
): Record<string, string> {
  const effectiveBindings = { ...ctx.outputBindings }
  if (ctx.elementType !== 'xml-parser' && ctx.elementType !== 'json-parser') return effectiveBindings

  const isIndividual = String(effectiveValues.output_mode) === 'individual'
  const fixedOutputNames = new Set(ctx.outputParameters.map((o) => o.name))
  for (const key of Object.keys(effectiveBindings)) {
    if (!fixedOutputNames.has(key)) {
      delete effectiveBindings[key]
    }
  }
  if (isIndividual) {
    const queries = effectiveValues.queries as Record<string, string> | undefined
    const queryTypes = effectiveValues.query_output_types as Record<string, string> | undefined
    if (queries) {
      for (const alias of Object.keys(queries)) {
        const isExpr = ctx.expressionFields.includes(`queries.${alias}`)
        outputTypes[alias] = isExpr ? 'string' : (queryTypes?.[alias] ?? 'string')
        effectiveBindings[alias] = alias
      }
    }
  }
  return effectiveBindings
}

/** A shown choice-list or true / false row stores the value it displays when the Block holds none (FIELD-8, SHELL-10). */
function writeShownChoices(
  ctx: SaveContext,
  effectiveValues: Record<string, unknown>,
  locked: ReadonlySet<string>,
): void {
  const tableParams = ctx.versionParameters as TableParameter[]
  const asWritten = new Set([...ctx.expressionFields, ...ctx.templateFields])
  const shown: Record<string, unknown> = {}
  for (const param of tableParams) {
    const name = param.name
    const choice = param.enumValues !== undefined || param.type === 'boolean'
    if (!choice || Object.hasOwn(effectiveValues, name) || Object.hasOwn(shown, name)) continue
    if (locked.has(name) || asWritten.has(name) || !isParameterVisible(param, effectiveValues, tableParams)) continue
    const pin = param.lockedWhen
    const displayed = pin && matchesCondition(pin, effectiveValues, tableParams) ? pin.value : param.defaultValue
    if (displayed !== undefined && displayed !== null) shown[name] = displayed
  }
  Object.assign(effectiveValues, shown)
}

// ============================================================================
// Public API
// ============================================================================

/** Strip hidden retainOnHide drafts (and their dotted expression fields) at
 *  save: only the active mode's payload persists. Visibility resolves through
 *  enum defaults via the shared showWhen check. */
function stripHiddenRetainedValues(
  ctx: SaveContext,
  effectiveValues: Record<string, unknown>,
  expressionFields: string[],
): string[] {
  const tableParams = ctx.versionParameters as TableParameter[]
  let fields = expressionFields
  for (const param of tableParams) {
    if (!param.retainOnHide || isParameterVisible(param, effectiveValues, tableParams)) continue
    delete effectiveValues[param.name]
    const prefix = `${param.name}.`
    fields = fields.filter((field) => field !== param.name && !field.startsWith(prefix))
  }
  return fields
}

/** True when a flag names something the values hold: a whole field with a value, or an entry of one. */
function flagHeld(values: Record<string, unknown>, flag: string): boolean {
  const [field, ...entry] = flag.split('.')
  const held = values[field]
  if (entry.length === 0) return holdsValue(held)
  if (held !== null && typeof held === 'object' && Object.hasOwn(held, entry.join('.'))) return true
  let current: unknown = held
  for (const key of entry) {
    if (current === null || typeof current !== 'object') return false
    current = (current as Record<string, unknown>)[key]
  }
  return current !== undefined
}

/** The flags of what the Save stores; a flag with no value goes with it. */
function heldFlags(fields: string[], values: Record<string, unknown>): string[] {
  return fields.filter((flag) => flagHeld(values, flag))
}

/** The output bindings that name a variable; a cleared one stores nothing. */
function namedBindings(bindings: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(bindings).filter(([, target]) => target !== ''))
}

/** The Secret list to store: the seed the boxes showed is not stored until it changes (REQ-3.1.2.9). */
function savedSecretFields(ctx: SaveContext): string[] | undefined {
  const seed = ctx.seededOutputSecretFields
  if (seed === undefined) return ctx.outputSecretFields
  const seeded = new Set(seed)
  const unchanged = ctx.outputSecretFields.length === seeded.size && ctx.outputSecretFields.every((name) => seeded.has(name))
  return unchanged ? undefined : ctx.outputSecretFields
}

/** The element types of the settings and Setter rows still held and literal, or undefined when none remain. */
function presentElementTypes(
  types: Record<string, ElementTypes> | undefined,
  present: Record<string, unknown>,
  expressionNames: ReadonlySet<string>,
): Record<string, ElementTypes> | undefined {
  const kept = Object.entries(types ?? {}).filter(
    ([name]) => flagHeld(present, name) && !expressionNames.has(name),
  )
  return kept.length === 0 ? undefined : Object.fromEntries(kept)
}

/** The picked type of each Setter row the Save keeps, for the canvas to declare a new target. */
function keptTargetTypes(
  types: Record<string, string>,
  values: Record<string, unknown>,
): Record<string, string> {
  const rows = isRecord(values.variables) ? values.variables : {}
  return Object.fromEntries(Object.entries(types).filter(([row]) => Object.hasOwn(rows, row)))
}

/** The save data the context describes, without the output-binding check. */
export function assembleSaveData(ctx: SaveContext): SaveData {
  const locked = remoteLockedNames(ctx)
  const effectiveValues = buildEffectiveValues(ctx, locked)
  writeShownChoices(ctx, effectiveValues, locked)
  const savedExpressionFields = heldFlags(
    stripHiddenRetainedValues(ctx, effectiveValues, withoutRows(ctx.expressionFields, locked)),
    effectiveValues,
  )
  const outputTypes = buildOutputTypes(ctx.outputParameters)
  const effectiveBindings = buildParserBindings(ctx, effectiveValues, outputTypes)
  const savedSetterSecrets = heldFlags(ctx.secretFields ?? [], effectiveValues)

  return {
    id: ctx.elementId,
    version: ctx.selectedVersion,
    name: ctx.name.trim(),
    values: effectiveValues,
    outputBindings: namedBindings(effectiveBindings),
    outputTypes,
    description: ctx.description.trim() || undefined,
    profileBindings: ctx.profileBindings,
    expressionFields: savedExpressionFields,
    templateFields: heldFlags(withoutRows(ctx.templateFields, locked), effectiveValues),
    outputSecretFields: savedSecretFields(ctx),
    unmaskedSecretFields: ctx.unmaskedSecretFields ?? [],
    secretMasking: ctx.secretMasking ?? 'system',
    elementTypes: presentElementTypes(
      ctx.settingElementTypes,
      effectiveValues,
      new Set(savedExpressionFields),
    ),
    ...(savedSetterSecrets.length > 0 && { secretFields: savedSetterSecrets }),
    ...(ctx.newTargetTypes !== undefined && {
      newTargetTypes: keptTargetTypes(ctx.newTargetTypes, effectiveValues),
    }),
  }
}

/**
 * Validate output bindings and build save data.
 * Returns { data, errors } - data is null if validation fails.
 */
export function buildSaveData(ctx: SaveContext): SaveResult {
  const errors = validateOutputBindings(ctx.outputParameters, ctx.outputBindings, ctx.variables)
  if (Object.keys(errors).length > 0) {
    return { data: null, errors }
  }
  return { data: assembleSaveData(ctx), errors: {} }
}

interface HasChangesContext {
  selectedVersion: string
  elementVersion: string
  name: string
  elementName: string
  description: string
  elementDescription: string | undefined
  values: Record<string, unknown>
  elementCurrentValues: Record<string, unknown>
  outputBindings: Record<string, string>
  elementOutputBindings: Record<string, string>
  profileBindings: ProfileBinding[]
  elementProfileBindings: ProfileBinding[] | undefined
  expressionFields: string[]
  elementExpressionFields: string[] | undefined
  templateFields: string[]
  elementTemplateFields: string[] | undefined
  secretFields: string[]
  elementSecretFields?: string[]
  outputSecretFields: string[]
  elementOutputSecretFields: string[] | undefined
  unmaskedSecretFields: string[]
  elementUnmaskedSecretFields: string[] | undefined
  secretMasking: string
  elementSecretMasking: string | undefined
  settingElementTypes?: Record<string, ElementTypes>
  elementSettingElementTypes?: Record<string, ElementTypes>
}

/** Compare two values as JSON for deep equality */
function jsonDiffers(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b)
}

/** Check scalar field changes (version, name, description) */
function hasScalarChanges(ctx: HasChangesContext): boolean {
  /* v8 ignore next - COV-BRANCH-072 */
  if (ctx.selectedVersion !== ctx.elementVersion) return true
  if ((ctx.name ?? '').trim() !== (ctx.elementName ?? '').trim()) return true
  if ((ctx.description || '') !== (ctx.elementDescription ?? '')) return true
  return false
}

/** Check structured data changes: values (control fields and Setter rows included), bindings, flag lists */
function hasStructuredChanges(ctx: HasChangesContext): boolean {
  if (jsonDiffers(ctx.values, ctx.elementCurrentValues)) return true
  /* v8 ignore next - COV-BRANCH-073 */
  if (jsonDiffers(ctx.outputBindings, ctx.elementOutputBindings)) return true
  if (jsonDiffers(ctx.profileBindings, ctx.elementProfileBindings ?? [])) return true
  if (jsonDiffers(ctx.expressionFields, ctx.elementExpressionFields ?? [])) return true
  /* v8 ignore next - COV-BRANCH-099 */
  if (jsonDiffers(ctx.templateFields, ctx.elementTemplateFields ?? [])) return true
  if (jsonDiffers(ctx.secretFields, ctx.elementSecretFields ?? [])) return true
  if (jsonDiffers(ctx.outputSecretFields, ctx.elementOutputSecretFields ?? [])) return true
  if (jsonDiffers(ctx.unmaskedSecretFields ?? [], ctx.elementUnmaskedSecretFields ?? [])) return true
  if ((ctx.secretMasking ?? 'system') !== (ctx.elementSecretMasking ?? 'system')) return true
  return !canonicalEqual(ctx.settingElementTypes ?? {}, ctx.elementSettingElementTypes ?? {})
}

/**
 * Determine if the form has unsaved changes compared to the original element data.
 */
export function computeHasChanges(ctx: HasChangesContext): boolean {
  return hasScalarChanges(ctx) || hasStructuredChanges(ctx)
}
