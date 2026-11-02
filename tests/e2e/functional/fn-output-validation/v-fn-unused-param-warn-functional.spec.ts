/**
 * V-FN-UNUSED-PARAM-WARN: each call of a Function warns in the run console about an input no block uses
 * and an output no block writes
 * Wireframe: none (functional)
 * Design Decisions: FNCFG-5, VMGR-99
 * REQ: REQ-3.1.2.7, REQ-3.1.2.8
 *
 * Seeds (API): one blank `zz-` Test per test (`createValidTest`); the refused-call tests also declare
 * the variable `nothing` holding null. Local tests build everything else through the UI: the Function
 * dragged from the palette, its parameters and locals made with the Add menu, the body blocks dropped
 * while drilled in, the nested Function bound in its call window, the muted block muted from its
 * context menu. Library tests publish the same body with `publishLibraryFunction` and call it from a
 * seeded Shared block; Nested tests seed it as a Local Function inside a seeded Local Function. Each
 * Local test first proves the body the UI stored equals the body the Library and Nested tests seed.
 *
 * Pass Criteria:
 * 1. Each call prints one WARN `Function '<name>' declares input '<input>' but no block uses it` per
 *    input no unmuted block reads and one WARN `Function '<name>' declares output '<output>' but no
 *    block writes it` per output no unmuted block writes, source FUNCTION, inputs then outputs in
 *    declaration order, and no other such line.
 * 2. No line names an input read by an expression setting, a template setting, a map entry, a reference
 *    setting (For Each collection), a Variable Setter row, a condition row of Assert, If/Else, Switch,
 *    While or Wait Until, a nested call binding, a Function-local Expression or Template variable, or an
 *    Expression or Template output; an input read only by a muted block warns.
 * 3. No line names an output written by a call output binding, a Variable Setter row or its Expression or
 *    Template kind; an output nothing writes and an output written only by a muted block warn.
 * 4. The lines print when the call starts: after `Entering Function '<name>'` and before the body's first
 *    line, once per call; a call inside a For with count 3 prints them three times, each set before its
 *    own body line.
 * 5. They print also when the call is refused before the body (a Required input given null fails the call
 *    with `'req' is null` and no body line) and when the body fails.
 * 6. Every criterion holds for a Local Function, a library Function and a Function nested in a Function.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  dragPaletteItemToCanvas,
  dragSourceToCanvas,
  expandPalette,
  waitForViewportSettled,
  type PaletteDragSpec,
} from '../../helpers/canvas'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  addLiteralRow,
  CHECK_BLOCK_PALETTE,
  openConditionBody,
  pickConditionVariable,
  pickOperator,
  setWaitTiming,
  type ConditionBlock,
} from '../../helpers/condition-builder'
import { bindOutput, numberInput, pickVariableRef, setRowExpression } from '../../helpers/config-sheet'
import { saveAndCloseSheet, valueSheet } from '../../helpers/element-types'
import {
  createValidTest,
  expressionInputs,
  localFunctionNode,
  publishLibraryFunction,
  setFunctionFields,
  sharedNode,
} from '../../helpers/fn-seed'
import {
  controlNode,
  edge,
  handleEdge,
  pluginNode,
  stackNodes,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../helpers/k8s-nodes'
import { escapeRegExp, expectLineBefore, formatEntries, getLogCopyTexts, type LogEntry } from '../../helpers/log-reader'
import { openStringParamSheet, setStringParam } from '../../helpers/param-config'
import { expandButton } from '../../helpers/value-field'
import { createDeclaration } from '../../helpers/variable-create'
import {
  breadcrumbFunctionSegments,
  digIn,
  disableNode,
  dropBelowStart,
  openFunctionBlockSheet,
  popToBreadcrumbSegment,
  runToEnd,
} from '../../helpers/workbench'
import {
  LANE_VIEWPORT,
  canvasNodeIds,
  deleteTest,
  edgeOnCanvas,
  laneDot,
  openConfig,
  openLaneCanvas,
  saveCanvas,
  saveConfig,
  setLogText,
} from '../canvas-lanes/lanes-helpers'
import { consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'

test.use({ viewport: LANE_VIEWPORT })

const RUN = randomUUID().slice(0, 8)
const NEW_FUNCTION = '[data-testid="palette-new-block-button"]'
const SHELL_EXEC: PaletteDragSpec = { term: 'shell exec', testId: 'palette-item-shell-exec' }
const SETTER: PaletteDragSpec = { term: 'var setter', testId: 'palette-item-variable-setter' }
const DECLARES = /^Function '.*' declares (input|output) '.*' but no block (uses|writes) it$/

// ---------------------------------------------------------------------------
// Messages (blueprint-backend.md section 2.4)
// ---------------------------------------------------------------------------

/** The run-log WARN for an input no block uses (REQ-3.1.2.7). */
function unusedInput(fn: string, input: string): string {
  return `Function '${fn}' declares input '${input}' but no block uses it`
}

/** The run-log WARN for an output no block writes (REQ-3.1.2.7). */
function unwrittenOutput(fn: string, output: string): string {
  return `Function '${fn}' declares output '${output}' but no block writes it`
}

