/**
 * Variable Updates Tests
 *
 * TDD tests for real-time variable update functionality.
 * The hook receives events forwarded from useWorkbenchRun via registerVariableHandler.
 * No own WebSocket connection.
 *
 * Every `variable_changed` event lands in the runtime values map; the Reset
 * signal (sessionId -> null) clears it.
 *
 * REQ-3.1.3.12: Auto-refresh watched variables on change
 * REQ-3.2.2.18: Live variable values display
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import {
  useVariableUpdates,
  type UseVariableUpdatesOptions,
  type UseVariableUpdatesReturn,
} from '@/features/workbench/hooks/use-variable-updates'

// ===========================================================================
// Test Component Wrapper
// ===========================================================================

interface TestComponentProps {
  options: Omit<UseVariableUpdatesOptions, 'sessionId' | 'registerVariableHandler'> & {
    sessionId?: string | null
    registerVariableHandler?: (handler: ((payload: unknown) => void) | null) => void
  }
  onUpdate?: (result: UseVariableUpdatesReturn) => void
  /** Exposes the captured handler so tests can simulate events */
  onHandlerCaptured?: (handler: ((payload: unknown) => void) | null) => void
}

function TestComponent({ options, onUpdate, onHandlerCaptured }: TestComponentProps) {
  const registerVariableHandler = options.registerVariableHandler ?? ((handler) => {
    onHandlerCaptured?.(handler)
  })

  const result = useVariableUpdates({
    ...options,
    sessionId: 'sessionId' in options ? options.sessionId! : 'test-session',
    registerVariableHandler,
  })
  onUpdate?.(result)
  return (
    <div>
      <span data-testid="values">{JSON.stringify(Array.from(result.values.entries()))}</span>
      <span data-testid="changed">{JSON.stringify(Array.from(result.recentlyChangedPaths))}</span>
    </div>
  )
}

// ===========================================================================
// Test Suite
// ===========================================================================

