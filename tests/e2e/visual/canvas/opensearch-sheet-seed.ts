/** Seed for the OpenSearch config-sheet specs: one OpenSearch block on a Test, opened with its sheet up (REQ-3.4.1.15). */

import { expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importExpectingErrors } from '../../helpers/fixture-import'
import { createValidTest, openTest, validateTest } from '../../helpers/fn-seed'
import {
  CA_CERT_PEM,
  OPENSEARCH_PASSWORD,
  OPENSEARCH_PORT,
  OPENSEARCH_TARGET_HOST,
  OPENSEARCH_USER,
  ensureEnvironment,
} from '../../helpers/config'
import { deleteTest, openConfig } from '../../functional/file-picker/picker'

export const OPENSEARCH_NODE_ID = '9108bde5-a714-4204-9e5d-5ff84f698e10'
const START_EDGE_ID = 'e97ae0c3-e5c2-4bff-a594-7fae075988e2'

export const OPENSEARCH_SHEET_TITLE = 'OpenSearch - Edit Config'
export const SETTINGS_NOTE = 'Save is disabled: the settings have errors'

export interface OpenSearchBlockOptions {
  /** Rows written as expressions (`fields.<i>.value` / `stats.<i>.value` for one list entry). */
  expressionFields?: string[]
  /** Rows whose text is a Template (`query` holding `{{ }}`). */
  templateFields?: string[]
  outputBindings?: Record<string, string>
}

/** One OpenSearch block node; `position` places it on the canvas. */
export function openSearchNode(
  id: string,
  values: Record<string, unknown>,
  { expressionFields = [], templateFields = [], outputBindings = {} }: OpenSearchBlockOptions = {},
  position: { x: number; y: number } = { x: -75, y: 100 },
): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position,
    data: {
      label: 'OpenSearch',
      elementType: 'opensearch',
      nodeType: 'plugin',
      category: 'database',
      version: '1.0.0',
      description: '',
      hasNewerVersion: false,
      expressionFields,
      templateFields,
      config: { values, outputBindings, profileBindings: [] },
    },
    measured: { width: 150, height: 62 },
  }
}

/** A Test holding one OpenSearch block (`OPENSEARCH_NODE_ID`), wired from Start. */
export function openSearchFixture(
  name: string,
  values: Record<string, unknown>,
  options: OpenSearchBlockOptions = {},
): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: [openSearchNode(OPENSEARCH_NODE_ID, values, options)],
      edges: [{ id: START_EDGE_ID, source: 'start-node', target: OPENSEARCH_NODE_ID }],
    },
    variables: {},
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

/** The connection rows that reach the E2E cluster: its https URL, the `wave` user, the lab CA and Verify on. */
export function realClusterValues(index: string): Record<string, unknown> {
  return {
    url: `https://${OPENSEARCH_TARGET_HOST}:${OPENSEARCH_PORT}`,
    index,
    username: OPENSEARCH_USER,
    password: OPENSEARCH_PASSWORD,
    ca_cert: CA_CERT_PEM,
    verify_ssl: true,
  }
}

/** The config values each run-context finding names, as `<code> <row>`. */
function findingRows(errors: Array<Record<string, unknown>>): string[] {
  return errors.map((e) => `${String(e.code)} ${String(e.path ?? '').split('.').pop()}`).sort()
}

export interface OpenedSheet {
  testId: string
  sheet: Locator
}

/** Persist a Test through POST /tests (a unique name) and the zero-error validation gate; returns its id. */
export async function seedTest(request: APIRequestContext, fixture: Record<string, unknown>): Promise<string> {
  await ensureEnvironment(request)
  const source = fixture as {
    name?: string
    workflow: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }
    variables?: Record<string, unknown>
  }
  const testId = await createValidTest(request, {
    name: `${source.name ?? 'OpenSearch'} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    nodes: source.workflow.nodes,
    edges: source.workflow.edges,
    variables: source.variables ?? {},
  })
  const { errors } = await validateTest(request, testId, 'run')
  expect(errors, `the seeded Test validates with zero errors: ${JSON.stringify(errors)}`).toEqual([])
  return testId
}

/** Persist a Test holding one OpenSearch block (usable from beforeAll); returns its id for afterAll. */
export function seedOpenSearchTest(
  request: APIRequestContext,
  name: string,
  values: Record<string, unknown>,
  options: OpenSearchBlockOptions = {},
): Promise<string> {
  return seedTest(request, openSearchFixture(name, values, options))
}

/** Open a seeded Test on the canvas (workbench slot freed, draft cleared) and the sheet of its OpenSearch block. */
export async function openOpenSearchSheet(page: Page, testId: string, nodeId = OPENSEARCH_NODE_ID): Promise<Locator> {
  await openTest(page, testId)
  return openSheetOf(page, nodeId)
}

/** Open the sheet of an OpenSearch block already on the canvas. */
export async function openSheetOf(page: Page, nodeId = OPENSEARCH_NODE_ID): Promise<Locator> {
  const sheet = await openConfig(page, nodeId)
  await expect(sheet.getByRole('heading', { name: OPENSEARCH_SHEET_TITLE })).toBeVisible()
  return sheet
}

/** Seed a block that passes the zero-error validation gate, then open its sheet. */
export async function openValidOpenSearchSheet(
  page: Page,
  name: string,
  values: Record<string, unknown>,
  options: OpenSearchBlockOptions = {},
): Promise<OpenedSheet> {
  const testId = await seedOpenSearchTest(page.request, name, values, options)
  return { testId, sheet: await openOpenSearchSheet(page, testId) }
}

/** Seed a block with empty required rows through the admin route (POST /tests refuses it) and open its sheet. */
export async function openIncompleteOpenSearchSheet(
  page: Page,
  name: string,
  values: Record<string, unknown>,
  missingRows: string[],
): Promise<OpenedSheet> {
  const imported = await importExpectingErrors(page, openSearchFixture(name, values))
  expect(findingRows(imported.errors), 'the server names exactly the empty required rows').toEqual(
    missingRows.map((row) => `REQUIRED_PARAM_MISSING ${row}`).sort(),
  )
  return { testId: imported.testId, sheet: await openSheetOf(page) }
}

export async function deleteOpenSearchTests(request: APIRequestContext, testIds: string[]): Promise<void> {
  for (const testId of testIds.splice(0)) await deleteTest(request, testId)
}
