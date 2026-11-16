/**
 * V-MCP-RECIPE-CONTROL-FIELDS: every control Block field a recipe writes is created, shown in the
 * Block windows, read back whole, kept by an amend of its readback, and run
 * Design Decisions: FIELD-14, FIELD-15, VMGR-83, PARALLEL-3, PARALLEL-5
 * REQ: REQ-5.2.7.3, REQ-5.2.7.6, REQ-5.2.7.7, REQ-3.5.1.5, REQ-3.4.1.14
 *
 * Seed: `recipe-control-fields.yaml` is created over the live MCP endpoint by
 * `create_test_from_recipe`; a second Test is saved through POST /tests in the stored shape the
 * windows write. Every Test is deleted after.
 *
 * Pass Criteria:
 * 1. `create_test_from_recipe` creates the recipe holding `or`, a nested `group`, a compare-to
 *    `{expr}`, a template and a `{literal}` text, `when` lists, `if_label` / elif `label` /
 *    `else_label` / case `label` / `default_label`, a Setter with a template row, an `{expr}` row,
 *    a per-entry `{expr}` and a per-entry template, `secret_rows` with one `null` row, a lane
 *    `time_limit: {expr}`, `join: all`, a count-mode `step`, `for_each` `collection_type`,
 *    `break: {loop: For Loop}` and a Note; each is stored in the window shape, and the authoring
 *    result lists `NO_VALUE_VARIABLE` "Secret variable 'pending_token' holds no value".
 * 2. The windows show it: the OR pill, the group frames, the branch and case labels in their
 *    cards, the Template face, the masked secret row and the lane {x}.
 * 3. `get_test_recipe` reads it back with `expressible: true` and every form above, both secret
 *    rows listed under `secret_rows` with the value `null`.
 * 4. `amend_test_from_recipe` with the readback (the secret value given again) leaves every
 *    Block's `config.values`, flags, `elementTypes`, secret marks and label unchanged.
 * 5. A Test saved through POST /tests in the stored shape with OR, a group, a compare-to {x} and
 *    Template, a branch with two conditions, branch labels, a Setter Template row and a secret
 *    row reads back expressible with all of them.
 * 6. `get_recipe_guide` names `or`, `group:`, `{template:`, `{literal:` and `secret_rows`.
 * 7. The created Test's run passes and takes the paths the fields decide.
 * 8. A secret Setter row written `{expr}` or as a Template is stored as written, unsealed, with its
 *    secret mark; `get_test_recipe` reads it back in the same form with the row under `secret_rows`
 *    and `expressible: true`, and an amend with the readback leaves the Setter unchanged.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type APIRequestContext, type Locator } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { openConditionBody } from '../../helpers/condition-builder'
import { deleteTest, runToken } from '../../helpers/element-types'
import { closeBlockWindow, controlBlock, pluginBlock, storedTest, type Rec } from '../../helpers/fn-block'
import { createValidTest, openTest, validateTest } from '../../helpers/fn-seed'
import { callTool, enableMcpUntilRestart, recipeData, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { SECRET_ENVELOPE } from '../../helpers/secret-canary'
import { openBlockSheet } from '../../helpers/workbench'

// One MCP port per stack so host-mode parallel workers never collide.
const MCP_PORT = Number(BACKEND_PORT) + 765

const BASE_NAME = 'zz-mcp-recipe-control-fields-base'
const SECRET_VALUE = 'tok-control-fields-7'
const OWED_ROW = "Secret variable 'pending_token' holds no value"
const TERMINAL = ['passed', 'failed', 'stopped', 'skipped']
const OLD_SETTER_KEYS = ['variableExpressionKeys', 'variableTemplateKeys', 'variableTypes', 'variableElementTypes']

type Doc = Record<string, any>

interface HistoryLog {
  level?: string
  message?: string
}

function recipeNamed(name: string): string {
  return fs
    .readFileSync(path.resolve(__dirname, 'recipe-control-fields.yaml'), 'utf-8')
    .replace(`name: ${BASE_NAME}`, `name: ${name}`)
}

function tool(name: string, args: Record<string, unknown>): Doc {
  const answer = callTool(MCP_PORT, name, args)
  expect(answer.isError, `${name}: ${JSON.stringify(answer.payload)}`).toBe(false)
  return answer.payload
}

/** The problems of every authoring action item of `code`. */
function actionProblems(payload: Doc, code: string): string[] {
  return ((payload.action_items ?? []) as Doc[]).filter((item) => item.code === code).map((item) => item.problem)
}

