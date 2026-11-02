/**
 * V-BACKUP-RT (functional): a backup restored on an empty WAVE gives back the same WAVE.
 *
 * Design Decisions: BACKUP-1, BACKUP-2, BACKUP-3, BACKUP-4, BACKUP-5, BACKUP-6, BACKUP-7, BACKUP-8,
 *   BACKUP-9
 * REQ: REQ-5.2.4.9.5, REQ-5.2.4.9.6
 *
 * Phase: functional-destructive. The spec owns the store while it runs: it starts and ends
 * with the reset plus the removal of every library Function.
 *
 * The fixture, every name with a run token: one Environment, one Profile with a value for
 * it, Function FnA in two versions, Function FnB that calls FnA 1.0.0, a Test that calls FnB
 * and binds the Profile (two history rows, one data file), a Test that calls FnA inside a
 * Local Function, a plain Test, a Suite of the three Tests and a Regression of the Suite.
 *
 * Pass Criteria:
 * 1. V-BACKUP-RT-1: the archive made on the Backup page with the six seeded parts holds a
 *    member for each seeded item, both versions in FnA's member and the data file. On the
 *    emptied store the preview has a row per part in the order of the part list, under the
 *    column headers Type, Total, OK, Conflicts, Fixable and Errors, and names no seeded
 *    item. After the restore every item is back under its ID, the Test has its
 *    description, tags, owner, version 1.1.0 and two history rows, every link holds, the
 *    data file is back and the Suite passes with the pinned FnA 1.0.0.
 * 2. V-BACKUP-RT-2: the same archive again with Skip. Every part has a toggle; opened, it
 *    names each seeded item as a conflict with "Already in this WAVE". The result names
 *    each one as skipped with the same reason. A conflict line and a skipped line show the
 *    reason alone. No ID and no last update changed.
 * 3. V-BACKUP-RT-3: with Overwrite picked the items stay listed as conflicts and the choice
 *    stays. The first click on Restore opens the confirmation and sends no restore; Cancel
 *    leaves the changed Test as it is. Restore then Overwrite gives the Test here the
 *    backup's description, version 1.1.0 and two history rows under the same ID.
 * 4. V-BACKUP-RT-4: with Rename every item stays under its ID and a copy named "<name> (2)"
 *    stands beside it under a new ID. Every link of a copy points at a copy, and the
 *    renamed Suite passes with the renamed Environment.
 * 5. V-BACKUP-RT-5: an archive without the Functions part on a store without Functions.
 *    The Tests row starts open and names both Tests that call a Function as fatal, each with
 *    `Cannot be restored. Uses Function "<name of its Function block>", which is not in the
 *    backup or in this WAVE`. The restore answers a result that names them fatal with
 *    `Not restored. Uses Function "<name>", which is not in this WAVE`; its Tests line reads
 *    "Tests: 1 imported, 0 skipped, 2 failed" and the four other lines count no failed item.
 *    Every other item is back under its ID and neither fatal Test exists.
 * 6. V-BACKUP-RT-6: unticking Functions disables Restore while the newer preview loads, then
 *    opens the Tests row with both Tests fatal (`Cannot be restored. Uses Function "<name>",
 *    which is not in this WAVE`); the Functions row stays. Ticked again, the Tests row names
 *    nothing.
 * 7. V-BACKUP-RT-7: a profile whose archive member has no type shows the auto-repair switch
 *    and is named in no preview list. Restored with the switch off it is named fatal with
 *    "Not restored. Has no type" and is not written; with the switch on it is written under
 *    its ID as type custom.
 * 8. V-BACKUP-RT-8: an Environment that is here and a Test that is not. With Overwrite picked
 *    and Environments unticked, Restore starts without asking and writes the Test. The preview
 *    is then read again and lists the Test as a conflict with "Already in this WAVE". The next
 *    click on Restore asks first; Cancel leaves the Test as changed here, and Restore then
 *    Overwrite gives it the backup's description.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/backup-restore/v-backup-roundtrip-functional.spec.ts
 */

import fs from 'fs'
import { randomUUID } from 'node:crypto'
import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import {
  apiPathMatcher,
  countApiFetches,
  delayApiRoute,
  type ApiUrlMatcher,
} from '../../helpers/api-route'
import { BACKEND_URL } from '../../helpers/config'
import { exec } from '../../helpers/exec'
import {
  addLibraryVersion,
  createValidTest,
  localFunctionNode,
  logNode,
  publishLibraryFunction,
  sharedNode,
  startEdge,
  validateTest,
} from '../../helpers/fn-seed'
import { listTestDataPaths, readTestDataContent, uploadTestData } from '../../helpers/testdata'
import {
  listZipEntries,
  readZipEntry,
  readZipEntryText,
  zipEntryNames,
} from '../../helpers/zip-reader'
import { buildZip, type ZipMember } from '../../helpers/zip-writer'

type Json = Record<string, any>
type BackupAnswer = Awaited<ReturnType<Page['waitForResponse']>>
type EntryStatus = 'conflict' | 'fatal' | 'skipped'

const RUN = randomUUID().slice(0, 8)

const SEEDED_PARTS = ['tests', 'environments', 'profiles', 'suites', 'regressions', 'functions'] as const
type Part = (typeof SEEDED_PARTS)[number]
const PARTS_WITHOUT_FUNCTIONS: readonly Part[] = SEEDED_PARTS.filter((part) => part !== 'functions')

const ENV_NAME = `bk-env ${RUN}`
const PROFILE_NAME = `bk-profile ${RUN}`
const FNA_NAME = `FnA ${RUN}`
const FNB_NAME = `FnB ${RUN}`
const USES_FNB_NAME = `T uses FnB ${RUN}`
const NESTED_NAME = `T nested ${RUN}`
const PLAIN_NAME = `A plain test ${RUN}`
const SUITE_NAME = `bk-suite ${RUN}`
const REGRESSION_NAME = `bk-regression ${RUN}`
const NO_TYPE_PROFILE_NAME = `bk-notype-profile ${RUN}`
const TYPED_PROFILE_NAME = `bk-typed-profile ${RUN}`
const STAYS_ENV_NAME = `bk-stays-env ${RUN}`
const COMES_BACK_NAME = `T comes back ${RUN}`

const CALL_FNB = { id: 'call-fnb', label: 'Call FnB block' }
const INNER_CALL = { id: 'inner-call-fna', label: 'Inner FnA call' }
const BOUND_LOG_ID = 'bound-log'
const LOCAL_WRAPPER_ID = 'local-wrapper'
const FNA_LOG_ID = 'fna-log'
const FNB_BODY_BLOCK_ID = 'fnb-calls-fna'

const FIRST_DESCRIPTION = `Round-trip test, first description ${RUN}`
const BACKUP_DESCRIPTION = `Round-trip test, second description ${RUN}`
const CHANGED_DESCRIPTION = `Changed here before the overwrite ${RUN}`
const COMES_BACK_DESCRIPTION = `In the backup, restored a moment ago ${RUN}`
const OWNER = 'ashley'
const TEST_TAGS = ['bk', 'roundtrip']
const SAMPLE_CSV = 'a,b\n1,2\n'
const A_V1 = `A v1 ${RUN}`
const A_V2 = `A v2 ${RUN}`

