/** Test graph builder for nesting shapes: any container in any slot of any container, at any depth (see functional/nesting/README.md). */

import {
  controlNode,
  delayNode,
  edge,
  handleEdge,
  markerNode,
  parallelNode,
  pluginNode,
  remoteExecutionNode,
  sshSessionOpenNode,
  tryCatchNode,
  type BranchHandle,
  type LogLevel,
  type WorkflowEdge,
  type WorkflowNode,
} from './k8s-nodes'
import { expressionInputs, sharedNode } from './fn-seed'
import {
  SSH_FIXTURE_HOST_SENTINEL,
  SSH_MAIN_PORT,
  SSH_STACK_PASSWORD,
  SSH_STACK_USER,
} from './config'

export const TOKEN_PLACEHOLDER = '__TOKEN__'

const START_NODE_ID = 'start-node'
const DEFAULT_SESSION_VAR = 'nest_sid'
/** For count, For Each length and While iterations when a step sets none. */
export const DEFAULT_LOOP_ITERATIONS = 2
/** Wait Until retry rounds before its condition holds, when a step sets none. */
export const DEFAULT_WAIT_ROUNDS = 1
const WAIT_TIMEOUT_MS = 20_000
const WAIT_INTERVAL_MS = 300
const FUNCTION_NAME_KEY_CHARS = 12

export const CONTAINER_KINDS = [
  'if-else',
  'switch-case',
  'assert-split',
  'for',
  'for-each',
  'while',
  'wait-until',
  'parallel',
  'try-catch',
  'remote-exec',
  'function',
] as const
export type ContainerKind = (typeof CONTAINER_KINDS)[number]

export const SLOT_KINDS = [
  'if-branch',
  'else-branch',
  'case',
  'default',
  'assert-pass',
  'assert-fail',
  'for-body',
  'for-each-body',
  'while-body',
  'wait-until-body',
  'parallel-lane',
  'try',
  'catch',
  'finally',
  'remote-body',
  'function-body',
] as const
export type SlotKind = (typeof SLOT_KINDS)[number]

/** The container kind each slot kind belongs to. */
export const SLOT_CONTAINER: Readonly<Record<SlotKind, ContainerKind>> = {
  'if-branch': 'if-else',
  'else-branch': 'if-else',
  case: 'switch-case',
  default: 'switch-case',
  'assert-pass': 'assert-split',
  'assert-fail': 'assert-split',
  'for-body': 'for',
  'for-each-body': 'for-each',
  'while-body': 'while',
  'wait-until-body': 'wait-until',
  'parallel-lane': 'parallel',
  try: 'try-catch',
  catch: 'try-catch',
  finally: 'try-catch',
  'remote-body': 'remote-exec',
  'function-body': 'function',
}

/** The slot a container's body fills when a step names none. */
export const PRIMARY_SLOT: Readonly<Record<ContainerKind, SlotKind>> = {
  'if-else': 'if-branch',
  'switch-case': 'case',
  'assert-split': 'assert-pass',
  for: 'for-body',
  'for-each': 'for-each-body',
  while: 'while-body',
  'wait-until': 'wait-until-body',
  parallel: 'parallel-lane',
  'try-catch': 'try',
  'remote-exec': 'remote-body',
  function: 'function-body',
}

/** The loop bodies (REQ-3.5.1.15-17): the slots LOOP:120 gives an untaken-branch paint rule. */
export const LOOP_SLOTS: readonly SlotKind[] = ['for-body', 'for-each-body', 'while-body']

/** Containers that run only some of their branches. */
export const BRANCHING_KINDS: readonly ContainerKind[] = ['if-else', 'switch-case', 'assert-split']

/** Diverging controls hand the branch to the main flow and have no `then` (REQ-3.5.0.9). */
const DIVERGING_KINDS: readonly ContainerKind[] = ['if-else', 'assert-split']

export type VarType = 'string' | 'integer' | 'boolean' | 'array' | 'map' | 'table'

/** How a variable crosses a Function boundary: `local` stays, `export` binds out to the Test, `import` binds in from the Test. */
export type VarFlow = 'local' | 'export' | 'import'

export type VarDecl = { name: string; type: VarType; seed: unknown; flow?: VarFlow }

export type NestLeaf = {
  step: 'leaf'
  id: string
  node: WorkflowNode
  vars: VarDecl[]
  /** The Block is meant to write ERROR lines; its Name is its id, so the harness excludes the lines naming it. */
  trigger: boolean
  /** No edge may leave the Block (Halt). */
  terminal: boolean
}

