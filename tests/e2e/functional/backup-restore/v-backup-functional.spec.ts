/**
 * Backup & Restore Functional E2E Test
 *
 * End-to-end test verifying the full backup and restore lifecycle:
 * 1. Seed valid entities through the API, every name with a run token
 * 2. Create a backup via API
 * 3. Reset the database
 * 4. Navigate to Settings > Backup tab
 * 5. Upload the backup via the Restore UI
 * 6. Verify validation preview shows correct entity counts
 * 7. Execute restore
 * 8. Verify every seeded entity is back under the id it had, via API
 *
 * REQ: selective backup, full backup, on-demand restore, periodic backup;
 *      REQ-4.7.16, REQ-4.7.20, REQ-5.2.4.9.5
 * Design Decisions: SETTINGS-18, SETTINGS-21, NET-1, SHELL-10, BACKUP-1
 *
 * Covers:
 * - Backup creation with the selected ones of the nine entity types a backup holds
 * - ZIP archive structure (manifest + entity files)
 * - Validation preview accuracy
 * - Restore with "skip" conflict resolution
 * - Every seeded entity read back after restore under its own id, with its links (REQ-5.2.4.9.5)
 * - Selective backup (subset of entity types)
 * - Format options (YAML, JSON)
 * - Schedule through the API: on, read back, shown on the page, off with every setting back at its default
 * - SSH Hosts and Additional Certificates (REQ-5.2.4.9.2, REQ-4.5.14, REQ-4.5.16): a
 *   backup made on the Backup page with only those two types selected carries both;
 *   the host and the certificate removed on the Network pages (trash + Save) come
 *   back on restore, through the API and on the pages, and the hosts still saved
 *   are skipped, not duplicated
 *
 * Pass Criteria - Periodic schedule on Settings > Backup (the stack's own config file is read from disk):
 * 1. Cancel and Save on the Periodic Backup heading line are disabled while nothing changed,
 *    enabled by a staged change and disabled again after Cancel; the section has no other save button.
 * 2. A schedule that was stored and then saved off holds none of its settings: switching on shows
 *    the defaults (an empty cron, the folder `~/wave-backups`, 5 backups); no PUT is sent and the
 *    API and the config file still say off until Save.
 * 3. Save with a cron and a folder under the temp folder writes both into backup.schedule of the
 *    config file, and the page shows the next run the server computed.
 * 4. Switched off and saved, the API and the file say off and the cron, the entity types, the
 *    format, the compression, the count and the folder are back at their defaults; switching on
 *    again shows the defaults, and Save without a cron is refused with "Cron expression is required".
 * 5. A Save Directory that is the data folder, or a folder inside it, is refused with the toast
 *    "Could Not Save Backup Schedule" and "Save directory must be outside the data folder: {data folder}";
 *    the typed value stays, the API and the config file are unchanged.
 * 6. With the cron "* * * * *" and Max Backups to Keep 1: the first run writes one archive into the
 *    folder and the file records last_run and last_run_status: success; reopened, the page reads
 *    "Last run: success at {last_run of the file, in the browser's time zone}"; after the second
 *    run the folder holds exactly one wave-backup-*.zip, the newer one. Switched off and saved
 *    after that, the cron is gone and the record of the last run stays in the API, in the file
 *    and on the page.
 * 7. DELETE /api/backup/schedule answers 405 and the schedule stays on.
 * 8. Leaving with a staged change asks first (Unsaved changes: Cancel, Discard, Save): Cancel stays
 *    with the change, Discard leaves and saves nothing, Save with a cron and a folder typed saves
 *    and leaves, and a Save refused with the data folder message stays on Backup with the typed value.
 * 9. An emptied Max Backups to Keep box stays empty, takes the number typed next alone, and Save
 *    writes it; left empty, the box shows its number again and nothing is staged.
 * 10. With a library Function published and the schedule switched on from its defaults (all nine
 *    entity types ticked), the archive of the first run holds a `functions/` member for that
 *    Function and the entity counts of `manifest.json` have the key `functions` (BACKUP-1, REQ-4.7.20).
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/backup-restore/v-backup-functional.spec.ts
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'node:crypto'
import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { apiPathMatcher, countApiFetches } from '../../helpers/api-route'
import { BACKEND_PORT, CA_CERT_PEM } from '../../helpers/config'
import { configSection, readConfigText, stackPaths } from '../../helpers/config-file'
import { exec } from '../../helpers/exec'
import {
  createValidTest,
  logNode,
  publishLibraryFunction,
  startEdge,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'
import { SSH_HOST_KEY, STACK_TRUSTED_HOSTS, resetNetworkSettings } from '../../helpers/network-settings'
import { readZipEntryText, zipEntryNames } from '../../helpers/zip-reader'

const API = `http://localhost:${BACKEND_PORT}`

// ---------------------------------------------------------------------------
// Cleanup: reset database after all destructive tests so earlier fixtures
// (from workflow execution tests) are not left wiped.
// ---------------------------------------------------------------------------

test.afterAll(async () => {
  exec('./tests/e2e/scripts/reset.sh')
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForSettingsPageLoad(page: Page) {
  await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="settings-page"][aria-busy="false"]', {
    state: 'attached',
  })
}

type SeededPart = 'tests' | 'environments' | 'suites' | 'regressions'

interface SeededItem {
  id: string
  name: string
}

type Seed = Record<SeededPart, SeededItem[]>

const SEEDED_PARTS: readonly SeededPart[] = ['tests', 'environments', 'suites', 'regressions']

/** Create one item through its own create route; its id. */
async function createItem(
  request: APIRequestContext,
  part: SeededPart,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await request.post(`${API}/${part}`, { data })
  const body = await response.json().catch(() => null)
  expect(response.status(), `POST /${part} answered ${JSON.stringify(body)}`).toBe(201)
  return body.data.id as string
}

/** Reset the store, then seed items the create routes accept; every name carries a run token. */
async function seedTestData(request: APIRequestContext): Promise<Seed> {
  exec('./tests/e2e/scripts/reset.sh')
  const token = randomUUID().slice(0, 8)

  const environments: SeededItem[] = []
  for (const label of ['Env 1', 'Env 2']) {
    const name = `Backup Test ${label} ${token}`
    const id = await createItem(request, 'environments', {
      name,
      description: `Environment for backup test, ${label}`,
    })
    environments.push({ id, name })
  }

  const tests: SeededItem[] = []
  for (const label of ['Alpha', 'Beta', 'Gamma']) {
    const name = `Backup Test ${label} ${token}`
    const blockId = `log-${label.toLowerCase()}`
    const id = await createValidTest(request, {
      name,
      nodes: [logNode(blockId, `Log ${label}`, `'backup test ${label} ${token}'`)],
      edges: [startEdge(blockId)],
    })
    tests.push({ id, name })
  }

  const suiteName = `Backup Test Suite ${token}`
  const suiteId = await createItem(request, 'suites', {
    name: suiteName,
    description: 'Suite for backup test',
    tests: tests.map((item) => item.id),
  })
  const regressionName = `Backup Test Regression ${token}`
  const regressionId = await createItem(request, 'regressions', {
    name: regressionName,
    description: 'Regression for backup test',
    suites: [suiteId],
  })

  return {
    tests,
    environments,
    suites: [{ id: suiteId, name: suiteName }],
    regressions: [{ id: regressionId, name: regressionName }],
  }
}

