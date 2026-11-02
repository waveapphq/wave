/** Publish and Make Local dialog wiring for a saved Test or a draft canvas. */

import { useContext, useMemo, useRef, useState } from 'react'

import {
  addFunctionVersion,
  createFunction,
  detachPublishedInstance,
  getFunctionVersion,
  publishLocalFunction,
} from '@/features/functions/api/functions-api'
import { useFunctionsStore } from '@/features/functions/stores/functions-store'
import { useFunctionVersions } from '@/features/functions/hooks/use-function-versions'
import {
  foldLocalDefinitionIntoDraft,
  type LocalDefinitionBody,
} from '@/features/functions/lib/edit-mode-draft'
import type {
  DetachFunctionResult,
  FunctionDependencies,
  FunctionInput,
  FunctionOutput,
  FunctionVariable,
  FunctionWorkflow,
  PublishFunctionPayload,
} from '@/features/functions/api/types'
import {
  canvasFunctionBody,
  canvasLocalFunctionBodies,
  storedFunctionBody,
} from '@/features/workbench/lib/canonical-workflow'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { runBlockingRead } from '@/hooks/use-blocking-reads'
import { usePageBlock } from '@/hooks/use-page-block'

import { ToastContext } from '@/components/ui/toast'

import { MakeLocalDialog } from './make-local-dialog'
import { PublishDialog } from './publish-dialog'
import { DropChangesDialog } from './drop-changes-dialog'
import { PublishEditModeDialog } from './publish-edit-mode-dialog'
import type { EditModeOutcomeRequest } from './publish-edit-mode-dialog'
import { PublishOutcomeDialog } from './publish-outcome-dialog'
import { fetchSharedDefinition, libraryBody, publishedDraftBody } from './shared-function-body'

const FUNCTION_BODY_LABEL = 'Function body'

type ActiveNode = {
  id: string
  data: Record<string, unknown>
} & Record<string, unknown>

/** Deep-search for a node by id (top-level + nested localDefinition.workflow.nodes).
 *  Returns the actual node reference (not wrapped) to keep zustand identity stable. */
function findNodeAnywhere(
  nodes: { id: string; data?: Record<string, unknown> }[],
  id: string,
): ActiveNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node as ActiveNode
    }
    const localDef = node.data?.localDefinition as
      | { workflow?: { nodes: { id: string; data?: Record<string, unknown> }[] } }
      | undefined
    if (localDef?.workflow?.nodes) {
      const inner = findNodeAnywhere(localDef.workflow.nodes, id)
      if (inner) return inner
    }
  }
  return null
}

function readLocalDefinition(activeNode: ActiveNode): {
  inputs: FunctionInput[]
  outputs: FunctionOutput[]
  dependencies: FunctionDependencies
  workflow: FunctionWorkflow
  variables?: FunctionVariable[]
} | null {
  const localDef = activeNode.data.localDefinition as
    | {
        inputs?: FunctionInput[]
        outputs?: FunctionOutput[]
        dependencies?: FunctionDependencies
        workflow?: FunctionWorkflow
        variables?: unknown[]
      }
    | undefined
  if (!localDef) return null
  const stored = storedFunctionBody({
    workflow: localDef.workflow ?? { nodes: [], edges: [] },
    variables: localDef.variables,
  })
  return {
    inputs: localDef.inputs ?? [],
    outputs: localDef.outputs ?? [],
    dependencies: localDef.dependencies ?? { functions: [], plugins: [] },
    workflow: stored.workflow,
    variables: stored.variables as FunctionVariable[] | undefined,
  }
}

/** Keeps a dialog's last subject through its close animation, so its modal layer ends after the menu that opened it. */
function useHeldThroughClose<T>(value: T | null): T | null {
  const [held, setHeld] = useState(value)
  if (value !== null && value !== held) setHeld(value)
  return held
}

