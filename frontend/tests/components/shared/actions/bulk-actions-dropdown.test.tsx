/**
 * BulkActionsDropdown Component Tests
 *
 * Tests for the shared bulk actions dropdown shell component that handles
 * the common selection mode toggle, dropdown trigger, and exit button UI.
 *
 * Component: frontend/src/components/shared/actions/bulk-actions-dropdown.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BulkActionsDropdown, BulkActionMenuItems } from '@/components/shared/actions/bulk-actions-dropdown'
import { DropdownItem, DropdownDivider } from '@/components/ui/dropdown'

describe('BulkActionsDropdown', () => {
  const defaultProps = {
    selectedCount: 3,
    selectionModeActive: true,
    onEnterSelectionMode: vi.fn(),
    onExitSelectionMode: vi.fn(),
  }

  describe('Mass Action Button (selection mode inactive)', () => {
    it('renders "Mass Action" button when not in selection mode', () => {
      render(
        <BulkActionsDropdown {...defaultProps} selectionModeActive={false}>
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )
      expect(screen.getByRole('button', { name: /Mass Action/i })).toBeInTheDocument()
    })

    it('does not render dropdown or X button when not in selection mode', () => {
      render(
        <BulkActionsDropdown {...defaultProps} selectionModeActive={false}>
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )
      expect(screen.queryByTestId('bulk-actions-dropdown')).not.toBeInTheDocument()
      expect(screen.queryByTestId('selection-close')).not.toBeInTheDocument()
    })

    it('calls onEnterSelectionMode when Mass Action button is clicked', async () => {
      const onEnterSelectionMode = vi.fn()
      const user = userEvent.setup()
      render(
        <BulkActionsDropdown
          {...defaultProps}
          selectionModeActive={false}
          onEnterSelectionMode={onEnterSelectionMode}
        >
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )

      await user.click(screen.getByRole('button', { name: /Mass Action/i }))
      expect(onEnterSelectionMode).toHaveBeenCalled()
    })

    it('Mass Action button has accessible label', () => {
      render(
        <BulkActionsDropdown {...defaultProps} selectionModeActive={false}>
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )
      expect(
        screen.getByRole('button', { name: 'Mass Action - click to enter selection mode' })
      ).toBeInTheDocument()
    })
  })

  describe('Selection Mode Active', () => {
    it('renders default selection label from selectedCount', () => {
      render(
        <BulkActionsDropdown {...defaultProps}>
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )
      expect(screen.getByRole('button', { name: /3 selected/i })).toBeInTheDocument()
    })

    it('renders 0 selected when selectedCount is 0', () => {
      render(
        <BulkActionsDropdown {...defaultProps} selectedCount={0}>
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )
      expect(screen.getByRole('button', { name: /0 selected/i })).toBeInTheDocument()
    })

    it('uses custom selectionLabel when provided', () => {
      render(
        <BulkActionsDropdown {...defaultProps} selectionLabel="All 5 selected">
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )
      expect(screen.getByRole('button', { name: /All 5 selected/i })).toBeInTheDocument()
    })

    it('renders bulk-actions-dropdown wrapper', () => {
      render(
        <BulkActionsDropdown {...defaultProps}>
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )
      expect(screen.getByTestId('bulk-actions-dropdown')).toBeInTheDocument()
    })

    it('renders selection counter with correct test id', () => {
      render(
        <BulkActionsDropdown {...defaultProps}>
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )
      expect(screen.getByTestId('selection-counter')).toBeInTheDocument()
    })

    it('selection counter has aria-live for screen readers', () => {
      render(
        <BulkActionsDropdown {...defaultProps}>
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )
      expect(screen.getByTestId('selection-counter')).toHaveAttribute('aria-live', 'polite')
    })
  })

  describe('Dropdown Menu', () => {
    it('opens menu when selection counter is clicked', async () => {
      const user = userEvent.setup()
      render(
        <BulkActionsDropdown {...defaultProps}>
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )

      await user.click(screen.getByRole('button', { name: /3 selected/i }))
      await waitFor(() => {
        expect(screen.getByRole('menu')).toBeInTheDocument()
      })
    })

    it('renders children as menu items', async () => {
      const user = userEvent.setup()
      render(
        <BulkActionsDropdown {...defaultProps}>
          <DropdownItem data-testid="item-export">Export</DropdownItem>
          <DropdownDivider />
          <DropdownItem data-testid="item-delete">Delete</DropdownItem>
        </BulkActionsDropdown>
      )

      await user.click(screen.getByRole('button', { name: /3 selected/i }))
      await waitFor(() => {
        expect(screen.getByTestId('item-export')).toBeInTheDocument()
        expect(screen.getByTestId('item-delete')).toBeInTheDocument()
      })
    })

    it('menu has correct test id', async () => {
      const user = userEvent.setup()
      render(
        <BulkActionsDropdown {...defaultProps}>
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )

      await user.click(screen.getByRole('button', { name: /3 selected/i }))
      await waitFor(() => {
        expect(screen.getByTestId('bulk-actions-menu')).toBeInTheDocument()
      })
    })
  })

  describe('Exit Selection Mode', () => {
    it('renders X button to exit selection mode', () => {
      render(
        <BulkActionsDropdown {...defaultProps}>
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )
      expect(screen.getByRole('button', { name: /Exit selection mode/i })).toBeInTheDocument()
    })

    it('X button has correct test id', () => {
      render(
        <BulkActionsDropdown {...defaultProps}>
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )
      expect(screen.getByTestId('selection-close')).toBeInTheDocument()
    })

    it('calls onExitSelectionMode when X button is clicked', async () => {
      const onExitSelectionMode = vi.fn()
      const user = userEvent.setup()
      render(
        <BulkActionsDropdown {...defaultProps} onExitSelectionMode={onExitSelectionMode}>
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )

      await user.click(screen.getByRole('button', { name: /Exit selection mode/i }))
      expect(onExitSelectionMode).toHaveBeenCalled()
    })
  })

  describe('Extra Content', () => {
    it('renders extraContent after the X button', () => {
      render(
        <BulkActionsDropdown
          {...defaultProps}
          extraContent={<div data-testid="extra-dialog">Dialog</div>}
        >
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )
      expect(screen.getByTestId('extra-dialog')).toBeInTheDocument()
    })

    it('does not render extraContent when not provided', () => {
      render(
        <BulkActionsDropdown {...defaultProps}>
          <DropdownItem>Test Item</DropdownItem>
        </BulkActionsDropdown>
      )
      // Just verify the component renders without error and no extra nodes
      expect(screen.getByTestId('selection-close')).toBeInTheDocument()
    })
  })
})

describe('BulkActionMenuItems', () => {
  const defaultMenuProps = {
    isDisabled: false,
    onRun: vi.fn(),
    onExport: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
  }

  /** Render BulkActionMenuItems inside a BulkActionsDropdown, then open the menu */
  async function renderAndOpenMenu(props: Omit<typeof defaultMenuProps, 'onRun'> & { onRun?: () => void; extraItems?: React.ReactNode } = defaultMenuProps) {
    const user = userEvent.setup()
    render(
      <BulkActionsDropdown
        selectedCount={2}
        selectionModeActive={true}
        onEnterSelectionMode={vi.fn()}
        onExitSelectionMode={vi.fn()}
      >
        <BulkActionMenuItems {...props} />
      </BulkActionsDropdown>
    )
    await user.click(screen.getByRole('button', { name: /2 selected/i }))
    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })
    return user
  }

  it('renders Run, Export, Duplicate, and Delete items', async () => {
    await renderAndOpenMenu(defaultMenuProps)

    expect(screen.getByTestId('bulk-action-run')).toBeInTheDocument()
    expect(screen.getByTestId('bulk-action-export')).toBeInTheDocument()
    expect(screen.getByTestId('bulk-action-duplicate')).toBeInTheDocument()
    expect(screen.getByTestId('bulk-action-delete')).toBeInTheDocument()
  })

  it('renders separator between Duplicate and Delete', async () => {
    await renderAndOpenMenu(defaultMenuProps)

    expect(screen.getByTestId('bulk-actions-separator')).toBeInTheDocument()
  })

  it('calls onRun when Run is clicked and not disabled', async () => {
    const onRun = vi.fn()
    const user = await renderAndOpenMenu({ ...defaultMenuProps, onRun })

    await user.click(screen.getByRole('menuitem', { name: /Run/i }))
    expect(onRun).toHaveBeenCalled()
  })

  it('calls onExport when Export is clicked and not disabled', async () => {
    const onExport = vi.fn()
    const user = await renderAndOpenMenu({ ...defaultMenuProps, onExport })

    await user.click(screen.getByRole('menuitem', { name: /Export/i }))
    expect(onExport).toHaveBeenCalled()
  })

  it('calls onDuplicate when Duplicate is clicked and not disabled', async () => {
    const onDuplicate = vi.fn()
    const user = await renderAndOpenMenu({ ...defaultMenuProps, onDuplicate })

    await user.click(screen.getByRole('menuitem', { name: /Duplicate/i }))
    expect(onDuplicate).toHaveBeenCalled()
  })

  it('calls onDelete when Delete is clicked and not disabled', async () => {
    const onDelete = vi.fn()
    const user = await renderAndOpenMenu({ ...defaultMenuProps, onDelete })

    await user.click(screen.getByRole('menuitem', { name: /Delete/i }))
    expect(onDelete).toHaveBeenCalled()
  })

  it('does not call handlers when disabled', async () => {
    const onRun = vi.fn()
    const user = await renderAndOpenMenu({ ...defaultMenuProps, isDisabled: true, onRun })

    await user.click(screen.getByRole('menuitem', { name: /Run/i }))
    expect(onRun).not.toHaveBeenCalled()
  })

  it('applies disabled class when isDisabled is true', async () => {
    await renderAndOpenMenu({ ...defaultMenuProps, isDisabled: true })

    expect(screen.getByTestId('bulk-action-run')).toHaveClass('text-muted')
    expect(screen.getByTestId('bulk-action-export')).toHaveClass('text-muted')
    expect(screen.getByTestId('bulk-action-duplicate')).toHaveClass('text-muted')
  })

  it('Delete has error styling with opacity when disabled', async () => {
    await renderAndOpenMenu({ ...defaultMenuProps, isDisabled: true })

    const deleteItem = screen.getByTestId('bulk-action-delete')
    expect(deleteItem).toHaveClass('text-error')
    expect(deleteItem).toHaveClass('opacity-50')
  })

  it('does not render Run item when onRun is omitted', async () => {
    const { onRun: _, ...propsWithoutRun } = defaultMenuProps
    await renderAndOpenMenu(propsWithoutRun)

    expect(screen.queryByTestId('bulk-action-run')).not.toBeInTheDocument()
    expect(screen.getByTestId('bulk-action-export')).toBeInTheDocument()
    expect(screen.getByTestId('bulk-action-duplicate')).toBeInTheDocument()
    expect(screen.getByTestId('bulk-action-delete')).toBeInTheDocument()
  })

  it('renders extraItems between Duplicate and separator', async () => {
    await renderAndOpenMenu({
      ...defaultMenuProps,
      extraItems: <DropdownItem data-testid="extra-item">Move to Suite</DropdownItem>,
    })

    // Verify order: Run, Export, Duplicate, Extra, [separator], Delete
    const menuItems = screen.getAllByRole('menuitem')
    expect(menuItems[0]).toHaveTextContent(/Run/i)
    expect(menuItems[1]).toHaveTextContent(/Export/i)
    expect(menuItems[2]).toHaveTextContent(/Duplicate/i)
    expect(menuItems[3]).toHaveTextContent(/Move to Suite/i)
    expect(menuItems[4]).toHaveTextContent(/Delete/i)
  })
})

