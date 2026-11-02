/**
 * UploadsInProgressCallout - the shared amber warning row the close and switch
 * dialogs render while a test's files are still arriving (TDATA-14).
 *
 * Module: frontend/src/components/shared/uploads-in-progress-callout.tsx
 *
 * One component = one tested copy source. The pinned copy is:
 *   "{N} test data upload{s} {is|are} still going."
 *   "Leaving this test does not stop {it|them}; closing the tab does."
 * The component renders nothing when count < 1.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UploadsInProgressCallout } from '@/components/shared/uploads-in-progress-callout'

describe('UploadsInProgressCallout', () => {
  it('renders the singular copy for count 1', () => {
    render(<UploadsInProgressCallout count={1} />)

    expect(screen.getByText('1 test data upload is still going.')).toBeInTheDocument()
    expect(
      screen.getByText('Leaving this test does not stop it; closing the tab does.')
    ).toBeInTheDocument()
  })

  it('renders the plural copy for count 2', () => {
    render(<UploadsInProgressCallout count={2} />)

    expect(screen.getByText('2 test data uploads are still going.')).toBeInTheDocument()
    expect(
      screen.getByText('Leaving this test does not stop them; closing the tab does.')
    ).toBeInTheDocument()
  })

  it('renders nothing at count 0', () => {
    const { container } = render(<UploadsInProgressCallout count={0} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a negative count', () => {
    const { container } = render(<UploadsInProgressCallout count={-1} />)

    expect(container).toBeEmptyDOMElement()
  })
})
