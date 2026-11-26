/**
 * Shared helpers for the watch-mode functional suite:
 * two-tab holder/watcher setup, fixture import+validate, viewport/centering
 * probes, a deterministic canvas pan, a per-frame recorder of what a tab
 * shows, a wait for a given streamed frame, a watch for a text reaching a tab,
 * and the New Test save. Self-contained per the per-dir helper convention used
 * by debug-step / function-debug-halt.
 */

import { randomUUID } from 'node:crypto'
import fs from 'fs'
import path from 'path'
import { expect, type Page } from '../../helpers/playwright-fixtures'
import type { Browser, BrowserContext, APIRequestContext } from '@playwright/test'
import { BACKEND_URL, FRONTEND_URL, ensureEnvironment } from '../../helpers/config'
import { stubSessionRecovery, waitForCanvasLoad } from '../../helpers/canvas'

/** A fixture of this folder, by file name. */
export function loadFixture(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8'))
}

/** Import a fixture via POST /tests (unique name), assert zero validation errors, return the new id. */
export async function importFixture(
  request: APIRequestContext,
  fixture: Record<string, unknown>,
): Promise<string> {
  await ensureEnvironment(request)
  const baseName = (fixture as { name?: string }).name ?? 'Watch Mode Test'
  const unique = {
    ...fixture,
    name: `${baseName} ${Date.now()}-${randomUUID().slice(0, 6)}`,
  }
  const createResp = await request.post(`${BACKEND_URL}/tests`, { data: unique })
  const body = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = body.data?.id || body.id

  const validateResp = await request.post(`${BACKEND_URL}/tests/${testId}/validate`)
  const validateBody = await validateResp.json().catch(() => null)
  expect(
    validateResp.ok(),
    `POST /tests/${testId}/validate failed: ${validateResp.status()} - ${JSON.stringify(validateBody)}`,
  ).toBeTruthy()
  const errors =
    validateBody?.data?.errors ??
    validateBody?.error?.details?.[0]?.errors ??
    validateBody?.errors ??
    []
  expect(errors.length, `Fixture failed validation: ${JSON.stringify(errors)}`).toBe(0)
  return testId
}

/** Open a fresh browser tab as the editing holder with a test loaded (editTest); `prepare` runs before it loads. */
export async function openHolder(
  browser: Browser,
  testId: string,
  track: (c: BrowserContext) => void,
  prepare?: (page: Page) => void | Promise<void>,
): Promise<Page> {
  const context = await browser.newContext({ baseURL: FRONTEND_URL })
  track(context)
  const page = await context.newPage()
  await prepare?.(page)
  await stubSessionRecovery(page)
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  return page
}

/** Open a fresh browser tab on /workbench: it mirrors the current holder, or holds the free session; `prepare` runs before it loads. */
export async function openWatcher(
  browser: Browser,
  track: (c: BrowserContext) => void,
  prepare?: (page: Page) => void | Promise<void>,
): Promise<Page> {
  const context = await browser.newContext({ baseURL: FRONTEND_URL })
  track(context)
  const page = await context.newPage()
  await prepare?.(page)
  await stubSessionRecovery(page)
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
  return page
}

/** A unique name for a test a spec makes (names are globally unique). */
export function uniqueName(base: string): string {
  return `${base} ${Date.now()}-${randomUUID().slice(0, 6)}`
}

/** Save the tab's unsaved draft as a new test through the toolbar Save and the New Test window. */
export async function saveAsNewTest(page: Page, name: string): Promise<void> {
  const save = page.locator('[data-testid="toolbar-save-button"]')
  await expect(save).toBeEnabled()
  await save.click()
  const dialog = page.getByRole('dialog', { name: 'New Test' })
  await expect(dialog).toBeVisible()
  await dialog.locator('#test-name').fill(name)
  await dialog.getByRole('button', { name: 'Create Test', exact: true }).click()
  await expect(dialog).toHaveCount(0, { timeout: 15_000 })
  await expect(save, 'the draft saved as a new test').toBeDisabled({ timeout: 15_000 })
}

