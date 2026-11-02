/**
 * TableEditBody - controlled table edit body for the inspect modal edit state.
 * Resizable, auto-fitting columns (shared useResizableColumns, same as the read
 * map/table grid) with an inline header per column: editable name field + colored
 * type pill + kebab (move/delete). A fixed 0-based "#" index and a per-row delete
 * bookend the data columns; "Add Row" / "Add Column" sit below. Accepts row-objects
 * or the {columns, rows} dict and emits row-objects; cell-type validation gates
 * validity.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { MoreVertical } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  TrashIcon,
} from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import { getValueColorClass } from '@/lib/variable-format'
import { numberEntryProps, takesEntryText } from '@/lib/number-entry'
import { toTableRenderModel } from '@/lib/variable-table-model'
import {
  defaultCellText,
  formatValue,
  inferColumnType,
  parseTableCell,
  validateTableCell,
  validateTableValue,
  type ColumnType,
  type TableColumnSchema,
  type TableValidationResult,
} from '@/lib/variable-validation'
import {
  replaceWidth,
  startColumnDrag,
} from '@/components/shared/variable-bodies/use-resizable-columns'
import {
  EDIT_COLUMN_WIDTH,
  EDIT_MIN_COLUMN_WIDTH,
  fitTableEditColumn,
  newTableColumnWidth,
} from '@/components/shared/variable-bodies/table-edit-widths'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { ENTRY_CONTROL_CLASS, EntryBox, NullChip } from '@/components/shared/variable-bodies/body-parts'
import { ScalarTypeSelect } from '@/components/shared/variable-bodies/scalar-type-select'
import { useStableKeys } from '@/components/shared/variable-bodies/use-stable-keys'

const INDEX_WIDTH = 40
const ACTIONS_WIDTH = 40

interface TableModel {
  headers: string[]
  types: ColumnType[]
  // A cell is typed text OR explicit null ("no value", distinct from "").
  rows: (string | null)[][]
}

export interface TableEditBodyProps {
  value: unknown
  /** Carried column schema - seeds types instead of re-inferring so an explicit
   *  Visual type survives a Visual -> Code -> Visual round trip. */
  schema?: TableColumnSchema[]
  /** Controlled column widths (host-owned, beside the schema): they survive a
   *  column add / remove / move and a Visual -> Code -> Visual round trip. */
  widths: number[]
  onWidthsChange: (widths: number[]) => void
  onChange: (value: Record<string, unknown>[]) => void
  onValidChange: (valid: boolean) => void
  onSchemaChange: (schema: TableColumnSchema[]) => void
  onValidation: (result: TableValidationResult) => void
}

function seedModel(value: unknown, schema?: TableColumnSchema[]): TableModel {
  const model = toTableRenderModel(value)
  const firstRow = model.rows[0] ?? []
  return {
    headers: model.columns.map((column) => column.name),
    types: model.columns.map((column, index) => {
      const carried = schema?.[index]?.type
      if (carried !== undefined) return carried
      return column.type === undefined
        ? inferColumnType(firstRow[index])
        : (column.type as ColumnType)
    }),
    rows: model.rows.map((row) =>
      model.columns.map((_, index) => {
        const cell = row[index]
        return cell == null ? null : formatValue(cell)
      }),
    ),
  }
}

function toRowObjects(model: TableModel): Record<string, unknown>[] {
  return model.rows.map((row) =>
    Object.fromEntries(
      model.headers.map((header, index) => [
        header,
        parseTableCell(row[index], model.types[index]),
      ]),
    ),
  )
}

function toSchema(model: TableModel): TableColumnSchema[] {
  return model.headers.map((name, index) => ({ name, type: model.types[index] }))
}

// A header input is marked red when its (trimmed) name is empty or shared with
// another column - the same rule validateTableValue gates on.
function headerHasError(headers: string[], index: number): boolean {
  const name = headers[index].trim()
  if (name === '') return true
  return headers.some((other, otherIndex) => otherIndex !== index && other.trim() === name)
}

