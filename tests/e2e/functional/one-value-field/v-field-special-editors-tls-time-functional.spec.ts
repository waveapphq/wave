/**
 * V-FIELD-SPECIAL-EDITORS-FUNCTIONAL (Parts, Cipher Suites, time picker): list fields with their own editors and the time field
 * Design Decisions: FIELD-9, FIELD-10, HTTP-13, HTTP-16
 * REQ: REQ-3.1.1.5, REQ-3.4.2.2, REQ-3.3.2.3
 *
 * Fixture `fixture-tls-time.json` (POST /tests, zero validation errors): Start, an HTTP Request `Unset ciphers`
 * (TLS 1.2 only, Cipher Suites not set) to the `tls-lab` client-preference listener, a Log, an HTTP Request
 * `Parts` (POST multipart to `http-echo`), a Log and a bookend Log; unlinked: `Set ciphers` (one suite), `IANA
 * ciphers` (an IANA name and an OpenSSL name), a K8s Connect with Cipher Suites not set and an OpenSearch Block with
 * From and To not set. The default lists come from GET /system/tls-capabilities. The Test is deleted afterwards.
 *
 * Pass Criteria:
 * 1. HTTP Request and K8s Connect: not set, Cipher Suites shows in gray the backend list for the TLS versions and
 *    follows Min / Max TLS Version; a typed name the versions cannot offer reads
 *    `Cipher suite "<name>" is not available in TLS <min> to <max>` under the row and holds the window Save.
 * 2. POST /tests refuses a stored out-of-range cipher on both Blocks with `TLS_CIPHER_OUT_OF_RANGE` and that text.
 * 3. A set list cleared with select all + Backspace and typed again key by key is kept after Save and reopen,
 *    and stored.
 * 4. The picker opens a list holding `TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA` with that suite checked, and a picker
 *    Save with no change keeps every suite under the name it was given (the window holds no change).
 * 5. Not set, the picker opens in its default state: every suite of the TLS range checked, `All N enabled` and
 *    `Default`, no Reset button, never `Library defaults`; a picker Save with no change keeps the field not set and
 *    a window Save stores no `cipher_suites`.
 * 6. Parts: the expand opens the Parts editor; a text part and an {x} part saved there are stored with the {x}
 *    index; the run sends both parts as multipart form-data to `http-echo` (the {x} part as its variable's value).
 * 7. The run on `tls-lab` negotiates the first suite of the gray list the listener accepts: the unset field sends
 *    exactly the gray default.
 * 8. Time picker (OpenSearch From): Cancel, Esc and a click outside discard the picked time (the field stays not
 *    set); Save keeps it and the window Save stores it.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { leaveExpressionEditor } from '../../helpers/code-editor'
import { readFixture, runToken } from '../../helpers/element-types'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { expectNodesSuccess, finishRun, startRun } from '../../helpers/k8s-run'
import { deleteSeededTest, openGroup } from '../../helpers/list-fields'
import { openBlockSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'
import {
  cipherCatalog,
  cipherLine,
  defaultCiphers,
  expectGrayList,
  expectOwnList,
  lineBox,
  openCipherPicker,
  openTimeFromExpand,
  pickChoice,
  pickerRows,
  resolvedCssColor,
  retypeLine,
  savePicker,
  setRelativeAmount,
  setTrueFalse,
  storedValues,
  timePicker,
} from '../../helpers/choice-tls'

const FIXTURE = 'fixture-tls-time.json'
const ID = {
  unset: '05e19af4-4dd9-40c1-813a-cf69686fe840',
  logUnset: 'e024efc1-b78d-4070-800c-115973afe4af',
  parts: 'e9f8390a-b528-43be-8ebe-cdd5e3414ee7',
  logParts: 'eca797f3-f9c7-4a7a-8af5-ceecdc50cc16',
  done: '118ed3fc-e213-45f7-8525-7f68a711bf70',
  set: 'd7a6cccf-b26c-4782-991c-f2cca8a39077',
  iana: '88410d81-19d0-494a-b15a-9eed5d556068',
  k8s: 'f0419de7-24bc-45de-8636-717c07c5d79a',
  os: 'c1abf04a-3153-4968-a78d-d3f1ff680a23',
} as const

const TLS_GROUP = 'TLS / Certificates'
const OUT_OF_RANGE_SUITE = 'TLS_AES_128_GCM_SHA256'
const outOfRange = (name: string, min: string, max: string) =>
  `Cipher suite "${name}" is not available in TLS ${min} to ${max}`
const TYPED_LIST = ['ECDHE-RSA-AES256-GCM-SHA384', 'TLS_AES_256_GCM_SHA384']
const IANA_LIST = ['TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA', 'ECDHE-RSA-AES256-GCM-SHA384']
// The tls-lab listener on 9457 offers these two and lets the client's order win.
const REORDER_SUITES = ['ECDHE-RSA-AES128-GCM-SHA256', 'ECDHE-RSA-AES256-GCM-SHA384']
const TRACE_VALUE = 'trace-abc'

type Block = 'http-client' | 'k8s-connect'
type Catalog = Awaited<ReturnType<typeof cipherCatalog>>

const defaults = defaultCiphers

/** Close a window whose Save is off because it holds no change. */
async function closeUnchanged(sheet: Locator): Promise<void> {
  await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await expect(sheet).toHaveCount(0)
}

