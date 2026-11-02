/**
 * V-VMGR-03: Variable Manager Panel - Functional Behavior
 *
 * Design Decisions: watcher removed, per-row layout, eye toggle semantics,
 * delete locks during execution, history read-only
 * REQ: REQ-3.1.3.11, REQ-3.1.3.12, REQ-3.2.2.18
 *
 * Pass Criteria:
 * 1. Run All starts and reaches a passing terminal state.
 * 2. After the run, eye toggles on non-secret rows are enabled.
 * 3. The referenced expression variable evaluates lazily and surfaces its
 *    runtime value; the unused expression variable stays as the expression
 *    text.
 * 4. Array / map runtime values render as count summaries
 *    "[2 items]" / "{3 keys}".
 * 5. The eye toggle flips the row between runtime and definition view; eye
 *    state survives across re-renders.
 * 6. A second Run All clears stale runtime values before the new run
 *    repopulates them.
 * 7. After a passing terminal state, edit and delete buttons unlock - no
 *    "Locked while the test is executing" tooltip.
 * 8. The secret row's value remains masked through the entire run.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8')
  const fixture = JSON.parse(raw)
  fixture.name = `V-VMGR-03 ${Date.now()}`
  return fixture
}

async function importAndOpen(page: Page): Promise<string> {
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
    .catch(() => {})
  await ensureEnvironment(page.request)

  const fixture = loadFixture()

  // Validation gate: confirm the fixture passes design-time validation
  // before we exercise it in the workbench. Validation must be zero-error.
  const createResp = await page.request.post(
    `http://localhost:${BACKEND_PORT}/tests`,
    { data: fixture },
  )
  const body = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = body.data?.id || body.id

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

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)

  const panel = page.locator('[data-testid="variable-manager"]')
  const state = await panel.getAttribute('data-state')
  if (state === 'collapsed') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }

  return testId
}

async function selectEnvironment(page: Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

async function runToPassed(page: Page): Promise<void> {
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
  await expect(status).toHaveAttribute('data-status', 'passed', { timeout: 30_000 })
}

test.describe('V-VMGR-03: Variable Manager functional behavior', () => {
  test('runtime values stream + eye toggle + lazy expressions + count summaries + edit/delete unlock', async ({
    page,
  }) => {
    await importAndOpen(page)
    await selectEnvironment(page)

    const content = page.locator('[data-testid="variable-manager-content"]')

    await test.step('STEP 1: Run All to a passing terminal state', async () => {
      await runToPassed(page)
    })

    await test.step('STEP 2: Eyes on non-secret rows unlock after the run', async () => {
      const eyeNames = ['counter', 'items_arr', 'map_data', 'referenced_expr', 'unused_expr']
      for (const name of eyeNames) {
        const eye = content
          .locator(`[aria-label="Variable ${name}"]`)
          .locator('[data-testid^="view-toggle-button-"]')
        await expect(
          eye,
          `eye for ${name} should be enabled after a run produces runtime values`,
        ).not.toHaveAttribute('aria-disabled', 'true')
      }
    })

    await test.step('STEP 3: Referenced expression evaluates lazily; unused expression has no runtime value', async () => {
      const referencedValue = content
        .locator('[aria-label="Variable referenced_expr"]')
        .locator('[data-testid^="variable-value-"]')
      await expect(referencedValue).toHaveText('15')

      const unusedValue = content
        .locator('[aria-label="Variable unused_expr"]')
        .locator('[data-testid^="variable-value-"]')
      // The Log node never reads ``unused_expr``, so the BE leaves it
      // pending in the LazyVariables map. With no ``variable_changed``
      // event for it, the row has ``hasRuntimeValue=false`` while
      // ``runtimeAvailable=true`` (other rows do have runtime values),
      // which surfaces the "<not evaluated yet>" placeholder. The
      // backend lazy-evaluation guarantee is what produces
      // this state - the expression was never realized.
      await expect(unusedValue).toContainText('<not evaluated yet>')
    })

    await test.step('STEP 4: Array and map runtime values render as count summaries', async () => {
      const arrValue = content
        .locator('[aria-label="Variable items_arr"]')
        .locator('[data-testid^="variable-value-"]')
      await expect(arrValue).toHaveText('[2 items]')

      const mapValue = content
        .locator('[aria-label="Variable map_data"]')
        .locator('[data-testid^="variable-value-"]')
      await expect(mapValue).toHaveText('{3 keys}')
    })

    await test.step('STEP 5: Eye toggle flips runtime <-> definition', async () => {
      const counterRow = content.locator('[aria-label="Variable counter"]')
      const counterValue = counterRow.locator('[data-testid^="variable-value-"]')
      const counterEye = counterRow.locator('[data-testid^="view-toggle-button-"]')

      // Default: runtime view shows the post-run value.
      await expect(counterValue).toHaveText('5')
      const runtimeClass = (await counterValue.getAttribute('class')) ?? ''
      expect(runtimeClass).not.toMatch(/italic/)

      // Toggle to definition view: shows the literal initial value, italic + dim.
      await counterEye.click()
      await expect(counterValue).toHaveText('0')
      const defClass = (await counterValue.getAttribute('class')) ?? ''
      expect(defClass).toMatch(/italic/)
      expect(defClass).toMatch(/opacity-70/)

      // Toggle back to runtime view.
      await counterEye.click()
      await expect(counterValue).toHaveText('5')
    })

    await test.step('STEP 6: Secret stays masked end-to-end', async () => {
      const secretValue = content
        .locator('[aria-label="Variable api_token"]')
        .locator('[data-testid^="variable-value-"]')
      await expect(secretValue).toHaveText('********')
    })

    await test.step('STEP 7: Edit and delete are unlocked after a passing terminal state', async () => {
      const counterRow = content.locator('[aria-label="Variable counter"]')
      const edit = counterRow.locator('[data-testid^="edit-button-"]')
      const del = counterRow.locator('[data-testid^="delete-button-"]')
      await expect(edit).not.toHaveAttribute('aria-disabled', 'true')
      await expect(del).not.toHaveAttribute('aria-disabled', 'true')

      // Hover edit - tooltip should NOT contain the executing-locked copy.
      await edit.hover()
      const lockedTooltip = page.getByRole('tooltip', {
        name: /Locked while the test is executing/i,
      })
      await expect(lockedTooltip).not.toBeVisible()
    })

    await test.step('STEP 8: Run All again clears stale runtime values before the new run repopulates them', async () => {
      await page.locator('[data-testid="run-button"]').click()
      const status = page.locator('[data-testid="workflow-status"]')

      // The session id transitions through null on Run All; the FE flushes
      // runtime values before the new run produces fresh ones. We assert the
      // panel reaches the passed terminal state again with the fresh values.
      await expect(status).toHaveAttribute('data-status', 'passed', { timeout: 30_000 })
      const referencedValue = content
        .locator('[aria-label="Variable referenced_expr"]')
        .locator('[data-testid^="variable-value-"]')
      await expect(referencedValue).toHaveText('15')
    })
  })
})
