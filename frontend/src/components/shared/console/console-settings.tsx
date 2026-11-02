/**
 * ConsoleSettings Component - REQ-3.4.2.7
 *
 * Settings popover that provides display options for log entries.
 * - Settings button (gear icon) opens display options popover
 * - Show Timestamps toggle (default: ON)
 * - Show Level toggle (default: ON)
 * - Show Source toggle (default: ON, width is resizable via drag handle)
 */

import { memo, useCallback } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Settings, Minus, Plus } from 'lucide-react'
import { useDisplaySettingsStore } from '@/components/shared/console/display-settings-store'
import type { DisplaySettings } from '@/types/console'

// ============================================================================
// Constants
// ============================================================================

const MIN_FONT_SIZE = 10
const MAX_FONT_SIZE = 18

// ============================================================================
// Types
// ============================================================================

export interface ConsoleSettingsProps {
  /** Explicit settings win; omitted, the shared persisted store is used. */
  settings?: DisplaySettings
  onSettingsChange?: (changes: Partial<DisplaySettings>) => void
}

// ============================================================================
// Component
// ============================================================================

export const ConsoleSettings = memo(function ConsoleSettings({
  settings: settingsProp,
  onSettingsChange,
}: ConsoleSettingsProps) {
  const storeSettings = useDisplaySettingsStore((state) => state.settings)
  const updateStoreSettings = useDisplaySettingsStore((state) => state.updateSettings)
  const settings = settingsProp ?? storeSettings
  const applyChange = onSettingsChange ?? updateStoreSettings

  const handleTimestampsChange = (checked: boolean) => {
    applyChange({ showTimestamps: checked })
  }

  const handleLevelChange = (checked: boolean) => {
    applyChange({ showLevel: checked })
  }

  const handleSourceChange = (checked: boolean) => {
    applyChange({ showSource: checked })
  }

  const handleSystemLogsChange = (checked: boolean) => {
    applyChange({ showSystemLogs: checked })
  }

  const handleFontSizeDecrease = useCallback(() => {
    const newSize = Math.max(MIN_FONT_SIZE, settings.fontSize - 1)
    applyChange({ fontSize: newSize })
  }, [settings.fontSize, applyChange])

  const handleFontSizeIncrease = useCallback(() => {
    const newSize = Math.min(MAX_FONT_SIZE, settings.fontSize + 1)
    applyChange({ fontSize: newSize })
  }, [settings.fontSize, applyChange])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 transition-[transform,background-color] duration-150 hover:bg-zinc-700 hover:scale-110 active:scale-95"
          aria-label="Console settings"
          aria-haspopup="dialog"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end">
        <div className="space-y-4">
          <h3 className="font-medium text-sm">Display Options</h3>

          <div
            data-testid="settings-row-timestamps"
            className="settings-row flex justify-between items-center"
          >
            <Label htmlFor="show-timestamps" className="cursor-pointer">
              Show Timestamps
            </Label>
            <Switch
              id="show-timestamps"
              checked={settings.showTimestamps}
              onCheckedChange={handleTimestampsChange}
              aria-label="Show Timestamps"
            />
          </div>

          <div
            data-testid="settings-row-level"
            className="settings-row flex justify-between items-center"
          >
            <Label htmlFor="show-level" className="cursor-pointer">
              Show Level
            </Label>
            <Switch
              id="show-level"
              checked={settings.showLevel}
              onCheckedChange={handleLevelChange}
              aria-label="Show Level"
            />
          </div>

          <div
            data-testid="settings-row-source"
            className="settings-row flex justify-between items-center"
          >
            <Label htmlFor="show-source" className="cursor-pointer">
              Show Source
            </Label>
            <Switch
              id="show-source"
              checked={settings.showSource}
              onCheckedChange={handleSourceChange}
              aria-label="Show Source"
            />
          </div>

          <div
            data-testid="settings-row-system-logs"
            className="settings-row flex justify-between items-center"
          >
            <Label htmlFor="show-system-logs" className="cursor-pointer">
              Show System Logs
            </Label>
            <Switch
              id="show-system-logs"
              checked={settings.showSystemLogs}
              onCheckedChange={handleSystemLogsChange}
              aria-label="Show System Logs"
            />
          </div>

          {/* Separator */}
          <div className="h-px bg-border my-2" />

          {/* Text Zoom */}
          <div
            data-testid="settings-row-font-size"
            className="settings-row flex justify-between items-center"
          >
            <Label className="cursor-default">Text Size</Label>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6 transition-transform duration-150 hover:scale-110 active:scale-95 disabled:hover:scale-100"
                onClick={handleFontSizeDecrease}
                disabled={settings.fontSize <= MIN_FONT_SIZE}
                aria-label="Decrease text size"
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span
                data-testid="font-size-display"
                className="w-8 text-center text-xs tabular-nums"
              >
                {settings.fontSize}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6 transition-transform duration-150 hover:scale-110 active:scale-95 disabled:hover:scale-100"
                onClick={handleFontSizeIncrease}
                disabled={settings.fontSize >= MAX_FONT_SIZE}
                aria-label="Increase text size"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
})

export default ConsoleSettings
