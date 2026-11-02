/**
 * V-CANVAS-FN-ADD-WINDOWS: every Add opens its own creation window, and each window keeps its Function
 * Wireframe: none (windows cascade like the watchers)
 * Design Decisions: VMGR-101, VMGR-102
 * REQ: REQ-3.1.3.11, REQ-3.1.2.1
 *
 * Seed (API): a `zz-` Test holding two empty Local Functions, A (`Fn_A`) and B (`Fn_B`), through
 * `createValidTest`. Every window is opened and filled through the Variable Manager "+ Add" menu.
 *
 * Pass Criteria:
 * 1. A second (and third) Add opens another window; every earlier window keeps its draft name and value.
 * 2. Two open windows create two parameters independently: Create closes only its own window, Cancel
 *    discards only its own draft, and the saved Test holds exactly what was created.
 * 3. Windows cascade 24 px down and right of the one before; dragging one moves only that window and
 *    brings it to the front.
 * 4. A window opened in Function A still creates into A after the author goes to the Test or into
 *    Function B: the saved Test holds the new input, local and output in A and nothing in B or the Test.
 * 5. A window puts focus on Name as it opens, from the Test's Add and from each Add menu entry: keys typed
 *    at once land in Name; once the author moves into the value field, focus stays there.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { getTest } from '../../helpers/element-types'
import {
  createValidTest,
  localFunctionNode,
  openTest,
  startEdge,
  storedLocalDefinition,
} from '../../helpers/fn-seed'
import {
  CREATE_MODAL,
  cancelCreate,
  fillCreateWindow,
  openFunctionCreateModal,
  submitCreate,
  valueEditor,
  variableRow,
} from '../../helpers/variable-create'
import { breadcrumbFunctionSegments, digIn, popToBreadcrumbSegment, saveTest } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

const FN_A = 'fn-windows-a'
const FN_B = 'fn-windows-b'
const CASCADE_STEP = 24

let testId = ''

async function seed(page: Page, request: APIRequestContext): Promise<string> {
  const testName = `zz-fn-add-windows-${randomUUID().slice(0, 8)}`
  testId = await createValidTest(request, {
    name: testName,
    nodes: [
      localFunctionNode(FN_A, 'Fn_A', { nodes: [] }, { x: 260, y: 160 }),
      localFunctionNode(FN_B, 'Fn_B', { nodes: [] }, { x: 260, y: 360 }),
    ],
    edges: [startEdge(FN_A), { id: 'e-a-b', source: FN_A, target: FN_B }],
  })
  await openTest(page, testId)
  return testName
}

async function enterFunction(page: Page, nodeId: string, label: string): Promise<void> {
  // The open windows sit over the canvas, so the click goes straight to the dig-in glyph.
  await page.locator(`[data-testid="workflow-node-${nodeId}"] [data-testid="node-dig-in"]`).dispatchEvent('click')
  await expect(page.locator('[data-testid="canvas-breadcrumb"]')).toContainText(label)
  await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
  await expect(page.getByTestId('add-variable-dropdown-trigger')).toBeVisible()
}

async function backToTest(page: Page, testName: string): Promise<void> {
  await popToBreadcrumbSegment(page, testName)
  await expect(breadcrumbFunctionSegments(page)).toHaveCount(0)
}

const windows = (page: Page): Locator => page.locator(CREATE_MODAL)

const nameOf = (modal: Locator): Locator => modal.locator('[data-testid="create-variable-name"]')

async function centerOf(modal: Locator): Promise<{ x: number; y: number }> {
  const box = (await modal.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

function expectNear(actual: { x: number; y: number }, expected: { x: number; y: number }, what: string): void {
  expect(Math.abs(actual.x - expected.x), `${what} (x)`).toBeLessThanOrEqual(1.5)
  expect(Math.abs(actual.y - expected.y), `${what} (y)`).toBeLessThanOrEqual(1.5)
}

/** Name and type (and the default or value) of each stored declaration. */
function shapes(entries: Array<Record<string, unknown>>, key: 'default' | 'value'): Array<Record<string, unknown>> {
  return entries.map((entry) => ({ name: entry.name, type: entry.type, [key]: entry[key] }))
}

/** Open a window from the Test's "+ Add" or from the in-Function menu, with no wait after the click. */
async function openAtOnce(page: Page, entry: 'Test' | 'Input parameter' | 'Output parameter' | 'Variable'): Promise<void> {
  if (entry === 'Test') {
    await page.locator('[data-testid="add-variable-button"]').click()
    return
  }
  await page.locator('[data-testid="add-variable-dropdown-trigger"]').click()
  await page.getByRole('menuitem', { name: entry, exact: true }).click()
}

