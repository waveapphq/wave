import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Map from search term (what a test types into the palette search box) to
 * the data-testid the palette gives its rendered item. Kept here so every
 * palette-drag call site uses the same convention. For search terms not in
 * this map, the helper falls through to `palette-item-<searchTerm>` which
 * covers controls/plugins whose testid equals their term (e.g. 'assert',
 * 'delay', 'halt', 'for', 'while').
 */
const PALETTE_TESTID_MAP: Record<string, string> = {
  // Plugins whose friendly term differs from their testid suffix.
  'http': 'palette-item-http-client',
  'sql': 'palette-item-sql-client',
  'if': 'palette-item-if-else',
  'shell script': 'palette-item-shell-script',
  'try': 'palette-item-try-catch-finally',
  'for each': 'palette-item-for-each',
  'xml': 'palette-item-xml-parser',
  'json': 'palette-item-json-parser',
}

/**
 * Expand the palette if it is collapsed. Idempotent.
 */
export async function expandPalette(page: Page): Promise<void> {
  const palette = page.locator('[data-testid="block-palette"]')
  const state = await palette.getAttribute('data-state')
  if (state === 'collapsed') {
    await page.locator('[data-testid="palette-expand-button"]').click()
    await expect(palette).toHaveAttribute('data-state', 'expanded')
    // The palette shares the row with the canvas, so this resized the canvas.
    await waitForCanvasBoxStable(page)
  }
}

/**
 * Spec for which palette item to drag. Callers pass either:
 *   - a short string (e.g. 'if', 'shell script') that the helper resolves via
 *     PALETTE_TESTID_MAP. This is what most tests use.
 *   - an object { term, testId } for cases where the text typed into the
 *     search box differs from the palette item's testid suffix, e.g. you
 *     want to type "try" to filter but click the `palette-item-try-catch-finally`
 *     result. Passing both explicitly avoids the helper guessing wrong.
 */
export type PaletteDragSpec = string | { term: string; testId: string }

type DropProbe = { dragstart: boolean; accepted: boolean; drop: boolean; dragend: boolean }

/** Record whether the next drag starts, its last dragover was accepted, a drop reached the page, and it ended. */
async function armDropProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __waveDropProbe?: DropProbe; __waveDropProbeOff?: () => void }
    w.__waveDropProbeOff?.()
    const probe: DropProbe = { dragstart: false, accepted: false, drop: false, dragend: false }
    const mark = (e: Event) => {
      probe[e.type as 'dragstart' | 'drop' | 'dragend'] = true
    }
    // Bubble phase on window runs after the canvas's onDragOver, so it sees that handler's verdict.
    const over = (e: DragEvent) => {
      probe.accepted = e.defaultPrevented && e.dataTransfer?.dropEffect === 'move'
    }
    const types = ['dragstart', 'drop', 'dragend'] as const
    for (const type of types) window.addEventListener(type, mark, true)
    window.addEventListener('dragover', over)
    w.__waveDropProbe = probe
    w.__waveDropProbeOff = () => {
      for (const type of types) window.removeEventListener(type, mark, true)
      window.removeEventListener('dragover', over)
    }
  })
}

