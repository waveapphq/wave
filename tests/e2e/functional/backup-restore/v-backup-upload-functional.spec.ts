/**
 * V-BACKUP-UP (functional): the Restore page sends the backup file once and lets it go.
 *
 * Design Decisions: BACKUP-5
 * REQ: REQ-5.2.4.9.6
 *
 * Phase: functional-destructive. No backup route is mocked: every request reaches the backend.
 * The spec resets the store before and after itself, puts the store back after each test and
 * drops every upload it saw the backend keep.
 *
 * The fixture, every name with a run token: an archive of two Environments and two Profiles in
 * which one Profile member has lost its type. One Environment stays in this WAVE, so the preview
 * counts one conflict and one fixable item and shows the conflict choice and the auto-repair
 * switch.
 *
 * Pass Criteria:
 * 1. V-BACKUP-UP-1: a file is picked, Profiles is unticked and ticked again, Rename is picked,
 *    auto-repair is switched on, Restore is pressed and the preview is read again. One
 *    POST /api/backup/uploads left the page. Each of the six POST /api/backup/validate and the
 *    one POST /api/backup/restore names that upload's ID with the choices on screen and carries
 *    no file part. The restore did what the choices said.
 * 2. V-BACKUP-UP-2: the kept upload is dropped through DELETE /api/backup/uploads/<id> after the
 *    first preview. The next change on the page is answered 404 once, the page sends the file
 *    again by itself, and the new preview shows with no error.
 * 3. V-BACKUP-UP-3: Clear sends DELETE /api/backup/uploads/<id> for the kept upload, and the
 *    backend no longer knows it.
 * 4. V-BACKUP-UP-4: a file the backend keeps but cannot read as a backup leaves the upload zone
 *    in place; picking another file sends DELETE /api/backup/uploads/<id> for the first one.
 * 5. V-BACKUP-UP-5: leaving the Backup page for another Settings section sends
 *    DELETE /api/backup/uploads/<id> for the kept upload.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/backup-restore/v-backup-upload-functional.spec.ts
 */

import { randomUUID } from 'node:crypto'
import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { apiPathMatcher, type ApiUrlMatcher } from '../../helpers/api-route'
import { BACKEND_URL } from '../../helpers/config'
import { exec } from '../../helpers/exec'
import { listZipEntries, readZipEntry } from '../../helpers/zip-reader'
import { buildZip, type ZipMember } from '../../helpers/zip-writer'

type Json = Record<string, any>
type Answer = Awaited<ReturnType<Page['waitForResponse']>>

const RUN = randomUUID().slice(0, 8)

const STAYS_ENV_NAME = `up-stays-env ${RUN}`
const BACK_ENV_NAME = `up-back-env ${RUN}`
const TYPED_PROFILE_NAME = `up-typed-profile ${RUN}`
const NO_TYPE_PROFILE_NAME = `up-notype-profile ${RUN}`
const ARCHIVE_NAME = `upload-once-${RUN}.zip`
const REFUSED_NAME = `not-a-backup-${RUN}.zip`

const BOTH_PARTS = 'environments,profiles'
const NOT_A_ZIP = 'Invalid backup file: not a ZIP archive'
const UPLOAD_UNKNOWN = { code: 'BACKUP_UPLOAD_NOT_FOUND', message: 'Backup upload not found' }

const UPLOADS_ROUTE = apiPathMatcher('/api/backup/uploads')
const VALIDATE_ROUTE = apiPathMatcher('/api/backup/validate')
const RESTORE_ROUTE = apiPathMatcher('/api/backup/restore')
const UPLOAD_ID = /^[0-9a-f]{32}$/
const UPLOAD_DROP_PATH = /^(?:\/api)?\/api\/backup\/uploads\/([0-9a-f]{32})$/

function isUploadDrop(url: URL): boolean {
  return UPLOAD_DROP_PATH.test(url.pathname)
}

interface Fixture {
  archive: Buffer
  staysEnv: string
  backEnv: string
  noTypeProfile: string
}

/** The fields of one multipart form the page sent to the validate or the restore route. */
interface SentForm {
  /** True when the body holds a file part. */
  carriesFile: boolean
  uploadId: string | null
  entityTypes: string | null
  conflictResolution: string | null
  autoRepair: string | null
}