export type ContainerOptions = {
  /** For count, For Each collection length, While iterations, Wait Until retry rounds. */
  iterations?: number
  disabled?: boolean
  /** Assert split and Wait Until `fail_current_scope`. */
  failScope?: boolean
  /** Wait Until: the condition never holds, so the wait runs to its timeout. */
  neverSatisfied?: boolean
  timeoutMs?: number
  join?: 'all' | 'first'
  /** Parallel section time limit. */
  timeLimitMs?: number
  /** Parallel time limit on the lane the body fills. */
  laneTimeLimitMs?: number
  enableCatch?: boolean
  enableFinally?: boolean
  /** Remote Execution: the variable holding the Execution Host session. */
  sessionVar?: string
  /** Loops: bind the index output to this variable. */
  bindIndex?: { name: string; flow?: VarFlow }
  /** For Each: bind the item output to this variable. */
  bindItem?: { name: string; flow?: VarFlow }
  /** For Each: the collection as an expression (a variable name reads the same way), in place of the generated list. */
  collection?: string
  /** For: the count as an expression, in place of `iterations`. */
  countExpression?: string
}

/** Which library Function a Function step's Block runs and its fields; names left out keep the same-name default. */
export type FunctionUse = {
  /** Run the Function published for this earlier Function step instead of publishing a new one (no body). */
  of?: string
  /** Input field name to the expression in the enclosing scope it holds. */
  fields?: Record<string, string>
  /** Output name to the enclosing-scope variable it is assigned to. */
  outputs?: Record<string, string>
}

export type NestContainer = {
  step: 'container'
  kind: ContainerKind
  id: string
  /** The slot `body` fills and the run is routed into. */
  slot: SlotKind
  body: NestStep[]
  /** Explicit chains for other slots; a slot left out gets a generated marker. */
  slots: Partial<Record<SlotKind, NestStep[]>>
  options: ContainerOptions
  /** Parallel: chains for lane 2, 3, ... in place of the generated lane-2 marker. */
  lanes?: NestStep[][]
  /** Function: the Block's library Function and field overrides. */
  uses?: FunctionUse
}

export type NestStep = NestLeaf | NestContainer

/** Readable, unique text a marker Log writes: `<id>-<token>`. */
export function markerText(id: string, token: string): string {
  return `${id}-${token}`
}

/** A variable name derived from a node id (Function parameter names allow no hyphen). */
export function varName(prefix: string, id: string): string {
  return `${prefix}_${id.replace(/[^a-zA-Z0-9]/g, '_')}`
}

/** The node with its id as its Name: engine lines and the console Source name a Block by its Name (EXEC-25, EXEC-26). */
function namedById(node: WorkflowNode): WorkflowNode {
  return { ...node, data: { ...node.data, label: node.id } }
}

/** The same leaf with its id as its Name, for a Block a spec finds by the lines that name it. */
export function named(step: NestLeaf): NestLeaf {
  return { ...step, node: namedById(step.node) }
}

/** Wrap a prepared node as a leaf step; a trigger gets its id as its Name. */
export function leaf(
  node: WorkflowNode,
  opts: { vars?: VarDecl[]; trigger?: boolean; terminal?: boolean } = {},
): NestLeaf {
  return {
    step: 'leaf',
    id: node.id,
    node: opts.trigger ? namedById(node) : node,
    vars: opts.vars ?? [],
    trigger: opts.trigger ?? false,
    terminal: opts.terminal ?? false,
  }
}

/** A Log Block writing `<id>-__TOKEN__`. */
export function marker(id: string, level: LogLevel = 'INFO'): NestLeaf {
  return leaf(markerNode({ id, description: id, text: markerText(id, TOKEN_PLACEHOLDER), level }))
}

export type SetterRow = {
  value: unknown
  /** The value is a Python expression. */
  expression?: boolean
  type: VarType
  seed: unknown
  flow?: VarFlow
}

/** A Variable Setter; every row's variable is declared in the scope it runs in. */
export function setter(id: string, rows: Record<string, SetterRow>): NestLeaf {
  const variables: Record<string, unknown> = {}
  const expressionKeys: string[] = []
  const vars: VarDecl[] = []
  for (const [name, row] of Object.entries(rows)) {
    variables[name] = row.value
    if (row.expression) expressionKeys.push(name)
    vars.push({ name, type: row.type, seed: row.seed, flow: row.flow ?? 'local' })
  }
  return leaf(
    controlNode({
      id,
      label: 'Variable Setter',
      elementType: 'variable-setter',
      category: 'flow',
      description: id,
      values: { variables },
      variableExpressionKeys: expressionKeys,
    }),
    { vars },
  )
}

/** A Block that raises when it runs (a Log evaluating 1/0). */
export function failBlock(id: string): NestLeaf {
  return leaf(
    pluginNode({
      id,
      label: 'Log',
      elementType: 'log',
      category: 'system',
      description: id,
      expressionFields: ['message'],
      values: { message: '1/0', level: 'INFO' },
    }),
    { trigger: true },
  )
}

