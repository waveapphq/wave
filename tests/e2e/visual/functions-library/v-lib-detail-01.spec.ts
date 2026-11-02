/**
 * V-LIB-DETAIL-01: Function detail page.
 * Design Decisions: FNDETAIL-1..13
 * REQ: REQ-3.1.2.3
 *
 * Runs in both the no-data light and dark projects, so every assertion below is
 * verified in both themes (the "wrap in both themes" guard is covered by the matrix).
 *
 * Pass Criteria:
 * 1. The selected version drives the metadata header + collapsible sections;
 *    Inputs/Outputs render a Description column.
 * 2. Per-version delete and whole-Function delete both proceed with usage present.
 * 3. A long unbroken description + changelog WRAP within the content column.
 * 4. A Test pinning a version makes that version's usage count non-zero
 *    and the Usage section lists the Test.
 * 5. The Usage Test link opens the workbench, the Function link opens its
 *    detail page - both client-side (no reload, no 404).
 * 6. The page issues a SINGLE /dependents/by-version request (not one per
 *    version) and older majors start collapsed.
 * 7. The metadata row renders icons + a human date + "Used in X tests ·
 *    Y functions"; the version nav shows a "Usage" column header.
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import {
  publishLibraryFunction,
  addLibraryVersion,
  createValidTest,
  sharedNode,
  startEdge,
  logNode,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const RUN = randomUUID().slice(0, 8)
// One long unbroken token (no break opportunity) reused for the header
// description and the Changelog markdown of the latest version.
const LONG_TOKEN = `wrapguard${'z'.repeat(220)}`

const INPUTS = [
  { name: 'recipient', type: 'string', required: false, default: '', description: 'Email recipient address' },
]
const OUTPUTS = [{ name: 'message_id', type: 'string', description: 'The sent message id' }]

function bodyFor(label: string): Record<string, unknown> {
  return { nodes: [logNode('inner', 'Step', `'${label}'`)], edges: [startEdge('inner')] }
}

interface DetailFixture {
  fnA: SeededLibraryFunction
  fnB: SeededLibraryFunction
  testIds: string[]
}

/** Publish a Function B whose body pins A@version, making B a dependent of A. */
async function publishConsumerFunction(
  request: APIRequestContext,
  name: string,
  target: SeededLibraryFunction,
  version: string,
): Promise<SeededLibraryFunction> {
  const node = sharedNode('fn-dep-1', { functionId: target.functionId, functionVersion: version, label: target.name })
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'Consumer function (references A)',
      tags: [],
      inputs: [],
      outputs: [],
      dependencies: { functions: [target.functionId], plugins: [] },
      workflow: { nodes: [node], edges: [startEdge('fn-dep-1')] },
      version: '1.0.0',
      changelog: 'Initial',
      details: '',
    },
  })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST consumer function: ${resp.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return { functionId: body.data.id, name, version: '1.0.0' }
}

/**
 * Seed Function A with three versions (1.0.0, 1.1.0, 2.0.0-latest) and pin TWO
 * Tests + ONE Function to 1.0.0. The latest (2.0.0) carries the long text for
 * the wrap guard.
 */
async function seedFixture(request: APIRequestContext): Promise<DetailFixture> {
  const fnA = await publishLibraryFunction(request, {
    name: `DetailFn-${RUN}-${randomUUID().slice(0, 6)}`,
    version: '1.0.0',
    inputs: INPUTS,
    outputs: OUTPUTS,
    tags: ['reporting', 'email'],
    description: 'Sends a templated email to a recipient',
    changelog: '## 1.0.0\nInitial release of the email Function.',
    details: '### Usage\nProvide a recipient; returns the sent message id.',
    workflow: bodyFor('detail-v1'),
  })
  await addLibraryVersion(request, fnA, {
    sourceVersion: '1.0.0',
    targetVersion: '1.1.0',
    inputs: INPUTS,
    outputs: OUTPUTS,
    tags: ['reporting', 'email'],
    description: 'Sends a templated email (1.1)',
    changelog: '## 1.1.0\nMinor delivery improvements.',
    details: '### Usage\n1.1 details.',
    workflow: bodyFor('detail-v11'),
  })
  await addLibraryVersion(request, fnA, {
    sourceVersion: '1.1.0',
    targetVersion: '2.0.0',
    inputs: INPUTS,
    outputs: OUTPUTS,
    tags: ['reporting', 'email'],
    description: LONG_TOKEN,
    changelog: `## 2.0.0\n${LONG_TOKEN}`,
    details: '### Usage\n2.0 details.',
    workflow: bodyFor('detail-v2'),
  })
  const testIds: string[] = []
  for (let i = 0; i < 2; i++) {
    testIds.push(
      await createValidTest(request, {
        name: `DetailUser-${RUN}-${i}-${randomUUID().slice(0, 6)}`,
        nodes: [sharedNode('fn-user-1', { functionId: fnA.functionId, functionVersion: '1.0.0', label: fnA.name })],
        edges: [startEdge('fn-user-1')],
      }),
    )
  }
  const fnB = await publishConsumerFunction(request, `DetailDep-${RUN}-${randomUUID().slice(0, 6)}`, fnA, '1.0.0')
  return { fnA, fnB, testIds }
}