/** What the tab shows of a frame the assistant streams: Blocks it must and must not show, and a turn's steady border. */
export interface AssistantFrame {
  present?: string[]
  absent?: string[]
  turn?: boolean
}

/** Wait, on every animation frame, until the tab shows the assistant's banner over such a frame. */
export async function waitForAssistantFrame(page: Page, frame: AssistantFrame, timeout = 20_000): Promise<void> {
  await page.waitForFunction(
    ({ present, absent, turn }) => {
      const shows = (id: string): boolean =>
        document.querySelector(`[data-testid="workflow-node-${id}"][data-nodetype]`) !== null
      return (
        document.querySelector('[data-testid="mirror-banner"][data-holder-kind="mcp"]') !== null &&
        present.every(shows) &&
        !absent.some(shows) &&
        (!turn || document.querySelector('[data-mirror-active="true"]') !== null)
      )
    },
    { present: frame.present ?? [], absent: frame.absent ?? [], turn: frame.turn ?? false },
    { timeout },
  )
}

/** Whether a text ever reached a tab: in a socket frame it received, or on screen (its text or a field's value). */
export interface TextSightings {
  received: () => boolean
  shown: () => Promise<boolean>
}

/** Stands in until a tab opener's `prepare` has called `watchForText`; reading it fails. */
export const NOT_WATCHED: TextSightings = {
  received: () => {
    throw new Error('the tab was never watched for the text')
  },
  shown: () => Promise.reject(new Error('the tab was never watched for the text')),
}

/** Watch a tab for `text` from before it loads; call it in the `prepare` of a tab opener. */
export async function watchForText(page: Page, text: string): Promise<TextSightings> {
  let received = false
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      if (String(payload).includes(text)) received = true
    })
  })
  await page.addInitScript((needle: string) => {
    const tab = window as unknown as { __textShown?: boolean }
    tab.__textShown = false
    const look = (): void => {
      const fields = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')]
      if ((document.body?.textContent ?? '').includes(needle) || fields.some((field) => field.value.includes(needle))) {
        tab.__textShown = true
      }
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  }, text)
  return {
    received: () => received,
    shown: () => page.evaluate(() => (window as unknown as { __textShown?: boolean }).__textShown === true),
  }
}

/** The React Flow viewport transform (pan/zoom); a stable id for "did the viewport move". */
export async function viewportTransform(page: Page): Promise<string> {
  return page
    .locator('.react-flow__viewport')
    .first()
    .evaluate((el) => (el as HTMLElement).style.transform || '')
}

/** Poll until the viewport transform stops changing, so a fitView/pan animation
 *  has fully settled before a "did the viewport move" baseline is captured. */
export async function waitForViewportIdle(page: Page, timeout = 8_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const a = await viewportTransform(page)
        await page.waitForTimeout(200)
        return a !== '' && a === (await viewportTransform(page))
      },
      { timeout, message: 'viewport did not settle' },
    )
    .toBe(true)
}

/** Breadcrumb Function segments == current drill depth. */
export function functionSegments(page: Page) {
  return page.locator('[data-testid="canvas-breadcrumb"]').locator('svg.lucide-square-function')
}

/** Poll until the node's bounding-box center sits near the viewport center (lenient by default). */
export async function expectNodeCentered(
  page: Page,
  nodeId: string,
  tolerance = 0.4,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const canvas = await page.locator('[data-testid="workflow-canvas"]').boundingBox()
        const node = await page.locator(`[data-testid="workflow-node-${nodeId}"]`).boundingBox()
        if (!canvas || !node) return false
        const cx = canvas.x + canvas.width / 2
        const cy = canvas.y + canvas.height / 2
        const nx = node.x + node.width / 2
        const ny = node.y + node.height / 2
        return (
          Math.abs(nx - cx) < canvas.width * tolerance &&
          Math.abs(ny - cy) < canvas.height * tolerance
        )
      },
      { timeout: 6_000, message: `node ${nodeId} should be centered in ${page.url()}` },
    )
    .toBe(true)
}