test.describe('V-CANVAS-FN-ADD-WINDOWS: one window per Add, each keeping its Function', () => {
  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  test('a second Add opens another window and the first keeps its draft', async ({ page, request }) => {
    await seed(page, request)
    await digIn(page, FN_A)

    const first = await openFunctionCreateModal(page, 'input')
    await fillCreateWindow(page, first, 'first_in', { value: 'keep-me' })

    // Per VMGR-101: Add appends a window; it never replaces the one already open.
    const second = await openFunctionCreateModal(page, 'output')
    await expect(windows(page)).toHaveCount(2)
    await expect(second).toContainText('New output parameter')
    await expect(first).toContainText('New input parameter')
    await expect(nameOf(first)).toHaveValue('first_in')
    await expect(valueEditor(page, first)).toHaveValue('keep-me')

    await fillCreateWindow(page, second, 'second_out', { type: 'integer', value: '5' })
    const third = await openFunctionCreateModal(page, 'variable')
    await expect(windows(page)).toHaveCount(3)
    await expect(third).toContainText('New variable')
    await expect(nameOf(first)).toHaveValue('first_in')
    await expect(valueEditor(page, first)).toHaveValue('keep-me')
    await expect(nameOf(second)).toHaveValue('second_out')
    await expect(second.locator('[data-testid="scalar-edit-input"]')).toHaveValue('5')
    await expect(nameOf(third)).toHaveValue('')
  })

  test('two open windows create two parameters independently, and Create or Cancel closes only its own window', async ({
    page,
    request,
  }) => {
    const testName = await seed(page, request)
    await digIn(page, FN_A)

    await test.step('Create in the second window leaves the first open with its draft', async () => {
      const first = await openFunctionCreateModal(page, 'input')
      await fillCreateWindow(page, first, 'in_one', { value: 'alpha' })
      const second = await openFunctionCreateModal(page, 'output')
      await fillCreateWindow(page, second, 'out_one', { type: 'integer', value: '7' })

      await submitCreate(page, second)
      await expect(windows(page)).toHaveCount(1)
      await expect(page.locator('[data-testid="out-badge-param:output:out_one"]')).toBeVisible()
      await expect(variableRow(page, 'in_one')).toHaveCount(0)
      await expect(nameOf(first)).toHaveValue('in_one')
      await expect(valueEditor(page, first)).toHaveValue('alpha')

      await submitCreate(page, first)
      await expect(windows(page)).toHaveCount(0)
      await expect(page.locator('[data-testid="in-badge-param:input:in_one"]')).toBeVisible()
    })

    await test.step('Cancel in one window discards only its draft', async () => {
      const kept = await openFunctionCreateModal(page, 'input')
      await fillCreateWindow(page, kept, 'kept_in', { value: 'k' })
      const dropped = await openFunctionCreateModal(page, 'variable')
      await fillCreateWindow(page, dropped, 'dropped_local', { value: 'x' })

      await cancelCreate(page, dropped)
      await expect(windows(page)).toHaveCount(1)
      await expect(nameOf(kept)).toHaveValue('kept_in')
      await expect(valueEditor(page, kept)).toHaveValue('k')
      await submitCreate(page, kept)
      await expect(windows(page)).toHaveCount(0)
      await expect(variableRow(page, 'kept_in')).toBeVisible()
      await expect(variableRow(page, 'dropped_local')).toHaveCount(0)
    })

    await test.step('the saved Function holds exactly what the windows created', async () => {
      await backToTest(page, testName)
      await saveTest(page)
      const stored = await storedLocalDefinition(request, testId, FN_A)
      expect(shapes(stored.inputs, 'default')).toEqual([
        { name: 'in_one', type: 'string', default: 'alpha' },
        { name: 'kept_in', type: 'string', default: 'k' },
      ])
      // A number typed in the number box is stored as its exact text under the declared type.
      expect(shapes(stored.outputs, 'default')).toEqual([{ name: 'out_one', type: 'integer', default: '7' }])
      expect(stored.variables).toEqual([])
    })
  })

  test('windows cascade 24 px apart and each keeps its own position', async ({ page, request }) => {
    await seed(page, request)
    await digIn(page, FN_A)

    const opened: Locator[] = []
    for (let index = 0; index < 3; index++) opened.push(await openFunctionCreateModal(page, 'input'))
    await expect(windows(page)).toHaveCount(3)

    // Per VMGR-101: each window opens one cascade step down and right of the one before.
    const centers = [] as Array<{ x: number; y: number }>
    for (const modal of opened) centers.push(await centerOf(modal))
    for (const index of [1, 2]) {
      expectNear(
        centers[index],
        { x: centers[index - 1].x + CASCADE_STEP, y: centers[index - 1].y + CASCADE_STEP },
        `window ${index} cascades from window ${index - 1}`,
      )
    }

    // The middle window's header shows above the front one; dragging it moves it alone.
    const handle = opened[1].locator('[data-testid="variable-create-modal-drag-handle"]')
    const grip = (await handle.boundingBox())!
    await page.mouse.move(grip.x + 60, grip.y + 8)
    await page.mouse.down()
    await page.mouse.move(grip.x + 60 + 150, grip.y + 8 - 30, { steps: 8 })
    await page.mouse.up()

    expectNear(await centerOf(opened[1]), { x: centers[1].x + 150, y: centers[1].y - 30 }, 'the dragged window moved')
    expectNear(await centerOf(opened[0]), centers[0], 'the first window stayed')
    expectNear(await centerOf(opened[2]), centers[2], 'the last window stayed')
    await expect(opened[1]).toHaveAttribute('data-active', 'true')
    const zIndex = (modal: Locator) => modal.evaluate((el) => Number((el as HTMLElement).style.zIndex))
    expect(await zIndex(opened[1]), 'the dragged window came to the front').toBeGreaterThan(await zIndex(opened[2]))
  })

  test('a window opened in Function A still creates into A after the author goes to the Test or to Function B', async ({
    page,
    request,
  }) => {
    const testName = await seed(page, request)

    await test.step('an input window opened in A creates into A from the Test', async () => {
      await digIn(page, FN_A)
      const input = await openFunctionCreateModal(page, 'input')
      await fillCreateWindow(page, input, 'from_a_in', { value: 'a1' })
      await backToTest(page, testName)
      await expect(windows(page)).toHaveCount(1)
      await expect(input).toContainText('New input parameter')
      await submitCreate(page, input)
      await expect(windows(page)).toHaveCount(0)
      await expect(variableRow(page, 'from_a_in')).toHaveCount(0)
    })

    await test.step('a local and an output window opened in A create into A from Function B', async () => {
      await digIn(page, FN_A)
      await expect(page.locator('[data-testid="in-badge-param:input:from_a_in"]')).toBeVisible()
      const local = await openFunctionCreateModal(page, 'variable')
      await fillCreateWindow(page, local, 'from_a_local', { value: 'a2' })
      const output = await openFunctionCreateModal(page, 'output')
      await fillCreateWindow(page, output, 'from_a_out', { value: 'a3' })

      await backToTest(page, testName)
      await enterFunction(page, FN_B, 'Fn_B')
      await expect(windows(page)).toHaveCount(2)
      await submitCreate(page, output)
      await submitCreate(page, local)
      await expect(windows(page)).toHaveCount(0)
      await expect(variableRow(page, 'from_a_local')).toHaveCount(0)
      await expect(variableRow(page, 'from_a_out')).toHaveCount(0)
    })

    await test.step('A shows the three new rows', async () => {
      await backToTest(page, testName)
      await digIn(page, FN_A)
      await expect(page.locator('[data-testid="in-badge-param:input:from_a_in"]')).toBeVisible()
      await expect(page.locator('[data-testid="out-badge-param:output:from_a_out"]')).toBeVisible()
      await expect(page.locator('[data-testid="var-group-variables"]').getByText('from_a_local', { exact: true })).toBeVisible()
    })

    await test.step('the saved Test holds them in A only', async () => {
      await backToTest(page, testName)
      await saveTest(page)
      const a = await storedLocalDefinition(request, testId, FN_A)
      expect(shapes(a.inputs, 'default')).toEqual([{ name: 'from_a_in', type: 'string', default: 'a1' }])
      expect(shapes(a.outputs, 'default')).toEqual([{ name: 'from_a_out', type: 'string', default: 'a3' }])
      expect(shapes(a.variables, 'value')).toEqual([{ name: 'from_a_local', type: 'string', value: 'a2' }])
      const b = await storedLocalDefinition(request, testId, FN_B)
      expect(b, 'Function B gained nothing').toEqual({ inputs: [], outputs: [], variables: [] })
      const testVariables = ((await getTest(request, testId)).variables ?? {}) as Record<string, unknown>
      for (const name of ['from_a_in', 'from_a_local', 'from_a_out']) {
        expect(testVariables[name], `${name} is not a Test variable`).toBeUndefined()
      }
    })
  })

  test('a window puts focus on Name as it opens, and the focus stays where the author moves it', async ({
    page,
    request,
  }) => {
    const testName = await seed(page, request)
    const entries = ['Test', 'Input parameter', 'Output parameter', 'Variable'] as const

    for (const entry of entries) {
      await test.step(`${entry}: keys typed at once land in Name`, async () => {
        if (entry === 'Input parameter') await digIn(page, FN_A)
        await openAtOnce(page, entry)
        await page.keyboard.type('typed_at_once')
        const modal = windows(page).first()
        await expect(page.getByRole('menu')).toHaveCount(0)
        await expect(nameOf(modal)).toBeFocused()
        await expect(nameOf(modal)).toHaveValue('typed_at_once')
        await cancelCreate(page, modal)
      })

      await test.step(`${entry}: focus moved into the value field stays there`, async () => {
        await openAtOnce(page, entry)
        const modal = windows(page).first()
        await valueEditor(page, modal).click()
        await page.keyboard.type('ab')
        await expect(page.getByRole('menu')).toHaveCount(0)
        await page.keyboard.type('cd')
        await expect(valueEditor(page, modal)).toHaveValue('abcd')
        await expect(nameOf(modal)).toHaveValue('')
        await cancelCreate(page, modal)
      })
    }
    await backToTest(page, testName)
  })
})
