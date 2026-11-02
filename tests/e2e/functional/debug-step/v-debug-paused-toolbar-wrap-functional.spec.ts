/**
 * V-DEBUG-PAUSED-TOOLBAR-WRAP: the paused toolbar keeps every label whole at any width
 * REQ: REQ-3.2.1.3 (Step-by-step execution: the paused toolbar)
 *
 * Phase: functional-workflow. API seed (POST /tests): one Test of two Log Blocks, validated with
 * zero errors. A Debug run with "pause on first" pauses on the first Block; the toolbar is measured
 * at 1400px and at 1920px wide while the run stays paused.
 *
 * Pass Criteria:
 * 1. Paused at 1400px: every toolbar button label sits on one line; the buttons that do not fit move
 *    whole to a second row, each row ends at the right edge of the button group, no button is cut
 *    off, and the canvas starts below the taller toolbar (it moved down by the toolbar's growth).
 * 2. Paused at 1920px: the toolbar is one 48px row, every button on the same line, labels whole.
 * 3. The run is still paused on the first Block afterwards and Continue finishes it.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { logNode, startEdge } from '../../helpers/fn-seed'
import { selectEnvironment } from '../../helpers/workbench'
import {
  clickContinue,
  expectPausedAt,
  importAndNavigate,
  setDebugOption,
  startDebugRun,
  waitForStatus,
} from './helpers'

const FIRST = 'wrap-log-1'
const SECOND = 'wrap-log-2'
const PAUSED_BUTTONS = [
  'action-step-over-button',
  'action-step-into-button',
  'action-repeat-step-button',
  'action-continue-button',
  'action-skip-block-button',
  'action-stop-button',
  'action-focus-current-button',
]

interface Box {
  top: number
  bottom: number
  left: number
  right: number
}

interface ToolbarLayout {
  toolbar: Box
  group: Box
  canvasTop: number
  /** Every visible child of the right button group. */
  items: Array<Box & { name: string }>
  /** Every labeled button in the toolbar and the number of lines its label takes. */
  labels: Array<{ label: string; lines: number }>
  /** Which paused buttons are on screen. */
  paused: string[]
}

async function readToolbar(page: Page): Promise<ToolbarLayout> {
  return page.getByTestId('canvas-toolbar').evaluate((bar) => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
    }
    const lineCount = (el: Element): number => {
      const tops = new Set<number>()
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width > 0) tops.add(Math.round(rect.top))
        }
      }
      return tops.size
    }
    const group = bar.querySelector('[data-testid="toolbar-right-group"]') as HTMLElement
    const canvas = document.querySelector('[data-testid="workflow-canvas"]') as HTMLElement
    const items = Array.from(group.children)
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => ({ name: el.getAttribute('data-testid') ?? el.tagName, ...box(el) }))
    const labels = Array.from(bar.querySelectorAll('button'))
      .filter((el) => el.getBoundingClientRect().width > 0 && (el.textContent ?? '').trim() !== '')
      .map((el) => ({ label: (el.textContent ?? '').trim(), lines: lineCount(el) }))
    const paused = Array.from(bar.querySelectorAll('[data-testid^="action-"]'))
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => el.getAttribute('data-testid') ?? '')
    return {
      toolbar: box(bar),
      group: box(group),
      canvasTop: canvas.getBoundingClientRect().top,
      items,
      labels,
      paused,
    }
  })
}

/** The group's children grouped into rows by their top edge. */
function rowsOf(items: ToolbarLayout['items']): Array<ToolbarLayout['items']> {
  const rows: Array<ToolbarLayout['items']> = []
  for (const item of [...items].sort((a, b) => a.top - b.top)) {
    const row = rows.find((candidate) => Math.abs(candidate[0].top - item.top) < 4)
    if (row) row.push(item)
    else rows.push([item])
  }
  return rows
}

