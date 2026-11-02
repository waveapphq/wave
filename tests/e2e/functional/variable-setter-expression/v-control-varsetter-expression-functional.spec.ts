/**
 * Variable Setter overriding an expression variable - lazy realization
 *
 * Guards backend/wavecore/controls/variable_setter.py: writing a name declared
 * as a still-pending expression variable must supersede it via a direct write
 * WITHOUT realizing the expression. Realizing the lazy expression `"123"` would
 * fire a deferred variable_changed push of the OLD value (123) that races - and
 * lands after - the setter's own overwrite push, so the watched Current value
 * would flip to `new value!` and then revert to `123`.
 *
 * The end-to-end guard is the inspect WATCHER Current value: it must
 * settle on `new value!` and never revert to `123`. The Delay holds the run
 * open so the deferred push (if any) lands well before the terminal state.
 *
 * Backend deterministic unit test:
 *   backend/tests/core/test_control_variable_setter.py::TestVariableSetterPendingExpression
 *
 * REQ: REQ-3.4.1.14 (Variable Setter Control), REQ-3.1.3.13 (computed
 * variables with expressions and runtime evaluation), REQ-3.2.2.18 (live
 * variable values display)
 *
 * Pass Criteria:
 * 1. The fixture passes POST /tests/{id}/validate with zero errors.
 * 2. The workflow runs to the passed terminal state.
 * 3. The open inspect watcher's evaluated Current value settles on
 *    `"new value!"` after the run and never reverts to `"123"`.
 * 4. The downstream Log proves propagation: `final=new value!` (not
 *    `final=123`).
 * 5. GET /workbench/{session_id}/variables returns `s1 = "new value!"`.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, ensureEnvironment } from '../../helpers/config'
import { selectEnvironment } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8')
  const fixture = JSON.parse(raw)
  fixture.name = `VarSetter Expression Override ${Date.now()}`
  return fixture
}

const content = (page: Page): Locator =>
  page.locator('[data-testid="variable-manager-content"]')

const rowFor = (page: Page, name: string): Locator =>
  content(page).locator(`[aria-label="Variable ${name}"]`)

const modalFor = (page: Page, name: string): Locator =>
  page.locator(`section[aria-label="Inspect variable ${name}"]`)

async function getActiveSessionId(page: Page): Promise<string> {
  const resp = await page.request.get(
    `http://localhost:${BACKEND_PORT}/workbench/session`,
  )
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `GET /workbench/session failed: ${resp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const sessionId = body?.data?.session_id ?? body?.session_id ?? null
  expect(
    sessionId,
    `expected an active session_id, got ${JSON.stringify(body)}`,
  ).toBeTruthy()
  return sessionId as string
}

async function getSessionVariables(
  page: Page,
  sessionId: string,
): Promise<Record<string, { value: unknown; type: string }>> {
  const resp = await page.request.get(
    `http://localhost:${BACKEND_PORT}/workbench/${sessionId}/variables`,
  )
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `GET /workbench/{sid}/variables failed: ${resp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  return body.data.variables
}

test.describe('Variable Setter overrides an expression variable', () => {
  test('the watched Current value settles on new value! and never reverts to 123', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const fixture = loadFixture()

    // ------------------------------------------------------------------
    // Import + validation gate (zero errors before the run).
    // ------------------------------------------------------------------
    await page.request
      .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
      .catch(() => {})
    await ensureEnvironment(page.request)

    const createResp = await page.request.post(
      `http://localhost:${BACKEND_PORT}/tests`,
      { data: fixture },
    )
    const createBody = await createResp.json().catch(() => null)
    expect(
      createResp.ok(),
      `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`,
    ).toBeTruthy()
    const testId = (createBody.data?.id ?? createBody.id) as string

    const validateResp = await page.request.post(
      `http://localhost:${BACKEND_PORT}/tests/${testId}/validate`,
    )
    expect(
      validateResp.ok(),
      `POST /tests/{id}/validate failed: ${validateResp.status()}`,
    ).toBeTruthy()
    const validateBody = await validateResp.json()
    const errors = validateBody?.data?.errors ?? validateBody?.errors ?? []
    expect(errors, `validation errors: ${JSON.stringify(errors)}`).toEqual([])

    // ------------------------------------------------------------------
    // Navigate + stage the watcher on s1 BEFORE the run.
    // ------------------------------------------------------------------
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const panel = page.locator('[data-testid="variable-manager"]')
    if ((await panel.getAttribute('data-state')) === 'collapsed') {
      await panel.locator('button[aria-label="Expand Variable Manager"]').click()
      await expect(panel).toHaveAttribute('data-state', 'expanded')
    }

    await rowFor(page, 's1').locator('[data-testid^="expand-button-"]').click()
    const modal = modalFor(page, 's1')
    await expect(modal).toBeVisible()
    // Idle: an unevaluated expression watcher shows the empty state.
    await expect(modal.locator('text="Not evaluated yet."')).toBeVisible()

    // ------------------------------------------------------------------
    // Run.
    // ------------------------------------------------------------------
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    await expect(page.locator('[data-testid="workflow-status"]')).not.toHaveAttribute(
      'data-status',
      'idle',
      { timeout: 10_000 },
    )

    // The setter writes the literal; the evaluated Current value becomes it.
    // A string body renders raw (no quotes) through the line-numbered editor,
    // so read the value from the editor content.
    const scalarBody = modal.locator('[data-testid="scalar-body"]').locator('.cm-content')
    await expect(scalarBody).toHaveText('new value!', { timeout: 15_000 })

    // Terminal state: the deferred realization push (if it existed) has long
    // since landed by now. The watched Current value must NOT have reverted.
    await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
      'data-status',
      'passed',
      { timeout: 30_000 },
    )
    await expect(scalarBody).toHaveText('new value!')

    // ------------------------------------------------------------------
    // Propagation + scope proofs.
    // ------------------------------------------------------------------
    const logTexts = await getLogTexts(page)
    const allLogText = logTexts.join('\n')
    expect(
      logTexts.some((t) => t === 'final=new value!'),
      `Expected 'final=new value!'\n${allLogText}`,
    ).toBeTruthy()
    expect(
      logTexts.some((t) => t === 'final=123'),
      `'final=123' must not appear (expression must not clobber the write)\n${allLogText}`,
    ).toBeFalsy()

    const sessionId = await getActiveSessionId(page)
    const variables = await getSessionVariables(page, sessionId)
    expect(variables.s1).toBeTruthy()
    expect(variables.s1.type).toBe('string')
    expect(variables.s1.value).toBe('new value!')

    // The Var Setter and Log both reached success.
    await expect(
      page.locator('[data-testid="workflow-node-varset-s1"]'),
    ).toHaveAttribute('data-execution-status', 'success')
    await expect(
      page.locator('[data-testid="workflow-node-log-s1"]'),
    ).toHaveAttribute('data-execution-status', 'success')
  })
})
