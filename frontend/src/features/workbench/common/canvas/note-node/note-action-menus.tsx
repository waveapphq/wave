/**
 * Note Action Menus
 *
 * Shared menu components for note nodes: color picker dropdown,
 * kebab overflow menu, and right-click context menu.
 */

import { Copy, Scissors, Trash2, Unlink } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import { Button } from '@/components/ui/button'
import { NOTE_COLOR_PRESETS, type NoteColorPreset } from './note-color-presets'

// ============================================
// Types
// ============================================

export type NoteAction = 'duplicate' | 'copy' | 'cut' | 'unlink' | 'delete'

// ============================================
// Color Picker
// ============================================

interface NoteColorPickerProps {
  preset: NoteColorPreset
  colorPickerOpen: boolean
  onOpenChange: (open: boolean) => void
  onColorChange: (colorId: string) => void
}

export function NoteColorPicker({
  preset,
  colorPickerOpen,
  onOpenChange,
  onColorChange,
}: Readonly<NoteColorPickerProps>) {
  return (
    <DropdownMenu open={colorPickerOpen} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          data-testid="note-color-picker"
          aria-label="Change note color"
        >
          <div className={cn('h-4 w-4 rounded-full border border-slate-300 dark:border-slate-600', preset.dot)} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-0 p-1">
        {NOTE_COLOR_PRESETS.map((p) => (
          <DropdownMenuItem
            key={p.id}
            className="flex items-center gap-2 px-2 py-1 cursor-pointer"
            onSelect={() => onColorChange(p.id)}
            data-testid={`note-color-${p.id}`}
          >
            <div className={cn('h-4 w-4 rounded-full border border-slate-300 dark:border-slate-600', p.dot)} />
            <span className="text-xs">{p.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ============================================
// Context Menu
// ============================================

interface NoteContextMenuContentProps {
  isExecuting: boolean
  hasConnections: boolean
  onAction: (action: NoteAction) => void
}

export function NoteContextMenuContent({
  isExecuting,
  hasConnections,
  onAction,
}: Readonly<NoteContextMenuContentProps>) {
  return (
    <ContextMenuContent className="w-48">
      <ContextMenuItem
        onSelect={() => onAction('duplicate')}
        disabled={isExecuting}
      >
        <Copy className="h-4 w-4 mr-2" />
        Duplicate
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => onAction('copy')}
        disabled={isExecuting}
      >
        <Copy className="h-4 w-4 mr-2" />
        Copy
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => onAction('cut')}
        disabled={isExecuting}
      >
        <Scissors className="h-4 w-4 mr-2" />
        Cut
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => onAction('unlink')}
        disabled={!hasConnections || isExecuting}
      >
        <Unlink className="h-4 w-4 mr-2" />
        Unlink
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        onSelect={() => onAction('delete')}
        disabled={isExecuting}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="h-4 w-4 mr-2" />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