function nodesOf(stored: Rec): Doc[] {
  return ((stored.workflow as Doc | undefined)?.nodes ?? []) as Doc[]
}

function nodeLabeled(nodes: Doc[], label: string): Doc {
  const node = nodes.find((entry) => entry.data?.label === label)
  expect(node, `a Block labeled '${label}' is stored: ${nodes.map((entry) => entry.data?.label).join(', ')}`).toBeTruthy()
  return node as Doc
}

function sortedList(value: unknown): string[] {
  return [...((value as string[] | undefined) ?? [])].sort()
}

/** A stored value with every sealed secret replaced by one mark, since a reseal never repeats the envelope. */
function withSealMarks(value: unknown): unknown {
  if (typeof value === 'string') return value.startsWith(SECRET_ENVELOPE) ? '<sealed>' : value
  if (Array.isArray(value)) return value.map(withSealMarks)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withSealMarks(item)]))
  }
  return value
}

/** What an amend must keep, per Block by its label: values, flags, entry types, secret marks. */
function blockFields(stored: Rec): Record<string, Doc> {
  const nodes = nodesOf(stored)
  const labels = nodes.map((node) => String(node.data.label))
  expect(new Set(labels).size, `every Block label is unique: ${labels.join(', ')}`).toBe(labels.length)
  return Object.fromEntries(
    nodes.map((node) => [
      String(node.data.label),
      {
        elementType: node.data.elementType,
        values: withSealMarks(node.data.config?.values ?? {}),
        expressionFields: sortedList(node.data.expressionFields),
        templateFields: sortedList(node.data.templateFields),
        elementTypes: node.data.elementTypes ?? {},
        secretFields: sortedList(node.data.config?.secretFields),
      },
    ]),
  )
}

const SECTION_KEYS = ['then', 'else', 'steps', 'body', 'default', 'on_pass', 'on_fail', 'retry', 'catch', 'finally']
const ENTRY_KEYS = ['elif', 'cases', 'branches']

const isDoc = (value: unknown): value is Doc => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** The steps of a construct mapping's sections and of its branch, case and lane entries. */
function sectionSteps(mapping: Doc): Doc[] {
  const own = SECTION_KEYS.flatMap((key) => allSteps(mapping[key]))
  const entries = ENTRY_KEYS.flatMap((key) => (Array.isArray(mapping[key]) ? (mapping[key] as unknown[]) : []))
  return [...own, ...entries.filter(isDoc).flatMap((entry) => [...allSteps(entry.then), ...allSteps(entry.steps)])]
}

/** Every step of a readback flow, nested sections included, in reading order. */
function allSteps(flow: unknown): Doc[] {
  if (!Array.isArray(flow)) return []
  return flow.filter(isDoc).flatMap((step) => [step, ...Object.values(step).filter(isDoc).flatMap(sectionSteps)])
}

/** The one readback construct of `keyword` whose mapping carries `label`. */
function construct(flow: unknown, keyword: string, label: string): Doc {
  const step = allSteps(flow).find((entry) => entry[keyword]?.label === label)
  expect(step, `the readback holds a '${keyword}' labeled '${label}'`).toBeTruthy()
  return (step as Doc)[keyword]
}

/** The one readback leaf step of `keyword`. */
function leaf(flow: unknown, keyword: string): Doc {
  const steps = allSteps(flow).filter((entry) => keyword in entry)
  expect(steps, `the readback holds one '${keyword}' step`).toHaveLength(1)
  return steps[0]
}

