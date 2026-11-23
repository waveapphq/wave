/**
 * V-MCP-GET-BLOCK-FUNCTIONAL: get_block serves the field-relative ceiling and the parser query outputs
 * Wireframe: none (tool surface)
 * Design Decisions: none (the catalog serves the plugin metadata as declared)
 * REQ: REQ-3.4.2.2, REQ-5.2.7.3, REQ-5.2.7.8
 *
 * Seed: none. The tool is called over the live MCP endpoint.
 *
 * Pass Criteria:
 * 1. `ping`: `min_replies` carries `"maximum_field": "count"` beside its minimum 1, its `required_when`
 *    and its `show_when` on Pass when At least N replies.
 * 2. `json-parser` and `xml-parser`: `queries` carries `"declares_outputs": true` and
 *    `"declares_outputs_when": {"field": "output_mode", "values": ["individual"]}`.
 * 3. Their `results` output carries `"show_when": {"field": "output_mode", "values": ["combined"]}`;
 *    `success` and `errors` stay ungated.
 * 4. The `list_blocks` entry of each of the three equals what `get_block` answers.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { MCP_PORT, callMcp, objectOf } from './list-client'

type Entry = Record<string, any>

const BY_REPLIES = { field: 'pass_when', values: ['min_replies'] }
const INDIVIDUAL = { field: 'output_mode', values: ['individual'] }
const COMBINED = { field: 'output_mode', values: ['combined'] }
const PARSERS = ['json-parser', 'xml-parser']

function block(id: string): Entry {
  return objectOf(callMcp('get_block', { block_id: id }), 'get_block')
}

function named(list: Entry[] | undefined, name: string): Entry {
  const found = (list ?? []).find((item) => item.name === name)
  expect(found, `'${name}' among ${(list ?? []).map((item) => item.name).join(', ')}`).toBeTruthy()
  return found as Entry
}

test.describe('V-MCP-GET-BLOCK-FUNCTIONAL: get_block serves the new parameter and output keys', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetOwnership(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('Ping, JSON Parser and XML Parser declare their new keys', async () => {
    const ping = block('ping')

    await test.step('1. ping min_replies is capped by count', () => {
      const minReplies = named(ping.parameters, 'min_replies')
      expect(minReplies.maximum_field).toBe('count')
      expect(minReplies.minimum).toBe(1)
      expect(minReplies.required_when).toEqual(BY_REPLIES)
      expect(minReplies.show_when).toEqual(BY_REPLIES)
      expect('maximum' in minReplies, 'the ceiling is the other setting, not a fixed maximum').toBe(false)
      expect(named(ping.parameters, 'count').maximum_field, 'Count itself has no field ceiling').toBeUndefined()
    })

    for (const id of PARSERS) {
      const parser = block(id)
      await test.step(`2. ${id} queries declare outputs in individual mode`, () => {
        const queries = named(parser.parameters, 'queries')
        expect(queries.declares_outputs).toBe(true)
        expect(queries.declares_outputs_when).toEqual(INDIVIDUAL)
      })
      await test.step(`3. ${id} results is an output in combined mode only`, () => {
        expect(named(parser.output_schema, 'results').show_when).toEqual(COMBINED)
        expect(named(parser.output_schema, 'success').show_when).toBeUndefined()
        expect(named(parser.output_schema, 'errors').show_when).toBeUndefined()
      })
    }

    await test.step('4. list_blocks serves the same entries', () => {
      const catalog = objectOf(callMcp('list_blocks'), 'list_blocks').blocks as Entry[]
      for (const id of ['ping', ...PARSERS]) {
        expect(catalog.find((entry) => entry.id === id), `${id} in list_blocks`).toEqual(block(id))
      }
    })
  })
})
