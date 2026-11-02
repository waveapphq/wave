/**
 * Tests for TableEditBody - the controlled table edit body used by the inspect
 * modal's edit state. Editable headers (name input + full-name
 * type select) + read-only 0-based "#" index + type-tinted cells + per-column
 * kebab menu (move/delete) + add column/row + per-row delete, on the shared body.
 * Reuses the promoted cell validators.
 *
 * Contract under test:
 *   - controlled: renders the draft (row-objects OR {columns,rows} dict via the
 *     normalized model), emits onChange(rowObjects); never saves
 *   - "#" row-index header + per-column name input + full-name type select +
 *     per-column kebab (Move left / Move right / Delete column)
 *   - Delete column disabled at one column; Move left/right disabled at the ends
 *   - add column / add row / per-row delete
 *   - cell-type validation: an invalid cell emits onValidChange(false) and
 *     marks the cell aria-invalid
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { useState } from 'react'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { TableEditBody } from '@/components/shared/variable-bodies/table-edit-body'
import { seedTableEditWidthsFromValue } from '@/components/shared/variable-bodies/table-edit-widths'
import type {
  TableColumnSchema,
  TableValidationResult,
} from '@/lib/variable-validation'

type RowObjects = Record<string, unknown>[]

interface RenderOptions {
  value?: unknown
  schema?: TableColumnSchema[]
  onChange?: (value: RowObjects) => void
  onValidChange?: (valid: boolean) => void
  onSchemaChange?: (schema: TableColumnSchema[]) => void
  onValidation?: (result: TableValidationResult) => void
}

const TWO_COL: RowObjects = [
  { id: 1, name: 'alpha' },
  { id: 2, name: 'beta' },
]

function renderBody({
  value = TWO_COL,
  schema,
  onChange = vi.fn(),
  onValidChange = vi.fn(),
  onSchemaChange = vi.fn(),
  onValidation = vi.fn(),
}: RenderOptions = {}) {
  // The body is controlled: a stateful host seeds the column widths from the
  // value and holds them, mirroring useComplexValueEditor (so widths survive a
  // column add / remove / move instead of re-seeding).
  function Harness() {
    const [widths, setWidths] = useState<number[]>(() => seedTableEditWidthsFromValue(value))
    return (
      <TableEditBody
        value={value}
        schema={schema}
        widths={widths}
        onWidthsChange={setWidths}
        onChange={onChange}
        onValidChange={onValidChange}
        onSchemaChange={onSchemaChange}
        onValidation={onValidation}
      />
    )
  }
  const view = render(<Harness />)
  return { onChange, onValidChange, onSchemaChange, onValidation, container: view.container }
}

/** Width of the first DATA column (colgroup[1]; colgroup[0] is the "#" index). */
function firstDataColWidth(container: HTMLElement): string {
  return (container.querySelectorAll('col')[1] as HTMLElement).style.width
}

function lastCall(onChange: (value: RowObjects) => void): RowObjects {
  return (onChange as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(
    -1,
  )?.[0] as RowObjects
}

async function openColumnMenu(
  user: ReturnType<typeof userEvent.setup>,
  col: number,
) {
  await user.click(screen.getByTestId(`table-col-menu-${col}`))
}

describe('TableEditBody - structure', () => {
  it('renders an editable header input per column seeded from the model', () => {
    renderBody()
    expect(screen.getByTestId('table-header-0')).toHaveValue('id')
    expect(screen.getByTestId('table-header-1')).toHaveValue('name')
  })

  it('renders a full-name type select per column reflecting the inferred type', () => {
    renderBody()
    expect(screen.getByTestId('table-type-0')).toHaveTextContent('integer')
    expect(screen.getByTestId('table-type-1')).toHaveTextContent('string')
  })

  it('renders a read-only 0-based "#" index cell per row', () => {
    renderBody()
    expect(
      screen.getAllByTestId(/^table-row-index-/).map((el) => el.textContent),
    ).toEqual(['0', '1'])
  })

  it('accepts the {columns, rows} dict shape', () => {
    renderBody({
      value: {
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'name', type: 'string' },
        ],
        rows: [[1, 'alpha']],
      },
    })
    expect(screen.getByTestId('table-header-0')).toHaveValue('id')
    expect(screen.getByTestId('table-cell-0-1')).toHaveValue('alpha')
  })
})

