/**
 * The mode adapter of the one field: where a field's {x}, Template, entry {x} and element types live, and the
 * dotted-flag math every host shares (whole field `name`, entry `name.<key>`, ordered row `<field>.<i>.<rowKey>`).
 * REQ-3.1.1.5, REQ-3.1.3.19; FIELD-6, FIELD-13
 */

import type { ElementTypes } from '@/lib/variable-validation'
import type { LiteralAssertion } from '@/features/workbench/common/config/assertion-builder/types'
import type { VariableRow } from '@/features/workbench/common/variables/variable-setter-editor/types'

/** How one field is held: what the cell reads and the writes it makes. Keys are relative to the field. */
export interface FieldModes {
  /** The whole field is {x}. */
  expression: boolean
  /** The whole field is a Template (text only; never with `expression`). */
  template: boolean
  /** First-level entries held as {x}: a list index as text or a map key. */
  entryExpressions: readonly string[]
  /** Declared entry types of a list or map value (REQ-3.1.3.19). */
  elementTypes: ElementTypes | undefined
  /** Sets whole-field {x}; one call also clears Template, entry {x} and element types. */
  setExpression: (pressed: boolean) => void
  setTemplate: (on: boolean) => void
  setEntryExpressions: (keys: readonly string[]) => void
  setElementTypes: (types: ElementTypes | undefined) => void
}

/** A Block's flag lists and their sinks, as a window keeps them. */
export interface BlockFieldLists {
  expressionFields: readonly string[]
  onExpressionFieldsChange: (fields: string[]) => void
  templateFields: readonly string[]
  onTemplateFieldsChange: (fields: string[]) => void
  /** This field's element types. */
  elementTypes?: ElementTypes
  onElementTypesChange?: (types: ElementTypes | undefined) => void
}

/** A row change of an ordered list: a move swaps two neighbors, an add inserts one, a delete takes one out. */
export type IndexedRowChange =
  | { kind: 'move'; from: number; to: number }
  | { kind: 'add'; at: number }
  | { kind: 'delete'; at: number }

const NO_KEYS: readonly string[] = []
const NOTHING = () => {}

/** The entries held as {x} under a field: what follows `<name>.` in each flag. */
export function entryFlagsFor(name: string, flags: readonly string[]): string[] {
  const prefix = `${name}.`
  return flags.filter((flag) => flag.startsWith(prefix)).map((flag) => flag.slice(prefix.length))
}

