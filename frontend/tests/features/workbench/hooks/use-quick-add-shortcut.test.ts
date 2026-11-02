/**
 * useQuickAddShortcut tests (REQ-4.2.5).
 *
 * Ctrl+Space keydown listener mirroring the use-canvas-shortcuts focus-guard
 * pattern: toggles the popover open state, suppressed inside editable
 * elements, suppressed when disabled (read-only / executing), and bound to
 * Ctrl (not Cmd) on every platform because Cmd+Space is macOS Spotlight.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useQuickAddShortcut } from '@/features/workbench/hooks/use-quick-add-shortcut'

function pressCtrlSpace(target: EventTarget = document): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useQuickAddShortcut - toggle', () => {
  it('opens on Ctrl+Space and toggles closed on a second press', () => {
    const { result } = renderHook(() => useQuickAddShortcut({ disabled: false }))
    expect(result.current.isOpen).toBe(false)

    pressCtrlSpace()
    expect(result.current.isOpen).toBe(true)

    pressCtrlSpace()
    expect(result.current.isOpen).toBe(false)
  })

  it('prevents the default Space behavior when it handles the shortcut', () => {
    renderHook(() => useQuickAddShortcut({ disabled: false }))
    const event = pressCtrlSpace()
    expect(event.defaultPrevented).toBe(true)
  })

  it('exposes setIsOpen for programmatic control', () => {
    const { result } = renderHook(() => useQuickAddShortcut({ disabled: false }))
    act(() => {
      result.current.setIsOpen(true)
    })
    expect(result.current.isOpen).toBe(true)
    act(() => {
      result.current.setIsOpen(false)
    })
    expect(result.current.isOpen).toBe(false)
  })
})

describe('useQuickAddShortcut - key guards', () => {
  it('ignores Space without modifiers', () => {
    const { result } = renderHook(() => useQuickAddShortcut({ disabled: false }))
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(result.current.isOpen).toBe(false)
  })

  it('ignores Cmd+Space (Meta) - that is Spotlight on macOS', () => {
    const { result } = renderHook(() => useQuickAddShortcut({ disabled: false }))
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(result.current.isOpen).toBe(false)
  })

  it('ignores Ctrl+Cmd+Space (Meta present alongside Ctrl)', () => {
    const { result } = renderHook(() => useQuickAddShortcut({ disabled: false }))
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          ctrlKey: true,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(result.current.isOpen).toBe(false)
  })

  it('ignores Ctrl with keys other than Space', () => {
    const { result } = renderHook(() => useQuickAddShortcut({ disabled: false }))
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'k',
          code: 'KeyK',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(result.current.isOpen).toBe(false)
  })
})

describe('useQuickAddShortcut - focus guards', () => {
  it.each([
    ['INPUT', () => document.createElement('input')],
    ['TEXTAREA', () => document.createElement('textarea')],
    [
      'contenteditable',
      () => {
        const div = document.createElement('div')
        div.setAttribute('contenteditable', 'true')
        return div
      },
    ],
  ])('does not trigger from a %s element', (_label, makeElement) => {
    const { result } = renderHook(() => useQuickAddShortcut({ disabled: false }))
    const el = makeElement()
    document.body.appendChild(el)
    pressCtrlSpace(el)
    expect(result.current.isOpen).toBe(false)
  })

  it('triggers from a non-editable element (e.g. a focused button)', () => {
    const { result } = renderHook(() => useQuickAddShortcut({ disabled: false }))
    const button = document.createElement('button')
    document.body.appendChild(button)
    pressCtrlSpace(button)
    expect(result.current.isOpen).toBe(true)
  })
})

describe('useQuickAddShortcut - disabled (read-only / executing)', () => {
  it('does not open while disabled', () => {
    const { result } = renderHook(() => useQuickAddShortcut({ disabled: true }))
    pressCtrlSpace()
    expect(result.current.isOpen).toBe(false)
  })

  it('re-arms when disabled flips back to false', () => {
    const { result, rerender } = renderHook(
      ({ disabled }) => useQuickAddShortcut({ disabled }),
      { initialProps: { disabled: true } },
    )
    pressCtrlSpace()
    expect(result.current.isOpen).toBe(false)

    rerender({ disabled: false })
    pressCtrlSpace()
    expect(result.current.isOpen).toBe(true)
  })
})
