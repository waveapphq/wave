/**
 * Shared expand toggle: the one button that opens and closes a row, used by
 * the folder row and by the Backup preview rows and result lines (BACKUP-2).
 *
 * Module: frontend/src/components/shared/expand-toggle.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { ExpandToggle } from '@/components/shared/expand-toggle'

type ExpandToggleProps = ComponentProps<typeof ExpandToggle>

const FOLDER_SQUARE_CLASSES = [
  'h-6',
  'w-6',
  'shrink-0',
  'justify-center',
  'rounded',
  'hover:bg-muted/20',
]

function renderToggle(props: Partial<ExpandToggleProps> = {}) {
  const onToggle = vi.fn()
  render(<ExpandToggle expanded={false} onToggle={onToggle} name="tests" {...props} />)
  return { onToggle, button: screen.getByRole('button') }
}

describe('ExpandToggle', () => {
  it('is a button that reads Expand <text> when closed', () => {
    const { button } = renderToggle({ expanded: false })

    expect(screen.getByRole('button', { name: 'Expand tests' })).toBe(button)
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button.querySelector('svg.lucide-chevron-right')).toBeInTheDocument()
    expect(button.querySelector('svg.lucide-chevron-down')).not.toBeInTheDocument()
  })

  it('reads Collapse <text> when open', () => {
    const { button } = renderToggle({ expanded: true })

    expect(screen.getByRole('button', { name: 'Collapse tests' })).toBe(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button.querySelector('svg.lucide-chevron-down')).toBeInTheDocument()
    expect(button.querySelector('svg.lucide-chevron-right')).not.toBeInTheDocument()
  })

  it('calls onToggle on click, Enter and Space', async () => {
    const user = userEvent.setup()
    const { onToggle, button } = renderToggle()

    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onToggle).toHaveBeenCalledTimes(1)

    await user.keyboard(' ')
    expect(onToggle).toHaveBeenCalledTimes(2)

    await user.click(button)
    expect(onToggle).toHaveBeenCalledTimes(3)
  })

  it('draws its children inside the same button after the chevron', async () => {
    const user = userEvent.setup()
    const { onToggle, button } = renderToggle({
      children: <span data-testid="toggle-name">tests</span>,
    })

    expect(screen.getAllByRole('button')).toHaveLength(1)
    const name = within(button).getByTestId('toggle-name')
    const chevron = button.querySelector('svg.lucide-chevron-right')
    expect(chevron).toBeInTheDocument()
    expect(name.compareDocumentPosition(chevron as Element)).toBe(Node.DOCUMENT_POSITION_PRECEDING)

    await user.click(name)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('draws only the chevron when it has no children', () => {
    const { button } = renderToggle()

    expect(button.childElementCount).toBe(1)
    expect(button.firstElementChild).toBe(button.querySelector('svg.lucide-chevron-right'))
    expect(button.textContent).toBe('')
  })

  it("adds the caller's classes to its own", () => {
    const { button } = renderToggle({ className: FOLDER_SQUARE_CLASSES.join(' ') })

    expect(button).toHaveClass('flex', 'items-center')
    expect(button).toHaveClass(...FOLDER_SQUARE_CLASSES)
  })

  it('passes any other prop to its button and draws a 16 px chevron', () => {
    render(
      <ExpandToggle
        expanded={false}
        onToggle={vi.fn()}
        name="tests"
        data-testid="entity-row-toggle-tests"
      />
    )

    const button = screen.getByRole('button', { name: 'Expand tests' })
    expect(screen.getByTestId('entity-row-toggle-tests')).toBe(button)
    expect(button.querySelector('svg')).toHaveClass('h-4', 'w-4')
  })
})
