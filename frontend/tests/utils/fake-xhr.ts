/**
 * Drives the XMLHttpRequest behind the shared multipart upload helper, so a
 * test programs an answer the way it would program a fetch mock.
 */

export interface XhrAnswer {
  status?: number
  statusText?: string
  /** Sent verbatim when it is a string, JSON-serialized otherwise. */
  body?: unknown
  headers?: string
}

export interface SentRequest {
  method: string
  url: string
  body: FormData
}

export interface FakeXhrHarness {
  /** Programs the answer every later request receives. */
  answer: (answer: XhrAnswer) => void
  /** Every request sent so far, in order. */
  requests: SentRequest[]
  restore: () => void
}

const JSON_HEADERS = 'content-type: application/json'

function serialize(body: unknown): string {
  if (body === undefined) return ''
  if (typeof body === 'string') return body
  return JSON.stringify(body)
}

export function installFakeXhr(): FakeXhrHarness {
  const original = globalThis.XMLHttpRequest
  const requests: SentRequest[] = []
  let programmed: XhrAnswer | null = null

  class FakeXhr {
    upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    method = ''
    url = ''
    status = 200
    statusText = 'OK'
    responseText = ''
    private headers = JSON_HEADERS

    open(method: string, url: string): void {
      this.method = method
      this.url = url
    }

    send(body: FormData): void {
      requests.push({ method: this.method, url: this.url, body })
      if (!programmed) {
        throw new Error(`No XHR answer programmed for ${this.method} ${this.url}`)
      }
      this.status = programmed.status ?? 200
      this.statusText = programmed.statusText ?? 'OK'
      this.responseText = serialize(programmed.body)
      this.headers = programmed.headers ?? (this.responseText === '' ? '' : JSON_HEADERS)
      this.onload?.()
    }

    abort(): void {
      this.onabort?.()
    }

    getAllResponseHeaders(): string {
      return this.headers
    }
  }

  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest

  return {
    answer: (next: XhrAnswer) => {
      programmed = next
    },
    requests,
    restore: () => {
      globalThis.XMLHttpRequest = original
    },
  }
}