// ---------------------------------------------------------------------------
// The Function bodies each group runs, as the UI stores them
// ---------------------------------------------------------------------------

type Decl = Record<string, unknown>

interface FunctionShape {
  inputs: Decl[]
  outputs: Decl[]
  variables: Decl[]
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

/** A string input made in the window with nothing typed: it holds the type default, never null. */
function input(name: string, extra: Decl = {}): Decl {
  return { name, type: 'string', default: '', required: false, ...extra }
}

function output(name: string, extra: Decl = {}): Decl {
  return { name, type: 'string', default: '', ...extra }
}

function local(name: string, extra: Decl = {}): Decl {
  return { name, type: 'string', value: '', ...extra }
}

function logBlock(id: string, message: string, kind: 'literal' | 'expression' | 'template' = 'literal'): WorkflowNode {
  return pluginNode({
    id,
    label: 'Log',
    elementType: 'log',
    category: 'system',
    values: { message },
    expressionFields: kind === 'expression' ? ['message'] : [],
    templateFields: kind === 'template' ? ['message'] : [],
  })
}

function shellExecBlock(id: string, command: string, env: Record<string, string>): WorkflowNode {
  return pluginNode({
    id,
    label: 'Shell Exec',
    elementType: 'shell-exec',
    category: 'system',
    values: { command, env_vars: env },
    expressionFields: Object.keys(env).map((key) => `env_vars.${key}`),
  })
}

function forEachBlock(id: string, collection: string): WorkflowNode {
  return controlNode({ id, label: 'For Each', elementType: 'for-each', category: 'loop', description: '', values: { collection } })
}

function setterBlock(id: string, rows: Record<string, string>): WorkflowNode {
  return controlNode({
    id,
    label: 'Variable Setter',
    elementType: 'variable-setter',
    category: 'flow',
    description: '',
    values: { variables: rows },
    variableExpressionKeys: Object.keys(rows),
  })
}

/** A literal condition row that takes no compare-to value. */
function nullRow(variable: string, operator: 'is_null' | 'is_not_null'): Record<string, unknown> {
  return {
    type: 'literal',
    variable,
    value_type: 'string',
    operator,
    reference_value: null,
    reference_is_expression: false,
  }
}

function checkBlock(id: string, block: ConditionBlock, row: Record<string, unknown>): WorkflowNode {
  switch (block) {
    case 'assert':
      return controlNode({ id, label: 'Assert', elementType: 'assert', category: 'flow', description: '', values: { assertions: [row] } })
    case 'wait-until':
      return controlNode({
        id,
        label: 'Wait Until',
        elementType: 'wait-until',
        category: 'timing',
        description: '',
        values: { conditions: [row], mode: 'retry', timeout: 1000, check_interval: 300 },
      })
    case 'while':
      return controlNode({ id, label: 'While Loop', elementType: 'while', category: 'loop', description: '', values: { conditions: [row] } })
    case 'switch':
      return controlNode({
        id,
        label: 'Switch/Case',
        elementType: 'switch-case',
        category: 'conditional',
        description: '',
        values: { branches: [{ id: 'branch_0', type: 'case', label: '', conditions: [row], break: true }] },
      })
    case 'if-else':
      return controlNode({
        id,
        label: 'If/Else',
        elementType: 'if-else',
        category: 'conditional',
        description: '',
        values: {
          branches: [
            { id: 'branch_0', type: 'if', label: '', conditions: [row] },
            { id: 'branch_1', type: 'else', label: '' },
          ],
        },
      })
  }
}

function muted(node: WorkflowNode): WorkflowNode {
  node.data.disabled = true
  return node
}

/** The nested Function of the settings and declarations bodies: `n` is read by `r`, an Expression output. */
const NESTED: Pick<FunctionShape, 'inputs' | 'outputs'> = {
  inputs: [input('n')],
  outputs: [output('r', { default: 'n', isExpression: true })],
}

function nestedFunction(id: string, bind: { input?: string; output?: string }): WorkflowNode {
  const node = localFunctionNode(id, 'Nested', { ...NESTED, nodes: [], edges: [] }) as unknown as WorkflowNode
  setFunctionFields(node, expressionInputs(bind.input ? { n: bind.input } : {}))
  ;(node.data.config as Record<string, unknown>).outputBindings = bind.output ? { r: bind.output } : {}
  return node
}

function body(nodes: WorkflowNode[], edges: WorkflowEdge[]): Pick<FunctionShape, 'nodes' | 'edges'> {
  return { nodes: stackNodes(nodes, { x: 200, startY: 120, step: 90 }), edges }
}

function startLink(target: string): WorkflowEdge {
  return { id: `edge-start-${target}`, source: 'start-node', target }
}

// ---------------------------------------------------------------------------
// The six groups of matrix 5a
// ---------------------------------------------------------------------------

interface UiBuild {
  /** The name the breadcrumb gives the Function under test, to come back to it from a nested one. */
  fnName: string
}

interface WarnGroup {
  key: string
  title: string
  shape: () => FunctionShape
  /** Inputs and outputs each call warns about, in declaration order. */
  warnInputs: string[]
  warnOutputs: string[]
  /** The line each call's WARN lines come before: the body's first line, or the refusal. */
  after: string | RegExp
  verdict: 'passed' | 'failed'
  calls: number
  /** Caller input bindings. */
  bindings?: Record<string, string>
  /** The caller declares `nothing` holding null. */
  nothingVariable?: boolean
  /** The call sits in a For with count 3. */
  loop?: boolean
  /** Build the body through the UI while drilled in; returns each generated block id -> the UI block id. */
  buildBody: (page: Page, ui: UiBuild) => Promise<Record<string, string>>
}

const SETTINGS: WarnGroup = {
  key: 'settings',
  title: 'inputs read by block settings',
  shape: () => ({
    inputs: [
      input('in_unread'),
      input('in_expr'),
      input('in_tmpl'),
      input('in_map'),
      input('in_ref', { type: 'array', default: [] }),
      input('in_setter'),
      input('in_nested'),
      input('in_muted'),
    ],
    outputs: [],
    variables: [local('sink')],
    ...body(
      [
        logBlock('s-log-expr', "'G1 body' + in_expr", 'expression'),
        logBlock('s-log-tmpl', 'tmpl {{ in_tmpl }}', 'template'),
        shellExecBlock('s-shell', 'echo map', { V: 'in_map' }),
        forEachBlock('s-for-each', 'in_ref'),
        setterBlock('s-setter', { sink: 'in_setter' }),
        nestedFunction('s-nested', { input: 'in_nested' }),
        muted(logBlock('s-muted', 'in_muted', 'expression')),
      ],
      [
        startLink('s-log-expr'),
        edge('s-log-expr', 's-log-tmpl'),
        edge('s-log-tmpl', 's-shell'),
        edge('s-shell', 's-for-each'),
        handleEdge('s-for-each', 'then', 's-setter'),
        edge('s-setter', 's-nested'),
        edge('s-nested', 's-muted'),
      ],
    ),
  }),
  warnInputs: ['in_unread', 'in_muted'],
  warnOutputs: [],
  after: 'G1 body',
  verdict: 'passed',
  calls: 1,
  buildBody: async (page, ui) => {
    const logExpr = await dropUnder(page, null, null, 'log')
    await configureLog(page, logExpr, 'expression', "'G1 body' + in_expr")
    const logTmpl = await dropUnder(page, logExpr, null, 'log')
    await configureLog(page, logTmpl, 'template', 'tmpl {{ in_tmpl }}')
    const shell = await dropUnder(page, logTmpl, null, SHELL_EXEC)
    await configureShellExec(page, shell, 'echo map', 'V', 'in_map')
    const forEach = await dropUnder(page, shell, null, 'for each')
    await configureForEach(page, forEach, 'in_ref')
    const setter = await dropUnder(page, forEach, 'then', SETTER)
    await configureSetter(page, setter, 'sink', 'in_setter')
    const nested = await addNestedFunction(page, setter, ui.fnName, { input: 'in_nested' })
    const mutedLog = await dropUnder(page, nested, null, 'log')
    await configureLog(page, mutedLog, 'expression', 'in_muted')
    await disableNode(page, mutedLog)
    return {
      's-log-expr': logExpr,
      's-log-tmpl': logTmpl,
      's-shell': shell,
      's-for-each': forEach,
      's-setter': setter,
      's-nested': nested,
      's-muted': mutedLog,
    }
  },
}

/** Check blocks in chain order, each with the operator it uses and the lane the chain leaves it by. */
const CHECKS: ReadonlyArray<{
  id: string
  block: ConditionBlock
  variable: string
  operator: 'is_null' | 'is_not_null'
  exit: 'pass' | 'then' | null
}> = [
  { id: 'c-assert', block: 'assert', variable: 'in_assert', operator: 'is_not_null', exit: 'pass' },
  { id: 'c-wait', block: 'wait-until', variable: 'in_wait', operator: 'is_not_null', exit: 'then' },
  { id: 'c-while', block: 'while', variable: 'in_while', operator: 'is_null', exit: 'then' },
  { id: 'c-switch', block: 'switch', variable: 'in_switch', operator: 'is_not_null', exit: 'then' },
  { id: 'c-if', block: 'if-else', variable: 'in_if', operator: 'is_not_null', exit: null },
]

const OPERATOR_LABEL = { is_null: 'is null', is_not_null: 'not null' } as const

const CONDITIONS: WarnGroup = {
  key: 'conditions',
  title: 'inputs read by condition rows',
  shape: () => {
    const edges: WorkflowEdge[] = [startLink('c-log'), edge('c-log', CHECKS[0].id)]
    for (let i = 1; i < CHECKS.length; i++) {
      const from = CHECKS[i - 1]
      edges.push(from.exit ? handleEdge(from.id, from.exit, CHECKS[i].id) : edge(from.id, CHECKS[i].id))
    }
    return {
      inputs: [input('in_unread'), ...CHECKS.map((check) => input(check.variable))],
      outputs: [],
      variables: [],
      ...body(
        [logBlock('c-log', 'G2 body'), ...CHECKS.map((check) => checkBlock(check.id, check.block, nullRow(check.variable, check.operator)))],
        edges,
      ),
    }
  },
  warnInputs: ['in_unread'],
  warnOutputs: [],
  after: 'G2 body',
  verdict: 'passed',
  calls: 1,
  buildBody: async (page) => {
    const ids: Record<string, string> = {}
    ids['c-log'] = await dropUnder(page, null, null, 'log')
    await setLogText(page, ids['c-log'], 'G2 body')
    let previous = ids['c-log']
    let lane: string | null = null
    for (const check of CHECKS) {
      ids[check.id] = await dropUnder(page, previous, lane, CHECK_BLOCK_PALETTE[check.block])
      await configureCheck(page, ids[check.id], check.block, check.variable, OPERATOR_LABEL[check.operator])
      previous = ids[check.id]
      lane = check.exit
    }
    return ids
  },
}

const DECLARATIONS: WarnGroup = {
  key: 'declarations',
  title: 'inputs read by Function declarations, outputs written by blocks and kinds',
  shape: () => ({
    inputs: [input('in_local_e'), input('in_local_t'), input('in_out_expr'), input('in_out_tmpl')],
    outputs: [
      output('out_none'),
      output('out_call'),
      output('out_setter'),
      output('out_expr', { default: 'in_out_expr', isExpression: true }),
      output('out_tmpl', { default: 't-{{ in_out_tmpl }}', isTemplate: true }),
      output('out_muted'),
    ],
    variables: [
      local('loc_e', { value: 'in_local_e', isExpression: true }),
      local('loc_t', { value: '{{ in_local_t }}', isTemplate: true }),
    ],
    ...body(
      [
        logBlock('d-log', 'G3 body'),
        setterBlock('d-setter', { out_setter: "'w'" }),
        nestedFunction('d-nested', { output: 'out_call' }),
        muted(setterBlock('d-muted', { out_muted: "'m'" })),
      ],
      [startLink('d-log'), edge('d-log', 'd-setter'), edge('d-setter', 'd-nested'), edge('d-nested', 'd-muted')],
    ),
  }),
  warnInputs: [],
  warnOutputs: ['out_none', 'out_muted'],
  after: 'G3 body',
  verdict: 'passed',
  calls: 1,
  buildBody: async (page, ui) => {
    const log = await dropUnder(page, null, null, 'log')
    await setLogText(page, log, 'G3 body')
    const setter = await dropUnder(page, log, null, SETTER)
    await configureSetter(page, setter, 'out_setter', "'w'")
    const nested = await addNestedFunction(page, setter, ui.fnName, { output: 'out_call' })
    const mutedSetter = await dropUnder(page, nested, null, SETTER)
    await configureSetter(page, mutedSetter, 'out_muted', "'m'")
    await disableNode(page, mutedSetter)
    return { 'd-log': log, 'd-setter': setter, 'd-nested': nested, 'd-muted': mutedSetter }
  },
}

const REFUSED: WarnGroup = {
  key: 'refused',
  title: 'a call refused before its body',
  shape: () => ({
    inputs: [{ name: 'req', type: 'string', required: true }, input('u')],
    outputs: [output('o')],
    variables: [],
    ...body([logBlock('r-log', "'G4 body ' + str(req)", 'expression')], [startLink('r-log')]),
  }),
  warnInputs: ['u'],
  warnOutputs: ['o'],
  after: /'req' is null$/,
  verdict: 'failed',
  calls: 1,
  bindings: { req: 'nothing' },
  nothingVariable: true,
  buildBody: async (page) => {
    const log = await dropUnder(page, null, null, 'log')
    await configureLog(page, log, 'expression', "'G4 body ' + str(req)")
    return { 'r-log': log }
  },
}

const FAILS: WarnGroup = {
  key: 'fails',
  title: 'a call whose body fails',
  shape: () => ({
    inputs: [input('u')],
    outputs: [output('o')],
    variables: [],
    ...body([logBlock('f-log', 'G5 body'), logBlock('f-boom', '1/0', 'expression')], [startLink('f-log'), edge('f-log', 'f-boom')]),
  }),
  warnInputs: ['u'],
  warnOutputs: ['o'],
  after: 'G5 body',
  verdict: 'failed',
  calls: 1,
  buildBody: async (page) => {
    const log = await dropUnder(page, null, null, 'log')
    await setLogText(page, log, 'G5 body')
    const boom = await dropUnder(page, log, null, 'log')
    await configureLog(page, boom, 'expression', '1/0')
    return { 'f-log': log, 'f-boom': boom }
  },
}

const LOOP: WarnGroup = {
  key: 'loop',
  title: 'a call inside a For with count 3',
  shape: () => ({
    inputs: [input('u')],
    outputs: [output('o')],
    variables: [],
    ...body([logBlock('l-log', 'G6 body')], [startLink('l-log')]),
  }),
  warnInputs: ['u'],
  warnOutputs: ['o'],
  after: 'G6 body',
  verdict: 'passed',
  calls: 3,
  loop: true,
  buildBody: async (page) => {
    const log = await dropUnder(page, null, null, 'log')
    await setLogText(page, log, 'G6 body')
    return { 'l-log': log }
  },
}

const GROUPS: readonly WarnGroup[] = [SETTINGS, CONDITIONS, DECLARATIONS, REFUSED, FAILS, LOOP]

// ---------------------------------------------------------------------------
// Building through the UI
// ---------------------------------------------------------------------------

async function fitView(page: Page): Promise<void> {
  await expandPalette(page)
  await page.locator('.react-flow__controls-fitview').click()
  await waitForViewportSettled(page)
}

/** Drop a palette block, or a new Function, under a lane dot of `source` (under Start when null); the drop links it. */
async function dropUnder(
  page: Page,
  source: string | null,
  handle: string | null,
  block: PaletteDragSpec | 'function',
): Promise<string> {
  await fitView(page)
  const item: PaletteDragSpec | Locator = block === 'function' ? page.locator(NEW_FUNCTION) : block
  if (source === null) return dropBelowStart(page, item)
  const dot = await laneDot(page, source, handle).boundingBox()
  const canvas = await page.locator('[data-testid="workflow-canvas"]').boundingBox()
  expect(dot && canvas, `the ${handle ?? 'exit'} dot of ${source} and the canvas have boxes`).toBeTruthy()
  const point = { x: dot!.x + dot!.width / 2 - canvas!.x, y: dot!.y + dot!.height + 16 - canvas!.y }
  const before = await canvasNodeIds(page)
  if (block === 'function') await dragSourceToCanvas(page, item as Locator, point)
  else await dragPaletteItemToCanvas(page, block, point)
  const added = (await canvasNodeIds(page)).filter((id) => !before.includes(id))
  expect(added, 'exactly one block was dropped').toHaveLength(1)
  await expect(edgeOnCanvas(page, source, added[0]), `the drop links ${source} -> ${added[0]}`).toHaveCount(1)
  return added[0]
}

/** Make the declarations of `shape` with the in-Function Add menu, in declaration order. */
async function addDecls(page: Page, shape: Pick<FunctionShape, 'inputs' | 'outputs'> & { variables?: Decl[] }): Promise<void> {
  for (const decl of shape.inputs) await createDeclaration(page, 'input', decl)
  for (const decl of shape.outputs) await createDeclaration(page, 'output', decl)
  for (const decl of shape.variables ?? []) await createDeclaration(page, 'variable', decl)
}

/** Make a string setting a Template in its Edit value sheet and apply it. */
async function setRowTemplate(page: Page, sheet: Locator, name: string, text: string): Promise<void> {
  const editorSheet = await openStringParamSheet(sheet, page, name)
  const kind = editorSheet.getByTestId('kind-dropdown')
  await kind.click()
  await page.getByRole('option', { name: 'Template', exact: true }).click()
  await expect(kind).toHaveText('Template')
  const editor = editorSheet.locator('.cm-content').first()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
  await leaveExpressionEditor(editor)
  await expect(editorSheet).toBeVisible()
  await expect(editor).toHaveText(text)
  const save = editorSheet.getByTestId('value-editor-save-button')
  await save.click()
  await expect(save).toBeDisabled()
  await editorSheet.getByTestId('value-editor-cancel-button').click()
  await expect(editorSheet).toBeHidden()
}

async function configureLog(page: Page, id: string, kind: 'literal' | 'expression' | 'template', text: string): Promise<void> {
  if (kind === 'literal') {
    await setLogText(page, id, text)
    return
  }
  const sheet = await openConfig(page, id)
  if (kind === 'expression') await setRowExpression(page, sheet, 'message', text)
  else await setRowTemplate(page, sheet, 'message', text)
  await saveConfig(sheet)
}

/** Shell Exec with a command and one environment entry whose value is an expression. */
async function configureShellExec(page: Page, id: string, command: string, key: string, expression: string): Promise<void> {
  const sheet = await openConfig(page, id)
  await setStringParam(sheet, page, 'command', command)
  await expandButton(sheet, 'env_vars').click()
  const map = valueSheet(page)
  await expect(map).toBeVisible()
  await map.getByTestId('map-add-entry').click()
  await map.getByTestId('map-edit-key-0').fill(key)
  await map.getByTestId('map-expr-toggle-0').click()
  const editor = map.locator('[data-testid="map-expr-value-0"] .cm-content')
  await editor.click()
  await page.keyboard.insertText(expression)
  await leaveExpressionEditor(editor)
  await expect(map).toBeVisible()
  await expect(editor).toHaveText(expression)
  await saveAndCloseSheet(page)
  await saveConfig(sheet)
}

async function configureForEach(page: Page, id: string, variable: string): Promise<void> {
  const sheet = await openConfig(page, id)
  await pickVariableRef(page, sheet, 'collection', variable)
  await saveConfig(sheet)
}

/** One Variable Setter row: `target` = an expression. */
async function configureSetter(page: Page, id: string, target: string, expression: string): Promise<void> {
  const sheet = await openConfig(page, id)
  const add = sheet.locator('[data-testid="varset-add-button"]')
  const nameInput = sheet.locator('[data-testid="varset-name-input-0"]')
  if ((await nameInput.count()) === 0) await add.click()
  await nameInput.fill(target)
  await add.focus()
  await sheet.locator('[data-testid="varset-expression-toggle-0"]').click()
  const editor = sheet.locator(`[data-testid="param-input-${target}"] .cm-content`)
  await editor.click()
  await page.keyboard.insertText(expression)
  await leaveExpressionEditor(editor)
  await expect(editor).toHaveText(expression)
  await saveConfig(sheet)
}

/** One literal row `<variable> <operator>` on a check block; Wait Until also gets its timing. */
async function configureCheck(page: Page, id: string, block: ConditionBlock, variable: string, operator: string): Promise<void> {
  const sheet = await openConfig(page, id)
  const conditions = await openConditionBody(sheet, block)
  await addLiteralRow(conditions)
  await pickConditionVariable(page, conditions, '0', variable)
  await pickOperator(page, conditions, '0', operator)
  if (block === 'wait-until') await setWaitTiming(sheet, 'retry', 1000, 300)
  await saveConfig(sheet)
}

function exactly(name: string): RegExp {
  return new RegExp(`^${escapeRegExp(name)}$`)
}

/** Drop the nested Function under `after`, give it `n` and `r`, come back to `outerName` and bind it. */
async function addNestedFunction(
  page: Page,
  after: string,
  outerName: string,
  bind: { input?: string; output?: string },
): Promise<string> {
  const nested = await dropUnder(page, after, null, 'function')
  await digIn(page, nested)
  await expect(breadcrumbFunctionSegments(page)).toHaveCount(2)
  await addDecls(page, NESTED)
  await popToBreadcrumbSegment(page, exactly(outerName))
  await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
  await expect(page.locator(`[data-testid="workflow-node-${nested}"]`)).toBeVisible({ timeout: 15_000 })
  const sheet = await openFunctionBlockSheet(page, nested)
  if (bind.input) await setRowExpression(page, sheet, 'n', bind.input)
  if (bind.output) await bindOutput(sheet, 'r', bind.output)
  await saveConfig(sheet)
  return nested
}

async function currentScopeName(page: Page): Promise<string> {
  const name = (await page.locator('[data-testid="breadcrumb-path"] [aria-current="page"]').innerText()).trim()
  expect(name, 'the breadcrumb names the scope').not.toBe('')
  return name
}

// ---------------------------------------------------------------------------
// The stored body equals the seeded body
// ---------------------------------------------------------------------------

interface StoredDefinition {
  name?: string
  inputs?: Decl[]
  outputs?: Decl[]
  variables?: Decl[]
  workflow?: { nodes?: WorkflowNode[]; edges?: WorkflowEdge[] }
}

/** Where `actual` differs from `expected`; keys `expected` leaves out are not compared. */
function differences(expected: unknown, actual: unknown, at: string): string[] {
  const shown = `${at}: expected ${JSON.stringify(expected)}, stored ${JSON.stringify(actual)}`
  if (expected === null || typeof expected !== 'object') return expected === actual ? [] : [shown]
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return [shown]
    return expected.flatMap((item, index) => differences(item, actual[index], `${at}[${index}]`))
  }
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return [shown]
  return Object.entries(expected as Record<string, unknown>).flatMap(([key, value]) =>
    differences(value, (actual as Record<string, unknown>)[key], `${at}.${key}`),
  )
}