/** One stored item, read by its id. */
async function readItem(
  request: APIRequestContext,
  part: SeededPart,
  id: string,
): Promise<Record<string, unknown>> {
  const response = await request.get(`${API}/${part}/${id}`)
  const body = await response.json().catch(() => null)
  expect(response.status(), `GET /${part}/${id} answered ${JSON.stringify(body)}`).toBe(200)
  return body.data as Record<string, unknown>
}

/** Every seeded item of the given parts answers under the id it had, with its name. */
async function expectBackUnderOwnIds(
  request: APIRequestContext,
  seed: Seed,
  parts: readonly SeededPart[],
): Promise<void> {
  for (const part of parts) {
    for (const item of seed[part]) {
      const stored = await readItem(request, part, item.id)
      expect(stored.id, `${item.name} is back under the id it had`).toBe(item.id)
      expect(stored.name).toBe(item.name)
    }
  }
}

async function getEntityCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}

  for (const type of ['tests', 'environments', 'suites', 'regressions']) {
    const resp = await fetch(`${API}/${type}/`)
    const data = await resp.json()
    // All listing endpoints return {success: true, data: [...], pagination: {total: N}}
    counts[type] = data.pagination?.total ?? data.data?.length ?? 0
  }

  return counts
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Backup & Restore E2E', () => {
  test('Full backup and restore lifecycle', async ({ page }) => {
    // -----------------------------------------------------------------------
    // STEP 1: Seed test data
    // -----------------------------------------------------------------------
    const seeded = await test.step('Seed test data through the API', async () => {
      const result = await seedTestData(page.request)
      // Verify entities exist
      const counts = await getEntityCounts()
      expect(counts.tests, 'Should have 3 seeded tests').toBe(result.tests.length)
      expect(counts.environments, 'Should have 2 seeded environments').toBe(
        result.environments.length,
      )
      expect(counts.suites, 'Should have 1 seeded suite').toBe(result.suites.length)
      expect(counts.regressions, 'Should have 1 seeded regression').toBe(result.regressions.length)
      return result
    })

    // -----------------------------------------------------------------------
    // STEP 2: Create backup via API
    // -----------------------------------------------------------------------
    const backupBuffer = await test.step('Create backup via API', async () => {
      const response = await page.request.post(`${API}/api/backup/create`, {
        data: {
          entity_types: ['tests', 'environments', 'suites', 'regressions'],
          format: 'yaml',
          compression_method: 'deflate',
          compression_level: 6,
          secrets: 'mask',
        },
      })
      expect(response.ok(), 'Backup creation should succeed').toBeTruthy()
      expect(response.headers()['content-type']).toBe('application/zip')

      const buffer = await response.body()
      expect(buffer.length, 'Backup should have content').toBeGreaterThan(0)
      return buffer
    })

    // -----------------------------------------------------------------------
    // STEP 3: Reset database
    // -----------------------------------------------------------------------
    await test.step('Reset database', async () => {
      exec('./tests/e2e/scripts/reset.sh')

      // Verify entities are gone
      const counts = await getEntityCounts()
      expect(counts.tests, 'Tests should be cleared').toBe(0)
      expect(counts.environments, 'Environments should be cleared').toBe(0)
      expect(counts.suites, 'Suites should be cleared').toBe(0)
      expect(counts.regressions, 'Regressions should be cleared').toBe(0)
    })

    // -----------------------------------------------------------------------
    // STEP 4: Navigate to Settings > Backup tab
    // -----------------------------------------------------------------------
    await test.step('Navigate to backup settings', async () => {
      await page.goto('/settings/backup')
      await waitForSettingsPageLoad(page)

      const backupTab = page.locator('[data-testid="backup-restore-tab"]')
      await expect(backupTab, 'Backup tab should be visible').toBeVisible()
    })

    // -----------------------------------------------------------------------
    // STEP 5: Upload backup file via Restore UI
    // -----------------------------------------------------------------------
    await test.step('Upload backup file', async () => {
      const fileInput = page.locator('[data-testid="upload-input"]')
      await fileInput.setInputFiles({
        name: 'wave-backup-functional-test.zip',
        mimeType: 'application/zip',
        buffer: backupBuffer,
      })

      // Wait for validation preview
      const preview = page.locator('[data-testid="validation-preview"]')
      await expect(preview, 'Validation preview should appear').toBeVisible({ timeout: 10_000 })
    })

    // -----------------------------------------------------------------------
    // STEP 6: Verify validation preview
    // -----------------------------------------------------------------------
    await test.step('Verify validation preview', async () => {
      const preview = page.locator('[data-testid="validation-preview"]')

      // Metadata should show file name and version
      await expect(preview).toContainText('wave-backup-functional-test.zip')
      // Format is displayed lowercase with CSS text-transform: uppercase
      await expect(preview).toContainText('yaml')
      // The preview reports the recorded secrets mode (backup created with
      // secrets: 'mask' -> "Masked").
      await expect(preview).toContainText('Secrets')
      await expect(preview).toContainText('Masked')
      await expect(preview, 'no legacy credentials line').not.toContainText('Excluded')
      await expect(preview, 'no legacy credentials line').not.toContainText('Included')

      // Entity summary table should be visible
      const table = page.locator('[data-testid="entity-summary-table"]')
      await expect(table, 'Entity summary table should be visible').toBeVisible()

      // Check entity rows exist
      for (const type of ['tests', 'environments', 'suites', 'regressions']) {
        const row = page.locator(`[data-testid="entity-row-${type}"]`)
        await expect(row, `${type} row should be visible`).toBeVisible()
      }

      // Cells: checkbox, type, total, OK, conflicts, fixable, errors.
      for (const type of SEEDED_PARTS) {
        const cells = page.locator(`[data-testid="entity-row-${type}"] td`)
        const seededCount = String(seeded[type].length)
        await expect(cells.nth(2), `${type}: total`).toHaveText(seededCount)
        await expect(cells.nth(3), `${type}: OK`).toHaveText(seededCount)
        await expect(cells.nth(4), `${type}: conflicts`).toHaveText('0')
        await expect(cells.nth(5), `${type}: fixable`).toHaveText('0')
        await expect(cells.nth(6), `${type}: errors`).toHaveText('0')
      }
      await expect(
        page.locator('[data-testid="restore-item"]'),
        'no entity is named as a conflict or as one that cannot be restored',
      ).toHaveCount(0)

      // Checkboxes should all be checked
      for (const type of ['tests', 'environments', 'suites', 'regressions']) {
        const checkbox = page.locator(`[data-testid="restore-checkbox-${type}"]`)
        await expect(checkbox, `${type} checkbox should be checked`).toBeChecked()
      }
    })

    // -----------------------------------------------------------------------
    // STEP 7: Execute restore
    // -----------------------------------------------------------------------
    await test.step('Execute restore', async () => {
      const restoreButton = page.locator('[data-testid="restore-button"]')
      await expect(restoreButton, 'Restore button should be enabled').toBeEnabled()
      await restoreButton.click()

      // Wait for restore result
      const result = page.locator('[data-testid="restore-result"]')
      await expect(result, 'Restore result should appear').toBeVisible({ timeout: 10_000 })
      await expect(result).toContainText('Restore Complete')

      // Every seeded entity was written: nothing skipped, nothing left out.
      for (const type of SEEDED_PARTS) {
        await expect(
          page.locator(`[data-testid="restore-result-line-${type}"]`),
          `${type}: the result line`,
        ).toHaveText(`${type}: ${seeded[type].length} imported, 0 skipped`, { ignoreCase: true })
      }
      await expect(
        result.locator('[data-testid="restore-item"]'),
        'the result names no skipped entity and none that could not be restored',
      ).toHaveCount(0)
    })

    // -----------------------------------------------------------------------
    // STEP 8: Verify entities restored via API
    // -----------------------------------------------------------------------
    await test.step('Verify entities restored', async () => {
      const counts = await getEntityCounts()
      expect(counts.tests, 'Tests should be restored').toBe(seeded.tests.length)
      expect(counts.environments, 'Environments should be restored').toBe(
        seeded.environments.length,
      )
      expect(counts.suites, 'Suites should be restored').toBe(seeded.suites.length)
      expect(counts.regressions, 'Regressions should be restored').toBe(seeded.regressions.length)

      await expectBackUnderOwnIds(page.request, seeded, SEEDED_PARTS)

      const [suite] = seeded.suites
      expect(
        (await readItem(page.request, 'suites', suite.id)).tests,
        'the restored Suite lists its Tests',
      ).toEqual(seeded.tests.map((item) => item.id))
      const [regression] = seeded.regressions
      expect(
        (await readItem(page.request, 'regressions', regression.id)).suites,
        'the restored Regression lists its Suite',
      ).toEqual([suite.id])
    })
  })

  test('Selective backup with JSON format', async ({ page }) => {
    // -----------------------------------------------------------------------
    // STEP 1: Seed data
    // -----------------------------------------------------------------------
    const seeded = await test.step('Seed test data', async () => {
      return await seedTestData(page.request)
    })

    // -----------------------------------------------------------------------
    // STEP 2: Create selective backup (only tests + environments, JSON format)
    // -----------------------------------------------------------------------
    const backupBuffer = await test.step('Create selective JSON backup', async () => {
      const response = await page.request.post(`${API}/api/backup/create`, {
        data: {
          entity_types: ['tests', 'environments'],
          format: 'json',
          compression_method: 'deflate',
          compression_level: 3,
          secrets: 'mask',
        },
      })
      expect(response.ok(), 'Selective backup should succeed').toBeTruthy()
      return await response.body()
    })

    // -----------------------------------------------------------------------
    // STEP 3: Reset and restore via API
    // -----------------------------------------------------------------------
    await test.step('Reset database', async () => {
      exec('./tests/e2e/scripts/reset.sh')
    })

    await test.step('Restore selective backup via API', async () => {
      // Use page.request to send multipart form data (Playwright handles FormData)
      const response = await page.request.post(`${API}/api/backup/restore`, {
        multipart: {
          file: {
            name: 'selective.zip',
            mimeType: 'application/zip',
            buffer: backupBuffer,
          },
          entity_types: 'tests,environments',
          conflict_resolution: 'skip',
          auto_repair: 'false',
        },
      })
      expect(response.ok(), `Restore should succeed: ${response.status()}`).toBeTruthy()

      const { data: result } = await response.json()
      // Every Test and Environment of the archive was written; no other part is in the answer.
      expect(result, 'the restore answer').toEqual({
        tests: { imported: seeded.tests.length, skipped: 0, fatal: 0, items: [] },
        environments: { imported: seeded.environments.length, skipped: 0, fatal: 0, items: [] },
      })
    })

    // -----------------------------------------------------------------------
    // STEP 4: Verify only selected types restored
    // -----------------------------------------------------------------------
    await test.step('Verify only selected types restored', async () => {
      const counts = await getEntityCounts()
      expect(counts.tests, 'Tests should be restored').toBe(3)
      expect(counts.environments, 'Environments should be restored').toBe(2)
      // Suites and regressions were NOT in backup
      expect(counts.suites, 'Suites should not be restored').toBe(0)
      expect(counts.regressions, 'Regressions should not be restored').toBe(0)

      await expectBackUnderOwnIds(page.request, seeded, ['tests', 'environments'])
      for (const part of ['suites', 'regressions'] as const) {
        for (const item of seeded[part]) {
          const response = await page.request.get(`${API}/${part}/${item.id}`)
          expect(response.status(), `${item.name} was not in the backup and is not here`).toBe(404)
        }
      }
    })
  })
})

