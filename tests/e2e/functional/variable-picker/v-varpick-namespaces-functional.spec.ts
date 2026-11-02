/**
 * V-VARPICK-NAMESPACES-FUNCTIONAL: what the shared variable picker offers.
 *
 * A bare namespace name (`system`, `suite`, `regression`) is a container, not a
 * variable - picking it would bind a condition to nothing. Its members are real
 * variables and must be offered with their real types. Expression autocomplete
 * keeps the bare roots, because there `system.` is a legitimate prefix to type.
 *
 * Also pins the OUT badge: OUT means "a node writes this variable", not
 * "this variable has an origin", so a system member wears no badge while a
 * variable actually bound to a node's output still does.
 *
 * REQ: REQ-3.5.1.20 (shared variable picker, VARPICK-1, VARPICK-2)
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet, openBlockSheet } from '../../helpers/workbench'

const SWITCH_ID = 'vp-switch'
const WHILE_ID = 'vp-while'
const LOG_ID = 'vp-log'

const UNIQUE = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

interface Seeded {
  testId: string
  suiteId: string
  regressionId: string
}

function buildFixture(): Record<string, unknown> {
  return {
    name: `V-VARPICK namespaces ${UNIQUE}`,
    version: '1.0.0',
    description: 'Switch + While + Log for picker and autocomplete coverage.',
    workflow: {
      nodes: [
        {
          id: SWITCH_ID,
          type: 'workflowNode',
          position: { x: 320, y: 140 },
          data: {
            label: 'Switch',
            elementType: 'switch-case',
            nodeType: 'control',
            category: 'conditional',
            version: '1.0.0',
            description: 'Picker host',
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: {
                branches: [
                  {
                    id: 'branch_0',
                    type: 'case',
                    label: 'first',
                    break: true,
                    conditions: [
                      {
                        type: 'literal',
                        variable: 'mode',
                        value_type: 'string',
                        operator: 'equals',
                        reference_value: 'go',
                        reference_is_expression: false,
                        id: 'vp-cond-0',
                      },
                    ],
                  },
                ],
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
        {
          id: WHILE_ID,
          type: 'workflowNode',
          position: { x: 320, y: 320 },
          data: {
            label: 'While Loop',
            elementType: 'while',
            nodeType: 'control',
            category: 'loop',
            version: '1.0.0',
            description: 'Output binder',
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: {
                mode: 'while-do',
                max_iterations: 3,
                conditions: [
                  {
                    type: 'literal',
                    variable: 'mode',
                    value_type: 'string',
                    operator: 'equals',
                    reference_value: 'never',
                    reference_is_expression: false,
                    id: 'vp-while-cond',
                  },
                ],
              },
              // Binds `loop_index` to a node output - the only thing OUT means.
              outputBindings: { index: 'loop_index' },
              profileBindings: [],
            },
          },
        },
        {
          id: LOG_ID,
          type: 'workflowNode',
          position: { x: 320, y: 500 },
          data: {
            label: 'Log',
            elementType: 'log',
            nodeType: 'plugin',
            category: 'system',
            version: '1.0.0',
            description: 'Autocomplete host',
            expressionFields: ['message'],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { message: "'hello'", level: 'INFO' },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
      ],
      edges: [
        { id: 'e-start', source: 'start-node', target: SWITCH_ID, type: 'default' },
        { id: 'e-then', source: SWITCH_ID, sourceHandle: 'then', target: WHILE_ID, type: 'default' },
        { id: 'e-while-then', source: WHILE_ID, sourceHandle: 'then', target: LOG_ID, type: 'default' },
      ],
    },
    variables: {
      mode: { value: 'go', type: 'string', scope: 'test' },
      loop_index: { value: 0, type: 'integer', scope: 'test' },
    },
    metadata: {},
  }
}

async function seed(request: APIRequestContext): Promise<Seeded> {
  const sysResp = await request.post(`${BACKEND_URL}/variables/system`, {
    data: {
      variables: {
        sys_flag: { type: 'boolean', value: true },
        sys_count: { type: 'integer', value: 7 },
      },
    },
  })
  expect(sysResp.ok(), `Set system variables failed: ${sysResp.status()}`).toBeTruthy()

  const suiteResp = await request.post(`${BACKEND_URL}/suites`, {
    data: { name: `VarPicker Suite ${UNIQUE}`, description: 'variable picker namespaces' },
  })
  expect(suiteResp.ok(), `Create suite failed: ${suiteResp.status()}`).toBeTruthy()
  const suiteId = (await suiteResp.json()).data.id as string

  const suiteVars = await request.put(`${BACKEND_URL}/suites/${suiteId}/variables`, {
    data: { suite_host: { type: 'string', value: 'localhost' } },
  })
  expect(suiteVars.ok(), `Set suite variables failed: ${suiteVars.status()}`).toBeTruthy()

  const regResp = await request.post(`${BACKEND_URL}/regressions`, {
    data: { name: `VarPicker Regression ${UNIQUE}` },
  })
  expect(regResp.ok(), `Create regression failed: ${regResp.status()}`).toBeTruthy()
  const regressionId = (await regResp.json()).data.id as string

  const regUpdate = await request.put(`${BACKEND_URL}/regressions/${regressionId}`, {
    data: {
      suites: [suiteId],
      variables: { reg_env: { type: 'string', value: 'staging' } },
    },
  })
  expect(regUpdate.ok(), `Update regression failed: ${regUpdate.status()}`).toBeTruthy()

  const testResp = await request.post(`${BACKEND_URL}/tests`, { data: buildFixture() })
  const testBody = await testResp.json().catch(() => null)
  expect(
    testResp.ok(),
    `Create test failed: ${testResp.status()} - ${JSON.stringify(testBody)}`,
  ).toBeTruthy()
  const testId = (testBody.data?.id ?? testBody.id) as string

  const addResp = await request.post(`${BACKEND_URL}/suites/${suiteId}/tests`, {
    data: { test_id: testId },
  })
  expect(addResp.ok(), `Add test to suite failed: ${addResp.status()}`).toBeTruthy()

  return { testId, suiteId, regressionId }
}

async function openWorkbench(page: Page, testId: string): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function openConfig(page: Page, nodeId: string): Promise<Locator> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  await openBlockSheet(page, nodeId)
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible({ timeout: 10_000 })
  return sheet
}

/** Open the Switch case's condition picker and return its option rows. */
async function openCasePicker(page: Page, sheet: Locator): Promise<Locator> {
  const anchor = sheet.locator('[data-testid="case-body-branch_0"] [data-testid="assert-variable-0"]')
  await expect(anchor).toBeVisible()
  await anchor.click()
  const options = page.getByRole('option')
  await expect(options.first()).toBeVisible({ timeout: 5_000 })
  return options
}

