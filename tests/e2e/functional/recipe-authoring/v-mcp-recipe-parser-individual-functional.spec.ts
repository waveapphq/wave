/**
 * V-MCP-RECIPE-PARSER-INDIVIDUAL-FUNCTIONAL: a recipe captures each Individual-mode parser query into the
 * variable of the same name
 * Wireframe: none (tool surface)
 * Design Decisions: none (15.16 Output Bindings name rules; a query alias binds to itself)
 * REQ: REQ-5.2.7.3, REQ-5.2.7.6, REQ-3.4.2.2, REQ-3.4.1.16, REQ-3.4.1.11
 *
 * Seed: one hand-built Test holding a JSON Parser and an XML Parser in Individual mode, saved through
 * POST /tests in the shape the canvas stores. Every recipe is built in the spec; every Test is deleted after.
 *
 * Pass Criteria:
 * 1. `validate_recipe` accepts a JSON Parser and an XML Parser in Individual mode capturing two queries
 *    each into the variable of the same name.
 * 2. `create_test_from_recipe` stores them with each query bound to itself and declares each variable with
 *    its query's type (integer from `query_output_types`, string when the entry is unset).
 * 3. `build_test_from_recipe` stores the same Blocks.
 * 4. A tracked run fills the four variables with the parsed values.
 * 5. `get_test_recipe` reads the hand-built Test back expressible with the self captures, and
 *    `amend_test_from_recipe` with that readback, its Log changed, changes the Test and keeps the parsers.
 * 6. Each refusal returns its exact text: a query captured into another name (`CAPTURE_NOT_SELF_BOUND`),
 *    the same-named variable declared with another type (`INVALID_OUTPUT_BINDING_TYPE`), `results` in
 *    Individual mode and a query name in Combined mode (`UNKNOWN_CAPTURE_OUTPUT`), a query named `success`
 *    or `errors` (`DECLARED_OUTPUT_CLASH`), a query name that is not a variable name
 *    (`INVALID_DECLARED_OUTPUT`) and a query name written twice on a JSON Parser and on an XML Parser
 *    (`DUPLICATE_DECLARED_OUTPUT` at `flow[0].settings.queries.<query>`); nothing is stored.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { deleteTest } from '../../helpers/element-types'
import { createTest, logBlock, pluginBlock } from '../../helpers/fn-block'
import { callToolAsync, enableMcpUntilRestart, recipeData, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import {
  MCP_PORT,
  createFromRecipe,
  findingsOf,
  freeSlot,
  rows,
  runOverMcp,
  storedTestDoc,
  storedTestsNamed,
  tool,
  uniqueName,
  type Doc,
} from './recipe-tool-helpers'

const ORDER_JSON = '{"order": {"id": 1042, "status": "shipped"}}'
const ITEM_XML = '<order><item><sku>AB-7</sku><qty>3</qty></item></order>'
const RUN_LINE = 'order=1042 status=shipped sku=AB-7 qty=3'
const NAME_PATTERN = '[a-zA-Z_][a-zA-Z0-9_]*'

interface ParserSpec {
  block: 'json-parser' | 'xml-parser'
  content: string
  queries: Record<string, string>
  types: Record<string, string>
}

const JSON_PARSER: ParserSpec = {
  block: 'json-parser',
  content: 'json_content',
  queries: { order_id: '$.order.id', status: '$.order.status' },
  // `status` has no entry: it is a string output.
  types: { order_id: 'integer' },
}
const XML_PARSER: ParserSpec = {
  block: 'xml-parser',
  content: 'xml_content',
  queries: { sku: '//item/sku/text()', qty: '//item/qty/text()' },
  types: { sku: 'string', qty: 'integer' },
}

const QUERY_TYPES: Record<string, string> = { order_id: 'integer', status: 'string', sku: 'string', qty: 'integer' }

/** A parser step; `capture` and `mode` default to the self captures in Individual mode. */
function parserStep(spec: ParserSpec, opts: { capture?: Doc; mode?: string; queries?: Doc } = {}): Doc {
  const queries = opts.queries ?? spec.queries
  return {
    block: spec.block,
    label: spec.block === 'json-parser' ? 'Parse the order' : 'Parse the item',
    settings: {
      [spec.content]: spec.block === 'json-parser' ? ORDER_JSON : ITEM_XML,
      queries,
      output_mode: opts.mode ?? 'individual',
      query_output_types: spec.types,
    },
    capture: opts.capture ?? Object.fromEntries(Object.keys(queries).map((name) => [name, name])),
  }
}