/** The parts of a block that name what it reads and writes. */
function blockView(node: WorkflowNode): Record<string, unknown> {
  const data = node.data as Record<string, any>
  return {
    elementType: data.elementType,
    disabled: data.disabled === true,
    values: data.config?.values ?? {},
    outputBindings: data.config?.outputBindings ?? {},
    expressionFields: [...(data.expressionFields ?? [])].sort(),
    templateFields: [...(data.templateFields ?? [])].sort(),
    variableExpressionKeys: [...(data.variableExpressionKeys ?? [])].sort(),
  }
}

function shapeOf(definition: StoredDefinition): FunctionShape {
  return {
    inputs: definition.inputs ?? [],
    outputs: definition.outputs ?? [],
    variables: definition.variables ?? [],
    nodes: definition.workflow?.nodes ?? [],
    edges: definition.workflow?.edges ?? [],
  }
}

function definitionDifferences(
  expected: FunctionShape,
  stored: StoredDefinition,
  ids: Readonly<Record<string, string>>,
  at: string,
): string[] {
  const found: string[] = []
  for (const key of ['inputs', 'outputs', 'variables'] as const) {
    const want = expected[key]
    const got = stored[key] ?? []
    const wantNames = want.map((decl) => decl.name).join(', ')
    const gotNames = got.map((decl) => decl.name).join(', ')
    if (wantNames !== gotNames) found.push(`${at}.${key}: expected [${wantNames}], stored [${gotNames}]`)
    else found.push(...want.flatMap((decl, index) => differences(decl, got[index], `${at}.${key}.${String(decl.name)}`)))
  }
  const nodes = stored.workflow?.nodes ?? []
  if (nodes.length !== expected.nodes.length) {
    found.push(`${at}: ${nodes.length} blocks stored, ${expected.nodes.length} expected`)
  }
  for (const node of expected.nodes) {
    const storedNode = nodes.find((candidate) => candidate.id === ids[node.id])
    if (!storedNode) {
      found.push(`${at}: block ${node.id} (${ids[node.id]}) is not stored`)
      continue
    }
    found.push(...differences(blockView(node), blockView(storedNode), `${at}.${node.id}`))
    const inner = node.data.localDefinition as StoredDefinition | undefined
    if (inner) {
      const storedInner = (storedNode.data.localDefinition ?? {}) as StoredDefinition
      found.push(...definitionDifferences(shapeOf(inner), storedInner, ids, `${at}.${node.id}`))
    }
  }
  const links = stored.workflow?.edges ?? []
  if (links.length !== expected.edges.length) {
    found.push(`${at}: ${links.length} links stored, ${expected.edges.length} expected`)
  }
  for (const link of expected.edges) {
    const source = link.source === 'start-node' ? 'start-node' : ids[link.source]
    const hit = links.some(
      (candidate) =>
        candidate.source === source &&
        candidate.target === ids[link.target] &&
        (candidate.sourceHandle ?? null) === (link.sourceHandle ?? null),
    )
    if (!hit) found.push(`${at}: no stored link ${link.source} -(${link.sourceHandle ?? 'exit'})-> ${link.target}`)
  }
  return found
}

