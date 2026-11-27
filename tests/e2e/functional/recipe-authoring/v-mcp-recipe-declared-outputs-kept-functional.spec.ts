/**
 * V-MCP-RECIPE-DECLARED-OUTPUTS-KEPT-FUNCTIONAL: the outputs a Shell Script, a Python and a Combined-mode
 * parser already gave recipes still validate, compile and read back
 * Wireframe: none (tool surface)
 * Design Decisions: none (REQ-3.4.2.2 Rules beyond type: extra outputs from a list's entries; 15.16 Output
 * Bindings name rules)
 * REQ: REQ-5.2.7.3, REQ-3.4.2.2, REQ-3.4.1.16
 *
 * Seed: one hand-built Test holding a Shell Script that exports two variables, one of them marked Secret,
 * saved through POST /tests in the shape the canvas stores. Every recipe is built in the spec; every Test is
 * deleted after.
 *
 * Pass Criteria:
 * 1. `validate_recipe` accepts a Shell Script exporting `COUNT` and `TOKEN` and a Python exporting `count`
 *    and `label`, each captured into a variable of another name, with no finding.
 * 2. `create_test_from_recipe` stores each export bound to the variable the recipe names, stores the
 *    Shell Script's Secret mark on `TOKEN`, and declares every undeclared target as a string, the one bound
 *    to a Secret output as a Secret string.
 * 3. `get_test_recipe` reads the created Test back with the same captures and `secret_outputs: [TOKEN]`.
 * 4. A bad export list is refused at the entry it names, with its exact text: an invalid name
 *    (`INVALID_DECLARED_OUTPUT` at `[0]`), a fixed output name (`DECLARED_OUTPUT_CLASH`), a repeated name
 *    (`DUPLICATE_DECLARED_OUTPUT` at `[1]`), and a capture of a name the list does not export
 *    (`UNKNOWN_CAPTURE_OUTPUT`, whose fix points at `settings.script_variables`); nothing is stored.
 * 5. A JSON Parser in Combined mode, written out or left to its default, captures `results` with no
 *    finding, and the created Test binds `results` and declares its target a map.
 * 6. The hand-built Shell Script Test reads back expressible with its captures and its Secret export, and
 *    `amend_test_from_recipe` with that readback, its Log changed, keeps both bindings and the Secret mark.
 *
 * Run: ./scripts/e2e/e2e-targeted-local.sh functional/recipe-authoring/v-mcp-recipe-declared-outputs-kept-functional.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { deleteTest } from '../../helpers/element-types'
import { createTest, logBlock, pluginBlock } from '../../helpers/fn-block'
import { enableMcpUntilRestart, recipeData, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import {
  MCP_PORT,
  createFromRecipe,
  freeSlot,
  rows,
  storedTestDoc,
  storedTestsNamed,
  tool,
  uniqueName,
  type Doc,
} from './recipe-tool-helpers'

const SHELL_FIXED = 'error, exit_code, reason, stderr, stdout, success'

/** A Shell Script exporting `exports`; `capture` defaults to COUNT and TOKEN into other names. */
function shellStep(exports: unknown[], capture?: Doc, secret?: string[]): Doc {
  const step: Doc = {
    block: 'shell-script',
    label: 'Export the count',
    settings: { script: 'COUNT=6; TOKEN=abc', script_variables: exports },
  }
  if (capture) step.capture = capture
  if (secret) step.secret_outputs = secret
  return step
}

const pythonStep: Doc = {
  block: 'python',
  label: 'Export the label',
  settings: { script_type: 'source', script: "count = 6\nlabel = 'ok'", script_variables: ['count', 'label'] },
  capture: { count: 'py_count', label: 'py_label' },
}

/** A JSON Parser of a literal document capturing `results`; `mode` null leaves Output Mode to its default. */
function combinedParserStep(mode: string | null): Doc {
  const settings: Doc = { json_content: '{"order": {"id": 7}}', queries: { order_id: '$.order.id' } }
  if (mode !== null) settings.output_mode = mode
  return { block: 'json-parser', label: 'Parse the order', settings, capture: { results: 'parsed' } }
}

/** The recipe text of a Test holding `steps`: JSON is YAML, so the recipe parser reads it as written. */
function recipeOf(name: string, steps: Doc[], variables?: Doc): string {
  const doc: Doc = { test: { name, description: 'Declared outputs captured from a recipe' }, flow: steps }
  if (variables) doc.variables = variables
  return JSON.stringify(doc, null, 2)
}

