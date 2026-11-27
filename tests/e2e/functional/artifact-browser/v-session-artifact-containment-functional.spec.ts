/**
 * V-SESSION-ARTIFACT-CONTAINMENT: a session artifact path stays inside the session's folder
 * Design Decisions: ARTIF-14 (the live session's artifacts), ARTIF-16 (session-artifact
 *   delete is a hard delete)
 * REQ: REQ-5.2.4.12
 *
 * The session artifact routes serve and delete files of the active workbench session.
 * Their paths are validated for containment within the session's folder, so a link in
 * that folder reaches nothing outside it. A run can leave such a link (a Shell block can
 * write one), so the spec plants the links in the session's folder itself.
 *
 * Pass Criteria:
 * 1. A link to a file outside the session's folder is refused as an invalid path for
 *    content and for delete; the link and the outside file stay.
 * 2. A path through a folder link that leads outside is refused the same way.
 * 3. Two links that point at each other are an invalid path, not a missing file.
 * 4. A link that stays inside the folder is still served with its target's bytes.
 *
 * Run: ./scripts/e2e/e2e-targeted-local.sh functional/artifact-browser/v-session-artifact-containment-functional.spec.ts
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, STORAGE_BASE_PATH } from '../../helpers/config'
import { createValidTest, delayNode, releaseWorkbenchOwnership, startEdge } from '../../helpers/fn-seed'
import { resolveEnvironmentId } from '../../helpers/k8s-run'

const SESSIONS_ROOT = path.join(STORAGE_BASE_PATH, 'artifacts', 'sessions')
const CONTENT = `${BACKEND_URL}/workbench/session/artifacts/content`
const ARTIFACTS = `${BACKEND_URL}/workbench/session/artifacts`
const SECRET = 'outside the session\n'
const INSIDE = 'inside the session\n'
// The spec ends the session itself, so the run must outlive every step.
const HOLD_RUN_MS = 120_000

let testId = ''
let sessionDir = ''
let outsideDir = ''

async function startSession(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/workbench/run`, {
    data: { test_id: testId, environment_id: await resolveEnvironmentId(request) },
  })
  expect(response.ok(), `POST /workbench/run failed: ${response.status()} ${await response.text()}`).toBeTruthy()
  return ((await response.json()).data as { session_id: string }).session_id
}

async function endSession(request: APIRequestContext): Promise<void> {
  await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
  await releaseWorkbenchOwnership(request)
}

async function expectInvalid(response: Awaited<ReturnType<APIRequestContext['get']>>, relative: string): Promise<void> {
  const text = await response.text()
  expect(response.status(), `${relative} must be refused as an invalid path: ${text}`).toBe(400)
  expect(JSON.parse(text).error.message).toBe(`Invalid artifact path: ${relative}`)
}

test.describe('V-SESSION-ARTIFACT-CONTAINMENT: a link in the session folder reaches nothing outside it', () => {
  test.beforeAll(async ({ request }) => {
    testId = await createValidTest(request, {
      name: `SESSION-ARTIFACT-CONTAINMENT Hold ${Date.now()}-${randomUUID().slice(0, 6)}`,
      nodes: [delayNode('session-artifact-hold', 'Hold', HOLD_RUN_MS)],
      edges: [startEdge('session-artifact-hold')],
    })
  })

  test.beforeEach(async ({ request }) => {
    await endSession(request)
    const sessionId = await startSession(request)
    sessionDir = path.join(SESSIONS_ROOT, sessionId)
    expect(fs.existsSync(sessionDir), `the session's folder must exist at ${sessionDir}`).toBe(true)
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-session-outside-'))
    fs.writeFileSync(path.join(outsideDir, 'secret.txt'), SECRET)
  })

  test.afterEach(async ({ request }) => {
    await endSession(request)
    fs.rmSync(outsideDir, { recursive: true, force: true })
  })

  test.afterAll(async ({ request }) => {
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
  })

  test('a link to a file outside is refused for content and delete, and both stay', async ({ request }) => {
    const link = path.join(sessionDir, 'leak.txt')
    fs.symlinkSync(path.join(outsideDir, 'secret.txt'), link)

    await expectInvalid(await request.get(`${CONTENT}/leak.txt`), 'leak.txt')
    await expectInvalid(await request.delete(`${ARTIFACTS}/leak.txt`), 'leak.txt')

    expect(fs.lstatSync(link).isSymbolicLink(), 'the link stays').toBe(true)
    expect(fs.readFileSync(path.join(outsideDir, 'secret.txt'), 'utf-8'), 'the outside file keeps its bytes').toBe(SECRET)
  })

  test('a path through a folder link that leads outside is refused', async ({ request }) => {
    fs.symlinkSync(outsideDir, path.join(sessionDir, 'out'))

    await expectInvalid(await request.get(`${CONTENT}/out/secret.txt`), 'out/secret.txt')
    await expectInvalid(await request.delete(`${ARTIFACTS}/out/secret.txt`), 'out/secret.txt')

    expect(fs.readFileSync(path.join(outsideDir, 'secret.txt'), 'utf-8'), 'the outside file stays').toBe(SECRET)
  })

  test('two links that point at each other are an invalid path, not a missing file', async ({ request }) => {
    fs.symlinkSync(path.join(sessionDir, 'b'), path.join(sessionDir, 'a'))
    fs.symlinkSync(path.join(sessionDir, 'a'), path.join(sessionDir, 'b'))

    await expectInvalid(await request.get(`${CONTENT}/a`), 'a')
    await expectInvalid(await request.delete(`${ARTIFACTS}/a`), 'a')
  })

  test('a link that stays inside the folder is served with its target\'s bytes', async ({ request }) => {
    fs.writeFileSync(path.join(sessionDir, 'real.txt'), INSIDE)
    fs.symlinkSync(path.join(sessionDir, 'real.txt'), path.join(sessionDir, 'alias.txt'))

    const response = await request.get(`${CONTENT}/alias.txt`)

    expect(response.status(), await response.text()).toBe(200)
    expect(await response.text()).toBe(INSIDE)
  })
})
