/**
 * V-VMGR-CREATE-FUNCTIONAL: the Variable Manager create modal end-to-end.
 * The "+ Add" entry point opens the floating create modal
 * (NOT the legacy scalar-variable-edit-dialog); a variable of every type and
 * kind is created and its row appears with the right type / kind badge, a
 * destructive type switch confirms first, and the legacy dialog is gone.
 *
 * REQ-3.1.3.11 (Variable Manager UI panel), REQ-3.1.3.13 (computed/expression),
 * REQ-3.1.3.15 (template variables).
 *
 * Phase: functional-workflow (seeds an empty Test via POST /tests, no run).
 *
 * Pass Criteria:
 * 1. Each type (string/integer/float/boolean/array/map/table) creates a row with
 *    the matching type badge.
 * 2. A string Expression creates a row with the {x} badge; a string Template with
 *    the {{ }} badge.
 * 3. A type switch away from a non-empty complex value confirms before discarding.
 * 4. The `scalar-variable-edit-dialog` testid is absent.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'
import { createValidTest, openTest } from '../../helpers/fn-seed'
import {
  answerChangeConfirm,
  expectWindowValue,
  insertCreateCode,
  openCreateModal,
  setCreateName,
  setCreateType,
  setCreateKind,
  setWindowValue,
  typeStringValue,
  setNumericValue,
  submitCreate,
  createModal,
  variableRow,
} from '../../helpers/variable-create'

async function seedAndOpen(page: Page, request: Page['request']): Promise<void> {
  const testId = await createValidTest(request, {
    name: `V-VMGR-CREATE-FN ${Date.now()}`,
    nodes: [],
  })
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
  await openTest(page, testId)
}

function typeBadge(page: Page, name: string) {
  return variableRow(page, name).locator('[data-testid^="type-badge-"]')
}

test.describe('V-VMGR-CREATE-FUNCTIONAL: create modal', () => {
  test('creates a variable of every type with the matching type badge', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    await seedAndOpen(page, request)

    await test.step('string (literal)', async () => {
      await openCreateModal(page)
      await setCreateName(page, 's1')
      await typeStringValue(page, 'hello')
      await submitCreate(page)
      await expect(typeBadge(page, 's1')).toHaveText('string')
    })

    await test.step('integer', async () => {
      await openCreateModal(page)
      await setCreateName(page, 'i1')
      await setCreateType(page, 'integer')
      await setNumericValue(page, '42')
      await submitCreate(page)
      await expect(typeBadge(page, 'i1')).toHaveText('integer')
    })

    await test.step('float', async () => {
      await openCreateModal(page)
      await setCreateName(page, 'f1')
      await setCreateType(page, 'float')
      await setNumericValue(page, '3.14')
      await submitCreate(page)
      await expect(typeBadge(page, 'f1')).toHaveText('float')
    })

    await test.step('boolean', async () => {
      await openCreateModal(page)
      await setCreateName(page, 'b1')
      await setCreateType(page, 'boolean')
      await createModal(page).locator('[data-testid="scalar-edit-bool-true"]').click()
      await submitCreate(page)
      await expect(typeBadge(page, 'b1')).toHaveText('boolean')
    })

    await test.step('array', async () => {
      const modal = await openCreateModal(page)
      await setCreateName(page, 'a1')
      await setCreateType(page, 'array')
      await setWindowValue(page, modal, '["x"]')
      await submitCreate(page)
      await expect(typeBadge(page, 'a1')).toHaveText('array')
    })

    await test.step('map', async () => {
      const modal = await openCreateModal(page)
      await setCreateName(page, 'm1')
      await setCreateType(page, 'map')
      await setWindowValue(page, modal, '{"k": "v"}')
      await submitCreate(page)
      await expect(typeBadge(page, 'm1')).toHaveText('map')
    })

    await test.step('table (authored in Code)', async () => {
      const modal = await openCreateModal(page)
      await setCreateName(page, 't1')
      await setCreateType(page, 'table')
      // Author in the Edit value window's Code view so the typed JSON defines the columns.
      await insertCreateCode(page, '[{"id":1}]', modal)
      await submitCreate(page)
      await expect(typeBadge(page, 't1')).toHaveText('table')
    })
  })

  test('creates string Expression and Template kinds with their kind badges', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    await seedAndOpen(page, request)

    await test.step('expression kind -> {x} badge', async () => {
      await openCreateModal(page)
      await setCreateName(page, 'expr1')
      await setCreateKind(page, 'Expression')
      await typeStringValue(page, '1 + 1')
      // Blur the expression editor so the cycle check runs before submit.
      await createModal(page).locator('[data-testid="create-variable-name"]').click()
      await submitCreate(page)
      await expect(
        variableRow(page, 'expr1').locator('[data-testid^="expr-badge-"]'),
      ).toHaveText('{x}')
    })

    await test.step('template kind -> {{ }} badge', async () => {
      await openCreateModal(page)
      await setCreateName(page, 'tmpl1')
      await setCreateKind(page, 'Template')
      await typeStringValue(page, 'Hi there')
      await submitCreate(page)
      await expect(
        variableRow(page, 'tmpl1').locator('[data-testid^="template-badge-"]'),
      ).toHaveText('{{ }}')
    })
  })

  test('a type switch away from a non-empty complex value confirms first', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    await seedAndOpen(page, request)

    const modal = await openCreateModal(page)
    await setCreateName(page, 'sw1')
    await setCreateType(page, 'array')
    await setWindowValue(page, modal, '["keep-me"]')

    // Switching the (non-empty) array to map stages a destructive confirm.
    await setCreateType(page, 'map')
    await expect(page.getByText('Change variable type?')).toBeVisible()

    // Cancel keeps the array authoring intact (no data lost).
    await answerChangeConfirm(page, 'Cancel')
    await expect(page.getByText('Change variable type?')).toHaveCount(0)
    await expectWindowValue(modal, '["keep-me"]')
  })

  test('regression guard: the legacy scalar-variable-edit-dialog is gone', async ({
    page,
    request,
  }) => {
    await seedAndOpen(page, request)
    await openCreateModal(page)
    // The create modal is the floating sheet, never the retired centered dialog.
    await expect(page.locator('[data-testid="scalar-variable-edit-dialog"]')).toHaveCount(0)
    await expect(createModal(page)).toBeVisible()
  })
})