/** A single-mode Assert that passes or fails; a failure with failScope writes ERROR lines. */
export function assertBlock(id: string, opts: { pass: boolean; failScope?: boolean }): NestLeaf {
  const failScope = opts.failScope ?? false
  return leaf(
    controlNode({
      id,
      label: 'Assert',
      elementType: 'assert',
      category: 'flow',
      description: id,
      values: {
        assertions: [{ type: 'expression', expression: opts.pass ? 'True' : 'False', id: `${id}-a` }],
        mode: 'single',
        fail_current_scope: failScope,
      },
    }),
    { trigger: !opts.pass && failScope },
  )
}

export type HaltScope = 'function' | 'test' | 'suite' | 'regression'
export type HaltStatus = 'passed' | 'failed' | 'skipped'

/** A Halt with a scope and status. No edge may leave it. */
export function halt(id: string, opts: { scope: HaltScope; status: HaltStatus; message?: string }): NestLeaf {
  return leaf(
    controlNode({
      id,
      label: 'Halt',
      elementType: 'halt',
      category: 'flow',
      description: id,
      values: { scope: opts.scope, status: opts.status, message: opts.message ?? `${id} halted` },
    }),
    { terminal: true },
  )
}

/** A Break targeting the loop container with id `targetLoop`. */
export function breakBlock(id: string, targetLoop: string): NestLeaf {
  return leaf(
    controlNode({
      id,
      label: 'Break',
      elementType: 'break',
      category: 'loop',
      description: id,
      values: { target_loop: targetLoop },
    }),
  )
}

/** A Continue targeting the loop container with id `targetLoop`. */
export function continueBlock(id: string, targetLoop: string): NestLeaf {
  return leaf(
    controlNode({
      id,
      label: 'Continue',
      elementType: 'continue',
      category: 'loop',
      description: id,
      values: { target_loop: targetLoop },
    }),
  )
}

/** A Delay control. */
export function delayBlock(id: string, durationMs: number): NestLeaf {
  return leaf(delayNode({ id, description: id, durationMs }))
}

/** A Shell Script Block (runs on WAVE, also inside a Remote Execution body). */
export function shellScript(
  id: string,
  script: string,
  opts: { outputBindings?: Record<string, string>; vars?: VarDecl[] } = {},
): NestLeaf {
  return leaf(
    pluginNode({
      id,
      label: 'Shell Script',
      elementType: 'shell-script',
      category: 'system',
      description: id,
      values: { script_type: 'source', script },
      outputBindings: opts.outputBindings,
    }),
    { vars: opts.vars },
  )
}

/** A remotable host probe: File I/O reads /etc/hostname into `variable` (exported to the Test). */
export function hostProbe(id: string, variable: string): NestLeaf {
  return leaf(
    pluginNode({
      id,
      label: 'File I/O',
      elementType: 'file-io',
      category: 'system',
      description: id,
      values: { operation: 'read', path: '/etc/hostname' },
      outputBindings: { content: variable },
    }),
    { vars: [{ name: variable, type: 'string', seed: 'seed', flow: 'export' }] },
  )
}

/** A container step: `body` fills `slot` (default the kind's primary slot). */
export function container(
  kind: ContainerKind,
  id: string,
  body: NestStep[],
  opts: {
    slot?: SlotKind
    slots?: Partial<Record<SlotKind, NestStep[]>>
    options?: ContainerOptions
    lanes?: NestStep[][]
    uses?: FunctionUse
  } = {},
): NestContainer {
  const slot = opts.slot ?? PRIMARY_SLOT[kind]
  if (SLOT_CONTAINER[slot] !== kind) {
    throw new Error(`slot ${slot} does not belong to a ${kind} container`)
  }
  if (opts.lanes !== undefined && (kind !== 'parallel' || opts.lanes.length === 0)) {
    throw new Error(`lanes need a parallel container and at least one chain (${id})`)
  }
  if (opts.uses !== undefined && kind !== 'function') {
    throw new Error(`uses needs a function container (${id})`)
  }
  const step: NestContainer = { step: 'container', kind, id, slot, body, slots: opts.slots ?? {}, options: opts.options ?? {} }
  if (opts.lanes !== undefined) step.lanes = opts.lanes
  if (opts.uses !== undefined) step.uses = opts.uses
  return step
}

/** The same step, stored disabled (`data.disabled`). */
export function disable<T extends NestStep>(step: T): T {
  if (step.step === 'container') return { ...step, options: { ...step.options, disabled: true } }
  return { ...step, node: { ...step.node, data: { ...step.node.data, disabled: true } } }
}