const ALREADY_HERE = 'Already in this WAVE'
const NO_TYPE = 'Has no type'
const OVERWRITE_TITLE = 'Overwrite conflicting entities?'
const OVERWRITE_BODY = "The ones in this WAVE get the backup's content. This cannot be undone."

const VALIDATE_ROUTE = apiPathMatcher('/api/backup/validate')
const RESTORE_ROUTE = apiPathMatcher('/api/backup/restore')
const ENDED = new Set(['passed', 'failed', 'stopped', 'skipped'])

const PREVIEW_HEADERS = ['', 'Type', 'Total', 'OK', 'Conflicts', 'Fixable', 'Errors']

function missingInBackupAndHere(blockName: string): string {
  return `Uses Function "${blockName}", which is not in the backup or in this WAVE`
}

function missingHere(blockName: string): string {
  return `Uses Function "${blockName}", which is not in this WAVE`
}

/** BACKUP-9: what a fatal line of the preview reads. */
function cannotBeRestored(reason: string): string {
  return `Cannot be restored. ${reason}`
}

/** BACKUP-9: what a fatal line of the result reads. */
function notRestored(reason: string): string {
  return `Not restored. ${reason}`
}

interface Ids {
  environment: string
  profile: string
  fnA: string
  fnB: string
  usesFnb: string
  nested: string
  plain: string
  suite: string
  regression: string
}

interface Item {
  key: keyof Ids
  part: Part
  name: string
  id: string
}

function itemsOf(ids: Ids, suffix = ''): Item[] {
  const rows: Array<[keyof Ids, Part, string]> = [
    ['usesFnb', 'tests', USES_FNB_NAME],
    ['nested', 'tests', NESTED_NAME],
    ['plain', 'tests', PLAIN_NAME],
    ['environment', 'environments', ENV_NAME],
    ['profile', 'profiles', PROFILE_NAME],
    ['suite', 'suites', SUITE_NAME],
    ['regression', 'regressions', REGRESSION_NAME],
    ['fnA', 'functions', FNA_NAME],
    ['fnB', 'functions', FNB_NAME],
  ]
  return rows.map(([key, part, name]) => ({ key, part, name: `${name}${suffix}`, id: ids[key] }))
}

function memberName(part: Part, name: string, extension: string): string {
  return `${part}/${name.replace(/ /g, '-')}.${extension}`
}

async function read(request: APIRequestContext, path: string): Promise<Json> {
  const response = await request.get(`${BACKEND_URL}${path}`)
  const body = await response.json().catch(() => null)
  expect(response.status(), `GET ${path} answered ${JSON.stringify(body)}`).toBe(200)
  return body.data as Json
}

async function statusOf(request: APIRequestContext, path: string): Promise<number> {
  return (await request.get(`${BACKEND_URL}${path}`)).status()
}

async function create(request: APIRequestContext, path: string, data: Json): Promise<Json> {
  const response = await request.post(`${BACKEND_URL}${path}`, { data })
  const body = await response.json().catch(() => null)
  expect(response.status(), `POST ${path} answered ${JSON.stringify(body)}`).toBe(201)
  return body.data as Json
}

async function changeDescription(
  request: APIRequestContext,
  testId: string,
  description: string,
  version: string,
): Promise<void> {
  const response = await request.put(`${BACKEND_URL}/tests/${testId}`, { data: { description } })
  const body = await response.json().catch(() => null)
  expect(response.status(), `PUT /tests/${testId} answered ${JSON.stringify(body)}`).toBe(200)
  expect(body.data.version, 'the update makes the next minor version').toBe(version)
}

async function deleteEveryFunction(request: APIRequestContext): Promise<void> {
  for (let round = 0; round < 20; round++) {
    const listed = await request.get(`${BACKEND_URL}/functions?per_page=100`)
    expect(listed.ok(), `GET /functions answered ${listed.status()}`).toBeTruthy()
    const functions = (await listed.json()).data as Array<{ id: string; name: string }>
    if (functions.length === 0) return
    for (const fn of functions) {
      const deleted = await request.delete(`${BACKEND_URL}/functions/${fn.id}?cascade=true`)
      expect(deleted.ok(), `DELETE /functions/${fn.id} (${fn.name}) answered ${deleted.status()}`).toBeTruthy()
    }
  }
}

async function cleanUp(request: APIRequestContext): Promise<void> {
  exec('./tests/e2e/scripts/reset.sh')
  await deleteEveryFunction(request)
  const left = await request.get(`${BACKEND_URL}/functions?per_page=100`)
  expect((await left.json()).pagination.total, 'Functions left behind').toBe(0)
}

function fnABody(line: string): Json {
  return { nodes: [logNode(FNA_LOG_ID, 'FnA log', `'${line}'`)], edges: [startEdge(FNA_LOG_ID)] }
}

function boundLogNode(profileId: string): Record<string, unknown> {
  const node = logNode(BOUND_LOG_ID, 'Bound log', "'greeting=' + str(prof.greeting)", { x: 200, y: 340 })
  const data = node.data as { config: Json }
  data.config.profileBindings = [
    { profileId, alias: 'prof', profileName: PROFILE_NAME, profileType: 'custom' },
  ]
  return node
}

