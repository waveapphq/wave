/**
 * ConfirmationDialog Component Tests
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 * REQ-5.2.1.23: Confirmation dialogs for destructive actions
 *
 * Tests for ConfirmationDialog component following design system specifications.
 *
 * Component specifications:
 * - Modal overlay with focused decision point
 * - 5 coordinated elements: icon, title, description, confirm button, cancel button
 * - Visual hierarchy: centered vertically/horizontally over dimmed background
 * - Container: width 400px (sm), max-height 90vh, padding 24px, border-radius 12px
 * - Backdrop clicking does NOT dismiss (must use buttons) - handled by Radix AlertDialog
 * - Focus trapping - handled by Radix AlertDialog
 * - Scroll lock - handled by Radix AlertDialog
 * - Type-to-confirm for high-risk actions
 */

import { createRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'

describe('ConfirmationDialog Component', () => {
  describe('Basic Rendering', () => {
    it('does not render when isOpen is false', () => {
      render(
        <ConfirmationDialog
          isOpen={false}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('renders when isOpen is true', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    it('renders with proper alertdialog role for destructive actions', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })
  })

  describe('Component Anatomy', () => {
    it('renders icon element', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(document.querySelector('[data-confirmation-icon]')).toBeInTheDocument()
    })

    it('renders title element', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.getByText('Delete item?')).toBeInTheDocument()
    })

    it('renders description element', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          description="This action cannot be undone."
        />
      )
      expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument()
    })

    it('renders confirm button', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
    })

    it('renders cancel button', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })
  })

  describe('Visual Integration - Container Styling', () => {
    it('applies max-w-[400px] width constraint', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          data-testid="confirmation-dialog"
        />
      )
      expect(screen.getByTestId('confirmation-dialog')).toHaveClass('max-w-[400px]')
    })

    it('applies max-height of 90vh', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          data-testid="confirmation-dialog"
        />
      )
      expect(screen.getByTestId('confirmation-dialog')).toHaveClass('max-h-[90vh]')
    })

    it('applies p-6 padding (24px per space-6)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          data-testid="confirmation-dialog"
        />
      )
      expect(screen.getByTestId('confirmation-dialog')).toHaveClass('p-6')
    })

    it('applies rounded-xl border radius (12px)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          data-testid="confirmation-dialog"
        />
      )
      expect(screen.getByTestId('confirmation-dialog')).toHaveClass('rounded-xl')
    })

    it('applies shadow-lg', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          data-testid="confirmation-dialog"
        />
      )
      expect(screen.getByTestId('confirmation-dialog')).toHaveClass('shadow-lg')
    })

    it('applies bg-elevated for elevated background', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          data-testid="confirmation-dialog"
        />
      )
      expect(screen.getByTestId('confirmation-dialog')).toHaveClass('bg-elevated')
    })

    it('applies text-center alignment', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          data-testid="confirmation-dialog"
        />
      )
      expect(screen.getByTestId('confirmation-dialog')).toHaveClass('text-center')
    })
  })

  describe('Visual Integration - Icon Styling', () => {
    it('applies icon-xl size (24px)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      const icon = document.querySelector('[data-confirmation-icon]')
      expect(icon).toHaveClass('icon-xl')
    })

    it('applies text-error color for icon', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      const icon = document.querySelector('[data-confirmation-icon]')
      expect(icon).toHaveClass('text-error')
    })

    it('applies mb-4 margin bottom (16px per space-4)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      const icon = document.querySelector('[data-confirmation-icon]')
      expect(icon).toHaveClass('mb-4')
    })

    it('icon has aria-hidden for decorative purpose', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      const icon = document.querySelector('[data-confirmation-icon]')
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    })
  })

  describe('Visual Integration - Title Styling', () => {
    it('applies text-lg font size (18px)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.getByText('Delete item?')).toHaveClass('text-lg')
    })

    it('applies font-semibold weight (600)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.getByText('Delete item?')).toHaveClass('font-semibold')
    })

    it('applies text-primary color', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.getByText('Delete item?')).toHaveClass('text-primary')
    })

    it('applies mb-2 margin bottom (8px per space-2)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.getByText('Delete item?')).toHaveClass('mb-2')
    })

    it('renders title as h2 element', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.getByText('Delete item?').tagName.toLowerCase()).toBe('h2')
    })
  })

  describe('Visual Integration - Description Styling', () => {
    it('applies text-sm font size (14px)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          description="This action cannot be undone."
        />
      )
      expect(screen.getByText('This action cannot be undone.')).toHaveClass('text-sm')
    })

    it('applies font-normal weight (400)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          description="This action cannot be undone."
        />
      )
      expect(screen.getByText('This action cannot be undone.')).toHaveClass('font-normal')
    })

    it('applies text-secondary color', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          description="This action cannot be undone."
        />
      )
      expect(screen.getByText('This action cannot be undone.')).toHaveClass('text-secondary')
    })

    it('applies leading-normal line height (1.5)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          description="This action cannot be undone."
        />
      )
      expect(screen.getByText('This action cannot be undone.')).toHaveClass('leading-normal')
    })

    it('applies mb-6 margin bottom (24px per space-6)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          description="This action cannot be undone."
        />
      )
      expect(screen.getByText('This action cannot be undone.')).toHaveClass('mb-6')
    })

    it('renders description as p element', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          description="This action cannot be undone."
        />
      )
      expect(screen.getByText('This action cannot be undone.').tagName.toLowerCase()).toBe('p')
    })
  })

  describe('Visual Integration - Action Group Styling', () => {
    it('action group applies flex layout', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      const actionGroup = document.querySelector('[data-action-group]')
      expect(actionGroup).toHaveClass('flex')
    })

    it('action group applies justify-end alignment', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      const actionGroup = document.querySelector('[data-action-group]')
      expect(actionGroup).toHaveClass('justify-end')
    })

    it('action group applies gap-3 spacing (12px per space-3)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      const actionGroup = document.querySelector('[data-action-group]')
      expect(actionGroup).toHaveClass('gap-3')
    })

    it('cancel button appears before confirm button (left position)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      const actionGroup = document.querySelector('[data-action-group]')
      const buttons = actionGroup?.querySelectorAll('button')
      expect(buttons?.[0]).toHaveTextContent(/cancel/i)
      expect(buttons?.[1]).toHaveTextContent(/delete/i)
    })
  })

  describe('Button Styling', () => {
    it('cancel button has secondary variant styling', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.getByRole('button', { name: /cancel/i })).toHaveClass('btn-secondary')
    })

    it('confirm button has danger variant styling', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.getByRole('button', { name: /delete/i })).toHaveClass('btn-danger')
    })

    it('cancel button has medium size (40px height)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.getByRole('button', { name: /cancel/i })).toHaveClass('btn-md')
    })

    it('confirm button has medium size (40px height)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.getByRole('button', { name: /delete/i })).toHaveClass('btn-md')
    })
  })

  describe('Dialog Variants', () => {
    it('renders delete variant with Trash icon', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="delete"
          title="Delete item?"
        />
      )
      const icon = document.querySelector('[data-confirmation-icon]')
      expect(icon).toHaveAttribute('data-icon', 'trash')
    })

    it('renders delete variant with "Delete" confirm label', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="delete"
          title="Delete item?"
        />
      )
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    })

    it('renders delete-multiple variant with "Delete All" confirm label', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="delete-multiple"
          title="Delete 5 items?"
          itemCount={5}
        />
      )
      expect(screen.getByRole('button', { name: 'Delete All' })).toBeInTheDocument()
    })

    it('renders reset variant with the RotateCcw icon in a red-tinted circle', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="reset"
          title="Reset settings?"
        />
      )
      const icon = document.querySelector('[data-confirmation-icon]')
      expect(icon).toHaveAttribute('data-icon', 'rotate-ccw')
      expect(icon).toHaveClass('rounded-full')
    })

    it('renders reset variant with "Reset" confirm label', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="reset"
          title="Reset settings?"
        />
      )
      expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
    })

    it('renders overwrite variant with AlertTriangle icon', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="overwrite"
          title="Overwrite file?"
        />
      )
      const icon = document.querySelector('[data-confirmation-icon]')
      expect(icon).toHaveAttribute('data-icon', 'alert-triangle')
    })

    it('renders overwrite variant with "Overwrite" confirm label', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="overwrite"
          title="Overwrite file?"
        />
      )
      expect(screen.getByRole('button', { name: 'Overwrite' })).toBeInTheDocument()
    })

    it('renders discard variant with X icon', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="discard"
          title="Discard changes?"
        />
      )
      const icon = document.querySelector('[data-confirmation-icon]')
      expect(icon).toHaveAttribute('data-icon', 'x')
    })

    it('renders discard variant with "Discard" confirm label', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="discard"
          title="Discard changes?"
        />
      )
      expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
    })

    it('renders disconnect variant with Unlink icon', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="disconnect"
          title="Disconnect server?"
        />
      )
      const icon = document.querySelector('[data-confirmation-icon]')
      expect(icon).toHaveAttribute('data-icon', 'unlink')
    })

    it('renders disconnect variant with "Disconnect" confirm label', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="disconnect"
          title="Disconnect server?"
        />
      )
      expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
    })

    it('renders disconnect variant default title without itemName', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="disconnect"
        />
      )
      expect(screen.getByText('Disconnect server?')).toBeInTheDocument()
    })

    it('renders delete variant default title without itemName', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="delete"
        />
      )
      expect(screen.getByText('Delete item?')).toBeInTheDocument()
    })

    it('renders overwrite variant default title without itemName', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="overwrite"
        />
      )
      expect(screen.getByText('Overwrite file?')).toBeInTheDocument()
    })

    it('renders overwrite variant default title with itemName', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="overwrite"
          itemName="data.json"
        />
      )
      expect(screen.getByText('Overwrite "data.json"?')).toBeInTheDocument()
    })

    it('renders disconnect variant default title with itemName', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="disconnect"
          itemName="Production Server"
        />
      )
      expect(screen.getByText('Disconnect "Production Server"?')).toBeInTheDocument()
    })

    it('renders delete-multiple variant default title with zero items when itemCount undefined', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="delete-multiple"
        />
      )
      expect(screen.getByText('Delete 0 items?')).toBeInTheDocument()
    })

    it('renders reset variant default title', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="reset"
        />
      )
      expect(screen.getByText('Reset settings?')).toBeInTheDocument()
    })

    it('renders discard variant default title', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="discard"
        />
      )
      expect(screen.getByText('Discard changes?')).toBeInTheDocument()
    })

    it('renders move variant default title without itemName', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="move"
        />
      )
      expect(screen.getByText('Move item?')).toBeInTheDocument()
    })

    it('renders move variant default title with itemName', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="move"
          itemName="Test Document"
        />
      )
      expect(screen.getByText('Move "Test Document"?')).toBeInTheDocument()
    })

    it('renders move variant with FolderInput icon', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="move"
          title="Move item?"
        />
      )
      const icon = document.querySelector('[data-confirmation-icon]')
      expect(icon).toHaveAttribute('data-icon', 'folder-input')
    })

    it('renders move variant with "Move" confirm label', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="move"
          title="Move item?"
        />
      )
      expect(screen.getByRole('button', { name: 'Move' })).toBeInTheDocument()
    })

    it('supports custom confirm label override', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="delete"
          title="Delete item?"
          confirmLabel="Remove Forever"
        />
      )
      expect(screen.getByRole('button', { name: 'Remove Forever' })).toBeInTheDocument()
    })

    it('supports custom cancel label override', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          cancelLabel="Keep It"
        />
      )
      expect(screen.getByRole('button', { name: 'Keep It' })).toBeInTheDocument()
    })
  })

  describe('Interaction Behavior', () => {
    it('calls onClose when Cancel button is clicked', async () => {
      const user = userEvent.setup()
      const handleClose = vi.fn()

      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={handleClose}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )

      await user.click(screen.getByRole('button', { name: /cancel/i }))
      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('calls onConfirm and onClose when Confirm button is clicked', async () => {
      const user = userEvent.setup()
      const handleClose = vi.fn()
      const handleConfirm = vi.fn()

      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={handleClose}
          onConfirm={handleConfirm}
          title="Delete item?"
        />
      )

      await user.click(screen.getByRole('button', { name: /delete/i }))
      expect(handleConfirm).toHaveBeenCalledTimes(1)
      expect(handleClose).toHaveBeenCalledTimes(1)
    })

    it('Escape neither closes the dialog nor confirms', async () => {
      const user = userEvent.setup()
      const handleClose = vi.fn()
      const handleConfirm = vi.fn()

      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={handleClose}
          onConfirm={handleConfirm}
          title="Delete item?"
        />
      )

      await user.keyboard('{Escape}')

      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      expect(handleClose).not.toHaveBeenCalled()
      expect(handleConfirm).not.toHaveBeenCalled()
    })
  })

  describe('Type-to-Confirm Protection', () => {
    it('renders input field when requireConfirmation is provided', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('displays instruction text with confirm phrase', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )
      expect(screen.getByText(/type/i)).toBeInTheDocument()
      expect(screen.getByText('DELETE')).toBeInTheDocument()
    })

    it('confirm phrase uses font-semibold styling', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )
      expect(screen.getByText('DELETE')).toHaveClass('font-semibold')
    })

    it('confirm phrase uses font-mono styling', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )
      expect(screen.getByText('DELETE')).toHaveClass('font-mono')
    })

    it('disables confirm button until input matches', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )
      expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
    })

    it('enables confirm button when input matches exactly', async () => {
      const user = userEvent.setup()

      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )

      await user.type(screen.getByRole('textbox'), 'DELETE')
      expect(screen.getByRole('button', { name: /delete/i })).not.toBeDisabled()
    })

    it('keeps confirm button disabled for partial match', async () => {
      const user = userEvent.setup()

      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )

      await user.type(screen.getByRole('textbox'), 'DELE')
      expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
    })

    it('keeps confirm button disabled for case mismatch', async () => {
      const user = userEvent.setup()

      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )

      await user.type(screen.getByRole('textbox'), 'delete')
      expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
    })

    it('focuses input field on open instead of Cancel button', async () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toHaveFocus()
      })
    })

    it('input field has height 40px (medium)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )
      expect(screen.getByRole('textbox')).toHaveClass('h-10')
    })

    it('input field has mt-4 margin top (16px per space-4)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )
      const inputWrapper = screen.getByRole('textbox').closest('[data-confirm-input-wrapper]')
      expect(inputWrapper).toHaveClass('mt-4')
    })

    it('input field uses .input CSS class for border, border-radius, and focus styling', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )
      expect(screen.getByRole('textbox')).toHaveClass('input')
    })

    it('input field shows error border when input does not match', async () => {
      const user = userEvent.setup()

      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )

      // Type incorrect value
      await user.type(screen.getByRole('textbox'), 'wrong')
      // Blur to trigger validation
      await user.tab()

      expect(screen.getByRole('textbox')).toHaveClass('border-error')
    })

    it('input field shows default border when input matches exactly', async () => {
      const user = userEvent.setup()

      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )

      await user.type(screen.getByRole('textbox'), 'DELETE')

      expect(screen.getByRole('textbox')).not.toHaveClass('border-error')
    })

    it('instruction text has text-sm font size (14px)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )
      const instructionText = screen.getByText(/type/i)
      expect(instructionText).toHaveClass('text-sm')
    })

    it('instruction text has text-secondary color', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )
      const instructionText = screen.getByText(/type/i)
      expect(instructionText).toHaveClass('text-secondary')
    })

    it('instruction text has mb-2 margin bottom (8px per space-2)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )
      const instructionText = screen.getByText(/type/i)
      expect(instructionText).toHaveClass('mb-2')
    })

    it('submits on Enter when input matches and confirm is enabled', async () => {
      const user = userEvent.setup()
      const handleConfirm = vi.fn()

      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={handleConfirm}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )

      await user.type(screen.getByRole('textbox'), 'DELETE')
      await user.keyboard('{Enter}')

      expect(handleConfirm).toHaveBeenCalledTimes(1)
    })

    it('does not submit on Enter when input does not match', async () => {
      const user = userEvent.setup()
      const handleConfirm = vi.fn()

      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={handleConfirm}
          title="Delete item?"
          requireConfirmation="DELETE"
        />
      )

      await user.type(screen.getByRole('textbox'), 'DELE')
      await user.keyboard('{Enter}')

      expect(handleConfirm).not.toHaveBeenCalled()
    })
  })

  describe('Loading State', () => {
    it('shows spinner on confirm button when loading', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          isLoading={true}
        />
      )
      expect(screen.getByTestId('button-spinner')).toBeInTheDocument()
    })

    it('disables confirm button when loading', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          isLoading={true}
        />
      )
      expect(screen.getByRole('button', { name: /delete/i })).toBeDisabled()
    })

    it('disables cancel button when loading', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          isLoading={true}
        />
      )
      expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()
    })

    it('shows aria-busy on confirm button when loading', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          isLoading={true}
        />
      )
      expect(screen.getByRole('button', { name: /delete/i })).toHaveAttribute(
        'aria-busy',
        'true'
      )
    })
  })

  describe('Error State', () => {
    it('displays error message when error is provided', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          error="Failed to delete item"
        />
      )
      expect(screen.getByText('Failed to delete item')).toBeInTheDocument()
    })

    it('error message has text-error styling', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          error="Failed to delete item"
        />
      )
      expect(screen.getByText('Failed to delete item')).toHaveClass('text-error')
    })

    it('error message has text-sm font size', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          error="Failed to delete item"
        />
      )
      expect(screen.getByText('Failed to delete item')).toHaveClass('text-sm')
    })

    it('error message has role="alert"', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          error="Failed to delete item"
        />
      )
      expect(screen.getByText('Failed to delete item')).toHaveAttribute('role', 'alert')
    })
  })

  describe('Item Identification', () => {
    it('displays item name in title with quotes', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title='Delete "config.yaml"?'
        />
      )
      expect(screen.getByText('Delete "config.yaml"?')).toBeInTheDocument()
    })

    it('supports itemName prop for dynamic title', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="delete"
          itemName="config.yaml"
        />
      )
      expect(screen.getByText('Delete "config.yaml"?')).toBeInTheDocument()
    })
  })

  describe('Bulk Action Handling', () => {
    it('displays count in title for bulk operations', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="delete-multiple"
          itemCount={5}
        />
      )
      expect(screen.getByText('Delete 5 items?')).toBeInTheDocument()
    })

    it('lists items in description when provided', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="delete-multiple"
          itemCount={3}
          itemNames={['file1.txt', 'file2.txt', 'file3.txt']}
        />
      )
      expect(screen.getByText(/file1.txt/)).toBeInTheDocument()
      expect(screen.getByText(/file2.txt/)).toBeInTheDocument()
      expect(screen.getByText(/file3.txt/)).toBeInTheDocument()
    })

    it('summarizes selection when item list is too long', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="delete-multiple"
          itemCount={50}
        />
      )
      expect(screen.getByText(/50 items/)).toBeInTheDocument()
    })

    it('renders scrollable list container for item verification', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="delete-multiple"
          itemCount={10}
          itemNames={[
            'file1.txt',
            'file2.txt',
            'file3.txt',
            'file4.txt',
            'file5.txt',
            'file6.txt',
            'file7.txt',
            'file8.txt',
            'file9.txt',
            'file10.txt',
          ]}
        />
      )
      const itemList = document.querySelector('[data-item-list]')
      expect(itemList).toBeInTheDocument()
      expect(itemList).toHaveClass('overflow-y-auto')
    })

    it('scrollable list has max-height constraint', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="delete-multiple"
          itemCount={10}
          itemNames={[
            'file1.txt',
            'file2.txt',
            'file3.txt',
            'file4.txt',
            'file5.txt',
            'file6.txt',
            'file7.txt',
            'file8.txt',
            'file9.txt',
            'file10.txt',
          ]}
        />
      )
      const itemList = document.querySelector('[data-item-list]')
      expect(itemList).toHaveClass('max-h-32')
    })
  })

  describe('Accessibility', () => {
    it('has role="alertdialog" for destructive confirmations', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    it('associates title with dialog via aria-labelledby', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      const dialog = screen.getByRole('alertdialog')
      const titleElement = screen.getByText('Delete item?')
      expect(dialog).toHaveAttribute('aria-labelledby', titleElement.id)
    })

    it('associates description with dialog via aria-describedby', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          description="This action cannot be undone."
        />
      )
      const dialog = screen.getByRole('alertdialog')
      const descElement = screen.getByText('This action cannot be undone.')
      expect(dialog).toHaveAttribute('aria-describedby', descElement.id)
    })

    it('icon is decorative (aria-hidden)', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      const icon = document.querySelector('[data-confirmation-icon]')
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    })

    it('buttons are focusable', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )
      expect(screen.getByRole('button', { name: /cancel/i })).not.toHaveAttribute(
        'tabindex',
        '-1'
      )
      expect(screen.getByRole('button', { name: /delete/i })).not.toHaveAttribute(
        'tabindex',
        '-1'
      )
    })
  })

  describe('Ref Forwarding', () => {
    it('forwards function ref to dialog element', () => {
      const refFn = vi.fn()

      render(
        <ConfirmationDialog
          ref={refFn}
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )

      expect(refFn).toHaveBeenCalled()
      expect(refFn.mock.calls[0][0]).toBeInstanceOf(HTMLDivElement)
    })

    it('forwards object ref to dialog element', () => {
      const ref = createRef<HTMLDivElement>()

      render(
        <ConfirmationDialog
          ref={ref}
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
        />
      )

      expect(ref.current).toBeInstanceOf(HTMLDivElement)
      expect(ref.current).toHaveRole('alertdialog')
    })
  })

  describe('Custom Styling', () => {
    it('applies additional className', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          className="custom-dialog"
          data-testid="confirmation-dialog"
        />
      )
      expect(screen.getByTestId('confirmation-dialog')).toHaveClass('custom-dialog')
    })

    it('merges className with base classes', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          className="custom-dialog"
          data-testid="confirmation-dialog"
        />
      )
      const dialog = screen.getByTestId('confirmation-dialog')
      expect(dialog).toHaveClass('max-w-[400px]')
      expect(dialog).toHaveClass('custom-dialog')
    })

    it('passes through additional props', () => {
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Delete item?"
          data-custom="value"
          data-testid="confirmation-dialog"
        />
      )
      expect(screen.getByTestId('confirmation-dialog')).toHaveAttribute(
        'data-custom',
        'value'
      )
    })
  })
})

