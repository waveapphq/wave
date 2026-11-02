/** V-CANVAS-LANES-FUNCTIONAL: every lane of Try/Catch/Finally, Parallel, Remote Execution and Halt built through the canvas
 *
 * Wireframe: N/A
 * Design Decisions: CANVAS-235, PARALLEL-1, PARALLEL-2, REMEX-1
 * REQ: REQ-3.1.1.1, REQ-3.1.1.2, REQ-3.1.1.3, REQ-4.2.5, REQ-3.4.1.3
 *
 * Pass Criteria:
 * 1. Each control is built three times: Log blocks dropped below its lane dots, Log blocks
 *    Quick Inserted with it selected, and links dragged from each lane dot, filling the lanes in
 *    the order they are drawn.
 * 2. Every link is drawn from its own lane dot and the saved Test names that lane.
 * 3. One run takes every lane: try, catch, finally and then as the toggles and a failing try
 *    path predict; every Parallel branch and then; the Remote Execution body and then (sshd).
 * 4. Halt has no exit: a drop below it and a Quick Insert with it selected place a Log with no
 *    link, it shows no exit dot, the saved Test has no link from it and the run never reaches
 *    the placed Logs.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  LANE_VIEWPORT,
  buildEveryLane,
  deleteTest,
  dropBelowBlock,
  edge,
  edgesFrom,
  expectLogTexts,
  haltBlock,
  logBlock,
  nodeLocator,
  openLaneCanvas,
  parallelNode,
  quickAddLogAfter,
  remoteExecutionNode,
  runToPass,
  saveCanvas,
  savedEdges,
  seedTest,
  setLogText,
  sshOpenBlock,
  tryCatchNode,
  type ControlCell,
  type LaneDef,
} from './lanes-helpers'

test.use({ viewport: LANE_VIEWPORT })

function tryCell(key: string, title: string, catchOn: boolean, finallyOn: boolean): ControlCell {
  const lanes: LaneDef[] = [{ handle: 'try', name: 'try', runs: 1, onward: catchOn ? 'fail' : undefined }]
  if (catchOn) lanes.push({ handle: 'catch', name: 'catch', runs: 1 })
  if (finallyOn) lanes.push({ handle: 'finally', name: 'finally', runs: 1 })
  lanes.push({ handle: 'then', name: 'then', runs: 1 })
  return {
    key,
    title,
    rounds: 1,
    dropAt: 'each-lane',
    lanes,
    control: (id, _vars, position) =>
      tryCatchNode({ id, description: id, enableCatch: catchOn, enableFinally: finallyOn, position }),
  }
}

function parallelCell(key: string, title: string, branches: number): ControlCell {
  const ids = Array.from({ length: branches }, (_, i) => `branch_${i + 1}`)
  return {
    key,
    title,
    rounds: 1,
    dropAt: 'each-lane',
    lanes: [...ids.map((id, i) => ({ handle: id, name: `b${i + 1}`, runs: 1 })), { handle: 'then', name: 'then', runs: 1 }],
    control: (id, _vars, position) =>
      parallelNode({ id, description: id, branches: ids.map((b, i) => ({ id: b, name: `b${i + 1}` })), position }),
  }
}

const REMOTE: ControlCell = {
  key: 'rx',
  title: 'Remote Execution',
  rounds: 1,
  dropAt: 'first-lane',
  ssh: true,
  prelude: [sshOpenBlock('rx-ssh', 'sid', { x: -300, y: 0 })],
  variables: { sid: { value: '', type: 'string', scope: 'test' } },
  lanes: [
    { handle: 'body', name: 'body', runs: 1 },
    { handle: 'then', name: 'then', runs: 1 },
  ],
  control: (id, _vars, position) =>
    remoteExecutionNode({ id, description: id, values: { session_id: 'sid' }, expressionFields: ['session_id'], position }),
}

const CELLS: ControlCell[] = [
  tryCell('tc1', 'Try/Catch catch', true, false),
  tryCell('tc2', 'Try/Catch catch + finally', true, true),
  tryCell('tc3', 'Try/Catch finally only', false, true),
  parallelCell('p2', 'Parallel two branches', 2),
  parallelCell('p3', 'Parallel three branches', 3),
  REMOTE,
]

test.describe('V-CANVAS-LANES-FUNCTIONAL: scopes, fan-out, remote and Halt', () => {
  for (const cell of CELLS) {
    test(`${cell.title}: every lane built by drop, Quick Insert and drag is drawn, saved and run`, async ({
      page,
      request,
    }) => {
      await buildEveryLane(page, request, cell)
    })
  }

  test('Halt: no exit, so a drop below it and a Quick Insert after it place a Log with no link', async ({
    page,
    request,
  }) => {
    const testId = await seedTest(request, {
      name: 'V-CANVAS-LANES Halt',
      nodes: [logBlock('halt-before', 'halt-before', { x: 0, y: 0 }), haltBlock('halt', { x: 0, y: 160 })],
      edges: [edge('start-node', 'halt-before'), edge('halt-before', 'halt')],
    })
    try {
      await openLaneCanvas(page, testId)
      await expect(nodeLocator(page, 'halt').locator('[data-testid^="handle-output"]'), 'Halt draws no exit dot').toHaveCount(0)

      const dropped = await dropBelowBlock(page, 'halt')
      await expect(edgesFrom(page, 'halt'), 'a drop below Halt adds no link').toHaveCount(0)
      await setLogText(page, dropped, 'halt-drop')

      const inserted = await quickAddLogAfter(page, 'halt')
      await expect(edgesFrom(page, 'halt'), 'a Quick Insert after Halt adds no link').toHaveCount(0)
      await setLogText(page, inserted, 'halt-quick')

      await saveCanvas(page)
      const saved = await savedEdges(request, testId)
      expect(saved.filter((e) => e.source === 'halt'), 'the saved Test has no link from Halt').toEqual([])
      expect(
        saved.filter((e) => e.target === dropped || e.target === inserted),
        'the placed Logs have no link into them',
      ).toEqual([])

      const entries = await runToPass(page)
      expectLogTexts(entries, ['halt-before'])
      expect(entries.map((e) => e.message)).not.toContain('halt-drop')
      expect(entries.map((e) => e.message)).not.toContain('halt-quick')
    } finally {
      await deleteTest(request, testId)
    }
  })
})