async function seedFixture(request: APIRequestContext): Promise<Ids> {
  const environment = (
    await create(request, '/environments', { name: ENV_NAME, description: 'Backup round-trip environment' })
  ).id as string
  const profile = (
    await create(request, '/profiles', {
      name: PROFILE_NAME,
      type: 'custom',
      description: 'Backup round-trip profile',
      tags: ['bk'],
      environment_values: {
        [environment]: { greeting: { type: 'string', secret: false, value: 'hello' } },
      },
    })
  ).id as string

  const fnA = await publishLibraryFunction(request, {
    name: FNA_NAME,
    description: 'FnA of the round-trip fixture',
    workflow: fnABody(A_V1),
  })
  await addLibraryVersion(request, fnA, {
    sourceVersion: '1.0.0',
    targetVersion: '1.1.0',
    workflow: fnABody(A_V2),
  })
  const fnB = await publishLibraryFunction(request, {
    name: FNB_NAME,
    description: 'FnB of the round-trip fixture',
    workflow: {
      nodes: [
        sharedNode(FNB_BODY_BLOCK_ID, {
          functionId: fnA.functionId,
          functionVersion: '1.0.0',
          label: 'FnA call in FnB',
          originalLibraryName: FNA_NAME,
        }),
      ],
      edges: [startEdge(FNB_BODY_BLOCK_ID)],
    },
  })

  const usesFnb = (
    await create(request, '/tests', {
      name: USES_FNB_NAME,
      version: '1.0.0',
      description: FIRST_DESCRIPTION,
      workflow: {
        nodes: [
          sharedNode(CALL_FNB.id, {
            functionId: fnB.functionId,
            functionVersion: '1.0.0',
            label: CALL_FNB.label,
            originalLibraryName: FNB_NAME,
          }),
          boundLogNode(profile),
        ],
        edges: [
          startEdge(CALL_FNB.id),
          { id: `e-${CALL_FNB.id}-${BOUND_LOG_ID}`, source: CALL_FNB.id, target: BOUND_LOG_ID },
        ],
      },
      variables: {},
      metadata: { owner: OWNER, tags: TEST_TAGS },
    })
  ).id as string
  await changeDescription(request, usesFnb, BACKUP_DESCRIPTION, '1.1.0')
  await uploadTestData(request, usesFnb, '', 'sample.csv', SAMPLE_CSV)

  const nested = await createValidTest(request, {
    name: NESTED_NAME,
    nodes: [
      localFunctionNode(LOCAL_WRAPPER_ID, 'Local wrapper', {
        nodes: [
          sharedNode(INNER_CALL.id, {
            functionId: fnA.functionId,
            functionVersion: '1.0.0',
            label: INNER_CALL.label,
            originalLibraryName: FNA_NAME,
          }),
        ],
        edges: [startEdge(INNER_CALL.id)],
      }),
    ],
    edges: [startEdge(LOCAL_WRAPPER_ID)],
  })
  const plain = await createValidTest(request, {
    name: PLAIN_NAME,
    nodes: [logNode('plain-log', 'Plain log', `'plain line ${RUN}'`)],
    edges: [startEdge('plain-log')],
  })

  for (const testId of [usesFnb, nested, plain]) {
    const validation = await validateTest(request, testId)
    expect(validation.status, `validate of ${testId}: ${JSON.stringify(validation.errors)}`).toBe(200)
    expect(validation.errors, 'a seeded Test validates with zero errors').toEqual([])
  }

  const suite = (
    await create(request, '/suites', {
      name: SUITE_NAME,
      description: 'Backup round-trip suite',
      tests: [usesFnb, nested, plain],
      tags: ['bk'],
    })
  ).id as string
  const regression = (
    await create(request, '/regressions', {
      name: REGRESSION_NAME,
      description: 'Backup round-trip regression',
      suites: [suite],
    })
  ).id as string

  return {
    environment,
    profile,
    fnA: fnA.functionId,
    fnB: fnB.functionId,
    usesFnb,
    nested,
    plain,
    suite,
    regression,
  }
}

function lastUpdateOf(document: Json): string {
  const stamp = document.updated_at ?? document.metadata?.updated_at
  expect(typeof stamp, `${document.name} has a last update`).toBe('string')
  return stamp as string
}

async function readStored(request: APIRequestContext, items: readonly Item[]): Promise<Record<string, string>> {
  const updates: Record<string, string> = {}
  for (const item of items) {
    const document = await read(request, `/${item.part}/${item.id}`)
    expect(document.id, `${item.name} is here under its ID`).toBe(item.id)
    expect(document.name).toBe(item.name)
    updates[item.name] = lastUpdateOf(document)
  }
  return updates
}

async function expectGone(request: APIRequestContext, items: readonly Item[]): Promise<void> {
  for (const item of items) {
    expect(await statusOf(request, `/${item.part}/${item.id}`), `${item.name} is not here`).toBe(404)
  }
}

async function idsNamed(request: APIRequestContext, part: Part, name: string): Promise<string[]> {
  const response = await request.get(
    `${BACKEND_URL}/${part}?search=${encodeURIComponent(RUN)}&page=1&per_page=100`,
  )
  expect(response.status(), `GET /${part} answered`).toBe(200)
  const body = await response.json()
  const rows = (Array.isArray(body) ? body : body.data) as Array<{ id: string; name: string }>
  return rows.filter((row) => row.name === name).map((row) => row.id)
}

function blockData(workflow: Json, blockId: string): Json {
  const node = (workflow.nodes as Json[]).find((candidate) => candidate.id === blockId)
  expect(node, `block ${blockId} is in the workflow`).toBeTruthy()
  return (node as Json).data as Json
}

async function expectBackupContent(request: APIRequestContext, testId: string): Promise<void> {
  const document = await read(request, `/tests/${testId}`)
  expect(document.description).toBe(BACKUP_DESCRIPTION)
  expect(document.version).toBe('1.1.0')
  expect(document.metadata.owner).toBe(OWNER)
  expect(document.metadata.tags).toEqual(TEST_TAGS)
  const history = await read(request, `/tests/${testId}/history`)
  const versions = (history.versions as Json[]).map((row) => String(row.version)).sort()
  expect(versions, 'the two history rows of the backup').toEqual(['1.0.0', '1.1.0'])
  expect(await listTestDataPaths(request, testId)).toEqual(['sample.csv'])
  expect(await readTestDataContent(request, testId, 'sample.csv')).toBe(SAMPLE_CSV)
}

async function expectBothVersions(request: APIRequestContext, fnAId: string): Promise<void> {
  const listed = await read(request, `/functions/${fnAId}/versions`)
  const versions = (listed.versions as Json[]).map((row) => String(row.version)).sort()
  expect(versions, 'FnA keeps every version').toEqual(['1.0.0', '1.1.0'])
  for (const [version, line] of [['1.0.0', A_V1], ['1.1.0', A_V2]] as const) {
    const stored = await read(request, `/functions/${fnAId}/versions/${version}`)
    const message = blockData(stored.definition.workflow, FNA_LOG_ID).config.values.message
    expect(message, `FnA ${version} logs its own line`).toContain(line)
  }
}

async function expectLinks(request: APIRequestContext, ids: Ids): Promise<void> {
  const suite = await read(request, `/suites/${ids.suite}`)
  expect(suite.tests, 'the Suite lists its Tests').toEqual([ids.usesFnb, ids.nested, ids.plain])
  const regression = await read(request, `/regressions/${ids.regression}`)
  expect(regression.suites, 'the Regression lists its Suite').toEqual([ids.suite])

  const usesFnb = await read(request, `/tests/${ids.usesFnb}`)
  const call = blockData(usesFnb.workflow, CALL_FNB.id)
  expect(call.functionId, 'the Test calls FnB').toBe(ids.fnB)
  expect(call.functionVersion).toBe('1.0.0')
  const bindings = blockData(usesFnb.workflow, BOUND_LOG_ID).config.profileBindings as Json[]
  expect(bindings.map((binding) => binding.profileId), 'the block binds the Profile').toEqual([ids.profile])

  const nested = await read(request, `/tests/${ids.nested}`)
  const wrapper = blockData(nested.workflow, LOCAL_WRAPPER_ID)
  const inner = blockData(wrapper.localDefinition.workflow, INNER_CALL.id)
  expect(inner.functionId, 'the block inside the Local Function calls FnA').toBe(ids.fnA)

  const fnB = await read(request, `/functions/${ids.fnB}/versions/1.0.0`)
  const fnBCall = blockData(fnB.definition.workflow, FNB_BODY_BLOCK_ID)
  expect(fnBCall.functionId, 'FnB calls FnA').toBe(ids.fnA)
  expect(fnBCall.functionVersion).toBe('1.0.0')

  const profile = await read(request, `/profiles/${ids.profile}`)
  expect(profile.type).toBe('custom')
  expect(Object.keys(profile.environment_values), 'the Profile keys its value by the Environment').toEqual([
    ids.environment,
  ])
}

