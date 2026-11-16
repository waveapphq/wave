/**
 * Live FE-side node validation.
 *
 * Mirrors the backend rules used by `_validate_test_data`: required parameter
 * checks (handles `required` and `requiredWhen`), the output binding type
 * check (uses `OUTPUT_TYPE_COMPAT`), unresolved expression-field references
 * (identifiers that don't resolve to a known variable / namespace root /
 * profile alias / builtin), the control rules and the Variable Setter rows,
 * worded as the save check words them. Returns one issue per (node, param).
 */

import { blockInputParams, blockOutputParams } from '@/features/workbench/lib/node-parameters'
import { OUTPUT_TYPE_COMPAT, type InputParam } from '@/features/workbench/lib/node-parameters/types'
import { functionScopeNames, type ScopeBody } from '@/features/workbench/lib/function-scope-rows'
import { resolveKeyPolicy } from '@/features/workbench/lib/node-parameters/key-policy'
import { outputListNodeIssues } from '@/features/workbench/lib/node-parameters/output-list'
import { resolveOutputTypes } from '@/features/workbench/lib/node-parameters/output-type'
import { extractIdentifiers } from '@/features/workbench/lib/ast-visitor'
import { collectLocalNames } from '@/features/workbench/lib/expression-validation/validation-helpers'
import { unknownVariableMessage } from '@/features/workbench/lib/expression-validation/messages'
import {
  SCRIPT_PARAMS,
  scriptIssueText,
} from '@/features/workbench/lib/python-script-validation/script-issues'
import { EXPRESSION_SAFE_NAMES } from '@/features/workbench/lib/expression-sandbox'
import { NAMESPACE_ROOTS } from '@/features/workbench/lib/namespace-roots'
import { literalFits } from '@/features/workbench/lib/saved-block-fields'
import { mapEntryErrorMessages } from '@/lib/variable-validation'
import { numberValueProblem, type NumberProblem } from '@/lib/number-rule'
import { safeStringify } from '@/lib/utils'
import { describeBindingRejection } from './output-binding-rules'
import { fieldLabel, literalNumberProblem, numberBoundError } from './number-bounds'
import { controlFindings, numberRuleReason } from './control-checks'

export type NodeIssueCode =
  | 'REQUIRED_PARAM_MISSING'
  | 'REQUIRED_PARAM_EMPTY'
  | 'INVALID_OUTPUT_BINDING_TYPE'
  | 'UNRESOLVED_VARIABLE_REFERENCE'
  | 'INPUT_WRITE_FORBIDDEN'
  | 'EXTERNAL_SCOPE_READ_FORBIDDEN'
  | 'OUTPUT_HAS_NO_PRODUCER'
  | 'MISSING_FUNCTION_VERSION'
  | 'CONTAINS_INVALID_DESCENDANT'
  | 'MAP_KEY_POLICY'
  | 'ENUM_ORDER'
  | 'NUMBER_RANGE'
  | 'NUMBER_VALUE'
  | 'OUTPUT_LIST_NAME'
  | 'OUTPUT_NEVER_ASSIGNED'
  | 'SCRIPT_SYNTAX_ERROR'
  | 'SCRIPT_CHECK_WARNING'
  | 'INVALID_COMPARE_VALUE'
  | 'INVALID_CONDITION'
  | 'INVALID_CONTROL_STRUCTURE'
  | 'INVALID_SETTING_VALUE'
  | 'INVALID_SETTING_TYPE'
  | 'INVALID_VARIABLE_VALUE'
  | 'TEMPLATE_NOT_STRING'

export type NodeIssueSeverity = 'error' | 'warning'

export interface NodeIssue {
  code: NodeIssueCode
  /** Absent reads as `'error'`; only an error paints the block invalid (PYRUN-14). */
  severity?: NodeIssueSeverity
  paramName?: string
  message: string
}

/** A syntax error, or with a warning severity a finding of the script checks. */
export interface ScriptSyntaxIssue {
  line: number
  message: string
  severity?: 'warning'
}

const scriptSyntaxIssues = new Map<string, ScriptSyntaxIssue[]>()

/** What the script editor last reported for a block; an empty list clears it. */
export function setScriptSyntaxIssues(
  nodeId: string,
  issues: readonly ScriptSyntaxIssue[],
): void {
  if (issues.length === 0) {
    scriptSyntaxIssues.delete(nodeId)
    return
  }
  scriptSyntaxIssues.set(nodeId, [...issues])
}

