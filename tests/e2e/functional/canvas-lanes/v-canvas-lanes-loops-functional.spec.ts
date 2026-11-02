/** V-CANVAS-LANES-FUNCTIONAL: every lane of For, For Each, While and Wait Until built through the canvas
 *
 * Wireframe: N/A
 * Design Decisions: CANVAS-235, WAIT-3, WAIT-5, WAIT-8
 * REQ: REQ-3.1.1.1, REQ-3.1.1.2, REQ-4.2.5, REQ-3.5.4.3, REQ-3.5.4.4
 *
 * Pass Criteria:
 * 1. Each control is built three times: Log blocks dropped below it, Log blocks Quick Inserted
 *    with it selected, and links dragged from each lane dot. Two drops at the same point under
 *    the first dot fill body then then; under a Retry-mode Wait Until, retry then then.
 * 2. Every link is drawn from its own lane dot and the saved Test names that lane.
 * 3. One run takes every lane: a loop body Log once per iteration and the then Log once; the
 *    Wait Until retry Log once per round (two rounds) and the then Log once; the Watch-mode
 *    Wait Until exit Log once.
 */

import { test } from '../../helpers/playwright-fixtures'
import { LANE_VIEWPORT, buildEveryLane, controlNode, expr, type ControlCell } from './lanes-helpers'

test.use({ viewport: LANE_VIEWPORT })

const BODY_THEN = (onward?: 'count') => [
  { handle: 'body', name: 'body', runs: 2, onward },
  { handle: 'then', name: 'then', runs: 1 },
]

const FOR: ControlCell = {
  key: 'for',
  title: 'For',
  rounds: 1,
  dropAt: 'first-lane',
  lanes: BODY_THEN(),
  control: (id, _vars, position) =>
    controlNode({
      id,
      label: 'For Loop',
      elementType: 'for',
      category: 'loop',
      description: id,
      values: { mode: 'count', count: 2, start: 0, end: 0 },
      position,
    }),
}

const FOR_EACH: ControlCell = {
  key: 'fe',
  title: 'For Each',
  rounds: 1,
  dropAt: 'first-lane',
  lanes: BODY_THEN(),
  control: (id, _vars, position) =>
    controlNode({
      id,
      label: 'ForEach',
      elementType: 'for-each',
      category: 'loop',
      description: id,
      values: { collection: ['a', 'b'] },
      position,
    }),
}

const WHILE: ControlCell = {
  key: 'wh',
  title: 'While',
  rounds: 1,
  dropAt: 'first-lane',
  lanes: BODY_THEN('count'),
  control: (id, vars, position) =>
    controlNode({
      id,
      label: 'While',
      elementType: 'while',
      category: 'loop',
      description: id,
      values: { mode: 'while-do', conditions: [expr(`${id}-c0`, `${vars.counter} < 2`)], max_iterations: 5 },
      position,
    }),
}

function waitUntil(id: string, mode: 'retry' | 'watch', expression: string, position: { x: number; y: number }) {
  return controlNode({
    id,
    label: 'Wait Until',
    elementType: 'wait-until',
    category: 'timing',
    description: id,
    values: {
      conditions: [expr(`${id}-c0`, expression)],
      timeout: 20_000,
      check_interval: 200,
      message: `${id} gave up`,
      mode,
      fail_current_scope: false,
    },
    position,
  })
}

const WAIT_RETRY: ControlCell = {
  key: 'wu',
  title: 'Wait Until Retry',
  rounds: 1,
  dropAt: 'first-lane',
  lanes: [
    { handle: 'retry', name: 'retry', runs: 2, onward: 'count' },
    { handle: 'then', name: 'then', runs: 1 },
  ],
  control: (id, vars, position) => waitUntil(id, 'retry', `${vars.counter} >= 2`, position),
}

const WAIT_WATCH: ControlCell = {
  key: 'ww',
  title: 'Wait Until Watch',
  rounds: 1,
  dropAt: 'each-lane',
  lanes: [{ handle: null, name: 'exit', runs: 1 }],
  control: (id, _vars, position) => waitUntil(id, 'watch', 'True', position),
}

test.describe('V-CANVAS-LANES-FUNCTIONAL: loops and waits', () => {
  for (const cell of [FOR, FOR_EACH, WHILE, WAIT_RETRY, WAIT_WATCH]) {
    test(`${cell.title}: every lane built by drop, Quick Insert and drag is drawn, saved and run`, async ({
      page,
      request,
    }) => {
      await buildEveryLane(page, request, cell)
    })
  }
})
