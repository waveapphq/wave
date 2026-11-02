/**
 * SessionArtifactLossCallout - the shared amber warning row rendered by every
 * session-teardown dialog when the live workbench session holds artifacts
 * (ARTIF-17).
 *
 * Module: frontend/src/components/shared/session-artifact-loss-callout.tsx
 *
 * One component = one tested copy source. The pinned copy is:
 *   "{N} session artifact{s} will be permanently deleted."
 *   "Download anything you need from the Artifacts panel first."
 * The component renders nothing when count < 1.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionArtifactLossCallout } from '@/components/shared/session-artifact-loss-callout'

describe('SessionArtifactLossCallout', () => {
  it('renders the plural copy for count > 1', () => {
    render(<SessionArtifactLossCallout count={3} />)

    expect(
      screen.getByText('3 session artifacts will be permanently deleted.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Download anything you need from the Artifacts panel first.')
    ).toBeInTheDocument()
  })

  it('renders the singular copy for count 1', () => {
    render(<SessionArtifactLossCallout count={1} />)

    expect(
      screen.getByText('1 session artifact will be permanently deleted.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Download anything you need from the Artifacts panel first.')
    ).toBeInTheDocument()
  })

  it('renders nothing at count 0', () => {
    const { container } = render(<SessionArtifactLossCallout count={0} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a negative count', () => {
    const { container } = render(<SessionArtifactLossCallout count={-1} />)

    expect(container).toBeEmptyDOMElement()
  })
})
