/** Idle Current-edit staging, sent with each run; display order is live > staged > definition (REQ-3.2.1.6). */

import { useCallback, useRef } from 'react'

import type { WorkbenchVariableOverrideBody } from '@/features/workbench/api/workbench'
import type { FunctionVariablesSeed } from '@/types/function-variables'
import type { ElementTypes } from '@/lib/variable-validation'
import {
  parseScopedVariableKey,
  scopedVariableKey,
} from '@/features/workbench/lib/variable-scope-key'

/** A staged or applied Current value is the API override body. */
export type StagedOverride = WorkbenchVariableOverrideBody

/** The re-armed source of an expression or template override; undefined for a literal. */
export function overrideSource(override: StagedOverride | undefined): string | undefined {
  if (override === undefined || 'value' in override) return undefined
  return 'expression' in override ? override.expression : override.template
}

/** The seed entry a staged override runs as: its own value or source, in its own kind. */
function stagedSeedEntry(override: StagedOverride): Record<string, unknown> {
  if ('expression' in override) {
    return { type: override.type, value: override.expression, isExpression: true }
  }
  if ('template' in override) {
    return { type: override.type, value: override.template, isTemplate: true }
  }
  if (override.elementTypes === undefined) return { type: override.type, value: override.value }
  return { type: override.type, value: override.value, elementTypes: override.elementTypes }
}

function isSecretSeed(entry: unknown): boolean {
  return typeof entry === 'object' && entry !== null && (entry as { secret?: unknown }).secret === true
}

/** Fold the root-scope staged overrides into a run-request `variables` seed; a staged name wins. */
export function mergeStagedIntoRunVariables(
  base: Record<string, unknown>,
  staged: Map<string, StagedOverride>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const [key, override] of staged) {
    const { name, functionPath } = parseScopedVariableKey(key)
    if (functionPath.length > 0) continue
    const entry = stagedSeedEntry(override)
    result[name] = isSecretSeed(base[name]) ? { ...entry, secret: true } : entry
  }
  return result
}

/** The staged Function values as the run's `function_variables`: one entry per Function instance. */
export function stagedFunctionVariables(
  staged: Map<string, StagedOverride>
): FunctionVariablesSeed[] {
  const entries = new Map<string, FunctionVariablesSeed>()
  for (const [key, override] of staged) {
    const { name, functionPath } = parseScopedVariableKey(key)
    if (functionPath.length === 0) continue
    const pathKey = JSON.stringify(functionPath)
    const entry = entries.get(pathKey) ?? { function_path: functionPath, variables: {} }
    entry.variables[name] = stagedSeedEntry(override)
    entries.set(pathKey, entry)
  }
  return [...entries.values()]
}

/** The source text shown for an expression variable's Current value: the staged override, else the definition. */
export function resolveCurrentExpressionSource(overrideExpression: string | undefined, definition: unknown): string {
  if (overrideExpression !== undefined) return overrideExpression
  if (typeof definition === 'string') return definition
  return ''
}

export interface ResolveCurrentDisplayArgs {
  hasLiveValue: boolean
  liveValue: unknown
  /** The current-edit override applied this session (idle staged or live applied). */
  override: StagedOverride | undefined
  /** The variable's value captured at run-start, passed while that run is live:
   *  the engine holds it, so editing the Initial definition can't move Current.
   *  A run that started the variable with no value passes null (VMGR-19). */
  sessionBaseline: unknown
  definitionValue: unknown
  /** Element types of the run-start baseline and of the definition (REQ-3.1.3.19). */
  baselineElementTypes?: ElementTypes
  definitionElementTypes?: ElementTypes
}

export interface CurrentDisplay {
  value: unknown
  hasValue: boolean
  /** The shown value's element types; a live value's arrive with its full read. */
  elementTypes?: ElementTypes
}

/**
 * Resolve the Current-mode display value with precedence
 * live > override > sessionBaseline > definition. An override expression is
 * re-armed (no realized value) so it reads as not-yet-evaluated until the next
 * reference. While a run is live the baseline (not the editable definition) is
 * the fallback, decoupling Current from Initial edits.
 */
