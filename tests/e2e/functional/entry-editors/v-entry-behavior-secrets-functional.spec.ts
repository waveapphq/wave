/**
 * V-ENTRY-BEHAVIOR-SECRETS-FUNCTIONAL: a typed secret warns until the save, and Delete & Edit hands focus on.
 * Design Decisions: FIELD-1, FIELD-7, SECFLD-1, SECFLD-4
 * REQ: REQ-3.1.3.5, REQ-3.1.3.18, REQ-3.1.1.5
 *
 * Pass Criteria:
 * 1. Typing into SSH Session Open Password shows the amber line `Secret value stays visible until you save the
 *    test.` under the field, and the text box is described by it (aria-describedby).
 * 2. {x} mode shows no line; back to a plain value, a typed password shows it again.
 * 3. After the Block and Test saves the stored password is sealed (never the typed text), the reopened field is
 *    masked and the line is gone.
 * 4. After `Delete & Edit` on the masked password the keyboard focus is in the field's new text box.
 * 5. After `Delete & Edit` on a stored map credential (K8s Apply Secret Data) the keyboard focus is in the
 *    field's new box.
 * 6. A secret Function input typed in a library Function view says `Secret value stays visible until you save the
 *    Function.`, linked to its box the same way.
 *
 * Phase: functional-workflow (imports its own fixture and seeds its own library Function, deletes both after).
 */

import { randomUUID } from 'node:crypto'

import { test, expect } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { deleteTest, readFixture } from '../../helpers/element-types'
import { localFunctionNode, logNode, openFunctionView, publishLibraryFunction, startEdge } from '../../helpers/fn-seed'
import { openBlockSheet } from '../../helpers/workbench'
import { exprToggle, paramRow } from '../../helpers/config-sheet'
import { SECRET_ENVELOPE, SECRET_MASK } from '../../helpers/secret-canary'
import {
  answerSwitch,
  deleteAndEdit,
  deleteLibraryFunction,
  enterFunctionEditMode,
  expectDescribedBy,
  expectSwitchQuestion,
  expectWarningColor,
  focusedTextBoxInside,
  maskedControl,
  rowNote,
  rowTextBox,
  saveBlockAndTest,
  SECRET_LINE_FUNCTION,
  SECRET_LINE_TEST,
  storedNode,
  writeCode,
} from '../../helpers/entry-behavior'
import { BACKEND_URL } from '../../helpers/config'

const SSH = '34ba9f9b-325a-46e4-8982-68baff0eaf9e'
const K8S = '5da5aba5-e4fd-4d6a-9302-bd9ac5888bd2'
const SECRET_FN = 'd80cf1d9-bdc1-4f8a-830f-e95dce8dabcd'
const SECRET_FN_BODY = '87348baa-c5d1-47fe-8e2f-f778dd8f45c9'
const TYPED = 'zz-11541-s6b-typed-pw'
// A text field with no default: Clear, and Clear & Empty both ways (FIELD-7).
const TEXT_SWITCH = ['Cancel', 'Clear', 'Clear & Empty'] as const

