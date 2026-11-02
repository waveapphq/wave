/**
 * Save logic for ElementConfigModal
 *
 * Pure functions for building save data and validating output bindings.
 * Extracted from useConfigModalState to keep the hook under 300 lines.
 */

import { OUTPUT_TYPE_COMPAT } from '@/features/workbench/lib/node-parameters/types'
import { describeBindingRejection } from '@/features/workbench/lib/validation/output-binding-rules'
import { isParameterVisible, matchesCondition, type Parameter as TableParameter } from './parameters/parameter-table-types'
import type { AssertionItem } from '../config/assertion-builder'
import type { ConditionBranch } from '../config/condition-branch-editor'
import type { CaseBranch } from '../config/case-branch-editor'
import type { ParallelBranch } from '../config/parallel-branch-editor'
import type { SecretMaskingSetting } from '@/features/workbench/lib/node-parameters/secret-reveal'
import type { ProfileBinding } from './dialogs/profile-binding-modal'
import type { Parameter, SaveData, EnrichedVariable } from './types'
import type { ElementTypes } from '@/lib/variable-validation'
import { wireNumber, type NumberType } from '@/lib/number-rule'
import { canonicalEqual } from '@/features/workbench/lib/canonical-workflow'

export interface SaveContext {
  elementId: string
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
  // Element type flags
  isVariableSetter: boolean
  isXmlParser: boolean
  isJsonParser: boolean
  isAssert: boolean
  isIfElse: boolean
  isSwitch: boolean
  isWhile: boolean
  isWaitUntil?: boolean
  isParallel?: boolean
  // Assert state
  assertAssertions: AssertionItem[]
  assertMode: 'single' | 'split'
  assertFailCurrentScope: boolean
  // If-Else state
  ifElseBranches: ConditionBranch[]
  // Switch/Case state
  switchBranches: CaseBranch[]
  // While state
  whileConditions: AssertionItem[]
  // Wait Until state (present whenever isWaitUntil)
  waitConditions?: AssertionItem[]
  waitMode?: 'retry' | 'watch'
  waitFailCurrentScope?: boolean
  // Parallel state (present whenever isParallel)
  parallelBranches?: ParallelBranch[]
  parallelJoin?: 'all' | 'first'
  // Variable setter state
  variableExpressionKeys: string[]
  variableTemplateKeys: string[]
  variableSecretKeys: string[]
  variableTypes: Record<string, string>
  /** Variable Setter rows' element types, and typed block settings' (REQ-3.1.3.19). */
  variableElementTypes?: Record<string, ElementTypes>
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

/** A branch row as storage holds it: snake_case limit, and no key when unset. */
function storedBranch(branch: ParallelBranch): Record<string, unknown> {
  const stored: Record<string, unknown> = { id: branch.id, name: branch.name }
  if (branch.timeLimit !== undefined) stored.time_limit = branch.timeLimit
  return stored
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

/** A literal number row's text stored as the JSON number the Block takes, when that number keeps every digit (REQ-3.1.3.14). */
function storedValue(ctx: SaveContext, name: string, value: unknown): unknown {
  if (typeof value !== 'string' || ctx.expressionFields.includes(name) || ctx.templateFields.includes(name)) {
    return value
  }
  const type = numberRowType(ctx.versionParameters, name)
  return type === null ? value : wireNumber(value, type)
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
    effectiveValues[name] = storedValue(ctx, name, value)
  }
  if (ctx.isAssert) {
    effectiveValues.assertions = ctx.assertAssertions
    effectiveValues.mode = ctx.assertMode
    effectiveValues.fail_current_scope = ctx.assertFailCurrentScope
  }
  if (ctx.isIfElse) {
    effectiveValues.branches = ctx.ifElseBranches
  }
  if (ctx.isSwitch) {
    effectiveValues.branches = ctx.switchBranches
  }
  if (ctx.isWhile) {
    effectiveValues.conditions = ctx.whileConditions
  }
  if (ctx.isWaitUntil) {
    effectiveValues.conditions = ctx.waitConditions
    effectiveValues.mode = ctx.waitMode
    effectiveValues.fail_current_scope = ctx.waitFailCurrentScope
  }
  if (ctx.isParallel) {
    effectiveValues.branches = (ctx.parallelBranches ?? []).map(storedBranch)
    effectiveValues.join = ctx.parallelJoin
  }
  return effectiveValues
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
  if (!ctx.isXmlParser && !ctx.isJsonParser) return effectiveBindings

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

/** The element types of the entries still present, or undefined when none remain. */
function presentElementTypes(
  types: Record<string, ElementTypes> | undefined,
  present: Record<string, unknown>,
  expressionNames: ReadonlySet<string>,
): Record<string, ElementTypes> | undefined {
  const kept = Object.entries(types ?? {}).filter(
    ([name]) => name in present && !expressionNames.has(name),
  )
  return kept.length === 0 ? undefined : Object.fromEntries(kept)
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
    ...(ctx.isVariableSetter && {
      variableExpressionKeys: ctx.variableExpressionKeys,
      variableTemplateKeys: ctx.variableTemplateKeys,
      variableSecretKeys: ctx.variableSecretKeys,
      variableTypes: ctx.variableTypes,
      variableElementTypes: presentElementTypes(
        ctx.variableElementTypes,
        (effectiveValues.variables as Record<string, unknown> | undefined) ?? {},
        new Set(ctx.variableExpressionKeys),
      ),
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
  outputSecretFields: string[]
  elementOutputSecretFields: string[] | undefined
  unmaskedSecretFields: string[]
  elementUnmaskedSecretFields: string[] | undefined
  secretMasking: string
  elementSecretMasking: string | undefined
  variableExpressionKeys: string[]
  elementVariableExpressionKeys: string[] | undefined
  variableTemplateKeys: string[]
  elementVariableTemplateKeys: string[] | undefined
  variableSecretKeys: string[]
  elementVariableSecretKeys: string[] | undefined
  variableTypes: Record<string, string>
  elementVariableTypes: Record<string, string> | undefined
  variableElementTypes?: Record<string, ElementTypes>
  elementVariableElementTypes?: Record<string, ElementTypes>
  settingElementTypes?: Record<string, ElementTypes>
  elementSettingElementTypes?: Record<string, ElementTypes>
  isAssert: boolean
  assertAssertions: AssertionItem[]
  assertMode: string
  assertFailCurrentScope: boolean
  isIfElse: boolean
  ifElseBranches: ConditionBranch[]
  isSwitch: boolean
  switchBranches: CaseBranch[]
  isWhile: boolean
  whileConditions: AssertionItem[]
  isWaitUntil?: boolean
  waitConditions?: AssertionItem[]
  waitMode?: string
  waitFailCurrentScope?: boolean
  isParallel?: boolean
  parallelBranches?: ParallelBranch[]
  parallelJoin?: string
}

/** Compare two values as JSON for deep equality */
function jsonDiffers(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b)
}

/** Check if assert-specific fields have changed */
function hasAssertChanges(ctx: HasChangesContext): boolean {
  if (jsonDiffers(ctx.assertAssertions, (ctx.elementCurrentValues.assertions as AssertionItem[]) ?? [])) return true
  if (ctx.assertMode !== ((ctx.elementCurrentValues.mode as string) ?? 'split')) return true
  if (ctx.assertFailCurrentScope !== ((ctx.elementCurrentValues.fail_current_scope as boolean) ?? false)) return true
  return false
}

/** Check scalar field changes (version, name, description) */
function hasScalarChanges(ctx: HasChangesContext): boolean {
  /* v8 ignore next - COV-BRANCH-072 */
  if (ctx.selectedVersion !== ctx.elementVersion) return true
  if ((ctx.name ?? '').trim() !== (ctx.elementName ?? '').trim()) return true
  if ((ctx.description || '') !== (ctx.elementDescription ?? '')) return true
  return false
}

/** Check structured data changes (values, bindings, fields) */
function hasStructuredChanges(ctx: HasChangesContext): boolean {
  if (jsonDiffers(ctx.values, ctx.elementCurrentValues)) return true
  /* v8 ignore next - COV-BRANCH-073 */
  if (jsonDiffers(ctx.outputBindings, ctx.elementOutputBindings)) return true
  if (jsonDiffers(ctx.profileBindings, ctx.elementProfileBindings ?? [])) return true
  if (jsonDiffers(ctx.expressionFields, ctx.elementExpressionFields ?? [])) return true
  /* v8 ignore next - COV-BRANCH-099 */
  if (jsonDiffers(ctx.templateFields, ctx.elementTemplateFields ?? [])) return true
  if (jsonDiffers(ctx.outputSecretFields, ctx.elementOutputSecretFields ?? [])) return true
  if (jsonDiffers(ctx.unmaskedSecretFields ?? [], ctx.elementUnmaskedSecretFields ?? [])) return true
  if ((ctx.secretMasking ?? 'system') !== (ctx.elementSecretMasking ?? 'system')) return true
  if (jsonDiffers(ctx.variableExpressionKeys, ctx.elementVariableExpressionKeys ?? [])) return true
  if (jsonDiffers(ctx.variableTemplateKeys, ctx.elementVariableTemplateKeys ?? [])) return true
  if (jsonDiffers(ctx.variableSecretKeys, ctx.elementVariableSecretKeys ?? [])) return true
  if (jsonDiffers(ctx.variableTypes, ctx.elementVariableTypes ?? {})) return true
  if (!canonicalEqual(ctx.variableElementTypes ?? {}, ctx.elementVariableElementTypes ?? {})) return true
  if (!canonicalEqual(ctx.settingElementTypes ?? {}, ctx.elementSettingElementTypes ?? {})) return true
  return false
}

/** Check wait-specific fields have changed */
function hasWaitChanges(ctx: HasChangesContext): boolean {
  if (jsonDiffers(ctx.waitConditions, (ctx.elementCurrentValues.conditions as AssertionItem[]) ?? [])) return true
  if (ctx.waitMode !== ((ctx.elementCurrentValues.mode as string) ?? 'retry')) return true
  if (ctx.waitFailCurrentScope !== ((ctx.elementCurrentValues.fail_current_scope as boolean) ?? false)) return true
  return false
}

/** Check parallel-specific fields have changed */
function hasParallelChanges(ctx: HasChangesContext): boolean {
  const stored = (ctx.parallelBranches ?? []).map(storedBranch)
  if (jsonDiffers(stored, ctx.elementCurrentValues.branches ?? [])) return true
  return (ctx.parallelJoin ?? 'all') !== ((ctx.elementCurrentValues.join as string) ?? 'all')
}

/** Check control-specific changes (assert, if-else, while, wait) */
function hasControlChanges(ctx: HasChangesContext): boolean {
  if (ctx.isAssert && hasAssertChanges(ctx)) return true
  if (ctx.isIfElse && jsonDiffers(ctx.ifElseBranches, (ctx.elementCurrentValues.branches as ConditionBranch[]) ?? [])) return true
  if (ctx.isSwitch && jsonDiffers(ctx.switchBranches, (ctx.elementCurrentValues.branches as CaseBranch[]) ?? [])) return true
  if (ctx.isWhile && jsonDiffers(ctx.whileConditions, (ctx.elementCurrentValues.conditions as AssertionItem[]) ?? [])) return true
  if (ctx.isWaitUntil && hasWaitChanges(ctx)) return true
  if (ctx.isParallel && hasParallelChanges(ctx)) return true
  return false
}

/**
 * Determine if the form has unsaved changes compared to the original element data.
 */
export function computeHasChanges(ctx: HasChangesContext): boolean {
  return hasScalarChanges(ctx) || hasStructuredChanges(ctx) || hasControlChanges(ctx)
}