// ---------------------------------------------------------------------------
// Periodic schedule
// ---------------------------------------------------------------------------

const SCHEDULE_URL = `${API}/api/backup/schedule`
const SCHEDULE_PATH = apiPathMatcher('/api/backup/schedule')
const SAVE_REFUSED_TITLE = 'Could Not Save Backup Schedule'
/** Fires once a year, so no run starts while a test holds the schedule on. */
const IDLE_CRON = '0 3 1 1 *'
const EVERY_MINUTE = '* * * * *'
const ARCHIVE_NAME = /^wave-backup-.*\.zip$/

interface Schedule {
  enabled: boolean
  cron: string
  entity_types: string[]
  max_backups: number
  save_directory: string
  format: string
  compression_method: string
  compression_level: number
  secrets: string
  last_run: string | null
  last_run_status: 'success' | 'failed' | null
  cron_description: string
  next_run: string | null
}

type ScheduleUpdate = { enabled: boolean } & Partial<
  Pick<
    Schedule,
    | 'cron'
    | 'entity_types'
    | 'max_backups'
    | 'save_directory'
    | 'format'
    | 'compression_method'
    | 'compression_level'
  >
>

/** A schedule that is off holds its settings at their defaults (REQ-4.7.16, SHELL-10). */
const SCHEDULE_DEFAULTS = {
  cron: '',
  entity_types: [
    'certificates',
    'environments',
    'functions',
    'profiles',
    'regressions',
    'ssh_hosts',
    'suites',
    'system_variables',
    'tests',
  ],
  max_backups: 5,
  save_directory: '~/wave-backups',
  format: 'yaml',
  compression_method: 'deflate',
  compression_level: 6,
}
const CRON_REQUIRED = 'Cron expression is required'

async function readSchedule(request: APIRequestContext): Promise<Schedule> {
  const response = await request.get(SCHEDULE_URL)
  expect(response.status(), 'GET /api/backup/schedule').toBe(200)
  return ((await response.json()) as { data: Schedule }).data
}

async function writeSchedule(request: APIRequestContext, update: ScheduleUpdate): Promise<Schedule> {
  const response = await request.put(SCHEDULE_URL, { data: update })
  expect(response.status(), await response.text()).toBe(200)
  return ((await response.json()) as { data: Schedule }).data
}

