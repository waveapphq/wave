/**
 * V-FN-SECRET-OUTPUT: a secret output parameter and its default
 * Design Decisions: SECUI-11, FNCFG-7
 * REQ: REQ-3.1.2.9, REQ-3.1.3.5, REQ-4.5.1, REQ-5.2.4.9
 *
 * Phase: functional-workflow. Setup seeds (none is the thing under test):
 * - POST /tests: a blank `zz-` Test holding one empty Local Function, a blank Test
 *   (the library publish test), or a Test whose Local Function declares the secret output
 *   `out_tok` (the shape the window stores) with a default or with a body
 *   Variable Setter writing it, or a Shared instance of a library Function.
 * - POST /functions (`publishLibraryFunction`): the library Function with the same output and
 *   body, deleted with cascade=true.
 * The output window, Publish to Library, every Function Block edit and every run go through the
 * UI. Exports (POST /tests/export, GET /functions/{id}/export), backups (POST /api/backup/create,
 * read with `helpers/zip-reader.ts`) and MCP reads are the surfaces read; MCP settings are reset
 * in afterAll.
 *
 * Pass Criteria:
 * 1. The saved Test declares the output `out_tok` secret.
 * 2. No file anywhere in the store holds the output's default, and the stored Test carries a
 *    sealed envelope in its place.
 * 3. The output's Variable Manager row shows the mask, never the default.
 * 4. (Local, Library) The Function Block opens with Secret ticked on the secret output; an
 *    untick is kept on Save (`outputSecretFields` stored empty) and the bound variable stays
 *    plain at run.
 * 5. (Local, Library) A new variable typed into Assign to on a ticked row is created secret:
 *    stored `secret: true`, SECRET badge, masked in the session read after the run; the Save stores
 *    no `outputSecretFields` of its own, since the Secret box was left as declared.
 * 6. (Library) A secret output default published from a Local Function is stored sealed in the
 *    library and masked in the library Function's Variable Manager row.
 * 7. (Local, Library) The default never shows in the inspect window (expand stays locked) or the
 *    Function Block sheet.
 * 8. (Local, Library) MCP reads leave the default out (recipe readback) or masked
 *    (`get_function`), never the value.
 * 9. (Local: Test export, Library: Function export) Mask writes `********`, Keep encrypted an
 *    envelope, Decrypt the value.
 * 10. (Local, Library) A backup archive in mask and encrypted mode holds the mask or an
 *    envelope in the entity's member, and the value nowhere.
 */

import path from 'path'
import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, STORAGE_BASE_PATH, ensureEnvironment } from '../../helpers/config'
import { bindOutput, outputRow } from '../../helpers/config-sheet'
import { getActiveSessionId, getSessionVariables } from '../../helpers/fixture-import'
import {
  createValidTest,
  localFunctionNode,
  openFunctionView,
  openTest,
  publishLibraryFunction,
  sharedNode,
  startEdge,
} from '../../helpers/fn-seed'
import { controlNode } from '../../helpers/k8s-nodes'
import { runTrackedTest } from '../../helpers/k8s-run'
import { formatEntries } from '../../helpers/log-reader'
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
  openBlockSheet,
  popToBreadcrumbSegment,
  publishToLibrary,
  runToEnd,
  saveBlockSheet,
  saveBtn,
  saveTest,
  selectEnvironment,
} from '../../helpers/workbench'
import { readZipEntryText, zipEntryNames } from '../../helpers/zip-reader'

const FN_NODE = 'fn-1'

/** The saved Function's output parameters, read back from the stored Test. */
async function storedOutputs(
  request: APIRequestContext,
  testId: string,
): Promise<Array<Record<string, unknown>>> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  const nodes = (await resp.json()).data.workflow.nodes as Array<{
    id: string
    data: { localDefinition?: { outputs?: Array<Record<string, unknown>> } }
  }>
  const fn = nodes.find((node) => node.id === FN_NODE)
  expect(fn, 'the stored Test keeps the Local Function').toBeTruthy()
  return fn?.data.localDefinition?.outputs ?? []
}

