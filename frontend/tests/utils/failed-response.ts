/** The failure shape fetch actually produces: ok:false plus status line, headers and json(). */
export function failedResponse(status: number, statusText: string, body?: unknown) {
  const headers = new Headers()
  if (body !== undefined) headers.set('content-type', 'application/json')
  return { ok: false, status, statusText, headers, json: () => Promise.resolve(body) }
}
