/**
 * Shared helpers for import/export functional tests.
 */

import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { BACKEND_URL } from '../../helpers/config'
import { createTestDataFolder, uploadTestData } from '../../helpers/testdata'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

export function loadFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, 'fixture.json'),
    'utf-8'
  )
  return JSON.parse(raw)
}

/** The travel fixture: two File I/O reads of `testdata://` paths, each logged,
 *  so a round trip is proved by the run rather than by a listing (TDATA-1). */
export function loadTravelFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, '../../fixtures/testdata-travel/fixture.json'),
    'utf-8'
  )
  return JSON.parse(raw)
}

// ---------------------------------------------------------------------------
// Test data files the travel fixture reads
// ---------------------------------------------------------------------------

/** One test data file: where it sits and the exact bytes that must survive. */
export interface TravelFile {
  /** Target folder, `''` for the test's own root. */
  folder: string
  name: string
  /** The path the File I/O block references, minus the `testdata://` scheme. */
  rel: string
  content: string
}

export const TRAVEL_ROOT_FILE: TravelFile = {
  folder: '',
  name: 'travel-root.txt',
  rel: 'travel-root.txt',
  content: 'traveling-root-bytes-4f21',
}

export const TRAVEL_NESTED_FILE: TravelFile = {
  folder: 'fixtures',
  name: 'travel-nested.json',
  rel: 'fixtures/travel-nested.json',
  content: '{"marker": "traveling-nested-bytes-9c07", "rows": 3}',
}

export const TRAVEL_FILES: readonly TravelFile[] = [TRAVEL_ROOT_FILE, TRAVEL_NESTED_FILE]

/** The last Log line of the travel fixture; gates the console harvest. */
export const TRAVEL_BOOKEND = 'testdata-travel-complete'

/** Every Block of the travel fixture, for the all-succeeded assertion. */
export const TRAVEL_NODES = [
  'fileio-read-root',
  'fileio-read-nested',
  'log-root',
  'log-nested',
  'log-travel-bookend',
] as const

/** Upload the travel fixture's two files, creating the nested folder first. */
export async function uploadTravelFiles(
  request: APIRequestContext,
  testId: string
): Promise<void> {
  await uploadTestData(
    request,
    testId,
    TRAVEL_ROOT_FILE.folder,
    TRAVEL_ROOT_FILE.name,
    TRAVEL_ROOT_FILE.content
  )
  await createTestDataFolder(request, testId, TRAVEL_NESTED_FILE.folder)
  await uploadTestData(
    request,
    testId,
    TRAVEL_NESTED_FILE.folder,
    TRAVEL_NESTED_FILE.name,
    TRAVEL_NESTED_FILE.content
  )
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

/** Create a test via API and return its ID */
export async function createTestViaApi(
  page: Page,
  fixture: Record<string, unknown>,
  nameOverride?: string
): Promise<string> {
  const data = nameOverride ? { ...fixture, name: nameOverride } : fixture
  const response = await page.request.post(`${BACKEND_URL}/tests`, {
    data,
  })
  expect(response.ok(), `POST /tests failed: ${response.status()}`).toBeTruthy()
  const json = await response.json()
  const testData = json.data ?? json
  return testData.id as string
}

/** Create a test via the admin bulk endpoint, bypassing the unified
 *  write-path validation pipeline. Use this when the fixture deliberately
 *  contains shapes that the pipeline would auto-fix or reject (e.g. an
 *  explicit `type: "startNode"` start node, or duplicate node IDs). The
 *  fixture's `id` must be present and unique.
 *
 *  Idempotently enables admin first, then issues a single `add` op. */
export async function createTestViaAdminBulk(
  page: Page,
  fixture: Record<string, unknown> & { id: string }
): Promise<string> {
  await page.request.post(`${BACKEND_URL}/admin/enable`, {
    data: { reason: 'E2E import-export functional setup' },
  })
  const response = await page.request.post(`${BACKEND_URL}/admin/bulk/tests`, {
    data: { operations: [{ op: 'add', entity: fixture }] },
  })
  expect(
    response.ok(),
    `POST /admin/bulk/tests failed: ${response.status()} ${await response.text()}`,
  ).toBeTruthy()
  return fixture.id
}

/** Delete a test via API (best-effort, ignores errors) */
export async function deleteTestViaApi(page: Page, testId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
}

/** Fetch a test by ID and return its data */
export async function fetchTestViaApi(
  page: Page,
  testId: string
): Promise<Record<string, unknown> | null> {
  const response = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
  if (!response.ok()) return null
  const json = await response.json()
  return (json.data ?? json) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Content builders
// ---------------------------------------------------------------------------

/** Build minimal YAML content for a test definition */
export function buildYamlContent(name: string, opts?: {
  includeVariables?: boolean
  omitPosition?: boolean
  invalidWorkflow?: boolean
}): string {
  const lines = [
    `name: "${name}"`,
    'version: "1.0.0"',
    `description: "Generated test for import"`,
  ]

  if (opts?.invalidWorkflow) {
    lines.push('workflow: "not-an-object"')
  } else {
    lines.push('workflow:')
    lines.push('  nodes:')
    lines.push('    - id: "start-node"')
    lines.push('      type: "startNode"')
    if (!opts?.omitPosition) {
      lines.push('      position:')
      lines.push('        x: 100')
      lines.push('        y: 100')
    }
    lines.push('      data:')
    lines.push('        label: "Start"')
    lines.push('        elementType: "start"')
    lines.push('        nodeType: "start"')
    lines.push('  edges: []')
  }

  if (opts?.includeVariables) {
    lines.push('variables:')
    lines.push('  my_var:')
    lines.push('    type: "string"')
    lines.push('    default: "hello"')
    lines.push('    scope: "test"')
  }

  return lines.join('\n') + '\n'
}

/** Build minimal JSON content for a test definition */
export function buildJsonContent(name: string): string {
  return JSON.stringify(
    {
      name,
      version: '1.0.0',
      description: 'Generated JSON test for import',
      workflow: {
        nodes: [
          {
            id: 'start-node',
            type: 'startNode',
            position: { x: 100, y: 100 },
            data: {
              label: 'Start',
              elementType: 'start',
              nodeType: 'start',
            },
          },
        ],
        edges: [],
      },
    },
    null,
    2
  )
}
