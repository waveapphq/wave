/**
 * V-VMGR-LIVE-TABLE: live complex values in the Variable Manager panel.
 *
 * Design Decisions: per-row layout; runtime vs definition view
 * REQ: REQ-3.1.3.12, REQ-3.2.2.18
 *
 * The live push carries ONE measurement of a complex value and the receiving
 * row picks what it needs from it by DECLARED type: a list of records is a
 * valid array and a valid table, and only the declaration tells them apart.
 *
 * Pass Criteria:
 * 1. Before the run both rows render their definition: "0×0 table" / "[0 items]".
 * 2. WHILE the run is still running, the declared-table row reads its real
 *    dimensions and the declared-array row reads its real count.
 * 3. Both survive to the passing terminal state, and the type badges still read
 *    table and array.
 * 4. The console and the session variables report the same truth.
 * 5. The array seeds of both fixtures here put a RECORD first - a scalar in
 *    front makes the array half untestable.
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import {
  importValidateAndNavigate,
  getActiveSessionId,
  getSessionVariables,
} from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'
import { getLogTexts } from '../../helpers/log-reader'
import fs from 'fs'
import path from 'path'

const TIMES = '×'
const LIVE_TABLE = `3${TIMES}2 table`
const IDLE_TABLE = `0${TIMES}0 table`
const LIVE_ARRAY = '[3 items]'
const IDLE_ARRAY = '[0 items]'
const RECORD_FIRST = /^\[\s*\{/

interface SeededTest {
  workflow?: { nodes?: Array<Record<string, unknown>> }
  variables?: Record<string, { type?: string }>
}

function loadFixture(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as Record<
    string,
    unknown
  >
}

/** The literal a Var Setter node seeds into one variable. */
function setterSeed(fixture: Record<string, unknown>, nodeId: string, varName: string): string {
  const node = ((fixture as SeededTest).workflow?.nodes ?? []).find((n) => n.id === nodeId) as
    | { data?: { config?: { values?: { variables?: Record<string, unknown> } } } }
    | undefined
  return String(node?.data?.config?.values?.variables?.[varName])
}

function declaredType(fixture: Record<string, unknown>, varName: string): string {
  return String((fixture as SeededTest).variables?.[varName]?.type)
}

function rowValue(page: Page, name: string): Locator {
  return variableRow(page, name).locator('[data-testid^="variable-value-"]')
}

function rowTypeBadge(page: Page, name: string): Locator {
  return variableRow(page, name).locator('[data-testid^="type-badge-"]')
}

test('the array seed of every fixture in this directory puts a record first', () => {
  const live = loadFixture('fixture-live-table.json')
  expect(
    setterSeed(live, 'set-order-rows', 'order_rows'),
    'order_rows must seed records, not scalars: a scalar first element makes the declared-array half of this row pass whatever the push sends',
  ).toMatch(RECORD_FIRST)
  expect(declaredType(live, 'order_rows')).toBe('array')
  expect(declaredType(live, 'orders')).toBe('table')

  const panel = loadFixture('fixture.json')
  expect(
    setterSeed(panel, 'varset-state', 'items_arr'),
    'items_arr must seed records, not scalars: V-VMGR-03 asserting [2 items] only guards the live push while this array holds records',
  ).toMatch(RECORD_FIRST)
  expect(declaredType(panel, 'items_arr')).toBe('array')
})

test('a declared table updates live with its dimensions and a declared array with its count', async ({
  page,
}) => {
  await importValidateAndNavigate(page, loadFixture('fixture-live-table.json'))
  await expandVariableManager(page)

  const tableValue = rowValue(page, 'orders')
  const arrayValue = rowValue(page, 'order_rows')
  const status = page.locator('[data-testid="workflow-status"]')

  await test.step('STEP 1: before the run both rows render their definition', async () => {
    await expect(tableValue).toHaveText(IDLE_TABLE)
    await expect(arrayValue).toHaveText(IDLE_ARRAY)
  })

  await test.step('STEP 2: mid-run both rows carry the live measurement', async () => {
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    await expect(status).toHaveAttribute('data-status', 'running', { timeout: 15_000 })

    await expect
      .poll(
        async () => {
          const [state, table, array] = await Promise.all([
            status.getAttribute('data-status'),
            tableValue.textContent(),
            arrayValue.textContent(),
          ])
          return `${state}|${table?.trim()}|${array?.trim()}`
        },
        {
          timeout: 15_000,
          intervals: [100, 100, 200],
          message:
            'while the run is still running the table row must read its dimensions and the array row its count',
        },
      )
      .toBe(`running|${LIVE_TABLE}|${LIVE_ARRAY}`)
  })

  await test.step('STEP 3: the values survive the terminal state, keyed on the declared type', async () => {
    await expect(status).toHaveAttribute('data-status', 'passed', { timeout: 60_000 })
    await expect(tableValue).toHaveText(LIVE_TABLE)
    await expect(arrayValue).toHaveText(LIVE_ARRAY)
    await expect(rowTypeBadge(page, 'orders')).toHaveText('table')
    await expect(rowTypeBadge(page, 'order_rows')).toHaveText('array')
  })

  await test.step('STEP 4: the console reports the same truth', async () => {
    const logs = await getLogTexts(page)
    expect(logs, `console lines:\n${logs.join('\n')}`).toContain(
      'truth-table-3x2-array-3-first-A-1',
    )
  })

  await test.step('STEP 5: the session variables report the same truth', async () => {
    const sessionId = await getActiveSessionId(page)
    const variables = await getSessionVariables(page, sessionId)

    expect(variables.orders?.type).toBe('table')
    const stored = variables.orders?.value as { columns: unknown[]; rows: unknown[] }
    expect(stored.rows).toHaveLength(3)
    expect(stored.columns).toHaveLength(2)

    expect(variables.order_rows?.type).toBe('array')
    const records = variables.order_rows?.value as Array<{ sku: string }>
    expect(records).toHaveLength(3)
    expect(records[0].sku).toBe('A-1')
  })
})