export function scriptSyntaxIssuesByNode(): Map<string, ScriptSyntaxIssue[]> {
  return new Map(scriptSyntaxIssues)
}

export function clearScriptSyntaxIssues(): void {
  scriptSyntaxIssues.clear()
}

/** A canvas node as the store holds it; only its id and data are read. */
interface NodeForValidation {
  id: string
  type?: string
  position?: { x: number; y: number }
  data: {
    elementType?: string
    nodeType?: string
    version?: string
    label?: string
    disabled?: boolean
    expressionFields?: string[]
    templateFields?: string[]
    elementTypes?: Record<string, unknown>
    config?: {
      values?: Record<string, unknown>
      outputBindings?: Record<string, string>
      profileBindings?: unknown
    }
  }
}

interface VarForValidation {
  name: string
  type: string
}

function matchesCondition(
  condition: { field: string; values: string[] },
  values: Record<string, unknown>,
  schema: InputParam[],
): boolean {
  let actual: unknown = values[condition.field]
  if (actual === undefined || actual === null) {
    const refParam = schema.find((p) => p.name === condition.field)
    if (refParam) actual = refParam.defaultValue
  }
  return condition.values.includes(safeStringify(actual))
}

/** Mirrors the sheet's own row-reveal rules: a row it hides is never checked. */
function isParamVisible(
  param: InputParam,
  values: Record<string, unknown>,
  schema: InputParam[],
): boolean {
  if (param.showWhen && !matchesCondition(param.showWhen, values, schema)) return false
  if (param.showWhenAny && !param.showWhenAny.some((c) => matchesCondition(c, values, schema))) {
    return false
  }
  if (param.showWhenAll) {
    return param.showWhenAll.every((c) => matchesCondition(c, values, schema))
  }
  return true
}

function isParamRequired(
  param: InputParam,
  values: Record<string, unknown>,
  schema: InputParam[],
): boolean {
  if (param.required) return true
  if (param.requiredWhen) return matchesCondition(param.requiredWhen, values, schema)
  if (param.requiredWhenAll) {
    return param.requiredWhenAll.every((condition) =>
      matchesCondition(condition, values, schema),
    )
  }
  return false
}

/** A value fills a field of this type: text that is not blank, a list or map with entries, any other value. */
export function isValueNonEmpty(value: unknown, paramType: string): boolean {
  if (paramType === 'string') {
    if (typeof value === 'string') return value.trim().length > 0
    return value !== null && value !== undefined
  }
  if (paramType === 'map') {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      && Object.keys(value as Record<string, unknown>).length > 0
  }
  if (paramType === 'array' || paramType === 'table') {
    // A variable reference or an expression arrives as its text, never as a
    // collection, so a non-blank string is a provided value.
    if (typeof value === 'string') return value.trim().length > 0
    return Array.isArray(value) && value.length > 0
  }
  /* v8 ignore next - COV-BRANCH-003 */
  return value !== null && value !== undefined
}

function isDefaultFilled(param: InputParam): boolean {
  return param.defaultValue !== undefined && isValueNonEmpty(param.defaultValue, param.type)
}

/** The issue a required field raises, or null when its value, its null or its default fills it. */
function requiredParamIssue(param: InputParam, value: unknown): NodeIssue | null {
  // An explicit null fills a field that takes null (REQ-3.1.3.21).
  if (value === null && param.acceptsNull) return null
  const notSet = value === undefined || value === null
  // A not-set field uses its default, which fills a required one only when it holds something.
  if (notSet && isDefaultFilled(param)) return null
  if (notSet) {
    return {
      code: 'REQUIRED_PARAM_MISSING',
      paramName: param.name,
      message: param.requiredMessage ?? `Required parameter '${param.name}' is missing`,
    }
  }
  if (isValueNonEmpty(value, param.type)) return null
  return {
    code: 'REQUIRED_PARAM_EMPTY',
    paramName: param.name,
    message: param.requiredMessage ?? `Required parameter '${param.name}' is empty`,
  }
}

