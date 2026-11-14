/**
 * V-MCP-LIST-FUNCTIONS-FUNCTIONAL: list_functions answers each library Function as a contract card of its latest version
 * Design Decisions: SECUI-11
 * REQ: REQ-5.2.7.8, REQ-5.2.7.13
 *
 * Pass Criteria:
 * 1. A Function published at 1.0.0 and again at 1.1.0 with one more optional input is one row holding the id,
 *    name, description, tags and times GET /functions answers, `latest_version` 1.1.0 (the latest of
 *    the versions GET /functions/{id}/versions answers) and the inputs and outputs of 1.1.0.
 * 2. Its secret output default reads masked in the row, as GET /functions/{id} shows it.
 * 3. `search` matches the name and the description case-insensitively; every row it answers holds the
 *    text in its name or its description, and a word only the description holds finds the Function.
 * 4. A search that matches nothing answers no output at all, and no error.
 * 5. A search sent as a number is refused with the type error that names `search`.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { addLibraryVersion, publishLibraryFunction } from '../../helpers/fn-seed'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { MASK, MCP_PORT, callMcp, expectWrongType, own, rowsOf } from './list-client'

const PREFIX = 'zz-mcp-list_functions-'
const FN_NAME = `${PREFIX}1`
const TAG = 'zz-mcp-list_functions-tag'
// A word no name holds, so a match on it can only come from the description.
const DESCRIPTION_WORD = 'quokkadesc7341'
const DESCRIPTION = `Listing probe function ${DESCRIPTION_WORD}`
const SECRET_DEFAULT = 'zz-mcp-list-functions-secret-4417'

const COUNT_INPUT = { name: 'count', type: 'integer', required: false, default: 3, description: 'How many' }
const LABEL_INPUT = { name: 'label', type: 'string', required: false, default: 'probe', description: 'What to call it' }
const TOKEN_OUTPUT = { name: 'token', type: 'string', secret: true, default: SECRET_DEFAULT, description: 'A token' }

async function purge(request: APIRequestContext): Promise<void> {
  const body = await (await request.get(`${BACKEND_URL}/functions?search=${PREFIX}&per_page=100`)).json().catch(() => null)
  for (const fn of own((body?.data ?? []) as Array<{ id: string; name: string }>, PREFIX)) {
    await request.delete(`${BACKEND_URL}/functions/${fn.id}?cascade=true`).catch(() => undefined)
  }
}

test.describe('V-MCP-LIST-FUNCTIONS-FUNCTIONAL: list_functions against the Function library', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetOwnership(request)
    await purge(request)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    await purge(request)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('the seeded Function is one card of its latest version, masked and searchable', async ({ request }) => {
    test.setTimeout(120_000)
    const fn = await publishLibraryFunction(request, {
      name: FN_NAME,
      description: DESCRIPTION,
      tags: [TAG],
      inputs: [COUNT_INPUT],
      outputs: [TOKEN_OUTPUT],
      version: '1.0.0',
    })
    await addLibraryVersion(request, fn, {
      sourceVersion: '1.0.0',
      targetVersion: '1.1.0',
      inputs: [COUNT_INPUT, LABEL_INPUT],
      outputs: [TOKEN_OUTPUT],
      description: DESCRIPTION,
      tags: [TAG],
    })

    const rows = own(rowsOf(callMcp('list_functions'), 'list_functions'), PREFIX)

    await test.step('the row holds the summary GET /functions answers and the latest version', async () => {
      expect(rows).toHaveLength(1)
      const row = rows[0]
      const listed = ((await (await request.get(`${BACKEND_URL}/functions?search=${FN_NAME}`)).json()).data ?? []) as Array<Record<string, any>>
      const summary = listed.find((entry) => entry.id === fn.functionId)
      expect(summary, 'GET /functions lists the Function').toBeTruthy()
      expect(row).toMatchObject({ ...summary, name: FN_NAME, description: DESCRIPTION, tags: [TAG] })

      const versions = (await (await request.get(`${BACKEND_URL}/functions/${fn.functionId}/versions`)).json()).data
      const numbers = (versions.versions as Array<string | { version: string }>).map((entry) =>
        typeof entry === 'string' ? entry : entry.version,
      )
      expect(numbers.sort()).toEqual(['1.0.0', '1.1.0'])
      expect(row.latest_version).toBe('1.1.0')
      expect(versions.latest).toBe(row.latest_version)
    })

    await test.step('the inputs and outputs are those of 1.1.0, the secret default masked', async () => {
      const row = rows[0]
      expect(row.inputs.map((input: { name: string }) => input.name)).toEqual(['count', 'label'])
      expect(row.inputs).toEqual([
        expect.objectContaining(COUNT_INPUT),
        expect.objectContaining(LABEL_INPUT),
      ])
      expect(row.outputs).toEqual([expect.objectContaining({ ...TOKEN_OUTPUT, default: MASK })])
      expect(JSON.stringify(row)).not.toContain(SECRET_DEFAULT)

      const stored = (await (await request.get(`${BACKEND_URL}/functions/${fn.functionId}`)).json()).data
      expect(row.inputs).toEqual(stored.inputs)
      expect(row.outputs).toEqual(stored.outputs)
    })

    await test.step('search matches the name case-insensitively', () => {
      const found = rowsOf(callMcp('list_functions', { search: PREFIX.toUpperCase() }), 'list_functions')
      for (const row of found) {
        expect(`${row.name} ${row.description}`.toLowerCase(), `${row.name} holds the text`).toContain(PREFIX)
      }
      expect(own(found, PREFIX).map((row) => row.id)).toEqual([fn.functionId])
    })

    await test.step('a word only the description holds finds the Function, in any case', () => {
      const found = rowsOf(callMcp('list_functions', { search: DESCRIPTION_WORD.toUpperCase() }), 'list_functions')
      expect(found.map((row) => row.id)).toEqual([fn.functionId])
      expect(String(found[0].name).toLowerCase()).not.toContain(DESCRIPTION_WORD)
    })

    await test.step('a search that matches nothing answers no output and no error', () => {
      expect(callMcp('list_functions', { search: `${PREFIX}none-${Date.now()}` })).toEqual({ isError: false, texts: [] })
    })

    await test.step('a search sent as a number is refused with the type error naming search', () => {
      expectWrongType(callMcp('list_functions', { search: 42 }), 'list_functions', 'search', 'a valid string')
    })
  })
})
