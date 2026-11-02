/**
 * V-NUMBER-VARS-ENTITY: a Test, Suite or Regression integer variable that is no whole number of at most 19 digits is refused by name
 * Wireframe: N/A (the Import dialog and the Edit Variables dialog keep their look)
 * Design Decisions: VMGR-110
 * REQ: REQ-3.1.3.14
 *
 * Every Test, Suite and Regression is named `zz-11541-s9-...` per run and deleted afterwards. The bad
 * values are `80.5` and a 20-digit integer; the files are raw JSON text, so every digit reaches the server.
 *
 * Pass Criteria:
 * 1. A Test saved through the API whose integer variable holds `80.5` is refused with the finding
 *    `Value for variable 'retries' is not a valid integer`; with 20 digits, with
 *    `Value for variable 'retries' allows at most 19 digits, got 20`; no Test is stored.
 * 2. The Tests list Import dialog blocks a Test file whose integer variable holds `80.5` with that same
 *    message (`0 importable, 1 blocked`); importing the file is refused 400 with it and writes nothing.
 * 3. A Suite and a Regression saved through the API with the integer `80.5` are refused 400
 *    `Value for variable 'retries' is not a valid integer`, and with 20 digits
 *    `Value for variable 'retries' allows at most 19 digits, got 20`; none is stored.
 * 4. The Suites and Regressions Import dialogs block a file whose integer variable holds `80.5` with
 *    `Value for variable 'retries' is not a valid integer` (`0 importable, 1 blocked`); importing that file
 *    is refused 400 with the same message and writes nothing.
 * 5. A Suite float variable stored as `0.0000001` shows `0.0000001` in its Edit Variables row; a digit typed
 *    at its end is kept and saved as `0.00000015`, and the reopened row shows `0.00000015`.
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { createEntity, entityVariableRow, openEntityVariables, saveVariablesDialog } from '../../helpers/entity-variables'
import { runToken } from '../../helpers/element-types'
import { expectBlocked, importDryRun, messagesOf, refusalOf, typeAtEnd } from '../../helpers/number-entry'

const VARIABLE = 'retries'
const NOT_INTEGER = `Value for variable '${VARIABLE}' is not a valid integer`
const PAST_THE_CAP = `Value for variable '${VARIABLE}' allows at most 19 digits, got 20`
const TWENTY_DIGITS = '12345678901234567890'

type Kind = 'tests' | 'suites' | 'regressions'

/** Every stored entity of `kind` named exactly `name`. */
async function idsNamed(request: APIRequestContext, kind: Kind, name: string): Promise<string[]> {
  const response = await request.get(`${BACKEND_URL}/${kind}?search=${encodeURIComponent(name)}&per_page=100`)
  expect(response.ok(), `GET /${kind} answered ${response.status()}`).toBeTruthy()
  const body = await response.json()
  const rows = (Array.isArray(body) ? body : (body.data ?? [])) as Array<{ id: string; name: string }>
  return rows.filter((row) => row.name === name).map((row) => row.id)
}

async function deleteNamed(request: APIRequestContext, kind: Kind, name: string): Promise<void> {
  for (const id of await idsNamed(request, kind, name)) {
    await request.delete(`${BACKEND_URL}/${kind}/${id}`).catch(() => undefined)
  }
}

function testDocument(name: string, value: unknown): Record<string, unknown> {
  return {
    name,
    version: '1.0.0',
    description: '',
    tags: [],
    workflow: { nodes: [], edges: [] },
    variables: { [VARIABLE]: { type: 'integer', value, scope: 'test' } },
  }
}

/** A JSON file of one document whose integer variable is written as the raw literal `literal`. */
function rawJsonFile(document: Record<string, unknown>, literal: string) {
  const text = JSON.stringify(document).replace('"__VALUE__"', literal)
  return { name: 'zz-11541-s9-entity.json', mimeType: 'application/json', buffer: Buffer.from(text, 'utf-8') }
}

