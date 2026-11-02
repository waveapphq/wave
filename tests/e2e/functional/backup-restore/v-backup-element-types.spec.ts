/**
 * V-BACKUP-ELEMENT-TYPES: a backup and a restore keep every declared element type - on a
 * Test's variables, Variable Setter and SQL block, on a Suite, on a System variable and on
 * a profile field - and the restored Test runs with those types.
 * REQ: REQ-3.1.3.19, REQ-3.5.2.4
 *
 * Pass Criteria:
 * 1. A backup taken while the entities exist restores them after they are deleted, with
 *    the same values and element types.
 * 2. The restored Test's tracked run reads every element as its declared type.
 *
 * Phase: functional-destructive (creates, backs up, deletes and restores its own
 * entities; restores other entities only where nothing of theirs was missing).
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { resolveEnvironmentId, runTrackedTest } from '../../helpers/k8s-run'
import {
  deleteTest,
  getTest,
  importValidated,
  listProbe,
  listProbeLine,
  mapElementTypes,
  mapProbe,
  mapProbeLine,
  readFixture,
  runToken,
  storedMap,
  substitute,
} from '../../helpers/element-types'

const SETTER = '80a2e4f0-8431-4ec5-a7d8-f0492ecb4602'
const LITE = '735739d0-24f2-4a77-a750-d2699ecea4fb'

type Json = Record<string, any>

/** The id of the one entity of `collection` named `name` (a restore creates new ids). */
async function idByName(request: APIRequestContext, collection: string, name: string): Promise<string> {
  const resp = await request.get(`${BACKEND_URL}/${collection}?search=${encodeURIComponent(name)}`)
  expect(resp.ok(), `GET /${collection}: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  const list = (Array.isArray(body.data) ? body.data : (body.data?.[collection] ?? body.data?.items ?? [])) as Json[]
  const match = list.filter((entry) => entry.name === name)
  expect(match, `exactly one ${collection} entry named ${name}`).toHaveLength(1)
  return match[0].id as string
}

async function restore(
  request: APIRequestContext,
  archive: Buffer,
  entityTypes: string,
  conflictResolution: string,
): Promise<void> {
  const resp = await request.post(`${BACKEND_URL}/api/backup/restore`, {
    multipart: {
      file: { name: 'element-types-backup.zip', mimeType: 'application/zip', buffer: archive },
      entity_types: entityTypes,
      conflict_resolution: conflictResolution,
      auto_repair: 'false',
    },
  })
  expect(resp.ok(), `POST /api/backup/restore: ${resp.status()} ${await resp.text()}`).toBeTruthy()
}

test.describe('V-BACKUP-ELEMENT-TYPES: element types survive a backup and restore', () => {
  const cleanups: Array<() => Promise<unknown>> = []

  test.afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup().catch(() => undefined)
  })

  test('a restored Test, Suite, System variable and profile keep every element type', async ({ request }) => {
    test.setTimeout(240_000)
    const token = runToken()
    const typed = { type: 'map', value: storedMap(), elementTypes: mapElementTypes(), secret: false }
    const environmentId = await resolveEnvironmentId(request)

    const testId = await importValidated(
      request,
      substitute(readFixture(__dirname, 'element-types-fixture.json'), {
        __MAP_PROBE__: mapProbe('MAP', 'm'),
        __LIST_PROBE__: listProbe('LIST', 'a'),
        __TOKEN__: token,
      }),
    )
    cleanups.push(() => deleteTest(request, testId))
    const suite = await request.post(`${BACKEND_URL}/suites`, {
      data: { name: `ET Backup Suite ${token}`, variables: { m: typed } },
    })
    const suiteId = (await suite.json()).data.id as string
    cleanups.push(() => request.delete(`${BACKEND_URL}/suites/${suiteId}`))
    const systemName = `et_backup_${token.replace(/-/g, '_')}`
    cleanups.push(() => request.delete(`${BACKEND_URL}/variables/system/${systemName}`))
    const existing = (await (await request.get(`${BACKEND_URL}/variables/system`)).json()).data.variables
    await request.post(`${BACKEND_URL}/variables/system`, {
      data: { variables: { ...existing, [systemName]: typed } },
    })
    const profile = await request.post(`${BACKEND_URL}/profiles`, {
      data: {
        name: `ET Backup Profile ${token}`,
        type: 'custom',
        tags: [],
        environment_values: { [environmentId]: { m: typed } },
      },
    })
    const profileId = (await profile.json()).data.id as string
    cleanups.push(() => request.delete(`${BACKEND_URL}/profiles/${profileId}`))
    const originalTest = await getTest(request, testId)
    const testName = originalTest.name as string
    const suiteName = `ET Backup Suite ${token}`
    const profileName = `ET Backup Profile ${token}`

    const backup = await request.post(`${BACKEND_URL}/api/backup/create`, {
      data: {
        entity_types: ['tests', 'suites', 'profiles', 'system_variables'],
        format: 'json',
        compression_method: 'deflate',
        compression_level: 6,
        secrets: 'encrypted',
      },
    })
    expect(backup.ok(), `POST /api/backup/create: ${backup.status()}`).toBeTruthy()
    const archive = await backup.body()

    await deleteTest(request, testId)
    await request.delete(`${BACKEND_URL}/suites/${suiteId}`)
    await request.delete(`${BACKEND_URL}/profiles/${profileId}`)
    await request.delete(`${BACKEND_URL}/variables/system/${systemName}`)

    await restore(request, archive, 'tests,suites,profiles', 'skip')
    await restore(request, archive, 'system_variables', 'overwrite')

    const restoredTestId = await idByName(request, 'tests', testName)
    cleanups.push(() => deleteTest(request, restoredTestId))
    const restoredSuiteId = await idByName(request, 'suites', suiteName)
    cleanups.push(() => request.delete(`${BACKEND_URL}/suites/${restoredSuiteId}`))
    const restoredProfileId = await idByName(request, 'profiles', profileName)
    cleanups.push(() => request.delete(`${BACKEND_URL}/profiles/${restoredProfileId}`))

    const restoredTest = await getTest(request, restoredTestId)
    expect(restoredTest.variables.m).toEqual(originalTest.variables.m)
    expect(restoredTest.variables.m.elementTypes, 'the Test variable keeps its element types').toEqual(
      mapElementTypes(),
    )
    expect(restoredTest.variables.a).toEqual(originalTest.variables.a)
    const node = (test: Json, id: string) => (test.workflow.nodes as Json[]).find((entry) => entry.id === id) as Json
    expect(node(restoredTest, SETTER).data.variableElementTypes).toEqual(
      node(originalTest, SETTER).data.variableElementTypes,
    )
    expect(node(restoredTest, LITE).data.elementTypes).toEqual(node(originalTest, LITE).data.elementTypes)

    const restoredSuite = (await (await request.get(`${BACKEND_URL}/suites/${restoredSuiteId}`)).json()).data
    expect(restoredSuite.variables.m, 'the Suite keeps its element types').toEqual(typed)
    const system = (await (await request.get(`${BACKEND_URL}/variables/system`)).json()).data.variables
    expect(system[systemName], 'the System variable keeps its element types').toEqual(typed)
    const restoredProfile = (await (await request.get(`${BACKEND_URL}/profiles/${restoredProfileId}`)).json()).data
    expect(restoredProfile.environment_values[environmentId].m, 'the profile field keeps its element types').toEqual(
      typed,
    )

    const { executionId, verdict } = await runTrackedTest(request, restoredTestId)
    const history = await request.get(`${BACKEND_URL}/executions/history/${executionId}`)
    const logs = ((((await history.json()).data ?? {}) as { logs?: Array<{ message?: string }> }).logs ?? []).map(
      (entry) => entry.message ?? '',
    )
    for (const line of [mapProbeLine('MAP'), listProbeLine('LIST'), 'TRAVEL sn=17 sz=02134-x lite=7000']) {
      expect(logs, logs.join('\n')).toContain(line)
    }
    expect(verdict, logs.join('\n')).toBe('passed')
  })
})
