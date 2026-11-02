/**
 * V-NUMBER-SETTINGS-BACKUP: a backup holding a profile whose Port is 70000 lists it as blocked with the save's message
 * Wireframe: N/A (the Restore from Backup preview and result keep their look)
 * Design Decisions: BACKUP-5, BACKUP-9
 * REQ: REQ-3.1.3.14, REQ-4.7.20
 *
 * A Database profile is created with Port 5432 and backed up with the Environments and Profiles parts; its member
 * in the archive is rewritten by hand to Port 70000 (the save refuses that, so no real backup can hold it) and the
 * profile is deleted. The archive is restored with the default Skip choice, so every other member is already here
 * and nothing else is written. The profile is deleted afterwards whatever happens.
 *
 * Pass Criteria:
 * 1. The restore preview lists the profile under Profiles as fatal with
 *    `Cannot be restored. Configuration validation failed at 'config.port': must be between 1 and 65535`
 *    (the preview answer holds the same reason).
 * 2. The restore result lists it as fatal with
 *    `Not restored. Configuration validation failed at 'config.port': must be between 1 and 65535`, and no profile
 *    of that name is stored.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { apiPathMatcher, type ApiUrlMatcher } from '../../helpers/api-route'
import {
  BACKEND_URL,
  SQL_STACK_DATABASE,
  SQL_STACK_PASSWORD,
  SQL_STACK_USER,
  SQL_TARGET_HOST,
} from '../../helpers/config'
import { runToken } from '../../helpers/element-types'
import { resolveEnvironmentId } from '../../helpers/k8s-run'
import { listZipEntries, readZipEntry } from '../../helpers/zip-reader'
import { buildZip, type ZipMember } from '../../helpers/zip-writer'

type Json = Record<string, any>

const REASON = "Configuration validation failed at 'config.port': must be between 1 and 65535"
const VALIDATE_ROUTE = apiPathMatcher('/api/backup/validate')
const RESTORE_ROUTE = apiPathMatcher('/api/backup/restore')

async function profileIdsNamed(request: APIRequestContext, name: string): Promise<string[]> {
  const response = await request.get(`${BACKEND_URL}/profiles?search=${encodeURIComponent(name)}`)
  const body = await response.json().catch(() => null)
  const listed = (Array.isArray(body) ? body : (body?.data ?? [])) as Array<{ id: string; name: string }>
  return listed.filter((profile) => profile.name === name).map((profile) => profile.id)
}

async function answerOf(page: Page, route: ApiUrlMatcher, action: () => Promise<void>) {
  const [answer] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && route(new URL(response.url())), {
      timeout: 60_000,
    }),
    action(),
  ])
  return answer
}

/** The archive of a real backup whose member for `profileId` holds Port 70000 in every place it keeps a port. */
function withRefusedPort(original: Buffer, profileId: string): Buffer {
  const changed: string[] = []
  const members: ZipMember[] = listZipEntries(original).map((entry) => {
    const data = readZipEntry(original, entry.name)
    if (!entry.name.startsWith('profiles/') || !entry.name.endsWith('.json')) return { name: entry.name, data }
    const document = JSON.parse(data.toString('utf-8')) as Json
    if (document.id !== profileId) return { name: entry.name, data }
    for (const config of [document.config, ...Object.values(document.environment_values ?? {})]) {
      if (config && typeof config === 'object' && 'port' in config) (config as Json).port = 70000
    }
    changed.push(entry.name)
    return { name: entry.name, data: Buffer.from(JSON.stringify(document, null, 2), 'utf-8') }
  })
  expect(changed, 'one member holds the profile').toHaveLength(1)
  return buildZip(members)
}

/** The line of `name` in an opened preview or result list: its name, then its reason. */
async function expectFatalLine(list: Locator, name: string, reason: string): Promise<void> {
  const line = list.getByTestId('restore-item').filter({ has: list.page().getByText(name, { exact: true }) })
  await expect(line, `"${name}" is listed once`).toHaveCount(1)
  await expect(line).toHaveAttribute('data-status', 'fatal')
  await expect(line.locator('span')).toHaveText([name, reason])
}

