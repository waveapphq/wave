/**
 * Shared run helpers for workflow specs: start a run, finish it on a bookend
 * marker, assert node status, reopen a finished run from history, and read the
 * exported HTML report.
 *
 * The console tail renders a beat AFTER the status attribute flips terminal,
 * so `finishRun` gates the harvest on the run's own marker line rather than
 * reading the console once the status settles.
 */

import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from './playwright-fixtures'
import { getLogTexts, waitForLogText } from './log-reader'
import { pollRunStatus, selectEnvironment } from './workbench'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from './config'

const TERMINAL_STATUSES = new Set(['passed', 'failed', 'stopped', 'skipped'])

export type NodeStatus = { testId: string | null; status: string | null }

/** Every canvas Block with its execution status, for failure dumps. */
export async function getNodeStatuses(page: Page): Promise<NodeStatus[]> {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-testid^="workflow-node-"]')
    return Array.from(nodes).map((n) => ({
      testId: n.getAttribute('data-testid'),
      status: n.getAttribute('data-execution-status'),
    }))
  })
}

/** Select the shared environment, click Run, and wait for the run to leave idle. */
export async function startRun(page: Page): Promise<Locator> {
  await selectEnvironment(page)
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await pollRunStatus(status, (value) => value !== 'idle', 10_000, 'the run leaves idle')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
  return status
}

/** Wait for the terminal state AND the bookend marker, dump on failure, and
 *  assert the run passed. Returns the harvested console lines. */
export async function finishRun(
  page: Page,
  status: Locator,
  marker: string,
  runTimeout = 120_000,
): Promise<string[]> {
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: runTimeout })
  const ended = await status.getAttribute('data-status')
  // A run that ended other than passed never writes the marker.
  const logs =
    ended !== 'passed' && TERMINAL_STATUSES.has(ended ?? '')
      ? await getLogTexts(page)
      : await waitForLogText(page, marker, 30_000)
  const statusVal = await status.getAttribute('data-status')
  if (statusVal !== 'passed') {
    console.log('=== WORKFLOW FAILED ===')
    console.log('node statuses:', JSON.stringify(await getNodeStatuses(page), null, 2))
    console.log('logs:', logs.join('\n'))
  }
  expect(statusVal).toBe('passed')
  return logs
}

/** Wait for the terminal state AND the bookend marker WITHOUT asserting the
 *  verdict. For a run that is meant to fail or be stopped. */
export async function finishRunAnyVerdict(
  page: Page,
  status: Locator,
  marker: string,
  runTimeout = 120_000,
): Promise<{ verdict: string | null; logs: string[] }> {
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: runTimeout })
  const logs = await waitForLogText(page, marker, 30_000)
  return { verdict: await status.getAttribute('data-status'), logs }
}

/** Assert one Block's execution status. */
export async function expectNodeStatus(
  page: Page,
  nodeId: string,
  expected: string,
): Promise<void> {
  await expect(page.locator(`[data-testid="workflow-node-${nodeId}"]`)).toHaveAttribute(
    'data-execution-status',
    expected,
  )
}

/** Assert every listed Block succeeded. */
export async function expectNodesSuccess(page: Page, ids: readonly string[]): Promise<void> {
  for (const id of ids) await expectNodeStatus(page, id, 'success')
}

