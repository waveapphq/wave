/**
 * V-FN-IMPORT-ENTRY-PROBLEMS (functional): an imported Function entry with a problem of its own is refused
 * Wireframe: none (the shared Import dialog review step)
 * Design Decisions: FNLIST-5, VMGR-112
 * REQ: REQ-3.1.2.5, REQ-3.1.2.11
 *
 * Seed: none. The file is a ZIP the spec writes itself (`buildZip`) with three Function entries, each
 * with one problem: an input with no type (a structural problem), a version that is not semver, and
 * an enum input with no allowed values (a declaration problem). The import goes through the Functions
 * list page's Import dialog; the commit is also sent over `POST /functions/import` to prove the
 * refusal holds there.
 *
 * Pass Criteria:
 * 1. The dry run (Validate) marks each entry Blocked, the summary reads `0 importable, 3 blocked` and
 *    Import stays disabled.
 * 2. The dry run names each entry's own problem: `Function input 'who' is required and missing a type`,
 *    `Invalid version 'one.two'; expected a valid semver`, `Enum input 'level' has no allowed values`.
 * 3. A commit of the same file imports nothing and skips each entry with that same message.
 * 4. The library holds none of the three names afterwards.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { openImportDialog } from '../../helpers/fixture-import'
import { buildZip } from '../../helpers/zip-writer'

const RUN = randomUUID().slice(0, 8)

interface ProblemEntry {
  name: string
  overrides: Record<string, unknown>
  message: string
}

const ENTRIES: ProblemEntry[] = [
  {
    name: `zz-imp-structural-${RUN}`,
    overrides: { inputs: [{ name: 'who', required: true, description: '' }] },
    message: "Function input 'who' is required and missing a type",
  },
  {
    name: `zz-imp-version-${RUN}`,
    overrides: { version: 'one.two' },
    message: "Invalid version 'one.two'; expected a valid semver",
  },
  {
    name: `zz-imp-enum-${RUN}`,
    overrides: {
      inputs: [{ name: 'level', type: 'string', required: true, description: '', enumValues: [], default: 'low' }],
    },
    message: "Enum input 'level' has no allowed values",
  },
]

/** One Function entry as an export writes it, with the given fields replaced. */
function entryDoc(entry: ProblemEntry): Record<string, unknown> {
  return {
    id: randomUUID(),
    name: entry.name,
    description: '',
    tags: [],
    inputs: [],
    outputs: [],
    dependencies: { functions: [], plugins: [] },
    workflow: { nodes: [], edges: [] },
    version: '1.0.0',
    ...entry.overrides,
  }
}

const archive = (): Buffer =>
  buildZip(ENTRIES.map((entry) => ({ name: `${entry.name}.json`, data: Buffer.from(JSON.stringify(entryDoc(entry))) })))

async function libraryNames(request: APIRequestContext): Promise<string[]> {
  const resp = await request.get(`${BACKEND_URL}/functions?q=${encodeURIComponent(RUN)}`)
  expect(resp.ok(), `GET /functions: ${resp.status()}`).toBeTruthy()
  // The search also matches other specs' Functions whose names hold the same characters.
  const ours = new Set(ENTRIES.map((entry) => entry.name))
  return (((await resp.json()).data ?? []) as Array<{ name: string }>).map((row) => row.name).filter((name) => ours.has(name))
}

test.describe('V-FN-IMPORT-ENTRY-PROBLEMS: an entry with its own problem is refused by name', () => {
  test('a structural, a version and a declaration problem are each refused with their own message', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000)
    const file = { name: `zz-imp-problems-${RUN}.zip`, mimeType: 'application/zip', buffer: archive() }

    await test.step('the dry run blocks each entry and names its problem', async () => {
      const dialog = await openImportDialog(page, '/functions', file)
      const dryRun = page.waitForResponse(
        (resp) => resp.request().method() === 'POST' && new URL(resp.url()).pathname.endsWith('/functions/import/validate'),
      )
      await dialog.locator('[data-testid="validate-button"]').click()
      const answer = await dryRun
      expect(answer.ok(), `validate: ${answer.status()}`).toBeTruthy()
      const items = ((await answer.json()).data.items ?? []) as Array<{
        name: string
        status: string
        fatal_errors: Array<{ message: string }>
      }>
      await expect(dialog.locator('[data-testid="review-step"]')).toBeVisible()
      for (const entry of ENTRIES) {
        const item = items.find((candidate) => candidate.name === entry.name)
        expect(item, `the dry run lists ${entry.name}`).toBeTruthy()
        expect(item!.status, `${entry.name} is blocked`).toBe('fatal')
        expect(item!.fatal_errors.map((error) => error.message), `${entry.name} names its own problem`).toEqual([
          entry.message,
        ])
        await expect(dialog.locator(`[data-testid="item-result-${entry.name}"]`)).toContainText('Blocked')
      }
      await expect(dialog.locator('[data-testid="import-summary"]')).toHaveText('0 importable, 3 blocked')
      await expect(dialog.locator('[data-testid="import-button"]'), 'nothing can be imported').toBeDisabled()
      await dialog.locator('[data-testid="back-button"]').click()
    })

    await test.step('a commit of the same file imports nothing and gives the same reasons', async () => {
      const resp = await request.post(`${BACKEND_URL}/functions/import`, { multipart: { file } })
      expect(resp.ok(), `import: ${resp.status()} ${await resp.text()}`).toBeTruthy()
      const result = (await resp.json()).data as {
        total_imported: number
        skipped: Array<{ name: string; reason: string }>
      }
      expect(result.total_imported).toBe(0)
      expect(
        result.skipped.map(({ name, reason }) => [name, reason]).sort((a, b) => a[0].localeCompare(b[0])),
      ).toEqual(ENTRIES.map((entry) => [entry.name, entry.message]).sort((a, b) => a[0].localeCompare(b[0])))
    })

    expect(await libraryNames(request), 'the library holds none of the entries').toEqual([])
  })
})