async function openedList(page: Page, toggleId: string, itemsId: string): Promise<Locator> {
  await expect(page.getByTestId(`${toggleId}-profiles`)).toHaveAttribute('aria-expanded', 'true')
  const list = page.getByTestId(`${itemsId}-profiles`)
  await expect(list).toBeVisible()
  return list
}

test.describe('V-NUMBER-SETTINGS-BACKUP: a backup profile whose Port the save refuses', () => {
  const name = `zz-11541-s9-backup-port-${runToken()}`

  test.afterEach(async ({ request }) => {
    for (const id of await profileIdsNamed(request, name)) {
      await request.delete(`${BACKEND_URL}/profiles/${id}`).catch(() => undefined)
    }
  })

  test('the preview and the restore list it as blocked with the save message, and nothing is written', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const envId = await resolveEnvironmentId(request)
    const created = await request.post(`${BACKEND_URL}/profiles`, {
      data: {
        name,
        type: 'database',
        description: '',
        tags: [],
        environment_values: {
          [envId]: {
            host: SQL_TARGET_HOST,
            port: 5432,
            database: SQL_STACK_DATABASE,
            username: SQL_STACK_USER,
            password: SQL_STACK_PASSWORD,
          },
        },
      },
    })
    expect(created.ok(), `POST /profiles answered ${await created.text()}`).toBeTruthy()
    const profileId = ((await created.json()).data?.id ?? '') as string

    const backup = await request.post(`${BACKEND_URL}/api/backup/create`, {
      data: {
        entity_types: ['environments', 'profiles'],
        format: 'json',
        compression_method: 'deflate',
        compression_level: 6,
        secrets: 'mask',
      },
    })
    expect(backup.status(), 'POST /api/backup/create').toBe(200)
    const archive = withRefusedPort(await backup.body(), profileId)
    expect((await request.delete(`${BACKEND_URL}/profiles/${profileId}`)).status()).toBe(204)

    await test.step('1. the preview lists the profile as blocked with the save message', async () => {
      await page.goto('/settings/backup')
      await expect(page.locator('[data-testid="settings-page"][aria-busy="false"]')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('restore-backup-section')).toBeVisible()
      const answer = await answerOf(page, VALIDATE_ROUTE, () =>
        page.getByTestId('upload-input').setInputFiles({
          name: 'zz-11541-s9-backup-port.zip',
          mimeType: 'application/zip',
          buffer: archive,
        }),
      )
      expect(answer.status(), 'the preview is read').toBe(200)
      const profiles = ((await answer.json()).data.entity_summary as Json).profiles as Json
      expect(profiles.items.filter((item: Json) => item.name === name)).toEqual([
        { name, status: 'fatal', reason: REASON },
      ])
      await expect(page.getByTestId('validation-preview')).toBeVisible({ timeout: 20_000 })
      await expectFatalLine(
        await openedList(page, 'entity-row-toggle', 'entity-row-items'),
        name,
        `Cannot be restored. ${REASON}`,
      )
    })

    await test.step('2. the restore lists it as not restored and writes nothing for it', async () => {
      const button = page.getByTestId('restore-button')
      await expect(button).toBeEnabled()
      const answer = await answerOf(page, RESTORE_ROUTE, () => button.click())
      expect(answer.status(), 'the restore answers a result').toBe(200)
      await expect(page.getByTestId('restore-result')).toBeVisible()
      await expectFatalLine(
        await openedList(page, 'restore-result-toggle', 'restore-result-items'),
        name,
        `Not restored. ${REASON}`,
      )
      expect(await profileIdsNamed(request, name), 'no profile of that name is stored').toEqual([])
      const reread = await request.get(`${BACKEND_URL}/profiles/${profileId}`)
      expect(reread.status(), 'the profile ID is not written').toBe(404)
    })
  })
})
