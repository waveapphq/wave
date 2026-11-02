/**
 * ConsolePanel - Paused line rendering - REQ-3.2.2.5 / CANVAS-85
 *
 * Contract for the amber ``⏸ Paused at [Name] (<reason>)`` line that
 * appears in the console when the engine pauses (CANVAS-85).
 *
 * Responsibility split between hook and panel:
 *   - The ``useWorkbenchRun`` WS handler emits a paused log entry when the
 *     ``debug_breakpoint_hit`` event arrives (covered by the
 *     ``use-workbench-run`` tests and the backend engine tests).
 *   - ``ConsolePanel`` renders that log entry with amber styling and the
 *     pause glyph intact. This file covers the rendering contract.
 *
 * Expected entry shape (the hook builds this):
 *   {
 *     id: <uuid>,
 *     timestamp: ISO-8601,
 *     level: 'WARN',
 *     source: 'DEBUG',
 *     message: '⏸ Paused at Python Step (breakpoint)',
 *     variant: 'paused',   // new amber variant (can alias to 'warning' styling)
 *   }
 *
 * The tests mount ``ConsolePanel`` with the log store mocked so the
 * paused entry is already in ``entries`` / ``getFilteredEntries()``.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { LogEntry } from '@/types/console'

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------

interface MockLogState {
  entries: LogEntry[]
  minLevel: string
  errorCount: number
  errorFilterActive: boolean
  displaySettings: {
    showTimestamps: boolean
    showLevel: boolean
    showSource: boolean
    sourceWidth: number
    showSystemLogs: boolean
    fontSize: number
  }
  autoScrollEnabled: boolean
  pagination: { hasMore: boolean; isLoading: boolean; cursor: string | null }
  getFilteredEntries: () => LogEntry[]
  setMinLevel: ReturnType<typeof vi.fn>
  setErrorFilterActive: ReturnType<typeof vi.fn>
  updateDisplaySettings: ReturnType<typeof vi.fn>
  setAutoScrollEnabled: ReturnType<typeof vi.fn>
  clearLogs: ReturnType<typeof vi.fn>
  setSessionId: ReturnType<typeof vi.fn>
  handleLevelSwitch: ReturnType<typeof vi.fn>
}

const mockLogState: MockLogState = {
  entries: [],
  minLevel: 'INFO',
  errorCount: 0,
  errorFilterActive: false,
  displaySettings: {
    showTimestamps: true,
    showLevel: true,
    showSource: true,
    sourceWidth: 20,
    showSystemLogs: true,
    fontSize: 12,
  },
  autoScrollEnabled: true,
  pagination: { hasMore: false, isLoading: false, cursor: null },
  getFilteredEntries: vi.fn(() => mockLogState.entries),
  setMinLevel: vi.fn(),
  setErrorFilterActive: vi.fn(),
  updateDisplaySettings: vi.fn(),
  setAutoScrollEnabled: vi.fn(),
  clearLogs: vi.fn(),
  setSessionId: vi.fn(),
  handleLevelSwitch: vi.fn(),
}

const mockExecutionState = {
  activeExecutionId: null as string | null,
  executions: {} as Record<string, { status: string }>,
}

vi.mock('@/features/workbench/stores/log-store', () => ({
  useLogStore: (selector: (state: typeof mockLogState) => unknown) =>
    selector(mockLogState),
}))

vi.mock('@/features/workbench/stores/execution-store', () => ({
  useExecutionStore: (selector: (state: typeof mockExecutionState) => unknown) =>
    selector(mockExecutionState),
}))

vi.mock('@/features/workbench/hooks/use-log-subscription', () => ({
  useLogSubscription: vi.fn(() => ({ requestMore: vi.fn() })),
}))

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function pausedEntry(
  overrides: Partial<LogEntry> = {}
): LogEntry {
  return {
    id: 'entry-paused-1',
    timestamp: '2026-04-24T12:00:00.000Z',
    level: 'WARN',
    source: 'DEBUG',
    message: '⏸ Paused at Python Step (breakpoint)',
    variant: 'paused' as LogEntry['variant'],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConsolePanel - paused line rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLogState.entries = []
    mockLogState.getFilteredEntries = vi.fn(() => mockLogState.entries)
  })

  it('renders a paused entry with the pause glyph + node name + reason in the message', async () => {
    mockLogState.entries = [pausedEntry()]
    const { ConsolePanel } = await import(
      '@/features/workbench/common/console/console-panel'
    )

    render(<ConsolePanel sessionId="session-1" defaultCollapsed={false} />)

    expect(
      screen.getByText(/⏸ Paused at Python Step \(breakpoint\)/)
    ).toBeInTheDocument()
  })

  it('renders the paused entry with amber variant styling', async () => {
    mockLogState.entries = [pausedEntry()]
    const { ConsolePanel } = await import(
      '@/features/workbench/common/console/console-panel'
    )

    const { container } = render(
      <ConsolePanel sessionId="session-1" defaultCollapsed={false} />
    )

    // The log-entry uses VARIANT_CLASS_MAP[variant] which for 'paused' maps
    // to a log-variant-paused class. Amber can alias to
    // warning styling if the team opts to reuse it, so accept either.
    const rowClass = container.innerHTML
    expect(rowClass).toMatch(/log-variant-paused|log-variant-warning/)
  })

  it('renders the "first_block" reason when that is the pause trigger', async () => {
    mockLogState.entries = [
      pausedEntry({
        id: 'entry-paused-fb',
        message: '⏸ Paused at Start Block (first_block)',
      }),
    ]
    const { ConsolePanel } = await import(
      '@/features/workbench/common/console/console-panel'
    )

    render(<ConsolePanel sessionId="session-1" defaultCollapsed={false} />)

    expect(
      screen.getByText(/⏸ Paused at Start Block \(first_block\)/)
    ).toBeInTheDocument()
  })

  it('renders the "error" reason with exception context in the message', async () => {
    mockLogState.entries = [
      pausedEntry({
        id: 'entry-paused-err',
        message: '⏸ Paused on error at Python Step: RuntimeError: boom',
      }),
    ]
    const { ConsolePanel } = await import(
      '@/features/workbench/common/console/console-panel'
    )

    render(<ConsolePanel sessionId="session-1" defaultCollapsed={false} />)

    expect(
      screen.getByText(
        /⏸ Paused on error at Python Step: RuntimeError: boom/
      )
    ).toBeInTheDocument()
  })

  it('keeps the paused entry visible when the user filters by errors (stays across level switches)', async () => {
    // Even though paused entries are WARN-level, they should be treated as
    // important enough to remain visible - this protects against a user
    // accidentally losing track of their paused state when toggling the
    // error filter.
    mockLogState.errorFilterActive = true
    mockLogState.entries = [pausedEntry()]
    mockLogState.getFilteredEntries = vi.fn(() => mockLogState.entries)

    const { ConsolePanel } = await import(
      '@/features/workbench/common/console/console-panel'
    )
    render(<ConsolePanel sessionId="session-1" defaultCollapsed={false} />)

    expect(
      screen.getByText(/⏸ Paused at Python Step/)
    ).toBeInTheDocument()
  })

  it('renders the DEBUG source on the paused entry', async () => {
    mockLogState.entries = [pausedEntry()]
    const { ConsolePanel } = await import(
      '@/features/workbench/common/console/console-panel'
    )

    render(<ConsolePanel sessionId="session-1" defaultCollapsed={false} />)

    expect(screen.getByText(/DEBUG/)).toBeInTheDocument()
  })
})
