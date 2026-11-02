/**
 * The body a Shared (library) Function instance opens with: its in-Test
 * edit-mode draft when one exists, else the library entry at the pinned version.
 */

import { getFunction, getFunctionVersion } from '@/features/functions/api/functions-api'
import type { FunctionDefinition } from '@/features/functions/api/types'
import { canvasFunctionBody } from '@/features/workbench/lib/canonical-workflow'
import type { EdgeType, NodeType, WorkflowVariable } from '@/features/workbench/stores/workflow-store'

export type SharedFunctionBody = NonNullable<NodeType['data']['localDefinition']>

interface FunctionBodyShape {
  workflow: { nodes: unknown[]; edges: unknown[] }
  inputs?: unknown[]
  outputs?: unknown[]
  variables?: unknown[]
}

function drillBody(body: FunctionBodyShape): SharedFunctionBody {
  return {
    workflow: {
      nodes: body.workflow.nodes as NodeType[],
      edges: body.workflow.edges as EdgeType[],
    },
    inputs: body.inputs ?? [],
    outputs: body.outputs ?? [],
    variables: (body.variables ?? []) as WorkflowVariable[],
  }
}

/** A library definition as the body a drill opens, its local variables included (REQ-3.1.2.1). */
export function libraryBody(definition: FunctionBodyShape): SharedFunctionBody {
  return canvasFunctionBody(drillBody(definition))
}

/** A just-published edit-mode draft (the stored body the library accepted) as a drill opens it, or null without a body. */
export function publishedDraftBody(draft: Record<string, unknown>): SharedFunctionBody | null {
  const body = draft as Partial<FunctionBodyShape>
  return body.workflow ? libraryBody({ ...body, workflow: body.workflow }) : null
}

/** The edit-mode draft body of a Shared instance, or null when it is not being edited. */
export function sharedDraftBody(data: Record<string, unknown>): SharedFunctionBody | null {
  const draft = data.draft as Partial<FunctionBodyShape> | undefined
  if (!data.editMode || !draft?.workflow) return null
  return drillBody({ ...draft, workflow: draft.workflow })
}

/** A Shared instance's library definition at its pinned version, or the latest when unpinned. */
export async function fetchSharedDefinition(
  functionId: string,
  pinnedVersion: string | undefined,
): Promise<FunctionDefinition> {
  const { definition } = await (pinnedVersion
    ? getFunctionVersion(functionId, pinnedVersion)
    : getFunction(functionId))
  return definition
}

/** Resolve a Shared instance's library body at its pinned version, or the latest when unpinned. */
export async function fetchSharedBody(
  functionId: string,
  pinnedVersion: string | undefined,
): Promise<SharedFunctionBody> {
  return libraryBody(await fetchSharedDefinition(functionId, pinnedVersion))
}
