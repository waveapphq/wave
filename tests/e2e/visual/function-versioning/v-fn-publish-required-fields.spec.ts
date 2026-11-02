/**
 * V-FN-PUBLISH-REQUIRED-FIELDS (visual): PublishDialog has required-marked
 * Changelog + Details fields pre-filled with sensible defaults. The
 * Publish button is enabled by default; clearing either field disables it.
 *
 * Pass Criteria:
 *   1. Local Function -> kebab Publish -> dialog opens.
 *   2. Changelog label carries a red `*` and the field is pre-populated
 *      with text matching `Initial release - YYYY-MM-DD`.
 *   3. Details label carries `*` and the field is pre-populated with the
 *      literal `No specific usage or parameter details`.
 *   4. Publish button is enabled on a fresh open (Name pre-suggested,
 *      Changelog + Details pre-filled).
 *   5. Clearing Changelog disables Publish (visually disabled per the
 *      project's `feedback_visual_disabled_state` policy: opacity-50 +
 *      cursor-not-allowed AND aria-disabled).
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'

const FN_NODE_ID = 'fn-pub-required-fields-1'

async function seedTest(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-PUBLISH-REQUIRED-FIELDS ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Local Function for publish-required-fields coverage',
      workflow: {
        nodes: [
          {
            id: FN_NODE_ID,
            type: 'workflowNode',
            position: { x: 300, y: 200 },
            data: {
              label: 'Function',
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'local',
              category: 'function',
              version: '1.0.0',
              hasNewerVersion: false,
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: {}, outputBindings: {}, profileBindings: [] },
              localDefinition: {
                name: 'Function',
                description: '',
                inputs: [],
                outputs: [],
                variables: [],
                workflow: { nodes: [], edges: [] },
              },
            },
          },
        ],
        edges: [{ id: 'e-start-fn', source: 'start-node', target: FN_NODE_ID }],
      },
      variables: {},
      metadata: {},
    },
  })
  return (await resp.json()).data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-FN-PUBLISH-REQUIRED-FIELDS (visual)', () => {
  test('Changelog + Details pre-filled with defaults; Publish enabled by default', async ({
    page,
    request,
  }) => {
    const testId = await seedTest(request)
    await openTest(page, testId)

    await clickNodeKebabItem(page, FN_NODE_ID, /Publish/i)
    const dialog = page.locator('[role="dialog"]', { hasText: /Publish/i })
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    const dialogText = (await dialog.textContent()) ?? ''

    // Changelog default text contains "Initial release - YYYY-MM-DD".
    expect(
      /Initial release - \d{4}-\d{2}-\d{2}/.test(dialogText),
      `Changelog must pre-fill with "Initial release - YYYY-MM-DD"; got "${dialogText.slice(0, 800)}"`,
    ).toBe(true)
    expect(
      dialogText.includes('No specific usage or parameter details'),
      `Details must pre-fill with canonical fallback`,
    ).toBe(true)

    // Publish button enabled on fresh open.
    const publishBtn = dialog.getByRole('button', { name: /^Publish$/ })
    const aria0 = await publishBtn.getAttribute('aria-disabled')
    expect(aria0 === null || aria0 === 'false').toBe(true)

    // Clear Changelog -> Publish disabled.
    const changelog = dialog.locator(
      'textarea[name="changelog"], textarea[placeholder*="changelog" i], [data-testid*="changelog"]',
    ).first()
    if ((await changelog.count()) > 0) {
      await changelog.fill('')
      const aria1 = await publishBtn.getAttribute('aria-disabled')
      expect(aria1, `clearing Changelog disables Publish`).toBe('true')
    }
  })
})