/** What the builder generated around one container, for the spec's expectations. */
export type ContainerInfo = {
  kind: ContainerKind
  slot: SlotKind
  /** `test` or the key of the Function whose body holds the container. */
  scope: string
  /** Generated markers in slots the run is not routed into: they never run. */
  untaken: string[]
  /** Generated markers in sibling slots that run once per entry (a second lane, a try before finally). */
  siblings: string[]
  /** The generated failing Block that routes a Try/Catch into its catch path. */
  trigger?: string
  /** The generated counter Variable Setter at the tail of a While or Wait Until body. */
  counter?: string
}

export type PublishedFunction = { functionId: string; name: string; version: string }
export type PublishedFunctions = Record<string, PublishedFunction>

export type FunctionPayload = {
  name: string
  description: string
  inputs: Array<Record<string, unknown>>
  outputs: Array<Record<string, unknown>>
  workflow: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
}

export type FunctionPlan = {
  /** The id of the Function container step. */
  key: string
  name: string
  build: (published: PublishedFunctions) => FunctionPayload
}

export type NestingGraphSpec = {
  /** Test name; may carry __TOKEN__. */
  name: string
  chain: NestStep[]
  /** Wrap the whole chain in the try path of a top-level Try/Catch. */
  topTry?: { catchBody?: NestStep[]; finallyBody?: NestStep[] }
}

export type NestingGraph = {
  bookendId: string
  topTryId?: string
  /** One SSH Session Open per Execution Host session variable, at the head of the Test. */
  sshOpenIds: string[]
  /** Publish order: every Function after the Functions its body references. */
  functions: FunctionPlan[]
  containers: Record<string, ContainerInfo>
  /** Every Block meant to write ERROR lines. */
  triggers: string[]
  /** Node ids on the Test's own canvas (not inside a Function body). */
  testNodeIds: string[]
  /** The Test document for POST /tests, still carrying __TOKEN__. */
  fixture: (published: PublishedFunctions) => Record<string, unknown>
}

type NodeThunk = (published: PublishedFunctions) => WorkflowNode
type Exit = { source: string; handle?: BranchHandle }
type Link = { source: string; handle?: BranchHandle }

type Scope = {
  key: string
  depth: number
  nodes: NodeThunk[]
  edges: WorkflowEdge[]
  vars: Map<string, VarDecl>
  nextY: number
}

type BuildState = {
  functions: FunctionPlan[]
  containers: Record<string, ContainerInfo>
  triggers: string[]
  ids: Set<string>
  /** Each published Function step's declared variables, for later steps that use it. */
  signatures: Map<string, VarDecl[]>
}

type SlotPlan = { handle: BranchHandle; steps: NestStep[] }

function newScope(key: string, depth: number): Scope {
  return { key, depth, nodes: [], edges: [], vars: new Map(), nextY: 100 }
}

function declare(scope: Scope, decl: VarDecl): void {
  if (!scope.vars.has(decl.name)) scope.vars.set(decl.name, { ...decl, flow: decl.flow ?? 'local' })
}

function claimId(state: BuildState, id: string): void {
  if (state.ids.has(id)) throw new Error(`duplicate node id ${id}`)
  state.ids.add(id)
}

function place(scope: Scope, node: WorkflowNode, depth: number): WorkflowNode {
  const position = { x: 200 + depth * 320, y: scope.nextY }
  scope.nextY += 100
  return { ...node, position }
}

function link(scope: Scope, from: Link, target: string, targetHandle?: string): void {
  const ingress = targetHandle === undefined ? {} : { targetHandle }
  if (from.handle === undefined) {
    const id = from.source === START_NODE_ID ? `edge-start-${target}` : edge(from.source, target).id
    scope.edges.push({ id, source: from.source, target, ...ingress })
    return
  }
  scope.edges.push({ ...handleEdge(from.source, from.handle, target), ...ingress })
}

/** The value types a literal condition row checks. */
export type CheckValueType = 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'

/** One literal condition row in the shape the condition builder stores; an operator that takes no compare-to value gets null. */
export function literalCondition(
  id: string,
  variable: string,
  valueType: CheckValueType,
  operator: string,
  reference: string | number | null,
): Record<string, unknown> {
  return {
    type: 'literal',
    variable,
    value_type: valueType,
    operator,
    reference_value: reference === null ? null : String(reference),
    reference_is_expression: false,
    id,
  }
}

function expressionCondition(id: string, holds: boolean): Record<string, unknown> {
  return { type: 'expression', expression: holds ? 'True' : 'False', id }
}

function counterSetter(id: string, counter: string): NestLeaf {
  return setter(`${id}-count`, {
    [counter]: { value: `${counter} + 1`, expression: true, type: 'integer', seed: 0 },
  })
}

/** Untaken / sibling marker for a slot the body does not fill. */
function slotOrMarker(
  c: NestContainer,
  slot: SlotKind,
  markerId: string,
  bucket: string[],
): NestStep[] {
  const explicit = c.slots[slot]
  if (explicit) return explicit
  bucket.push(markerId)
  return [marker(markerId)]
}

