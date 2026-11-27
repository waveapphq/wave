/**
 * V-ARTIFACT-ID-CONTAINMENT: an artifact id names one stored artifact, however it is spelled
 * Design Decisions: ARTIF-11 (a delete frees the bytes and leaves a tombstone; an
 *   execution in progress keeps its artifacts)
 * REQ: REQ-5.2.4.12
 *
 * An id is the execution folder name and the artifact's path inside it. The same
 * file can be named with a dot segment in front (`./<folder>/<file>`, sent with
 * an encoded slash so no client folds it away). Every rule the artifact routes
 * hold must hold for that spelling too.
 *
 * Pass Criteria:
 * 1. An artifact of a running execution cannot be deleted through a dot-segment
 *    spelling: the delete answers 409 naming the execution, and the file stays.
 * 2. The metadata of a dot-segment spelling names the artifact and its execution
 *    the way the plain id does.
 * 3. A delete through a dot-segment spelling records the artifact's own path in
 *    its tombstone, so the removed listing shows the path the artifact had.
 * 4. The workbench sessions area stays out of reach of the artifact routes with a
 *    dot segment in front: content and delete answer 400 with the id, and the
 *    session file stays.
 *
 * Run: ./scripts/e2e/e2e-targeted-local.sh functional/artifact-browser/v-artifact-id-containment-functional.spec.ts
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, STORAGE_BASE_PATH } from '../../helpers/config'
import { createValidTest, delayNode, startEdge } from '../../helpers/fn-seed'
import { resolveEnvironmentId } from '../../helpers/k8s-run'

const ARTIFACT_ROOT = path.join(STORAGE_BASE_PATH, 'artifacts')
const PLANTED = 'planted.txt'
const PLANTED_BYTES = 'planted by the spec\n'
const IN_PROGRESS_MESSAGE = 'Cannot delete artifact of an execution in progress'
// The run is stopped by the spec, so it must outlive every step.
const HOLD_RUN_MS = 120_000
const TERMINAL = new Set(['passed', 'failed', 'stopped', 'skipped'])

let testId = ''
const startedExecutions: string[] = []

/** An id with a dot segment in front, its slashes encoded so the request keeps it whole. */
function dotSpelled(id: string): string {
  return encodeURIComponent(`./${id}`)
}

async function executionStatus(request: APIRequestContext, executionId: string): Promise<string> {
  const response = await request.get(`${BACKEND_URL}/executions/${executionId}`)
  const body = await response.json().catch(() => null)
  return ((body?.data ?? {}) as { status?: string }).status ?? ''
}

/** Start a tracked run of the held Test and return its id and its artifact folder name. */
async function startHeldRun(request: APIRequestContext): Promise<{ executionId: string; dir: string }> {
  const response = await request.post(`${BACKEND_URL}/executions`, {
    data: { type: 'test', id: testId, environment_id: await resolveEnvironmentId(request) },
  })
  expect(response.ok(), `POST /executions failed: ${response.status()} ${await response.text()}`).toBeTruthy()
  const executionId = ((await response.json()).data as { id: string }).id
  startedExecutions.push(executionId)
  const dir = fs.readdirSync(ARTIFACT_ROOT).find((name) => name.endsWith(`-${executionId}`))
  expect(dir, `the run's artifact folder must exist under ${ARTIFACT_ROOT}`).toBeTruthy()
  return { executionId, dir: dir as string }
}

async function stopRun(request: APIRequestContext, executionId: string): Promise<void> {
  await request.put(`${BACKEND_URL}/executions/${executionId}/stop`).catch(() => undefined)
  await expect
    .poll(async () => TERMINAL.has(await executionStatus(request, executionId)), {
      timeout: 30_000,
      message: `execution ${executionId} must settle after the stop`,
    })
    .toBe(true)
}

function plant(dir: string): string {
  const file = path.join(ARTIFACT_ROOT, dir, PLANTED)
  fs.writeFileSync(file, PLANTED_BYTES)
  return file
}

