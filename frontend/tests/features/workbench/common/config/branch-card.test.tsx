/**
 * BranchCard Tests
 *
 * The shared collapsible branch-card shell that both the If/Else editor and the
 * Switch case editor compose. Locks the composed test ids, the badge and
 * headerExtra slots, label editing, the reorder and delete affordances, and the
 * card-owned open state (the body is unmounted, not hidden, when collapsed).
 *
 * Design Reference:
 * SWITCH-8 (card layout, header controls), SWITCH-9 (Break switch is the only
 * fall-through signal, so headerExtra survives collapse); shared card shell.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { BranchCard } from '@/features/workbench/common/config/branch-card'

function renderCard(overrides: Partial<React.ComponentProps<typeof BranchCard>> = {}) {
  const onLabelChange = (overrides.onLabelChange ?? vi.fn()) as ReturnType<typeof vi.fn>
  const onMove = (overrides.onMove ?? vi.fn()) as ReturnType<typeof vi.fn>
  const onDelete = (overrides.onDelete ?? vi.fn()) as ReturnType<typeof vi.fn>
  const props = {
    branchId: 'branch_0',
    testIdPrefix: 'branch',
    badge: <span>CASE</span>,
    label: '',
    canMove: true,
    canMoveUp: true,
    canMoveDown: true,
    canDelete: true,
    children: <div data-testid="card-children">body content</div>,
    ...overrides,
    onLabelChange,
    onMove,
    onDelete,
  }
  render(<BranchCard {...props} />)
  return { onLabelChange, onMove, onDelete }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BranchCard', () => {
  describe('Test ids', () => {
    it('composes every test id from the prefix and the branch id', () => {
      renderCard({ testIdPrefix: 'case', branchId: 'branch_2' })

      expect(screen.getByTestId('case-card-branch_2')).toBeInTheDocument()
      expect(screen.getByTestId('case-header-branch_2')).toBeInTheDocument()
      expect(screen.getByTestId('case-toggle-branch_2')).toBeInTheDocument()
      expect(screen.getByTestId('case-label-branch_2')).toBeInTheDocument()
      expect(screen.getByTestId('case-move-up-branch_2')).toBeInTheDocument()
      expect(screen.getByTestId('case-move-down-branch_2')).toBeInTheDocument()
      expect(screen.getByTestId('case-delete-branch_2')).toBeInTheDocument()
      expect(screen.getByTestId('case-body-branch_2')).toBeInTheDocument()
    })

    it('uses the default prefix for the If/Else branch cards', () => {
      renderCard({ testIdPrefix: 'branch', branchId: 'branch_1' })

      expect(screen.getByTestId('branch-card-branch_1')).toBeInTheDocument()
      expect(screen.getByTestId('branch-body-branch_1')).toBeInTheDocument()
    })
  })

  describe('Badge slot', () => {
    it('renders the caller badge node verbatim', () => {
      renderCard({
        badge: (
          <span data-testid="default-badge-branch_0" className="badge-default">
            DEFAULT
          </span>
        ),
      })

      const badge = screen.getByTestId('default-badge-branch_0')
      expect(badge).toHaveTextContent('DEFAULT')
      expect(badge.className).toContain('badge-default')
    })

    // Guard: a shell-composed badge test id lands variant checks on a wrapper.
    it('composes no badge test id of its own', () => {
      renderCard({ badge: <span data-testid="case-badge-branch_0">CASE</span> })

      expect(screen.queryByTestId('branch-badge-branch_0')).not.toBeInTheDocument()
    })
  })

  describe('Label input', () => {
    it('renders the label input with the current value', () => {
      renderCard({ label: 'Check status' })

      const input = screen.getByTestId('branch-label-branch_0') as HTMLInputElement
      expect(input.value).toBe('Check status')
    })

    it('calls onLabelChange with the typed value', async () => {
      const user = userEvent.setup()
      const { onLabelChange } = renderCard({ label: '' })

      await user.type(screen.getByTestId('branch-label-branch_0'), 'A')

      expect(onLabelChange).toHaveBeenCalledWith('A')
    })

    it('does not toggle the body when the label input is clicked', async () => {
      const user = userEvent.setup()
      renderCard()

      await user.click(screen.getByTestId('branch-label-branch_0'))

      expect(screen.getByTestId('branch-body-branch_0')).toBeInTheDocument()
    })
  })

  describe('Header extra slot', () => {
    it('renders the headerExtra node in the header', () => {
      renderCard({ headerExtra: <span data-testid="header-extra-slot">Break</span> })

      expect(screen.getByTestId('header-extra-slot')).toBeInTheDocument()
    })

    it('keeps headerExtra visible while the card is collapsed', () => {
      renderCard({
        defaultOpen: false,
        headerExtra: <span data-testid="header-extra-slot">Break</span>,
      })

      expect(screen.getByTestId('header-extra-slot')).toBeInTheDocument()
      expect(screen.queryByTestId('branch-body-branch_0')).not.toBeInTheDocument()
    })

    // Guard: a header control never collapses the card it sits in.
    it('leaves an expanded card expanded when a headerExtra control is clicked', async () => {
      const user = userEvent.setup()
      const onExtraClick = vi.fn()
      renderCard({
        headerExtra: (
          <button type="button" data-testid="header-extra-button" onClick={onExtraClick}>
            Break
          </button>
        ),
      })

      await user.click(screen.getByTestId('header-extra-button'))

      expect(onExtraClick).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('branch-body-branch_0')).toBeInTheDocument()
    })

    it('leaves a collapsed card collapsed when a headerExtra control is clicked', async () => {
      const user = userEvent.setup()
      const onExtraClick = vi.fn()
      renderCard({
        defaultOpen: false,
        headerExtra: (
          <button type="button" data-testid="header-extra-button" onClick={onExtraClick}>
            Break
          </button>
        ),
      })

      await user.click(screen.getByTestId('header-extra-button'))

      expect(onExtraClick).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('branch-body-branch_0')).not.toBeInTheDocument()
    })
  })

  describe('Expand/collapse', () => {
    it('renders the body when defaultOpen is omitted', () => {
      renderCard()

      expect(screen.getByTestId('branch-body-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('card-children')).toBeInTheDocument()
    })

    it('renders the body when defaultOpen is true', () => {
      renderCard({ defaultOpen: true })

      expect(screen.getByTestId('branch-body-branch_0')).toBeInTheDocument()
    })

    it('hides the body when defaultOpen is false', () => {
      renderCard({ defaultOpen: false })

      expect(screen.queryByTestId('branch-body-branch_0')).not.toBeInTheDocument()
    })

    it('toggles the body on header click', async () => {
      const user = userEvent.setup()
      renderCard()

      await user.click(screen.getByTestId('branch-toggle-branch_0'))
      expect(screen.queryByTestId('branch-body-branch_0')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('branch-toggle-branch_0'))
      expect(screen.getByTestId('branch-body-branch_0')).toBeInTheDocument()
    })

    it('toggles the body exactly once per chevron click', async () => {
      const user = userEvent.setup()
      renderCard()

      await user.click(screen.getByTestId('branch-toggle-branch_0'))
      expect(screen.queryByTestId('branch-body-branch_0')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('branch-toggle-branch_0'))
      expect(screen.getByTestId('branch-body-branch_0')).toBeInTheDocument()
    })

    it('unmounts the body content when collapsed', async () => {
      const user = userEvent.setup()
      renderCard()

      await user.click(screen.getByTestId('branch-toggle-branch_0'))

      expect(screen.queryByTestId('branch-body-branch_0')).not.toBeInTheDocument()
      expect(screen.queryByTestId('card-children')).not.toBeInTheDocument()
    })

    it('exposes aria-expanded on the chevron button reflecting the open state', async () => {
      const user = userEvent.setup()
      renderCard()

      const toggle = screen.getByTestId('branch-toggle-branch_0')
      expect(toggle).toHaveAttribute('aria-expanded', 'true')

      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')

      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
    })

    it('starts with aria-expanded false when the card opens collapsed', () => {
      renderCard({ defaultOpen: false })

      expect(screen.getByTestId('branch-toggle-branch_0')).toHaveAttribute('aria-expanded', 'false')
    })

    // Guard: a toolbar role plus an expanded state on the toggle row is invalid.
    it('renders the header as a plain clickable row, not a toolbar', () => {
      renderCard()

      const header = screen.getByTestId('branch-header-branch_0')
      expect(header).not.toHaveAttribute('role', 'toolbar')
      expect(header).not.toHaveAttribute('aria-expanded')
      expect(screen.getByTestId('branch-toggle-branch_0')).toHaveAttribute('aria-expanded', 'true')
    })
  })

  describe('Reorder', () => {
    it('omits both reorder buttons when canMove is false', () => {
      renderCard({ canMove: false })

      expect(screen.queryByTestId('branch-move-up-branch_0')).not.toBeInTheDocument()
      expect(screen.queryByTestId('branch-move-down-branch_0')).not.toBeInTheDocument()
    })

    it('enables both reorder buttons when the branch can move either way', () => {
      renderCard({ canMove: true, canMoveUp: true, canMoveDown: true })

      expect(screen.getByTestId('branch-move-up-branch_0')).not.toBeDisabled()
      expect(screen.getByTestId('branch-move-down-branch_0')).not.toBeDisabled()
    })

    it('renders the reorder buttons visually disabled when the branch cannot move', () => {
      renderCard({ canMove: true, canMoveUp: false, canMoveDown: false })

      const upButton = screen.getByTestId('branch-move-up-branch_0')
      const downButton = screen.getByTestId('branch-move-down-branch_0')

      expect(upButton).toBeDisabled()
      expect(upButton.className).toContain('opacity-50')
      expect(upButton.className).toContain('cursor-not-allowed')
      expect(downButton).toBeDisabled()
      expect(downButton.className).toContain('opacity-50')
      expect(downButton.className).toContain('cursor-not-allowed')
    })

    it('calls onMove with up when the move-up button is clicked', async () => {
      const user = userEvent.setup()
      const { onMove } = renderCard()

      await user.click(screen.getByTestId('branch-move-up-branch_0'))

      expect(onMove).toHaveBeenCalledWith('up')
    })

    it('calls onMove with down when the move-down button is clicked', async () => {
      const user = userEvent.setup()
      const { onMove } = renderCard()

      await user.click(screen.getByTestId('branch-move-down-branch_0'))

      expect(onMove).toHaveBeenCalledWith('down')
    })

    it('does not call onMove when a reorder button is disabled', async () => {
      const user = userEvent.setup()
      const { onMove } = renderCard({ canMove: true, canMoveUp: false, canMoveDown: false })

      await user.click(screen.getByTestId('branch-move-up-branch_0'))

      expect(onMove).not.toHaveBeenCalled()
    })

    it('does not toggle the body when a reorder button is clicked', async () => {
      const user = userEvent.setup()
      renderCard()

      await user.click(screen.getByTestId('branch-move-up-branch_0'))

      expect(screen.getByTestId('branch-body-branch_0')).toBeInTheDocument()
    })
  })

  describe('Delete', () => {
    it('omits the delete button when canDelete is false', () => {
      renderCard({ canDelete: false })

      expect(screen.queryByTestId('branch-delete-branch_0')).not.toBeInTheDocument()
    })

    it('calls onDelete when the delete button is enabled', async () => {
      const user = userEvent.setup()
      const { onDelete } = renderCard({ canDelete: true })

      await user.click(screen.getByTestId('branch-delete-branch_0'))

      expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('renders the delete button visually disabled when deleteDisabled is true', () => {
      renderCard({ canDelete: true, deleteDisabled: true })

      const deleteButton = screen.getByTestId('branch-delete-branch_0')
      expect(deleteButton).toBeDisabled()
      expect(deleteButton.className).toContain('opacity-50')
      expect(deleteButton.className).toContain('cursor-not-allowed')
    })

    it('does not call onDelete when the delete button is disabled', async () => {
      const user = userEvent.setup()
      const { onDelete } = renderCard({ canDelete: true, deleteDisabled: true })

      await user.click(screen.getByTestId('branch-delete-branch_0'))

      expect(onDelete).not.toHaveBeenCalled()
    })

    it('does not toggle the body when the delete button is clicked', async () => {
      const user = userEvent.setup()
      renderCard({ canDelete: true })

      await user.click(screen.getByTestId('branch-delete-branch_0'))

      expect(screen.getByTestId('branch-body-branch_0')).toBeInTheDocument()
    })
  })

  describe('Aria labels', () => {
    it('defaults the aria noun to branch', () => {
      renderCard()

      expect(screen.getByTestId('branch-toggle-branch_0')).toHaveAttribute(
        'aria-label',
        'Collapse branch'
      )
      expect(screen.getByTestId('branch-move-up-branch_0')).toHaveAttribute(
        'aria-label',
        'Move branch up'
      )
      expect(screen.getByTestId('branch-move-down-branch_0')).toHaveAttribute(
        'aria-label',
        'Move branch down'
      )
      expect(screen.getByTestId('branch-delete-branch_0')).toHaveAttribute(
        'aria-label',
        'Delete branch'
      )
    })

    // Guard: case cards do not inherit the branch aria noun.
    it('derives the aria labels from the noun prop', () => {
      renderCard({ testIdPrefix: 'case', noun: 'case' })

      expect(screen.getByTestId('case-toggle-branch_0')).toHaveAttribute(
        'aria-label',
        'Collapse case'
      )
      expect(screen.getByTestId('case-move-up-branch_0')).toHaveAttribute(
        'aria-label',
        'Move case up'
      )
      expect(screen.getByTestId('case-move-down-branch_0')).toHaveAttribute(
        'aria-label',
        'Move case down'
      )
      expect(screen.getByTestId('case-delete-branch_0')).toHaveAttribute(
        'aria-label',
        'Delete case'
      )
    })

    it('flips the toggle aria label between Expand and Collapse', async () => {
      const user = userEvent.setup()
      renderCard({ noun: 'default' })

      expect(screen.getByTestId('branch-toggle-branch_0')).toHaveAttribute(
        'aria-label',
        'Collapse default'
      )

      await user.click(screen.getByTestId('branch-toggle-branch_0'))
      expect(screen.getByTestId('branch-toggle-branch_0')).toHaveAttribute(
        'aria-label',
        'Expand default'
      )

      await user.click(screen.getByTestId('branch-toggle-branch_0'))
      expect(screen.getByTestId('branch-toggle-branch_0')).toHaveAttribute(
        'aria-label',
        'Collapse default'
      )
    })

    it('starts with the Expand label when the card opens collapsed', () => {
      renderCard({ defaultOpen: false })

      expect(screen.getByTestId('branch-toggle-branch_0')).toHaveAttribute(
        'aria-label',
        'Expand branch'
      )
    })

    // The name field is not named by its placeholder alone.
    it('names the label input from the noun prop', () => {
      renderCard({ testIdPrefix: 'case', noun: 'case' })

      expect(screen.getByRole('textbox', { name: 'Name for case' })).toBe(
        screen.getByTestId('case-label-branch_0')
      )
    })
  })

  describe('Header-only mode', () => {
    it('keeps the chevron and the body when collapsible is omitted', () => {
      renderCard()

      expect(screen.getByTestId('branch-toggle-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('branch-body-branch_0')).toBeInTheDocument()
    })

    it('keeps the chevron and the body when collapsible is true', () => {
      renderCard({ collapsible: true })

      expect(screen.getByTestId('branch-toggle-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('branch-body-branch_0')).toBeInTheDocument()
    })

    // Guard: a chevron that expands to nothing is an affordance that lies.
    it('renders no chevron when collapsible is false', () => {
      renderCard({ collapsible: false })

      expect(screen.queryByTestId('branch-toggle-branch_0')).not.toBeInTheDocument()
    })

    it('renders no body when collapsible is false', () => {
      renderCard({ collapsible: false })

      expect(screen.queryByTestId('branch-body-branch_0')).not.toBeInTheDocument()
      expect(screen.queryByTestId('card-children')).not.toBeInTheDocument()
    })

    it('still renders the card, header, badge and label input', () => {
      renderCard({ collapsible: false, label: 'ingest' })

      expect(screen.getByTestId('branch-card-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('branch-header-branch_0')).toBeInTheDocument()
      expect(screen.getByText('CASE')).toBeInTheDocument()
      expect((screen.getByTestId('branch-label-branch_0') as HTMLInputElement).value).toBe('ingest')
    })

    it('still renders the reorder and delete controls', () => {
      renderCard({ collapsible: false })

      expect(screen.getByTestId('branch-move-up-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('branch-move-down-branch_0')).toBeInTheDocument()
      expect(screen.getByTestId('branch-delete-branch_0')).toBeInTheDocument()
    })

    it('still renders the headerExtra slot', () => {
      renderCard({
        collapsible: false,
        headerExtra: <span data-testid="header-extra-slot">30000</span>,
      })

      expect(screen.getByTestId('header-extra-slot')).toBeInTheDocument()
    })
  })

  describe('Label placeholder', () => {
    it('defaults to the shared branch-name placeholder', () => {
      renderCard()

      expect(screen.getByTestId('branch-label-branch_0')).toHaveAttribute(
        'placeholder',
        'Branch name…',
      )
    })

    it('uses the caller placeholder when given', () => {
      renderCard({ labelPlaceholder: 'Branch 3' })

      expect(screen.getByTestId('branch-label-branch_0')).toHaveAttribute(
        'placeholder',
        'Branch 3',
      )
    })
  })

  describe('Disabled-delete explanation', () => {
    it('renders no tooltip when the delete button is enabled', async () => {
      const user = userEvent.setup()
      renderCard({ canDelete: true, deleteDisabledReason: 'Needs at least two' })

      await user.hover(screen.getByTestId('branch-delete-branch_0'))

      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    it('explains a disabled delete on hover', async () => {
      const user = userEvent.setup()
      renderCard({
        canDelete: true,
        deleteDisabled: true,
        deleteDisabledReason: 'A parallel section needs at least two branches',
      })

      await user.hover(screen.getByTestId('branch-delete-branch_0'))

      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'A parallel section needs at least two branches',
      )
    })

    it('renders no tooltip for a disabled delete with no reason given', async () => {
      const user = userEvent.setup()
      renderCard({ canDelete: true, deleteDisabled: true })

      await user.hover(screen.getByTestId('branch-delete-branch_0'))

      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
  })

  describe('Incomplete marker', () => {
    it('renders no marker when the card is complete', () => {
      renderCard()
      expect(screen.queryByTestId('branch-alert-branch_0')).not.toBeInTheDocument()
    })

    it('marks an incomplete card in the header, where a collapsed card still shows it', () => {
      renderCard({ alert: 'This branch has no assertions yet - Save is blocked until it has one' })

      const marker = screen.getByTestId('branch-alert-branch_0')
      expect(marker).toBeInTheDocument()
      expect(screen.getByTestId('branch-header-branch_0')).toContainElement(marker)
    })

    it('keeps the marker visible while the card is collapsed', async () => {
      const user = userEvent.setup()
      renderCard({ alert: 'This branch has no assertions yet - Save is blocked until it has one' })

      await user.click(screen.getByTestId('branch-toggle-branch_0'))

      expect(screen.queryByTestId('branch-body-branch_0')).not.toBeInTheDocument()
      expect(screen.getByTestId('branch-alert-branch_0')).toBeInTheDocument()
    })

    it('explains the block on hover', async () => {
      const user = userEvent.setup()
      const message = 'This branch has no assertions yet - Save is blocked until it has one'
      renderCard({ alert: message })

      await user.hover(screen.getByTestId('branch-alert-branch_0'))

      expect(await screen.findByRole('tooltip')).toHaveTextContent(message)
    })
  })
})
