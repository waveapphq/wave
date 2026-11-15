/**
 * V-MCP-LIST-BLOCKS-FUNCTIONAL: list_blocks answers the whole Block catalog the palette offers
 * Design Decisions: none (tool surface)
 * REQ: REQ-5.2.7.8
 *
 * Pass Criteria:
 * 1. list_blocks answers exactly one object, `{blocks: [...]}`, with one entry per Block id.
 * 2. Every Block the workbench palette offers in its Controls and Plugins sections is in the catalog;
 *    a palette control is a `control` entry and a palette plugin a `plugin` or `container` entry.
 * 3. For HTTP (`http-client`), If/Else (`if-else`) and Variable Setter (`variable-setter`) the entry
 *    equals what get_block answers for the same id, settings included.
 * 4. get_block with an unknown id is refused with "Block '<id>' not found".
 * 5. An argument the tool does not declare is refused with the error that names it.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { expandPalette, stubSessionRecovery, waitForCanvasLoad } from '../../helpers/canvas'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { MCP_PORT, callMcp, expectRaised, objectOf } from './list-client'

const UNKNOWN_BLOCK = 'zz-mcp-list_blocks-1'
const COMPARED = ['http-client', 'if-else', 'variable-setter']

/** The Block ids a palette section offers, read from its items whether a group is open or not. */
async function paletteIds(page: Page, section: string): Promise<string[]> {
  const items = page.locator(`[data-testid="${section}"] [data-testid^="palette-item-"]`)
  await expect(items.first()).toBeAttached()
  const testIds = await items.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') ?? ''))
  return [...new Set(testIds.map((testId) => testId.replace('palette-item-', '')))]
}

test.describe('V-MCP-LIST-BLOCKS-FUNCTIONAL: list_blocks against the palette and get_block', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetOwnership(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('one catalog object holds every palette Block, and three entries equal get_block', async ({ page, request }) => {
    test.setTimeout(180_000)
    const catalog = objectOf(callMcp('list_blocks'), 'list_blocks')
    expect(Object.keys(catalog), 'the answer is one {blocks} object').toEqual(['blocks'])
    const blocks = catalog.blocks as Array<Record<string, any>>
    const byId = new Map(blocks.map((block) => [String(block.id), block]))
    expect(byId.size, 'one entry per Block id').toBe(blocks.length)

    await test.step('every Block the palette offers is in the catalog with its kind', async () => {
      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
      await stubSessionRecovery(page)
      await page.goto('/workbench')
      await waitForCanvasLoad(page)
      await expandPalette(page)

      const controls = await paletteIds(page, 'palette-section-controls')
      const plugins = await paletteIds(page, 'palette-section-plugins')
      expect(controls).toEqual(expect.arrayContaining(['if-else', 'variable-setter']))
      expect(plugins).toContain('http-client')
      expect(controls.filter((id) => !byId.has(id)), 'palette controls missing from the catalog').toEqual([])
      expect(plugins.filter((id) => !byId.has(id)), 'palette plugins missing from the catalog').toEqual([])
      for (const id of controls) expect(byId.get(id)?.kind, `${id} is a control`).toBe('control')
      for (const id of plugins) expect(['plugin', 'container'], `${id} is a plugin`).toContain(byId.get(id)?.kind)
    })

    await test.step('HTTP, If/Else and Variable Setter equal get_block for the same id', () => {
      for (const id of COMPARED) {
        const entry = byId.get(id)
        expect(entry, `${id} is in the catalog`).toBeTruthy()
        const settings = entry?.kind === 'plugin' ? entry.parameters : entry?.parameter_schema
        expect((settings as unknown[]).length, `${id} declares its settings`).toBeGreaterThan(0)
        expect(objectOf(callMcp('get_block', { block_id: id }), 'get_block')).toEqual(entry)
      }
    })

    await test.step('get_block with an unknown id is refused with its exact text', () => {
      expectRaised(callMcp('get_block', { block_id: UNKNOWN_BLOCK }), 'get_block', `Block '${UNKNOWN_BLOCK}' not found`)
    })

    await test.step('an argument the tool does not declare is refused with the error that names it', () => {
      expectRaised(
        callMcp('list_blocks', { search: 'http' }),
        'list_blocks',
        "Unknown argument 'search'; this tool takes no arguments",
      )
    })
  })
})