function expectLabelsWhole(layout: ToolbarLayout, width: number): void {
  for (const { label, lines } of layout.labels) {
    expect(lines, `at ${width}px the label "${label}" sits on one line`).toBe(1)
  }
}

test.describe('V-DEBUG-PAUSED-TOOLBAR-WRAP: whole buttons on a second row', () => {
  test.use({ viewport: { width: 1400, height: 900 } })

  test('paused at 1400px the buttons wrap whole to a right-aligned second row; at 1920px one 48px row', async ({
    page,
  }) => {
    await importAndNavigate(page, {
      name: 'zz-paused-toolbar-wrap',
      version: '1.0.0',
      description: 'Two Log Blocks for a paused Debug run',
      workflow: {
        nodes: [
          logNode(FIRST, 'First log', "'first'", { x: 300, y: 120 }),
          logNode(SECOND, 'Second log', "'second'", { x: 300, y: 260 }),
        ],
        edges: [startEdge(FIRST), { id: 'e-wrap-1-2', source: FIRST, target: SECOND }],
      },
      variables: {},
      metadata: {},
    })
    await selectEnvironment(page)
    await setDebugOption(page, 'first', true)
    await startDebugRun(page)
    await expectPausedAt(page, FIRST, 30_000)

    const narrow = await readToolbar(page)
    await test.step('1400px: labels whole, whole buttons on a second right-aligned row', async () => {
      expect(narrow.paused, 'every paused button is on screen').toEqual(
        expect.arrayContaining(PAUSED_BUTTONS),
      )
      expectLabelsWhole(narrow, 1400)
      const rows = rowsOf(narrow.items)
      expect(rows.length, `the buttons take two rows: ${JSON.stringify(narrow.items)}`).toBeGreaterThanOrEqual(2)
      for (const item of narrow.items) {
        expect(item.left, `${item.name} is not cut off on the left`).toBeGreaterThanOrEqual(narrow.group.left - 1)
        expect(item.right, `${item.name} is not cut off on the right`).toBeLessThanOrEqual(narrow.group.right + 1)
        expect(item.bottom, `${item.name} sits inside the toolbar`).toBeLessThanOrEqual(narrow.toolbar.bottom + 1)
      }
      for (const row of rows) {
        const rowRight = Math.max(...row.map((item) => item.right))
        expect(Math.abs(rowRight - narrow.group.right), 'each row ends at the right edge').toBeLessThanOrEqual(1)
      }
      expect(narrow.toolbar.bottom - narrow.toolbar.top, 'the toolbar grew past one row').toBeGreaterThan(48)
      expect(narrow.canvasTop, 'the canvas starts below the toolbar').toBeGreaterThanOrEqual(
        narrow.toolbar.bottom - 1,
      )
    })

    await page.setViewportSize({ width: 1920, height: 900 })
    await expect
      .poll(async () => {
        const layout = await readToolbar(page)
        return Math.round(layout.toolbar.bottom - layout.toolbar.top)
      })
      .toBe(48)
    const wide = await readToolbar(page)
    await test.step('1920px: one 48px row and the canvas moves back up', async () => {
      expectLabelsWhole(wide, 1920)
      expect(rowsOf(wide.items), 'every button on one line').toHaveLength(1)
      expect(wide.paused).toEqual(expect.arrayContaining(PAUSED_BUTTONS))
      const grown = narrow.toolbar.bottom - narrow.toolbar.top - 48
      expect(
        Math.abs(narrow.canvasTop - wide.canvasTop - grown),
        'at 1400px the canvas sat lower by exactly the toolbar growth',
      ).toBeLessThanOrEqual(1)
    })

    await test.step('the run is still paused on the first Block and Continue finishes it', async () => {
      await expectPausedAt(page, FIRST)
      await clickContinue(page)
      await waitForStatus(page, 'passed', 30_000)
      await expect(page.getByTestId(`workflow-node-${SECOND}`)).toHaveAttribute(
        'data-execution-status',
        'success',
      )
    })
  })
})
