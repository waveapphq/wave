/**
 * NetworkAddButton Component Tests
 *
 * The add button of the Network tables and lists (NET-3, NET-7): it shows its
 * label, reports a click and can be disabled.
 *
 * Component: frontend/src/features/settings/components/network/network-add-button.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { NetworkAddButton } from '@/features/settings/components/network/network-add-button'

describe('NetworkAddButton', () => {
  describe('Rendering', () => {
    it.each(['Add hosts', 'Add certificate', 'Add'])(
      'renders one button with the label "%s"',
      (label) => {
        render(<NetworkAddButton label={label} onClick={vi.fn()} />)

        expect(screen.getAllByRole('button')).toHaveLength(1)
        expect(screen.getByRole('button', { name: label })).toHaveTextContent(
          new RegExp(`^${label}$`),
        )
      },
    )

    it('takes a name that says what is added and keeps its visible word', () => {
      render(<NetworkAddButton label="Add" aria-label="Add entry" onClick={vi.fn()} />)

      expect(screen.getByRole('button', { name: 'Add entry' })).toHaveTextContent(/^Add$/)
    })

    it('is a plain button, never a submit', () => {
      render(<NetworkAddButton label="Add hosts" onClick={vi.fn()} />)

      expect(screen.getByRole('button', { name: 'Add hosts' })).toHaveAttribute('type', 'button')
    })
  })

  describe('Click', () => {
    it('reports a click once', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      render(<NetworkAddButton label="Add hosts" onClick={onClick} />)

      await user.click(screen.getByRole('button', { name: 'Add hosts' }))

      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('Disabled', () => {
    it('is enabled by default', () => {
      render(<NetworkAddButton label="Add certificate" onClick={vi.fn()} />)

      expect(screen.getByRole('button', { name: 'Add certificate' })).toBeEnabled()
    })

    it('is enabled when disabled is false', () => {
      render(<NetworkAddButton label="Add certificate" onClick={vi.fn()} disabled={false} />)

      expect(screen.getByRole('button', { name: 'Add certificate' })).toBeEnabled()
    })

    it('is disabled when asked to, and keeps its label', () => {
      render(<NetworkAddButton label="Add certificate" onClick={vi.fn()} disabled />)

      expect(screen.getByRole('button', { name: 'Add certificate' })).toBeDisabled()
    })

    it('reports nothing when it is clicked while disabled', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      render(<NetworkAddButton label="Add certificate" onClick={onClick} disabled />)

      await user.click(screen.getByRole('button', { name: 'Add certificate' }))

      expect(onClick).not.toHaveBeenCalled()
    })
  })
})
