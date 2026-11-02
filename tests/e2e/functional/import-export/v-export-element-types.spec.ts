/**
 * V-EXPORT-ELEMENT-TYPES: exporting and importing keeps every declared element type -
 * on a Test's variables, its Variable Setter and its SQL block's Driver options, and on
 * Suite, Regression, System variables and profile fields - and the imported Test runs
 * with those types.
 * REQ: REQ-3.1.3.19, REQ-5.2.4.9, REQ-4.7.4
 *
 * Pass Criteria:
 * 1. A Test exported as YAML and as JSON, deleted and imported, stores the same values
 *    and element types on its variables, Variable Setter node and SQL block.
 * 2. The imported Test's tracked run reads every element as its declared type.
 * 3. A Suite, a Regression, a System variable and a profile field exported, deleted and
 *    imported keep their map values and element types.
 *
 * Phase: functional-destructive (creates, exports, deletes and re-imports its own
 * entities; deletes everything after).
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
const TRAVEL_LINE = 'TRAVEL sn=17 sz=02134-x lite=7000'

type Json = Record<string, any>

/** What one Test keeps of its element types: variables, Setter node and SQL block. */
function sidecarsOf(test: Json): Json {
  const nodes = test.workflow.nodes as Json[]
  const setter = nodes.find((node) => node.id === SETTER) as Json
  const lite = nodes.find((node) => node.id === LITE) as Json
  return {
    m: { value: test.variables.m.value, elementTypes: test.variables.m.elementTypes },
    a: { value: test.variables.a.value, elementTypes: test.variables.a.elementTypes },
    setter: {
      values: setter.data.config.values.variables,
      variableElementTypes: setter.data.variableElementTypes,
    },
    lite: { values: lite.data.config.values.driver_options, elementTypes: lite.data.elementTypes },
  }
}