/** 'lost' only when the canvas accepted the drag and no drop reached the page; anything else unclear is 'unknown'. */
async function dropOutcome(page: Page): Promise<'dropped' | 'lost' | 'unknown'> {
  try {
    const handle = await page.waitForFunction(
      () => {
        const p = (window as unknown as { __waveDropProbe?: DropProbe }).__waveDropProbe
        if (!p?.dragstart) return 'unknown'
        if (p.drop) return 'dropped'
        if (!p.dragend) return false
        return p.accepted ? 'lost' : 'unknown'
      },
      undefined,
      { timeout: 1000 },
    )
    return (await handle.jsonValue()) as 'dropped' | 'lost' | 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Drag a palette item onto the canvas and wait for the new node to appear.
 *
 * Playwright's `dragTo({ force: true })` dispatches the synthetic HTML5 DnD
 * sequence (dragstart → dragover → drop) in quick succession. Under CPU load
 * the React scheduler can re-render the palette item between dragstart and
 * drop - the drag source becomes detached and React Flow never receives a
 * valid drop. A single arbitrary `waitForTimeout(200)` is not enough when
 * many container shards run in parallel.
 *
 * This helper retries the whole palette-fill → drag → node-appears cycle up
 * to 3 times. Each attempt re-fills the search input so a transient re-render
 * doesn't leave a stale locator, waits one animation frame for React to
 * commit, then verifies the new node appeared before returning.
 *
 * Any test that drops a palette item onto the canvas should use this helper
 * instead of calling `paletteItem.dragTo(canvas, ...)` directly.
 */
export async function dragPaletteItemToCanvas(
  page: Page,
  spec: PaletteDragSpec,
  targetPosition: { x: number; y: number }
): Promise<void> {
  const searchTerm = typeof spec === 'string' ? spec : spec.term
  const paletteTestId =
    typeof spec === 'string'
      ? (PALETTE_TESTID_MAP[spec] ?? `palette-item-${spec}`)
      : spec.testId

  const canvas = page.locator('[data-testid="workflow-canvas"]')
  // `workflow-node-*` covers standard control/plugin nodes; `note-node-*`
  // covers Note annotations (which don't mount as workflow nodes). Each
  // workflow node renders BOTH an outer wrapper (`workflow-node-<id>`) and
  // an inner body button (`workflow-node-body-<id>`); count only the outer
  // wrapper via the `[data-nodetype]` attribute (only the wrapper carries
  // that attribute). The selector union lets the helper verify node
  // creation across both kinds without the caller having to tell us which
  // kind was dragged.
  const createdNodes = page.locator(
    '[data-testid^="workflow-node-"][data-nodetype], [data-testid^="note-node-"]'
  )
  const nodesBefore = await createdNodes.count()

  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    await expandPalette(page)
    const searchInput = page.locator('[data-testid="palette-search-input"]')
    // Playwright's `fill()` already clears the input before typing, so we
    // deliberately do NOT call `fill('')` first - every extra fill is an
    // extra React commit on the filtered palette, which widens the exact
    // race window this helper was built to close.
    await searchInput.fill(searchTerm)

    const paletteItem = page.locator(`[data-testid="${paletteTestId}"]`)
    await expect(paletteItem).toBeVisible({ timeout: 5000 })
    // Two animation frames after visibility: frame 1 lets React commit the
    // filter result; frame 2 gives the commit a chance to paint before we
    // start the drag. A single frame is not always enough under container-shard parallelism.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )
    try {
      // A filter re-render can detach the item after it showed; that counts as a missed attempt.
      await paletteItem.waitFor({ state: 'attached', timeout: 1000 })
      await armDropProbe(page)
      await paletteItem.dragTo(canvas, { targetPosition, force: true })
      // A drop the canvas accepted but never received cannot add a node, so skip the node wait and retry.
      if ((await dropOutcome(page)) === 'lost') {
        throw new Error('dragPaletteItemToCanvas: the canvas accepted the drag but no drop reached the page')
      }
      await expect(createdNodes).toHaveCount(nodesBefore + 1, { timeout: 3000 })
      return
    } catch (e) {
      lastError = e
      // Drop missed (palette re-rendered mid-drag). Let React settle then
      // retry - on the next pass `fill(searchTerm)` no-ops the value but
      // still re-focuses the input, which is enough to reset drag state.
      await page.waitForTimeout(500)
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('dragPaletteItemToCanvas: node did not appear after 3 attempts')
}

/**
 * Drag a non-palette-search source (e.g. the "New Function" handle, the
 * Functions Library card) onto the canvas with the same retry / animation
 * frame discipline as `dragPaletteItemToCanvas`. Use when the drag source
 * is NOT a palette filter result (those still use
 * `dragPaletteItemToCanvas`).
 */
export async function dragSourceToCanvas(
  page: Page,
  source: Locator,
  targetPosition: { x: number; y: number }
): Promise<void> {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const createdNodes = page.locator(
    '[data-testid^="workflow-node-"][data-nodetype]'
  )
  const before = await createdNodes.count()

  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    await source.scrollIntoViewIfNeeded().catch(() => {})
    await source.waitFor({ state: 'attached', timeout: 5_000 })
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    try {
      await source.dragTo(canvas, { targetPosition, force: true })
      await expect(createdNodes).toHaveCount(before + 1, { timeout: 3_000 })
      return
    } catch (e) {
      lastError = e
      await page.waitForTimeout(500)
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('dragSourceToCanvas: node did not appear after 3 attempts')
}

const CANVAS_SELECTOR = '[data-testid="workflow-canvas"]'
const VIEWPORT_SELECTOR = `${CANVAS_SELECTOR} .react-flow__viewport`

/**
 * One frame-accurate settle loop, shared by the canvas geometry waits.
 *
 * Samples on `requestAnimationFrame` inside the page rather than over the
 * protocol, so the settling commit is seen on the frame it lands. Resolves as
 * soon as the sampled value holds still for `stableFrames`, and on give-up
 * resolves anyway, leaving the caller exactly where it would have been without
 * the wait.
 */
async function settleCanvasGeometry(
  page: Page,
  kind: 'viewport' | 'box',
  timeout: number,
): Promise<void> {
  // Best-effort by contract: a context torn down mid-settle leaves the caller
  // exactly where the give-up path does, so it must not fail the test.
  await page.evaluate(
    ({ kind, canvasSelector, viewportSelector, timeout, stableFrames }) =>
      new Promise<void>((resolve) => {
        const read = () => {
          if (kind === 'viewport') {
            const el = document.querySelector(viewportSelector)
            return el ? getComputedStyle(el).transform : null
          }
          const el = document.querySelector(canvasSelector)
          if (!el) return null
          const r = el.getBoundingClientRect()
          return `${r.x},${r.y},${r.width},${r.height}`
        }
        let last = read()
        // No canvas mounted (placeholder pages) - nothing can shift.
        if (last === null) {
          resolve()
          return
        }
        // React Flow's fit is a no-op on an empty node set, so for those the
        // untouched identity transform IS the settled state, not a pending fit.
        const unfitted =
          kind === 'viewport' && document.querySelector('.react-flow__node')
            ? new Set(['none', 'matrix(1, 0, 0, 1, 0, 0)'])
            : new Set<string>()

        let stable = 0
        let done = false
        const finish = () => {
          if (done) return
          done = true
          clearTimeout(guard)
          resolve()
        }
        // rAF stops in a throttled renderer; the timer keeps the wait bounded.
        const guard = setTimeout(finish, timeout + 500)
        const deadline = performance.now() + timeout

        const tick = () => {
          if (done) return
          const now = read()
          if (now === null) {
            finish()
            return
          }
          stable = now === last ? stable + 1 : 0
          last = now
          if ((stable >= stableFrames && !unfitted.has(now)) || performance.now() >= deadline) {
            finish()
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    {
      kind,
      canvasSelector: CANVAS_SELECTOR,
      viewportSelector: VIEWPORT_SELECTOR,
      timeout,
      stableFrames: 3,
    },
  ).catch(() => {})
}

/**
 * Wait for the React Flow viewport transform to stop changing.
 *
 * React Flow queues `fitView` and applies it only once every node is measured,
 * which lands AFTER the loading overlay is dismissed. Any bounding box read in
 * that window is stale by the pan and zoom the fit is about to apply, so a drag
 * to those coordinates hits the wrong place.
 */
export async function waitForViewportSettled(page: Page, timeout = 2000): Promise<void> {
  await settleCanvasGeometry(page, 'viewport', timeout)
}

/**
 * Wait for the canvas element's own rect to stop changing.
 *
 * The palette, console and Variable Manager share a resizable row with the
 * canvas, so collapsing or expanding one moves the canvas origin and resizes
 * it over more than one commit. Every screen coordinate derived from the
 * canvas rect is stale until that lands, which the viewport settle cannot see
 * because the React Flow transform does not change. Call this after toggling
 * a panel, once the panel's own `data-state` proves the toggle committed.
 */
export async function waitForCanvasBoxStable(page: Page, timeout = 1500): Promise<void> {
  await settleCanvasGeometry(page, 'box', timeout)
}

/**
 * Wait for canvas page to finish loading.
 * This helper waits for the canvas layout to be visible and ready for interaction.
 */
export async function waitForCanvasLoad(page: Page): Promise<void> {
  // Wait for the canvas page container to be visible
  // With fullyParallel and 8 workers, many tests hit /workbench concurrently.
  // The Vite dev server + React hydration can take longer under parallel load.
  // 30s gives headroom without slowing passing tests (resolves on first match).
  await expect(page.locator('[data-testid="canvas-page"]')).toBeVisible({ timeout: 30000 })

  // Wait for loading to complete - no skeletons should be present
  await expect(page.locator('[data-skeleton]')).toHaveCount(0, { timeout: 15_000 })

  // Wait for canvas to be ready (overlay dismissed, pointer events enabled)
  await waitForCanvasReady(page)

  // The overlay lifts while the fit is still queued, so settle the viewport
  // before the caller reads any coordinate off the canvas.
  await waitForViewportSettled(page)
}

/**
 * Intercept session recovery to prevent stale cross-worker sessions from
 * triggering a failed test load. Under parallel load, another worker may
 * create a backend workbench session whose test is later deleted; without
 * this interception, session recovery shows a "Test not found" modal that
 * blocks all canvas interaction. Call before any navigation to /workbench.
 */
export async function stubSessionRecovery(page: Page): Promise<void> {
  await page.route('**/workbench/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: null }),
    })
  )
}

/**
 * Answer the two reads a Test invented with `page.route` cannot serve: the
 * load-time validation and the post-save sealed-secret re-read. The real
 * backend never stored the id, so both fail, and a failed read blocks the
 * canvas: the load-time one also stops the canvas ever reporting itself ready.
 * Named ids only, so a real seeded Test in the same spec is untouched. Call it
 * FIRST, before the spec registers its own handlers, so anything the spec
 * answers for itself still wins.
 */
export async function mockInventedTestReads(
  page: Page,
  testIds: readonly string[],
): Promise<void> {
  for (const testId of testIds) {
    await page.route(`**/tests/${testId}/validate**`, async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { fatal: false, errors: [], warnings: [] } }),
      })
    })
    await page.route(`**/tests/${testId}/workflow`, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { nodes: [], edges: [] } }),
      })
    })
  }
}

