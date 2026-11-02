/**
 * ConsolePanel Component - REQ-3.4.2.7, REQ-3.7.2.5, REQ-3.7.2.6, REQ-3.7.2.8
 *
 * Collapsible panel for execution output and logs with real-time streaming.
 * Integrates with WebSocket for live log updates during test execution.
 *
 * Sizing is controlled by the parent container (ResizablePanelGroup in the
 * workbench layout). This component fills its container via h-full.
 * - Real-time log streaming via WebSocket
 * - Level filtering (DEBUG, INFO, WARN, ERROR, FATAL)
 * - Error badge with count on collapsed state
 * - Virtualized log display for 10K+ entries
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useExecutionStore } from '@/features/workbench/stores/execution-store'
import { useLogStore } from '@/features/workbench/stores/log-store'
import { useDisplaySettingsStore } from '@/components/shared/console/display-settings-store'
import { useLogSubscription } from '@/features/workbench/hooks/use-log-subscription'
import { ConsolePanelHeader } from '@/components/shared/console/console-panel-header'
import { ConsoleContent } from '@/components/shared/console/content'
import { formatEntryForCopy } from '@/components/shared/console/log-entry'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

/** Failed copies stay silent (the shared copy-control pattern): the helper
 *  answers false when it cannot copy, and a rejection says the same thing. */
function ignoreCopyOutcome(): void {
  // Nothing to add: a failed copy is deliberately silent.
}

// ============================================================================
// Types
// ============================================================================

interface ConsolePanelProps {
  /** Session ID for log subscription (from workbench run) */
  sessionId?: string | null
  /** Initial collapsed state */
  defaultCollapsed?: boolean
  /** Controlled collapsed state */
  collapsed?: boolean
  /** Callback when collapse state changes */
  onCollapsedChange?: (collapsed: boolean) => void
  /** Additional class names */
  className?: string
}

// ============================================================================
// Component
// ============================================================================

export function ConsolePanel({
  sessionId: propSessionId,
  defaultCollapsed = true,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  className,
}: Readonly<ConsolePanelProps>) {
  // Internal collapsed state (for uncontrolled mode)
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed)
  const isControlled = controlledCollapsed !== undefined
  const collapsed = isControlled ? controlledCollapsed : internalCollapsed

  // Content area ref for measuring available height (used by virtualized list)
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(155)

  // Use provided sessionId (from workbench run) - don't fall back to execution store
  // The execution store ID is different from the workbench session ID
  const activeSessionId = propSessionId ?? null
  const isExecuting = useExecutionStore((state) => {
    if (!state.activeExecutionId) return false
    return state.executions[state.activeExecutionId]?.status === 'running'
  })

  // Log store state
  const entries = useLogStore((state) => state.entries)
  const minLevel = useLogStore((state) => state.minLevel)
  const errorCount = useLogStore((state) => state.errorCount)
  const errorFilterActive = useLogStore((state) => state.errorFilterActive)
  const autoScrollEnabled = useLogStore((state) => state.autoScrollEnabled)
  const pagination = useLogStore((state) => state.pagination)
  const getFilteredEntries = useLogStore((state) => state.getFilteredEntries)

  // Shared per-browser display settings
  const displaySettings = useDisplaySettingsStore((state) => state.settings)
  const updateDisplaySettings = useDisplaySettingsStore((state) => state.updateSettings)

  // Log store actions
  const handleLevelSwitch = useLogStore((state) => state.handleLevelSwitch)
  const setErrorFilterActive = useLogStore((state) => state.setErrorFilterActive)
  const setAutoScrollEnabled = useLogStore((state) => state.setAutoScrollEnabled)
  const clearLogs = useLogStore((state) => state.clearLogs)
  const setSessionId = useLogStore((state) => state.setSessionId)

  // Subscribe to log WebSocket topic when we have a session
  const { requestMore } = useLogSubscription(activeSessionId, minLevel)

  // Update log store sessionId when session changes
  useEffect(() => {
    setSessionId(activeSessionId)
  }, [activeSessionId, setSessionId])

  // Measure content area height via ResizeObserver for virtualized list
  useEffect(() => {
    if (collapsed || !contentRef.current) return

    const element = contentRef.current
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height
        /* v8 ignore next 3 - COV-JSDOM-009 */
        if (height > 0) {
          setContentHeight(height)
        }
      }
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [collapsed])

  // Collapse state handler
  const handleCollapsedChange = useCallback(
    (newCollapsed: boolean) => {
      if (!isControlled) {
        setInternalCollapsed(newCollapsed)
      }
      onCollapsedChange?.(newCollapsed)
    },
    [isControlled, onCollapsedChange]
  )

  // Load more handler for pagination
  const handleLoadMore = useCallback(() => {
    if (pagination.hasMore && !pagination.isLoading) {
      requestMore(pagination.cursor)
    }
  }, [pagination.hasMore, pagination.isLoading, pagination.cursor, requestMore])

  // Copy logs to clipboard - uses same format as manual selection
  const handleCopyLogs = useCallback(() => {
    const filtered = getFilteredEntries()
    if (filtered.length === 0) return

    const logText = filtered
      .map((entry) => formatEntryForCopy(entry, displaySettings))
      .join('\n')

    copyText(logText).then(ignoreCopyOutcome, ignoreCopyOutcome)
  }, [getFilteredEntries, displaySettings])

  // Get filtered entries for display
  const filteredEntries = getFilteredEntries()

  return (
    <div
      data-testid="console-panel"
      data-state={collapsed ? 'collapsed' : 'expanded'}
      className={cn(
        'flex flex-col border-t-2 bg-background h-full',
        className
      )}
    >
      {/* Header - always visible */}
      <ConsolePanelHeader
        sessionId={activeSessionId}
        errorCount={errorCount}
        minLevel={minLevel}
        onMinLevelChange={handleLevelSwitch}
        errorFilterActive={errorFilterActive}
        onErrorFilterChange={setErrorFilterActive}
        onClear={clearLogs}
        onCopyLogs={handleCopyLogs}
        collapsed={collapsed}
        onCollapsedChange={handleCollapsedChange}
        hasEntries={entries.length > 0}
        isExecuting={isExecuting}
        displaySettings={displaySettings}
        onDisplaySettingsChange={updateDisplaySettings}
      />

      {/* Content - only visible when expanded */}
      {!collapsed && (
        <div ref={contentRef} className="flex-1 overflow-hidden">
          <ConsoleContent
            entries={filteredEntries}
            displaySettings={displaySettings}
            containerHeight={contentHeight}
            autoScrollEnabled={autoScrollEnabled}
            onAutoScrollChange={setAutoScrollEnabled}
            hasMore={pagination.hasMore}
            isLoading={pagination.isLoading}
            onLoadMore={handleLoadMore}
            onSourceWidthChange={(width) => updateDisplaySettings({ sourceWidth: width })}
          />
        </div>
      )}
    </div>
  )
}
