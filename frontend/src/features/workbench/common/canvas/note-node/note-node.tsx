import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { Check, Copy, MoreVertical, Pencil, Scissors, Trash2, Unlink, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import {
  ContextMenu,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatShortcut } from '@/lib/platform'
import { getNoteColorPreset } from './note-color-presets'
import {
  NoteColorPicker,
  NoteContextMenuContent,
  type NoteAction,
} from './note-action-menus'

function NoteNodeComponent({ id, data, selected }: Readonly<NodeProps>) {
  const rawData = data
  const config = rawData.config as Record<string, unknown> | undefined
  const text = (config?.text as string) ?? ''
  const colorId = (config?.color as string) ?? 'slate'
  const preset = getNoteColorPreset(colorId)

  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(text)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const noteRef = useRef<HTMLDivElement>(null)

  const selectNode = useWorkflowStore((s) => s.selectNode)
  const updateNode = useWorkflowStore((s) => s.updateNode)
  const commitHistory = useWorkflowStore((s) => s.commitHistory)
  const deleteSelected = useWorkflowStore((s) => s.deleteSelected)
  const duplicateNodes = useWorkflowStore((s) => s.duplicate)
  const copyNodes = useWorkflowStore((s) => s.copy)
  const cutNodes = useWorkflowStore((s) => s.cut)
  const unlinkNode = useWorkflowStore((s) => s.unlinkNode)
  const edges = useWorkflowStore((s) => s.edges)
  const isExecuting = (rawData.isExecuting as boolean) ?? false

  const updateNodeInternals = useUpdateNodeInternals()
  const hasConnections = edges.some((e) => e.source === id || e.target === id)

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, isEditing, updateNodeInternals])

  const autoResize = useCallback(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${ta.scrollHeight}px`
    }
  }, [])

  useEffect(() => {
    if (!isEditing) {
      setEditText(text)
    }
  }, [text, isEditing])

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
      autoResize()
    }
  }, [isEditing, autoResize])

  const enterEditMode = useCallback(() => {
    if (isExecuting || isEditing) return
    setEditText(text)
    setIsEditing(true)
  }, [text, isExecuting, isEditing])

  const commitEdit = useCallback(() => {
    setIsEditing(false)
    if (editText !== text) {
      const nodeData = rawData as unknown as { label: string; config?: Record<string, unknown> }
      updateNode(id, { data: { ...nodeData, config: { ...config, text: editText } } })
      commitHistory('Edit note text')
    }
    // Restore focus to the note element so canvas-level keyboard shortcuts
    // (Backspace = unlink, Delete = remove) keep working without an extra click.
    noteRef.current?.focus()
  }, [editText, text, id, rawData, config, updateNode, commitHistory])

  const cancelEdit = useCallback(() => {
    setIsEditing(false)
    setEditText(text)
    noteRef.current?.focus()
  }, [text])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelEdit()
      }
    },
    [cancelEdit],
  )

  const handleColorChange = useCallback(
    (newColor: string) => {
      const nodeData = rawData as unknown as { label: string; config?: Record<string, unknown> }
      updateNode(id, { data: { ...nodeData, config: { ...config, color: newColor } } })
      commitHistory('Change note color')
      setColorPickerOpen(false)
    },
    [id, rawData, config, updateNode, commitHistory],
  )

  const handleAction = useCallback(
    (action: NoteAction) => {
      switch (action) {
        case 'duplicate':
          selectNode(id)
          duplicateNodes()
          break
        case 'copy':
          selectNode(id)
          copyNodes()
          break
        case 'cut':
          selectNode(id)
          cutNodes()
          break
        case 'unlink':
          if (unlinkNode) unlinkNode(id)
          break
        case 'delete':
          selectNode(id)
          requestAnimationFrame(() => deleteSelected())
          break
      }
    },
    [id, selectNode, duplicateNodes, copyNodes, cutNodes, unlinkNode, deleteSelected],
  )

  useEffect(() => {
    const el = noteRef.current
    /* v8 ignore next - COV-DEF-110 */
    if (!el) return
    el.tabIndex = 0
    el.setAttribute('role', 'button')
    el.setAttribute('aria-pressed', String(selected))
    const onClickHandler = (e: MouseEvent) => {
      if (e.target === el || el.contains(e.target as Node)) {
        const addToSelection = e.ctrlKey || e.metaKey
        if (addToSelection) {
          selectNode(id, { addToSelection: true })
        } else {
          selectNode(id)
        }
      }
    }
    const onKeyDownHandler = (e: KeyboardEvent) => {
      if (e.target !== el) return
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click() }
    }
    const onDblClickHandler = (e: MouseEvent) => {
      // React Flow zooms the canvas on dblclick by default; stop bubbling so the
      // Note's own action (enter edit mode) is the only thing that fires.
      e.stopPropagation()
      e.preventDefault()
      enterEditMode()
    }
    const onCtxMenuHandler = (e: Event) => {
      if (isEditing) { e.preventDefault(); return }
      if (!selected) selectNode(id)
    }
    el.addEventListener('click', onClickHandler)
    el.addEventListener('keydown', onKeyDownHandler)
    el.addEventListener('dblclick', onDblClickHandler)
    el.addEventListener('contextmenu', onCtxMenuHandler)
    return () => {
      el.removeEventListener('click', onClickHandler)
      el.removeEventListener('keydown', onKeyDownHandler)
      el.removeEventListener('dblclick', onDblClickHandler)
      el.removeEventListener('contextmenu', onCtxMenuHandler)
    }
  }, [selected, selectNode, id, enterEditMode, isEditing])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={noteRef}
          data-testid={`note-node-${id}`}
          aria-label="Note"
          className={cn(
            'relative rounded-lg flex flex-col h-full text-left',
            'min-w-[120px] min-h-[60px]',
            'transition-shadow duration-150 cursor-pointer',
            'focus:outline-none focus-visible:outline-none',
          )}
        >
          {selected && !isEditing && (
            <div
              className="absolute top-0 left-0 right-0 bottom-0 pointer-events-none rounded-lg z-[1] outline outline-2 outline-dashed outline-white outline-offset-[4px]"
            />
          )}

          <Handle
            type="target"
            position={Position.Top}
            data-testid="note-handle-input"
            className="!w-4 !h-2 !rounded-full !bg-zinc-600 !border-0 hover:!ring-2 hover:!ring-zinc-400 transition-shadow !z-10"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            data-testid="note-handle-output"
            className="!w-4 !h-2 !rounded-full !bg-zinc-600 !border-0 hover:!ring-2 hover:!ring-zinc-400 transition-shadow !z-10"
          />

          <div
            data-edit-border={isEditing ? 'true' : undefined}
            className={cn(
              'relative px-3 py-2 flex-1 flex flex-col overflow-hidden rounded-t-lg',
              isEditing
                ? 'border-2 border-solid border-blue-500'
                : cn('border border-dashed', preset.border, preset.darkBorder),
              preset.bg, preset.darkBg,
            )}
          >
            <div className="flex-1 w-full overflow-auto nowheel">
              {isEditing ? (
                <textarea
                  ref={textareaRef}
                  className={cn(
                    'w-full resize-none bg-transparent outline-none border-0',
                    'text-sm text-foreground placeholder:text-muted-foreground/60',
                    'px-0 py-0 nowheel nodrag',
                  )}
                  value={editText}
                  onChange={(e) => {
                    setEditText(e.target.value)
                    autoResize()
                  }}
                  onKeyDown={handleKeyDown}
                  onContextMenu={(e) => e.stopPropagation()}
                  placeholder="Add your note here…"
                  data-testid="note-text-editor"
                />
              ) : (
                <p
                  className={cn(
                    'text-sm whitespace-pre-wrap break-words leading-relaxed',
                    text ? 'text-foreground' : 'text-muted-foreground/60 italic',
                  )}
                  data-testid="note-text-display"
                >
                  {text || 'Add your note here…'}
                </p>
              )}
            </div>
          </div>

          <div
            data-testid="node-status-bar"
            data-slim="true"
            className={cn(
              'flex items-center justify-between gap-2 px-2 h-8',
              isEditing
                ? 'border-x-2 border-b-2 border-solid border-blue-500 rounded-b-lg bg-card'
                : cn('border border-t-0 border-dashed rounded-b-lg bg-card', preset.border, preset.darkBorder),
            )}
          >
            <div data-testid="node-status-bar-left" className="flex items-center gap-1 min-w-0">
              {isEditing && (
                <NoteColorPicker
                  preset={preset}
                  colorPickerOpen={colorPickerOpen}
                  onOpenChange={setColorPickerOpen}
                  onColorChange={handleColorChange}
                />
              )}
            </div>
            <div data-testid="node-status-bar-right" className="flex items-center gap-0.5">
              {isEditing ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-green-500 hover:text-green-600"
                    onClick={commitEdit}
                    aria-label="Accept"
                    data-testid="note-edit-accept"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-destructive hover:text-destructive/80"
                    onClick={cancelEdit}
                    aria-label="Cancel"
                    data-testid="note-edit-cancel"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-testid="node-kebab"
                      aria-label="More options"
                      className="inline-flex items-center justify-center h-5 w-5 rounded-md cursor-pointer transition-colors hover:bg-accent/50"
                    >
                      <MoreVertical className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                      onSelect={() => enterEditMode()}
                      disabled={isExecuting}
                      data-testid="note-action-edit"
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => handleAction('duplicate')} disabled={isExecuting} data-testid="note-action-duplicate">
                      <Copy className="h-4 w-4 mr-2" />
                      Duplicate
                      <span className="ml-auto pl-4 text-xs text-muted-foreground">{formatShortcut('D')}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleAction('copy')} disabled={isExecuting} data-testid="note-action-copy">
                      <Copy className="h-4 w-4 mr-2" />
                      Copy
                      <span className="ml-auto pl-4 text-xs text-muted-foreground">{formatShortcut('C')}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleAction('cut')} disabled={isExecuting} data-testid="note-action-cut">
                      <Scissors className="h-4 w-4 mr-2" />
                      Cut
                      <span className="ml-auto pl-4 text-xs text-muted-foreground">{formatShortcut('X')}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => handleAction('unlink')}
                      disabled={!hasConnections || isExecuting}
                      data-testid="note-action-unlink"
                    >
                      <Unlink className="h-4 w-4 mr-2" />
                      Unlink
                      <span className="ml-auto pl-4 text-xs text-muted-foreground">Backspace</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => handleAction('delete')}
                      disabled={isExecuting}
                      className="text-destructive focus:text-destructive"
                      data-testid="note-action-delete"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                      <span className="ml-auto pl-4 text-xs text-muted-foreground">Del</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          <NodeResizer
            minWidth={120}
            minHeight={60}
            isVisible={!!selected || isEditing}
            lineClassName="!border-[3px] !border-transparent !z-20"
            handleClassName="!w-5 !h-5 !opacity-0 !z-20"
          />
        </div>
      </ContextMenuTrigger>

      <NoteContextMenuContent
        isExecuting={isExecuting}
        hasConnections={hasConnections}
        onAction={handleAction}
      />
    </ContextMenu>
  )
}

export const NoteNode = memo(NoteNodeComponent)