/** Pan the canvas by a screen delta, grabbing an empty near-corner so no node is hit. */
export async function panCanvas(page: Page, dx: number, dy: number): Promise<void> {
  const box = await page.locator('[data-testid="workflow-canvas"]').boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  const sx = box.x + 48
  const sy = box.y + box.height - 48
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + dx, sy + dy, { steps: 12 })
  await page.mouse.up()
}

/** One frame of a tab's canvas: its Blocks and lines, the assistant's marks, the banner, the view and the glide. */
export interface ViewSample {
  count: number
  transform: string
  watchingMcp: boolean
  newestInView: boolean
  startInView: boolean
  allInView: boolean
  /** Each Block as `<id>=<name>`, sorted. */
  blocks: string[]
  /** Each Block's place on the canvas, by id. */
  places: Record<string, string>
  /** Each line as `<from id>><to id>`, sorted. */
  lines: string[]
  /** The Block with the steady violet border, or null. */
  active: string | null
  /** The one-time ring as `<id>#<n>`, where n counts the rings this tab showed. */
  ring: string | null
  /** The mirror banner's text, empty when the tab shows none. */
  banner: string
  /** The Blocks whose description is open, by id, sorted. */
  expanded: string[]
  /** The canvas's `data-mirror-glide` ("framing" or "moving" while a watched change glides), empty otherwise. */
  glide: string
}

