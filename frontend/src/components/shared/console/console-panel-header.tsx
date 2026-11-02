/**
 * ConsolePanelHeader Component - REQ-3.4.2.7, REQ-3.7.2.6, REQ-3.7.2.8
 *
 * Header for console panel with level dropdown, error badge, clear button,
 * and integrated settings.
 * - Level dropdown for minimum level filter (DEBUG, INFO, WARN, ERROR, FATAL)
 * - Error badge on collapsed panel header (red triangle + count)
 * - Error badge click expands panel + activates error filter
 * - Clear button to reset log buffer
 */

import { memo, useCallback, useId } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { ConsoleSettings } from './console-settings'
import { ChevronDown, ChevronRight, AlertTriangle, Trash2, X, Copy, Activity } from 'lucide-react'
import { LOG_LEVELS, type LogLevel } from '@/lib/log-levels'
import type { DisplaySettings } from '@/types/console'

// ============================================================================
// Types
// ============================================================================

export interface ConsolePanelHeaderProps {
  sessionId: string | null
  errorCount: number
  minLevel: LogLevel
  onMinLevelChange: (level: LogLevel) => void
  errorFilterActive: boolean
  onErrorFilterChange: (active: boolean) => void
  onClear: () => void
  onCopyLogs?: () => void
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  hasEntries?: boolean
  isExecuting?: boolean
  /**
   * Disables the Clear button while leaving every other control active.
   * The history console sets this so users can still filter, copy, and
   * scroll logs from a completed run without being able to wipe them.
   */
  readOnly?: boolean
  displaySettings?: DisplaySettings
  onDisplaySettingsChange?: (settings: Partial<DisplaySettings>) => void
}

// ============================================================================
// Component
// ============================================================================

export const ConsolePanelHeader = memo(function ConsolePanelHeader({
  sessionId: _sessionId,
  errorCount,
  minLevel,
  onMinLevelChange,
  errorFilterActive,
  onErrorFilterChange,
  onClear,
  onCopyLogs,
  collapsed = false,
  onCollapsedChange,
  hasEntries = true,
  isExecuting = false,
  readOnly = false,
  displaySettings,
  onDisplaySettingsChange,
}: ConsolePanelHeaderProps) {
  const levelSelectId = useId()
  const handleToggleCollapse = useCallback(() => {
    if (onCollapsedChange) {
      onCollapsedChange(!collapsed)
    }
  }, [collapsed, onCollapsedChange])

  const handleErrorBadgeClick = useCallback(() => {
    // Expand panel and activate error filter
    if (onCollapsedChange) {
      onCollapsedChange(false)
    }
    onErrorFilterChange(true)
  }, [onCollapsedChange, onErrorFilterChange])

  const handleErrorBadgeKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        handleErrorBadgeClick()
      }
    },
    [handleErrorBadgeClick]
  )

  const handleDismissErrorFilter = useCallback(() => {
    onErrorFilterChange(false)
  }, [onErrorFilterChange])

  const clearDisabled = !hasEntries || isExecuting || readOnly

  return (
    <div
      data-testid="console-panel-header"
      role="toolbar"
      className="flex items-center gap-2 px-2 h-12 bg-card border-b border-border"
    >
      {/* Collapse toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 transition-[transform,background-color] duration-150 hover:bg-accent hover:scale-110 active:scale-95"
        onClick={handleToggleCollapse}
        aria-label="Toggle console"
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </Button>

      {/* Console icon - styled like palette icons */}
      <div
        className="flex items-center justify-center w-6 h-6 rounded-md bg-emerald-500/10 text-emerald-400"
        data-testid="console-icon"
      >
        <Activity className="h-4 w-4" />
      </div>

      {/* Console title */}
      <span className="text-sm font-medium">Console</span>

      {/* Error badge (always visible when there are errors) */}
      {errorCount > 0 && (
        <button
          type="button"
          data-testid="error-badge"
          aria-label={`${errorCount} errors, show errors only`}
          className="text-error flex items-center gap-1 px-2 py-0.5 rounded cursor-pointer transition-[transform,background-color] duration-150 hover:bg-accent hover:scale-105 active:scale-95 bg-transparent border-0 p-0"
          onClick={handleErrorBadgeClick}
          onKeyDown={handleErrorBadgeKeyDown}
        >
          <AlertTriangle className="h-3 w-3" />
          <span className="text-xs">{errorCount}</span>
        </button>
      )}

      {/* Error filter chip */}
      {errorFilterActive && (
        <div
          data-testid="error-filter-chip"
          className="flex items-center gap-1 px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-xs"
        >
          <span>Errors only</span>
          <button
            type="button"
            onClick={handleDismissErrorFilter}
            aria-label="Dismiss error filter"
            className="rounded p-0.5 transition-[transform,background-color] duration-150 hover:bg-red-500/30 hover:scale-110 active:scale-95"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Right-aligned controls with separators */}
      <div className="ml-auto flex items-center gap-2">
        {/* Level dropdown */}
        <div className="flex items-center gap-1">
          <label htmlFor={levelSelectId} className="text-xs text-muted-foreground">
            Level:
          </label>
          <Select
            value={minLevel}
            onValueChange={(value) => onMinLevelChange(value as LogLevel)}
          >
            <SelectTrigger
              id={levelSelectId}
              className="h-6 w-24 text-xs transition-[transform,background-color,border-color] duration-150 hover:bg-accent hover:border-border active:scale-95"
              aria-label="Minimum log level"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOG_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Separator */}
        <div className="h-4 w-px bg-border" />

        {/* Copy logs button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 transition-[transform,background-color] duration-150 hover:bg-accent hover:scale-110 active:scale-95 disabled:hover:scale-100"
          onClick={onCopyLogs}
          disabled={!hasEntries}
          aria-label="Copy logs"
        >
          <Copy className="h-4 w-4" />
        </Button>

        {/* Separator */}
        <div className="h-4 w-px bg-border" />

        {/* Settings button */}
        <ConsoleSettings
          settings={displaySettings}
          onSettingsChange={onDisplaySettingsChange}
        />

        {/* Separator */}
        <div className="h-4 w-px bg-border" />

        {/* Clear button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 transition-[transform,background-color] duration-150 hover:bg-accent hover:scale-110 active:scale-95 disabled:hover:scale-100"
          onClick={onClear}
          disabled={clearDisabled}
          aria-label="Clear console"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
})

export default ConsolePanelHeader