async function expectSuitePasses(request: APIRequestContext, ids: Ids): Promise<void> {
  const started = await request.post(`${BACKEND_URL}/executions`, {
    data: { type: 'suite', id: ids.suite, environment_id: ids.environment },
  })
  const startedBody = await started.json().catch(() => null)
  expect(started.status(), `POST /executions answered ${JSON.stringify(startedBody)}`).toBe(201)
  const executionId = startedBody.data.id as string

  let execution: Json = {}
  await expect
    .poll(
      async () => {
        execution = await read(request, `/executions/${executionId}`)
        return ENDED.has(execution.status)
      },
      { message: 'the Suite run ends', timeout: 120_000, intervals: [250, 500, 1_000] },
    )
    .toBe(true)

  const logs = await read(request, `/executions/${executionId}/logs?limit=1000`)
  const entries = logs.entries as Array<{ run_id?: string; level: string; message: string }>
  const text = entries.map((entry) => `[${entry.level}] ${entry.message}`).join('\n')
  const rows = execution.tests as Array<{ id: string; status: string; run_id: string }>
  expect(execution.status, text).toBe('passed')
  expect(Object.fromEntries(rows.map((row) => [row.id, row.status])), text).toEqual({
    [ids.usesFnb]: 'passed',
    [ids.nested]: 'passed',
    [ids.plain]: 'passed',
  })

  const runId = rows.find((row) => row.id === ids.usesFnb)?.run_id
  const lines = entries.filter((entry) => entry.run_id === runId).map((entry) => entry.message)
  expect(lines.some((line) => line.includes(A_V1)), `FnA 1.0.0 ran.\n${text}`).toBe(true)
  expect(lines.some((line) => line.includes(A_V2)), `FnA 1.1.0 did not run.\n${text}`).toBe(false)
}

async function openBackupPage(page: Page): Promise<void> {
  await page.goto('/settings/backup')
  await expect(page.locator('[data-testid="settings-page"][aria-busy="false"]')).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByTestId('restore-backup-section')).toBeVisible()
}

async function answerOf(
  page: Page,
  route: ApiUrlMatcher,
  action: () => Promise<void>,
): Promise<BackupAnswer> {
  const [answer] = await Promise.all([
    page.waitForResponse(
      (response) => response.request().method() === 'POST' && route(new URL(response.url())),
      { timeout: 60_000 },
    ),
    action(),
  ])
  return answer
}

async function downloadBackup(page: Page, parts: readonly Part[]): Promise<Buffer> {
  await openBackupPage(page)
  const section = page.getByTestId('create-backup-section')
  for (const part of parts) {
    const box = section.getByTestId(`entity-checkbox-${part}`)
    await box.click()
    await expect(box).toBeChecked()
  }
  await expect(section.getByRole('checkbox', { checked: true })).toHaveCount(parts.length)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    section.getByRole('button', { name: 'Create & Download' }).click(),
  ])
  return fs.readFileSync((await download.path()) as string)
}

async function uploadArchive(page: Page, archive: Buffer, fileName: string): Promise<Json> {
  await openBackupPage(page)
  const answer = await answerOf(page, VALIDATE_ROUTE, () =>
    page
      .getByTestId('upload-input')
      .setInputFiles({ name: fileName, mimeType: 'application/zip', buffer: archive }),
  )
  expect(answer.status(), 'the preview is read').toBe(200)
  await expect(page.getByTestId('validation-preview')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('restore-validate-error')).toHaveCount(0)
  return (await answer.json()).data.entity_summary as Json
}

async function pickConflictChoice(page: Page, choice: 'overwrite' | 'rename'): Promise<void> {
  const radio = page.getByTestId(`cr-${choice}`)
  const answer = await answerOf(page, VALIDATE_ROUTE, () => radio.click())
  expect(answer.status(), 'the newer preview is read').toBe(200)
  await expect(radio).toBeChecked()
  await expect(page.getByTestId('restore-button')).toBeEnabled()
}

/** Restores on the page and waits for the read of the preview that follows the restore (BACKUP-5). */
async function restoreOnPage(page: Page, confirmOverwrite = false): Promise<Json> {
  const button = page.getByTestId('restore-button')
  await expect(button).toBeEnabled()
  const [answer, reread] = await Promise.all([
    answerOf(page, RESTORE_ROUTE, async () => {
      await button.click()
      if (confirmOverwrite) {
        await page
          .getByTestId('restore-overwrite-dialog')
          .getByRole('button', { name: 'Overwrite', exact: true })
          .click()
      }
    }),
    answerOf(page, VALIDATE_ROUTE, async () => {}),
  ])
  expect(answer.status(), 'the restore answers a result, not an error').toBe(200)
  expect(reread.status(), 'the preview is read again after the restore').toBe(200)
  await expect(page.getByTestId('restore-result')).toBeVisible()
  await expect(page.getByTestId('restore-backup-error')).toHaveCount(0)
  await expect(page.getByTestId('restore-validate-error')).toHaveCount(0)
  return (await answer.json()).data as Json
}

