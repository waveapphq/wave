/**
 * ParallelBranchEditor Tests
 *
 * The BRANCHES section of the Parallel config sheet: one header-only row per
 * branch (violet BRANCH badge, name, time limit with its {x}, reorder, delete),
 * a column header, and the "+ Branch" button. A section holds at least two
 * branches, so the last two rows cannot be deleted. A branch time limit is the
 * one value field: a whole number of milliseconds, at least 1, plain or {x};
 * an {x} limit is flagged `branches.<index>.time_limit` in the Block {x} list,
 * and each flag moves with its branch.
 *
 * Design Reference: PARALLEL-3, FIELD-1, FIELD-7, REQ-3.1.1.3, REQ-3.2.3.7.
 */

import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The Edit value sheet is heavy (CodeMirror) and never opened here.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: () => null,
}))

// The {x} box reads the flow scope from the workflow store: these branches sit in the root flow.
vi.mock('@/features/functions/canvas/use-function-scope', () => ({
  useFunctionScope: () => ({
    insideFunction: false,
    scopeId: '',
    declaredInputNames: [],
    declaredOutputNames: [],
    allowedVarNames: new Set<string>(),
  }),
}))

import { ParallelBranchEditor } from '@/features/workbench/common/config/parallel-branch-editor'

type EditorProps = React.ComponentProps<typeof ParallelBranchEditor>

/** A branch as the Block stores it. */
interface Lane {
  id: string
  name: string
  time_limit?: number | string
}

function branch(id: string, name = '', limit?: number | string): Lane {
  return limit === undefined ? { id, name } : { id, name, time_limit: limit }
}

const TWO_BRANCHES: Lane[] = [branch('branch_1', 'ingest'), branch('branch_2', 'probe')]
const VARIABLES = [{ name: 'slow_ms', type: 'integer' }]
const TOO_SMALL = /^Time Limit must be at least 1$/
const BLANK_EXPRESSION = 'Time Limit is required'

function renderEditor(overrides: Partial<EditorProps> = {}) {
  const onBranchesChange = (overrides.onBranchesChange ?? vi.fn()) as ReturnType<typeof vi.fn>
  const onExpressionFieldsChange = (overrides.onExpressionFieldsChange ?? vi.fn()) as ReturnType<typeof vi.fn>
  render(
    <ParallelBranchEditor
      branches={TWO_BRANCHES}
      expressionFields={[]}
      availableVariables={VARIABLES}
      messages={{}}
      {...overrides}
      onBranchesChange={onBranchesChange}
      onExpressionFieldsChange={onExpressionFieldsChange}
    />,
  )
  return { onBranchesChange, onExpressionFieldsChange }
}

/** What the section last wrote, as the config window keeps it. */
const state: { lanes: Lane[]; flags: string[] } = { lanes: [], flags: [] }

function Host({
  lanes: initialLanes = TWO_BRANCHES,
  flags: initialFlags = [],
  messages = {},
}: Readonly<{ lanes?: Lane[]; flags?: string[]; messages?: Record<string, string> }>) {
  const [lanes, setLanes] = useState<Lane[]>(initialLanes)
  const [flags, setFlags] = useState<string[]>(initialFlags)
  state.lanes = lanes
  state.flags = flags
  return (
    <ParallelBranchEditor
      branches={lanes}
      expressionFields={flags}
      availableVariables={VARIABLES}
      messages={messages}
      onBranchesChange={(next, nextFlags) => {
        setLanes(next)
        setFlags(nextFlags)
      }}
      onExpressionFieldsChange={setFlags}
    />
  )
}

function renderHost(props: Parameters<typeof Host>[0] = {}) {
  render(<Host {...props} />)
  return userEvent.setup()
}

function rowTestIds(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid^="parallel-branch-card-"]'),
  ).map((el) => el.getAttribute('data-testid') ?? '')
}

const limitBox = (id: string) => screen.getByTestId(`param-input-parallel-branch-limit-${id}`)
const limitToggle = (id: string) => screen.getByTestId(`parallel-branch-limit-toggle-${id}`)
const limitError = (id: string) => screen.queryByTestId(`param-error-parallel-branch-limit-${id}`)
const limitExpand = (id: string) => screen.queryByTestId(`param-expand-parallel-branch-limit-${id}`)
const switchDialog = () => screen.queryByTestId('switch-mode-dialog')

