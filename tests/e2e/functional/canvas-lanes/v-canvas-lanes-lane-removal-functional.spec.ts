/** V-CANVAS-LANES-FUNCTIONAL: links on a lane that a removed branch takes away
 *
 * Wireframe: N/A
 * Design Decisions: PARALLEL-3
 * REQ: REQ-3.1.1.3
 *
 * Only what the design states is asserted here; the design is silent on removing an If/Else
 * or Switch/Case branch, and on turning Try/Catch paths off and on.
 *
 * Pass Criteria:
 * 1. Parallel: removing a branch row removes its lane and the link that used it, on the canvas
 *    and in the saved Test; the other branches and then keep their links on their own dots.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  LANE_VIEWPORT,
  deleteTest,
  dropBelow,
  edge,
  edgeOnCanvas,
  expectDrawnFromLane,
  expectSavedLane,
  laneDot,
  openConfig,
  openLaneCanvas,
  parallelNode,
  saveCanvas,
  saveConfig,
  savedEdges,
  seedTest,
  setLogText,
} from './lanes-helpers'

test.use({ viewport: LANE_VIEWPORT })

test.describe('V-CANVAS-LANES-FUNCTIONAL: lanes taken away', () => {
  test('Parallel: removing a branch removes its lane and its link; the other lanes keep theirs', async ({
    page,
    request,
  }) => {
    const par = parallelNode({
      id: 'par',
      description: 'par',
      branches: [
        { id: 'branch_1', name: 'b1' },
        { id: 'branch_2', name: 'b2' },
        { id: 'branch_3', name: 'b3' },
      ],
      position: { x: 0, y: 150 },
    })
    const testId = await seedTest(request, { name: 'V-CANVAS-LANES parallel remove', nodes: [par], edges: [edge('start-node', 'par')] })
    try {
      await openLaneCanvas(page, testId)
      const lanes = ['branch_1', 'branch_2', 'branch_3', 'then']
      const logs = new Map<string, string>()
      for (const lane of lanes) {
        const id = await dropBelow(page, 'par', lane)
        await setLogText(page, id, `remove-${lane}`)
        logs.set(lane, id)
        await expectDrawnFromLane(page, 'par', lane, id)
      }
      await saveCanvas(page)
      const before = await savedEdges(request, testId)
      for (const lane of lanes) expectSavedLane(before, 'par', lane, logs.get(lane)!)

      const sheet = await openConfig(page, 'par')
      await sheet.locator('[data-testid="parallel-branch-delete-branch_2"]').click()
      await expect(sheet.locator('[data-testid="parallel-branch-card-branch_2"]')).toHaveCount(0)
      await saveConfig(sheet)

      await expect(laneDot(page, 'par', 'branch_2'), 'the removed branch has no lane').toHaveCount(0)
      await expect(edgeOnCanvas(page, 'par', logs.get('branch_2')!), 'its link is gone from the canvas').toHaveCount(0)
      for (const lane of ['branch_1', 'branch_3', 'then']) await expectDrawnFromLane(page, 'par', lane, logs.get(lane)!)

      await saveCanvas(page)
      const after = await savedEdges(request, testId)
      expect.soft(after.filter((e) => e.target === logs.get('branch_2')), 'the removed lane link is not saved').toEqual([])
      for (const lane of ['branch_1', 'branch_3', 'then']) expectSavedLane(after, 'par', lane, logs.get(lane)!)
    } finally {
      await deleteTest(request, testId)
    }
  })
})