async function storedFunction(request: APIRequestContext, testId: string, fnId: string): Promise<StoredDefinition> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  const nodes = ((await resp.json()).data?.workflow?.nodes ?? []) as WorkflowNode[]
  const node = nodes.find((candidate) => candidate.id === fnId)
  expect(node, `the Function ${fnId} is in the stored Test`).toBeTruthy()
  return (node!.data.localDefinition ?? {}) as StoredDefinition
}

// ---------------------------------------------------------------------------
// Run and read the console
// ---------------------------------------------------------------------------

function repeat<T>(times: number, items: readonly T[]): T[] {
  return Array.from({ length: times }, () => items).flat()
}

async function runAndRead(page: Page): Promise<{ verdict: string | null; entries: LogEntry[] }> {
  const { verdict } = await runToEnd(page)
  return { verdict, entries: consoleEntriesFromCopy(await getLogCopyTexts(page)) }
}

/** The WARN lines of `group` for the Function named `fn`: their text, level, source, count and place. */
function expectWarnLines(group: WarnGroup, fn: string, verdict: string | null, entries: readonly LogEntry[]): void {
  const shown = formatEntries(entries)
  const warns = [
    ...group.warnInputs.map((name) => unusedInput(fn, name)),
    ...group.warnOutputs.map((name) => unwrittenOutput(fn, name)),
  ]
  const printed = entries
    .filter((entry) => DECLARES.test(entry.message))
    .map((entry) => `[${entry.level}] ${entry.source}: ${entry.message}`)
  // Per FNCFG-5: one line per unused input and unwritten output, every call, inputs first.
  expect(printed, `the unused-parameter lines.\n${shown}`).toEqual(
    repeat(group.calls, warns.map((line) => `[WARN] FUNCTION: ${line}`)),
  )

  const entering = `Entering Function '${fn}'`
  const isAfter = (message: string) =>
    typeof group.after === 'string' ? message === group.after : group.after.test(message)
  const sequence = entries
    .map((entry) => entry.message)
    .filter((message) => warns.includes(message) || isAfter(message))
    .map((message) => (isAfter(message) ? 'AFTER' : message))
    // A refusal is repeated by the lines that pass it on (block, Test); the first one counts.
    .filter((token, index, all) => token !== 'AFTER' || all[index - 1] !== 'AFTER')
  expect(sequence, `each call: its WARN lines, then ${group.after}.\n${shown}`).toEqual(
    repeat(group.calls, [...warns, 'AFTER']),
  )
  // The lines are written when the call starts: right after its entry line, together.
  entries.forEach((entry, index) => {
    if (entry.message !== warns[0]) return
    expect(entries[index - 1]?.message, `the line before the WARN lines.\n${shown}`).toBe(entering)
    expect(entries.slice(index, index + warns.length).map((line) => line.message), `the WARN lines of one call.\n${shown}`).toEqual(warns)
  })
  expectLineBefore(entries, entering, warns[0])
  expectLineBefore(entries, warns[warns.length - 1], group.after)
  expect(verdict, `the run verdict.\n${shown}`).toBe(group.verdict)
}

