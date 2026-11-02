/**
 * Tests for the useRowViewMode hook.
 *
 * Per-row eye state (runtime vs definition view). Default ON (runtime). Toggle
 * persists across re-renders. The map clears only when runtimeValues
 * transitions from non-empty to empty - the same Reset signal that clears the
 * underlying useVariableUpdates values map.
 *
 * REQ-3.2.2.18: Live variable values display
 */

import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRowViewMode } from '@/features/workbench/common/variables/variable-manager-content/use-row-view-mode'

describe('useRowViewMode', () => {
  describe('defaults', () => {
    it('returns runtime ON for an unknown id (default)', () => {
      const { result } = renderHook(() => useRowViewMode(new Map()))
      expect(result.current.getMode('var-anything')).toBe('runtime')
    })

    it('returns runtime ON for any new id, even after another id was toggled off', () => {
      const { result } = renderHook(() => useRowViewMode(new Map()))
      act(() => result.current.toggleMode('var-1'))
      expect(result.current.getMode('var-1')).toBe('definition')
      // var-2 has never been toggled - should still default to runtime ON
      expect(result.current.getMode('var-2')).toBe('runtime')
    })
  })

  describe('toggle behavior', () => {
    it('toggleMode flips runtime <-> definition for a single id', () => {
      const { result } = renderHook(() => useRowViewMode(new Map()))
      expect(result.current.getMode('var-1')).toBe('runtime')

      act(() => result.current.toggleMode('var-1'))
      expect(result.current.getMode('var-1')).toBe('definition')

      act(() => result.current.toggleMode('var-1'))
      expect(result.current.getMode('var-1')).toBe('runtime')
    })

    it('toggle on one id does not affect other ids', () => {
      const { result } = renderHook(() => useRowViewMode(new Map()))
      act(() => result.current.toggleMode('var-a'))
      expect(result.current.getMode('var-a')).toBe('definition')
      expect(result.current.getMode('var-b')).toBe('runtime')
    })

    it('toggled state persists across re-renders that do not reset', () => {
      const initialMap = new Map<string, unknown>([['x', 1]])
      const { result, rerender } = renderHook(
        ({ runtimeValues }: { runtimeValues: Map<string, unknown> }) => useRowViewMode(runtimeValues),
        { initialProps: { runtimeValues: initialMap } },
      )

      act(() => result.current.toggleMode('var-1'))
      expect(result.current.getMode('var-1')).toBe('definition')

      // Re-render with a NEW map reference but still non-empty - state must survive
      rerender({ runtimeValues: new Map<string, unknown>([['x', 2], ['y', 'value']]) })
      expect(result.current.getMode('var-1')).toBe('definition')
    })
  })

  describe('reset semantics (driven by runtimeValues membership)', () => {
    it('clears the per-row map when runtimeValues transitions non-empty -> empty', () => {
      const populated = new Map<string, unknown>([['x', 1]])
      const { result, rerender } = renderHook(
        ({ runtimeValues }: { runtimeValues: Map<string, unknown> }) => useRowViewMode(runtimeValues),
        { initialProps: { runtimeValues: populated } },
      )

      act(() => result.current.toggleMode('var-1'))
      expect(result.current.getMode('var-1')).toBe('definition')

      // Reset: runtimeValues becomes empty (sessionId -> null in the underlying values hook)
      rerender({ runtimeValues: new Map() })
      expect(result.current.getMode('var-1')).toBe('runtime')
    })

    describe('with the session the values belong to', () => {
      function toggledRow(sessionId: string | null) {
        const hook = renderHook(
          (props: { runtimeValues: Map<string, unknown>; sessionId: string | null }) =>
            useRowViewMode(props.runtimeValues, props.sessionId),
          { initialProps: { runtimeValues: new Map<string, unknown>([['x', 1]]), sessionId } },
        )
        act(() => hook.result.current.toggleMode('var-1'))
        return hook
      }

      it('keeps the per-row map when the same session drops its last value', () => {
        const { result, rerender } = toggledRow('sess-1')

        rerender({ runtimeValues: new Map(), sessionId: 'sess-1' })

        expect(result.current.getMode('var-1')).toBe('definition')
      })

      it('clears the per-row map when the session ends (Reset)', () => {
        const { result, rerender } = toggledRow('sess-1')

        rerender({ runtimeValues: new Map(), sessionId: null })

        expect(result.current.getMode('var-1')).toBe('runtime')
      })

      it('clears the per-row map when a new session starts with no values (full Run)', () => {
        const { result, rerender } = toggledRow('sess-1')

        rerender({ runtimeValues: new Map(), sessionId: 'sess-2' })

        expect(result.current.getMode('var-1')).toBe('runtime')
      })

      it('clears the per-row map when the values of a new session are dropped later', () => {
        const { result, rerender } = toggledRow('sess-1')
        rerender({ runtimeValues: new Map([['x', 2]]), sessionId: 'sess-1' })
        rerender({ runtimeValues: new Map([['x', 2]]), sessionId: 'sess-2' })

        rerender({ runtimeValues: new Map(), sessionId: 'sess-3' })

        expect(result.current.getMode('var-1')).toBe('runtime')
      })
    })

    it('does NOT clear when runtimeValues transitions empty -> non-empty (first event arrives)', () => {
      const empty = new Map<string, unknown>()
      const { result, rerender } = renderHook(
        ({ runtimeValues }: { runtimeValues: Map<string, unknown> }) => useRowViewMode(runtimeValues),
        { initialProps: { runtimeValues: empty } },
      )

      act(() => result.current.toggleMode('var-1'))
      expect(result.current.getMode('var-1')).toBe('definition')

      // First event arrives - runtimeValues becomes populated. State must survive.
      rerender({ runtimeValues: new Map<string, unknown>([['x', 'new']]) })
      expect(result.current.getMode('var-1')).toBe('definition')
    })

    it('does NOT clear when runtimeValues stays non-empty across renders (mid-session updates)', () => {
      const map1 = new Map<string, unknown>([['x', 1]])
      const { result, rerender } = renderHook(
        ({ runtimeValues }: { runtimeValues: Map<string, unknown> }) => useRowViewMode(runtimeValues),
        { initialProps: { runtimeValues: map1 } },
      )

      act(() => result.current.toggleMode('var-1'))
      expect(result.current.getMode('var-1')).toBe('definition')

      // Mid-session: more values arrive. Eye state must persist.
      rerender({ runtimeValues: new Map<string, unknown>([['x', 1], ['y', 2]]) })
      expect(result.current.getMode('var-1')).toBe('definition')

      // Another mid-session update.
      rerender({ runtimeValues: new Map<string, unknown>([['x', 99], ['y', 100]]) })
      expect(result.current.getMode('var-1')).toBe('definition')
    })

    it('does NOT clear when runtimeValues stays empty across renders (no-op transitions)', () => {
      const empty = new Map<string, unknown>()
      const { result, rerender } = renderHook(
        ({ runtimeValues }: { runtimeValues: Map<string, unknown> }) => useRowViewMode(runtimeValues),
        { initialProps: { runtimeValues: empty } },
      )

      act(() => result.current.toggleMode('var-1'))
      expect(result.current.getMode('var-1')).toBe('definition')

      // Render again with another empty map.
      rerender({ runtimeValues: new Map() })
      expect(result.current.getMode('var-1')).toBe('definition')
    })
  })
})
