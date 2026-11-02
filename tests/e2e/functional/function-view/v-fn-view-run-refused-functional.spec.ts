/**
 * V-FN-VIEW-RUN-REFUSED-FUNCTIONAL: a library View draft the save rules refuse never starts
 * Wireframe: none
 * Design Decisions: none
 * REQ: REQ-3.1.2.4, REQ-3.2.1.1
 *
 * Phase: functional-workflow. Setup seeds (none is the thing under test): a library Function
 * through POST /functions whose body runs three Logs. The draft is broken through the UI: in
 * edit mode two Logs are pointed at names the Function does not declare.
 *
 * Pass Criteria:
 * 1. Run answers that the draft has 2 validation errors and lists each one, naming its Block.
 * 2. The Run Error toast shows the same summary.
 * 3. Nothing runs: the untouched Log prints nothing and the run status stays idle.
 */

import { randomUUID } from 'node:crypto'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { logNode, openFunctionView, publishLibraryFunction, startEdge } from '../../helpers/fn-seed'
import { formatEntries, getLogEntries } from '../../helpers/log-reader'
import { selectEnvironment, setBlockExpression } from '../../helpers/workbench'

const SUMMARY = 'Function draft has 2 validation error(s)'
const notDefined = (name: string) =>
  `Variable '${name}' is not defined in this Function's scope (inputs, outputs, and local variables)`

test.describe('V-FN-VIEW-RUN-REFUSED-FUNCTIONAL: a draft run checked before it starts', () => {
  let functionId: string | undefined

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (functionId) await request.delete(`${BACKEND_URL}/functions/${functionId}?cascade=true`).catch(() => undefined)
  })

  test('a draft the save rules refuse is refused before it starts, listing each error', async ({ page, request }) => {
    test.setTimeout(150_000)
    await ensureEnvironment(request)
    const fn = await publishLibraryFunction(request, {
      name: `v-fn-view-run-refused-${randomUUID().slice(0, 8)}`,
      workflow: {
        nodes: [
          logNode('log-a', 'Log A', "'a-ran'", { x: 200, y: 100 }),
          logNode('log-b', 'Log B', "'b-ran'", { x: 200, y: 220 }),
          logNode('log-c', 'Log C', "'c-ran'", { x: 200, y: 340 }),
        ],
        edges: [
          startEdge('log-a'),
          { id: 'e-a-b', source: 'log-a', target: 'log-b' },
          { id: 'e-b-c', source: 'log-b', target: 'log-c' },
        ],
      },
    })
    functionId = fn.functionId
    await openFunctionView(page, fn.functionId, fn.version)
    await selectEnvironment(page)

    await test.step('edit mode: two Logs read names the Function does not declare', async () => {
      await page.locator('[data-testid="action-bar-edit-function-button"]').click()
      await expect(page.locator('[data-testid="action-bar-publish-button"]')).toBeVisible({ timeout: 15_000 })
      await setBlockExpression(page, 'log-a', 'message', 'missing_a')
      await setBlockExpression(page, 'log-b', 'message', 'missing_b')
    })

    await test.step('Run is refused, listing each error', async () => {
      const answer = page.waitForResponse(
        (resp) => resp.request().method() === 'POST' && resp.url().includes(`/functions/${fn.functionId}/run`),
      )
      await page.locator('[data-testid="run-button"]').click()
      const resp = await answer
      expect(resp.status(), 'the run is refused').toBe(422)
      const error = (await resp.json()).error
      expect(error.message).toBe(SUMMARY)
      const listed = (error.details.errors as Array<Record<string, unknown>>).map((entry) => [
        entry.node_label,
        entry.message,
      ])
      expect(listed).toEqual([
        ['Log A', notDefined('missing_a')],
        ['Log B', notDefined('missing_b')],
      ])
      const toast = page.locator('[data-toast]', { hasText: 'Run Error' })
      await expect(toast.getByText(SUMMARY, { exact: true })).toBeVisible()
    })

    await test.step('nothing ran', async () => {
      await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute('data-status', 'idle')
      const entries = await getLogEntries(page)
      const ran = entries.filter((entry) => ['a-ran', 'b-ran', 'c-ran'].includes(entry.message))
      expect(ran, `no Log ran.\n${formatEntries(entries)}`).toEqual([])
    })
  })
})
