/**
 * Variable Manager Content - Types and Constants
 *
 * Shared type definitions and constants for the variable manager content components.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.2.2.18: Live variable values display
 */

import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'
import type { DrillEntry } from '@/features/functions/canvas/inner-workflow'
import type { VariableCreateSpec } from '../variable-inspect-modal/use-inspect-create'
import type { StagedOverride } from '@/features/workbench/live/staged-overrides'
import type { WorkbenchVariableOverrideBody } from '@/features/workbench/api/workbench'
import type { ElementTypes } from '@/lib/variable-validation'

// ===========================================================================
// Types
// ===========================================================================

export interface Variable {
  id: string
  name: string
  /** Absent when the variable is declared but was never given a value. */
  value?: unknown
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
  isSecret?: boolean
  isExpression?: boolean
  /** A template string value: {{ }} markers render lazily on reference. Mutually
   *  exclusive with isExpression (REQ-3.1.3.15). */
  isTemplate?: boolean
  /** Array / map only: each element's declared type (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
  /** Function input only: the Function Block must set a value (REQ-3.1.1.5). */
  required?: boolean
  /** Function input / output only: what the parameter is for. */
  description?: string
  /** Enum input only: the allowed values, typed by the input's type (REQ-3.1.2.11). */
  enumValues?: unknown[]
}

/**
 * Function-scope contract surfaced to the Variable Manager. When
 * `insideFunction` is true the panel scopes variable visibility and
 * structures the layout around PARAMETERS / VARIABLES.
 */
export interface FunctionScope {
  insideFunction: boolean
  /** Stable identity of the drilled scope (drillPath join); '' at root. */
  scopeId?: string
  declaredInputNames: string[]
  declaredOutputNames: string[]
  allowedVarNames: Set<string>
}

/** Variable manager Add modes when inside a Function. */
export type VariableManagerAddMode = 'input' | 'output' | 'variable'

/** One open creation window: its mode and the Function it was opened in, absent at the Test root (VMGR-101, VMGR-102). */
export interface CreateWindowEntry {
  /** The lowest index no other open window held when it opened; names its sheet and cascade place. */
  slot: number
  mode: VariableManagerAddMode
  functionPath?: DrillEntry[]
}

export interface VariableManagerContentProps {
  /** All test-local variables as a flat sorted list */
  variables: Variable[]
  /** Secret variable ids whose value is still unsaved (new, or edited since the
   *  last save): their value stays visible/inspectable until the test is saved.
   *  Omitted (read-only / history) -> every secret is locked. */
  unsavedSecretIds?: ReadonlySet<string>
  /** Secret variable ids the saved Test does not hold yet (new, or a changed value): the "stays visible until you save" strip. */
  changedSecretIds?: ReadonlySet<string>
  /** Runtime values by scope (`scopedVariableKey`, a root variable by its bare name); empty when idle. */
  runtimeValues: Map<string, unknown>
  /** Whether a run is running or paused (live values, expression locks). */
  isExecuting?: boolean
  /** Live run status: the pencil, the row delete and the window's Save lock only while `running` (VMGR-107). */
  runStatus?: string
  /** Whether variables are loading */
  isLoading?: boolean
  /** The window's definition Save of a row, in the window's own scope (the drilled one when absent). */
  onVariableEdit?: (
    target: Variable,
    spec: VariableCreateSpec,
    functionPath?: DrillEntry[],
  ) => { success: boolean; error?: string }
  /** The window's Current Save in its scope; absent -> Current mode stays read-only. */
  onVariableCurrentEdit?: (
    name: string,
    body: WorkbenchVariableOverrideBody,
    functionPath?: DrillEntry[],
  ) => Promise<void>
  /** Every Current-edit override (idle or live) by scope, for the Current display (live > override > baseline > definition). */
  appliedOverrides?: Map<string, StagedOverride>
  /** Variable values captured at run-start: what Current shows while that run is
   *  live for a variable it gave no value. Empty while idle. */
  runStartSnapshot?: Map<string, unknown>
  /** The element types of each run-start snapshot value (REQ-3.1.3.19). */
  runStartElementTypes?: Map<string, ElementTypes>
  /**
   * Callback when "+ Add" button is clicked. Hidden in readOnly. When the
   * Variable Manager is inside a Function, the button morphs to a dropdown
   * and the callback receives the chosen mode ('input' | 'output' |
   * 'variable'). Outside a Function the "+ Add" button opens it in 'variable'
   * mode. Returns success; the modal stays open and shows the error on failure.
   * A window opened inside a Function passes its path and keeps creating there (VMGR-102).
   */
  onCreateVariable?: (
    mode: VariableManagerAddMode,
    spec: VariableCreateSpec,
    functionPath?: DrillEntry[],
  ) => { success: boolean; error?: string }
  /** Callback when a variable is deleted */
  onVariableDelete?: (id: string) => void
  /** Set of variable names that are bound to element outputs (REQ-3.1.3.6) */
  outputBoundVarNames?: Set<string>
  /** Set of variable names referenced anywhere in the workflow (outputs + inputs) */
  workflowReferencedVarNames?: Set<string>
  /**
   * Cycle validator wired to the scalar variable edit dialog's expression
   * field blur and save path. Returns the cycle-path message when the
   * proposed expression introduces a cycle, null otherwise.
   */
  validateExpressionCycle?: (params: {
    variableId?: string
    variableName: string
    value: unknown
    isExpression: boolean
    /** A creation window's own scope (VMGR-102); the drilled scope when absent. */
    functionPath?: DrillEntry[]
  }) => string | null
  /** Set of recently changed variable paths (for highlight animation) */
  recentlyChanged?: Set<string>
  /** True while the session is mirrored live: a modified row gets a temporary
   *  violet bar + pulse (the watcher/inspect bar stays visible otherwise). */
  isMirroring?: boolean
  /** Available variables for expression autocomplete */
  availableVariables?: AvailableVariable[]
  /**
   * When true, every mutating surface is hidden or locked: the Add button
   * is hidden, per-row Edit pencil and Delete trash are rendered but
   * disabled, and the edit dialog opens read-only. The eye toggle, filter,
   * and sort stay fully usable. Used by the historical test canvas.
   */
  readOnly?: boolean
  /**
   * Active Function scope. When `scope.insideFunction` is true, the panel
   * renders PARAMETERS (INPUTS / OUTPUTS) + VARIABLES groups, filters
   * variables to scope.allowedVarNames, and the Add button becomes a
   * dropdown. Outside a Function (default) the layout is unchanged.
   */
  scope?: FunctionScope
  /**
   * Identity the open watchers are persisted under (the editing test id).
   * Watchers survive navigation and reloads of the SAME test and are dropped
   * on test close or switch. `null` = live workbench without a saved test
   * (session-only); `undefined` = persistence disabled (history workbench).
   */
  persistenceKey?: string | null
  /**
   * Live workbench session id - lets complex watchers fetch full runtime
   * values from the session variables endpoint. Absent in history workbench
   * (snapshots are already full) and while idle.
   */
  sessionId?: string | null
}

// ===========================================================================
// Constants
// ===========================================================================

export const VIRTUALIZATION_THRESHOLD = 50
export const MAX_VALUE_LENGTH = 100
/** Inline row height in px: py-2 + 22px action line + gap-1 + 20px text line + border-b. */
export const INLINE_VARIABLE_ROW_HEIGHT = 63
/** Virtualized window used until the panel body reports its own height. */
export const VARIABLE_LIST_FALLBACK_HEIGHT = 400