describe('useVariableUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  // =========================================================================
  // Handler Registration
  // =========================================================================

  describe('Handler Registration', () => {
    it('registers a handler on mount via registerVariableHandler', () => {
      const registerVariableHandler = vi.fn()

      render(
        <TestComponent
          options={{ registerVariableHandler }}
        />
      )

      // Should have been called with a function (the event handler)
      expect(registerVariableHandler).toHaveBeenCalledWith(expect.any(Function))
    })

    it('deregisters handler on unmount by passing null', () => {
      const registerVariableHandler = vi.fn()

      const { unmount } = render(
        <TestComponent
          options={{ registerVariableHandler }}
        />
      )

      registerVariableHandler.mockClear()

      unmount()

      expect(registerVariableHandler).toHaveBeenCalledWith(null)
    })
  })

  // =========================================================================
  // Receiving Variable Updates
  // =========================================================================

  describe('Receiving Updates', () => {
    it('updates value when variable_changed event is forwarded', () => {
      let handler: ((payload: unknown) => void) | null = null

      render(
        <TestComponent
          options={{}}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      expect(handler).not.toBeNull()

      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: 'new value',
          var_type: 'string',
          scope: 'test',
        })
      })

      expect(screen.getByTestId('values')).toHaveTextContent('"new value"')
    })

    it('calls onVariableChange callback', () => {
      const onVariableChange = vi.fn()
      let handler: ((payload: unknown) => void) | null = null

      render(
        <TestComponent
          options={{ onVariableChange }}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: 42,
          var_type: 'integer',
          scope: 'test',
        })
      })

      expect(onVariableChange).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'v1',
          value: 42,
          type: 'integer',
        })
      )
      // Verify timestamp is a number
      const call = onVariableChange.mock.calls[0][0]
      expect(typeof call.timestamp).toBe('number')
    })

    it('handles scalar value updates', () => {
      let handler: ((payload: unknown) => void) | null = null

      render(
        <TestComponent
          options={{}}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: 123.45,
          var_type: 'float',
          scope: 'test',
        })
      })

      expect(screen.getByTestId('values')).toHaveTextContent('123.45')
    })

    it('handles array summary updates', () => {
      let handler: ((payload: unknown) => void) | null = null

      render(
        <TestComponent
          options={{}}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: { count: 25, changed: true },
          var_type: 'array',
          scope: 'test',
        })
      })

      expect(screen.getByTestId('values')).toHaveTextContent('"count":25')
    })

    it('handles map summary updates', () => {
      let handler: ((payload: unknown) => void) | null = null

      render(
        <TestComponent
          options={{}}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: { count: 10, changed: true },
          var_type: 'map',
          scope: 'test',
        })
      })

      expect(screen.getByTestId('values')).toHaveTextContent('"count":10')
    })

    it('handles table summary updates', () => {
      let handler: ((payload: unknown) => void) | null = null

      render(
        <TestComponent
          options={{}}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: { rows: 5, cols: 3, changed: true },
          var_type: 'table',
          scope: 'test',
        })
      })

      expect(screen.getByTestId('values')).toHaveTextContent('"rows":5')
      expect(screen.getByTestId('values')).toHaveTextContent('"cols":3')
    })

    it('preserves values when sessionId transitions from null to first session', () => {
      let handler: ((payload: unknown) => void) | null = null

      const { rerender } = render(
        <TestComponent
          options={{ sessionId: null }}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      // Events arrive while sessionId is still null (before API response)
      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: 'runtime-value',
          var_type: 'string',
          scope: 'test',
        })
      })

      expect(screen.getByTestId('values')).toHaveTextContent('runtime-value')

      // sessionId transitions from null to first session (API response arrived)
      // This must NOT clear values - they were collected for this session
      rerender(
        <TestComponent
          options={{ sessionId: 'session-1' }}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      expect(screen.getByTestId('values')).toHaveTextContent('runtime-value')
    })

    it('preserves runtime values when sessionId changes (incremental dev: ad-hoc + Run All keep prior values)', () => {
      let handler: ((payload: unknown) => void) | null = null

      const { rerender } = render(
        <TestComponent
          options={{ sessionId: 'session-A' }}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: 'runtime-value',
          var_type: 'string',
          scope: 'test',
        })
      })

      expect(screen.getByTestId('values')).toHaveTextContent('runtime-value')

      rerender(
        <TestComponent
          options={{ sessionId: 'session-B' }}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      expect(screen.getByTestId('values')).toHaveTextContent('runtime-value')
    })

    it('clears runtime values when sessionId resets to null (Reset)', () => {
      let handler: ((payload: unknown) => void) | null = null

      const { rerender } = render(
        <TestComponent
          options={{ sessionId: 'session-A' }}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: 'runtime-value',
          var_type: 'string',
          scope: 'test',
        })
      })

      expect(screen.getByTestId('values')).toHaveTextContent('runtime-value')

      rerender(
        <TestComponent
          options={{ sessionId: null }}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      expect(screen.getByTestId('values')).toHaveTextContent('[]')
    })

    it('records every variable_changed event (no watchedPaths filter; full panel monitors everything)', () => {
      let handler: ((payload: unknown) => void) | null = null

      render(
        <TestComponent
          options={{}}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: 'first',
          var_type: 'string',
          scope: 'test',
        })
        handler!({
          type: 'variable_changed',
          path: 'v2',
          value: 'second',
          var_type: 'string',
          scope: 'test',
        })
        handler!({
          type: 'variable_changed',
          path: 'v3',
          value: 'third',
          var_type: 'string',
          scope: 'test',
        })
      })

      // All three events must appear in the values map.
      const values = screen.getByTestId('values').textContent ?? ''
      expect(values).toContain('"v1"')
      expect(values).toContain('"first"')
      expect(values).toContain('"v2"')
      expect(values).toContain('"second"')
      expect(values).toContain('"v3"')
      expect(values).toContain('"third"')
    })

    it('ignores events with non-variable_changed type', () => {
      let handler: ((payload: unknown) => void) | null = null

      render(
        <TestComponent
          options={{}}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      act(() => {
        handler!({
          type: 'block_status_changed',
          block_id: 'b1',
          block_name: 'Block 1',
          status: 'running',
        })
      })

      // Values should remain empty
      expect(screen.getByTestId('values')).toHaveTextContent('[]')
    })
  })

  // =========================================================================
  // Forgetting a value (a re-armed source holds none until it is evaluated again)
  // =========================================================================

  describe('Forgetting a Value', () => {
    function mounted() {
      const captured: {
        handler: ((payload: unknown) => void) | null
        latest: UseVariableUpdatesReturn | null
      } = { handler: null, latest: null }
      render(
        <TestComponent
          options={{}}
          onHandlerCaptured={(h) => { captured.handler = h }}
          onUpdate={(result) => { captured.latest = result }}
        />
      )
      return captured
    }

    function push(captured: ReturnType<typeof mounted>, path: string, value: unknown) {
      act(() => {
        captured.handler!({ type: 'variable_changed', path, value, var_type: 'string' })
      })
    }

    it('drops the value of the named variable and keeps the others', () => {
      const captured = mounted()
      push(captured, 'url', 'http://b')
      push(captured, 'host', 'b')

      act(() => captured.latest!.forget('url'))

      expect(screen.getByTestId('values')).toHaveTextContent('[["host","b"]]')
    })

    it('shows the value again once a run gives the variable one', () => {
      const captured = mounted()
      push(captured, 'url', 'http://b')
      act(() => captured.latest!.forget('url'))

      push(captured, 'url', 'https://b')

      expect(screen.getByTestId('values')).toHaveTextContent('[["url","https://b"]]')
    })

    it('keeps the same values map when the variable holds no value', () => {
      const captured = mounted()
      push(captured, 'host', 'b')
      const values = captured.latest!.values

      act(() => captured.latest!.forget('url'))

      expect(captured.latest!.values).toBe(values)
    })
  })

  // =========================================================================
  // Recently Changed Tracking (for highlight animation)
  // =========================================================================

  describe('Recently Changed Tracking', () => {
    it('adds variable to recentlyChangedPaths on update', () => {
      let handler: ((payload: unknown) => void) | null = null

      render(
        <TestComponent
          options={{}}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: 'updated',
          var_type: 'string',
          scope: 'test',
        })
      })

      expect(screen.getByTestId('changed')).toHaveTextContent('v1')
    })

    it('removes variable from recentlyChangedPaths after 300ms', () => {
      vi.useFakeTimers()

      let handler: ((payload: unknown) => void) | null = null

      render(
        <TestComponent
          options={{}}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: 'updated',
          var_type: 'string',
          scope: 'test',
        })
      })

      expect(screen.getByTestId('changed')).toHaveTextContent('v1')

      // Advance time by 300ms (animation duration)
      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(screen.getByTestId('changed')).not.toHaveTextContent('v1')

      vi.useRealTimers()
    })

    it('handles rapid updates to same variable (debounces timeout)', () => {
      vi.useFakeTimers()

      let handler: ((payload: unknown) => void) | null = null

      render(
        <TestComponent
          options={{}}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      // First update to v1
      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: 'first update',
          var_type: 'string',
          scope: 'test',
        })
      })

      expect(screen.getByTestId('changed')).toHaveTextContent('v1')

      // Advance time by 150ms (half the duration)
      act(() => {
        vi.advanceTimersByTime(150)
      })

      // v1 should still be in changed list
      expect(screen.getByTestId('changed')).toHaveTextContent('v1')

      // Second update to SAME path (v1) - this should clear the existing timeout
      // and set a new one
      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: 'second update',
          var_type: 'string',
          scope: 'test',
        })
      })

      // Still in changed list
      expect(screen.getByTestId('changed')).toHaveTextContent('v1')

      // Advance by 200ms - if the timeout wasn't reset, this would remove v1
      // But since we sent a second update, the timeout was reset
      act(() => {
        vi.advanceTimersByTime(200)
      })

      // v1 should still be in changed list because timeout was reset
      expect(screen.getByTestId('changed')).toHaveTextContent('v1')

      // Now advance the full 300ms from the second update
      act(() => {
        vi.advanceTimersByTime(100)
      })

      // Now v1 should be removed
      expect(screen.getByTestId('changed')).not.toHaveTextContent('v1')

      vi.useRealTimers()
    })

    it('handles multiple rapid changes correctly', () => {
      let handler: ((payload: unknown) => void) | null = null

      render(
        <TestComponent
          options={{}}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      // Rapid updates
      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: 'update1',
          var_type: 'string',
          scope: 'test',
        })
        handler!({
          type: 'variable_changed',
          path: 'v2',
          value: 'update2',
          var_type: 'string',
          scope: 'test',
        })
      })

      expect(screen.getByTestId('changed')).toHaveTextContent('v1')
      expect(screen.getByTestId('changed')).toHaveTextContent('v2')
    })

    it('clears recentlyChangedPaths only when sessionId resets to null (Reset)', () => {
      vi.useFakeTimers()

      let handler: ((payload: unknown) => void) | null = null

      const { rerender } = render(
        <TestComponent
          options={{ sessionId: 'session-A' }}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: 'updated',
          var_type: 'string',
          scope: 'test',
        })
      })

      expect(screen.getByTestId('changed')).toHaveTextContent('v1')

      // Switching to another live session preserves the recently-changed
      // paths so the watcher does not flicker the highlight off mid ad-hoc.
      rerender(
        <TestComponent
          options={{ sessionId: 'session-B' }}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      expect(screen.getByTestId('changed')).toHaveTextContent('v1')

      // Reset (sessionId -> null) clears.
      rerender(
        <TestComponent
          options={{ sessionId: null }}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      expect(screen.getByTestId('changed')).toHaveTextContent('[]')

      vi.useRealTimers()
    })
  })

  // =========================================================================
  // Live values per scope: a Function value never lands on a same-named
  // Test variable (REQ-3.1.3.12, REQ-3.2.1.6)
  // =========================================================================

  describe('Scoped Values', () => {
    function mounted() {
      const captured: {
        handler: ((payload: unknown) => void) | null
        latest: UseVariableUpdatesReturn | null
      } = { handler: null, latest: null }
      const view = render(
        <TestComponent
          options={{ sessionId: 'session-A' }}
          onHandlerCaptured={(h) => { captured.handler = h }}
          onUpdate={(result) => { captured.latest = result }}
        />
      )
      const resetSession = () =>
        view.rerender(
          <TestComponent
            options={{ sessionId: null }}
            onHandlerCaptured={(h) => { captured.handler = h }}
            onUpdate={(result) => { captured.latest = result }}
          />
        )
      return { captured, resetSession }
    }

    function push(
      captured: ReturnType<typeof mounted>['captured'],
      path: string,
      value: unknown,
      functionPath: string[],
    ) {
      act(() => {
        captured.handler!({
          type: 'variable_changed',
          path,
          value,
          var_type: 'integer',
          scope: functionPath.length === 0 ? 'test' : 'function',
          function_path: functionPath,
        })
      })
    }

    /** Entries held for `name` in a Function scope: keyed by a scope prefix + the name, never the bare name. */
    function functionEntries(values: Map<string, unknown>, name: string): Array<[string, unknown]> {
      return [...values.entries()].filter(([key]) => key !== name && key.endsWith(name))
    }

    it('keeps a Function local value apart from a same-named Test variable', () => {
      const { captured } = mounted()
      push(captured, 'loc_n', 1, [])
      push(captured, 'loc_n', 5, ['fn-1'])

      const values = captured.latest!.values
      expect(values.get('loc_n')).toBe(1)
      expect(values.size).toBe(2)
      expect(functionEntries(values, 'loc_n').map(([, value]) => value)).toEqual([5])
    })

    it('updates only the Function entry when that Function pushes again', () => {
      const { captured } = mounted()
      push(captured, 'loc_n', 1, [])
      push(captured, 'loc_n', 5, ['fn-1'])
      push(captured, 'loc_n', 6, ['fn-1'])

      const values = captured.latest!.values
      expect(values.get('loc_n')).toBe(1)
      expect(values.size).toBe(2)
      expect(functionEntries(values, 'loc_n').map(([, value]) => value)).toEqual([6])
    })

    it('keeps the Test value when only a Function pushes the name', () => {
      const { captured } = mounted()
      push(captured, 'loc_n', 5, ['fn-1'])

      expect(captured.latest!.values.has('loc_n')).toBe(false)
      expect(functionEntries(captured.latest!.values, 'loc_n').map(([, value]) => value)).toEqual([5])
    })

    it('keeps two Function instances apart', () => {
      const { captured } = mounted()
      push(captured, 'loc_n', 5, ['fn-1'])
      push(captured, 'loc_n', 7, ['fn-2'])

      const entries = functionEntries(captured.latest!.values, 'loc_n')
      expect(entries.map(([, value]) => value)).toEqual([5, 7])
      expect(new Set(entries.map(([key]) => key)).size).toBe(2)
    })

    it('keeps a nested Function apart from the Function that holds it', () => {
      const { captured } = mounted()
      push(captured, 'loc_n', 5, ['fn-1'])
      push(captured, 'loc_n', 8, ['fn-1', 'fn-2'])

      const entries = functionEntries(captured.latest!.values, 'loc_n')
      expect(entries.map(([, value]) => value)).toEqual([5, 8])
      expect(new Set(entries.map(([key]) => key)).size).toBe(2)
    })

    it('lands a push with an empty function_path on the Test variable', () => {
      const { captured } = mounted()
      push(captured, 'loc_n', 3, [])

      expect(captured.latest!.values.get('loc_n')).toBe(3)
      expect(captured.latest!.values.size).toBe(1)
    })

    it('keys a value by its function_path, so the library View Function, pushed with an empty path, lands on its own row', () => {
      const { captured } = mounted()
      act(() => {
        captured.handler!({
          type: 'variable_changed',
          path: 'loc_n',
          value: 4,
          var_type: 'integer',
          scope: 'function',
          function_path: [],
        })
      })

      expect(captured.latest!.values.get('loc_n')).toBe(4)
      expect(captured.latest!.values.size).toBe(1)
    })

    it('marks only the Function entry as recently changed', () => {
      const { captured } = mounted()
      push(captured, 'loc_n', 5, ['fn-1'])

      const changed = [...captured.latest!.recentlyChangedPaths]
      expect(changed).toHaveLength(1)
      expect(changed[0]).not.toBe('loc_n')
      expect(changed[0].endsWith('loc_n')).toBe(true)
    })

    it('forgetting the Test variable keeps the Function value', () => {
      const { captured } = mounted()
      push(captured, 'loc_n', 1, [])
      push(captured, 'loc_n', 5, ['fn-1'])

      act(() => captured.latest!.forget('loc_n'))

      const values = captured.latest!.values
      expect(values.has('loc_n')).toBe(false)
      expect(functionEntries(values, 'loc_n').map(([, value]) => value)).toEqual([5])
    })

    it('Reset clears the values of every scope', () => {
      const { captured, resetSession } = mounted()
      push(captured, 'loc_n', 1, [])
      push(captured, 'loc_n', 5, ['fn-1'])

      resetSession()

      expect(captured.latest!.values.size).toBe(0)
    })
  })

  // =========================================================================
  // Cleanup
  // =========================================================================

  describe('Cleanup', () => {
    it('clears all timeouts on unmount', () => {
      vi.useFakeTimers()
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

      let handler: ((payload: unknown) => void) | null = null

      const { unmount } = render(
        <TestComponent
          options={{}}
          onHandlerCaptured={(h) => { handler = h }}
        />
      )

      // Create some pending timeouts by sending variable updates
      act(() => {
        handler!({
          type: 'variable_changed',
          path: 'v1',
          value: 'val1',
          var_type: 'string',
          scope: 'test',
        })
        handler!({
          type: 'variable_changed',
          path: 'v2',
          value: 'val2',
          var_type: 'string',
          scope: 'test',
        })
      })

      clearTimeoutSpy.mockClear()

      unmount()

      // Should have cleared both timeouts
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(2)

      clearTimeoutSpy.mockRestore()
      vi.useRealTimers()
    })
  })
})
