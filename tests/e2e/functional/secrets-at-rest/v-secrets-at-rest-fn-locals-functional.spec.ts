/**
 * V-SECRETS-AT-REST-FN-LOCALS: a Function's local secret is sealed at rest and masked
 * Wireframe: none
 * Design Decisions: SECUI-11
 * REQ: REQ-3.1.2.1, REQ-3.1.3.5, REQ-4.5.1, REQ-5.2.4.9
 *
 * Phase: functional-workflow. Setup seeds (none is the thing under test):
 * - POST /tests: a blank `zz-` Test holding one empty Local Function, a blank Test
 *   (the library publish test), or a Test whose Local Function holds the secret local `fn_tok`
 *   (the shape the window stores) and a body Log reading it, or a Shared
 *   instance of a library Function.
 * - POST /functions (`publishLibraryFunction`): the library Function with the same local and
 *   body, deleted with cascade=true.
 * The local's window, Publish to Library and every workbench run go through the UI; the tracked
 * run is POST /executions. Exports (POST /tests/export, GET /functions/{id}/export), backups
 * (POST /api/backup/create, read with `helpers/zip-reader.ts`) and MCP reads are the surfaces
 * read; MCP settings are reset in afterAll.
 *
 * Pass Criteria:
 * 1. No file anywhere in the store holds the local's value, and the stored Test carries a
 *    sealed envelope in its place.
 * 2. The saved Test declares the Function local `fn_tok` secret.
 * 3. (Library) A local secret published from a Local Function is stored sealed in the library,
 *    and GET /functions reads it masked.
 * 4. (Local, Library) The local's Variable Manager row is masked while drilled, before and
 *    after a run; the run console shows the mask while the body computes on the real value.
 * 5. (Local: Test export, Library: Function export) Mask writes `********`, Keep encrypted an
 *    envelope, Decrypt the value.
 * 6. (Local, Library) MCP reads leave the value out (recipe readback) or masked (`get_function`).
 * 7. (Local, Library) A backup archive in mask and encrypted mode holds the mask or an envelope
 *    in the entity's member, and the value nowhere.
 * 8. (Local, Library) A tracked execution persists the run masked: its variables and record
 *    hold the masked body line and never the value.
 */

import path from 'path'
import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, STORAGE_BASE_PATH, ensureEnvironment } from '../../helpers/config'
import {
  createValidTest,
  localFunctionNode,
  logNode,
  openTest,
  publishLibraryFunction,
  sharedNode,
  startEdge,
} from '../../helpers/fn-seed'
import { runTrackedTest } from '../../helpers/k8s-run'
import { expectConsoleLine, formatEntries } from '../../helpers/log-reader'
import { callTool, enableMcpUntilRestart, MCP_DEFAULTS } from '../../helpers/mcp'
import {
  backupArchive,
  declaredFields,
  dirBytes,
  expectSecretUnderMode,
  exportFunctionJson,
  exportTestJson,
  SECRET_ENVELOPE,
  SECRET_MASK,
  sweepStore,
  type SecretsMode,
} from '../../helpers/secret-canary'
import {
  createFunctionParam,
  createModal,
  expandVariableManager,
  openFunctionCreateModal,
  setCreateName,
  submitCreate,
  typeStringValue,
  valueEditor,
  variableRow,
} from '../../helpers/variable-create'
import {
  breadcrumbFunctionSegments,
  digIn,
  dropBelowStart,
  popToBreadcrumbSegment,
  publishToLibrary,
  runToEnd,
  saveBtn,
  selectEnvironment,
} from '../../helpers/workbench'
import { readZipEntryText, zipEntryNames } from '../../helpers/zip-reader'

const FN_NODE = 'fn-1'

/** The saved Function's local variables, read back from the stored Test. */
async function storedLocals(
  request: APIRequestContext,
  testId: string,
): Promise<Array<Record<string, unknown>>> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  const nodes = (await resp.json()).data.workflow.nodes as Array<{
    id: string
    data: { localDefinition?: { variables?: Array<Record<string, unknown>> } }
  }>
  const fn = nodes.find((node) => node.id === FN_NODE)
  expect(fn, 'the stored Test keeps the Local Function').toBeTruthy()
  return fn?.data.localDefinition?.variables ?? []
}

