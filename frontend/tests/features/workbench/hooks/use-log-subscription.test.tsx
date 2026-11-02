/**
 * useLogSubscription Hook Tests - REQ-5.2.1.4
 *
 * Tests for the hook that manages WebSocket subscription to log events,
 * handling real-time log streaming with level filtering.
 *
 * Contract:
 * - Topic pattern: `log:{session_id}`
 * - Subscribe with level parameter for server-side filtering
 * - Handle level switch protocol
 * - Request historical logs on level change
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { LOG_LEVELS, type LogLevel } from '@/lib/log-levels'

// Log entry type
interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  message: string
  source: string
  blockId?: string
  sequence: number
}

// Mock WebSocket store
const mockSubscribe = vi.fn()
const mockUnsubscribe = vi.fn()
const mockConnect = vi.fn().mockResolvedValue(undefined)

vi.mock('@/features/workbench/stores/websocket-store', () => ({
  useWebSocketStore: vi.fn(() => ({
    isConnected: true,
    subscribe: mockSubscribe,
    connect: mockConnect,
  })),
}))

// Mock log store
const mockAddEntry = vi.fn()
const mockAddEntries = vi.fn()
const mockClearLogs = vi.fn()
const mockPrependHistoricalEntries = vi.fn()
const mockSetPaginationLoading = vi.fn()
const mockSetPaginationHasMore = vi.fn()
const mockSetPaginationCursor = vi.fn()

function storeState(pagination?: { isLoading: boolean; hasMore: boolean; cursor: string | null }) {
  return {
    entries: [],
    minLevel: 'INFO',
    sessionId: 'session-123',
    pagination,
    addEntry: mockAddEntry,
    addEntries: mockAddEntries,
    clearLogs: mockClearLogs,
    prependHistoricalEntries: mockPrependHistoricalEntries,
    setPaginationLoading: mockSetPaginationLoading,
    setPaginationHasMore: mockSetPaginationHasMore,
    setPaginationCursor: mockSetPaginationCursor,
  }
}

function storeSelector(pagination?: { isLoading: boolean; hasMore: boolean; cursor: string | null }) {
  return (selector: unknown) => {
    const state = storeState(pagination)
    return typeof selector === 'function' ? selector(state) : state
  }
}

vi.mock('../../../../src/features/workbench/stores/log-store', () => ({
  useLogStore: vi.fn(),
}))

describe('useLogSubscription Hook', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.mocked(
      await import('../../../../src/features/workbench/stores/log-store')
    ).useLogStore.mockImplementation(storeSelector() as never)
    mockSubscribe.mockReturnValue({ topic: 'log:session-123', unsubscribe: mockUnsubscribe })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
  })

  describe('Subscription Lifecycle', () => {
    it('subscribes to log topic when mounted with sessionId', async () => {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')

      renderHook(() => useLogSubscription('session-123', 'INFO'))

      expect(mockSubscribe).toHaveBeenCalledWith(
        'log:session-123',
        expect.any(Function),
        expect.objectContaining({ level: 'INFO' })
      )
    })

    it('does not subscribe when sessionId is null', async () => {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')

      renderHook(() => useLogSubscription(null, 'INFO'))

      expect(mockSubscribe).not.toHaveBeenCalled()
    })

    it('unsubscribes when unmounted', async () => {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')

      const { unmount } = renderHook(() => useLogSubscription('session-123', 'INFO'))

      unmount()

      expect(mockUnsubscribe).toHaveBeenCalled()
    })

    it('unsubscribes when sessionId changes', async () => {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')

      const { rerender } = renderHook(
        ({ sessionId, level }) => useLogSubscription(sessionId, level),
        { initialProps: { sessionId: 'session-123', level: 'INFO' as LogLevel } }
      )

      rerender({ sessionId: 'session-456', level: 'INFO' as LogLevel })

      expect(mockUnsubscribe).toHaveBeenCalled()
      expect(mockSubscribe).toHaveBeenCalledWith(
        'log:session-456',
        expect.any(Function),
        expect.any(Object)
      )
    })
  })

  describe('Log Event Handling', () => {
    it('adds received log entry to store', async () => {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')
      // Handler receives payload directly from websocket-client, not wrapped in envelope
      let eventHandler: (payload: LogEntry) => void = () => {}

      mockSubscribe.mockImplementation((topic, handler) => {
        eventHandler = handler
        return { topic, unsubscribe: mockUnsubscribe }
      })

      renderHook(() => useLogSubscription('session-123', 'INFO'))

      const logEntry: LogEntry = {
        id: 'log-1',
        timestamp: '2025-01-22T10:30:45.123Z',
        level: 'INFO',
        message: 'Test message',
        source: 'HTTP Client',
        sequence: 1,
      }

      act(() => {
        // websocket-client passes payload directly, not wrapped
        eventHandler(logEntry)
      })

      expect(mockAddEntry).toHaveBeenCalledWith(logEntry)
    })

    it('handles batch log events', async () => {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')
      // Handler receives payload directly from websocket-client
      let eventHandler: (payload: LogEntry[]) => void = () => {}

      mockSubscribe.mockImplementation((topic, handler) => {
        eventHandler = handler
        return { topic, unsubscribe: mockUnsubscribe }
      })

      renderHook(() => useLogSubscription('session-123', 'INFO'))

      const logEntries: LogEntry[] = [
        { id: 'log-1', timestamp: '', level: 'INFO', message: 'First', source: '', sequence: 1 },
        { id: 'log-2', timestamp: '', level: 'WARN', message: 'Second', source: '', sequence: 2 },
      ]

      act(() => {
        // websocket-client passes array directly for batches
        eventHandler(logEntries)
      })

      expect(mockAddEntries).toHaveBeenCalledWith(logEntries)
    })

    it('ignores non-log payloads with unrecognized structure', async () => {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')
      // Handler receives payload directly from websocket-client
      let eventHandler: (payload: unknown) => void = () => {}
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      mockSubscribe.mockImplementation((topic, handler) => {
        eventHandler = handler
        return { topic, unsubscribe: mockUnsubscribe }
      })

      renderHook(() => useLogSubscription('session-123', 'INFO'))

      act(() => {
        // Non-log payload (not a LogEntry, array, or history response)
        eventHandler({ unrecognizedField: 'value' })
      })

      // Nothing reaches the console panel; the frame is recorded for developers.
      expect(mockAddEntry).not.toHaveBeenCalled()
      expect(consoleWarn).toHaveBeenCalled()
      consoleWarn.mockRestore()
    })
  })

  describe('Unreadable Frames', () => {
    async function captureHandler(): Promise<(payload: unknown) => void> {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')
      let eventHandler: (payload: unknown) => void = () => {}

      mockSubscribe.mockImplementation((topic, handler) => {
        eventHandler = handler
        return { topic, unsubscribe: mockUnsubscribe }
      })

      renderHook(() => useLogSubscription('session-123', 'INFO'))

      return (payload: unknown) => {
        act(() => {
          eventHandler(payload)
        })
      }
    }

    const readable = {
      id: 'log-1',
      timestamp: '2026-01-22T10:30:45.123Z',
      level: 'INFO',
      message: 'Test message',
      source: 'HTTP Client',
    }

    const unreadableFrames: [string, unknown][] = [
      ['null', null],
      ['undefined', undefined],
      ['a string', 'boom'],
      ['a number', 42],
      ['a boolean', true],
      ['an entry with an empty id', { ...readable, id: '' }],
      ['an entry with no timestamp', { ...readable, timestamp: undefined }],
      ['an entry with no message', { ...readable, message: undefined }],
      ['an entry with no source', { ...readable, source: undefined }],
      ['an entry with no level', { ...readable, level: undefined }],
      ['an entry with an unknown level', { ...readable, level: 'TRACE' }],
    ]

    for (const [label, payload] of unreadableFrames) {
      it(`drops ${label} and records it for developers`, async () => {
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const deliver = await captureHandler()

        expect(() => deliver(payload)).not.toThrow()

        expect(mockAddEntry).not.toHaveBeenCalled()
        expect(mockAddEntries).not.toHaveBeenCalled()
        expect(consoleWarn).toHaveBeenCalled()
        consoleWarn.mockRestore()
      })
    }

    it('keeps a frame at every level the console renders', async () => {
      // Driven by the canonical level list, which is keyed by the level type, so a
      // level added to the type reaches this loop instead of being silently skipped.
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const deliver = await captureHandler()

      for (const level of LOG_LEVELS) {
        const entry = { ...readable, id: `log-${level}`, level }
        deliver(entry)
        expect(mockAddEntry).toHaveBeenCalledWith(entry)
      }

      expect(mockAddEntry).toHaveBeenCalledTimes(LOG_LEVELS.length)
      expect(consoleWarn).not.toHaveBeenCalled()
      consoleWarn.mockRestore()
    })

    it('keeps the readable lines of a batch and records the rest', async () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const deliver = await captureHandler()

      deliver([readable, { unrecognizedField: 'value' }])

      expect(mockAddEntries).toHaveBeenCalledWith([readable])
      expect(consoleWarn).toHaveBeenCalled()
      consoleWarn.mockRestore()
    })

    it('releases the page-back wait even when the page carries no readable line', async () => {
      // Dropping the whole page would leave the console spinning on "Loading".
      await mockPageRequestInFlight()
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const deliver = await captureHandler()

      deliver({ entries: [{ unrecognizedField: 'value' }], hasMore: true, cursor: 'cursor-abc' })

      expect(mockPrependHistoricalEntries).toHaveBeenCalledWith([])
      expect(mockSetPaginationHasMore).toHaveBeenCalledWith(true)
      expect(mockSetPaginationCursor).toHaveBeenCalledWith('cursor-abc')
      expect(mockSetPaginationLoading).toHaveBeenCalledWith(false)
      expect(consoleWarn).toHaveBeenCalled()
      consoleWarn.mockRestore()
    })

    it('keeps a numeric page cursor as sent', async () => {
      // An ephemeral session pages by sequence number and the backend only
      // accepts that cursor back as a number.
      await mockPageRequestInFlight()
      const deliver = await captureHandler()

      deliver({ entries: [readable], hasMore: true, cursor: 42 })

      expect(mockPrependHistoricalEntries).toHaveBeenCalledWith([readable])
      expect(mockSetPaginationCursor).toHaveBeenCalledWith(42)
    })

    it('treats a page with no hasMore flag as the end of the history', async () => {
      await mockPageRequestInFlight()
      const deliver = await captureHandler()

      deliver({ entries: [readable] })

      expect(mockSetPaginationHasMore).toHaveBeenCalledWith(false)
      expect(mockSetPaginationCursor).toHaveBeenCalledWith(null)
    })
  })

  describe('Level Change Protocol', () => {
    it('resubscribes with new level when level changes', async () => {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')

      const { rerender } = renderHook(
        ({ sessionId, level }) => useLogSubscription(sessionId, level),
        { initialProps: { sessionId: 'session-123', level: 'INFO' as LogLevel } }
      )

      rerender({ sessionId: 'session-123', level: 'DEBUG' as LogLevel })

      expect(mockUnsubscribe).toHaveBeenCalled()
      expect(mockSubscribe).toHaveBeenLastCalledWith(
        'log:session-123',
        expect.any(Function),
        expect.objectContaining({ level: 'DEBUG' })
      )
    })

    it('does not clear logs on level change (filtering is client-side)', async () => {
      // The hook does not clear logs on level change: filtering is client-side
      // via getFilteredEntries()
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')

      const { rerender } = renderHook(
        ({ sessionId, level }) => useLogSubscription(sessionId, level),
        { initialProps: { sessionId: 'session-123', level: 'INFO' as LogLevel } }
      )

      mockClearLogs.mockClear()

      rerender({ sessionId: 'session-123', level: 'WARN' as LogLevel })

      // No log clearing on level change
      expect(mockClearLogs).not.toHaveBeenCalled()
    })
  })


/** Model a page-back in flight: a page response only arrives after a request. */
async function mockPageRequestInFlight(): Promise<void> {
  vi.mocked(
    await import('../../../../src/features/workbench/stores/log-store')
  ).useLogStore.mockImplementation(
    storeSelector({ isLoading: true, hasMore: true, cursor: 'old' }) as never
  )
}

  describe('Historical Log Loading', () => {
    it('handles historical log page events', async () => {
      await mockPageRequestInFlight()
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')
      // Handler receives payload directly from websocket-client
      let eventHandler: (payload: { entries: LogEntry[]; hasMore: boolean; cursor?: string }) => void = () => {}

      mockSubscribe.mockImplementation((topic, handler) => {
        eventHandler = handler
        return { topic, unsubscribe: mockUnsubscribe }
      })

      renderHook(() => useLogSubscription('session-123', 'INFO'))

      const historicalEntries: LogEntry[] = [
        { id: 'log-old-1', timestamp: '', level: 'INFO', message: 'Old', source: '', sequence: 0 },
      ]

      act(() => {
        // websocket-client passes history response directly
        eventHandler({
          entries: historicalEntries,
          hasMore: true,
          cursor: 'cursor-abc',
        })
      })

      expect(mockPrependHistoricalEntries).toHaveBeenCalledWith(historicalEntries)
      expect(mockSetPaginationHasMore).toHaveBeenCalledWith(true)
      expect(mockSetPaginationCursor).toHaveBeenCalledWith('cursor-abc')
    })

    it('merges an unsolicited subscribe-time page in log order', async () => {
      // A tab that subscribes mid-run may already hold live lines, so the
      // page the subscribe delivers cannot simply prepend.
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')
      let eventHandler: (payload: { entries: LogEntry[]; hasMore: boolean }) => void = () => {}

      mockSubscribe.mockImplementation((topic, handler) => {
        eventHandler = handler
        return { topic, unsubscribe: mockUnsubscribe }
      })

      renderHook(() => useLogSubscription('session-123', 'INFO'))

      const backlog: LogEntry[] = [
        { id: 'log-1', timestamp: '', level: 'INFO', message: 'first', source: '', sequence: 0 },
      ]

      act(() => {
        eventHandler({ entries: backlog, hasMore: false })
      })

      expect(mockAddEntries).toHaveBeenCalledWith(backlog)
      expect(mockPrependHistoricalEntries).not.toHaveBeenCalled()
    })

    it('sets hasMore to false when no more history', async () => {
      await mockPageRequestInFlight()
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')
      // Handler receives payload directly from websocket-client
      let eventHandler: (payload: { entries: LogEntry[]; hasMore: boolean }) => void = () => {}

      mockSubscribe.mockImplementation((topic, handler) => {
        eventHandler = handler
        return { topic, unsubscribe: mockUnsubscribe }
      })

      renderHook(() => useLogSubscription('session-123', 'INFO'))

      act(() => {
        // websocket-client passes history response directly
        eventHandler({
          entries: [],
          hasMore: false,
        })
      })

      expect(mockSetPaginationHasMore).toHaveBeenCalledWith(false)
    })
  })

  describe('Request Historical Logs', () => {
    it('returns requestMore function', async () => {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')

      const { result } = renderHook(() => useLogSubscription('session-123', 'INFO'))

      expect(result.current.requestMore).toBeDefined()
      expect(typeof result.current.requestMore).toBe('function')
    })

    it('requestMore sends request through WebSocket', async () => {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')
      const mockSend = vi.fn()

      mockSubscribe.mockImplementation((topic, _handler, _options) => {
        return {
          topic,
          unsubscribe: mockUnsubscribe,
          send: mockSend,
        }
      })

      const { result } = renderHook(() => useLogSubscription('session-123', 'INFO'))

      act(() => {
        result.current.requestMore('cursor-123')
      })

      // Sets loading state
      expect(mockSetPaginationLoading).toHaveBeenCalledWith(true)
    })

    it('requestMore requests ~100 entries per page', async () => {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')
      const mockSend = vi.fn()
      // Local constant matching the module-private PAGE_SIZE
      const PAGE_SIZE = 100

      mockSubscribe.mockImplementation((topic, _handler, _options) => {
        return {
          topic,
          unsubscribe: mockUnsubscribe,
          send: mockSend,
        }
      })

      const { result } = renderHook(() => useLogSubscription('session-123', 'INFO'))

      act(() => {
        result.current.requestMore('cursor-123')
      })

      // Should request PAGE_SIZE entries (100)
      expect(PAGE_SIZE).toBe(100)
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'request_history',
          pageSize: 100,
        })
      )
    })

    it('requestMore includes the log: topic so the BE router dispatches the request', async () => {
      // Without this field the backend's message router falls through the
      // `request_history` case silently and the console gets stuck on
      // "Loading…" as the user scrolls up.
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')
      const mockSend = vi.fn()

      mockSubscribe.mockImplementation((topic, _handler, _options) => ({
        topic,
        unsubscribe: mockUnsubscribe,
        send: mockSend,
      }))

      const { result } = renderHook(() => useLogSubscription('session-xyz', 'INFO'))

      act(() => {
        result.current.requestMore('cursor-50')
      })

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'request_history',
          topic: 'log:session-xyz',
          cursor: 'cursor-50',
          pageSize: 100,
        })
      )
    })

    it('requestMore releases the loading flag when the subscription has no send channel', async () => {
      // Real Subscription objects from the ws client expose send, but the
      // no-op subscription returned when the store is not yet connected
      // does not. Loading must not stay pinned on.
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')

      mockSubscribe.mockImplementation((topic, _handler, _options) => ({
        topic,
        unsubscribe: mockUnsubscribe,
        // No send method.
      }))

      const { result } = renderHook(() => useLogSubscription('session-123', 'INFO'))

      act(() => {
        result.current.requestMore('cursor-1')
      })

      expect(mockSetPaginationLoading).toHaveBeenCalledWith(true)
      expect(mockSetPaginationLoading).toHaveBeenCalledWith(false)
    })

    it('requestMore is a no-op and does not flip loading when sessionId is null', async () => {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')
      const mockSend = vi.fn()

      mockSubscribe.mockImplementation((topic, _handler, _options) => ({
        topic,
        unsubscribe: mockUnsubscribe,
        send: mockSend,
      }))

      const { result } = renderHook(() => useLogSubscription(null, 'INFO'))

      act(() => {
        result.current.requestMore(null)
      })

      expect(mockSend).not.toHaveBeenCalled()
      expect(mockSetPaginationLoading).not.toHaveBeenCalledWith(true)
    })

    it('requestMore does nothing when already loading', async () => {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')

      vi.mocked(await import('../../../../src/features/workbench/stores/log-store')).useLogStore.mockImplementation((selector) => {
        const state = {
          // State
          entries: [] as LogEntry[],
          minLevel: 'INFO' as const,
          sessionId: 'session-123',
          errorFilterActive: false,
          displaySettings: { showTimestamps: true, showLevel: true, showSource: true, sourceWidth: 20, showSystemLogs: true, fontSize: 12 },
          errorCount: 0,
          autoScrollEnabled: true,
          pagination: { isLoading: true, hasMore: true, cursor: 'old' },
          // Actions
          addEntry: mockAddEntry,
          addEntries: mockAddEntries,
          clearLogs: mockClearLogs,
          prependHistoricalEntries: mockPrependHistoricalEntries,
          setPaginationLoading: mockSetPaginationLoading,
          setPaginationHasMore: mockSetPaginationHasMore,
          setPaginationCursor: mockSetPaginationCursor,
          setMinLevel: vi.fn(),
          setErrorFilterActive: vi.fn(),
          updateDisplaySettings: vi.fn(),
          setAutoScrollEnabled: vi.fn(),
          setSessionId: vi.fn(),
          handleLevelSwitch: vi.fn(),
          getFilteredEntries: vi.fn().mockReturnValue([]),
          getLogTopic: vi.fn().mockReturnValue(null),
        }
        return typeof selector === 'function' ? selector(state) : state
      })

      const { result } = renderHook(() => useLogSubscription('session-123', 'INFO'))

      mockSetPaginationLoading.mockClear()

      act(() => {
        result.current.requestMore('cursor-123')
      })

      expect(mockSetPaginationLoading).not.toHaveBeenCalled()
    })
  })

  describe('Connection State', () => {
    it('connects WebSocket if not connected', async () => {
      vi.mocked(await import('@/features/workbench/stores/websocket-store')).useWebSocketStore.mockImplementation(() => ({
        isConnected: false,
        subscribe: mockSubscribe,
        connect: mockConnect,
      }))

      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')

      renderHook(() => useLogSubscription('session-123', 'INFO'))

      expect(mockConnect).toHaveBeenCalled()
    })

    it('waits for connection before subscribing', async () => {
      let isConnected = false

      vi.mocked(await import('@/features/workbench/stores/websocket-store')).useWebSocketStore.mockImplementation(() => ({
        isConnected,
        subscribe: mockSubscribe,
        connect: mockConnect.mockImplementation(() => {
          isConnected = true
          return Promise.resolve()
        }),
      }))

      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')

      renderHook(() => useLogSubscription('session-123', 'INFO'))

      // Subscribe should be called after connect
      await waitFor(() => {
        expect(mockSubscribe).toHaveBeenCalled()
      })
    })
  })

  describe('Error Handling', () => {
    it('handles subscription errors gracefully', async () => {
      // Mock console.error to prevent stderr output
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockSubscribe.mockImplementation(() => {
        throw new Error('Subscription failed')
      })

      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')

      // Should not throw
      expect(() => {
        renderHook(() => useLogSubscription('session-123', 'INFO'))
      }).not.toThrow()

      consoleError.mockRestore()
    })

    it('logs error when subscription fails', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSubscribe.mockImplementation(() => {
        throw new Error('Subscription failed')
      })

      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')

      renderHook(() => useLogSubscription('session-123', 'INFO'))

      expect(consoleError).toHaveBeenCalled()
      consoleError.mockRestore()
    })

    it('says in the console itself that the run log will not appear', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSubscribe.mockImplementation(() => {
        throw new Error('Subscription failed')
      })

      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')

      renderHook(() => useLogSubscription('session-123', 'INFO'))

      expect(mockAddEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'ERROR',
          // Not 'SYSTEM': a display preference hides those rows.
          source: 'CONSOLE',
          message:
            "Console not connected - this run's log will not appear: Subscription failed",
        }),
      )
      const entry = mockAddEntry.mock.calls.at(-1)?.[0] as { id: string; timestamp: string }
      expect(entry.id).not.toBe('')
      expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false)
      consoleError.mockRestore()
    })

    it('adds no console row while the subscribe succeeds', async () => {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')

      renderHook(() => useLogSubscription('session-123', 'INFO'))

      expect(mockAddEntry).not.toHaveBeenCalled()
    })
  })

  describe('Cleanup', () => {
    it('cleans up subscription on session change', async () => {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')

      const { rerender } = renderHook(
        ({ sessionId }) => useLogSubscription(sessionId, 'INFO'),
        { initialProps: { sessionId: 'session-123' as string | null } }
      )

      rerender({ sessionId: null })

      expect(mockUnsubscribe).toHaveBeenCalled()
    })

    it('does not leave dangling subscriptions', async () => {
      const { useLogSubscription } = await import('../../../../src/features/workbench/hooks/use-log-subscription')
      const subscriptions: { unsubscribe: () => void }[] = []

      mockSubscribe.mockImplementation((topic) => {
        const sub = { topic, unsubscribe: vi.fn() }
        subscriptions.push(sub)
        return sub
      })

      const { unmount, rerender } = renderHook(
        ({ sessionId, level }) => useLogSubscription(sessionId, level),
        { initialProps: { sessionId: 'session-1', level: 'INFO' as LogLevel } }
      )

      rerender({ sessionId: 'session-2', level: 'INFO' as LogLevel })
      rerender({ sessionId: 'session-3', level: 'DEBUG' as LogLevel })
      unmount()

      // All subscriptions should be cleaned up
      subscriptions.forEach((sub) => {
        expect(sub.unsubscribe).toHaveBeenCalled()
      })
    })
  })
})
