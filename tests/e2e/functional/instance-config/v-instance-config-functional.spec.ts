/**
 * V-INSTANCE-CONFIG-FUNCTIONAL: Settings > General saves this WAVE's settings into its config file
 * Design Decisions: SETTINGS-14, SETTINGS-18, SETTINGS-19, SETTINGS-20, WSRV-11, NET-1
 * REQ: REQ-4.7.15, REQ-4.7.16, REQ-4.7.17, REQ-4.7.18, REQ-3.1.3.17
 *
 * Everything goes through the Settings pages of the stack. The config file is the stack's own
 * (`config_file` of `GET /server/status`), read from disk; the repository's config file is never
 * touched. The log level, the four reveal flags and the file are put back after every test.
 *
 * Pass Criteria:
 * 1. Config file row: `config_file` is an absolute path beside the stack's data folder, not
 *    `backend/config/config.yaml`; Settings > WAVE Server shows exactly that path on the lock-marked
 *    "Config file" row of the Backend Server card and its copy button puts it on the clipboard.
 * 2. Staging: on a clean General page Cancel and Save are disabled; Log Level DEBUG, "Reveal secrets
 *    in run output" and Time Zone UTC enable both and save nothing (no write request, the two GETs
 *    and the file unchanged, no `wave.timezone` key, a timestamp in another tab unchanged); Cancel
 *    restores the saved values and disables both.
 * 3. Save: both buttons disable; `GET /admin/log-level` reads DEBUG and the select shows it; the file
 *    holds `level: DEBUG` and `run_output: true`; only those two lines differ, every comment line of
 *    the example file is still there and the file mode is the same; `wave.timezone` is `utc` and the
 *    About page's Released date ends in `UTC`.
 * 4. Hand edit: a comment line and an `e2e_marker: {note: kept}` section written into the file are
 *    still there, unchanged, after a later Save that changes one other line.
 * 5. Read-only file: with the file at mode 0444 Save answers 500 and the toast "Could Not Save
 *    General Settings" reads exactly `Settings cannot be saved: the config file {path} is
 *    read-only`; the staged values stay, both GETs and the file are unchanged; with the mode put
 *    back the same staged values save.
 * 6. Run output reveal: saved on, a run prints the secret in the console; saved off again, the same
 *    run prints the mask and never the secret.
 * 7. Level in force: each saved level is what `GET /admin/log-level` reads at once and what a
 *    reloaded page shows.
 * 8. Leaving with a staged level by another Settings section, the app sidebar and browser Back each
 *    open "Unsaved changes" (Cancel, Discard, Save) while General stays: Cancel keeps the staged
 *    value; Discard leaves and the saved value shows on return; Save writes the file and leaves.
 * 9. Leaving with the file read-only: the dialog's Save shows the refusal toast, the dialog closes
 *    and General stays with the staged value; nothing is written.
 * 10. Loading: while `GET /admin/log-level` is held open General shows one skeleton row for
 *     Log Level and four for Secret Masking and no Cancel or Save on the Logging heading line; once
 *     it answers, the select, the four switches and the two buttons appear.
 * 11. Labels: "Log Level" and "Time Zone" name the two selects, and a value chosen through
 *     the labeled control is staged.
 * 12. A saved flag reaches the open app: with a test holding a secret variable open, "Reveal
 *     test variables" saved on shows the value in the Variable Manager after a sidebar visit with no
 *     reload; saved off, it is masked again.
 * 13. General brings the app in line: when the app's first read of the reveal flags fails
 *     (toast "Could Not Load Masking Settings") while the server holds `test_variables: true`, the
 *     Variable Manager masks; after opening General through the sidebar it shows the value.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { apiPathMatcher, countApiFetches, failApiRoute, type ApiUrlMatcher } from '../../helpers/api-route'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { configSection, readConfigText, stackPaths, withMode } from '../../helpers/config-file'
import { importFixtureTest, importValidateAndNavigate } from '../../helpers/fixture-import'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import { SHIPPED_EXAMPLE_CONFIG_TEXT } from '../../helpers/spawn-backend'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'
import { deleteTest } from '../file-picker/picker'

// A zone that is never UTC, so a Browser local timestamp and a UTC one read differently.
test.use({ timezoneId: 'America/Los_Angeles' })

// ---------------------------------------------------------------------------
// Exact texts and fixed values
// ---------------------------------------------------------------------------

const SAVE_FAILED_TITLE = 'Could Not Save General Settings'
const MASKING_LOAD_FAILED_TITLE = 'Could Not Load Masking Settings'
const MASKING_LOAD_REASON = 'Secret masking store unreadable: instance-config E2E 6c1d'
const readOnlyRefusal = (file: string): string =>
  `Settings cannot be saved: the config file ${file} is read-only`

const TIMEZONE_KEY = 'wave.timezone'
const LOCAL_ZONE_DATE = / (PST|PDT)$/
const UTC_DATE = / UTC$/

const MARKER_KEY = 'e2e_marker'
const MARKER_LINE = `${MARKER_KEY}: {note: kept}`
const MARKER_COMMENT = '# instance-config E2E hand edit'

const SECRET_VARIABLE = 'cfg_token'
const SECRET_VALUE = 'wave-cfg-s3cr3t-7731'
const RUN_DONE = 'instance-config-done'

const REVEAL = {
  runOutput: 'Reveal secrets in run output',
  testVariables: 'Reveal test variables',
  sharedVariables: 'Reveal global, regression, and suite variables',
  credentialInputs: 'Unmask plugin credential input fields',
} as const

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const LOG_LEVEL_ROUTE = apiPathMatcher('/admin/log-level')
const MASKING_ROUTE = apiPathMatcher('/admin/secret-masking')

interface MaskingFlags {
  run_output: boolean
  test_variables: boolean
  shared_variables: boolean
  credential_inputs: boolean
}

const MASKING_ALL_OFF: MaskingFlags = {
  run_output: false,
  test_variables: false,
  shared_variables: false,
  credential_inputs: false,
}

async function readLevel(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BACKEND_URL}/admin/log-level`)
  expect(response.status(), 'GET /admin/log-level').toBe(200)
  return ((await response.json()) as { level: string }).level
}

async function readFlags(request: APIRequestContext): Promise<MaskingFlags> {
  const response = await request.get(`${BACKEND_URL}/admin/secret-masking`)
  expect(response.status(), 'GET /admin/secret-masking').toBe(200)
  const body = (await response.json()) as MaskingFlags
  return {
    run_output: body.run_output,
    test_variables: body.test_variables,
    shared_variables: body.shared_variables,
    credential_inputs: body.credential_inputs,
  }
}

type Write = 'level' | 'masking'

const WRITE_ROUTES: Record<Write, ApiUrlMatcher> = { level: LOG_LEVEL_ROUTE, masking: MASKING_ROUTE }

function waitForWrite(page: Page, write: Write) {
  return page.waitForResponse(
    (response) => response.request().method() === 'PUT' && WRITE_ROUTES[write](new URL(response.url())),
  )
}

// ---------------------------------------------------------------------------
// The config file
// ---------------------------------------------------------------------------

interface LineChange {
  before: string
  after: string
}

/** The lines that differ between two texts of the same length. */
function changedLines(before: string, after: string): LineChange[] {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  expect(afterLines.length, 'the file keeps its line count').toBe(beforeLines.length)
  return beforeLines.flatMap((line, index) =>
    line === afterLines[index] ? [] : [{ before: line, after: afterLines[index] }],
  )
}

