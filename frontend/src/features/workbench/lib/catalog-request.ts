/**
 * The request every catalog pull (Get Tables, Get fields) sends and its cache keys (SQL-12, OS-13).
 */

import { isSealedSecret } from '@/lib/secret-envelope'
import type { ElementTypes } from '@/lib/variable-validation'

export interface CatalogProfileBinding {
  profileId: string
  alias: string
  profileName: string
  profileType: string
}

export type CatalogJobStatus = 'connecting' | 'reading' | 'done' | 'failed' | 'canceled'

/** A block's connection rows plus everything the server resolves them with, as a run of the open test does. */
export interface CatalogRequest<Connection> {
  connection: Connection
  expression_fields: string[]
  template_fields: string[]
  /** Typed connection settings' element types (REQ-3.1.3.19). */
  element_types: Record<string, ElementTypes>
  profile_bindings: CatalogProfileBinding[]
  environment_id: string | null
  test_id: string | null
}

export interface CatalogRequestInput {
  values: Record<string, unknown>
  expressionFields: readonly string[]
  templateFields: readonly string[]
  profileBindings: readonly CatalogProfileBinding[]
  environmentId?: string | null
  testId?: string | null
  elementTypes?: Readonly<Record<string, ElementTypes>>
}

/** The pull request of a block whose connection rows are `rows`, built by `connectionOf`. */
export function catalogRequestOf<Connection>(
  input: CatalogRequestInput,
  rows: ReadonlySet<string>,
  connectionOf: (values: Record<string, unknown>) => Connection,
): CatalogRequest<Connection> {
  return {
    connection: connectionOf(input.values),
    // A connection row, or one entry of it (`driver_options.<key>`).
    expression_fields: input.expressionFields.filter((name) => rows.has(name.split('.', 1)[0])),
    template_fields: input.templateFields.filter((name) => rows.has(name)),
    element_types: Object.fromEntries(
      Object.entries(input.elementTypes ?? {}).filter(([name]) => rows.has(name)),
    ),
    profile_bindings: input.profileBindings.map(({ profileId, alias, profileName, profileType }) => ({
      profileId,
      alias,
      profileName,
      profileType,
    })),
    environment_id: input.environmentId ?? null,
    test_id: input.testId ?? null,
  }
}

/** UTF-16 code-unit order, the order a bare sort() gives strings, so a key never depends on the locale. */
export function byCodeUnits(left: string, right: string): number {
  return Number(left > right) - Number(left < right)
}

/** The value with the keys of every object sorted, at every depth. */
export function sortedDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedDeep)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort(byCodeUnits)
        .map((key) => [key, sortedDeep(record[key])]),
    )
  }
  return value
}

/** Stable cache key of a pull: equal requests give equal keys, whatever their key order. */
export function catalogKey(request: object): string {
  return JSON.stringify(sortedDeep(request))
}

// Every seal draws a fresh nonce, so one secret saved in two blocks never reads the same.
const SEALED = { sealed: true }

/** The key of the pull state editors share: requests differing only in a sealed value's ciphertext share it. */
export function catalogStateKey(request: CatalogRequest<object>): string {
  const connection = Object.fromEntries(
    Object.entries(request.connection).map(([row, value]) => [row, isSealedSecret(value) ? SEALED : value]),
  )
  return catalogKey({ ...request, connection })
}
