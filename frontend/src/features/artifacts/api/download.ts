/**
 * Artifact download client (REQ-5.2.1.41).
 *
 * Streams binary blobs via the shared download helper (filename from
 * Content-Disposition): a single artifact file and an execution's (or
 * subtree's) .zip bundle.
 */

import { getApiBaseUrl } from '@/lib/api'
import { downloadFromUrl } from '@/lib/download-file'

/** Download one artifact file (attachment disposition). */
export async function downloadArtifactFile(
  artifactId: string,
  fallbackFilename: string,
): Promise<void> {
  await downloadFromUrl(`${getApiBaseUrl()}/artifacts/content/${artifactId}`, fallbackFilename)
}

/** Download an execution's live artifacts as a .zip (optionally a subtree). */
export async function downloadExecutionZip(executionId: string, subtree?: string): Promise<void> {
  const query = new URLSearchParams({ execution_id: executionId })
  if (subtree) {
    query.set('path', subtree)
  }
  await downloadFromUrl(
    `${getApiBaseUrl()}/artifacts/zip?${query.toString()}`,
    `${executionId}.zip`,
    'application/zip',
  )
}