function bindingsOf(scope: Scope, c: NestContainer, index: boolean, item: boolean): Record<string, string> {
  const bindings: Record<string, string> = {}
  if (index && c.options.bindIndex) {
    bindings.index = c.options.bindIndex.name
    declare(scope, { name: c.options.bindIndex.name, type: 'integer', seed: 0, flow: c.options.bindIndex.flow })
  }
  if (item && c.options.bindItem) {
    bindings.item = c.options.bindItem.name
    declare(scope, { name: c.options.bindItem.name, type: 'map', seed: {}, flow: c.options.bindItem.flow })
  }
  return bindings
}

/** The container node plus the chain each of its handles leads into. */
function planContainer(scope: Scope, c: NestContainer, info: ContainerInfo): { node: WorkflowNode; slots: SlotPlan[] } {
  const o = c.options
  const base = { id: c.id, description: c.id, disabled: o.disabled }
  switch (c.kind) {
    case 'if-else': {
      const ifTaken = c.slot === 'if-branch'
      const ifSteps = ifTaken ? c.body : slotOrMarker(c, 'if-branch', `${c.id}-if`, info.untaken)
      const elseSteps = ifTaken ? slotOrMarker(c, 'else-branch', `${c.id}-else`, info.untaken) : c.body
      return {
        node: controlNode({
          ...base,
          label: 'If/Else',
          elementType: 'if-else',
          category: 'conditional',
          values: {
            branches: [
              { type: 'if', id: 'branch_0', label: 'if', conditions: [expressionCondition(`${c.id}-c0`, ifTaken)] },
              { type: 'else', id: 'branch_1', label: 'else' },
            ],
          },
        }),
        slots: [
          { handle: 'branch_0', steps: ifSteps },
          { handle: 'branch_1', steps: elseSteps },
        ],
      }
    }
    case 'switch-case': {
      const caseTaken = c.slot === 'case'
      const branches: Array<Record<string, unknown>> = []
      const slots: SlotPlan[] = []
      if (caseTaken) {
        branches.push(
          { id: 'branch_0', type: 'case', label: 'hit', break: true, conditions: [expressionCondition(`${c.id}-c0`, true)] },
          { id: 'branch_1', type: 'case', label: 'miss', break: true, conditions: [expressionCondition(`${c.id}-c1`, false)] },
          { id: 'branch_2', type: 'default', label: 'default' },
        )
        slots.push(
          { handle: 'branch_0', steps: c.body },
          { handle: 'branch_1', steps: [marker(`${c.id}-case-miss`)] },
          { handle: 'branch_2', steps: slotOrMarker(c, 'default', `${c.id}-default`, info.untaken) },
        )
        info.untaken.unshift(`${c.id}-case-miss`)
      } else {
        branches.push(
          { id: 'branch_0', type: 'case', label: 'miss', break: true, conditions: [expressionCondition(`${c.id}-c0`, false)] },
          { id: 'branch_1', type: 'default', label: 'default' },
        )
        slots.push(
          { handle: 'branch_0', steps: slotOrMarker(c, 'case', `${c.id}-case`, info.untaken) },
          { handle: 'branch_1', steps: c.body },
        )
      }
      return {
        node: controlNode({
          ...base,
          label: 'Switch',
          elementType: 'switch-case',
          category: 'conditional',
          values: { branches },
        }),
        slots,
      }
    }
    case 'assert-split': {
      const passTaken = c.slot === 'assert-pass'
      const failScope = o.failScope ?? false
      if (!passTaken && failScope) info.trigger = c.id
      return {
        node: controlNode({
          ...base,
          label: 'Assert',
          elementType: 'assert',
          category: 'flow',
          values: {
            assertions: [expressionCondition(`${c.id}-a`, passTaken)],
            mode: 'split',
            fail_current_scope: failScope,
          },
        }),
        slots: [
          { handle: 'pass', steps: passTaken ? c.body : slotOrMarker(c, 'assert-pass', `${c.id}-pass`, info.untaken) },
          { handle: 'fail', steps: passTaken ? slotOrMarker(c, 'assert-fail', `${c.id}-fail`, info.untaken) : c.body },
        ],
      }
    }
    case 'for':
      return {
        node: controlNode({
          ...base,
          label: 'For Loop',
          elementType: 'for',
          category: 'loop',
          values: { mode: 'count', count: o.countExpression ?? o.iterations ?? DEFAULT_LOOP_ITERATIONS, start: 0, end: 0 },
          expressionFields: o.countExpression === undefined ? [] : ['count'],
          outputBindings: bindingsOf(scope, c, true, false),
        }),
        slots: [{ handle: 'body', steps: c.body }],
      }
    case 'for-each': {
      const length = o.iterations ?? DEFAULT_LOOP_ITERATIONS
      return {
        node: controlNode({
          ...base,
          label: 'ForEach',
          elementType: 'for-each',
          category: 'loop',
          values: { collection: o.collection ?? Array.from({ length }, (_, i) => `item${i}`) },
          expressionFields: o.collection === undefined ? [] : ['collection'],
          outputBindings: bindingsOf(scope, c, true, true),
        }),
        slots: [{ handle: 'body', steps: c.body }],
      }
    }
    case 'while': {
      const iterations = o.iterations ?? DEFAULT_LOOP_ITERATIONS
      const counter = varName('n', c.id)
      const tail = counterSetter(c.id, counter)
      info.counter = tail.id
      return {
        node: controlNode({
          ...base,
          label: 'While',
          elementType: 'while',
          category: 'loop',
          values: {
            mode: 'while-do',
            conditions: [literalCondition(`${c.id}-c0`, counter, 'integer', 'less_than', iterations)],
            max_iterations: iterations + 3,
          },
          outputBindings: bindingsOf(scope, c, true, false),
        }),
        slots: [{ handle: 'body', steps: [...c.body, tail] }],
      }
    }
    case 'wait-until': {
      const counter = varName('n', c.id)
      const tail = counterSetter(c.id, counter)
      info.counter = tail.id
      const failScope = o.failScope ?? false
      if (o.neverSatisfied && failScope) info.trigger = c.id
      const reference = o.neverSatisfied ? -1 : (o.iterations ?? DEFAULT_WAIT_ROUNDS)
      return {
        node: controlNode({
          ...base,
          label: 'Wait Until',
          elementType: 'wait-until',
          category: 'timing',
          values: {
            conditions: [literalCondition(`${c.id}-c0`, counter, 'integer', 'equals', reference)],
            timeout: o.timeoutMs ?? WAIT_TIMEOUT_MS,
            check_interval: WAIT_INTERVAL_MS,
            message: `${c.id} gave up`,
            mode: 'retry',
            fail_current_scope: failScope,
          },
        }),
        slots: [{ handle: 'retry', steps: [...c.body, tail] }],
      }
    }
    case 'parallel': {
      const lane = { id: 'branch_1', name: 'lane 1', timeLimitMs: o.laneTimeLimitMs }
      const others = c.lanes ?? [[marker(`${c.id}-lane-2`)]]
      const node = parallelNode({
        ...base,
        branches: [lane, ...others.map((_, i) => ({ id: `branch_${i + 2}`, name: `lane ${i + 2}` }))],
        join: o.join,
        timeLimitMs: o.timeLimitMs,
      })
      if (o.disabled) node.data.disabled = true
      if (c.lanes === undefined) info.siblings.push(`${c.id}-lane-2`)
      const otherSlots: SlotPlan[] = others.map((steps, i) => ({ handle: `branch_${i + 2}`, steps }))
      return {
        node,
        slots: [{ handle: 'branch_1', steps: c.body }, ...otherSlots],
      }
    }
    case 'try-catch': {
      const enableCatch = o.enableCatch ?? true
      const enableFinally = o.enableFinally ?? (c.slot === 'finally' || c.slots.finally !== undefined)
      const node = tryCatchNode({ ...base, enableCatch, enableFinally })
      if (o.disabled) node.data.disabled = true
      const slots: SlotPlan[] = []
      if (c.slot === 'try') {
        slots.push({ handle: 'try', steps: c.body })
      } else if (c.slot === 'catch') {
        const explicit = c.slots.try
        if (!explicit) info.trigger = `${c.id}-trigger`
        slots.push({ handle: 'try', steps: explicit ?? [failBlock(`${c.id}-trigger`)] })
      } else {
        slots.push({ handle: 'try', steps: slotOrMarker(c, 'try', `${c.id}-try`, info.siblings) })
      }
      if (enableCatch) {
        slots.push({
          handle: 'catch',
          steps: c.slot === 'catch' ? c.body : slotOrMarker(c, 'catch', `${c.id}-catch`, info.untaken),
        })
      }
      if (enableFinally) {
        slots.push({
          handle: 'finally',
          steps: c.slot === 'finally' ? c.body : slotOrMarker(c, 'finally', `${c.id}-finally`, info.siblings),
        })
      }
      return { node, slots }
    }
    case 'remote-exec': {
      const sessionVar = o.sessionVar ?? DEFAULT_SESSION_VAR
      declare(scope, { name: sessionVar, type: 'string', seed: '', flow: 'import' })
      const node = remoteExecutionNode({
        ...base,
        values: { session_id: sessionVar },
        expressionFields: ['session_id'],
      })
      if (o.disabled) node.data.disabled = true
      return { node, slots: [{ handle: 'body', steps: c.body }] }
    }
    case 'function':
      throw new Error('a Function container is emitted by emitFunction')
  }
}

