/**
 * Template variable renders lazily on reference (functional)
 *
 * Proves a template value kind end-to-end (REQ-3.1.3.15): a template variable
 * `greeting = "Hello {{user}}!"` renders to the string "Hello Ada!" when a Log
 * node references it. The reference routes through LazyVariables.__getitem__,
 * which realizes the template via plugin_executor._evaluate_template, substituting
 * the literal `user`. A single-pass substitution; recursion (here just the one
 * `{{user}}` ref) happens through variable references.
 *
 * Also guards two behaviors of the live inspect watcher:
 *   - the footer metric reads "N chars" ONLY for the realized string VALUE
 *     (Rendered view); the Template (source) view carries NO metric.
 *   - a computed variable (template `farewell` / expression `total`) that no
 *     node references stays unevaluated after the run - the Current watcher
 *     shows the empty state, NOT its source (run-start snapshot excludes
 *     computed vars).
 *
 * Design Decisions: lazy template realization; the Rendered/Template watcher
 * REQ: REQ-3.1.3.13 (computed variables with runtime evaluation),
 * REQ-3.1.3.15 (template variables), REQ-3.1.3.11 (variable watching UI panel)
 *
 * Pass Criteria:
 * 1. The fixture passes POST /tests/{id}/validate with zero errors.
 * 2. The workflow runs to the passed terminal state.
 * 3. The open `greeting` watcher transitions from "Not rendered yet." to the
 *    realized string "Hello Ada!" with the "10 chars" metric.
 * 4. The Template (source) view shows "Hello {{user}}!" and carries NO metric.
 * 5. The downstream Log emits the realized string "Hello Ada!".
 * 6. GET /workbench/{session_id}/variables returns `greeting = "Hello Ada!"`.
 * 7. The never-referenced `farewell` (template) and `total` (expression) Current
 *    watchers show the empty state, not their source.
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
  fixture.name = `Template Variable Render ${Date.now()}`
  return fixture
}

const content = (page: Page): Locator =>
  page.locator('[data-testid="variable-manager-content"]')

const rowFor = (page: Page, name: string): Locator =>
  content(page).locator(`[aria-label="Variable ${name}"]`)

const modalFor = (page: Page, name: string): Locator =>
  page.locator(`section[aria-label="Inspect variable ${name}"]`)

async function openWatcher(page: Page, name: string): Promise<Locator> {
  await rowFor(page, name).locator('[data-testid^="expand-button-"]').click()
  const modal = modalFor(page, name)
  await expect(modal).toBeVisible()
  return modal
}

async function closeWatcher(page: Page, name: string): Promise<void> {
  await modalFor(page, name).locator(`[aria-label="Close inspector for ${name}"]`).click()
  await expect(modalFor(page, name)).toHaveCount(0)
}

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

test.describe('Template variable renders lazily on reference', () => {
  test('greeting realizes to "Hello Ada!" on reference; unreferenced computed vars stay empty', async ({
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
    // Navigate + stage the greeting watcher BEFORE the run.
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

    // The template row carries the cyan {{ }} kind badge (not the {x} expr badge).
    await expect(
      rowFor(page, 'greeting').locator('[data-testid^="template-badge-"]'),
    ).toHaveText('{{ }}')

    const modal = await openWatcher(page, 'greeting')
    // Idle: a template watcher opens on Rendered with the empty state - no value
    // yet, and the source must NOT leak through (pre-run parity).
    await expect(modal.locator('text="Not rendered yet."')).toBeVisible()
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)

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

    // The Log references `greeting`, realizing the template lazily. The Rendered
    // view shows the realized string raw through the line-numbered editor.
    const scalarBody = modal.locator('[data-testid="scalar-body"]').locator('.cm-content')
    await expect(scalarBody).toHaveText('Hello Ada!', { timeout: 15_000 })

    // A realized string VALUE carries the "N chars" metric ("Hello Ada!"
    // is 10 chars); the "no value yet" word is gone.
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveText('10 chars')

    await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
      'data-status',
      'passed',
      { timeout: 30_000 },
    )
    await expect(scalarBody).toHaveText('Hello Ada!')

    // The Template (source) view shows the {{ }} source and carries NO
    // metric - a source is not a value, so there is no char count.
    await modal.locator('[data-testid="view-dropdown"]').click()
    await page.getByRole('option', { name: 'Template', exact: true }).click()
    // The template source renders through the line-numbered editor; read the
    // value from .cm-content (the gutter would otherwise prefix line numbers).
    await expect(
      modal.locator('[data-testid="scalar-body"]').locator('.cm-content'),
    ).toHaveText('Hello {{user}}!')
    await expect(modal.locator('[data-testid="inspect-metric"]')).toHaveCount(0)
    await closeWatcher(page, 'greeting')

    // ------------------------------------------------------------------
    // Propagation + scope proofs.
    // ------------------------------------------------------------------
    const logTexts = await getLogTexts(page)
    const allLogText = logTexts.join('\n')
    expect(
      logTexts.some((t) => t === 'Hello Ada!'),
      `Expected the realized template 'Hello Ada!'\n${allLogText}`,
    ).toBeTruthy()

    const sessionId = await getActiveSessionId(page)
    const variables = await getSessionVariables(page, sessionId)
    expect(variables.greeting).toBeTruthy()
    expect(variables.greeting.type).toBe('string')
    expect(variables.greeting.value).toBe('Hello Ada!')

    await expect(
      page.locator('[data-testid="workflow-node-log-greeting"]'),
    ).toHaveAttribute('data-execution-status', 'success')

    // ------------------------------------------------------------------
    // A computed variable no node references stays unevaluated after the
    // run. The run-start snapshot excludes computed vars, so the Current watcher
    // shows the empty state, NOT the {{ }} source / formula.
    // ------------------------------------------------------------------
    const farewell = await openWatcher(page, 'farewell')
    await expect(farewell.locator('text="Not rendered yet."')).toBeVisible()
    await expect(farewell.locator('[data-testid="scalar-body"]')).toHaveCount(0)
    await closeWatcher(page, 'farewell')

    const total = await openWatcher(page, 'total')
    await expect(total.locator('text="Not evaluated yet."')).toBeVisible()
    await expect(total.locator('[data-testid="scalar-body"]')).toHaveCount(0)
    await closeWatcher(page, 'total')
  })
})
