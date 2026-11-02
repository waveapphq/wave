/**
 * V-FIELD-VARIABLE-REQUIRED: the New variable window shows its required Name error from the moment it opens
 * Design Decisions: FIELD-12, VMGR-106, VMGR-110
 * REQ: REQ-3.1.3.11
 *
 * Phase: no-data. Seed (API, POST /tests): one `zz-11541-s1-` Test holding the String variable `greeting` read
 * by one Log Block; each test seeds its own Test, checks it validates with zero errors and deletes it afterwards.
 * One test per theme: the dark project's theme, then the light theme through the shell toggle.
 *
 * Pass Criteria (in both themes, checked as the window opens, before any key or click in it):
 * 1. The label `Name` is followed by the red star, which screen readers hear as "required".
 * 2. The empty Name field shows the placeholder `variable_name`, is outlined in red and marked invalid, and
 *    `Name is required` shows in red right under it.
 * 3. Create is disabled.
 * 4. The rest of the window is unchanged: title `New variable`; Type `String` with `Text value`; Kind `Literal`;
 *    `Mark as secret (value will be masked)` and `Set to null` unticked; the Value field with its Open editor
 *    expand (two diagonal arrows) right of it; Cancel then Create.
 * 5. Typing a name takes the error, the red outline and the invalid mark away and enables Create; emptying the
 *    name brings them back and disables Create again.
 * 6. A screenshot of the window in each theme is attached.
 */

import { test, expect, type APIRequestContext, type Locator, type Page, type TestInfo } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { elementColor, resolvedColor } from '../../helpers/config-sheet'
import { createValidTest, logNode, openTest, startEdge, validateTest } from '../../helpers/fn-seed'
import { toggleTheme } from '../../helpers/theme'
import {
  cancelCreate,
  openCreateModal,
  setCreateName,
  valueField,
  windowCancelButton,
  windowCheckbox,
  windowSaveButton,
} from '../../helpers/variable-create'
import { randomUUID } from 'node:crypto'

type Theme = 'dark' | 'light'

const control = (modal: Locator, id: string): Locator => modal.locator(`[data-testid="${id}"]`)

async function seed(request: APIRequestContext): Promise<string> {
  const testId = await createValidTest(request, {
    name: `zz-11541-s1-variable-required-${randomUUID().slice(0, 8)}`,
    nodes: [logNode('log-greeting', 'Log greeting', 'greeting')],
    edges: [startEdge('log-greeting')],
    variables: { greeting: { value: 'hello', type: 'string', scope: 'test' } },
  })
  const validation = await validateTest(request, testId)
  expect(validation.errors, 'the seeded Test validates with zero errors').toEqual([])
  return testId
}

/** The label that names the Name field. */
async function nameLabel(modal: Locator): Promise<Locator> {
  const id = await control(modal, 'create-variable-name').getAttribute('id')
  expect(id, 'the Name field has an id').toBeTruthy()
  return modal.locator(`label[for="${id}"]`)
}

/** Criterion 1: `Name` and its red star right after it (FIELD-12). */
async function expectStar(page: Page, modal: Locator): Promise<void> {
  const label = await nameLabel(modal)
  await expect(label).toHaveText('Name* required')
  await expect(control(modal, 'create-variable-name'), 'the field is named Name, required').toHaveAccessibleName(
    /^Name\s+required$/,
  )
  await expect(label.locator('.sr-only')).toHaveText(' required')
  const star = label.locator('span[aria-hidden="true"]')
  await expect(star).toHaveText('*')
  expect(await elementColor(star, 'color'), 'the star is red').toBe(await resolvedColor(page, 'var(--destructive)'))
  const textEnd = await label.evaluate((el) => {
    const range = document.createRange()
    range.setStart(el.firstChild as Node, 0)
    range.setEnd(el.firstChild as Node, (el.firstChild as Text).length)
    const rect = range.getBoundingClientRect()
    return { right: rect.right, middle: rect.y + rect.height / 2 }
  })
  const starBox = (await star.boundingBox())!
  expect(starBox.x - textEnd.right, 'the star sits right after Name').toBeGreaterThanOrEqual(0)
  expect(starBox.x - textEnd.right, 'the star sits right after Name').toBeLessThanOrEqual(4)
  expect(Math.abs(starBox.y + starBox.height / 2 - textEnd.middle), 'the star shares the label line').toBeLessThanOrEqual(4)
}