test.describe('V-ENTRY-BEHAVIOR-SECRETS-FUNCTIONAL: the unsaved-secret line and Delete & Edit', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await deleteTest(request, testId)
    testId = ''
  })

  test('a typed password warns until the Test save, then shows masked; Delete & Edit focuses its box', async ({
    page,
  }) => {
    testId = await importValidateAndNavigate(page, readFixture(__dirname, 'fixture-behavior-secrets.json'), {
      injectSsh: true,
    })
    const win = await openBlockSheet(page, SSH)
    const box = rowTextBox(win, 'password')
    const note = rowNote(win, 'password')

    await test.step('typing shows the amber line under the field, linked to the box', async () => {
      await expect(win.getByText(SECRET_LINE_TEST), 'no line before a value is typed').toHaveCount(0)
      await box.click()
      await page.keyboard.type(TYPED)
      await expect(box).toHaveValue(TYPED)
      await expect(note).toHaveText(SECRET_LINE_TEST)
      await expectWarningColor(note)
      await expectDescribedBy(box, note)
    })

    await test.step('{x} mode shows no line; a password typed again brings it back', async () => {
      await exprToggle(win, 'password').click()
      await answerSwitch(await expectSwitchQuestion(page, 'in', TEXT_SWITCH), 'Clear')
      await writeCode(page, paramRow(win, 'password'), "'x' + 'y'")
      await expect(win.getByText(SECRET_LINE_TEST), '{x} mode shows no line').toHaveCount(0)

      await exprToggle(win, 'password').click()
      await answerSwitch(await expectSwitchQuestion(page, 'out', TEXT_SWITCH), 'Clear')
      await expect(box).toHaveValue('')
      await expect(win.getByText(SECRET_LINE_TEST), 'an empty field shows no line').toHaveCount(0)
      await box.click()
      await page.keyboard.type(TYPED)
      await expect(note).toHaveText(SECRET_LINE_TEST)
    })

    await test.step('the saves seal the password; the reopened field is masked with no line', async () => {
      await saveBlockAndTest(page, win)
      const stored = (await storedNode(page.request, testId, SSH)).data.config.values.password as string
      expect(stored, 'the typed text is never stored').not.toBe(TYPED)
      expect(stored === SECRET_MASK || stored.startsWith(SECRET_ENVELOPE), `stored as ${stored}`).toBe(true)

      const reopened = await openBlockSheet(page, SSH)
      await expect(maskedControl(reopened, 'password')).toBeVisible()
      await expect(reopened.getByText(SECRET_LINE_TEST), 'the line is gone once saved').toHaveCount(0)
    })

    await test.step("Delete & Edit puts the focus in the field's new box", async () => {
      const reopened = page.locator('[data-testid="element-config-sheet"]')
      await deleteAndEdit(page, maskedControl(reopened, 'password'))
      await expect(rowTextBox(reopened, 'password'), 'the new box has the focus').toBeFocused()
      await expect(rowTextBox(reopened, 'password')).toHaveValue('')
    })
  })

  test("Delete & Edit on a stored map credential puts the focus in the field's new box", async ({ page }) => {
    testId = await importValidateAndNavigate(page, readFixture(__dirname, 'fixture-behavior-secrets.json'), {
      injectSsh: true,
    })
    const win = await openBlockSheet(page, K8S)
    const row = paramRow(win, 'secret_data')
    await expect(maskedControl(win, 'secret_data'), 'the stored map is masked').toBeVisible()
    await deleteAndEdit(page, maskedControl(win, 'secret_data'))
    await expect(maskedControl(win, 'secret_data')).toHaveCount(0)
    await expect
      .poll(() => focusedTextBoxInside(row), { message: 'the focus is in the box that replaced the masked map' })
      .toBe(true)
  })

  test('a secret Function input typed in a library Function view names the Function save', async ({
    page,
    request,
  }) => {
    const base = localFunctionNode(SECRET_FN, 'Secret_Fn', {
      inputs: [{ name: 'token', type: 'string', required: false, secret: true }],
      nodes: [logNode(SECRET_FN_BODY, 'Log', "'secret body'")],
      edges: [startEdge(SECRET_FN_BODY)],
    })
    const node = {
      ...base,
      data: { ...(base.data as Record<string, unknown>), config: { values: {}, outputBindings: {}, profileBindings: [] } },
    }
    const fn = await publishLibraryFunction(request, {
      name: `zz-11541-s6b-secret-fn-${randomUUID().slice(0, 8)}`,
      workflow: { nodes: [node], edges: [startEdge(SECRET_FN)] },
    })
    try {
      await openFunctionView(page, fn.functionId, fn.version)
      await enterFunctionEditMode(page)
      const win = await openBlockSheet(page, SECRET_FN)
      const box = rowTextBox(win, 'token')
      const note = rowNote(win, 'token')
      await box.click()
      await page.keyboard.type(TYPED)
      await expect(note).toHaveText(SECRET_LINE_FUNCTION)
      await expectDescribedBy(box, note)
      await expect(win.getByText(SECRET_LINE_TEST)).toHaveCount(0)
    } finally {
      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
      await deleteLibraryFunction(request, fn.functionId)
    }
  })
})