/** The id of the shared E2E execution environment, creating it if absent. */
export async function resolveEnvironmentId(request: APIRequestContext): Promise<string> {
  await ensureEnvironment(request)
  const resp = await request.get(`${BACKEND_URL}/environments/`)
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `GET /environments/ failed: ${resp.status()} ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const envs = (Array.isArray(body) ? body : (body?.data ?? [])) as Array<{
    id?: string
    name?: string
  }>
  const env = envs.find((e) => e.name === E2E_ENV_NAME)
  expect(env?.id, `environment "${E2E_ENV_NAME}" not found`).toBeTruthy()
  return env?.id as string
}

export type TrackedRun = { executionId: string; verdict: string }

/** Start a TRACKED run of a saved Test (POST /executions) and poll it to a
 *  terminal verdict. Only a tracked run has a history route; a workbench Run
 *  does not. */
export async function runTrackedTest(
  request: APIRequestContext,
  testId: string,
  timeoutMs = 120_000,
): Promise<TrackedRun> {
  const environmentId = await resolveEnvironmentId(request)
  const startResp = await request.post(`${BACKEND_URL}/executions`, {
    data: { type: 'test', id: testId, environment_id: environmentId },
  })
  expect(
    startResp.ok(),
    `POST /executions failed: ${startResp.status()} ${await startResp.text()}`,
  ).toBeTruthy()
  const startBody = await startResp.json()
  const executionId = ((startBody.data ?? startBody) as { id: string }).id

  let verdict = ''
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
        if (!resp.ok()) return ''
        const body = await resp.json().catch(() => null)
        const data = (body?.data ?? body ?? {}) as { status?: string }
        verdict = data.status ?? ''
        return TERMINAL_STATUSES.has(verdict) ? verdict : ''
      },
      {
        timeout: timeoutMs,
        intervals: [200, 500, 1_000],
        message: `execution ${executionId} did not reach a terminal status`,
      },
    )
    .toBeTruthy()
  return { executionId, verdict }
}

/** Clear the workbench session once no run is live, so the next bare /workbench does not
 *  recover a finished tracked run and redirect to its history. */
export async function clearSettledWorkbenchSession(request: APIRequestContext): Promise<void> {
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${BACKEND_URL}/workbench/session`)
        const body = await resp.json().catch(() => null)
        return ((body?.data ?? null) as { status?: string } | null)?.status ?? 'none'
      },
      { timeout: 30_000, intervals: [200, 500, 1_000], message: 'a workbench run is still live' },
    )
    .not.toMatch(/^(running|paused)$/)
  const cleared = await request.delete(`${BACKEND_URL}/workbench/session`)
  expect(cleared.ok(), `DELETE /workbench/session failed: ${cleared.status()}`).toBeTruthy()
  const after = await request.get(`${BACKEND_URL}/workbench/session`)
  expect((await after.json())?.data ?? null, 'the workbench session outlived its clear').toBeNull()
}

/** Reopen a finished run on the historical canvas. A test-type run reuses its
 *  execution id as the run id. */
export async function openRunHistory(page: Page, executionId: string): Promise<void> {
  await page.goto(`/executions/history/${executionId}`)
  const workbenchPage = page.locator('[data-testid="workbench-page"]')
  await expect(workbenchPage, 'the historical canvas did not boot').toBeVisible({
    timeout: 20_000,
  })
  await expect(workbenchPage).toHaveAttribute('data-mode', 'history')
  await expect(page.locator('[data-testid="workflow-canvas"]')).toBeVisible()
}

/** Generate (or reuse) the workbench session's HTML report and return its text. */
export async function fetchSessionReport(page: Page): Promise<string> {
  const genResp = await page.request.post(`${BACKEND_URL}/workbench/session/report`)
  expect(
    genResp.status(),
    `POST /workbench/session/report failed: ${await genResp.text()}`,
  ).toBe(200)
  const contentResp = await page.request.get(
    `${BACKEND_URL}/workbench/session/artifacts/content/report.html`,
  )
  expect(
    contentResp.ok(),
    `GET session report failed: ${contentResp.status()}`,
  ).toBeTruthy()
  return contentResp.text()
}

/** Generate (or reuse) a tracked execution's HTML report and return its text.
 *  The first POST answers 202 and the job completes asynchronously. */
export async function fetchExecutionReport(
  request: APIRequestContext,
  executionId: string,
  timeoutMs = 30_000,
): Promise<string> {
  const genResp = await request.post(`${BACKEND_URL}/executions/${executionId}/report`)
  expect(
    [200, 202].includes(genResp.status()),
    `POST /executions/${executionId}/report: ${genResp.status()} ${await genResp.text()}`,
  ).toBeTruthy()

  let artifactId = ''
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${BACKEND_URL}/executions/${executionId}/report`)
        if (!resp.ok()) return ''
        const body = await resp.json().catch(() => null)
        const job = (body?.data ?? body ?? {}) as { status?: string; artifact_id?: string }
        expect(job.status, 'report generation failed').not.toBe('failed')
        artifactId = job.artifact_id ?? ''
        return job.status === 'completed' ? artifactId : ''
      },
      {
        timeout: timeoutMs,
        intervals: [200, 500],
        message: `report for ${executionId} did not complete`,
      },
    )
    .toBeTruthy()

  const contentResp = await request.get(`${BACKEND_URL}/artifacts/content/${artifactId}`)
  expect(
    contentResp.ok(),
    `GET /artifacts/content/${artifactId} failed: ${contentResp.status()}`,
  ).toBeTruthy()
  return contentResp.text()
}