/** Close a window and drop its edits. */
async function discardWindow(page: Page, sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  const question = page.locator('[data-testid="unsaved-changes-dialog"]')
  await expect(question).toBeVisible()
  await question.locator('[data-testid="unsaved-close"]').click()
  await expect(sheet).toHaveCount(0)
}

async function grayFollowsVersions(page: Page, caps: Catalog, id: string, block: Block, start: [string, string]): Promise<void> {
  const sheet = await openBlockSheet(page, id)
  await openGroup(sheet, TLS_GROUP)
  await expectGrayList(page, sheet, 'cipher_suites', defaults(caps, block, ...start), `${block} as stored`)
  await pickChoice(page, sheet, 'tls_max_version', 'TLS 1.2')
  await pickChoice(page, sheet, 'tls_min_version', 'TLS 1.0')
  await expectGrayList(page, sheet, 'cipher_suites', defaults(caps, block, '1.0', '1.2'), `${block} on TLS 1.0 to 1.2`)
  await pickChoice(page, sheet, 'tls_min_version', 'TLS 1.2')
  await expectGrayList(page, sheet, 'cipher_suites', defaults(caps, block, '1.2', '1.2'), `${block} on TLS 1.2 only`)

  await retypeLine(page, sheet, 'cipher_suites', `["${OUT_OF_RANGE_SUITE}"]`)
  const error = sheet.locator('[data-testid="param-error-cipher_suites"]')
  await expect(error).toHaveText(new RegExp(`^${escape(outOfRange(OUT_OF_RANGE_SUITE, '1.2', '1.2'))}$`))
  await expect(sheet.getByRole('button', { name: 'Save', exact: true }), 'the window Save is held').toBeDisabled()
  await pickChoice(page, sheet, 'tls_max_version', 'TLS 1.3')
  await expect(error, 'TLS 1.3 offers the typed suite').toHaveCount(0)
  await discardWindow(page, sheet)
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function refusedAtSave(request: APIRequestContext, fixture: Record<string, any>): Promise<Array<Record<string, any>>> {
  const pick = (id: string) => structuredClone(fixture.workflow.nodes.find((node: { id: string }) => node.id === id))
  const http = pick(ID.set)
  Object.assign(http.data.config.values, { tls_min_version: '1.2', tls_max_version: '1.2', cipher_suites: [OUT_OF_RANGE_SUITE] })
  const k8s = pick(ID.k8s)
  Object.assign(k8s.data.config.values, { tls_min_version: '1.2', tls_max_version: '1.2', cipher_suites: [OUT_OF_RANGE_SUITE] })
  const name = `zz-11541-s10-tls-refused-${runToken()}`
  const response = await request.post(`${BACKEND_URL}/tests`, {
    data: { ...fixture, name, workflow: { nodes: [http, k8s], edges: [] }, variables: {} },
  })
  expect(response.status(), 'the save check refuses the Test').toBe(422)
  const listed = await request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(name)}`)
  expect((await listed.json()).data ?? [], 'no Test is stored').toHaveLength(0)
  return ((await response.json()).error?.details ?? []) as Array<Record<string, any>>
}

test.describe('V-FIELD-SPECIAL-EDITORS-FUNCTIONAL: Parts, Cipher Suites and the time picker', () => {
  let testId = ''

  test.afterEach(async ({ page }) => {
    await deleteSeededTest(page, testId)
    testId = ''
  })

  test('Cipher Suites: gray default, picker, typed list and range check; Parts; the run sends the gray default', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    await ensureEnvironment(request)
    const fixture = readFixture(__dirname, FIXTURE)
    testId = await importValidateAndNavigate(page, fixture, { injectHttp: true })
    const caps = await cipherCatalog(request)

    await test.step('HTTP Request and K8s Connect: the gray list follows the TLS versions; an out-of-range name is named', async () => {
      await grayFollowsVersions(page, caps, ID.unset, 'http-client', ['1.2', '1.2'])
      await grayFollowsVersions(page, caps, ID.k8s, 'k8s-connect', ['1.2', '1.3'])
    })

    await test.step('the save check refuses an out-of-range cipher on both Blocks', async () => {
      const findings = await refusedAtSave(request, fixture)
      const text = outOfRange(OUT_OF_RANGE_SUITE, '1.2', '1.2')
      const found = findings
        .filter((entry) => entry.code === 'TLS_CIPHER_OUT_OF_RANGE')
        .map((entry) => [entry.node_id, entry.message])
      expect(found, JSON.stringify(findings)).toEqual(expect.arrayContaining([[ID.set, text], [ID.k8s, text]]))
    })

    await test.step('a set list cleared with select all + Backspace and typed again is kept', async () => {
      let sheet = await openBlockSheet(page, ID.set)
      await openGroup(sheet, TLS_GROUP)
      await expectOwnList(page, sheet, 'cipher_suites', ['ECDHE-RSA-AES128-GCM-SHA256'], 'the stored list')
      const box = lineBox(sheet, 'cipher_suites')
      await box.click()
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.press('Backspace')
      await expectGrayList(page, sheet, 'cipher_suites', defaults(caps, 'http-client', '1.2', '1.3'), 'cleared')
      await page.keyboard.type('[')
      const muted = await resolvedCssColor(page, 'var(--color-text-muted)')
      await expect(box).toHaveValue('[')
      expect(await box.evaluate((el) => getComputedStyle(el).color), 'unfinished text is not gray').not.toBe(muted)
      await page.keyboard.type(TYPED_LIST.map((name) => `"${name}"`).join(', ') + ']')
      await expectOwnList(page, sheet, 'cipher_suites', TYPED_LIST, 'the typed list')
      await saveBlockSheet(sheet)

      sheet = await openBlockSheet(page, ID.set)
      await openGroup(sheet, TLS_GROUP)
      await expectOwnList(page, sheet, 'cipher_suites', TYPED_LIST, 'reopened')
      await closeUnchanged(sheet)
    })

    await test.step('the picker checks a suite held by its IANA name and a Save with no change keeps every suite', async () => {
      const sheet = await openBlockSheet(page, ID.iana)
      await openGroup(sheet, TLS_GROUP)
      await expectOwnList(page, sheet, 'cipher_suites', IANA_LIST, 'the stored list')
      const picker = await openCipherPicker(page, sheet)
      const rows = await pickerRows(picker)
      expect(rows.checked).toEqual(['ECDHE-RSA-AES128-SHA', 'ECDHE-RSA-AES256-GCM-SHA384'])
      await expect(picker.locator('[data-testid="cipher-picker-metric"]')).toHaveText(/^2 selected$/)
      await savePicker(picker)
      expect(await cipherLine(sheet), 'both suites under the names they were given').toEqual(IANA_LIST)
      await closeUnchanged(sheet)
    })

    await test.step('not set, the picker opens in its default state and a Save with no change keeps it not set', async () => {
      const list = defaults(caps, 'http-client', '1.2', '1.2')
      const sheet = await openBlockSheet(page, ID.unset)
      await openGroup(sheet, TLS_GROUP)
      const picker = await openCipherPicker(page, sheet)
      const rows = await pickerRows(picker)
      expect(rows.unchecked, 'every suite of the range is checked').toEqual([])
      expect(rows.checked.toSorted(), 'the picker lists the gray default').toEqual(list.toSorted())
      await expect(picker.locator('[data-testid="cipher-picker-metric"]')).toHaveText(new RegExp(`^All ${list.length} enabled$`))
      await expect(picker.locator('[data-testid="cipher-picker-defaults-note"]')).toHaveText(/^Default$/)
      await expect(picker.locator('[data-testid="cipher-picker-reset-button"]')).toHaveCount(0)
      await expect(picker.getByText('Library defaults')).toHaveCount(0)
      await savePicker(picker)
      await expectGrayList(page, sheet, 'cipher_suites', list, 'after the picker Save')
      await openGroup(sheet, 'Connection')
      await setTrueFalse(sheet, 'allow_redirects', false)
      await saveBlockSheet(sheet)
    })

    await test.step('Parts: the editor builds a text part and an {x} part', async () => {
      const sheet = await openBlockSheet(page, ID.parts)
      await openGroup(sheet, 'Body')
      await sheet.getByRole('button', { name: 'Open editor for Parts', exact: true }).click()
      const editor = page.locator('[data-testid="parts-editor-sheet"]')
      await expect(editor).toBeVisible()
      await editor.locator('[data-testid="parts-add-part"]').click()
      await editor.locator('[data-testid="part-name-0"]').fill('meta')
      await editor.locator('[data-testid="part-value-0"]').fill('hello-parts')
      await editor.locator('[data-testid="parts-add-part"]').click()
      await editor.locator('[data-testid="part-name-1"]').fill('trace')
      await editor.locator('[data-testid="part-expr-toggle-1"]').click()
      const code = editor.locator('[data-testid="part-expr-value-1"] .cm-content')
      await code.click()
      await page.keyboard.insertText('trace_token')
      await expect(code).toHaveText('trace_token')
      await leaveExpressionEditor(code)
      await expect(editor.locator('[data-testid="parts-editor-metric"]')).toHaveText(/^2 parts$/)
      await editor.locator('[data-testid="parts-editor-save-button"]').click()
      await expect(editor).toHaveCount(0)
      await saveBlockSheet(sheet)
    })

    await saveTest(page)

    await test.step('storage holds the typed list, no cipher_suites for the unset Block and both parts', async () => {
      expect((await storedValues(request, testId, ID.set)).cipher_suites).toEqual(TYPED_LIST)
      expect((await storedValues(request, testId, ID.iana)).cipher_suites).toEqual(IANA_LIST)
      const unset = await storedValues(request, testId, ID.unset)
      expect(unset, 'the unset Block stores no cipher_suites').not.toHaveProperty('cipher_suites')
      expect(unset.allow_redirects).toBe(false)
      expect((await storedValues(request, testId, ID.parts)).parts).toEqual([
        { kind: 'text', name: 'meta', value: 'hello-parts' },
        { kind: 'text', name: 'trace', value: 'trace_token' },
      ])
      const node = (await (await request.get(`${BACKEND_URL}/tests/${testId}`)).json()).data.workflow.nodes.find(
        (entry: { id: string }) => entry.id === ID.parts,
      )
      expect(node.data.expressionFields).toContain('parts.1.value')
    })

    await test.step('the run sends the gray default to tls-lab and both parts to http-echo', async () => {
      const status = await startRun(page)
      const logs = await finishRun(page, status, 'tls-time-done')
      const line = (marker: string) => logs.find((entry) => entry.startsWith(marker)) ?? ''
      const gray = defaults(caps, 'http-client', '1.2', '1.2')
      const firstAccepted = gray.find((name) => REORDER_SUITES.includes(name))
      expect(firstAccepted, 'the gray list holds a suite the listener accepts').toBeTruthy()
      expect(line('unset status='), logs.join('\n')).toContain('unset status=200')
      expect(line('unset status='), logs.join('\n')).toContain(`"ssl_cipher":"${firstAccepted}"`)
      const parts = line('parts status=')
      expect(parts, logs.join('\n')).toContain('parts status=200')
      expect(parts).toContain('multipart/form-data; boundary=')
      expect(parts).toMatch(/name=\\?"meta\\?"(\\r\\n|\r\n)+hello-parts/)
      expect(parts).toMatch(new RegExp(`name=\\\\?"trace\\\\?"(\\\\r\\\\n|\\r\\n)+${TRACE_VALUE}`))
      await expectNodesSuccess(page, [ID.unset, ID.logUnset, ID.parts, ID.logParts, ID.done])
    })
  })

  test('time picker: Cancel, Esc and a click outside discard; Save keeps', async ({ page, request }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    testId = await importValidateAndNavigate(page, readFixture(__dirname, FIXTURE), { injectHttp: true })
    const sheet = await openBlockSheet(page, ID.os)
    const from = lineBox(sheet, 'from')
    const muted = await resolvedCssColor(page, 'var(--color-text-muted)')
    const expectNotSet = async (what: string) => {
      await expect(from, what).toHaveValue('now-15m')
      expect(await from.evaluate((el) => getComputedStyle(el).color), `${what}: gray`).toBe(muted)
      await expect(sheet.locator('[data-testid="param-reset-from"]'), `${what}: no reset icon`).toHaveCount(0)
    }
    await expectNotSet('as stored')

    await test.step('Cancel discards', async () => {
      const picker = await openTimeFromExpand(page, sheet, 'from', 'From')
      await expect(await setRelativeAmount(picker, 'From', 30)).toHaveText('now-30m')
      await picker.locator('[data-testid="time-picker-cancel"]').click()
      await expect(timePicker(page, 'From')).toHaveCount(0)
      await expectNotSet('after Cancel')
    })

    await test.step('Esc discards and leaves the window open', async () => {
      const picker = await openTimeFromExpand(page, sheet, 'from', 'From')
      await expect(await setRelativeAmount(picker, 'From', 45)).toHaveText('now-45m')
      await page.keyboard.press('Escape')
      await expect(timePicker(page, 'From')).toHaveCount(0)
      await expect(sheet).toBeVisible()
      await expectNotSet('after Esc')
    })

    await test.step('a click outside discards', async () => {
      const picker = await openTimeFromExpand(page, sheet, 'from', 'From')
      await expect(await setRelativeAmount(picker, 'From', 50)).toHaveText('now-50m')
      await sheet.locator('[data-testid="param-row-index"] td').first().click()
      await expect(timePicker(page, 'From')).toHaveCount(0)
      await expect(sheet).toBeVisible()
      await expectNotSet('after a click outside')
    })

    await test.step('Save keeps the picked time and the window Save stores it', async () => {
      const picker = await openTimeFromExpand(page, sheet, 'from', 'From')
      await expect(await setRelativeAmount(picker, 'From', 2)).toHaveText('now-2m')
      await picker.locator('[data-testid="time-picker-save"]').click()
      await expect(timePicker(page, 'From')).toHaveCount(0)
      await expect(from).toHaveValue('now-2m')
      expect(await from.evaluate((el) => getComputedStyle(el).color), 'a held time is not gray').not.toBe(muted)
      await expect(sheet.locator('[data-testid="param-reset-from"]')).toHaveCount(1)
      await saveBlockSheet(sheet)
      await saveTest(page)
      const values = await storedValues(request, testId, ID.os)
      expect(values.from).toBe('now-2m')
      expect(values, 'To stays not set').not.toHaveProperty('to')
    })
  })
})