function commentLines(text: string): string[] {
  return text.split('\n').filter((line) => line.trimStart().startsWith('#'))
}

function fileMode(file: string): number {
  return fs.statSync(file).mode & 0o777
}

/** The text without the hand-edited comment and marker section. */
function withoutMarker(text: string): string {
  const kept: string[] = []
  let insideMarker = false
  for (const line of text.split('\n')) {
    if (line.startsWith(`${MARKER_KEY}:`)) {
      insideMarker = true
      continue
    }
    if (insideMarker && /^\s+\S/.test(line)) continue
    insideMarker = false
    if (line !== MARKER_COMMENT) kept.push(line)
  }
  return kept.join('\n')
}

function removeMarker(file: string): void {
  const text = readConfigText(file)
  const clean = withoutMarker(text)
  if (clean !== text) fs.writeFileSync(file, clean)
}

// ---------------------------------------------------------------------------
// The General page
// ---------------------------------------------------------------------------

const GENERAL_URL = /\/settings$/
const ABOUT_URL = /\/settings\/about$/

const generalTab = (page: Page): Locator => page.getByTestId('general-tab')
// Cancel and Save sit on the page's first heading line (SETTINGS-18).
const headingLine = (page: Page): Locator =>
  generalTab(page).getByRole('heading', { level: 2, name: 'Logging', exact: true }).locator('xpath=..')
const headerButton = (page: Page, name: 'Cancel' | 'Save'): Locator =>
  headingLine(page).getByRole('button', { name, exact: true })
