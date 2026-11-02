/**
 * Shared helpers for suite import/export functional tests.
 */

import { expect, type Page } from '@playwright/test'
import { BACKEND_URL } from '../../helpers/config'

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/** Create a suite via API and return its ID */
export async function createSuiteViaApi(
  page: Page,
  name: string,
  opts?: {
    description?: string
    tests?: string[]
    variables?: Record<string, unknown>
    tags?: string[]
  }
): Promise<string> {
  const response = await page.request.post(`${BACKEND_URL}/suites`, {
    data: {
      name,
      description: opts?.description ?? `Test suite: ${name}`,
      tests: opts?.tests ?? [],
      variables: opts?.variables ?? {},
      tags: opts?.tags ?? [],
    },
  })
  expect(response.ok(), `POST /suites failed: ${response.status()}`).toBeTruthy()
  const json = await response.json()
  return (json.data ?? json).id as string
}

/** Delete a suite via API (best-effort) */
export async function deleteSuiteViaApi(page: Page, suiteId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/suites/${suiteId}`).catch(() => {})
}

/** Fetch a suite by ID */
export async function fetchSuiteViaApi(
  page: Page,
  suiteId: string
): Promise<Record<string, unknown> | null> {
  const response = await page.request.get(`${BACKEND_URL}/suites/${suiteId}`)
  if (!response.ok()) return null
  const json = await response.json()
  return (json.data ?? json) as Record<string, unknown>
}

/** Create a test via API and return its ID */
export async function createTestViaApi(
  page: Page,
  name: string
): Promise<string> {
  const response = await page.request.post(`${BACKEND_URL}/tests`, {
    data: {
      name,
      description: `Test for suite I/E: ${name}`,
      workflow: { nodes: [], edges: [] },
    },
  })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const json = await response.json()
  return (json.data ?? json).id as string
}

/** Delete a test via API (best-effort) */
export async function deleteTestViaApi(page: Page, testId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
}

// ---------------------------------------------------------------------------
// Content builders
// ---------------------------------------------------------------------------

/** Build minimal YAML for a suite */
export function buildSuiteYaml(name: string, opts?: {
  tests?: string[]
  variables?: Record<string, Record<string, unknown>>
  tags?: string[]
}): string {
  const lines = [
    `name: "${name}"`,
    `description: "Imported suite"`,
    `version: "1.0.0"`,
  ]

  // Tests
  if (opts?.tests && opts.tests.length > 0) {
    lines.push('tests:')
    for (const testId of opts.tests) {
      lines.push(`  - "${testId}"`)
    }
  } else {
    lines.push('tests: []')
  }

  // Variables
  if (opts?.variables && Object.keys(opts.variables).length > 0) {
    lines.push('variables:')
    for (const [varName, varInfo] of Object.entries(opts.variables)) {
      lines.push(`  "${varName}":`)
      for (const [k, v] of Object.entries(varInfo)) {
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
    for (const tag of opts.tags) {
      lines.push(`  - "${tag}"`)
    }
  } else {
    lines.push('tags: []')
  }

  return lines.join('\n') + '\n'
}

/** Build minimal JSON for a suite */
export function buildSuiteJson(name: string, opts?: {
  tests?: string[]
  variables?: Record<string, Record<string, unknown>>
  tags?: string[]
}): string {
  return JSON.stringify(
    {
      name,
      description: 'Imported suite',
      version: '1.0.0',
      tests: opts?.tests ?? [],
      variables: opts?.variables ?? {},
      tags: opts?.tags ?? [],
    },
    null,
    2
  )
}
