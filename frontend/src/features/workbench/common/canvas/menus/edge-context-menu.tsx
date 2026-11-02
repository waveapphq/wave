/**
 * EdgeContextMenu Component
 *
 * Positioned menu shown on right-clicking an edge (connection).
 * Offers edge type selection (Bezier, Smoothstep, Step, Straight) and Delete.
 */

import { useEffect, useRef } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

const EDGE_TYPES = [
  { label: 'Bezier', value: 'default' },
  { label: 'Smoothstep', value: 'smoothstep' },
  { label: 'Step', value: 'step' },
  { label: 'Straight', value: 'straight' },
] as const

interface EdgeContextMenuProps {
  open: boolean
  position: { x: number; y: number }
  edgeId: string
  edgeType: string
  onClose: () => void
}

export function EdgeContextMenu({ open, position, edgeId, edgeType, onClose }: Readonly<EdgeContextMenuProps>) {
  const removeEdge = useWorkflowStore((state) => state.removeEdge)
  const updateEdgeType = useWorkflowStore((state) => state.updateEdgeType)
  const menuRef = useRef<HTMLDivElement>(null)

  // Normalize: undefined, empty string, and "default" all mean Bezier
  const activeType = edgeType || 'default'

  // Close on any click outside the menu
  useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    // Use capture phase so it fires before React Flow's own click handlers
    document.addEventListener('mousedown', handleClickOutside, true)
    return () => document.removeEventListener('mousedown', handleClickOutside, true)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 min-w-[8rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: position.x, top: position.y }}
    >
      {EDGE_TYPES.map(({ label, value }) => (
        <button
          key={value}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground w-full text-left bg-transparent border-0"
          onClick={() => {
            updateEdgeType(edgeId, value)
            onClose()
          }}
        >
          <span className="inline-flex w-4 mr-2 justify-center">
            {activeType === value && <Check className="h-4 w-4" />}
          </span>
          {label}
        </button>
      ))}
      <div className="my-1 h-px bg-border" />
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground text-destructive w-full text-left bg-transparent border-0"
        onClick={() => {
          removeEdge(edgeId)
          onClose()
        }}
      >
        <Trash2 className="h-4 w-4 mr-2" />
        Delete
        <span aria-hidden="true" className="ml-auto pl-4 text-xs text-muted-foreground">Del</span>
      </button>
    </div>
  )
}
