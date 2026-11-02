/**
 * useFileDrop Hook
 *
 * Manages window-level drag-and-drop file handling for a drop zone element.
 * Provides drag state tracking and event handlers that detect whether the
 * user is dragging over the referenced drop zone.
 */

import { useState, useEffect, useRef, useCallback, type RefObject } from 'react'

interface UseFileDropOptions {
  /** Called with the first dropped file */
  onFile?: (file: File) => void
  /** Called with every dropped file, in drop order */
  onFiles?: (files: File[]) => void
  /** Whether drag-and-drop is active. When false, listeners are not attached. */
  enabled?: boolean
}

interface UseFileDropResult<E extends HTMLElement = HTMLElement> {
  /** Whether the user is currently dragging over the drop zone */
  isDragging: boolean
  /** Ref to attach to the drop zone element */
  dropZoneRef: RefObject<E | null>
}

/**
 * Hook for window-level drag-and-drop file handling with zone detection.
 *
 * Attaches dragover, dragleave, and drop listeners to globalThis (capture phase)
 * and determines whether the drag target is inside the referenced drop zone.
 */
export function useFileDrop<E extends HTMLElement = HTMLElement>({
  onFile,
  onFiles,
  enabled = true,
}: UseFileDropOptions): UseFileDropResult<E> {
  const [isDragging, setIsDragging] = useState(false)
  const dropZoneRef = useRef<E | null>(null)
  // Keep a stable reference to the callbacks to avoid re-registering listeners
  const callbacksRef = useRef({ onFile, onFiles })
  callbacksRef.current = { onFile, onFiles }

  // preventDefault is what makes the page a drop target; the event must keep
  // propagating so a zone's own React onDragOver still sees it.
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    const zone = dropZoneRef.current
    if (zone?.contains(e.target as Node)) {
      setIsDragging(true)
    } else {
      setIsDragging(false)
    }
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    const zone = dropZoneRef.current
    if (zone && !zone.contains(e.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const zone = dropZoneRef.current
    if (!zone?.contains(e.target as Node)) return
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length === 0) return
    callbacksRef.current.onFile?.(files[0])
    callbacksRef.current.onFiles?.(files)
  }, [])

  useEffect(() => {
    if (!enabled) return

    globalThis.addEventListener('dragover', handleDragOver, true)
    globalThis.addEventListener('dragleave', handleDragLeave, true)
    globalThis.addEventListener('drop', handleDrop, true)
    return () => {
      globalThis.removeEventListener('dragover', handleDragOver, true)
      globalThis.removeEventListener('dragleave', handleDragLeave, true)
      globalThis.removeEventListener('drop', handleDrop, true)
      setIsDragging(false)
    }
  }, [enabled, handleDragOver, handleDragLeave, handleDrop])

  return { isDragging, dropZoneRef }
}