function checkRequiredParams(
  schema: InputParam[],
  values: Record<string, unknown>,
  issues: NodeIssue[],
): void {
  for (const param of schema) {
    if (!isParamVisible(param, values, schema)) continue
    if (!isParamRequired(param, values, schema)) continue
    const issue = requiredParamIssue(param, values[param.name])
    if (issue) issues.push(issue)
  }
}

/** Mirror of the save-validation map key policies: duplicate and blocked keys
 *  with the same exact messages as the editor and the strip. */
function checkMapKeyPolicies(
  schema: InputParam[],
  values: Record<string, unknown>,
  issues: NodeIssue[],
): void {
  for (const param of schema) {
    if (!param.keyPolicy) continue
    const entries = values[param.name]
    if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) continue
    const rows = Object.entries(entries as Record<string, unknown>).map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : String(value),
      type: 'string' as const,
    }))
    const policy = resolveKeyPolicy(param.keyPolicy)
    for (const message of mapEntryErrorMessages(rows, undefined, policy)) {
      issues.push({ code: 'MAP_KEY_POLICY', paramName: param.name, message })
    }
  }
}

/** Mirror of the sheet's variable export row errors, one issue per offending row. */
function checkOutputLists(
  schema: InputParam[],
  values: Record<string, unknown>,
  outputNames: string[],
  issues: NodeIssue[],
): void {
  issues.push(...outputListNodeIssues(schema, values, outputNames))
}

/** Cross-field enum ordering (`notAbove`): the param's value must not order
 *  after the referenced field's value on the shared enumValues scale. */
function checkEnumOrder(
  schema: InputParam[],
  values: Record<string, unknown>,
  issues: NodeIssue[],
): void {
  for (const param of schema) {
    const rule = param.notAbove
    if (!rule || !param.enumValues) continue
    const own = String(values[param.name] ?? param.defaultValue)
    const refParam = schema.find((p) => p.name === rule.field)
    const other = String(values[rule.field] ?? refParam?.defaultValue)
    const ownIndex = param.enumValues.indexOf(own)
    const otherIndex = param.enumValues.indexOf(other)
    if (ownIndex < 0 || otherIndex < 0) continue
    if (ownIndex > otherIndex) {
      issues.push({ code: 'ENUM_ORDER', paramName: param.name, message: rule.message })
    }
  }
}

/** A literal integer / float the number rule refuses, then declared numeric bounds: a literal outside the
 *  row's range, or above the row its `maximumField` names. Nothing is clamped; the value typed is kept. */
function checkNumberRanges(
  schema: InputParam[],
  values: Record<string, unknown>,
  expressionFields: Set<string>,
  issues: NodeIssue[],
): void {
  for (const param of schema) {
    if (!isParamVisible(param, values, schema)) continue
    const problem = literalNumberProblem(param.type, values[param.name], expressionFields.has(param.name))
    if (problem !== null) {
      const message = `${fieldLabel(param)}: ${problem}`
      issues.push({ code: 'NUMBER_VALUE', severity: 'error', paramName: param.name, message })
      continue
    }
    const message = numberBoundError(param, values, schema, expressionFields)
    if (message === null) continue
    issues.push({ code: 'NUMBER_RANGE', severity: 'error', paramName: param.name, message })
  }
}

/** The control rules of a Block, each with the save check's code and place (REQ-3.5.0.3). */
function checkControlRules(
  elementType: string,
  values: Record<string, unknown>,
  expressionFields: readonly string[],
  issues: NodeIssue[],
): void {
  for (const { code, field, message } of controlFindings(elementType, values, expressionFields)) {
    issues.push({ code, paramName: field, message })
  }
}

const SETTER_ELEMENT = 'variable-setter'
const SETTER_FLAG = 'variables.'

/** The value-type word the save check names a stored value by. */
function valueTypeName(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'float'
  if (Array.isArray(value)) return 'array'
  return isRecord(value) ? 'map' : typeof value
}

/** The save check's type-fit text for a Setter literal its variable's declared type refuses. */
function setterTypeIssue(row: string, value: unknown, declared: string): NodeIssue {
  if (declared === 'integer' || declared === 'float') {
    // The literal does not fit, so the number rule refuses it.
    const reason = numberRuleReason(value, declared, numberValueProblem(value, declared) as NumberProblem)
    return { code: 'INVALID_VARIABLE_VALUE', paramName: 'variables', message: `Value for variable '${row}' ${reason}` }
  }
  return {
    code: 'INVALID_SETTING_TYPE',
    paramName: 'variables',
    message: `Setting 'variables.${row}' of block 'variable-setter' expects ${declared}, got ${valueTypeName(value)}`,
  }
}

