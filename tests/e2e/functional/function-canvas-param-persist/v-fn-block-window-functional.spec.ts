/**
 * V-FN-BLOCK-WINDOW-FUNCTIONAL: the Function Block window's Name gate, its Profiles count and its edit-mode Description
 * Wireframe: none (functional)
 * Design Decisions: CANVAS-207, CANVAS-208, CANVAS-209, CANVAS-214, FN-LC-9, FIELDERR-3
 * REQ: REQ-3.1.2.1, REQ-3.1.2.2, REQ-3.1.1.5
 *
 * Seeds (API, POST /tests, POST /functions and POST /profiles; every name `zz-11541-s7-`, all deleted
 * afterwards, the library Function with `cascade=true`): a Local Function `Gate_Fn`; two `custom` profiles
 * bound to a Local Function Block and a second Local Function Block bound to none; a library Function
 * pinned by a Shared Function Block that the UI puts in edit mode.
 *
 * Pass Criteria:
 * 1. Clearing the Name shows `Name is required` at once under it, marks it invalid and keeps Save off with
 *    `Save is disabled: the settings have errors`; a new Name opens Save, and the saved Block and its Local
 *    Function both carry it.
 * 2. The footer's Profiles shows the bound count `2`, its sheet lists the two bound profiles, and a Function
 *    Block with no binding shows no count.
 * 3. In edit mode a Description typed in the window is this Block's own: it is stored on the Block, the
 *    draft keeps the library description, the window shows it again after a reload, and the publish that
 *    follows starts its Description from the source version and records that on the new version.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { openTest } from '../../helpers/fn-seed'
import {
  cleanUp,
  closeBlockWindow,
  createFunction,
  createTest,
  libraryFunction,
  localFunctionBlock,
  logBlock,
  openBlockWindow,
  pickBlockMenuItem,
  saveBlockWindow,
  sharedFunctionBlock,
  storedBlock,
  windowSave,
  zzName,
  type Rec,
} from '../../helpers/fn-block'
import { editModeOverlay, saveTest } from '../../helpers/workbench'

const GATE_ID = 'fn-gate'
const BOUND_ID = 'fn-bound'
const UNBOUND_ID = 'fn-unbound'
const SHARED_ID = 'fn-described'
const SAVE_NOTE = 'Save is disabled: the settings have errors'
const LIBRARY_DESCRIPTION = 'Library description'
const BLOCK_DESCRIPTION = 'Only this Block'

function printBody(id: string): { nodes: Rec[] } {
  return { nodes: [logBlock(id, 'Print', "'hi'")] }
}

async function createProfile(request: APIRequestContext, name: string): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/profiles`, {
    data: { name, type: 'custom', tags: [], environment_values: {} },
  })
  expect(resp.ok(), `POST /profiles: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  const body = await resp.json()
  return (body.data?.id ?? body.id) as string
}

test.describe('V-FN-BLOCK-WINDOW-FUNCTIONAL: the Function Block window', () => {
  const testIds: string[] = []
  const functionIds: string[] = []
  const profileIds: string[] = []

  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
  })

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds, functionIds)
    for (const id of profileIds.splice(0)) await request.delete(`${BACKEND_URL}/profiles/${id}`).catch(() => undefined)
  })

  test('a blank Name is flagged at once and holds Save; a new Name saves to the Block and its Function', async ({
    page,
    request,
  }) => {
    const testId = await createTest(request, {
      name: zzName('name-gate'),
      nodes: [localFunctionBlock(GATE_ID, 'Gate_Fn', printBody('gate-log'))],
    })
    testIds.push(testId)
    await openTest(page, testId)
    const sheet = await openBlockWindow(page, GATE_ID)
    const nameBox = sheet.getByTestId('function-name-input')
    const error = sheet.getByTestId('function-name-error')
    await expect(nameBox).toHaveValue('Gate_Fn')
    await expect(error).toHaveCount(0)

    await test.step('clearing the Name flags it at once and keeps Save off', async () => {
      await nameBox.fill('')
      await expect(error).toHaveText(/^Name is required$/)
      await expect(nameBox).toHaveAttribute('aria-invalid', 'true')
      await expect(windowSave(sheet)).toBeDisabled()
      await expect(sheet.getByTestId('save-blocked-note')).toHaveText(SAVE_NOTE)
    })

    await test.step('a new Name opens Save and is stored on the Block and its Local Function', async () => {
      await nameBox.fill('Renamed_Fn')
      await expect(error).toHaveCount(0)
      await expect(sheet.getByTestId('save-blocked-note')).toHaveCount(0)
      await saveBlockWindow(sheet)
      await expect(page.getByTestId(`workflow-node-body-${GATE_ID}`)).toHaveAttribute('aria-label', 'Renamed_Fn block')
      await saveTest(page)
      const block = await storedBlock(request, testId, GATE_ID)
      expect(block.label).toBe('Renamed_Fn')
      expect((block.localDefinition as Rec).name).toBe('Renamed_Fn')
    })
  })

  test('the footer Profiles shows the bound profile count and lists the bound profiles', async ({ page, request }) => {
    const names = [zzName('profile-a'), zzName('profile-b')]
    for (const name of names) profileIds.push(await createProfile(request, name))
    const bindings = profileIds.map((profileId, index) => ({
      profileId,
      profileName: names[index],
      profileType: 'custom',
      alias: `prof_${index}`,
    }))
    const testId = await createTest(request, {
      name: zzName('profile-count'),
      nodes: [
        localFunctionBlock(BOUND_ID, 'Bound_Fn', printBody('bound-log'), { profileBindings: bindings }),
        localFunctionBlock(UNBOUND_ID, 'Unbound_Fn', printBody('unbound-log'), { position: { x: 300, y: 360 } }),
      ],
    })
    testIds.push(testId)
    await openTest(page, testId)

    await test.step('a Function Block bound to two profiles counts 2 and its sheet lists both', async () => {
      const sheet = await openBlockWindow(page, BOUND_ID)
      const profiles = sheet.getByRole('button', { name: 'Profiles', exact: true })
      await expect(profiles.getByTestId('profiles-count-badge')).toHaveText('2')
      await profiles.click()
      const bound = page.getByTestId('profile-binding-sheet')
      await expect(bound).toBeVisible()
      await expect(bound.locator('[data-testid^="bound-profile-"]')).toHaveCount(2)
      for (const [index, profileId] of profileIds.entries()) {
        await expect(bound.getByTestId(`bound-profile-${profileId}`)).toContainText(names[index])
      }
      await bound.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(bound).toHaveCount(0)
      await closeBlockWindow(sheet)
    })

    await test.step('a Function Block bound to none shows no count', async () => {
      const sheet = await openBlockWindow(page, UNBOUND_ID)
      await expect(sheet.getByRole('button', { name: 'Profiles', exact: true })).toBeVisible()
      await expect(sheet.getByTestId('profiles-count-badge')).toHaveCount(0)
      await closeBlockWindow(sheet)
    })
  })

  test("in edit mode the window's Description stays the Block's own and the publish keeps the library description", async ({
    page,
    request,
  }) => {
    const pin = await createFunction(request, libraryFunction(zzName('described'), printBody('described-log'), LIBRARY_DESCRIPTION))
    functionIds.push(pin.functionId)
    const testId = await createTest(request, {
      name: zzName('draft-description'),
      nodes: [sharedFunctionBlock(SHARED_ID, 'Described_Fn', pin)],
    })
    testIds.push(testId)
    await openTest(page, testId)
    await pickBlockMenuItem(page, SHARED_ID, /^Edit$/)
    await expect(editModeOverlay(page, SHARED_ID)).toBeVisible({ timeout: 10_000 })

    await test.step('the window Save stores the Description on the Block and leaves the draft alone', async () => {
      const sheet = await openBlockWindow(page, SHARED_ID)
      await sheet.getByTestId('element-description-input').fill(BLOCK_DESCRIPTION)
      await saveBlockWindow(sheet)
      await saveTest(page)
      const block = await storedBlock(request, testId, SHARED_ID)
      expect(block.editMode).toBe(true)
      expect(block.description).toBe(BLOCK_DESCRIPTION)
      expect((block.draft as Rec).description, 'the draft keeps the library description').toBe(LIBRARY_DESCRIPTION)
    })

    await test.step('after a reload the window shows the Block description again', async () => {
      await openTest(page, testId)
      await expect(editModeOverlay(page, SHARED_ID)).toBeVisible({ timeout: 10_000 })
      const sheet = await openBlockWindow(page, SHARED_ID)
      await expect(sheet.getByTestId('element-description-input')).toHaveValue(BLOCK_DESCRIPTION)
      await closeBlockWindow(sheet)
    })

    await test.step('the publish starts from the source version description and records it', async () => {
      await pickBlockMenuItem(page, SHARED_ID, /^Publish$/)
      const dialog = page.getByRole('dialog').filter({ hasText: 'Publish edit-mode draft' })
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await expect(dialog.getByTestId('publish-edit-mode-description-input')).toHaveValue(LIBRARY_DESCRIPTION)
      await dialog.getByTestId('publish-edit-mode-changelog-input').fill('Republish with a Block description')
      await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
      const outcome = page.getByRole('alertdialog')
      await expect(outcome).toBeVisible({ timeout: 10_000 })
      const single = outcome.getByTestId('publish-outcome-single-confirm')
      if ((await single.count()) > 0) await single.click()
      else await outcome.getByRole('button', { name: 'Publish and set New', exact: true }).click()
      await expect(outcome).toHaveCount(0, { timeout: 15_000 })
      await expect(editModeOverlay(page, SHARED_ID), 'the publish ends edit mode').toHaveCount(0)

      const resp = await request.get(`${BACKEND_URL}/functions/${pin.functionId}/versions`)
      expect(resp.ok(), `GET versions: ${resp.status()}`).toBeTruthy()
      const versions = ((await resp.json()).data.versions ?? []) as Array<{ version: string; description: string }>
      const published = versions.filter((entry) => entry.version !== pin.version)
      expect(published, JSON.stringify(versions)).toHaveLength(1)
      expect(published[0].description).toBe(LIBRARY_DESCRIPTION)
    })
  })
})