/** One backup.schedule value as the config file spells it, YAML quotes removed. */
function scheduleValue(configFile: string, key: string): string | undefined {
  const line = new RegExp(`^    ${key}: (.*)$`, 'm').exec(configSection(configFile, 'backup'))
  return line?.[1].replace(/^(['"])(.*)\1$/, '$2')
}

/** An instant as the page shows it in Browser local mode, without the zone name. */
function shownLocally(page: Page, iso: string): Promise<string> {
  return page.evaluate((value) => {
    const at = new Date(value)
    const two = (part: number) => String(part).padStart(2, '0')
    const day = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
    return `${day} ${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`
  }, iso)
}

/** The archives of a save folder, oldest first: the name carries the UTC time of the run. */
function archivesIn(folder: string): string[] {
  return fs
    .readdirSync(folder)
    .filter((name) => ARCHIVE_NAME.test(name))
    .sort()
}

const periodicSection = (page: Page): Locator =>
  page.locator('[data-testid="periodic-backup-section"]')
const enableSwitch = (page: Page): Locator =>
  periodicSection(page).getByRole('switch', { name: 'Enable periodic backups', exact: true })
const cronInput = (page: Page): Locator =>
  periodicSection(page).locator('[data-testid="cron-input"]')
const maxBackupsInput = (page: Page): Locator =>
  periodicSection(page).locator('[data-testid="max-backups-input"]')
const saveDirectoryInput = (page: Page): Locator =>
  periodicSection(page).locator('[data-testid="save-directory-input"]')
const leaveDialog = (page: Page): Locator => page.locator('[data-testid="leave-unsaved-dialog"]')

/** Cancel or Save on the Periodic Backup heading line (SETTINGS-21). */
function headerButton(page: Page, name: 'Cancel' | 'Save'): Locator {
  return periodicSection(page)
    .getByRole('heading', { name: 'Periodic Backup', exact: true })
    .locator('xpath=..')
    .getByRole('button', { name, exact: true })
}

async function openSchedule(page: Page): Promise<void> {
  await page.goto('/settings/backup')
  await waitForSettingsPageLoad(page)
  await expect(enableSwitch(page)).toBeVisible()
}

async function expectClean(page: Page): Promise<void> {
  await expect(headerButton(page, 'Cancel'), 'Cancel is disabled while nothing changed').toBeDisabled()
  await expect(headerButton(page, 'Save'), 'Save is disabled while nothing changed').toBeDisabled()
}

async function expectDirty(page: Page): Promise<void> {
  await expect(headerButton(page, 'Cancel'), 'Cancel is enabled by a staged change').toBeEnabled()
  await expect(headerButton(page, 'Save'), 'Save is enabled by a staged change').toBeEnabled()
}

function isScheduleWrite(response: { url(): string; request(): { method(): string } }): boolean {
  return response.request().method() === 'PUT' && SCHEDULE_PATH(new URL(response.url()))
}

/** Press Save on the heading line; the status of its PUT. */
async function pressSave(page: Page): Promise<number> {
  const save = headerButton(page, 'Save')
  await expect(save).toBeEnabled()
  const [response] = await Promise.all([page.waitForResponse(isScheduleWrite), save.click()])
  return response.status()
}

/** The save failure toast carries the reason; dismissed, so a later refusal shows its own. */
async function expectSaveRefused(page: Page, reason: string): Promise<void> {
  const toast = page.locator('[data-toast]').filter({ hasText: SAVE_REFUSED_TITLE })
  await expect(toast).toHaveCount(1)
  // A hovered toast does not time out.
  await toast.hover()
  await expect(toast.locator('div.font-semibold')).toHaveText(SAVE_REFUSED_TITLE)
  await expect(toast.locator('div.text-sm').first()).toHaveText(reason)
  await toast.getByRole('button', { name: 'Dismiss notification' }).click()
  await expect(toast).toHaveCount(0)
}

/** The leave prompt is up with its three answers and the Backup page stayed. */
async function expectLeavePrompt(page: Page): Promise<Locator> {
  const dialog = leaveDialog(page)
  await expect(page.getByRole('dialog', { name: 'Unsaved changes', exact: true })).toBeVisible()
  await expect(dialog.locator('[data-testid="leave-unsaved-cancel"]')).toHaveText('Cancel')
  await expect(dialog.locator('[data-testid="leave-unsaved-discard"]')).toHaveText('Discard')
  await expect(dialog.locator('[data-testid="leave-unsaved-save"]')).toHaveText('Save')
  await expect(page).toHaveURL(/\/settings\/backup$/)
  return dialog
}

test.describe('Backup & Restore E2E: periodic schedule', () => {
  let configFile = ''
  let dataFolder = ''
  const saveFolders: string[] = []
  const publishedFunctions: SeededLibraryFunction[] = []

  /** A save folder under the temp folder, removed when the test ends. */
  function newSaveFolder(): string {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-e2e-backups-'))
    saveFolders.push(folder)
    return folder
  }

  /** The e2e reset keeps the Functions library, so a test's own Function is deleted here. */
  async function deletePublishedFunctions(request: APIRequestContext): Promise<void> {
    for (const fn of publishedFunctions.splice(0)) {
      const deleted = await request.delete(`${API}/functions/${fn.functionId}?cascade=true`)
      expect(deleted.ok(), `DELETE /functions/${fn.functionId} answered ${deleted.status()}`).toBeTruthy()
      const left = await request.get(
        `${API}/functions?search=${encodeURIComponent(fn.name)}&per_page=100`,
      )
      expect(left.ok(), `GET /functions answered ${left.status()}`).toBeTruthy()
      expect((await left.json()).pagination.total, `${fn.name} is left in the library`).toBe(0)
    }
  }

  /** Store a valid schedule through the API, left on or saved off after it; its save folder. */
  async function storeSchedule(
    request: APIRequestContext,
    enabled: boolean,
    maxBackups = 5,
  ): Promise<string> {
    const folder = newSaveFolder()
    await writeSchedule(request, {
      enabled: true,
      cron: IDLE_CRON,
      save_directory: folder,
      max_backups: maxBackups,
    })
    if (!enabled) await writeSchedule(request, { enabled: false })
    return folder
  }

  test.beforeEach(async ({ request }) => {
    const paths = await stackPaths(request)
    configFile = paths.configFile
    dataFolder = paths.dataFolder
    await writeSchedule(request, { enabled: false })
  })

  test.afterEach(async ({ request }) => {
    try {
      await writeSchedule(request, { enabled: false })
    } finally {
      for (const folder of saveFolders.splice(0)) {
        fs.rmSync(folder, { recursive: true, force: true })
      }
      await deletePublishedFunctions(request)
    }
  })

  test('Schedule CRUD operations', async ({ page }) => {
    const saveFolder = newSaveFolder()

    // -----------------------------------------------------------------------
    // STEP 1: Ensure schedule is disabled
    // -----------------------------------------------------------------------
    await test.step('Ensure schedule starts disabled', async () => {
      const off = await page.request.put(SCHEDULE_URL, { data: { enabled: false } })
      expect(off.ok(), 'Turning the schedule off should succeed').toBeTruthy()

      const response = await page.request.get(SCHEDULE_URL)
      expect(response.ok()).toBeTruthy()
      const { data: schedule } = await response.json()
      expect(schedule.enabled, 'Schedule should be disabled initially').toBe(false)
    })

    // -----------------------------------------------------------------------
    // STEP 2: Update schedule
    // -----------------------------------------------------------------------
    await test.step('Update schedule', async () => {
      const response = await page.request.put(SCHEDULE_URL, {
        data: {
          enabled: true,
          cron: '0 3 * * *',
          entity_types: ['tests', 'environments'],
          max_backups: 7,
          save_directory: saveFolder,
          format: 'json',
          compression_method: 'bzip2',
          compression_level: 5,
          secrets: 'mask',
        },
      })
      expect(response.ok(), 'Schedule update should succeed').toBeTruthy()
      const { data: schedule } = await response.json()
      expect(schedule.enabled).toBe(true)
      expect(schedule.cron).toBe('0 3 * * *')
      expect(schedule.max_backups).toBe(7)
      expect(schedule.next_run, 'Next run should be calculated').toBeTruthy()
    })

    // -----------------------------------------------------------------------
    // STEP 3: Verify schedule persisted
    // -----------------------------------------------------------------------
    await test.step('Verify schedule persisted', async () => {
      const response = await page.request.get(SCHEDULE_URL)
      expect(response.ok()).toBeTruthy()
      const { data: schedule } = await response.json()
      expect(schedule.enabled).toBe(true)
      expect(schedule.cron).toBe('0 3 * * *')
      expect(schedule.entity_types).toEqual(['tests', 'environments'])
      expect(schedule.format).toBe('json')
    })

    // -----------------------------------------------------------------------
    // STEP 4: Verify schedule visible in UI
    // -----------------------------------------------------------------------
    await test.step('Schedule visible in UI', async () => {
      await page.goto('/settings/backup')
      await waitForSettingsPageLoad(page)

      // Enable toggle should be on
      const enableToggle = page.locator('[data-testid="periodic-enable-toggle"]')
      await expect(enableToggle, 'Enable toggle should be checked').toBeChecked()

      // Cron input should show saved value
      await expect(cronInput(page)).toHaveValue('0 3 * * *')

      // Cron description should show
      const cronDesc = page.locator('[data-testid="cron-description"]')
      await expect(cronDesc).toContainText('At 03:00')

      // Next run should be displayed
      const nextRunUtc = page.locator('[data-testid="next-run-utc"]')
      await expect(nextRunUtc, 'Next run UTC should be visible').toBeVisible()
    })

    // -----------------------------------------------------------------------
    // STEP 5: Turn the schedule off
    // -----------------------------------------------------------------------
    await test.step('Turn the schedule off', async () => {
      const response = await page.request.put(SCHEDULE_URL, { data: { enabled: false } })
      expect(response.ok(), 'Turning the schedule off should succeed').toBeTruthy()
      const { data: schedule } = await response.json()
      expect(schedule.enabled, 'Schedule should be disabled after the update').toBe(false)
    })

    // -----------------------------------------------------------------------
    // STEP 6: Verify the schedule is off with every setting back at its default
    // -----------------------------------------------------------------------
    await test.step('Verify schedule disabled', async () => {
      const response = await page.request.get(SCHEDULE_URL)
      expect(response.ok()).toBeTruthy()
      const { data: schedule } = await response.json()
      expect(schedule.enabled).toBe(false)
      expect(schedule, 'off keeps none of the settings the page hides').toMatchObject(
        SCHEDULE_DEFAULTS,
      )
    })
  })

  test('(1) Cancel and Save on the Periodic Backup heading line are disabled until something changes', async ({
    page,
  }) => {
    await openSchedule(page)
    await expectClean(page)

    await enableSwitch(page).click()
    await expect(cronInput(page)).toBeVisible()
    await expectDirty(page)
    await expect(
      periodicSection(page).getByRole('button', { name: /save/i }),
      'the heading line holds the only save button',
    ).toHaveCount(1)

    await headerButton(page, 'Cancel').click()
    await expect(enableSwitch(page)).not.toBeChecked()
    await expect(cronInput(page)).toHaveCount(0)
    await expectClean(page)
  })

  test('(2) switching on shows the defaults, not the values stored before it was saved off, and saves nothing until Save', async ({
    page,
  }) => {
    await storeSchedule(page.request, false, 7)
    const writes = countApiFetches(page, SCHEDULE_PATH, 'PUT')
    await openSchedule(page)
    await expect(enableSwitch(page)).not.toBeChecked()
    await expect(cronInput(page)).toHaveCount(0)

    await enableSwitch(page).click()
    await expect(enableSwitch(page)).toBeChecked()
    await expect(cronInput(page)).toHaveValue(SCHEDULE_DEFAULTS.cron)
    await expect(saveDirectoryInput(page)).toHaveValue(SCHEDULE_DEFAULTS.save_directory)
    await expect(maxBackupsInput(page)).toHaveValue(String(SCHEDULE_DEFAULTS.max_backups))
    await expectDirty(page)

    expect((await readSchedule(page.request)).enabled, 'the API still says off').toBe(false)
    expect(configSection(configFile, 'backup'), 'the config file still says off').toMatch(
      /^    enabled: false$/m,
    )
    expect(writes(), 'no PUT before Save').toBe(0)
  })

  test('(3) Save writes the cron and the folder into the config file and the page shows the next run', async ({
    page,
  }) => {
    const folder = newSaveFolder()
    const cron = '15 4 1 1 *'
    await openSchedule(page)
    await enableSwitch(page).click()
    await cronInput(page).fill(cron)
    await saveDirectoryInput(page).fill(folder)
    expect(await pressSave(page), 'PUT /api/backup/schedule from Save').toBe(200)
    await expectClean(page)

    const backup = configSection(configFile, 'backup')
    expect(backup).toMatch(/^  schedule:$/m)
    expect(backup).toMatch(/^    enabled: true$/m)
    expect(scheduleValue(configFile, 'cron')).toBe(cron)
    expect(scheduleValue(configFile, 'save_directory')).toBe(folder)

    const schedule = await readSchedule(page.request)
    expect(schedule).toMatchObject({ enabled: true, cron, save_directory: folder })
    const nextRun = schedule.next_run ?? ''
    expect(nextRun, 'the server computed the next run').toMatch(/^\d{4}-01-01T04:15:00/)
    await expect(periodicSection(page).locator('[data-testid="next-run-utc"]')).toContainText(
      `${nextRun.slice(0, 10)} 04:15`,
    )
  })

  test('(4) switched off and saved, the settings go back to their defaults; switched on again the fields show the defaults and Save needs a cron', async ({
    page,
  }) => {
    const folder = newSaveFolder()
    await writeSchedule(page.request, {
      enabled: true,
      cron: IDLE_CRON,
      entity_types: ['tests', 'environments'],
      max_backups: 7,
      save_directory: folder,
      format: 'json',
      compression_method: 'bzip2',
      compression_level: 5,
    })
    const stored = await readSchedule(page.request)
    await openSchedule(page)
    await expect(enableSwitch(page)).toBeChecked()
    await expect(cronInput(page)).toHaveValue(IDLE_CRON)

    await enableSwitch(page).click()
    await expect(cronInput(page)).toHaveCount(0)
    expect(await pressSave(page), 'PUT /api/backup/schedule from Save').toBe(200)
    await expectClean(page)

    const off = await readSchedule(page.request)
    expect(off, 'off keeps none of the settings the page hides').toMatchObject({
      enabled: false,
      ...SCHEDULE_DEFAULTS,
    })
    expect(
      { last_run: off.last_run, last_run_status: off.last_run_status },
      'the record of the last run is as it was',
    ).toEqual({ last_run: stored.last_run, last_run_status: stored.last_run_status })
    const backup = configSection(configFile, 'backup')
    expect(backup).toMatch(/^    enabled: false$/m)
    expect(backup, 'the cron is gone from the config file').not.toContain(IDLE_CRON)
    expect(backup, 'the folder is gone from the config file').not.toContain(folder)
    expect(scheduleValue(configFile, 'cron')).toBe(SCHEDULE_DEFAULTS.cron)
    expect(scheduleValue(configFile, 'save_directory')).toBe(SCHEDULE_DEFAULTS.save_directory)
    expect(scheduleValue(configFile, 'max_backups')).toBe(String(SCHEDULE_DEFAULTS.max_backups))
    expect(scheduleValue(configFile, 'format')).toBe(SCHEDULE_DEFAULTS.format)
    expect(scheduleValue(configFile, 'compression_method')).toBe(
      SCHEDULE_DEFAULTS.compression_method,
    )
    expect(scheduleValue(configFile, 'compression_level')).toBe(
      String(SCHEDULE_DEFAULTS.compression_level),
    )

    await test.step('switched on again, the fields show the defaults', async () => {
      await enableSwitch(page).click()
      await expect(cronInput(page)).toHaveValue(SCHEDULE_DEFAULTS.cron)
      await expect(saveDirectoryInput(page)).toHaveValue(SCHEDULE_DEFAULTS.save_directory)
      await expect(maxBackupsInput(page)).toHaveValue(String(SCHEDULE_DEFAULTS.max_backups))
      await expect(periodicSection(page).locator('[data-testid="periodic-format-select"]')).toHaveText(
        'YAML',
      )
      await expect(
        periodicSection(page).locator('[data-testid="periodic-compression-method-select"]'),
      ).toHaveText('Deflate')
      await expect(periodicSection(page).getByText('Compression Level: 6', { exact: true })).toBeVisible()
      for (const entityType of SCHEDULE_DEFAULTS.entity_types) {
        await expect(
          periodicSection(page).locator(`[data-testid="entity-checkbox-${entityType}"]`),
          `${entityType} is selected`,
        ).toBeChecked()
      }
    })

    await test.step('Save without a cron is refused and the schedule stays off', async () => {
      expect(await pressSave(page), 'PUT /api/backup/schedule from Save').toBe(400)
      await expectSaveRefused(page, CRON_REQUIRED)
      await expect(enableSwitch(page)).toBeChecked()
      await expectDirty(page)
      expect(await readSchedule(page.request)).toMatchObject({
        enabled: false,
        ...SCHEDULE_DEFAULTS,
      })
      expect(configSection(configFile, 'backup')).toMatch(/^    enabled: false$/m)
    })
  })

  test('(5) a Save Directory that is the data folder or inside it is refused', async ({ page }) => {
    const reason = `Save directory must be outside the data folder: ${dataFolder}`
    const fileBefore = readConfigText(configFile)
    await openSchedule(page)
    await enableSwitch(page).click()
    // A schedule that is off holds no cron (REQ-4.7.16), and the cron is checked before the folder.
    await cronInput(page).fill(IDLE_CRON)

    for (const refused of [dataFolder, path.join(dataFolder, 'scheduled-backups')]) {
      await test.step(`Save Directory ${refused}`, async () => {
        await saveDirectoryInput(page).fill(refused)
        expect(await pressSave(page), 'PUT /api/backup/schedule from Save').toBe(400)
        await expectSaveRefused(page, reason)
        await expect(saveDirectoryInput(page), 'the typed folder stays').toHaveValue(refused)
        await expect(enableSwitch(page)).toBeChecked()
        await expectDirty(page)
        expect(await readSchedule(page.request)).toMatchObject({
          enabled: false,
          ...SCHEDULE_DEFAULTS,
        })
        expect(readConfigText(configFile), 'the config file is unchanged').toBe(fileBefore)
      })
    }
  })

  test('(6) a schedule of every minute writes an archive, records the run, shows it and keeps only the newest archive', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const folder = newSaveFolder()
    const startedAt = Date.now()

    await test.step('Save the schedule: every minute, one archive kept', async () => {
      await openSchedule(page)
      await enableSwitch(page).click()
      await cronInput(page).fill(EVERY_MINUTE)
      await maxBackupsInput(page).fill('1')
      await saveDirectoryInput(page).fill(folder)
      expect(await pressSave(page), 'PUT /api/backup/schedule from Save').toBe(200)
      expect(scheduleValue(configFile, 'cron')).toBe(EVERY_MINUTE)
      expect(scheduleValue(configFile, 'save_directory')).toBe(folder)
      expect(configSection(configFile, 'backup')).toMatch(/^    max_backups: 1$/m)
    })

    const first = await test.step('(6) the first run writes an archive and the config file records it', async () => {
      await expect
        .poll(() => archivesIn(folder), { timeout: 90_000, message: 'first archive in the save folder' })
        .toHaveLength(1)
      await expect
        .poll(() => Date.parse(scheduleValue(configFile, 'last_run') ?? ''), {
          timeout: 20_000,
          message: 'last_run in the config file is the time of this run',
        })
        .toBeGreaterThanOrEqual(startedAt)
      expect(configSection(configFile, 'backup')).toMatch(/^    last_run_status: success$/m)
      return { archive: archivesIn(folder)[0], lastRun: scheduleValue(configFile, 'last_run') }
    })

    await test.step('reopened, the page shows the result and the time of the last run', async () => {
      await page.locator('[data-testid="settings-nav-about"]').click()
      await expect(page).toHaveURL(/\/settings\/about$/)
      await page.locator('[data-testid="settings-nav-backup"]').click()
      await expect(page).toHaveURL(/\/settings\/backup$/)
      const shown = await shownLocally(page, String(first.lastRun))
      await expect(periodicSection(page).locator('[data-testid="last-run-status"]')).toHaveText(
        new RegExp(`^Last run: success at ${shown} \\S+$`),
      )
    })

    await test.step('after the second run only the newest archive is kept', async () => {
      await expect
        .poll(() => archivesIn(folder).some((name) => name > first.archive), {
          timeout: 100_000,
          message: 'second archive in the save folder',
        })
        .toBe(true)
      await expect
        .poll(() => archivesIn(folder), { timeout: 20_000, message: 'one archive is kept' })
        .toHaveLength(1)
      const [kept] = archivesIn(folder)
      expect(kept > first.archive, `${kept} is newer than ${first.archive}`).toBe(true)
    })

    await test.step('switched off and saved, the cron is gone and the record of the last run stays', async () => {
      await enableSwitch(page).click()
      await expect(cronInput(page)).toHaveCount(0)
      expect(await pressSave(page), 'PUT /api/backup/schedule from Save').toBe(200)

      const off = await readSchedule(page.request)
      expect(off).toMatchObject({ enabled: false, cron: '', last_run_status: 'success' })
      const lastRun = Date.parse(off.last_run ?? '')
      expect(lastRun, 'last_run is still the time of a run of this test').toBeGreaterThanOrEqual(
        Date.parse(String(first.lastRun)),
      )
      expect(scheduleValue(configFile, 'cron')).toBe('')
      expect(Date.parse(scheduleValue(configFile, 'last_run') ?? ''), 'last_run in the config file').toBe(
        lastRun,
      )
      expect(configSection(configFile, 'backup')).toMatch(/^    last_run_status: success$/m)

      await enableSwitch(page).click()
      await expect(cronInput(page)).toHaveValue('')
      const shown = await shownLocally(page, String(off.last_run))
      await expect(periodicSection(page).locator('[data-testid="last-run-status"]')).toHaveText(
        new RegExp(`^Last run: success at ${shown} \\S+$`),
      )
    })
  })

  test('(7) DELETE /api/backup/schedule answers 405 and the schedule stays on', async ({ page }) => {
    await storeSchedule(page.request, true)
    const response = await page.request.delete(SCHEDULE_URL)
    expect(response.status()).toBe(405)
    expect((await readSchedule(page.request)).enabled).toBe(true)
  })

  test('(8) leaving with a staged change asks first: Cancel stays, Discard drops it, Save saves and leaves, a refused Save stays', async ({
    page,
  }) => {
    const folder = newSaveFolder()
    const about = page.locator('[data-testid="settings-nav-about"]')
    const backup = page.locator('[data-testid="settings-nav-backup"]')
    await openSchedule(page)
    await enableSwitch(page).click()

    await test.step('Cancel stays on Backup with the staged switch', async () => {
      await about.click()
      const dialog = await expectLeavePrompt(page)
      await dialog.locator('[data-testid="leave-unsaved-cancel"]').click()
      await expect(leaveDialog(page)).toHaveCount(0)
      await expect(page).toHaveURL(/\/settings\/backup$/)
      await expect(enableSwitch(page)).toBeChecked()
      await expectDirty(page)
    })

    await test.step('Discard leaves and the schedule is unchanged', async () => {
      await about.click()
      const dialog = await expectLeavePrompt(page)
      await dialog.locator('[data-testid="leave-unsaved-discard"]').click()
      await expect(page).toHaveURL(/\/settings\/about$/)
      await expect(leaveDialog(page)).toHaveCount(0)
      expect((await readSchedule(page.request)).enabled).toBe(false)
      expect(configSection(configFile, 'backup')).toMatch(/^    enabled: false$/m)

      await backup.click()
      await expect(enableSwitch(page)).not.toBeChecked()
      await expectClean(page)
    })

    await test.step('Save saves the schedule and leaves', async () => {
      await enableSwitch(page).click()
      // A schedule that is off holds no cron and no folder of its own (REQ-4.7.16).
      await cronInput(page).fill(IDLE_CRON)
      await saveDirectoryInput(page).fill(folder)
      await about.click()
      const dialog = await expectLeavePrompt(page)
      await dialog.locator('[data-testid="leave-unsaved-save"]').click()
      await expect(page).toHaveURL(/\/settings\/about$/)
      await expect(leaveDialog(page)).toHaveCount(0)
      expect(await readSchedule(page.request)).toMatchObject({
        enabled: true,
        cron: IDLE_CRON,
        save_directory: folder,
      })
      expect(configSection(configFile, 'backup')).toMatch(/^    enabled: true$/m)

      await backup.click()
      await expect(enableSwitch(page)).toBeChecked()
      await expectClean(page)
    })

    await test.step('a Save refused for the data folder stays on Backup with the typed folder', async () => {
      await saveDirectoryInput(page).fill(dataFolder)
      await about.click()
      const dialog = await expectLeavePrompt(page)
      await dialog.locator('[data-testid="leave-unsaved-save"]').click()
      await expect(leaveDialog(page)).toHaveCount(0)
      await expectSaveRefused(page, `Save directory must be outside the data folder: ${dataFolder}`)
      await expect(page).toHaveURL(/\/settings\/backup$/)
      await expect(saveDirectoryInput(page)).toHaveValue(dataFolder)
      await expectDirty(page)
      expect((await readSchedule(page.request)).save_directory).toBe(folder)
    })
  })

  test('(9) an emptied Max Backups to Keep box stays empty, takes the next number alone, and shows its number again when left empty', async ({
    page,
  }) => {
    // The schedule is on, so the Save of this test holds a cron (REQ-4.7.16).
    await storeSchedule(page.request, true, 5)
    await openSchedule(page)
    await expect(enableSwitch(page)).toBeChecked()
    await expect(maxBackupsInput(page)).toHaveValue('5')

    await maxBackupsInput(page).clear()
    await expect(maxBackupsInput(page), 'an emptied box stays empty').toHaveValue('')
    await maxBackupsInput(page).pressSequentially('8')
    await expect(maxBackupsInput(page), 'the typed number stands alone').toHaveValue('8')

    expect(await pressSave(page), 'PUT /api/backup/schedule from Save').toBe(200)
    expect(configSection(configFile, 'backup')).toMatch(/^    max_backups: 8$/m)
    expect((await readSchedule(page.request)).max_backups).toBe(8)
    await expectClean(page)

    await maxBackupsInput(page).clear()
    await maxBackupsInput(page).blur()
    await expect(maxBackupsInput(page), 'left empty, the box shows its number again').toHaveValue('8')
    await expectClean(page)
  })

  test('(10) BACKUP-1, REQ-4.7.20: a schedule switched on from its defaults writes the Functions part into its archive', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const folder = newSaveFolder()
    const token = randomUUID().slice(0, 8)
    const blockId = 'scheduled-log'
    const logLine = `scheduled-backup-${token}`
    const fn = await publishLibraryFunction(page.request, {
      name: `Scheduled Fn ${token}`,
      description: 'Function for the scheduled backup',
      workflow: {
        nodes: [logNode(blockId, 'Scheduled log', `'${logLine}'`)],
        edges: [startEdge(blockId)],
      },
    })
    publishedFunctions.push(fn)
    const startedAt = Date.now()

    await test.step('Switch the schedule on from its defaults and save it for every minute', async () => {
      await openSchedule(page)
      await enableSwitch(page).click()
      for (const entityType of SCHEDULE_DEFAULTS.entity_types) {
        await expect(
          periodicSection(page).locator(`[data-testid="entity-checkbox-${entityType}"]`),
          `${entityType} is selected`,
        ).toBeChecked()
      }
      await cronInput(page).fill(EVERY_MINUTE)
      await saveDirectoryInput(page).fill(folder)
      expect(await pressSave(page), 'PUT /api/backup/schedule from Save').toBe(200)
      const saved = await readSchedule(page.request)
      expect(saved).toMatchObject({ enabled: true, cron: EVERY_MINUTE, save_directory: folder })
      expect([...saved.entity_types].sort(), 'the saved schedule holds the nine entity types').toEqual(
        SCHEDULE_DEFAULTS.entity_types,
      )
    })

    const archive = await test.step('The first run writes an archive and the config file records it', async () => {
      await expect
        .poll(() => archivesIn(folder), { timeout: 90_000, message: 'first archive in the save folder' })
        .toHaveLength(1)
      // The run is recorded after the archive is written, so the file is whole by then.
      await expect
        .poll(() => Date.parse(scheduleValue(configFile, 'last_run') ?? ''), {
          timeout: 20_000,
          message: 'last_run in the config file is the time of this run',
        })
        .toBeGreaterThanOrEqual(startedAt)
      expect(configSection(configFile, 'backup')).toMatch(/^    last_run_status: success$/m)
      return fs.readFileSync(path.join(folder, archivesIn(folder)[0]))
    })

    await test.step('The archive holds the Functions part with the published Function', async () => {
      const manifest = JSON.parse(readZipEntryText(archive, 'manifest.json')) as {
        entity_counts: Record<string, number>
      }
      expect(
        Object.keys(manifest.entity_counts).sort(),
        'manifest.json counts the nine entity types, functions among them',
      ).toEqual(SCHEDULE_DEFAULTS.entity_types)
      expect(manifest.entity_counts.functions, 'the published Function is counted').toBeGreaterThanOrEqual(1)

      const member = `functions/${fn.name.replace(/ /g, '-')}.yaml`
      expect(zipEntryNames(archive), `the archive holds "${member}"`).toContain(member)
      const text = readZipEntryText(archive, member)
      expect(text, 'the member is the published Function').toContain(fn.functionId)
      expect(text).toContain(fn.name)
      expect(text, 'the member holds the body of the Function').toContain(logLine)
    })
  })
})

// ---------------------------------------------------------------------------
// Network settings in a backup
// ---------------------------------------------------------------------------

const BACKUP_HOST = {
  host: 'backup-e2e.lab.internal',
  port: 2222,
  key_type: 'ED25519',
  key: SSH_HOST_KEY,
} as const

/** The common name of the CA_CERT_PEM certificate, as the Network pages list it. */
const CA_NAME = 'WAVE Test CA'

interface TrustedHostRow {
  id: string
  host: string
  port: number
  key_type: string
  fingerprint: string
}

interface CertificateRow {
  id: string
  name: string
  type: string
}

async function readTrustedHosts(page: Page): Promise<TrustedHostRow[]> {
  const response = await page.request.get(`${API}/network/ssh-hosts`)
  expect(response.status(), 'GET /network/ssh-hosts').toBe(200)
  return ((await response.json()) as { hosts: TrustedHostRow[] }).hosts
}

async function readAdditionalCertificates(page: Page): Promise<CertificateRow[]> {
  const response = await page.request.get(`${API}/network/certificates`)
  expect(response.status(), 'GET /network/certificates').toBe(200)
  return ((await response.json()) as { additional: CertificateRow[] }).additional
}

function hostsOn(hosts: TrustedHostRow[], host: string, port: number): TrustedHostRow[] {
  return hosts.filter((row) => row.host === host && row.port === port)
}

function isNetworkWrite(path: string) {
  return (response: { url(): string; request(): { method(): string } }) =>
    response.request().method() === 'PATCH' && new URL(response.url()).pathname.endsWith(path)
}

async function saveNetworkPage(page: Page, path: string): Promise<void> {
  const save = page.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeEnabled()
  const [response] = await Promise.all([page.waitForResponse(isNetworkWrite(path)), save.click()])
  expect(response.status(), `PATCH ${path} from Save`).toBe(200)
  await expect(save, 'the saved page has nothing left to save').toBeDisabled()
}

test.describe('Backup & Restore E2E: network settings', () => {
  test.beforeEach(async () => {
    await resetNetworkSettings(API)
  })

  test.afterEach(async () => {
    await resetNetworkSettings(API)
  })

  test('SSH Hosts and Additional Certificates come back from a backup', async ({ page }) => {
    const saved = await test.step('Trust one more host and one certificate', async () => {
      const hostsReply = await page.request.patch(`${API}/network/ssh-hosts`, {
        data: { add: [BACKUP_HOST] },
      })
      expect(hostsReply.status(), await hostsReply.text()).toBe(200)
      const certReply = await page.request.patch(`${API}/network/certificates`, {
        data: { add: [CA_CERT_PEM] },
      })
      expect(certReply.status(), await certReply.text()).toBe(200)

      const hosts = await readTrustedHosts(page)
      expect(hosts, 'the stack hosts plus the added one').toHaveLength(STACK_TRUSTED_HOSTS.length + 1)
      const [host] = hostsOn(hosts, BACKUP_HOST.host, BACKUP_HOST.port)
      expect(host?.key_type).toBe('ED25519')
      const certificates = await readAdditionalCertificates(page)
      expect(certificates.map((row) => row.name)).toEqual([CA_NAME])
      return { host, certificate: certificates[0], hostCount: hosts.length }
    })

    const backupBuffer = await test.step('Create the backup on the Backup page', async () => {
      await page.goto('/settings/backup')
      await waitForSettingsPageLoad(page)
      const create = page.locator('[data-testid="create-backup-section"]')
      for (const label of ['SSH Hosts', 'Additional Certificates']) {
        const checkbox = create.getByRole('checkbox', { name: label, exact: true })
        await checkbox.click()
        await expect(checkbox).toBeChecked()
      }
      await expect(create.getByRole('checkbox', { checked: true })).toHaveCount(2)

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        create.getByRole('button', { name: 'Create & Download' }).click(),
      ])
      const buffer = fs.readFileSync((await download.path()) as string)
      const manifest = JSON.parse(readZipEntryText(buffer, 'manifest.json')) as {
        entity_counts: Record<string, number>
      }
      expect(manifest.entity_counts, 'the archive holds exactly the two selected types').toEqual({
        ssh_hosts: saved.hostCount,
        certificates: 1,
      })
      return buffer
    })

    await test.step('Remove the host on the SSH Hosts page (trash + Save)', async () => {
      await page.goto('/settings/network/ssh-hosts')
      const table = page.locator('[data-testid="trusted-hosts-table"]')
      await expect(table.getByRole('row').filter({ hasText: BACKUP_HOST.host })).toHaveCount(1)
      await table.getByRole('button', { name: `Remove ${BACKUP_HOST.host}`, exact: true }).click()
      await expect(table.getByRole('row').filter({ hasText: BACKUP_HOST.host })).toHaveCount(0)
      await saveNetworkPage(page, '/network/ssh-hosts')
      const hosts = await readTrustedHosts(page)
      expect(hostsOn(hosts, BACKUP_HOST.host, BACKUP_HOST.port)).toHaveLength(0)
      expect(hosts).toHaveLength(saved.hostCount - 1)
    })

    await test.step('Remove the certificate on the Certificates page (trash + Save)', async () => {
      await page.goto('/settings/network/certificates')
      const table = page.locator('[data-testid="additional-certificates-table"]')
      await expect(table.getByRole('row').filter({ hasText: CA_NAME })).toHaveCount(1)
      await table.getByRole('button', { name: `Remove ${CA_NAME}`, exact: true }).click()
      await expect(table.getByRole('row').filter({ hasText: CA_NAME })).toHaveCount(0)
      await saveNetworkPage(page, '/network/certificates')
      expect(await readAdditionalCertificates(page)).toEqual([])
    })

    await test.step('Restore the backup on the Backup page', async () => {
      await page.goto('/settings/backup')
      await waitForSettingsPageLoad(page)
      await page.locator('[data-testid="upload-input"]').setInputFiles({
        name: 'wave-backup-network.zip',
        mimeType: 'application/zip',
        buffer: backupBuffer,
      })
      await expect(page.locator('[data-testid="validation-preview"]')).toBeVisible({ timeout: 10_000 })

      // Cells: checkbox, type, total, OK, conflicts, fixable, errors.
      await expect(page.locator('[data-testid="entity-row-ssh_hosts"] td')).toHaveText([
        '',
        'SSH Hosts',
        String(saved.hostCount),
        '1',
        String(saved.hostCount - 1),
        '0',
        '0',
      ])
      await expect(page.locator('[data-testid="entity-row-certificates"] td')).toHaveText([
        '',
        'Additional Certificates',
        '1',
        '1',
        '0',
        '0',
        '0',
      ])
      for (const type of ['ssh_hosts', 'certificates']) {
        await expect(page.locator(`[data-testid="restore-checkbox-${type}"]`)).toBeChecked()
      }

      await page.locator('[data-testid="restore-button"]').click()
      const result = page.locator('[data-testid="restore-result"]')
      await expect(result).toBeVisible({ timeout: 10_000 })
      await expect(result.locator('h3')).toHaveText('Restore Complete')
      await expect(result).toContainText(
        `SSH Hosts: 1 imported, ${saved.hostCount - 1} skipped`,
      )
      await expect(result).toContainText('Additional Certificates: 1 imported, 0 skipped')
    })

    await test.step('Both are back through the API, the saved hosts not duplicated', async () => {
      const hosts = await readTrustedHosts(page)
      expect(hosts).toHaveLength(saved.hostCount)
      const restored = hostsOn(hosts, BACKUP_HOST.host, BACKUP_HOST.port)
      expect(restored).toHaveLength(1)
      expect(restored[0].key_type).toBe(saved.host.key_type)
      expect(restored[0].fingerprint).toBe(saved.host.fingerprint)
      for (const stackHost of STACK_TRUSTED_HOSTS) {
        expect(
          hostsOn(hosts, stackHost.host, stackHost.port),
          `${stackHost.host}:${stackHost.port} is kept once`,
        ).toHaveLength(1)
      }

      const certificates = await readAdditionalCertificates(page)
      expect(certificates).toHaveLength(1)
      expect(certificates[0].id).toBe(saved.certificate.id)
      expect(certificates[0].name).toBe(CA_NAME)
    })

    await test.step('Both are back on the Network pages', async () => {
      await page.goto('/settings/network/ssh-hosts')
      const hostsTable = page.locator('[data-testid="trusted-hosts-table"]')
      const hostRow = hostsTable.getByRole('row').filter({ hasText: BACKUP_HOST.host })
      await expect(hostRow).toHaveCount(1)
      await expect(hostRow).toContainText(String(BACKUP_HOST.port))

      await page.goto('/settings/network/certificates')
      const certTable = page.locator('[data-testid="additional-certificates-table"]')
      await expect(certTable.getByRole('row').filter({ hasText: CA_NAME })).toHaveCount(1)
    })
  })
})
