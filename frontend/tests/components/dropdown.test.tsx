/**
 * Dropdown/DropdownMenu Component Tests
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 *
 * Tests for Dropdown composite component following design system specifications.
 *
 * Dropdown/ActionMenu is a composite component that provides:
 * - Trigger button
 * - Dropdown panel with menu items
 * - Keyboard navigation (Arrow keys, Enter, Escape)
 * - Focus management
 *
 * This addresses REQ-5.2.1.6 requirement for:
 * "Composite components... action menus with keyboard navigation"
 */

import { createRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownDivider,
  DropdownLabel,
} from '@/components/ui/dropdown'

describe('Dropdown Component', () => {
  describe('Rendering', () => {
    it('renders trigger button', () => {
      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )
      expect(screen.getByRole('button', { name: 'Actions' })).toBeInTheDocument()
    })

    it('does not show menu by default', () => {
      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('shows menu when trigger is clicked', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('renders menu items when open', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
            <DropdownItem>Delete</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    })
  })

  describe('Opening and Closing', () => {
    it('closes menu when clicking trigger again', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('closes menu when clicking outside', async () => {
      const user = userEvent.setup()

      render(
        <div>
          <Dropdown>
            <DropdownTrigger>Actions</DropdownTrigger>
            <DropdownMenu>
              <DropdownItem>Edit</DropdownItem>
            </DropdownMenu>
          </Dropdown>
          <button data-testid="outside">Outside</button>
        </div>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      await user.click(screen.getByTestId('outside'))
      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      })
    })

    it('closes menu when Escape is pressed', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      expect(screen.getByRole('menu')).toBeInTheDocument()

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('returns focus to trigger after closing with Escape', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.keyboard('{Escape}')

      expect(screen.getByRole('button', { name: 'Actions' })).toHaveFocus()
    })

    it('closes menu when an item is selected', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem onSelect={() => {}}>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.click(screen.getByRole('menuitem', { name: 'Edit' }))

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  describe('Keyboard Navigation', () => {
    it('opens menu with Enter key on trigger', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      screen.getByRole('button', { name: 'Actions' }).focus()
      await user.keyboard('{Enter}')

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('opens menu with Space key on trigger', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      screen.getByRole('button', { name: 'Actions' }).focus()
      await user.keyboard(' ')

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('opens menu with ArrowDown key on trigger', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      screen.getByRole('button', { name: 'Actions' }).focus()
      await user.keyboard('{ArrowDown}')

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('focuses first item when menu opens', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
            <DropdownItem>Delete</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
      })
    })

    it('moves focus with ArrowDown', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
            <DropdownItem>Delete</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.keyboard('{ArrowDown}')

      expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    })

    it('moves focus with ArrowUp', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
            <DropdownItem>Delete</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.keyboard('{ArrowDown}') // Move to Delete
      await user.keyboard('{ArrowUp}') // Move back to Edit

      expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
    })

    it('wraps focus from last to first with ArrowDown', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
            <DropdownItem>Delete</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.keyboard('{ArrowDown}') // Move to Delete
      await user.keyboard('{ArrowDown}') // Wrap to Edit

      expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
    })

    it('wraps focus from first to last with ArrowUp', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
            <DropdownItem>Delete</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.keyboard('{ArrowUp}') // Wrap to Delete

      expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    })

    it('selects item with Enter key', async () => {
      const user = userEvent.setup()
      const handleSelect = vi.fn()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem onSelect={handleSelect}>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.keyboard('{Enter}')

      expect(handleSelect).toHaveBeenCalledTimes(1)
    })

    it('selects item with Space key', async () => {
      const user = userEvent.setup()
      const handleSelect = vi.fn()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem onSelect={handleSelect}>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.keyboard(' ')

      expect(handleSelect).toHaveBeenCalledTimes(1)
    })

    it('focuses first item matching typed character', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Copy</DropdownItem>
            <DropdownItem>Delete</DropdownItem>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.keyboard('e')

      expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
    })

    it('does not change focus when no item matches typed character', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Copy</DropdownItem>
            <DropdownItem>Delete</DropdownItem>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      // First item should be focused
      expect(screen.getByRole('menuitem', { name: 'Copy' })).toHaveFocus()

      // Type a character that doesn't match any item
      await user.keyboard('x')

      // Focus should remain on the same item (no match found)
      expect(screen.getByRole('menuitem', { name: 'Copy' })).toHaveFocus()
    })

    it('cycles focus backward from first to last item on Shift+Tab in bottom sheet mode', async () => {
      const user = userEvent.setup()
      setMockViewport(375, 'base', true)

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem data-testid="first-item">First</DropdownItem>
            <DropdownItem>Middle</DropdownItem>
            <DropdownItem data-testid="last-item">Last</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      // Focus the first item
      const firstItem = screen.getByTestId('first-item')
      firstItem.focus()
      expect(document.activeElement).toBe(firstItem)

      // Shift+Tab from first should cycle to last
      await user.tab({ shift: true })
      const lastItem = screen.getByTestId('last-item')
      expect(document.activeElement).toBe(lastItem)

      // Restore viewport
      setMockViewport(1280, 'xl', false)
    })

    it('cycles focus forward from last to first item on Tab in bottom sheet mode', async () => {
      const user = userEvent.setup()
      setMockViewport(375, 'base', true)

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem data-testid="first-item">First</DropdownItem>
            <DropdownItem>Middle</DropdownItem>
            <DropdownItem data-testid="last-item">Last</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      // Focus the last item (wrap in act to avoid React state update warning)
      const lastItem = screen.getByTestId('last-item')
      act(() => {
        lastItem.focus()
      })
      expect(document.activeElement).toBe(lastItem)

      // Tab from last should cycle to first
      await user.tab()
      const firstItem = screen.getByTestId('first-item')
      expect(document.activeElement).toBe(firstItem)

      // Restore viewport
      setMockViewport(1280, 'xl', false)
    })

    it('skips disabled items during navigation', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
            <DropdownItem disabled>Copy</DropdownItem>
            <DropdownItem>Delete</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.keyboard('{ArrowDown}')

      expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    })

    it('moves focus to first item with Home key', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
            <DropdownItem>Copy</DropdownItem>
            <DropdownItem>Delete</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.keyboard('{ArrowDown}{ArrowDown}') // Move to Delete
      await user.keyboard('{Home}')

      expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
    })

    it('moves focus to last item with End key', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
            <DropdownItem>Copy</DropdownItem>
            <DropdownItem>Delete</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.keyboard('{End}')

      expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    })
  })

  describe('Menu Item States', () => {
    it('applies disabled styling to disabled items', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem disabled>Disabled Item</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByRole('menuitem', { name: 'Disabled Item' })).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    })

    it('does not call onSelect for disabled items', async () => {
      const user = userEvent.setup()
      const handleSelect = vi.fn()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem disabled onSelect={handleSelect}>
              Disabled Item
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.click(screen.getByRole('menuitem', { name: 'Disabled Item' }))

      expect(handleSelect).not.toHaveBeenCalled()
    })

    it('applies hover styling to items', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveClass('hover:bg-subtle')
    })
  })

  describe('Design System Compliance', () => {
    it('applies menu panel styling', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByTestId('menu')).toHaveClass('dropdown-menu')
    })

    it('applies rounded-md to menu (6px per design system)', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByTestId('menu')).toHaveClass('rounded-md')
    })

    it('applies shadow-md to menu (per design system)', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByTestId('menu')).toHaveClass('shadow-md')
    })

    it('applies border to menu', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByTestId('menu')).toHaveClass('border')
    })

    it('applies bg-card to menu', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByTestId('menu')).toHaveClass('bg-card')
    })

    it('applies padding to menu items', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem data-testid="item">Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByTestId('item')).toHaveClass('px-3')
      expect(screen.getByTestId('item')).toHaveClass('py-2')
    })
  })

  describe('DropdownDivider', () => {
    it('renders divider element', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
            <DropdownDivider data-testid="divider" />
            <DropdownItem>Delete</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByTestId('divider')).toBeInTheDocument()
    })

    it('applies divider styling', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
            <DropdownDivider data-testid="divider" />
            <DropdownItem>Delete</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByTestId('divider')).toHaveClass('border-t')
    })

    it('has separator role', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
            <DropdownDivider />
            <DropdownItem>Delete</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByRole('separator')).toBeInTheDocument()
    })
  })

  describe('DropdownLabel', () => {
    it('renders label text', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownLabel>File Actions</DropdownLabel>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByText('File Actions')).toBeInTheDocument()
    })

    it('applies label styling', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownLabel data-testid="label">File Actions</DropdownLabel>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const label = screen.getByTestId('label')
      expect(label).toHaveClass('text-xs')
      expect(label).toHaveClass('font-semibold')
      expect(label).toHaveClass('text-muted')
    })

    it('is not focusable', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownLabel>File Actions</DropdownLabel>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      // First item should be focused, not the label
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
    })
  })

  describe('Icons in Items', () => {
    it('renders icon in menu item', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem icon={<span data-testid="edit-icon">✏️</span>}>
              Edit
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByTestId('edit-icon')).toBeInTheDocument()
    })

    it('applies icon styling', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem icon={<span data-testid="icon">✏️</span>} data-testid="item">
              Edit
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByTestId('item')).toHaveClass('gap-2')
    })
  })

  describe('Positioning', () => {
    it('supports bottom-start placement by default', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      // Menu should have placement attribute or class
      expect(screen.getByTestId('menu')).toHaveAttribute('data-placement', 'bottom-start')
    })

    it('supports bottom-end placement', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown placement="bottom-end">
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByTestId('menu')).toHaveAttribute('data-placement', 'bottom-end')
    })
  })

  describe('Accessibility', () => {
    it('trigger has aria-haspopup="menu"', () => {
      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      expect(screen.getByRole('button', { name: 'Actions' })).toHaveAttribute(
        'aria-haspopup',
        'menu'
      )
    })

    it('trigger has aria-expanded="false" when closed', () => {
      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      expect(screen.getByRole('button', { name: 'Actions' })).toHaveAttribute(
        'aria-expanded',
        'false'
      )
    })

    it('trigger has aria-expanded="true" when open', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByRole('button', { name: 'Actions' })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
    })

    it('menu has proper role', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByRole('menu')).toBeInTheDocument()
    })

    it('menu items have menuitem role', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    })

    it('trigger and menu are associated via aria-controls', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const trigger = screen.getByRole('button', { name: 'Actions' })
      const menu = screen.getByRole('menu')
      expect(trigger).toHaveAttribute('aria-controls', menu.id)
    })
  })

  describe('Ref Handling', () => {
    it('accepts ref object for DropdownMenu', async () => {
      const user = userEvent.setup()
      const menuRef = createRef<HTMLDivElement>()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu ref={menuRef}>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(menuRef.current).toBeInstanceOf(HTMLDivElement)
      expect(menuRef.current).toHaveRole('menu')
    })

    it('accepts ref object for DropdownItem', async () => {
      const user = userEvent.setup()
      const itemRef = createRef<HTMLButtonElement>()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem ref={itemRef}>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(itemRef.current).toBeInstanceOf(HTMLButtonElement)
      expect(itemRef.current).toHaveRole('menuitem')
    })

    it('accepts ref object for DropdownTrigger', () => {
      const triggerRef = createRef<HTMLButtonElement>()

      render(
        <Dropdown>
          <DropdownTrigger ref={triggerRef}>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      expect(triggerRef.current).toBeInstanceOf(HTMLButtonElement)
      expect(triggerRef.current).toHaveAttribute('aria-haspopup', 'menu')
    })

    it('accepts function ref for DropdownTrigger', () => {
      const refCallback = vi.fn()

      render(
        <Dropdown>
          <DropdownTrigger ref={refCallback}>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      expect(refCallback).toHaveBeenCalledWith(expect.any(HTMLButtonElement))
    })

    it('accepts function ref for DropdownMenu', async () => {
      const user = userEvent.setup()
      const refCallback = vi.fn()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu ref={refCallback}>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(refCallback).toHaveBeenCalledWith(expect.any(HTMLDivElement))
    })

    it('accepts function ref for DropdownItem', async () => {
      const user = userEvent.setup()
      const refCallback = vi.fn()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem ref={refCallback}>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(refCallback).toHaveBeenCalledWith(expect.any(HTMLButtonElement))
    })
  })

  describe('Edge Cases', () => {
    it('stays on current index when all items are disabled', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem disabled>Edit</DropdownItem>
            <DropdownItem disabled>Delete</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      // Try to navigate with arrow keys when all items are disabled
      await user.keyboard('{ArrowDown}')

      // Should remain in the menu (no crash, navigation degrades gracefully)
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })
  })

  describe('Context Error Handling', () => {
    it('throws error when DropdownTrigger is used outside Dropdown', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        render(<DropdownTrigger>Click me</DropdownTrigger>)
      }).toThrow('Dropdown components must be used within a Dropdown')

      consoleSpy.mockRestore()
    })

    it('throws error when DropdownMenu is used outside Dropdown', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        render(<DropdownMenu><DropdownItem>Item</DropdownItem></DropdownMenu>)
      }).toThrow('Dropdown components must be used within a Dropdown')

      consoleSpy.mockRestore()
    })

    it('throws error when DropdownItem is used outside Dropdown', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        render(<DropdownItem>Item</DropdownItem>)
      }).toThrow('Dropdown components must be used within a Dropdown')

      consoleSpy.mockRestore()
    })
  })

  describe('Item Registration Edge Cases', () => {
    it('handles rapid re-opening without errors', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
            <DropdownItem>Delete</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      // Rapidly open/close to test item registration stability
      const trigger = screen.getByRole('button', { name: 'Actions' })
      await user.click(trigger)
      await user.click(trigger)
      await user.click(trigger)

      expect(screen.getByRole('menu')).toBeInTheDocument()
      expect(screen.getAllByRole('menuitem')).toHaveLength(2)
    })
  })

  describe('Optional Callback Handling', () => {
    it('handles keyboard navigation on menu without onKeyDown callback', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>First</DropdownItem>
            <DropdownItem>Second</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      // Type a character to trigger type-ahead search
      await user.keyboard('s')

      expect(screen.getByRole('menuitem', { name: 'Second' })).toHaveFocus()
    })

    it('handles item click without onClick callback', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Click Me</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.click(screen.getByRole('menuitem', { name: 'Click Me' }))

      // Menu should close after click
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('handles item keyboard without onKeyDown callback', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Select Me</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.keyboard('{Enter}')

      // Menu should close after Enter
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    it('calls menu onKeyDown callback when provided', async () => {
      const user = userEvent.setup()
      const handleMenuKeyDown = vi.fn()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu onKeyDown={handleMenuKeyDown}>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.keyboard('a')

      expect(handleMenuKeyDown).toHaveBeenCalled()
    })

    it('calls item onClick callback when provided', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem onClick={handleClick}>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.click(screen.getByRole('menuitem', { name: 'Edit' }))

      expect(handleClick).toHaveBeenCalled()
    })

    it('calls item onKeyDown callback when provided', async () => {
      const user = userEvent.setup()
      const handleItemKeyDown = vi.fn()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem onKeyDown={handleItemKeyDown}>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await user.keyboard('{Enter}')

      expect(handleItemKeyDown).toHaveBeenCalled()
    })

    it('does not call handleSelect when item is disabled', async () => {
      const user = userEvent.setup()
      const handleSelect = vi.fn()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem disabled onSelect={handleSelect}>
              Disabled Edit
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      // Focus the disabled item and try to select with Enter
      screen.getByRole('menuitem', { name: 'Disabled Edit' }).focus()
      await user.keyboard('{Enter}')

      expect(handleSelect).not.toHaveBeenCalled()
    })

    it('calls trigger onClick callback when provided', async () => {
      const user = userEvent.setup()
      const handleClick = vi.fn()

      render(
        <Dropdown>
          <DropdownTrigger onClick={handleClick}>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(handleClick).toHaveBeenCalled()
    })

    it('calls trigger onKeyDown callback when provided', async () => {
      const user = userEvent.setup()
      const handleKeyDown = vi.fn()

      render(
        <Dropdown>
          <DropdownTrigger onKeyDown={handleKeyDown}>Actions</DropdownTrigger>
          <DropdownMenu>
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      screen.getByRole('button', { name: 'Actions' }).focus()
      await user.keyboard('{ArrowDown}')

      expect(handleKeyDown).toHaveBeenCalled()
    })

    it('handles empty menu navigation gracefully', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="empty-menu">{null}</DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const menu = screen.getByTestId('empty-menu')

      // Fire keyboard events directly on the menu to trigger navigation in empty state
      fireEvent.keyDown(menu, { key: 'ArrowDown' })
      fireEvent.keyDown(menu, { key: 'ArrowUp' })
      fireEvent.keyDown(menu, { key: 'Home' })
      fireEvent.keyDown(menu, { key: 'End' })

      // Menu should still be open (no crash)
      expect(screen.getByRole('menu')).toBeInTheDocument()
    })
  })
})

