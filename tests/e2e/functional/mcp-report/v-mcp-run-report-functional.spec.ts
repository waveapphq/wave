/**
 * V-MCP-RUN-REPORT-FUNCTIONAL: the run report names each Block by the containers it sits in
 * Wireframes: none (report content)
 * Design Decisions: REPORT-10, RVIEW-6
 * REQ: REQ-5.2.7.11, REQ-3.7.2.3
 *
 * An If/Else and a split Assert are not containers: their branches stay on the main flow and
 * a Block where they rejoin stands after them (Branching Engine). Loops, Switch/Case and the
 * other containers nest every Block of their lanes.
 *
 * Pass Criteria:
 * 1. get_run_report json: the Switch three empty If/Else branches join reads "Pick path" and
 *    its case Log "Pick path / Say picked"; both Logs of the For body carry "Repeat once / ";
 *    the Assert inside an `if` branch reads "Gate" and the Block after that `if` with no
 *    `else` reads "Say after"; the error entries of the failed Assert read "Gate".
 * 2. get_failure_report names the failed Assert inside the branch by the path "Gate".
 * 3. The report viewer shows the same paths: the only path prefixes are "Pick path /" and
 *    "Repeat once /" twice.
 * 4. Two If/Else branches with Blocks that rejoin: the timeline lists the Blocks of each
 *    branch in flow order before the join, with no If/Else name in their paths.
 * 5. The tools list describes get_run_report as holding the per-Block timeline and names
 *    its two formats.
 * 6. A run still in progress is refused with its exact text, and the run is still running.
 * 7. For the finished run, json holds the run's identity, the variables GET /executions/{id}/variables
 *    answers with the secret masked, one timeline row per Block with its status and timing, and the
 *    logs GET /executions/{id}/logs answers; the secret value appears nowhere (REQ-5.2.7.13).
 * 8. html returns a document for the same run: its title names the Test, it carries the execution
 *    id and the masked log line, and never the secret value.
 * 9. An unknown execution id and an unknown format are refused with their exact texts.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/mcp-report/v-mcp-run-report-functional.spec.ts
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { deleteTest, getTest, importValidated } from '../../helpers/element-types'
import { resolveEnvironmentId } from '../../helpers/k8s-run'
import {
  callTool,
  enableMcpUntilRestart,
  listToolDescriptions,
  resetMcpSettings,
  type McpToolResult,
} from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'

// One MCP port per stack so host-mode parallel workers never collide.
const MCP_PORT = Number(BACKEND_PORT) + 765

const TERMINAL_STATUSES = ['passed', 'failed', 'stopped']

function loadFixture(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8'))
}

/** Start a tracked run of the Test over MCP and poll get_execution until it ends. */
async function runOverMcp(testId: string): Promise<{ executionId: string; status: string }> {
  const started = callTool(MCP_PORT, 'start_execution', {
    entity_type: 'test',
    ref: testId,
    environment: E2E_ENV_NAME,
  })
  expect(started.isError, JSON.stringify(started.payload)).toBe(false)
  const executionId = String(started.payload.execution_id)
  let status = ''
  await expect
    .poll(
      () => {
        status = String(callTool(MCP_PORT, 'get_execution', { execution_id: executionId }).payload.status)
        return TERMINAL_STATUSES.includes(status)
      },
      { timeout: 90_000, message: `execution ${executionId} reaches a terminal status` },
    )
    .toBe(true)
  return { executionId, status }
}

function jsonReport(executionId: string): McpToolResult {
  const report = callTool(MCP_PORT, 'get_run_report', { execution_id: executionId, format: 'json' })
  expect(report.isError, JSON.stringify(report.payload)).toBe(false)
  return report
}

function blockPaths(report: McpToolResult): string[] {
  return (report.payload.timeline.blocks as Array<{ block_path: string }>).map((row) => row.block_path)
}

const MASK = '********'
const REPORT_SECRET = 'zz-mcp-run-report-secret-6612'

/** A raised refusal of get_run_report: an error answer carrying the exact message. */
function expectReportRefused(result: McpToolResult, message: string): void {
  expect(result.isError, `get_run_report must refuse: ${JSON.stringify(result.payload)}`).toBe(true)
  expect(result.payload.text).toBe(`Error executing tool get_run_report: ${message}`)
}

/** Start a tracked run through POST /executions and return its id without waiting. */
async function startTrackedRun(request: APIRequestContext, testId: string): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/executions`, {
    data: { type: 'test', id: testId, environment_id: await resolveEnvironmentId(request) },
  })
  expect(resp.ok(), `POST /executions failed: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  return String(((await resp.json()).data ?? {}).id)
}

