/**
 * Per-type inspect-watcher geometry. Tune freely - the single source for how
 * big each type's watcher opens (and, where resizable, its resize floor) per
 * mode. Switching mode auto-resizes to the matching size until the user
 * drags/resizes.
 *
 * Compact scalars (boolean/integer/float) are fixed and non-resizable:
 * width === minWidth, height === minHeight. Each type has its own width: the
 * float group is widened so a long exact value shows on one line, and Compare
 * adds room for the per-row Initial/Current label.
 *
 *   single  = Initial / Current  (one value pane)
 *   compare = Compare            (Initial | Current panes + labels above values)
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import type { Variable } from '@/features/workbench/common/variables/variable-manager-content/types'
import type { ScriptMode } from '@/features/workbench/lib/python-script-validation/script-issues'
import type { InspectMode } from './mode-dropdown'

export interface SheetSize {
  width: number
  height: number
  minWidth: number
  minHeight: number
}

export interface ModeSizes {
  single: SheetSize
  compare: SheetSize
}

// boolean - the smallest watcher.
const BOOLEAN: ModeSizes = {
  single: { width: 220, height: 125, minWidth: 220, minHeight: 125 },
  compare: { width: 220, height: 155, minWidth: 220, minHeight: 155 },
}

// integer - 220 fits a 19-digit value (REQ-3.1.3.14).
const INTEGER: ModeSizes = {
  single: { width: 220, height: 125, minWidth: 220, minHeight: 125 },
  compare: { width: 280, height: 155, minWidth: 280, minHeight: 155 },
}

// float - wide enough for a long exact value on one line; Compare adds room for the row label.
const FLOAT: ModeSizes = {
  single: { width: 310, height: 125, minWidth: 310, minHeight: 125 },
  compare: { width: 350, height: 155, minWidth: 350, minHeight: 155 },
}

// string - resize floors; the watcher opens auto-fit up to 5 lines (`stringWatcherHeight`).
const STRING: ModeSizes = {
  single: { width: 400, height: 138, minWidth: 320, minHeight: 138 },
  compare: { width: 600, height: 160, minWidth: 460, minHeight: 160 },
}

// array - one value per row.
const ARRAY: ModeSizes = {
  single: { width: 400, height: 280, minWidth: 360, minHeight: 138 },
  compare: { width: 580, height: 320, minWidth: 460, minHeight: 158 },
}

// map - key/value rows.
const MAP: ModeSizes = {
  single: { width: 400, height: 280, minWidth: 360, minHeight: 172 },
  compare: { width: 580, height: 320, minWidth: 460, minHeight: 205 },
}

// table - columns + grid; the widest watchers.
const TABLE: ModeSizes = {
  single: { width: 520, height: 320, minWidth: 460, minHeight: 138 },
  compare: { width: 780, height: 360, minWidth: 620, minHeight: 185 },
}

// expression - a one-line cyan source field (+ autocomplete / expand).
const EXPRESSION: ModeSizes = {
  single: { width: 420, height: 190, minWidth: 360, minHeight: 170 },
  compare: { width: 580, height: 250, minWidth: 460, minHeight: 145 },
}

type SizeGroup =
  | 'boolean'
  | 'integer'
  | 'float'
  | 'string'
  | 'array'
  | 'map'
  | 'table'
  | 'expression'

const SHEET_SIZES: Record<SizeGroup, ModeSizes> = {
  boolean: BOOLEAN,
  integer: INTEGER,
  float: FLOAT,
  string: STRING,
  array: ARRAY,
  map: MAP,
  table: TABLE,
  expression: EXPRESSION,
}

// The compact scalar groups: each opens at a small per-type default and stacks
// the Initial/Current rows vertically in Compare (vs side-by-side panes for the
// complex types). They are width-resizable from that default (grow only).
const COMPACT_SCALAR_GROUPS = new Set<SizeGroup>(['boolean', 'integer', 'float'])

function sizeGroup(type: Variable['type'], isExpression: boolean): SizeGroup {
  if (isExpression) return 'expression'
  switch (type) {
    case 'string':
      return 'string'
    case 'array':
      return 'array'
    case 'map':
      return 'map'
    case 'table':
      return 'table'
    case 'integer':
      return 'integer'
    case 'float':
      return 'float'
    default:
      return 'boolean'
  }
}

// The window's width per kind; its height follows its fields, so it always fits them (VMGR-106, VMGR-110).
const WINDOW_WIDTHS: Record<'variable' | 'input' | 'output', { width: number; minWidth: number }> = {
  variable: { width: 410, minWidth: 410 },
  input: { width: 560, minWidth: 460 },
  output: { width: 560, minWidth: 460 },
}

/** The variable window's width for a mode. */
export function getCreateSheetWidth(mode: 'variable' | 'input' | 'output'): { width: number; minWidth: number } {
  return WINDOW_WIDTHS[mode]
}

// Watchers and windows open in one cascade: 24px per open sheet, wrapping every 8 (VMGR-15, VMGR-101).
const CASCADE_STEP_PX = 24
const CASCADE_WRAP = 8

