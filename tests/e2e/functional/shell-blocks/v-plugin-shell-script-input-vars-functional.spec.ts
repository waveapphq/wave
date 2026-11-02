/**
 * SH-3: Shell Script Input Variables reach a child process
 * Design Decisions: SHRUN-5
 * REQ: REQ-3.4.1.1
 *
 * Pass Criteria:
 * 1. The run passes and `sh-input-vars` paints success.
 * 2. `iv_out` is exactly `hello world|42|true|["a",2,true]`: a literal, an integer, a
 *    boolean and an array expression each arrive as environment text in a child process
 *    of the script (the array as JSON text).
 * 3. The sheet's Input Variables row reads "4 entries".
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { startRun, finishRun, expectNodeStatus } from '../../helpers/k8s-run'
import { closeConfig, deleteTest, openConfig } from '../file-picker/picker'
import { newToken, stripOneNewline, withToken } from './shell-helpers'

const NODE = 'sh-input-vars'

function loadFixture(token: string): Record<string, unknown> {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture-input-vars.json'), 'utf-8'))
  return withToken(raw, token)
}

test.describe('SH-3: Shell Script Input Variables reach a child process', () => {
  let testId: string | undefined

  test.afterAll(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
  })

  test('SH-3 literal, expression and array Input Variables arrive as text', async ({
    page,
  }: {
    page: Page
  }) => {
    test.setTimeout(180_000)
    const token = newToken()
    testId = await importValidateAndNavigate(page, loadFixture(token))

    await test.step('the run passes and the child printed every variable', async () => {
      const status = await startRun(page)
      await finishRun(page, status, `SH-3-done-${token}`)
      await expectNodeStatus(page, NODE, 'success')
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      expect(stripOneNewline(String(variables.iv_out.value))).toBe(
        'hello world|42|true|["a",2,true]',
      )
    })

    await test.step('the Input Variables row draws its four entries on one line (FIELD-6)', async () => {
      const dialog = await openConfig(page, NODE)
      await expect(dialog.locator('[data-testid="param-row-input_vars"] [data-slot="input-group"] input')).toHaveValue(
        /^\{\s*"GREETING": "hello world",\s*"COUNT": \{\{ num \}\},\s*"FLAG": \{\{ flag \}\},\s*"ITEMS": \{\{ items \}\}\s*\}$/,
      )
      await closeConfig(dialog)
    })
  })
})
