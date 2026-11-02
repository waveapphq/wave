/**
 * Shared helpers for regression import/export functional tests.
 */

import { expect, type Page } from '@playwright/test'
import { BACKEND_URL } from '../../helpers/config'

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/** Create a regression via API and return its ID */
export async function createRegressionViaApi(
  page: Page,
  name: string,
  opts?: { description?: string; suites?: string[]; variables?: Record<string, unknown>; tags?: string[] }
): Promise<string> {
  const response = await page.request.post(`${BACKEND_URL}/regressions`, {
    data: { name, description: opts?.description ?? `Test regression: ${name}`, tags: opts?.tags ?? [] },
  })
  expect(response.ok(), `POST /regressions failed: ${response.status()}`).toBeTruthy()
  const json = await response.json()
  const id = (json.data ?? json).id as string

  // Apply variables and suites via PUT if provided
  if (opts?.variables || opts?.suites) {
    const putData: Record<string, unknown> = {}
    if (opts.variables) putData.variables = opts.variables
    if (opts.suites) putData.suites = opts.suites
    const putResp = await page.request.put(`${BACKEND_URL}/regressions/${id}`, { data: putData })
    expect(putResp.ok(), `PUT /regressions/${id} failed: ${putResp.status()}`).toBeTruthy()
  }

  return id
}

/** Delete a regression via API (best-effort) */
export async function deleteRegressionViaApi(page: Page, id: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/regressions/${id}`).catch(() => {})
}

/** Fetch a regression by ID */
export async function fetchRegressionViaApi(page: Page, id: string): Promise<Record<string, unknown> | null> {
  const response = await page.request.get(`${BACKEND_URL}/regressions/${id}`)
  if (!response.ok()) return null
  const json = await response.json()
  return (json.data ?? json) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Content builders
// ---------------------------------------------------------------------------

/** Build minimal YAML for a regression */
export function buildRegressionYaml(name: string, opts?: {
  suites?: string[]; variables?: Record<string, Record<string, unknown>>; tags?: string[]
}): string {
  const lines = [
    `name: "${name}"`,
    `description: "Imported regression"`,
    `version: "1.0.0"`,
  ]

  // Suites
  if (opts?.suites && opts.suites.length > 0) {
    lines.push('suites:')
    for (const s of opts.suites) {
      lines.push(`  - "${s}"`)
    }
  } else {
    lines.push('suites: []')
  }

  // Variables
  if (opts?.variables && Object.keys(opts.variables).length > 0) {
    lines.push('variables:')
    for (const [name, info] of Object.entries(opts.variables)) {
      lines.push(`  "${name}":`)
      for (const [k, v] of Object.entries(info)) {
        if (typeof v === 'boolean') {
          lines.push(`    ${k}: ${v}`)
        } else {
          lines.push(`    ${k}: "${v}"`)
        }
      }
    }
  } else {
    lines.push('variables: {}')
  }

  // Tags
  if (opts?.tags && opts.tags.length > 0) {
    lines.push('tags:')
    for (const t of opts.tags) {
      lines.push(`  - "${t}"`)
    }
  } else {
    lines.push('tags: []')
  }

  return lines.join('\n') + '\n'
}

/** Build minimal JSON for a regression */
export function buildRegressionJson(name: string, opts?: {
  suites?: string[]; variables?: Record<string, Record<string, unknown>>; tags?: string[]
}): string {
  return JSON.stringify(
    {
      name,
      description: 'Imported regression',
      version: '1.0.0',
      suites: opts?.suites ?? [],
      variables: opts?.variables ?? {},
      tags: opts?.tags ?? [],
    },
    null,
    2
  )
}