const levelSelect = (page: Page): Locator => page.getByTestId('log-level-select')
const zoneSelect = (page: Page): Locator => page.getByTestId('timezone-select')
const revealSwitch = (page: Page, name: string): Locator =>
  generalTab(page).getByRole('switch', { name, exact: true })
const sidebarLink = (page: Page, name: string): Locator =>
  page.getByTestId('sidebar').getByRole('link', { name, exact: true })
const leaveDialog = (page: Page): Locator => page.getByTestId('leave-unsaved-dialog')
const secretValueCell = (page: Page): Locator =>
  variableRow(page, SECRET_VARIABLE).locator('[data-testid^="variable-value-"]')

async function expectLoaded(page: Page): Promise<void> {
  // Cancel and Save appear once the first read has answered.
  await expect(headerButton(page, 'Save')).toBeVisible({ timeout: 15_000 })
}

async function openGeneral(page: Page): Promise<void> {
  await page.goto('/settings')
  await expectLoaded(page)
}

/** Lands on About by URL, then opens General in-app, so browser Back has About behind it. */
async function openGeneralFromAbout(page: Page): Promise<void> {
  await page.goto('/settings/about')
  await expect(page.getByTestId('settings-nav-about')).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('settings-nav-general').click()
  await expect(page).toHaveURL(GENERAL_URL)
  await expectLoaded(page)
}

async function expectClean(page: Page): Promise<void> {
  await expect(headerButton(page, 'Cancel')).toBeDisabled()
  await expect(headerButton(page, 'Save')).toBeDisabled()
}

async function expectDirty(page: Page): Promise<void> {
  await expect(headerButton(page, 'Cancel')).toBeEnabled()
  await expect(headerButton(page, 'Save')).toBeEnabled()
}

async function choose(page: Page, select: Locator, option: string): Promise<void> {
  await select.click()
  await page.getByRole('option', { name: option, exact: true }).click()
  await expect(select).toHaveText(option)
}

async function setReveal(page: Page, name: string, on: boolean): Promise<void> {
  const toggle = revealSwitch(page, name)
  await expect(toggle).toBeChecked({ checked: !on })
  await toggle.click()
  await expect(toggle).toBeChecked({ checked: on })
}

/** Click `button` and wait until every named write answered 200. */
async function saveThrough(page: Page, button: Locator, writes: Write[]): Promise<void> {
  const answers = writes.map((write) => waitForWrite(page, write))
  await button.click()
  for (const answer of answers) {
    const response = await answer
    expect(response.status(), `${response.url()} answered ${await response.text()}`).toBe(200)
  }
}

async function savePage(page: Page, writes: Write[]): Promise<void> {
  await expect(headerButton(page, 'Save')).toBeEnabled()
  await saveThrough(page, headerButton(page, 'Save'), writes)
  await expectClean(page)
}

async function expectSaveRefused(page: Page, reason: string): Promise<void> {
  const toast = page.locator('[data-toast]').filter({ hasText: SAVE_FAILED_TITLE })
  await expect(toast).toBeVisible()
  await expect(toast.locator('div.font-semibold')).toHaveText(SAVE_FAILED_TITLE)
  await expect(toast.locator('div.text-sm').first()).toHaveText(reason)
}

/** The leave prompt is up with exactly Cancel, Discard and Save, and General stayed. */
async function expectLeavePrompt(page: Page): Promise<Locator> {
  await expect(page.getByRole('dialog', { name: 'Unsaved changes', exact: true })).toBeVisible()
  const dialog = leaveDialog(page)
  await expect(dialog.getByTestId('leave-unsaved-cancel')).toHaveText('Cancel')
  await expect(dialog.getByTestId('leave-unsaved-discard')).toHaveText('Discard')
  await expect(dialog.getByTestId('leave-unsaved-save')).toHaveText('Save')
  await expect(page).toHaveURL(GENERAL_URL)
  await expect(generalTab(page)).toBeVisible()
  return dialog
}

function storedTimezone(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), TIMEZONE_KEY)
}

// ---------------------------------------------------------------------------
// Ways of leaving General
// ---------------------------------------------------------------------------

interface Exit {
  title: string
  target: RegExp
  leave(page: Page): Promise<void>
  comeBack(page: Page): Promise<void>
}

