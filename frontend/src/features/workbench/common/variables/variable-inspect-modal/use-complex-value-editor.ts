/** The array / map / table value-editing core of the "Edit value" sheet (REQ-3.1.3.11, REQ-3.1.3.13). */

import { useMemo, useState } from 'react'

import {
  arrayErrorMessages,
  deriveTableSchema,
  firstTableErrorMessage,
  formatValue,
  mapEntryErrorMessages,
  mapKeyPolicyDuplicateMessage,
  overCapNumberLines,
  parseArrayCode,
  parseMapCode,
  parseStringMapCode,
  parseTableCodeText,
  resolveArrayTypes,
  resolveMapTypes,
  scanDuplicateMapMemberKeys,
  serializeArrayForCode,
  serializeMapForCode,
  serializeStringMapForCode,
  serializeTableForCode,
  tableErrorMessages,
  tableSchemaFromCode,
  validateTableCodeValue,
  type ElementTypes,
  type ResolvedMapKeyPolicy,
  type TableColumnSchema,
  type TableValidationResult,
  type ValueType,
} from '@/lib/variable-validation'
import type { QuickInsertMenu } from '@/lib/quick-inserts'
import type {
  GeneratedMapRow,
  MapExpressionEditorProps,
} from '@/components/shared/variable-bodies/map-edit-body'
import { typedListItem, type ListItemType } from '@/components/shared/variable-bodies/array-edit-body'
import type { ReactNode } from 'react'
import {
  describeJsonError,
  jsonCellLine,
  jsonElementLine,
  jsonMemberLine,
} from '@/lib/codemirror/json-data-editor'
import { seedTableEditWidthsFromValue } from '@/components/shared/variable-bodies/table-edit-widths'
import { toStoredTable } from '@/lib/variable-table-model'
import { isNullValue } from '@/lib/variable-format'
import type { VariableType } from '@/lib/variable-types'

/** The three complex value types this editor handles. */
export type ComplexEditorType = 'array' | 'map' | 'table'

const FIX_JSON_TOOLTIP = 'Fix JSON errors to switch to Visual'
const FIX_TABLE_TOOLTIP = 'Fix the table structure to switch to Visual'

