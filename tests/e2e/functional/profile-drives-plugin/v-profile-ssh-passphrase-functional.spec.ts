/**
 * V-PROFILE-SSH-PASSPHRASE-FUNCTIONAL: an ssh profile built on the Profiles page unlocks a passphrase-protected key
 * Wireframe: N/A
 * Design Decisions: SSH-7, K8SPROF-9, SECFLD-1
 * REQ: REQ-4.5.4, REQ-4.7.3
 *
 * The good profile is made on the Profiles page: the key text is pasted into the Private Key
 * value sheet and the Passphrase typed, for the shared E2E environment. The fixture's first
 * SSH Session Open takes every connection value from that profile (its own Password empty,
 * Strict host keys), the SFTP blocks run on the session, and a second Session Open bound to a
 * profile with the wrong passphrase is caught by a Try/Catch.
 *
 * Pass Criteria:
 * 1. PASS-1: the create dialog's Type selector offers exactly six types and none reads `sftp`;
 *    the Profiles list's Type filter offers no `sftp` either.
 * 2. PASS-2: the fixture validates with zero errors; every connection value of the first
 *    Session Open comes from the profile.
 * 3. PASS-3: the session opens: connected true, `hop_count` 1.
 * 4. PASS-4: SFTP Create folder `{F}`, Stats (Exists true, Type `folder`) and Delete pass on
 *    that session.
 * 5. PASS-5: the wrong-passphrase Session Open is caught with
 *    `SSH connection to {host}:{port} failed: Incorrect passphrase`.
 * 6. PASS-6: no console line carries the passphrase or any line of the private key in clear.
 * 7. PASS-7: nothing outlives the run: the Test and both profiles are gone.
 */

import fs from 'fs'
import path from 'path'
import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  E2E_ENV_NAME,
  SSH_KEY_PASSPHRASE,
  SSH_MAIN_PORT,
  SSH_STACK_USER,
  SSH_TARGET_HOST,
  ensureEnvironment,
} from '../../helpers/config'
import { getNode } from '../../helpers/element-types'
import { sessionValue } from '../../helpers/fixture-import'
import { expectNodeStatus, resolveEnvironmentId } from '../../helpers/k8s-run'
import {
  expectConsoleLine,
  formatEntries,
  getLogCopyTexts,
  setConsoleMinimumLevel,
  type LogEntry,
} from '../../helpers/log-reader'
import {
  openProfileCreateDialog,
  openProfileFieldSheet,
  selectProfileModalEnvironment,
} from '../../helpers/profiles'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import { deleteTest } from '../file-picker/picker'
import { blockSource } from '../shell-blocks/shell-helpers'
import {
  expectRunValid,
  importSftpTest,
  loadSftpFixture,
  newSftpRun,
  out,
  runCleanup,
  runSftpTest,
  sftpLine,
  sftpLines,
} from '../sftp/sftp-cases'

const FIXTURE_FILE = 'fixture-ssh-passphrase.json'

const KEY_TEXT = fs.readFileSync(
  path.resolve(__dirname, '../../services/sshd/keys/wave_ed25519_passphrase'),
  'utf-8',
)
const KEY_LINES = KEY_TEXT.split('\n').filter((line) => line.trim() !== '')

const PROFILE_TYPES = ['custom', 'database', 'http', 'kubernetes', 'opensearch', 'ssh']
const SSH_FIELDS = ['host', 'port', 'username', 'password', 'private_key', 'passphrase', 'connect_timeout']
const CONNECTION_FIELDS = ['host', 'port', 'username', 'private_key', 'passphrase']

const NODE = {
  open: 'd1306ef0-9e12-46b6-9978-e311ef252de3',
  report: 'eac37e10-63b1-412a-a196-742b4d287688',
  mkdir: '23ef2814-f5c5-48d3-a214-422f13d2c69f',
  stats: '7ed0c849-d33f-4ac4-8250-f72930176226',
  delete: '35c13cc6-1fbd-40f9-9a0e-a29c67a51312',
  statsGone: '760505d8-37f0-47b6-ba0d-f2e34a36de13',
  close: 'b2dee854-ce4d-469d-a037-1e23be9da4b3',
  guard: '590161a1-a941-4c08-be72-18baeee73888',
  openWrong: '1e6be0a1-9e3d-4157-94c1-594d8c2e2da4',
  caught: 'fbae0eae-31b8-46b3-a53b-d4577248ff59',
  done: '0dca971e-0d1c-4764-ae17-343e0f58f073',
} as const

const OPEN_NAME = 'Open with the passphrase key'

