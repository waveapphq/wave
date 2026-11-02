/**
 * V-ENTRY-LOOK-TYPE-PILL: a fixed-type list or map editor shows a `Type` header and a read-only type pill, {x}
 * one grid gap after the pill, and the `Type` label level with the other header labels
 * Design Decisions: FIELD-10, FIELD-13, VMGR-100, VMGR-112
 * REQ: REQ-3.1.1.5, REQ-3.1.3.19
 *
 * Phase: functional-workflow. Each test imports `fixture-look-type-pill.json` under a `zz-11541-s6a-` name, proves
 * it validates with zero errors and deletes it afterwards. Every check runs in both themes.
 *
 * Pass Criteria:
 * 1. HTTP Headers, Query Params and Form Fields (maps), Retryable Codes (a text list), Shell Script and Python
 *    Arguments, SQL Out arguments, OpenSearch Fields and the Allowed values of an Integer enum input each show a
 *    `Type` header label and, on every row, a read-only pill reading the fixed type (`string`, or `integer` for
 *    the enum): a plain text element with no chevron, not a button, not a combobox and not focusable.
 * 2. Where the editor has {x} (every one above but the Allowed values), {x} sits right after the pill, one row grid
 *    gap from it.
 * 3. The `Type` header label's top is level with `Key` (maps) or `#` (lists) and `Value`.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { deleteTest, readFixture } from '../../helpers/element-types'
import { digIn, openBlockSheet } from '../../helpers/workbench'
import {
  cancelCreate,
  closeValueEditor,
  fillCreateWindow,
  openFunctionCreateModal,
  openValueEditor,
  setAllowedValues,
  setValueEditorView,
} from '../../helpers/variable-create'
import {
  closeBlockSheet,
  expandGroup,
  headerLabel,
  inBothThemes,
  listItem,
  mapEntry,
  openBlockEditor,
  rectOf,
  type EntryParts,
} from '../../helpers/entry-editors'

const FIXTURE = 'fixture-look-type-pill.json'
const NODE = {
  http: '2a71a879-a5cd-44db-8d6d-31057fc619aa',
  shell: 'b84a8000-5fca-48c1-84e6-21e06ad1e631',
  python: '261c5884-26eb-403b-80c4-13f9d239d144',
  sql: 'd14b93a5-5ea3-4e12-89c9-98c7092e5f92',
  opensearch: '3824b2a7-ba38-46e4-9d80-02ae641857b7',
  fn: '6fa81c3a-8f7a-4b57-8e0f-1c579f2849eb',
} as const

type EditorKind = 'map' | 'list'

interface FixedEditor {
  what: string
  kind: EditorKind
  type: string
  rows: number
  hasToggle: boolean
}

const bodyOf = (editor: Locator, kind: EditorKind): Locator =>
  editor.locator(`[data-testid="${kind === 'map' ? 'map-edit-body' : 'array-edit-body'}"]`)

const entryOf = (editor: Locator, kind: EditorKind, index: number): EntryParts =>
  kind === 'map' ? mapEntry(editor, index) : listItem(editor, index)

/** FIELD-10: the read-only pill is plain text in the pill look - no chevron, no picker, no focus stop. */
async function expectReadOnlyPill(pill: Locator, type: string, what: string): Promise<void> {
  await expect(pill, `${what} pill reads the fixed type`).toHaveText(type)
  const facts = await pill.evaluate((el) => ({
    tag: el.tagName,
    role: el.getAttribute('role'),
    popup: el.getAttribute('aria-haspopup'),
    chevrons: el.querySelectorAll('svg').length,
    focusable: (el as HTMLElement).tabIndex >= 0,
    inButton: el.closest('button, [role="combobox"]') !== null,
  }))
  expect(facts, `${what} pill is read-only text`).toEqual({
    tag: 'SPAN',
    role: null,
    popup: null,
    chevrons: 0,
    focusable: false,
    inButton: false,
  })
}

