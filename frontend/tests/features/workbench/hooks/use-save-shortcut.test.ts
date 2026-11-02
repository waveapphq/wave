/**
 * useSaveShortcut Hook Tests
 *
 * Cmd/Ctrl+S routes to the workbench save handler (mirroring the Save
 * button), intercepting the browser's native save dialog. Disabled on
 * read-only canvases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSaveShortcut } from '@/features/workbench/hooks/use-save-shortcut'

function pressKey(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { ...init, cancelable: true })
  document.dispatchEvent(event)
  return event
}

describe('useSaveShortcut', () => {
  let onSave: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onSave = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('Ctrl+S calls onSave and prevents the native save dialog', () => {
    renderHook(() => useSaveShortcut({ onSave }))
    const event = pressKey({ key: 's', ctrlKey: true })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('Cmd+S (metaKey) calls onSave', () => {
    renderHook(() => useSaveShortcut({ onSave }))
    pressKey({ key: 's', metaKey: true })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('uppercase S with the modifier still triggers (case-insensitive)', () => {
    renderHook(() => useSaveShortcut({ onSave }))
    pressKey({ key: 'S', ctrlKey: true })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('does NOT trigger when disabled', () => {
    renderHook(() => useSaveShortcut({ onSave, disabled: true }))
    const event = pressKey({ key: 's', ctrlKey: true })
    expect(onSave).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('does NOT trigger without a modifier key', () => {
    renderHook(() => useSaveShortcut({ onSave }))
    pressKey({ key: 's' })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('does NOT trigger when Shift is also held', () => {
    renderHook(() => useSaveShortcut({ onSave }))
    pressKey({ key: 's', ctrlKey: true, shiftKey: true })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('does NOT trigger when Alt is also held', () => {
    renderHook(() => useSaveShortcut({ onSave }))
    pressKey({ key: 's', ctrlKey: true, altKey: true })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('does NOT trigger for a different key with the modifier', () => {
    renderHook(() => useSaveShortcut({ onSave }))
    pressKey({ key: 'a', ctrlKey: true })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('removes the listener on unmount (no call after teardown)', () => {
    const { unmount } = renderHook(() => useSaveShortcut({ onSave }))
    unmount()
    pressKey({ key: 's', ctrlKey: true })
    expect(onSave).not.toHaveBeenCalled()
  })
})
