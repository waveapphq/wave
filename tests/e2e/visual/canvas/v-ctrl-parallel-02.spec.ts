/**
 * V-PARALLEL-01 (config half): Parallel configuration sheet
 *
 * Design Decisions: PARALLEL-3, PARALLEL-4, PARALLEL-5, PARALLEL-6
 * REQ: REQ-3.1.1.3 (parallel branch creation and merging), REQ-3.2.3.6 (join mode),
 *      REQ-3.2.3.7 (per-branch and per-section time limits)
 *
 * Pass Criteria:
 * 1. Input Parameters hold exactly one row - Section Time Limit, Integer,
 *    optional, described "Optional. Milliseconds." - and neither branches nor
 *    join is a row
 * 2. BRANCHES carries a Name / Time limit (ms) column header over single-line
 *    rows: violet BRANCH badge, name field, limit field, reorder pair, delete -
 *    and no chevron and no body, because a branch row has no content
 * 3. At the two-branch minimum both deletes are visually disabled and explain
 *    why on hover
 * 4. "+ Branch" adds a third row, unlocks the deletes, hints "Branch 3", and on
 *    Save the canvas node grows a lane for it - deleting the row removes it again
 * 5. JOIN MODE is an uppercase muted heading; "Wait for all" is first and
 *    selected, "First to finish" second, each with its own description
 * 6. The sheet renders no Output Variables section - Parallel binds nothing
 * 7. Names, per-branch limits and the join mode reach storage; the branch limit
 *    is stored snake_case and an unset limit stores no key at all
 * 8. Reordering a branch reorders its lane on the node and keeps every wired
 *    edge on the branch it was wired to
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet, openBlockSheet } from '../../helpers/workbench'

const BASE = `http://localhost:${BACKEND_PORT}`

const PARALLEL_ID = 'par-cfg'

const ALL_DESCRIPTION =
  'The exit runs once every branch has finished. A branch that fails ends the section.'
const FIRST_DESCRIPTION =
  'The exit runs as soon as one branch finishes; the others stop at their next block.'
const DELETE_BLOCKED = 'A parallel section needs at least two branches'

function logNode(id: string, message: string, x: number, y: number): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x, y },
    data: {
      label: 'Log',
      elementType: 'log',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      description: id,
      expressionFields: ['message'],
      templateFields: [],
      variableExpressionKeys: [],
      config: {
        values: { message: `'${message}'`, level: 'INFO' },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { width: 120, height: 62 },
  }
}

function buildFixture(): Record<string, unknown> {
  return {
    name: `V-PARALLEL-01-CFG ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    version: '1.0.0',
    description: 'One Parallel at the two-branch minimum, each lane wired.',
    workflow: {
      nodes: [
        {
          id: PARALLEL_ID,
          type: 'workflowNode',
          position: { x: 320, y: 160 },
          data: {
            label: 'Parallel',
            elementType: 'parallel',
            nodeType: 'control',
            category: 'flow',
            version: '1.0.0',
            description: 'Parallel under test',
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: {
              values: {
                branches: [
                  { id: 'branch_1', name: 'ingest' },
                  { id: 'branch_2', name: 'probe' },
                ],
                join: 'all',
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
          measured: { width: 224, height: 62 },
        },
        logNode('log-b1', 'cfg-b1', 180, 320),
        logNode('log-b2', 'cfg-b2', 420, 320),
      ],
      edges: [
        { id: 'e-start', source: 'start-node', target: PARALLEL_ID, type: 'default' },
        {
          id: 'e-b1',
          source: PARALLEL_ID,
          sourceHandle: 'branch_1',
          target: 'log-b1',
          type: 'default',
        },
        {
          id: 'e-b2',
          source: PARALLEL_ID,
          sourceHandle: 'branch_2',
          target: 'log-b2',
          type: 'default',
        },
      ],
    },
    variables: {},
    metadata: {},
  }
}

async function seedAndOpen(page: Page): Promise<string> {
  await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
  const resp = await page.request.post(`${BASE}/tests`, { data: buildFixture() })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  const testId = body.data?.id ?? body.id

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  return testId
}

async function openConfig(page: Page): Promise<Locator> {
  const node = page.locator(`[data-testid="workflow-node-${PARALLEL_ID}"]`)
  await expect(node).toBeVisible()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  // Every node carries a Configure button, so the click has to be scoped to
  // the one under test.
  await openBlockSheet(page, PARALLEL_ID)
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible({ timeout: 10_000 })
  await expect(sheet.locator('[data-testid="parallel-branch-editor"]')).toBeVisible()
  return sheet
}

async function persistedValues(page: Page, testId: string): Promise<Record<string, unknown>> {
  const resp = await page.request.get(`${BASE}/tests/${testId}/workflow`)
  expect(resp.ok(), `GET /tests/${testId}/workflow failed: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as Record<string, unknown>
  const data = (body.data ?? body) as { nodes?: Array<Record<string, unknown>> }
  const node = (data.nodes ?? []).find((n) => n.id === PARALLEL_ID)
  const nodeData = (node?.data ?? {}) as Record<string, unknown>
  const config = (nodeData.config ?? {}) as Record<string, unknown>
  return (config.values as Record<string, unknown>) ?? {}
}

async function persistedEdges(
  page: Page,
  testId: string,
): Promise<Array<Record<string, unknown>>> {
  const resp = await page.request.get(`${BASE}/tests/${testId}/workflow`)
  expect(resp.ok(), `GET /tests/${testId}/workflow failed: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as Record<string, unknown>
  const data = (body.data ?? body) as { edges?: Array<Record<string, unknown>> }
  return data.edges ?? []
}

/** Save the sheet, then push the canvas through the toolbar save. */
async function saveSheetAndTest(page: Page, sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: /^Save$/ }).click()
  await expect(sheet).toBeHidden({ timeout: 10_000 })
  const toolbarSave = page.locator('[data-testid="toolbar-save-button"]')
  await expect(toolbarSave).toBeEnabled({ timeout: 10_000 })
  await toolbarSave.click()
  await expect(toolbarSave).toBeDisabled({ timeout: 15_000 })
}