async function expectFixedTypeEditor(editor: Locator, spec: FixedEditor): Promise<void> {
  const body = bodyOf(editor, spec.kind)
  await expect(body, `${spec.what}: the Visual editor shows`).toBeVisible()

  const first = spec.kind === 'map' ? 'Key' : '#'
  const labels = [first, 'Value', 'Type']
  const tops: number[] = []
  for (const label of labels) tops.push((await rectOf(headerLabel(body, label), `${spec.what} header ${label}`)).y)
  expect(Math.abs(tops[2] - tops[0]), `${spec.what}: Type is level with ${first} (${tops.join(', ')})`).toBeLessThanOrEqual(0.5)
  expect(Math.abs(tops[2] - tops[1]), `${spec.what}: Type is level with Value (${tops.join(', ')})`).toBeLessThanOrEqual(0.5)

  for (let index = 0; index < spec.rows; index += 1) {
    const entry = entryOf(editor, spec.kind, index)
    await expectReadOnlyPill(entry.typeCell, spec.type, `${spec.what} row ${index}`)
    if (!spec.hasToggle) {
      await expect(entry.exprToggle, `${spec.what}: no {x} on a stored-only value`).toHaveCount(0)
      continue
    }
    const pill = await rectOf(entry.typeCell, `${spec.what} row ${index} pill`)
    const toggle = await rectOf(entry.exprToggle, `${spec.what} row ${index} {x}`)
    const gridGap = await entry.exprToggle.evaluate((el) => Number.parseFloat(getComputedStyle(el.parentElement!).columnGap))
    const gap = toggle.x - (pill.x + pill.width)
    expect(gridGap, `${spec.what}: the row grid has a gap`).toBeGreaterThan(0)
    expect(Math.abs(gap - gridGap), `${spec.what} row ${index}: {x} is one grid gap (${gridGap}) after the pill, reads ${gap}`).toBeLessThanOrEqual(0.5)
  }
}

/** Open a Block row's editor, check it, close it. */
async function checkBlockEditor(page: Page, sheet: Locator, name: string, spec: FixedEditor): Promise<void> {
  const editor = await openBlockEditor(page, sheet, name)
  await expectFixedTypeEditor(editor, spec)
  await closeValueEditor(page, editor)
}

test.describe('V-ENTRY-LOOK-TYPE-PILL: fixed-type editors show a read-only Type pill', () => {
  test('Block maps and lists with a fixed item type show the Type header, the read-only pill and {x} one gap after it', async ({
    page,
  }) => {
    let testId = ''
    try {
      testId = await importValidateAndNavigate(page, readFixture(__dirname, FIXTURE))
      await inBothThemes(page, async () => {
        const http = await openBlockSheet(page, NODE.http)
        const map = { kind: 'map', type: 'string', rows: 1, hasToggle: true } as const
        await checkBlockEditor(page, http, 'headers', { ...map, what: 'HTTP Headers' })
        await checkBlockEditor(page, http, 'query_params', { ...map, what: 'HTTP Query Params' })
        await expandGroup(http, 'Body')
        await checkBlockEditor(page, http, 'form_fields', { ...map, what: 'HTTP Form Fields' })
        await expandGroup(http, 'Timeouts & Retries')
        await checkBlockEditor(page, http, 'retryable_status_codes', {
          what: 'HTTP Retryable Codes',
          kind: 'list',
          type: 'string',
          rows: 1,
          hasToggle: true,
        })
        await closeBlockSheet(http)

        const list = { kind: 'list', type: 'string', hasToggle: true } as const
        for (const [node, what] of [
          [NODE.shell, 'Shell Script Arguments'],
          [NODE.python, 'Python Arguments'],
        ] as const) {
          const sheet = await openBlockSheet(page, node)
          await expandGroup(sheet, 'Script')
          await checkBlockEditor(page, sheet, 'arguments', { ...list, what, rows: 1 })
          await closeBlockSheet(sheet)
        }

        const sql = await openBlockSheet(page, NODE.sql)
        await checkBlockEditor(page, sql, 'out_arguments', { ...list, what: 'SQL Out arguments', rows: 1 })
        await closeBlockSheet(sql)

        const opensearch = await openBlockSheet(page, NODE.opensearch)
        await checkBlockEditor(page, opensearch, 'fields', { ...list, what: 'OpenSearch Fields', rows: 2 })
        await closeBlockSheet(opensearch)
      })
    } finally {
      if (testId) await deleteTest(page.request, testId)
    }
  })

  test('the Allowed values of an Integer enum input show the Type header and the read-only integer pill', async ({
    page,
  }) => {
    let testId = ''
    try {
      testId = await importValidateAndNavigate(page, readFixture(__dirname, FIXTURE))
      await digIn(page, NODE.fn)
      await expect(page.getByTestId('add-variable-dropdown-trigger')).toBeVisible()
      await inBothThemes(page, async () => {
        const modal = await openFunctionCreateModal(page, 'input')
        await fillCreateWindow(page, modal, 'zz_11541_s6a_level', { type: 'integer', createEnum: true })
        await setAllowedValues(modal, '[1, 2]')
        const editor = await openValueEditor(page, modal, 'allowed-values')
        await setValueEditorView(page, editor, 'Visual')
        await expectFixedTypeEditor(editor, {
          what: 'Allowed values (Integer enum)',
          kind: 'list',
          type: 'integer',
          rows: 2,
          hasToggle: false,
        })
        await closeValueEditor(page, editor)
        await cancelCreate(page, modal)
      })
    } finally {
      if (testId) await deleteTest(page.request, testId)
    }
  })
})
