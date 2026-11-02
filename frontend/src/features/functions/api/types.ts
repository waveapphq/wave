/**
 * Domain and wire types for the Functions feature.
 *
 * The on-disk Function shape is `FunctionDefinition`; list rows are
 * `FunctionSummary`. The store and API client both depend on these names.
 */

import type { ElementTypes } from '@/lib/variable-validation'

export type FunctionParamType =
  | 'string'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'array'
  | 'map'
  | 'table'

export interface FunctionInput {
  name: string
  type: FunctionParamType
  required: boolean
  default: unknown
  description: string
  /** A secret input acts as a block's secret field (REQ-3.1.2.9). */
  secret?: boolean
  /** An enum input's allowed values, typed by `type`; the input holds one of them (REQ-3.1.2.11). */
  enumValues?: Array<string | number>
  /** Array / map default only: each element's declared type (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
}

export interface FunctionOutput {
  name: string
  type: FunctionParamType
  description: string
  /** A secret output seeds Secret ticked in the Function Block's outputs table (REQ-3.1.2.9). */
  secret?: boolean
  /** Output kind (REQ-3.1.2.8): `default` holds the expression or template source. */
  isExpression?: boolean
  isTemplate?: boolean
}

/** A Function-local variable, in the list shape a Function body stores (REQ-3.1.2.1). */
export interface FunctionVariable {
  name: string
  type: FunctionParamType
  value?: unknown
  secret?: boolean
  isExpression?: boolean
  isTemplate?: boolean
  elementTypes?: ElementTypes
}

export interface FunctionDependencies {
  functions: string[]
  plugins: string[]
}

export interface FunctionMetadata {
  author: string
  created_at: string
  updated_at: string
}

export interface FunctionWorkflow {
  nodes: unknown[]
  edges: unknown[]
}

export interface FunctionDefinition {
  id: string
  name: string
  description: string
  tags: string[]
  inputs: FunctionInput[]
  outputs: FunctionOutput[]
  dependencies: FunctionDependencies
  workflow: FunctionWorkflow
  variables?: FunctionVariable[]
  metadata: FunctionMetadata
}

export interface FunctionSummary {
  id: string
  name: string
  description: string
  tags: string[]
  created_at: string
  updated_at: string
  latest_version?: string
}

export interface PaginationMeta {
  page: number
  per_page: number
  total: number
  total_pages: number
}

export interface FunctionListResponse {
  functions: FunctionSummary[]
  pagination: PaginationMeta
}

export interface FunctionDependentRef {
  id: string
  name: string
}

export interface FunctionDependentsResponse {
  tests: FunctionDependentRef[]
  functions: FunctionDependentRef[]
}

export interface ListFunctionsParams {
  page?: number
  per_page?: number
  search?: string
  tags?: string[]
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}

export interface CreateFunctionPayload {
  name: string
  description: string
  tags: string[]
  inputs: FunctionInput[]
  outputs: FunctionOutput[]
  dependencies: FunctionDependencies
  workflow: FunctionWorkflow
  variables?: FunctionVariable[]
  /** Initial library version; defaults to 1.0.0 server-side when omitted. */
  version?: string
}

export interface BatchCreateFailure {
  index: number
  errors: string[]
}

export interface BatchCreateResult {
  created: FunctionDefinition[]
  failed: BatchCreateFailure[]
}

export interface BatchDeleteFailure {
  id: string
  errors: string[]
}

export interface BatchDeleteResult {
  deleted: string[]
  failed: BatchDeleteFailure[]
}

export interface ImportResultEntry {
  name?: string
}

export interface ImportFailedEntry {
  name: string
  errors: string[]
}

export interface ImportResult {
  imported: FunctionDefinition[]
  skipped: ImportResultEntry[]
  renamed: ImportResultEntry[]
  failed: ImportFailedEntry[]
}

export interface PublishFunctionPayload {
  name: string
  description: string
  tags: string[]
  changelog?: string
  details?: string
  version?: string
}

export interface PublishFunctionResult {
  function_id: string
  version: string
  node: {
    id: string
    data: Record<string, unknown>
  } & Record<string, unknown>
}

export interface DetachFunctionResult {
  node: {
    id: string
    data: Record<string, unknown>
  } & Record<string, unknown>
}


// ---------------------------------------------------------------------------
// Versioning and edit-mode
// ---------------------------------------------------------------------------


export type BumpLevel = 'patch' | 'minor' | 'major'

export interface VersionDescriptor {
  version: string
  published_at: string
  published_by?: string
  changelog: string
  details: string
  description: string
  tags: string[]
  /** Pinned-version contract, surfaced by GET /versions so the canvas can
   *  resolve a Shared instance's inputs/outputs without a per-version fetch. */
  inputs?: FunctionInput[]
  outputs?: FunctionOutput[]
}

export interface ListVersionsResult {
  versions: VersionDescriptor[]
  latest: string
  name?: string
}

export interface GetVersionResult {
  definition: FunctionDefinition
  etag: string
}

export interface ValidateBumpsPayload {
  draftDefinition: Partial<FunctionDefinition> & {
    name: string
    inputs: FunctionInput[]
    outputs: FunctionOutput[]
  }
  sourceVersion: string
}

export interface ComputedBumps {
  allowed: BumpLevel[]
  blocked: Partial<Record<BumpLevel, string>>
}

export interface AddFunctionVersionPayload {
  sourceVersion: string
  targetVersion: string
  draftDefinition: Record<string, unknown>
  changelog: string
  description?: string
  tags?: string[]
  details?: string
}

export interface AddFunctionVersionResult {
  function_id: string
  version: string
}
