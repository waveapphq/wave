/**
 * Report Artifact Download Client
 *
 * REQ-5.2.4.13: Reporting endpoints (artifact download pathway)
 *
 * Streams the artifact blob via the shared download helper (filename from
 * Content-Disposition, with a caller-provided fallback).
 */

import { getApiBaseUrl } from '@/lib/api'
import { downloadFromUrl } from '@/lib/download-file'

/**
 * Download a report artifact as a file (attachment disposition).
 *
 * The filename comes from Content-Disposition, falling back to the
 * caller-provided name.
 */
export async function downloadReportArtifact(
  artifactId: string,
  fallbackFilename: string,
): Promise<void> {
  await downloadFromUrl(`${getApiBaseUrl()}/artifacts/content/${artifactId}`, fallbackFilename)
}