describe('ConfirmationDialog - make-secret look (SECUI-12, REQ-4.5.20)', () => {
  const ONE_BODY =
    'Saving makes the plain variable api_token a secret. Its value is masked from then on. Making it plain again clears its value.'
  const MANY_BODY =
    'Saving makes these plain variables secrets. Their values are masked from then on. Making them plain again clears their values.'

  function variableNames(count: number): string[] {
    return Array.from({ length: count }, (_, i) => `var_${i + 1}`)
  }

  it('shows the warning triangle icon in the error color', () => {
    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        variant="make-secret"
        title="Make this variable secret?"
        description={ONE_BODY}
      />
    )
    const icon = document.querySelector('[data-confirmation-icon]')
    expect(icon).toHaveAttribute('data-icon', 'alert-triangle')
    expect(icon).toHaveClass('text-error')
  })

  it('offers Cancel and a red "Make secret and save" confirm without a custom label', () => {
    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        variant="make-secret"
        title="Make this variable secret?"
        description={ONE_BODY}
      />
    )
    const buttons = screen.getAllByRole('button').map((button) => button.textContent)
    expect(buttons).toEqual(['Cancel', 'Make secret and save'])
    expect(screen.getByRole('button', { name: 'Make secret and save' })).toHaveClass('btn-danger')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('btn-secondary')
  })

  it('one variable: the body names it and no list is drawn', () => {
    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        variant="make-secret"
        title="Make this variable secret?"
        description={ONE_BODY}
      />
    )
    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription(ONE_BODY)
    expect(document.querySelector('[data-item-list]')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it.each([[2], [11], [15]])(
    'lists every one of %i names in the bordered list that scrolls, with no cap',
    (count) => {
      const names = variableNames(count)
      render(
        <ConfirmationDialog
          isOpen={true}
          onClose={() => {}}
          onConfirm={() => {}}
          variant="make-secret"
          title={`Make ${count} variables secret?`}
          description={MANY_BODY}
          itemNames={names}
        />
      )
      const itemList = document.querySelector('[data-item-list]')
      expect(itemList).toBeInTheDocument()
      expect(itemList).toHaveClass('border', 'overflow-y-auto', 'max-h-32')
      expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(names)
    }
  )

  it('"Make secret and save" calls onConfirm once', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={() => {}}
        onConfirm={onConfirm}
        variant="make-secret"
        title="Make 2 variables secret?"
        description={MANY_BODY}
        itemNames={['token', 'api_key']}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Make secret and save' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('Cancel calls onClose and never onConfirm', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        variant="make-secret"
        title="Make this variable secret?"
        description={ONE_BODY}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Escape neither closes the warning nor saves: Cancel is the way back (REQ-5.2.1.23)', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        variant="make-secret"
        title="Make 2 variables secret?"
        description={MANY_BODY}
        itemNames={['token', 'api_key']}
      />
    )
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Make 2 variables secret?')
    expect(onClose).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('delete-multiple keeps its 10-name rule: 11 names draw no list', () => {
    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        variant="delete-multiple"
        itemCount={11}
        itemNames={variableNames(11)}
      />
    )
    expect(document.querySelector('[data-item-list]')).not.toBeInTheDocument()
  })
})