const run = newSftpRun('profile-ssh-passphrase')
const F = run.folder
const BOOKEND = `profile-ssh-passphrase-done-${run.uuid}`
const GOOD_NAME = `Profile SSH Passphrase ${run.uuid}`
const WRONG_NAME = `Profile SSH Wrong Passphrase ${run.uuid}`
const WRONG_PASSPHRASE = `not-the-passphrase-${run.uuid.slice(0, 8)}`
const WRONG_PASSPHRASE_REFUSAL = `SSH connection to ${SSH_TARGET_HOST}:${SSH_MAIN_PORT} failed: Incorrect passphrase`

const createdTests: string[] = []
const createdProfiles: string[] = []
let workflowRan = false

type ProfileValues = Record<string, unknown>

const paramRows = (dialog: Locator): Locator => dialog.locator('tbody tr[data-parameter-id]')

async function optionTexts(options: Locator): Promise<string[]> {
  return (await options.allTextContents()).map((text) => text.trim()).sort()
}

/** Apply the value sheet's text and close it, as the Profiles page does for any literal. */
async function applyValueSheet(sheet: Locator): Promise<void> {
  const save = sheet.locator('[data-testid="value-editor-save-button"]')
  await save.click()
  await expect(save).toBeDisabled()
  await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(sheet).toBeHidden()
}

async function typeProfileField(page: Page, dialog: Locator, field: string, value: string): Promise<void> {
  const sheet = await openProfileFieldSheet(page, dialog, field)
  await sheet.locator('.cm-content').first().click()
  await page.keyboard.insertText(value)
  await applyValueSheet(sheet)
}