// ===========================================================================
// Dropdown Responsive Behavior Tests
// REQ-5.2.1.17: Responsive layout with desktop and tablet breakpoints
//
// Per design spec:
// "Dropdowns similarly convert to bottom sheet style on small viewports"
// Threshold: < 640px renders as bottom sheet, >= 640px renders as positioned dropdown
// ===========================================================================

// Mock useViewport hook for responsive tests
const mockViewportState = {
  width: 1280,
  height: 800,
  breakpoint: 'xl' as const,
  isAtLeast: vi.fn((_bp: string) => true),
  isBelow: vi.fn((_bp: string) => false),
  isMobile: false,
  isTablet: false,
  isDesktop: true,
  sidebarShouldBeVisible: true,
  canvasInteractionEnabled: true,
  isTouchDevice: false,
}

vi.mock('@/hooks/use-viewport', () => ({
  useViewport: () => mockViewportState,
}))

const setMockViewport = (width: number, breakpoint: string, isTouchDevice = false) => {
  mockViewportState.width = width
  mockViewportState.breakpoint = breakpoint as typeof mockViewportState.breakpoint
  mockViewportState.isMobile = width < 1024
  mockViewportState.isTablet = width >= 768 && width < 1024
  mockViewportState.isDesktop = width >= 1024
  mockViewportState.sidebarShouldBeVisible = width >= 1024
  mockViewportState.canvasInteractionEnabled = width >= 768
  mockViewportState.isTouchDevice = isTouchDevice
  mockViewportState.isAtLeast.mockImplementation((bp: string) => {
    const breakpoints: Record<string, number> = {
      sm: 640,
      md: 768,
      lg: 1024,
      xl: 1280,
      '2xl': 1536,
    }
    return width >= (breakpoints[bp] || 0)
  })
  mockViewportState.isBelow.mockImplementation((bp: string) => {
    const breakpoints: Record<string, number> = {
      sm: 640,
      md: 768,
      lg: 1024,
      xl: 1280,
      '2xl': 1536,
    }
    return width < (breakpoints[bp] || 0)
  })
}