/** A Setter literal row whose value no longer fits its variable's declared type (REQ-3.4.1.14). */
function checkSetterRowTypes(
  data: NodeForValidation['data'],
  rows: Record<string, unknown>,
  varsByName: Map<string, VarForValidation>,
  issues: NodeIssue[],
): void {
  const written = new Set([...(data.expressionFields ?? []), ...(data.templateFields ?? [])])
  for (const [row, value] of Object.entries(rows)) {
    const declared = varsByName.get(row)?.type
    if (declared === undefined || written.has(SETTER_FLAG + row)) continue
    if (!literalFits(value, { name: row, type: declared })) issues.push(setterTypeIssue(row, value, declared))
  }
}

function withArticle(word: string): string {
  return `${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}`
}

/** The entry type stored for one entry of a list (by index) or map (by key) row. */
function entryTypeAt(types: unknown, key: string): unknown {
  if (Array.isArray(types)) return types[Number(key)]
  return isRecord(types) ? types[key] : undefined
}

/** The save check's text for a Template Setter row or entry on a type that is not text, or null. */
function setterTemplateMessage(
  place: string,
  data: NodeForValidation['data'],
  varsByName: Map<string, VarForValidation>,
): string | null {
  const dot = place.indexOf('.')
  if (dot === -1) {
    const declared = varsByName.get(place)?.type
    if (declared === undefined || declared === 'string') return null
    return `Row '${place}' sets ${withArticle(declared)} variable; a template builds text, so it needs a string variable`
  }
  const row = place.slice(0, dot)
  const key = place.slice(dot + 1)
  const entryType = entryTypeAt(data.elementTypes?.[SETTER_FLAG + row], key)
  if (typeof entryType !== 'string' || entryType === 'string') return null
  return `Entry '${key}' of row '${row}' is ${entryType}; a template builds text, so it needs element type string`
}

/** A Template Setter row or entry on a type that is not text: a template builds text (REQ-3.4.1.14). */
function checkSetterTemplates(
  data: NodeForValidation['data'],
  varsByName: Map<string, VarForValidation>,
  issues: NodeIssue[],
): void {
  if (data.elementType !== SETTER_ELEMENT) return
  const places = (data.templateFields ?? []).filter((flag) => flag.startsWith(SETTER_FLAG))
  for (const flag of places) {
    const message = setterTemplateMessage(flag.slice(SETTER_FLAG.length), data, varsByName)
    if (message !== null) issues.push({ code: 'TEMPLATE_NOT_STRING', paramName: 'variables', message })
  }
}

function setterRows(node: NodeForValidation): Record<string, unknown> {
  const rows = node.data.config?.values?.variables
  return node.data.elementType === SETTER_ELEMENT && isRecord(rows) ? rows : {}
}

interface ProfileBindingLike {
  alias?: string
  fields?: Array<{ name?: unknown }>
}

