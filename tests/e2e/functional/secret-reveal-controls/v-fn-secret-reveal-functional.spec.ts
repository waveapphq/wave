/**
 * V-FN-SECRET-REVEAL-FUNCTIONAL: the reveal settings cover a Function's own secrets
 * Wireframe: none
 * Design Decisions: SECREV-6, VMGR-11
 * REQ: REQ-3.1.3.17, REQ-3.1.3.18, REQ-3.1.3.5
 *
 * Phase: functional-workflow. Setup seeds (none is the thing under test): a Test through
 * POST /tests (zero validation errors) whose Local Function declares a secret local and a
 * secret output with a default, and a library Function through POST /functions declaring the
 * same plus an SSH Session Open holding a stored password. The reveal settings are set through
 * PUT /admin/secret-masking and reset after each test.
 *
 * Pass Criteria:
 * 1. "Reveal test variables" off: drilled into the Local Function, the secret local and output
 *    rows show `********` and their watchers cannot be opened, so the placeholder is never shown
 *    as a value and no "8 chars" metric appears.
 * 2. On: the rows show the real values, before and after a run, and each watcher shows its real
 *    value with the metric of that value's own length.
 * 3. Reads: with both settings off, a Function's secret local and output read `********`
 *    (`masked`) and a stored credential reads sealed, in the Test (GET /tests/{id} and its
 *    workflow) and on every Function read (latest, `?version=`, `/versions/{v}`); "Reveal test
 *    variables" alone reveals the secret local and output only; "Unmask plugin credential input
 *    fields" alone reveals the credential only.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { ALL_MASKED, setMasking } from './masking-flags'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { importFixtureTest } from '../../helpers/fixture-import'
import { localFunctionNode, logNode, openTest, publishLibraryFunction, startEdge } from '../../helpers/fn-seed'
import { expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import { SECRET_ENVELOPE, SECRET_MASK } from '../../helpers/secret-canary'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'
import { digIn, popToBreadcrumbSegment, runToEnd, selectEnvironment } from '../../helpers/workbench'

const FN = 'fn-1'
const BODY_LOG = 'fn-log'
const INNER_OPEN = 'ssh-inner'
const REVEAL_PREFIX = 'v-fn-secret-reveal-'

interface Secrets {
  local: string
  output: string
  credential: string
}

function secretsFor(tag: string): Secrets {
  return { local: `loc-${tag}`, output: `out-${tag}`, credential: `pw-${tag}` }
}

const secretLocal = (value: string) => ({ name: 'fn_tok', type: 'string', value, secret: true })
const secretOutput = (value: string) => ({ name: 'fn_out', type: 'string', secret: true, default: value })

/** An SSH Session Open whose password is a credential literal. */
function sshOpenNode(password: string): Record<string, unknown> {
  return {
    id: INNER_OPEN,
    type: 'workflowNode',
    position: { x: 200, y: 200 },
    data: {
      label: 'Inner Open',
      elementType: 'ssh-session-open',
      nodeType: 'plugin',
      category: 'network',
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: {
        values: { host: 'example.host', port: 22, username: 'admin', password, host_key_verification: 'strict' },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { width: 120, height: 62 },
  }
}

/** The body a Function computes on: its own secret local and output, read for their length only. */
const lengthLog = () =>
  logNode(BODY_LOG, 'Log', "'len=' + str(len(fn_tok)) + ' out=' + str(len(fn_out))")

async function seedTest(page: Page, prefix: string, body: Record<string, unknown>[], secrets: Secrets): Promise<string> {
  return importFixtureTest(page, {
    name: `${prefix}${randomUUID().slice(0, 8)}`,
    version: '1.0.0',
    description: 'A Local Function with its own secrets',
    workflow: {
      nodes: [
        localFunctionNode(FN, 'Function_1', {
          nodes: body,
          edges: [startEdge(String(body[0].id))],
          variables: [secretLocal(secrets.local)],
          outputs: [secretOutput(secrets.output)],
        }),
      ],
      edges: [startEdge(FN)],
    },
    variables: {},
    metadata: { tags: [], suite_id: null, parent_suite: null },
  })
}

const rowValue = (page: Page, name: string): Locator =>
  variableRow(page, name).locator('[data-testid^="variable-value-"]')
const expandButton = (page: Page, name: string): Locator =>
  variableRow(page, name).locator('[data-testid^="expand-button-"]')
const watcher = (page: Page, name: string): Locator => page.locator(`section[aria-label="Inspect variable ${name}"]`)

/** Open the watcher of `name` and prove it shows `value` with that value's own metric, then close it. */
async function expectWatcherShows(page: Page, name: string, value: string): Promise<void> {
  await expect(expandButton(page, name), `${name}: the revealed secret can be watched`).toBeEnabled()
  await variableRow(page, name).hover()
  await expandButton(page, name).click()
  const sheet = watcher(page, name)
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('[data-testid="scalar-body"] .cm-content')).toHaveText(value)
  await expect(sheet.locator('[data-testid="inspect-metric"]')).toHaveText(`${value.length} chars`)
  await expect(sheet.locator('[data-testid="inspect-secret-masked"]')).toHaveCount(0)
  await sheet.locator(`[aria-label="Close inspector for ${name}"]`).click()
  await expect(sheet).toHaveCount(0)
}

async function expectRowsMaskedAndLocked(page: Page): Promise<void> {
  for (const name of ['fn_tok', 'fn_out']) {
    await expect(rowValue(page, name), `${name} is masked`).toHaveText(SECRET_MASK)
    await expect(expandButton(page, name), `${name}: a masked secret's watcher stays closed`).toBeDisabled()
    await expect(watcher(page, name)).toHaveCount(0)
  }
}

async function expectRowsAndWatchersRevealed(page: Page, secrets: Secrets): Promise<void> {
  await expect(rowValue(page, 'fn_tok')).toHaveText(secrets.local)
  await expect(rowValue(page, 'fn_out')).toHaveText(secrets.output)
  await expectWatcherShows(page, 'fn_tok', secrets.local)
  await expectWatcherShows(page, 'fn_out', secrets.output)
}

// --- Reads -----------------------------------------------------------------------------------

interface ReadSecrets {
  local: Record<string, unknown>
  output: Record<string, unknown>
  credential: unknown
}

function readOf(definition: Record<string, any>): ReadSecrets {
  const local = (definition.variables ?? []).find((v: Record<string, unknown>) => v.name === 'fn_tok')
  const output = (definition.outputs ?? []).find((o: Record<string, unknown>) => o.name === 'fn_out')
  const ssh = (definition.workflow?.nodes ?? []).find((n: Record<string, unknown>) => n.id === INNER_OPEN)
  return { local, output, credential: ssh?.data?.config?.values?.password }
}

async function getData(request: APIRequestContext, path: string): Promise<Record<string, any>> {
  const resp = await request.get(`${BACKEND_URL}${path}`)
  expect(resp.ok(), `GET ${path}: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data
}

/** Every read of the secrets: the Test, its workflow, and the library Function three ways. */
async function everyRead(
  request: APIRequestContext,
  testId: string,
  functionId: string,
): Promise<Array<[string, ReadSecrets]>> {
  const localDefinition = (workflow: Record<string, any>) =>
    (workflow.nodes as Array<Record<string, any>>).find((node) => node.id === FN)?.data?.localDefinition
  const test = await getData(request, `/tests/${testId}`)
  const workflow = await getData(request, `/tests/${testId}/workflow`)
  const reads: Array<[string, ReadSecrets]> = [
    ['GET /tests/{id}', readOf(localDefinition(test.workflow))],
    ['GET /tests/{id}/workflow', readOf(localDefinition(workflow))],
  ]
  for (const path of [
    `/functions/${functionId}`,
    `/functions/${functionId}?version=1.0.0`,
    `/functions/${functionId}/versions/1.0.0`,
  ]) {
    const data = await getData(request, path)
    reads.push([`GET ${path.replace(functionId, '{id}')}`, readOf(data.etag && data.definition ? data.definition : data)])
  }
  return reads
}

function expectFunctionSecretsMasked(where: string, read: ReadSecrets): void {
  expect([read.local?.value, read.local?.masked], `${where}: the secret local`).toEqual([SECRET_MASK, true])
  expect([read.output?.default, read.output?.masked], `${where}: the secret output`).toEqual([SECRET_MASK, true])
}

function expectCredentialSealed(where: string, read: ReadSecrets, secrets: Secrets): void {
  expect(String(read.credential), `${where}: the credential reads sealed`).toMatch(
    new RegExp(`^${SECRET_ENVELOPE}`),
  )
  expect(String(read.credential), where).not.toContain(secrets.credential)
}

test.describe('V-FN-SECRET-REVEAL-FUNCTIONAL: the reveal settings and a Function own secrets', () => {
  const testIds: string[] = []
  const functionIds: string[] = []

  test.beforeEach(async ({ request }) => {
    await setMasking(request, ALL_MASKED)
  })

  test.afterEach(async ({ request }) => {
    await setMasking(request, ALL_MASKED)
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const id of testIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${id}`).catch(() => undefined)
    }
    for (const id of functionIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/functions/${id}?cascade=true`).catch(() => undefined)
    }
  })

  // Per SECREV-6 and VMGR-11: the setting reveals a Function's secrets in rows and watchers; off, they stay locked.
  test("'reveal test variables' shows a Function's secret local and output in rows and watchers", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const secrets = secretsFor(randomUUID().slice(0, 8))
    const testId = await seedTest(page, REVEAL_PREFIX, [lengthLog()], secrets)
    testIds.push(testId)

    await test.step('setting off: masked rows, watchers locked', async () => {
      await openTest(page, testId)
      await digIn(page, FN)
      await expandVariableManager(page)
      await expectRowsMaskedAndLocked(page)
    })

    await test.step('setting on: the rows and watchers show the real values', async () => {
      await setMasking(request, { test_variables: true })
      await openTest(page, testId)
      await digIn(page, FN)
      await expandVariableManager(page)
      await expectRowsAndWatchersRevealed(page, secrets)
    })

    await test.step('after a run the rows and watchers still show the real values', async () => {
      await popToBreadcrumbSegment(page, new RegExp(`^${REVEAL_PREFIX}`))
      await selectEnvironment(page)
      const { verdict, entries } = await runToEnd(page)
      expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
      expectConsoleLine(entries, 'INFO', `len=${secrets.local.length} out=${secrets.output.length}`)
      await digIn(page, FN)
      await expectRowsAndWatchersRevealed(page, secrets)
    })
  })

  // Per SECREV-6: one setting per surface; each read follows its own.
  test('every Function read follows the reveal settings', async ({ page, request }) => {
    const tag = randomUUID().slice(0, 8)
    const secrets = secretsFor(tag)
    const testId = await seedTest(page, 'v-fn-secret-reads-', [sshOpenNode(secrets.credential)], secrets)
    testIds.push(testId)
    const fn = await publishLibraryFunction(request, {
      name: `v-fn-secret-reads-${tag}`,
      variables: [secretLocal(secrets.local)],
      outputs: [secretOutput(secrets.output)],
      workflow: { nodes: [sshOpenNode(secrets.credential)], edges: [startEdge(INNER_OPEN)] },
    })
    functionIds.push(fn.functionId)

    await test.step('both off: the secrets read masked and the credential sealed', async () => {
      for (const [where, read] of await everyRead(request, testId, fn.functionId)) {
        expectFunctionSecretsMasked(where, read)
        expectCredentialSealed(where, read, secrets)
      }
    })

    await test.step("'reveal test variables' on: the secrets read in the clear, the credential stays sealed", async () => {
      await setMasking(request, { test_variables: true, credential_inputs: false })
      for (const [where, read] of await everyRead(request, testId, fn.functionId)) {
        expect([read.local?.value, 'masked' in (read.local ?? {})], `${where}: the secret local`).toEqual([
          secrets.local,
          false,
        ])
        expect([read.output?.default, 'masked' in (read.output ?? {})], `${where}: the secret output`).toEqual([
          secrets.output,
          false,
        ])
        expectCredentialSealed(where, read, secrets)
      }
    })

    await test.step("'unmask plugin credential input fields' on: the credential reads in the clear, the secrets stay masked", async () => {
      await setMasking(request, { test_variables: false, credential_inputs: true })
      for (const [where, read] of await everyRead(request, testId, fn.functionId)) {
        expectFunctionSecretsMasked(where, read)
        expect(read.credential, `${where}: the credential`).toBe(secrets.credential)
      }
    })
  })
})
