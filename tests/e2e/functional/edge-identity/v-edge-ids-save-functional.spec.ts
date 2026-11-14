/**
 * V-EDGE-IDS-SAVE-FUNCTIONAL: every client path refuses a workflow whose wires repeat an id
 *
 * REQ: REQ-5.2.4.3 (Error Code Taxonomy: DUPLICATE_EDGE_ID, the save refuses the workflow as sent),
 *      REQ-3.1.2.4 (Function validation before save), REQ-5.2.4.9 and REQ-5.2.4.9.6 (import and restore),
 *      REQ-3.2.1.1 (the run gate)
 *
 * Pass Criteria:
 * 1. POST /tests answers 422 with the one finding "Edge ID 'e-repeat' is used by more than one edge"
 *    and stores no Test of that name.
 * 2. PUT /tests/{id} answers 422 with the same finding and keeps the stored wires as they were.
 * 3. A Local Function body whose wires repeat an id is refused at POST /tests with the same finding,
 *    on the Function Block, and no Test is stored.
 * 4. POST /functions answers 422 with the same finding and stores no Function of that name.
 * 5. The import preview marks the Test blocked with the finding, and POST /tests/import answers 422
 *    with code DUPLICATE_EDGE_ID and the finding, storing nothing.
 * 6. The backup restore preview lists the Test as fatal with the finding as its reason, and the
 *    restore lists it fatal with the same reason and writes nothing.
 * 7. A run of an unsaved workflow that repeats a wire id, and a run of a stored Test that does, are
 *    refused with "Cannot run test: validation errors: <finding>".
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import {
  cleanUp,
  functionIdsNamed,
  libraryFunction,
  localFunctionBlock,
  storedTest,
  testIdsNamed,
} from '../../helpers/fn-block'
import { rawPersistTest } from '../../helpers/fn-seed'
import { resolveEnvironmentId } from '../../helpers/k8s-run'
import { buildZip } from '../../helpers/zip-writer'
import {
  DUPLICATE_EDGE_ID,
  REPEATED_ID,
  answerOf,
  cleanTest,
  expectSaveRefused,
  repeatedIdMessage,
  repeatedTest,
  uniqueName,
  wireRows,
  type TestDocument,
  type Wire,
} from './edge-ids'

const FINDING: [string, string] = [DUPLICATE_EDGE_ID, repeatedIdMessage(REPEATED_ID)]
const FN_BLOCK = 'ei-fn'

/** A library Function name under the 32 character cap. */
function functionName(): string {
  return `v-edge-ids-fn-${randomUUID().slice(0, 6)}`
}

async function postTestDocument(request: APIRequestContext, doc: TestDocument) {
  return answerOf(await request.post(`${BACKEND_URL}/tests`, { data: doc }))
}

/** Every Test stored under `name`, kept for clean up; the caller asserts the list. */
async function storedNamed(request: APIRequestContext, name: string, keep: string[]): Promise<string[]> {
  const ids = await testIdsNamed(request, name)
  keep.push(...ids)
  return ids
}

function jsonFile(name: string, doc: TestDocument) {
  return { name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc), 'utf-8') }
}

/** A backup archive holding only `doc`, in the JSON format a backup writes. */
function backupOf(doc: TestDocument & { id: string }): Buffer {
  const manifest = {
    wave_version: '1.0.0',
    created_at: new Date().toISOString(),
    entity_counts: { tests: 1 },
    compression: { method: 'stored', level: 0 },
    format: 'json',
    secrets: 'mask',
    schema_version: '1.0',
  }
  return buildZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest), 'utf-8') },
    { name: `tests/${doc.id}.json`, data: Buffer.from(JSON.stringify(doc), 'utf-8') },
  ])
}