/** What the page sent to the backup routes, in the order it left the page. */
interface BackupTraffic {
  /** The POST /api/backup/uploads requests. */
  uploads: number
  validates: SentForm[]
  /** The status of each validate answer, in the order they landed. */
  validateStatuses: number[]
  restores: SentForm[]
  /** The upload ID of each DELETE /api/backup/uploads/<id>. */
  drops: string[]
}

function readForm(body: string | null): SentForm {
  const text = body ?? ''
  const field = (name: string) =>
    new RegExp(`name="${name}"\\r?\\n\\r?\\n([^\\r\\n]*)`).exec(text)?.[1] ?? null
  return {
    carriesFile: /name="file"|filename=/.test(text),
    uploadId: field('upload_id'),
    entityTypes: field('entity_types'),
    conflictResolution: field('conflict_resolution'),
    autoRepair: field('auto_repair'),
  }
}

function watchBackupTraffic(page: Page): BackupTraffic {
  const traffic: BackupTraffic = { uploads: 0, validates: [], validateStatuses: [], restores: [], drops: [] }
  page.on('request', (request) => {
    const url = new URL(request.url())
    const dropped = request.method() === 'DELETE' ? UPLOAD_DROP_PATH.exec(url.pathname) : null
    if (dropped) traffic.drops.push(dropped[1])
    if (request.method() !== 'POST') return
    if (UPLOADS_ROUTE(url)) traffic.uploads += 1
    if (VALIDATE_ROUTE(url)) traffic.validates.push(readForm(request.postData()))
    if (RESTORE_ROUTE(url)) traffic.restores.push(readForm(request.postData()))
  })
  page.on('response', (response) => {
    if (response.request().method() !== 'POST') return
    if (VALIDATE_ROUTE(new URL(response.url()))) traffic.validateStatuses.push(response.status())
  })
  return traffic
}

/** The form of a preview or a restore of a kept file: its upload ID, the choices, no file part. */
function choices(
  uploadId: string,
  entityTypes: string | null,
  conflictResolution: string,
  autoRepair: string,
): SentForm {
  return { carriesFile: false, uploadId, entityTypes, conflictResolution, autoRepair }
}

/** The next answer of one method on one backup route, with one status when a status is given. */
function nextAnswer(page: Page, method: string, route: ApiUrlMatcher, status?: number): Promise<Answer> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      route(new URL(response.url())) &&
      (status === undefined || response.status() === status),
    { timeout: 60_000 },
  )
}

async function create(request: APIRequestContext, path: string, data: Json): Promise<string> {
  const response = await request.post(`${BACKEND_URL}${path}`, { data })
  const body = await response.json().catch(() => null)
  expect(response.status(), `POST ${path} answered ${JSON.stringify(body)}`).toBe(201)
  return body.data.id as string
}

async function remove(request: APIRequestContext, path: string): Promise<void> {
  const response = await request.delete(`${BACKEND_URL}${path}`)
  expect(response.status(), `DELETE ${path} answered`).toBe(204)
}

async function read(request: APIRequestContext, path: string): Promise<Json> {
  const response = await request.get(`${BACKEND_URL}${path}`)
  const body = await response.json().catch(() => null)
  expect(response.status(), `GET ${path} answered ${JSON.stringify(body)}`).toBe(200)
  return body.data as Json
}

/** The stored items of one part whose name holds the run token. */
async function itemsOfRun(
  request: APIRequestContext,
  part: 'environments' | 'profiles',
): Promise<Array<{ id: string; name: string }>> {
  const response = await request.get(
    `${BACKEND_URL}/${part}?search=${encodeURIComponent(RUN)}&page=1&per_page=100`,
  )
  expect(response.status(), `GET /${part} answered`).toBe(200)
  const body = await response.json()
  const rows = (Array.isArray(body) ? body : body.data) as Array<{ id: string; name: string }>
  return rows.filter((row) => row.name.includes(RUN))
}

