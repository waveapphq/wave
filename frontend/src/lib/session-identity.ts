/**
 * Per-browser-tab session identity: a UUID persisted in per-tab storage so it
 * survives a reload and dies with the tab, plus a "{Browser} ({OS})" connection
 * label derived from the User-Agent. The label matches the server-derived roster
 * label (backend client_label), so a person holder's mirror banner and its WAVE
 * Server roster row read as the same connection.
 */

import { randomUUID } from '@/lib/uuid'

const TAB_ID_KEY = 'wave.tab-session-id'
const LIVE_IDS_KEY = 'wave.live-tab-ids'

let sessionId: string | null = null

function readStoredTabId(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(TAB_ID_KEY) ?? null
  } catch {
    return null
  }
}

function storeTabId(id: string): void {
  try {
    globalThis.sessionStorage?.setItem(TAB_ID_KEY, id)
  } catch {
    // Per-tab storage unavailable: identity degrades to this page load only.
  }
}

function readLiveIds(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(LIVE_IDS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function writeLiveIds(ids: string[]): void {
  try {
    globalThis.localStorage?.setItem(LIVE_IDS_KEY, JSON.stringify(ids))
  } catch {
    // Cross-tab claims degrade when shared storage is unavailable.
  }
}

export function getSessionId(): string {
  if (sessionId !== null) return sessionId
  // A stored id still claimed live belongs to a duplicated source tab.
  const stored = readStoredTabId()
  const id = stored !== null && !readLiveIds().includes(stored) ? stored : randomUUID()
  sessionId = id
  storeTabId(id)
  writeLiveIds([...readLiveIds(), id])
  globalThis.addEventListener('pagehide', () => {
    writeLiveIds(readLiveIds().filter((liveId) => liveId !== id))
  })
  return id
}

let pageId: string | null = null

/** This page load's id: a reload keeps the tab's session id but mints a new page id. */
export function getPageId(): string {
  pageId ??= randomUUID()
  return pageId
}

// Session ids this browser has minted, shared across its tabs via localStorage so
// the WAVE Server roster can mark every same-browser connection as "You" (each tab
// keeps a distinct per-tab session id; this groups them by browser).
const OWN_SESSIONS_KEY = 'wave.own-session-ids'
const OWN_SESSIONS_CAP = 100

export function getOwnSessionIds(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(OWN_SESSIONS_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export function rememberOwnSession(id: string): void {
  try {
    const ids = getOwnSessionIds()
    ids.add(id)
    const capped = [...ids].slice(-OWN_SESSIONS_CAP)
    globalThis.localStorage?.setItem(OWN_SESSIONS_KEY, JSON.stringify(capped))
  } catch {
    // localStorage unavailable (private mode): the "You" marker degrades to this tab only.
  }
}

function browserName(userAgent: string): string | null {
  if (userAgent.includes('Edg/')) return 'Edge'
  if (userAgent.includes('Firefox/')) return 'Firefox'
  if (userAgent.includes('Chrome/')) return 'Chrome'
  if (userAgent.includes('Safari/') && userAgent.includes('Version/')) return 'Safari'
  return null
}

function operatingSystem(userAgent: string): string | null {
  if (userAgent.includes('Windows NT')) return 'Windows'
  if (userAgent.includes('Android')) return 'Android'
  if (userAgent.includes('iPhone') || userAgent.includes('iPad') || userAgent.includes('iPod')) {
    return 'iOS'
  }
  if (userAgent.includes('Mac OS X') || userAgent.includes('Macintosh')) return 'macOS'
  if (userAgent.includes('Linux')) return 'Linux'
  return null
}

export function getSessionLabel(): string {
  const userAgent = globalThis.navigator?.userAgent ?? ''
  const browser = browserName(userAgent)
  if (browser === null) return 'Browser'
  const os = operatingSystem(userAgent)
  return os ? `${browser} (${os})` : browser
}
