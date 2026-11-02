/**
 * V-CANVAS-NODE-02: Plugin node idle, with description
 *
 * Design Decisions: Element Node Visual Structure; the chevron is a sibling of the body button
 *
 * Phase: fixture (serial) - seeds a test with a node carrying a `data.description`
 * via POST /tests; the workbench renders the description row with a 2-line clamp.
 *
 * Pass Criteria:
 *   1. The description row is rendered with `[data-testid="node-description"]`.
 *   2. The text content matches the seeded `description` exactly.
 *   3. When the seeded description overflows the 2-line clamp, the chevron
 *      renders as a sibling of the body button (positioned absolute,
 *      `right-3 bottom-9 z-10`), NOT inside it.
 *   4. The chevron is a real `<button type="button">` (not `<span role="button">`).
 *   5. Clicking the chevron toggles `data-expanded` on the description element.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

const SHORT_DESC = 'GET /api/users/{id}'
const LONG_DESC = 'Probe the upstream gateway, then unwrap the auth token before fanning out to downstream consumers.'

function buildFixture(description: string, suffix: string) {
  const now = new Date().toISOString().replace('Z', '')
  return {
    name: `V-CANVAS-NODE-02 - ${suffix} ${Date.now()}`,
    version: '1.0.0',
    description: 'Auto-fixture for plugin description row',
    workflow: {
      nodes: [
        {
          id: 'node-1',
          type: 'workflowNode',
          position: { x: 400, y: 200 },
          data: {
            label: 'Shell Script',
            elementType: 'shell-script',
            nodeType: 'plugin',
            category: 'system',
            version: '1.0.0',
            description,
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: { script: 'echo hello' },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
      ],
      edges: [
        { id: 'e-start', source: 'start-node', target: 'node-1', type: 'default' },
      ],
    },
    variables: {},
    metadata: {},
    created_at: now,
    updated_at: now,
  }
}

async function seedTest(page: Page, description: string, suffix: string): Promise<string> {
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
  const resp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: buildFixture(description, suffix),
  })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

test.describe('V-CANVAS-NODE-02: plugin idle, with description', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: description row renders with the seeded text', async ({ page }) => {
    const testId = await seedTest(page, SHORT_DESC, 'short')
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-node-1"]')
    const description = node.locator('[data-testid="node-description"]')
    await expect(description).toBeVisible()
    await expect(description).toHaveText(SHORT_DESC)
  })

  test('S2: short description does NOT show the chevron (no overflow)', async ({ page }) => {
    const testId = await seedTest(page, SHORT_DESC, 'no-overflow')
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-node-1"]')
    await expect(node.locator('[data-testid="node-description"]')).toBeVisible()
    await expect(node.locator('[data-testid="node-description-chevron"]')).toHaveCount(0)
  })

  test('S3: long description shows the chevron as a sibling of the body button', async ({ page }) => {
    const testId = await seedTest(page, LONG_DESC, 'overflow')
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-node-1"]')
    const chevron = node.locator('[data-testid="node-description-chevron"]')
    await expect(chevron).toBeVisible()

    // Chevron is a real <button>, not a <span role="button">.
    const tag = await chevron.evaluate((el) => el.tagName)
    expect(tag).toBe('BUTTON')
    await expect(chevron).toHaveAttribute('type', 'button')

    // Chevron is a SIBLING of the body button, not nested inside it.
    const bodyButton = node.locator('[data-testid="workflow-node-body-node-1"]')
    const chevronInsideBody = await bodyButton.locator('[data-testid="node-description-chevron"]').count()
    expect(
      chevronInsideBody,
      'description chevron must be a sibling of the body button, not nested inside',
    ).toBe(0)
  })

  test('S4: chevron click toggles aria-expanded and data-expanded on the description', async ({ page }) => {
    const testId = await seedTest(page, LONG_DESC, 'toggle')
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-node-1"]')
    const description = node.locator('[data-testid="node-description"]')
    const chevron = node.locator('[data-testid="node-description-chevron"]')

    await expect(chevron).toBeVisible()
    await expect(chevron).toHaveAttribute('aria-expanded', 'false')
    // Production omits `data-expanded` entirely when collapsed (the attribute
    // is only set when `expanded` is true). Assert by counting presence.
    await expect(description).not.toHaveAttribute('data-expanded', 'true')

    await chevron.click()
    await expect(chevron).toHaveAttribute('aria-expanded', 'true')
    await expect(description).toHaveAttribute('data-expanded', 'true')

    await chevron.click()
    await expect(chevron).toHaveAttribute('aria-expanded', 'false')
    await expect(description).not.toHaveAttribute('data-expanded', 'true')
  })
})