describe('ConfirmationDialog - switch variant with a secondary action (FIELD-7)', () => {
  const TITLE = 'Switch the field to an expression?'
  const BODY = 'The current value is cleared.'

  interface SwitchProps {
    onClose?: () => void
    onConfirm?: () => void
    onSecondary?: () => void
    withSecondary?: boolean
  }

  function renderSwitch({
    onClose = vi.fn(),
    onConfirm = vi.fn(),
    onSecondary = vi.fn(),
    withSecondary = true,
  }: SwitchProps = {}) {
    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        variant="switch"
        title={TITLE}
        description={BODY}
        confirmLabel={withSecondary ? 'Clear & Empty' : 'Clear & Default'}
        secondaryAction={
          withSecondary
            ? { label: 'Clear & Default', onClick: onSecondary, testId: 'switch-mode-clear-default' }
            : undefined
        }
        cancelTestId="switch-mode-cancel"
        confirmTestId={withSecondary ? 'switch-mode-clear-empty' : 'switch-mode-clear-default'}
        data-testid="switch-mode-dialog"
      />,
    )
    return { onClose, onConfirm, onSecondary }
  }

  function buttonTexts(): string[] {
    return screen.getAllByRole('button').map((button) => button.textContent ?? '')
  }

  it('shows the X icon', () => {
    renderSwitch()
    expect(document.querySelector('[data-confirmation-icon]')).toHaveAttribute('data-icon', 'x')
  })

  it('paints the confirm blue (primary), never red', () => {
    renderSwitch()
    const confirm = screen.getByRole('button', { name: 'Clear & Empty' })
    expect(confirm).toHaveClass('btn-primary')
    expect(confirm).not.toHaveClass('btn-danger')
  })

  it('names the dialog by its title and describes it by its body', () => {
    renderSwitch()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAccessibleName(TITLE)
    expect(dialog).toHaveAccessibleDescription(BODY)
  })

  it('puts the passed test id on the dialog', () => {
    renderSwitch()
    expect(screen.getByTestId('switch-mode-dialog')).toBe(screen.getByRole('alertdialog'))
  })

  it('renders the secondary action between Cancel and the confirm', () => {
    renderSwitch()
    expect(buttonTexts()).toEqual(['Cancel', 'Clear & Default', 'Clear & Empty'])
  })

  it('puts the test ids on Cancel, the secondary action and the confirm', () => {
    renderSwitch()
    expect(screen.getByTestId('switch-mode-cancel')).toBe(
      screen.getByRole('button', { name: 'Cancel' }),
    )
    expect(screen.getByTestId('switch-mode-clear-default')).toBe(
      screen.getByRole('button', { name: 'Clear & Default' }),
    )
    expect(screen.getByTestId('switch-mode-clear-empty')).toBe(
      screen.getByRole('button', { name: 'Clear & Empty' }),
    )
  })

  it('fires the secondary handler once and never the confirm', async () => {
    const user = userEvent.setup()
    const { onSecondary, onConfirm } = renderSwitch()
    await user.click(screen.getByRole('button', { name: 'Clear & Default' }))
    expect(onSecondary).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('the confirm fires onConfirm and never the secondary handler', async () => {
    const user = userEvent.setup()
    const { onSecondary, onConfirm } = renderSwitch()
    await user.click(screen.getByRole('button', { name: 'Clear & Empty' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onSecondary).not.toHaveBeenCalled()
  })

  it('Cancel fires onClose and neither action', async () => {
    const user = userEvent.setup()
    const { onClose, onConfirm, onSecondary } = renderSwitch()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onSecondary).not.toHaveBeenCalled()
  })

  it('without a secondary action shows Cancel and the blue confirm only', () => {
    renderSwitch({ withSecondary: false })
    expect(buttonTexts()).toEqual(['Cancel', 'Clear & Default'])
    expect(screen.getByTestId('switch-mode-clear-default')).toHaveClass('btn-primary')
  })

  it('Escape leaves the dialog open and fires nothing', async () => {
    const user = userEvent.setup()
    const { onClose, onConfirm, onSecondary } = renderSwitch()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName(TITLE)
    expect(onClose).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onSecondary).not.toHaveBeenCalled()
  })

  it('a click on the backdrop leaves the dialog open and fires nothing', async () => {
    const user = userEvent.setup()
    const { onClose, onConfirm, onSecondary } = renderSwitch()
    const backdrop = screen.getByRole('alertdialog').previousElementSibling as HTMLElement
    expect(backdrop).toHaveClass('fixed', 'inset-0')
    await user.click(backdrop)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onSecondary).not.toHaveBeenCalled()
  })

  it('starts focus on Cancel', async () => {
    renderSwitch()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    })
  })

  it('tabs Cancel, then the secondary action, then the confirm', async () => {
    const user = userEvent.setup()
    renderSwitch()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    })
    await user.tab()
    expect(screen.getByRole('button', { name: 'Clear & Default' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Clear & Empty' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Clear & Default' })).toHaveFocus()
  })

  it('Enter on the focused secondary action fires it', async () => {
    const user = userEvent.setup()
    const { onSecondary } = renderSwitch()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    })
    await user.tab()
    await user.keyboard('{Enter}')
    expect(onSecondary).toHaveBeenCalledTimes(1)
  })
})