const follows = (later: Element, earlier: Element) =>
  !earlier.contains(later) && (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

/** The empty placeholder columns drawn between two elements: an empty expand or {x} slot. */
function emptySlotsBetween(start: Element, end: Element): Element[] {
  return Array.from(document.body.querySelectorAll('span[aria-hidden="true"]')).filter(
    (slot) => slot.childNodes.length === 0 && follows(slot, start) && follows(end, slot),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  state.lanes = []
  state.flags = []
})

describe('ParallelBranchEditor - layout', () => {
  it('renders the section container', () => {
    renderEditor()

    expect(screen.getByTestId('parallel-branch-editor')).toBeInTheDocument()
  })

  it('renders one row per branch in config order', () => {
    renderEditor({
      branches: [branch('branch_1', 'ingest'), branch('branch_2', 'probe'), branch('branch_3')],
    })

    expect(rowTestIds()).toEqual([
      'parallel-branch-card-branch_1',
      'parallel-branch-card-branch_2',
      'parallel-branch-card-branch_3',
    ])
  })

  it('heads the columns with Name and Time limit (ms)', () => {
    renderEditor()

    const columns = screen.getByTestId('parallel-branch-columns')
    expect(columns).toHaveTextContent('Name')
    expect(columns).toHaveTextContent('Time limit (ms)')
  })

  it('badges every row BRANCH', () => {
    renderEditor()

    expect(screen.getByTestId('parallel-branch-badge-branch_1')).toHaveTextContent('BRANCH')
    expect(screen.getByTestId('parallel-branch-badge-branch_2')).toHaveTextContent('BRANCH')
  })

  it('renders each row as a single line with no chevron and no body', () => {
    // Guard: a branch row has nothing to expand into, so it must not offer to.
    renderEditor()

    expect(screen.queryByTestId('parallel-branch-toggle-branch_1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('parallel-branch-body-branch_1')).not.toBeInTheDocument()
  })

  it('renders the add button below the rows', () => {
    renderEditor()

    expect(screen.getByTestId('add-branch-button')).toHaveTextContent('Branch')
  })
})

// The 880 px window row: the name up to the If/Else name width, the limit box at the Setter value box width (PARALLEL-3).
describe('ParallelBranchEditor - lane row sizes', () => {
  const NAME_COLUMN = ['min-w-0', 'flex-1', 'max-w-[201px]']
  const nameColumn = (id: string) => screen.getByTestId(`parallel-branch-label-${id}`).closest('.input-wrapper')
  const limitCell = (id: string) => screen.getByTestId(`parallel-branch-limit-cell-${id}`)

  it('lets each name fill the free space up to the If/Else name width', () => {
    renderEditor()

    expect(nameColumn('branch_1')).toHaveClass(...NAME_COLUMN)
    expect(nameColumn('branch_2')).toHaveClass(...NAME_COLUMN)
  })

  it('holds each time limit cell at the 357 px box plus its expand and {x} columns', () => {
    renderEditor({
      branches: [branch('branch_1', 'ingest', 500), branch('branch_2', 'probe', 'slow_ms')],
      expressionFields: ['branches.1.time_limit'],
    })

    for (const id of ['branch_1', 'branch_2']) {
      expect(limitCell(id)).toHaveClass('w-[437px]', 'shrink-0')
      expect(limitCell(id)).toContainElement(limitBox(id))
      expect(limitCell(id)).toContainElement(limitToggle(id))
    }
  })

  it('heads the name and the time limit over their boxes, with spacers for the icon and button columns', () => {
    renderEditor()

    const columns = Array.from(screen.getByTestId('parallel-branch-columns').children)
    const name = screen.getByText('Name', { exact: true })
    const limit = screen.getByText('Time limit (ms)', { exact: true })
    expect(name).toHaveClass(...NAME_COLUMN)
    expect(limit).toHaveClass('w-[357px]', 'shrink-0')
    const spacers = columns.slice(columns.indexOf(limit) + 1)
    expect(spacers.map((spacer) => spacer.getAttribute('aria-hidden'))).toEqual(['true', 'true', 'true'])
    expect(spacers[0]).toHaveClass('w-8')
    expect(spacers[1]).toHaveClass('w-8')
    expect(spacers[2]).toHaveClass('w-16')
  })
})

describe('ParallelBranchEditor - names', () => {
  it('shows the stored name in the row input', () => {
    renderEditor()

    expect((screen.getByTestId('parallel-branch-label-branch_1') as HTMLInputElement).value).toBe(
      'ingest',
    )
  })

  it('placeholders an unnamed row with its position', () => {
    renderEditor({ branches: [branch('branch_1', 'ingest'), branch('branch_2')] })

    expect(screen.getByTestId('parallel-branch-label-branch_2')).toHaveAttribute(
      'placeholder',
      'Branch 2',
    )
  })

  it('pushes a renamed branch up with every other branch unchanged', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor()

    await user.type(screen.getByTestId('parallel-branch-label-branch_2'), 'X')

    expect(onBranchesChange).toHaveBeenCalledWith(
      [branch('branch_1', 'ingest'), branch('branch_2', 'probeX')],
      [],
    )
  })
})

// The branch time limit is the one value field's number box (REQ-3.2.3.7).
describe('ParallelBranchEditor - the branch time limit field', () => {
  it('shows a stored limit in the number box, with its {x} unpressed', () => {
    renderEditor({ branches: [branch('branch_1', 'ingest', 30000), branch('branch_2', 'probe')] })

    expect(limitBox('branch_1')).toHaveValue('30000')
    expect(limitToggle('branch_1')).toHaveAttribute('aria-pressed', 'false')
    expect(limitError('branch_1')).not.toBeInTheDocument()
  })

  it('shows an empty box with no hint for a branch with no limit', () => {
    renderEditor()

    expect(limitBox('branch_2')).toHaveValue('')
    expect(limitBox('branch_2')).not.toHaveAttribute('placeholder')
    expect(document.querySelector('[placeholder="No limit"]')).toBeNull()
    expect(limitError('branch_2')).not.toBeInTheDocument()
  })

  it('messages a stored limit of 0 under its box and marks only that box invalid', () => {
    renderEditor({ branches: [branch('branch_1', 'ingest', 0), branch('branch_2', 'probe', 500)] })

    const error = limitError('branch_1')
    expect(error).toHaveTextContent(TOO_SMALL)
    expect(error).toHaveAttribute('role', 'alert')
    expect(limitBox('branch_1')).toHaveValue('0')
    expect(limitBox('branch_1')).toHaveAttribute('aria-invalid', 'true')
    expect(limitError('branch_2')).not.toBeInTheDocument()
  })

  it('messages a 0 typed into the box', () => {
    renderHost()

    fireEvent.change(limitBox('branch_1'), { target: { value: '0' } })

    expect(limitError('branch_1')).toHaveTextContent(TOO_SMALL)
    expect(String(state.lanes[0].time_limit)).toBe('0')
  })

  it.each([1, 30000, '12345678901234567'])('raises no message for a limit of %j', (limit) => {
    renderEditor({ branches: [branch('branch_1', 'ingest', limit), branch('branch_2', 'probe')] })

    expect(limitError('branch_1')).not.toBeInTheDocument()
    expect(limitBox('branch_1')).toHaveValue(String(limit))
  })

  it('pushes a typed limit up and leaves every other branch unchanged', () => {
    renderHost()

    fireEvent.change(limitBox('branch_1'), { target: { value: '5' } })

    expect(String(state.lanes[0].time_limit)).toBe('5')
    expect(state.lanes[0]).toMatchObject(branch('branch_1', 'ingest'))
    expect(state.lanes[1]).toEqual(branch('branch_2', 'probe'))
    expect(state.flags).toEqual([])
  })

  it('clears the limit back to unset when the box is emptied', () => {
    renderHost({ lanes: [branch('branch_1', 'ingest', 3), branch('branch_2', 'probe')] })

    fireEvent.change(limitBox('branch_1'), { target: { value: '' } })

    expect(state.lanes[0].time_limit).toBeUndefined()
    expect(state.lanes).toEqual([branch('branch_1', 'ingest'), branch('branch_2', 'probe')])
  })
})

// Each branch limit takes an expression of its own (FIELD-1, FIELD-7).
describe('ParallelBranchEditor - {x} per branch time limit', () => {
  it('gives every branch its own {x} toggle', () => {
    renderEditor({
      branches: [branch('branch_1', 'ingest'), branch('branch_2', 'probe'), branch('branch_3')],
    })

    for (const id of ['branch_1', 'branch_2', 'branch_3']) {
      expect(limitToggle(id)).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('switches a branch with no limit to {x} at once and flags only that branch', async () => {
    const user = renderHost()

    await user.click(limitToggle('branch_2'))

    expect(switchDialog()).not.toBeInTheDocument()
    expect(state.flags).toEqual(['branches.1.time_limit'])
    expect(limitToggle('branch_2')).toHaveAttribute('aria-pressed', 'true')
    expect(limitToggle('branch_1')).toHaveAttribute('aria-pressed', 'false')
    expect(limitBox('branch_2').querySelector('.cm-editor')).not.toBeNull()
  })

  it('asks before {x} on a branch that holds a limit, and Clear empties it into {x}', async () => {
    const user = renderHost({ lanes: [branch('branch_1', 'ingest', 30000), branch('branch_2', 'probe')] })

    await user.click(limitToggle('branch_1'))

    const dialog = screen.getByTestId('switch-mode-dialog')
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Cancel',
      'Clear',
    ])
    await user.click(screen.getByTestId('switch-mode-cancel'))
    expect(limitToggle('branch_1')).toHaveAttribute('aria-pressed', 'false')
    expect(state.lanes[0].time_limit).toBe(30000)
    expect(state.flags).toEqual([])

    await user.click(limitToggle('branch_1'))
    await user.click(screen.getByTestId('switch-mode-clear-default'))

    expect(limitToggle('branch_1')).toHaveAttribute('aria-pressed', 'true')
    expect(state.flags).toEqual(['branches.0.time_limit'])
    // A blank {x} box holds nothing: no value or an empty expression (REQ-3.1.1.5).
    expect([undefined, '']).toContainEqual(state.lanes[0].time_limit)
  })

  it('shows a stored {x} limit as an expression with its expand and no message', () => {
    renderEditor({
      branches: [branch('branch_1', 'ingest', 'slow_ms'), branch('branch_2', 'probe')],
      expressionFields: ['branches.0.time_limit'],
    })

    expect(limitToggle('branch_1')).toHaveAttribute('aria-pressed', 'true')
    expect(limitBox('branch_1').querySelector('.cm-editor')).not.toBeNull()
    expect(limitExpand('branch_1')).toBeInTheDocument()
    expect(limitError('branch_1')).not.toBeInTheDocument()
    expect(limitToggle('branch_2')).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps an empty expand column beside a number and draws the expand in it in {x} mode', async () => {
    const user = renderHost()
    expect(limitExpand('branch_1')).not.toBeInTheDocument()
    const slots = emptySlotsBetween(limitBox('branch_1'), limitToggle('branch_1'))
    expect(slots).toHaveLength(1)
    expect(slots[0]).toHaveClass('w-8')

    await user.click(limitToggle('branch_1'))

    const expand = limitExpand('branch_1') as HTMLElement
    expect(expand).toBeInTheDocument()
    expect(follows(expand, limitBox('branch_1'))).toBe(true)
    expect(follows(limitToggle('branch_1'), expand)).toBe(true)
    expect(emptySlotsBetween(limitBox('branch_1'), limitToggle('branch_1'))).toHaveLength(0)
  })

  it('messages a blank {x} limit with the line the window hands in', () => {
    renderEditor({
      expressionFields: ['branches.0.time_limit'],
      messages: { 'branches.0.time_limit': BLANK_EXPRESSION },
    })

    expect(limitError('branch_1')).toHaveTextContent(/^Time Limit is required$/)
    expect(limitError('branch_2')).not.toBeInTheDocument()
  })
})

// A branch's {x} flag names its place, so it moves when the branch moves (REQ-3.1.1.3).
describe('ParallelBranchEditor - {x} flags move with their branch', () => {
  it('moves the flag down with a branch moved down', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor({
      branches: [branch('branch_1', 'ingest', 'slow_ms'), branch('branch_2', 'probe')],
      expressionFields: ['branches.0.time_limit'],
    })

    await user.click(screen.getByTestId('parallel-branch-move-down-branch_1'))

    expect(onBranchesChange).toHaveBeenCalledWith(
      [branch('branch_2', 'probe'), branch('branch_1', 'ingest', 'slow_ms')],
      ['branches.1.time_limit'],
    )
  })

  it('moves the flag up with a branch moved up', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor({
      branches: [branch('branch_1', 'ingest'), branch('branch_2', 'probe', 'slow_ms')],
      expressionFields: ['branches.1.time_limit'],
    })

    await user.click(screen.getByTestId('parallel-branch-move-up-branch_2'))

    expect(onBranchesChange).toHaveBeenCalledWith(
      [branch('branch_2', 'probe', 'slow_ms'), branch('branch_1', 'ingest')],
      ['branches.0.time_limit'],
    )
  })

  it('keeps the flags as they are when a branch is added at the end', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor({
      branches: [branch('branch_1', 'ingest'), branch('branch_2', 'probe', 'slow_ms')],
      expressionFields: ['branches.1.time_limit'],
    })

    await user.click(screen.getByTestId('add-branch-button'))

    expect(onBranchesChange).toHaveBeenCalledWith(
      [branch('branch_1', 'ingest'), branch('branch_2', 'probe', 'slow_ms'), branch('branch_3')],
      ['branches.1.time_limit'],
    )
  })

  it('shifts the flag of a branch after a deleted one', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor({
      branches: [branch('branch_1', 'ingest'), branch('branch_2', 'probe'), branch('branch_3', '', 'slow_ms')],
      expressionFields: ['branches.2.time_limit'],
    })

    await user.click(screen.getByTestId('parallel-branch-delete-branch_2'))

    expect(onBranchesChange).toHaveBeenCalledWith(
      [branch('branch_1', 'ingest'), branch('branch_3', '', 'slow_ms')],
      ['branches.1.time_limit'],
    )
  })

  it('drops the flag of a deleted branch', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor({
      branches: [branch('branch_1', 'ingest', 'slow_ms'), branch('branch_2', 'probe'), branch('branch_3')],
      expressionFields: ['branches.0.time_limit'],
    })

    await user.click(screen.getByTestId('parallel-branch-delete-branch_1'))

    expect(onBranchesChange).toHaveBeenCalledWith([branch('branch_2', 'probe'), branch('branch_3')], [])
  })

  it('leaves the other {x} flags of the Block alone', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor({
      branches: [branch('branch_1', 'ingest', 'slow_ms'), branch('branch_2', 'probe')],
      expressionFields: ['time_limit', 'branches.0.time_limit'],
    })

    await user.click(screen.getByTestId('parallel-branch-move-down-branch_1'))

    const flags = onBranchesChange.mock.lastCall?.[1] as string[]
    expect([...flags].sort((a, b) => a.localeCompare(b))).toEqual(['branches.1.time_limit', 'time_limit'])
  })

  it('moves the {x} state on screen with its branch', async () => {
    const user = renderHost({
      lanes: [branch('branch_1', 'ingest', 'slow_ms'), branch('branch_2', 'probe')],
      flags: ['branches.0.time_limit'],
    })

    await user.click(screen.getByTestId('parallel-branch-move-down-branch_1'))

    expect(rowTestIds()).toEqual(['parallel-branch-card-branch_2', 'parallel-branch-card-branch_1'])
    expect(state.flags).toEqual(['branches.1.time_limit'])
    expect(limitToggle('branch_1')).toHaveAttribute('aria-pressed', 'true')
    expect(limitToggle('branch_2')).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('ParallelBranchEditor - add', () => {
  it('appends a branch with the next free id', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor()

    await user.click(screen.getByTestId('add-branch-button'))

    expect(onBranchesChange).toHaveBeenCalledWith(
      [branch('branch_1', 'ingest'), branch('branch_2', 'probe'), branch('branch_3')],
      [],
    )
  })

  it('continues the id sequence past a deleted middle branch', async () => {
    // Guard: reusing a freed id would re-point an edge that was wired to it.
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor({
      branches: [branch('branch_1', 'ingest'), branch('branch_4', 'probe')],
    })

    await user.click(screen.getByTestId('add-branch-button'))

    expect(onBranchesChange).toHaveBeenCalledWith(
      [branch('branch_1', 'ingest'), branch('branch_4', 'probe'), branch('branch_5')],
      [],
    )
  })
})

describe('ParallelBranchEditor - reorder', () => {
  it('disables move-up on the first row and move-down on the last', () => {
    renderEditor()

    expect(screen.getByTestId('parallel-branch-move-up-branch_1')).toBeDisabled()
    expect(screen.getByTestId('parallel-branch-move-down-branch_1')).not.toBeDisabled()
    expect(screen.getByTestId('parallel-branch-move-up-branch_2')).not.toBeDisabled()
    expect(screen.getByTestId('parallel-branch-move-down-branch_2')).toBeDisabled()
  })

  it('swaps a branch with the one above it', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor()

    await user.click(screen.getByTestId('parallel-branch-move-up-branch_2'))

    expect(onBranchesChange).toHaveBeenCalledWith([branch('branch_2', 'probe'), branch('branch_1', 'ingest')], [])
  })

  it('swaps a branch with the one below it', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor()

    await user.click(screen.getByTestId('parallel-branch-move-down-branch_1'))

    expect(onBranchesChange).toHaveBeenCalledWith([branch('branch_2', 'probe'), branch('branch_1', 'ingest')], [])
  })
})

