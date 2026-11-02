/** Seed for the SQL config-sheet specs: one SQL block on a Test, opened with its sheet up (REQ-3.4.1.6). */

import { expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importExpectingErrors, importValidateAndNavigate } from '../../helpers/fixture-import'
import { deleteTest, openConfig } from '../../functional/file-picker/picker'

export const SQL_NODE_ID = '3c9e5a17-8b42-4f06-9d1e-6a0b2c7f4e81'
const START_EDGE_ID = 'e7d21b04-5f3a-4c8e-b196-0a4f8d3c2e57'

export const SQL_SHEET_TITLE = 'SQL - Edit Config'
export const SETTINGS_NOTE = 'Save is disabled: the settings have errors'
export const EMPTY_PREVIEW = 'Edit…'

export interface SqlBlockOptions {
  /** Rows written as expressions rather than literals. */
  expressionFields?: string[]
}

/** One SQL block on the Test, wired from Start. */
export function sqlFixture(
  name: string,
  values: Record<string, unknown>,
  { expressionFields = [] }: SqlBlockOptions = {},
): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: [
        {
          id: SQL_NODE_ID,
          type: 'workflowNode',
          position: { x: -75, y: 100 },
          data: {
            label: 'SQL',
            elementType: 'sql-client',
            nodeType: 'plugin',
            category: 'database',
            version: '1.0.0',
            description: '',
            hasNewerVersion: false,
            expressionFields,
            templateFields: [],
            config: { values, outputBindings: {}, profileBindings: [] },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [{ id: START_EDGE_ID, source: 'start-node', target: SQL_NODE_ID }],
    },
    variables: {},
    metadata: { tags: [], suite_id: null, parent_suite: null },
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

/** Seed a block with empty required rows through the admin route (POST /tests refuses it) and open its sheet. */
export async function openIncompleteSqlSheet(
  page: Page,
  name: string,
  values: Record<string, unknown>,
  missingRows: string[],
): Promise<OpenedSheet> {
  const imported = await importExpectingErrors(page, sqlFixture(name, values))
  expect(findingRows(imported.errors), 'the server names exactly the empty required rows').toEqual(
    missingRows.map((row) => `REQUIRED_PARAM_MISSING ${row}`).sort(),
  )
  const sheet = await openConfig(page, SQL_NODE_ID)
  await expect(sheet.getByRole('heading', { name: SQL_SHEET_TITLE })).toBeVisible()
  return { testId: imported.testId, sheet }
}

/** Seed a block that passes the zero-error validation gate, then open its sheet. */
export async function openValidSqlSheet(
  page: Page,
  name: string,
  values: Record<string, unknown>,
  options: SqlBlockOptions = {},
): Promise<OpenedSheet> {
  const testId = await importValidateAndNavigate(page, sqlFixture(name, values, options))
  const sheet = await openConfig(page, SQL_NODE_ID)
  await expect(sheet.getByRole('heading', { name: SQL_SHEET_TITLE })).toBeVisible()
  return { testId, sheet }
}

export async function deleteSqlTests(request: APIRequestContext, testIds: string[]): Promise<void> {
  for (const testId of testIds.splice(0)) await deleteTest(request, testId)
}