describe('TableEditBody - cell editing', () => {
  it('emits the row objects when a cell changes (parsed by column type)', () => {
    const { onChange } = renderBody()
    fireEvent.change(screen.getByTestId('table-cell-0-1'), {
      target: { value: 'gamma' },
    })
    expect(lastCall(onChange)).toEqual([
      { id: '1', name: 'gamma' },
      { id: '2', name: 'beta' },
    ])
  })

  it('keeps an integer-column cell as an exact digit-string (precision past 2^53)', () => {
    const { onChange } = renderBody({ value: [{ id: 1, name: 'alpha' }] })
    fireEvent.change(screen.getByTestId('table-cell-0-0'), {
      target: { value: '1234567890123456789' },
    })
    expect(lastCall(onChange)).toEqual([{ id: '1234567890123456789', name: 'alpha' }])
  })

  it('hard-stops an invalid char and an over-cap length at the input (never just flagged)', () => {
    renderBody({
      value: [{ id: 1, rate: '0.5' }],
      schema: [
        { name: 'id', type: 'integer' },
        { name: 'rate', type: 'float' },
      ],
    })
    const intCell = screen.getByTestId('table-cell-0-0')
    fireEvent.change(intCell, { target: { value: 'abc' } }) // non-numeric -> dropped
    expect(intCell).toHaveValue('1')
    fireEvent.change(intCell, { target: { value: '1'.repeat(20) } }) // > 19 digits -> dropped
    expect(intCell).toHaveValue('1')

    const floatCell = screen.getByTestId('table-cell-0-1')
    fireEvent.change(floatCell, { target: { value: 'x' } }) // non-numeric -> dropped
    expect(floatCell).toHaveValue('0.5')
    fireEvent.change(floatCell, { target: { value: `0.${'1'.repeat(29)}` } }) // > 28 sig digits
    expect(floatCell).toHaveValue('0.5')
  })
})

describe('TableEditBody - cell-type validation', () => {
  it('flags an incomplete integer cell (a lone sign) - reachable past the input guard', () => {
    const { onValidChange } = renderBody({ value: [{ id: 1 }] })
    fireEvent.change(screen.getByTestId('table-cell-0-0'), {
      target: { value: '-' },
    })
    expect(onValidChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByTestId('table-cell-0-0')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('returns to onValidChange(true) once the cell is valid again', () => {
    const { onValidChange } = renderBody({ value: [{ id: 1 }] })
    const cell = screen.getByTestId('table-cell-0-0')
    fireEvent.change(cell, { target: { value: 'abc' } })
    fireEvent.change(cell, { target: { value: '5' } })
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })
})

describe('TableEditBody - rows', () => {
  it('appends a row on "+ Add row"', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: [{ id: 1 }] })
    await user.click(screen.getByTestId('table-add-row'))
    expect(lastCall(onChange)).toHaveLength(2)
  })

  it('removes the targeted row', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody()
    await user.click(screen.getByTestId('table-remove-row-0'))
    expect(lastCall(onChange)).toEqual([{ id: '2', name: 'beta' }])
  })
})