describe('ParallelBranchEditor - delete and the two-branch minimum', () => {
  it('disables delete on both rows of a two-branch section', () => {
    renderEditor()

    expect(screen.getByTestId('parallel-branch-delete-branch_1')).toBeDisabled()
    expect(screen.getByTestId('parallel-branch-delete-branch_2')).toBeDisabled()
  })

  it('renders a disabled delete visually disabled, not only aria-disabled', () => {
    renderEditor()

    const button = screen.getByTestId('parallel-branch-delete-branch_1')
    expect(button.className).toContain('opacity-50')
    expect(button.className).toContain('cursor-not-allowed')
  })

  it('explains the disabled delete on hover', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.hover(screen.getByTestId('parallel-branch-delete-branch_1'))

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'A parallel section needs at least two branches',
    )
  })

  it('does not delete when the button is disabled', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor()

    await user.click(screen.getByTestId('parallel-branch-delete-branch_1'))

    expect(onBranchesChange).not.toHaveBeenCalled()
  })

  it('enables delete once a third branch exists', () => {
    renderEditor({
      branches: [branch('branch_1', 'ingest'), branch('branch_2', 'probe'), branch('branch_3')],
    })

    expect(screen.getByTestId('parallel-branch-delete-branch_1')).not.toBeDisabled()
  })

  it('removes the row and leaves the others untouched', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor({
      branches: [branch('branch_1', 'ingest'), branch('branch_2', 'probe'), branch('branch_3')],
    })

    await user.click(screen.getByTestId('parallel-branch-delete-branch_2'))

    expect(onBranchesChange).toHaveBeenCalledWith([branch('branch_1', 'ingest'), branch('branch_3')], [])
  })
})