function functionName(index: number, key: string): string {
  return `nf${index}-${key.slice(0, FUNCTION_NAME_KEY_CHARS)}-${TOKEN_PLACEHOLDER}`
}

/** Publish the Function a Function step defines; returns its declared variables. */
function publishFunction(state: BuildState, c: NestContainer): VarDecl[] {
  const fnScope = newScope(c.id, 0)
  emitChain(state, fnScope, c.body, { source: START_NODE_ID })
  const decls = [...fnScope.vars.values()]

  const inputs: Array<Record<string, unknown>> = []
  const outputs: Array<Record<string, unknown>> = []
  for (const decl of decls) {
    if (decl.flow === 'import') inputs.push({ name: decl.name, type: decl.type, required: true })
    else outputs.push({ name: decl.name, type: decl.type, default: decl.seed })
  }

  const name = functionName(state.functions.length + 1, c.id)
  const nodes = fnScope.nodes
  const edges = fnScope.edges
  state.functions.push({
    key: c.id,
    name,
    build: (published) => ({
      name,
      description: `Nesting sweep Function ${c.id}`,
      inputs,
      outputs,
      workflow: { nodes: nodes.map((thunk) => thunk(published)), edges },
    }),
  })
  state.signatures.set(c.id, decls)
  return decls
}