test.describe('V-EDGE-IDS-SAVE-FUNCTIONAL: a workflow whose wires repeat an id is refused as sent', () => {
  const testIds: string[] = []
  const functionIds: string[] = []

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds, functionIds)
  })

  test('POST /tests refuses it and stores nothing', async ({ request }) => {
    const doc = repeatedTest(uniqueName('create'))
    const answer = await postTestDocument(request, doc)
    const stored = await storedNamed(request, doc.name, testIds)

    expectSaveRefused(answer, 'POST /tests', 'Test')
    expect(stored, 'no Test of that name is stored').toEqual([])
  })

  test('PUT /tests/{id} refuses it and keeps the stored wires', async ({ request }) => {
    const doc = cleanTest(uniqueName('update'))
    const created = await postTestDocument(request, doc)
    expect(created.status, `POST /tests of the clean Test: ${JSON.stringify(created.body)}`).toBe(201)
    const testId = String(created.body?.data?.id)
    testIds.push(testId)

    const { workflow } = repeatedTest('unused')
    const answer = await answerOf(await request.put(`${BACKEND_URL}/tests/${testId}`, { data: { workflow } }))

    expectSaveRefused(answer, `PUT /tests/${testId}`, 'Test')
    const stored = (await storedTest(request, testId)).workflow as { edges: Wire[] }
    expect(wireRows(stored.edges), 'the stored wires are the ones saved before').toEqual(wireRows(doc.workflow.edges))
  })

  test('a Local Function body that repeats a wire id is refused at POST /tests', async ({ request }) => {
    const name = uniqueName('local')
    const body = repeatedTest('unused').workflow
    const doc: TestDocument = {
      ...repeatedTest(name),
      workflow: {
        nodes: [localFunctionBlock(FN_BLOCK, 'ei_body', { nodes: body.nodes, edges: body.edges })],
        edges: [{ id: 'e-ei-start-fn', source: 'start-node', target: FN_BLOCK }],
      },
    }
    const answer = await postTestDocument(request, doc)
    const stored = await storedNamed(request, name, testIds)

    expectSaveRefused(answer, 'POST /tests', 'Test')
    const details = (answer.error?.details ?? []) as Array<Record<string, unknown>>
    expect(details.map((d) => d.node_id), 'the finding is on the Function Block').toEqual([FN_BLOCK])
    expect(stored, 'no Test of that name is stored').toEqual([])
  })

  test('POST /functions refuses it and stores nothing', async ({ request }) => {
    const name = functionName()
    const { workflow } = repeatedTest('unused')
    const answer = await answerOf(
      await request.post(`${BACKEND_URL}/functions`, {
        data: libraryFunction(name, { nodes: workflow.nodes, edges: workflow.edges }),
      }),
    )
    const stored = await functionIdsNamed(request, name)
    functionIds.push(...stored)

    expectSaveRefused(answer, 'POST /functions', 'Function')
    expect(stored, 'no Function of that name is stored').toEqual([])
  })

  test('the import preview blocks it and the import answers 422, storing nothing', async ({ request }) => {
    const doc = repeatedTest(uniqueName('import'))

    await test.step('POST /tests/import/validate marks the Test blocked with the finding', async () => {
      const resp = await request.post(`${BACKEND_URL}/tests/import/validate`, {
        multipart: { file: jsonFile('v-edge-ids-import.json', doc) },
      })
      expect(resp.ok(), `POST /tests/import/validate answered ${resp.status()}`).toBeTruthy()
      const data = (await resp.json()).data as {
        tests: Array<{ name: string; status: string; fatal_errors: Array<{ code: string; message: string }> }>
        importable: number
        blocked: number
      }
      expect(data.tests.map((t) => t.name)).toEqual([doc.name])
      expect(data.tests[0].status, 'the Test is blocked').toBe('fatal')
      expect(data.tests[0].fatal_errors.map((e) => [e.code, e.message]), 'the preview names the repeated id').toEqual([
        FINDING,
      ])
      expect([data.importable, data.blocked], 'nothing is importable').toEqual([0, 1])
    })

    await test.step('POST /tests/import answers 422 with the finding and stores nothing', async () => {
      const answer = await answerOf(
        await request.post(`${BACKEND_URL}/tests/import`, {
          multipart: { file: jsonFile('v-edge-ids-import.json', doc), conflict_resolutions: '{}' },
        }),
      )
      const stored = await storedNamed(request, doc.name, testIds)

      expect(answer.status, `POST /tests/import answered ${answer.status}: ${JSON.stringify(answer.body)}`).toBe(422)
      expect(answer.error?.code).toBe(DUPLICATE_EDGE_ID)
      expect(answer.error?.message).toBe(`Cannot import test '${doc.name}'. ${repeatedIdMessage(REPEATED_ID)}`)
      expect(answer.findings).toEqual([FINDING])
      expect(stored, 'no Test of that name is stored').toEqual([])
    })
  })

  test('the backup restore preview and the restore name the Test as not restorable', async ({ request }) => {
    const doc = { ...repeatedTest(uniqueName('backup')), id: randomUUID() }
    const file = { name: 'v-edge-ids-backup.zip', mimeType: 'application/zip', buffer: backupOf(doc) }
    const notRestored = { name: doc.name, status: 'fatal', reason: repeatedIdMessage(REPEATED_ID) }

    await test.step('POST /api/backup/validate lists the Test as fatal with the finding as its reason', async () => {
      const resp = await request.post(`${BACKEND_URL}/api/backup/validate`, { multipart: { file } })
      const body = await resp.json().catch(() => null)
      expect(resp.status(), `POST /api/backup/validate: ${JSON.stringify(body)}`).toBe(200)
      const tests = body.data.entity_summary.tests
      expect([tests.total, tests.ok, tests.fatal], 'the one Test cannot be restored').toEqual([1, 0, 1])
      expect(tests.items).toEqual([notRestored])
    })

    await test.step('POST /api/backup/restore lists it fatal with the same reason and writes nothing', async () => {
      const resp = await request.post(`${BACKEND_URL}/api/backup/restore`, { multipart: { file } })
      const body = await resp.json().catch(() => null)
      const read = await request.get(`${BACKEND_URL}/tests/${doc.id}`)
      if (read.ok()) testIds.push(doc.id)
      testIds.push(...(await testIdsNamed(request, doc.name)).filter((id) => id !== doc.id))

      expect(resp.status(), `POST /api/backup/restore: ${JSON.stringify(body)}`).toBe(200)
      const tests = body.data.tests
      expect([tests.imported, tests.fatal], 'nothing is restored').toEqual([0, 1])
      expect(tests.items).toEqual([notRestored])
      expect(read.status(), 'the Test of the backup is not stored').toBe(404)
    })
  })

  test('the run gate refuses an unsaved workflow and a stored Test that repeat a wire id', async ({ request }) => {
    const environmentId = await resolveEnvironmentId(request)
    const refusal = `Cannot run test: validation errors: ${repeatedIdMessage(REPEATED_ID)}`

    await test.step('A run of the canvas as it stands, sent unsaved, is refused', async () => {
      await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
      const doc = cleanTest(uniqueName('run-unsaved'))
      const created = await postTestDocument(request, doc)
      expect(created.status, `POST /tests of the clean Test: ${JSON.stringify(created.body)}`).toBe(201)
      const testId = String(created.body?.data?.id)
      testIds.push(testId)

      const answer = await answerOf(
        await request.post(`${BACKEND_URL}/workbench/run`, {
          data: {
            test_id: testId,
            environment_id: environmentId,
            workflow: repeatedTest('unused').workflow,
            variables: {},
          },
        }),
      )
      expect(answer.status, `POST /workbench/run answered ${answer.status}: ${JSON.stringify(answer.body)}`).toBe(400)
      expect([answer.error?.code, answer.error?.message]).toEqual(['VALIDATION_ERROR', refusal])
    })

    await test.step('A run of a stored Test that repeats a wire id is refused', async () => {
      await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
      const doc = repeatedTest(uniqueName('run-stored'))
      // The save refuses this Test, so it is stored through the admin bulk route.
      const testId = await rawPersistTest(request, {
        name: doc.name,
        nodes: doc.workflow.nodes,
        edges: doc.workflow.edges,
        variables: doc.variables,
      })
      testIds.push(testId)

      const answer = await answerOf(
        await request.post(`${BACKEND_URL}/workbench/run`, {
          data: { test_id: testId, environment_id: environmentId },
        }),
      )
      expect(answer.status, `POST /workbench/run answered ${answer.status}: ${JSON.stringify(answer.body)}`).toBe(400)
      expect([answer.error?.code, answer.error?.message]).toEqual(['VALIDATION_ERROR', refusal])
    })
  })
})