const EXITS: Exit[] = [
  {
    title: 'another Settings section',
    target: ABOUT_URL,
    leave: (page) => page.getByTestId('settings-nav-about').click(),
    comeBack: (page) => page.getByTestId('settings-nav-general').click(),
  },
  {
    title: 'the app sidebar',
    target: /\/dashboard$/,
    leave: (page) => sidebarLink(page, 'Dashboard').click(),
    comeBack: (page) => sidebarLink(page, 'Settings').click(),
  },
  {
    title: 'browser Back',
    target: ABOUT_URL,
    leave: (page) => page.evaluate(() => window.history.back()),
    comeBack: (page) => page.getByTestId('settings-nav-general').click(),
  },
]

// ---------------------------------------------------------------------------
// The secret fixture
// ---------------------------------------------------------------------------

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture-secret-run.json'), 'utf-8'))
}

const created: string[] = []

/** Import the fixture (zero validation errors), open it on the canvas and run it to the marker. */
async function runSecretFixture(page: Page): Promise<string[]> {
  const testId = await importValidateAndNavigate(page, loadFixture())
  created.push(testId)
  const status = await startRun(page)
  return finishRun(page, status, RUN_DONE)
}

/** The workbench through the sidebar, with the Variable Manager open. */
async function workbenchThroughSidebar(page: Page): Promise<void> {
  await sidebarLink(page, 'Workbench').click()
  await expect(page).toHaveURL(/\/workbench$/)
  await waitForCanvasLoad(page)
  await expandVariableManager(page)
}

