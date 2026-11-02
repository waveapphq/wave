/**
 * Shared helpers for environment import/export functional tests.
 */

import { expect, type Page } from '@playwright/test'
import { BACKEND_URL } from '../../helpers/config'

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/** Create an environment via API and return its ID */
export async function createEnvironmentViaApi(
  page: Page,
  name: string,
  description?: string,
  tags?: string[]
): Promise<string> {
  const response = await page.request.post(`${BACKEND_URL}/environments`, {
    data: {
      name,
      description: description || `Test environment: ${name}`,
      tags: tags || [],
    },
  })
  expect(response.ok(), `POST /environments failed: ${response.status()}`).toBeTruthy()
  const json = await response.json()
  const data = json.data ?? json
  return data.id as string
}

/** Delete an environment via API (best-effort) */
export async function deleteEnvironmentViaApi(page: Page, envId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/environments/${envId}`).catch(() => {})
}

/** Fetch an environment by ID */
export async function fetchEnvironmentViaApi(
  page: Page,
  envId: string
): Promise<Record<string, unknown> | null> {
  const response = await page.request.get(`${BACKEND_URL}/environments/${envId}`)
  if (!response.ok()) return null
  const json = await response.json()
  return (json.data ?? json) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Content builders
// ---------------------------------------------------------------------------

/** Build minimal YAML content for an environment */
export function buildEnvironmentYaml(name: string, opts?: {
  description?: string
  tags?: string[]
}): string {
  const lines = [
    `name: "${name}"`,
    `description: "${opts?.description || 'Imported environment'}"`,
  ]
  if (opts?.tags && opts.tags.length > 0) {
    lines.push('tags:')
    for (const tag of opts.tags) {
      lines.push(`  - "${tag}"`)
    }
  } else {
    lines.push('tags: []')
  }
  return lines.join('\n') + '\n'
}

/** Build minimal JSON content for an environment */
export function buildEnvironmentJson(name: string, opts?: {
  description?: string
  tags?: string[]
}): string {
  return JSON.stringify(
    {
      name,
      description: opts?.description || 'Imported environment',
      tags: opts?.tags || [],
    },
    null,
    2
  )
}
