/**
 * The amber row notes the OpenSearch descriptor names (OS-2, OS-4, REQ-5.1.2, REQ-3.3.2.3).
 */

import type { RowNoteContext } from '@/features/workbench/lib/node-parameters/types'
import { parseTimeValue } from './time-values'

const API_KEY_PREFIX = /^ApiKey /i
const BEARER_PREFIX = /^Bearer /i
const HTTP_URL = /^http:\/\//i

function literalStartsWith(prefix: RegExp, { value, isExpression }: RowNoteContext): boolean {
  return !isExpression && typeof value === 'string' && prefix.test(value)
}

export function apiKeySchemeNote(ctx: RowNoteContext): string | null {
  return literalStartsWith(API_KEY_PREFIX, ctx) ? 'Remove "ApiKey " at the start: WAVE adds it' : null
}

export function bearerSchemeNote(ctx: RowNoteContext): string | null {
  return literalStartsWith(BEARER_PREFIX, ctx) ? 'Remove "Bearer " at the start: WAVE adds it' : null
}

/** Verify Server Certificate turned off, or a filled certificate or key row, on an http Cluster URL. */
export function tlsOnHttpNote({ value, allValues }: RowNoteContext): string | null {
  const url = allValues.url
  const onHttp = typeof url === 'string' && HTTP_URL.test(url)
  const set = value === false || (typeof value === 'string' && value.trim() !== '')
  return onHttp && set ? 'Not used: the Cluster URL is http' : null
}

/** A fixed From later than a fixed To or than now. */
export function fromNote({ value, isExpression, allValues, now }: RowNoteContext): string | null {
  if (isExpression) return null
  const from = parseTimeValue(value)
  if (from.kind !== 'absolute') return null
  const to = parseTimeValue(allValues.to)
  if (to.kind === 'absolute' && from.epochMs > to.epochMs) {
    return 'From is later than To: the search can find nothing'
  }
  return from.epochMs > now.getTime() ? 'From is later than now: the search can find nothing' : null
}
