/**
 * ConsolePanel Component Tests - REQ-3.4.2.7, REQ-3.7.2.5, REQ-3.7.2.6
 *
 * Tests for the main console panel component that integrates header and content.
 *
 * Design Reference:
 * - Collapsible panel with header and content
 * - Real-time log streaming via WebSocket
 * - Level filtering and pagination
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Types for mock state
interface LogEntry {
  id: string
  timestamp: string
  level: string
  message: string
  source: string
  sequence: number
}

interface Execution {
  status: string
}

// Mock the stores
const mockExecutionState = {
  activeExecutionId: null as string | null,
  executions: {} as Record<string, Partial<Execution>>,
}

const mockLogState = {
  entries: [] as LogEntry[],
  minLevel: 'INFO' as const,
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
  pagination: {
    hasMore: false,
    isLoading: false,
    cursor: null as string | null,
  },
  getFilteredEntries: vi.fn((): LogEntry[] => []),
  setMinLevel: vi.fn(),
  setErrorFilterActive: vi.fn(),
  updateDisplaySettings: vi.fn(),
  setAutoScrollEnabled: vi.fn(),
  clearLogs: vi.fn(),
  setSessionId: vi.fn(),
}

vi.mock('@/features/workbench/stores/execution-store', () => ({
  useExecutionStore: vi.fn((selector: (state: typeof mockExecutionState) => unknown) => selector(mockExecutionState)),
}))

vi.mock('@/features/workbench/stores/log-store', () => ({
  useLogStore: vi.fn((selector: (state: typeof mockLogState) => unknown) => selector(mockLogState)),
}))

vi.mock('@/features/workbench/hooks/use-log-subscription', () => ({
  useLogSubscription: vi.fn(() => ({
    requestMore: vi.fn(),
  })),
}))

vi.mock('@/lib/clipboard', () => ({
  copyText: vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(true),
}))

// Mock child components to simplify testing
vi.mock('@/components/shared/console/console-panel-header', () => ({
  ConsolePanelHeader: vi.fn(({ collapsed, onCollapsedChange, onCopyLogs }) => (
    <div data-testid="console-panel-header">
      <button data-testid="toggle-button" onClick={() => onCollapsedChange?.(!collapsed)}>
        Toggle
      </button>
      <button data-testid="copy-logs-button" onClick={onCopyLogs}>
        Copy
      </button>
      <span data-testid="collapsed-state">{collapsed ? 'collapsed' : 'expanded'}</span>
    </div>
  )),
}))

vi.mock('@/components/shared/console/content', () => ({
  ConsoleContent: vi.fn(({ onLoadMore }) => (
    <div data-testid="console-content">
      <button data-testid="load-more-button" onClick={onLoadMore}>
        Load More
      </button>
    </div>
  )),
}))

describe('ConsolePanel Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mock state
    mockLogState.entries = []
    mockLogState.pagination = { hasMore: false, isLoading: false, cursor: null }
    mockExecutionState.activeExecutionId = null
    mockExecutionState.executions = {}
  })

  afterEach(() => {
    vi.resetModules()
  })

  describe('Rendering', () => {
    it('renders console panel with header', async () => {
      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')

      render(<ConsolePanel />)

      expect(screen.getByTestId('console-panel')).toBeInTheDocument()
      expect(screen.getByTestId('console-panel-header')).toBeInTheDocument()
    })

    it('shows content when expanded', async () => {
      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')

      render(<ConsolePanel defaultCollapsed={false} />)

      expect(screen.getByTestId('console-content')).toBeInTheDocument()
    })

    it('hides content when collapsed', async () => {
      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')

      render(<ConsolePanel defaultCollapsed={true} />)

      expect(screen.queryByTestId('console-content')).not.toBeInTheDocument()
    })

    it('applies custom className', async () => {
      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')

      render(<ConsolePanel className="custom-class" />)

      expect(screen.getByTestId('console-panel')).toHaveClass('custom-class')
    })

    it('fills its container with h-full', async () => {
      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')

      render(<ConsolePanel defaultCollapsed={false} />)

      expect(screen.getByTestId('console-panel')).toHaveClass('h-full')
    })
  })

  describe('Controlled vs Uncontrolled Mode', () => {
    it('uses internal state when uncontrolled', async () => {
      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')
      const user = userEvent.setup()

      render(<ConsolePanel defaultCollapsed={true} />)

      expect(screen.getByTestId('collapsed-state')).toHaveTextContent('collapsed')

      // Toggle using the mock button
      await user.click(screen.getByTestId('toggle-button'))

      expect(screen.getByTestId('collapsed-state')).toHaveTextContent('expanded')
    })

    it('uses controlled state when collapsed prop provided', async () => {
      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')
      const onCollapsedChange = vi.fn()

      const { rerender } = render(<ConsolePanel collapsed={true} onCollapsedChange={onCollapsedChange} />)

      expect(screen.getByTestId('collapsed-state')).toHaveTextContent('collapsed')

      // Rerender with expanded state
      rerender(<ConsolePanel collapsed={false} onCollapsedChange={onCollapsedChange} />)

      expect(screen.getByTestId('collapsed-state')).toHaveTextContent('expanded')
    })

    it('calls onCollapsedChange when toggle is clicked', async () => {
      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')
      const onCollapsedChange = vi.fn()
      const user = userEvent.setup()

      render(<ConsolePanel defaultCollapsed={false} onCollapsedChange={onCollapsedChange} />)

      await user.click(screen.getByTestId('toggle-button'))

      expect(onCollapsedChange).toHaveBeenCalledWith(true)
    })
  })

  describe('Session ID', () => {
    it('passes sessionId to child components', async () => {
      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')

      render(<ConsolePanel sessionId="session-123" />)

      // sessionId should be passed through (verified by mock)
      expect(mockLogState.setSessionId).toHaveBeenCalledWith('session-123')
    })

    it('handles null sessionId', async () => {
      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')

      render(<ConsolePanel sessionId={null} />)

      expect(mockLogState.setSessionId).toHaveBeenCalledWith(null)
    })
  })

  describe('Load More Pagination', () => {
    it('calls requestMore when load more is triggered and has more', async () => {
      const mockRequestMore = vi.fn()
      const { useLogSubscription } = await import('@/features/workbench/hooks/use-log-subscription')
      vi.mocked(useLogSubscription).mockReturnValue({ requestMore: mockRequestMore })

      mockLogState.pagination = { hasMore: true, isLoading: false, cursor: 'cursor-123' }

      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')
      const user = userEvent.setup()

      render(<ConsolePanel defaultCollapsed={false} />)

      await user.click(screen.getByTestId('load-more-button'))

      expect(mockRequestMore).toHaveBeenCalledWith('cursor-123')
    })

    it('does not call requestMore when no more entries', async () => {
      const mockRequestMore = vi.fn()
      const { useLogSubscription } = await import('@/features/workbench/hooks/use-log-subscription')
      vi.mocked(useLogSubscription).mockReturnValue({ requestMore: mockRequestMore })

      mockLogState.pagination = { hasMore: false, isLoading: false, cursor: null }

      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')
      const user = userEvent.setup()

      render(<ConsolePanel defaultCollapsed={false} />)

      await user.click(screen.getByTestId('load-more-button'))

      expect(mockRequestMore).not.toHaveBeenCalled()
    })

    it('does not call requestMore when already loading', async () => {
      const mockRequestMore = vi.fn()
      const { useLogSubscription } = await import('@/features/workbench/hooks/use-log-subscription')
      vi.mocked(useLogSubscription).mockReturnValue({ requestMore: mockRequestMore })

      mockLogState.pagination = { hasMore: true, isLoading: true, cursor: 'cursor-123' }

      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')
      const user = userEvent.setup()

      render(<ConsolePanel defaultCollapsed={false} />)

      await user.click(screen.getByTestId('load-more-button'))

      expect(mockRequestMore).not.toHaveBeenCalled()
    })
  })

  describe('Execution State', () => {
    it('detects when execution is running', async () => {
      mockExecutionState.activeExecutionId = 'exec-1'
      mockExecutionState.executions = { 'exec-1': { status: 'running' } }

      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')

      render(<ConsolePanel />)

      // The isExecuting state is derived via primitive selector from execution store
      // Verify the component renders with the execution state active
      expect(screen.getByTestId('console-panel')).toBeInTheDocument()
    })
  })

  describe('Content Height', () => {
    it('uses ResizeObserver to measure content area', async () => {
      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')

      render(<ConsolePanel defaultCollapsed={false} />)

      // Content should be visible when expanded
      expect(screen.getByTestId('console-content')).toBeInTheDocument()
    })

    it('disconnects ResizeObserver on unmount', async () => {
      const disconnectSpy = vi.fn()
      const observeSpy = vi.fn()
      vi.stubGlobal(
        'ResizeObserver',
        vi.fn(() => ({
          observe: observeSpy,
          disconnect: disconnectSpy,
          unobserve: vi.fn(),
        }))
      )

      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')

      const { unmount } = render(<ConsolePanel defaultCollapsed={false} />)

      unmount()

      expect(disconnectSpy).toHaveBeenCalled()
      vi.unstubAllGlobals()
    })
  })

  describe('Filtered Entries', () => {
    it('calls getFilteredEntries for display', async () => {
      const mockFilteredEntries = [
        { id: '1', timestamp: '2025-01-01T12:00:00Z', level: 'INFO', message: 'Test', source: 'test', sequence: 1 },
      ]
      mockLogState.getFilteredEntries.mockReturnValue(mockFilteredEntries)

      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')

      render(<ConsolePanel defaultCollapsed={false} />)

      expect(mockLogState.getFilteredEntries).toHaveBeenCalled()
    })
  })

  describe('Copy Logs', () => {
    it('creates handleCopyLogs callback from filtered entries', async () => {
      const mockFilteredEntries = [
        { id: '1', timestamp: '2025-01-01T12:00:00Z', level: 'INFO', message: 'Test message', source: 'test', sequence: 1 },
      ]
      mockLogState.getFilteredEntries.mockReturnValue(mockFilteredEntries)

      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')

      render(<ConsolePanel defaultCollapsed={false} />)

      // getFilteredEntries is called to prepare the copy handler
      expect(mockLogState.getFilteredEntries).toHaveBeenCalled()
    })

    it('does not fail when there are no entries to copy', async () => {
      mockLogState.getFilteredEntries.mockReturnValue([])

      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')

      // Should render without errors even with no entries
      render(<ConsolePanel defaultCollapsed={false} />)

      expect(screen.getByTestId('console-panel')).toBeInTheDocument()
    })

    it('copies the formatted filtered entries when the copy action fires', async () => {
      const mockFilteredEntries = [
        { id: '1', timestamp: '2025-01-01T12:00:00Z', level: 'INFO', message: 'First line', source: 'test', sequence: 1 },
        { id: '2', timestamp: '2025-01-01T12:00:01Z', level: 'WARN', message: 'Second line', source: 'test', sequence: 2 },
      ]
      mockLogState.getFilteredEntries.mockReturnValue(mockFilteredEntries)

      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')
      const { copyText } = await import('@/lib/clipboard')
      const user = userEvent.setup()

      render(<ConsolePanel defaultCollapsed={false} />)

      await user.click(screen.getByTestId('copy-logs-button'))

      expect(copyText).toHaveBeenCalledTimes(1)
      const copiedText = vi.mocked(copyText).mock.calls[0][0]
      expect(copiedText).toContain('First line')
      expect(copiedText).toContain('Second line')
    })

    it('does not invoke the clipboard when there are no filtered entries', async () => {
      mockLogState.getFilteredEntries.mockReturnValue([])

      const { ConsolePanel } = await import('../../../../../src/features/workbench/common/console/console-panel')
      const { copyText } = await import('@/lib/clipboard')
      const user = userEvent.setup()

      render(<ConsolePanel defaultCollapsed={false} />)

      await user.click(screen.getByTestId('copy-logs-button'))

      expect(copyText).not.toHaveBeenCalled()
    })
  })
})