async function expectPartOrder(rows: Locator, prefix: string, parts: readonly Part[]): Promise<void> {
  await expect
    .poll(() => rows.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid'))))
    .toEqual(parts.map((part) => `${prefix}${part}`))
}

function namesListed(answer: Json): string[] {
  return Object.values(answer).flatMap((part) => ((part as Json).items as Json[]).map((item) => String(item.name)))
}

function entryLine(list: Locator, name: string): Locator {
  return list.getByTestId('restore-item').filter({ has: list.page().getByText(name, { exact: true }) })
}

async function expectEntry(list: Locator, name: string, status: EntryStatus, reason: string): Promise<void> {
  const line = entryLine(list, name)
  await expect(line, `"${name}" is listed once`).toHaveCount(1)
  await expect(line).toHaveAttribute('data-status', status)
  await expect(line.locator('span')).toHaveText([name, reason])
}

async function openList(page: Page, toggleId: string, itemsId: string, part: Part): Promise<Locator> {
  const toggle = page.getByTestId(`${toggleId}-${part}`)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toHaveAttribute('aria-label', `Expand ${part}`)
  await toggle.click()
  return openedList(page, toggleId, itemsId, part)
}

async function openedList(page: Page, toggleId: string, itemsId: string, part: Part): Promise<Locator> {
  const toggle = page.getByTestId(`${toggleId}-${part}`)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(toggle).toHaveAttribute('aria-label', `Collapse ${part}`)
  const list = page.getByTestId(`${itemsId}-${part}`)
  await expect(list).toBeVisible()
  return list
}

async function expectListedInEveryPart(
  page: Page,
  toggleId: string,
  itemsId: string,
  items: readonly Item[],
  status: EntryStatus,
): Promise<void> {
  for (const part of SEEDED_PARTS) {
    const list = await openList(page, toggleId, itemsId, part)
    for (const item of items.filter((entry) => entry.part === part)) {
      await expectEntry(list, item.name, status, ALREADY_HERE)
    }
  }
}

test.describe('V-BACKUP-RT: a backup restored on an empty WAVE gives back the same WAVE', () => {
  test.describe.configure({ mode: 'serial' })

  let seed: Ids
  let fullArchive: Buffer

  test.beforeAll(async ({ request }) => {
    await cleanUp(request)
  })

  test.afterAll(async ({ request }) => {
    await cleanUp(request)
  })

  test('V-BACKUP-RT-1: a backup made and restored on the page gives back every item under its ID, and the Suite runs (BACKUP-1, BACKUP-7, BACKUP-9, REQ-5.2.4.9.5)', async ({
    page,
    request,
  }) => {
    seed = await test.step('Seed the fixture; every Test validates and the Suite passes', async () => {
      const ids = await seedFixture(request)
      await expectSuitePasses(request, ids)
      return ids
    })
    const items = itemsOf(seed)

    fullArchive = await test.step('Tick the six seeded parts and press Create & Download', async () => {
      const archive = await downloadBackup(page, SEEDED_PARTS)
      const manifest = JSON.parse(readZipEntryText(archive, 'manifest.json')) as {
        entity_counts: Record<string, number>
      }
      expect(Object.keys(manifest.entity_counts), 'the archive holds the six ticked parts').toEqual([
        ...SEEDED_PARTS,
      ])
      const members = zipEntryNames(archive)
      for (const item of items) {
        const member = memberName(item.part, item.name, 'yaml')
        expect(members, `a member for ${item.name}`).toContain(member)
        expect(readZipEntryText(archive, member), `${member} holds the ID of ${item.name}`).toContain(item.id)
      }
      const fnAMember = readZipEntryText(archive, memberName('functions', FNA_NAME, 'yaml'))
      expect(fnAMember, 'version 1.0.0 of FnA is in its member').toContain(A_V1)
      expect(fnAMember, 'version 1.1.0 of FnA is in its member').toContain(A_V2)
      expect(readZipEntryText(archive, `tests/testdata/${seed.usesFnb}/sample.csv`)).toBe(SAMPLE_CSV)
      return archive
    })

    await test.step('Clean up: none of the seeded items is left', async () => {
      await cleanUp(request)
      await expectGone(request, items)
    })

    await test.step('Upload: a row per part in the order of the part list, no seeded item listed', async () => {
      const preview = await uploadArchive(page, fullArchive, `roundtrip-${RUN}.zip`)
      await expect(
        page.getByTestId('entity-summary-table').locator('thead th'),
        'the last count column is Errors (BACKUP-9)',
      ).toHaveText(PREVIEW_HEADERS)
      await expectPartOrder(
        page.getByTestId('entity-summary-table').locator('tbody > tr'),
        'entity-row-',
        SEEDED_PARTS,
      )
      const listed = namesListed(preview)
      for (const item of items) expect(listed, `${item.name} is in no entry list`).not.toContain(item.name)
      for (const part of SEEDED_PARTS) {
        await expect(page.getByTestId(`restore-checkbox-${part}`)).toBeChecked()
        await expect(page.getByTestId(`entity-row-toggle-${part}`), `${part} has nothing to list`).toHaveCount(0)
      }
    })

    await test.step('Restore: a line per part in the same order, nothing skipped or failed', async () => {
      const result = await restoreOnPage(page)
      await expectPartOrder(
        page.getByTestId('restore-result').locator('[data-testid^="restore-result-part-"]'),
        'restore-result-part-',
        SEEDED_PARTS,
      )
      const listed = namesListed(result)
      for (const item of items) expect(listed, `${item.name} was written`).not.toContain(item.name)
      for (const part of SEEDED_PARTS) {
        await expect(page.getByTestId(`restore-result-toggle-${part}`)).toHaveCount(0)
      }
    })

    await test.step('Every item is back under its ID with its content and its links', async () => {
      await readStored(request, items)
      await expectBackupContent(request, seed.usesFnb)
      await expectBothVersions(request, seed.fnA)
      await expectLinks(request, seed)
    })

    await test.step('The Suite passes with the restored Environment', async () => {
      await expectSuitePasses(request, seed)
    })
  })

  test('V-BACKUP-RT-2: the same archive again with Skip names every item as already here and changes nothing (BACKUP-2, BACKUP-3, BACKUP-4, BACKUP-6, BACKUP-9)', async ({
    page,
    request,
  }) => {
    const items = itemsOf(seed)
    const before = await readStored(request, items)

    await test.step('Upload: every part opens to its items, each a conflict', async () => {
      await uploadArchive(page, fullArchive, `roundtrip-${RUN}.zip`)
      await expect(page.getByTestId('conflict-resolution')).toBeVisible()
      await expect(page.getByTestId('cr-skip')).toBeChecked()
      await expectListedInEveryPart(page, 'entity-row-toggle', 'entity-row-items', items, 'conflict')
    })

    await test.step('Restore: every result line opens to its items, each skipped', async () => {
      await restoreOnPage(page)
      for (const part of SEEDED_PARTS) {
        await expect(page.getByTestId(`entity-row-toggle-${part}`), 'the preview rows close').toHaveAttribute(
          'aria-expanded',
          'false',
        )
      }
      await expectListedInEveryPart(page, 'restore-result-toggle', 'restore-result-items', items, 'skipped')
    })

    await test.step('No ID and no last update changed, and nothing was copied', async () => {
      expect(await readStored(request, items)).toEqual(before)
      for (const item of items) {
        expect(await idsNamed(request, item.part, item.name), `${item.name} is here once`).toEqual([item.id])
        expect(await idsNamed(request, item.part, `${item.name} (2)`)).toEqual([])
      }
    })

    await test.step('The Suite passes', async () => {
      await expectSuitePasses(request, seed)
    })
  })

  test('V-BACKUP-RT-3: Overwrite asks first, Cancel changes nothing, and Overwrite gives the Test here the content of the backup (BACKUP-5, BACKUP-8, REQ-5.2.4.9.5)', async ({
    page,
    request,
  }) => {
    const items = itemsOf(seed)
    const dialog = page.getByTestId('restore-overwrite-dialog')
    const restoreButton = page.getByTestId('restore-button')

    await test.step('Change the description of the Test here', async () => {
      await changeDescription(request, seed.usesFnb, CHANGED_DESCRIPTION, '1.2.0')
      const history = await read(request, `/tests/${seed.usesFnb}/history`)
      expect(history.versions, 'a third history row').toHaveLength(3)
    })

    await test.step('Upload and pick Overwrite: the items stay conflicts and the choice stays', async () => {
      await uploadArchive(page, fullArchive, `roundtrip-${RUN}.zip`)
      await pickConflictChoice(page, 'overwrite')
      await expect(page.getByTestId('conflict-resolution')).toBeVisible()
      await expect(page.getByTestId('cr-overwrite')).toBeChecked()
      await expectListedInEveryPart(page, 'entity-row-toggle', 'entity-row-items', items, 'conflict')
    })

    const restoresSent = countApiFetches(page, RESTORE_ROUTE, 'POST')

    await test.step('The first click on Restore asks and sends nothing', async () => {
      await restoreButton.click()
      await expect(dialog).toBeVisible()
      await expect(dialog).toHaveAttribute('role', 'alertdialog')
      await expect(dialog.getByRole('heading')).toHaveText(OVERWRITE_TITLE)
      await expect(dialog.getByText(OVERWRITE_BODY, { exact: true })).toBeVisible()
      expect(restoresSent(), 'no restore was sent').toBe(0)
    })

    await test.step('Cancel closes the dialog and the Test here keeps its change', async () => {
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page.getByTestId('restore-result')).toHaveCount(0)
      await expect(page.getByTestId('cr-overwrite')).toBeChecked()
      for (const part of SEEDED_PARTS) {
        await expect(page.getByTestId(`restore-checkbox-${part}`)).toBeChecked()
      }
      expect(restoresSent(), 'no restore was sent').toBe(0)
      const document = await read(request, `/tests/${seed.usesFnb}`)
      expect(document.description).toBe(CHANGED_DESCRIPTION)
      expect(document.version).toBe('1.2.0')
    })

    await test.step('Restore, then Overwrite in the dialog, starts the restore', async () => {
      await restoreOnPage(page, true)
      await expect(dialog).toHaveCount(0)
      expect(restoresSent(), 'one restore was sent').toBe(1)
    })

    await test.step('The Test has its ID and the content of the backup; the Suite still lists it', async () => {
      await readStored(request, items)
      await expectBackupContent(request, seed.usesFnb)
      await expectBothVersions(request, seed.fnA)
      await expectLinks(request, seed)
      for (const item of items) {
        expect(await idsNamed(request, item.part, item.name), `${item.name} is here once`).toEqual([item.id])
      }
    })

    await test.step('The Suite passes', async () => {
      await expectSuitePasses(request, seed)
    })
  })

  test('V-BACKUP-RT-4: Rename brings every item in beside the one here and the links follow the copies (BACKUP-5, REQ-5.2.4.9.5)', async ({
    page,
    request,
  }) => {
    const items = itemsOf(seed)
    const before = await readStored(request, items)

    await test.step('Upload, pick Rename and restore', async () => {
      await uploadArchive(page, fullArchive, `roundtrip-${RUN}.zip`)
      await pickConflictChoice(page, 'rename')
      const result = await restoreOnPage(page)
      const listed = namesListed(result)
      for (const item of items) expect(listed, `${item.name} was written`).not.toContain(item.name)
    })

    const copies = await test.step('Every item is still here and has a copy named "<name> (2)" under a new ID', async () => {
      expect(await readStored(request, items)).toEqual(before)
      const found = { ...seed }
      for (const item of items) {
        expect(await idsNamed(request, item.part, item.name), `${item.name} is here once`).toEqual([item.id])
        const copyIds = await idsNamed(request, item.part, `${item.name} (2)`)
        expect(copyIds, `one copy named "${item.name} (2)"`).toHaveLength(1)
        expect(copyIds[0], 'the copy has a new ID').not.toBe(item.id)
        found[item.key] = copyIds[0]
      }
      await expectLinks(request, seed)
      return found
    })

    await test.step('The links follow the copies', async () => {
      await readStored(request, itemsOf(copies, ' (2)'))
      await expectLinks(request, copies)
      await expectBackupContent(request, copies.usesFnb)
      await expectBothVersions(request, copies.fnA)
    })

    await test.step('The renamed Suite passes with the renamed Environment', async () => {
      await expectSuitePasses(request, copies)
    })
  })

  test('V-BACKUP-RT-5: a Test whose Function is missing is left out and named, and the rest is restored (BACKUP-2, BACKUP-4, BACKUP-6, BACKUP-9, REQ-5.2.4.9.6)', async ({
    page,
    request,
  }) => {
    seed = await test.step('Clean up and seed again', async () => {
      await cleanUp(request)
      return seedFixture(request)
    })
    const items = itemsOf(seed)
    const fatal = [
      { name: USES_FNB_NAME, id: seed.usesFnb, block: CALL_FNB.label },
      { name: NESTED_NAME, id: seed.nested, block: INNER_CALL.label },
    ]

    const archive = await test.step('Make an archive of five parts, Functions not ticked', async () => {
      const made = await downloadBackup(page, PARTS_WITHOUT_FUNCTIONS)
      await expect(
        page.getByTestId('create-backup-section').getByTestId('entity-checkbox-functions'),
      ).not.toBeChecked()
      const members = zipEntryNames(made)
      expect(members.filter((member) => member.startsWith('functions/')), 'no Function member').toEqual([])
      for (const item of items.filter((entry) => entry.part !== 'functions')) {
        expect(members, `a member for ${item.name}`).toContain(memberName(item.part, item.name, 'yaml'))
      }
      return made
    })

    await test.step('Clean up: the Functions are gone too', async () => {
      await cleanUp(request)
      await expectGone(request, items)
    })

    await test.step('Upload: the Tests row is open and names both Tests fatal', async () => {
      await uploadArchive(page, archive, `no-functions-${RUN}.zip`)
      await expectPartOrder(
        page.getByTestId('entity-summary-table').locator('tbody > tr:not([data-testid^="entity-row-items-"])'),
        'entity-row-',
        PARTS_WITHOUT_FUNCTIONS,
      )
      const list = await openedList(page, 'entity-row-toggle', 'entity-row-items', 'tests')
      for (const entry of fatal) {
        await expectEntry(list, entry.name, 'fatal', cannotBeRestored(missingInBackupAndHere(entry.block)))
      }
      await expect(entryLine(list, PLAIN_NAME)).toHaveCount(0)
    })

    await test.step('Restore: a result whose Tests line is open and names both Tests fatal', async () => {
      const result = await restoreOnPage(page)
      expect(Object.keys(result), 'a result for every ticked part').toEqual([...PARTS_WITHOUT_FUNCTIONS])
      const list = await openedList(page, 'restore-result-toggle', 'restore-result-items', 'tests')
      for (const entry of fatal) {
        await expectEntry(list, entry.name, 'fatal', notRestored(missingHere(entry.block)))
      }
      await expect(entryLine(list, PLAIN_NAME)).toHaveCount(0)
    })

    await test.step('A result line counts failed items only when it has some (BACKUP-9)', async () => {
      await expect(
        page.getByTestId('restore-result').locator('[data-testid^="restore-result-line-"]'),
      ).toHaveText(
        [
          'Tests: 1 imported, 0 skipped, 2 failed',
          'Environments: 1 imported, 0 skipped',
          'Profiles: 1 imported, 0 skipped',
          'Suites: 1 imported, 0 skipped',
          'Regressions: 1 imported, 0 skipped',
        ],
        { useInnerText: true },
      )
    })

    await test.step('The rest is back under its ID and neither fatal Test exists', async () => {
      const restored = items.filter(
        (item) => item.part !== 'functions' && item.key !== 'usesFnb' && item.key !== 'nested',
      )
      expect(restored.map((item) => item.name)).toEqual([
        PLAIN_NAME,
        ENV_NAME,
        PROFILE_NAME,
        SUITE_NAME,
        REGRESSION_NAME,
      ])
      await readStored(request, restored)
      for (const entry of fatal) {
        expect(await statusOf(request, `/tests/${entry.id}`), `${entry.name} was not written`).toBe(404)
        expect(await idsNamed(request, 'tests', entry.name)).toEqual([])
      }
      expect(await idsNamed(request, 'functions', FNA_NAME), 'no Function was written').toEqual([])
      expect(await idsNamed(request, 'functions', FNB_NAME), 'no Function was written').toEqual([])
    })
  })

  test('V-BACKUP-RT-6: unticking Functions turns the Tests that need them fatal in the preview (BACKUP-2, BACKUP-5, BACKUP-6)', async ({
    page,
    request,
  }) => {
    const functionsBox = page.getByTestId('restore-checkbox-functions')
    const restoreButton = page.getByTestId('restore-button')
    const testsList = page.getByTestId('entity-row-items-tests')
    let holdMs = 0
    await delayApiRoute(page, VALIDATE_ROUTE, () => holdMs, 'POST')

    await test.step('Clean up and upload the six-part archive: no seeded item is listed', async () => {
      await cleanUp(request)
      const preview = await uploadArchive(page, fullArchive, `roundtrip-${RUN}.zip`)
      const listed = namesListed(preview)
      for (const name of [USES_FNB_NAME, NESTED_NAME, PLAIN_NAME, FNA_NAME, FNB_NAME]) {
        expect(listed, `${name} is in no entry list`).not.toContain(name)
      }
      for (const part of SEEDED_PARTS) {
        await expect(page.getByTestId(`entity-row-toggle-${part}`), `${part} has nothing to list`).toHaveCount(0)
      }
      await expect(functionsBox).toBeChecked()
      await expect(restoreButton).toBeEnabled()
    })

    await test.step('Untick Functions: Restore waits for the newer preview', async () => {
      holdMs = 5_000
      const answer = await answerOf(page, VALIDATE_ROUTE, async () => {
        await functionsBox.click()
        await expect(functionsBox).not.toBeChecked()
        await expect(restoreButton).toBeDisabled()
        await expect(testsList, 'the last preview stays while the newer one loads').toHaveCount(0)
      })
      holdMs = 0
      expect(answer.status()).toBe(200)
    })

    await test.step('The Tests row opens and names both Tests fatal; the Functions row stays', async () => {
      const list = await openedList(page, 'entity-row-toggle', 'entity-row-items', 'tests')
      await expectEntry(list, USES_FNB_NAME, 'fatal', cannotBeRestored(missingHere(CALL_FNB.label)))
      await expectEntry(list, NESTED_NAME, 'fatal', cannotBeRestored(missingHere(INNER_CALL.label)))
      await expect(entryLine(list, PLAIN_NAME)).toHaveCount(0)
      await expect(page.getByTestId('entity-row-functions')).toBeVisible()
      await expect(functionsBox).not.toBeChecked()
      await expect(restoreButton).toBeEnabled()
    })

    await test.step('Tick Functions again: the Tests row names nothing', async () => {
      const answer = await answerOf(page, VALIDATE_ROUTE, () => functionsBox.click())
      expect(answer.status()).toBe(200)
      const listed = namesListed((await answer.json()).data.entity_summary as Json)
      expect(listed).not.toContain(USES_FNB_NAME)
      expect(listed).not.toContain(NESTED_NAME)
      await expect(functionsBox).toBeChecked()
      await expect(testsList).toHaveCount(0)
      await expect(page.getByTestId('entity-row-toggle-tests')).toHaveCount(0)
      await expect(restoreButton).toBeEnabled()
    })

    await test.step('The previews wrote nothing', async () => {
      for (const name of [USES_FNB_NAME, NESTED_NAME, PLAIN_NAME]) {
        expect(await idsNamed(request, 'tests', name), `${name} was not written`).toEqual([])
      }
    })
  })

  test('V-BACKUP-RT-7: a profile without a type is left out with auto-repair off and written as custom with it on (BACKUP-4, BACKUP-5, BACKUP-6, REQ-5.2.4.9.6)', async ({
    page,
    request,
  }) => {
    const autoRepair = page.getByTestId('auto-repair-toggle')

    const made = await test.step('Clean up; make two profiles of type custom', async () => {
      await cleanUp(request)
      const noType = (await create(request, '/profiles', { name: NO_TYPE_PROFILE_NAME, type: 'custom', tags: [] }))
        .id as string
      const typed = (await create(request, '/profiles', { name: TYPED_PROFILE_NAME, type: 'custom', tags: [] }))
        .id as string
      return { noType, typed }
    })

    const archive = await test.step('Make a JSON backup of Profiles and drop the type of one member', async () => {
      const backup = await request.post(`${BACKEND_URL}/api/backup/create`, {
        data: {
          entity_types: ['profiles'],
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
        if (document.id !== made.noType) return { name: entry.name, data }
        expect(document.type, 'the member holds the type before it is dropped').toBe('custom')
        delete document.type
        changed.push(entry.name)
        return { name: entry.name, data: Buffer.from(JSON.stringify(document, null, 2), 'utf-8') }
      })
      expect(changed, 'one member lost its type').toHaveLength(1)
      const rebuilt = buildZip(members)
      expect(Object.keys(JSON.parse(readZipEntryText(rebuilt, changed[0])))).not.toContain('type')
      for (const member of members) expect(readZipEntry(rebuilt, member.name).equals(member.data)).toBe(true)
      return rebuilt
    })

    await test.step('Delete both profiles', async () => {
      for (const id of [made.noType, made.typed]) {
        expect((await request.delete(`${BACKEND_URL}/profiles/${id}`)).status()).toBe(204)
        expect(await statusOf(request, `/profiles/${id}`)).toBe(404)
      }
    })

    await test.step('Upload: the auto-repair switch shows and the profile is in no entry list', async () => {
      const preview = await uploadArchive(page, archive, `no-type-${RUN}.zip`)
      await expect(autoRepair).toBeVisible()
      await expect(autoRepair).not.toBeChecked()
      expect(namesListed(preview), 'a fixable item is not listed').not.toContain(NO_TYPE_PROFILE_NAME)
      await expect(page.getByTestId('entity-row-toggle-profiles'), 'Profiles has nothing to list').toHaveCount(0)
    })

    await test.step('Restore with auto-repair off: the profile is named fatal and is not written', async () => {
      await restoreOnPage(page)
      const list = await openedList(page, 'restore-result-toggle', 'restore-result-items', 'profiles')
      await expectEntry(list, NO_TYPE_PROFILE_NAME, 'fatal', notRestored(NO_TYPE))
      await expect(entryLine(list, TYPED_PROFILE_NAME)).toHaveCount(0)
      expect(await statusOf(request, `/profiles/${made.noType}`), 'the profile was not written').toBe(404)
      expect((await read(request, `/profiles/${made.typed}`)).name).toBe(TYPED_PROFILE_NAME)
    })

    await test.step('Turn auto-repair on and wait for the newer preview', async () => {
      const answer = await answerOf(page, VALIDATE_ROUTE, () => autoRepair.click())
      expect(answer.status()).toBe(200)
      const preview = (await answer.json()).data.entity_summary as Json
      expect(namesListed(preview), 'a fixable item is not listed').not.toContain(NO_TYPE_PROFILE_NAME)
      await expect(autoRepair).toBeChecked()
      await expect(page.getByTestId('restore-button')).toBeEnabled()
    })

    await test.step('Restore: the profile is written under its ID as type custom', async () => {
      const result = await restoreOnPage(page)
      expect(namesListed(result), 'the profile was written').not.toContain(NO_TYPE_PROFILE_NAME)
      const list = await openList(page, 'restore-result-toggle', 'restore-result-items', 'profiles')
      await expectEntry(list, TYPED_PROFILE_NAME, 'skipped', ALREADY_HERE)
      await expect(entryLine(list, NO_TYPE_PROFILE_NAME)).toHaveCount(0)
      const written = await read(request, `/profiles/${made.noType}`)
      expect(written.id).toBe(made.noType)
      expect(written.name).toBe(NO_TYPE_PROFILE_NAME)
      expect(written.type).toBe('custom')
    })
  })
  test('V-BACKUP-RT-8: after a restore the preview lists the Test just restored as a conflict, and Overwrite asks before it writes over it (BACKUP-5, BACKUP-8)', async ({
    page,
    request,
  }) => {
    const dialog = page.getByTestId('restore-overwrite-dialog')
    const restoreButton = page.getByTestId('restore-button')
    const environmentsBox = page.getByTestId('restore-checkbox-environments')
    const testsToggle = page.getByTestId('entity-row-toggle-tests')

    const made = await test.step('Clean up; make an Environment and a Test', async () => {
      await cleanUp(request)
      const environment = (
        await create(request, '/environments', { name: STAYS_ENV_NAME, description: 'Stays in this WAVE' })
      ).id as string
      const testId = (
        await create(request, '/tests', {
          name: COMES_BACK_NAME,
          version: '1.0.0',
          description: COMES_BACK_DESCRIPTION,
          workflow: {
            nodes: [logNode('comes-back-log', 'Comes back log', `'comes back ${RUN}'`)],
            edges: [startEdge('comes-back-log')],
          },
          variables: {},
          metadata: { owner: OWNER, tags: TEST_TAGS },
        })
      ).id as string
      const validation = await validateTest(request, testId)
      expect(validation.status, `validate of ${testId}: ${JSON.stringify(validation.errors)}`).toBe(200)
      expect(validation.errors, 'the seeded Test validates with zero errors').toEqual([])
      return { environment, testId }
    })

    const archive = await test.step('Back up Tests and Environments, then delete the Test', async () => {
      const backup = await downloadBackup(page, ['tests', 'environments'])
      const deleted = await request.delete(`${BACKEND_URL}/tests/${made.testId}`)
      expect(deleted.ok(), `DELETE /tests/${made.testId} answered ${deleted.status()}`).toBeTruthy()
      expect(await statusOf(request, `/tests/${made.testId}`), 'the Test is not here').toBe(404)
      return backup
    })

    await test.step('Upload, pick Overwrite and untick Environments: no ticked part has a conflict', async () => {
      const preview = await uploadArchive(page, archive, `comes-back-${RUN}.zip`)
      expect(namesListed(preview), 'the Environment is here').toContain(STAYS_ENV_NAME)
      expect(namesListed(preview), 'the Test is not here').not.toContain(COMES_BACK_NAME)
      await pickConflictChoice(page, 'overwrite')
      const answer = await answerOf(page, VALIDATE_ROUTE, () => environmentsBox.click())
      expect(answer.status(), 'the newer preview is read').toBe(200)
      await expect(environmentsBox).not.toBeChecked()
      await expect(restoreButton).toBeEnabled()
      await expect(testsToggle, 'Tests has nothing to list').toHaveCount(0)
    })

    const restoresSent = countApiFetches(page, RESTORE_ROUTE, 'POST')

    await test.step('Restore starts without asking and writes the Test', async () => {
      const result = await restoreOnPage(page)
      await expect(dialog).toHaveCount(0)
      expect(Object.keys(result), 'a result for the ticked part').toEqual(['tests'])
      expect(namesListed(result), 'the Test was written').not.toContain(COMES_BACK_NAME)
      const written = await read(request, `/tests/${made.testId}`)
      expect(written.name).toBe(COMES_BACK_NAME)
      expect(written.description).toBe(COMES_BACK_DESCRIPTION)
      expect(restoresSent(), 'one restore was sent').toBe(1)
    })

    await test.step('The preview is read again and lists the Test just restored as a conflict', async () => {
      await expect(testsToggle, 'the Tests row lists the Test just restored').toHaveCount(1)
      const list = await openList(page, 'entity-row-toggle', 'entity-row-items', 'tests')
      await expectEntry(list, COMES_BACK_NAME, 'conflict', ALREADY_HERE)
      await expect(page.getByTestId('cr-overwrite')).toBeChecked()
      await expect(environmentsBox).not.toBeChecked()
      await expect(restoreButton).toBeEnabled()
    })

    await test.step('Change the Test here: Restore asks first, and Cancel keeps the change', async () => {
      await changeDescription(request, made.testId, CHANGED_DESCRIPTION, '1.1.0')
      await restoreButton.click()
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('heading')).toHaveText(OVERWRITE_TITLE)
      expect(restoresSent(), 'no second restore was sent').toBe(1)
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      expect(restoresSent(), 'no second restore was sent').toBe(1)
      expect((await read(request, `/tests/${made.testId}`)).description).toBe(CHANGED_DESCRIPTION)
    })

    await test.step('Restore, then Overwrite in the dialog, gives the Test the description of the backup', async () => {
      await restoreOnPage(page, true)
      await expect(dialog).toHaveCount(0)
      expect(restoresSent(), 'the second restore was sent').toBe(2)
      const document = await read(request, `/tests/${made.testId}`)
      expect(document.id).toBe(made.testId)
      expect(document.description).toBe(COMES_BACK_DESCRIPTION)
      expect((await read(request, `/environments/${made.environment}`)).name).toBe(STAYS_ENV_NAME)
    })
  })
})
