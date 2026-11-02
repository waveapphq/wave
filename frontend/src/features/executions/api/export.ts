/**
 * Execution Export API Client
 *
 * File-download clients for the execution export endpoints. Uses fetch
 * directly (not the apiClient) because the responses are binary Blobs.
 */

import { getApiBaseUrl } from '@/lib/api'
import { downloadFromUrl } from '@/lib/download-file'

export interface ExportExecutionOptions {
  /** Restrict the export to specific test_ids. Empty array = whole execution. */
  testIds?: string[]
  /** File format. Defaults to json when omitted. */
  format?: 'json' | 'yaml'
}

interface BackendError {
  success?: boolean
  error?: { code?: string; message?: string }
}

function buildUrl(executionId: string, opts: ExportExecutionOptions): string {
  const params = new URLSearchParams()
  if (opts.testIds && opts.testIds.length > 0) {
    params.set('test_ids', opts.testIds.join(','))
  }
  if (opts.format && opts.format !== 'json') {
    params.set('format', opts.format)
  }
  const query = params.toString()
  const base = `${getApiBaseUrl()}/executions/${executionId}/export`
  return query ? `${base}?${query}` : base
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body: BackendError = await response.json()
    if (body.error?.message) {
      return body.error.message
    }
    return `Request failed with status ${response.status}`
  } catch {
    return `Request failed with status ${response.status}`
  }
}

/**
 * Download a single-execution export under its Content-Disposition filename.
 */
export async function downloadExecutionExport(
  executionId: string,
  options: ExportExecutionOptions = {},
): Promise<void> {
  const format = options.format ?? 'json'
  await downloadFromUrl(buildUrl(executionId, options), `execution-${executionId}.${format}`)
}

/**
 * Fetch a bulk executions export (single file or ZIP) as a Blob.
 */
export async function exportExecutions(
  executionIds: string[],
  format: 'yaml' | 'json',
): Promise<Blob> {
  const response = await fetch(`${getApiBaseUrl()}/executions/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ execution_ids: executionIds, format }),
  })
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
  // Re-wrap in the current realm's Blob constructor so `instanceof Blob`
  // holds even when the Response was fabricated in a different realm.
  return new Blob([await response.arrayBuffer()], {
    type: response.headers.get('content-type') ?? 'application/zip',
  })
}
