/**
 * V-STORAGE-DIRECTORY-FOLLOW: the Tests, Profiles and Environments lists
 * follow their storage directories, not a load-once cache.
 *
 * The storage directory is the record. For all three entities:
 *  - a record directory removed from disk while the backend is running stops
 *    appearing in the list, with no restart
 *  - a record directory that appears underneath is picked up
 *  - one record file that cannot be read is skipped, so the rest of the list
 *    still loads and the page still renders
 *
 * Plus, for the single-record reads:
 *  - opening a Profile whose file was deleted by hand answers not found
 *    instead of serving its old values from memory
 *  - the name of a deleted Profile or Environment is free again immediately
 *
 * DESTRUCTIVE: this spec deletes files under the running backend's data
 * directory. Every path it touches is built by `recordDir`, which refuses any
 * path that is not `<STORAGE_BASE_PATH>/<one of three entity dirs>/<a uuid
 * this spec created>`. STORAGE_BASE_PATH is already per-stack, so nothing here
 * can reach another shard's data.
 *
 * NOT asserted here, because these are known and unfixed: a record file
 * MODIFIED in place is still served stale (the check is presence-based),
 * saves are not atomic, and an unreadable record is invisible rather than
 * flagged.
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, STORAGE_BASE_PATH } from '../../helpers/config'
import { createValidTest, logNode, startEdge } from '../../helpers/fn-seed'

// --- the three surfaces ----------------------------------------------------

interface EntitySurface {
  /** Storage directory under STORAGE_BASE_PATH. */
  dirName: 'api_tests' | 'api_profiles' | 'api_environments'
  /** Record file inside each id directory - its presence is what the scan keys on. */
  fileName: string
  /** List page URL. */
  url: string
  /** Page shell, waited for before the search box is touched. */
  pageTestId: string
  /** One list row. */
  rowTestId: string
  /** The read-failure surface that must stay absent. */
  errorTestId: string
  create: (request: APIRequestContext, name: string) => Promise<string>
  remove: (request: APIRequestContext, id: string) => Promise<void>
}

const TESTS: EntitySurface = {
  dirName: 'api_tests',
  fileName: 'test.yaml',
  url: '/tests',
  pageTestId: 'tests-page',
  rowTestId: 'test-row',
  errorTestId: 'error-state',
  create: (request, name) =>
    createValidTest(request, {
      name,
      nodes: [logNode('sdf-log', 'Log', "'storage directory follow'")],
      edges: [startEdge('sdf-log')],
    }),
  remove: async (request, id) => {
    await request.delete(`${BACKEND_URL}/tests/${id}`).catch(() => {})
  },
}

const PROFILES: EntitySurface = {
  dirName: 'api_profiles',
  fileName: 'profile.yaml',
  url: '/profiles',
  pageTestId: 'profiles-page',
  rowTestId: 'profile-row',
  errorTestId: 'error-state',
  create: async (request, name) => createProfile(request, name),
  remove: async (request, id) => {
    await request.delete(`${BACKEND_URL}/profiles/${id}`).catch(() => {})
  },
}

const ENVIRONMENTS: EntitySurface = {
  dirName: 'api_environments',
  fileName: 'environment.yaml',
  url: '/settings/environments',
  pageTestId: 'settings-page',
  rowTestId: 'environment-row',
  errorTestId: 'environments-error',
  create: async (request, name) => createEnvironment(request, name),
  remove: async (request, id) => {
    await request.delete(`${BACKEND_URL}/environments/${id}`).catch(() => {})
  },
}

// --- seeding ---------------------------------------------------------------

async function createProfile(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/profiles`, {
    data: {
      name,
      type: 'custom',
      description: 'Storage directory follow',
      tags: [],
      config: {},
      environment_values: {},
    },
  })
  expect(
    response.ok(),
    `POST /profiles failed: ${response.status()} - ${await response.text()}`,
  ).toBeTruthy()
  const body = await response.json()
  return (body.data ?? body).id as string
}

async function createEnvironment(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/environments`, {
    data: { name, description: 'Storage directory follow', tags: [] },
  })
  expect(
    response.ok(),
    `POST /environments failed: ${response.status()} - ${await response.text()}`,
  ).toBeTruthy()
  const body = await response.json()
  return (body.data ?? body).id as string
}

