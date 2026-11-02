/**
 * Shared seed for the one value field specs: a Test holding the Local Function Block `deploy_check` whose seven
 * inputs show every field state (FIELD-1..FIELD-8).
 *
 * Imported by V-FIELD-BLOCK-STATES and V-FIELD-SWITCH-WARNING.
 *
 * REQ: REQ-3.1.1.5, REQ-3.1.2.1
 */

import { expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { createValidTest, validateTest } from '../../helpers/fn-seed'
import { openBlockSheet } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

export const DEPLOY_CHECK_ID = 'deploy-check'
export const DEPLOY_CHECK = 'deploy_check'

/** The rows in declared order, as the window lists them. */
export const DEPLOY_CHECK_ROWS = ['region', 'owner', 'prefix', 'note', 'tags', 'targets', 'env'] as const

/** The rows that draw the free-entry value field with its expand (all but the choice list). */
export const FREE_ENTRY_ROWS = ['region', 'owner', 'prefix', 'note', 'tags', 'targets'] as const

export const TARGETS_LINE = '["web-1", {{ backup_host }}, "web-3"]'

const INPUTS = [
  { name: 'region', type: 'string', required: false, default: 'eu-west-1', description: 'Cloud region to check.' },
  { name: 'owner', type: 'string', required: false, default: 'platform', description: 'Team that owns the deploy.' },
  { name: 'prefix', type: 'string', required: false, default: null, description: 'Prefix for resource names.' },
  { name: 'note', type: 'string', required: false, default: null, description: 'Free note for the report.' },
  { name: 'tags', type: 'array', required: false, default: ['smoke'], description: 'Tags the check runs with.' },
  { name: 'targets', type: 'array', required: false, default: null, description: 'Hosts to check.' },
  {
    name: 'env',
    type: 'string',
    required: true,
    default: 'staging',
    enumValues: ['dev', 'staging', 'prod'],
    description: 'Environment to check.',
  },
]

/** `region` and `tags` not set; `owner` its own value; `prefix` empty text; `note` null; `targets` with one {x} entry. */
export const DEPLOY_CHECK_VALUES = {
  owner: 'qa-team',
  prefix: '',
  note: null,
  targets: ['web-1', 'backup_host', 'web-3'],
  env: 'staging',
}

function deployCheckNode(): Record<string, unknown> {
  return {
    id: DEPLOY_CHECK_ID,
    type: 'workflowNode',
    position: { x: 300, y: 200 },
    data: {
      label: DEPLOY_CHECK,
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'local',
      category: 'function',
      version: '1.0.0',
      expressionFields: ['targets.1'],
      templateFields: [],
      variableExpressionKeys: [],
      config: { values: DEPLOY_CHECK_VALUES, outputBindings: {}, profileBindings: [] },
      localDefinition: {
        name: DEPLOY_CHECK,
        workflow: { nodes: [], edges: [] },
        inputs: INPUTS,
        outputs: [],
        variables: [],
      },
    },
    measured: { width: 120, height: 62 },
  }
}

/** Seed the Test through POST /tests, check it validates with zero errors, and return its id. */
export async function seedDeployCheck(request: APIRequestContext, stem: string): Promise<string> {
  const testId = await createValidTest(request, {
    name: `zz-11541-s1-${stem}-${randomUUID().slice(0, 8)}`,
    nodes: [deployCheckNode()],
    edges: [{ id: 'e-start-deploy-check', source: 'start-node', target: DEPLOY_CHECK_ID }],
    variables: { backup_host: { value: 'db-2', type: 'string', scope: 'test' } },
  })
  const validation = await validateTest(request, testId)
  expect(validation.errors, 'the seeded Test validates with zero errors').toEqual([])
  return testId
}

/** The stored config values of `deploy_check` (GET /tests/{id}). */
export async function storedDeployCheck(
  request: APIRequestContext,
  testId: string,
): Promise<{ values: Record<string, unknown>; expressionFields: string[] }> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} answered ${resp.status()}`).toBeTruthy()
  const nodes = ((await resp.json()).data?.workflow?.nodes ?? []) as Array<Record<string, any>>
  const node = nodes.find((n) => n.id === DEPLOY_CHECK_ID)
  expect(node, 'deploy_check is in the stored Test').toBeTruthy()
  return { values: node?.data?.config?.values ?? {}, expressionFields: node?.data?.expressionFields ?? [] }
}

/** Open `deploy_check`'s window on the open Test; returns the window. */
export async function openDeployCheckWindow(page: Page): Promise<Locator> {
  const sheet = await openBlockSheet(page, DEPLOY_CHECK_ID)
  await expect(sheet.getByText(`${DEPLOY_CHECK} - Edit Config`, { exact: true })).toBeVisible()
  return sheet
}

export async function deleteSeededTest(request: APIRequestContext, testId: string): Promise<void> {
  if (!testId) return
  await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  const resp = await request.delete(`${BACKEND_URL}/tests/${testId}`)
  expect([200, 204, 404], `DELETE /tests/${testId} answered ${resp.status()}`).toContain(resp.status())
}
