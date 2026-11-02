/**
 * Types for ElementConfigModal
 *
 * Shared interfaces for the config modal component and its sub-components.
 */

import type { ReactNode } from 'react'
import type { FunctionInput, FunctionOutput } from '@/features/functions/api/types'
import type { ControlVersion } from '@/features/workbench/docs/_types'
import type { SecretMaskingSetting } from '@/features/workbench/lib/node-parameters/secret-reveal'
import type { OutputTypeRule } from '@/features/workbench/lib/node-parameters/types'
import type { ProfileBinding } from './dialogs/profile-binding-modal'
import type { ElementTypes } from '@/lib/variable-validation'

export interface Parameter {
  name: string
  label?: string
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
  required: boolean
  description?: string
  defaultValue?: unknown
  /** Allowed values, typed by `type` (REQ-3.1.2.11). */
  enumValues?: Array<string | number>
  showWhen?: { field: string; values: string[] }
  /** Survives the hidden-param auto-clear in the draft; stripped at save. */
  retainOnHide?: boolean
}

export interface OutputParameter {
  name: string
  label?: string
  type: string
  description?: string
  /** Offered for binding only while the referenced input field matches */
  showWhen?: { field: string; values: string[] }
  /** Offered for binding only while EVERY condition matches (conjunctive showWhen). */
  showWhenAll?: { field: string; values: string[] }[]
  /** This output's type follows other fields: first matching rule wins, else `type`. */
  typeWhen?: OutputTypeRule[]
  /** Schema-secret output: seeds the instance's Secret checkbox checked (K8SCON-4) */
  secret?: boolean
}

/** Output row shape consumed by the output-mode ParameterTable. */
export type OutputTableParameter = Pick<
  Parameter,
  'name' | 'label' | 'type' | 'description'
> & { required: false }

export interface ElementData {
  id: string
  name: string
  elementType: string
  version: string
  availableVersions: string[]
  parameters: Parameter[]
  outputs: OutputParameter[]
  currentValues: Record<string, unknown>
  outputBindings: Record<string, string>
  /** Per-instance description (multiline, max 256 chars) */
  description?: string
  /** Element documentation summary (from registry metadata) */
  summary?: string
  versions?: ControlVersion[]
  profileBindings?: ProfileBinding[]
  expressionFields?: string[]
  templateFields?: string[]
  variableExpressionKeys?: string[]
  variableTemplateKeys?: string[]
  variableSecretKeys?: string[]
  /** Output names whose bound variable is secret (SECUI-3/4). */
  outputSecretFields?: string[]
  /** Credential-field keys the user revealed for this block. */
  unmaskedSecretFields?: string[]
  /** Per-block run-output reveal tri-state (default 'system'). */
  secretMasking?: SecretMaskingSetting
  /** Canvas node kind - the "Secrets" section renders only for plugins. */
  nodeType?: string
  variableTypes?: Record<string, string>
  /** Variable Setter: each array / map literal row's element types (REQ-3.1.3.19). */
  variableElementTypes?: Record<string, ElementTypes>
  /** Typed block settings (a map whose values carry a type): each one's element types. */
  elementTypes?: Record<string, ElementTypes>
}

export interface SaveData {
  id: string
  version: string
  /** User-visible canvas-node label (max ``MAX_BLOCK_NAME_LENGTH``). */
  name: string
  values: Record<string, unknown>
  outputBindings: Record<string, string>
  outputTypes: Record<string, string>
  /** Per-instance description (multiline, max 256 chars) */
  description?: string
  profileBindings: ProfileBinding[]
  expressionFields: string[]
  templateFields: string[]
  variableExpressionKeys?: string[]
  variableTemplateKeys?: string[]
  variableSecretKeys?: string[]
  /** Output names whose bound variable is secret (SECUI-3/4). */
  outputSecretFields?: string[]
  /** Credential-field keys the user revealed for this block. */
  unmaskedSecretFields?: string[]
  /** Per-block run-output reveal tri-state (default 'system'). */
  secretMasking?: SecretMaskingSetting
  variableTypes?: Record<string, string>
  variableElementTypes?: Record<string, ElementTypes>
  elementTypes?: Record<string, ElementTypes>
  /** Function Blocks: the picked library version; `version` stays the Block's own. */
  functionVersion?: string
  /** Function Blocks: the picked version is gone from the library. */
  missingVersion?: boolean
  /** Function Blocks: the picked version's contract, stamped on the Block. */
  resolvedInputs?: FunctionInput[]
  resolvedOutputs?: FunctionOutput[]
}

/** The Name field a chrome Name row draws, held by the window. */
export interface BlockWindowName {
  value: string
  onChange: (name: string) => void
}

/** A Function Block's lifecycle chrome on the one Block window (CANVAS-207). */
export interface BlockWindowChrome {
  /** The title word while the Name is blank. */
  typeLabel: string
  /** The Description box's hint. */
  descriptionPlaceholder: string
  /** Shown above the form. */
  banner: ReactNode
  /** The Name row in place of the Block name and version list; a blank Name holds the Save. */
  renderNameRow: (name: BlockWindowName) => ReactNode
  /** The footer actions left of Cancel and Save. */
  footerActions: ReactNode
  /** What the Input and Output sections show when the Block has no fields there. */
  emptyInputs: ReactNode
  emptyOutputs: ReactNode
  /** The chrome's own change (a version pick) and its waiver of the nothing-changed rule. */
  gate: { changed: boolean; savesUnchanged: boolean }
}

export interface ElementConfigModalProps {
  isOpen: boolean
  onClose: () => void
  element: ElementData
  onSave: (data: SaveData) => void
  /** Cascade offset from the centered position (28px per open-order slot). */
  initialOffset?: { x: number; y: number }
  /** A Function Block's chrome in place of the Block name row and footer actions. */
  chrome?: BlockWindowChrome
}

/** Variable entry enriched with output source info */
export interface EnrichedVariable {
  id: string
  name: string
  /** Absent when the variable is declared but was never given a value. */
  value?: unknown
  type: string
  source?: string
  /** The variable is secret-flagged (drives the credential-field status icon) */
  isSecret?: boolean
  /** A bare namespace container (`system`), not a variable: pickers drop it. */
  isNamespaceRoot?: boolean
  /** A node's output binding writes this variable - the only origin the
   *  picker's OUT badge means. Namespace and profile entries carry a `source`
   *  label too, but they are not outputs. */
  isOutputBinding?: boolean
}
