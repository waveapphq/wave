/**
 * DragPreview Component - REQ-3.1.1.1 Drag-and-drop interface for block arrangement
 *
 * Visual feedback during drag operations. The preview follows the cursor with:
 * - 50% opacity
 * - 1.02× scale (unless reduced motion is preferred)
 * - Cursor offset to prevent preview from being under cursor
 * - Invalid target indication
 */

import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface Position {
  x: number
  y: number
}

interface BlockData {
  id: string
  name: string
  icon: string
  type?: string
}

interface DragPreviewProps {
  isDragging: boolean
  position: Position
  blockData: BlockData
  cursorOffset?: Position
  isOverInvalidTarget?: boolean
}

/**
 * Icon component for block icons
 */
function BlockIcon({
  icon,
  className,
}: Readonly<{
  icon: string
  className?: string
}>) {
  // Simple icon rendering - in production this would use an icon library
  const iconMap: Record<string, string> = {
    terminal: '▶',
    code: '{ }',
    file: '📄',
    box: '📦',
    settings: '⚙️',
    lock: '🔒',
    globe: '🌐',
    'git-branch': '⎇',
    'git-fork': '⑂',
    shield: '🛡️',
  }

  return (
    <span
      data-testid="drag-preview-icon"
      className={cn('flex items-center justify-center w-5 h-5 text-sm', className)}
      aria-hidden="true"
    >
      {iconMap[icon] ?? '●'}
    </span>
  )
}

/**
 * Check if reduced motion is preferred
 */
function prefersReducedMotion(): boolean {
  /* v8 ignore next - COV-SSR-003 */
  if (globalThis.window === undefined) return false
  /* v8 ignore next - COV-JSDOM-019 */
  return globalThis.window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
}

/**
 * Drag preview component that follows the cursor during drag operations
 */
export function DragPreview({
  isDragging,
  position,
  blockData,
  cursorOffset = { x: 0, y: 0 },
  isOverInvalidTarget = false,
}: Readonly<DragPreviewProps>) {
  const reducedMotion = prefersReducedMotion()

  // Calculate transform with position offset and optional scale
  const transform = useMemo(() => {
    const x = position.x + cursorOffset.x
    const y = position.y + cursorOffset.y

    if (reducedMotion) {
      return `translate(${x}px, ${y}px)`
    }
    return `translate(${x}px, ${y}px) scale(1.02)`
  }, [position, cursorOffset, reducedMotion])

  // Don't render if not dragging
  if (!isDragging) {
    return null
  }

  // Calculate opacity based on invalid target state
  const opacity = isOverInvalidTarget ? 0.3 : 0.5

  return (
    <div
      data-testid="drag-preview"
      data-invalid-target={isOverInvalidTarget ? 'true' : undefined}
      data-block-type={blockData.type}
      className={cn(
        'flex items-center gap-2 px-3 py-2',
        'bg-bg-elevated border border-border-default rounded-md shadow-lg',
        'text-sm font-medium text-text-primary'
      )}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        transform,
        opacity,
        pointerEvents: 'none',
        zIndex: 1000,
        cursor: isOverInvalidTarget ? 'not-allowed' : undefined,
      }}
      aria-hidden="true"
    >
      <BlockIcon icon={blockData.icon} />
      <span>{blockData.name}</span>

      {/* Invalid drop indicator */}
      {isOverInvalidTarget && (
        <span
          data-testid="invalid-drop-indicator"
          className="ml-1 text-destructive"
          aria-hidden="true"
        >
          ✕
        </span>
      )}
    </div>
  )
}

/**
 * Portal wrapper for DragPreview to render outside component tree
 */
export function DragPreviewPortal(props: Readonly<DragPreviewProps>) {
  // Render in a portal to ensure preview appears above all other content
  return createPortal(<DragPreview {...props} />, document.body)
}