/**
 * Wait for sidebar to be visible and ready.
 * Note: Sidebar collapse state depends on viewport width (1200px threshold),
 * not route type. Canvas routes don't auto-collapse the sidebar.
 */
export async function waitForSidebarReady(page: Page): Promise<void> {
  const sidebar = page.locator('[data-testid="sidebar"]')
  await expect(sidebar).toBeVisible()
}

/**
 * Wait for sidebar to be in collapsed state (56px width per SHELL-6).
 * @deprecated Use waitForSidebarReady instead - sidebar collapse depends on viewport, not route
 */
export async function waitForSidebarCollapsed(page: Page): Promise<void> {
  // Wait for sidebar to be visible
  const sidebar = page.locator('[data-testid="sidebar"]')
  await expect(sidebar).toBeVisible()

  // Note: Sidebar collapse is based on viewport width threshold (1200px),
  // not on canvas route detection. On desktop viewport (1280px),
  // sidebar will be expanded by default.
}

/**
 * Wait for canvas toolbar to be visible and ready.
 */
export async function waitForCanvasToolbar(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="canvas-toolbar"]')).toBeVisible()
}

/**
 * Wait for canvas breadcrumb bar to be visible.
 */
export async function waitForCanvasBreadcrumb(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="canvas-breadcrumb"]')).toBeVisible()
}