test.describe('V-SECRETS-AT-REST-FN-LOCALS: Function local secrets at rest', () => {
  let testId: string | undefined

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
  })

  test('a Function local secret is sealed at rest and masked on every surface', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const canary = `fnlocal-${randomUUID()}`
    testId = await createValidTest(request, {
      name: `zz-secrets-at-rest-fn-locals ${randomUUID().slice(0, 8)}`,
      nodes: [localFunctionNode(FN_NODE, 'Function_1', { nodes: [] })],
      edges: [startEdge(FN_NODE)],
    })
    await openTest(page, testId)
    await digIn(page, FN_NODE)

    await test.step('Add > Variable creates the local fn_tok marked as secret', async () => {
      await openFunctionCreateModal(page, 'variable')
      await setCreateName(page, 'fn_tok')
      await typeStringValue(page, canary)
      await expect(valueEditor(page), 'the window holds the typed value').toHaveValue(canary)
      await createModal(page).locator('[data-testid="create-secret-checkbox"]').click()
      await submitCreate(page)
      await expect(createModal(page)).toBeHidden()
      await expect(variableRow(page, 'fn_tok')).toBeVisible()
    })

    await test.step('Save stores the Test with its local', async () => {
      await expect(saveBtn(page)).toBeEnabled()
      await saveBtn(page).click()
      await expect(saveBtn(page)).toBeDisabled({ timeout: 15_000 })
      const names = (await storedLocals(request, testId as string)).map((entry) => entry.name)
      expect(names, 'the saved Function keeps its local').toContain('fn_tok')
    })

    // Per REQ-4.5.1: a secret is stored as an envelope, never as the typed text.
    await test.step('no store file holds the local secret value', () => {
      expect
        .soft(sweepStore(canary), 'store files holding the Function local secret')
        .toEqual([])
      expect
        .soft(
          dirBytes(path.join(STORAGE_BASE_PATH, 'api_tests', testId as string)).includes(
            SECRET_ENVELOPE,
          ),
          'the stored Test carries the sealed envelope',
        )
        .toBe(true)
    })

    await test.step('the saved Function declares its local secret', async () => {
      const local = (await storedLocals(request, testId as string)).find(
        (entry) => entry.name === 'fn_tok',
      )
      expect(local, 'the stored local fn_tok').toMatchObject({
        name: 'fn_tok',
        type: 'string',
        secret: true,
      })
    })
  })
})

// ---------------------------------------------------------------------------
// Every surface of a Function-local secret (Local Function in a Test, library Function)
// ---------------------------------------------------------------------------

const MCP_PORT = Number(BACKEND_PORT) + 765
const BODY_LOG = 'fn-log'
/** The body Log: the mask where the value goes, its real last 12 characters after. */
const BODY_MESSAGE = "'in=' + fn_tok + ' tail=' + fn_tok[-12:]"
const MODES: readonly SecretsMode[] = ['mask', 'encrypted', 'plaintext']

/** The local the window stores for Name `fn_tok` + Mark as secret; the seeds reuse it. */
const secretLocal = (value: string): Record<string, unknown> => ({
  name: 'fn_tok',
  type: 'string',
  value,
  secret: true,
})

/** The body Log line for a value: masked where printed whole, its real tail after. */
const maskedLine = (value: string): string => `in=${SECRET_MASK} tail=${value.slice(-12)}`

type Variant = 'Local' | 'Library'

interface Seeded {
  testId: string
  testName: string
  /** Library variant only. */
  functionId: string
  functionName: string
}