/** Run the Test tracked over MCP; returns the verdict and every run line. */
async function runOverMcp(request: APIRequestContext, testId: string): Promise<{ verdict: string; lines: HistoryLog[] }> {
  const started = tool('start_execution', { entity_type: 'test', ref: testId, environment: E2E_ENV_NAME })
  const executionId = started.execution_id as string
  let verdict = ''
  await expect
    .poll(
      async () => {
        const resp = await request.get(`${BACKEND_URL}/executions/${executionId}`)
        verdict = (((await resp.json()).data ?? {}) as { status?: string }).status ?? ''
        return TERMINAL.includes(verdict)
      },
      { timeout: 90_000, message: `execution ${executionId} reaches a terminal state` },
    )
    .toBe(true)
  const history = await request.get(`${BACKEND_URL}/executions/history/${executionId}`)
  expect(history.ok(), `GET /executions/history/${executionId}: ${history.status()}`).toBeTruthy()
  return { verdict, lines: (((await history.json()).data ?? {}) as { logs?: HistoryLog[] }).logs ?? [] }
}

/** A CodeMirror value box: its text, and the text its expression marks cover. */
async function codeFace(box: Locator): Promise<{ text: string; marked: string }> {
  const content = box.locator('.cm-content')
  await expect(content).toBeVisible()
  return {
    text: (await content.textContent()) ?? '',
    marked: (await content.locator('.cm-expression').allTextContents()).join(''),
  }
}

const literalRow = (id: string, variable: string, operator: string, value: string, flag?: string): Rec => ({
  id,
  type: 'literal',
  variable,
  operator,
  value_type: 'string',
  reference_value: value,
  ...(flag ? { [flag]: true } : {}),
})

const join = (value: 'and' | 'or'): Rec => ({ type: 'operator', value })

/** The hand-built Test: a Setter with a Template row and a secret row, then an If/Else holding OR, a group and labels. */
function handBuiltTest(name: string): { name: string; nodes: Rec[]; edges: Rec[]; variables: Rec } {
  const setter = controlBlock('hand-set', 'Hand rows', 'variable-setter', 'variables', {
    position: { x: 200, y: 140 },
    templateFields: ['variables.greeting'],
    values: { variables: { greeting: 'hi {{ prefix }}', tok: 'hand-secret-9' } },
  })
  ;((setter.data as Doc).config as Doc).secretFields = ['variables.tok']
  const route = controlBlock('hand-if', 'Hand route', 'if-else', 'conditional', {
    position: { x: 200, y: 280 },
    values: {
      branches: [
        {
          id: 'branch_0',
          type: 'if',
          label: 'Hand ready',
          conditions: [
            literalRow('h-status', 'status', 'equals', 'expected_status', 'reference_is_expression'),
            join('or'),
            {
              id: 'h-group',
              type: 'group',
              items: [
                literalRow('h-host', 'host', 'starts_with', '{{ prefix }}-1', 'reference_is_template'),
                join('and'),
                { id: 'h-retries', type: 'expression', expression: 'retries < 3' },
              ],
            },
          ],
        },
        {
          id: 'branch_1',
          type: 'else_if',
          label: 'Hand second',
          conditions: [
            { id: 'h-five', type: 'expression', expression: 'retries > 5' },
            join('and'),
            { id: 'h-six', type: 'expression', expression: 'retries > 6' },
          ],
        },
        { id: 'branch_2', type: 'else', label: 'Hand else' },
      ],
    },
  })
  const log = (id: string, label: string, message: string, x: number): Rec =>
    pluginBlock(id, label, 'log', 'system', { values: { message, level: 'INFO' }, position: { x, y: 420 } })
  return {
    name,
    nodes: [
      setter,
      route,
      log('hand-log-if', 'Hand log if', 'hand=if', 0),
      log('hand-log-elif', 'Hand log elif', 'hand=elif', 200),
      log('hand-log-else', 'Hand log else', 'hand=else', 400),
    ],
    edges: [
      { id: 'e-start-set', source: 'start-node', target: 'hand-set' },
      { id: 'e-set-if', source: 'hand-set', target: 'hand-if' },
      { id: 'e-if-0', source: 'hand-if', target: 'hand-log-if', sourceHandle: 'branch_0' },
      { id: 'e-if-1', source: 'hand-if', target: 'hand-log-elif', sourceHandle: 'branch_1' },
      { id: 'e-if-2', source: 'hand-if', target: 'hand-log-else', sourceHandle: 'branch_2' },
    ],
    variables: {
      status: { value: 'ready', type: 'string', scope: 'test' },
      expected_status: { value: 'ready', type: 'string', scope: 'test' },
      host: { value: 'web-1', type: 'string', scope: 'test' },
      prefix: { value: 'web', type: 'string', scope: 'test' },
      retries: { value: 2, type: 'integer', scope: 'test' },
      greeting: { value: '', type: 'string', scope: 'test' },
      tok: { value: '', type: 'string', scope: 'test' },
    },
  }
}

