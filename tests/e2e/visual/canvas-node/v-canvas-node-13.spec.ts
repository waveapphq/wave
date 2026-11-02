/**
 * V-CANVAS-NODE-13: Description chevron is a real <button>, never nested in another <button>
 *
 * The chevron is a `DescriptionChevron` rendered as a sibling of the body
 * button.
 *
 * Phase: fixture (serial) - seeds a test with a long description so the chevron
 * actually renders (the chevron only mounts when the description overflows or
 * has been expanded), then expands/collapses it while listening for the
 * React/HTML5 "button cannot be a descendant of button" warning.
 *
 * Pass Criteria:
 *   1. The chevron is a real `<button type="button">` element (NOT `<span role="button">`).
 *   2. Zero "<button> cannot be a descendant of <button>" console warnings fire
 *      during the test, including after expand/collapse toggles.
 *   3. The chevron carries an explicit `data-testid="node-description-chevron"`.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

const LONG_DESC = 'Probe the upstream gateway, then unwrap the auth token before fanning out to downstream consumers.'

function buildFixture() {
  const now = new Date().toISOString().replace('Z', '')
  return {
    name: `V-CANVAS-NODE-13 - ${Date.now()}`,
    version: '1.0.0',
    description: 'Auto-fixture for chevron-not-nested test',
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
            description: LONG_DESC,
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

async function seedFixture(page: Page): Promise<string> {
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
  const resp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: buildFixture(),
  })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

test.describe('V-CANVAS-NODE-13: description chevron is a real <button> (no nested-button warnings)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: chevron element is a real <button type="button">', async ({ page }) => {
    const testId = await seedFixture(page)
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-node-1"]')
    const chevron = node.locator('[data-testid="node-description-chevron"]')
    await expect(chevron).toBeVisible()
    const tag = await chevron.evaluate((el) => el.tagName)
    expect(tag).toBe('BUTTON')
    await expect(chevron).toHaveAttribute('type', 'button')
  })

  test('S2: no "<button> cannot be a descendant of <button>" warnings fire on toggle', async ({
    page,
  }) => {
    const consoleErrors: string[] = []
    page.on('pageerror', (err) => consoleErrors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') consoleErrors.push(msg.text())
    })

    const testId = await seedFixture(page)
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-node-1"]')
    const chevron = node.locator('[data-testid="node-description-chevron"]')
    await expect(chevron).toBeVisible()

    // Toggle a few times so the chevron and body both re-render through expand/collapse paths.
    await chevron.click()
    await chevron.click()
    await chevron.click()

    const offending = consoleErrors.find((m) =>
      /button.*cannot be a descendant of.*button/i.test(m),
    )
    expect(
      offending,
      `Console messages include nested-button warning:\n${consoleErrors.join('\n')}`,
    ).toBeUndefined()
  })

  test('S3: chevron is a sibling of the body button, not nested', async ({ page }) => {
    const testId = await seedFixture(page)
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-node-1"]')
    const bodyButton = node.locator('[data-testid="workflow-node-body-node-1"]')
    await expect(bodyButton).toBeVisible()

    // The chevron must NOT be a descendant of the body button.
    const nested = await bodyButton.locator('[data-testid="node-description-chevron"]').count()
    expect(nested, 'chevron must be a sibling of the body button, not nested inside').toBe(0)

    // It IS a descendant of the node wrapper.
    await expect(node.locator('[data-testid="node-description-chevron"]')).toHaveCount(1)
  })
})