describe('TableEditBody - columns', () => {
  it('adds a new column header on "+ add column"', async () => {
    const user = userEvent.setup()
    renderBody({ value: [{ id: 1 }] })
    expect(screen.getAllByTestId(/^table-header-/)).toHaveLength(1)
    await user.click(screen.getByTestId('table-add-column'))
    expect(screen.getAllByTestId(/^table-header-/)).toHaveLength(2)
  })

  it('deletes a column via its kebab menu, dropping the key from every row', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: [{ id: 1, name: 'alpha' }] })
    await openColumnMenu(user, 0)
    await user.click(await screen.findByRole('menuitem', { name: 'Delete column' }))
    expect(lastCall(onChange)).toEqual([{ name: 'alpha' }])
  })

  it('disables Delete column when only one column remains', async () => {
    const user = userEvent.setup()
    renderBody({ value: [{ only: 1 }] })
    await openColumnMenu(user, 0)
    expect(
      await screen.findByRole('menuitem', { name: 'Delete column' }),
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('moves a column right via its kebab menu, reordering the headers', async () => {
    const user = userEvent.setup()
    renderBody()
    await openColumnMenu(user, 0)
    await user.click(await screen.findByRole('menuitem', { name: 'Move right' }))
    expect(screen.getByTestId('table-header-0')).toHaveValue('name')
    expect(screen.getByTestId('table-header-1')).toHaveValue('id')
  })

  it('disables Move left on the first column and Move right on the last column', async () => {
    const user = userEvent.setup()
    renderBody()
    await openColumnMenu(user, 0)
    expect(
      await screen.findByRole('menuitem', { name: 'Move left' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('menuitem', { name: 'Move right' }),
    ).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('moves a column left via its kebab menu, reordering the headers', async () => {
    const user = userEvent.setup()
    renderBody()
    await openColumnMenu(user, 1)
    await user.click(await screen.findByRole('menuitem', { name: 'Move left' }))
    expect(screen.getByTestId('table-header-0')).toHaveValue('name')
    expect(screen.getByTestId('table-header-1')).toHaveValue('id')
  })
})

describe('TableEditBody - header + type editing', () => {
  it('renames a column header, re-keying the emitted row objects', () => {
    const { onChange } = renderBody({ value: [{ id: 1, name: 'alpha' }] })
    fireEvent.change(screen.getByTestId('table-header-0'), {
      target: { value: 'ident' },
    })
    expect(lastCall(onChange)).toEqual([{ ident: '1', name: 'alpha' }])
  })

  it('changes a column type via the type select', async () => {
    const user = userEvent.setup()
    renderBody({ value: [{ id: 1, name: 'alpha' }] })
    await user.click(screen.getByTestId('table-type-0'))
    await user.click(await screen.findByRole('option', { name: 'string' }))
    expect(screen.getByTestId('table-type-0')).toHaveTextContent('string')
  })

  it('accepts an empty {columns, rows} dict (no rows)', () => {
    renderBody({
      value: { columns: [{ name: 'id', type: 'integer' }], rows: [] },
    })
    expect(screen.getByTestId('table-header-0')).toHaveValue('id')
    expect(screen.getByTestId('table-type-0')).toHaveTextContent('integer')
  })
})

describe('TableEditBody - resizable columns', () => {
  it('renders a drag handle on each data column', () => {
    renderBody() // two data columns
    expect(screen.getByTestId('table-edit-col-resize-0')).toBeInTheDocument()
    expect(screen.getByTestId('table-edit-col-resize-1')).toBeInTheDocument()
  })

  it('grows a column when its handle is dragged', () => {
    const { container } = renderBody()
    expect(firstDataColWidth(container)).toBe('180px') // no-metrics fallback
    fireEvent.mouseDown(screen.getByTestId('table-edit-col-resize-0'), { clientX: 0 })
    fireEvent.mouseMove(document, { clientX: 60 })
    fireEvent.mouseUp(document)
    expect(firstDataColWidth(container)).toBe('240px')
  })

  it('clamps a dragged column at the inline-header minimum (180px)', () => {
    const { container } = renderBody()
    fireEvent.mouseDown(screen.getByTestId('table-edit-col-resize-0'), { clientX: 0 })
    fireEvent.mouseMove(document, { clientX: -10000 })
    fireEvent.mouseUp(document)
    expect(firstDataColWidth(container)).toBe('180px')
  })
})

describe('TableEditBody - auto-fit columns', () => {
  beforeAll(() => {
    // jsdom has no canvas text metrics; stub measureText (width = chars * 8) so
    // the auto-fit path runs (other tests use the no-metrics fallback width).
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText: (text: string) => ({ width: text.length * 8 }),
    } as unknown as CanvasRenderingContext2D)
  })
  afterAll(() => {
    vi.restoreAllMocks()
  })

  // header "a_descriptive_column" = 20 * 8 = 160, + 140 inline-control room = 300;
  // + 16 pad + 8 buffer = 324 (drives the fit past the short "1" cell).
  const FIT = '324px'

  it('auto-fits a column to its header plus inline-control room by default', () => {
    const { container } = renderBody({ value: [{ a_descriptive_column: 1 }] })
    expect(firstDataColWidth(container)).toBe(FIT)
  })

  it('treats a null cell as "null" when fitting (header still dominates)', () => {
    const { container } = renderBody({
      value: [{ a_descriptive_column: null }],
      schema: [{ name: 'a_descriptive_column', type: 'integer' }],
    })
    expect(firstDataColWidth(container)).toBe(FIT)
  })

  it('re-fits a manually-resized column on double-click', () => {
    const { container } = renderBody({ value: [{ a_descriptive_column: 1 }] })
    fireEvent.mouseDown(screen.getByTestId('table-edit-col-resize-0'), { clientX: 0 })
    fireEvent.mouseMove(document, { clientX: 100 })
    fireEvent.mouseUp(document)
    expect(firstDataColWidth(container)).toBe('424px')
    fireEvent.doubleClick(screen.getByTestId('table-edit-col-resize-0'))
    expect(firstDataColWidth(container)).toBe(FIT)
  })
})

// ===========================================================================
// VMGR-81: the column widths are controlled - they live above the
// body so a resized width survives an add / remove / move column (which used
// to re-seed every width) and a Visual -> Code -> Visual round trip. The body
// transforms the widths array in place and reports it up.
//
// REQ-3.1.3.11: Variable watching UI panel
// ===========================================================================

function dataColWidth(container: HTMLElement, dataIndex: number): string {
  return (container.querySelectorAll('col')[dataIndex + 1] as HTMLElement).style.width
}

function dragColumn(dataIndex: number, byPx: number): void {
  fireEvent.mouseDown(screen.getByTestId(`table-edit-col-resize-${dataIndex}`), { clientX: 0 })
  fireEvent.mouseMove(document, { clientX: byPx })
  fireEvent.mouseUp(document)
}

describe('TableEditBody - controlled widths persist (VMGR-81)', () => {
  it('keeps a resized width when a column is added', async () => {
    const user = userEvent.setup()
    const { container } = renderBody() // two 180px data columns
    dragColumn(0, 60)
    expect(dataColWidth(container, 0)).toBe('240px')
    await user.click(screen.getByTestId('table-add-column'))
    expect(dataColWidth(container, 0)).toBe('240px') // not re-seeded to 180
  })

  it('appends a fitted width for the newly added column', async () => {
    const user = userEvent.setup()
    const { container } = renderBody({ value: [{ id: 1 }] }) // one column
    await user.click(screen.getByTestId('table-add-column'))
    expect(dataColWidth(container, 1)).toBe('180px') // new column at the min
  })

  it('keeps the surviving width when a column is deleted', async () => {
    const user = userEvent.setup()
    const { container } = renderBody() // cols [id, name]
    dragColumn(1, 60) // widen the second column to 240
    await openColumnMenu(user, 0)
    await user.click(await screen.findByRole('menuitem', { name: 'Delete column' }))
    expect(dataColWidth(container, 0)).toBe('240px') // 240 follows the survivor
  })

  it('keeps a resized width with its column when moved', async () => {
    const user = userEvent.setup()
    const { container } = renderBody() // cols [id, name]
    dragColumn(0, 60) // widen the first column to 240
    await openColumnMenu(user, 0)
    await user.click(await screen.findByRole('menuitem', { name: 'Move right' }))
    expect(dataColWidth(container, 0)).toBe('180px') // formerly-second column
    expect(dataColWidth(container, 1)).toBe('240px') // the 240 width moved with it
  })

  it('falls back to the default width for a column with no provided width', () => {
    // Fewer widths than columns (e.g. a Code edit grew the table while the host
    // widths lagged): the unprovided column renders at the default, not undefined.
    const view = render(
      <TableEditBody
        value={[{ id: 1, name: 'a' }]}
        widths={[200]}
        onWidthsChange={vi.fn()}
        onChange={vi.fn()}
        onValidChange={vi.fn()}
        onSchemaChange={vi.fn()}
        onValidation={vi.fn()}
      />,
    )
    expect(dataColWidth(view.container, 0)).toBe('200px') // provided
    expect(dataColWidth(view.container, 1)).toBe('180px') // fallback
  })
})

// ===========================================================================
// The table editor carries the column SCHEMA so an explicit Visual type
// survives a Visual -> Code -> Visual round trip (the type is not stored in the
// row-object value), emits its schema on every column edit, marks an empty or
// duplicate header in place, and reports the structured validation result the
// host turns into the strip message + Save gate.
//
// REQ-3.1.3.11: Variable watching UI panel
// ===========================================================================

function lastSchema(fn: (schema: TableColumnSchema[]) => void): TableColumnSchema[] {
  return (fn as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)
    ?.[0] as TableColumnSchema[]
}

function lastValidation(
  fn: (result: TableValidationResult) => void,
): TableValidationResult {
  return (fn as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)
    ?.[0] as TableValidationResult
}

describe('TableEditBody - carried schema seeding', () => {
  it('seeds a column type from the schema prop instead of re-inferring the value', () => {
    // The value "true" infers boolean, but the carried schema pins it to string.
    renderBody({
      value: [{ flag: 'true' }],
      schema: [{ name: 'flag', type: 'string' }],
    })
    expect(screen.getByTestId('table-type-0')).toHaveTextContent('string')
  })

  it('falls back to inference when no schema is supplied', () => {
    renderBody({ value: [{ flag: 'true' }] })
    expect(screen.getByTestId('table-type-0')).toHaveTextContent('boolean')
  })
})

describe('TableEditBody - onSchemaChange', () => {
  it('emits the schema when a header is renamed', () => {
    const { onSchemaChange } = renderBody({ value: [{ id: 1, name: 'a' }] })
    fireEvent.change(screen.getByTestId('table-header-0'), {
      target: { value: 'ident' },
    })
    expect(lastSchema(onSchemaChange)).toEqual([
      { name: 'ident', type: 'integer' },
      { name: 'name', type: 'string' },
    ])
  })

  it('emits the schema when a column type changes', async () => {
    const user = userEvent.setup()
    const { onSchemaChange } = renderBody({ value: [{ id: 1 }] })
    await user.click(screen.getByTestId('table-type-0'))
    await user.click(await screen.findByRole('option', { name: 'string' }))
    expect(lastSchema(onSchemaChange)).toEqual([{ name: 'id', type: 'string' }])
  })

  it('emits the schema when a column is added', async () => {
    const user = userEvent.setup()
    const { onSchemaChange } = renderBody({ value: [{ id: 1 }] })
    await user.click(screen.getByTestId('table-add-column'))
    expect(lastSchema(onSchemaChange)).toEqual([
      { name: 'id', type: 'integer' },
      { name: 'Column 2', type: 'string' },
    ])
  })

  it('emits the schema when a column is deleted', async () => {
    const user = userEvent.setup()
    const { onSchemaChange } = renderBody({ value: [{ id: 1, name: 'a' }] })
    await openColumnMenu(user, 1)
    await user.click(await screen.findByRole('menuitem', { name: 'Delete column' }))
    expect(lastSchema(onSchemaChange)).toEqual([{ name: 'id', type: 'integer' }])
  })
})

describe('TableEditBody - invalid header marking', () => {
  it('marks an emptied header aria-invalid', () => {
    renderBody({ value: [{ id: 1, name: 'a' }] })
    fireEvent.change(screen.getByTestId('table-header-0'), { target: { value: '' } })
    expect(screen.getByTestId('table-header-0')).toHaveAttribute('aria-invalid', 'true')
  })

  it('marks BOTH headers aria-invalid when a name is duplicated', () => {
    renderBody({ value: [{ id: 1, name: 'a' }] })
    fireEvent.change(screen.getByTestId('table-header-1'), { target: { value: 'id' } })
    expect(screen.getByTestId('table-header-0')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('table-header-1')).toHaveAttribute('aria-invalid', 'true')
  })

  it('leaves a valid header unmarked', () => {
    renderBody({ value: [{ id: 1, name: 'a' }] })
    expect(screen.getByTestId('table-header-0')).not.toHaveAttribute('aria-invalid')
  })
})

describe('TableEditBody - structured validation result', () => {
  it('emits an invalid result with a cell error and gates via onValidChange', () => {
    const { onValidChange, onValidation } = renderBody({ value: [{ id: 1 }] })
    fireEvent.change(screen.getByTestId('table-cell-0-0'), { target: { value: '-' } })
    expect(onValidChange).toHaveBeenLastCalledWith(false)
    const result = lastValidation(onValidation)
    expect(result.valid).toBe(false)
    expect(result.cellErrors).toEqual([{ row: 0, column: 'id', expected: 'integer' }])
  })

  it('emits an invalid result with a column error for an empty header', () => {
    const { onValidation } = renderBody({ value: [{ id: 1, name: 'a' }] })
    fireEvent.change(screen.getByTestId('table-header-0'), { target: { value: '' } })
    const result = lastValidation(onValidation)
    expect(result.valid).toBe(false)
    expect(result.columnErrors).toEqual([{ kind: 'empty', position: 1 }])
  })

  it('emits a valid result once the table is clean again', () => {
    const { onValidation } = renderBody({ value: [{ id: 1 }] })
    const cell = screen.getByTestId('table-cell-0-0')
    fireEvent.change(cell, { target: { value: '-' } })
    fireEvent.change(cell, { target: { value: '5' } })
    expect(lastValidation(onValidation).valid).toBe(true)
  })
})

// ===========================================================================
// The editor never silently nulls a cell. Null is an
// explicit state set via the per-cell ∅ affordance, shown as an italic chip and
// distinct from the empty string; new rows/columns seed type-defaults; boolean
// cells use a true/false selector.
//
// REQ-3.1.3.11: Variable watching UI panel
// ===========================================================================

describe('TableEditBody - explicit null cells', () => {
  it('sets a cell to null via the ∅ affordance and emits null, leaving other rows', () => {
    const { onChange } = renderBody({ value: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] })
    fireEvent.click(screen.getByTestId('table-cell-0-0-null'))
    expect(lastCall(onChange)).toEqual([
      { id: null, name: 'a' },
      { id: '2', name: 'b' },
    ])
  })

  it('renders a null cell as an italic chip (a valid result)', () => {
    const { onValidation } = renderBody({ value: [{ id: 1 }] })
    fireEvent.click(screen.getByTestId('table-cell-0-0-null'))
    const chip = screen.getByTestId('table-cell-0-0')
    expect(chip).toHaveTextContent('null')
    expect(chip.className).toMatch(/italic/)
    expect(lastValidation(onValidation).valid).toBe(true)
  })

  it('un-nulls a cell to its type default when the chip is clicked', () => {
    const { onChange } = renderBody({ value: [{ id: 1 }] })
    fireEvent.click(screen.getByTestId('table-cell-0-0-null'))
    fireEvent.click(screen.getByTestId('table-cell-0-0'))
    expect(lastCall(onChange)).toEqual([{ id: '0' }])
  })

  it('seeds an explicit null value as a null chip', () => {
    renderBody({ value: [{ id: null }], schema: [{ name: 'id', type: 'integer' }] })
    expect(screen.getByTestId('table-cell-0-0')).toHaveTextContent('null')
  })

  it('draws each cell ∅ with the shared NullButton, keeping the <testid>-null id (FIELD-5)', async () => {
    renderBody({ value: [{ id: 1, name: 'a' }] })
    const button = screen.getByTestId('table-cell-0-0-null')
    expect(button).toHaveAccessibleName('Set Row 0 id to null')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('table-cell-0-1-null')).toHaveAccessibleName('Set Row 0 name to null')
    fireEvent.focus(button)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Set to null$/)
  })

  it('names a cell under a column with no name yet by its column number', () => {
    renderBody({ value: [{ '': 'a' }], schema: [{ name: '', type: 'string' }] })
    expect(screen.getByTestId('table-cell-0-0-null')).toHaveAccessibleName('Set Row 0 column 1 to null')
  })
})