test.describe('V-FN-SECRET-OUTPUT: secret output parameters', () => {
  let testId: string | undefined

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
  })

  test('a secret output default is stored sealed and masked everywhere', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const canary = `outdef-${randomUUID()}`
    testId = await createValidTest(request, {
      name: `zz-fn-secret-output ${randomUUID().slice(0, 8)}`,
      nodes: [localFunctionNode(FN_NODE, 'Function_1', { nodes: [] })],
      edges: [startEdge(FN_NODE)],
    })
    await openTest(page, testId)
    await digIn(page, FN_NODE)

    await test.step('Add > Output parameter creates out_tok marked as secret with a default', async () => {
      await openFunctionCreateModal(page, 'output')
      await setCreateName(page, 'out_tok')
      await typeStringValue(page, canary)
      await expect(valueEditor(page), 'the window holds the typed default').toHaveValue(canary)
      await createModal(page).locator('[data-testid="create-secret-checkbox"]').click()
      await submitCreate(page)
      await expect(createModal(page)).toBeHidden()
      await expect(variableRow(page, 'out_tok')).toBeVisible()
    })

    await test.step('Save stores the output declared secret', async () => {
      await expect(saveBtn(page)).toBeEnabled()
      await saveBtn(page).click()
      await expect(saveBtn(page)).toBeDisabled({ timeout: 15_000 })
      const output = (await storedOutputs(request, testId as string)).find(
        (entry) => entry.name === 'out_tok',
      )
      expect(output, 'the saved Function keeps its output out_tok').toBeTruthy()
      expect(output?.secret, 'out_tok is stored as a secret').toBe(true)
    })

    // Per SECUI-11: the default is sealed at rest and masked in the UI.
    await test.step('no store file holds the secret output default', () => {
      expect
        .soft(sweepStore(canary), 'store files holding the secret output default')
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

    await test.step('the output row shows the mask, never the default', async () => {
      await expect(
        variableRow(page, 'out_tok').locator('[data-testid^="variable-value-"]'),
        'the out_tok row value',
      ).toHaveText(SECRET_MASK)
    })
  })
})

// ---------------------------------------------------------------------------
// Every variant of the secret output (Local and Library)
// ---------------------------------------------------------------------------

const MCP_PORT = Number(BACKEND_PORT) + 765
const SETTER = 'fn-set'
/** The output the window stores for Name `out_tok` + Mark as secret; the seeds reuse it. */
const SECRET_OUTPUT = { name: 'out_tok', type: 'string', secret: true }
const MODES: readonly SecretsMode[] = ['mask', 'encrypted', 'plaintext']

type Variant = 'Local' | 'Library'

interface Seeded {
  testId: string
  testName: string
  /** Library variant only. */
  functionId: string
  functionName: string
}

interface StoredNode {
  id: string
  data: {
    config?: { outputBindings?: Record<string, string>; outputSecretFields?: string[] }
  }
}

interface StoredTest {
  workflow: { nodes: StoredNode[] }
  variables: Record<string, Record<string, unknown>>
}

async function storedTest(request: APIRequestContext, id: string): Promise<StoredTest> {
  const resp = await request.get(`${BACKEND_URL}/tests/${id}`)
  expect(resp.ok(), `GET /tests/${id} failed: ${resp.status()}`).toBeTruthy()
  const data = (await resp.json()).data
  return { workflow: data.workflow, variables: data.variables ?? {} }
}

function storedConfig(test: StoredTest): NonNullable<StoredNode['data']['config']> {
  const node = test.workflow.nodes.find((entry) => entry.id === FN_NODE)
  expect(node, 'the stored Test keeps the Function Block').toBeTruthy()
  return node?.data.config ?? {}
}

/** A body Variable Setter writing `value` into the output. */
function outputWriter(value: string): Record<string, unknown> {
  return controlNode({
    id: SETTER,
    label: 'Variable Setter',
    elementType: 'variable-setter',
    category: 'flow',
    description: 'writes out_tok',
    values: { variables: { out_tok: value } },
  }) as unknown as Record<string, unknown>
}

async function runPassed(page: Page): Promise<void> {
  await selectEnvironment(page)
  const { verdict, entries } = await runToEnd(page)
  expect(verdict, `the run passes.\n${formatEntries(entries)}`).toBe('passed')
}

