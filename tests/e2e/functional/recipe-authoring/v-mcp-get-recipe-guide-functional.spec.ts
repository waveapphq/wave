/**
 * V-MCP-GET-RECIPE-GUIDE-FUNCTIONAL: the served guide says how a parser's query outputs are captured
 * Wireframe: none (tool surface)
 * Design Decisions: none (the guide must not drift from behavior)
 * REQ: REQ-5.2.7.3, REQ-5.2.7.7
 *
 * Seed: none. The tools are called over the live MCP endpoint.
 *
 * Pass Criteria:
 * 1. `get_recipe_guide` returns the parser paragraph word for word, in the declared-outputs paragraph
 *    beside Shell Script and Python, and that paragraph names `13-json-parser-individual`.
 * 2. Its examples include `13-json-parser-individual`: a JSON Parser in Individual mode over a literal
 *    document capturing `order_id` (typed integer) and `status` (typed string) each into the variable of
 *    the same name, which `validate_recipe` accepts with no finding.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { ensureEnvironment } from '../../helpers/config'
import { enableMcpUntilRestart, recipeData, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { MCP_PORT, rows, tool } from './recipe-tool-helpers'

const PARSER_TEXT =
  "The JSON Parser and the XML Parser declare outputs through `queries` while `output_mode` is " +
  '`individual`: each query name is an output, typed by its `query_output_types` entry, or string when ' +
  'that entry is unset or the query is an expression, and `results` is not an output then. Capture a ' +
  'query only into the variable of the same name, as `<query>: <query>`. In `combined` mode, capture ' +
  '`results`.'

const EXAMPLE = '13-json-parser-individual'

/** Markdown wraps its lines anywhere; the words are compared with every run of white space as one. */
const flat = (text: string): string => text.replace(/\s+/g, ' ').trim()

test.describe('V-MCP-GET-RECIPE-GUIDE-FUNCTIONAL: the guide teaches the parser query outputs', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetOwnership(request)
    await ensureEnvironment(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('the parser paragraph and example 13 are served, and the example validates clean', async () => {
    test.setTimeout(120_000)
    const answer = tool('get_recipe_guide', {})
    const guide = flat(String(answer.guide))
    const examples = answer.examples as Array<{ name: string; description: string; recipe: string }>

    await test.step('1. the declared-outputs paragraph holds the parser text', () => {
      expect(guide).toContain(PARSER_TEXT)
      const paragraphs = String(answer.guide).split(/\n\s*\n/).map(flat)
      const declared = paragraphs.find((paragraph) => paragraph.includes('declares_outputs: true'))
      expect(declared, 'the declared-outputs paragraph is served').toBeTruthy()
      expect(declared).toContain('`script_variables`')
      const parserParagraph = paragraphs.find((paragraph) => paragraph.includes(PARSER_TEXT)) ?? ''
      expect(
        `${declared} ${parserParagraph}`,
        'the declared-outputs text points at the parser example',
      ).toContain(`\`${EXAMPLE}\``)
    })

    await test.step('2. example 13 is listed, parses a literal document in Individual mode, and validates clean', () => {
      const example = examples.find((item) => item.name === EXAMPLE)
      expect(example, `examples: ${examples.map((item) => item.name).join(', ')}`).toBeTruthy()
      expect(String(example?.description).trim().length, 'the example describes itself').toBeGreaterThan(0)

      const doc = recipeData(String(example?.recipe))
      const parser = (doc.flow as Array<Record<string, any>>).find((step) => step.block === 'json-parser')
      expect(parser, 'the example holds a JSON Parser step').toBeTruthy()
      expect(parser?.settings.output_mode).toBe('individual')
      expect(typeof parser?.settings.json_content, 'the document is a literal').toBe('string')
      expect(Object.keys(parser?.settings.queries ?? {}).sort()).toEqual(['order_id', 'status'])
      expect(parser?.settings.query_output_types).toEqual({ order_id: 'integer', status: 'string' })
      expect(parser?.capture).toEqual({ order_id: 'order_id', status: 'status' })

      const verdict = tool('validate_recipe', { recipe: String(example?.recipe) })
      expect(rows(verdict)).toEqual([])
      expect(verdict.valid, JSON.stringify(verdict)).toBe(true)
    })
  })
})
