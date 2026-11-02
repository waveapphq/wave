/**
 * useFunctionView - boots the workbench into read-only library-View mode when
 * the URL carries `?viewFunction={id}&version={v}`.
 *
 * Stages a synthetic Shared root for the Function and drills into it via the
 * existing pushSharedDrill machinery, so the read-only chrome + drilled-Shared
 * canvas render the published body with no parent Test. Mirrors the `?editTest=`
 * detection in use-test-lifecycle.
 *
 * Opening a Function over unsaved work (a dirty Test or Function, or an active
 * execution) routes through the shared switch-confirm dialog instead of silently
 * discarding it; Discard/Save clears the dirty/exec state, which re-fires this
 * effect to perform the boot.
 */

import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

import { getFunctionVersion, isFunctionAbsent } from '@/features/functions/api/functions-api'
import type { GetVersionResult } from '@/features/functions/api/types'
import { libraryBody } from '@/features/functions/canvas/shared-function-body'
import { useWorkflowStore, type NodeType } from '@/features/workbench/stores/workflow-store'
import { startBlockingRead } from '@/hooks/use-blocking-reads'
import { usePageBlock } from '@/hooks/use-page-block'

const VIEW_ROOT_ID = 'view-shared-root'
const FUNCTION_BODY_LABEL = 'Function body'

export interface UseFunctionViewParams {
  /** True when the workbench has an active (non-idle) execution. */
  executionActive: boolean
  /** Show the shared switch-confirm dialog (unsaved-changes guard). */
  setShowSwitchDialog: (show: boolean) => void
  /** Clear any pending Test target so the dialog treats this as a Function open. */
  setPendingEditTestId: (id: string | null) => void
}

export function useFunctionView({
  executionActive,
  setShowSwitchDialog,
  setPendingEditTestId,
}: UseFunctionViewParams): void {
  const [searchParams] = useSearchParams()
  const viewFunctionId = searchParams.get('viewFunction')
  const version = searchParams.get('version') ?? ''
  const isDirty = useWorkflowStore((s) => s.isDirty)
  const { blockPage, clearPageBlock } = usePageBlock()
  // Boot once per id/version: pushSharedDrill appends, so a StrictMode
  // double-invoke (or a re-render) must not stack a second drill entry.
  const bootedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!viewFunctionId) return
    const key = `${viewFunctionId}@${version}`
    if (bootedKeyRef.current === key) return

    // Returning to the View that is already open keeps it, as reopening the open Test does.
    const { functionViewMode: open, nodes } = useWorkflowStore.getState()
    if (open?.functionId === viewFunctionId && open.version === version && nodes.length > 0) {
      bootedKeyRef.current = key
      return
    }

    // Unsaved work in the currently-open Test/Function (or an active execution)
    // must be resolved first - confirm instead of discarding it. Discard/Save
    // clears isDirty/executionActive, which re-fires this effect to boot.
    if (isDirty || executionActive) {
      setPendingEditTestId(null)
      setShowSwitchDialog(true)
      return
    }

    bootedKeyRef.current = key
    const store = useWorkflowStore.getState()
    store.reset()
    store.enterFunctionView({ functionId: viewFunctionId, version, editable: false })

    // A failed read would otherwise leave the read-only canvas empty with no
    // reason: the View is blocked instead, and its Try Again re-runs the read.
    startBlockingRead(
      {
        label: FUNCTION_BODY_LABEL,
        run: async () => {
          let read: GetVersionResult
          try {
            read = await getFunctionVersion(viewFunctionId, version)
          } catch (error_) {
            if (!isFunctionAbsent(error_)) throw error_
            // A 404 is an answer: stage the root stamped missing so the canvas alert and config sheet surface it.
            const missingRoot: NodeType = {
              id: VIEW_ROOT_ID,
              type: 'workflowNode',
              position: { x: 0, y: 0 },
              data: {
                label: 'Function',
                elementType: 'function',
                nodeType: 'function',
                functionLifecycle: 'shared',
                functionId: viewFunctionId,
                functionVersion: version,
                missingVersion: true,
              },
            }
            store.setNodes([missingRoot], { skipDirty: true })
            store.markSaved()
            store.requestFitView({ padding: 0.2, duration: 0 })
            clearPageBlock(FUNCTION_BODY_LABEL)
            return
          }
          const { definition } = read
          const root: NodeType = {
            id: VIEW_ROOT_ID,
            type: 'workflowNode',
            position: { x: 0, y: 0 },
            data: {
              label: definition.name,
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'shared',
              functionId: viewFunctionId,
              functionVersion: version,
            },
          }
          // Re-stamp with the resolved name so the switch-confirm dialog can label
          // this Function if the user later opens something else over dirty edits.
          store.enterFunctionView({
            functionId: viewFunctionId,
            version,
            editable: false,
            name: definition.name,
          })
          // skipDirty: the read-only View has no unsaved changes, so it must not
          // leave isDirty set (else the switch-test guard fires on the next test).
          store.setNodes([root], { skipDirty: true })
          const body = libraryBody(definition)
          store.pushSharedDrill(VIEW_ROOT_ID, body)
          // The loaded version is what the View's secrets compare to until the next publish.
          store.setFunctionViewBaseline({ nodeId: VIEW_ROOT_ID, body })
          // Re-baseline AFTER staging so the undo floor is the loaded published
          // body, never the empty canvas reset() left behind.
          store.markSaved()
          // The View owns its readiness: use-test-lifecycle no longer fits the
          // view in library-View mode, so clear the loading overlay here.
          store.requestFitView({ padding: 0.2, duration: 0 })
          clearPageBlock(FUNCTION_BODY_LABEL)
        },
      },
      blockPage,
    )
  }, [
    viewFunctionId,
    version,
    isDirty,
    executionActive,
    setShowSwitchDialog,
    setPendingEditTestId,
    blockPage,
    clearPageBlock,
  ])
}