async function apiStatus(request: APIRequestContext, executionId: string): Promise<string> {
  const resp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
  return resp.ok() ? String(((await resp.json()).data ?? {}).status ?? '') : ''
}

async function pollApiStatus(
  request: APIRequestContext,
  executionId: string,
  wanted: readonly string[],
  timeout: number,
): Promise<string> {
  let status = ''
  await expect
    .poll(
      async () => {
        status = await apiStatus(request, executionId)
        return wanted.includes(status)
      },
      { timeout, intervals: [200, 500, 1_000], message: `execution ${executionId} reaches ${wanted.join(' or ')}` },
    )
    .toBe(true)
  return status
}

test.describe('V-MCP-RUN-REPORT-FUNCTIONAL: report paths follow containers only', () => {
  const created: string[] = []
  const executions: string[] = []

  test.beforeEach(async ({ page, request }) => {
    await resetOwnership(request)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    for (const id of executions.splice(0)) {
      await request.delete(`${BACKEND_URL}/executions/${id}`).catch(() => undefined)
    }
    for (const testId of created.splice(0)) await deleteTest(request, testId)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('a Block is named by the containers it sits in, never by an If/Else', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const testId = await importValidated(request, loadFixture('fixture-paths.json'))
    created.push(testId)
    const { executionId, status } = await runOverMcp(testId)
    expect(status, 'the Assert inside the if branch fails the run').toBe('failed')

    await test.step('get_run_report names each Block by its containers only', async () => {
      const report = jsonReport(executionId)
      expect.soft(blockPaths(report)).toEqual([
        'Route by health',
        'Pick path',
        'Pick path / Say picked',
        'Repeat once',
        'Repeat once / Say first',
        'Repeat once / Say second',
        'Check gate',
        'Gate',
        'Say after',
      ])
      const errors = report.payload.errors as Array<{ block_path: string | null }>
      const errorPaths = [...new Set(errors.map((entry) => entry.block_path).filter(Boolean))]
      expect.soft(errorPaths, JSON.stringify(errors)).toEqual(['Gate'])
    })

    await test.step('get_failure_report names the failed Block inside the branch by its own path', async () => {
      const report = callTool(MCP_PORT, 'get_failure_report', { execution_id: executionId })
      expect(report.isError, JSON.stringify(report.payload)).toBe(false)
      const failedTests = report.payload.failed_tests as Array<Record<string, any>>
      expect(failedTests).toHaveLength(1)
      const failed = (failedTests[0].failed_blocks as Array<Record<string, unknown>>).map((block) => [
        block.label,
        block.path,
      ])
      expect.soft(failed).toEqual([['Gate', 'Gate']])
    })

    await test.step('the report viewer shows the same paths', async () => {
      await page.goto(`/reports/${executionId}`)
      const timeline = page.getByTestId('report-timeline')
      await expect(timeline.getByTestId('timeline-row').first()).toBeVisible({ timeout: 30_000 })
      await expect(timeline.getByTestId('timeline-path-prefix')).toHaveText([
        'Pick path /',
        'Repeat once /',
        'Repeat once /',
      ])
    })
  })

  test('the Blocks of two branches that rejoin are listed in flow order before the join', async ({
    request,
  }) => {
    test.setTimeout(180_000)
    const testId = await importValidated(request, loadFixture('fixture-rejoin.json'))
    created.push(testId)
    const { executionId, status } = await runOverMcp(testId)
    expect(status).toBe('passed')

    const report = jsonReport(executionId)
    expect(blockPaths(report)).toEqual([
      'Choose side',
      'Left one',
      'Left two',
      'Right one',
      'Join step',
      'Final step',
    ])
    const ran = (report.payload.timeline.blocks as Array<{ block_path: string; status: string }>)
      .filter((row) => row.status === 'passed')
      .map((row) => row.block_path)
    expect(ran, 'the else branch ran, then the join').toEqual([
      'Choose side',
      'Right one',
      'Join step',
      'Final step',
    ])
  })

  test('the tools list says get_run_report holds the per-Block timeline and its formats', () => {
    const description = listToolDescriptions(MCP_PORT).get_run_report ?? ''
    expect(description).toContain('per-Block timeline, errors, variables and logs')
    expect(description).toContain('`format` is `json` (the default) or `html`')
  })

  test('json holds the variables, the per-Block timeline and the logs, secrets masked; html renders the same run', async ({
    request,
  }) => {
    test.setTimeout(240_000)
    const testId = await importValidated(request, loadFixture('fixture-report.json'))
    created.push(testId)
    const testName = String((await getTest(request, testId)).name)
    const executionId = await startTrackedRun(request, testId)
    executions.push(executionId)

    await test.step('a run still in progress is refused with its exact text', async () => {
      await pollApiStatus(request, executionId, ['running'], 60_000)
      expectReportRefused(
        callTool(MCP_PORT, 'get_run_report', { execution_id: executionId, format: 'json' }),
        "Cannot generate report for execution in 'running' state. Wait for the execution to finish.",
      )
      expect(await apiStatus(request, executionId), 'the Delay still holds the run').toBe('running')
    })

    expect(await pollApiStatus(request, executionId, TERMINAL_STATUSES, 90_000)).toBe('passed')
    const report = jsonReport(executionId).payload

    await test.step('json names the run as GET /executions/{id} does', async () => {
      const stored = (await (await request.get(`${BACKEND_URL}/executions/${executionId}`)).json()).data
      expect(report.execution).toMatchObject({
        id: executionId,
        name: testName,
        entity_type: 'test',
        entity_id: testId,
        environment: E2E_ENV_NAME,
        status: 'passed',
        triggered_by: stored.triggered_by,
        started_at: stored.started_at,
        ended_at: stored.ended_at,
      })
      expect(report.summary.status).toBe('passed')
    })

    await test.step('json holds the variables GET /executions/{id}/variables answers, the secret masked', async () => {
      const runs = report.timeline.runs as Array<Record<string, any>>
      expect(runs).toHaveLength(1)
      expect(runs[0]).toMatchObject({ test_id: testId, test_name: testName, status: 'passed' })
      expect(runs[0].variables).toMatchObject({ zz_mode: 'report', zz_token: MASK })
      const stored = (await (await request.get(`${BACKEND_URL}/executions/${executionId}/variables`)).json()).data
      expect(stored).toMatchObject({ zz_mode: 'report', zz_token: MASK })
      expect(runs[0].variables.zz_token).toBe(stored.zz_token)
    })

    await test.step('json holds one timeline row per Block with its status and timing', () => {
      const rows = report.timeline.blocks as Array<Record<string, any>>
      expect(rows.map((row) => row.block_path)).toEqual(['Say mode', 'Say token', 'Hold', 'Say done'])
      for (const row of rows) {
        expect(row.status, `${row.block_path} passed`).toBe('passed')
        expect(row.started_at, `${row.block_path} has a start time`).toBeTruthy()
        expect(row.ended_at, `${row.block_path} has an end time`).toBeTruthy()
      }
      const hold = rows.find((row) => row.block_path === 'Hold')
      expect(Number(hold?.duration), 'the Delay row spans its 15 seconds').toBeGreaterThanOrEqual(14)
    })

    await test.step('json holds the logs GET /executions/{id}/logs answers, the secret masked', async () => {
      const messages = (report.logs as Array<{ message?: string }>).map((entry) => String(entry.message ?? ''))
      expect(messages).toEqual(expect.arrayContaining(['mode=report', `token=${MASK}`, 'done=report']))
      const logsPage = (await (await request.get(`${BACKEND_URL}/executions/${executionId}/logs?limit=1000`)).json()).data
      const stored = (logsPage.entries as Array<{ message?: string }>).map((entry) => String(entry.message ?? ''))
      expect(stored).toEqual(expect.arrayContaining(['mode=report', `token=${MASK}`, 'done=report']))
      expect(JSON.stringify(report)).not.toContain(REPORT_SECRET)
    })

    await test.step('html returns a document for the same run, the secret masked', () => {
      const html = callTool(MCP_PORT, 'get_run_report', { execution_id: executionId, format: 'html' })
      expect(html.isError, JSON.stringify(html.payload)).toBe(false)
      const text = String(html.payload.text ?? '')
      expect(text.startsWith('<!DOCTYPE html>'), text.slice(0, 200)).toBe(true)
      expect(text).toContain(`<title>WAVE Execution Report - ${testName}</title>`)
      expect(text).toContain(executionId)
      expect(text).toContain(`token=${MASK}`)
      expect(text).not.toContain(REPORT_SECRET)
    })

    await test.step('an unknown execution id and an unknown format are refused with their exact texts', () => {
      const unknownId = 'zz-mcp-get_run_report-404'
      expectReportRefused(
        callTool(MCP_PORT, 'get_run_report', { execution_id: unknownId, format: 'json' }),
        `Execution with ID '${unknownId}' not found`,
      )
      expectReportRefused(
        callTool(MCP_PORT, 'get_run_report', { execution_id: executionId, format: 'pdf' }),
        "Invalid format 'pdf': valid formats are html, json",
      )
    })
  })
})
