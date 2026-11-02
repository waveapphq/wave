/**
 * Logs section of the report viewer (RVIEW-9, REQ-3.7.2.8 viewer side).
 *
 * Composes the store-free shared console primitives with local state,
 * mirroring the exported HTML document's heading controls: a Level
 * dropdown defaulting to INFO, a Columns menu (Time/Level/Source), and a
 * live "N of M entries" count over the report's log stream.
 */

import { useMemo, useState, type ReactNode } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from '@/components/ui/dropdown'
import { CheckboxIndicator } from '@/components/ui/checkbox'
import { Icon, ChevronDownIcon } from '@/components/ui/icon'
import { ConsoleContent } from '@/components/shared/console/content'
import {
  DEFAULT_DISPLAY_SETTINGS,
  useDisplaySettingsStore,
} from '@/components/shared/console/display-settings-store'
import { LOG_LEVELS, type LogLevel } from '@/lib/log-levels'
import type { LogEntry } from '@/types/console'

const LEVEL_HIERARCHY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
}

type ColumnKey = 'showTimestamps' | 'showLevel' | 'showSource'

const COLUMN_TOGGLES: ReadonlyArray<{ key: ColumnKey; label: string }> = [
  { key: 'showTimestamps', label: 'Time' },
  { key: 'showLevel', label: 'Level' },
  { key: 'showSource', label: 'Source' },
]

const CONTENT_HEIGHT = 360

export interface ReportLogsPanelProps {
  entries: LogEntry[]
}

export function ReportLogsPanel({ entries }: Readonly<ReportLogsPanelProps>): ReactNode {
  const [minLevel, setMinLevel] = useState<LogLevel>('INFO')
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
  // The reduced picker follows the shared preference for exactly its three
  // columns; text size and the system-log switch stay workbench/history only.
  const sharedSettings = useDisplaySettingsStore((state) => state.settings)
  const updateSharedSettings = useDisplaySettingsStore((state) => state.updateSettings)

  const displaySettings = useMemo(
    () => ({
      ...DEFAULT_DISPLAY_SETTINGS,
      showTimestamps: sharedSettings.showTimestamps,
      showLevel: sharedSettings.showLevel,
      showSource: sharedSettings.showSource,
    }),
    [sharedSettings.showTimestamps, sharedSettings.showLevel, sharedSettings.showSource]
  )

  const filteredEntries = useMemo(() => {
    const minSeverity = LEVEL_HIERARCHY[minLevel]
    return entries.filter((entry) => LEVEL_HIERARCHY[entry.level] >= minSeverity)
  }, [entries, minLevel])

  return (
    <section data-testid="report-logs">
      <h2 className="mb-3 flex items-center justify-between gap-2 text-[15px] font-bold uppercase tracking-wider">
        <span>Logs</span>
        <span className="flex items-center gap-2 text-xs font-normal normal-case tracking-normal">
          <span className="text-muted-foreground">Level:</span>
          <Select value={minLevel} onValueChange={(value) => setMinLevel(value as LogLevel)}>
            <SelectTrigger
              className="h-6 w-20 text-xs"
              aria-label="Minimum log level"
              data-testid="report-logs-level"
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
          <Dropdown placement="bottom-end">
            <DropdownTrigger
              data-testid="report-logs-columns"
              className="flex h-6 items-center gap-1 rounded-md border border-input bg-transparent px-2 text-xs hover:bg-subtle"
            >
              Columns
              <Icon icon={ChevronDownIcon} size="sm" className="opacity-50" />
            </DropdownTrigger>
            <DropdownMenu>
              {COLUMN_TOGGLES.map((column) => (
                <DropdownItem
                  key={column.key}
                  role="menuitemcheckbox"
                  aria-checked={displaySettings[column.key]}
                  closeOnSelect={false}
                  onSelect={() =>
                    updateSharedSettings({ [column.key]: !sharedSettings[column.key] })
                  }
                >
                  <div className="flex items-center gap-2">
                    <CheckboxIndicator checked={displaySettings[column.key]} />
                    {column.label}
                  </div>
                </DropdownItem>
              ))}
            </DropdownMenu>
          </Dropdown>
          <span className="text-muted-foreground" data-testid="report-logs-count">
            {filteredEntries.length} of {entries.length} entries
          </span>
        </span>
      </h2>
      <div className="overflow-hidden rounded-[10px] border">
        <ConsoleContent
          entries={filteredEntries}
          displaySettings={displaySettings}
          containerHeight={CONTENT_HEIGHT}
          autoScrollEnabled={autoScrollEnabled}
          onAutoScrollChange={setAutoScrollEnabled}
        />
      </div>
    </section>
  )
}
