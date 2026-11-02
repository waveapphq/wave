/**
 * LastUpdatedIndicator Tests
 *
 * REQ-3.2.2.17 - Real-time dashboard with metrics.
 *
 * Small header pill. State-only:
 *
 *   | Status        | Dot           | Label                          |
 *   | ------------- | ------------- | ------------------------------ |
 *   | live          | Pulsing info  | "Live"                         |
 *   | paused        | Static muted  | "Paused"                       |
 *   | reconnecting  | Static warning| "Connection issue - retrying"  |
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LastUpdatedIndicator } from '@/features/dashboard/components/last-updated-indicator'

describe('LastUpdatedIndicator', () => {
  describe('Status labels', () => {
    it('renders "Live" when status is live', () => {
      render(<LastUpdatedIndicator status="live" />)
      expect(screen.getByTestId('dashboard-live-status')).toHaveTextContent('Live')
    })

    it('renders "Paused" when status is paused', () => {
      render(<LastUpdatedIndicator status="paused" />)
      expect(screen.getByTestId('dashboard-live-status')).toHaveTextContent('Paused')
    })

    it('renders "Connection issue - retrying" when status is reconnecting', () => {
      render(<LastUpdatedIndicator status="reconnecting" />)
      expect(screen.getByTestId('dashboard-live-status')).toHaveTextContent(
        'Connection issue - retrying'
      )
    })
  })

  describe('Status data attribute', () => {
    it.each([
      ['live' as const],
      ['paused' as const],
      ['reconnecting' as const],
    ])('exposes data-status=%s for integration-test hooks', (status) => {
      render(<LastUpdatedIndicator status={status} />)
      expect(screen.getByTestId('dashboard-live-status')).toHaveAttribute(
        'data-status',
        status
      )
    })
  })

  describe('Status dot', () => {
    it('applies animate-pulse when live', () => {
      render(<LastUpdatedIndicator status="live" />)
      const dot = screen
        .getByTestId('dashboard-live-status')
        .querySelector('[data-badge-dot]')
      expect(dot).not.toBeNull()
      expect(dot).toHaveClass('animate-pulse')
    })

    it('does not animate when paused', () => {
      render(<LastUpdatedIndicator status="paused" />)
      const dot = screen
        .getByTestId('dashboard-live-status')
        .querySelector('[data-badge-dot]')
      expect(dot).not.toBeNull()
      expect(dot).not.toHaveClass('animate-pulse')
    })

    it('does not animate when reconnecting', () => {
      render(<LastUpdatedIndicator status="reconnecting" />)
      const dot = screen
        .getByTestId('dashboard-live-status')
        .querySelector('[data-badge-dot]')
      expect(dot).not.toBeNull()
      expect(dot).not.toHaveClass('animate-pulse')
    })

    it('uses the info color token when live', () => {
      render(<LastUpdatedIndicator status="live" />)
      const dot = screen
        .getByTestId('dashboard-live-status')
        .querySelector('[data-badge-dot]')
      expect(dot).toHaveClass('bg-info')
    })

    it('uses the muted color token when paused', () => {
      render(<LastUpdatedIndicator status="paused" />)
      const dot = screen
        .getByTestId('dashboard-live-status')
        .querySelector('[data-badge-dot]')
      expect(dot).toHaveClass('bg-muted')
    })

    it('uses the warning color token when reconnecting', () => {
      render(<LastUpdatedIndicator status="reconnecting" />)
      const dot = screen
        .getByTestId('dashboard-live-status')
        .querySelector('[data-badge-dot]')
      expect(dot).toHaveClass('bg-warning')
    })
  })
})
