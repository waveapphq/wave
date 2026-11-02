import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePanelState } from '@/features/workbench/common/use-panel-state'

describe('usePanelState', () => {
  it('returns correct initial state', () => {
    const { result } = renderHook(() => usePanelState())

    expect(result.current.consoleCollapsed).toBe(true)
    expect(result.current.varManagerCollapsed).toBe(false)
    expect(result.current.consolePanelRef.current).toBeNull()
    expect(result.current.varManagerPanelRef.current).toBeNull()
  })

  describe('handleConsoleCollapsedChange', () => {
    it('sets consoleCollapsed to true and calls ref.collapse()', () => {
      const { result } = renderHook(() => usePanelState())

      const mockCollapse = vi.fn()
      const mockResize = vi.fn()
      ;(result.current.consolePanelRef as React.RefObject<unknown>).current = {
        collapse: mockCollapse,
        resize: mockResize,
      }

      act(() => {
        result.current.handleConsoleCollapsedChange(true)
      })

      expect(result.current.consoleCollapsed).toBe(true)
      expect(mockCollapse).toHaveBeenCalledOnce()
      expect(mockResize).not.toHaveBeenCalled()
    })

    it('sets consoleCollapsed to false and calls ref.resize(200)', () => {
      const { result } = renderHook(() => usePanelState())

      const mockCollapse = vi.fn()
      const mockResize = vi.fn()
      ;(result.current.consolePanelRef as React.RefObject<unknown>).current = {
        collapse: mockCollapse,
        resize: mockResize,
      }

      act(() => {
        result.current.handleConsoleCollapsedChange(false)
      })

      expect(result.current.consoleCollapsed).toBe(false)
      expect(mockResize).toHaveBeenCalledWith(200)
      expect(mockCollapse).not.toHaveBeenCalled()
    })
  })

  describe('handleVarManagerCollapsedChange', () => {
    it('sets varManagerCollapsed to true and calls ref.collapse()', () => {
      const { result } = renderHook(() => usePanelState())

      const mockCollapse = vi.fn()
      const mockResize = vi.fn()
      ;(result.current.varManagerPanelRef as React.RefObject<unknown>).current = {
        collapse: mockCollapse,
        resize: mockResize,
      }

      act(() => {
        result.current.handleVarManagerCollapsedChange(true)
      })

      expect(result.current.varManagerCollapsed).toBe(true)
      expect(mockCollapse).toHaveBeenCalledOnce()
      expect(mockResize).not.toHaveBeenCalled()
    })

    it('sets varManagerCollapsed to false and calls ref.resize(320)', () => {
      const { result } = renderHook(() => usePanelState())

      const mockCollapse = vi.fn()
      const mockResize = vi.fn()
      ;(result.current.varManagerPanelRef as React.RefObject<unknown>).current = {
        collapse: mockCollapse,
        resize: mockResize,
      }

      act(() => {
        result.current.handleVarManagerCollapsedChange(false)
      })

      expect(result.current.varManagerCollapsed).toBe(false)
      expect(mockResize).toHaveBeenCalledWith(320)
      expect(mockCollapse).not.toHaveBeenCalled()
    })
  })

  describe('refs not set (null)', () => {
    it('does not error when consolePanelRef is null', () => {
      const { result } = renderHook(() => usePanelState())

      expect(result.current.consolePanelRef.current).toBeNull()

      act(() => {
        result.current.handleConsoleCollapsedChange(true)
      })
      expect(result.current.consoleCollapsed).toBe(true)

      act(() => {
        result.current.handleConsoleCollapsedChange(false)
      })
      expect(result.current.consoleCollapsed).toBe(false)
    })

    it('does not error when varManagerPanelRef is null', () => {
      const { result } = renderHook(() => usePanelState())

      expect(result.current.varManagerPanelRef.current).toBeNull()

      act(() => {
        result.current.handleVarManagerCollapsedChange(true)
      })
      expect(result.current.varManagerCollapsed).toBe(true)

      act(() => {
        result.current.handleVarManagerCollapsedChange(false)
      })
      expect(result.current.varManagerCollapsed).toBe(false)
    })
  })
})
