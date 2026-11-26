/**
 * V-MCP-RECIPE-DECLARED-OUTPUTS-FORMS-FUNCTIONAL: a Shell Script export list written as a literal still
 * declares its names, and one written as an expression declares none
 * Wireframe: none (tool surface)
 * Design Decisions: none (REQ-3.4.2.2 Rules beyond type: extra outputs from a list's entries; REQ-5.2.7.3
 * value forms)
 * REQ: REQ-5.2.7.3, REQ-3.4.2.2
 *
 * Seed: none; every recipe is built in the spec and every created Test is deleted after.
 *
 * Pass Criteria:
 * 1. `validate_recipe` accepts a Shell Script whose `script_variables` is `{literal: [COUNT]}` and that
 *    captures `COUNT` into `pod_count`, with no finding.
 * 2. `create_test_from_recipe` of that recipe stores the binding `COUNT: pod_count`.
 * 3. A Shell Script whose `script_variables` is an expression declares no output: a capture of `COUNT` is
 *    refused at `flow[0].capture.COUNT` with `UNKNOWN_CAPTURE_OUTPUT`, its fix listing only the fixed
 *    outputs and pointing at `settings.script_variables`, and a capture of the fixed `stdout` validates.
 *
 * Run: ./scripts/e2e/e2e-targeted-local.sh functional/recipe-authoring/v-mcp-recipe-declared-outputs-forms-functional.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { deleteTest } from '../../helpers/element-types'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { MCP_PORT, createFromRecipe, rows, storedTestDoc, tool, uniqueName, type Doc } from './recipe-tool-helpers'

const SHELL_FIXED = 'error, exit_code, reason, stderr, stdout, success'

/** A Shell Script with `exports` written as given and the given capture. */
function shellStep(exports: unknown, capture: Doc): Doc {
  return {
    block: 'shell-script',
    label: 'Export the count',
    settings: { script: 'COUNT=6', script_variables: exports },
    capture,
  }
}

/** The recipe text of a Test holding `steps`: JSON is YAML, so the recipe parser reads it as written. */
function recipeOf(name: string, steps: Doc[], variables?: Doc): string {
  const doc: Doc = { test: { name, description: 'Declared outputs in each value form' }, flow: steps }
  if (variables) doc.variables = variables
  return JSON.stringify(doc, null, 2)
}

test.describe('V-MCP-RECIPE-DECLARED-OUTPUTS-FORMS-FUNCTIONAL: export list value forms', () => {
  const created: string[] = []

  test.beforeAll(async ({ request }) => {
    await resetOwnership(request)
    await ensureEnvironment(request)
  })

  test.beforeEach(async ({ page, request }) => {
    await resetOwnership(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    for (const id of created.splice(0)) await deleteTest(request, id)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('a literal export list declares its names', async ({ request }) => {
    const steps = [shellStep({ literal: ['COUNT'] }, { COUNT: 'pod_count' })]
    const variables = { pod_count: { type: 'integer' } }

    await test.step('1. validate_recipe accepts the capture', () => {
      const verdict = tool('validate_recipe', { recipe: recipeOf(uniqueName('zz-b29-forms-literal'), steps, variables) })
      expect(rows(verdict)).toEqual([])
      expect(verdict.valid, JSON.stringify(verdict)).toBe(true)
    })

    await test.step('2. create_test_from_recipe stores the binding', async () => {
      const testId = createFromRecipe(recipeOf(uniqueName('zz-b29-forms-literal-create'), steps, variables))
      created.push(testId)
      const nodes = (await storedTestDoc(request, testId)).workflow.nodes as Doc[]
      const shell = nodes.find((node) => node.data.elementType === 'shell-script')
      expect(shell, 'the Test stores a Shell Script Block').toBeTruthy()
      expect(shell?.data.config.outputBindings).toEqual({ COUNT: 'pod_count' })
    })
  })

  test('3. an expression export list declares no output', () => {
    const variables = { names: { type: 'array', value: ['COUNT'] } }
    const refused = tool('validate_recipe', {
      recipe: recipeOf(uniqueName('zz-b29-forms-expr'), [shellStep({ expr: 'names' }, { COUNT: 'pod_count' })], variables),
    })
    expect(refused.valid, JSON.stringify(refused)).toBe(false)
    expect(rows(refused)).toEqual([
      [
        'flow[0].capture.COUNT',
        'UNKNOWN_CAPTURE_OUTPUT',
        "Block 'shell-script' has no output 'COUNT' to capture",
        `Valid outputs: ${SHELL_FIXED}. Declare a new one in settings.script_variables`,
      ],
    ])

    const fixed = tool('validate_recipe', {
      recipe: recipeOf(uniqueName('zz-b29-forms-expr-fixed'), [shellStep({ expr: 'names' }, { stdout: 'out' })], variables),
    })
    expect(rows(fixed)).toEqual([])
    expect(fixed.valid, JSON.stringify(fixed)).toBe(true)
  })
})
