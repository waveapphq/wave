/**
 * V-BACKUP-FAILURE: a restore that fails says so
 *
 * Phase: functional-destructive.
 *
 * Design Decisions: LIST-26 (a failed action reports at the gesture that
 * started it), LIST-11 (a failure is never presented as a result).
 *
 * Pass Criteria:
 *  1. A backup file the server refuses is reported on screen, no preview
 *     appears, and there is nothing to restore from it; a good file afterwards
 *     clears the report.
 *  2. A restore that fails is stated on screen, no completion panel appears,
 *     the progress bar is not left behind, and the button comes back so the
 *     user can try again.
 *  3. Nothing is restored: the stored data is what it was.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { apiPathMatcher, failApiRoute } from '../../helpers/api-route'

const BACKUP_RESTORE_ROUTE = apiPathMatcher('/api/backup/restore')

// The reasons the server itself gives: the client reads them out of the WAVE
// error envelope, so what reaches the screen is the server's sentence.
const VALIDATE_FAILED = 'Invalid backup file: not a ZIP archive'
const RESTORE_FAILED = 'Restore refused by the E2E harness'

const NOT_A_BACKUP = Buffer.from('this is not a zip archive')

let backupZip: Buffer

async function createEnvironmentBackup(request: APIRequestContext): Promise<Buffer> {
  const response = await request.post(`${BACKEND_URL}/api/backup/create`, {
    data: {
      entity_types: ['environments'],
      format: 'yaml',
      compression_method: 'deflate',
      compression_level: 6,
      secrets: 'mask',
    },
  })
  expect(response.ok(), `seed backup could not be created: ${response.status()}`).toBeTruthy()
  return await response.body()
}

async function environmentCount(request: APIRequestContext): Promise<number> {
  const response = await request.get(`${BACKEND_URL}/environments/`)
  const body = await response.json()
  return body.pagination?.total ?? (body.data ?? []).length
}

async function openRestoreSection(page: Page): Promise<void> {
  await page.goto('/settings/backup')
  await expect(page.getByTestId('settings-page')).toBeVisible({ timeout: 20000 })
  await expect(page.getByTestId('restore-backup-section')).toBeVisible({ timeout: 20000 })
}

async function uploadBackup(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page
    .getByTestId('upload-input')
    .setInputFiles({ name, mimeType: 'application/zip', buffer })
}

test.describe('V-BACKUP-FAILURE: a failed restore is never silent', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
    backupZip = await createEnvironmentBackup(request)
  })

  test('BF1: a backup file the server refuses is reported, and nothing can be restored from it', async ({
    page,
  }) => {
    await openRestoreSection(page)
    await uploadBackup(page, 'not-a-backup.zip', NOT_A_BACKUP)

    const failure = page.getByTestId('restore-validate-error')
    await expect(failure).toBeVisible({ timeout: 20000 })
    await expect(failure).toHaveAttribute('role', 'alert')
    await expect(failure).toHaveText(VALIDATE_FAILED)

    await expect(
      page.getByTestId('validation-preview'),
      'a refused file must not produce a preview',
    ).toHaveCount(0)
    await expect(
      page.getByTestId('restore-button'),
      'a refused file must leave nothing to restore',
    ).toHaveCount(0)

    // The report belongs to the file that failed, not to the section.
    await uploadBackup(page, 'wave-backup.zip', backupZip)
    await expect(page.getByTestId('validation-preview')).toBeVisible({ timeout: 20000 })
    await expect(failure, 'a good file must clear the previous report').toHaveCount(0)
  })

  test('BF2: a restore that fails says so, and nothing is presented as restored', async ({
    page,
    request,
  }) => {
    const storedBefore = await environmentCount(request)
    await failApiRoute(page, BACKUP_RESTORE_ROUTE, { detail: RESTORE_FAILED }, 'POST')

    await openRestoreSection(page)
    await uploadBackup(page, 'wave-backup.zip', backupZip)
    await expect(page.getByTestId('validation-preview')).toBeVisible({ timeout: 20000 })

    const restore = page.getByTestId('restore-button')
    await expect(restore).toBeEnabled({ timeout: 20000 })
    await restore.click()

    const failure = page.getByTestId('restore-backup-error')
    await expect(failure).toBeVisible({ timeout: 20000 })
    await expect(failure).toHaveAttribute('role', 'alert')
    await expect(failure).toHaveText(RESTORE_FAILED)

    await expect(
      page.getByTestId('restore-result'),
      'a failed restore must not report completion',
    ).toHaveCount(0)
    await expect(
      page.getByTestId('restore-progress'),
      'a failed restore must not leave a progress bar behind',
    ).toHaveCount(0)
    await expect(restore, 'the user must be able to try again').toBeEnabled({ timeout: 20000 })

    expect(
      await environmentCount(request),
      'a failed restore must not change the stored data',
    ).toBe(storedBefore)
  })
})
