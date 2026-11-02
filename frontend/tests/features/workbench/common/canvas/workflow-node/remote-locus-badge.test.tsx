/**
 * RemoteLocusBadge tests (REQ-3.4.1.3).
 *
 * The R / L chip mirrors the Function L / S badge: R (cyan) = runs on the remote
 * host, L (slate) = runs on WAVE, each with a hover tooltip.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RemoteLocusBadge } from '@/features/workbench/common/canvas/workflow-node/remote-locus-badge'

describe('RemoteLocusBadge', () => {
  it('renders R with the cyan treatment and the host tooltip', () => {
    render(<RemoteLocusBadge locus="R" />)
    const badge = screen.getByTestId('node-remote-locus-badge')
    expect(badge).toHaveTextContent('R')
    expect(badge.getAttribute('data-locus')).toBe('R')
    expect(badge.getAttribute('aria-label')).toBe('Runs on the remote host')
    expect(badge.className).toContain('cyan')
  })

  it('renders L with the slate treatment and the WAVE tooltip', () => {
    render(<RemoteLocusBadge locus="L" />)
    const badge = screen.getByTestId('node-remote-locus-badge')
    expect(badge).toHaveTextContent('L')
    expect(badge.getAttribute('data-locus')).toBe('L')
    expect(badge.getAttribute('aria-label')).toBe('Runs on WAVE')
    expect(badge.className).toContain('slate')
  })

  it('honors a custom test id', () => {
    render(<RemoteLocusBadge locus="R" testId="custom-locus" />)
    expect(screen.getByTestId('custom-locus')).toBeInTheDocument()
  })
})
