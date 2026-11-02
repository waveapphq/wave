/**
 * V-CONSOLE-SETTINGS-PERSIST-FUNCTIONAL: console display settings are one
 * remembered per-browser preference shared by every console surface.
 * Design Decisions: RUNM-10; REPORT-12..14
 * REQ: REQ-3.4.2.7
 *
 * Pass Criteria:
 * 1. Changing all four column/filter switches + text size in the live console
 *    survives a reload (persisted per browser).
 * 2. The Execution History console renders with the same settings and its own
 *    settings control writes back to the same preference.
 * 3. The report log panel follows the shared preference for exactly its three
 *    column toggles; text size and the system-log filter stay at defaults
 *    there (report appearance is otherwise unchanged).
 * 4. A column toggled from the report panel is reflected back in the history
 *    console (single shared store, all surfaces).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const STORAGE_KEY = 'wave-console-display-settings'

function loadFixture(): Record<string, unknown> {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
  fixture.name = `Console Settings Persist ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return fixture
}

async function environmentId(request: APIRequestContext): Promise<string> {
  await ensureEnvironment(request)
  const resp = await request.get(`${BACKEND_URL}/environments/`)
  const body = await resp.json()
  const env = (body.data as Array<{ id: string; name: string }>).find(
    (e) => e.name === E2E_ENV_NAME,
  )
  expect(env, `environment "${E2E_ENV_NAME}" exists`).toBeTruthy()
  return env!.id
}

async function importFixture(request: APIRequestContext): Promise<string> {
  const createResp = await request.post(`${BACKEND_URL}/tests`, { data: loadFixture() })
  const createBody = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`,
  ).toBeTruthy()
  return (createBody.data?.id ?? createBody.id) as string
}

async function runTracked(request: APIRequestContext, testId: string, envId: string): Promise<string> {
  const startResp = await request.post(`${BACKEND_URL}/executions`, {
    data: { type: 'test', id: testId, environment_id: envId },
  })
  expect(startResp.ok(), `POST /executions failed: ${startResp.status()}`).toBeTruthy()
  const executionId = ((await startResp.json()).data as { id: string }).id
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
        return (((await resp.json()).data ?? {}) as { status?: string }).status
      },
      { timeout: 30_000, message: 'expected the tracked run to reach a terminal state' },
    )
    .toBe('passed')
  return executionId
}

async function generateJsonReport(request: APIRequestContext, executionId: string): Promise<void> {
  await request.post(`${BACKEND_URL}/executions/${executionId}/report?format=json`)
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${BACKEND_URL}/executions/${executionId}/report?format=json`)
        const job = ((await resp.json()).data ?? {}) as { status?: string }
        expect(job.status, 'report job must not fail').not.toBe('failed')
        return job.status
      },
      { timeout: 30_000, message: 'expected the JSON report job to complete' },
    )
    .toBe('completed')
}

async function expandConsole(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="console-panel"]').first()
  if ((await panel.getAttribute('data-state')) === 'collapsed') {
    await page
      .locator('[data-testid="console-panel-header"] button[aria-label="Toggle console"]')
      .first()
      .click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

async function openConsoleSettings(page: Page): Promise<void> {
  await expandConsole(page)
  await page
    .locator('[data-testid="console-panel-header"] button[aria-label="Console settings"]')
    .first()
    .click()
  await expect(page.locator('[data-testid="settings-row-timestamps"]')).toBeVisible()
}

function settingsSwitch(page: Page, row: string) {
  return page.locator(`[data-testid="settings-row-${row}"] button[role="switch"]`)
}

/** Rows of the console (excludes the source/message spans sharing the prefix). */
function logRows(page: Page) {
  return page
    .locator('[data-testid^="log-entry-"]')
    .filter({ has: page.locator('[data-testid="log-entry-message"]') })
}

async function persistedSettings(page: Page): Promise<Record<string, unknown>> {
  const raw = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    STORAGE_KEY,
  )
  expect(raw, `localStorage["${STORAGE_KEY}"] exists`).toBeTruthy()
  return (JSON.parse(raw!) as { state: { settings: Record<string, unknown> } }).state.settings
}

