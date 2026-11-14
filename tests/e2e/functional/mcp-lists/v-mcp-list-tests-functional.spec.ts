/**
 * V-MCP-LIST-TESTS-FUNCTIONAL: list_tests answers the Tests the Tests page shows, and its filters narrow them
 * Design Decisions: none (tool surface)
 * REQ: REQ-5.2.7.8, REQ-5.2.7.2
 *
 * Pass Criteria:
 * 1. list_tests answers one row per Test; for three seeded Tests each row holds the name, description,
 *    tags and version GET /tests/{id} stores (one Test saved again reads 1.1.0), and the status of its
 *    last run: passed, failed and never_run.
 * 2. The Tests page searched to the seeded names lists the same three Tests with the same names and
 *    the same status badges.
 * 3. `search` matches the name case-insensitively and matches a word that only the description holds;
 *    every row it answers holds the searched text.
 * 4. `tag` answers only Tests carrying that tag, and the Tests page filtered to the tag lists the same Test.
 * 5. A search that matches nothing answers no output at all, and no error.
 * 6. A tag sent as a list is refused with the type error that names `tag`.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { resolveEnvironmentId } from '../../helpers/k8s-run'
import { enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { runToken } from '../../helpers/element-types'
import {
  MCP_PORT,
  callMcp,
  expectWrongType,
  failingTest,
  own,
  passingTest,
  purgeTests,
  rowsOf,
  seedTest,
  startTracked,
  waitForStatus,
} from './list-client'

const PREFIX = 'zz-mcp-list_tests-'
const TAG_A = 'zz-mcp-list_tests-tag-a'
const TAG_B = 'zz-mcp-list_tests-tag-b'

const STATUS_LABELS: Record<string, string> = { passed: 'Passed', failed: 'Failed', never_run: 'Never Run' }

interface Seeded {
  id: string
  name: string
  description: string
  tags: string[]
  status: string
}

async function openTestsPage(page: Page, query: string): Promise<void> {
  await page.goto(`/tests?${query}`)
  await page.waitForSelector('[data-testid="tests-page"][aria-busy="false"]', { state: 'attached' })
}

async function expectTestsPageRows(page: Page, expected: Seeded[]): Promise<void> {
  const rows = page.locator('[data-testid="test-row"]')
  await expect(rows).toHaveCount(expected.length, { timeout: 15_000 })
  for (const seeded of expected) {
    const row = page.locator(`[data-testid="test-row"][data-row-id="${seeded.id}"]`)
    await expect(row.getByTestId('test-name')).toHaveText(seeded.name)
    const badge = row.locator(`[data-testid="status-badge-${seeded.status.replace('_', '-')}"]`)
    await expect(badge, `${seeded.name} shows its status`).toHaveText(STATUS_LABELS[seeded.status])
  }
}

test.describe('V-MCP-LIST-TESTS-FUNCTIONAL: list_tests against the Tests page', () => {
  const created: string[] = []
  const executions: string[] = []

  test.beforeEach(async ({ page, request }) => {
    await resetOwnership(request)
    await ensureEnvironment(request)
    await purgeTests(request, PREFIX)
    await enableMcpUntilRestart(page, MCP_PORT)
  })

  test.afterEach(async ({ page, request }) => {
    for (const id of executions.splice(0)) await request.delete(`${BACKEND_URL}/executions/${id}`).catch(() => undefined)
    for (const id of created.splice(0)) await request.delete(`${BACKEND_URL}/tests/${id}`).catch(() => undefined)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('rows match the Tests page and the stored Tests; search and tag filter; no match answers nothing', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const descriptionWord = `quokka${runToken().replace(/[^a-z0-9]/gi, '')}`
    const seeded: Seeded[] = [
      { id: '', name: `${PREFIX}1`, description: 'Listing probe that passes', tags: [TAG_A], status: 'passed' },
      { id: '', name: `${PREFIX}2`, description: 'Listing probe saved again', tags: [TAG_B], status: 'never_run' },
      { id: '', name: `${PREFIX}3`, description: 'Listing probe that fails', tags: [TAG_B], status: 'failed' },
    ]

    await test.step('seed three Tests through the API: one passed run, one saved again, one failed run', async () => {
      const workflows = [passingTest('lt1'), passingTest('lt2'), failingTest('lt3')]
      for (const [i, entry] of seeded.entries()) {
        entry.id = await seedTest(request, { ...entry, workflow: workflows[i] })
        created.push(entry.id)
      }
      seeded[1].description = `Listing probe saved again ${descriptionWord}`
      const saved = await request.put(`${BACKEND_URL}/tests/${seeded[1].id}`, {
        data: { description: seeded[1].description },
      })
      expect(saved.ok(), `PUT /tests failed: ${saved.status()} ${await saved.text()}`).toBeTruthy()

      const environmentId = await resolveEnvironmentId(request)
      for (const entry of [seeded[0], seeded[2]]) {
        const executionId = await startTracked(request, 'test', entry.id, environmentId)
        executions.push(executionId)
        expect(await waitForStatus(request, executionId)).toBe(entry.status)
      }
    })

    await test.step('each row holds what GET /tests/{id} stores and the status of the last run', async () => {
      const rows = own(rowsOf(callMcp('list_tests'), 'list_tests'), PREFIX)
      expect(rows.map((row) => row.name).sort()).toEqual(seeded.map((entry) => entry.name))
      for (const entry of seeded) {
        const stored = (await (await request.get(`${BACKEND_URL}/tests/${entry.id}`)).json()).data
        const row = rows.find((candidate) => candidate.id === entry.id)
        expect(row, `${entry.name} is listed by id`).toBeTruthy()
        expect(row).toMatchObject({
          name: stored.name,
          description: entry.description,
          tags: entry.tags,
          version: stored.version,
          status: entry.status,
        })
        expect(stored.description).toBe(entry.description)
      }
      expect(rows.find((row) => row.id === seeded[1].id)?.version, 'a Test saved again moves to the next minor version').toBe('1.1.0')
      expect(rows.find((row) => row.id === seeded[0].id)?.version).toBe('1.0.0')
      expect(rows.find((row) => row.id === seeded[1].id)?.last_run, 'a Test never run has no last run').toBeNull()
      expect(rows.find((row) => row.id === seeded[0].id)?.last_run, 'a Test that ran has a last run').toBeTruthy()
    })

    await test.step('the Tests page lists the same Tests with the same names and status badges', async () => {
      await openTestsPage(page, `search=${encodeURIComponent(PREFIX)}`)
      await expectTestsPageRows(page, seeded)
    })

    await test.step('search matches the name case-insensitively and a word only the description holds', async () => {
      const upper = PREFIX.toUpperCase()
      const byName = rowsOf(callMcp('list_tests', { search: upper }), 'list_tests')
      for (const row of byName) {
        const text = `${row.name}\n${row.description}`.toLowerCase()
        expect(text, `${row.name} holds the searched text`).toContain(PREFIX)
      }
      expect(own(byName, PREFIX).map((row) => row.id).sort()).toEqual(seeded.map((entry) => entry.id).sort())

      const byDescription = rowsOf(callMcp('list_tests', { search: descriptionWord.toUpperCase() }), 'list_tests')
      expect(byDescription.map((row) => row.id)).toEqual([seeded[1].id])
    })

    await test.step('tag answers only Tests carrying the tag, as the Tests page filtered to it does', async () => {
      const tagged = rowsOf(callMcp('list_tests', { tag: TAG_A }), 'list_tests')
      for (const row of tagged) expect(row.tags, `${row.name} carries ${TAG_A}`).toContain(TAG_A)
      expect(own(tagged, PREFIX).map((row) => row.id)).toEqual([seeded[0].id])

      const both = own(rowsOf(callMcp('list_tests', { tag: TAG_B, search: PREFIX }), 'list_tests'), PREFIX)
      expect(both.map((row) => row.id).sort()).toEqual([seeded[1].id, seeded[2].id].sort())

      await openTestsPage(page, `search=${encodeURIComponent(PREFIX)}&tags=${encodeURIComponent(TAG_A)}`)
      await expectTestsPageRows(page, [seeded[0]])
    })

    await test.step('a search that matches nothing answers no output and no error', () => {
      const none = callMcp('list_tests', { search: `${PREFIX}none-${descriptionWord}` })
      expect(none).toEqual({ isError: false, texts: [] })
    })

    await test.step('a tag sent as a list is refused with the type error naming tag', () => {
      expectWrongType(callMcp('list_tests', { tag: [TAG_A] }), 'list_tests', 'tag', 'a valid string')
    })
  })
})
