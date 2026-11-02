/**
 * Shared binary-download helper: fetch a URL, derive the filename from
 * Content-Disposition (with a caller fallback), and trigger the browser
 * download. Used by feature download clients that stream blobs rather than
 * going through the JSON apiClient.
 */

import { downloadBlob } from '@/lib/download-blob'

const FILENAME_PATTERN = /filename="?([^"]+)"?/i
const ENCODED_FILENAME_PATTERN = /filename\*=UTF-8''([^;]+)/i

function decodeEncodedFilename(value: string): string | null {
  try {
    return decodeURIComponent(value.trim())
  } catch {
    return null
  }
}

/** The download's file name: the encoded form when the header carries one, else the quoted one (REQ-4.6.9). */
export function parseFilename(response: Response): string | null {
  const disposition = response.headers.get('content-disposition')
  if (!disposition) return null
  const encoded = ENCODED_FILENAME_PATTERN.exec(disposition)
  const decoded = encoded ? decodeEncodedFilename(encoded[1]) : null
  if (decoded) return decoded
  const match = FILENAME_PATTERN.exec(disposition)
  return match ? match[1] : null
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error: { message: string } }
    return body.error.message
  } catch {
    return `Request failed with status ${response.status}`
  }
}

/** Fetch a binary URL and download it under the Content-Disposition filename. */
export async function downloadFromUrl(
  url: string,
  fallbackFilename: string,
  blobType?: string,
): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
  const blob = new Blob([await response.arrayBuffer()], {
    type: blobType ?? (response.headers.get('content-type') as string),
  })
  downloadBlob(blob, parseFilename(response) ?? fallbackFilename)
}