/**
 * Wait for canvas empty state components to be visible.
 */
export async function waitForCanvasEmptyState(page: Page): Promise<void> {
  // Wait for start node to be visible
  await expect(page.locator('[data-testid="start-node"]')).toBeVisible()

  // Wait for onboarding placeholder to be visible
  await expect(page.locator('[data-testid="onboarding-placeholder"]')).toBeVisible()
}

/**
 * Wait for canvas to be fully ready (overlay dismissed, canvas visible).
 * On pages with a loading overlay, waits for the overlay to dismiss
 * (pointer-events-none). On placeholder pages without an overlay,
 * returns immediately since the canvas is ready by default.
 */
export async function waitForCanvasReady(page: Page): Promise<void> {
  const overlay = page.locator('[data-testid="canvas-loading-overlay"]')
  const overlayCount = await overlay.count()
  if (overlayCount > 0) {
    // Real canvas with overlay - wait for it to become transparent and non-interactive
    await expect(overlay).toHaveClass(/pointer-events-none/, { timeout: 30000 })
  }
}

/** Open a workflow node's kebab menu, retrying the trigger click until the Radix menu appears. */
export async function openNodeKebab(page: Page, nodeId: string): Promise<Locator> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  const kebab = node.locator('[data-testid="node-kebab"]')
  const menu = page.locator('[role="menu"]')
  await expect(async () => {
    await kebab.click()
    await expect(menu).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 15000 })
  return menu
}

/** Open a node's kebab and click a menu item, retrying the whole open+click so an
 *  edit-mode re-render that closes the menu mid-flow doesn't flake the click. */
export async function clickNodeKebabItem(
  page: Page,
  nodeId: string,
  itemName: string | RegExp,
): Promise<void> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  const kebab = node.locator('[data-testid="node-kebab"]')
  const item = page.locator('[role="menu"]').getByRole('menuitem', { name: itemName })
  await expect(async () => {
    await kebab.click()
    await item.click({ timeout: 2000 })
  }).toPass({ timeout: 15000 })
}

/** Open a node's kebab and assert a menu item is present, retrying the open so a
 *  post-edit-mode re-render that closes the menu doesn't flake the assertion. */
export async function expectNodeKebabItem(
  page: Page,
  nodeId: string,
  itemName: string | RegExp,
): Promise<void> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  const kebab = node.locator('[data-testid="node-kebab"]')
  const item = page.locator('[role="menu"]').getByRole('menuitem', { name: itemName })
  await expect(async () => {
    await kebab.click()
    await expect(item).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15000 })
}
