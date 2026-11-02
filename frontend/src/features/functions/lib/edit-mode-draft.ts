/** Build an edit-mode draft from a resolved definition, mirroring the BE
 *  snapshot so the publish-time name-lock and tag rules validate identically. */

import type { FunctionDefinition } from '@/features/functions/api/types'
import {
  dropBlockFields,
  writeNewChoiceInputs,
  type BlockFieldContract,
} from '@/features/workbench/lib/saved-block-fields'

export interface EditModeDraft {
  name: string
  description: string
  tags: string[]
  inputs: FunctionDefinition['inputs']
  outputs: FunctionDefinition['outputs']
  dependencies: FunctionDefinition['dependencies']
  workflow: FunctionDefinition['workflow']
  variables?: FunctionDefinition['variables']
}

export function buildEditModeDraft(definition: FunctionDefinition): EditModeDraft {
  return {
    name: definition.name,
    description: definition.description,
    tags: definition.tags,
    inputs: definition.inputs,
    outputs: definition.outputs,
    dependencies: definition.dependencies,
    workflow: definition.workflow,
    variables: definition.variables,
  }
}

export interface LocalDefinitionBody {
  workflow?: unknown
  inputs?: unknown
  outputs?: unknown
  dependencies?: unknown
  variables?: unknown
}

/**
 * Fit a Function Block to the contract it now follows: drop what the contract no longer declares or
 * no longer fits (FNCFG-9), then, when the contract it followed is known, start each new choice-list
 * and true / false input on its default (REQ-3.1.2.10).
 */
export function reconcileBindingsToContract<T extends object>(
  data: T,
  contract: BlockFieldContract,
  previous?: BlockFieldContract,
): T {
  const fitted = dropBlockFields(data, contract)
  return previous ? writeNewChoiceInputs(fitted, previous.inputs, contract.inputs) : fitted
}

/** Fold a drilled-in working body back into the persisted draft, keeping draft-only
 *  fields (name, tags). One source of truth for the edit-mode round-trip (pop-out + save). */
export function foldLocalDefinitionIntoDraft(
  prevDraft: Record<string, unknown> | undefined,
  localDef: LocalDefinitionBody,
): Record<string, unknown> {
  const base = prevDraft ?? {}
  const variables = localDef.variables ?? base.variables
  return {
    ...base,
    workflow: localDef.workflow ?? base.workflow ?? { nodes: [], edges: [] },
    inputs: localDef.inputs ?? base.inputs ?? [],
    outputs: localDef.outputs ?? base.outputs ?? [],
    dependencies:
      localDef.dependencies ?? base.dependencies ?? { functions: [], plugins: [] },
    // The body's local variables travel with the draft into the published version (REQ-3.1.2.1).
    ...(variables === undefined ? {} : { variables }),
  }
}