function usedSignature(state: BuildState, c: NestContainer, of: string): VarDecl[] {
  if (c.body.length > 0) throw new Error(`Function step ${c.id} uses ${of} and cannot hold a body`)
  const decls = state.signatures.get(of)
  if (!decls) throw new Error(`Function step ${c.id} uses ${of}, which is not emitted before it`)
  return decls
}

function emitFunction(state: BuildState, scope: Scope, c: NestContainer): { node: NodeThunk; exits: Exit[] } {
  const use = c.uses ?? {}
  const decls = use.of === undefined ? publishFunction(state, c) : usedSignature(state, c, use.of)

  const fields: Record<string, string> = {}
  const outputBindings: Record<string, string> = {}
  for (const decl of decls) {
    if (decl.flow === 'import') {
      const given = use.fields?.[decl.name]
      fields[decl.name] = given ?? decl.name
      if (given === undefined) declare(scope, decl)
      continue
    }
    const target = use.outputs?.[decl.name] ?? (decl.flow === 'export' ? decl.name : undefined)
    if (target !== undefined) {
      outputBindings[decl.name] = target
      declare(scope, target === decl.name ? decl : { ...decl, name: target })
    }
  }
  state.containers[c.id] = { kind: 'function', slot: 'function-body', scope: scope.key, untaken: [], siblings: [] }

  const libraryKey = use.of ?? c.id
  const depth = scope.depth
  const y = scope.nextY
  scope.nextY += 100
  const thunk: NodeThunk = (published) => {
    const fn = published[libraryKey]
    if (!fn) throw new Error(`Function ${libraryKey} was not published`)
    const node = sharedNode(c.id, {
      functionId: fn.functionId,
      functionVersion: fn.version,
      label: fn.name,
      originalLibraryName: fn.name,
      ...expressionInputs(fields),
      disabled: c.options.disabled,
      position: { x: 200 + depth * 320, y },
    }) as unknown as WorkflowNode
    node.data.description = c.id
    ;(node.data.config as Record<string, unknown>).outputBindings = { ...outputBindings }
    return node
  }
  return { node: thunk, exits: [{ source: c.id }] }
}

function emitContainer(state: BuildState, scope: Scope, c: NestContainer, from: Link): Exit[] {
  claimId(state, c.id)
  if (c.kind === 'function') {
    const { node, exits } = emitFunction(state, scope, c)
    scope.nodes.push(node)
    link(scope, from, c.id)
    return exits
  }
  const info: ContainerInfo = { kind: c.kind, slot: c.slot, scope: scope.key, untaken: [], siblings: [] }
  state.containers[c.id] = info
  const { node, slots } = planContainer(scope, c, info)
  if (info.trigger) state.triggers.push(info.trigger)
  // A container that is its own trigger gets its id as its Name, as a trigger leaf does.
  const placed = place(scope, info.trigger === c.id ? namedById(node) : node, scope.depth)
  scope.nodes.push(() => placed)
  link(scope, from, c.id)

  const inner: Scope = scope
  const savedDepth = scope.depth
  inner.depth = savedDepth + 1
  const branchExits: Exit[] = []
  for (const plan of slots) {
    const exits = emitChain(state, inner, plan.steps, { source: c.id, handle: plan.handle })
    branchExits.push(...(plan.steps.length === 0 ? [{ source: c.id, handle: plan.handle }] : exits))
  }
  inner.depth = savedDepth

  return DIVERGING_KINDS.includes(c.kind) ? branchExits : [{ source: c.id, handle: 'then' }]
}

