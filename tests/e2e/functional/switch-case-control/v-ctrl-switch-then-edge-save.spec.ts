/**
 * V-CTRL-SWITCH-THEN-EDGE-SAVE: config save must not sweep the non-branch
 * egress edge.
 *
 * The config-save orphan sweep removes edges whose source lane is not a declared
 * branch. A container's `then` is an egress, not a branch, so it stays. This spec
 * edits a case through the UI, saves, and proves the `then` edge is still on the
 * canvas AND still in the persisted test - then deletes a case and proves that
 * lane's edge IS removed.
 *
 * REQ: REQ-3.5.1.20 (Switch/Case multi-branch decisions)
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openBlockSheet } from '../../helpers/workbench'

const BASE = `http://localhost:${BACKEND_PORT}`

const SWITCH_ID = 'sw-save'

function logNode(id: string, description: string, x: number, y: number) {
  return {
    id,
    type: 'workflowNode',
    position: { x, y },
    data: {
      label: 'Log',
      elementType: 'log',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      description,
      expressionFields: ['message'],
      templateFields: [],
      variableExpressionKeys: [],
      config: {
        values: { message: `'${id}'`, level: 'INFO' },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { width: 120, height: 62 },
  }
}

function caseBranch(id: string, label: string, reference: string) {
  return {
    id,
    type: 'case',
    label,
    break: true,
    conditions: [
      {
        type: 'literal',
        variable: 'sw',
        value_type: 'string',
        operator: 'equals',
        reference_value: reference,
        reference_is_expression: false,
        id: `cond-${id}`,
      },
    ],
  }
}

function buildFixture(): Record<string, unknown> {
  return {
    name: `V-CTRL-SWITCH-THEN-EDGE-SAVE ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'Switch with two wired cases and a wired then egress.',
    workflow: {
      nodes: [
        {
          id: SWITCH_ID,
          type: 'workflowNode',
          position: { x: 400, y: 120 },
          data: {
            label: 'Switch',
            elementType: 'switch-case',
            nodeType: 'control',
            category: 'conditional',
            version: '1.0.0',
            description: 'Switch under test',
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: {
                branches: [caseBranch('branch_0', 'first', 'a'), caseBranch('branch_1', 'second', 'b')],
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
          measured: { width: 240, height: 62 },
        },
        logNode('log-case-a', 'Case A body', 200, 300),
        logNode('log-case-b', 'Case B body', 380, 300),
        logNode('log-then', 'Then body', 600, 300),
      ],
      edges: [
        { id: 'e-start', source: 'start-node', target: SWITCH_ID, type: 'default' },
        { id: 'e-a', source: SWITCH_ID, sourceHandle: 'branch_0', target: 'log-case-a', type: 'default' },
        { id: 'e-b', source: SWITCH_ID, sourceHandle: 'branch_1', target: 'log-case-b', type: 'default' },
        { id: 'e-then', source: SWITCH_ID, sourceHandle: 'then', target: 'log-then', type: 'default' },
      ],
    },
    variables: { sw: { value: 'a', type: 'string', scope: 'test' } },
    metadata: {},
  }
}

async function persistedSourceHandles(
  request: APIRequestContext,
  testId: string,
): Promise<string[]> {
  const resp = await request.get(`${BASE}/tests/${testId}/workflow`)
  expect(resp.ok(), `GET /tests/${testId}/workflow failed: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as Record<string, unknown>
  const data = (body.data ?? body) as { edges?: Array<Record<string, unknown>> }
  return (data.edges ?? [])
    .filter((e) => e.source === SWITCH_ID)
    .map((e) => String(e.sourceHandle ?? ''))
}

async function openSwitchConfig(page: Page) {
  const node = page.locator(`[data-testid="workflow-node-${SWITCH_ID}"]`)
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  await openBlockSheet(page, SWITCH_ID)
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible({ timeout: 10_000 })
  return sheet
}

async function saveSheetAndWorkflow(page: Page, sheet: ReturnType<typeof configSheet>) {
  const saveBtn = sheet.getByRole('button', { name: /^Save$/ })
  await expect(saveBtn).toBeEnabled()
  await saveBtn.click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })

  const toolbarSave = page.locator('[data-testid="toolbar-save-button"]')
  await expect(toolbarSave).toBeEnabled({ timeout: 10_000 })
  await toolbarSave.click()
  await expect(toolbarSave).toBeDisabled({ timeout: 15_000 })
}

test.describe('V-CTRL-SWITCH-THEN-EDGE-SAVE: the then egress survives a config save', () => {
  test('editing a case keeps the then edge; deleting a case still drops that lane', async ({
    page,
    request,
  }) => {
    await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
    const resp = await request.post(`${BASE}/tests`, { data: buildFixture() })
    const body = await resp.json().catch(() => null)
    expect(resp.ok(), `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
    const testId = body.data?.id ?? body.id

    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await test.step('Rename a case and save - the then edge stays', async () => {
      const sheet = await openSwitchConfig(page)
      const labelInput = sheet.locator('[data-testid="case-label-branch_0"]')
      await expect(labelInput).toBeVisible()
      await labelInput.fill('renamed first')
      await saveSheetAndWorkflow(page, sheet)

      // On the canvas: start -> switch, two lanes, then. Nothing swept.
      await expect(page.locator('.react-flow__edge')).toHaveCount(4, { timeout: 5_000 })

      // And in storage.
      const handles = await persistedSourceHandles(request, testId)
      expect(handles.sort(), `persisted Switch lanes: ${JSON.stringify(handles)}`).toEqual([
        'branch_0',
        'branch_1',
        'then',
      ])
    })

    await test.step('Delete the second case - its lane edge goes, then stays', async () => {
      const sheet = await openSwitchConfig(page)
      await sheet.locator('[data-testid="case-delete-branch_1"]').click()
      await expect(sheet.locator('[data-testid="case-card-branch_1"]')).toHaveCount(0)
      await saveSheetAndWorkflow(page, sheet)

      await expect(page.locator('.react-flow__edge')).toHaveCount(3, { timeout: 5_000 })
      const handles = await persistedSourceHandles(request, testId)
      expect(
        handles.sort(),
        `a deleted case must drop its lane while then survives: ${JSON.stringify(handles)}`,
      ).toEqual(['branch_0', 'then'])
    })
  })
})
