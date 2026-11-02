/**
 * Normalized context for a failed API read, plus the one text rendering of it
 * that both the details panel and the copy control use.
 */

export interface FailureDetail {
  method?: string
  path?: string
  status?: number
  statusText?: string
  durationMs?: number
  requestId?: string
  occurredAt?: string
  message: string
}

const FALLBACK_MESSAGE = 'Request failed'
const LEAD_COLUMN_WIDTH = 4

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Build a failure detail from anything thrown by the API client. Never throws. */
export function toFailureDetail(error: unknown): FailureDetail {
  if (typeof error === 'string') {
    return { message: error.trim() === '' ? FALLBACK_MESSAGE : error }
  }
  if (typeof error !== 'object' || error === null) {
    return { message: FALLBACK_MESSAGE }
  }
  try {
    const source = error as Record<string, unknown>
    return {
      method: readString(source, 'method'),
      path: readString(source, 'path'),
      status: readNumber(source, 'status'),
      statusText: readString(source, 'statusText'),
      durationMs: readNumber(source, 'durationMs'),
      requestId: readString(source, 'requestId'),
      occurredAt: readString(source, 'occurredAt'),
      message: readString(source, 'message') ?? FALLBACK_MESSAGE,
    }
  } catch {
    // A hostile accessor must not take the blocked page down with it.
    return { message: FALLBACK_MESSAGE }
  }
}

function pairLine(lead: string | undefined, rest: string | undefined): string | undefined {
  if (lead === undefined) return rest
  if (rest === undefined) return lead
  return `${lead.padEnd(LEAD_COLUMN_WIDTH)} ${rest}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function timeLine(occurredAt: string | undefined): string | undefined {
  if (occurredAt === undefined) return undefined
  const at = new Date(occurredAt)
  if (Number.isNaN(at.getTime())) return undefined
  return `${pad2(at.getHours())}:${pad2(at.getMinutes())}:${pad2(at.getSeconds())} local`
}

/** The exact text shown in the details panel AND copied by the copy control. */
export function formatFailureDetail(detail: FailureDetail): string {
  const lines = [
    pairLine(detail.method, detail.path),
    detail.status === undefined ? undefined : pairLine(String(detail.status), detail.statusText),
    detail.durationMs === undefined ? undefined : `${detail.durationMs} ms`,
    detail.requestId === undefined ? undefined : `request ${detail.requestId}`,
    timeLine(detail.occurredAt),
  ].filter((line): line is string => line !== undefined)

  if (lines.length === 0) return detail.message
  return `${lines.join('\n')}\n\n${detail.message}`
}