test.describe('V-CONSOLE-SETTINGS-PERSIST-FUNCTIONAL: one persisted preference across every console surface', () => {
  test('settings survive reload and bind the live, history and report consoles', async ({
    page,
    request,
  }) => {
    const envId = await environmentId(request)
    const testId = await importFixture(request)
    const executionId = await runTracked(request, testId, envId)
    await generateJsonReport(request, executionId)

    const historyResp = await request.get(`${BACKEND_URL}/executions/history/${executionId}`)
    const historyLogs = (((await historyResp.json()).data ?? {}) as {
      logs?: Array<{ level?: string; source?: string }>
    }).logs ?? []
    expect(historyLogs.length, 'the tracked run persisted log rows').toBeGreaterThan(0)

    await test.step('change every display setting in the live console', async () => {
      await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
      await page.goto('/workbench')
      await page.evaluate(() => localStorage.clear())
      await page.goto('/workbench')
      await openConsoleSettings(page)

      for (const row of ['timestamps', 'level', 'source', 'system-logs']) {
        const toggle = settingsSwitch(page, row)
        await expect(toggle).toHaveAttribute('aria-checked', 'true')
        await toggle.click()
        await expect(toggle).toHaveAttribute('aria-checked', 'false')
      }
      const fontRow = page.locator('[data-testid="settings-row-font-size"]')
      await fontRow.locator('button[aria-label="Increase text size"]').click()
      await fontRow.locator('button[aria-label="Increase text size"]').click()
      await expect(page.locator('[data-testid="font-size-display"]')).toHaveText('14')

      const stored = await persistedSettings(page)
      expect(stored).toMatchObject({
        showTimestamps: false,
        showLevel: false,
        showSource: false,
        showSystemLogs: false,
        fontSize: 14,
      })
    })

    await test.step('reload: the live console keeps the preference', async () => {
      await page.reload()
      await openConsoleSettings(page)
      for (const row of ['timestamps', 'level', 'source', 'system-logs']) {
        await expect(settingsSwitch(page, row)).toHaveAttribute('aria-checked', 'false')
      }
      await expect(page.locator('[data-testid="font-size-display"]')).toHaveText('14')
      await page.keyboard.press('Escape')
    })

    await test.step('the Execution History console applies the same preference', async () => {
      await page.goto(`/executions/history/${executionId}`)
      await expect(page.locator('[data-testid="canvas-page"]')).toBeVisible({ timeout: 30_000 })
      await openConsoleSettings(page)
      for (const row of ['timestamps', 'level', 'source', 'system-logs']) {
        await expect(settingsSwitch(page, row)).toHaveAttribute('aria-checked', 'false')
      }
      await page.keyboard.press('Escape')

      await expect(logRows(page).first()).toBeVisible()
      await expect(page.locator('.log-timestamp')).toHaveCount(0)
      await expect(page.locator('.level-badge')).toHaveCount(0)
      await expect(page.locator('[data-testid="log-entry-source"]')).toHaveCount(0)
      await expect(logRows(page).first()).toHaveCSS('font-size', '14px')

      // System rows are filtered out here (showSystemLogs off): only the
      // non-SYSTEM rows at or above the default INFO floor remain.
      const expectedVisible = historyLogs.filter(
        (entry) =>
          entry.source !== 'SYSTEM' && (entry.level ?? 'INFO').toUpperCase() !== 'DEBUG',
      ).length
      await expect(logRows(page)).toHaveCount(expectedVisible)
    })

    await test.step('a change made in the history console writes the shared preference', async () => {
      await openConsoleSettings(page)
      const toggle = settingsSwitch(page, 'timestamps')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', 'true')
      await page.keyboard.press('Escape')
      await expect(page.locator('.log-timestamp').first()).toBeVisible()
      const stored = await persistedSettings(page)
      expect(stored).toMatchObject({ showTimestamps: true, showLevel: false })
    })

    await test.step('the report log panel follows exactly its three column toggles', async () => {
      await page.goto(`/reports/${executionId}`)
      const logsSection = page.getByTestId('report-logs')
      await expect(logsSection).toBeVisible({ timeout: 30_000 })

      // Shared columns: timestamps back on, level + source off.
      await expect(logsSection.locator('.log-timestamp').first()).toBeVisible()
      await expect(logsSection.locator('.level-badge')).toHaveCount(0)
      await expect(logsSection.locator('[data-testid="log-entry-source"]')).toHaveCount(0)

      // Text size stays at the report default (12px), never the shared 14.
      const reportRows = logsSection
        .locator('[data-testid^="log-entry-"]')
        .filter({ has: page.locator('[data-testid="log-entry-message"]') })
      await expect(reportRows.first()).toBeVisible()
      await expect(reportRows.first()).toHaveCSS('font-size', '12px')

      // The reduced Columns picker mirrors the shared column flags.
      await page.getByTestId('report-logs-columns').click()
      const timeItem = page.getByRole('menuitemcheckbox', { name: 'Time' })
      const levelItem = page.getByRole('menuitemcheckbox', { name: 'Level' })
      const sourceItem = page.getByRole('menuitemcheckbox', { name: 'Source' })
      await expect(timeItem).toHaveAttribute('aria-checked', 'true')
      await expect(levelItem).toHaveAttribute('aria-checked', 'false')
      await expect(sourceItem).toHaveAttribute('aria-checked', 'false')

      // Toggling Source here writes the shared preference.
      await sourceItem.click()
      await expect(sourceItem).toHaveAttribute('aria-checked', 'true')
      await page.keyboard.press('Escape')
      await expect(logsSection.locator('[data-testid="log-entry-source"]').first()).toBeVisible()
      const stored = await persistedSettings(page)
      expect(stored).toMatchObject({ showSource: true, showTimestamps: true, showLevel: false })

      // The system-log switch does not exist on the report surface and the
      // shared "off" value is inert here - SYSTEM rows still render.
      const sources = await logsSection
        .locator('[data-testid="log-entry-source"]')
        .evaluateAll((cells) => cells.map((cell) => cell.textContent?.trim() ?? ''))
      expect(
        sources.some((text) => text.includes('SYSTEM')),
        `report rows keep SYSTEM lines regardless of the shared system-log filter: ${JSON.stringify(sources)}`,
      ).toBeTruthy()
    })

    await test.step('the report-made change reaches the history console', async () => {
      await page.goto(`/executions/history/${executionId}`)
      await expect(page.locator('[data-testid="canvas-page"]')).toBeVisible({ timeout: 30_000 })
      await expandConsole(page)
      await expect(logRows(page).first()).toBeVisible()
      await expect(page.locator('[data-testid="log-entry-source"]').first()).toBeVisible()
      await expect(page.locator('.level-badge')).toHaveCount(0)
    })
  })
})
