/**
 * Shared helpers for profile import/export functional tests.
 */

import { expect, type Page } from '@playwright/test'
import { BACKEND_URL } from '../../helpers/config'

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/** Create an environment via API and return its ID */
export async function createEnvironmentViaApi(
  page: Page,
  name: string
): Promise<string> {
  const response = await page.request.post(`${BACKEND_URL}/environments`, {
    data: { name, description: `Env for profile tests: ${name}`, tags: [] },
  })
  expect(response.ok(), `POST /environments failed: ${response.status()}`).toBeTruthy()
  const json = await response.json()
  return (json.data ?? json).id as string
}

/** Delete an environment via API (best-effort) */
export async function deleteEnvironmentViaApi(page: Page, envId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/environments/${envId}`).catch(() => {})
}

/** Create a profile via API and return its ID */
export async function createProfileViaApi(
  page: Page,
  name: string,
  opts?: {
    type?: string
    envValues?: Record<string, Record<string, unknown>>
    config?: Record<string, unknown>
  }
): Promise<string> {
  const response = await page.request.post(`${BACKEND_URL}/profiles`, {
    data: {
      name,
      type: opts?.type || 'custom',
      description: `Test profile: ${name}`,
      tags: [],
      config: opts?.config || {},
      environment_values: opts?.envValues || {},
    },
  })
  expect(response.ok(), `POST /profiles failed: ${response.status()}`).toBeTruthy()
  const json = await response.json()
  return (json.data ?? json).id as string
}

/** Delete a profile via API (best-effort) */
export async function deleteProfileViaApi(page: Page, profileId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/profiles/${profileId}`).catch(() => {})
}

/** Fetch a profile by ID */
export async function fetchProfileViaApi(
  page: Page,
  profileId: string
): Promise<Record<string, unknown> | null> {
  const response = await page.request.get(`${BACKEND_URL}/profiles/${profileId}`)
  if (!response.ok()) return null
  const json = await response.json()
  return (json.data ?? json) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Content builders
// ---------------------------------------------------------------------------

/** Build minimal YAML for a profile */
export function buildProfileYaml(name: string, opts?: {
  type?: string
  envValues?: Record<string, Record<string, unknown>>
}): string {
  const lines = [
    `name: "${name}"`,
    `type: "${opts?.type || 'custom'}"`,
    `description: "Imported profile"`,
    'tags: []',
    'config: {}',
  ]
  if (opts?.envValues && Object.keys(opts.envValues).length > 0) {
    lines.push('environment_values:')
    for (const [envName, values] of Object.entries(opts.envValues)) {
      lines.push(`  "${envName}":`)
      for (const [k, v] of Object.entries(values)) {
        lines.push(`    ${k}: "${v}"`)
      }
    }
  } else {
    lines.push('environment_values: {}')
  }
  return lines.join('\n') + '\n'
}

/** Build minimal JSON for a profile */
export function buildProfileJson(name: string, opts?: {
  type?: string
  envValues?: Record<string, Record<string, unknown>>
}): string {
  return JSON.stringify(
    {
      name,
      type: opts?.type || 'custom',
      description: 'Imported profile',
      tags: [],
      config: {},
      environment_values: opts?.envValues || {},
    },
    null,
    2
  )
}
