/**
 * useOutputList - edit-time rows for an element's author-declared output list,
 * held apart from the form state and merged back at save.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  followRowBindings,
  mergeOutputList,
  seedOutputListRows,
  outputListFieldErrors,
} from '@/features/workbench/lib/node-parameters/output-list'
import type {
  InputParam,
  OutputListPolicy,
  OutputListRowState,
} from '@/features/workbench/lib/node-parameters/types'
import { describeBindingRejection } from '@/features/workbench/lib/validation/output-binding-rules'
import { useStoredFollow } from '@/hooks/use-stored-follow'
import type { ElementData, EnrichedVariable, OutputParameter } from './types'

/** What the Output Variables section needs to render and edit the list. */
export interface OutputListEditState {
  policy: OutputListPolicy
  rows: OutputListRowState[]
  onRowsChange: (rows: OutputListRowState[]) => void
  rowErrors: (string | undefined)[]
  bindingErrors: (string | undefined)[]
}

export interface OutputListBindingParameter {
  name: string
  type: string
  required: false
}

const NO_ROWS: OutputListRowState[] = []

/** An existing variable's own type wins; a new name takes the row's choice. */
function rowOutputType(row: OutputListRowState, variables: EnrichedVariable[]): string {
  if (row.binding === '') return ''
  return variables.find((variable) => variable.name === row.binding)?.type ?? row.type
}

export function useOutputList(
  element: ElementData,
  versionParameters: InputParam[],
  versionOutputs: OutputParameter[],
  values: Record<string, unknown>,
  outputBindings: Record<string, string>,
  outputSecretFields: string[],
  enrichedVariables: EnrichedVariable[],
) {
  const listParameter = versionParameters.find((p) => p.outputList !== undefined)
  const paramName = listParameter?.name
  const policy = listParameter?.outputList

  // The seed is the mount-time snapshot: untouched rows must read as no change.
  const [seedRows, setSeedRows] = useState<OutputListRowState[]>(() =>
    paramName === undefined
      ? NO_ROWS
      : seedOutputListRows(paramName, values, outputBindings, outputSecretFields),
  )
  const [rows, setRows] = useState<OutputListRowState[]>(seedRows)
  // A binding the canvas changed under the open sheet reaches the rows and their seed, as it reaches the form.
  useStoredFollow({ outputBindings: element.outputBindings }, (base, next) => {
    setSeedRows((seed) => followRowBindings(seed, base.outputBindings, next.outputBindings))
    setRows((current) => followRowBindings(current, base.outputBindings, next.outputBindings))
  })

  const schemaOutputNames = useMemo(() => versionOutputs.map((out) => out.name), [versionOutputs])
  const hadStoredKey = paramName !== undefined && Object.hasOwn(element.currentValues, paramName)

  // The rows merged into any values, so a replayed draft merges exactly as the form does.
  const mergeValues = useCallback(
    (draftValues: Record<string, unknown>) =>
      paramName === undefined
        ? { values: draftValues, outputBindings, outputSecretFields }
        : mergeOutputList(paramName, rows, seedRows, schemaOutputNames, {
            values: draftValues,
            outputBindings,
            outputSecretFields,
            hadStoredKey,
          }),
    [paramName, rows, seedRows, schemaOutputNames, outputBindings, outputSecretFields, hadStoredKey],
  )
  const merged = useMemo(() => mergeValues(values), [mergeValues, values])

  const rowErrors = useMemo(
    () => (policy ? outputListFieldErrors(rows, policy, schemaOutputNames) : []),
    [policy, rows, schemaOutputNames],
  )
  const bindingErrors = useMemo(
    () => rows.map((row) => describeBindingRejection(row.binding) ?? undefined),
    [rows],
  )
  const valid =
    rowErrors.every((error) => error === undefined) &&
    bindingErrors.every((error) => error === undefined)

  const bindingParameters = useMemo<OutputListBindingParameter[]>(
    () =>
      rows.map((row) => ({
        name: row.name,
        type: rowOutputType(row, enrichedVariables),
        required: false as const,
      })),
    [rows, enrichedVariables],
  )

  return { policy, rows, setRows, rowErrors, bindingErrors, valid, merged, mergeValues, bindingParameters }
}