test.describe('V-FN-SECRET-OUTPUT: every variant of a secret output', () => {
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

  /** A Test whose Function Block calls a Function declaring the secret output `out_tok`. */
  async function seed(
    request: APIRequestContext,
    variant: Variant,
    opts: { defaultValue?: string; writes?: string },
  ): Promise<Seeded> {
    const tag = randomUUID().slice(0, 8)
    const testName = `zz-fn-secret-output-${variant.toLowerCase()}-${tag}`
    const output = opts.defaultValue === undefined ? SECRET_OUTPUT : { ...SECRET_OUTPUT, default: opts.defaultValue }
    const body =
      opts.writes === undefined
        ? { nodes: [], edges: [] }
        : { nodes: [outputWriter(opts.writes)], edges: [startEdge(SETTER)] }
    let node: Record<string, unknown>
    let functionId = ''
    let functionName = ''
    if (variant === 'Local') {
      node = localFunctionNode(FN_NODE, 'Function_1', { ...body, outputs: [output] })
    } else {
      const fn = await publishLibraryFunction(request, {
        name: `zz-sec-out-${tag}`,
        outputs: [output],
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

  for (const variant of ['Local', 'Library'] as const) {
    test(`the Function Block opens with Secret ticked on a secret output and keeps an untick on Save (${variant})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000)
      await ensureEnvironment(request)
      const written = `out-plain-${randomUUID()}`
      const seeded = await seed(request, variant, { writes: written })
      await openTest(page, seeded.testId)

      // Per SECUI-11: the row seeds Secret ticked and the author may untick it.
      await test.step('Secret opens ticked and the author unticks it', async () => {
        const sheet = await openBlockSheet(page, FN_NODE)
        const secretBox = sheet.locator('[data-testid="output-secret-out_tok"]')
        await expect(secretBox).toHaveAttribute('data-state', 'checked')
        await secretBox.click()
        await expect(secretBox).toHaveAttribute('data-state', 'unchecked')
        await bindOutput(sheet, 'out_tok', 'plain_out')
        await saveBlockSheet(sheet)
        await saveTest(page)
      })

      await test.step('Save keeps the untick', async () => {
        const stored = await storedTest(request, seeded.testId)
        const config = storedConfig(stored)
        expect(config.outputSecretFields, 'no output is marked Secret').toEqual([])
        expect(config.outputBindings).toMatchObject({ out_tok: 'plain_out' })
        expect(stored.variables.plain_out?.secret ?? false, 'plain_out is stored plain').toBe(false)
        const sheet = await openBlockSheet(page, FN_NODE)
        await expect(sheet.locator('[data-testid="output-secret-out_tok"]')).toHaveAttribute(
          'data-state',
          'unchecked',
        )
        await page.keyboard.press('Escape')
        await expect(sheet).toHaveCount(0)
      })

      await test.step('the run leaves the bound variable plain', async () => {
        await runPassed(page)
        await expandVariableManager(page)
        await expect(variableRow(page, 'plain_out').locator('[data-testid^="secret-badge-"]')).toHaveCount(0)
        const variables = await getSessionVariables(page, await getActiveSessionId(page))
        expect(variables.plain_out?.value, 'the session read of plain_out').toBe(written)
      })
    })

    test(`an unticked secret output bound to a variable of its own name reads plain after the run (${variant})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000)
      await ensureEnvironment(request)
      const written = `out-same-${randomUUID()}`
      const seeded = await seed(request, variant, { writes: written })
      await openTest(page, seeded.testId)

      await test.step('the unticked row binds a new variable named out_tok', async () => {
        const sheet = await openBlockSheet(page, FN_NODE)
        await sheet.locator('[data-testid="output-secret-out_tok"]').click()
        await bindOutput(sheet, 'out_tok', 'out_tok')
        await saveBlockSheet(sheet)
        await saveTest(page)
        expect(storedConfig(await storedTest(request, seeded.testId)).outputSecretFields).toEqual([])
      })

      // Per SECUI-11: the output's secret name inside the Function never masks the caller's.
      await test.step('the run leaves the caller variable plain', async () => {
        await runPassed(page)
        await expandVariableManager(page)
        await expect(variableRow(page, 'out_tok').locator('[data-testid^="secret-badge-"]')).toHaveCount(0)
        const variables = await getSessionVariables(page, await getActiveSessionId(page))
        expect(variables.out_tok?.value, 'the session read of out_tok').toBe(written)
      })
    })

    test(`a tracked run returns an unticked secret output plain (${variant})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000)
      await ensureEnvironment(request)
      const written = `out-tracked-${randomUUID()}`
      const seeded = await seed(request, variant, { writes: written })
      await openTest(page, seeded.testId)
      const sheet = await openBlockSheet(page, FN_NODE)
      await sheet.locator('[data-testid="output-secret-out_tok"]').click()
      await bindOutput(sheet, 'out_tok', 'plain_out')
      await saveBlockSheet(sheet)
      await saveTest(page)
      await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)

      const { executionId, verdict } = await runTrackedTest(request, seeded.testId)
      expect(verdict, 'the tracked run passes').toBe('passed')
      const resp = await request.get(`${BACKEND_URL}/executions/${executionId}/variables`)
      expect(resp.ok(), `GET /executions/${executionId}/variables: ${resp.status()}`).toBeTruthy()
      expect(JSON.stringify(await resp.json()), 'the tracked run keeps plain_out plain').toContain(written)
    })

    test(`a new variable typed into Assign to on a secret output is created secret (${variant})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000)
      await ensureEnvironment(request)
      const written = `out-secret-${randomUUID()}`
      const seeded = await seed(request, variant, { writes: written })
      await openTest(page, seeded.testId)

      // Per SECUI-11: a new variable typed into a ticked row is created secret, with no warning.
      await test.step('the new variable is bound on the ticked row', async () => {
        const sheet = await openBlockSheet(page, FN_NODE)
        await expect(sheet.locator('[data-testid="output-secret-out_tok"]')).toHaveAttribute(
          'data-state',
          'checked',
        )
        await bindOutput(sheet, 'out_tok', 'new_tok')
        await saveBlockSheet(sheet)
        await expect(page.locator('[data-testid="secret-promote-dialog"]')).toHaveCount(0)
        await saveTest(page)
      })

      await test.step('the variable is created secret', async () => {
        const stored = await storedTest(request, seeded.testId)
        // Per FNCFG-7: the Secret box was left as declared, so the Save stores no list of its own.
        expect(storedConfig(stored).outputSecretFields).toBeUndefined()
        expect(stored.variables.new_tok, 'new_tok is declared').toBeTruthy()
        expect(stored.variables.new_tok?.secret, 'new_tok is stored secret').toBe(true)
        await expandVariableManager(page)
        await expect(variableRow(page, 'new_tok').locator('[data-testid^="secret-badge-"]')).toHaveCount(1)
      })

      await test.step('the run writes it masked', async () => {
        await runPassed(page)
        const variables = await getSessionVariables(page, await getActiveSessionId(page))
        expect(variables.new_tok?.value, 'the session read of new_tok').toBe(SECRET_MASK)
        expect(JSON.stringify(variables), 'the session read').not.toContain(written)
      })
    })

    test(`the secret output default stays hidden in the inspect window and the Function Block sheet (${variant})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000)
      const canary = `outdef-view-${randomUUID()}`
      const seeded = await seed(request, variant, { defaultValue: canary })
      await openTest(page, seeded.testId)

      await test.step('the output row is masked and cannot be inspected', async () => {
        await digIn(page, FN_NODE)
        await expandVariableManager(page)
        const row = variableRow(page, 'out_tok')
        await expect(row.locator('[data-testid^="variable-value-"]')).toHaveText(SECRET_MASK)
        const expand = row.locator('[data-testid^="expand-button-"]')
        await expect(expand).toHaveAttribute('aria-disabled', 'true')
        await expect(expand).toHaveAttribute('aria-label', 'Secret value for out_tok cannot be inspected')
        await row.hover()
        await expand.click({ force: true })
        await expect(page.locator('section[aria-label="Inspect variable out_tok"]')).toHaveCount(0)
        expect(await page.content(), 'the page while drilled').not.toContain(canary)
        await popToBreadcrumbSegment(page, seeded.testName)
      })

      await test.step('the Function Block sheet never shows it', async () => {
        const sheet = await openBlockSheet(page, FN_NODE)
        await expect(outputRow(sheet, 'out_tok')).toBeVisible()
        await expect(sheet).not.toContainText(canary)
        expect(await page.content(), 'the page with the sheet open').not.toContain(canary)
        await page.keyboard.press('Escape')
        await expect(sheet).toHaveCount(0)
      })
    })

    test(`MCP reads leave the secret output default out or masked (${variant})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000)
      const canary = `outdef-mcp-${randomUUID()}`
      const seeded = await seed(request, variant, { defaultValue: canary })
      await enableMcpUntilRestart(page, MCP_PORT)

      await test.step('get_test and the recipe readback carry no default', () => {
        const read = callTool(MCP_PORT, 'get_test', { test_ref: seeded.testId })
        expect(read.isError, JSON.stringify(read.payload)).toBe(false)
        expect(JSON.stringify(read.payload), 'get_test').not.toContain(canary)
        const readback = callTool(MCP_PORT, 'get_test_recipe', { test_ref: seeded.testId })
        expect(readback.isError, JSON.stringify(readback.payload)).toBe(false)
        expect(JSON.stringify(readback.payload), 'get_test_recipe').not.toContain(canary)
        if (variant === 'Local') {
          const recipe = String(readback.payload.recipe)
          expect(recipe, 'the readback declares the output').toContain('out_tok')
          expect(recipe, 'the readback leaves the default out').not.toContain(SECRET_MASK)
        }
      })

      if (variant === 'Library') {
        await test.step('get_function masks the default, latest and pinned', () => {
          for (const args of [
            { function_id: seeded.functionId },
            { function_id: seeded.functionId, version: '1.0.0' },
          ]) {
            const read = callTool(MCP_PORT, 'get_function', args)
            expect(read.isError, JSON.stringify(read.payload)).toBe(false)
            expect(JSON.stringify(read.payload), 'get_function').not.toContain(canary)
            expectSecretUnderMode(declaredFields(read.payload, 'out_tok', 'default'), 'mask', canary, 'get_function')
          }
        })
      }
    })

    test(`export carries the secret output default masked, sealed or plain per the mode (${variant})`, async ({
      request,
    }) => {
      const canary = `outdef-export-${randomUUID()}`
      const seeded = await seed(request, variant, { defaultValue: canary })
      for (const mode of MODES) {
        await test.step(`${variant === 'Local' ? 'Test' : 'Function'} export, ${mode}`, async () => {
          const exported =
            variant === 'Local'
              ? await exportTestJson(request, seeded.testId, mode)
              : await exportFunctionJson(request, seeded.functionId, mode)
          expectSecretUnderMode(declaredFields(exported.doc, 'out_tok', 'default'), mode, canary, `${mode} export`)
          if (mode !== 'plaintext') expect(exported.text, `${mode} export`).not.toContain(canary)
        })
      }
    })

    test(`a backup archive keeps the secret output default masked or sealed (${variant})`, async ({
      request,
    }) => {
      test.setTimeout(120_000)
      const canary = `outdef-backup-${randomUUID()}`
      const seeded = await seed(request, variant, { defaultValue: canary })
      const entity = variant === 'Local' ? 'tests' : 'functions'
      const member = variant === 'Local' ? `tests/${seeded.testName}.json` : `functions/${seeded.functionName}.json`
      for (const mode of ['mask', 'encrypted'] as const) {
        await test.step(`backup, ${mode}`, async () => {
          const zip = await backupArchive(request, entity, mode)
          expect(zip.includes(canary), `the ${mode} archive holds the default`).toBe(false)
          expect(zipEntryNames(zip), 'the archive carries the entity').toContain(member)
          const doc = JSON.parse(readZipEntryText(zip, member))
          expectSecretUnderMode(declaredFields(doc, 'out_tok', 'default'), mode, canary, `${mode} backup`)
        })
      }
    })
  }

  test('a secret output default published to the library is stored sealed and masked (Library)', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const tag = randomUUID().slice(0, 8)
    const canary = `outdef-pub-${randomUUID()}`
    const testName = `zz-fn-secret-output-publish-${tag}`
    const testId = await createValidTest(request, { name: testName, nodes: [] })
    testIds.push(testId)
    await openTest(page, testId)

    let functionId = ''
    await test.step('a Local Function with the secret output is published', async () => {
      const fnId = await dropBelowStart(page, page.locator('[data-testid="palette-new-block-button"]'))
      await digIn(page, fnId)
      await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
      await createFunctionParam(page, 'output', 'out_tok', { value: canary, secret: true })
      await popToBreadcrumbSegment(page, testName)
      functionId = await publishToLibrary(page, fnId, `zz-sec-out-pub-${tag}`)
      functionIds.push(functionId)
    })

    // Per SECUI-11: the library version stores the default sealed.
    await test.step('the library stores the default sealed', async () => {
      expect(sweepStore(canary), 'store files holding the secret output default').toEqual([])
      expect(
        dirBytes(path.join(STORAGE_BASE_PATH, 'functions', functionId)).includes(SECRET_ENVELOPE),
        'the library Function carries the sealed envelope',
      ).toBe(true)
      const resp = await request.get(`${BACKEND_URL}/functions/${functionId}`)
      expect(resp.ok(), `GET /functions/${functionId}: ${resp.status()}`).toBeTruthy()
      const body = await resp.json()
      const output = ((body.data?.outputs ?? []) as Array<Record<string, unknown>>).find(
        (entry) => entry.name === 'out_tok',
      )
      expect(output, 'the library output is the seed shape').toMatchObject(SECRET_OUTPUT)
      expect(output?.default, 'GET /functions masks the default').toBe(SECRET_MASK)
    })

    await test.step("the library Function's output row is masked", async () => {
      await openFunctionView(page, functionId, '1.0.0')
      await expandVariableManager(page)
      await expect(variableRow(page, 'out_tok').locator('[data-testid^="variable-value-"]')).toHaveText(
        SECRET_MASK,
      )
      expect(await page.content(), 'the Function View').not.toContain(canary)
    })
  })
})