async function generalThroughSidebar(page: Page): Promise<void> {
  await sidebarLink(page, 'Settings').click()
  await expect(page).toHaveURL(GENERAL_URL)
  await expectLoaded(page)
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('V-INSTANCE-CONFIG-FUNCTIONAL: Settings > General and the config file', () => {
  let configFile = ''
  let dataFolder = ''
  let levelAtStart = ''
  // A level General can stage that differs from the one in force at the start.
  const STAGED_LEVEL = 'ERROR'

  test.beforeAll(async ({ request }) => {
    ;({ configFile, dataFolder } = await stackPaths(request))
    levelAtStart = await readLevel(request)
    expect(levelAtStart, 'the stack starts at INFO or WARN').toMatch(/^(INFO|WARN)$/)
  })

  test.afterEach(async ({ request }) => {
    const flags = await request.put(`${BACKEND_URL}/admin/secret-masking`, { data: MASKING_ALL_OFF })
    const level = await request.put(`${BACKEND_URL}/admin/log-level`, { data: { level: levelAtStart } })
    removeMarker(configFile)
    expect(flags.status(), 'PUT /admin/secret-masking puts the four flags back').toBe(200)
    expect(level.status(), 'PUT /admin/log-level puts the level back').toBe(200)
    expect(readConfigText(configFile), 'the marker is out of the file').not.toContain(MARKER_KEY)
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const testId of created.splice(0)) await deleteTest(request, testId)
  })

  test("(1) WAVE Server shows the stack's own config file and its copy button copies the path", async ({
    page,
  }) => {
    await test.step("the path is the stack's own file, beside its data folder", async () => {
      expect(path.isAbsolute(configFile), configFile).toBe(true)
      expect(configFile).not.toMatch(/backend\/config\/config\.yaml$/)
      expect(configFile).toBe(`${dataFolder}.config.yaml`)
      expect(fs.existsSync(configFile), `${configFile} exists`).toBe(true)
    })

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/settings/server')
    const row = page.getByTestId('server-card-backend').getByTestId('server-config-file')

    await test.step('the Config file row shows exactly that path, lock-marked (WSRV-11)', async () => {
      await expect(page.getByTestId('server-config-file')).toHaveCount(1)
      await expect(row).toContainText('Config file')
      await expect(row.locator('svg.lucide-lock')).toBeVisible()
      await expect(row.getByText(configFile, { exact: true })).toBeVisible()
    })

    await test.step('the copy button copies exactly that path', async () => {
      await page.evaluate(() => navigator.clipboard.writeText(''))
      const copy = row.getByRole('button', { name: 'Copy Config file', exact: true })
      await copy.click()
      await expect(copy).toHaveAttribute('data-copied', 'true')
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(configFile)
    })
  })

  test('(2) General stages Log Level, a reveal switch and Time Zone; nothing is saved until Save and Cancel drops them', async ({
    page,
  }) => {
    const about = await page.context().newPage()
    await about.goto('/settings/about')
    const released = about.getByTestId('build-date')
    await expect(released).toHaveText(LOCAL_ZONE_DATE)
    const releasedBefore = await released.innerText()

    await page.bringToFront()
    const levelWrites = countApiFetches(page, LOG_LEVEL_ROUTE, 'PUT')
    const maskingWrites = countApiFetches(page, MASKING_ROUTE, 'PUT')
    await openGeneral(page)
    const fileBefore = readConfigText(configFile)

    const expectNothingSaved = async (): Promise<void> => {
      expect(levelWrites() + maskingWrites(), 'no write request left the page').toBe(0)
      expect(await readLevel(page.request)).toBe(levelAtStart)
      expect(await readFlags(page.request)).toEqual(MASKING_ALL_OFF)
      expect(readConfigText(configFile), 'the config file is unchanged').toBe(fileBefore)
      expect(await storedTimezone(page)).toBeNull()
    }

    await test.step('clean: Cancel and Save are disabled and the page shows the saved values', async () => {
      await expectClean(page)
      await expect(levelSelect(page)).toHaveText(levelAtStart)
      await expect(zoneSelect(page)).toHaveText('Browser local')
      await expect(revealSwitch(page, REVEAL.runOutput)).not.toBeChecked()
    })

    await test.step('staging the three values enables Cancel and Save', async () => {
      await choose(page, levelSelect(page), 'DEBUG')
      await setReveal(page, REVEAL.runOutput, true)
      await choose(page, zoneSelect(page), 'UTC')
      await expectDirty(page)
    })

    await test.step('nothing is saved: GETs, file, localStorage and a timestamp in another tab', async () => {
      await expectNothingSaved()
      await about.reload()
      await expect(released).toHaveText(releasedBefore)
    })

    await test.step('Cancel restores the saved values and disables both buttons', async () => {
      await page.bringToFront()
      await headerButton(page, 'Cancel').click()
      await expect(levelSelect(page)).toHaveText(levelAtStart)
      await expect(zoneSelect(page)).toHaveText('Browser local')
      await expect(revealSwitch(page, REVEAL.runOutput)).not.toBeChecked()
      await expectClean(page)
      await expectNothingSaved()
    })

    await about.close()
  })

  test('(3) Save writes the level and the flag into the config file, keeps every other line and the file mode, and applies the Time Zone', async ({
    page,
  }) => {
    await openGeneral(page)
    const fileBefore = readConfigText(configFile)
    const modeBefore = fileMode(configFile)

    await test.step('stage Log Level DEBUG, the run output reveal and Time Zone UTC, then Save', async () => {
      await choose(page, levelSelect(page), 'DEBUG')
      await setReveal(page, REVEAL.runOutput, true)
      await choose(page, zoneSelect(page), 'UTC')
      await savePage(page, ['level', 'masking'])
    })

    await test.step('the server holds the saved values and the page shows them', async () => {
      expect(await readLevel(page.request)).toBe('DEBUG')
      expect(await readFlags(page.request)).toEqual({ ...MASKING_ALL_OFF, run_output: true })
      await expect(levelSelect(page)).toHaveText('DEBUG')
      await expect(revealSwitch(page, REVEAL.runOutput)).toBeChecked()
      await expect(zoneSelect(page)).toHaveText('UTC')
    })

    await test.step('the file holds the two values; only those two lines differ', async () => {
      expect(configSection(configFile, 'logging')).toMatch(/^  level: DEBUG$/m)
      expect(configSection(configFile, 'secret_masking')).toMatch(/^  run_output: true$/m)
      const changed = changedLines(fileBefore, readConfigText(configFile))
      expect(changed.map((line) => line.after)).toEqual(['  level: DEBUG', '  run_output: true'])
      expect(changed.map((line) => line.before)).toEqual([
        expect.stringMatching(/^  level: (INFO|WARN)$/),
        '  run_output: false',
      ])
    })

    await test.step('every comment line of the example file is still there and the mode is the same', async () => {
      const lines = readConfigText(configFile).split('\n')
      const comments = commentLines(SHIPPED_EXAMPLE_CONFIG_TEXT)
      expect(comments.length, 'the example file carries comments').toBeGreaterThan(0)
      for (const comment of comments) expect(lines, `comment kept: ${comment}`).toContain(comment)
      expect(fileMode(configFile)).toBe(modeBefore)
    })

    await test.step('the browser holds the Time Zone and a timestamp ends in UTC', async () => {
      expect(await storedTimezone(page)).toBe('utc')
      await page.getByTestId('settings-nav-about').click()
      await expect(page).toHaveURL(ABOUT_URL)
      await expect(page.getByTestId('build-date')).toHaveText(UTC_DATE)
      await page.evaluate((key) => window.localStorage.removeItem(key), TIMEZONE_KEY)
    })
  })

  test('(4) a hand edit in the config file survives a later Save', async ({ page }) => {
    const original = readConfigText(configFile)
    const edited = `${original}${original.endsWith('\n') ? '' : '\n'}${MARKER_COMMENT}\n${MARKER_LINE}\n`
    fs.writeFileSync(configFile, edited)

    await openGeneral(page)
    await setReveal(page, REVEAL.sharedVariables, true)
    await savePage(page, ['masking'])
    expect(await readFlags(page.request)).toEqual({ ...MASKING_ALL_OFF, shared_variables: true })

    const after = readConfigText(configFile)
    expect(changedLines(edited, after), 'only the saved line differs from the hand-edited file').toEqual([
      { before: '  shared_variables: false', after: '  shared_variables: true' },
    ])
    expect(after.split('\n')).toContain(MARKER_COMMENT)
    expect(configSection(configFile, MARKER_KEY)).toMatch(/^e2e_marker: \{note: kept\}$/m)
  })

  test('(5) a read-only config file refuses Save with the exact reason and keeps the staged values', async ({
    page,
  }) => {
    await openGeneral(page)
    await choose(page, levelSelect(page), 'DEBUG')
    await setReveal(page, REVEAL.runOutput, true)
    const fileBefore = readConfigText(configFile)
    const modeBefore = fileMode(configFile)

    await withMode(configFile, 0o444, async () => {
      await test.step('Save answers 500 and the toast states the exact reason', async () => {
        const refused = waitForWrite(page, 'level')
        await headerButton(page, 'Save').click()
        expect((await refused).status()).toBe(500)
        await expectSaveRefused(page, readOnlyRefusal(configFile))
      })

      await test.step('the staged values stay and nothing is saved', async () => {
        await expect(levelSelect(page)).toHaveText('DEBUG')
        await expect(revealSwitch(page, REVEAL.runOutput)).toBeChecked()
        await expectDirty(page)
        expect(await readLevel(page.request)).toBe(levelAtStart)
        expect(await readFlags(page.request)).toEqual(MASKING_ALL_OFF)
        expect(readConfigText(configFile), 'the config file is unchanged').toBe(fileBefore)
      })
    })

    await test.step('with the mode put back the same staged values save', async () => {
      expect(fileMode(configFile)).toBe(modeBefore)
      await savePage(page, ['level', 'masking'])
      expect(await readLevel(page.request)).toBe('DEBUG')
      expect(await readFlags(page.request)).toEqual({ ...MASKING_ALL_OFF, run_output: true })
    })
  })

  test('(6) a saved run output reveal shows a secret in the run console, and masking it again hides it', async ({
    page,
  }) => {
    await test.step('reveal saved: the run prints the secret', async () => {
      await openGeneral(page)
      await setReveal(page, REVEAL.runOutput, true)
      await savePage(page, ['masking'])
      expect(configSection(configFile, 'secret_masking')).toMatch(/^  run_output: true$/m)

      const logs = await runSecretFixture(page)
      expect(logs, logs.join('\n')).toContain(`CFG:${SECRET_VALUE}`)
    })

    await test.step('masked saved again: the same run prints the mask and never the secret', async () => {
      await openGeneral(page)
      await setReveal(page, REVEAL.runOutput, false)
      await savePage(page, ['masking'])
      expect(configSection(configFile, 'secret_masking')).toMatch(/^  run_output: false$/m)

      const logs = await runSecretFixture(page)
      expect(logs, logs.join('\n')).toContain(`CFG:${SECRET_MASK}`)
      expectNoSecret(logs.join('\n'), 'the run console', [SECRET_VALUE])
    })
  })

  test('(7) a saved log level is in force at once, without a restart', async ({ page }) => {
    await openGeneral(page)
    await expect(levelSelect(page)).toHaveText(levelAtStart)

    for (const level of ['DEBUG', STAGED_LEVEL]) {
      await test.step(`Save ${level}: GET /admin/log-level reads it and a reloaded page shows it`, async () => {
        await choose(page, levelSelect(page), level)
        await savePage(page, ['level'])
        expect(await readLevel(page.request)).toBe(level)
        await page.reload()
        await expectLoaded(page)
        await expect(levelSelect(page)).toHaveText(level)
      })
    }
  })

  for (const exit of EXITS) {
    test(`(8) leaving by ${exit.title} with a staged level asks first: Cancel stays, Discard drops it, Save writes the file`, async ({
      page,
    }) => {
      await openGeneralFromAbout(page)
      await expect(levelSelect(page)).toHaveText(levelAtStart)
      await choose(page, levelSelect(page), STAGED_LEVEL)

      await test.step('Cancel stays on General with the staged value', async () => {
        await exit.leave(page)
        const dialog = await expectLeavePrompt(page)
        await dialog.getByTestId('leave-unsaved-cancel').click()
        await expect(leaveDialog(page)).toHaveCount(0)
        await expect(page).toHaveURL(GENERAL_URL)
        await expect(levelSelect(page)).toHaveText(STAGED_LEVEL)
        await expectDirty(page)
        expect(await readLevel(page.request)).toBe(levelAtStart)
      })

      await test.step('Discard leaves, and coming back shows the saved value', async () => {
        await exit.leave(page)
        const dialog = await expectLeavePrompt(page)
        await dialog.getByTestId('leave-unsaved-discard').click()
        await expect(page).toHaveURL(exit.target)
        await expect(leaveDialog(page)).toHaveCount(0)
        expect(await readLevel(page.request)).toBe(levelAtStart)
        await exit.comeBack(page)
        await expect(page).toHaveURL(GENERAL_URL)
        await expectLoaded(page)
        await expect(levelSelect(page)).toHaveText(levelAtStart)
        await expectClean(page)
      })

      await test.step('Save writes the file and leaves', async () => {
        await choose(page, levelSelect(page), STAGED_LEVEL)
        await exit.leave(page)
        const dialog = await expectLeavePrompt(page)
        await saveThrough(page, dialog.getByTestId('leave-unsaved-save'), ['level'])
        await expect(page).toHaveURL(exit.target)
        await expect(leaveDialog(page)).toHaveCount(0)
        expect(await readLevel(page.request)).toBe(STAGED_LEVEL)
        expect(configSection(configFile, 'logging')).toMatch(new RegExp(`^  level: ${STAGED_LEVEL}$`, 'm'))
        await exit.comeBack(page)
        await expect(page).toHaveURL(GENERAL_URL)
        await expectLoaded(page)
        await expect(levelSelect(page)).toHaveText(STAGED_LEVEL)
        await expectClean(page)
      })
    })
  }

  test("(8) the leave dialog's Save on a read-only config file shows the refusal and stays on General", async ({
    page,
  }) => {
    await openGeneralFromAbout(page)
    await choose(page, levelSelect(page), STAGED_LEVEL)
    const fileBefore = readConfigText(configFile)

    await page.getByTestId('settings-nav-about').click()
    const dialog = await expectLeavePrompt(page)

    await withMode(configFile, 0o444, async () => {
      const refused = waitForWrite(page, 'level')
      await dialog.getByTestId('leave-unsaved-save').click()
      expect((await refused).status()).toBe(500)
      await expectSaveRefused(page, readOnlyRefusal(configFile))
      await expect(leaveDialog(page)).toHaveCount(0)
      await expect(page).toHaveURL(GENERAL_URL)
      await expect(levelSelect(page)).toHaveText(STAGED_LEVEL)
      await expectDirty(page)
      expect(await readLevel(page.request)).toBe(levelAtStart)
      expect(readConfigText(configFile), 'the config file is unchanged').toBe(fileBefore)
    })
  })

  test('(10) while the first read is open General shows skeleton rows and no Cancel or Save', async ({
    page,
  }) => {
    const level = await readLevel(page.request)
    const logging = page.getByTestId('log-level-section')
    const masking = page.getByTestId('secret-masking-section')
    const skeletonRows = (section: Locator): Locator => section.locator('[aria-busy="true"] > div')

    let release = (): void => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(LOG_LEVEL_ROUTE, async (route) => {
      if (route.request().method() === 'GET') await held
      await route.fallback()
    })
    const asked = page.waitForRequest(
      (request) => request.method() === 'GET' && LOG_LEVEL_ROUTE(new URL(request.url())),
    )

    try {
      await test.step('held open: one Log Level skeleton row, four masking rows, no control, no button', async () => {
        await page.goto('/settings')
        await asked
        await expect(generalTab(page)).toBeVisible()
        await expect(skeletonRows(logging)).toHaveCount(1)
        await expect(skeletonRows(masking)).toHaveCount(4)
        await expect(levelSelect(page)).toHaveCount(0)
        await expect(masking.getByRole('switch')).toHaveCount(0)
        await expect(headingLine(page).getByRole('button')).toHaveCount(0)
      })
    } finally {
      release()
    }

    await test.step('answered: the select, the four switches and the two buttons appear', async () => {
      await expect(levelSelect(page)).toHaveText(level)
      await expect(masking.getByRole('switch')).toHaveCount(4)
      for (const name of Object.values(REVEAL)) await expect(revealSwitch(page, name)).not.toBeChecked()
      await expect(generalTab(page).locator('[aria-busy="true"]')).toHaveCount(0)
      await expectClean(page)
    })
  })

  test('(11) the Log Level and Time Zone labels name their selects', async ({ page }) => {
    await openGeneral(page)
    const level = page.getByLabel('Log Level', { exact: true })
    const zone = page.getByLabel('Time Zone', { exact: true })

    await expect(level).toHaveCount(1)
    await expect(level).toHaveAttribute('data-testid', 'log-level-select')
    await expect(page.getByRole('combobox', { name: 'Log Level', exact: true })).toHaveAttribute(
      'data-testid',
      'log-level-select',
    )
    await expect(zone).toHaveCount(1)
    await expect(zone).toHaveAttribute('data-testid', 'timezone-select')
    await expect(page.getByRole('combobox', { name: 'Time Zone', exact: true })).toHaveAttribute(
      'data-testid',
      'timezone-select',
    )

    await test.step('a value chosen through each labeled control is staged', async () => {
      await choose(page, level, STAGED_LEVEL)
      await expectDirty(page)
      await headerButton(page, 'Cancel').click()
      await expectClean(page)
      await choose(page, zone, 'UTC')
      await expectDirty(page)
      await headerButton(page, 'Cancel').click()
      await expectClean(page)
    })
  })

  test('(12) a saved reveal flag reaches the open workbench without a reload', async ({ page }) => {
    const testId = await importValidateAndNavigate(page, loadFixture())
    created.push(testId)
    await expandVariableManager(page)
    await expect(secretValueCell(page), 'masked while the flag is off').toHaveText(SECRET_MASK)

    // A value on the window object lives only as long as the document.
    await page.evaluate(() => {
      ;(window as unknown as Record<string, unknown>).instanceConfigSameDocument = true
    })
    const sameDocument = (): Promise<unknown> =>
      page.evaluate(() => (window as unknown as Record<string, unknown>).instanceConfigSameDocument)

    await test.step('"Reveal test variables" saved on: the Variable Manager shows the value', async () => {
      await generalThroughSidebar(page)
      await setReveal(page, REVEAL.testVariables, true)
      await savePage(page, ['masking'])
      await workbenchThroughSidebar(page)
      await expect(secretValueCell(page)).toContainText(SECRET_VALUE)
      expect(await sameDocument(), 'the same document: no reload happened').toBe(true)
    })

    await test.step('saved off again: the Variable Manager masks the value', async () => {
      await generalThroughSidebar(page)
      await setReveal(page, REVEAL.testVariables, false)
      await savePage(page, ['masking'])
      await workbenchThroughSidebar(page)
      await expect(secretValueCell(page)).toHaveText(SECRET_MASK)
      expect(await sameDocument(), 'the same document: no reload happened').toBe(true)
    })
  })

  test("(13) opening General brings the app's reveal flags in line with the server", async ({ page }) => {
    const seeded = await page.request.put(`${BACKEND_URL}/admin/secret-masking`, {
      data: { test_variables: true },
    })
    expect(seeded.status(), 'PUT /admin/secret-masking').toBe(200)
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    const testId = await importFixtureTest(page, loadFixture())
    created.push(testId)

    await test.step("the app's first read of the flags fails: the toast says why and the secret is masked", async () => {
      await failApiRoute(page, MASKING_ROUTE, { detail: MASKING_LOAD_REASON })
      await page.goto(`/workbench?editTest=${testId}`)
      const toast = page.locator('[data-toast]').filter({ hasText: MASKING_LOAD_FAILED_TITLE })
      await expect(toast).toBeVisible()
      await expect(toast.locator('div.font-semibold')).toHaveText(MASKING_LOAD_FAILED_TITLE)
      await expect(toast.locator('div.text-sm').first()).toHaveText(MASKING_LOAD_REASON)
      await waitForCanvasLoad(page)
      await expandVariableManager(page)
      await expect(secretValueCell(page)).toHaveText(SECRET_MASK)
    })

    await test.step('General, opened through the sidebar, reads the flags; the Variable Manager shows the value', async () => {
      await page.unroute(MASKING_ROUTE)
      await generalThroughSidebar(page)
      await expect(revealSwitch(page, REVEAL.testVariables)).toBeChecked()
      await workbenchThroughSidebar(page)
      await expect(secretValueCell(page)).toContainText(SECRET_VALUE)
    })
  })
})
