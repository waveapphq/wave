/**
 * Tests for the global Escape key handler module.
 *
 * Verifies that:
 * - Registered handlers are called on Escape keydown
 * - Handlers that return true stop event propagation
 * - Handlers that return false allow event to continue
 * - Non-Escape keys are ignored
 * - Unregistered handlers are not called
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { registerEscapeHandler } from '@/features/workbench/lib/codemirror/escape-handler'

describe('escape-handler', () => {
  const cleanups: (() => void)[] = []

  afterEach(() => {
    for (const cleanup of cleanups) cleanup()
    cleanups.length = 0
  })

  function dispatchEscape(): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    vi.spyOn(event, 'stopImmediatePropagation')
    vi.spyOn(event, 'preventDefault')
    document.dispatchEvent(event)
    return event
  }

  it('calls registered handler on Escape and stops propagation when handler returns true', () => {
    const handler = vi.fn(() => true)
    cleanups.push(registerEscapeHandler(handler))

    const event = dispatchEscape()

    expect(handler).toHaveBeenCalledWith(event)
    expect(event.stopImmediatePropagation).toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('does not stop propagation when handler returns false', () => {
    const handler = vi.fn(() => false)
    cleanups.push(registerEscapeHandler(handler))

    const event = dispatchEscape()

    expect(handler).toHaveBeenCalled()
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does not call handler for non-Escape keys', () => {
    const handler = vi.fn(() => true)
    cleanups.push(registerEscapeHandler(handler))

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    document.dispatchEvent(event)

    expect(handler).not.toHaveBeenCalled()
  })

  it('does not call handler after unregistering', () => {
    const handler = vi.fn(() => true)
    const unregister = registerEscapeHandler(handler)
    unregister()

    dispatchEscape()

    expect(handler).not.toHaveBeenCalled()
  })

  it('stops at first handler that returns true', () => {
    const handler1 = vi.fn(() => true)
    const handler2 = vi.fn(() => true)
    cleanups.push(registerEscapeHandler(handler1))
    cleanups.push(registerEscapeHandler(handler2))

    dispatchEscape()

    // One of them should be called, the other should not
    // Set iteration order = insertion order, so handler1 is called first
    expect(handler1).toHaveBeenCalled()
    expect(handler2).not.toHaveBeenCalled()
  })
})
