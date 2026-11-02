/**
 * ParallelBranchEditor Tests
 *
 * The BRANCHES section of the Parallel config sheet: one header-only row per
 * branch (violet BRANCH badge, name, time limit, reorder, delete), a column
 * header, and the "+ Branch" button. A section holds at least two branches, so
 * the last two rows cannot be deleted.
 *
 * Design Reference: PARALLEL-3.
 */

import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ParallelBranchEditor } from '@/features/workbench/common/config/parallel-branch-editor'

type EditorProps = React.ComponentProps<typeof ParallelBranchEditor>
type Branch = EditorProps['branches'][number]

function branch(id: string, name = '', timeLimit?: number | string): Branch {
  return timeLimit === undefined ? { id, name } : { id, name, timeLimit }
}

const TWO_BRANCHES: Branch[] = [branch('branch_1', 'ingest'), branch('branch_2', 'probe')]

function renderEditor(overrides: Partial<EditorProps> = {}) {
  const onBranchesChange = (overrides.onBranchesChange ?? vi.fn()) as ReturnType<typeof vi.fn>
  const onValidChange = (overrides.onValidChange ?? vi.fn()) as ReturnType<typeof vi.fn>
  render(
    <ParallelBranchEditor
      branches={TWO_BRANCHES}
      {...overrides}
      onBranchesChange={onBranchesChange}
      onValidChange={onValidChange}
    />,
  )
  return { onBranchesChange, onValidChange }
}

function rowTestIds(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid^="parallel-branch-card-"]'),
  ).map((el) => el.getAttribute('data-testid') ?? '')
}

beforeEach(() => {
  vi.clearAllMocks()
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

    expect(onBranchesChange).toHaveBeenCalledWith([
      branch('branch_1', 'ingest'),
      branch('branch_2', 'probeX'),
    ])
  })
})

describe('ParallelBranchEditor - per-branch time limit', () => {
  it('shows the stored limit in the row input', () => {
    renderEditor({ branches: [branch('branch_1', 'ingest', 30000), branch('branch_2', 'probe')] })

    expect((screen.getByTestId('parallel-branch-limit-branch_1') as HTMLInputElement).value).toBe(
      '30000',
    )
  })

  it('placeholders an unlimited branch with No limit', () => {
    renderEditor()

    expect(screen.getByTestId('parallel-branch-limit-branch_2')).toHaveAttribute(
      'placeholder',
      'No limit',
    )
  })

  it('pushes a typed limit up as a number', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor()

    await user.type(screen.getByTestId('parallel-branch-limit-branch_1'), '5')

    expect(onBranchesChange).toHaveBeenCalledWith([
      branch('branch_1', 'ingest', 5),
      branch('branch_2', 'probe'),
    ])
  })

  it('clears the limit back to unset when the field is emptied', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor({
      branches: [branch('branch_1', 'ingest', 3), branch('branch_2', 'probe')],
    })

    await user.clear(screen.getByTestId('parallel-branch-limit-branch_1'))

    expect(onBranchesChange).toHaveBeenCalledWith([
      branch('branch_1', 'ingest'),
      branch('branch_2', 'probe'),
    ])
  })

  it('reports the section valid when every limit is unset or positive', () => {
    const { onValidChange } = renderEditor({
      branches: [branch('branch_1', 'ingest', 30000), branch('branch_2', 'probe')],
    })

    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('reports the section invalid when a limit is not positive', () => {
    const { onValidChange } = renderEditor({
      branches: [branch('branch_1', 'ingest', 0), branch('branch_2', 'probe')],
    })

    expect(onValidChange).toHaveBeenLastCalledWith(false)
  })

  it('reports the section invalid when a limit is negative', () => {
    const { onValidChange } = renderEditor({
      branches: [branch('branch_1', 'ingest'), branch('branch_2', 'probe', -1)],
    })

    expect(onValidChange).toHaveBeenLastCalledWith(false)
  })
})