test.describe('V-ARTIFACT-ID-CONTAINMENT: every artifact rule holds for a dot-segment spelling', () => {
  test.beforeAll(async ({ request }) => {
    testId = await createValidTest(request, {
      name: `ARTIFACT-ID-CONTAINMENT Hold ${Date.now()}-${randomUUID().slice(0, 6)}`,
      nodes: [delayNode('artifact-id-hold', 'Hold', HOLD_RUN_MS)],
      edges: [startEdge('artifact-id-hold')],
    })
  })

  test.afterEach(async ({ request }) => {
    for (const executionId of startedExecutions.splice(0)) {
      await stopRun(request, executionId)
      await request.delete(`${BACKEND_URL}/executions/${executionId}`).catch(() => undefined)
    }
  })

  test.afterAll(async ({ request }) => {
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
  })

  test('an artifact of a running execution cannot be deleted through a dot-segment spelling', async ({
    request,
  }) => {
    const { executionId, dir } = await startHeldRun(request)
    const file = plant(dir)
    expect(await executionStatus(request, executionId), 'the run is still in progress').toBe('running')

    const plain = await request.delete(`${BACKEND_URL}/artifacts/${dir}/${PLANTED}`)
    expect(plain.status(), 'the plain id is protected while the run is in progress').toBe(409)

    const spelled = await request.delete(`${BACKEND_URL}/artifacts/${dotSpelled(`${dir}/${PLANTED}`)}`)
    const body = await spelled.json().catch(() => null)
    expect(spelled.status(), `the dot-segment spelling must be protected too: ${JSON.stringify(body)}`).toBe(409)
    expect(body.error.message).toBe(IN_PROGRESS_MESSAGE)
    expect(body.error.details).toEqual({ execution_ids: [executionId] })
    expect(fs.readFileSync(file, 'utf-8'), 'the artifact keeps its bytes').toBe(PLANTED_BYTES)
    expect(fs.existsSync(`${file}.removed`), 'no tombstone is written').toBe(false)
  })

  test('the metadata of a dot-segment spelling names the artifact and its execution', async ({ request }) => {
    const { executionId, dir } = await startHeldRun(request)
    plant(dir)

    const response = await request.get(`${BACKEND_URL}/artifacts/meta/${dotSpelled(`${dir}/${PLANTED}`)}`)

    expect(response.status()).toBe(200)
    const meta = await response.json()
    expect({ id: meta.id, execution_id: meta.execution_id, path: meta.path, name: meta.name }).toEqual({
      id: `${dir}/${PLANTED}`,
      execution_id: executionId,
      path: PLANTED,
      name: PLANTED,
    })
    expect(meta.size_bytes).toBe(Buffer.byteLength(PLANTED_BYTES))
  })

  test('a delete through a dot-segment spelling records the path the artifact had', async ({ request }) => {
    const { executionId, dir } = await startHeldRun(request)
    const file = plant(dir)
    await stopRun(request, executionId)

    const response = await request.delete(`${BACKEND_URL}/artifacts/${dotSpelled(`${dir}/${PLANTED}`)}`)

    expect(response.status(), 'an execution that is over gives its artifacts up').toBe(204)
    expect(fs.existsSync(file), 'the bytes are freed').toBe(false)
    const listing = await request.get(
      `${BACKEND_URL}/artifacts?execution_id=${executionId}&include_removed=true&per_page=100`,
    )
    const removed = ((await listing.json()).data as Array<Record<string, unknown>>).filter(
      (item) => item.removed_at,
    )
    expect(removed.map((item) => ({ id: item.id, path: item.path, name: item.name }))).toEqual([
      { id: `${dir}/${PLANTED}`, path: PLANTED, name: PLANTED },
    ])
  })

  test('the sessions area stays out of reach of the artifact routes with a dot segment in front', async ({
    request,
  }) => {
    const sessionDir = path.join(ARTIFACT_ROOT, 'sessions', `spec-${randomUUID()}`)
    const relative = `sessions/${path.basename(sessionDir)}/${PLANTED}`
    fs.mkdirSync(sessionDir, { recursive: true })
    const file = path.join(sessionDir, PLANTED)
    fs.writeFileSync(file, PLANTED_BYTES)
    try {
      const plain = await request.get(`${BACKEND_URL}/artifacts/content/${encodeURIComponent(relative)}`)
      expect(plain.status(), 'the plain sessions id is refused').toBe(400)

      const content = await request.get(`${BACKEND_URL}/artifacts/content/${dotSpelled(relative)}`)
      expect(content.status(), `content must refuse the sessions area: ${await content.text()}`).toBe(400)
      expect((await content.json()).error.message).toBe(`Invalid artifact identifier: ./${relative}`)

      const removal = await request.delete(`${BACKEND_URL}/artifacts/${dotSpelled(relative)}`)
      expect(removal.status(), `delete must refuse the sessions area: ${await removal.text()}`).toBe(400)
      expect((await removal.json()).error.message).toBe(`Invalid artifact identifier: ./${relative}`)
      expect(fs.readFileSync(file, 'utf-8'), 'the session file keeps its bytes').toBe(PLANTED_BYTES)
      expect(fs.existsSync(`${file}.removed`), 'no tombstone is written in the session').toBe(false)
    } finally {
      fs.rmSync(sessionDir, { recursive: true, force: true })
    }
  })
})