function collectProfileAliasNames(nodes: NodeForValidation[]): Set<string> {
  const names = new Set<string>()
  for (const node of nodes) {
    const bindings = node.data?.config?.profileBindings
    if (!Array.isArray(bindings)) continue
    for (const raw of bindings) {
      const binding = raw as ProfileBindingLike
      if (typeof binding.alias === 'string' && binding.alias) {
        names.add(binding.alias)
      }
    }
  }
  return names
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The entry a dotted path addresses inside a list or map value; a key may itself hold a dot. */
function entryAt(container: unknown, path: string): unknown {
  if (isRecord(container) && Object.hasOwn(container, path)) return container[path]
  const dot = path.indexOf('.')
  const head = dot === -1 ? path : path.slice(0, dot)
  const item = entryOf(container, head)
  return dot === -1 ? item : entryAt(item, path.slice(dot + 1))
}

/** One list item or map value by its key. */
function entryOf(container: unknown, key: string): unknown {
  if (Array.isArray(container)) return container[Number(key)]
  return isRecord(container) ? container[key] : undefined
}

interface ExpressionSite {
  /** The field that holds the site: the whole field, or the list / map holding the entry. */
  field: string
  text: string
}

/** Every non-blank expression text a Block holds: whole fields and, through dotted flags, single entries. */
function expressionSites(node: NodeForValidation): ExpressionSite[] {
  const values = node.data.config?.values
  if (!values) return []
  const sites: ExpressionSite[] = []
  for (const flag of node.data.expressionFields ?? []) {
    const dot = flag.indexOf('.')
    const whole = Object.hasOwn(values, flag) || dot === -1
    const field = whole ? flag : flag.slice(0, dot)
    const text = whole ? values[flag] : entryAt(values[field], flag.slice(dot + 1))
    if (typeof text === 'string' && text.trim() !== '') sites.push({ field, text })
  }
  return sites
}

function checkUnresolvedRefs(
  node: NodeForValidation,
  availableNames: Set<string>,
  issues: NodeIssue[],
): void {
  for (const { field, text } of expressionSites(node)) {
    const identifiers = extractIdentifiers(text)
    // A name the expression binds itself is local to it, never a reference.
    const { localVariables, kwargNames } = collectLocalNames(text)
    const unresolved = identifiers
      .map((i) => i.name)
      .find(
        (name) =>
          !availableNames.has(name) && !localVariables.has(name) && !kwargNames.has(name),
      )
    if (unresolved) {
      issues.push({
        code: 'UNRESOLVED_VARIABLE_REFERENCE',
        paramName: field,
        message: unknownVariableMessage(unresolved),
      })
    }
  }
}

function checkOutputBindings(
  bindings: Record<string, string> | undefined,
  outputTypes: Map<string, string>,
  varsByName: Map<string, VarForValidation>,
  issues: NodeIssue[],
): void {
  if (!bindings) return
  for (const [paramName, varName] of Object.entries(bindings)) {
    if (!varName) continue
    // Reject namespace pointers and non-identifier names regardless of type.
    const rejection = describeBindingRejection(varName)
    if (rejection) {
      issues.push({
        code: 'INVALID_OUTPUT_BINDING_TYPE',
        paramName,
        message: rejection,
      })
      continue
    }
    const variable = varsByName.get(varName)
    if (!variable) continue
    const paramType = outputTypes.get(paramName)
    if (!paramType) continue
    const compat = OUTPUT_TYPE_COMPAT[paramType]
    if (!compat || compat.has(variable.type)) continue
    issues.push({
      code: 'INVALID_OUTPUT_BINDING_TYPE',
      paramName,
      message: `Output '${paramName}' (type ${paramType}) cannot bind to variable '${varName}' (type ${variable.type})`,
    })
  }
}

/** The script editor's own parse and checks, named by line on the script row (PYRUN-13, SQL-10, OS-12). */
function checkScriptSyntax(node: NodeForValidation, elementType: string, issues: NodeIssue[]): void {
  const paramName = SCRIPT_PARAMS[elementType]
  // A script row in expression mode has no editor, so no finding of one applies.
  if (paramName === undefined || node.data.expressionFields?.includes(paramName)) return
  const reported = scriptSyntaxIssues.get(node.id) ?? []
  const firstError = reported.find((issue) => issue.severity !== 'warning')
  if (firstError) {
    issues.push({
      code: 'SCRIPT_SYNTAX_ERROR',
      paramName,
      message: `Script has a syntax error on line ${firstError.line}`,
    })
  }
  for (const warning of reported.filter((issue) => issue.severity === 'warning')) {
    issues.push({
      code: 'SCRIPT_CHECK_WARNING',
      severity: 'warning',
      paramName,
      message: scriptIssueText(warning),
    })
  }
}

/** Run all per-node checks against a single node and return its issues. */
function issuesForNode(
  node: NodeForValidation,
  availableNames: Set<string>,
  varsByName: Map<string, VarForValidation>,
): NodeIssue[] {
  const data = node.data ?? {}
  if (data.disabled) return []

  // One field list for every Block: plugin, control and Function (REQ-3.1.2.4).
  const inputSchema = blockInputParams(data as Record<string, unknown>)
  const outputSchema = blockOutputParams(data as Record<string, unknown>)
  // Every registered Block declares both; an unknown one, or a pin not read yet, declares neither.
  if (!inputSchema || !outputSchema) return []

  const config = data.config ?? {}
  const values = config.values ?? {}

  const issues: NodeIssue[] = []

  checkRequiredParams(inputSchema, values, issues)
  checkMapKeyPolicies(inputSchema, values, issues)
  checkEnumOrder(inputSchema, values, issues)
  // An {x} or a Template is written source, never read with the number rule (REQ-3.1.3.14).
  const sourceFields = new Set([...(data.expressionFields ?? []), ...(data.templateFields ?? [])])
  checkNumberRanges(inputSchema, values, sourceFields, issues)
  checkControlRules(data.elementType ?? '', values, data.expressionFields ?? [], issues)
  checkSetterRowTypes(data, setterRows(node), varsByName, issues)
  checkSetterTemplates(data, varsByName, issues)
  checkOutputLists(inputSchema, values, outputSchema.map((output) => output.name), issues)

  const outputTypes = resolveOutputTypes(outputSchema, values, inputSchema)
  checkOutputBindings(config.outputBindings, outputTypes, varsByName, issues)

  checkUnresolvedRefs(node, availableNames, issues)
  checkScriptSyntax(node, data.elementType ?? '', issues)

  return issues
}

/** The names a Function flow reads, the types its Blocks' outputs bind against, and its read-only inputs. */
interface FunctionFlowScope {
  available: Set<string>
  varsByName: Map<string, VarForValidation>
  inputs: Set<string>
}

function typedEntries(items: unknown): VarForValidation[] {
  if (!Array.isArray(items)) return []
  return items.flatMap((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.type !== 'string') return []
    return [{ name: entry.name, type: entry.type }]
  })
}

