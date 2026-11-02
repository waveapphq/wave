/**
 * HistoryConsole - history-mode console panel.
 *
 * Composes `ConsolePanelHeader` + `ConsoleContent` directly rather than
 * reusing the live `ConsolePanel`, because `ConsolePanel` is tied to the
 * global `log-store` + websocket subscription. Going through the
 * primitives keeps the history canvas fully independent from live log
 * state, so filtering/autoscroll/collapse state in a history tab does
 * not leak into the live Workbench console in another tab.
 *
 * Entries come from the execution's log slice (REST payload). The panel
 * is read-only: the Clear button stays visible but disabled, while
 * filters, autoscroll, copy, and collapse continue to work.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ConsolePanelHeader } from '@/components/shared/console/console-panel-header'
import { ConsoleContent } from '@/components/shared/console/content'
import { useDisplaySettingsStore } from '@/components/shared/console/display-settings-store'
import { formatEntryForCopy } from '@/components/shared/console/log-entry'
import type { LogEntry } from '@/types/console'
import type { LogLevel } from '@/lib/log-levels'
import type { HistoricalCanvasLog } from '@/features/executions/api/types'
import type { PanelSlotProps } from '@/features/workbench/common/shell'
import { copyText } from '@/lib/clipboard'

/** Failed copies stay silent (the shared copy-control pattern): the helper
 *  answers false when it cannot copy, and a rejection says the same thing. */
function ignoreCopyOutcome(): void {
  // Nothing to add: a failed copy is deliberately silent.
}

const LEVEL_HIERARCHY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
}

function isErrorLevel(level: LogLevel): boolean {
  return level === 'ERROR' || level === 'FATAL'
}

function normalizeLevel(raw: string | undefined): LogLevel {
  const upper = (raw ?? 'INFO').toUpperCase()
  if (upper === 'DEBUG' || upper === 'INFO' || upper === 'WARN' || upper === 'ERROR' || upper === 'FATAL') {
    return upper
  }
  return 'INFO'
}

/**
 * Turn the execution's raw `logs` slice into the `LogEntry[]` shape the
 * shared console primitives expect. Missing fields fall back to safe
 * defaults; `sequence` uses the entry's own `sequence` when present and
 * otherwise the array index so virtualization stays stable.
 */
export function buildLogEntries(raw: readonly HistoricalCanvasLog[]): LogEntry[] {
  return raw.map((entry, index) => ({
    id: entry.id ?? `hist-${index}`,
    timestamp: entry.timestamp ?? '',
    level: normalizeLevel(entry.level),
    message: entry.message ?? '',
    source: entry.source ?? '',
    blockId: entry.blockId,
    sequence: entry.sequence ?? index,
  }))
}

export interface HistoryConsoleProps extends PanelSlotProps {
  entries: LogEntry[]
}

export function HistoryConsole({
  collapsed,
  onCollapsedChange,
  entries,
}: Readonly<HistoryConsoleProps>): ReactNode {
  const [minLevel, setMinLevel] = useState<LogLevel>('INFO')
  const [errorFilterActive, setErrorFilterActive] = useState(false)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
  const displaySettings = useDisplaySettingsStore((state) => state.settings)
  const updateDisplaySettings = useDisplaySettingsStore((state) => state.updateSettings)

  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(155)

  useEffect(() => {
    if (collapsed || !contentRef.current) return
    const el = contentRef.current
    const observer = new ResizeObserver((observed) => {
      for (const rect of observed) {
        const h = rect.contentRect.height
        /* v8 ignore next 3 - COV-JSDOM-009 */
        if (h > 0) setContentHeight(h)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [collapsed])

  const filteredEntries = useMemo(() => {
    if (errorFilterActive) {
      return entries.filter((e) => isErrorLevel(e.level))
    }
    const minSeverity = LEVEL_HIERARCHY[minLevel]
    let filtered = entries.filter((e) => LEVEL_HIERARCHY[e.level] >= minSeverity)
    if (!displaySettings.showSystemLogs) {
      filtered = filtered.filter((e) => e.source !== 'SYSTEM')
    }
    return filtered
  }, [entries, minLevel, errorFilterActive, displaySettings.showSystemLogs])

  const errorCount = useMemo(() => entries.filter((e) => isErrorLevel(e.level)).length, [entries])

  const handleCopyLogs = useCallback(() => {
    if (filteredEntries.length === 0) return
    const text = filteredEntries
      .map((entry) => formatEntryForCopy(entry, displaySettings))
      .join('\n')
    copyText(text).then(ignoreCopyOutcome, ignoreCopyOutcome)
  }, [filteredEntries, displaySettings])

  // Clear is disabled on a historical run (the header forces it off via
  // `readOnly`), so the handler is a permanent no-op kept only because
  // `ConsolePanelHeader` takes `onClear` as a required prop.
  const handleClear = useCallback(() => {}, [])

  return (
    <div
      data-testid="console-panel"
      data-state={collapsed ? 'collapsed' : 'expanded'}
      className="flex flex-col border-t-2 bg-background h-full"
    >
      <ConsolePanelHeader
        sessionId={null}
        errorCount={errorCount}
        minLevel={minLevel}
        onMinLevelChange={setMinLevel}
        errorFilterActive={errorFilterActive}
        onErrorFilterChange={setErrorFilterActive}
        onClear={handleClear}
        onCopyLogs={handleCopyLogs}
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        hasEntries={entries.length > 0}
        isExecuting={false}
        readOnly
        displaySettings={displaySettings}
        onDisplaySettingsChange={updateDisplaySettings}
      />

      {!collapsed && (
        <div ref={contentRef} className="flex-1 overflow-hidden">
          <ConsoleContent
            entries={filteredEntries}
            displaySettings={displaySettings}
            containerHeight={contentHeight}
            autoScrollEnabled={autoScrollEnabled}
            onAutoScrollChange={setAutoScrollEnabled}
            hasMore={false}
            isLoading={false}
            onSourceWidthChange={(width) => updateDisplaySettings({ sourceWidth: width })}
          />
        </div>
      )}
    </div>
  )
}