// --- on-disk access, fenced ------------------------------------------------

const ENTITY_DIRS = ['api_tests', 'api_profiles', 'api_environments']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Every filesystem path this spec touches is built here and nowhere else. */
function recordDir(dirName: string, id: string): string {
  expect(STORAGE_BASE_PATH, 'STORAGE_BASE_PATH must be a rooted data dir').toMatch(/^\/\w/)
  expect(ENTITY_DIRS, 'only the three entity directories may be touched').toContain(dirName)
  expect(id, 'only a uuid this spec owns may be touched').toMatch(UUID_RE)
  return path.join(STORAGE_BASE_PATH, dirName, id)
}

/** Ids whose directory this spec planted or removed, cleaned up in afterAll. */
const owned: Array<{ surface: EntitySurface; id: string }> = []

function own(surface: EntitySurface, id: string): string {
  owned.push({ surface, id })
  return id
}

async function seed(
  request: APIRequestContext,
  surface: EntitySurface,
  name: string,
): Promise<string> {
  return own(surface, await surface.create(request, name))
}

/** Read the record file, then remove the whole id directory. */
function takeRecordAway(surface: EntitySurface, id: string): Buffer {
  const dir = recordDir(surface.dirName, id)
  const bytes = fs.readFileSync(path.join(dir, surface.fileName))
  fs.rmSync(dir, { recursive: true, force: true })
  expect(fs.existsSync(dir), `${dir} must be gone from disk`).toBe(false)
  return bytes
}

/** Put the same record back underneath, byte for byte. */
function putRecordBack(surface: EntitySurface, id: string, bytes: Buffer): void {
  const dir = recordDir(surface.dirName, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, surface.fileName), bytes)
}

/**
 * Plant a record file the cache has never seen that cannot be turned into a
 * record: a leading 0xff is not valid UTF-8, and the NUL byte is not valid
 * YAML either, so the file is unreadable whatever the process encoding is.
 */
function plantUnreadableRecord(surface: EntitySurface): string {
  const id = own(surface, randomUUID())
  const dir = recordDir(surface.dirName, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, surface.fileName), Buffer.from([0xff, 0xfe, 0x00, 0x41]))
  return id
}

function removeOwnedDir(surface: EntitySurface, id: string): void {
  fs.rmSync(recordDir(surface.dirName, id), { recursive: true, force: true })
}

// --- list reading ----------------------------------------------------------

/** Reload the list and narrow it to this run's records. */
async function openList(page: Page, surface: EntitySurface, nonce: string): Promise<void> {
  await page.goto(surface.url)
  await expect(page.locator(`[data-testid="${surface.pageTestId}"]`)).toBeVisible()
  const search = page.locator('[data-testid="search-input"] input').first()
  // These pages disable their filters when the list read failed, so an enabled
  // search box is the first sign that the page is not sitting on an error.
  await expect(search, 'the list read did not fail').toBeEnabled()
  await search.fill(nonce)
}

function row(page: Page, surface: EntitySurface, id: string) {
  return page.locator(`[data-testid="${surface.rowTestId}"][data-row-id="${id}"]`)
}

// --- teardown --------------------------------------------------------------

test.afterAll(async ({ request }) => {
  const failures: string[] = []
  // One entry must never stop the rest from being cleaned up.
  for (const entry of owned.reverse()) {
    try {
      await entry.surface.remove(request, entry.id)
      removeOwnedDir(entry.surface, entry.id)
    } catch (error) {
      failures.push(`${entry.surface.dirName}/${entry.id}: ${String(error)}`)
    }
  }
  owned.length = 0
  expect(failures, 'every seeded and planted record is cleaned up').toEqual([])
})

