/**
 * ValidationPathRow renders one path-aware validation error row.
 *
 * The row renders the enclosing-Function trail as clickable segments, the
 * failing leaf as a clickable bold target, and the message after ` - `.
 * A segment whose Function is a Published (shared) reference renders the
 * library name in italics (CANVAS-217). Clicking a segment fires
 * `onSegmentNavigate(depthIndex)`; clicking the leaf fires `onLeafFocus()`.
 *
 * The component props are:
 *   { path: PathSegment[]; leafLabel: string; message: string;
 *     onSegmentNavigate(depthIndex); onLeafFocus() }
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  ValidationPathRow,
  type PathSegment,
} from '@/features/workbench/common/canvas/dialogs/validation-path-row'

const TWO_LEVEL: PathSegment[] = [
  { label: 'Outer_Fn' },
  { label: 'Inner_Fn' },
]

describe('ValidationPathRow', () => {
  it('renders one button per path segment plus the leaf', () => {
    render(
      <ValidationPathRow
        path={TWO_LEVEL}
        leafLabel="Log_1"
        message="Required parameter 'message' is missing"
        onSegmentNavigate={vi.fn()}
        onLeafFocus={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Outer_Fn' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inner_Fn' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log_1' })).toBeInTheDocument()
  })

  it('renders the message text after the path', () => {
    render(
      <ValidationPathRow
        path={TWO_LEVEL}
        leafLabel="Log_1"
        message="Required parameter 'message' is missing"
        onSegmentNavigate={vi.fn()}
        onLeafFocus={vi.fn()}
      />,
    )
    expect(
      screen.getByText("Required parameter 'message' is missing"),
    ).toBeInTheDocument()
  })

  it('fires onSegmentNavigate with the depth index when a segment is clicked', async () => {
    const onSegmentNavigate = vi.fn()
    const user = userEvent.setup()
    render(
      <ValidationPathRow
        path={TWO_LEVEL}
        leafLabel="Log_1"
        message="msg"
        onSegmentNavigate={onSegmentNavigate}
        onLeafFocus={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Inner_Fn' }))
    expect(onSegmentNavigate).toHaveBeenCalledWith(1)
  })

  it('fires onLeafFocus when the leaf is clicked', async () => {
    const onLeafFocus = vi.fn()
    const user = userEvent.setup()
    render(
      <ValidationPathRow
        path={TWO_LEVEL}
        leafLabel="Log_1"
        message="msg"
        onSegmentNavigate={vi.fn()}
        onLeafFocus={onLeafFocus}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Log_1' }))
    expect(onLeafFocus).toHaveBeenCalledTimes(1)
  })

  it('renders a shared-reference segment in italics (CANVAS-217)', () => {
    const shared: PathSegment[] = [{ label: 'ValidateUser', isShared: true }]
    render(
      <ValidationPathRow
        path={shared}
        leafLabel="Log_1"
        message="msg"
        onSegmentNavigate={vi.fn()}
        onLeafFocus={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'ValidateUser' })).toHaveClass('italic')
  })

  it('renders a shared-reference leaf in italics (CANVAS-218)', () => {
    render(
      <ValidationPathRow
        path={[]}
        leafLabel="ValidateUser"
        leafIsShared
        message="Pinned version 2.0.0 is no longer available in the library"
        onSegmentNavigate={vi.fn()}
        onLeafFocus={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'ValidateUser' })).toHaveClass('italic')
  })

  it('renders a single segment for a one-level path', () => {
    render(
      <ValidationPathRow
        path={[{ label: 'Outer_Fn' }]}
        leafLabel="Log_1"
        message="msg"
        onSegmentNavigate={vi.fn()}
        onLeafFocus={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Outer_Fn' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log_1' })).toBeInTheDocument()
  })

  it('renders only the leaf when there is no enclosing-Function path', () => {
    render(
      <ValidationPathRow
        path={[]}
        leafLabel="HTTP_1"
        message="Required parameter 'url' is missing"
        onSegmentNavigate={vi.fn()}
        onLeafFocus={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'HTTP_1' })).toBeInTheDocument()
    expect(
      screen.getByText("Required parameter 'url' is missing"),
    ).toBeInTheDocument()
  })
})