/** The flags with this field's entries replaced by `keys`; other fields and the whole-field flag stay. */
export function withEntryFlags(name: string, flags: readonly string[], keys: readonly string[]): string[] {
  const prefix = `${name}.`
  return [...flags.filter((flag) => !flag.startsWith(prefix)), ...keys.map((key) => `${prefix}${key}`)]
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function rowFlagPattern(field: string, rowKey: string): RegExp {
  return new RegExp(String.raw`^${escapeRegExp(field)}\.(\d+)\.${escapeRegExp(rowKey)}$`)
}

function rowFlag(field: string, rowKey: string, index: number): string {
  return `${field}.${index}.${rowKey}`
}

/** The row indices of an ordered list whose `<field>.<i>.<rowKey>` flag is set. */
export function indexedRowFlagsFor(field: string, rowKey: string, flags: readonly string[]): Set<number> {
  const pattern = rowFlagPattern(field, rowKey)
  const rows = new Set<number>()
  for (const flag of flags) {
    const match = pattern.exec(flag)
    if (match) rows.add(Number(match[1]))
  }
  return rows
}

/** A sheet save of an ordered list: every dotted flag of the field gives way to one flag per given row. */
export function withIndexedRowFlags(
  field: string,
  rowKey: string,
  flags: readonly string[],
  rows: Iterable<number>,
): string[] {
  const prefix = `${field}.`
  return [...flags.filter((flag) => !flag.startsWith(prefix)), ...[...rows].map((row) => rowFlag(field, rowKey, row))]
}

/** Where a row lands after the change, or null for the row a delete takes out. */
function movedIndex(index: number, change: IndexedRowChange): number | null {
  if (change.kind === 'move') {
    if (index === change.from) return change.to
    return index === change.to ? change.from : index
  }
  // A row added at `at` pushes the rows from there down by one.
  if (change.kind === 'add') return index + Number(index >= change.at)
  if (index === change.at) return null
  return index > change.at ? index - 1 : index
}

/** The row flags of an ordered list follow their rows through a move, add or delete. */
export function rekeyIndexedFlags(
  flags: readonly string[],
  field: string,
  rowKey: string,
  change: IndexedRowChange,
): string[] {
  const pattern = rowFlagPattern(field, rowKey)
  return flags.flatMap((flag) => {
    const match = pattern.exec(flag)
    if (!match) return [flag]
    const next = movedIndex(Number(match[1]), change)
    return next === null ? [] : [rowFlag(field, rowKey, next)]
  })
}

/** A Block field's modes in the Block lists: `name`, `name.<key>` and its element types. */
export function blockFieldModes(name: string, lists: BlockFieldLists): FieldModes {
  const { expressionFields, templateFields, elementTypes } = lists
  const prefix = `${name}.`
  return {
    expression: expressionFields.includes(name),
    template: templateFields.includes(name),
    entryExpressions: entryFlagsFor(name, expressionFields),
    elementTypes,
    setExpression: (pressed) => {
      const others = expressionFields.filter((flag) => flag !== name && !flag.startsWith(prefix))
      lists.onExpressionFieldsChange(pressed ? [...others, name] : others)
      // Kinds are mutually exclusive: an expression cannot also be a template.
      if (templateFields.includes(name)) lists.onTemplateFieldsChange(templateFields.filter((field) => field !== name))
      if (elementTypes !== undefined) lists.onElementTypesChange?.(undefined)
    },
    setTemplate: (on) => {
      const others = templateFields.filter((field) => field !== name)
      lists.onTemplateFieldsChange(on ? [...others, name] : others)
    },
    setEntryExpressions: (keys) => lists.onExpressionFieldsChange(withEntryFlags(name, expressionFields, keys)),
    setElementTypes: (types) => lists.onElementTypesChange?.(types),
  }
}

/** One ordered row's {x} in the Block list: `<field>.<index>.<rowKey>` (Parts `value`, Parallel lanes `time_limit`). */
export function indexedRowModes(
  field: string,
  rowKey: string,
  index: number,
  lists: Pick<BlockFieldLists, 'expressionFields' | 'onExpressionFieldsChange'>,
): FieldModes {
  const { expressionFields } = lists
  const flag = rowFlag(field, rowKey, index)
  return {
    expression: indexedRowFlagsFor(field, rowKey, expressionFields).has(index),
    template: false,
    entryExpressions: NO_KEYS,
    elementTypes: undefined,
    // The one row's flag only: the other dotted flags of the field stay.
    setExpression: (pressed) => {
      const others = expressionFields.filter((entry) => entry !== flag)
      lists.onExpressionFieldsChange(pressed ? [...others, flag] : others)
    },
    setTemplate: NOTHING,
    setEntryExpressions: NOTHING,
    setElementTypes: NOTHING,
  }
}

/** A compare value's flags inside its condition item; setting one clears the other. */
export function conditionValueModes(
  row: LiteralAssertion,
  onRow: (patch: Partial<LiteralAssertion>) => void,
): FieldModes {
  return {
    expression: row.reference_is_expression === true,
    template: row.reference_is_template === true,
    entryExpressions: NO_KEYS,
    elementTypes: undefined,
    setExpression: (pressed) => onRow({ reference_is_expression: pressed, reference_is_template: false }),
    setTemplate: (on) => onRow({ reference_is_template: on, reference_is_expression: false }),
    setEntryExpressions: NOTHING,
    setElementTypes: NOTHING,
  }
}

const EXPRESSION_ONLY: FieldModes = {
  expression: true,
  template: false,
  entryExpressions: NO_KEYS,
  elementTypes: undefined,
  setExpression: NOTHING,
  setTemplate: NOTHING,
  setEntryExpressions: NOTHING,
  setElementTypes: NOTHING,
}

/** The expression condition row: always {x}, nothing to write. */
export function expressionOnlyModes(): FieldModes {
  return EXPRESSION_ONLY
}

/** A Setter row's own flags; the editor writes them to the `variables.<row>` places. */
export function setterRowModes(row: VariableRow, onRow: (patch: Partial<VariableRow>) => void): FieldModes {
  return {
    expression: row.isExpression,
    template: row.isTemplate === true,
    entryExpressions: row.entryExpressions ?? NO_KEYS,
    elementTypes: row.elementTypes,
    setExpression: (pressed) =>
      onRow({ isExpression: pressed, isTemplate: false, entryExpressions: [], elementTypes: undefined }),
    setTemplate: (on) => onRow({ isTemplate: on }),
    setEntryExpressions: (keys) => onRow({ entryExpressions: [...keys] }),
    setElementTypes: (types) => onRow({ elementTypes: types }),
  }
}

/** The text a blank {x} entry shows: a list row counted from 1, a map key by name (FIELD-13). */
export function blankEntryMessage(setting: string, held: unknown, key: string): string {
  return Array.isArray(held) ? `Row ${Number(key) + 1} in '${setting}' is required` : `'${key}' in '${setting}' is required`
}
