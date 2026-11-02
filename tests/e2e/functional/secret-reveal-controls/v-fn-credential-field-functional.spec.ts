/**
 * V-FN-CREDENTIAL-FIELD-FUNCTIONAL: a credential field on a Block inside a Local Function
 * Design Decisions: SECFLD-1, SECFLD-2, SECREV-6
 * REQ: REQ-3.1.3.17, REQ-3.1.3.18, REQ-4.5.1
 *
 * Phase: functional-workflow. Setup seeds a Test through POST /tests (zero validation errors):
 * an SSH Session Open at the root and one inside a Local Function, each holding a stored
 * password. The reveal settings are set through PUT /admin/secret-masking and reset after each test.
 *
 * Pass Criteria:
 * 1. A password typed into the Block inside the Local Function, after the Test save, shows
 *    masked and write-only at once (no reload), as the root Block's does; the saved Test holds
 *    a sealed envelope for each and never the typed text.
 * 2. With "Unmask plugin credential input fields" off, the Block inside the Local Function shows
 *    its password masked; with it on, it shows the stored value, as the root Block does.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { ALL_MASKED, setMasking } from './masking-flags'
import { BACKEND_URL } from '../../helpers/config'
import { importFixtureTest } from '../../helpers/fixture-import'
import { localFunctionNode, openTest, startEdge } from '../../helpers/fn-seed'
import { SECRET_ENVELOPE } from '../../helpers/secret-canary'
import {
  clearPointerLock,
  configSheet,
  digIn,
  openBlockSheet,
  popToBreadcrumbSegment,
  saveBlockSheet,
  saveTest,
} from '../../helpers/workbench'

const FN = 'fn-1'
const ROOT_OPEN = 'ssh-root'
const INNER_OPEN = 'ssh-inner'
const TEST_PREFIX = 'v-fn-cred-field-'

/** An SSH Session Open whose password is a credential literal. */
function sshOpenNode(id: string, label: string, password: string, y: number): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x: 200, y },
    data: {
      label,
      elementType: 'ssh-session-open',
      nodeType: 'plugin',
      category: 'network',
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: {
        values: {
          host: 'example.host',
          port: 22,
          username: 'admin',
          password,
          host_key_verification: 'strict',
        },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { width: 120, height: 62 },
  }
}

/** A Test with a stored password on a root SSH Session Open and on one inside a Local Function. */
async function seedTest(page: Page, rootPassword: string, innerPassword: string): Promise<string> {
  return importFixtureTest(page, {
    name: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
    version: '1.0.0',
    description: 'Credential fields at the root and inside a Local Function',
    workflow: {
      nodes: [
        sshOpenNode(ROOT_OPEN, 'Root Open', rootPassword, 100),
        localFunctionNode(
          FN,
          'Function_1',
          {
            nodes: [sshOpenNode(INNER_OPEN, 'Inner Open', innerPassword, 100)],
            edges: [startEdge(INNER_OPEN)],
          },
          { x: 200, y: 260 },
        ),
      ],
      edges: [startEdge(ROOT_OPEN), { id: 'e-root-fn', source: ROOT_OPEN, target: FN }],
    },
    variables: {},
    metadata: { tags: [], suite_id: null, parent_suite: null },
  })
}

/** The stored password of every SSH Session Open in the saved Test, Local Function bodies included. */
async function storedPasswords(request: APIRequestContext, testId: string): Promise<Record<string, unknown>> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}/workflow`)
  expect(resp.ok(), `GET /tests/${testId}/workflow: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  const found: Record<string, unknown> = {}
  const walk = (nodes: Array<Record<string, any>>) => {
    for (const node of nodes) {
      const values = node.data?.config?.values
      if (node.data?.elementType === 'ssh-session-open') found[node.id] = values?.password
      walk(node.data?.localDefinition?.workflow?.nodes ?? [])
    }
  }
  walk(body.data?.nodes ?? body.nodes ?? [])
  return found
}

const passwordRow = (page: Page): Locator => configSheet(page).locator('[data-testid="param-row-password"]')
const maskedControl = (row: Locator): Locator => row.locator('button[aria-label$="Edit protected value"]')
/** The row's one value field text box; a masked secret has none. */
const passwordBox = (row: Locator): Locator => row.locator('[data-slot="input-group"] input')

/** Clear the stored password through the write-only flow, type a new one, and Save the Block. */
async function retypePassword(page: Page, blockId: string, typed: string): Promise<void> {
  await openBlockSheet(page, blockId)
  await maskedControl(passwordRow(page)).click()
  const confirm = page.getByRole('dialog').filter({ hasText: 'Edit Protected Value?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Delete & Edit', exact: true }).click()
  // Delete & Edit leaves the row an empty text box with the keyboard in it.
  const box = passwordBox(passwordRow(page))
  await expect(box).toBeFocused()
  await page.keyboard.insertText(typed)
  await expect(box, 'a value typed this session stays visible until the Test is saved').toHaveValue(typed)
  await saveBlockSheet(configSheet(page))
}

