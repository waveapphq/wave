/**
 * Tests for SortDropdown - the variable manager toolbar's sort selector.
 *
 * Wraps the shadcn `Select` to expose three options: Name A-Z (default),
 * Name Z-A, Type. Controlled via `value` + `onValueChange`. Used in the
 * Variable Manager panel header toolbar.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SortDropdown } from '@/features/workbench/common/variables/variable-manager-content/sort-dropdown'
import type { SortKey } from '@/features/workbench/common/variables/variable-manager-content/sort-variables'

describe('SortDropdown', () => {
  describe('rendering', () => {
    it('renders the trigger with the current value label', () => {
      render(<SortDropdown value="name-asc" onValueChange={vi.fn()} />)
      // Trigger surfaces the current label.
      expect(screen.getByText('Name A-Z')).toBeInTheDocument()
    })

    it('shows the Name Z-A label when value is name-desc', () => {
      render(<SortDropdown value="name-desc" onValueChange={vi.fn()} />)
      expect(screen.getByText('Name Z-A')).toBeInTheDocument()
    })

    it('shows the Type label when value is type', () => {
      render(<SortDropdown value="type" onValueChange={vi.fn()} />)
      expect(screen.getByText('Type')).toBeInTheDocument()
    })
  })

  describe('options', () => {
    it('opens to reveal all three options', async () => {
      const user = userEvent.setup()
      render(<SortDropdown value="name-asc" onValueChange={vi.fn()} />)

      const trigger = screen.getByRole('combobox')
      await user.click(trigger)

      // The options are rendered in the dropdown content.
      const options = await screen.findAllByRole('option')
      const labels = options.map((el) => el.textContent?.trim())
      expect(labels).toEqual(expect.arrayContaining(['Name A-Z', 'Name Z-A', 'Type']))
      expect(labels).toHaveLength(3)
    })
  })

  describe('selection', () => {
    it('fires onValueChange with name-desc when Name Z-A is picked', async () => {
      const user = userEvent.setup()
      const onValueChange = vi.fn<(v: SortKey) => void>()

      render(<SortDropdown value="name-asc" onValueChange={onValueChange} />)
      await user.click(screen.getByRole('combobox'))

      const option = await screen.findByRole('option', { name: /name z-a/i })
      await user.click(option)

      expect(onValueChange).toHaveBeenCalledWith('name-desc')
    })

    it('fires onValueChange with type when Type is picked', async () => {
      const user = userEvent.setup()
      const onValueChange = vi.fn<(v: SortKey) => void>()

      render(<SortDropdown value="name-asc" onValueChange={onValueChange} />)
      await user.click(screen.getByRole('combobox'))

      const option = await screen.findByRole('option', { name: /^type$/i })
      await user.click(option)

      expect(onValueChange).toHaveBeenCalledWith('type')
    })
  })

  describe('accessibility', () => {
    it('exposes an accessible name for the sort selector', () => {
      render(<SortDropdown value="name-asc" onValueChange={vi.fn()} />)
      const trigger = screen.getByRole('combobox')
      // Accessible name comes from the aria-label or the surrounding label.
      const name =
        trigger.getAttribute('aria-label') ??
        trigger.getAttribute('aria-labelledby') ??
        ''
      expect(name.length).toBeGreaterThan(0)
    })
  })
})