function emitLeaf(state: BuildState, scope: Scope, step: NestLeaf, from: Link): Exit[] {
  claimId(state, step.id)
  for (const decl of step.vars) declare(scope, decl)
  if (step.trigger) state.triggers.push(step.id)
  const placed = place(scope, step.node, scope.depth)
  scope.nodes.push(() => placed)
  link(scope, from, step.id)
  return step.terminal ? [] : [{ source: step.id }]
}

/** Emit a chain; `from` links into its first step. Returns the last step's exits. */
function emitChain(state: BuildState, scope: Scope, steps: readonly NestStep[], from: Link): Exit[] {
  let incoming: Link[] = [from]
  for (const step of steps) {
    if (incoming.length === 0) throw new Error(`step ${step.id} follows a step no edge may leave`)
    const [first, ...rejoins] = incoming
    const exits =
      step.step === 'leaf'
        ? emitLeaf(state, scope, step, first)
        : emitContainer(state, scope, step, first)
    // Each rejoin lands on its own ingress handle, as the canvas draws it; a shared handle is cut at save.
    rejoins.forEach((source, i) => link(scope, source, step.id, `ingress_${i + 1}`))
    incoming = exits
  }
  return incoming
}

function collectSessionVars(steps: readonly NestStep[], into: Set<string>): void {
  for (const step of steps) {
    if (step.step === 'leaf') continue
    if (step.kind === 'remote-exec') into.add(step.options.sessionVar ?? DEFAULT_SESSION_VAR)
    collectSessionVars(step.body, into)
    for (const chain of Object.values(step.slots)) if (chain) collectSessionVars(chain, into)
    for (const chain of step.lanes ?? []) collectSessionVars(chain, into)
  }
}

function sshOpenStep(sessionVar: string): NestLeaf {
  const id = `nest-ssh-${sessionVar.replace(/[^a-zA-Z0-9]/g, '-')}`
  return leaf(
    sshSessionOpenNode({
      id,
      description: id,
      values: {
        host: SSH_FIXTURE_HOST_SENTINEL,
        port: Number(SSH_MAIN_PORT),
        username: SSH_STACK_USER,
        password: SSH_STACK_PASSWORD,
        host_key_verification: 'disabled',
        connect_timeout: 30,
      },
      outputBindings: { session_id: sessionVar },
    }),
    { vars: [{ name: sessionVar, type: 'string', seed: '', flow: 'local' }] },
  )
}

/** Build the Test and the Functions it references. */
export function buildNestingGraph(spec: NestingGraphSpec): NestingGraph {
  const state: BuildState = { functions: [], containers: {}, triggers: [], ids: new Set(), signatures: new Map() }
  const testScope = newScope('test', 0)

  const sessionVars = new Set<string>()
  collectSessionVars(spec.chain, sessionVars)
  if (spec.topTry) {
    collectSessionVars(spec.topTry.catchBody ?? [], sessionVars)
    collectSessionVars(spec.topTry.finallyBody ?? [], sessionVars)
  }
  const opens = [...sessionVars].map(sshOpenStep)

  const topTryId = spec.topTry ? 'nest-top-try' : undefined
  const body: NestStep[] = spec.topTry
    ? [
        container('try-catch', 'nest-top-try', spec.chain, {
          slots: {
            ...(spec.topTry.catchBody ? { catch: spec.topTry.catchBody } : {}),
            ...(spec.topTry.finallyBody ? { finally: spec.topTry.finallyBody } : {}),
          },
        }),
      ]
    : spec.chain
  const bookendId = 'nest-done'
  emitChain(state, testScope, [...opens, ...body, marker(bookendId)], { source: START_NODE_ID })

  const testNodes = testScope.nodes
  const testEdges = testScope.edges
  const variables: Record<string, unknown> = {}
  for (const decl of testScope.vars.values()) {
    variables[decl.name] = { value: decl.seed, type: decl.type, scope: 'test' }
  }

  return {
    bookendId,
    topTryId,
    sshOpenIds: opens.map((o) => o.id),
    functions: state.functions,
    containers: state.containers,
    triggers: [...new Set(state.triggers)],
    testNodeIds: testNodes.map((thunk) => thunk({ ...stubPublished(state.functions) }).id),
    fixture: (published) => ({
      name: spec.name,
      version: '1.0.0',
      description: 'Nesting sweep cell',
      workflow: { nodes: testNodes.map((thunk) => thunk(published)), edges: testEdges },
      variables,
      metadata: { tags: [], suite_id: null, parent_suite: null },
    }),
  }
}

function stubPublished(functions: readonly FunctionPlan[]): PublishedFunctions {
  const stub: PublishedFunctions = {}
  for (const fn of functions) stub[fn.key] = { functionId: 'unpublished', name: fn.name, version: '1.0.0' }
  return stub
}