/** Two Environments and two Profiles in a JSON backup, one Profile member without its type. */
async function seedFixture(request: APIRequestContext): Promise<Fixture> {
  const staysEnv = await create(request, '/environments', {
    name: STAYS_ENV_NAME,
    description: 'Stays in this WAVE',
  })
  const backEnv = await create(request, '/environments', {
    name: BACK_ENV_NAME,
    description: 'Only in the backup',
  })
  const typedProfile = await create(request, '/profiles', { name: TYPED_PROFILE_NAME, type: 'custom', tags: [] })
  const noTypeProfile = await create(request, '/profiles', {
    name: NO_TYPE_PROFILE_NAME,
    type: 'custom',
    tags: [],
  })

  const backup = await request.post(`${BACKEND_URL}/api/backup/create`, {
    data: {
      entity_types: ['environments', 'profiles'],
      format: 'json',
      compression_method: 'deflate',
      compression_level: 6,
      secrets: 'mask',
    },
  })
  expect(backup.status(), 'POST /api/backup/create answered').toBe(200)
  const original = await backup.body()

  const changed: string[] = []
  const members: ZipMember[] = listZipEntries(original).map((entry) => {
    const data = readZipEntry(original, entry.name)
    if (!entry.name.startsWith('profiles/')) return { name: entry.name, data }
    const document = JSON.parse(data.toString('utf-8')) as Json
    if (document.id !== noTypeProfile) return { name: entry.name, data }
    delete document.type
    changed.push(entry.name)
    return { name: entry.name, data: Buffer.from(JSON.stringify(document, null, 2), 'utf-8') }
  })
  expect(changed, 'one Profile member lost its type').toHaveLength(1)

  await remove(request, `/environments/${backEnv}`)
  await remove(request, `/profiles/${typedProfile}`)
  await remove(request, `/profiles/${noTypeProfile}`)
  return { archive: buildZip(members), staysEnv, backEnv, noTypeProfile }
}

/** Puts the store back as the fixture left it: the one Environment that stays, no Profile. */
async function restoreFixtureState(request: APIRequestContext, staysEnv: string): Promise<void> {
  for (const environment of await itemsOfRun(request, 'environments')) {
    if (environment.id !== staysEnv) await remove(request, `/environments/${environment.id}`)
  }
  for (const profile of await itemsOfRun(request, 'profiles')) {
    await remove(request, `/profiles/${profile.id}`)
  }
}

/** A preview read through REST by upload ID: the status and the error the backend answers. */
async function previewByUploadId(
  request: APIRequestContext,
  uploadId: string,
): Promise<{ status: number; error: Json | undefined }> {
  const response = await request.post(`${BACKEND_URL}/api/backup/validate`, {
    multipart: { upload_id: uploadId },
  })
  const body = (await response.json().catch(() => null)) as Json | null
  return { status: response.status(), error: body?.error }
}

async function expectKept(request: APIRequestContext, uploadId: string): Promise<void> {
  const answer = await previewByUploadId(request, uploadId)
  expect(answer.status, `upload ${uploadId} is kept: ${JSON.stringify(answer.error)}`).toBe(200)
}

async function expectUnknown(request: APIRequestContext, uploadId: string): Promise<void> {
  const answer = await previewByUploadId(request, uploadId)
  expect(answer.status, `upload ${uploadId} is not known any more`).toBe(404)
  expect(answer.error).toMatchObject(UPLOAD_UNKNOWN)
}

async function openBackupPage(page: Page): Promise<void> {
  await page.goto('/settings/backup')
  await expect(page.locator('[data-testid="settings-page"][aria-busy="false"]')).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByTestId('restore-backup-section')).toBeVisible()
}

async function uploadIdOf(kept: Answer): Promise<string> {
  expect(kept.status(), 'POST /api/backup/uploads answered').toBe(200)
  const uploadId = (await kept.json()).data.upload_id as string
  expect(uploadId, 'an upload ID is 32 lowercase hex characters').toMatch(UPLOAD_ID)
  return uploadId
}

function restoreButton(page: Page): Locator {
  return page.getByTestId('restore-button')
}