/** A Function flow sees only its own scope: no Test variables, no namespaces (REQ-3.1.2.4). */
function functionFlowScope(body: ScopeBody): FunctionFlowScope {
  const names = functionScopeNames(body)
  const varsByName = new Map<string, VarForValidation>()
  for (const entry of [...typedEntries(body.inputs), ...typedEntries(body.outputs), ...typedEntries(body.variables)]) {
    if (!varsByName.has(entry.name)) varsByName.set(entry.name, entry)
  }
  return {
    available: new Set([...EXPRESSION_SAFE_NAMES, ...names.map((entry) => entry.name)]),
    varsByName,
    inputs: new Set(names.filter((entry) => entry.kind === 'input').map((entry) => entry.name)),
  }
}

const EXTERNAL_SCOPE_READ = /\b(regression|suite|system)\.([A-Za-z_]\w*)/g

/** The Function flow rules: a Block never writes a Function input, nor reads an external scope. */
function functionFlowRuleIssues(node: NodeForValidation, inputs: Set<string>): NodeIssue[] {
  const issues: NodeIssue[] = []
  for (const [output, target] of Object.entries(node.data.config?.outputBindings ?? {})) {
    if (!target || !inputs.has(target)) continue
    issues.push({
      code: 'INPUT_WRITE_FORBIDDEN',
      paramName: output,
      message: `Writes to declared input '${target}'; inputs are read-only`,
    })
  }
  for (const row of Object.keys(setterRows(node))) {
    if (!inputs.has(row)) continue
    issues.push({
      code: 'INPUT_WRITE_FORBIDDEN',
      paramName: 'variables',
      message: `Writes to declared input '${row}'; inputs are read-only`,
    })
  }
  for (const { field, text } of expressionSites(node)) {
    for (const [, scope, name] of text.matchAll(EXTERNAL_SCOPE_READ)) {
      issues.push({
        code: 'EXTERNAL_SCOPE_READ_FORBIDDEN',
        paramName: field,
        message: `Reads variable '${name}' from external scope '${scope}'; only the Function's own scope is visible`,
      })
    }
  }
  return issues
}

function missingVersionIssue(data: Record<string, unknown>): NodeIssue | null {
  if (data.disabled || !data.missingVersion) return null
  const pinned = typeof data.functionVersion === 'string' ? data.functionVersion : '?'
  return { code: 'MISSING_FUNCTION_VERSION', message: `Pinned version ${pinned} is no longer available in the library` }
}

/** Every badge one Block of a Function flow gets: the one Block check, the flow rules, a missing version. */
function functionFlowBlockIssues(node: NodeForValidation, scope: FunctionFlowScope): NodeIssue[] {
  if (node.data?.disabled) return []
  const issues = [
    ...issuesForNode(node, scope.available, scope.varsByName),
    ...functionFlowRuleIssues(node, scope.inputs),
  ]
  const missing = missingVersionIssue(node.data as Record<string, unknown>)
  if (missing) issues.push(missing)
  return issues
}