/** The guide section under `heading` through the line before the next heading. */
function guideSection(guide: string, heading: string): string {
  const lines = guide.split('\n')
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start === -1) return ''
  const end = lines.findIndex((line, i) => i > start && /^#{1,4} /.test(line))
  return lines.slice(start, end === -1 ? undefined : end).join('\n')
}

test.describe('V-MCP-RECIPE-CONTROL-FIELDS: control Block fields through the recipe tools', () => {
  const created: string[] = []

  test.beforeEach(async ({ page, request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    await resetOwnership(request)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const id of created.splice(0)) await deleteTest(request, id)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('a recipe with every control field form is created, shown, read back, amended unchanged and run', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    let testId = ''

    await test.step('create_test_from_recipe stores every form and lists the null secret row', async () => {
      const answer = tool('create_test_from_recipe', { recipe: recipeNamed(`zz-mcp-recipe-control-fields-${runToken()}`) })
      expect(answer.created, JSON.stringify(answer)).toBe(true)
      testId = answer.test_id as string
      created.push(testId)
      expect(actionProblems(answer, 'NO_VALUE_VARIABLE'), JSON.stringify(answer.action_items)).toEqual([OWED_ROW])

      const nodes = nodesOf(await storedTest(request, testId))
      const route = nodeLabeled(nodes, 'Route on status').data
      const [ifBranch, slowBranch, elseBranch] = route.config.values.branches as Doc[]
      expect([ifBranch.label, slowBranch.label, elseBranch.label]).toEqual(['Ready path', 'Slow path', 'Fallback path'])
      expect(ifBranch.conditions).toMatchObject([
        {
          type: 'literal',
          variable: 'status',
          operator: 'equals',
          reference_value: "expected_status + '-x'",
          reference_is_expression: true,
        },
        { type: 'operator', value: 'or' },
        {
          type: 'group',
          items: [
            { type: 'literal', variable: 'host', operator: 'starts_with', reference_value: '{{ prefix }}', reference_is_template: true },
            { type: 'operator', value: 'and' },
            {
              type: 'group',
              items: [
                { type: 'expression', expression: 'retries > limit' },
                { type: 'operator', value: 'or' },
                { type: 'literal', variable: 'host', operator: 'not_equals', reference_value: '{{ host }}' },
              ],
            },
          ],
        },
      ])
      const literalText = ifBranch.conditions[2].items[2].items[2]
      expect(literalText.reference_is_template, 'a {literal} text holds no template mark').toBeFalsy()
      expect(literalText.reference_is_expression, 'a {literal} text holds no expression mark').toBeFalsy()
      expect(slowBranch.conditions).toMatchObject([
        { type: 'expression', expression: 'retries > 10' },
        { type: 'operator', value: 'and' },
        { type: 'expression', expression: 'limit > 10' },
      ])

      const cases = nodeLabeled(nodes, 'Route on case').data.config.values.branches as Doc[]
      expect(cases).toMatchObject([
        {
          type: 'case',
          label: 'Ready case',
          conditions: [{ variable: 'status', reference_value: 'expected_status', reference_is_expression: true }],
        },
        { type: 'default', label: 'Other case' },
      ])

      const setter = nodeLabeled(nodes, 'Set the rows').data
      const rows = setter.config.values.variables as Doc
      expect(Object.keys(rows)).toEqual(['greeting', 'next_retries', 'hosts', 'api_token', 'pending_token'])
      expect(rows.greeting).toBe('hello {{ prefix }}')
      expect(rows.next_retries).toBe('retries + 1')
      expect(rows.hosts).toEqual(['host', '{{ prefix }}-2', 'plain-3'])
      expect(String(rows.api_token), 'the secret row is sealed at rest').toMatch(new RegExp(`^${SECRET_ENVELOPE}`))
      expect(rows.pending_token).toBeNull()
      expect(sortedList(setter.expressionFields)).toEqual(['variables.hosts.0', 'variables.next_retries'])
      expect(sortedList(setter.templateFields)).toEqual(['variables.greeting', 'variables.hosts.1'])
      expect(setter.elementTypes).toEqual({ 'variables.hosts': ['string', 'string', 'string'] })
      expect(sortedList(setter.config.secretFields)).toEqual(['variables.api_token', 'variables.pending_token'])
      for (const key of OLD_SETTER_KEYS) expect(setter[key], `no ${key} is stored`).toBeUndefined()
      expect(setter.config.variableSecretKeys, 'no config.variableSecretKeys is stored').toBeUndefined()

      const fan = nodeLabeled(nodes, 'Fan out').data
      expect(fan.config.values).toMatchObject({
        join: 'all',
        branches: [
          { id: 'branch_1', name: 'quick lane' },
          { id: 'branch_2', name: 'budget lane', time_limit: 'lane_ms' },
        ],
      })
      expect(fan.expressionFields).toContain('branches.1.time_limit')

      const loop = nodeLabeled(nodes, 'For Loop').data
      expect(loop.config.values).toMatchObject({ mode: 'count', count: 6, step: 2 })
      const each = nodeLabeled(nodes, 'Each item').data
      expect(each.config.values).toMatchObject({ collection: 'items', collection_type: 'array' })
      const stop = nodes.find((node) => node.data.elementType === 'break')
      expect(stop?.data.config.values.target_loop, 'the break aims at the For Loop').toBe(nodeLabeled(nodes, 'For Loop').id)
      const note = nodes.find((node) => node.type === 'noteNode')
      expect(note?.data.config.values).toEqual({ text: 'Control fields under test', color: 'yellow' })
    })

    await test.step('the windows show the OR pill, the groups, the labels, the Template face, the masked row and the lane {x}', async () => {
      const nodes = nodesOf(await storedTest(request, testId))
      const route = nodeLabeled(nodes, 'Route on status')
      const group = route.data.config.values.branches[0].conditions[2]
      const nested = group.items[2]
      await openTest(page, testId)

      const ifSheet = await openBlockSheet(page, route.id)
      await expect(ifSheet.locator('[data-testid="branch-label-branch_0"]')).toHaveValue('Ready path')
      await expect(ifSheet.locator('[data-testid="branch-label-branch_1"]')).toHaveValue('Slow path')
      await expect(ifSheet.locator('[data-testid="branch-label-branch_2"]')).toHaveValue('Fallback path')
      const body = await openConditionBody(ifSheet, 'if-else', 'branch_0')
      await expect(body.locator('[data-testid="assert-operator-toggle-root-1"]')).toHaveText('OR')
      const frame = body.locator(`[data-testid="assert-group-${group.id}"]`)
      await expect(frame).toBeVisible()
      await expect(frame.locator(`[data-testid="assert-operator-toggle-${group.id}-1"]`)).toHaveText('AND')
      const inner = frame.locator(`[data-testid="assert-group-${nested.id}"]`)
      await expect(inner, 'the nested group has its own frame inside the group').toBeVisible()
      await expect(inner.locator(`[data-testid="assert-operator-toggle-${nested.id}-1"]`)).toHaveText('OR')
      await expect(body.locator('[data-testid="assert-expr-toggle-2-0"]')).toHaveAttribute('aria-pressed', 'false')
      expect(await codeFace(body.locator('[data-testid="param-input-assert-value-2-0"]')), 'the Template face').toEqual({
        text: '{{ prefix }}',
        marked: '{{ prefix }}',
      })
      await expect(body.locator('[data-testid="param-input-assert-value-2-2-2"]'), 'the literal text').toHaveValue('{{ host }}')
      await expect(body.locator('[data-testid="assert-expr-toggle-0"]')).toHaveAttribute('aria-pressed', 'true')
      await expect(body.locator('[data-testid="param-input-assert-value-0"] .cm-content')).toHaveText("expected_status + '-x'")
      await closeBlockWindow(ifSheet)

      const switchSheet = await openBlockSheet(page, nodeLabeled(nodes, 'Route on case').id)
      await expect(switchSheet.locator('[data-testid="case-label-branch_0"]')).toHaveValue('Ready case')
      await expect(switchSheet.locator('[data-testid="default-label-branch_1"]')).toHaveValue('Other case')
      const caseBody = await openConditionBody(switchSheet, 'switch', 'branch_0')
      await expect(caseBody.locator('[data-testid="assert-expr-toggle-0"]')).toHaveAttribute('aria-pressed', 'true')
      await expect(caseBody.locator('[data-testid="param-input-assert-value-0"] .cm-content')).toHaveText('expected_status')
      await closeBlockWindow(switchSheet)

      const setSheet = await openBlockSheet(page, nodeLabeled(nodes, 'Set the rows').id)
      await expect(setSheet.locator('[data-testid="varset-name-input-0"]')).toHaveValue('greeting')
      await expect(setSheet.locator('[data-testid="varset-expression-toggle-0"]')).toHaveAttribute('aria-pressed', 'false')
      expect(await codeFace(setSheet.locator('[data-testid="param-input-varset-value-0"]')), 'the Template row face').toEqual({
        text: 'hello {{ prefix }}',
        marked: '{{ prefix }}',
      })
      await expect(setSheet.locator('[data-testid="varset-expression-toggle-1"]')).toHaveAttribute('aria-pressed', 'true')
      await expect(setSheet.locator('[data-testid="param-input-varset-value-1"] .cm-content')).toHaveText('retries + 1')
      await expect(setSheet.locator('[data-testid="varset-name-input-3"]')).toHaveValue('api_token')
      await expect(setSheet.locator('[data-testid="varset-secret-checkbox-3"]')).toBeChecked()
      await expect(setSheet.locator('[data-testid="varset-secret-checkbox-4"]')).toBeChecked()
      await expect(setSheet.getByRole('button', { name: 'api_token: Edit protected value', exact: true })).toBeVisible()
      await expect(setSheet.getByRole('button', { name: /Edit protected value$/ }), 'only the held secret is masked').toHaveCount(1)
      await expect(setSheet.getByText(SECRET_VALUE)).toHaveCount(0)
      await expect(setSheet.getByText(new RegExp(SECRET_ENVELOPE))).toHaveCount(0)
      await closeBlockWindow(setSheet)

      const fanSheet = await openBlockSheet(page, nodeLabeled(nodes, 'Fan out').id)
      await expect(fanSheet.locator('[data-testid="parallel-branch-label-branch_1"]')).toHaveValue('quick lane')
      await expect(fanSheet.locator('[data-testid="parallel-branch-label-branch_2"]')).toHaveValue('budget lane')
      await expect(fanSheet.locator('[data-testid="parallel-branch-limit-toggle-branch_1"]')).toHaveAttribute('aria-pressed', 'false')
      await expect(fanSheet.locator('[data-testid="parallel-branch-limit-toggle-branch_2"]')).toHaveAttribute('aria-pressed', 'true')
      await expect(fanSheet.locator('[data-testid="param-input-parallel-branch-limit-branch_2"] .cm-content')).toHaveText('lane_ms')
      await closeBlockWindow(fanSheet)
    })

    await test.step('the run passes and takes the paths the fields decide', async () => {
      await page.goto('/tests')
      await resetOwnership(request)
      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
      const { verdict, lines } = await runOverMcp(request, testId)
      const messages = lines.map((line) => line.message ?? '')
      const count = (text: string): number => messages.filter((message) => message === text).length
      expect(verdict, messages.join('\n')).toBe('passed')
      const runPaths = {
        'route=if': count('route=if'),
        'route=slow': count('route=slow'),
        'route=fallback': count('route=fallback'),
        'case=ready': count('case=ready'),
        'case=default': count('case=default'),
        rows: count('greeting=hello web next=3 hosts=web-1,web-2,plain-3'),
        'lane=quick': count('lane=quick'),
        'lane=budget': count('lane=budget'),
        'tick=0': count('tick=0'),
        'tick=2': count('tick=2'),
        'tick=4': count('tick=4'),
        'each=a': count('each=a'),
        'each=b': count('each=b'),
      }
      expect(runPaths, messages.join('\n')).toEqual({
        'route=if': 1,
        'route=slow': 0,
        'route=fallback': 0,
        'case=ready': 1,
        'case=default': 0,
        rows: 1,
        'lane=quick': 1,
        'lane=budget': 1,
        'tick=0': 1,
        'tick=2': 1,
        'tick=4': 0,
        'each=a': 1,
        'each=b': 1,
      })
      expect(messages.filter((message) => message.includes(SECRET_VALUE)), 'the secret row is masked in the run').toEqual([])
    })

    let readback: Doc = {}
    await test.step('get_test_recipe reads every form back, expressible', async () => {
      const answer = tool('get_test_recipe', { test_ref: testId })
      expect(answer.inexpressible, String(answer.recipe)).toEqual([])
      expect(answer.expressible).toBe(true)
      readback = recipeData(String(answer.recipe))
      const flow = readback.flow

      const route = construct(flow, 'if', 'Route on status')
      expect(route.if_label).toBe('Ready path')
      expect(route.when).toEqual([
        { variable: 'status', operator: 'equals', value: { expr: "expected_status + '-x'" }, value_type: 'string' },
        'or',
        {
          group: [
            { variable: 'host', operator: 'starts_with', value: '{{ prefix }}', value_type: 'string' },
            {
              group: [
                'retries > limit',
                'or',
                { variable: 'host', operator: 'not_equals', value: { literal: '{{ host }}' }, value_type: 'string' },
              ],
            },
          ],
        },
      ])
      expect(route.elif).toMatchObject([{ label: 'Slow path', when: ['retries > 10', 'limit > 10'] }])
      expect(route.else_label).toBe('Fallback path')

      const router = construct(flow, 'switch', 'Route on case')
      expect(router.cases).toMatchObject([
        {
          label: 'Ready case',
          when: { variable: 'status', operator: 'equals', value: { expr: 'expected_status' }, value_type: 'string' },
        },
      ])
      expect(router.default_label).toBe('Other case')

      const set = leaf(flow, 'set')
      expect(set.set).toEqual({
        greeting: 'hello {{ prefix }}',
        next_retries: { expr: 'retries + 1' },
        hosts: [{ expr: 'host' }, '{{ prefix }}-2', 'plain-3'],
        api_token: null,
        pending_token: null,
      })
      expect(set.secret_rows).toEqual(['api_token', 'pending_token'])
      expect(set.label).toBe('Set the rows')

      const fan = construct(flow, 'parallel', 'Fan out')
      expect(fan.join).toBe('all')
      expect(fan.branches).toMatchObject([{ name: 'quick lane' }, { name: 'budget lane', time_limit: { expr: 'lane_ms' } }])
      expect(fan.branches[0].time_limit).toBeUndefined()

      const loop = (allSteps(flow).find((step) => 'for' in step) as Doc).for
      expect(loop).toMatchObject({ count: 6, step: 2, capture: { index: 'tick' } })
      const each = construct(flow, 'for_each', 'Each item')
      expect(each).toMatchObject({ collection: { expr: 'items' }, collection_type: 'array' })
      expect(leaf(flow, 'break').break).toEqual({ loop: 'For Loop' })
      expect(leaf(flow, 'note').note).toEqual({ text: 'Control fields under test', color: 'yellow' })
    })

    await test.step('amend_test_from_recipe with the readback keeps every stored field', async () => {
      const before = await storedTest(request, testId)
      const resend = structuredClone(readback)
      leaf(resend.flow, 'set').set.api_token = SECRET_VALUE
      const answer = tool('amend_test_from_recipe', { test_ref: testId, recipe: JSON.stringify(resend, null, 2) })
      expect(answer.amended, JSON.stringify(answer)).toBe(true)
      expect(actionProblems(answer, 'NO_VALUE_VARIABLE'), JSON.stringify(answer.action_items)).toEqual([OWED_ROW])
      const after = await storedTest(request, testId)
      expect(after.version, 'the amend applied').not.toBe(before.version)
      expect(blockFields(after)).toEqual(blockFields(before))
      const rows = nodeLabeled(nodesOf(after), 'Set the rows').data.config.values.variables as Doc
      expect(String(rows.api_token), 'the secret given again is sealed').toMatch(new RegExp(`^${SECRET_ENVELOPE}`))
    })
  })

  test('a Test saved in the stored shape reads back with OR, a group, labels, a Template row and a secret row', async ({
    request,
  }) => {
    test.setTimeout(180_000)
    const testId = await createValidTest(request, handBuiltTest(`zz-mcp-recipe-control-fields-hand-${runToken()}`))
    created.push(testId)
    const checked = await validateTest(request, testId)
    expect(checked.errors, JSON.stringify(checked)).toEqual([])

    const answer = tool('get_test_recipe', { test_ref: testId })
    expect(answer.inexpressible, String(answer.recipe)).toEqual([])
    expect(answer.expressible).toBe(true)
    const flow = recipeData(String(answer.recipe)).flow

    const set = leaf(flow, 'set')
    expect(set.set).toEqual({ greeting: 'hi {{ prefix }}', tok: null })
    expect(set.secret_rows).toEqual(['tok'])
    const route = construct(flow, 'if', 'Hand route')
    expect(route.if_label).toBe('Hand ready')
    expect(route.when).toEqual([
      { variable: 'status', operator: 'equals', value: { expr: 'expected_status' }, value_type: 'string' },
      'or',
      { group: [{ variable: 'host', operator: 'starts_with', value: '{{ prefix }}-1', value_type: 'string' }, 'retries < 3'] },
    ])
    expect(route.elif).toMatchObject([{ label: 'Hand second', when: ['retries > 5', 'retries > 6'] }])
    expect(route.else_label).toBe('Hand else')
  })

  const secretForms = [
    {
      form: '{expr}',
      written: `{expr: "base + '-1'"}`,
      stored: "base + '-1'",
      flag: 'expressionFields',
      read: { expr: "base + '-1'" } as unknown,
    },
    { form: 'Template', written: '"Bearer {{ base }}"', stored: 'Bearer {{ base }}', flag: 'templateFields', read: 'Bearer {{ base }}' as unknown },
  ]
  for (const { form, written, stored, flag, read } of secretForms) {
    test(`a secret Setter row written as ${form} reads back as written and survives an amend`, async ({ request }) => {
      test.setTimeout(120_000)
      const recipe = [
        'test:',
        `  name: zz-mcp-recipe-control-fields-secret-${flag}-${runToken()}`,
        'variables:',
        '  base: {type: string, value: tok}',
        '  api_token: {type: string}',
        'flow:',
        '  - set:',
        `      api_token: ${written}`,
        '    label: Set the secret',
        '    secret_rows: [api_token]',
      ].join('\n')
      const answer = tool('create_test_from_recipe', { recipe })
      expect(answer.created, JSON.stringify(answer)).toBe(true)
      const testId = answer.test_id as string
      created.push(testId)

      const before = await storedTest(request, testId)
      const setter = nodeLabeled(nodesOf(before), 'Set the secret').data
      expect(setter.config.values.variables, 'the row is stored as written, unsealed').toEqual({ api_token: stored })
      expect(sortedList(setter[flag])).toEqual(['variables.api_token'])
      expect(sortedList(setter.config.secretFields)).toEqual(['variables.api_token'])

      const readback = tool('get_test_recipe', { test_ref: testId })
      expect(readback.inexpressible, String(readback.recipe)).toEqual([])
      expect(readback.expressible).toBe(true)
      const set = leaf(recipeData(String(readback.recipe)).flow, 'set')
      expect(set.set).toEqual({ api_token: read })
      expect(set.secret_rows).toEqual(['api_token'])

      const amended = tool('amend_test_from_recipe', { test_ref: testId, recipe: String(readback.recipe) })
      expect(amended.amended, JSON.stringify(amended)).toBe(true)
      expect(blockFields(await storedTest(request, testId))).toEqual(blockFields(before))
    })
  }

  test('the guide names the condition joins, groups, value forms and secret rows', () => {
    const guide = String(tool('get_recipe_guide', {}).guide ?? '')
    const conditions = guideSection(guide, '### Conditions')
    expect(conditions, 'the guide has a Conditions section').not.toBe('')
    expect(conditions).toMatch(/^- or\b/m)
    expect(conditions).toContain('`or`')
    expect(conditions).toMatch(/^- group:/m)
    expect(guide).toContain('{template:')
    expect(guide).toContain('{literal:')
    expect(guide).toContain('secret_rows')
  })
})