test.describe('V-VARPICK-NAMESPACES: namespace members are variables, roots are not', () => {
  let seeded: Seeded

  test.beforeAll(async ({ request }) => {
    seeded = await seed(request)
  })

  test.afterAll(async ({ request }) => {
    if (seeded?.testId) await request.delete(`${BACKEND_URL}/tests/${seeded.testId}`).catch(() => {})
    if (seeded?.suiteId) await request.delete(`${BACKEND_URL}/suites/${seeded.suiteId}`).catch(() => {})
    if (seeded?.regressionId) {
      await request.delete(`${BACKEND_URL}/regressions/${seeded.regressionId}`).catch(() => {})
    }
    await request.delete(`${BACKEND_URL}/variables/system`).catch(() => {})
  })

  test('the picker offers namespace members with their real types and never the bare roots', async ({
    page,
  }) => {
    await openWorkbench(page, seeded.testId)
    const sheet = await openConfig(page, SWITCH_ID)
    const options = await openCasePicker(page, sheet)

    const names = await options.locator('span.font-mono').allTextContents()
    const trimmed = names.map((n) => n.trim())

    await test.step('Members of every namespace are offered', () => {
      for (const member of ['system.sys_flag', 'system.sys_count', 'suite.suite_host', 'regression.reg_env']) {
        expect(trimmed, `expected ${member} among ${JSON.stringify(trimmed)}`).toContain(member)
      }
    })

    await test.step('The bare roots are not offered', () => {
      for (const root of ['system', 'suite', 'regression']) {
        expect(trimmed, `bare "${root}" must not be pickable: ${JSON.stringify(trimmed)}`).not.toContain(root)
      }
    })

    await test.step('Each member carries its real type, not a namespace type', async () => {
      const typeOf = async (name: string) =>
        (await options.filter({ hasText: name }).first().textContent())?.trim() ?? ''
      expect(await typeOf('system.sys_flag')).toContain('boolean')
      expect(await typeOf('system.sys_count')).toContain('integer')
      expect(await typeOf('suite.suite_host')).toContain('string')
      expect(await typeOf('regression.reg_env')).toContain('string')
    })

    await test.step('OUT marks an output binding, not any origin (5.1 fix)', async () => {
      const systemOption = options.filter({ hasText: 'system.sys_flag' }).first()
      await expect(
        systemOption.getByText('OUT', { exact: true }),
        'a system variable is not written by a node, so it wears no OUT badge',
      ).toHaveCount(0)

      const boundOption = options.filter({ hasText: 'loop_index' }).first()
      await expect(
        boundOption.getByText('OUT', { exact: true }),
        'a variable bound to a node output keeps its OUT badge',
      ).toHaveCount(1)
    })
  })

  test('picking a namespaced variable persists and reads back unchanged', async ({
    page,
    request,
  }) => {
    await openWorkbench(page, seeded.testId)
    const sheet = await openConfig(page, SWITCH_ID)
    const options = await openCasePicker(page, sheet)

    await options.filter({ hasText: 'system.sys_count' }).first().click()
    const anchor = sheet.locator('[data-testid="case-body-branch_0"] [data-testid="assert-variable-0"]')
    await expect(anchor).toHaveValue('system.sys_count')
    // The row now compares a whole number, so its compare-to value must be one (REQ-3.1.3.14).
    const compareTo = sheet.locator('[data-testid="case-body-branch_0"] [data-testid="assert-value-input-0"]')
    await compareTo.fill('3')
    await expect(compareTo).toHaveValue('3')

    const saveBtn = sheet.getByRole('button', { name: /^Save$/ })
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await expect(sheet).toBeHidden({ timeout: 10_000 })

    const toolbarSave = page.locator('[data-testid="toolbar-save-button"]')
    await expect(toolbarSave).toBeEnabled({ timeout: 10_000 })
    await toolbarSave.click()
    await expect(toolbarSave).toBeDisabled({ timeout: 15_000 })

    const resp = await request.get(`${BACKEND_URL}/tests/${seeded.testId}/workflow`)
    expect(resp.ok(), `GET workflow failed: ${resp.status()}`).toBeTruthy()
    const body = (await resp.json()) as Record<string, unknown>
    const data = (body.data ?? body) as { nodes?: Array<Record<string, unknown>> }
    const node = (data.nodes ?? []).find((n) => n.id === SWITCH_ID)
    const values = (((node?.data ?? {}) as Record<string, unknown>).config as
      | Record<string, unknown>
      | undefined)?.values as Record<string, unknown> | undefined
    const branches = (values?.branches as Array<Record<string, unknown>>) ?? []
    const condition = ((branches[0]?.conditions ?? []) as Array<Record<string, unknown>>)[0] ?? {}

    expect(
      condition.variable,
      `the namespaced name must survive the save: ${JSON.stringify(condition)}`,
    ).toBe('system.sys_count')
    expect(
      condition.value_type,
      `the picked member's real type must survive the save: ${JSON.stringify(condition)}`,
    ).toBe('integer')
  })

  test('expression autocomplete still offers the bare roots', async ({ page }) => {
    await openWorkbench(page, seeded.testId)
    const sheet = await openConfig(page, LOG_ID)

    const editor = sheet.locator('[data-testid="param-input-message"] .cm-content')
    await expect(editor).toBeVisible()
    await editor.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('sys', { delay: 40 })

    const autocomplete = page.locator('.cm-tooltip-autocomplete')
    await expect(autocomplete).toBeVisible({ timeout: 5_000 })
    const labels = (
      await autocomplete.locator('.cm-completionLabel').allTextContents()
    ).map((l) => l.trim())

    expect(
      labels,
      `the bare root stays a legitimate prefix to type: ${JSON.stringify(labels)}`,
    ).toContain('system')

    // And completing the root reaches its members, which is what the root is for.
    await page.keyboard.press('Control+a')
    await page.keyboard.type('system.', { delay: 40 })
    await expect(autocomplete).toBeVisible({ timeout: 5_000 })
    const memberLabels = (
      await autocomplete.locator('.cm-completionLabel').allTextContents()
    ).map((l) => l.trim())
    expect(
      memberLabels.some((l) => l.includes('sys_flag')),
      `typing the root must reach its members: ${JSON.stringify(memberLabels)}`,
    ).toBeTruthy()
  })
})