test.describe('V-NUMBER-VARS-ENTITY: Test, Suite and Regression variables keep the one number rule', () => {
  const token = runToken()
  const names = {
    test: `zz-11541-s9-vars-test-${token}`,
    suite: `zz-11541-s9-vars-suite-${token}`,
    regression: `zz-11541-s9-vars-regression-${token}`,
    tiny: `zz-11541-s9-vars-tiny-${token}`,
  }

  test.afterAll(async ({ request }) => {
    await deleteNamed(request, 'tests', names.test)
    await deleteNamed(request, 'suites', names.suite)
    await deleteNamed(request, 'suites', names.tiny)
    await deleteNamed(request, 'regressions', names.regression)
  })

  test('a Test integer variable of 80.5 or 20 digits is refused by name, through the API and the Import dialog', async ({
    page,
    request,
  }) => {
    await ensureEnvironment(request)

    for (const [value, message] of [
      ['80.5', NOT_INTEGER],
      [TWENTY_DIGITS, PAST_THE_CAP],
    ] as const) {
      await test.step(`1. POST /tests with ${value} is refused naming the variable`, async () => {
        const refusal = await refusalOf(
          await request.post(`${BACKEND_URL}/tests`, { data: testDocument(names.test, value) }),
          `POST /tests with the integer ${value}`,
        )
        expect(messagesOf(refusal, 'INVALID_VARIABLE_VALUE')).toEqual([message])
        expect(await idsNamed(request, 'tests', names.test), 'no Test is stored').toEqual([])
      })
    }

    await test.step('2. the Tests Import dialog blocks the file naming the variable', async () => {
      const file = rawJsonFile(testDocument(names.test, '__VALUE__'), '80.5')
      const dryRun = await importDryRun(page, '/tests', file, 'tests')
      await expectBlocked(dryRun, names.test, NOT_INTEGER)
      await expect(dryRun.dialog.locator('[data-testid="import-summary"]')).toHaveText('0 importable, 1 blocked')
      await expect(dryRun.dialog.locator('[data-testid="import-button"]'), 'nothing can be imported').toBeDisabled()
    })

    await test.step('2. importing the file is refused 400 naming the variable and writes nothing', async () => {
      const file = rawJsonFile(testDocument(names.test, '__VALUE__'), '80.5')
      const refusal = await refusalOf(
        await request.post(`${BACKEND_URL}/tests/import`, { multipart: { file } }),
        'POST /tests/import',
      )
      expect(refusal.status).toBe(400)
      expect(refusal.message).toBe(NOT_INTEGER)
      expect(await idsNamed(request, 'tests', names.test), 'the import writes nothing').toEqual([])
    })
  })

  for (const kind of ['suites', 'regressions'] as const) {
    const listKey = kind
    const document = (name: string, value: unknown): Record<string, unknown> => ({
      name,
      description: '',
      ...(kind === 'suites' ? { tests: [] } : { suites: [] }),
      variables: { [VARIABLE]: { type: 'integer', value } },
    })

    test(`a ${kind === 'suites' ? 'Suite' : 'Regression'} integer variable of 80.5 or 20 digits is refused by name, and its import writes nothing`, async ({
      page,
      request,
    }) => {
      const name = kind === 'suites' ? names.suite : names.regression

      for (const [value, message] of [
        ['80.5', NOT_INTEGER],
        [TWENTY_DIGITS, PAST_THE_CAP],
      ] as const) {
        await test.step(`3. POST /${kind} with ${value} is refused naming the variable`, async () => {
          const refusal = await refusalOf(
            await request.post(`${BACKEND_URL}/${kind}`, { data: document(name, value) }),
            `POST /${kind} with the integer ${value}`,
          )
          expect(refusal.status).toBe(400)
          expect(refusal.message).toBe(message)
          expect(await idsNamed(request, kind, name), 'nothing is stored').toEqual([])
        })
      }

      const file = rawJsonFile(document(name, '__VALUE__'), '80.5')

      await test.step('4. the Import dialog blocks the file naming the variable', async () => {
        const dryRun = await importDryRun(page, `/${kind}`, file, listKey)
        await expectBlocked(dryRun, name, NOT_INTEGER)
        await expect(dryRun.dialog.locator('[data-testid="import-summary"]')).toHaveText('0 importable, 1 blocked')
        await expect(dryRun.dialog.locator('[data-testid="import-button"]'), 'nothing can be imported').toBeDisabled()
      })

      await test.step('4. importing the file is refused with the same message and writes nothing', async () => {
        const refusal = await refusalOf(
          await request.post(`${BACKEND_URL}/${kind}/import`, { multipart: { file } }),
          `POST /${kind}/import`,
        )
        expect(refusal.status).toBe(400)
        expect(refusal.message).toBe(NOT_INTEGER)
        expect(await idsNamed(request, kind, name), 'the import writes nothing').toEqual([])
      })
    })
  }

  test('a Suite float stored as 0.0000001 shows in plain digits and takes a digit typed at its end', async ({
    page,
    request,
  }) => {
    const suiteId = await createEntity(request, '/suites', {
      name: names.tiny,
      variables: { tiny: { type: 'float', value: 1e-7 } },
    })
    const openTiny = async (pageRef: Page) => {
      const dialog = await openEntityVariables(pageRef, 'suite', suiteId)
      return { dialog, box: (await entityVariableRow(dialog, 'tiny')).locator('[data-testid="scalar-edit-input"]') }
    }

    await test.step('5. the row shows 0.0000001; a digit typed at its end is kept and saved exactly', async () => {
      const { dialog, box } = await openTiny(page)
      await expect(box).toHaveValue('0.0000001')
      await typeAtEnd(box, '5')
      await expect(box).toHaveValue('0.00000015')
      await saveVariablesDialog(dialog)
      const stored = await request.get(`${BACKEND_URL}/suites/${suiteId}`)
      expect(stored.ok()).toBeTruthy()
      expect(((await stored.json()).data.variables.tiny as { value: unknown }).value).toBe('0.00000015')
    })

    await test.step('5. the reopened row shows 0.00000015', async () => {
      const { box } = await openTiny(page)
      await expect(box).toHaveValue('0.00000015')
    })
  })
})