// ---------------------------------------------------------------------------
// Seeds for the library and nested variants
// ---------------------------------------------------------------------------

function forThreeTimes(id: string): WorkflowNode {
  return controlNode({
    id,
    label: 'For Loop',
    elementType: 'for',
    category: 'loop',
    description: '',
    values: { mode: 'count', count: 3, start: 0, end: 0 },
  })
}

/** The caller's nodes and links: the call, inside a For with count 3 when the group asks. */
function callerFlow(group: WarnGroup, call: WorkflowNode): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  if (!group.loop) return { nodes: [call], edges: [startLink(call.id)] }
  const loop = forThreeTimes('fn-loop')
  return { nodes: stackNodes([loop, call], { x: 200, startY: 120, step: 120 }), edges: [startLink(loop.id), handleEdge(loop.id, 'body', call.id)] }
}

const NOTHING_VARIABLE = { nothing: { type: 'string', value: null, scope: 'test' } }

function testName(group: WarnGroup, variant: string): string {
  return `zz-unused-warn-${group.key}-${variant}-${randomUUID().slice(0, 8)}`
}

async function deleteLibraryFunction(request: APIRequestContext, functionId: string): Promise<void> {
  if (functionId) await request.delete(`${BACKEND_URL}/functions/${functionId}?cascade=true`).catch(() => undefined)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

for (const group of GROUPS) {
  test.describe(`V-FN-UNUSED-PARAM-WARN: ${group.title}`, () => {
    let testId = ''
    let functionId = ''

    test.afterEach(async ({ request }) => {
      await deleteTest(request, testId)
      await deleteLibraryFunction(request, functionId)
      testId = ''
      functionId = ''
    })

    test(`${group.title}: a Local Function built in the UI`, async ({ page, request }) => {
      await ensureEnvironment(request)
      const name = testName(group, 'local')
      testId = await createValidTest(request, { name, nodes: [], variables: group.nothingVariable ? NOTHING_VARIABLE : {} })
      await openLaneCanvas(page, testId)

      let fnId = ''
      let ids: Record<string, string> = {}
      await test.step('drop the Function and build its body', async () => {
        if (group.loop) {
          const loop = await dropUnder(page, null, null, 'for')
          const sheet = await openConfig(page, loop)
          await numberInput(sheet, 'count').fill('3')
          await expect(numberInput(sheet, 'count')).toHaveValue('3')
          await saveConfig(sheet)
          fnId = await dropUnder(page, loop, 'body', 'function')
        } else {
          fnId = await dropUnder(page, null, null, 'function')
        }
        await digIn(page, fnId)
        await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
        const fnName = await currentScopeName(page)
        await addDecls(page, group.shape())
        ids = await group.buildBody(page, { fnName })
        await popToBreadcrumbSegment(page, exactly(name))
        await expect(breadcrumbFunctionSegments(page)).toHaveCount(0)
      })

      if (group.bindings) {
        await test.step('bind the call inputs', async () => {
          const sheet = await openFunctionBlockSheet(page, fnId)
          for (const [inputName, expression] of Object.entries(group.bindings!)) {
            await setRowExpression(page, sheet, inputName, expression)
          }
          await saveConfig(sheet)
        })
      }

      await saveCanvas(page)
      const stored = await storedFunction(request, testId, fnId)
      // The Library and Nested tests seed group.shape(): it must be what the UI stores.
      expect(definitionDifferences(group.shape(), stored, ids, 'body'), 'the stored body equals the seeded body').toEqual([])

      const { verdict, entries } = await runAndRead(page)
      expectWarnLines(group, String(stored.name), verdict, entries)
    })

    test(`${group.title}: a library Function`, async ({ page, request }) => {
      await ensureEnvironment(request)
      const shape = group.shape()
      const published = await publishLibraryFunction(request, {
        name: `zz-uw-${group.key}-${RUN}`,
        inputs: shape.inputs,
        outputs: shape.outputs,
        variables: shape.variables,
        workflow: { nodes: shape.nodes, edges: shape.edges },
      })
      functionId = published.functionId
      const call = sharedNode('fn-call', {
        functionId: published.functionId,
        functionVersion: published.version,
        label: published.name,
        originalLibraryName: published.name,
        ...expressionInputs(group.bindings ?? {}),
      }) as unknown as WorkflowNode
      const flow = callerFlow(group, call)
      testId = await createValidTest(request, {
        name: testName(group, 'library'),
        ...flow,
        variables: group.nothingVariable ? NOTHING_VARIABLE : {},
      })
      await openLaneCanvas(page, testId)

      const { verdict, entries } = await runAndRead(page)
      expectWarnLines(group, published.name, verdict, entries)
    })

    test(`${group.title}: a Function nested in a Function`, async ({ page, request }) => {
      await ensureEnvironment(request)
      const innerName = `zz-inner-${group.key}`
      const inner = localFunctionNode('fn-inner', innerName, group.shape()) as unknown as WorkflowNode
      setFunctionFields(inner, expressionInputs(group.bindings ?? {}))
      const flow = callerFlow(group, inner)
      const outer = localFunctionNode('fn-outer', `zz-outer-${group.key}`, {
        ...flow,
        variables: group.nothingVariable ? [{ name: 'nothing', type: 'string', value: null }] : [],
      }) as unknown as WorkflowNode
      testId = await createValidTest(request, {
        name: testName(group, 'nested'),
        nodes: [outer],
        edges: [startLink(outer.id)],
      })
      await openLaneCanvas(page, testId)

      const { verdict, entries } = await runAndRead(page)
      expectWarnLines(group, innerName, verdict, entries)
    })
  })
}