interface ColumnMenuProps {
  index: number
  columnCount: number
  onMove: (index: number, delta: number) => void
  onDelete: (index: number) => void
}

function ColumnMenu({ index, columnCount, onMove, onDelete }: Readonly<ColumnMenuProps>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={`table-col-menu-${index}`}
          aria-label={`Column ${index + 1} options`}
          className="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <MoreVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(index, -1)}>
          <ChevronLeftIcon size={14} />
          Move left
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={index === columnCount - 1}
          onSelect={() => onMove(index, 1)}
        >
          <ChevronRightIcon size={14} />
          Move right
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={columnCount <= 1}
          onSelect={() => onDelete(index)}
          className="text-destructive focus:text-destructive"
        >
          <TrashIcon size={14} />
          Delete column
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const BOOLEAN_OPTIONS: readonly string[] = ['true', 'false']

interface CellEditorProps {
  cell: string | null
  type: ColumnType
  rowIndex: number
  colIndex: number
  headerName: string
  onText: (text: string) => void
  onNull: () => void
}

/** One table cell in the row box, its ∅ inside: the null chip, a true / false selector or a typed text input. */
function CellEditor({
  cell,
  type,
  rowIndex,
  colIndex,
  headerName,
  onText,
  onNull,
}: Readonly<CellEditorProps>) {
  const testid = `table-cell-${rowIndex}-${colIndex}`
  const label = headerName.trim() === '' ? `Row ${rowIndex} column ${colIndex + 1}` : `Row ${rowIndex} ${headerName}`
  const enterValue = () => onText(defaultCellText(type))
  const error = cell === null ? null : validateTableCell(cell, type)
  let field: ReactNode
  if (cell === null) {
    field = <NullChip label={label} testId={testid} onEnterValue={enterValue} className={ENTRY_CONTROL_CLASS} />
  } else if (type === 'boolean' && error === null) {
    field = (
      <Select value={cell} onValueChange={onText}>
        <SelectTrigger
          data-testid={testid}
          aria-label={label}
          className={cn(ENTRY_CONTROL_CLASS, 'font-mono', getValueColorClass('boolean'))}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BOOLEAN_OPTIONS.map((option) => (
            <SelectItem key={option} value={option} className="font-mono text-xs">
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  } else {
    field = (
      <input
        data-testid={testid}
        aria-label={label}
        aria-invalid={error ? 'true' : undefined}
        autoComplete="off"
        spellCheck={false}
        {...numberEntryProps(type)}
        value={cell}
        onChange={(event) => {
          const next = event.target.value
          // int/float cells hard-stop invalid chars + over-cap length at the input,
          // matching the scalar editor (never just flagged red after the fact).
          if (!takesEntryText(next, type)) return
          onText(next)
        }}
        className={cn(ENTRY_CONTROL_CLASS, 'font-mono', error ? 'text-destructive' : getValueColorClass(type))}
      />
    )
  }
  return (
    <EntryBox
      nullButton={{
        label,
        pressed: cell === null,
        onClick: cell === null ? enterValue : onNull,
        testId: `${testid}-null`,
      }}
    >
      {field}
    </EntryBox>
  )
}

export function TableEditBody({
  value,
  schema,
  widths,
  onWidthsChange,
  onChange,
  onValidChange,
  onSchemaChange,
  onValidation,
}: Readonly<TableEditBodyProps>) {
  const [model, setModel] = useState<TableModel>(() => seedModel(value, schema))
  const colKeys = useStableKeys(model.headers.length)
  const rowKeys = useStableKeys(model.rows.length)
  // The latest widths for the drag handler, which is registered once per drag
  // and would otherwise close over the widths from the mousedown render.
  const widthsRef = useRef(widths)
  widthsRef.current = widths

  const emitValue = (next: TableModel) => {
    setModel(next)
    onChange(toRowObjects(next))
    const result = validateTableValue(next)
    onValidChange(result.valid)
    onValidation(result)
  }
  // Column-shape edits also re-emit the carried schema so the host (and the Code
  // view) keep the authoritative column names + types.
  const emitColumns = (next: TableModel) => {
    emitValue(next)
    onSchemaChange(toSchema(next))
  }
  const updateCell = (rowIndex: number, colIndex: number, text: string) =>
    emitValue({
      ...model,
      rows: model.rows.map((row, r) =>
        r === rowIndex ? row.map((cell, c) => (c === colIndex ? text : cell)) : row,
      ),
    })
  const setCellNull = (rowIndex: number, colIndex: number) =>
    emitValue({
      ...model,
      rows: model.rows.map((row, r) =>
        r === rowIndex ? row.map((cell, c) => (c === colIndex ? null : cell)) : row,
      ),
    })
  const updateHeader = (colIndex: number, text: string) =>
    emitColumns({ ...model, headers: model.headers.map((h, c) => (c === colIndex ? text : h)) })
  const updateType = (colIndex: number, type: ColumnType) =>
    emitColumns({ ...model, types: model.types.map((t, c) => (c === colIndex ? type : t)) })
  const addRow = () =>
    emitValue({
      ...model,
      rows: [...model.rows, model.types.map((type) => defaultCellText(type))],
    })
  const removeRow = (rowIndex: number) =>
    emitValue({ ...model, rows: model.rows.filter((_, r) => r !== rowIndex) })
  const addColumn = () => {
    const name = `Column ${model.headers.length + 1}`
    emitColumns({
      headers: [...model.headers, name],
      types: [...model.types, 'string'],
      rows: model.rows.map((row) => [...row, '']),
    })
    onWidthsChange([...widths, newTableColumnWidth(name)])
  }
  const deleteColumn = (colIndex: number) => {
    emitColumns({
      headers: model.headers.filter((_, c) => c !== colIndex),
      types: model.types.filter((_, c) => c !== colIndex),
      rows: model.rows.map((row) => row.filter((_, c) => c !== colIndex)),
    })
    onWidthsChange(widths.filter((_, c) => c !== colIndex))
  }
  const moveColumn = (colIndex: number, delta: number) => {
    const target = colIndex + delta
    const swap = <T,>(list: T[]): T[] => {
      const next = [...list]
      const held = next[colIndex]
      next[colIndex] = next[target]
      next[target] = held
      return next
    }
    emitColumns({
      headers: swap(model.headers),
      types: swap(model.types),
      rows: model.rows.map((row) => swap(row)),
    })
    onWidthsChange(swap(widths))
  }

  // Controlled resize / fit: the drag handle reports each clamped width up and a
  // double-click reports the auto-fit width; the host owns the widths array.
  const startResize = (index: number, event: ReactMouseEvent) =>
    startColumnDrag(event, widths[index], EDIT_MIN_COLUMN_WIDTH, (width) =>
      onWidthsChange(replaceWidth(widthsRef.current, index, width)),
    )
  const fitColumn = (index: number) =>
    onWidthsChange(replaceWidth(widths, index, fitTableEditColumn(model.headers, model.rows, index)))

  const totalWidth =
    INDEX_WIDTH +
    ACTIONS_WIDTH +
    model.headers.reduce((sum, _header, index) => sum + (widths[index] ?? EDIT_COLUMN_WIDTH), 0)

  const headerCellClass =
    'sticky top-0 z-10 border-b border-border/60 bg-muted px-2 py-2 align-top'

  return (
    <div data-testid="table-edit-body" className="flex h-full flex-col">
      <div className="min-h-0 grow scroll-pt-12 overflow-auto overscroll-contain rounded-lg border">
        <table
          className="border-collapse text-sm"
          style={{ tableLayout: 'fixed', width: `${totalWidth}px` }}
        >
          <colgroup>
            <col style={{ width: `${INDEX_WIDTH}px` }} />
            {model.headers.map((_header, colIndex) => (
              <col
                key={colKeys[colIndex]}
                style={{ width: `${widths[colIndex] ?? EDIT_COLUMN_WIDTH}px` }}
              />
            ))}
            <col style={{ width: `${ACTIONS_WIDTH}px` }} />
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                aria-label="Row index"
                className="sticky top-0 z-10 border-b border-border/60 bg-muted px-2 py-2 text-right align-bottom text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
              >
                #
              </th>
              {model.headers.map((header, colIndex) => {
                const columnType = model.types[colIndex]
                const headerError = headerHasError(model.headers, colIndex)
                return (
                  // `sticky` is the positioning context for the absolute resize
                  // handle - do NOT add `relative` (tailwind-merge drops `sticky`).
                  <th key={colKeys[colIndex]} scope="col" className={headerCellClass}>
                    <div className="flex items-center gap-1.5">
                      <input
                        data-testid={`table-header-${colIndex}`}
                        aria-label={`Column ${colIndex + 1} name`}
                        aria-invalid={headerError ? 'true' : undefined}
                        autoComplete="off"
                        spellCheck={false}
                        value={header}
                        onChange={(event) => updateHeader(colIndex, event.target.value)}
                        className={cn(
                          'min-w-0 flex-1 rounded-md border bg-background px-2 py-1 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                          headerError && 'border-destructive text-destructive',
                        )}
                      />
                      <ScalarTypeSelect
                        value={columnType}
                        onChange={(next) => updateType(colIndex, next as ColumnType)}
                        testId={`table-type-${colIndex}`}
                        label={`Column ${colIndex + 1} type`}
                      />
                      <ColumnMenu
                        index={colIndex}
                        columnCount={model.headers.length}
                        onMove={moveColumn}
                        onDelete={deleteColumn}
                      />
                    </div>
                    <ConditionalTooltip content="Drag to resize, double-click to fit">
                    <span
                      data-testid={`table-edit-col-resize-${colIndex}`}
                      aria-hidden="true"
                      onMouseDown={(event) => startResize(colIndex, event)}
                      onDoubleClick={() => fitColumn(colIndex)}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/30"
                    />
                    </ConditionalTooltip>
                  </th>
                )
              })}
              <th
                scope="col"
                aria-label="Row actions"
                className="sticky top-0 z-10 border-b border-border/60 bg-muted px-1 py-2"
              />
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row, rowIndex) => (
              <tr key={rowKeys[rowIndex]} className="border-b border-border/40 last:border-b-0">
                <td
                  data-testid={`table-row-index-${rowIndex}`}
                  className="px-2 py-1 text-right align-top font-mono text-xs text-muted-foreground"
                >
                  {rowIndex}
                </td>
                {row.map((cell, colIndex) => (
                  <td key={`cell-${rowIndex}-${colIndex}`} className="px-1 py-1 align-top">
                    <CellEditor
                      cell={cell}
                      type={model.types[colIndex]}
                      rowIndex={rowIndex}
                      colIndex={colIndex}
                      headerName={model.headers[colIndex]}
                      onText={(text) => updateCell(rowIndex, colIndex, text)}
                      onNull={() => setCellNull(rowIndex, colIndex)}
                    />
                  </td>
                ))}
                <td className="px-1 py-1 text-center align-top">
                  <button
                    type="button"
                    data-testid={`table-remove-row-${rowIndex}`}
                    aria-label={`Remove row ${rowIndex}`}
                    onClick={() => removeRow(rowIndex)}
                    className="rounded-sm p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <TrashIcon size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="table-add-row"
          className="h-7 gap-1 px-2 text-xs text-indigo-500 hover:text-indigo-600"
          onClick={addRow}
        >
          <ChevronDownIcon size={14} />
          Add Row
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="table-add-column"
          className="h-7 gap-1 px-2 text-xs text-indigo-500 hover:text-indigo-600"
          onClick={addColumn}
        >
          <ChevronRightIcon size={14} />
          Add Column
        </Button>
      </div>
    </div>
  )
}
