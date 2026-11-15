/** Test graphs with a Note wired into a For, For Each and While body, a Try section, a Switch case, a Parallel lane and an If/Else branch. */

import {
  controlNode,
  edge,
  handleEdge,
  markerNode,
  parallelNode,
  tryCatchNode,
  type BranchHandle,
  type NodePosition,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import { literalCondition } from '../../helpers/nesting-graph'

const START_NODE_ID = 'start-node'

/** A canvas Note in the shape the palette and a recipe store: type `noteNode`, text and color under config.values. */
export type NoteNode = {
  id: string
  type: 'noteNode'
  position: NodePosition
  data: Record<string, unknown>
}

export type CanvasNode = WorkflowNode | NoteNode

export type NoteGraph = {
  nodes: CanvasNode[]
  edges: WorkflowEdge[]
  variables: Record<string, { value: unknown; type: string; scope: 'test' }>
}

/** A Note with its text, wired like any Block through its input and output handles. */
export function noteNode(id: string, text: string, position: NodePosition): NoteNode {
  return {
    id,
    type: 'noteNode',
    position,
    data: {
      label: 'Note',
      elementType: 'note',
      nodeType: 'control',
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      config: { values: { text, color: 'slate' }, outputBindings: {}, profileBindings: [] },
    },
  }
}

/** Column `col`, row `row` of a readable grid. */
export function at(col: number, row: number): NodePosition {
  return { x: -75 + col * 320, y: 100 + row * 120 }
}

/** The ids every graph below uses. */
export const IDS = {
  container: 'container',
  logA: 'log-a',
  note: 'note',
  logB: 'log-b',
  done: 'done',
  other: 'log-other',
  inc: 'inc',
  count: 'log-count',
  taken: 'log-taken',
  untaken: 'log-untaken',
} as const

/** The text each marker Log prints in one run. */
export function lines(token: string) {
  return {
    a: `A-${token}`,
    b: `B-${token}`,
    done: `done-${token}`,
    other: `other-${token}`,
    count: (n: number) => `count-${n}-${token}`,
    taken: `taken-${token}`,
    untaken: `untaken-${token}`,
  }
}

function log(id: string, text: string, position: NodePosition): WorkflowNode {
  return markerNode({ id, description: id, text, position })
}

function expressionCondition(id: string): Record<string, unknown> {
  return { type: 'expression', expression: 'True', id }
}

/** Log A, Note, Log B on `handle` of the container, the bookend Log on its `then`. */
function bodyAB(container: WorkflowNode, handle: BranchHandle, token: string, extra: CanvasNode[] = [], extraEdges: WorkflowEdge[] = []): NoteGraph {
  const text = lines(token)
  return {
    nodes: [
      container,
      log(IDS.logA, text.a, at(1, 1)),
      noteNode(IDS.note, 'Between Log A and Log B', at(1, 2)),
      log(IDS.logB, text.b, at(1, 3)),
      ...extra,
      log(IDS.done, text.done, at(0, 5)),
    ],
    edges: [
      { id: `edge-start-${IDS.container}`, source: START_NODE_ID, target: IDS.container },
      handleEdge(IDS.container, handle, IDS.logA),
      edge(IDS.logA, IDS.note),
      edge(IDS.note, IDS.logB),
      ...extraEdges,
      handleEdge(IDS.container, 'then', IDS.done),
    ],
    variables: {},
  }
}

/** For with count 2; its body is Log A, Note, Log B. */
export function forBody(token: string): NoteGraph {
  const loop = controlNode({
    id: IDS.container,
    label: 'For Loop',
    elementType: 'for',
    category: 'loop',
    description: 'for',
    values: { mode: 'count', count: 2, start: 0, end: 0 },
    position: at(0, 0),
  })
  return bodyAB(loop, 'body', token)
}

/** For Each over [1, 2]; its body is Log A, Note, Log B. */
export function forEachBody(token: string): NoteGraph {
  const loop = controlNode({
    id: IDS.container,
    label: 'ForEach',
    elementType: 'for-each',
    category: 'loop',
    description: 'for each',
    values: { collection: [1, 2] },
    position: at(0, 0),
  })
  return bodyAB(loop, 'body', token)
}

/** Try/Catch whose try section is Log A, Note, Log B; its catch section holds a Log that never prints. */
export function trySection(token: string): NoteGraph {
  const tryCatch = tryCatchNode({ id: IDS.container, description: 'try', enableCatch: true, position: at(0, 0) })
  return bodyAB(tryCatch, 'try', token, [log(IDS.other, lines(token).other, at(2, 1))], [handleEdge(IDS.container, 'catch', IDS.other)])
}

/** Switch whose matching case is Log A, Note, Log B; its default holds a Log that never prints. */
export function switchCase(token: string): NoteGraph {
  const sw = controlNode({
    id: IDS.container,
    label: 'Switch',
    elementType: 'switch-case',
    category: 'conditional',
    description: 'switch',
    values: {
      branches: [
        { id: 'branch_0', type: 'case', label: 'hit', break: true, conditions: [expressionCondition('switch-c0')] },
        { id: 'branch_1', type: 'default', label: 'default' },
      ],
    },
    position: at(0, 0),
  })
  return bodyAB(sw, 'branch_0', token, [log(IDS.other, lines(token).other, at(2, 1))], [handleEdge(IDS.container, 'branch_1', IDS.other)])
}

/** Parallel whose lane 1 is Log A, Note, Log B and whose lane 2 is one Log. */
export function parallelLane(token: string): NoteGraph {
  const lanes = parallelNode({
    id: IDS.container,
    description: 'parallel',
    branches: [
      { id: 'branch_1', name: 'lane 1' },
      { id: 'branch_2', name: 'lane 2' },
    ],
    position: at(0, 0),
  })
  return bodyAB(lanes, 'branch_1', token, [log(IDS.other, lines(token).other, at(2, 1))], [handleEdge(IDS.container, 'branch_2', IDS.other)])
}

/** While `i < 2` (at most 5 rounds) whose body is a Note, then a Setter `i = i + 1`; its then lane logs `count-<i>`. */
export function whileBody(token: string): NoteGraph {
  const text = lines(token)
  const loop = controlNode({
    id: IDS.container,
    label: 'While',
    elementType: 'while',
    category: 'loop',
    description: 'while',
    values: {
      mode: 'while-do',
      conditions: [literalCondition('while-c0', 'i', 'integer', 'less_than', 2)],
      max_iterations: 5,
    },
    position: at(0, 0),
  })
  // The row is an Expression: its place is flagged in expressionFields, as the canvas stores it.
  const inc = controlNode({
    id: IDS.inc,
    label: 'Variable Setter',
    elementType: 'variable-setter',
    category: 'flow',
    description: IDS.inc,
    values: { variables: { i: 'i + 1' } },
    expressionFields: ['variables.i'],
    position: at(1, 2),
  })
  return {
    nodes: [
      loop,
      noteNode(IDS.note, 'Count one round', at(1, 1)),
      inc,
      markerNode({ id: IDS.count, description: IDS.count, expression: `f'count-{i}-${token}'`, position: at(0, 4) }),
      log(IDS.done, text.done, at(0, 5)),
    ],
    edges: [
      { id: `edge-start-${IDS.container}`, source: START_NODE_ID, target: IDS.container },
      handleEdge(IDS.container, 'body', IDS.note),
      edge(IDS.note, IDS.inc),
      handleEdge(IDS.container, 'then', IDS.count),
      edge(IDS.count, IDS.done),
    ],
    variables: { i: { value: 0, type: 'integer', scope: 'test' } },
  }
}

/** For with count 1 whose body is an If/Else that takes its if branch; the untaken else branch is a Note, then a Log. */
export function untakenBranch(token: string): NoteGraph {
  const text = lines(token)
  const loop = controlNode({
    id: IDS.container,
    label: 'For Loop',
    elementType: 'for',
    category: 'loop',
    description: 'for',
    values: { mode: 'count', count: 1, start: 0, end: 0 },
    position: at(0, 0),
  })
  const ifElse = controlNode({
    id: 'if-else',
    label: 'If/Else',
    elementType: 'if-else',
    category: 'conditional',
    description: 'if else',
    values: {
      branches: [
        { type: 'if', id: 'branch_0', label: 'if', conditions: [expressionCondition('if-c0')] },
        { type: 'else', id: 'branch_1', label: 'else' },
      ],
    },
    position: at(1, 1),
  })
  return {
    nodes: [
      loop,
      ifElse,
      log(IDS.taken, text.taken, at(1, 2)),
      noteNode(IDS.note, 'The else branch', at(2, 2)),
      log(IDS.untaken, text.untaken, at(2, 3)),
      log(IDS.done, text.done, at(0, 5)),
    ],
    edges: [
      { id: `edge-start-${IDS.container}`, source: START_NODE_ID, target: IDS.container },
      handleEdge(IDS.container, 'body', 'if-else'),
      handleEdge('if-else', 'branch_0', IDS.taken),
      handleEdge('if-else', 'branch_1', IDS.note),
      edge(IDS.note, IDS.untaken),
      handleEdge(IDS.container, 'then', IDS.done),
    ],
    variables: {},
  }
}

/** For with count 0 whose body is a Note, then a Log: the body never runs. */
export function neverRunBody(token: string): NoteGraph {
  const text = lines(token)
  const loop = controlNode({
    id: IDS.container,
    label: 'For Loop',
    elementType: 'for',
    category: 'loop',
    description: 'for',
    values: { mode: 'count', count: 0, start: 0, end: 0 },
    position: at(0, 0),
  })
  return {
    nodes: [
      loop,
      noteNode(IDS.note, 'The body', at(1, 1)),
      log(IDS.untaken, text.untaken, at(1, 2)),
      log(IDS.done, text.done, at(0, 5)),
    ],
    edges: [
      { id: `edge-start-${IDS.container}`, source: START_NODE_ID, target: IDS.container },
      handleEdge(IDS.container, 'body', IDS.note),
      edge(IDS.note, IDS.untaken),
      handleEdge(IDS.container, 'then', IDS.done),
    ],
    variables: {},
  }
}
