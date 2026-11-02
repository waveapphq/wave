/**
 * CanvasReadOnlyContext tests
 *
 * Covers the provider + hook pair that broadcasts the canvas-level
 * read-only flag to descendant nodes, the block action row, and the
 * element config modal.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  CanvasReadOnlyProvider,
  useCanvasReadOnly,
} from '@/features/workbench/common/canvas/read-only-context'

function Probe() {
  const value = useCanvasReadOnly()
  return <div data-testid="probe">{value ? 'true' : 'false'}</div>
}

describe('CanvasReadOnlyProvider', () => {
  it('broadcasts true when value is true', () => {
    render(
      <CanvasReadOnlyProvider value={true}>
        <Probe />
      </CanvasReadOnlyProvider>,
    )

    expect(screen.getByTestId('probe').textContent).toBe('true')
  })

  it('broadcasts false when value is false', () => {
    render(
      <CanvasReadOnlyProvider value={false}>
        <Probe />
      </CanvasReadOnlyProvider>,
    )

    expect(screen.getByTestId('probe').textContent).toBe('false')
  })

  it('defaults to false outside the provider', () => {
    render(<Probe />)

    expect(screen.getByTestId('probe').textContent).toBe('false')
  })
})
