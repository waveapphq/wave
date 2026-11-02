/**
 * Tests for `ActionBarReadonlyChrome` (chrome variants).
 *
 * The chrome owns two slots inside the canvas action bar when the user is
 * drilled into a Shared Function instance:
 *
 *   - read-only variant (default; `editMode: false` or omitted): indigo
 *     "Read-only" pill + "Edit Function" button. Click invokes
 *     `onEditFunction`.
 *   - edit-mode variant (`editMode: true`): amber "Edit mode" pill +
 *     "Drop changes" button. Click invokes `onDropChanges`.
 *
 * Both variants render bracketing splitters and keep the SAME slot in the
 * action bar so a user toggling edit mode does not see the chrome flicker
 * into / out of existence.
 *
 * Accessibility:
 *   - read-only pill: `aria-label="Read-only inspect mode"`
 *   - edit-mode pill: `aria-label="Edit-mode inspect"`
 *   - edit button: `aria-label="Edit Function"`
 *   - drop button: `aria-label="Drop changes"`
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { ActionBarReadonlyChrome } from '@/features/workbench/common/canvas/chrome/action-bar-readonly-chrome'


describe('ActionBarReadonlyChrome - read-only variant (default)', () => {
  it('renders the Read-only badge with the documented aria-label', () => {
    render(<ActionBarReadonlyChrome />)
    expect(
      screen.getByLabelText('Read-only inspect mode'),
    ).toBeInTheDocument()
  })

  it('renders the Edit Function button with the documented aria-label', () => {
    render(<ActionBarReadonlyChrome />)
    expect(screen.getByLabelText('Edit Function')).toBeInTheDocument()
  })

  it('renders the badge text "READ-ONLY" uppercase', () => {
    render(<ActionBarReadonlyChrome />)
    expect(screen.getByText(/READ-ONLY/i)).toBeInTheDocument()
  })

  it('renders TWO bracketing splitters (left + right of the chrome group)', () => {
    const { container } = render(<ActionBarReadonlyChrome />)
    const splitters = container.querySelectorAll(
      '[data-testid="action-bar-readonly-splitter"]',
    )
    expect(splitters.length).toBe(2)
  })

  it('Edit button is NOT disabled', () => {
    render(<ActionBarReadonlyChrome />)
    expect(screen.getByLabelText('Edit Function')).not.toBeDisabled()
  })

  it('click is a no-op when no onEditFunction supplied', () => {
    render(<ActionBarReadonlyChrome />)
    expect(() => fireEvent.click(screen.getByLabelText('Edit Function'))).not.toThrow()
  })

  it('invokes onEditFunction handler when supplied', () => {
    const onEditFunction = vi.fn()
    render(<ActionBarReadonlyChrome onEditFunction={onEditFunction} />)
    fireEvent.click(screen.getByLabelText('Edit Function'))
    expect(onEditFunction).toHaveBeenCalledTimes(1)
  })
})


describe('ActionBarReadonlyChrome - edit-mode variant', () => {
  it('renders the Edit-mode pill with the documented aria-label', () => {
    render(<ActionBarReadonlyChrome editMode />)
    expect(screen.getByLabelText('Edit-mode inspect')).toBeInTheDocument()
  })

  it('renders the badge text "EDIT MODE" uppercase', () => {
    render(<ActionBarReadonlyChrome editMode />)
    expect(screen.getByText(/EDIT MODE/i)).toBeInTheDocument()
  })

  it('renders the Drop changes button (replaces Edit Function)', () => {
    render(<ActionBarReadonlyChrome editMode />)
    expect(screen.getByLabelText('Drop changes')).toBeInTheDocument()
    expect(screen.queryByLabelText('Edit Function')).toBeNull()
  })

  it('invokes onDropChanges handler when supplied', () => {
    const onDropChanges = vi.fn()
    render(<ActionBarReadonlyChrome editMode onDropChanges={onDropChanges} />)
    fireEvent.click(screen.getByLabelText('Drop changes'))
    expect(onDropChanges).toHaveBeenCalledTimes(1)
  })

  it('still renders TWO bracketing splitters', () => {
    const { container } = render(<ActionBarReadonlyChrome editMode />)
    const splitters = container.querySelectorAll(
      '[data-testid="action-bar-readonly-splitter"]',
    )
    expect(splitters.length).toBe(2)
  })
})


describe('ActionBarReadonlyChrome - Publish button', () => {
  it('renders the Publish button in edit mode', () => {
    render(<ActionBarReadonlyChrome editMode onPublish={vi.fn()} />)
    expect(screen.getByLabelText('Publish')).toBeInTheDocument()
  })

  it('does NOT render the Publish button in read-only mode', () => {
    render(<ActionBarReadonlyChrome onPublish={vi.fn()} />)
    expect(screen.queryByLabelText('Publish')).toBeNull()
  })

  it('invokes onPublish when the Publish button is clicked', () => {
    const onPublish = vi.fn()
    render(<ActionBarReadonlyChrome editMode onPublish={onPublish} />)
    fireEvent.click(screen.getByLabelText('Publish'))
    expect(onPublish).toHaveBeenCalledTimes(1)
  })

  it('orders Publish to the right of Drop changes (rightmost in the edit cluster)', () => {
    const { container } = render(<ActionBarReadonlyChrome editMode onPublish={vi.fn()} />)
    const dropChanges = screen.getByLabelText('Drop changes')
    const publish = screen.getByLabelText('Publish')
    // Publish follows Drop changes in document order.
    expect(
      dropChanges.compareDocumentPosition(publish) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // Sanity: both live inside the chrome container.
    expect(container.contains(dropChanges)).toBe(true)
    expect(container.contains(publish)).toBe(true)
  })

  it('keeps the Publish click a no-op when no handler is supplied', () => {
    render(<ActionBarReadonlyChrome editMode />)
    expect(() => fireEvent.click(screen.getByLabelText('Publish'))).not.toThrow()
  })
})