// --- the three lists -------------------------------------------------------

for (const [label, surface] of [
  ['Tests', TESTS],
  ['Profiles', PROFILES],
  ['Environments', ENVIRONMENTS],
] as Array<[string, EntitySurface]>) {
  test(`${label}: the list follows its storage directory with no restart`, async ({
    page,
    request,
  }) => {
    const nonce = `SDF${Date.now().toString(36)}${randomUUID().slice(0, 4)}`
    const keeperId = await seed(request, surface, `${nonce} Keeper`)
    const victimId = await seed(request, surface, `${nonce} Victim`)

    await test.step('both records are listed', async () => {
      await openList(page, surface, nonce)
      await expect(row(page, surface, keeperId)).toBeVisible()
      await expect(row(page, surface, victimId)).toBeVisible()
    })

    let victimBytes: Buffer = Buffer.alloc(0)

    await test.step('a directory deleted from disk stops being listed', async () => {
      victimBytes = takeRecordAway(surface, victimId)
      await openList(page, surface, nonce)
      // The keeper anchors the assertion: the list has answered and rendered.
      await expect(row(page, surface, keeperId)).toBeVisible()
      await expect(
        row(page, surface, victimId),
        'a record whose directory is gone must not be listed',
      ).toHaveCount(0)
      await expect(page.locator(`[data-testid="${surface.errorTestId}"]`)).toHaveCount(0)
    })

    await test.step('a directory that appears underneath is listed again', async () => {
      putRecordBack(surface, victimId, victimBytes)
      await openList(page, surface, nonce)
      await expect(
        row(page, surface, victimId),
        'a record put back underneath must be listed again',
      ).toBeVisible()
      await expect(row(page, surface, keeperId)).toBeVisible()
    })

    await test.step('one unreadable record file does not take the list down', async () => {
      plantUnreadableRecord(surface)
      await openList(page, surface, nonce)
      await expect(row(page, surface, keeperId)).toBeVisible()
      await expect(row(page, surface, victimId)).toBeVisible()
      await expect(
        page.locator(`[data-testid="${surface.errorTestId}"]`),
        'an unreadable record file must not make the page answer an error',
      ).toHaveCount(0)
    })
  })
}

// --- single-record reads ---------------------------------------------------

test('Opening a Profile whose file was deleted by hand says not found', async ({
  page,
  request,
}) => {
  const nonce = `SDF${Date.now().toString(36)}${randomUUID().slice(0, 4)}`
  const profileId = await seed(request, PROFILES, `${nonce} Opened`)

  await openList(page, PROFILES, nonce)
  const profileRow = row(page, PROFILES, profileId)
  await expect(profileRow).toBeVisible()

  // Delete the file underneath the rendered row, then open it from that row -
  // the list itself is never reloaded, so only the single-record read answers.
  takeRecordAway(PROFILES, profileId)
  await profileRow.locator('[data-testid="action-edit"]').click()

  await expect(
    page.locator('[data-testid="error-state-description"]'),
    'the read must report the profile as not found',
  ).toContainText(`Profile with ID '${profileId}' not found`)
  await expect(
    page.locator('[data-testid="modal-header"]'),
    'no editor may open on a profile that no longer exists',
  ).toHaveCount(0)

  const read = await request.get(`${BACKEND_URL}/profiles/${profileId}`)
  expect(read.status(), 'GET /profiles/{id} must answer 404').toBe(404)
})

test('The name of a deleted Profile or Environment is free again immediately', async ({
  request,
}) => {
  const nonce = `SDF${Date.now().toString(36)}${randomUUID().slice(0, 4)}`

  for (const surface of [PROFILES, ENVIRONMENTS]) {
    const name = `${nonce} ${surface.dirName} Reused`
    const firstId = await seed(request, surface, name)
    takeRecordAway(surface, firstId)

    // No restart, no product delete: the name must not still be taken.
    const secondId = await seed(request, surface, name)
    expect(secondId, 'the re-created record is a new record').not.toBe(firstId)
  }
})
