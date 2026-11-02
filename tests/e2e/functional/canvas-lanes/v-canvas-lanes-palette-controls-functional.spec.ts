/** V-CANVAS-LANES-FUNCTIONAL: single-exit controls, a Function, and every lane control fresh from the palette
 *
 * Wireframe: N/A
 * Design Decisions: CANVAS-235, SWITCH-6, WAIT-3, PARALLEL-1, REMEX-1
 * REQ: REQ-3.1.1.1, REQ-3.1.1.2, REQ-4.2.5
 *
 * Pass Criteria:
 * 1. Break, Continue, Variable Setter, Delay and a new local Function: a Halt dropped under the
 *    exit dot is linked from it (drawn from that dot), a second drop adds no second link, and
 *    the saved Test keeps the one link with no lane name.
 * 2. Every lane control dropped from the palette with its default settings draws the lanes its
 *    defaults give (If/Else if + else, Switch one case + then, Assert pass + fail, loops and
 *    Remote Execution body + then, Parallel two branches + then, Try/Catch try + catch + then,
 *    Wait Until retry + then, Halt none).
 * 3. A Halt dropped under the first dot takes the first lane; Quick Insert with the control
 *    selected takes the next lanes in drawing order; each link is drawn from its own dot and
 *    the saved Test names that lane. Nothing links from a Halt.
 */

import { test } from '../../helpers/playwright-fixtures'
import { LANE_VIEWPORT, wirePaletteDefaults, wireSingleExits } from './lanes-helpers'
import { CONTROLS_AND_FUNCTION, LANE_CONTROL_DEFAULTS } from './single-exit-blocks'

test.use({ viewport: LANE_VIEWPORT })

test.describe('V-CANVAS-LANES-FUNCTIONAL: controls fresh from the palette', () => {
  test('single-exit controls and a Function link their one exit once, and the saved Test keeps it', async ({
    page,
    request,
  }) => {
    await wireSingleExits(page, request, 'single exit controls', CONTROLS_AND_FUNCTION)
  })

  test('lane controls with their default settings take links on the lanes they draw, in order', async ({
    page,
    request,
  }) => {
    await wirePaletteDefaults(page, request, LANE_CONTROL_DEFAULTS)
  })
})