export function isComplexEditorType(type: VariableType): type is ComplexEditorType {
  return type === 'array' || type === 'map' || type === 'table'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

interface SeededTypes {
  arrayTypes: ValueType[]
  mapTypes: Record<string, ValueType>
  tableSchema: TableColumnSchema[]
}

/** Per-element types / schema of the current value (empty for scalars): each
 *  element's declared type where it has one, else its stored shape (REQ-3.1.3.19). */
function seedTypesFromValue(
  type: VariableType,
  value: unknown,
  elementTypes: ElementTypes | undefined,
): SeededTypes {
  return {
    arrayTypes: type === 'array' && Array.isArray(value) ? resolveArrayTypes(value, elementTypes) : [],
    mapTypes: type === 'map' && isPlainObject(value) ? resolveMapTypes(value, elementTypes) : {},
    tableSchema: type === 'table' ? deriveTableSchema(value) : [],
  }
}

/** A text-only or typed list gives every item its one type, whatever the item looks like. */
function asFixedList(seeded: SeededTypes, itemType: ListItemType): SeededTypes {
  return { ...seeded, arrayTypes: seeded.arrayTypes.map(() => itemType) }
}

/** The one Value Type every item of a typed or text-only list takes; undefined for any other value. */
function fixedListItemType(
  type: VariableType,
  itemType: ListItemType | undefined,
  stringValuesOnly: boolean | undefined,
): ListItemType | undefined {
  if (type !== 'array') return undefined
  return itemType ?? (stringValuesOnly ? 'string' : undefined)
}

const NUMBER_TOKENS: ReadonlySet<ValueType> = new Set<ValueType>(['integer', 'float'])

/** Serialize the draft to its Code-view text. Matches the CodeBody's own
 *  serialize so the parsed line-resolvers align with the displayed document. */
function serializeForCode(
  type: VariableType,
  value: unknown,
  arrayTypes: ValueType[],
  mapTypes: Record<string, ValueType>,
  tableSchema: TableColumnSchema[],
  exprKeys?: ReadonlySet<string>,
  exprIndices?: ReadonlySet<number>,
): string {
  if (type === 'table') return serializeTableForCode(value, tableSchema)
  if (type === 'array') return serializeArrayForCode(value as unknown[], arrayTypes, 'pretty', exprIndices)
  if (type === 'map') return serializeMapForCode(value as Record<string, unknown>, mapTypes, exprKeys)
  return JSON.stringify(value, null, 2)
}

/** The {x} entries of a list or map, which the Code checks read as text. */
interface CodeExpressions {
  keys?: ReadonlySet<string>
  indices?: ReadonlySet<number>
}

/** Array / map Code semantic messages: the per-element checks (incl. nested caps),
 *  each located at the offending number's line (cap) or the slot's line. */
function arrayMapCodeMessages(
  type: VariableType,
  value: unknown,
  arrayTypes: ValueType[],
  mapTypes: Record<string, ValueType>,
  codeText: string,
  exprs: CodeExpressions,
): string[] | null {
  const capLines = overCapNumberLines(codeText)
  if (type === 'array' && Array.isArray(value)) {
    const checked = arrayTypes.map((itemType, index) => (exprs.indices?.has(index) ? 'string' : itemType))
    return arrayErrorMessages(value, checked, (index) => capLines.get(index) ?? jsonElementLine(codeText, index))
  }
  if (type === 'map' && isPlainObject(value)) {
    return mapEntryErrorMessages(
      Object.entries(value).map(([key, entryValue]) => ({
        key,
        value: formatValue(entryValue),
        // A null value fits any element type (REQ-3.1.3.19).
        type: isNullValue(entryValue) || exprs.keys?.has(key) ? 'string' : (mapTypes[key] ?? 'string'),
      })),
      (key) => capLines.get(key) ?? jsonMemberLine(codeText, key),
    )
  }
  return null
}

interface StripResult {
  message: string | null
  messages: string[] | null
}

/** A table's strip line: the JSON syntax error first (the cell errors are stale
 *  while it does not parse), else the first table problem + its full list. */
function tableStrip(
  syntaxError: string | null,
  tableValidation: TableValidationResult | null,
  cellLine: (row: number, column: string) => number | null,
): StripResult {
  if (syntaxError !== null) return { message: syntaxError, messages: null }
  if (tableValidation !== null && !tableValidation.valid) {
    return {
      message: firstTableErrorMessage(tableValidation, cellLine),
      messages: tableErrorMessages(tableValidation, cellLine),
    }
  }
  return { message: null, messages: null }
}

/** An array / map's strip line: in Code the syntax error then the semantic
 *  messages; in Visual the per-element messages the editor emits. */
function arrayMapStrip(
  inCode: boolean,
  syntaxError: string | null,
  codeMessages: string[] | null,
  visualErrors: string[],
): StripResult {
  if (inCode) {
    return {
      message: syntaxError ?? codeMessages?.[0] ?? null,
      messages: syntaxError === null ? codeMessages : null,
    }
  }
  return {
    message: visualErrors[0] ?? null,
    messages: visualErrors.length > 0 ? visualErrors : null,
  }
}

export interface UseComplexValueEditorArgs {
  /** The draft type. The hook is inert when this is not a complex type. */
  type: VariableType
  /** The host-owned draft value. */
  value: unknown
  /** Host value sink: a Code parse / nested edit writes the new value through this. */
  onChange: (value: unknown) => void
  /** Host body-valid sink: the Code parse validity feeds the host Save / Create gate. */
  onValidChange: (valid: boolean) => void
  /** The active Visual / Code view (host-owned). */
  view: 'visual' | 'code'
  /** Re-seeds the per-element types / schema from `value` when it changes (the
   *  create modal passes its draftType; the inspect modal an edit-enter token). */
  seedKey: unknown
  /** Map only: force every value to the string type (HTTP header / query maps stay
   *  string->string). Surfaced on bodyData for the MapEditBody. */
  stringValuesOnly?: boolean
  /** Map only: key-policy / scaffold / generated-row / expression options. */
  mapEntry?: MapEntryEditorOptions
  /** String-only map: keys whose values are expressions (host-owned draft). */
  mapExprKeys?: ReadonlySet<string>
  /** String-only map: reports the rebuilt expression-key set (Visual + Code). */
  onMapExprKeysChange?: (keys: Set<string>) => void
  /** Array only: the items held as {x}, given when the list takes per-item {x} (Code writes them bare). */
  listExprIndices?: ReadonlySet<number>
  /** Array only: reports the {x} items a Code edit leaves. */
  onListExprIndicesChange?: (indices: Set<number>) => void
  /** The value's declared element types, seeding each row's type (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
  /** Array only: every item takes this Value Type (an enum's allowed values, VMGR-104). */
  itemType?: ListItemType
}

/** Map-editor extensions threaded from a param schema into the shared body. */
export interface MapEntryEditorOptions {
  quickInserts?: QuickInsertMenu[]
  note?: string
  keyPolicy?: ResolvedMapKeyPolicy
  credentialAdvisory?: (key: string, value: string, isExpr: boolean) => boolean
  /** Read-only generated rows (composed auth / auto body headers). */
  generatedRows?: GeneratedMapRow[]
  /** Headers the config would generate but does not - the amber stripe data. */
  missingHeaderAdvisories?: { key: string; message: string }[]
  /** Host-injected per-row expression editor (the {x} affordance). */
  expressionEditor?: (props: MapExpressionEditorProps) => ReactNode
  /** Seed of keys whose values are expressions (draft owned by the sheet). */
  expressionKeys?: string[]
}

/** Props the ComplexValueBody needs, all wired to this hook's state + handlers. */
export interface ComplexValueBodyData {
  type: ComplexEditorType
  value: unknown
  arrayTypes: ValueType[]
  mapTypes: Record<string, ValueType>
  tableSchema: TableColumnSchema[]
  /** Map only: per-entry expression / key-policy / scaffold options (HTTP headers). */
  mapEntry?: MapEntryEditorOptions
  /** String-only map: expression-key draft + its change sink for the Visual body. */
  mapExprKeys?: ReadonlySet<string>
  onMapExprKeysChange?: (keys: Set<string>) => void
  /** Controlled table column widths - persisted here so they survive the body
   *  unmount on a Visual -> Code -> Visual round trip (reset on seedKey). */
  tableWidths: number[]
  onChange: (value: unknown) => void
  onValidChange: (valid: boolean) => void
  onArrayChange: (value: unknown[], types: ValueType[]) => void
  onMapChange: (value: Record<string, unknown>, types: Record<string, ValueType>) => void
  onTableSchemaChange: (schema: TableColumnSchema[]) => void
  onTableWidthsChange: (widths: number[]) => void
  onTableValidation: (result: TableValidationResult) => void
  onVisualErrors: (messages: string[]) => void
  onCodeChange: (text: string) => void
  onCodeValidChange: (valid: boolean) => void
  serialize: (value: unknown) => string
  /** Map only: forces string values in the MapEditBody. */
  stringValuesOnly?: boolean
  /** Array only: the one Value Type of every item. */
  itemType?: ListItemType
}

export interface UseComplexValueEditor {
  /** Spread onto ComplexValueBody (host adds `view` + `formatKey`). */
  bodyData: ComplexValueBodyData
  /** The complex-value strip line (syntax / table / array-map semantic), or null. */
  stripMessage: string | null
  /** The full ordered message list, driving the strip's "(+N more)" expander. */
  stripMessages: string[] | null
  /** A semantic problem (table shape / cell, array-map cap, a whole text that is
   *  not a list / map) gating Save / Create. */
  semanticInvalid: boolean
  /** The Code value cannot render in Visual (bad JSON or a non-row-list shape). */
  visualLocked: boolean
  visualLockTooltip: string
  /** Format would reflow onto - and discard - broken input, so block it. */
  formatBlocked: boolean
  /** The draft serialized to Code text (host syncs codeText on switch-to-Code). */
  serializeDraftToCode: () => string
  /** Re-snapshot codeText from the draft (call on switch-to-Code). */
  syncCodeText: () => void
  /** Settle the table column schema on switch-to-Visual: the Code columns are kept and settled. */
  seedTableSchema: () => void
  /** Clear stale Code validity after a Format re-mount (host bumps formatKey). */
  markFormatted: () => void
  /** The rows' declared element types to store beside the value (array / typed
   *  map only; an expression map row declares none, an expression list item text). */
  elementTypes: ElementTypes | undefined
  /** The draft as stored: a table is its {columns, rows} form with the column types (REQ-3.5.5.4). */
  storedValue: unknown
}

/** Which Code members are {x}: a string-only map keeps {{ }} inside its strings; a typed map with an
 *  expression editor and a list with {x} indices write their {x} members bare. */
function codeExpressionSlots(
  type: VariableType,
  stringValuesOnly: boolean | undefined,
  mapEntry: MapEntryEditorOptions | undefined,
  mapExprKeys: ReadonlySet<string> | undefined,
  listExprIndices: ReadonlySet<number> | undefined,
) {
  const stringMap = type === 'map' && stringValuesOnly === true
  const typedExpressions = type === 'map' && !stringMap && mapEntry?.expressionEditor !== undefined
  const listExpressions = type === 'array' && listExprIndices !== undefined
  return {
    stringMap,
    typedExpressions,
    typedExprKeys: typedExpressions ? mapExprKeys : undefined,
    listExpressions,
    listExprs: listExpressions ? listExprIndices : undefined,
  }
}

/** The Code text of a value as it is seeded. */
function codeTextOf(
  type: VariableType,
  value: unknown,
  seeded: SeededTypes,
  slots: {
    stringMap: boolean
    mapExprKeys: ReadonlySet<string> | undefined
    typedExprKeys: ReadonlySet<string> | undefined
    listExprs: ReadonlySet<number> | undefined
  },
): string {
  if (slots.stringMap) return serializeStringMapForCode(value as Record<string, string>, slots.mapExprKeys)
  return serializeForCode(type, value, seeded.arrayTypes, seeded.mapTypes, seeded.tableSchema, slots.typedExprKeys, slots.listExprs)
}

export function useComplexValueEditor({
  type,
  value,
  onChange,
  onValidChange,
  view,
  seedKey,
  stringValuesOnly,
  mapEntry,
  mapExprKeys,
  onMapExprKeysChange,
  listExprIndices,
  onListExprIndicesChange,
  elementTypes,
  itemType,
}: UseComplexValueEditorArgs): UseComplexValueEditor {
  const fixedItemType = fixedListItemType(type, itemType, stringValuesOnly)
  const seedTypes = (): SeededTypes => {
    const seeded = seedTypesFromValue(type, value, elementTypes)
    return fixedItemType === undefined ? seeded : asFixedList(seeded, fixedItemType)
  }
  const initialSeed = seedTypes()
  const [arrayTypes, setArrayTypes] = useState<ValueType[]>(initialSeed.arrayTypes)
  const [mapTypes, setMapTypes] = useState<Record<string, ValueType>>(initialSeed.mapTypes)
  const [tableSchema, setTableSchema] = useState<TableColumnSchema[]>(initialSeed.tableSchema)
  const [tableWidths, setTableWidths] = useState<number[]>(() =>
    type === 'table' ? seedTableEditWidthsFromValue(value) : [],
  )
  const [tableValidation, setTableValidation] = useState<TableValidationResult | null>(null)
  const [codeText, setCodeText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  // A whole text that is valid JSON but not a list / map: the Code body still reports it valid.
  const [shapeRefused, setShapeRefused] = useState(false)
  const [codeValid, setCodeValid] = useState(true)
  const [visualErrors, setVisualErrors] = useState<string[]>([])
  const [stringCodeErrors, setStringCodeErrors] = useState<string[]>([])
  // The column schema came from the rows typed in Code, so the next Code edit may still change it.
  const [codeColumns, setCodeColumns] = useState(false)
  const [seededKey, setSeededKey] = useState(seedKey)
  const [seededItemType, setSeededItemType] = useState(fixedItemType)

  const { stringMap, typedExpressions, typedExprKeys, listExpressions, listExprs } = codeExpressionSlots(
    type,
    stringValuesOnly,
    mapEntry,
    mapExprKeys,
    listExprIndices,
  )

  // Re-seed the per-element types / schema from the value when the seed key
  // changes (a create type switch, or an inspect edit-enter) or the list's Value
  // Type does. Done during render - the React way to reset state on an input
  // change - so it is StrictMode-safe and never lands a stale frame from an effect.
  if (seededKey !== seedKey || seededItemType !== fixedItemType) {
    setSeededKey(seedKey)
    setSeededItemType(fixedItemType)
    const seeded = seedTypes()
    setArrayTypes(seeded.arrayTypes)
    setMapTypes(seeded.mapTypes)
    setTableSchema(seeded.tableSchema)
    setTableWidths(type === 'table' ? seedTableEditWidthsFromValue(value) : [])
    setTableValidation(null)
    setCodeColumns(false)
    setJsonError(null)
    setShapeRefused(false)
    setCodeValid(true)
    setVisualErrors([])
    setStringCodeErrors([])
    setCodeText(view === 'code' ? codeTextOf(type, value, seeded, { stringMap, mapExprKeys, typedExprKeys, listExprs }) : '')
  }

  const inCode = view === 'code'

  const onArrayChange = (nextValue: unknown[], nextTypes: ValueType[]) => {
    onChange(nextValue)
    setArrayTypes(nextTypes)
  }
  const onMapChange = (
    nextValue: Record<string, unknown>,
    nextTypes: Record<string, ValueType>,
  ) => {
    onChange(nextValue)
    setMapTypes(nextTypes)
  }

  const onTableSchemaChange = (schema: TableColumnSchema[]) => {
    setTableSchema(schema)
    setCodeColumns(false)
  }

  // The schema a Code table edit is checked against; a table with no columns takes them from the typed rows.
  const codeEditSchema = (text: string): TableColumnSchema[] => {
    if (!codeColumns && tableSchema.length > 0) return tableSchema
    const schema = tableSchemaFromCode(text)
    setTableSchema(schema)
    setCodeColumns(true)
    return schema
  }

  const onCodeValidChange = (valid: boolean) => {
    setCodeValid(valid)
    onValidChange(valid)
  }

  // Parse the Code text into the draft + its inferred element types; invalid JSON
  // or a whole text that is not a list / map keeps the last valid draft.
  const onCodeChange = (text: string) => {
    setCodeText(text)
    try {
      if (stringMap) {
        const parsed = parseStringMapCode(text)
        onChange(parsed.value)
        setMapTypes(Object.fromEntries(Object.keys(parsed.value).map((key) => [key, 'string'])))
        onMapExprKeysChange?.(new Set(parsed.exprKeys))
        setStringCodeErrors(parsed.errors)
      } else if (type === 'array') {
        const { items, types, exprIndices } = parseArrayCode(text, listExpressions)
        if (listExpressions) onListExprIndicesChange?.(new Set(exprIndices))
        if (fixedItemType === undefined) {
          onChange(items)
          setArrayTypes(types)
        } else {
          // A number written into a typed list reads as its Value Type; any other token stays as written.
          onChange(
            items.map((item, i) =>
              NUMBER_TOKENS.has(types[i]) ? typedListItem(item as string, fixedItemType) : item,
            ),
          )
          setArrayTypes(items.map(() => fixedItemType))
        }
      } else if (type === 'map') {
        const { value: mapValue, types, exprKeys } = parseMapCode(text, typedExpressions)
        onChange(mapValue)
        setMapTypes(types)
        if (typedExpressions) onMapExprKeysChange?.(new Set(exprKeys))
      } else {
        const parsed = parseTableCodeText(text)
        onChange(parsed)
        setTableValidation(validateTableCodeValue(parsed, codeEditSchema(text)))
      }
      setJsonError(null)
      setShapeRefused(false)
    } catch (error) {
      setJsonError(describeJsonError(text, error))
      setShapeRefused(!(error instanceof SyntaxError))
    }
  }

  const serialize = (v: unknown) => {
    if (stringMap) return serializeStringMapForCode(v as Record<string, string>, mapExprKeys)
    return serializeForCode(type, v, arrayTypes, mapTypes, tableSchema, typedExprKeys, listExprs)
  }
  const serializeDraftToCode = () => serialize(value)

  // String-map Code semantics: non-string members, source-level duplicate
  // members (JSON.parse would swallow them), collisions with generated rows,
  // then the key-policy checks on the parsed entries (duplicates ride the
  // source scan, so the policy runs exact).
  const stringMapCodeMessages = (): string[] => {
    const policy = mapEntry?.keyPolicy
    const dupMessages = scanDuplicateMapMemberKeys(codeText, policy?.caseInsensitive).map((key) =>
      policy ? mapKeyPolicyDuplicateMessage(policy.keyNoun, key) : `Duplicate key "${key}"`,
    )
    const generatedKeys = new Set((mapEntry?.generatedRows ?? []).map((row) => row.key.toLowerCase()))
    const generatedDupMessages = Object.keys(value as Record<string, unknown>)
      .filter((key) => generatedKeys.has(key.trim().toLowerCase()))
      .map((key) =>
        policy ? mapKeyPolicyDuplicateMessage(policy.keyNoun, key) : `Duplicate key "${key}"`,
      )
    const entryMessages = mapEntryErrorMessages(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => ({
        key,
        value: formatValue(entryValue),
        type: 'string' as ValueType,
      })),
      (key) => jsonMemberLine(codeText, key),
      policy ? { ...policy, caseInsensitive: false } : undefined,
    )
    return [...stringCodeErrors, ...dupMessages, ...generatedDupMessages, ...entryMessages]
  }

  const cellLine = (row: number, column: string) => jsonCellLine(codeText, row, column)
  const tableInvalid = type === 'table' && tableValidation !== null && !tableValidation.valid
  const tableBlocksVisual = type === 'table' && tableValidation?.structureError != null

  // Only a real JSON parse failure is a syntax error; a valid-but-invalid value
  // (table shape / cell, nested cap) is semantic and never locks the Visual switch.
  const syntaxError = inCode ? jsonError : null
  // Array / map Code semantic messages run only on a clean parse (caps, type checks).
  const codeMessages = (() => {
    if (!inCode || jsonError !== null) return null
    if (stringMap) return stringMapCodeMessages()
    return arrayMapCodeMessages(type, value, arrayTypes, mapTypes, codeText, {
      keys: typedExprKeys,
      indices: listExprs,
    })
  })()
  const codeSemanticInvalid = (codeMessages?.length ?? 0) > 0
  const shapeInvalid = inCode && shapeRefused

  const strip =
    type === 'table'
      ? tableStrip(syntaxError, tableValidation, cellLine)
      : arrayMapStrip(inCode, syntaxError, codeMessages, visualErrors)

  // A rejected non-string member blocks the Visual switch too - rendering it
  // would silently drop the member.
  const stringBlocksVisual = stringMap && stringCodeErrors.length > 0
  const visualLocked =
    inCode && (jsonError !== null || !codeValid || tableBlocksVisual || stringBlocksVisual)
  const visualLockTooltip =
    jsonError !== null || !codeValid || stringBlocksVisual ? FIX_JSON_TOOLTIP : FIX_TABLE_TOOLTIP

  const bodyData: ComplexValueBodyData = {
    type: type as ComplexEditorType,
    value,
    arrayTypes,
    mapTypes,
    tableSchema,
    tableWidths,
    mapEntry,
    mapExprKeys,
    onMapExprKeysChange,
    onChange,
    onValidChange,
    onArrayChange,
    onMapChange,
    onTableSchemaChange,
    onTableWidthsChange: setTableWidths,
    onTableValidation: setTableValidation,
    onVisualErrors: setVisualErrors,
    onCodeChange,
    onCodeValidChange,
    serialize,
    stringValuesOnly,
    itemType,
  }

  const storedElementTypes = useMemo(
    // A text-only map and a text-only or typed list store no element types.
    () =>
      stringMap || fixedItemType !== undefined
        ? undefined
        : declaredElementTypes(type, value, arrayTypes, mapTypes, { keys: typedExprKeys, indices: listExprs }),
    [type, value, stringMap, fixedItemType, arrayTypes, mapTypes, typedExprKeys, listExprs],
  )

  const storedValue = useMemo(
    () => (type === 'table' ? toStoredTable(value, tableSchema) : value),
    [type, value, tableSchema],
  )

  return {
    bodyData,
    stripMessage: strip.message,
    stripMessages: strip.messages,
    semanticInvalid: tableInvalid || codeSemanticInvalid || shapeInvalid,
    visualLocked,
    visualLockTooltip,
    formatBlocked: !codeValid || tableInvalid || codeSemanticInvalid || shapeInvalid,
    serializeDraftToCode,
    syncCodeText: () => setCodeText(serializeDraftToCode()),
    // The column types survive a Code -> Visual switch; the Code columns are settled once shown in Visual.
    seedTableSchema: () => setCodeColumns(false),
    markFormatted: () => {
      setCodeValid(true)
      onValidChange(true)
    },
    elementTypes: storedElementTypes,
    storedValue,
  }
}

/** The element types a host stores: one per array item ({x} items as text), or a typed map's literal rows. */
function declaredElementTypes(
  type: VariableType,
  value: unknown,
  arrayTypes: ValueType[],
  mapTypes: Record<string, ValueType>,
  exprs: CodeExpressions,
): ElementTypes | undefined {
  if (type === 'array') {
    if (!Array.isArray(value)) return undefined
    return resolveArrayTypes(value, arrayTypes).map((itemType, index) =>
      exprs.indices?.has(index) ? 'string' : itemType,
    )
  }
  if (type !== 'map' || !isPlainObject(value)) return undefined
  const types = resolveMapTypes(value, mapTypes)
  const exprKeys = exprs.keys
  if (exprKeys === undefined) return types
  return Object.fromEntries(Object.entries(types).filter(([key]) => !exprKeys.has(key)))
}
