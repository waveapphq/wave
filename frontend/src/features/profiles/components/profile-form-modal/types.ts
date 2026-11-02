/**
 * Types for ProfileFormModal
 *
 * REQ-4.7.4: Profile management UI - Create/Edit modal
 * REQ-4.7.10: Environment-specific configurations
 */

import type { ElementTypes } from '@/lib/variable-validation'

/**
 * WAVE variable types for profile parameters.
 * Aligned with backend's canonical type set: string, integer, float,
 * boolean, array, map, table.
 */
export type WaveType = 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'

export const WAVE_TYPES: WaveType[] = [
  'string',
  'integer',
  'float',
  'boolean',
  'array',
  'map',
  'table',
]

/** Display label for each WAVE type (UI only - storage uses lowercase identifiers). */
export const WAVE_TYPE_LABELS: Record<WaveType, string> = {
  string: 'String',
  integer: 'Integer',
  float: 'Float',
  boolean: 'Boolean',
  array: 'Array',
  map: 'Map',
  table: 'Table',
}

export interface Parameter {
  id: string
  name: string
  type: WaveType
  secret: boolean
  /** Values keyed by environment ID - PROFILE-39: per-environment values */
  values: Record<string, string>
  /** An array / map value's element types, keyed by environment ID (REQ-3.1.3.19). */
  elementTypes?: Record<string, ElementTypes>
}

/** The parameter with one environment's element types set, or removed when undefined. */
export function withEnvironmentElementTypes(
  parameter: Parameter,
  environmentId: string,
  types: ElementTypes | undefined,
): Parameter {
  const { [environmentId]: _replaced, ...others } = parameter.elementTypes ?? {}
  const next = types === undefined ? others : { ...others, [environmentId]: types }
  return { ...parameter, elementTypes: Object.keys(next).length === 0 ? undefined : next }
}

export interface Environment {
  id: string
  name: string
  tags: string[]
}

export interface Profile {
  id: string
  name: string
  type: string
  description: string | null
  tags: string[]
  usage: number
  parameters: Parameter[]
  createdAt: string
  updatedAt: string
}

export interface ProfileFormData {
  name: string
  type: string
  description: string
  tags: string[]
  parameters: Parameter[]
}

/** Schema field for profile type parameters */
export interface ProfileTypeSchemaField {
  name: string
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
  required: boolean
  secret: boolean
  /** The field's declared starting value, absent when it declares none; a map arrives as an object. */
  default?: string | number | boolean | Record<string, unknown>
  /** Declared numeric bounds of the field's value. */
  minimum?: number
  maximum?: number
  /** A URL, host or certificate: plain text only, so its value editor offers no format. */
  plain?: boolean
}

/** The schema read for one profile type. */
export interface ProfileTypeSchema {
  type: string
  fields: ProfileTypeSchemaField[]
}

export interface ProfileFormModalProps {
  open: boolean
  mode: 'create' | 'edit'
  profile?: Profile
  profileTypes: string[]
  environments: Environment[]
  allTags: string[]
  loading?: boolean
  error?: string
  onClose: () => void
  onSubmit: (data: ProfileFormData) => void
  onDelete: (id: string) => void
  /** Callback to fetch schema fields for a profile type (used to populate default parameters) */
  onFetchTypeSchema?: (type: string) => Promise<ProfileTypeSchemaField[]>
}