test.describe('V-SECRETS-AT-REST-FN-LOCALS: every surface of a Function local secret', () => {
  const testIds: string[] = []
  const functionIds: string[] = []

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const id of testIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/tests/${id}`).catch(() => undefined)
    }
    for (const id of functionIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/functions/${id}?cascade=true`).catch(() => undefined)
    }
  })

  test.afterAll(async ({ request }) => {
    await request.put(`${BACKEND_URL}/mcp/settings`, { data: MCP_DEFAULTS }).catch(() => undefined)
  })

  /** A Test whose Function Block calls a Function holding the secret local `fn_tok`. */
  async function seed(request: APIRequestContext, variant: Variant, canary: string): Promise<Seeded> {
    const tag = randomUUID().slice(0, 8)
    const testName = `zz-secrets-at-rest-fn-locals-${variant.toLowerCase()}-${tag}`
    const body = { nodes: [logNode(BODY_LOG, 'Log', BODY_MESSAGE)], edges: [startEdge(BODY_LOG)] }
    let node: Record<string, unknown>
    let functionId = ''
    let functionName = ''
    if (variant === 'Local') {
      node = localFunctionNode(FN_NODE, 'Function_1', { ...body, variables: [secretLocal(canary)] })
    } else {
      const fn = await publishLibraryFunction(request, {
        name: `zz-fn-local-${tag}`,
        variables: [secretLocal(canary)],
        workflow: body,
      })
      functionIds.push(fn.functionId)
      functionId = fn.functionId
      functionName = fn.name
      node = sharedNode(FN_NODE, {
        functionId: fn.functionId,
        functionVersion: fn.version,
        label: fn.name,
        originalLibraryName: fn.name,
      })
    }
    const id = await createValidTest(request, {
      name: testName,
      nodes: [node],
      edges: [startEdge(FN_NODE)],
    })
    testIds.push(id)
    return { testId: id, testName, functionId, functionName }
  }

  /** Drill into the Function Block: the local's row is masked and the page holds no copy. */
  async function expectRowMaskedWhileDrilled(page: Page, seeded: Seeded, canary: string): Promise<void> {
    await digIn(page, FN_NODE)
    await expandVariableManager(page)
    await expect(variableRow(page, 'fn_tok').locator('[data-testid^="variable-value-"]')).toHaveText(
      SECRET_MASK,
    )
    expect(await page.content(), 'the page while drilled').not.toContain(canary)
    await popToBreadcrumbSegment(page, seeded.testName)
  }

  for (const variant of ['Local', 'Library'] as const) {
    test(`a run masks the local secret on the console while the body uses the real value (${variant})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000)
      await ensureEnvironment(request)
      const canary = `fnlocal-run-${randomUUID()}`
      const seeded = await seed(request, variant, canary)
      await openTest(page, seeded.testId)

      await test.step('the row is masked while drilled before the run', async () => {
        await expectRowMaskedWhileDrilled(page, seeded, canary)
      })

      await test.step('the console masks it while the body computes on the real value', async () => {
        await selectEnvironment(page)
        const { verdict, entries } = await runToEnd(page)
        expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
        expectConsoleLine(entries, 'INFO', maskedLine(canary))
        const leaked = entries.filter((entry) => entry.message.includes(canary))
        expect(leaked, `the local secret leaked onto the console.\n${formatEntries(entries)}`).toEqual([])
      })

      await test.step('the row is masked while drilled after the run', async () => {
        await expectRowMaskedWhileDrilled(page, seeded, canary)
      })
    })

    test(`export carries the local secret masked, sealed or plain per the mode (${variant})`, async ({
      request,
    }) => {
      const canary = `fnlocal-export-${randomUUID()}`
      const seeded = await seed(request, variant, canary)
      for (const mode of MODES) {
        await test.step(`${variant === 'Local' ? 'Test' : 'Function'} export, ${mode}`, async () => {
          const exported =
            variant === 'Local'
              ? await exportTestJson(request, seeded.testId, mode)
              : await exportFunctionJson(request, seeded.functionId, mode)
          expectSecretUnderMode(declaredFields(exported.doc, 'fn_tok', 'value'), mode, canary, `${mode} export`)
          if (mode !== 'plaintext') expect(exported.text, `${mode} export`).not.toContain(canary)
        })
      }
    })

    test(`MCP reads leave the local secret out or masked (${variant})`, async ({ page, request }) => {
      test.setTimeout(180_000)
      const canary = `fnlocal-mcp-${randomUUID()}`
      const seeded = await seed(request, variant, canary)
      await enableMcpUntilRestart(page, MCP_PORT)

      await test.step('get_test and the recipe readback carry no value', () => {
        const read = callTool(MCP_PORT, 'get_test', { test_ref: seeded.testId })
        expect(read.isError, JSON.stringify(read.payload)).toBe(false)
        expect(JSON.stringify(read.payload), 'get_test').not.toContain(canary)
        const readback = callTool(MCP_PORT, 'get_test_recipe', { test_ref: seeded.testId })
        expect(readback.isError, JSON.stringify(readback.payload)).toBe(false)
        expect(JSON.stringify(readback.payload), 'get_test_recipe').not.toContain(canary)
        if (variant === 'Local') {
          const recipe = String(readback.payload.recipe)
          expect(recipe, 'the readback declares the local').toContain('fn_tok')
          expect(recipe, 'the readback leaves the value out').not.toContain(SECRET_MASK)
        }
      })

      if (variant === 'Library') {
        await test.step('get_function masks the value, latest and pinned', () => {
          for (const args of [
            { function_id: seeded.functionId },
            { function_id: seeded.functionId, version: '1.0.0' },
          ]) {
            const read = callTool(MCP_PORT, 'get_function', args)
            expect(read.isError, JSON.stringify(read.payload)).toBe(false)
            expect(JSON.stringify(read.payload), 'get_function').not.toContain(canary)
            expectSecretUnderMode(declaredFields(read.payload, 'fn_tok', 'value'), 'mask', canary, 'get_function')
          }
        })
      }
    })

    test(`a backup archive keeps the local secret masked or sealed (${variant})`, async ({ request }) => {
      test.setTimeout(120_000)
      const canary = `fnlocal-backup-${randomUUID()}`
      const seeded = await seed(request, variant, canary)
      const entity = variant === 'Local' ? 'tests' : 'functions'
      const member = variant === 'Local' ? `tests/${seeded.testName}.json` : `functions/${seeded.functionName}.json`
      for (const mode of ['mask', 'encrypted'] as const) {
        await test.step(`backup, ${mode}`, async () => {
          const zip = await backupArchive(request, entity, mode)
          expect(zip.includes(canary), `the ${mode} archive holds the value`).toBe(false)
          expect(zipEntryNames(zip), 'the archive carries the entity').toContain(member)
          const doc = JSON.parse(readZipEntryText(zip, member))
          expectSecretUnderMode(declaredFields(doc, 'fn_tok', 'value'), mode, canary, `${mode} backup`)
        })
      }
    })

    test(`a tracked execution persists the local secret masked (${variant})`, async ({ request }) => {
      test.setTimeout(180_000)
      const canary = `fnlocal-tracked-${randomUUID()}`
      const seeded = await seed(request, variant, canary)
      const { executionId, verdict } = await runTrackedTest(request, seeded.testId)
      expect(verdict, 'the tracked run passes').toBe('passed')

      const vars = await request.get(`${BACKEND_URL}/executions/${executionId}/variables`)
      expect(vars.ok(), `GET /executions/${executionId}/variables: ${vars.status()}`).toBeTruthy()
      expect(JSON.stringify(await vars.json()), 'the execution variables').not.toContain(canary)

      const record = dirBytes(path.join(STORAGE_BASE_PATH, 'api_executions', executionId))
      expect(record.length, 'the execution record is on disk').toBeGreaterThan(0)
      expect(record.includes(maskedLine(canary)), 'the record keeps the masked body line').toBe(true)
      expect(record.includes(canary), 'the execution record holds the value').toBe(false)
      expect(sweepStore(canary), 'store files holding the value after the tracked run').toEqual([])
    })
  }

  test('a Function local secret published to the library is sealed at rest (Library)', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const tag = randomUUID().slice(0, 8)
    const canary = `fnlocal-pub-${randomUUID()}`
    const testName = `zz-secrets-at-rest-fn-locals-publish-${tag}`
    const testId = await createValidTest(request, { name: testName, nodes: [] })
    testIds.push(testId)
    await openTest(page, testId)

    let functionId = ''
    await test.step('a Local Function with the secret local is published', async () => {
      const fnId = await dropBelowStart(page, page.locator('[data-testid="palette-new-block-button"]'))
      await digIn(page, fnId)
      await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
      await createFunctionParam(page, 'variable', 'fn_tok', { value: canary, secret: true })
      await popToBreadcrumbSegment(page, testName)
      functionId = await publishToLibrary(page, fnId, `zz-fn-local-pub-${tag}`)
      functionIds.push(functionId)
    })

    // Per REQ-4.5.1: the library version stores the local as an envelope.
    await test.step('the library stores the local sealed and reads it masked', async () => {
      expect(sweepStore(canary), 'store files holding the local secret').toEqual([])
      expect(
        dirBytes(path.join(STORAGE_BASE_PATH, 'functions', functionId)).includes(SECRET_ENVELOPE),
        'the library Function carries the sealed envelope',
      ).toBe(true)
      const resp = await request.get(`${BACKEND_URL}/functions/${functionId}`)
      expect(resp.ok(), `GET /functions/${functionId}: ${resp.status()}`).toBeTruthy()
      const local = (((await resp.json()).data?.variables ?? []) as Array<Record<string, unknown>>).find(
        (entry) => entry.name === 'fn_tok',
      )
      expect(local, 'the library local is the seed shape').toMatchObject({
        name: 'fn_tok',
        type: 'string',
        secret: true,
      })
      expect(local?.value, 'GET /functions masks the local').toBe(SECRET_MASK)
    })
  })
})