describe('BulkActionMenuItems - optional Export and Duplicate (BULK-3)', () => {
  type MenuItemsProps = Parameters<typeof BulkActionMenuItems>[0]

  async function openMenu(props: Partial<MenuItemsProps>, selectedCount = 2) {
    const user = userEvent.setup()
    render(
      <BulkActionsDropdown
        selectedCount={selectedCount}
        selectionModeActive={true}
        onEnterSelectionMode={vi.fn()}
        onExitSelectionMode={vi.fn()}
      >
        <BulkActionMenuItems isDisabled={selectedCount === 0} onDelete={vi.fn()} {...props} />
      </BulkActionsDropdown>
    )
    await user.click(screen.getByRole('button', { name: `${selectedCount} selected` }))
    const menu = await screen.findByRole('menu')
    return { user, menu }
  }

  const itemNames = (menu: HTMLElement) =>
    within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim())

  it('renders only the red Delete item and no separator when Export and Duplicate are omitted', async () => {
    const { menu } = await openMenu({})

    expect(itemNames(menu)).toEqual(['Delete'])
    expect(screen.getByTestId('bulk-action-delete')).toHaveClass('text-error')
    expect(screen.queryByTestId('bulk-actions-separator')).not.toBeInTheDocument()
    expect(within(menu).queryByRole('separator')).not.toBeInTheDocument()
  })

  it('calls onDelete from the Delete-only menu', async () => {
    const onDelete = vi.fn()
    const { user } = await openMenu({ onDelete })

    await user.click(screen.getByRole('menuitem', { name: /Delete/ }))

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('opens the Delete-only menu with Delete disabled when nothing is selected (BULK-4)', async () => {
    const onDelete = vi.fn()
    const { user, menu } = await openMenu({ onDelete }, 0)

    expect(itemNames(menu)).toEqual(['Delete'])
    const deleteItem = screen.getByTestId('bulk-action-delete')
    expect(deleteItem).toHaveAttribute('aria-disabled', 'true')
    expect(deleteItem).toHaveClass('text-error', 'opacity-50')
    await user.click(deleteItem)
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('renders Export without Duplicate, then the separator and Delete', async () => {
    const { menu } = await openMenu({ onExport: vi.fn() })

    expect(itemNames(menu)).toEqual(['Export', 'Delete'])
    expect(screen.queryByTestId('bulk-action-duplicate')).not.toBeInTheDocument()
    expect(screen.getByTestId('bulk-actions-separator')).toBeInTheDocument()
  })

  it('renders Duplicate without Export, then the separator and Delete', async () => {
    const { menu } = await openMenu({ onDuplicate: vi.fn() })

    expect(itemNames(menu)).toEqual(['Duplicate', 'Delete'])
    expect(screen.queryByTestId('bulk-action-export')).not.toBeInTheDocument()
    expect(screen.getByTestId('bulk-actions-separator')).toBeInTheDocument()
  })

  it('renders the separator when only Run precedes Delete', async () => {
    const { menu } = await openMenu({ onRun: vi.fn() })

    expect(itemNames(menu)).toEqual(['Run', 'Delete'])
    expect(screen.getByTestId('bulk-actions-separator')).toBeInTheDocument()
  })

  it('renders the separator when only extra items precede Delete', async () => {
    const { menu } = await openMenu({
      extraItems: <DropdownItem data-testid="extra-item">Move to Suite</DropdownItem>,
    })

    expect(itemNames(menu)).toEqual(['Move to Suite', 'Delete'])
    expect(screen.getByTestId('bulk-actions-separator')).toBeInTheDocument()
  })

  it('places the separator directly before Delete', async () => {
    const { menu } = await openMenu({ onExport: vi.fn() })

    const separator = within(menu).getByRole('separator')
    expect(separator.nextElementSibling).toBe(screen.getByTestId('bulk-action-delete'))
  })

  it('keeps Export, Duplicate, the separator and Delete when every handler is given', async () => {
    const { menu } = await openMenu({ onExport: vi.fn(), onDuplicate: vi.fn() })

    expect(itemNames(menu)).toEqual(['Export', 'Duplicate', 'Delete'])
    expect(screen.getByTestId('bulk-actions-separator')).toBeInTheDocument()
  })
})

describe('BulkActionsDropdown - disabled', () => {
  it('disables the selection trigger so the menu cannot open', async () => {
    const user = userEvent.setup()
    render(
      <BulkActionsDropdown
        selectedCount={2}
        selectionModeActive={true}
        onEnterSelectionMode={vi.fn()}
        onExitSelectionMode={vi.fn()}
        disabled
      >
        <BulkActionMenuItems isDisabled={false} onDelete={vi.fn()} />
      </BulkActionsDropdown>
    )

    const trigger = screen.getByRole('button', { name: '2 selected' })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('keeps the selection trigger enabled by default', () => {
    render(
      <BulkActionsDropdown
        selectedCount={2}
        selectionModeActive={true}
        onEnterSelectionMode={vi.fn()}
        onExitSelectionMode={vi.fn()}
      >
        <BulkActionMenuItems isDisabled={false} onDelete={vi.fn()} />
      </BulkActionsDropdown>
    )

    expect(screen.getByRole('button', { name: '2 selected' })).toBeEnabled()
  })
})
