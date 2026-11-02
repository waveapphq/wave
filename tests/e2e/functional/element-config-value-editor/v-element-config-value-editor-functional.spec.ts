/**
 * V-ELEMENT-CONFIG-VALUE-EDITOR-FUNCTIONAL: element-config parameter value editing
 * migrates onto the shared "Edit value" sheet.
 *
 * The HTTP node's Headers (map) / Query Params (map) / Body (multiline string)
 * now open the shared ValueEditorSheet instead of the deleted array / map / text
 * editor modals. Param maps stay string -> string (stringValuesOnly), a
 * multiline body keeps its Format control + the templateFields opt-in, and the
 * edited values persist (GET /tests/{id}/workflow) and reach the request at
 * execution (the http-echo stack service reflects method, query, body, headers).
 *
 * REQ-3.1.3.11, REQ-3.6.2.x, REQ-5.2.4.8. Covers the element-config behaviors
 * (string-only param map at runtime, templateFields renders at execution,
 * multiline format round-trip).
 *
 * Phase: functional-workflow (each test imports its own fixture; T1 runs to /echo).
 * Run: ./scripts/e2e-targeted-local.sh functional/element-config-value-editor/v-element-config-value-editor-functional.spec.ts
 */

import { test, expect, type Page, type Locator, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'
import { injectHttpHost } from '../../helpers/fixture-import'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { expandButton, fieldInput } from '../../helpers/value-field'

const HTTP_ID = 'ec-http-1'
const LOG_ID = 'ec-log-1'

interface FixtureOpts {
  body: string
  templateFields: string[]
}

/** Build an HTTP-POST-to-/echo + Log fixture. The Body is seeded by the caller
 *  (a template for T1, a JSON literal for T2); Headers / Query Params start EMPTY
 *  so the test fills them through the shared sheet. The Log reads the bound
 *  response body back so the run output proves what reached the request. */
function buildFixture({ body, templateFields }: FixtureOpts): Record<string, unknown> {
  const httpValues: Record<string, unknown> = {
    timeout: 30,
    retry_count: 0,
    retry_delay: 1,
    retry_backoff_factor: 2,
    retryable_status_codes: ['502', '503', '504'],
    verify_ssl: false,
    allow_redirects: true,
    max_redirects: 10,
    url: "f'https://127.0.0.1:9449/echo'",
    method: 'POST',
    body,
    headers: {},
    query_params: {},
  }
  return {
    name: `V-ELEMENT-CONFIG-VALUE-EDITOR ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'HTTP node whose Headers / Query / Body edit through the shared value sheet',
    workflow: {
      nodes: [
        {
          id: HTTP_ID,
          type: 'workflowNode',
          position: { x: 300, y: 150 },
          measured: { width: 120, height: 62 },
          data: {
            label: 'HTTP',
            description: 'Echo POST',
            elementType: 'http-client',
            nodeType: 'plugin',
            category: 'network',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: ['url'],
            templateFields,
            config: {
              values: httpValues,
              outputBindings: { body: 'echo_response' },
              profileBindings: [],
            },
          },
        },
        {
          id: LOG_ID,
          type: 'workflowNode',
          position: { x: 540, y: 150 },
          measured: { width: 120, height: 62 },
          data: {
            label: 'Log',
            description: 'Log Echo',
            elementType: 'log',
            nodeType: 'plugin',
            category: 'system',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: ['message'],
            templateFields: [],
            config: {
              values: { message: 'echo_response', level: 'INFO' },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
      ],
      edges: [
        { id: 'edge-start-http', source: 'start-node', target: HTTP_ID },
        { id: 'edge-http-log', source: HTTP_ID, target: LOG_ID },
      ],
    },
    variables: {
      who: { value: 'Ada', type: 'string', scope: 'test' },
      echo_response: { value: '', type: 'string', scope: 'test' },
    },
    metadata: {},
  }
}

async function importAndValidate(
  request: APIRequestContext,
  fixture: Record<string, unknown>,
): Promise<string> {
  // injectHttp: rewrite the 127.0.0.1:9449 http-echo URL to the shard gateway in container mode
  const createResp = await request.post(`${BACKEND_URL}/tests`, { data: injectHttpHost(fixture) })
  const createBody = (await createResp.json().catch(() => null)) as Record<string, unknown> | null
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`,
  ).toBeTruthy()
  const testId = ((createBody!.data as Record<string, unknown>)?.id ?? createBody!.id) as string

  const validateResp = await request.post(`${BACKEND_URL}/tests/${testId}/validate`)
  const validateBody = await validateResp.json().catch(() => null)
  const errors =
    validateBody?.data?.errors ?? validateBody?.error?.details?.[0]?.errors ?? validateBody?.errors ?? []
  expect(errors.length, `Fixture failed validation: ${JSON.stringify(errors)}`).toBe(0)
  return testId
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function openHttpConfig(page: Page) {
  await page.locator(`[data-testid="workflow-node-${HTTP_ID}"]`).locator('button').first().dblclick()
  const dialog = configSheet(page)
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

const sheet = (page: Page) => page.locator('[data-testid="value-editor-sheet"]')

/** The Body param rows live inside the collapsed "Body" group card - expand it first. */
async function expandBodyGroup(dialog: Locator) {
  await dialog.locator('[data-testid="group-header-Body"]').click()
  await expect(expandButton(dialog, 'body')).toBeVisible()
}

/** A one-line map field reads as one JSON line holding the entry (FIELD-10). */
const oneEntryLine = (key: string, value: string): RegExp =>
  new RegExp(`^\\{\\s*"${key}": "${value}"\\s*\\}$`)

async function selectEnvironment(page: Page, envName: string) {
  const envSelector = page.locator('[data-testid="environment-selector"]')
  await envSelector.click()
  const envPopover = page.locator('[data-testid="environment-popover"]')
  await expect(envPopover).toBeVisible()
  await envPopover.locator(`button:has-text("${envName}")`).first().click()
  await expect(envPopover).not.toBeVisible()
}

/** Replace the whole text of the open sheet's editor without saving it. */
async function retypeSheetText(page: Page, text: string) {
  const editor = sheet(page).locator('.cm-content').first()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.type(text)
}

/** Apply the config sheet, persist the workbench and read the stored HTTP values back. */
async function persistAndReadHttpValues(
  page: Page,
  request: APIRequestContext,
  dialog: Locator,
  testId: string,
): Promise<Record<string, unknown>> {
  await dialog.getByRole('button', { name: /^Save$/ }).last().click()
  await expect(dialog).toBeHidden({ timeout: 10_000 })
  const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
  await expect(saveBtn).toBeEnabled()
  await saveBtn.click()
  await expect(saveBtn).toBeDisabled({ timeout: 10_000 })
  const wf = (await (await request.get(`${BACKEND_URL}/tests/${testId}/workflow`)).json()).data
  const httpNode = (wf.nodes as Array<Record<string, unknown>>).find((n) => n.id === HTTP_ID)!
  return ((httpNode.data as Record<string, unknown>).config as Record<string, Record<string, unknown>>)
    .values
}

/** Add one entry to the currently-open map sheet and Save it. */
async function fillMapEntry(page: Page, key: string, value: string) {
  const s = sheet(page)
  await expect(s).toBeVisible()
  await expect(s.locator('[data-testid="value-editor-type-badge"]')).toContainText('map')
  await s.locator('[data-testid="map-add-entry"]').click()
  await s.locator('[data-testid="map-edit-key-0"]').fill(key)
  await s.locator('[data-testid="map-edit-value-0"]').fill(value)
  // A string-only param map shows its fixed type as a read-only pill, never a picker.
  const pill = s.locator('[data-testid="map-type-0"]')
  await expect(pill, 'param map is string-only').toHaveText('string')
  await expect(pill).not.toHaveAttribute('role', 'combobox')
  await s.locator('[data-testid="value-editor-save-button"]').click()
  await s.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(s).toBeHidden()
}

test.describe('V-ELEMENT-CONFIG-VALUE-EDITOR: element-config params edit via the shared sheet', () => {
  test.beforeEach(async ({ request }) => {
    await ensureEnvironment(request)
  })

  // -------------------------------------------------------------------------
  // T1: Headers + Query Params edit through the string-only map sheet, a
  // templated body renders, and all three reach the /echo request at execution.
  // Covers a numeric value staying a string end-to-end and the templateFields
  // opt-in rendering at execution.
  // -------------------------------------------------------------------------
  test('T1: string-only header/query maps + a templated body persist and reach the request', async ({
    page,
    request,
  }) => {
    const testId = await importAndValidate(request, buildFixture({ body: 'Hi {{ who }}', templateFields: ['body'] }))
    await openTest(page, testId)

    const dialog = await openHttpConfig(page)

    // Headers map -> shared sheet (NOT the deleted map-editor-modal). Numeric-looking
    // value 8080 stays a string because the param map is string-only.
    await expandButton(dialog, 'headers').click()
    // The deleted map-editor-modal used map-row-* testids; the shared sheet uses map-edit-*.
    await expect(page.locator('[data-testid^="map-row-"]'), 'old map editor modal is gone').toHaveCount(0)
    await fillMapEntry(page, 'x-echo-port', '8080')
    await expect(fieldInput(dialog, 'headers')).toHaveValue(oneEntryLine('x-echo-port', '8080'))

    // Query Params map -> shared sheet. Another numeric-looking value.
    await expandButton(dialog, 'query_params').click()
    await fillMapEntry(page, 'q1', '8081')
    await expect(fieldInput(dialog, 'query_params')).toHaveValue(oneEntryLine('q1', '8081'))

    // The seeded template body reflects back into the sheet as Kind=Template
    // (templateFields -> the sheet's Kind dropdown).
    await expandBodyGroup(dialog)
    await expandButton(dialog, 'body').click()
    await expect(sheet(page).locator('[data-testid="value-editor-type-badge"]')).toContainText('string')
    await expect(sheet(page).locator('[data-testid="kind-dropdown"]')).toContainText('Template')
    await sheet(page).locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(sheet(page)).toBeHidden()

    // Apply the config, then persist the workbench.
    await dialog.getByRole('button', { name: /^Save$/ }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await expect(saveBtn).toBeDisabled({ timeout: 10_000 })

    // Persisted shape: the numeric-looking map values are JSON STRINGS, not numbers,
    // the body kept its template source, and templateFields opted body in.
    const wfResp = await request.get(`${BACKEND_URL}/tests/${testId}/workflow`)
    expect(wfResp.ok(), `GET workflow: ${wfResp.status()}`).toBeTruthy()
    const wf = (await wfResp.json()).data
    const httpNode = (wf.nodes as Array<Record<string, unknown>>).find((n) => n.id === HTTP_ID)!
    const data = httpNode.data as Record<string, unknown>
    const values = (data.config as Record<string, Record<string, unknown>>).values
    expect(values.headers, 'header value persisted as the string "8080"').toEqual({ 'x-echo-port': '8080' })
    expect(typeof (values.headers as Record<string, unknown>)['x-echo-port']).toBe('string')
    expect(values.query_params, 'query value persisted as the string "8081"').toEqual({ q1: '8081' })
    expect(typeof (values.query_params as Record<string, unknown>).q1).toBe('string')
    expect(values.body).toBe('Hi {{ who }}')
    expect(data.templateFields, 'body opted into templateFields').toContain('body')

    // Run: the values reach the /echo request, the body template renders, and the
    // numeric-looking header survives as a string (a number header would have failed).
    await selectEnvironment(page, E2E_ENV_NAME)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 30_000 })
    expect(await status.getAttribute('data-status')).toBe('passed')

    const echo = (await getLogTexts(page)).join('\n')
    expect(echo, 'header reached the request as a string').toMatch(/x-echo-port["']?\s*:\s*["']8080["']/)
    expect(echo, 'query param reached the request').toMatch(/"q1"\s*:\s*"8081"/)
    expect(echo, 'body template rendered at execution').toContain('Hi Ada')

    await expect(page.locator(`[data-testid="workflow-node-${HTTP_ID}"]`)).toHaveAttribute(
      'data-execution-status',
      'success',
    )
  })

  // -------------------------------------------------------------------------
  // T2: a multiline JSON body round-trips through the sheet's Format control, and
  // the deleted array / map / text editor modals are unreachable. No execution.
  // -------------------------------------------------------------------------
  test('T2: multiline body Format round-trip; deleted editor modals are unreachable', async ({
    page,
    request,
  }) => {
    const JSON_BODY = '{"name":"wave","port":8080}'
    const testId = await importAndValidate(request, buildFixture({ body: JSON_BODY, templateFields: [] }))
    await openTest(page, testId)

    const dialog = await openHttpConfig(page)

    // Headers expand opens the shared sheet, never the deleted map-editor-modal
    // (whose distinctive map-row-* testids must be absent).
    await expandButton(dialog, 'headers').click()
    await expect(sheet(page)).toBeVisible()
    await expect(page.locator('[data-testid^="map-row-"]'), 'old map editor modal is gone').toHaveCount(0)
    await sheet(page).locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(sheet(page)).toBeHidden()

    // Body opens the shared string sheet (never a separate text modal); its Format
    // control auto-detects the seeded JSON and the Format button reflows it.
    await expandBodyGroup(dialog)
    await expandButton(dialog, 'body').click()
    const s = sheet(page)
    await expect(s).toBeVisible()
    await expect(s.locator('[data-testid="value-editor-type-badge"]')).toContainText('string')
    // Literal multiline string: Kind + Format dropdowns present; Format auto-detects JSON.
    await expect(s.locator('[data-testid="kind-dropdown"]')).toContainText('Literal')
    await expect(s.locator('[data-testid="format-dropdown"]')).toContainText('Auto (JSON)')
    await s.locator('[data-testid="value-editor-string-format-button"]').click()
    await expect(async () => {
      expect(await s.locator('.cm-content .cm-line').count(), 'pretty-print reflowed onto multiple lines').toBeGreaterThan(1)
    }).toPass()
    await s.locator('[data-testid="value-editor-save-button"]').click()
    await s.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(s).toBeHidden()

    await dialog.getByRole('button', { name: /^Save$/ }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await expect(saveBtn).toBeDisabled({ timeout: 10_000 })

    // Round-trip: the persisted body is still valid JSON (the same object), now
    // pretty-printed, and reopening the sheet re-detects the JSON format.
    const wf = (await (await request.get(`${BACKEND_URL}/tests/${testId}/workflow`)).json()).data
    const httpNode = (wf.nodes as Array<Record<string, unknown>>).find((n) => n.id === HTTP_ID)!
    const storedBody = ((httpNode.data as Record<string, unknown>).config as Record<string, Record<string, unknown>>)
      .values.body as string
    expect(JSON.parse(storedBody), 'body JSON round-tripped intact').toEqual({ name: 'wave', port: 8080 })
    expect(storedBody, 'body was pretty-printed (multi-line)').toContain('\n')

    const reopened = await openHttpConfig(page)
    await expandBodyGroup(reopened)
    await expandButton(reopened, 'body').click()
    await expect(sheet(page)).toBeVisible()
    await expect(sheet(page).locator('[data-testid="format-dropdown"]')).toContainText('Auto (JSON)')
    await sheet(page).locator('[data-testid="value-editor-cancel-button"]').click()
  })
})

/**
 * V-ELEMENT-CONFIG-VALUE-EDITOR-SAVE-CLOSE: the shared "Edit value" sheet's own
 * Close / Save contract, for every parameter of every block (PYRUN-20, SAVE-1).
 *
 * Design Decisions: PYRUN-20, SAVE-1
 * REQ: REQ-3.4.1.2
 *
 * Pass Criteria:
 * 1. The footer's dismiss button reads Close, and no button in the sheet reads Cancel.
 * 2. Save applies the value, keeps the sheet open and then goes dead until the draft
 *    differs again; the applied value reaches the row and the stored Test.
 * 3. Close closes the sheet and asks nothing when nothing is unsaved.
 * 4. Close with unsaved text asks Keep Editing / Close / Save: Keep Editing returns to
 *    the editor with the text intact, Close discards it, Save applies it and closes.
 * 5. Save is dead while nothing has changed, on a plain string parameter too.
 */
test.describe('V-ELEMENT-CONFIG-VALUE-EDITOR: the Edit value sheet Close / Save contract', () => {
  test.beforeEach(async ({ request }) => {
    await ensureEnvironment(request)
  })

  // -------------------------------------------------------------------------
  // T3: criteria 1, 2, 3 and 5 on the HTTP Body, a plain string parameter.
  // -------------------------------------------------------------------------
  test('T3: footer reads Close; Save applies, keeps the sheet open and goes dead', async ({
    page,
    request,
  }) => {
    const testId = await importAndValidate(
      request,
      buildFixture({ body: 'seed-body', templateFields: [] }),
    )
    await openTest(page, testId)
    const dialog = await openHttpConfig(page)
    await expandBodyGroup(dialog)
    const preview = fieldInput(dialog, 'body')
    await expandButton(dialog, 'body').click()

    const s = sheet(page)
    await expect(s).toBeVisible()
    const close = s.locator('[data-testid="value-editor-cancel-button"]')
    const save = s.locator('[data-testid="value-editor-save-button"]')

    // Per PYRUN-20: the dismiss button is Close, never Cancel.
    await expect(close).toHaveText('Close')
    await expect(s.getByRole('button', { name: /^Cancel$/ })).toHaveCount(0)

    // Per SAVE-1: nothing changed yet, so Save is dead on this plain string too.
    await expect(save, 'Save is dead until the draft differs from what was saved').toBeDisabled()

    await retypeSheetText(page, 'applied-once')
    await expect(save).toBeEnabled()
    await save.click()

    // Per PYRUN-20: Save applies the value and keeps the sheet open.
    await expect(s, 'Save keeps the sheet open').toBeVisible()
    await expect(save, 'Save goes dead again once the draft is applied').toBeDisabled()
    await expect(preview, 'the applied value reached the parameter row').toHaveValue('applied-once')

    // ... and lives again as soon as the draft differs.
    await retypeSheetText(page, 'applied-twice')
    await expect(save).toBeEnabled()
    await save.click()
    await expect(save).toBeDisabled()
    await expect(preview).toHaveValue('applied-twice')

    // Per PYRUN-20: Close closes, and asks nothing while nothing is unsaved.
    await close.click()
    await expect(s).toBeHidden()
    await expect(page.locator('[data-testid="value-editor-unsaved-dialog"]')).toHaveCount(0)

    const values = await persistAndReadHttpValues(page, request, dialog, testId)
    expect(values.body, 'the value the sheet applied is what the Test stores').toBe('applied-twice')
  })

  // -------------------------------------------------------------------------
  // T4: criterion 4 - all three answers of the sheet's own unsaved question.
  // -------------------------------------------------------------------------
  test('T4: Close with unsaved text asks Keep Editing / Close / Save', async ({ page, request }) => {
    const testId = await importAndValidate(
      request,
      buildFixture({ body: 'seed-body', templateFields: [] }),
    )
    await openTest(page, testId)
    const dialog = await openHttpConfig(page)
    await expandBodyGroup(dialog)
    const preview = fieldInput(dialog, 'body')
    await expandButton(dialog, 'body').click()

    const s = sheet(page)
    const close = s.locator('[data-testid="value-editor-cancel-button"]')
    const question = page.locator('[data-testid="value-editor-unsaved-dialog"]')
    const keepEditing = question.locator('[data-testid="value-editor-unsaved-keep-button"]')
    const questionClose = question.locator('[data-testid="value-editor-unsaved-discard-button"]')
    const questionSave = question.locator('[data-testid="value-editor-unsaved-save-button"]')

    await expect(s).toBeVisible()
    await retypeSheetText(page, 'kept-text')
    await close.click()

    await expect(question).toBeVisible()
    await expect(question).toContainText('Unsaved changes')
    await expect(question).toContainText('You have unsaved changes. What would you like to do?')
    await expect(keepEditing).toHaveText('Keep Editing')
    await expect(questionClose, 'the middle answer reads Close, not Discard').toHaveText('Close')
    await expect(questionSave).toHaveText('Save')

    // Keep Editing returns to the editor with the text intact.
    await keepEditing.click()
    await expect(question).toBeHidden()
    await expect(s).toBeVisible()
    await expect(s.locator('.cm-content')).toContainText('kept-text')

    // Close discards the text: the row keeps the value it already had.
    await close.click()
    await expect(question).toBeVisible()
    await questionClose.click()
    await expect(s).toBeHidden()
    await expect(preview).toHaveValue('seed-body')

    // Save applies the value and then closes.
    await expandButton(dialog, 'body').click()
    await expect(s).toBeVisible()
    await retypeSheetText(page, 'saved-on-close')
    await close.click()
    await expect(question).toBeVisible()
    await questionSave.click()
    await expect(s).toBeHidden()
    await expect(preview).toHaveValue('saved-on-close')

    const values = await persistAndReadHttpValues(page, request, dialog, testId)
    expect(values.body, 'the question Save applied the value before it closed').toBe('saved-on-close')
  })
})
