/**
 * V-FN-CONFIG-DIALOGS-MD (visual): the Function config modal's Changelog and
 * Details dialogs render their per-version content as real, *styled* Markdown,
 * wrap long tokens, and (changelog) show a human release date.
 *
 * Guards:
 *   - changelog rendered markdown (#/## -> headings, - -> list), human
 *     release date (no raw ISO), long token wraps.
 *   - details rendered markdown (headings, list, bold, code).
 *   - the details description subtitle wraps (no horizontal run-off).
 *   - markdown is *styled*: the @tailwindcss/typography `prose` plugin must be
 *     loaded, so headings are larger than body and lists show bullet markers
 *     (react-markdown emits bare <h1>/<ul>, which reads as flat
 *     unstyled text). Overflow is measured at the scroll viewport (the real
 *     clip boundary), not at the auto-growing .prose div.
 *
 * Phase: no-data (seeds its own library entry + Test via POST). DOM-assertion
 * pattern, no pixel baseline, so the structural + computed-style checks hold in
 * any theme.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-config-md-1'
// Long enough to overflow the dialog by a wide margin when it does NOT wrap.
const LONG = 'M'.repeat(140)

const CHANGELOG = [
  '# Release notes',
  '## Version 1.0.0',
  '- Added the **first** output',
  '- Tightened `binding` resolution',
  '',
  LONG,
].join('\n')

const DETAILS = [
  '# Documentation',
  '## Overview',
  'This Function does **important** work with `inline code`.',
  '',
  '- Step one',
  '- Step two',
  '',
  LONG,
].join('\n')

const DESCRIPTION = `A very long per-version description that must wrap: ${LONG}`

async function seedLibrary(request: APIRequestContext): Promise<{ functionId: string; name: string }> {
  const name = `cfg_md_${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: DESCRIPTION,
      tags: [],
      inputs: [],
      outputs: [],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: CHANGELOG,
      details: DETAILS,
    },
  })
  expect(resp.ok(), `POST /functions: ${resp.status()}`).toBeTruthy()
  return { functionId: (await resp.json()).data.id, name }
}

async function seedTest(request: APIRequestContext, fn: { functionId: string; name: string }): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-CONFIG-DIALOGS-MD ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Shared instance for the markdown dialog guards',
      workflow: {
        nodes: [
          {
            id: FN_NODE_ID,
            type: 'workflowNode',
            position: { x: 300, y: 200 },
            data: {
              label: fn.name,
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'shared',
              functionId: fn.functionId,
              functionVersion: '1.0.0',
              originalLibraryName: fn.name,
              category: 'function',
              version: '1.0.0',
              hasNewerVersion: false,
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: {}, outputBindings: {}, profileBindings: [] },
            },
            measured: { width: 120, height: 62 },
          },
        ],
        edges: [],
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

async function openConfigModal(page: Page): Promise<void> {
  const node = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
  await node.locator('button').first().dblclick()
  await expect(configSheet(page)).toBeVisible({ timeout: 10_000 })
}

type Loc = ReturnType<Page['locator']>

/** The scroll container is the real horizontal clip boundary: if a long token
 *  does not wrap, its content widens and scrollWidth exceeds clientWidth. These
 *  dialogs use a plain overflow scroll div (NOT a Radix ScrollArea, whose
 *  display:table wrapper defeats overflow-wrap and let the run-off through). */
async function expectScrollNoOverflow(dialog: Loc, testid: string): Promise<void> {
  const scroller = dialog.locator(`[data-testid="${testid}"]`)
  await expect(scroller).toBeVisible()
  const overflow = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow, 'scroll container must not overflow horizontally').toBeLessThanOrEqual(1)
}

/** Markdown must be *styled*, not just structurally present: the typography
 *  plugin sizes headings above body text and gives lists bullet markers. Without
 *  the plugin the CSS reset flattens both, which is what looked "unstyled". */
async function expectMarkdownStyled(dialog: Loc): Promise<void> {
  const listStyle = await dialog
    .locator('.prose ul')
    .first()
    .evaluate((el) => getComputedStyle(el).listStyleType)
  expect(listStyle, 'list must show bullet markers (typography plugin loaded)').toBe('disc')

  const h1Size = await dialog
    .locator('.prose h1')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  const liSize = await dialog
    .locator('.prose li')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(h1Size, 'heading must be larger than body text (typography plugin loaded)').toBeGreaterThan(liSize)
}

test.describe('V-FN-CONFIG-DIALOGS-MD (visual): markdown changelog + details', () => {
  test('changelog renders styled markdown, a human date, and wraps long text', async ({ page, request }) => {
    const fn = await seedLibrary(request)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)
    await openConfigModal(page)

    await page.locator('[data-testid="function-changelog-button"]').click()
    const dialog = page.locator('[role="dialog"]', { hasText: 'Release notes' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Markdown structure: #/## become headings, - becomes a list, ** -> strong, ` -> code.
    await expect(dialog.locator('h1', { hasText: 'Release notes' })).toBeVisible()
    await expect(dialog.locator('h2', { hasText: 'Version 1.0.0' })).toBeVisible()
    await expect(dialog.locator('li')).toHaveCount(2)
    await expect(dialog.locator('strong', { hasText: 'first' })).toBeVisible()
    await expect(dialog.locator('code', { hasText: 'binding' })).toBeVisible()
    // The raw markdown tokens must NOT appear literally.
    await expect(dialog).not.toContainText('# Release notes')
    await expect(dialog).not.toContainText('- Added the')

    // The markdown is actually styled (headings sized, list bulleted).
    await expectMarkdownStyled(dialog)

    // Release date is human-formatted, never a raw ISO string.
    const released = dialog.getByText(/Released:/)
    await expect(released).toContainText(/Released: [A-Z][a-z]{2} \d{1,2}, \d{4}/)
    await expect(released).not.toContainText('T')
    await expect(released).not.toContainText('Z')

    // The long unbroken token wraps - the scroll container has no horizontal run-off.
    await expectScrollNoOverflow(dialog, 'changelog-scroll')
  })

  test('details render styled markdown and the description wraps', async ({ page, request }) => {
    const fn = await seedLibrary(request)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)
    await openConfigModal(page)

    await page.locator('[data-testid="function-details-button"]').click()
    const dialog = page.locator('[role="dialog"]', { hasText: 'Overview' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Markdown body: headings, list, bold, code.
    await expect(dialog.locator('h1', { hasText: 'Documentation' })).toBeVisible()
    await expect(dialog.locator('h2', { hasText: 'Overview' })).toBeVisible()
    await expect(dialog.locator('li')).toHaveCount(2)
    await expect(dialog.locator('strong', { hasText: 'important' })).toBeVisible()
    await expect(dialog.locator('code', { hasText: 'inline code' })).toBeVisible()
    await expect(dialog).not.toContainText('# Documentation')

    // The markdown is actually styled (headings sized, list bulleted).
    await expectMarkdownStyled(dialog)

    // The long description subtitle wraps instead of running off-screen.
    const description = dialog.getByText(/A very long per-version description/)
    await expect(description).toBeVisible()
    const descOverflow = await description.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(descOverflow, 'description must wrap, not overflow').toBeLessThanOrEqual(1)
    // The long markdown body token wraps too (measured at the scroll container).
    await expectScrollNoOverflow(dialog, 'details-scroll')
  })
})