const reportStep: Doc = {
  block: 'log',
  settings: { message: 'order={{ order_id }} status={{ status }} sku={{ sku }} qty={{ qty }}', level: 'INFO' },
}

/** The recipe text of a Test holding `steps`: JSON is YAML, so the recipe parser reads it as written. */
function recipeOf(name: string, steps: Doc[], variables?: Doc): string {
  const doc: Doc = { test: { name, description: 'Parser query outputs captured by name' }, flow: steps }
  if (variables) doc.variables = variables
  return JSON.stringify(doc, null, 2)
}

/**
 * A recipe whose parser writes the query `status` twice. JSON.stringify cannot write a repeated key, so the
 * queries object is spliced into the text; the recipe parser reads it as YAML.
 */
function duplicateQueryRecipe(name: string, spec: ParserSpec): string {
  const marker = 'REPEATED_QUERIES'
  const [first, second] = Object.values(spec.queries)
  const step = parserStep(spec, { capture: {} })
  step.settings = { ...step.settings, queries: marker, query_output_types: {} }
  const repeated = `{"status": ${JSON.stringify(first)}, "status": ${JSON.stringify(second)}}`
  return recipeOf(name, [step]).replace(JSON.stringify(marker), repeated)
}

/** The stored parser Blocks of a Test: their type, values and bindings, by Block type. */
async function storedParsers(request: Parameters<typeof storedTestDoc>[0], testId: string): Promise<Doc> {
  const nodes = (await storedTestDoc(request, testId)).workflow.nodes as Doc[]
  return Object.fromEntries(
    nodes
      .filter((node) => ['json-parser', 'xml-parser'].includes(node.data.elementType))
      .map((node) => [node.data.elementType, { values: node.data.config.values, bindings: node.data.config.outputBindings }]),
  )
}