/** The cascade offset of the sheet opened at a given index. */
export function cascadeOffset(index: number): number {
  return (index % CASCADE_WRAP) * CASCADE_STEP_PX
}

// Value-editor sheet geometry ("Edit value"): a pure value editor with no
// name/type/kind chrome, so it opens tighter than the create sheet. String fits
// the line-numbered editor; the complex types open with grid room and resize.
const VALUE_EDITOR_SIZES: Record<'string' | 'array' | 'map' | 'table', SheetSize> = {
  // VMGR-91: min width must clear the full string footer (Kind + Format +
  // Format button + Cancel + Save) so Save never lands outside the sheet.
  string: { width: 460, height: 300, minWidth: 440, minHeight: 220 },
  array: { width: 440, height: 420, minWidth: 385, minHeight: 320 },
  map: { width: 440, height: 420, minWidth: 385, minHeight: 320 },
  table: { width: 600, height: 460, minWidth: 480, minHeight: 360 },
}

// A script body is a code editor: wider and taller than any string, with maximize (PYRUN-13, SQL-10).
export const SCRIPT_VALUE_EDITOR_SIZE: SheetSize = {
  width: 720,
  height: 460,
  minWidth: 520,
  minHeight: 320,
}

// The SQL and OpenSearch footers also hold Kind, Format and the catalog chip; the floor is their open width so no label wraps (SQL-10, OS-12).
export const SQL_VALUE_EDITOR_SIZE: SheetSize = { ...SCRIPT_VALUE_EDITOR_SIZE, minWidth: 720 }

// A scaffolded map editor (note + actions row + strip) opens taller and wider so a
// several-row header set plus the validation strip fit without overlap.
const SCAFFOLDED_MAP_EDITOR_SIZE: SheetSize = {
  width: 480,
  height: 520,
  minWidth: 440,
  minHeight: 380,
}

/** The "Edit value" sheet geometry: a script body is a code editor, a scaffolded map
 *  editor opens on its own box, every other value opens by its type. */
export function getValueEditorSheetSize(
  type: Variable['type'],
  scriptMode: ScriptMode | null = null,
  scaffolded = false,
): SheetSize {
  if (scriptMode === 'python') return SCRIPT_VALUE_EDITOR_SIZE
  if (scriptMode !== null) return SQL_VALUE_EDITOR_SIZE
  if (scaffolded) return SCAFFOLDED_MAP_EDITOR_SIZE
  if (type === 'array') return VALUE_EDITOR_SIZES.array
  if (type === 'map') return VALUE_EDITOR_SIZES.map
  if (type === 'table') return VALUE_EDITOR_SIZES.table
  return VALUE_EDITOR_SIZES.string
}

/** The watcher geometry for a variable in a given inspect mode. */
export function getSheetSize(
  type: Variable['type'],
  isExpression: boolean,
  mode: InspectMode,
): SheetSize {
  const sizes = SHEET_SIZES[sizeGroup(type, isExpression)]
  return mode === 'compare' ? sizes.compare : sizes.single
}

/**
 * Whether a watcher is a compact scalar (boolean/integer/float): it stacks the
 * Initial/Current rows vertically in Compare. These open small and grow only.
 */
export function isCompactScalarWatcher(
  type: Variable['type'],
  isExpression: boolean,
): boolean {
  return COMPACT_SCALAR_GROUPS.has(sizeGroup(type, isExpression))
}

// String watcher auto-fit: a string opens sized to its content up to 5 lines
// (the editor fills + scrolls past that) and stays resizable, so the estimate
// below only sets the OPEN height - the user drags to fine-tune. Tunable.
const STRING_LINE_PX = 20 // matches plain-text-editor's line height
const STRING_MAX_LINES = 5
const STRING_CHAR_PX = 7.3 // ~13px mono advance
const STRING_GUTTER_PX = 30 // line-number gutter
const STRING_SIDE_PAD_PX = 24 // body / pane horizontal padding
const STRING_CHROME_SINGLE_PX = 105 // header + footer + body + editor padding
const STRING_CHROME_COMPARE_PX = 125 // + the per-pane label row

function estimateWrappedLines(text: string, contentWidthPx: number): number {
  const perLine = Math.max(1, Math.floor(contentWidthPx / STRING_CHAR_PX))
  return text
    .split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0)
}

/** Open height for a string watcher: chrome plus its content clamped to 5 lines (approximate). */
export function stringWatcherHeight(
  texts: string[],
  width: number,
  isCompare: boolean,
): number {
  const paneWidth = isCompare ? width / 2 : width
  const contentWidth = Math.max(40, paneWidth - STRING_GUTTER_PX - STRING_SIDE_PAD_PX)
  const lines = Math.min(
    STRING_MAX_LINES,
    Math.max(1, ...texts.map((text) => estimateWrappedLines(text, contentWidth))),
  )
  const chrome = isCompare ? STRING_CHROME_COMPARE_PX : STRING_CHROME_SINGLE_PX
  return chrome + lines * STRING_LINE_PX
}
