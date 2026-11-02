/**
 * Profile data transform functions
 *
 * Pure utility functions for converting between API profile format
 * and modal/form data format.
 */

import type {
  Profile as ModalProfile,
  Parameter,
  Environment as ModalEnvironment,
} from '@/features/profiles/components/profile-form-modal'
import type { Profile, Environment } from '@/features/profiles/api/types'
import { randomUUID } from '@/lib/uuid'
import { isElementTypes, type ElementTypes } from '@/lib/variable-validation'
import { numberTextProblem, plainNumberText, wireNumber } from '@/lib/number-rule'
import { numberShapeType } from '@/lib/variable-format'

// ============================================================================
// Type Guards & Helpers
// ============================================================================

/**
 * Typed parameter value structure from API
 */
interface TypedValue {
  type: Parameter['type']
  secret: boolean
  value: unknown
  /** An array / map value's element types (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
}

/**
 * Check if a value is a typed parameter value
 */
function isTypedValue(val: unknown): val is TypedValue {
  return (
    val !== null &&
    typeof val === 'object' &&
    'type' in val &&
    'value' in val &&
    typeof (val as TypedValue).type === 'string'
  )
}

/**
 * Convert a typed value back to string for the form
 */
export function valueToString(value: unknown, type: Parameter['type']): string {
  /* v8 ignore next - COV-DEF-027 */
  if (value === null || value === undefined) return ''

  switch (type) {
    case 'boolean':
      return value === true ? 'true' : 'false'
    case 'integer':
    case 'float':
      return typeof value === 'number' ? plainNumberText(value) : String(value as string)
    case 'array':
    case 'map':
    case 'table':
      return typeof value === 'string' ? value : JSON.stringify(value)
    default:
      /* v8 ignore next - COV-BRANCH-113 */
      return typeof value === 'object' ? JSON.stringify(value) : String(value as string | number | boolean)
  }
}

/**
 * Detect type from a raw value (legacy format without type info)
 */
function detectType(value: unknown): Parameter['type'] {
  if (typeof value === 'number') return numberShapeType(value)
  if (typeof value === 'boolean') return 'boolean'
  if (Array.isArray(value)) {
    // Check if it's a table (2D array or object with headers/rows)
    /* v8 ignore next - COV-DEF-021 */
    if (value.length > 0 && Array.isArray(value[0])) return 'table'
    return 'array'
  }
  if (value !== null && typeof value === 'object') {
    // Check if it's a table format
    /* v8 ignore next - COV-DEF-028 */
    if ('headers' in value && 'rows' in value) return 'table'
    return 'map'
  }
  return 'string'
}

// ============================================================================
// API <-> Modal Transforms
// ============================================================================

const NO_DECLARED_TYPES: Readonly<Record<string, Parameter['type']>> = {}

/** A raw number, or digit text that keeps the number rule, reads as the declared number type; else by its shape. */
function rawValueType(value: unknown, declared: Parameter['type'] | undefined): Parameter['type'] {
  if (declared !== 'integer' && declared !== 'float') return detectType(value)
  const isNumber = typeof value === 'number' || (typeof value === 'string' && numberTextProblem(value, declared) === null)
  return isNumber ? declared : detectType(value)
}

/** The type and secret flag the first provided value of `key` carries (K8SPROF-6: an unprovided field carries none). */
function detectParameterKind(
  environmentValues: Record<string, Record<string, unknown>>,
  key: string,
  declared: Parameter['type'] | undefined,
): { type: Parameter['type'] | undefined; secret: boolean } {
  for (const envConfig of Object.values(environmentValues)) {
    const val = envConfig[key]
    if (!(key in envConfig) || val === null) continue
    if (isTypedValue(val)) return { type: val.type, secret: val.secret }
    return { type: rawValueType(val, declared), secret: looksSecret(key) }
  }
  return { type: declared, secret: looksSecret(key) }
}

/** A name that reads like a credential, for a value that carries no secret flag of its own. */
function looksSecret(key: string): boolean {
  return key.includes('password') || key.includes('secret') || key.includes('token') || key.includes('key')
}

/** Each environment's cell text for `key`, and its element types where the value has them. */
function environmentCells(
  environmentValues: Record<string, Record<string, unknown>>,
  environments: Environment[],
  key: string,
  paramType: Parameter['type'],
): { values: Record<string, string>; elementTypes: Record<string, ElementTypes> } {
  const values: Record<string, string> = {}
  const elementTypes: Record<string, ElementTypes> = {}
  for (const env of environments) {
    const val = environmentValues[env.id]?.[key]
    if (isTypedValue(val)) {
      values[env.id] = valueToString(val.value, val.type)
      if (isElementTypes(val.elementTypes)) elementTypes[env.id] = val.elementTypes
    } else {
      values[env.id] = val === undefined ? '' : valueToString(val, paramType)
    }
  }
  return { values, elementTypes }
}

/**
 * Transform API profile environment_values to modal parameters
 * Note: API stores per-environment configs; we transform to modal parameters
 * Supports both new typed format { type, secret, value } and legacy raw values
 */
export function environmentValuesToParameters(
  environmentValues: Record<string, Record<string, unknown>>,
  environments: Environment[],
  declaredTypes: Readonly<Record<string, Parameter['type']>> = NO_DECLARED_TYPES
): Parameter[] {
  // Collect all unique parameter names across all environments
  const allParamNames = new Set<string>()
  for (const envConfig of Object.values(environmentValues)) {
    for (const key of Object.keys(envConfig)) {
      allParamNames.add(key)
    }
  }

  // Create parameter for each unique name
  return Array.from(allParamNames).map((key) => {
    const detected = detectParameterKind(environmentValues, key, declaredTypes[key])
    const paramType = detected.type ?? 'string'
    const paramSecret = detected.secret
    const { values, elementTypes } = environmentCells(environmentValues, environments, key, paramType)

    const parameter: Parameter = {
      id: randomUUID(),
      name: key,
      type: paramType,
      secret: paramSecret,
      values,
    }
    if (Object.keys(elementTypes).length > 0) parameter.elementTypes = elementTypes
    return parameter
  })
}

/** An array / map value's element types for one environment, when it has any. */
function environmentElementTypes(
  param: Parameter,
  environmentId: string,
): ElementTypes | undefined {
  if (param.type !== 'array' && param.type !== 'map') return undefined
  return param.elementTypes?.[environmentId]
}

/** Return the appropriate empty/default value for a WAVE type */
function emptyValueForType(type: Parameter['type']): unknown {
  switch (type) {
    case 'integer':
    case 'float': return null
    case 'boolean': return false
    case 'array': return []
    case 'map': return {}
    case 'table': return { headers: [], rows: [] }
    default: return ''
  }
}

/** Parse a JSON string into a collection type, falling back to empty value */
function parseCollectionValue(value: string, type: Parameter['type']): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return emptyValueForType(type)
  }
}

