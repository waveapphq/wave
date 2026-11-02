/**
 * Multipart upload helper and path-segment encoder shared by the upload
 * clients (test data, imports).
 */

import { getApiBaseUrl } from '@/lib/api'
import { apiErrorFromResponse, type ResponseFailureContext } from '@/services/api-client/errors'

export interface PostUploadOptions {
  /** The route answers a bare body instead of the success envelope. */
  rawResponse?: boolean
  /** Bytes of the body that have left the machine, and the total to send. */
  onProgress?: (loaded: number, total: number) => void
  /** Aborts the request; the promise rejects with an AbortError. */
  signal?: AbortSignal
}

const TRANSPORT_FAILURE = 'Failed to fetch'
const CANCELED = 'Upload canceled'

function abortError(): DOMException {
  return new DOMException(CANCELED, 'AbortError')
}

function headersOf(raw: string): Headers {
  const headers = new Headers()
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const colon = line.indexOf(':')
    if (colon > 0) {
      headers.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
    }
  }
  return headers
}

/** Sends the body and resolves the settled request, so progress and cancel are reportable. */
function sendUpload(
  url: string,
  formData: FormData,
  options: PostUploadOptions
): Promise<XMLHttpRequest> {
  return new Promise((resolve, reject) => {
    const { onProgress, signal } = options
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const request = new XMLHttpRequest()
    const cancel = () => request.abort()
    const done = () => signal?.removeEventListener('abort', cancel)
    request.open('POST', url)
    if (onProgress) {
      request.upload.onprogress = (event) => onProgress(event.loaded, event.total)
    }
    request.onload = () => {
      done()
      resolve(request)
    }
    request.onerror = () => {
      done()
      reject(new TypeError(TRANSPORT_FAILURE))
    }
    request.onabort = () => {
      done()
      reject(abortError())
    }
    signal?.addEventListener('abort', cancel)
    request.send(formData)
  })
}

/** Posts a multipart body; resolves the envelope's data (or the bare body), throws an ApiError on failure. */
export async function postUpload<T>(
  path: string,
  formData: FormData,
  fallback: string,
  options: PostUploadOptions = {}
): Promise<T> {
  const request = await sendUpload(`${getApiBaseUrl()}${path}`, formData, options)
  const response = new Response(request.responseText, {
    status: request.status,
    statusText: request.statusText,
    headers: headersOf(request.getAllResponseHeaders()),
  })
  if (!response.ok) {
    const context: ResponseFailureContext = { method: 'POST', path, fallback }
    throw await apiErrorFromResponse(response, context)
  }
  const json = JSON.parse(request.responseText)
  return options.rawResponse ? (json as T) : json.data
}

/** Encodes each segment of a relative path for a URL, keeping the separators. */
export function encodePathSegments(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}
