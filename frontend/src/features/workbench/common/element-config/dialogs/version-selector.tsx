/**
 * VersionSelector Component - V-CANVAS-12 Config Modal Header
 *
 * Version dropdown for selecting plugin/block versions in config modal.
 * - CANVAS-125: Header: Element name + version dropdown
 */

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConditionalTooltip } from '@/components/ui/tooltip'

interface VersionSelectorProps {
  currentVersion: string
  availableVersions: string[]
  onVersionChange: (version: string) => void
  /** Freezes the selector (used by the read-only history canvas). */
  disabled?: boolean
}

export function VersionSelector({
  currentVersion,
  availableVersions,
  onVersionChange,
  disabled = false,
}: Readonly<VersionSelectorProps>) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Check if there's a newer version available
  const latestVersion = availableVersions[0]
  const hasNewerVersion = currentVersion !== latestVersion

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleToggle = () => {
    setIsOpen(!isOpen)
  }

  const handleSelect = (version: string) => {
    onVersionChange(version)
    setIsOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        data-testid="version-selector"
        onClick={handleToggle}
        disabled={disabled}
        className={cn(
          'flex items-center justify-between gap-2 px-3 py-1.5 rounded-md text-sm font-medium min-w-[100px]',
          'border border-border bg-background hover:bg-accent cursor-pointer',
          disabled && 'opacity-60 cursor-not-allowed hover:bg-background'
        )}
      >
        <div className="flex items-center gap-1.5">
          <span>{currentVersion}</span>
          {hasNewerVersion && (
            <ConditionalTooltip content="Newer version available">
              <span data-testid="version-update-available">
                <ArrowUp className="h-3 w-3 text-green-500" />
              </span>
            </ConditionalTooltip>
          )}
        </div>
        <ChevronDown
          data-testid="version-dropdown-icon"
          className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {isOpen && (
        <ul
          className="absolute top-full right-0 mt-1 z-50 min-w-[140px] bg-popover border border-border rounded-md shadow-md py-1 overflow-hidden list-none m-0 p-0"
        >
          {availableVersions.map((version) => {
            const isCurrent = version === currentVersion

            return (
              <li key={version}>
                <button
                  type="button"
                  aria-current={isCurrent || undefined}
                  onClick={() => handleSelect(version)}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left',
                    'hover:bg-accent focus:bg-accent outline-none',
                    isCurrent && 'bg-accent/50'
                  )}
                >
                  <span>{version}</span>
                  {isCurrent && (
                    <span className="text-xs text-muted-foreground" aria-hidden="true">Current</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
