/** V-CANVAS-LANES-FUNCTIONAL: single-exit Network, Remote, Database and System blocks wired through the canvas
 *
 * Wireframe: N/A
 * Design Decisions: CANVAS-51
 * REQ: REQ-3.1.1.1, REQ-3.1.1.2
 *
 * Pass Criteria:
 * 1. Each block is dropped from the palette; a Halt dropped under its exit dot is linked from
 *    that dot, and the link is drawn from it.
 * 2. A second Halt dropped under the same exit adds no second link.
 * 3. The saved Test holds exactly that one link per block, with no lane name.
 */

import { test } from '../../helpers/playwright-fixtures'
import { LANE_VIEWPORT, wireSingleExits } from './lanes-helpers'
import { PLUGINS_A } from './single-exit-blocks'

test.use({ viewport: LANE_VIEWPORT })

test.describe('V-CANVAS-LANES-FUNCTIONAL: single exit, Network to System', () => {
  test('a drop under each block links its one exit once, and the saved Test keeps that link', async ({
    page,
    request,
  }) => {
    await wireSingleExits(page, request, 'single exit A', PLUGINS_A)
  })
})
