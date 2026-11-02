/**
 * SectionError Component Tests
 *
 * REQ-5.2.1.42: shared settings section error: alert icon, the API's
 * reason and "Try Again".
 *
 * Component: frontend/src/features/settings/components/section-error.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SectionError } from '@/features/settings/components/section-error'

const MESSAGE =
  "WAVE's trusted SSH hosts list /srv/wave/data/network/ssh_hosts.yaml cannot be read: Permission denied"

describe('SectionError', () => {
  it('renders the message in an alert', () => {
    render(<SectionError message={MESSAGE} onRetry={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent(MESSAGE)
  })

  it('shows an alert icon hidden from assistive tech', () => {
    render(<SectionError message={MESSAGE} onRetry={vi.fn()} />)

    const icon = screen.getByRole('alert').querySelector('svg.lucide-circle-alert')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('calls onRetry when Try Again is clicked', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<SectionError message={MESSAGE} onRetry={onRetry} />)

    await user.click(screen.getByRole('button', { name: 'Try Again' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('does not call onRetry on render', () => {
    const onRetry = vi.fn()
    render(<SectionError message={MESSAGE} onRetry={onRetry} />)

    expect(onRetry).not.toHaveBeenCalled()
  })

  it('passes its data-testid through to the alert', () => {
    render(<SectionError message={MESSAGE} onRetry={vi.fn()} data-testid="masking-error" />)

    expect(screen.getByTestId('masking-error')).toBe(screen.getByRole('alert'))
  })
})
