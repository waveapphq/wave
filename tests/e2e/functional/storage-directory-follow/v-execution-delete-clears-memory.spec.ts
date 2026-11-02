/**
 * V-EXECUTION-DELETE-CLEARS-MEMORY: deleting an execution through the product
 * clears everything it left behind.
 *
 * The Executions list is deliberately NOT reconciled against its storage
 * directory - it is the one entity that grows with no retention sweep, and its
 * cached record is meant to be ahead of the file while a run is in flight. So
 * this spec proves the other half: a delete made THROUGH the product drops the
 * execution from the in-memory record as well as from disk, and it does not
 * come back on a fresh read of the list.
 *
 * NOT asserted here, because it is known and unfixed: an execution whose files
 * are deleted by hand stays in the list until someone opens it.
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, STORAGE_BASE_PATH, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { createValidTest, logNode, startEdge } from '../../helpers/fn-seed'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Read-only: where this execution's files live. Never used to write or remove. */
function executionDir(executionId: string): string {
  expect(STORAGE_BASE_PATH, 'STORAGE_BASE_PATH must be a rooted data dir').toMatch(/^\/\w/)
  expect(executionId, 'only a uuid this spec created may be inspected').toMatch(UUID_RE)
  return path.join(STORAGE_BASE_PATH, 'api_executions', executionId)
}

async function environmentId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BACKEND_URL}/environments/`)
  expect(response.ok(), `GET /environments failed: ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const envs = (Array.isArray(body) ? body : (body.data ?? [])) as Array<Record<string, unknown>>
  const env = envs.find((candidate) => candidate.name === E2E_ENV_NAME)
  expect(env, `environment "${E2E_ENV_NAME}" not found`).toBeTruthy()
  return (env as Record<string, unknown>).id as string
}

async function runToTerminal(
  request: APIRequestContext,
  executionId: string,
  timeoutMs = 30_000,
): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const response = await request.get(`${BACKEND_URL}/executions/${executionId}`)
    expect(response.ok(), `GET /executions/${executionId} failed: ${response.status()}`).toBeTruthy()
    const body = await response.json()
    const status = ((body.data ?? body) as Record<string, unknown>).status as string
    if (status === 'passed' || status === 'failed' || status === 'stopped') return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Execution ${executionId} stayed non-terminal for ${timeoutMs}ms`)
}

test('Deleting an execution through the product clears it from memory and disk', async ({
  page,
  request,
}) => {
  await ensureEnvironment(request)
  const testName = `SDF Exec ${Date.now().toString(36)}${randomUUID().slice(0, 4)}`
  const testId = await createValidTest(request, {
    name: testName,
    nodes: [logNode('sdf-exec-log', 'Log', "'storage directory follow'")],
    edges: [startEdge('sdf-exec-log')],
  })

  const envId = await environmentId(request)

  async function startRun(): Promise<string> {
    const startResponse = await request.post(`${BACKEND_URL}/executions`, {
      data: { type: 'test', id: testId, environment_id: envId },
    })
    expect(
      startResponse.ok(),
      `POST /executions failed: ${startResponse.status()} - ${await startResponse.text()}`,
    ).toBeTruthy()
    const id = ((await startResponse.json()).data as Record<string, unknown>).id as string
    await runToTerminal(request, id)
    return id
  }

  // Two runs of the same Test: the keeper anchors every list assertion, so the
  // list is never empty and its filters never disable (LIST-3).
  const executionId = await startRun()
  const keeperId = await startRun()
  expect(fs.existsSync(executionDir(executionId)), 'the run left files on disk').toBe(true)

  const row = page.locator(`[data-testid="execution-row"][data-row-id="${executionId}"]`)
  const keeperRow = page.locator(`[data-testid="execution-row"][data-row-id="${keeperId}"]`)

  await test.step('delete it from the Executions list', async () => {
    await page.goto('/executions')
    await expect(page.locator('[data-testid="executions-page"]')).toBeVisible()
    await page.locator('[data-testid="search-input"] input').first().fill(testName)
    await expect(row).toBeVisible()
    await expect(keeperRow).toBeVisible()

    await row.locator('[data-testid="row-action-delete"]').click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete' }).click()
    await expect(row, 'the deleted execution leaves the list').toHaveCount(0)
    await expect(keeperRow, 'the other run is untouched').toBeVisible()
  })

  await test.step('nothing it left is still readable', async () => {
    const read = await request.get(`${BACKEND_URL}/executions/${executionId}`)
    expect(read.status(), 'GET /executions/{id} must answer 404').toBe(404)
    const variables = await request.get(`${BACKEND_URL}/executions/${executionId}/variables`)
    expect(variables.status(), 'GET /executions/{id}/variables must answer 404').toBe(404)
    expect(fs.existsSync(executionDir(executionId)), 'its files are gone from disk').toBe(false)
  })

  await test.step('a fresh read of the list does not bring it back', async () => {
    // The list is served from the in-memory record, so a row here would mean
    // the delete cleared the files and left the record behind.
    await page.goto('/executions')
    await expect(page.locator('[data-testid="executions-page"]')).toBeVisible()
    await page.locator('[data-testid="search-input"] input').first().fill(testName)
    // The keeper proves the list answered and rendered rows for this name.
    await expect(keeperRow).toBeVisible()
    await expect(page.locator('[data-testid="error-state-title"]')).toHaveCount(0)
    await expect(row, 'the deleted execution does not return').toHaveCount(0)
  })

  await request.delete(`${BACKEND_URL}/executions/${keeperId}`).catch(() => {})
  await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
})
