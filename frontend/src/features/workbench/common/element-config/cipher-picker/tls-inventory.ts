/**
 * TLS cipher inventory helpers shared by the cipher picker sheet and the
 * Cipher Suites row: the catalog fetch hook, the node's draft TLS range,
 * the range-visibility filter, the protocol-family predicates, and the row's
 * gray default list and out-of-range finding (FIELD-10, REQ-3.4.2.2).
 */

import { useEffect, useState } from 'react'

import {
  fetchTlsCapabilities,
  type TlsCapabilities,
  type TlsCipher,
} from '@/services/tls-capabilities'

export const TLS_RANGE_DEFAULTS = { min: '1.2', max: '1.3' }

const VERSION_RANK: Record<string, number> = { '1.0': 0, '1.1': 1, '1.2': 2, '1.3': 3 }

function rankOf(version: string, fallback: string): number {
  return VERSION_RANK[version] ?? VERSION_RANK[fallback]
}

/** The node's draft TLS range for the picker: draft values first, then the
 *  schema defaults of the version params, then the product 1.2/1.3 defaults. */
export function resolveTlsRange(
  allValues?: Record<string, unknown>,
  allParameters?: { name: string; defaultValue?: unknown }[],
): { min: string; max: string } {
  const resolve = (field: string, fallback: string): string => {
    const draft = allValues?.[field]
    if (typeof draft === 'string' && draft) return draft
    const schemaDefault = allParameters?.find((p) => p.name === field)?.defaultValue
    return typeof schemaDefault === 'string' ? schemaDefault : fallback
  }
  return {
    min: resolve('tls_min_version', TLS_RANGE_DEFAULTS.min),
    max: resolve('tls_max_version', TLS_RANGE_DEFAULTS.max),
  }
}

type TlsRange = { min: string; max: string }

/** What an unset Cipher Suites sends: the Block's list for the TLS range, from the backend payload. */
export function defaultCipherList(
  capabilities: TlsCapabilities | null,
  block: string | undefined,
  range: TlsRange,
): string[] | undefined {
  if (capabilities === null || block === undefined) return undefined
  return capabilities.defaults?.[block]?.[`${range.min}-${range.max}`]
}

/** The catalog row a suite name refers to: names are accepted under their OpenSSL or IANA form (HTTP-13). */
export function findCipher(ciphers: TlsCipher[], name: unknown): TlsCipher | undefined {
  return ciphers.find((row) => row.openssl === name || row.iana === name)
}

/** The first named cipher the TLS range cannot offer, worded as the save check words it. */
export function cipherOutOfRange(
  capabilities: TlsCapabilities | null,
  names: unknown,
  range: TlsRange,
): string | null {
  if (capabilities === null || !Array.isArray(names)) return null
  const minRank = rankOf(range.min, TLS_RANGE_DEFAULTS.min)
  const maxRank = rankOf(range.max, TLS_RANGE_DEFAULTS.max)
  for (const name of names) {
    const cipher = findCipher(capabilities.ciphers, name)
    if (cipher && (VERSION_RANK[cipher.min_version] > maxRank || VERSION_RANK[cipher.max_version] < minRank)) {
      return `Cipher suite "${String(name)}" is not available in TLS ${range.min} to ${range.max}`
    }
  }
  return null
}

/** Whether a catalog row belongs to the TLS 1.3 family (table 2). */
export function isTls13(cipher: TlsCipher): boolean {
  return cipher.min_version === '1.3'
}

/** The per-suite compat tag: "1.2" for exact rows, "1.0-1.2" for span rows. */
export function compatTag(cipher: TlsCipher): string {
  if (cipher.min_version === cipher.max_version) return cipher.min_version
  return `${cipher.min_version}-${cipher.max_version}`
}

/** Catalog rows (both families, catalog order) whose version span intersects
 *  [minVersion, maxVersion]; out-of-range rows are hidden, never dimmed. */
export function visibleCiphers(
  capabilities: TlsCapabilities,
  minVersion: string,
  maxVersion: string,
): TlsCipher[] {
  const minRank = rankOf(minVersion, TLS_RANGE_DEFAULTS.min)
  const maxRank = rankOf(maxVersion, TLS_RANGE_DEFAULTS.max)
  return capabilities.ciphers.filter(
    (cipher) =>
      VERSION_RANK[cipher.min_version] <= maxRank && VERSION_RANK[cipher.max_version] >= minRank,
  )
}

/** Fetch the cipher catalog once on mount. Pass `enabled=false` to skip the
 *  fetch (the affordance only needs it while the stored set is unset). */
export function useTlsCapabilities(enabled = true): {
  capabilities: TlsCapabilities | null
  error: string | null
} {
  const [capabilities, setCapabilities] = useState<TlsCapabilities | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let canceled = false
    fetchTlsCapabilities()
      .then((result) => {
        if (!canceled) setCapabilities(result)
      })
      .catch((err: unknown) => {
        if (!canceled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      canceled = true
    }
  }, [enabled])

  return { capabilities, error }
}

/** A Cipher Suites row's standing: its gray default for the TLS versions and a typed name they cannot offer. */
export function useCipherSuitesStanding(
  parameter: { cipherPicker?: boolean; cipherDefaultsBlock?: string },
  names: unknown,
  allValues?: Record<string, unknown>,
  allParameters?: { name: string; defaultValue?: unknown }[],
): { defaultList: string[] | undefined; outOfRange: string | null } {
  const { capabilities } = useTlsCapabilities(parameter.cipherPicker === true)
  const range = resolveTlsRange(allValues, allParameters)
  return {
    defaultList: defaultCipherList(capabilities, parameter.cipherDefaultsBlock, range),
    outOfRange: cipherOutOfRange(capabilities, names, range),
  }
}
