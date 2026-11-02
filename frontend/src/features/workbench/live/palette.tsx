/**
 * LivePalette - live-mode wrapper over `PalettePanel`.
 *
 * Owns the open/close state of the Functions Library modal so the palette
 * button (and its collapsed-strip icon counterpart) can toggle it without
 * lifting state into the workbench shell. The modal renders as a sibling and
 * is non-blocking, so the canvas behind stays interactive.
 */

import { useCallback } from 'react'

import { PalettePanel } from '@/features/workbench/common/palette'
import type { PalettePanelProps } from '@/features/workbench/common/palette/palette-types'
import { FunctionsLibraryModal } from '@/features/functions/library/functions-library-modal'
import { refocusSheet } from '@/components/shared/draggable-sheet'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

export type LivePaletteProps = Omit<PalettePanelProps, 'disabled' | 'onOpenFunctionLibrary'>

export function LivePalette(props: Readonly<LivePaletteProps>) {
  const isLibraryOpen = useWorkflowStore((s) => s.isFunctionLibraryOpen)
  const libraryInitialSearch = useWorkflowStore(
    (s) => s.functionLibraryInitialSearch,
  )
  const setLibraryOpen = useWorkflowStore((s) => s.setFunctionLibraryOpen)

  const handleOpenLibrary = useCallback(() => {
    // Reopen attempt: raise + pulse the open library instead of a no-op.
    if (useWorkflowStore.getState().isFunctionLibraryOpen) {
      refocusSheet('functions-library')
      return
    }
    // No pre-fill here; the Function Block window's From-library link opens it with a search seed.
    setLibraryOpen(true)
  }, [setLibraryOpen])

  const handleCloseLibrary = useCallback(() => {
    setLibraryOpen(false)
  }, [setLibraryOpen])

  return (
    <>
      <PalettePanel {...props} onOpenFunctionLibrary={handleOpenLibrary} />
      <FunctionsLibraryModal
        isOpen={isLibraryOpen}
        onClose={handleCloseLibrary}
        initialSearch={libraryInitialSearch}
      />
    </>
  )
}