// The time limit box keeps the one number rule (REQ-3.1.3.14).
describe('ParallelBranchEditor - the time limit number rule', () => {
  const limitBox = () => screen.getByTestId('parallel-branch-limit-branch_1') as HTMLInputElement

  it('drops a key the rule refuses and gives no box a digit past 19', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor()

    await user.type(limitBox(), 'x.')

    expect(onBranchesChange).not.toHaveBeenCalled()
    expect(limitBox()).toHaveValue('')
    expect(limitBox()).toHaveAttribute('maxlength', '20')
    expect(limitBox()).toHaveAttribute('inputmode', 'numeric')
  })

  it('pushes a limit past what a JS number holds as its exact digits, never exponent notation', () => {
    function Host() {
      const [branches, setBranches] = useState<Branch[]>(TWO_BRANCHES)
      return <ParallelBranchEditor branches={branches} onBranchesChange={setBranches} onValidChange={vi.fn()} />
    }
    render(<Host />)

    fireEvent.change(limitBox(), { target: { value: '1234567890123456789' } })

    expect(limitBox()).toHaveValue('1234567890123456789')
  })

  it('pushes the exact digit text when a JS number would change them', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor()

    await user.type(limitBox(), '0')

    expect(onBranchesChange).toHaveBeenLastCalledWith([branch('branch_1', 'ingest', 0), branch('branch_2', 'probe')])
    fireEvent.change(limitBox(), { target: { value: '9007199254740993' } })
    expect(onBranchesChange).toHaveBeenLastCalledWith([
      branch('branch_1', 'ingest', '9007199254740993'),
      branch('branch_2', 'probe'),
    ])
  })

  it('refuses a minus key, since a limit is at least 1', () => {
    const { onBranchesChange } = renderEditor()

    fireEvent.change(limitBox(), { target: { value: '-' } })
    fireEvent.change(limitBox(), { target: { value: '-5' } })

    expect(onBranchesChange).not.toHaveBeenCalled()
    expect(limitBox()).toHaveValue('')
  })

  it('holds the section while the box shows 0', () => {
    function Host({ onValid }: Readonly<{ onValid: (valid: boolean) => void }>) {
      const [branches, setBranches] = useState<Branch[]>(TWO_BRANCHES)
      return <ParallelBranchEditor branches={branches} onBranchesChange={setBranches} onValidChange={onValid} />
    }
    const onValid = vi.fn()
    render(<Host onValid={onValid} />)

    fireEvent.change(limitBox(), { target: { value: '0' } })

    expect(onValid).toHaveBeenLastCalledWith(false)
    expect(limitBox()).toHaveValue('0')
  })

  it('names each box after its branch and keeps browser autofill off it', () => {
    renderEditor()

    expect(limitBox()).toHaveAttribute('name', 'time-limit-branch_1')
    expect(limitBox()).toHaveAttribute('autocomplete', 'off')
  })

  it('reads a limit stored as digit text as a number', () => {
    const { onValidChange } = renderEditor({
      branches: [branch('branch_1', 'ingest', '12345678901234567'), branch('branch_2', 'probe', '0')],
    })

    expect(limitBox()).toHaveValue('12345678901234567')
    expect(onValidChange).toHaveBeenLastCalledWith(false)
  })

  it('shows a new limit from outside and keeps the text it shows for the same number', () => {
    const { rerender } = render(
      <ParallelBranchEditor
        branches={[branch('branch_1', 'ingest', 5), branch('branch_2', 'probe')]}
        onBranchesChange={vi.fn()}
        onValidChange={vi.fn()}
      />,
    )
    rerender(
      <ParallelBranchEditor
        branches={[branch('branch_1', 'ingest', '5'), branch('branch_2', 'probe')]}
        onBranchesChange={vi.fn()}
        onValidChange={vi.fn()}
      />,
    )
    expect(limitBox()).toHaveValue('5')
    rerender(
      <ParallelBranchEditor
        branches={[branch('branch_1', 'ingest', 7), branch('branch_2', 'probe')]}
        onBranchesChange={vi.fn()}
        onValidChange={vi.fn()}
      />,
    )
    expect(limitBox()).toHaveValue('7')
    rerender(
      <ParallelBranchEditor
        branches={[branch('branch_1', 'ingest', '2.5'), branch('branch_2', 'probe')]}
        onBranchesChange={vi.fn()}
        onValidChange={vi.fn()}
      />,
    )
    expect(limitBox()).toHaveValue('2.5')
    rerender(
      <ParallelBranchEditor
        branches={[branch('branch_1', 'ingest', 3), branch('branch_2', 'probe')]}
        onBranchesChange={vi.fn()}
        onValidChange={vi.fn()}
      />,
    )
    expect(limitBox()).toHaveValue('3')
    rerender(
      <ParallelBranchEditor
        branches={[branch('branch_1', 'ingest'), branch('branch_2', 'probe')]}
        onBranchesChange={vi.fn()}
        onValidChange={vi.fn()}
      />,
    )
    expect(limitBox()).toHaveValue('')
  })
})

describe('ParallelBranchEditor - add', () => {
  it('appends a branch with the next free id', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor()

    await user.click(screen.getByTestId('add-branch-button'))

    expect(onBranchesChange).toHaveBeenCalledWith([
      branch('branch_1', 'ingest'),
      branch('branch_2', 'probe'),
      branch('branch_3'),
    ])
  })

  it('continues the id sequence past a deleted middle branch', async () => {
    // Guard: reusing a freed id would re-point an edge that was wired to it.
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor({
      branches: [branch('branch_1', 'ingest'), branch('branch_4', 'probe')],
    })

    await user.click(screen.getByTestId('add-branch-button'))

    expect(onBranchesChange).toHaveBeenCalledWith([
      branch('branch_1', 'ingest'),
      branch('branch_4', 'probe'),
      branch('branch_5'),
    ])
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

    expect(onBranchesChange).toHaveBeenCalledWith([
      branch('branch_2', 'probe'),
      branch('branch_1', 'ingest'),
    ])
  })

  it('swaps a branch with the one below it', async () => {
    const user = userEvent.setup()
    const { onBranchesChange } = renderEditor()

    await user.click(screen.getByTestId('parallel-branch-move-down-branch_1'))

    expect(onBranchesChange).toHaveBeenCalledWith([
      branch('branch_2', 'probe'),
      branch('branch_1', 'ingest'),
    ])
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

    expect(onBranchesChange).toHaveBeenCalledWith([branch('branch_1', 'ingest'), branch('branch_3')])
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

    expect(onBranchesChange).toHaveBeenCalledWith([branch('branch_1'), branch('branch_2')])
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
})