test.describe('V-BACKUP-UP: the Restore page sends the backup file once and lets it go', () => {
  let fixture: Fixture | undefined
  /** The uploads a test saw the backend keep; dropped again after the test. */
  const keptUploads: string[] = []

  function seeded(): Fixture {
    if (!fixture) throw new Error('the fixture was not seeded')
    return fixture
  }

  /** Picks a file and waits for its upload and its first preview; the upload ID. */
  async function pickFile(page: Page, name: string, content: Buffer, previewStatus: number): Promise<string> {
    const [kept, preview] = await Promise.all([
      nextAnswer(page, 'POST', UPLOADS_ROUTE),
      nextAnswer(page, 'POST', VALIDATE_ROUTE),
      page.getByTestId('upload-input').setInputFiles({ name, mimeType: 'application/zip', buffer: content }),
    ])
    const uploadId = await uploadIdOf(kept)
    keptUploads.push(uploadId)
    expect(preview.status(), 'the first preview of the file answered').toBe(previewStatus)
    return uploadId
  }

  /** Picks the fixture archive; the preview counts one conflict and one fixable item. */
  async function pickArchive(page: Page): Promise<string> {
    const uploadId = await pickFile(page, ARCHIVE_NAME, seeded().archive, 200)
    await expect(page.getByTestId('validation-preview')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('restore-validate-error')).toHaveCount(0)
    await expect(page.getByTestId('conflict-resolution')).toBeVisible()
    await expect(page.getByTestId('auto-repair-toggle')).toBeVisible()
    await expect(restoreButton(page)).toHaveText('Restore 3 entities')
    await expect(restoreButton(page)).toBeEnabled()
    return uploadId
  }

  /** Makes one change on the page and waits for the preview read it starts. */
  async function rereadAfter(page: Page, change: () => Promise<void>): Promise<void> {
    const [reread] = await Promise.all([nextAnswer(page, 'POST', VALIDATE_ROUTE), change()])
    expect(reread.status(), 'the newer preview is read').toBe(200)
    await expect(restoreButton(page)).toBeEnabled()
  }

  /** Runs one action and waits for the DELETE of a kept upload it sends; the upload ID dropped. */
  async function dropSentBy(page: Page, action: () => Promise<unknown>): Promise<string> {
    const [dropped] = await Promise.all([nextAnswer(page, 'DELETE', isUploadDrop), action()])
    expect(dropped.status(), 'DELETE /api/backup/uploads/<id> answered').toBe(204)
    return new URL(dropped.url()).pathname.split('/').pop() as string
  }

  test.beforeAll(async ({ request }) => {
    exec('./tests/e2e/scripts/reset.sh')
    fixture = await seedFixture(request)
  })

  test.afterEach(async ({ request }) => {
    for (const uploadId of keptUploads.splice(0)) {
      await request.delete(`${BACKEND_URL}/api/backup/uploads/${uploadId}`)
    }
    if (fixture) await restoreFixtureState(request, fixture.staysEnv)
  })

  test.afterAll(() => {
    exec('./tests/e2e/scripts/reset.sh')
  })

  test('V-BACKUP-UP-1: a picked file is sent once, and every preview and the restore name its upload ID (BACKUP-5)', async ({
    page,
    request,
  }) => {
    const traffic = watchBackupTraffic(page)
    const profilesBox = page.getByTestId('restore-checkbox-profiles')
    const rename = page.getByTestId('cr-rename')
    const autoRepair = page.getByTestId('auto-repair-toggle')
    await openBackupPage(page)

    const uploadId = await test.step('Pick the archive: one upload, then the first preview', async () => {
      const kept = await pickArchive(page)
      expect(traffic.uploads, 'the file was sent').toBe(1)
      return kept
    })

    await test.step('Untick Profiles, then tick it again', async () => {
      await rereadAfter(page, () => profilesBox.click())
      await expect(profilesBox).not.toBeChecked()
      await expect(restoreButton(page)).toHaveText('Restore 2 entities')
      await rereadAfter(page, () => profilesBox.click())
      await expect(profilesBox).toBeChecked()
      await expect(restoreButton(page)).toHaveText('Restore 3 entities')
    })

    await test.step('Pick Rename', async () => {
      await rereadAfter(page, () => rename.click())
      await expect(rename).toBeChecked()
    })

    await test.step('Switch auto-repair on', async () => {
      await rereadAfter(page, () => autoRepair.click())
      await expect(autoRepair).toBeChecked()
      await expect(restoreButton(page)).toHaveText('Restore 4 entities')
    })

    await test.step('Restore: the result shows and the preview is read again', async () => {
      const [restored, reread] = await Promise.all([
        nextAnswer(page, 'POST', RESTORE_ROUTE),
        nextAnswer(page, 'POST', VALIDATE_ROUTE),
        restoreButton(page).click(),
      ])
      expect(restored.status(), 'the restore answers a result').toBe(200)
      expect(reread.status(), 'the preview is read again after the restore').toBe(200)
      await expect(page.getByTestId('restore-backup-error')).toHaveCount(0)
      await expect(page.getByTestId('restore-validate-error')).toHaveCount(0)
      await expect(
        page.getByTestId('restore-result').locator('[data-testid^="restore-result-line-"]'),
      ).toHaveText(['Environments: 2 imported, 0 skipped', 'Profiles: 2 imported, 0 skipped'], {
        useInnerText: true,
      })
      const after = (await reread.json()).data.entity_summary as Json
      expect(after.environments, 'the preview read by upload ID shows this WAVE after the restore').toMatchObject({
        total: 2,
        ok: 0,
        conflicts: 2,
      })
      await expect(restoreButton(page)).toBeEnabled()
    })

    await test.step('One upload left the page; every preview and the restore name its ID and carry no file', async () => {
      expect(traffic.uploads, 'POST /api/backup/uploads requests').toBe(1)
      expect(traffic.validates, 'POST /api/backup/validate requests').toEqual([
        choices(uploadId, null, 'skip', 'false'),
        choices(uploadId, 'environments', 'skip', 'false'),
        choices(uploadId, BOTH_PARTS, 'skip', 'false'),
        choices(uploadId, BOTH_PARTS, 'rename', 'false'),
        choices(uploadId, BOTH_PARTS, 'rename', 'true'),
        choices(uploadId, BOTH_PARTS, 'rename', 'true'),
      ])
      expect(traffic.restores, 'POST /api/backup/restore requests').toEqual([
        choices(uploadId, BOTH_PARTS, 'rename', 'true'),
      ])
      expect(traffic.validateStatuses, 'every preview was answered from the kept upload').toEqual(
        Array<number>(6).fill(200),
      )
      expect(traffic.drops, 'the upload is kept while the page shows the file').toEqual([])
    })

    await test.step('The restore did what the choices said: Rename and auto-repair', async () => {
      expect((await read(request, `/environments/${seeded().backEnv}`)).name).toBe(BACK_ENV_NAME)
      const environments = (await itemsOfRun(request, 'environments')).map((row) => row.name).sort()
      expect(environments, 'the Environment that was here has a renamed copy beside it').toEqual(
        [BACK_ENV_NAME, STAYS_ENV_NAME, `${STAYS_ENV_NAME} (2)`].sort(),
      )
      const repaired = await read(request, `/profiles/${seeded().noTypeProfile}`)
      expect(repaired.name).toBe(NO_TYPE_PROFILE_NAME)
      expect(repaired.type, 'auto-repair wrote the Profile without a type as custom').toBe('custom')
    })
  })

  test('V-BACKUP-UP-2: an upload the backend no longer knows is sent again by the page, and the new preview shows with no error (BACKUP-5)', async ({
    page,
    request,
  }) => {
    const traffic = watchBackupTraffic(page)
    const profilesBox = page.getByTestId('restore-checkbox-profiles')
    await openBackupPage(page)
    const firstId = await pickArchive(page)

    await test.step('Drop the kept upload through REST: the backend no longer knows it', async () => {
      await remove(request, `/api/backup/uploads/${firstId}`)
      await expectUnknown(request, firstId)
    })

    const secondId = await test.step('Untick Profiles: the page sends the file again', async () => {
      const [kept, preview] = await Promise.all([
        nextAnswer(page, 'POST', UPLOADS_ROUTE),
        nextAnswer(page, 'POST', VALIDATE_ROUTE, 200),
        profilesBox.click(),
      ])
      const uploadId = await uploadIdOf(kept)
      keptUploads.push(uploadId)
      expect(uploadId, 'the file is kept under a new ID').not.toBe(firstId)
      const summary = (await preview.json()).data.entity_summary as Json
      expect(Object.keys(summary), 'the new preview holds both parts').toEqual(['environments', 'profiles'])
      return uploadId
    })

    await test.step('The new preview shows and no error does', async () => {
      await expect(restoreButton(page)).toBeEnabled()
      await expect(restoreButton(page)).toHaveText('Restore 2 entities')
      await expect(profilesBox).not.toBeChecked()
      await expect(page.getByTestId('validation-preview')).toContainText(ARCHIVE_NAME)
      await expect(page.getByTestId('restore-validate-error')).toHaveCount(0)
      await expect(page.getByTestId('restore-backup-error')).toHaveCount(0)
    })

    await test.step('The file left the page twice; the refused read was repeated once under the new ID', async () => {
      expect(traffic.uploads, 'POST /api/backup/uploads requests').toBe(2)
      expect(traffic.validates).toEqual([
        choices(firstId, null, 'skip', 'false'),
        choices(firstId, 'environments', 'skip', 'false'),
        choices(secondId, 'environments', 'skip', 'false'),
      ])
      expect(traffic.validateStatuses).toEqual([200, 404, 200])
      await expectKept(request, secondId)
    })
  })

  test('V-BACKUP-UP-3: Clear drops the kept upload (BACKUP-5)', async ({ page, request }) => {
    const traffic = watchBackupTraffic(page)
    await openBackupPage(page)
    const uploadId = await pickArchive(page)
    await expectKept(request, uploadId)

    const dropped = await dropSentBy(page, () => page.getByTestId('clear-file-button').click())

    expect(dropped, 'Clear drops the upload of the file it lets go').toBe(uploadId)
    await expect(page.getByTestId('upload-zone')).toBeVisible()
    await expect(page.getByTestId('validation-preview')).toHaveCount(0)
    expect(traffic.drops).toEqual([uploadId])
    await expectUnknown(request, uploadId)
  })

  test('V-BACKUP-UP-4: picking another file drops the upload kept for the first one (BACKUP-5)', async ({
    page,
    request,
  }) => {
    const traffic = watchBackupTraffic(page)
    await openBackupPage(page)

    const refusedId = await test.step('Pick a file that is no backup: it is kept, its preview is refused, the upload zone stays', async () => {
      const uploadId = await pickFile(page, REFUSED_NAME, Buffer.from('this is not a zip archive'), 400)
      await expect(page.getByTestId('restore-validate-error')).toHaveText(NOT_A_ZIP)
      await expect(page.getByTestId('upload-zone')).toContainText(REFUSED_NAME)
      const stillKept = await previewByUploadId(request, uploadId)
      expect(stillKept.status, 'the refused file is kept until the page lets it go').toBe(400)
      expect(stillKept.error?.message).toBe(NOT_A_ZIP)
      expect(traffic.drops).toEqual([])
      return uploadId
    })

    await test.step('Pick the archive: the first upload is dropped and the preview of the archive shows', async () => {
      let archiveId = ''
      const dropped = await dropSentBy(page, async () => {
        archiveId = await pickArchive(page)
      })
      expect(dropped, 'the upload of the file that was replaced is dropped').toBe(refusedId)
      expect(archiveId).not.toBe(refusedId)
      await expect(page.getByTestId('validation-preview')).toContainText(ARCHIVE_NAME)
      expect(traffic.uploads, 'each picked file was sent once').toBe(2)
      expect(traffic.drops).toEqual([refusedId])
      await expectUnknown(request, refusedId)
      await expectKept(request, archiveId)
    })
  })

  test('V-BACKUP-UP-5: leaving the Backup page drops the kept upload (BACKUP-5)', async ({ page, request }) => {
    const traffic = watchBackupTraffic(page)
    await openBackupPage(page)
    const uploadId = await pickArchive(page)
    await expectKept(request, uploadId)

    const dropped = await dropSentBy(page, () => page.getByTestId('settings-nav-about').click())

    expect(dropped, 'leaving drops the upload of the file the page held').toBe(uploadId)
    await expect(page).toHaveURL(/\/settings\/about$/)
    await expect(page.getByTestId('restore-backup-section')).toHaveCount(0)
    expect(traffic.drops).toEqual([uploadId])
    await expectUnknown(request, uploadId)
  })
})
