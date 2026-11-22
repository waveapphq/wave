/** Canvas geometry in flow coordinates; each read takes box and viewport in one browser call. */

import { expect, type Locator, type Page } from './playwright-fixtures'

/** A drawn box in flow coordinates. */
export interface FlowBox {
  x: number
  y: number
  width: number
  height: number
}

/** The flow box of any element drawn inside the canvas viewport. */
export async function flowBoxOf(element: Locator): Promise<FlowBox> {
  await expect(element).toBeVisible()
  return element.evaluate((el) => {
    const flow = el.closest('.react-flow') as HTMLElement | null
    const viewport = flow?.querySelector('.react-flow__viewport') as HTMLElement | null
    if (!flow || !viewport) throw new Error('the element is not drawn inside a canvas viewport')
    const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform)
    const origin = flow.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    const zoom = matrix.a
    return {
      x: (box.left - origin.left - matrix.e) / zoom,
      y: (box.top - origin.top - matrix.f) / zoom,
      width: box.width / zoom,
      height: box.height / zoom,
    }
  })
}

/** The canvas wrapper of the node `id` (a Block, a Note, Start or the onboarding placeholder). */
export function nodeWrapper(page: Page, id: string): Locator {
  return page.locator(`.react-flow__node[data-id="${id}"]`)
}

/** The flow box of the node `id` as the canvas draws it. */
export async function nodeFlowBox(page: Page, id: string): Promise<FlowBox> {
  return flowBoxOf(nodeWrapper(page, id))
}

/** The horizontal center of a box. */
export function centerX(box: FlowBox): number {
  return box.x + box.width / 2
}

/** The flow x of a handle's center. */
export async function handleCenterX(handle: Locator): Promise<number> {
  return centerX(await flowBoxOf(handle))
}

/** Start's one egress handle. */
export function startHandle(page: Page): Locator {
  return nodeWrapper(page, 'start-node').locator('.react-flow__handle-bottom').first()
}

/** The ingress handle on top of the node `id`. */
export function topHandle(page: Page, id: string): Locator {
  return nodeWrapper(page, id).locator('.react-flow__handle-top').first()
}

/** The egress handle `handleId` of the node `id`; without one, its single egress. */
export function egressHandle(page: Page, id: string, handleId?: string): Locator {
  const handles = nodeWrapper(page, id).locator('.react-flow__handle-bottom')
  return handleId ? handles.and(page.locator(`[data-handleid="${handleId}"]`)) : handles.first()
}

/** Assert two flow x values agree within `tolerance` px. */
export function expectSameX(actual: number, expected: number, what: string, tolerance = 1): void {
  expect(
    Math.abs(actual - expected),
    `${what}: x ${actual.toFixed(2)} vs ${expected.toFixed(2)} (within ${tolerance} px)`,
  ).toBeLessThanOrEqual(tolerance)
}