function flagFunctionIfBodyFails(
  node: NodeForValidation,
  result: Map<string, NodeIssue[]>,
): boolean {
  // Validate one Local Function's body (and descendants); flag the Function
  // and return true when anything inside it failed (REQ-3.1.2.4 ancestor alert).
  const data = (node.data ?? {}) as Record<string, unknown>
  if (data.nodeType !== 'function') return false
  if (data.functionLifecycle !== 'local') return false
  const localDef = data.localDefinition as ScopeBody | undefined
  const innerRaw = localDef?.workflow?.nodes
  if (!localDef || !Array.isArray(innerRaw) || innerRaw.length === 0) return false
  const innerNodes = innerRaw as NodeForValidation[]
  const scope = functionFlowScope(localDef)
  let bodyHasIssue = false
  for (const inner of innerNodes) {
    const issues = functionFlowBlockIssues(inner, scope)
    if (issues.length > 0) result.set(inner.id, issues)
    // A warning never marks the enclosing Function invalid (PYRUN-14).
    if (issues.some((issue) => issue.severity !== 'warning')) bodyHasIssue = true
  }
  // Recurse so nested Local Functions get their bodies validated and so a
  // deeper failing descendant lights this enclosing Function too.
  if (collectInnerFunctionIssues(innerNodes, result)) {
    bodyHasIssue = true
  }
  if (bodyHasIssue) {
    const existing = result.get(node.id) ?? []
    existing.push({
      code: 'CONTAINS_INVALID_DESCENDANT',
      message: 'This Function contains a block with validation issues',
    })
    result.set(node.id, existing)
  }
  return bodyHasIssue
}

function collectInnerFunctionIssues(
  nodes: NodeForValidation[],
  result: Map<string, NodeIssue[]>,
): boolean {
  // Returns true when any node in `nodes` (or a descendant body) has an issue,
  // so a caller can light the alert on every enclosing Function (REQ-3.1.2.4).
  let subtreeHasIssue = false
  for (const node of nodes) {
    if (flagFunctionIfBodyFails(node, result)) {
      subtreeHasIssue = true
    }
  }
  return subtreeHasIssue
}


/** Flag Shared instances whose pinned version is no longer in the library. */
function collectMissingVersionIssues(
  nodes: NodeForValidation[],
  result: Map<string, NodeIssue[]>,
): void {
  for (const node of nodes) {
    const issue = missingVersionIssue((node.data ?? {}) as Record<string, unknown>)
    if (issue) result.set(node.id, [...(result.get(node.id) ?? []), issue])
  }
}

/** Every issue carries a severity; the ones that never name one are errors. */
function withDefaultSeverity(result: Map<string, NodeIssue[]>): Map<string, NodeIssue[]> {
  const normalized = new Map<string, NodeIssue[]>()
  for (const [nodeId, issues] of result) {
    normalized.set(
      nodeId,
      issues.map((issue) => (issue.severity ? issue : { ...issue, severity: 'error' })),
    )
  }
  return normalized
}

export function computeNodeIssues(
  nodes: NodeForValidation[],
  variables: VarForValidation[],
): Map<string, NodeIssue[]> {
  const result = new Map<string, NodeIssue[]>()
  const varsByName = new Map(variables.map((v) => [v.name, v]))

  const availableNames = new Set<string>(EXPRESSION_SAFE_NAMES)
  for (const n of NAMESPACE_ROOTS) availableNames.add(n)
  for (const alias of collectProfileAliasNames(nodes)) availableNames.add(alias)
  for (const v of variables) availableNames.add(v.name)

  for (const node of nodes) {
    const issues = issuesForNode(node, availableNames, varsByName)
    if (issues.length > 0) {
      result.set(node.id, issues)
    }
  }

  // Surface issues from inside every Local Function body so the
  // NodeValidationAlert badge lights up on the drilled-in canvas.
  collectInnerFunctionIssues(nodes, result)

  // Light the alert on Shared instances pinned to a now-missing version.
  collectMissingVersionIssues(nodes, result)

  return withDefaultSeverity(result)
}