/** The stored Block of `elementType`. */
async function storedBlock(request: Parameters<typeof storedTestDoc>[0], testId: string, elementType: string): Promise<Doc> {
  const nodes = (await storedTestDoc(request, testId)).workflow.nodes as Doc[]
  const node = nodes.find((candidate) => candidate.data.elementType === elementType)
  expect(node, `the Test stores a ${elementType} Block`).toBeTruthy()
  return node as Doc
}

const SEEDED_NAME = uniqueName('zz-b29-loss-seeded-exports')
let seededId = ''

test.describe('V-MCP-RECIPE-DECLARED-OUTPUTS-KEPT-FUNCTIONAL: declared outputs kept in recipes', () => {
  const created: string[] = []

  test.beforeAll(async ({ request }) => {
    await resetOwnership(request)
    const shell = pluginBlock('shell-1', 'Export the count', 'shell-script', 'system', {
      values: {
        script: 'COUNT=6; TOKEN=abc',
        script_type: 'source',
        script_variables: ['COUNT', 'TOKEN'],
        stream_output: false,
        stop_on_pattern: false,
        on_error: 'fail',
      },
      outputBindings: { COUNT: 'pod_count', TOKEN: 'token_value' },
      position: { x: -120, y: 140 },
    })
    const shellData = shell.data as Doc
    shellData.config.outputSecretFields = ['TOKEN']
    seededId = await createTest(request, {
      name: SEEDED_NAME,
      nodes: [shell, logBlock('log-1', 'Report', "f'count={pod_count}'", { position: { x: -120, y: 280 } })],
      edges: [
        { id: 'e-start', source: 'start-node', target: 'shell-1' },
        { id: 'e-log', source: 'shell-1', target: 'log-1' },
      ],
      variables: {
        pod_count: { type: 'integer' },
        token_value: { type: 'string', secret: true },
      },
    })
  })

  test.afterAll(async ({ request }) => {
    if (seededId) await deleteTest(request, seededId)
  })

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

  test('Shell Script and Python exports validate, compile and read back', async ({ request }) => {
    test.setTimeout(240_000)
    const steps = [
      shellStep(['COUNT', 'TOKEN'], { COUNT: 'pod_count', TOKEN: 'token_value' }, ['TOKEN']),
      pythonStep,
    ]
    const variables = { pod_count: { type: 'integer' }, py_count: { type: 'integer' } }
    let testId = ''

    await test.step('1. validate_recipe accepts both export lists', () => {
      const verdict = tool('validate_recipe', { recipe: recipeOf(uniqueName('zz-b29-loss-exports'), steps, variables) })
      expect(rows(verdict)).toEqual([])
      expect(verdict.valid, JSON.stringify(verdict)).toBe(true)
    })

    await test.step('2. create_test_from_recipe stores the bindings, the Secret mark and the targets', async () => {
      testId = createFromRecipe(recipeOf(uniqueName('zz-b29-loss-exports-create'), steps, variables))
      created.push(testId)
      const shell = await storedBlock(request, testId, 'shell-script')
      expect(shell.data.config.outputBindings).toEqual({ COUNT: 'pod_count', TOKEN: 'token_value' })
      expect(shell.data.config.outputSecretFields).toEqual(['TOKEN'])
      const python = await storedBlock(request, testId, 'python')
      expect(python.data.config.outputBindings).toEqual({ count: 'py_count', label: 'py_label' })
      const stored = (await storedTestDoc(request, testId)).variables as Doc
      expect(stored.pod_count?.type).toBe('integer')
      expect(stored.py_count?.type).toBe('integer')
      expect(stored.py_label?.type, 'an undeclared export target is a string').toBe('string')
      expect(stored.token_value?.type).toBe('string')
      expect(stored.token_value?.secret, 'the target of a Secret export is Secret').toBe(true)
    })

    await test.step('3. get_test_recipe reads the captures and the Secret export back', () => {
      const readback = tool('get_test_recipe', { test_ref: testId })
      expect(readback.expressible, JSON.stringify(readback.inexpressible)).toBe(true)
      const flow = recipeData(String(readback.recipe)).flow as Doc[]
      const shell = flow.find((step) => step.block === 'shell-script') as Doc
      expect(shell.capture).toEqual({ COUNT: 'pod_count', TOKEN: 'token_value' })
      expect(shell.secret_outputs).toEqual(['TOKEN'])
      expect(flow.find((step) => step.block === 'python')?.capture).toEqual({ count: 'py_count', label: 'py_label' })
    })
  })

  test('4. a bad export list is refused at the entry it names', async ({ request }) => {
    const cases: Array<[string, Doc, [string, string, string, string]]> = [
      [
        'an invalid name',
        shellStep(['1bad']),
        [
          'flow[0].settings.script_variables[0]',
          'INVALID_DECLARED_OUTPUT',
          "Setting 'script_variables' of block 'shell-script' declares an invalid output name: '1bad' (must match [a-zA-Z_][a-zA-Z0-9_]*)",
          'Rename it',
        ],
      ],
      [
        'a fixed output name',
        shellStep(['stdout']),
        [
          'flow[0].settings.script_variables[0]',
          'DECLARED_OUTPUT_CLASH',
          "Setting 'script_variables' of block 'shell-script' declares 'stdout', which is already an output of the block",
          `Choose a name other than: ${SHELL_FIXED}`,
        ],
      ],
      [
        'a repeated name',
        shellStep(['COUNT', 'COUNT']),
        [
          'flow[0].settings.script_variables[1]',
          'DUPLICATE_DECLARED_OUTPUT',
          "Setting 'script_variables' of block 'shell-script' declares 'COUNT' more than once",
          'Remove the repeated name',
        ],
      ],
      [
        'a capture of a name the list does not export',
        shellStep(['COUNT'], { OTHER: 'other' }),
        [
          'flow[0].capture.OTHER',
          'UNKNOWN_CAPTURE_OUTPUT',
          "Block 'shell-script' has no output 'OTHER' to capture",
          `Valid outputs: COUNT, ${SHELL_FIXED}. Declare a new one in settings.script_variables`,
        ],
      ],
    ]
    for (const [what, step, expected] of cases) {
      const verdict = tool('validate_recipe', { recipe: recipeOf(uniqueName('zz-b29-loss-bad'), [step]) })
      expect(verdict.valid, `${what}: ${JSON.stringify(verdict)}`).toBe(false)
      expect(rows(verdict), what).toEqual([expected])
    }

    const name = uniqueName('zz-b29-loss-bad-create')
    const refused = tool('create_test_from_recipe', { recipe: recipeOf(name, [shellStep(['COUNT', 'COUNT'])]) })
    if (refused.created) created.push(String(refused.test_id))
    expect(refused.created, JSON.stringify(refused)).toBe(false)
    expect(await storedTestsNamed(request, name), 'no Test of the refused recipe is stored').toEqual([])
  })

  test('5. a Combined-mode JSON Parser captures results', async ({ request }) => {
    for (const mode of ['combined', null]) {
      const what = mode ?? 'Output Mode left to its default'
      const steps = [combinedParserStep(mode)]
      const verdict = tool('validate_recipe', { recipe: recipeOf(uniqueName('zz-b29-loss-combined'), steps) })
      expect(rows(verdict), what).toEqual([])
      expect(verdict.valid, `${what}: ${JSON.stringify(verdict)}`).toBe(true)

      const testId = createFromRecipe(recipeOf(uniqueName('zz-b29-loss-combined-create'), steps))
      created.push(testId)
      const parser = await storedBlock(request, testId, 'json-parser')
      expect(parser.data.config.outputBindings, what).toEqual({ results: 'parsed' })
      expect(((await storedTestDoc(request, testId)).variables as Doc).parsed?.type, what).toBe('map')
    }
  })

  test('6. a hand-built Shell Script Test reads back and amends with its exports', async ({ page, request }) => {
    test.setTimeout(240_000)
    const readback = tool('get_test_recipe', { test_ref: seededId })
    expect(readback.expressible, JSON.stringify(readback.inexpressible)).toBe(true)
    const doc = recipeData(String(readback.recipe))
    const flow = doc.flow as Doc[]
    const shell = flow.find((step) => step.block === 'shell-script') as Doc
    expect(shell.capture).toEqual({ COUNT: 'pod_count', TOKEN: 'token_value' })
    expect(shell.secret_outputs).toEqual(['TOKEN'])

    const log = flow.find((step) => step.block === 'log') as Doc
    log.settings = { ...log.settings, message: { expr: "f'amended count={pod_count}'" } }
    await freeSlot(page, request)
    const amended = tool('amend_test_from_recipe', { test_ref: seededId, recipe: JSON.stringify(doc, null, 2) })
    expect(((amended.findings ?? []) as Doc[]).filter((f) => f.severity === 'error'), JSON.stringify(amended)).toEqual([])
    expect(amended.amended, JSON.stringify(amended)).toBe(true)

    const stored = await storedBlock(request, seededId, 'shell-script')
    expect(stored.data.config.outputBindings, 'the amend keeps both bindings').toEqual({
      COUNT: 'pod_count',
      TOKEN: 'token_value',
    })
    expect(stored.data.config.outputSecretFields, 'the amend keeps the Secret export').toEqual(['TOKEN'])
    const storedLog = await storedBlock(request, seededId, 'log')
    expect(storedLog.data.config.values.message).toBe("f'amended count={pod_count}'")
  })
})