export function resolveCurrentDisplay({
  hasLiveValue,
  liveValue,
  override,
  sessionBaseline,
  definitionValue,
  baselineElementTypes,
  definitionElementTypes,
}: ResolveCurrentDisplayArgs): CurrentDisplay {
  if (hasLiveValue) return { value: liveValue, hasValue: true }
  if (override !== undefined && 'value' in override) {
    return { value: override.value, hasValue: true, elementTypes: override.elementTypes }
  }
  // A re-armed override expression or template reads as not-yet-evaluated over the fallback.
  if (sessionBaseline !== undefined) {
    return {
      value: sessionBaseline,
      hasValue: override === undefined,
      elementTypes: baselineElementTypes,
    }
  }
  return { value: definitionValue, hasValue: false, elementTypes: definitionElementTypes }
}

/** The variable as the next run reads it: a Current-mode source edit replaces its source. */
export function withOverrideSource<T extends { value?: unknown }>(
  variable: T,
  override: StagedOverride | undefined
): T {
  const source = overrideSource(override)
  return source === undefined ? variable : { ...variable, value: source }
}

const NO_NAMES: ReadonlySet<string> = new Set()

/** The entries whose key is in `keep`; the same map when none goes. */
export function keepNamed<T>(map: Map<string, T>, keep: ReadonlySet<string> = NO_NAMES): Map<string, T> {
  const kept = new Map([...map].filter(([name]) => keep.has(name)))
  return kept.size === map.size ? map : kept
}

/** The map without the entry of `name` in that scope; the same map when it holds none. */
export function withoutScoped<T>(map: Map<string, T>, name: string, functionPath?: readonly string[]): Map<string, T> {
  const key = scopedVariableKey(name, functionPath)
  if (!map.has(key)) return map
  const next = new Map(map)
  next.delete(key)
  return next
}

/** The map with the entry of `name` moved to `newName` in the same scope; the same map when it holds none. */
export function renamedScoped<T>(
  map: Map<string, T>,
  name: string,
  newName: string,
  functionPath?: readonly string[],
): Map<string, T> {
  if (name === newName) return map
  const key = scopedVariableKey(name, functionPath)
  const entry = map.get(key)
  if (entry === undefined) return map
  const next = withoutScoped(map, name, functionPath)
  next.set(scopedVariableKey(newName, functionPath), entry)
  return next
}

/** The entries whose Function instance `isGone` does not name; the same map when none goes. */
export function withoutGoneScopes<T>(
  map: Map<string, T>,
  isGone: (functionPath: string[]) => boolean,
): Map<string, T> {
  const kept = new Map([...map].filter(([key]) => !isGone(parseScopedVariableKey(key).functionPath)))
  return kept.size === map.size ? map : kept
}

export interface UseStagedOverrides {
  /** The staged map as it is now, so a run started right after a Save carries that Save (VMGR-64). */
  read: () => Map<string, StagedOverride>
  /** Stages a value in its scope: node ids from the root canvas inward, absent or empty at the root. */
  stage: (name: string, override: StagedOverride, functionPath?: string[]) => void
  /** Applies a change to the whole staged map (rename, drop, prune). */
  restage: (change: (staged: Map<string, StagedOverride>) => Map<string, StagedOverride>) => void
  /** Reset: drops every staged override except the keys in `keep`. */
  clear: (keep?: ReadonlySet<string>) => void
}

/** Holds idle staged overrides keyed by scope and name; only a run reads them, so they live in a ref, not render state. */
export function useStagedOverrides(): UseStagedOverrides {
  const stagedRef = useRef<Map<string, StagedOverride>>(new Map())

  const read = useCallback(() => stagedRef.current, [])

  const restage = useCallback(
    (change: (staged: Map<string, StagedOverride>) => Map<string, StagedOverride>) => {
      stagedRef.current = change(stagedRef.current)
    },
    [],
  )

  const stage = useCallback(
    (name: string, override: StagedOverride, functionPath?: string[]) => {
      restage((prev) => new Map(prev).set(scopedVariableKey(name, functionPath), override))
    },
    [restage],
  )

  const clear = useCallback((keep?: ReadonlySet<string>) => restage((prev) => keepNamed(prev, keep)), [restage])

  return { read, stage, restage, clear }
}