describe('ParallelBranchEditor - seed on mount', () => {
  it('renders two rows for a section with no branches yet', () => {
    renderEditor({ branches: [] })

    expect(rowTestIds()).toEqual([
      'parallel-branch-card-branch_1',
      'parallel-branch-card-branch_2',
    ])
  })

  it('pushes the seeded pair up so Save persists it', () => {
    const { onBranchesChange } = renderEditor({ branches: [] })

    expect(onBranchesChange).toHaveBeenCalledWith([branch('branch_1'), branch('branch_2')], [])
  })

  it('does not re-seed a section that already has branches', () => {
    const { onBranchesChange } = renderEditor()

    expect(onBranchesChange).not.toHaveBeenCalled()
  })
})

describe('ParallelBranchEditor - accessibility (5.8)', () => {
  it('names the reorder and delete controls after the branch', () => {
    renderEditor()

    expect(screen.getByTestId('parallel-branch-move-up-branch_1')).toHaveAttribute(
      'aria-label',
      'Move branch ingest up',
    )
    expect(screen.getByTestId('parallel-branch-move-down-branch_1')).toHaveAttribute(
      'aria-label',
      'Move branch ingest down',
    )
    expect(screen.getByTestId('parallel-branch-delete-branch_1')).toHaveAttribute(
      'aria-label',
      'Delete branch ingest',
    )
  })

  it('falls back to the branch position when the branch has no name', () => {
    renderEditor({ branches: [branch('branch_1'), branch('branch_2')] })

    expect(screen.getByTestId('parallel-branch-delete-branch_2')).toHaveAttribute(
      'aria-label',
      'Delete branch 2',
    )
  })

  it('groups each time limit box under its own branch, by name or by position', () => {
    renderEditor({ branches: [branch('branch_1', 'ingest'), branch('branch_2')] })

    const named = screen.getByRole('group', { name: 'Time limit for branch ingest' })
    const unnamed = screen.getByRole('group', { name: 'Time limit for branch 2' })
    expect(named).toBe(screen.getByTestId('parallel-branch-limit-cell-branch_1'))
    expect(named).toContainElement(limitBox('branch_1'))
    expect(unnamed).toContainElement(limitBox('branch_2'))
  })
})