export function FunctionLifecycleDialogs() {
  const publishDialogNodeId = useWorkflowStore((s) => s.publishDialogNodeId)
  const makeLocalDialogNodeId = useWorkflowStore((s) => s.makeLocalDialogNodeId)
  const publishEditModeDialogNodeId = useWorkflowStore(
    (s) => s.publishEditModeDialogNodeId,
  )
  const dropChangesDialogNodeId = useWorkflowStore((s) => s.dropChangesDialogNodeId)
  const closePublishDialog = useWorkflowStore((s) => s.closePublishDialog)
  const closeMakeLocalDialog = useWorkflowStore((s) => s.closeMakeLocalDialog)
  const closePublishEditModeDialog = useWorkflowStore(
    (s) => s.closePublishEditModeDialog,
  )
  const closeDropChangesDialog = useWorkflowStore((s) => s.closeDropChangesDialog)
  const applyEditModeDropped = useWorkflowStore((s) => s.applyEditModeDropped)
  const applyEditModePublished = useWorkflowStore((s) => s.applyEditModePublished)
  const applyMakeLocal = useWorkflowStore((s) => s.applyMakeLocal)
  const applyFirstPublish = useWorkflowStore((s) => s.applyFirstPublish)
  const editingTestId = useWorkflowStore((s) => s.editingTestId)
  const isDirty = useWorkflowStore((s) => s.isDirty)
  const functionViewMode = useWorkflowStore((s) => s.functionViewMode)
  const { blockPage, clearPageBlock } = usePageBlock()

  // Three-option outcome dialog state: the edit-mode publish payload the
  // dialog collected, plus the in-flight + error state of the chosen outcome.
  const [outcomePayload, setOutcomePayload] = useState<EditModeOutcomeRequest | null>(null)
  const [outcomePending, setOutcomePending] = useState(false)
  const [outcomeError, setOutcomeError] = useState<string | null>(null)

  // The backend's atomic publish/detach routes mutate both the Test and the
  // library entry by reading the node from the saved Test. When the canvas
  // workflow is dirty (the node was added or moved since the last save) the
  // backend doesn't know about the node yet and returns 404. In that case
  // (and in draft mode) we fall back to the in-memory path: create/fetch the
  // library entry, rewrite the canvas node locally, and leave the Test dirty
  // for the user to save when they're ready.
  const useInMemoryPath = !editingTestId || isDirty

  // Deep-search rather than walkActiveSubtree: dialogs may target a Shared whose body the user is drilled into.
  const activeNode = useWorkflowStore((s) => {
    const id =
      s.publishDialogNodeId ??
      s.makeLocalDialogNodeId ??
      s.publishEditModeDialogNodeId ??
      s.dropChangesDialogNodeId
    if (!id) return null
    return findNodeAnywhere(
      s.nodes as unknown as { id: string; data?: Record<string, unknown> }[],
      id,
    )
  })

  // Source-version metadata that pre-fills the edit-mode publish dialog.
  const editModeFunctionId =
    publishEditModeDialogNodeId && activeNode
      ? (activeNode.data?.functionId as string | undefined)
      : undefined
  const {
    versions: editModeVersions,
    failed: editModeVersionsFailed,
    retry: retryEditModeVersions,
  } = useFunctionVersions(editModeFunctionId ?? '')
  // The publish dialog pre-fills from this read, so its failure reports there.
  const sourceMetadataRead = useMemo(
    () => ({ failed: editModeVersionsFailed, retry: retryEditModeVersions }),
    [editModeVersionsFailed, retryEditModeVersions],
  )

  const localFunction = useMemo(() => {
    if (!publishDialogNodeId || !activeNode) return null
    const label = activeNode.data?.label as string | undefined
    return {
      testId: editingTestId ?? '',
      nodeId: publishDialogNodeId,
      suggestedName: label ?? '',
    }
  }, [publishDialogNodeId, editingTestId, activeNode])
  const shownLocalFunction = useHeldThroughClose(localFunction)

  const publishedRef = useMemo(() => {
    if (!makeLocalDialogNodeId || !activeNode) return null
    const fid = activeNode.data?.functionId as string | undefined
    const label = activeNode.data?.label as string | undefined
    if (!fid) return null
    return {
      testId: editingTestId ?? '',
      nodeId: makeLocalDialogNodeId,
      functionId: fid,
      functionName: label ?? 'Function',
    }
  }, [makeLocalDialogNodeId, editingTestId, activeNode])
  const shownPublishedRef = useHeldThroughClose(publishedRef)

  // Stash the just-submitted name + version so handlePublished can stamp them onto the now-shared node.
  const lastPublishedNameRef = useRef<string | null>(null)
  const lastPublishedVersionRef = useRef<string | null>(null)
  // Null-tolerant: quick-add uses the same pattern; tests may mount bare.
  const toast = useContext(ToastContext)

  const handlePublishSubmit = async (payload: PublishFunctionPayload) => {
    const nodeId = publishDialogNodeId as string
    const node = activeNode as ActiveNode
    lastPublishedNameRef.current = payload.name
    lastPublishedVersionRef.current = payload.version ?? '1.0.0'
    if (!useInMemoryPath && editingTestId) {
      const result = await publishLocalFunction(editingTestId, nodeId, payload)
      return { function_id: result.function_id }
    }
    // Draft canvas, or saved Test with unsaved canvas changes: create the
    // library entry from the in-memory local body. The parent rewrites the
    // canvas node; the user saves the Test when ready.
    const localDef = readLocalDefinition(node)
    if (!localDef) {
      throw new Error('Local Function definition is missing')
    }
    const created = await createFunction({
      name: payload.name,
      description: payload.description,
      tags: payload.tags,
      inputs: localDef.inputs,
      outputs: localDef.outputs,
      dependencies: localDef.dependencies,
      workflow: localDef.workflow,
      // The body's local variables publish with it (REQ-3.1.2.1).
      variables: localDef.variables,
      // Match the version stamped on the node, else the library reads back as a MISSING pin.
      version: payload.version,
    })
    return { function_id: created.definition.id }
  }

  const handlePublished = (functionId: string) => {
    const nodeId = publishDialogNodeId as string
    const node = activeNode as ActiveNode
    const nextData: Record<string, unknown> = { ...node.data }
    nextData.functionLifecycle = 'shared'
    nextData.functionId = functionId
    if (lastPublishedVersionRef.current) {
      nextData.functionVersion = lastPublishedVersionRef.current
    }
    if (lastPublishedNameRef.current) {
      nextData.originalLibraryName = lastPublishedNameRef.current
    }
    delete nextData.localDefinition
    // First publish: in-store pick-out surgery, no undoable conversion entry.
    applyFirstPublish(nodeId, nextData)
    useFunctionsStore.getState().invalidate()
    // Tell any open Functions Library modal that the catalog changed -
    // an open modal effects on this revision counter and re-fetches its
    // list automatically (no stale view after a fresh publish).
    useWorkflowStore.getState().bumpFunctionLibraryRevision()
    // Both refs are stamped in handlePublishSubmit before this callback runs.
    const publishedName = lastPublishedNameRef.current as string
    const publishedVersion = lastPublishedVersionRef.current as string
    toast?.success(`'${publishedName}' v${publishedVersion} published to the Function Library`)
    lastPublishedNameRef.current = null
    lastPublishedVersionRef.current = null
  }

  const handleDetachConfirm = async (): Promise<DetachFunctionResult['node']> => {
    // The dialog is only rendered when `makeLocalDialogNodeId`,
    // `activeNode`, and `publishedRef.functionId` are all present (see the
    // `publishedRef` computation above), so we can safely treat them as
    // non-null here.
    const nodeId = makeLocalDialogNodeId as string
    const node = activeNode as ActiveNode
    const ref = publishedRef as NonNullable<typeof publishedRef>
    if (!useInMemoryPath && editingTestId) {
      const result = await detachPublishedInstance(editingTestId, nodeId)
      return canvasLocalFunctionBodies([result.node])[0]
    }
    // Draft canvas or unsaved Test: copy the pinned version into the node; the library is untouched.
    const definition = await fetchSharedDefinition(
      ref.functionId,
      node.data.functionVersion as string | undefined,
    )
    const localDefinition = canvasFunctionBody({
      name: definition.name,
      description: definition.description,
      tags: definition.tags,
      inputs: definition.inputs,
      outputs: definition.outputs,
      dependencies: definition.dependencies,
      workflow: definition.workflow,
      variables: definition.variables,
    })
    const newData = { ...node.data }
    delete (newData as Record<string, unknown>).functionId
    newData.functionLifecycle = 'local'
    newData.localDefinition = localDefinition
    return { id: nodeId, data: newData as Record<string, unknown> }
  }

  const handleDetached = (node: DetachFunctionResult['node']) => {
    // Mirrors `handlePublished`: only fires after a successful detach so
    // both state fields are guaranteed non-null at this point.
    const nodeId = makeLocalDialogNodeId as string
    const active = activeNode as ActiveNode
    const incoming = node.data
    const label = (incoming.label as string | undefined) ?? (active.data.label as string)
    const nextData = {
      ...active.data,
      ...incoming,
      label,
    }
    // Shared-to-local rewrite with exactly ONE undoable entry.
    applyMakeLocal(nodeId, nextData)
  }

  const editModeInstance = useMemo(() => {
    if (!publishEditModeDialogNodeId || !activeNode) return null
    const fid = activeNode.data?.functionId as string | undefined
    const sourceVersion =
      (activeNode.data?.upstreamLink as { sourceVersion?: string } | undefined)
        ?.sourceVersion ??
      (activeNode.data?.functionVersion as string | undefined) ??
      '1.0.0'
    const rawDraft = activeNode.data?.draft as Record<string, unknown> | undefined
    const label = (activeNode.data?.label as string | undefined) ?? 'Function'
    if (!fid || !rawDraft) return null
    // Publishing while drilled into the edit-mode body (library View, or the
    // in-Test drilled-in chrome Publish): the live edits live in localDefinition
    // because the fold-on-pop never ran. Fold them into the draft so the new
    // version body AND the bump-level check reflect the edits.
    const localDef = activeNode.data?.localDefinition as LocalDefinitionBody | undefined
    const draft = storedFunctionBody(localDef ? foldLocalDefinitionIntoDraft(rawDraft, localDef) : rawDraft)
    const src = editModeVersions.find((v) => v.version === sourceVersion)
    // The currently-pinned contract backs keep-old binding reconciliation.
    const resolvedInputs = activeNode.data?.resolvedInputs as { name: string }[] | undefined
    const resolvedOutputs = activeNode.data?.resolvedOutputs as { name: string }[] | undefined
    return {
      testId: editingTestId ?? '',
      nodeId: publishEditModeDialogNodeId,
      functionId: fid,
      functionName: label,
      sourceVersion,
      draft,
      pinnedContract:
        resolvedInputs || resolvedOutputs
          ? { inputs: resolvedInputs ?? [], outputs: resolvedOutputs ?? [] }
          : undefined,
      sourceMetadata: src
        ? { description: src.description, tags: src.tags, details: src.details }
        : undefined,
    }
  }, [publishEditModeDialogNodeId, editingTestId, activeNode, editModeVersions])

  const dropChangesRef = useMemo(() => {
    if (!dropChangesDialogNodeId || !activeNode) return null
    const sourceVersion =
      (activeNode.data?.upstreamLink as { sourceVersion?: string } | undefined)
        ?.sourceVersion ??
      (activeNode.data?.functionVersion as string | undefined) ??
      '1.0.0'
    const label = (activeNode.data?.label as string | undefined) ?? 'Function'
    return {
      nodeId: dropChangesDialogNodeId,
      functionName: label,
      sourceVersion,
      // Captured here (activeNode is guaranteed non-null) so the confirm
      // handler never needs to re-null-check activeNode.
      nodeData: activeNode.data,
    }
  }, [dropChangesDialogNodeId, activeNode])
  const shownDropChangesRef = useHeldThroughClose(dropChangesRef)

  const handleDropChangesConfirm = (ref: NonNullable<typeof dropChangesRef>): void => {
    // Drop is client-side - strip the edit-mode markers in-memory so the
    // user keeps editing without a BE round-trip. The Test save flow rehydrates
    // the canonical node shape on save. The store-side surgery reconciles the
    // drill location to the nearest valid ancestor.
    const fid = ref.nodeData.functionId as string | undefined
    const wasDrilledIntoTarget =
      useWorkflowStore.getState().drillPath.at(-1)?.nodeId === ref.nodeId
    const cleaned = { ...ref.nodeData }
    delete cleaned.editMode
    delete cleaned.upstreamLink
    delete cleaned.draft
    applyEditModeDropped(ref.nodeId, cleaned)
    // Library View: the synthetic root scope must stay open - re-drill into
    // the reverted published body.
    if (fid && wasDrilledIntoTarget && functionViewMode) {
      // The block card is the report; rethrowing would also fail the drop, which succeeded.
      runBlockingRead(
        {
          label: FUNCTION_BODY_LABEL,
          run: async () => {
            const { definition } = await getFunctionVersion(fid, ref.sourceVersion)
            useWorkflowStore.getState().pushSharedDrill(ref.nodeId, libraryBody(definition))
            clearPageBlock(FUNCTION_BODY_LABEL)
          },
        },
        blockPage,
      ).catch(() => {})
    }
  }

  const handleRequestOutcome = (payload: EditModeOutcomeRequest) => {
    // The edit-mode dialog collected the metadata; open the three-option outcome
    // confirmation. The publish itself runs on the chosen outcome.
    setOutcomeError(null)
    setOutcomePending(false)
    setOutcomePayload(payload)
  }

  const closeOutcome = () => {
    setOutcomePayload(null)
    setOutcomePending(false)
    setOutcomeError(null)
  }

  /** A publish that failed is named on the outcome dialog's own error line. */
  const reportOutcomeFailure = (err: unknown): void => {
    setOutcomeError((err as { message?: string })?.message ?? 'Publish failed')
    setOutcomePending(false)
  }

  const runEditModeOutcome = async (
    keepOld: boolean,
    instance: NonNullable<typeof editModeInstance>,
    payload: EditModeOutcomeRequest,
  ) => {
    setOutcomePending(true)
    setOutcomeError(null)
    try {
      const result = await addFunctionVersion(instance.functionId, {
        sourceVersion: instance.sourceVersion,
        targetVersion: payload.targetVersion,
        draftDefinition: instance.draft,
        changelog: payload.changelog,
        description: payload.description,
        tags: payload.tags,
        details: payload.details,
      })
      // Set New re-pins this instance to the new version; Keep Old leaves it on
      // the source. Either way the store's pick-out surgery collapses the edit
      // session and reconciles bindings to the target contract.
      const pinnedVersion = keepOld ? instance.sourceVersion : result.version
      const repin: Record<string, unknown> = { functionVersion: pinnedVersion }
      const draft = instance.draft as { inputs?: { name: string }[]; outputs?: { name: string }[] }
      if (!keepOld) {
        // Set New re-pins to the just-published contract: refresh the cached
        // resolved I/O so the config modal renders the new version's input +
        // output tables instead of stale/empty sections.
        repin.resolvedInputs = draft.inputs
        repin.resolvedOutputs = draft.outputs
      }
      const targetContract = keepOld
        ? instance.pinnedContract
        : { inputs: draft.inputs ?? [], outputs: draft.outputs ?? [] }
      applyEditModePublished(instance.nodeId, repin, {
        mode: keepOld ? 'keep-old' : 'set-new',
        targetContract,
      })
      const store = useWorkflowStore.getState()
      // Library View: switch the read-only View to the freshly published version.
      if (functionViewMode) {
        store.setFunctionViewVersion(result.version)
        // Its secrets now compare to the body just published, at any drill depth.
        const published = publishedDraftBody(instance.draft)
        if (published && store.functionViewBaseline?.nodeId === instance.nodeId) {
          store.setFunctionViewBaseline({ nodeId: instance.nodeId, body: published })
        }
      }
      // Publish while drilled into the Function (View or in-Test):
      // refresh the drilled body in place so it shows the pinned contract.
      if (store.drillPath.at(-1)?.nodeId === instance.nodeId) {
        // The block card is the report; rethrowing would report the publish as failed.
        await runBlockingRead(
          {
            label: FUNCTION_BODY_LABEL,
            run: async () => {
              const { definition } = await getFunctionVersion(instance.functionId, pinnedVersion)
              const body = libraryBody(definition)
              store.refreshSharedDrillBody(instance.nodeId, body)
              // The published body is the library View's new baseline for its secrets.
              if (useWorkflowStore.getState().functionViewBaseline?.nodeId === instance.nodeId) {
                store.setFunctionViewBaseline({ nodeId: instance.nodeId, body })
              }
              clearPageBlock(FUNCTION_BODY_LABEL)
            },
          },
          blockPage,
        ).catch(() => {})
      }
      useFunctionsStore.getState().invalidate()
      useWorkflowStore.getState().bumpFunctionLibraryRevision()
      setOutcomePayload(null)
      setOutcomePending(false)
      closePublishEditModeDialog()
    } catch (err) {
      reportOutcomeFailure(err)
    }
  }

  return (
    <>
      {shownLocalFunction ? (
        <PublishDialog
          isOpen={!!publishDialogNodeId}
          onClose={closePublishDialog}
          onPublished={handlePublished}
          localFunction={shownLocalFunction}
          onSubmit={handlePublishSubmit}
        />
      ) : null}
      {shownPublishedRef ? (
        <MakeLocalDialog
          isOpen={!!makeLocalDialogNodeId}
          onClose={closeMakeLocalDialog}
          onDetached={handleDetached}
          publishedRef={shownPublishedRef}
          onConfirm={handleDetachConfirm}
        />
      ) : null}
      {editModeInstance ? (
        <PublishEditModeDialog
          isOpen={!!publishEditModeDialogNodeId}
          onClose={closePublishEditModeDialog}
          instance={editModeInstance}
          onRequestOutcome={handleRequestOutcome}
          sourceMetadataRead={sourceMetadataRead}
        />
      ) : null}
      {editModeInstance && outcomePayload ? (
        <PublishOutcomeDialog
          isOpen={!!outcomePayload}
          onClose={closeOutcome}
          functionName={editModeInstance.functionName}
          sourceVersion={editModeInstance.sourceVersion}
          targetVersion={outcomePayload.targetVersion}
          pending={outcomePending}
          error={outcomeError}
          mode={functionViewMode ? 'single' : 'three-option'}
          onConfirmSingle={() => {
            runEditModeOutcome(false, editModeInstance, outcomePayload).catch(reportOutcomeFailure)
          }}
          onSetNew={() => {
            runEditModeOutcome(false, editModeInstance, outcomePayload).catch(reportOutcomeFailure)
          }}
          onKeepOld={() => {
            runEditModeOutcome(true, editModeInstance, outcomePayload).catch(reportOutcomeFailure)
          }}
        />
      ) : null}
      {shownDropChangesRef ? (
        <DropChangesDialog
          isOpen={!!dropChangesDialogNodeId}
          onClose={closeDropChangesDialog}
          functionName={shownDropChangesRef.functionName}
          sourceVersion={shownDropChangesRef.sourceVersion}
          onConfirm={() => handleDropChangesConfirm(shownDropChangesRef)}
        />
      ) : null}
    </>
  )
}
