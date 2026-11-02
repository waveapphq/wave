/**
 * NetworkRemoveButton Component Tests
 *
 * The trash button of the Network tables and lists (NET-3, NET-7): named by
 * its aria-label, it reports a click and can be disabled.
 *
 * Component: frontend/src/features/settings/components/network/network-remove-button.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { NetworkRemoveButton } from '@/features/settings/components/network/network-remove-button'

const LABEL = 'Remove bastion.corp.example'

describe('NetworkRemoveButton', () => {
  describe('Rendering', () => {
    it('renders one button named by its aria-label', () => {
      render(<NetworkRemoveButton aria-label={LABEL} onClick={vi.fn()} />)

      expect(screen.getAllByRole('button')).toHaveLength(1)
      expect(screen.getByRole('button', { name: LABEL })).toBeInTheDocument()
    })

    it('takes its name from the aria-label it is given', () => {
      render(
        <>
          <NetworkRemoveButton aria-label="Remove entry 1" onClick={vi.fn()} />
          <NetworkRemoveButton aria-label="Remove entry 2" onClick={vi.fn()} />
        </>,
      )

      expect(screen.getByRole('button', { name: 'Remove entry 1' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove entry 2' })).toBeInTheDocument()
    })

    it('shows an icon hidden from assistive tech and no text', () => {
      render(<NetworkRemoveButton aria-label={LABEL} onClick={vi.fn()} />)

      const button = screen.getByRole('button', { name: LABEL })
      expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
      expect(button.textContent).toBe('')
    })

    it('is a plain button, never a submit', () => {
      render(<NetworkRemoveButton aria-label={LABEL} onClick={vi.fn()} />)

      expect(screen.getByRole('button', { name: LABEL })).toHaveAttribute('type', 'button')
    })
  })

  describe('Click', () => {
    it('reports a click once', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      render(<NetworkRemoveButton aria-label={LABEL} onClick={onClick} />)

      await user.click(screen.getByRole('button', { name: LABEL }))

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('reports only the button that was clicked', async () => {
      const user = userEvent.setup()
      const first = vi.fn()
      const second = vi.fn()
      render(
        <>
          <NetworkRemoveButton aria-label="Remove entry 1" onClick={first} />
          <NetworkRemoveButton aria-label="Remove entry 2" onClick={second} />
        </>,
      )

      await user.click(screen.getByRole('button', { name: 'Remove entry 2' }))

      expect(second).toHaveBeenCalledTimes(1)
      expect(first).not.toHaveBeenCalled()
    })
  })

  describe('Disabled', () => {
    it('is enabled by default', () => {
      render(<NetworkRemoveButton aria-label={LABEL} onClick={vi.fn()} />)

      expect(screen.getByRole('button', { name: LABEL })).toBeEnabled()
    })

    it('is enabled when disabled is false', () => {
      render(<NetworkRemoveButton aria-label={LABEL} onClick={vi.fn()} disabled={false} />)

      expect(screen.getByRole('button', { name: LABEL })).toBeEnabled()
    })

    it('is disabled when asked to, and keeps its name', () => {
      render(<NetworkRemoveButton aria-label={LABEL} onClick={vi.fn()} disabled />)

      expect(screen.getByRole('button', { name: LABEL })).toBeDisabled()
    })

    it('reports nothing when it is clicked while disabled', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      render(<NetworkRemoveButton aria-label={LABEL} onClick={onClick} disabled />)

      await user.click(screen.getByRole('button', { name: LABEL }))

      expect(onClick).not.toHaveBeenCalled()
    })
  })
})