/** Paste multi-line text into a profile field's value sheet, the way a key is copied in. */
async function pasteProfileField(page: Page, dialog: Locator, field: string, value: string): Promise<void> {
  const sheet = await openProfileFieldSheet(page, dialog, field)
  const content = sheet.locator('.cm-content').first()
  await content.click()
  await content.evaluate((element, text) => {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, value)
  await expect
    .poll(async () => sheet.locator('.cm-content .cm-line').allTextContents(), { message: 'the sheet holds every key line' })
    .toEqual(value.split('\n'))
  await applyValueSheet(sheet)
}

async function storedValues(request: APIRequestContext, profileId: string, environmentId: string): Promise<ProfileValues> {
  const response = await request.get(`${BACKEND_URL}/profiles/${profileId}`)
  expect(response.ok(), `GET /profiles/${profileId}: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  return ((body.data ?? body).environment_values?.[environmentId] ?? {}) as ProfileValues
}

async function createWrongProfile(request: APIRequestContext, environmentId: string): Promise<string> {
  const config = {
    host: SSH_TARGET_HOST,
    port: Number(SSH_MAIN_PORT),
    username: SSH_STACK_USER,
    private_key: KEY_TEXT,
    passphrase: WRONG_PASSPHRASE,
  }
  const response = await request.post(`${BACKEND_URL}/profiles`, {
    data: {
      name: WRONG_NAME,
      type: 'ssh',
      description: 'The passphrase key with a wrong passphrase',
      config,
      environment_values: { [environmentId]: config },
      tags: ['e2e'],
    },
  })
  const body = await response.json().catch(() => null)
  expect(response.ok(), `POST /profiles: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return String((body.data ?? body).id)
}

/** The lines an SSH Session Open block of that Name wrote at `level`. */
function openEntries(entries: readonly LogEntry[], name: string, level: string): LogEntry[] {
  const source = blockSource('SSH Session Open', name)
  return entries.filter((entry) => entry.level === level && entry.source === source)
}

test.describe('V-PROFILE-SSH-PASSPHRASE-FUNCTIONAL: a UI-built ssh profile unlocks a passphrase key', () => {
  test.afterAll(async ({ request }) => {
    const cleanup = await runCleanup(request, { account: 'wave', paths: [F] })
    if (workflowRan) expect(cleanup.probe?.exists, `${F} outlived the run`).toBe(false)

    const tests = createdTests.splice(0)
    const profiles = createdProfiles.splice(0)
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of tests) await deleteTest(request, testId)
    for (const profileId of profiles) {
      const response = await request.delete(`${BACKEND_URL}/profiles/${profileId}`)
      expect([204, 404], `DELETE /profiles/${profileId}: ${response.status()}`).toContain(response.status())
    }

    // PASS-7: the Test and both profiles are gone.
    for (const testId of tests) {
      expect((await request.get(`${BACKEND_URL}/tests/${testId}`)).status(), `Test ${testId}`).toBe(404)
    }
    for (const profileId of profiles) {
      expect((await request.get(`${BACKEND_URL}/profiles/${profileId}`)).status(), `profile ${profileId}`).toBe(404)
    }
  })

  test('PASS-1..PASS-7: a profile made on the Profiles page opens the SFTP session; a wrong passphrase is caught', async ({
    page,
    request,
  }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    await ensureEnvironment(request)
    const environmentId = await resolveEnvironmentId(request)
    let goodId = ''

    await test.step('PASS-1: the create dialog offers exactly six types, none of them sftp', async () => {
      const dialog = await openProfileCreateDialog(page)
      const listbox = page
        .getByRole('listbox')
        .filter({ has: page.getByRole('option', { name: 'custom', exact: true }) })
      await expect(async () => {
        if (!(await listbox.isVisible())) await dialog.locator('[data-testid="type-selector"]').click()
        await expect(listbox).toBeVisible({ timeout: 2000 })
      }).toPass({ timeout: 15_000 })
      const options = listbox.getByRole('option')
      await expect(options).toHaveCount(PROFILE_TYPES.length)
      expect(await optionTexts(options)).toEqual(PROFILE_TYPES)
      await listbox.getByRole('option', { name: 'ssh', exact: true }).click()
      await expect(paramRows(dialog)).toHaveCount(SSH_FIELDS.length)
      const names = await dialog
        .locator('textarea[aria-label="Parameter name"]')
        .evaluateAll((elements) => elements.map((element) => (element as HTMLTextAreaElement).value))
      expect(names).toEqual(SSH_FIELDS)
    })

    await test.step('the good profile is filled on the Profiles page and saved', async () => {
      const dialog = page.locator('[role="dialog"]').first()
      await dialog.locator('#name').fill(GOOD_NAME)
      await selectProfileModalEnvironment(page, dialog, E2E_ENV_NAME)
      await typeProfileField(page, dialog, 'host', SSH_TARGET_HOST)
      const port = paramRows(dialog).nth(SSH_FIELDS.indexOf('port')).locator('[data-testid="scalar-edit-input"]')
      await port.fill(SSH_MAIN_PORT)
      await expect(port).toHaveValue(SSH_MAIN_PORT)
      await typeProfileField(page, dialog, 'username', SSH_STACK_USER)
      await pasteProfileField(page, dialog, 'private_key', KEY_TEXT)
      await typeProfileField(page, dialog, 'passphrase', SSH_KEY_PASSPHRASE)
      await expect(dialog.locator('[data-testid^="param-value-error-"]')).toHaveCount(0)

      const created = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/profiles'),
      )
      await dialog.getByRole('button', { name: 'Create', exact: true }).click()
      const response = await created
      const body = await response.json()
      expect(response.status(), `POST /profiles answered ${JSON.stringify(body)}`).toBe(201)
      goodId = String((body.data ?? body).id)
      createdProfiles.push(goodId)
      await expect(dialog).toBeHidden()

      const values = await storedValues(request, goodId, environmentId)
      expect(values.host).toBe(SSH_TARGET_HOST)
      expect(values.port).toBe(Number(SSH_MAIN_PORT))
      expect(values.username).toBe(SSH_STACK_USER)
      expect(['', null, undefined], 'Password stays blank').toContain(values.password)
      for (const secret of ['private_key', 'passphrase']) {
        expect(values[secret], `${secret} is stored`).toBeTruthy()
        expectNoSecret(JSON.stringify(values[secret]), `stored ${secret}`, [SSH_KEY_PASSPHRASE, ...KEY_LINES.slice(1, -1)])
      }
    })

    await test.step('PASS-1: the Profiles list Type filter offers no sftp either', async () => {
      await page.locator('[data-testid="filter-type"]').click()
      const popover = page.locator('[role="dialog"]').filter({ has: page.getByPlaceholder('Search type…') })
      const options = popover.getByRole('option')
      await expect(options).toHaveCount(PROFILE_TYPES.length)
      expect(await optionTexts(options)).toEqual(PROFILE_TYPES)
      await page.keyboard.press('Escape')
      await expect(popover).toBeHidden()
    })

    const wrongId = await createWrongProfile(request, environmentId)
    createdProfiles.push(wrongId)

    const testId = await test.step('import the fixture bound to both profiles', async () => {
      const fixture = loadSftpFixture(__dirname, FIXTURE_FILE, run, {
        __GOOD_PROFILE_ID__: goodId,
        __GOOD_PROFILE_NAME__: GOOD_NAME,
        __WRONG_PROFILE_ID__: wrongId,
        __WRONG_PROFILE_NAME__: WRONG_NAME,
      })
      const id = await importSftpTest(page, fixture)
      createdTests.push(id)
      return id
    })

    await test.step('PASS-2: zero errors, and the first Session Open takes its connection from the profile', async () => {
      await expectRunValid(request, testId)
      const data = (await getNode(request, testId, NODE.open)).data
      const values = data.config.values as Record<string, unknown>
      for (const field of CONNECTION_FIELDS) {
        expect(values[field], field).toBe(`sshpass.${field}`)
        expect(data.expressionFields, `${field} is an expression`).toContain(field)
      }
      expect(['', null, undefined], "the block's own Password is empty").toContain(values.password)
      expect(values.host_key_verification).toBe('strict')
      expect(data.config.profileBindings).toEqual([
        expect.objectContaining({ profileId: goodId, alias: 'sshpass', profileType: 'ssh' }),
      ])
    })

    await setConsoleMinimumLevel(page, 'DEBUG')
    const { vars, entries } = await runSftpTest(page, testId, BOOKEND)
    workflowRan = true
    const consoleText = formatEntries(entries)

    await test.step('PASS-2: the resolved inputs are the profile values', () => {
      const inputs = openEntries(entries, OPEN_NAME, 'DEBUG')
        .map((entry) => entry.message)
        .filter((message) => message.startsWith('Inputs: '))
      expect(inputs, consoleText).toHaveLength(1)
      for (const piece of [
        `"host":${JSON.stringify(SSH_TARGET_HOST)}`,
        `"port":${Number(SSH_MAIN_PORT)}`,
        `"username":${JSON.stringify(SSH_STACK_USER)}`,
        `"private_key":${JSON.stringify(SECRET_MASK)}`,
        `"passphrase":${JSON.stringify(SECRET_MASK)}`,
        '"host_key_verification":"strict"',
      ]) {
        expect(inputs[0], piece).toContain(piece)
      }
    })

    await test.step('PASS-3: the session opens with connected true and one hop', async () => {
      // Close flips Connected to false, so the Log right after Open carries the proof.
      expectConsoleLine(entries, 'INFO', 'pass-session connected=True hops=1')
      expect(out(vars, 'pass_hops')).toBe(1)
      await expectNodeStatus(page, NODE.open, 'success')
    })

    await test.step('PASS-4: Create folder, Stats and Delete pass on that session', async () => {
      expect(sftpLines(entries, 'Create the spec folder'), consoleText).toEqual([sftpLine.createdFolder(F)])
      expect(out(vars, 'mkdir_success')).toBe(true)
      expect(sftpLines(entries, 'Stats of the spec folder'), consoleText).toEqual([sftpLine.stats(F)])
      expect(out(vars, 'stats_exists'), 'Exists').toBe(true)
      expect(out(vars, 'stats_type'), 'Type').toBe('folder')
      expect(out(vars, 'stats_success')).toBe(true)
      expect(sftpLines(entries, 'Delete the spec folder'), consoleText).toEqual([sftpLine.deleted(F)])
      expect(out(vars, 'delete_success')).toBe(true)
      expect(out(vars, 'gone_exists'), 'the folder is gone after the Delete').toBe(false)
      expect(out(vars, 'gone_type')).toBe('')
      for (const id of [NODE.mkdir, NODE.stats, NODE.delete, NODE.statsGone, NODE.close]) {
        await expectNodeStatus(page, id, 'success')
      }
    })

    await test.step('PASS-5: the wrong passphrase is caught with the Incorrect passphrase refusal', async () => {
      expect(out(vars, 'wrong_caught')).toBe(true)
      expect(out(vars, 'wrong_connected')).toBe(false)
      const error = sessionValue(vars, 'wrong_error') as Record<string, unknown>
      expect(error.message).toBe(WRONG_PASSPHRASE_REFUSAL)
      expect(error.node_id).toBe(NODE.openWrong)
      expectConsoleLine(entries, 'WARN', `Try-path error caught: ${WRONG_PASSPHRASE_REFUSAL}`)
      expectConsoleLine(entries, 'WARN', 'pass caught wrong passphrase')
      await expectNodeStatus(page, NODE.openWrong, 'failed')
      await expectNodeStatus(page, NODE.caught, 'success')
      await expectNodeStatus(page, NODE.done, 'success')
    })

    await test.step('PASS-6: neither passphrase nor any key line reaches the console', async () => {
      const copy = (await getLogCopyTexts(page)).join('\n')
      const needles = [SSH_KEY_PASSPHRASE, WRONG_PASSPHRASE, ...KEY_LINES]
      expectNoSecret(`${copy}\n${consoleText}`, 'run console', needles)
    })
  })
})