describe('ConfirmationDialog - existing variants keep their look', () => {
  it.each([
    ['delete', 'trash', 'btn-danger'],
    ['delete-multiple', 'trash', 'btn-danger'],
    ['reset', 'rotate-ccw', 'btn-danger'],
    ['overwrite', 'alert-triangle', 'btn-danger'],
    ['discard', 'x', 'btn-danger'],
    ['disconnect', 'unlink', 'btn-danger'],
    ['move', 'folder-input', 'btn-primary'],
    ['make-secret', 'alert-triangle', 'btn-danger'],
  ] as const)('%s keeps the %s icon and a %s confirm', (variant, iconName, confirmClass) => {
    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        variant={variant}
        title="Are you sure?"
        confirmLabel="Go ahead"
      />,
    )
    expect(document.querySelector('[data-confirmation-icon]')).toHaveAttribute('data-icon', iconName)
    expect(screen.getByRole('button', { name: 'Go ahead' })).toHaveClass(confirmClass)
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Cancel',
      'Go ahead',
    ])
  })

  it('puts no test id on Cancel or the confirm unless asked', () => {
    render(
      <ConfirmationDialog
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete item?"
      />,
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toHaveAttribute('data-testid')
    expect(screen.getByRole('button', { name: 'Delete' })).not.toHaveAttribute('data-testid')
  })
})