test.describe('V-PARALLEL-01: Parallel configuration sheet', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`${BASE}/workbench/session/`).catch(() => {})
  })

  test('S1: one input row, the BRANCHES table, and no Output Variables', async ({ page }) => {
    await seedAndOpen(page)
    const sheet = await openConfig(page)

    await test.step('Section Time Limit is the only input row, and it is optional', async () => {
      const rows = await sheet
        .locator('[data-testid^="param-row-"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
      expect(rows, `input rows: ${JSON.stringify(rows)}`).toEqual(['param-row-time_limit'])

      const row = sheet.locator('[data-testid="param-row-time_limit"]')
      await expect(row).toContainText('Section Time Limit')
      await expect(row).toContainText(/integer/i)
      await expect(row.locator('.text-destructive')).toHaveCount(0)
      // The row's (i) carries the wireframe's "Optional. Milliseconds." copy;
      // the value field itself ships bare, next to the expression toggle.
      // SHELL-7a: that copy is revealed by the shared tooltip, not printed.
      await row.locator('.cursor-help').hover()
      await expect(page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')).toContainText('Optional. Milliseconds.', {
        timeout: 5_000,
      })
      await expect(row.locator('[data-testid="param-input-time_limit"]')).toHaveValue('')
    })

    await test.step('Branches and join are not parameter-table rows', async () => {
      await expect(sheet.locator('[data-testid="param-row-branches"]')).toHaveCount(0)
      await expect(sheet.locator('[data-testid="param-row-join"]')).toHaveCount(0)
    })

    await test.step('Column header names the two branch fields', async () => {
      const header = sheet.locator('[data-testid="parallel-branch-columns"]')
      await expect(header).toContainText('Name')
      await expect(header).toContainText('Time limit (ms)')
    })

    await test.step('The sheet offers no Output Variables section', async () => {
      await expect(sheet.getByRole('heading', { name: /^output variables$/i })).toHaveCount(0)
      await expect(sheet.locator('[data-testid^="output-row-"]')).toHaveCount(0)
    })
  })

  test('S2: a branch row is one line - badge, name, limit, reorder, delete', async ({ page }) => {
    await seedAndOpen(page)
    const sheet = await openConfig(page)

    await test.step('Two rows, in config order, each with the violet BRANCH badge', async () => {
      const cards = sheet.locator('[data-testid^="parallel-branch-card-"]')
      await expect(cards).toHaveCount(2)
      const badge = sheet.locator('[data-testid="parallel-branch-badge-branch_1"]')
      await expect(badge).toHaveText('BRANCH')
      await expect(badge).toHaveClass(/bg-violet-500/)
      await expect(sheet.locator('[data-testid="parallel-branch-label-branch_1"]')).toHaveValue(
        'ingest',
      )
      await expect(sheet.locator('[data-testid="parallel-branch-label-branch_2"]')).toHaveValue(
        'probe',
      )
    })

    await test.step('Header order: badge, name, limit, up, down, delete', async () => {
      const header = sheet.locator('[data-testid="parallel-branch-header-branch_1"]')
      const order = await header.evaluate((el) =>
        Array.from(el.querySelectorAll('[data-testid]'))
          .map((n) => n.getAttribute('data-testid'))
          .filter((id): id is string => !!id),
      )
      expect(order, `header children: ${JSON.stringify(order)}`).toEqual([
        'parallel-branch-badge-branch_1',
        'parallel-branch-label-branch_1',
        'parallel-branch-limit-branch_1',
        'parallel-branch-move-up-branch_1',
        'parallel-branch-move-down-branch_1',
        'parallel-branch-delete-branch_1',
      ])
    })

    await test.step('No chevron and no body - a branch row holds nothing', async () => {
      await expect(sheet.locator('[data-testid^="parallel-branch-toggle-"]')).toHaveCount(0)
      await expect(sheet.locator('[data-testid^="parallel-branch-body-"]')).toHaveCount(0)
    })

    await test.step('An unset limit shows the No limit hint', async () => {
      await expect(
        sheet.locator('[data-testid="parallel-branch-limit-branch_1"]'),
      ).toHaveAttribute('placeholder', 'No limit')
      await expect(sheet.locator('[data-testid="parallel-branch-limit-branch_1"]')).toHaveValue('')
    })

    await test.step('Reorder is pinned at the ends of a two-row list', async () => {
      await expect(sheet.locator('[data-testid="parallel-branch-move-up-branch_1"]')).toBeDisabled()
      await expect(
        sheet.locator('[data-testid="parallel-branch-move-down-branch_2"]'),
      ).toBeDisabled()
      await expect(sheet.locator('[data-testid="parallel-branch-move-down-branch_1"]')).toBeEnabled()
      await expect(sheet.locator('[data-testid="parallel-branch-move-up-branch_2"]')).toBeEnabled()
    })
  })

  test('S3: the minimum of two branches is enforced and explained', async ({ page }) => {
    await seedAndOpen(page)
    const sheet = await openConfig(page)

    for (const id of ['branch_1', 'branch_2']) {
      const del = sheet.locator(`[data-testid="parallel-branch-delete-${id}"]`)
      await expect(del).toBeDisabled()
      await expect(del).toHaveClass(/opacity-50/)
      await expect(del).toHaveClass(/cursor-not-allowed/)
    }

    await test.step('Hovering a blocked delete says why', async () => {
      // A disabled button swallows its own hover, so the wrapper carries the
      // tooltip; read the popup that wrapper owns rather than whatever is on
      // screen.
      const wrapper = sheet.locator(
        'span:has(> [data-testid="parallel-branch-delete-branch_1"])',
      )
      await wrapper.hover()
      await expect(wrapper).toHaveAttribute('data-state', /open/, { timeout: 5_000 })
      const describedBy = await wrapper.getAttribute('aria-describedby')
      expect(describedBy, 'the blocked delete must point at its own tooltip').toBeTruthy()
      await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(DELETE_BLOCKED, {
        timeout: 5_000,
      })
    })
  })

  test('S4: "+ Branch" adds a row, unlocks the deletes, and grows a lane', async ({ page }) => {
    await seedAndOpen(page)
    const sheet = await openConfig(page)

    const node = page.locator(`[data-testid="workflow-node-${PARALLEL_ID}"]`)
    await expect(node.locator('[data-testid^="handle-output-"]')).toHaveCount(3)

    await sheet.locator('[data-testid="add-branch-button"]').click()

    await test.step('The third row is unnamed and hints its position', async () => {
      await expect(sheet.locator('[data-testid^="parallel-branch-card-"]')).toHaveCount(3)
      const label = sheet.locator('[data-testid="parallel-branch-label-branch_3"]')
      await expect(label).toHaveValue('')
      await expect(label).toHaveAttribute('placeholder', 'Branch 3')
    })

    await test.step('Every delete is live once the list is above the minimum', async () => {
      for (const id of ['branch_1', 'branch_2', 'branch_3']) {
        await expect(sheet.locator(`[data-testid="parallel-branch-delete-${id}"]`)).toBeEnabled()
      }
    })

    await test.step('Saving the sheet grows the lane on the canvas node', async () => {
      // Lanes follow the saved branch list, the same as a Switch's cases.
      await sheet.getByRole('button', { name: /^Save$/ }).click()
      await expect(sheet).toBeHidden({ timeout: 10_000 })
      await expect(node.locator('[data-testid="handle-output-branch_3"]')).toBeVisible()
      await expect(node.locator('[data-testid^="handle-output-"]')).toHaveCount(4)
    })

    await test.step('Deleting the row takes the lane with it', async () => {
      const reopened = await openConfig(page)
      await reopened.locator('[data-testid="parallel-branch-delete-branch_3"]').click()
      await expect(reopened.locator('[data-testid^="parallel-branch-card-"]')).toHaveCount(2)
      await reopened.getByRole('button', { name: /^Save$/ }).click()
      await expect(reopened).toBeHidden({ timeout: 10_000 })
      await expect(node.locator('[data-testid="handle-output-branch_3"]')).toHaveCount(0)
      await expect(node.locator('[data-testid^="handle-output-"]')).toHaveCount(3)
    })
  })

  test('S5: the JOIN MODE section', async ({ page }) => {
    await seedAndOpen(page)
    const sheet = await openConfig(page)

    await test.step('Uppercase muted heading, same treatment as the other sections', async () => {
      // Case-insensitive: the heading is uppercased in CSS, which Chromium
      // folds into the accessible name.
      const heading = sheet.getByRole('heading', { name: /join mode/i })
      await expect(heading).toBeVisible()
      await expect(heading).toHaveClass(/uppercase/)
      await expect(heading).toHaveClass(/text-muted-foreground/)
    })

    await test.step('Wait for all first and selected, First to finish second', async () => {
      const all = sheet.locator('#join-mode-all')
      const first = sheet.locator('#join-mode-first')
      await expect(all).toHaveAttribute('data-state', 'checked')
      await expect(first).toHaveAttribute('data-state', 'unchecked')

      const allBox = await all.boundingBox()
      const firstBox = await first.boundingBox()
      expect(allBox!.y, 'Wait for all must sit above First to finish').toBeLessThan(firstBox!.y)

      await expect(sheet.locator('label[for="join-mode-all"]')).toHaveText('Wait for all')
      await expect(sheet.locator('label[for="join-mode-first"]')).toHaveText('First to finish')
      await expect(sheet).toContainText(ALL_DESCRIPTION)
      await expect(sheet).toContainText(FIRST_DESCRIPTION)
    })

    await test.step('Parallel offers no Fail Current Scope checkbox', async () => {
      await expect(sheet.locator('#fail-current-scope')).toHaveCount(0)
      await expect(sheet.locator('#wait-fail-current-scope')).toHaveCount(0)
    })
  })

  test('S6: names, per-branch limits and the join mode reach storage', async ({ page }) => {
    const testId = await seedAndOpen(page)
    const sheet = await openConfig(page)

    await sheet.locator('[data-testid="parallel-branch-label-branch_2"]').fill('drain')
    await sheet.locator('[data-testid="parallel-branch-limit-branch_1"]').fill('30000')
    await sheet.locator('label[for="join-mode-first"]').click()
    await expect(sheet.locator('#join-mode-first')).toHaveAttribute('data-state', 'checked')

    await saveSheetAndTest(page, sheet)

    await test.step('The saved test carries the names, the limit and the join', async () => {
      const values = await persistedValues(page, testId)
      expect(values.join, `persisted values: ${JSON.stringify(values)}`).toBe('first')
      expect(values.branches, `persisted values: ${JSON.stringify(values)}`).toEqual([
        { id: 'branch_1', name: 'ingest', time_limit: 30000 },
        { id: 'branch_2', name: 'drain' },
      ])
    })

    await test.step('Reopening the sheet shows what was saved', async () => {
      const reopened = await openConfig(page)
      await expect(reopened.locator('[data-testid="parallel-branch-limit-branch_1"]')).toHaveValue(
        '30000',
      )
      await expect(reopened.locator('[data-testid="parallel-branch-label-branch_2"]')).toHaveValue(
        'drain',
      )
      await expect(reopened.locator('#join-mode-first')).toHaveAttribute('data-state', 'checked')
    })

    await test.step('The renamed branch renames its lane', async () => {
      const node = page.locator(`[data-testid="workflow-node-${PARALLEL_ID}"]`)
      await expect(node.locator('[data-testid="handle-output-branch_2"]')).toHaveAttribute(
        'aria-label',
        'drain',
      )
    })
  })

  test('S7: reordering a branch reorders its lane and keeps its wired edge', async ({ page }) => {
    const testId = await seedAndOpen(page)
    const sheet = await openConfig(page)

    await sheet.locator('[data-testid="parallel-branch-move-up-branch_2"]').click()

    await test.step('The rows swap', async () => {
      const ids = await sheet
        .locator('[data-testid^="parallel-branch-card-"]')
        .evaluateAll((els) =>
          els.map((el) => (el.getAttribute('data-testid') ?? '').replace('parallel-branch-card-', '')),
        )
      expect(ids, `row order: ${JSON.stringify(ids)}`).toEqual(['branch_2', 'branch_1'])
    })

    await saveSheetAndTest(page, sheet)

    await test.step('The lanes follow the rows', async () => {
      const node = page.locator(`[data-testid="workflow-node-${PARALLEL_ID}"]`)
      const xOf = async (handle: string) => {
        const box = await node.locator(`[data-testid="handle-output-${handle}"]`).boundingBox()
        expect(box, `lane ${handle} must be visible`).not.toBeNull()
        return box!.x
      }
      const probeX = await xOf('branch_2')
      const ingestX = await xOf('branch_1')
      const thenX = await xOf('then')
      expect(probeX, `probe (${probeX}) moved ahead of ingest (${ingestX})`).toBeLessThan(ingestX)
      expect(ingestX, `then (${thenX}) stays last`).toBeLessThan(thenX)
    })

    await test.step('Each lane keeps the block it was wired to', async () => {
      const edges = await persistedEdges(page, testId)
      const targetOf = (handle: string) =>
        edges.find((e) => e.source === PARALLEL_ID && e.sourceHandle === handle)?.target
      expect(targetOf('branch_1'), `edges: ${JSON.stringify(edges)}`).toBe('log-b1')
      expect(targetOf('branch_2'), `edges: ${JSON.stringify(edges)}`).toBe('log-b2')
    })

    await test.step('The stored order is the reordered one', async () => {
      const values = await persistedValues(page, testId)
      const ids = (values.branches as Array<{ id: string }>).map((b) => b.id)
      expect(ids, `persisted branches: ${JSON.stringify(values.branches)}`).toEqual([
        'branch_2',
        'branch_1',
      ])
    })
  })
})
