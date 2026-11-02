/** V-CANVAS-LANES-FUNCTIONAL: every lane of If/Else, Assert and Switch/Case built through the canvas
 *
 * Wireframe: N/A
 * Design Decisions: CANVAS-235, SWITCH-1, SWITCH-3, SWITCH-4, SWITCH-6
 * REQ: REQ-3.1.1.1, REQ-3.1.1.2, REQ-4.2.5, REQ-3.5.1.20
 *
 * Pass Criteria:
 * 1. Each control is built three times: Log blocks dropped below its lane dots, Log blocks
 *    Quick Inserted with the control selected, and links dragged from each lane dot. Drops and
 *    Quick Inserts fill the lanes in the order they are drawn; a Log dropped under an If/Else
 *    lands on its first branch.
 * 2. Every link is drawn from its own lane dot and the saved Test names that lane.
 * 3. One run takes every lane the lane logic predicts: If/Else one branch per round, Assert pass
 *    then fail, Switch both fall-through cases, the default and then.
 */

import { test } from '../../helpers/playwright-fixtures'
import { LANE_VIEWPORT, buildEveryLane, controlNode, expr, type ControlCell } from './lanes-helpers'

test.use({ viewport: LANE_VIEWPORT })

function ifElse(id: string, branches: Array<Record<string, unknown>>, position: { x: number; y: number }) {
  return controlNode({
    id,
    label: 'If/Else',
    elementType: 'if-else',
    category: 'conditional',
    description: id,
    values: { branches },
    position,
  })
}

function assertBlock(id: string, mode: 'split' | 'single', expression: string, position: { x: number; y: number }) {
  return controlNode({
    id,
    label: 'Assert',
    elementType: 'assert',
    category: 'flow',
    description: id,
    values: { assertions: [expr(`${id}-a`, expression)], mode, fail_current_scope: false },
    position,
  })
}

const IF_ONLY: ControlCell = {
  key: 'ie1',
  title: 'If/Else if',
  rounds: 2,
  dropAt: 'each-lane',
  lanes: [{ handle: 'branch_0', name: 'if', runs: 1 }],
  control: (id, vars, position) =>
    ifElse(id, [{ type: 'if', id: 'branch_0', label: '', conditions: [expr(`${id}-c0`, `${vars.index} == 0`)] }], position),
}

const IF_ELSE: ControlCell = {
  key: 'ie2',
  title: 'If/Else if + else',
  rounds: 2,
  dropAt: 'first-lane',
  lanes: [
    { handle: 'branch_0', name: 'if', runs: 1 },
    { handle: 'branch_1', name: 'else', runs: 1 },
  ],
  control: (id, vars, position) =>
    ifElse(
      id,
      [
        { type: 'if', id: 'branch_0', label: '', conditions: [expr(`${id}-c0`, `${vars.index} == 0`)] },
        { type: 'else', id: 'branch_1', label: '' },
      ],
      position,
    ),
}

const IF_ELIF_ELSE: ControlCell = {
  key: 'ie3',
  title: 'If/Else if + else if + else',
  rounds: 3,
  dropAt: 'each-lane',
  lanes: [
    { handle: 'branch_0', name: 'if', runs: 1 },
    { handle: 'branch_1', name: 'elif', runs: 1 },
    { handle: 'branch_2', name: 'else', runs: 1 },
  ],
  control: (id, vars, position) =>
    ifElse(
      id,
      [
        { type: 'if', id: 'branch_0', label: '', conditions: [expr(`${id}-c0`, `${vars.index} == 0`)] },
        { type: 'else_if', id: 'branch_1', label: '', conditions: [expr(`${id}-c1`, `${vars.index} == 1`)] },
        { type: 'else', id: 'branch_2', label: '' },
      ],
      position,
    ),
}

const ASSERT_SPLIT: ControlCell = {
  key: 'as2',
  title: 'Assert split',
  rounds: 2,
  dropAt: 'first-lane',
  lanes: [
    { handle: 'pass', name: 'pass', runs: 1 },
    { handle: 'fail', name: 'fail', runs: 1 },
  ],
  control: (id, vars, position) => assertBlock(id, 'split', `${vars.index} == 0`, position),
}

const ASSERT_SINGLE: ControlCell = {
  key: 'as1',
  title: 'Assert single',
  rounds: 1,
  dropAt: 'each-lane',
  lanes: [{ handle: null, name: 'exit', runs: 1 }],
  control: (id, _vars, position) => assertBlock(id, 'single', 'True', position),
}

const SWITCH: ControlCell = {
  key: 'sw',
  title: 'Switch/Case cases + default',
  rounds: 1,
  dropAt: 'each-lane',
  lanes: [
    { handle: 'branch_0', name: 'case1', runs: 1 },
    { handle: 'branch_1', name: 'case2', runs: 1 },
    { handle: 'branch_2', name: 'default', runs: 1 },
    { handle: 'then', name: 'then', runs: 1 },
  ],
  control: (id, _vars, position) =>
    controlNode({
      id,
      label: 'Switch',
      elementType: 'switch-case',
      category: 'conditional',
      description: id,
      values: {
        branches: [
          { id: 'branch_0', type: 'case', label: '', break: false, conditions: [expr(`${id}-c0`, 'True')] },
          { id: 'branch_1', type: 'case', label: '', break: false, conditions: [expr(`${id}-c1`, 'True')] },
          { id: 'branch_2', type: 'default', label: '' },
        ],
      },
      position,
    }),
}

test.describe('V-CANVAS-LANES-FUNCTIONAL: branching controls', () => {
  for (const cell of [IF_ONLY, IF_ELSE, IF_ELIF_ELSE, ASSERT_SPLIT, ASSERT_SINGLE, SWITCH]) {
    test(`${cell.title}: every lane built by drop, Quick Insert and drag is drawn, saved and run`, async ({
      page,
      request,
    }) => {
      await buildEveryLane(page, request, cell)
    })
  }
})
