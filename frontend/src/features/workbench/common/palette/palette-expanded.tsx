/**
 * Expanded state of the PalettePanel - the 260px sidebar with search and sections.
 */

import {
  FunctionSquare,
  PanelLeftClose,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import { NewFunctionHandle } from '@/features/functions/palette/new-function-handle'
import { PaletteExpandedContent } from './palette-expanded-content'

// ============================================================================
// PaletteExpanded
// ============================================================================

interface PaletteExpandedProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  onOpenFunctionLibrary?: () => void
  onCollapse: () => void
}

export function PaletteExpanded({
  searchQuery,
  onSearchChange,
  onOpenFunctionLibrary,
  onCollapse,
}: Readonly<PaletteExpandedProps>) {
  return (
    <div
      data-testid="block-palette"
      data-state="expanded"
      className="flex flex-col shrink-0 bg-muted/30 border-r border-border"
      style={{ width: 260 }}
    >
      {/* Header with Tools icon */}
      <div className="flex items-center gap-3 px-3 py-3 border-b border-border">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted/50">
          <Wrench className="h-5 w-5 text-muted-foreground" />
        </div>
        <span className="text-base font-bold text-foreground">
          Tools Palette
        </span>
      </div>

      {/* Search input */}
      <div className="px-3 py-2.5 border-b border-border">
        <SearchInput
          inputTestId="palette-search-input"
          clearTestId="palette-search-clear"
          size="sm"
          className="w-full"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {/* Scrollable content */}
      <PaletteExpandedContent searchQuery={searchQuery} />

      {/* Action buttons */}
      <div className="flex flex-col gap-1.5 p-3 border-t border-border">
        <NewFunctionHandle
          variant="expanded"
          testId="palette-new-block-button"
        />
        <Button
          data-testid="palette-blocks-library-button"
          variant="ghost"
          size="sm"
          onClick={onOpenFunctionLibrary}
          className="h-9 text-sm justify-start gap-2.5 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-500/10 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          <FunctionSquare className="h-5 w-5" />
          <span>Function Lib</span>
        </Button>
      </div>

      {/* Collapse button at bottom */}
      <div className="flex flex-col h-[49px]">
        <div className="h-px w-full bg-border shrink-0" />
        <div className="flex flex-1 items-center justify-end px-3">
          <Button
            variant="ghost"
            size="sm"
            data-testid="palette-collapse-button"
            onClick={onCollapse}
            className="h-7 w-7 p-0"
            aria-label="Collapse palette"
          >
            <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      </div>
    </div>
  )
}