/** Criteria 2 and 3: the empty Name outlined in red, its error under it, Create disabled. */
async function expectNameError(page: Page, modal: Locator): Promise<void> {
  const name = control(modal, 'create-variable-name')
  const error = control(modal, 'create-name-error')
  const red = await resolvedColor(page, 'var(--destructive)')
  await expect(name).toHaveValue('')
  await expect(name).toHaveAttribute('placeholder', 'variable_name')
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect(error).toHaveText(/^Name is required$/)
  await expect(error).toHaveAttribute('role', 'alert')
  await expect(name).toHaveAttribute('aria-describedby', (await error.getAttribute('id')) ?? '')
  expect(await elementColor(error, 'color'), 'the error text is red').toBe(red)
  expect(await elementColor(name, 'borderTopColor'), 'the field is outlined in red').toBe(red)
  const fieldBox = (await name.boundingBox())!
  const errorBox = (await error.boundingBox())!
  expect(errorBox.y, 'the error sits under the field').toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height)
  expect(errorBox.y - (fieldBox.y + fieldBox.height), 'the error sits right under the field').toBeLessThanOrEqual(12)
  expect(Math.abs(errorBox.x - fieldBox.x), 'the error lines up with the field').toBeLessThanOrEqual(2)
  await expect(windowSaveButton(modal), 'Create waits for a name').toBeDisabled()
}

/** Criterion 4: the rest of the window is unchanged. */
async function expectRestOfWindow(modal: Locator): Promise<void> {
  await expect(modal.getByText('New variable', { exact: true })).toBeVisible()
  const type = control(modal, 'create-type-select')
  await expect(type).toContainText('String')
  await expect(type).toContainText('Text value')
  await expect(control(modal, 'create-kind-select')).toHaveText('Literal')
  for (const [box, text] of [
    ['secret', 'Mark as secret (value will be masked)'],
    ['set-to-null', 'Set to null'],
  ] as const) {
    const checkbox = windowCheckbox(modal, box)
    await expect(checkbox).toHaveAttribute('data-state', 'unchecked')
    await expect(checkbox.locator('xpath=following-sibling::label')).toHaveText(text)
  }
  const field = valueField(modal)
  await expect(field).toBeVisible()
  const expand = control(modal, 'open-value-editor-button')
  await expect(expand).toHaveAccessibleName('Open editor')
  await expect(expand.locator('svg.lucide-maximize-2'), 'two diagonal arrows').toHaveCount(1)
  const input = field.locator('input').first()
  const inputBox = (await input.boundingBox())!
  const expandBox = (await expand.boundingBox())!
  expect(expandBox.x, 'expand sits right of the Value field').toBeGreaterThanOrEqual(inputBox.x + inputBox.width)
  const cancelBox = (await windowCancelButton(modal).boundingBox())!
  await expect(windowCancelButton(modal)).toHaveText('Cancel')
  await expect(windowSaveButton(modal)).toHaveText('Create')
  expect(cancelBox.x, 'Cancel comes before Create').toBeLessThan((await windowSaveButton(modal).boundingBox())!.x)
}

/** Criterion 5: the error follows the Name field. */
async function expectErrorFollowsName(page: Page, modal: Locator): Promise<void> {
  const name = control(modal, 'create-variable-name')
  const red = await resolvedColor(page, 'var(--destructive)')
  await setCreateName(page, 'release_tag', modal)
  await expect(control(modal, 'create-name-error')).toHaveCount(0)
  await expect(name).not.toHaveAttribute('aria-invalid', 'true')
  await expect
    .poll(() => elementColor(name, 'borderTopColor'), { message: 'a name takes the red outline away' })
    .not.toBe(red)
  await expect(windowSaveButton(modal), 'a name enables Create').toBeEnabled()
  await setCreateName(page, '', modal)
  await expect(control(modal, 'create-name-error')).toHaveText(/^Name is required$/)
  await expect(name).toHaveAttribute('aria-invalid', 'true')
  await expect.poll(() => elementColor(name, 'borderTopColor'), { message: 'the red outline comes back' }).toBe(red)
  await expect(windowSaveButton(modal), 'an emptied name disables Create again').toBeDisabled()
}

async function attach(testInfo: TestInfo, name: string, modal: Locator): Promise<void> {
  await testInfo.attach(name, { body: await modal.screenshot(), contentType: 'image/png' })
}

test.describe('V-FIELD-VARIABLE-REQUIRED: the red star and the Name error on open', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  for (const theme of ['dark', 'light'] as const satisfies readonly Theme[]) {
    test(`a new variable window in the ${theme} theme`, async ({ page, request }, testInfo) => {
      testId = await seed(request)
      await openTest(page, testId)
      if (theme === 'light') expect(await toggleTheme(page)).toBe('light')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

      const modal = await openCreateModal(page)
      await test.step('the error shows on open', async () => {
        await expectStar(page, modal)
        await expectNameError(page, modal)
      })
      await attach(testInfo, `field-variable-required-${theme}.png`, modal)
      await test.step('the rest of the window', () => expectRestOfWindow(modal))
      await test.step('the error follows the Name', () => expectErrorFollowsName(page, modal))
      await cancelCreate(page, modal)
    })
  }
})