/**
 * Convert a string value to the appropriate type based on WAVE type
 */
export function convertValueToType(value: string, type: Parameter['type']): unknown {
  if (!value && value !== '0' && value !== 'false') {
    return emptyValueForType(type)
  }

  switch (type) {
    case 'integer':
    case 'float':
      return wireNumber(value, type)
    case 'boolean':
      return value === 'true'
    case 'array':
    case 'map':
    case 'table':
      return parseCollectionValue(value, type)
    default:
      return value
  }
}

// ============================================================================
// Table adapter
//
// Convert the profile's stored { headers, rows } table shape <-> the shared
// complex-body row-object model only at the editor boundary. The stored shape
// and the runtime binding stay unchanged - column types are inferred-from-cells
// editing aids, never persisted.
// ============================================================================

/** { headers, rows } -> header-keyed row objects (cell types preserved). */
export function headersRowsToRowObjects(table: {
  headers: string[]
  rows: unknown[][]
}): Record<string, unknown>[] {
  const candidate = table as unknown as { headers?: unknown; rows?: unknown } | null
  if (!candidate || typeof candidate !== 'object') return []
  const { headers, rows } = candidate
  if (!Array.isArray(headers) || !Array.isArray(rows)) return []
  return rows.map((row) => {
    const cells = Array.isArray(row) ? row : []
    const obj: Record<string, unknown> = {}
    headers.forEach((header, index) => {
      obj[String(header)] = cells[index]
    })
    return obj
  })
}

/**
 * Transform modal parameters to API config for a specific environment
 *
 * For custom profiles: sends wrapped format { type, secret, value } since backend
 * doesn't have a schema and needs this metadata.
 *
 * For typed profiles (ssh, database, etc.): sends simple values since backend
 * validates against its predefined schema.
 */
export function parametersToConfig(
  parameters: Parameter[],
  environmentId: string,
  profileType: string
): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  const isCustomType = !profileType || profileType.toLowerCase() === 'custom'

  for (const param of parameters) {
    if (param.name.trim()) {
      /* v8 ignore next - COV-DEF-022 */
      const value = param.values[environmentId] ?? ''
      const elementTypes = environmentElementTypes(param, environmentId)

      if (elementTypes !== undefined) {
        // Element types store beside the value in the typed wrapper, on every profile type.
        config[param.name] = {
          type: param.type,
          secret: param.secret,
          value: convertValueToType(value, param.type),
          elementTypes,
        }
      } else if (isCustomType) {
        // Custom profiles: include type metadata for backend storage. integer /
        // float stay exact digit-strings (a JS Number rounds past 2^53 / ~17 sig
        // digits); the backend coerces them to int / Decimal at execution.
        const keepExact = param.type === 'integer' || param.type === 'float'
        config[param.name] = {
          type: param.type,
          secret: param.secret,
          value: keepExact ? value : convertValueToType(value, param.type),
        }
      } else if ((param.type === 'integer' || param.type === 'float') && value.trim() === '') {
        // An empty number is not provided (K8SPROF-6), never zero.
        config[param.name] = null
      } else {
        // Typed profiles: send simple values, backend validates against schema
        config[param.name] = convertValueToType(value, param.type)
      }
    }
  }
  return config
}

/**
 * Get all environment configs from parameters
 * Returns a map of environmentId -> config
 */
export function parametersToAllConfigs(
  parameters: Parameter[],
  environments: Environment[],
  profileType: string
): Record<string, Record<string, unknown>> {
  const configs: Record<string, Record<string, unknown>> = {}
  for (const env of environments) {
    configs[env.id] = parametersToConfig(parameters, env.id, profileType)
  }
  return configs
}

/**
 * Transform API Profile to Modal Profile
 */
export function apiProfileToModalProfile(
  profile: Profile,
  environments: Environment[],
  declaredTypes?: Readonly<Record<string, Parameter['type']>>
): ModalProfile {
  return {
    id: profile.id,
    name: profile.name,
    type: profile.type,
    description: profile.description,
    tags: profile.tags,
    usage: profile.usage,
    parameters: environmentValuesToParameters(profile.environmentValues, environments, declaredTypes),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

/**
 * Transform API environments to modal environments
 */
export function apiEnvsToModalEnvs(envs: Environment[]): ModalEnvironment[] {
  return envs.map((e) => ({
    id: e.id,
    name: e.name,
    tags: e.tags ?? [],
  }))
}
