/**
 * V-EXEC-HISTORY-SECRET-COPY-LIVE: an unflagged copy of a secret table, map or list reads masked in the
 * live Variable Manager and its watcher, and is not marked secret on the run page of a deleted Test
 * REQ: REQ-3.1.3.5 (Secret variable masking) / REQ-3.1.3.11 (Variable watching UI panel) /
 *      REQ-3.1.3.12 (Auto-refresh variables on change) / REQ-5.2.1.40 (Execution history screen)
 * Design: copying a secret does not make the copy secret, but a byte-identical copy is still masked by
 *         value; in variable displays and watch pushes an entry masked whole is the bare placeholder,
 *         with no keys, no shape and no counts. The watcher's type-mismatch notice is for a runtime value
 *         whose type contradicts its declaration, which a masked copy is not.
 *
 * Phase: functional-workflow. API seed (POST /tests) through `secret-copy.ts`, no fixture file: a secret
 * table, a secret map and a secret list whose cells are shorter than the 6 character scan floor, and one
 * Variable Setter whose Expression rows copy each into an unflagged variable of the same type, and a
 * plain table into a plain variable. Validated with zero errors.
 *
 * Pass Criteria:
 * 1. Run live in the Workbench, each secret source reads `********` and cannot be inspected, each copy
 *    reads `********` and the plain copy `1×2 table`.
 * 2. The watcher of each copy shows `********`, with no type mismatch notice and no `type mismatch`
 *    metric; no column name, map key or cell of the secrets is in the panel or a watcher.
 * 3. Run as a tracked execution and the Test deleted, the run page shows each copy as `********` with no
 *    SECRET badge; only the three secret sources carry it, and the plain copy reads `1×2 table`.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { cleanUp } from '../../helpers/fn-block'
import { openTest } from '../../helpers/fn-seed'
import { openRunHistory, runTrackedTest } from '../../helpers/k8s-run'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'
import { runToTerminal, selectEnvironment } from '../../helpers/workbench'
import { COPIES, createSecretCopyTest, PLAIN_COPY, SECRET_TEXTS } from './secret-copy'

let testIds: string[] = []
let executionIds: string[] = []

function rowValue(page: Page, name: string): Locator {
  return variableRow(page, name).locator('[data-testid^="variable-value-"]')
}

function secretBadge(page: Page, name: string): Locator {
  return variableRow(page, name).locator('[data-testid^="secret-badge-"]')
}

function expandButton(page: Page, name: string): Locator {
  return variableRow(page, name).locator('[data-testid^="expand-button-"]')
}

function watcher(page: Page, name: string): Locator {
  return page.getByRole('dialog', { name: name, exact: true, includeHidden: true })
}

async function panelText(page: Page): Promise<string> {
  return page.locator('[data-testid="variable-manager"]').innerHTML()
}

test.describe('V-EXEC-HISTORY-SECRET-COPY-LIVE: a copy of a secret container reads masked live and is never marked secret', () => {
  test.afterEach(async ({ request }) => {
    for (const id of executionIds.splice(0)) {
      await request.delete(`${BACKEND_URL}/executions/${id}`).catch(() => undefined)
    }
    await cleanUp(request, testIds)
    testIds = []
  })

  test('a live run shows each copy of a secret table, map and list masked, and its watcher with no type mismatch', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    const testId = await createSecretCopyTest(request, testIds)
    await openTest(page, testId)
    await selectEnvironment(page)
    await expandVariableManager(page)
    await runToTerminal(page)

    await test.step('each secret source reads as the mask and cannot be inspected', async () => {
      for (const { source } of COPIES) {
        await expect(rowValue(page, source), `${source} is a secret`).toHaveText(SECRET_MASK)
        await expect(expandButton(page, source), `${source} is a saved secret`).toHaveAttribute(
          'aria-disabled',
          'true',
        )
      }
    })

    await test.step('the plain copy shows the table the run wrote', async () => {
      await expect(rowValue(page, PLAIN_COPY), 'the run copied one row of two columns').toHaveText('1×2 table')
    })

    await test.step("each copy's row reads as the mask, with no size or count", async () => {
      for (const { source, copy } of COPIES) {
        await expect(rowValue(page, copy), `${copy} holds the run's copy of ${source}`).toHaveText(SECRET_MASK)
      }
    })

    await test.step("each copy's watcher shows the mask with no type mismatch notice", async () => {
      for (const { source, copy } of COPIES) {
        const row = variableRow(page, copy)
        await row.hover()
        await expect(expandButton(page, copy), `${copy} is not a secret, so it can be inspected`).not.toHaveAttribute(
          'aria-disabled',
          'true',
        )
        await expandButton(page, copy).click()
        const sheet = watcher(page, copy)
        await expect(sheet).toBeVisible()
        await expect(sheet.locator('[data-testid="mode-dropdown"]')).toHaveText('Current')
        await expect(sheet, `the watcher of ${copy} shows the run's copy of ${source} masked`).toContainText(
          SECRET_MASK,
        )
        await expect
          .soft(sheet.getByTestId('mismatch-body'), `the watcher of ${copy} shows no type mismatch notice`)
          .toHaveCount(0)
        await expect
          .soft(sheet, `the watcher of ${copy} names no received and declared type`)
          .not.toContainText(/received \w+ - declared/)
        await expect.soft(sheet, `the watcher of ${copy} shows no type mismatch metric`).not.toContainText('type mismatch')
        expectNoSecret(await sheet.innerHTML(), `the watcher of ${copy}`, SECRET_TEXTS)
        await sheet.getByRole('button', { name: `Close inspector for ${copy}`, exact: true }).click()
        await expect(sheet).toHaveCount(0)
      }
    })

    await test.step('the Variable Manager shows no column name, key or cell of the secrets', async () => {
      expectNoSecret(await panelText(page), 'the live Variable Manager', SECRET_TEXTS)
    })
  })

  test('on the run page of a deleted Test the copies read masked and only the secrets carry the SECRET badge', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    const testId = await createSecretCopyTest(request, testIds)
    const run = await runTrackedTest(request, testId)
    executionIds.push(run.executionId)
    expect(run.verdict, `tracked run ${run.executionId} passed`).toBe('passed')

    const deleted = await request.delete(`${BACKEND_URL}/tests/${testId}`)
    expect(deleted.ok(), `DELETE /tests/${testId} failed: ${deleted.status()}`).toBeTruthy()
    testIds = testIds.filter((id) => id !== testId)

    await openRunHistory(page, run.executionId)
    await expandVariableManager(page)

    await test.step('each secret source reads as the mask and carries the SECRET badge', async () => {
      for (const { source } of COPIES) {
        await expect(rowValue(page, source), `${source} is listed from the run snapshot`).toHaveText(SECRET_MASK)
        await expect(secretBadge(page, source), `${source} is a secret`).toHaveText('SECRET')
      }
    })

    await test.step('the plain copy shows the table the run wrote and no SECRET badge', async () => {
      await expect(rowValue(page, PLAIN_COPY), 'the run copied one row of two columns').toHaveText('1×2 table')
      await expect(secretBadge(page, PLAIN_COPY)).toHaveCount(0)
    })

    await test.step('each copy reads as the mask and carries no SECRET badge', async () => {
      for (const { source, copy } of COPIES) {
        await expect(rowValue(page, copy), `${copy} holds the run's copy of ${source}`).toHaveText(SECRET_MASK)
        await expect
          .soft(secretBadge(page, copy), `${copy} copies ${source} but is not a secret, so it has no SECRET badge`)
          .toHaveCount(0)
      }
    })

    await test.step('the Variable Manager shows no column name, key or cell of the secrets', async () => {
      expectNoSecret(await panelText(page), 'the run page Variable Manager', SECRET_TEXTS)
    })
  })
})
