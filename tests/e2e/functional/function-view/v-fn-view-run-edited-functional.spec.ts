/**
 * V-FN-VIEW-RUN-EDITED (functional): an UNSAVED edit made in the library View's
 * edit mode is folded into the standalone run body, so the run executes the
 * EDITED draft - not the pinned published version.
 *
 * REQ-3.2.1.1, REQ-3.1.2.2.
 *
 * The working body of a drilled View sits in the transient localDefinition;
 * resolveViewRunBody folds it into the draft at run time. Edits deeper than the
 * synthetic root are covered by run-current-nested/v-rc-nested-functional.spec.ts.
 *
 * Phase: functional-workflow. Self-seeds a published Function via REST.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import {
  publishLibraryFunction,
  openFunctionView,
  logNode,
  startEdge,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'
import { getLogTexts } from '../../helpers/log-reader'
import { E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

/** A published Function whose body logs two literals: one kept, one disabled. */
function seedViewFunction(request: APIRequestContext): Promise<SeededLibraryFunction> {
  return publishLibraryFunction(request, {
    name: `View-Edit-${randomUUID().slice(0, 6)}`,
    workflow: {
      nodes: [
        logNode('view-keep', 'Keep', "'view-keep'", { x: 200, y: 160 }),
        logNode('view-drop', 'Drop', "'view-drop'", { x: 200, y: 300 }),
      ],
      edges: [startEdge('view-keep'), { id: 'e-vk-vd', source: 'view-keep', target: 'view-drop' }],
    },
  })
}

async function selectEnvironment(page: Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

test.describe('V-FN-VIEW-RUN-EDITED (functional): View edit folds into the standalone run', () => {
  test('a disabled node in the View edit draft is reflected in the run body and execution', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)
    const fn = await seedViewFunction(request)
    await openFunctionView(page, fn.functionId, fn.version)
    await selectEnvironment(page)

    // Enter edit mode, then disable an inner node in the drilled (synthetic-root) body.
    await page.locator('[data-testid="action-bar-edit-function-button"]').click()
    await expect(page.locator('[data-testid="action-bar-publish-button"]')).toBeVisible({ timeout: 15_000 })

    const dropNode = page.locator('[data-testid="workflow-node-view-drop"]')
    await expect(dropNode).toBeVisible()
    await dropNode.click({ button: 'right' })
    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    await menu.locator('[role="menuitem"]').filter({ hasText: 'Disable' }).click()
    await expect(menu).not.toBeVisible()
    await expect(dropNode).toHaveAttribute('data-disabled', 'true')

    // Run: the standalone run must carry the EDITED draft (resolveViewRunBody fold),
    // not the pinned published version.
    const runReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes(`/functions/${fn.functionId}/run`),
    )
    await page.locator('[data-testid="run-button"]').click()
    const body = (await runReq).postDataJSON()
    expect(body.draft, 'View edit-mode Run dispatches the in-memory draft').toBeTruthy()
    expect(body.version, 'the draft names the version it was made from').toBe(fn.version)
    const draftNodes = (body.draft.workflow.nodes ?? []) as Array<{ id: string; data?: { disabled?: boolean } }>
    const dropInDraft = draftNodes.find((n) => n.id === 'view-drop')
    expect(dropInDraft?.data?.disabled, 'the disabled edit is folded into the run draft').toBe(true)

    // End-to-end: the kept line runs, the disabled line does not.
    await expect
      .poll(async () => (await getLogTexts(page)).join(' | '), { timeout: 30_000 })
      .toContain('view-keep')
    const logs = await getLogTexts(page)
    expect(
      logs.some((m) => m.includes('view-drop')),
      `view-drop is disabled and must NOT run\n${logs.join('\n')}`,
    ).toBe(false)
  })
})