async function openDetail(page: Page, functionId: string): Promise<void> {
  await page.goto(`/functions/${functionId}`)
  await expect(page.locator('[data-testid="function-detail-page"]')).toBeVisible()
}

/** Expand the (collapsed-by-default) major-1 group and select a 1.x version. */
async function selectVersion(page: Page, version: string): Promise<void> {
  const item = page.locator(`[data-testid="version-nav-item-${version}"]`)
  if ((await item.count()) === 0) {
    await page.locator(`[data-testid="version-major-${version.split('.')[0]}"]`).click()
  }
  await item.click()
}

test.describe('V-LIB-DETAIL-01: Function detail page', () => {
  test('V-LIB-DETAIL-01-S1: version select drives content; sections + I/O descriptions', async ({
    page,
    request,
  }) => {
    const { fnA } = await seedFixture(request)
    await openDetail(page, fnA.functionId)

    // Latest (2.0.0) preselected: header shows the version + Latest badge.
    const header = page.locator('[data-testid="function-detail-header"]')
    await expect(header.locator('h2')).toHaveText('2.0.0')
    await expect(header.getByText('Latest')).toBeVisible()

    // Selecting 1.0.0 (under the collapsed major-1 group) re-drives the header.
    await selectVersion(page, '1.0.0')
    await expect(header.locator('h2')).toHaveText('1.0.0')
    await expect(header.getByText('Latest')).toHaveCount(0)
    await expect(header).toContainText('Sends a templated email to a recipient')

    // Changelog is expanded by default; Inputs/Outputs collapse until toggled.
    await expect(page.locator('[data-testid="section-changelog"]')).toBeVisible()
    await expect(page.locator('[data-testid="section-inputs"]')).toHaveCount(0)

    await page.locator('[data-testid="section-toggle-inputs"]').click()
    const inputs = page.locator('[data-testid="section-inputs"]')
    await expect(inputs).toBeVisible()
    await expect(inputs).toContainText('Description')
    await expect(inputs).toContainText('Email recipient address')

    await page.locator('[data-testid="section-toggle-outputs"]').click()
    const outputs = page.locator('[data-testid="section-outputs"]')
    await expect(outputs).toContainText('The sent message id')
  })

  test('V-LIB-DETAIL-01-S2: long description + changelog WRAP', async ({ page, request }) => {
    // min-w-0 + break-words make the header description and the Changelog
    // Markdown wrap. Verified in both themes by the light/dark project matrix.
    const { fnA } = await seedFixture(request)
    await openDetail(page, fnA.functionId)
    // Latest 2.0.0 carries the long token in both the description and changelog.
    await expect(page.locator('[data-testid="function-detail-header"]')).toContainText(LONG_TOKEN)

    const scrollEl = page.locator('[data-testid="function-detail-page"]')
    const overflow = await scrollEl.evaluate((root) => {
      const content = root.querySelector('.flex-1.min-w-0')
      return content ? content.scrollWidth - content.clientWidth : 0
    })
    expect(overflow, 'detail content must wrap, not run off horizontally').toBeLessThanOrEqual(1)
  })

  test('V-LIB-DETAIL-01-S3: usage count non-zero + Usage lists the Test', async ({
    page,
    request,
  }) => {
    // The dependents matcher reads data.nodeType, so tests seed via the real save
    // flow (type: workflowNode, data.nodeType: function, data.functionId).
    const { fnA, testIds } = await seedFixture(request)
    await openDetail(page, fnA.functionId)
    await selectVersion(page, '1.0.0')

    // 1.0.0 is pinned by 2 Tests + 1 Function -> count 3 in the nav.
    await expect(page.locator('[data-testid="version-nav-item-1.0.0"]')).toContainText('3')

    await page.locator('[data-testid="section-toggle-usage"]').click()
    const usage = page.locator('[data-testid="section-usage"]')
    await expect(usage).toBeVisible()
    // The consuming Test is listed (Usage links to /workbench?editTest=<id>).
    await expect(usage.locator(`a[href="/workbench?editTest=${testIds[0]}"]`)).toBeVisible()
  })

  test('V-LIB-DETAIL-01-S4: Usage navigation is client-side', async ({ page, request }) => {
    // UsageList uses Router <Link>: Tests -> the workbench, Functions -> their detail
    // page, all client-side.
    const { fnA, fnB, testIds } = await seedFixture(request)
    await openDetail(page, fnA.functionId)
    await selectVersion(page, '1.0.0')
    await page.locator('[data-testid="section-toggle-usage"]').click()
    const usage = page.locator('[data-testid="section-usage"]')

    // Test link -> workbench (client-side; URL carries editTest, no 404).
    await usage.locator(`a[href="/workbench?editTest=${testIds[0]}"]`).click()
    await expect(page).toHaveURL(new RegExp(`/workbench\\?editTest=${testIds[0]}`))
    await expect(page.locator('[data-testid="canvas-page"]')).toBeVisible()

    // Back on the detail page, the Function link opens B's detail page.
    await openDetail(page, fnA.functionId)
    await selectVersion(page, '1.0.0')
    await page.locator('[data-testid="section-toggle-usage"]').click()
    await page.locator(`[data-testid="section-usage"] a[href="/functions/${fnB.functionId}"]`).click()
    await expect(page).toHaveURL(new RegExp(`/functions/${fnB.functionId}$`))
    await expect(page.locator('[data-testid="function-detail-page"]')).toBeVisible()
  })

  test('V-LIB-DETAIL-01-S5: single by-version request; older majors collapsed', async ({
    page,
    request,
  }) => {
    // The page issues ONE batched /dependents/by-version call, and the nav opens
    // only the latest major.
    const { fnA } = await seedFixture(request)
    const byVersion: string[] = []
    const perVersion: string[] = []
    page.on('request', (req) => {
      const u = req.url()
      if (u.includes('/dependents/by-version')) byVersion.push(u)
      else if (/\/dependents(\?|$)/.test(u)) perVersion.push(u)
    })

    await openDetail(page, fnA.functionId)
    // Latest major (2) is open; 2.0.0 is visible.
    await expect(page.locator('[data-testid="version-nav-item-2.0.0"]')).toBeVisible()
    // Older major (1) is collapsed: its versions are not yet in the DOM.
    await expect(page.locator('[data-testid="version-nav-item-1.0.0"]')).toHaveCount(0)

    // Exactly one batched usage request; never a per-version one.
    expect(byVersion.length, `by-version calls: ${byVersion.length}`).toBe(1)
    expect(perVersion.length, `per-version calls: ${perVersion.join(',')}`).toBe(0)

    // Expanding major-1 reveals its versions with counts already populated.
    await page.locator('[data-testid="version-major-1"]').click()
    await expect(page.locator('[data-testid="version-nav-item-1.0.0"]')).toContainText('3')
    expect(byVersion.length, 'expanding a major fires no new usage request').toBe(1)
  })

  test('V-LIB-DETAIL-01-S6: metadata row + nav Usage header', async ({ page, request }) => {
    // The row renders icons, a human date, and "Used in X tests · Y functions"; the
    // nav has a "Usage" column header.
    const { fnA } = await seedFixture(request)
    await openDetail(page, fnA.functionId)
    await selectVersion(page, '1.0.0')

    const header = page.locator('[data-testid="function-detail-header"]')
    // Human-formatted date (e.g. "Jun 4, 2026"), no ISO "T"/"Z" and no "UTC".
    await expect(header).toContainText(/[A-Z][a-z]{2} \d{1,2}, \d{4}/)
    await expect(header).not.toContainText('UTC')
    // Pluralized usage summary (2 tests, 1 function).
    await expect(header).toContainText('Used in 2 tests · 1 function')
    // Icons render in the metadata row (calendar + users always; user when authored).
    const metaRow = header.locator('> div').last()
    expect(await metaRow.locator('svg').count()).toBeGreaterThanOrEqual(2)

    // The version nav carries a "Usage" column header over the per-version counts.
    const nav = page.locator('nav[aria-label="Versions"]')
    await expect(nav.getByText('Usage', { exact: true })).toBeVisible()
  })

  test('V-LIB-DETAIL-01-S7: per-version delete proceeds with usage present', async ({
    page,
    request,
  }) => {
    const { fnA } = await seedFixture(request)
    await openDetail(page, fnA.functionId)
    await selectVersion(page, '1.0.0')

    // 1.0.0 has usage (2 tests + 1 function); per-version delete is never gated (FNDETAIL-13).
    await page.locator('[data-testid="version-delete-1.0.0"]').click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()

    // The version disappears from the nav; the page stays on the Function.
    await page.locator('[data-testid="version-major-1"]').click().catch(() => {})
    await expect(page.locator('[data-testid="version-nav-item-1.0.0"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="function-detail-page"]')).toBeVisible()
  })

  test('V-LIB-DETAIL-01-S8: whole-Function delete proceeds with usage present', async ({
    page,
    request,
  }) => {
    const { fnA } = await seedFixture(request)
    await openDetail(page, fnA.functionId)

    await page.locator('[data-testid="delete-function"]').click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()

    // Deleting a used Function is allowed and returns to the library list.
    await expect(page).toHaveURL(/\/functions$/)
    await expect(page.locator('[data-testid="functions-page"]')).toBeVisible()
  })
})