test.describe('V-MCP-RECIPE-PARSER-INDIVIDUAL-FUNCTIONAL: parser query outputs in recipes', () => {
  const created: string[] = []

  test.beforeEach(async ({ page, request }) => {
    await resetOwnership(request)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    for (const id of created.splice(0)) await deleteTest(request, id)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('validate, create, build and run a JSON Parser and an XML Parser in Individual mode', async ({ request }) => {
    test.setTimeout(300_000)
    const steps = [parserStep(JSON_PARSER), parserStep(XML_PARSER), reportStep]
    let testId = ''

    await test.step('1. validate_recipe accepts two self captures on each parser', () => {
      const verdict = tool('validate_recipe', { recipe: recipeOf(uniqueName('zz-b29-parser-validate'), steps) })
      expect(rows(verdict)).toEqual([])
      expect(verdict.valid, JSON.stringify(verdict)).toBe(true)
    })

    await test.step('2. create_test_from_recipe binds each query to itself and declares its type', async () => {
      testId = createFromRecipe(recipeOf(uniqueName('zz-b29-parser-create'), steps))
      created.push(testId)
      const parsers = await storedParsers(request, testId)
      expect(parsers['json-parser'].bindings).toMatchObject({ order_id: 'order_id', status: 'status' })
      expect(parsers['xml-parser'].bindings).toMatchObject({ sku: 'sku', qty: 'qty' })
      expect(parsers['json-parser'].values.queries).toEqual(JSON_PARSER.queries)
      expect(parsers['xml-parser'].values.output_mode).toBe('individual')
      expect('results' in parsers['json-parser'].bindings, 'results is no output in Individual mode').toBe(false)

      const variables = (await storedTestDoc(request, testId)).variables as Doc
      for (const [name, type] of Object.entries(QUERY_TYPES)) {
        expect(variables[name]?.type, `variable ${name} is declared ${type}`).toBe(type)
      }
    })

    await test.step('3. build_test_from_recipe stores the same Blocks', async () => {
      const buildName = uniqueName('zz-b29-parser-build')
      const built = await callToolAsync(MCP_PORT, 'build_test_from_recipe', { recipe: recipeOf(buildName, steps) })
      expect(built.isError, JSON.stringify(built.payload)).toBe(false)
      expect(built.payload.built, JSON.stringify(built.payload)).toBe(true)
      const builtId = String(built.payload.test_id)
      created.push(builtId)
      expect(await storedParsers(request, builtId)).toEqual(await storedParsers(request, testId))
    })

    await test.step('4. a tracked run fills each variable with its parsed value', async () => {
      const { verdict, messages } = await runOverMcp(request, testId)
      expect(verdict, messages.join('\n')).toBe('passed')
      expect(messages).toContain(RUN_LINE)
    })
  })

  test('5. a hand-built Individual-mode Test reads back expressible and amends', async ({ page, request }) => {
    test.setTimeout(240_000)
    const name = uniqueName('zz-b29-parser-hand-built')
    const parser = (id: string, spec: ParserSpec, y: number) =>
      pluginBlock(id, spec.block === 'json-parser' ? 'Parse the order' : 'Parse the item', spec.block, 'data', {
        values: {
          [spec.content]: spec.block === 'json-parser' ? ORDER_JSON : ITEM_XML,
          queries: spec.queries,
          output_mode: 'individual',
          query_output_types: spec.types,
        },
        outputBindings: Object.fromEntries(Object.keys(spec.queries).map((query) => [query, query])),
        position: { x: 200, y },
      })
    const testId = await createTest(request, {
      name,
      nodes: [
        parser('parse-json', JSON_PARSER, 150),
        parser('parse-xml', XML_PARSER, 290),
        logBlock('report', 'Report', "f'order={order_id} status={status} sku={sku} qty={qty}'", { position: { x: 200, y: 430 } }),
      ],
      variables: Object.fromEntries(
        Object.entries(QUERY_TYPES).map(([variable, type]) => [variable, { type, value: type === 'integer' ? 0 : '' }]),
      ),
    })
    created.push(testId)
    const before = await storedParsers(request, testId)

    const readback = tool('get_test_recipe', { test_ref: testId })
    expect(readback.expressible, JSON.stringify(readback.inexpressible)).toBe(true)
    const doc = recipeData(String(readback.recipe))
    const flow = doc.flow as Doc[]
    expect(flow.find((step) => step.block === 'json-parser')?.capture).toEqual({ order_id: 'order_id', status: 'status' })
    expect(flow.find((step) => step.block === 'xml-parser')?.capture).toEqual({ sku: 'sku', qty: 'qty' })

    const log = flow.find((step) => step.block === 'log') as Doc
    log.settings = { ...log.settings, message: { expr: "f'amended order={order_id}'" } }
    await freeSlot(page, request)
    const amended = tool('amend_test_from_recipe', { test_ref: testId, recipe: JSON.stringify(doc, null, 2) })
    expect(((amended.findings ?? []) as Doc[]).filter((f) => f.severity === 'error'), JSON.stringify(amended)).toEqual([])
    expect(amended.amended, JSON.stringify(amended)).toBe(true)
    expect(await storedParsers(request, testId), 'the amend keeps both parsers as they were').toEqual(before)
    const nodes = (await storedTestDoc(request, testId)).workflow.nodes as Doc[]
    expect(nodes.find((node) => node.data.elementType === 'log')?.data.config.values.message).toBe(
      "f'amended order={order_id}'",
    )
  })

  test('6. each refusal returns its exact text and stores nothing', async ({ request }) => {
    test.setTimeout(240_000)

    const refusals: Array<{ what: string; steps: Doc[]; variables?: Doc; expected: Array<[string, string, string, string | null]> }> = [
      {
        what: 'a JSON query captured into another name',
        steps: [parserStep(JSON_PARSER, { capture: { order_id: 'the_order', status: 'status' } })],
        expected: [
          [
            'flow[0].capture.order_id',
            'CAPTURE_NOT_SELF_BOUND',
            "Block 'json-parser' output 'order_id' must be captured into variable 'order_id'",
            'Capture it as order_id: order_id',
          ],
        ],
      },
      {
        what: 'an XML query captured into another name',
        steps: [parserStep(XML_PARSER, { capture: { sku: 'sku', qty: 'item_count' } })],
        expected: [
          [
            'flow[0].capture.qty',
            'CAPTURE_NOT_SELF_BOUND',
            "Block 'xml-parser' output 'qty' must be captured into variable 'qty'",
            'Capture it as qty: qty',
          ],
        ],
      },
    ]
    for (const refusal of refusals) {
      const name = uniqueName('zz-b29-parser-refused')
      const recipe = recipeOf(name, refusal.steps, refusal.variables)
      const verdict = tool('validate_recipe', { recipe })
      expect(verdict.valid, `${refusal.what}: ${JSON.stringify(verdict)}`).toBe(false)
      expect(rows(verdict), refusal.what).toEqual(refusal.expected)
      const refused = tool('create_test_from_recipe', { recipe })
      if (refused.created) created.push(String(refused.test_id))
      expect(refused.created, refusal.what).toBe(false)
      expect(rows(refused), refusal.what).toEqual(refusal.expected)
      expect(await storedTestsNamed(request, name), `${refusal.what}: nothing is stored`).toEqual([])
    }

    // Each case below asserts its code and exact problem text; the existing codes keep their own step and fix.
    const coded: Array<{ what: string; steps: Doc[]; variables?: Doc; code: string; problem: string }> = [
      {
        what: 'the same-named variable declared with another type',
        steps: [parserStep(JSON_PARSER)],
        variables: { order_id: { type: 'string', value: 'none' } },
        code: 'INVALID_OUTPUT_BINDING_TYPE',
        problem: "Output 'order_id' (type integer) cannot bind to variable 'order_id' (type string)",
      },
      {
        what: 'results captured in Individual mode',
        steps: [parserStep(JSON_PARSER, { capture: { results: 'results' } })],
        code: 'UNKNOWN_CAPTURE_OUTPUT',
        problem: "Block 'json-parser' has no output 'results' to capture",
      },
      {
        what: 'a query name captured in Combined mode',
        steps: [parserStep(XML_PARSER, { mode: 'combined', capture: { sku: 'sku' } })],
        code: 'UNKNOWN_CAPTURE_OUTPUT',
        problem: "Block 'xml-parser' has no output 'sku' to capture",
      },
      {
        what: 'a query named success',
        steps: [parserStep(JSON_PARSER, { queries: { success: '$.order.id' }, capture: {} })],
        code: 'DECLARED_OUTPUT_CLASH',
        problem: "Setting 'queries' of block 'json-parser' declares 'success', which is already an output of the block",
      },
      {
        what: 'a query named errors',
        steps: [parserStep(XML_PARSER, { queries: { errors: '//item/sku/text()' }, capture: {} })],
        code: 'DECLARED_OUTPUT_CLASH',
        problem: "Setting 'queries' of block 'xml-parser' declares 'errors', which is already an output of the block",
      },
      {
        what: 'a query name that is not a variable name',
        steps: [parserStep(JSON_PARSER, { queries: { 'order-id': '$.order.id' }, capture: {} })],
        code: 'INVALID_DECLARED_OUTPUT',
        problem: `Setting 'queries' of block 'json-parser' declares an invalid output name: 'order-id' (must match ${NAME_PATTERN})`,
      },
    ]
    for (const refusal of coded) {
      const name = uniqueName('zz-b29-parser-refused')
      const recipe = recipeOf(name, refusal.steps, refusal.variables)
      const verdict = tool('validate_recipe', { recipe })
      expect(verdict.valid, `${refusal.what}: ${JSON.stringify(verdict)}`).toBe(false)
      expect(findingsOf(verdict, refusal.code).map((f) => f.problem), refusal.what).toEqual([refusal.problem])
      const refused = tool('create_test_from_recipe', { recipe })
      if (refused.created) created.push(String(refused.test_id))
      expect(refused.created, refusal.what).toBe(false)
      expect(findingsOf(refused, refusal.code).map((f) => f.problem), refusal.what).toEqual([refusal.problem])
      expect(await storedTestsNamed(request, name), `${refusal.what}: nothing is stored`).toEqual([])
    }

    for (const spec of [JSON_PARSER, XML_PARSER]) {
      const what = `a query name written twice on the ${spec.block}`
      const name = uniqueName('zz-b29-parser-refused')
      const recipe = duplicateQueryRecipe(name, spec)
      expect(recipe, 'the recipe text repeats the query name').toMatch(/"status": "[^"]+", "status": "[^"]+"/)
      const expected: Array<[string, string, string, string | null]> = [
        [
          'flow[0].settings.queries.status',
          'DUPLICATE_DECLARED_OUTPUT',
          `Setting 'queries' of block '${spec.block}' declares 'status' more than once`,
          'Remove the repeated name',
        ],
      ]
      const verdict = tool('validate_recipe', { recipe })
      expect(verdict.valid, `${what}: ${JSON.stringify(verdict)}`).toBe(false)
      expect(rows(verdict), what).toEqual(expected)
      const refused = tool('create_test_from_recipe', { recipe })
      if (refused.created) created.push(String(refused.test_id))
      expect(refused.created, what).toBe(false)
      expect(rows(refused), what).toEqual(expected)
      expect(await storedTestsNamed(request, name), `${what}: nothing is stored`).toEqual([])
    }
  })
})