describe('TableEditBody - boolean selector', () => {
  it('renders a boolean cell as a true/false selector and emits the picked value', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: [{ flag: true }] })
    const cell = screen.getByTestId('table-cell-0-0')
    expect(cell).toHaveTextContent('true')
    await user.click(cell)
    await user.click(await screen.findByRole('option', { name: 'false' }))
    expect(lastCall(onChange)).toEqual([{ flag: false }])
  })

  it('renders an invalid boolean cell as a flagged input, not the selector', () => {
    renderBody({ value: [{ flag: 'maybe' }], schema: [{ name: 'flag', type: 'boolean' }] })
    const cell = screen.getByTestId('table-cell-0-0')
    expect(cell.tagName).toBe('INPUT')
    expect(cell).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('TableEditBody - default cells on add', () => {
  it('seeds a new row with type-default cells, not empty/null', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({ value: [{ id: 1, ok: true }] })
    await user.click(screen.getByTestId('table-add-row'))
    expect(lastCall(onChange)).toEqual([
      { id: '1', ok: true },
      { id: '0', ok: false },
    ])
  })
})

describe('TableEditBody - boolean selector focus ring', () => {
  it('rings on keyboard focus only, like the text cells beside it', () => {
    renderBody({ value: [{ flag: true, name: 'alpha' }] })
    const selector = screen.getByTestId('table-cell-0-0')
    const textCell = screen.getByTestId('table-cell-0-1')
    const ringClasses = (el: HTMLElement) => [...el.classList].filter((name) => /(^|:)ring-(?!offset)/.test(name))
    expect(ringClasses(selector).every((name) => name.startsWith('focus-visible:'))).toBe(true)
    expect(ringClasses(selector)).toEqual(expect.arrayContaining(ringClasses(textCell)))
  })
})

// Every cell is the one row box with its ∅ inside at the right end, shown always (FIELD-1, FIELD-13).
describe('TableEditBody - one cell box', () => {
  const boxOf = (element: HTMLElement) => element.closest('[data-slot="input-group"]') as HTMLElement

  it('puts the ∅ inside the cell box at its right end, shown without a hover', () => {
    renderBody({ value: [{ id: 1, name: 'a' }] })
    const cell = screen.getByTestId('table-cell-0-1')
    const nullButton = screen.getByTestId('table-cell-0-1-null')
    expect(boxOf(cell)).toHaveClass('h-8')
    expect(boxOf(nullButton)).toBe(boxOf(cell))
    expect(nullButton.closest('[data-slot="input-group-addon"]')).toHaveAttribute('data-align', 'inline-end')
    expect([...nullButton.classList].some((name) => name.includes('opacity-0'))).toBe(false)
  })

  it('puts the true / false selector in the same box with its ∅', () => {
    renderBody({ value: [{ flag: true }] })
    const selector = screen.getByTestId('table-cell-0-0')
    expect(boxOf(selector)).toHaveClass('h-8')
    expect(boxOf(screen.getByTestId('table-cell-0-0-null'))).toBe(boxOf(selector))
  })

  it('shows a null cell as gray italic null with the ∅ pressed inside its box (VMGR-93)', () => {
    renderBody({ value: [{ id: null }], schema: [{ name: 'id', type: 'integer' }] })
    const chip = screen.getByRole('button', { name: 'Row 0 id (null)' })
    const nullButton = screen.getByTestId('table-cell-0-0-null')
    expect(nullButton).toHaveAttribute('aria-pressed', 'true')
    expect(boxOf(nullButton)).toBe(boxOf(chip))
    expect(boxOf(chip)).toHaveClass('h-8')
  })

  it('leaves null with the type default from the pressed ∅', () => {
    const { onChange } = renderBody({ value: [{ id: null }], schema: [{ name: 'id', type: 'integer' }] })
    fireEvent.click(screen.getByTestId('table-cell-0-0-null'))
    expect(lastCall(onChange)).toEqual([{ id: '0' }])
    expect(screen.getByTestId('table-cell-0-0')).toHaveValue('0')
    expect(screen.getByTestId('table-cell-0-0-null')).toHaveAttribute('aria-pressed', 'false')
  })
})
