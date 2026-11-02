/**
 * useFileDrop Hook Tests
 *
 * Tests for the shared drag-and-drop file handling hook that provides
 * window-level event listeners and drop zone detection.
 *
 * Component: frontend/src/hooks/use-file-drop.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFileDrop } from '@/hooks/use-file-drop'

// ============================================================================
// Helpers
// ============================================================================

function createDragEvent(type: string, overrides: Record<string, unknown> = {}): Event {
  const evt = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(evt, key, { value, writable: true })
  }
  return evt
}

let dropZone: HTMLButtonElement

beforeEach(() => {
  dropZone = document.createElement('button')
  document.body.appendChild(dropZone)
})

afterEach(() => {
  dropZone.remove()
})

// ============================================================================
// Tests
// ============================================================================

describe('useFileDrop', () => {
  describe('initialization', () => {
    it('returns isDragging as false initially', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile }))
      expect(result.current.isDragging).toBe(false)
    })

    it('returns a dropZoneRef', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile }))
      expect(result.current.dropZoneRef).toBeDefined()
      expect(result.current.dropZoneRef.current).toBeNull()
    })
  })

  describe('dragover', () => {
    it('sets isDragging to true when dragover target is inside drop zone', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile }))

      // Attach ref to our zone
      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      const child = document.createElement('span')
      dropZone.appendChild(child)

      act(() => {
        const evt = createDragEvent('dragover', {
          target: child,
          dataTransfer: { dropEffect: '' },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(result.current.isDragging).toBe(true)
    })

    it('sets isDragging to false when dragover target is outside drop zone', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      // First set isDragging to true
      const child = document.createElement('span')
      dropZone.appendChild(child)
      act(() => {
        const evt = createDragEvent('dragover', {
          target: child,
          dataTransfer: { dropEffect: '' },
        })
        globalThis.dispatchEvent(evt)
      })
      expect(result.current.isDragging).toBe(true)

      // Dragover outside the zone
      act(() => {
        const evt = createDragEvent('dragover', {
          target: document.body,
          dataTransfer: { dropEffect: '' },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(result.current.isDragging).toBe(false)
    })

    it('sets dropEffect to copy', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      const dataTransfer = { dropEffect: '' }
      act(() => {
        const evt = createDragEvent('dragover', {
          target: dropZone,
          dataTransfer,
        })
        globalThis.dispatchEvent(evt)
      })

      expect(dataTransfer.dropEffect).toBe('copy')
    })

    it('handles dragover when dataTransfer is null', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      // No dataTransfer property - should not throw
      act(() => {
        const evt = createDragEvent('dragover', { target: dropZone })
        globalThis.dispatchEvent(evt)
      })

      expect(result.current.isDragging).toBe(true)
    })
  })

  describe('propagation to the page', () => {
    it('lets a dragover reach a listener above the drop zone', () => {
      // React delegates its onDragOver to the root container, an ancestor of the
      // zone, so a window capture listener must not stop the event there.
      const container = document.createElement('div')
      document.body.appendChild(container)
      const zone = document.createElement('div')
      container.appendChild(zone)
      const delegated = vi.fn()
      container.addEventListener('dragover', delegated)
      const { result } = renderHook(() => useFileDrop({ onFiles: vi.fn() }))
      act(() => {
        result.current.dropZoneRef.current = zone as HTMLElement
      })

      act(() => {
        zone.dispatchEvent(createDragEvent('dragover', { target: zone }))
      })

      expect(delegated).toHaveBeenCalledTimes(1)
      container.remove()
    })
  })

  describe('dragleave', () => {
    it('sets isDragging to false when relatedTarget is outside drop zone', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      // Activate dragging first
      act(() => {
        const evt = createDragEvent('dragover', {
          target: dropZone,
          dataTransfer: { dropEffect: '' },
        })
        globalThis.dispatchEvent(evt)
      })
      expect(result.current.isDragging).toBe(true)

      // Dragleave with relatedTarget outside zone
      act(() => {
        const evt = createDragEvent('dragleave', {
          relatedTarget: document.body,
        })
        globalThis.dispatchEvent(evt)
      })

      expect(result.current.isDragging).toBe(false)
    })

    it('keeps isDragging true when relatedTarget is inside drop zone', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile }))

      const child = document.createElement('span')
      dropZone.appendChild(child)

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      // Activate dragging first
      act(() => {
        const evt = createDragEvent('dragover', {
          target: dropZone,
          dataTransfer: { dropEffect: '' },
        })
        globalThis.dispatchEvent(evt)
      })
      expect(result.current.isDragging).toBe(true)

      // Dragleave with relatedTarget inside zone (moving to child element)
      act(() => {
        const evt = createDragEvent('dragleave', {
          relatedTarget: child,
        })
        globalThis.dispatchEvent(evt)
      })

      expect(result.current.isDragging).toBe(true)
    })
  })

  describe('drop', () => {
    it('calls onFile with the dropped file when target is inside zone', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      const file = new File(['content'], 'test.yaml', { type: 'application/x-yaml' })
      act(() => {
        const evt = createDragEvent('drop', {
          target: dropZone,
          dataTransfer: { files: [file] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(onFile).toHaveBeenCalledWith(file)
    })

    it('does not call onFile when target is outside zone', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      const file = new File(['content'], 'outside.yaml')
      act(() => {
        const evt = createDragEvent('drop', {
          target: document.body,
          dataTransfer: { files: [file] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(onFile).not.toHaveBeenCalled()
    })

    it('does not call onFile when dataTransfer has no files', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      act(() => {
        const evt = createDragEvent('drop', {
          target: dropZone,
          dataTransfer: { files: [] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(onFile).not.toHaveBeenCalled()
    })

    it('does not call onFile when dataTransfer is absent', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      act(() => {
        const evt = createDragEvent('drop', { target: dropZone })
        globalThis.dispatchEvent(evt)
      })

      expect(onFile).not.toHaveBeenCalled()
    })

    it('resets isDragging to false after drop', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      // Activate drag state first
      act(() => {
        const evt = createDragEvent('dragover', {
          target: dropZone,
          dataTransfer: { dropEffect: '' },
        })
        globalThis.dispatchEvent(evt)
      })
      expect(result.current.isDragging).toBe(true)

      const file = new File(['content'], 'test.yaml')
      act(() => {
        const evt = createDragEvent('drop', {
          target: dropZone,
          dataTransfer: { files: [file] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(result.current.isDragging).toBe(false)
    })
  })

  describe('enabled option', () => {
    it('does not attach listeners when enabled is false', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile, enabled: false }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      const file = new File(['content'], 'test.yaml')
      act(() => {
        const evt = createDragEvent('drop', {
          target: dropZone,
          dataTransfer: { files: [file] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(onFile).not.toHaveBeenCalled()
      expect(result.current.isDragging).toBe(false)
    })

    it('attaches listeners when enabled transitions from false to true', () => {
      const onFile = vi.fn()
      const { result, rerender } = renderHook(
        ({ enabled }) => useFileDrop({ onFile, enabled }),
        { initialProps: { enabled: false } }
      )

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      // Re-render with enabled=true
      rerender({ enabled: true })

      const file = new File(['content'], 'test.yaml')
      act(() => {
        const evt = createDragEvent('drop', {
          target: dropZone,
          dataTransfer: { files: [file] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(onFile).toHaveBeenCalledWith(file)
    })

    it('removes listeners when enabled transitions from true to false', () => {
      const onFile = vi.fn()
      const { result, rerender } = renderHook(
        ({ enabled }) => useFileDrop({ onFile, enabled }),
        { initialProps: { enabled: true } }
      )

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      // Disable
      rerender({ enabled: false })

      const file = new File(['content'], 'test.yaml')
      act(() => {
        const evt = createDragEvent('drop', {
          target: dropZone,
          dataTransfer: { files: [file] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(onFile).not.toHaveBeenCalled()
    })

    it('defaults enabled to true when not specified', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      const file = new File(['content'], 'test.yaml')
      act(() => {
        const evt = createDragEvent('drop', {
          target: dropZone,
          dataTransfer: { files: [file] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(onFile).toHaveBeenCalledWith(file)
    })
  })

  describe('cleanup', () => {
    it('removes event listeners on unmount', () => {
      const onFile = vi.fn()
      const { result, unmount } = renderHook(() => useFileDrop({ onFile }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      unmount()

      const file = new File(['content'], 'test.yaml')
      act(() => {
        const evt = createDragEvent('drop', {
          target: dropZone,
          dataTransfer: { files: [file] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(onFile).not.toHaveBeenCalled()
    })
  })

  describe('onFiles - every dropped file', () => {
    it('reports all dropped files in the order they arrived', () => {
      const onFiles = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFiles }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      const first = new File(['a'], 'users.csv')
      const second = new File(['b'], 'orders.csv')
      act(() => {
        const evt = createDragEvent('drop', {
          target: dropZone,
          dataTransfer: { files: [first, second] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(onFiles).toHaveBeenCalledWith([first, second])
    })

    it('reports a single dropped file as a one-item list', () => {
      const onFiles = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFiles }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      const file = new File(['a'], 'users.csv')
      act(() => {
        const evt = createDragEvent('drop', {
          target: dropZone,
          dataTransfer: { files: [file] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(onFiles).toHaveBeenCalledWith([file])
    })

    it('does not fire when the drop lands outside the zone', () => {
      const onFiles = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFiles }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      act(() => {
        const evt = createDragEvent('drop', {
          target: document.body,
          dataTransfer: { files: [new File(['a'], 'users.csv')] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(onFiles).not.toHaveBeenCalled()
    })

    it('does nothing when the drop carries no files', () => {
      const onFiles = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFiles }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      act(() => {
        const evt = createDragEvent('drop', {
          target: dropZone,
          dataTransfer: { files: [] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(onFiles).not.toHaveBeenCalled()
    })

    it('does nothing when the drop carries no dataTransfer', () => {
      const onFiles = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFiles }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      act(() => {
        const evt = createDragEvent('drop', { target: dropZone })
        globalThis.dispatchEvent(evt)
      })

      expect(onFiles).not.toHaveBeenCalled()
    })

    it('uses the latest onFiles callback without re-registering listeners', () => {
      const first = vi.fn()
      const second = vi.fn()
      const { result, rerender } = renderHook(({ onFiles }) => useFileDrop({ onFiles }), {
        initialProps: { onFiles: first },
      })

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      rerender({ onFiles: second })

      const file = new File(['a'], 'users.csv')
      act(() => {
        const evt = createDragEvent('drop', {
          target: dropZone,
          dataTransfer: { files: [file] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledWith([file])
    })
  })

  describe('onFile and onFiles together', () => {
    it('serves both callbacks from one drop', () => {
      const onFile = vi.fn()
      const onFiles = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile, onFiles }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      const first = new File(['a'], 'users.csv')
      const second = new File(['b'], 'orders.csv')
      act(() => {
        const evt = createDragEvent('drop', {
          target: dropZone,
          dataTransfer: { files: [first, second] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(onFile).toHaveBeenCalledWith(first)
      expect(onFiles).toHaveBeenCalledWith([first, second])
    })

    it('accepts neither callback without throwing', () => {
      const { result } = renderHook(() => useFileDrop({}))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      act(() => {
        const evt = createDragEvent('drop', {
          target: dropZone,
          dataTransfer: { files: [new File(['a'], 'users.csv')] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(result.current.isDragging).toBe(false)
    })
  })

  describe('enabled false suppresses both callbacks', () => {
    it('does not report files when disabled', () => {
      const onFile = vi.fn()
      const onFiles = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile, onFiles, enabled: false }))

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      act(() => {
        const evt = createDragEvent('drop', {
          target: dropZone,
          dataTransfer: { files: [new File(['a'], 'users.csv')] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(onFile).not.toHaveBeenCalled()
      expect(onFiles).not.toHaveBeenCalled()
    })

    it('clears an active drag when it is disabled', () => {
      const onFiles = vi.fn()
      const { result, rerender } = renderHook(
        ({ enabled }) => useFileDrop({ onFiles, enabled }),
        { initialProps: { enabled: true } }
      )

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      act(() => {
        const evt = createDragEvent('dragover', {
          target: dropZone,
          dataTransfer: { dropEffect: '' },
        })
        globalThis.dispatchEvent(evt)
      })
      expect(result.current.isDragging).toBe(true)

      rerender({ enabled: false })

      expect(result.current.isDragging).toBe(false)
    })
  })

  describe('result shape', () => {
    it('returns only isDragging and dropZoneRef', () => {
      const { result } = renderHook(() => useFileDrop({ onFiles: vi.fn() }))

      expect(Object.keys(result.current).sort()).toEqual(['dropZoneRef', 'isDragging'])
    })
  })

  describe('onFile callback updates', () => {
    it('uses the latest onFile callback without re-registering listeners', () => {
      const onFile1 = vi.fn()
      const onFile2 = vi.fn()

      const { result, rerender } = renderHook(
        ({ onFile }) => useFileDrop({ onFile }),
        { initialProps: { onFile: onFile1 } }
      )

      Object.defineProperty(result.current.dropZoneRef, 'current', {
        value: dropZone,
        writable: true,
      })

      // Update callback
      rerender({ onFile: onFile2 })

      const file = new File(['content'], 'test.yaml')
      act(() => {
        const evt = createDragEvent('drop', {
          target: dropZone,
          dataTransfer: { files: [file] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(onFile1).not.toHaveBeenCalled()
      expect(onFile2).toHaveBeenCalledWith(file)
    })
  })

  describe('drop zone ref not set', () => {
    it('does not set isDragging when ref is null on dragover', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile }))

      // Don't set the ref - leave it null
      act(() => {
        const evt = createDragEvent('dragover', {
          target: document.body,
          dataTransfer: { dropEffect: '' },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(result.current.isDragging).toBe(false)
    })

    it('does not call onFile when ref is null on drop', () => {
      const onFile = vi.fn()
      renderHook(() => useFileDrop({ onFile }))

      // Don't set the ref
      const file = new File(['content'], 'test.yaml')
      act(() => {
        const evt = createDragEvent('drop', {
          target: document.body,
          dataTransfer: { files: [file] },
        })
        globalThis.dispatchEvent(evt)
      })

      expect(onFile).not.toHaveBeenCalled()
    })

    it('does not crash on dragleave when ref is null', () => {
      const onFile = vi.fn()
      const { result } = renderHook(() => useFileDrop({ onFile }))

      act(() => {
        const evt = createDragEvent('dragleave', {
          relatedTarget: document.body,
        })
        globalThis.dispatchEvent(evt)
      })

      // Dragging state should remain false (no crash, no state change)
      expect(result.current.isDragging).toBe(false)
    })
  })
})
