/** Store-connected wrapper over ActionBarReadonlyChrome: gates rendering on
 *  drilled-into-Shared, wires Edit Function (BE or in-memory fallback) and
 *  Drop changes. */

import { useCallback } from 'react'

import { useToast } from '@/components/ui/toast'
import { getFunctionVersion } from '@/features/functions/api/functions-api'
import { buildEditModeDraft } from '@/features/functions/lib/edit-mode-draft'
import { canvasFunctionBody } from '@/features/workbench/lib/canonical-workflow'
import { reportFunctionBodyFailure } from '@/features/functions/lib/function-body-report'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

import { ActionBarReadonlyChrome } from './action-bar-readonly-chrome'
import { useDrilledSharedInfo, type DrilledSharedInfo } from '../use-readonly-canvas'

export function DrilledSharedChrome() {
  const info = useDrilledSharedInfo()
  if (!info) return null
  return <DrilledSharedChromeInner info={info} />
}

function DrilledSharedChromeInner({ info }: Readonly<{ info: DrilledSharedInfo }>) {
  const applyEditModeEntered = useWorkflowStore((s) => s.applyEditModeEntered)
  const openDropChangesDialog = useWorkflowStore((s) => s.openDropChangesDialog)
  const openPublishEditModeDialog = useWorkflowStore((s) => s.openPublishEditModeDialog)
  const nodes = useWorkflowStore((s) => s.nodes)
  const { error: toastError } = useToast()

  const handleEditFunction = useCallback(() => {
    const findShared = (
      list: { id: string; data?: Record<string, unknown> }[],
    ): { id: string; data: Record<string, unknown> } | null => {
      for (const node of list) {
        if (node.id === info.nodeId) {
          return { id: node.id, data: node.data ?? {} }
        }
        const localDef = node.data?.localDefinition as
          | { workflow?: { nodes: { id: string; data?: Record<string, unknown> }[] } }
          | undefined
        if (localDef?.workflow?.nodes) {
          const inner = findShared(localDef.workflow.nodes)
          if (inner) return inner
        }
      }
      return null
    }
    const found = findShared(nodes as unknown as { id: string; data?: Record<string, unknown> }[])
    if (!found) return
    const data = found.data
    const functionId = data.functionId as string | undefined
    const sourceVersion =
      info.sourceVersion ?? (data.functionVersion as string | undefined)
    if (!functionId) return
    const nodeId = info.nodeId
    // Edit-mode entry is client-side - build the draft from the pinned
    // version. The draft persists only when the Test is saved.
    if (!sourceVersion) return
    void getFunctionVersion(functionId, sourceVersion)
      .then(({ definition }) => {
        applyEditModeEntered(
          nodeId,
          {
            ...data,
            editMode: true,
            upstreamLink: { functionId, sourceVersion },
            draft: canvasFunctionBody(buildEditModeDraft(definition)),
          },
          false,
        )
      })
      .catch((err: unknown) => reportFunctionBodyFailure(toastError, err))
  }, [info, applyEditModeEntered, nodes, toastError])

  const handleDropChanges = useCallback(() => {
    openDropChangesDialog(info.nodeId)
  }, [info, openDropChangesDialog])

  const handlePublish = useCallback(() => {
    openPublishEditModeDialog(info.nodeId)
  }, [info, openPublishEditModeDialog])

  return (
    <ActionBarReadonlyChrome
      editMode={info.editMode}
      onEditFunction={handleEditFunction}
      onDropChanges={handleDropChanges}
      onPublish={handlePublish}
    />
  )
}
