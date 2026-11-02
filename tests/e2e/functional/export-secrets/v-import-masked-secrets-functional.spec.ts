/**
 * V-IMPORT-MASKED-SECRETS: a masked secret brought in by an import is stored null and owed
 * Wireframe: none
 * Design Decisions: EXPORT-7
 * REQ: REQ-4.5.19, REQ-3.1.3.20, REQ-3.1.3.21
 *
 * Phase: functional-destructive. Tests 1-4 seed nothing through the API: the spec writes a Test
 * file (`fixture-import-secret-http.json`) whose secret `api_tok` holds the mask a masked
 * export leaves, and imports it through the Tests page Import dialog. An HTTP block reads
 * `api_tok` in its Basic password and calls the stack's `http-echo` `/retry` counter under a
 * per-run key inside a Try/Catch; a probe with the same key follows it.
 *
 * Pass Criteria:
 * 1. The Tests page Import dialog imports the Test.
 * 2. The imported `api_tok` row in the Variable Manager reads `null` in the null look.
 * 3. The HTTP block fails and names the null field: `'auth_password' is null` (a null header entry would be
 *    sent as empty text, REQ-3.1.3.21, so the secret is read where null is refused).
 * 4. Nothing was sent: the first probe with the run key answers attempt 1.
 * 5. Each place a secret lives - a Test variable, a Variable Setter secret literal, an HTTP basic
 *    password, a Suite variable, a Regression variable, a System variable, an HTTP profile password,
 *    a library Function workflow secret, local secret and secret output default, a secret input
 *    literal on the Function Block, and all of them by a backup restore - brought in from a masked
 *    export: the review warns per masked variable, a plaintext export reads null and the value
 *    stays secret; the Suite, Regression and System Variables lists read null in the null look.
 * 6. The block that reads it fails before sending (`'auth_password' is null`, or `'tok' is null` on the
 *    Function Block of a secret input) and the probe answers attempt 1.
 * 7. The run's failure report lists it as owed: `Secret variable '<name>' holds no value`, or
 *    `Secret field '<field>' holds no value` for a field; a Test variable's item is exact (its Test,
 *    step and fix), the owed wording for an import.
 * 8. EXPORT-7: a masked archive restored with Overwrite over the same parts keeps every real secret.
 *
 * Seeds for 5-8 (`import-secrets-harness.ts`): each leg seeds its entity with a real secret through
 * POST /tests, /suites, /regressions, /profiles, /functions and /variables/system/import, exports it
 * masked and deletes it (the EXPORT-7 leg keeps them); the restore legs cut a POST /api/backup/create
 * archive to their own members. Owed is read through MCP `get_failure_report`.
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  expectNothingSent,
  getActiveSessionId,
  getSessionVariables,
  importedTestId,
  importThroughListPage,
  injectHttpHost,
  sessionValue,
  type ImportFile,
} from '../../helpers/fixture-import'
import { openTest } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { expectNullLook } from '../../helpers/null-look'
import { SECRET_MASK } from '../../helpers/secret-canary'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'
import { IMPORT_LEGS, maskedOverwriteLeg, runImportLeg } from './import-secrets-harness'

const HTTP_BLOCK = 'http-secret'
// One MCP port per stack so host-mode parallel workers never collide.
const MCP_PORT = Number(BACKEND_PORT) + 772
const NULL_PASSWORD = "'auth_password' is null"

/** The Test file a masked export would have left, aimed at this run's probe key. */
function maskedTestFile(name: string, runKey: string): ImportFile {
  const fixture = JSON.parse(
    fs
      .readFileSync(path.resolve(__dirname, 'fixture-import-secret-http.json'), 'utf-8')
      .replaceAll('__RUN_KEY__', runKey),
  )
  fixture.name = name
  fixture.variables.api_tok.value = SECRET_MASK
  return {
    name: `${name}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(injectHttpHost(fixture)), 'utf-8'),
  }
}

test.describe('V-IMPORT-MASKED-SECRETS: masked secrets brought in by an import', () => {
  let testId: string | undefined

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
  })

  test('a masked secret imported with a Test is stored null, owed, and its HTTP block sends nothing', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(page.request)
    const runKey = `zz-import-masked-${randomUUID()}`
    const name = `zz-import-masked ${randomUUID().slice(0, 8)}`

    await test.step('the Tests page imports the file', async () => {
      const review = await importThroughListPage(page, '/tests', maskedTestFile(name, runKey))
      expect(review.summary).toBe('1 importable, 0 blocked')
      testId = await importedTestId(page, name)
    })

    await openTest(page, testId as string)
    await expandVariableManager(page)

    // Per EXPORT-7: the placeholder becomes null, never a stored value.
    await test.step('the imported secret is stored null', async () => {
      await expectNullLook(
        variableRow(page, 'api_tok').locator('[data-testid^="variable-value-"]'),
        'the imported api_tok row',
      )
    })

    const status = await startRun(page)
    await finishRun(page, status, `import-secret-done-${runKey}`)
    const variables = await getSessionVariables(page, await getActiveSessionId(page))

    await test.step('the HTTP block that reads the secret fails and names the null field', async () => {
      await expectNodeStatus(page, HTTP_BLOCK, 'failed')
      expect(sessionValue(variables, 'e_http')).toMatchObject({
        message: NULL_PASSWORD,
        node_id: HTTP_BLOCK,
      })
    })

    await test.step('nothing was sent with the run key before the probe', () => {
      expectNothingSent(variables, { status: 'probe_status', body: 'probe_body' })
    })
  })


  for (const leg of IMPORT_LEGS) {
    test(`${leg.title}: a masked secret is stored null, owed, and its block sends nothing`, async ({ page }) => {
      test.setTimeout(leg.timeoutMs)
      await runImportLeg(page, leg, 'masked', MCP_PORT)
    })
  }

  test('a masked backup restored over stored secrets keeps every real secret', async ({ page }) => {
    test.setTimeout(maskedOverwriteLeg.timeoutMs)
    await runImportLeg(page, maskedOverwriteLeg, 'masked', MCP_PORT)
  })
})