/** Open the Block's sheet and prove its password is masked write-only and `typed` is nowhere on the page. */
async function expectMaskedWriteOnly(page: Page, blockId: string, typed: string): Promise<void> {
  await openBlockSheet(page, blockId)
  await expect(maskedControl(passwordRow(page)), `${blockId} masks its password write-only`).toBeVisible()
  await expect(passwordBox(passwordRow(page))).toHaveCount(0)
  expect(await page.content(), `${blockId}: the typed password is gone from the page`).not.toContain(typed)
  await closeSheet(page)
}

/** Open the Block's sheet and prove its password shows `value` in the clear. */
async function expectRevealed(page: Page, blockId: string, value: string): Promise<void> {
  await openBlockSheet(page, blockId)
  await expect(passwordBox(passwordRow(page)), `${blockId} shows its stored password`).toHaveValue(value)
  await expect(maskedControl(passwordRow(page))).toHaveCount(0)
  await closeSheet(page)
}

async function expectMasked(page: Page, blockId: string): Promise<void> {
  await openBlockSheet(page, blockId)
  await expect(maskedControl(passwordRow(page)), `${blockId} masks its password`).toBeVisible()
  await expect(passwordBox(passwordRow(page))).toHaveCount(0)
  await closeSheet(page)
}

async function closeSheet(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(configSheet(page)).toHaveCount(0)
  await clearPointerLock(page)
}

test.describe('V-FN-CREDENTIAL-FIELD-FUNCTIONAL: credential fields inside a Local Function', () => {
  const testIds: string[] = []

  test.beforeEach(async ({ request }) => {
    await setMasking(request, ALL_MASKED)
  })

  test.afterEach(async ({ request }) => {
    await setMasking(request, ALL_MASKED)
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const id of testIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${id}`).catch(() => undefined)
    }
  })

  // Per SECFLD-1: a typed credential is write-only after save.
  test('a password typed inside a Local Function is masked write-only right after the Test save, as at the root', async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000)
    const tag = randomUUID().slice(0, 8)
    const rootTyped = `root-typed-${tag}`
    const innerTyped = `inner-typed-${tag}`
    const testId = await seedTest(page, `root-stored-${tag}`, `inner-stored-${tag}`)
    testIds.push(testId)
    await openTest(page, testId)

    await test.step('type a new password on the root Block and on the Block inside the Function', async () => {
      await retypePassword(page, ROOT_OPEN, rootTyped)
      await digIn(page, FN)
      await expect(page.locator(`[data-testid="workflow-node-${INNER_OPEN}"]`)).toBeVisible()
      await retypePassword(page, INNER_OPEN, innerTyped)
    })

    await test.step('Save the Test: the saved Test holds a sealed envelope for both, never the typed text', async () => {
      await saveTest(page)
      await expect
        .poll(async () => {
          const stored = await storedPasswords(request, testId)
          return [ROOT_OPEN, INNER_OPEN].map((id) => String(stored[id]).startsWith(SECRET_ENVELOPE))
        })
        .toEqual([true, true])
      const stored = JSON.stringify(await storedPasswords(request, testId))
      expect(stored, 'the saved Test').not.toContain(rootTyped)
      expect(stored, 'the saved Test').not.toContain(innerTyped)
    })

    await test.step('without a reload, both Blocks mask their password write-only', async () => {
      await expectMaskedWriteOnly(page, INNER_OPEN, innerTyped)
      await popToBreadcrumbSegment(page, new RegExp(`^${TEST_PREFIX}`))
      await expect(page.locator(`[data-testid="workflow-node-${ROOT_OPEN}"]`)).toBeVisible()
      await expectMaskedWriteOnly(page, ROOT_OPEN, rootTyped)
    })
  })

  // Per SECREV-6: "Unmask plugin credential input fields" reveals every Block's stored credential.
  test('the credential reveal setting reaches a Block inside a Local Function', async ({ page, request }) => {
    test.setTimeout(150_000)
    const tag = randomUUID().slice(0, 8)
    const rootStored = `root-stored-${tag}`
    const innerStored = `inner-stored-${tag}`
    const testId = await seedTest(page, rootStored, innerStored)
    testIds.push(testId)

    await test.step('setting off: both passwords are masked', async () => {
      await openTest(page, testId)
      await expectMasked(page, ROOT_OPEN)
      await digIn(page, FN)
      await expectMasked(page, INNER_OPEN)
    })

    await test.step('setting on: both Blocks show their stored password', async () => {
      await setMasking(request, { credential_inputs: true })
      await openTest(page, testId)
      await expectRevealed(page, ROOT_OPEN, rootStored)
      await digIn(page, FN)
      await expect(page.locator(`[data-testid="workflow-node-${INNER_OPEN}"]`)).toBeVisible()
      await expectRevealed(page, INNER_OPEN, innerStored)
    })
  })
})