/** Sample the view on every animation frame from now on, keeping each sample that differs from the last. */
export async function recordView(page: Page): Promise<void> {
  await page.evaluate(() => {
    const samples: unknown[] = []
    ;(window as unknown as { __viewSamples: unknown[] }).__viewSamples = samples
    let last = ''
    const rings = new WeakMap<Element, number>()
    let ringCount = 0
    const inView = (el: Element | null, pane: DOMRect): boolean => {
      if (!el) return false
      const box = el.getBoundingClientRect()
      return (
        box.left >= pane.left - 1 &&
        box.top >= pane.top - 1 &&
        box.right <= pane.right + 1 &&
        box.bottom <= pane.bottom + 1
      )
    }
    const idOf = (el: Element, prefix: string): string =>
      (el.getAttribute('data-testid') ?? '').replace(prefix, '')
    // A ring is keyed by its change, so a new ring is a new element even on the same Block.
    const ringNow = (): string | null => {
      const ring = document.querySelector('[data-testid^="node-change-pulse-"]')
      if (!ring) return null
      if (!rings.has(ring)) {
        ringCount += 1
        rings.set(ring, ringCount)
      }
      return `${idOf(ring, 'node-change-pulse-')}#${rings.get(ring)}`
    }
    const tick = (): void => {
      const flow = document.querySelector('[data-testid="workflow-canvas"] .react-flow')
      const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
      if (flow && viewport) {
        const pane = flow.getBoundingClientRect()
        const blocks = [...document.querySelectorAll('[data-testid^="workflow-node-"][data-nodetype]')]
        const ids = blocks.map((block) => idOf(block, 'workflow-node-'))
        const places: Record<string, string> = {}
        for (const id of ids) {
          places[id] = document.querySelector<HTMLElement>(`[data-testid="rf__node-${id}"]`)?.style.transform ?? ''
        }
        const active = document.querySelector('[data-mirror-active="true"]')
        const sample = {
          count: blocks.length,
          transform: viewport.style.transform,
          watchingMcp:
            document.querySelector('[data-testid="mirror-banner"][data-holder-kind="mcp"]') !== null,
          // A linear recipe compiles its Blocks as node-1, node-2, ... in build order.
          newestInView: inView(
            document.querySelector(`[data-testid="workflow-node-node-${blocks.length}"]`),
            pane,
          ),
          startInView: inView(document.querySelector('[data-testid="start-node"]'), pane),
          allInView: blocks.every((block) => inView(block, pane)),
          blocks: ids
            .map((id) => {
              const body = document.querySelector(`[data-testid="workflow-node-body-${id}"]`)
              return `${id}=${(body?.getAttribute('aria-label') ?? '').replace(/ block$/, '')}`
            })
            .sort(),
          places,
          lines: [...flow.querySelectorAll('.react-flow__edge')]
            .map((line) => (line.getAttribute('aria-label') ?? '').replace(/^Edge from (.+) to (.+)$/, '$1>$2'))
            .sort(),
          active: active ? idOf(active, 'workflow-node-') : null,
          ring: ringNow(),
          banner: document.querySelector('[data-testid="mirror-banner"]')?.textContent ?? '',
          expanded: ids
            .filter(
              (id) =>
                document.querySelector(
                  `[data-testid="workflow-node-${id}"] [data-testid="node-description"][data-expanded="true"]`,
                ) !== null,
            )
            .sort(),
          glide: document.querySelector('[data-testid="workflow-canvas"]')?.getAttribute('data-mirror-glide') ?? '',
        }
        const key = JSON.stringify(sample)
        if (key !== last) {
          samples.push(sample)
          last = key
        }
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

/** The Blocks the tab shows now, each as `<id>=<name>`, sorted, as `recordView` reads them. */
export async function shownBlocks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="workflow-node-"][data-nodetype]')]
      .map((block) => {
        const id = (block.getAttribute('data-testid') ?? '').replace('workflow-node-', '')
        const body = document.querySelector(`[data-testid="workflow-node-body-${id}"]`)
        return `${id}=${(body?.getAttribute('aria-label') ?? '').replace(/ block$/, '')}`
      })
      .sort(),
  )
}

/** Every sample recorded since recordView. */
export async function viewSamples(page: Page): Promise<ViewSample[]> {
  return page.evaluate(() => (window as unknown as { __viewSamples: ViewSample[] }).__viewSamples)
}

/** The samples recorded while an assistant's build streamed into this tab, from its first Block on. */
export async function buildSamples(page: Page): Promise<ViewSample[]> {
  return (await viewSamples(page)).filter((sample) => sample.watchingMcp && sample.count >= 1)
}

/** Pan the Start node out of view, then record the view from there. */
export async function lookAway(page: Page): Promise<void> {
  await panCanvas(page, 600, -300)
  await waitForViewportIdle(page)
  await recordView(page)
  await expect.poll(async () => (await viewSamples(page)).length).toBeGreaterThan(0)
  expect((await viewSamples(page))[0].startInView, 'the Start node is panned out of view').toBe(false)
}

/** A run of samples that show the same Blocks under the same steady border. */
export interface ContentState {
  blocks: string[]
  active: string | null
  samples: ViewSample[]
}

/** Whether a state and a sample show the same Blocks under the same steady border. */
export function sameContent(state: ContentState, sample: ViewSample): boolean {
  return state.active === sample.active && JSON.stringify(state.blocks) === JSON.stringify(sample.blocks)
}

/** The states a tab showed, in order: a state ends when its Blocks, their names or the steady border change. */
export function contentStates(samples: readonly ViewSample[]): ContentState[] {
  const states: ContentState[] = []
  for (const sample of samples) {
    const current = states.at(-1)
    if (current && sameContent(current, sample)) current.samples.push(sample)
    else states.push({ blocks: sample.blocks, active: sample.active, samples: [sample] })
  }
  return states
}

/** Whether the tab last told the server its canvas holds unsaved work; attach before the tab loads. */
export function trackDirtyReport(page: Page): () => boolean {
  let dirty = false
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      if (typeof payload !== 'string' || !payload.includes('"draft_state"')) return
      const frame = JSON.parse(payload) as { type?: string; dirty?: boolean }
      if (frame.type === 'draft_state') dirty = frame.dirty === true
    })
  })
  return () => dirty
}

/** The zoom of a React Flow viewport transform. */
export function zoomOf(transform: string): number {
  const match = /scale\(([\d.]+)\)/.exec(transform)
  if (!match) throw new Error(`no scale in transform "${transform}"`)
  return Number(match[1])
}

/** The pan offset of a React Flow viewport transform. */
export function offsetOf(transform: string): { x: number; y: number } {
  const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(transform)
  if (!match) throw new Error(`no translate in transform "${transform}"`)
  return { x: Number(match[1]), y: Number(match[2]) }
}
