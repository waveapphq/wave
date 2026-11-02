/**
 * Connection failure diagnosis.
 *
 * A request the browser blocked for origin policy and a backend that is not
 * listening raise the same opaque network error. A no-cors probe separates
 * them: it resolves when the address answered, rejects when nothing did.
 */

const PROBE_TIMEOUT_MS = 3000

/** The address the app could not reach. */
export function unreachableMessage(baseUrl: string): string {
  return `Cannot reach the backend at ${baseUrl}`
}

function originRejectedMessage(baseUrl: string, origin: string): string {
  return (
    `The backend at ${baseUrl} is running but rejected requests from ${origin}. ` +
    `Add ${origin} to its allowed origins.`
  )
}

async function answered(url: string, signal: AbortSignal): Promise<boolean> {
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal })
    return true
  } catch {
    return false
  }
}

/**
 * Probes the backend and returns the reason a request to it failed.
 */
export async function diagnoseConnection(baseUrl: string): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  const reachable = await answered(`${baseUrl}/health`, controller.signal)
  clearTimeout(timeoutId)

  return reachable
    ? originRejectedMessage(baseUrl, globalThis.location.origin)
    : unreachableMessage(baseUrl)
}