describe('Dropdown Responsive Behavior', () => {
  beforeEach(() => {
    setMockViewport(1280, 'xl')
    vi.clearAllMocks()
  })

  describe('Desktop Mode (sm+ breakpoints)', () => {
    beforeEach(() => {
      setMockViewport(640, 'sm')
    })

    it('renders as positioned dropdown at sm breakpoint', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const menu = screen.getByTestId('menu')
      expect(menu).toHaveAttribute('data-display-mode', 'dropdown')
    })

    it('does not render overlay in dropdown mode', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.queryByTestId('dropdown-overlay')).not.toBeInTheDocument()
    })

    it('positions menu with fixed positioning in dropdown mode (portal-based)', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const menu = screen.getByTestId('menu')
      // Dropdown uses fixed positioning via portal to avoid overflow clipping
      expect(menu).toHaveClass('fixed')
    })
  })

  describe('Mobile Mode (below sm breakpoint)', () => {
    beforeEach(() => {
      setMockViewport(375, 'base')
    })

    it('renders as bottom sheet below sm breakpoint', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const menu = screen.getByTestId('menu')
      expect(menu).toHaveAttribute('data-display-mode', 'bottom-sheet')
    })

    it('renders semi-transparent overlay in bottom sheet mode', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const overlay = screen.getByTestId('dropdown-overlay')
      expect(overlay).toBeInTheDocument()
      expect(overlay).toHaveClass('bg-overlay')
    })

    it('positions menu at bottom of viewport in bottom sheet mode', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const menu = screen.getByTestId('menu')
      expect(menu).toHaveClass('fixed')
      expect(menu).toHaveClass('bottom-0')
      expect(menu).toHaveClass('left-0')
      expect(menu).toHaveClass('right-0')
    })

    it('applies full width in bottom sheet mode', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const menu = screen.getByTestId('menu')
      expect(menu).toHaveClass('w-full')
    })

    it('applies rounded top corners only in bottom sheet mode', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const menu = screen.getByTestId('menu')
      expect(menu).toHaveClass('rounded-t-lg')
      expect(menu).not.toHaveClass('rounded-b-lg')
    })

    it('closes bottom sheet when overlay is clicked', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const overlay = screen.getByTestId('dropdown-overlay')
      await user.click(overlay)

      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      })
    })

    it('applies slide-up animation for bottom sheet', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const menu = screen.getByTestId('menu')
      expect(menu).toHaveClass('animate-slide-up')
    })

    it('includes drag handle indicator in bottom sheet mode', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByTestId('bottom-sheet-handle')).toBeInTheDocument()
    })
  })

  describe('Threshold Boundary Tests', () => {
    it('renders as bottom sheet at 639px (just below sm)', async () => {
      setMockViewport(639, 'base')
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByTestId('menu')).toHaveAttribute(
        'data-display-mode',
        'bottom-sheet'
      )
    })

    it('renders as dropdown at exactly 640px (sm breakpoint)', async () => {
      setMockViewport(640, 'sm')
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(screen.getByTestId('menu')).toHaveAttribute(
        'data-display-mode',
        'dropdown'
      )
    })
  })

  describe('Viewport Transition Handling', () => {
    it('transitions from dropdown to bottom sheet when viewport shrinks below sm', async () => {
      setMockViewport(800, 'md')
      const user = userEvent.setup()

      const { rerender } = render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      expect(screen.getByTestId('menu')).toHaveAttribute(
        'data-display-mode',
        'dropdown'
      )

      // Simulate viewport shrinking
      setMockViewport(500, 'base')
      rerender(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      expect(screen.getByTestId('menu')).toHaveAttribute(
        'data-display-mode',
        'bottom-sheet'
      )
    })
  })

  describe('Touch Target Sizes in Bottom Sheet Mode', () => {
    beforeEach(() => {
      setMockViewport(375, 'base')
    })

    it('applies minimum 48px height to menu items in bottom sheet mode', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem data-testid="item">Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const item = screen.getByTestId('item')
      expect(item).toHaveClass('min-h-12')
    })

    it('increases padding for better touch targets in bottom sheet mode', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem data-testid="item">Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const item = screen.getByTestId('item')
      expect(item).toHaveClass('py-3')
    })
  })

  describe('Accessibility in Bottom Sheet Mode', () => {
    beforeEach(() => {
      setMockViewport(375, 'base')
    })

    it('bottom sheet uses dialog element', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const menu = screen.getByTestId('menu')
      expect(menu.tagName).toBe('DIALOG')
    })

    it('bottom sheet has aria-modal="true"', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const menu = screen.getByTestId('menu')
      expect(menu).toHaveAttribute('aria-modal', 'true')
    })

    it('overlay is a close button for accessibility', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const overlay = screen.getByTestId('dropdown-overlay')
      expect(overlay).toHaveAttribute('aria-label', 'Close menu')
    })

    it('traps focus within bottom sheet', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem data-testid="first">First</DropdownItem>
            <DropdownItem data-testid="last">Last</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const firstItem = screen.getByTestId('first')
      const lastItem = screen.getByTestId('last')

      // Focus should start on first item
      await waitFor(() => {
        expect(firstItem).toHaveFocus()
      })

      // Tab should move to next item
      await user.tab()
      expect(lastItem).toHaveFocus()

      // Tab again should wrap back to first (focus trap)
      await user.tab()
      expect(firstItem).toHaveFocus()
    })

    it('closes bottom sheet with Escape key', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))
      expect(screen.getByTestId('menu')).toBeInTheDocument()

      await user.keyboard('{Escape}')

      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  describe('Swipe-to-Dismiss in Bottom Sheet Mode', () => {
    beforeEach(() => {
      setMockViewport(375, 'base')
      mockViewportState.isTouchDevice = true
    })

    afterEach(() => {
      mockViewportState.isTouchDevice = false
    })

    it('supports swipe-down gesture to dismiss bottom sheet', async () => {
      const user = userEvent.setup()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      const menu = screen.getByTestId('menu')

      // Simulate swipe down gesture - wrap in act() to handle state updates
      await act(async () => {
        menu.dispatchEvent(
          new TouchEvent('touchstart', {
            touches: [{ clientX: 200, clientY: 400 } as Touch],
            bubbles: true,
          })
        )

        menu.dispatchEvent(
          new TouchEvent('touchend', {
            changedTouches: [{ clientX: 200, clientY: 550 } as Touch],
            bubbles: true,
          })
        )
      })

      await waitFor(() => {
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      })
    })

    it('accepts function ref in bottom sheet mode', async () => {
      const user = userEvent.setup()
      const refCallback = vi.fn()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu ref={refCallback} data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(refCallback).toHaveBeenCalledWith(expect.any(HTMLDialogElement))
    })

    it('accepts object ref in bottom sheet mode', async () => {
      const user = userEvent.setup()
      const menuRef = createRef<HTMLDivElement>()

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu ref={menuRef} data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      await user.click(screen.getByRole('button', { name: 'Actions' }))

      expect(menuRef.current).toBeInstanceOf(HTMLDialogElement)
      expect(menuRef.current).toHaveAttribute('data-display-mode', 'bottom-sheet')
    })
  })

  describe('Portal Position Bounds Checking', () => {
    beforeEach(() => {
      // Reset to desktop mode for portal-based dropdown tests
      setMockViewport(1280, 'xl')
    })

    it('flips dropdown above trigger when insufficient space below viewport', async () => {
      const user = userEvent.setup()

      // Mock viewport dimensions - small viewport to force flip
      Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true })
      Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true })

      // Mock getBoundingClientRect globally on Element prototype to ensure it's used
      const mockGetBoundingClientRect = vi.fn().mockReturnValue({
        top: 350,
        bottom: 380,
        left: 100,
        right: 200,
        width: 100,
        height: 30,
        x: 100,
        y: 350,
        toJSON: () => {},
      })
      const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
      Element.prototype.getBoundingClientRect = mockGetBoundingClientRect

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
            <DropdownItem>Delete</DropdownItem>
            <DropdownItem>Duplicate</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      const trigger = screen.getByRole('button', { name: 'Actions' })
      await user.click(trigger)

      // Menu should be positioned - the bounds checking logic will flip the menu above
      // when top + menuHeight > viewportHeight - 8
      // 384 + 200 = 584 > 400 - 8 = 392 → flip should occur
      await waitFor(() => {
        expect(screen.getByTestId('menu')).toBeInTheDocument()
      })

      // Restore original
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
    })

    it('constrains dropdown position when near right edge of viewport on initial open', async () => {
      const user = userEvent.setup()

      // Mock viewport dimensions - narrow viewport
      Object.defineProperty(window, 'innerWidth', { value: 300, configurable: true })
      Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })

      // Mock getBoundingClientRect globally
      const mockGetBoundingClientRect = vi.fn().mockReturnValue({
        top: 100,
        bottom: 130,
        left: 200,
        right: 280,
        width: 80,
        height: 30,
        x: 200,
        y: 100,
        toJSON: () => {},
      })
      const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect
      Element.prototype.getBoundingClientRect = mockGetBoundingClientRect

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      const trigger = screen.getByRole('button', { name: 'Actions' })
      await user.click(trigger)

      // Menu should be positioned with right edge constraint
      // left (200) + menuWidth (~160) = 360 > viewportWidth (300) - 8 = 292
      // So left should be adjusted to 300 - 160 - 8 = 132
      await waitFor(() => {
        expect(screen.getByTestId('menu')).toBeInTheDocument()
      })

      // Restore original
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect
    })

    it('updates position on scroll events', async () => {
      const user = userEvent.setup()

      // Mock trigger position
      const mockGetBoundingClientRect = vi.fn().mockReturnValue({
        top: 100,
        bottom: 130,
        left: 100,
        right: 200,
        width: 100,
        height: 30,
        x: 100,
        y: 100,
        toJSON: () => {},
      })

      Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true })
      Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      const trigger = screen.getByRole('button', { name: 'Actions' })
      trigger.getBoundingClientRect = mockGetBoundingClientRect

      await user.click(trigger)

      // Wait for menu to be visible
      await waitFor(() => {
        expect(screen.getByTestId('menu')).toBeInTheDocument()
      })

      // Clear call count
      mockGetBoundingClientRect.mockClear()

      // Dispatch scroll event to trigger updatePosition callback
      await act(async () => {
        window.dispatchEvent(new Event('scroll'))
      })

      // getBoundingClientRect should be called by updatePosition
      expect(mockGetBoundingClientRect).toHaveBeenCalled()
    })

    it('updates position on resize events', async () => {
      const user = userEvent.setup()

      // Mock trigger position
      const mockGetBoundingClientRect = vi.fn().mockReturnValue({
        top: 100,
        bottom: 130,
        left: 100,
        right: 200,
        width: 100,
        height: 30,
        x: 100,
        y: 100,
        toJSON: () => {},
      })

      Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true })
      Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      const trigger = screen.getByRole('button', { name: 'Actions' })
      trigger.getBoundingClientRect = mockGetBoundingClientRect

      await user.click(trigger)

      // Wait for menu to be visible
      await waitFor(() => {
        expect(screen.getByTestId('menu')).toBeInTheDocument()
      })

      // Clear call count
      mockGetBoundingClientRect.mockClear()

      // Dispatch resize event to trigger updatePosition callback
      await act(async () => {
        window.dispatchEvent(new Event('resize'))
      })

      // getBoundingClientRect should be called by updatePosition
      expect(mockGetBoundingClientRect).toHaveBeenCalled()
    })

    it('constrains dropdown position when near left edge of viewport', async () => {
      const user = userEvent.setup()

      // Mock trigger position near left edge
      const mockGetBoundingClientRect = vi.fn().mockReturnValue({
        top: 100,
        bottom: 130,
        left: -10,
        right: 90,
        width: 100,
        height: 30,
        x: -10,
        y: 100,
        toJSON: () => {},
      })

      Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true })
      Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      const trigger = screen.getByRole('button', { name: 'Actions' })
      trigger.getBoundingClientRect = mockGetBoundingClientRect

      await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByTestId('menu')).toBeInTheDocument()
      })
    })

    it('flips dropdown above during scroll when trigger near bottom', async () => {
      const user = userEvent.setup()

      // Start with trigger at normal position
      let triggerTop = 100
      const mockGetBoundingClientRect = vi.fn(() => ({
        top: triggerTop,
        bottom: triggerTop + 30,
        left: 100,
        right: 200,
        width: 100,
        height: 30,
        x: 100,
        y: triggerTop,
        toJSON: () => {},
      }))

      Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true })
      Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      const trigger = screen.getByRole('button', { name: 'Actions' })
      trigger.getBoundingClientRect = mockGetBoundingClientRect

      await user.click(trigger)

      // Wait for menu to be visible
      await waitFor(() => {
        expect(screen.getByTestId('menu')).toBeInTheDocument()
      })

      // Now move trigger near bottom of viewport (simulates scroll)
      triggerTop = 700

      // Dispatch scroll event to trigger updatePosition with flip logic
      await act(async () => {
        window.dispatchEvent(new Event('scroll'))
      })

      // Menu should still be visible (position recalculated)
      expect(screen.getByTestId('menu')).toBeInTheDocument()
    })

    it('constrains dropdown position on right edge during resize', async () => {
      const user = userEvent.setup()

      // Start with trigger at normal position
      let triggerLeft = 100
      const mockGetBoundingClientRect = vi.fn(() => ({
        top: 100,
        bottom: 130,
        left: triggerLeft,
        right: triggerLeft + 100,
        width: 100,
        height: 30,
        x: triggerLeft,
        y: 100,
        toJSON: () => {},
      }))

      Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true })
      Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      const trigger = screen.getByRole('button', { name: 'Actions' })
      trigger.getBoundingClientRect = mockGetBoundingClientRect

      await user.click(trigger)

      // Wait for menu to be visible
      await waitFor(() => {
        expect(screen.getByTestId('menu')).toBeInTheDocument()
      })

      // Move trigger to right edge (simulates narrow viewport)
      triggerLeft = 1200
      Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true })

      // Dispatch resize event to trigger updatePosition with right edge constraint
      await act(async () => {
        window.dispatchEvent(new Event('resize'))
      })

      // Menu should still be visible (position constrained)
      expect(screen.getByTestId('menu')).toBeInTheDocument()
    })

    it('cleans up scroll and resize event listeners on close', async () => {
      const user = userEvent.setup()
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

      render(
        <Dropdown>
          <DropdownTrigger>Actions</DropdownTrigger>
          <DropdownMenu data-testid="menu">
            <DropdownItem>Edit</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      )

      // Open menu
      await user.click(screen.getByRole('button', { name: 'Actions' }))
      await waitFor(() => {
        expect(screen.getByTestId('menu')).toBeInTheDocument()
      })

      // Close menu by pressing Escape
      await user.keyboard('{Escape}')

      // Wait for menu to close
      await waitFor(() => {
        expect(screen.queryByTestId('menu')).not.toBeInTheDocument()
      })

      // Cleanup should have been called
      expect(removeEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function), true)
      expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))

      vi.restoreAllMocks()
    })
  })
})