async function importFile(
  request: APIRequestContext,
  route: string,
  name: string,
  content: Buffer,
): Promise<Json> {
  const resp = await request.post(`${BACKEND_URL}${route}`, {
    multipart: {
      file: { name, mimeType: name.endsWith('.json') ? 'application/json' : 'application/x-yaml', buffer: content },
      conflict_resolutions: '{}',
    },
  })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST ${route}: ${resp.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return body.data
}

async function exported(request: APIRequestContext, route: string): Promise<Buffer> {
  const resp = await request.get(`${BACKEND_URL}${route}`)
  expect(resp.ok(), `GET ${route}: ${resp.status()}`).toBeTruthy()
  return resp.body()
}

async function runLogs(request: APIRequestContext, testId: string): Promise<{ verdict: string; logs: string[] }> {
  const { executionId, verdict } = await runTrackedTest(request, testId)
  const resp = await request.get(`${BACKEND_URL}/executions/history/${executionId}`)
  const logs = (((await resp.json()).data ?? {}) as { logs?: Array<{ message?: string }> }).logs ?? []
  return { verdict, logs: logs.map((entry) => entry.message ?? '') }
}

test.describe('V-EXPORT-ELEMENT-TYPES: element types travel through export and import', () => {
  const created: Array<() => Promise<unknown>> = []

  test.afterEach(async () => {
    for (const cleanup of created.splice(0)) await cleanup().catch(() => undefined)
  })

  for (const format of ['yaml', 'json'] as const) {
    test(`a Test exported as ${format.toUpperCase()} and imported keeps every sidecar and runs typed`, async ({
      request,
    }) => {
      test.setTimeout(240_000)
      const fixture = substitute(readFixture(__dirname, 'element-types-fixture.json'), {
        __MAP_PROBE__: mapProbe('MAP', 'm'),
        __LIST_PROBE__: listProbe('LIST', 'a'),
        __TOKEN__: runToken(),
      })
      const originalId = await importValidated(request, fixture)
      created.push(() => deleteTest(request, originalId))
      const before = sidecarsOf(await getTest(request, originalId))

      const file = await exported(request, `/tests/${originalId}/export?format=${format}&secrets=encrypted`)
      await deleteTest(request, originalId)
      const result = await importFile(request, '/tests/import', `typed.${format}`, file)
      expect(result.total_imported, JSON.stringify(result)).toBe(1)
      const importedId = result.imported[0].id as string
      created.push(() => deleteTest(request, importedId))

      expect(sidecarsOf(await getTest(request, importedId)), 'the imported Test keeps every sidecar').toEqual(
        before,
      )
      const run = await runLogs(request, importedId)
      for (const line of [mapProbeLine('MAP'), listProbeLine('LIST'), TRAVEL_LINE]) {
        expect(run.logs, run.logs.join('\n')).toContain(line)
      }
      expect(run.verdict, run.logs.join('\n')).toBe('passed')
    })
  }

  test('Suite, Regression, System variable and profile field keep their element types', async ({ request }) => {
    test.setTimeout(180_000)
    const token = runToken()
    const typed = { type: 'map', value: storedMap(), elementTypes: mapElementTypes(), secret: false }

    const suite = await request.post(`${BACKEND_URL}/suites`, {
      data: { name: `ET Export Suite ${token}`, variables: { m: typed } },
    })
    expect(suite.ok(), `POST /suites: ${suite.status()}`).toBeTruthy()
    const suiteId = (await suite.json()).data.id as string
    const suiteFile = await exported(request, `/suites/${suiteId}/export?format=yaml&secrets=encrypted`)
    await request.delete(`${BACKEND_URL}/suites/${suiteId}`)
    const suiteImport = await importFile(request, '/suites/import', 'suite.yaml', suiteFile)
    const importedSuiteId = suiteImport.imported[0].id as string
    created.push(() => request.delete(`${BACKEND_URL}/suites/${importedSuiteId}`))
    const importedSuite = (await (await request.get(`${BACKEND_URL}/suites/${importedSuiteId}`)).json()).data
    expect(importedSuite.variables.m.value).toEqual(storedMap())
    expect(importedSuite.variables.m.elementTypes, 'the Suite keeps its element types').toEqual(mapElementTypes())

    const regression = await request.post(`${BACKEND_URL}/regressions`, {
      data: { name: `ET Export Regression ${token}` },
    })
    const regressionId = (await regression.json()).data.id as string
    await request.put(`${BACKEND_URL}/regressions/${regressionId}`, { data: { variables: { m: typed } } })
    const regressionFile = await exported(
      request,
      `/regressions/${regressionId}/export?format=json&secrets=encrypted`,
    )
    await request.delete(`${BACKEND_URL}/regressions/${regressionId}`)
    const regressionImport = await importFile(request, '/regressions/import', 'regression.json', regressionFile)
    const importedRegressionId = regressionImport.imported[0].id as string
    created.push(() => request.delete(`${BACKEND_URL}/regressions/${importedRegressionId}`))
    const importedRegression = (
      await (await request.get(`${BACKEND_URL}/regressions/${importedRegressionId}`)).json()
    ).data
    expect(importedRegression.variables.m.elementTypes, 'the Regression keeps its element types').toEqual(
      mapElementTypes(),
    )

    const systemName = `et_export_${token.replace(/-/g, '_')}`
    created.push(() => request.delete(`${BACKEND_URL}/variables/system/${systemName}`))
    const existing = (await (await request.get(`${BACKEND_URL}/variables/system`)).json()).data.variables
    const setSystem = await request.post(`${BACKEND_URL}/variables/system`, {
      data: { variables: { ...existing, [systemName]: typed } },
    })
    expect(setSystem.ok(), `POST /variables/system: ${setSystem.status()}`).toBeTruthy()
    const systemFile = await exported(request, '/variables/system/export?format=yaml&secrets=encrypted')
    await request.delete(`${BACKEND_URL}/variables/system/${systemName}`)
    await importFile(request, '/variables/system/import', 'system.yaml', systemFile)
    const system = (await (await request.get(`${BACKEND_URL}/variables/system`)).json()).data.variables
    expect(system[systemName].elementTypes, 'the System variable keeps its element types').toEqual(
      mapElementTypes(),
    )

    const environmentId = await resolveEnvironmentId(request)
    const profile = await request.post(`${BACKEND_URL}/profiles`, {
      data: {
        name: `ET Export Profile ${token}`,
        type: 'custom',
        tags: [],
        environment_values: { [environmentId]: { m: typed } },
      },
    })
    expect(profile.ok(), `POST /profiles: ${profile.status()}`).toBeTruthy()
    const profileId = (await profile.json()).data.id as string
    const profileFile = await exported(request, `/profiles/${profileId}/export?format=yaml&secrets=encrypted`)
    await request.delete(`${BACKEND_URL}/profiles/${profileId}`)
    const profileImport = await importFile(request, '/profiles/import', 'profile.yaml', profileFile)
    const importedProfileId = profileImport.imported[0].id as string
    created.push(() => request.delete(`${BACKEND_URL}/profiles/${importedProfileId}`))
    const importedProfile = (await (await request.get(`${BACKEND_URL}/profiles/${importedProfileId}`)).json()).data
    expect(importedProfile.environment_values[environmentId].m, 'the profile field keeps its element types').toEqual(
      typed,
    )
  })
})
