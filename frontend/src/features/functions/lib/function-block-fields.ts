/** The Function adapter: a Function's declared inputs and outputs as its Function Block's field list (REQ-3.1.2.1). */

import type { FunctionInput, FunctionOutput } from '@/features/functions/api/types'
import { isEnumInput } from '@/features/functions/lib/enum-input'
import type { InputParam, OutputParam } from '@/features/workbench/lib/node-parameters/types'

/** The declared inputs and outputs a Function Block reads its fields from. */
export interface FunctionBlockDefinition {
  inputs?: readonly FunctionInput[]
  outputs?: readonly FunctionOutput[]
}

function isDeclared<T extends { name: string }>(entry: unknown): entry is T {
  if (entry === null || typeof entry !== 'object') return false
  const { name } = entry as { name?: unknown }
  return typeof name === 'string' && name !== ''
}

function declaredEntries<T extends { name: string }>(entries: readonly unknown[] | undefined): T[] {
  return Array.isArray(entries) ? entries.filter((entry): entry is T => isDeclared<T>(entry)) : []
}

function hasDefault(input: FunctionInput): boolean {
  return input.default !== null && input.default !== undefined
}

function toInputField(input: FunctionInput): InputParam {
  const required = input.required === true
  const secret = input.secret === true
  const field: InputParam = { name: input.name, type: input.type, required, description: input.description }
  if (isEnumInput(input)) field.enumValues = [...input.enumValues]
  if (secret) field.secret = true
  // A Function Block never falls back on a Required input's default, and a secret input has none (REQ-3.1.2.10).
  const plain = !required && !secret
  if (plain && hasDefault(input)) field.defaultValue = input.default
  if (input.type === 'array' || input.type === 'map') field.typedValues = true
  field.acceptsNull = plain && !hasDefault(input)
  return field
}

function toOutputField(output: FunctionOutput): OutputParam {
  const field: OutputParam = { name: output.name, type: output.type, description: output.description }
  if (output.secret === true) field.secret = true
  return field
}

/** The Function Block's input fields, in declared order. */
export function functionBlockInputs(definition: FunctionBlockDefinition): InputParam[] {
  return declaredEntries<FunctionInput>(definition.inputs).map(toInputField)
}

/** The Function Block's outputs, in declared order. */
export function functionBlockOutputs(definition: FunctionBlockDefinition): OutputParam[] {
  return declaredEntries<FunctionOutput>(definition.outputs).map(toOutputField)
}

function listOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function definitionOf(body: unknown): Required<FunctionBlockDefinition> | null {
  if (body === null || typeof body !== 'object') return null
  const { inputs, outputs } = body as Record<string, unknown>
  return { inputs: listOf<FunctionInput>(inputs), outputs: listOf<FunctionOutput>(outputs) }
}

/**
 * The definition a Function Block reads: a Local Block its own body, a Shared Block in edit mode its
 * draft, any other Shared Block the contract of the version it pins; null when there is none to read.
 */
export function functionBlockDefinition(data: Record<string, unknown>): Required<FunctionBlockDefinition> | null {
  if (data.functionLifecycle === 'local') return definitionOf(data.localDefinition)
  if (data.functionLifecycle !== 'shared') return null
  if (data.editMode === true) {
    const draft = definitionOf(data.draft)
    if (draft) return draft
  }
  const { resolvedInputs, resolvedOutputs } = data
  if (resolvedInputs === undefined && resolvedOutputs === undefined) return null
  return { inputs: listOf<FunctionInput>(resolvedInputs), outputs: listOf<FunctionOutput>(resolvedOutputs) }
}
