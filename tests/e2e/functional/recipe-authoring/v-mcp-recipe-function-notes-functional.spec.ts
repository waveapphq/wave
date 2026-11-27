/**
 * V-MCP-RECIPE-FUNCTION-NOTES-FUNCTIONAL: a Note in a local Function's `notes:` is stored on the
 * Function canvas with no connection and reads back there
 * Wireframes: none (recipe format over MCP)
 * Design Decisions: none (recipe compile and readback)
 * REQ: REQ-5.2.7.3, REQ-5.2.7.6
 *
 * Pass Criteria:
 * 1. validate_recipe accepts a recipe whose local Function lists one Note in its `notes:`.
 * 2. create_test_from_recipe stores that Note on the Function canvas with no wire, beside the
 *    Function's own wired Log.
 * 3. get_test_recipe writes the Note back in the Function entry's `notes:`, and the readback is
 *    the written recipe.
 *
 * Run: ./scripts/e2e/e2e-targeted-local.sh functional/recipe-authoring/v-mcp-recipe-function-notes-functional.spec.ts
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { runToken } from '../../helpers/element-types'
import { cleanUp } from '../../helpers/fn-block'
import { resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import {
  allWires,
  asReadBack,
  functionCanvas,
  logStep,
  noteStep,
  noteWithText,
  readBack,
  recipeOf,
  startMcp,
  storedCanvas,
  tool,
  wiresAt,
} from './notes-helpers'

test.describe('V-MCP-RECIPE-FUNCTION-NOTES-FUNCTIONAL: a local Function keeps the Notes beside its flow', () => {
  const testIds: string[] = []

  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    await cleanUp(request, testIds)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('a Note in a local Function notes: is stored with no wire and reads back there', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await startMcp(page, request)
    const doc = {
      test: {
        name: `zz-mcp-function-notes-${runToken()}`,
        description: 'A Note beside a local Function flow',
      },
      functions: [
        {
          name: 'annotated_helper',
          inputs: [],
          outputs: [],
          flow: [logStep('helper-step')],
          notes: [noteStep('Helper owner note', 'pink')],
        },
      ],
      flow: [{ function: 'annotated_helper' }],
    }

    await test.step('validate_recipe accepts the Note beside the Function flow', () => {
      const verdict = tool('validate_recipe', { recipe: recipeOf(doc) })
      expect(verdict.findings, JSON.stringify(verdict)).toEqual([])
      expect(verdict.valid).toBe(true)
    })

    let testId = ''
    await test.step('create_test_from_recipe stores the Note on the Function canvas with no wire', async () => {
      const created = tool('create_test_from_recipe', { recipe: recipeOf(doc) })
      if (typeof created.test_id === 'string') testIds.push(created.test_id)
      expect(created.created, JSON.stringify(created)).toBe(true)
      testId = String(created.test_id)
      const inner = functionCanvas(await storedCanvas(request, testId))
      const note = noteWithText(inner, 'Helper owner note')
      expect(wiresAt(inner, note.id), JSON.stringify(inner.edges)).toEqual([])
      expect(allWires(inner)).toEqual(['start -> log helper-step'])
    })

    await test.step('get_test_recipe writes the Note back in the Function notes:', () => {
      const { answer, recipe } = readBack(testId)
      expect(answer.inexpressible, JSON.stringify(answer)).toEqual([])
      expect(answer.expressible).toBe(true)
      expect(recipe, String(answer.recipe)).toEqual(asReadBack(doc))
    })
  })
})
