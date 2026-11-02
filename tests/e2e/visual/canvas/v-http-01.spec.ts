/**
 * V-HTTP-01: HTTP Headers Editor - Everyday State + Guard Rails
 *
 * Phase: no-data (parallel) - seeds its own Tests via POST /tests and
 * /admin/bulk/tests; no DB reset required.
 * Design Decisions: HTTP-4, FIELD-1, FIELD-7, FIELD-10
 * REQ: REQ-3.4.1.4, REQ-3.1.1.5
 *
 * Pass Criteria:
 * 1. The Headers field's expand opens the map editor; the editor note renders the exact one-line
 *    copy; a value row is a plain string input in literal mode and the shared expression editor
 *    when toggled; every entry has its expand; {x} on an entry holding a value asks the field's
 *    switch warning and Cancel keeps the entry and its text
 * 2. "+ Content-Type" scaffold renders in ALL body modes; "+ Auth" is ABSENT
 * 3. Enable Auth renders the read-only generated row; deleting it flips the
 *    checkbox AND the saved config; a manual same-name row is a duplicate
 * 4. Guard rails: reworded Content-Length sentence (canonical casing),
 *    Transfer-Encoding legal, duplicate pair + strip + "(+N more)" + Save
 *    disabled, 3 amber credential advisories with a calm secret expression
 * 5. Code view: literal = quoted string, expression = bare {{ expr }} with NO
 *    lint error; anything else blocks Save and locks Visual with the
 *    exact Key "<key>" sentence; the source-level duplicate scan still fires
 * 6. Load parity (admin-seeded): duplicate + reworded blocked messages in the
 *    Test Issues dialog and the node badge (incl. a non-string map value); on a
 *    Remote Execution body config only the file-body REMOTE_UNSUPPORTED finding
 *    fires - an artifact:// source is no save finding and paints no badge
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { rawPersistTest } from '../../helpers/fn-seed'
import { configSheet } from '../../helpers/workbench'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { leaveExpressionEditor } from '../../helpers/code-editor'

const EDITOR_NOTE =
  'Standard headers (Host, User-Agent, Accept, ...) are sent automatically - add a row to override.'
const MSG_DUPLICATE = 'Duplicate header "authorization" (header names are case-insensitive)'
const MSG_BLOCKED =
  'Header "Content-Length" cannot be set manually - the HTTP stack blocks length overrides'
const MSG_CODE_REJECT =
  'Key "Authorization": value must be a quoted string or a {{ expression }}'
const MSG_REMOTE_FILE_BODY = 'Body mode "File" is not supported inside Remote Execution'

function httpNode(
  id: string,
  y: number,
  values: Record<string, unknown>,
  expressionFields: string[] = [],
) {
  return {
    id,
    type: 'workflowNode',
    position: { x: 320, y },
    data: {
      label: 'HTTP',
      elementType: 'http-client',
      nodeType: 'plugin',
      category: 'network',
      version: '1.0.0',
      description: id,
      hasNewerVersion: false,
      expressionFields,
      templateFields: [],
      config: { values, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 120, height: 62 },
  }
}

function buildFixture() {
  return {
    name: 'V-HTTP-01 Headers Editor',
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: [
        httpNode(
          'http-everyday',
          160,
          {
            url: 'https://api.example.com/v1/orders',
            method: 'GET',
            headers: { 'X-Trace-Id': 'wave-1', Authorization: 'api_token' },
            timeout: 30,
          },
          ['headers.Authorization'],
        ),
        httpNode('http-form', 280, {
          url: 'https://api.example.com/v1/login',
          method: 'POST',
          body_mode: 'form',
          form_fields: { username: 'alice' },
          timeout: 30,
        }),
        httpNode('http-auth-on', 400, {
          url: 'https://api.example.com/v1/private',
          method: 'GET',
          auth_enabled: true,
          auth_mode: 'basic',
          auth_username: 'alice',
          auth_password: 'wave-pass-1',
          timeout: 30,
        }),
      ],
      edges: [
        { id: 'e-start', source: 'start-node', target: 'http-everyday' },
        { id: 'e-1', source: 'http-everyday', target: 'http-form' },
        { id: 'e-2', source: 'http-form', target: 'http-auth-on' },
      ],
    },
    variables: {
      api_token: { value: 'tok-demo', type: 'string', scope: 'test', secret: true },
      suffix: { value: 'abc', type: 'string', scope: 'test' },
    },
    metadata: { tags: [], suite_id: null, parent_suite: null },
  }
}

async function openConfig(page: Page, nodeId: string): Promise<Locator> {
  await page.locator(`[data-testid="workflow-node-${nodeId}"]`).dblclick()
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible()
  return sheet
}

async function openHeadersEditor(page: Page, sheet: Locator): Promise<Locator> {
  await sheet.getByRole('button', { name: 'Open editor for Headers', exact: true }).click()
  const editor = page.locator('[data-testid="value-editor-sheet"]')
  await expect(editor).toBeVisible()
  return editor
}

/** Fill a fresh map row (adds it first) with key/value. */
async function addRow(editor: Locator, index: number, key: string, value: string) {
  await editor.locator('[data-testid="map-add-entry"]').click()
  await editor.locator(`[data-testid="map-edit-key-${index}"]`).fill(key)
  await editor.locator(`[data-testid="map-edit-value-${index}"]`).fill(value)
}

/** Add a map row whose value is an expression: {x} on the still empty value switches at once (FIELD-7). */
async function addExpressionRow(page: Page, editor: Locator, index: number, key: string, expression: string) {
  await editor.locator('[data-testid="map-add-entry"]').click()
  await editor.locator(`[data-testid="map-edit-key-${index}"]`).fill(key)
  await editor.locator(`[data-testid="map-expr-toggle-${index}"]`).click()
  const code = editor.locator(`[data-testid="map-expr-value-${index}"] .cm-content`)
  await code.click()
  await page.keyboard.insertText(expression)
  await expect(code).toHaveText(expression)
  await leaveExpressionEditor(code)
}

/** Close a Block sheet from its Cancel; a sheet holding a change asks first and Close drops it. */
async function closeSheet(page: Page, sheet: Locator) {
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  const close = page.getByTestId('unsaved-close')
  if (await close.isVisible({ timeout: 1_000 }).catch(() => false)) await close.click()
  await expect(sheet).not.toBeVisible()
}

/** Replace the Code view's CodeMirror document with `text`. */
async function replaceCode(page: Page, editor: Locator, text: string) {
  const code = editor.locator('.cm-content').first()
  await code.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(text)
}

test.describe('V-HTTP-01: HTTP headers editor', () => {
  test('V-HTTP-01-S1: everyday state - note, literal/expression rows, scaffolds', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, buildFixture())
    const sheet = await openConfig(page, 'http-everyday')
    const editor = await openHeadersEditor(page, sheet)

    // 1. Exact editor note (HTTP-4)
    await expect(editor).toContainText(EDITOR_NOTE)

    // A literal row is a plain string input, toggle unpressed
    await expect(editor.locator('[data-testid="map-edit-value-0"]')).toHaveValue('wave-1')
    await expect(editor.locator('[data-testid="map-expr-toggle-0"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    // Expression row: toggle pressed, shared expression editor, raw text shown
    await expect(editor.locator('[data-testid="map-expr-toggle-1"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(editor.locator('[data-testid="map-expr-value-1"]')).toContainText('api_token')

    // Every entry, literal or {x}, has its expand (FIELD-1)
    await expect(editor.locator('[data-testid="map-expand-0"]')).toBeVisible()
    await expect(editor.locator('[data-testid="map-expand-1"]')).toBeVisible()

    // {x} on an entry holding a value asks first; Cancel keeps the entry and its text (FIELD-7)
    const question = page.locator('[data-testid="switch-mode-dialog"]')
    await editor.locator('[data-testid="map-expr-toggle-1"]').click()
    await expect(question).toContainText('Switch the field to a plain value?')
    await question.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(question).toHaveCount(0)
    await expect(editor.locator('[data-testid="map-expr-toggle-1"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(editor.locator('[data-testid="map-expr-value-1"]')).toContainText('api_token')
    await editor.locator('[data-testid="map-expr-toggle-0"]').click()
    await expect(question).toContainText('Switch the field to an expression?')
    await question.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(question).toHaveCount(0)
    await expect(editor.locator('[data-testid="map-edit-value-0"]')).toHaveValue('wave-1')

    // 2. There is no "+ Auth" scaffold; only "+ Content-Type" remains
    await expect(editor.getByRole('button', { name: '+ Auth' })).toHaveCount(0)
    await expect(editor.getByRole('button', { name: 'Add entry' })).toBeVisible()
    await expect(editor.getByRole('button', { name: '+ Content-Type' })).toBeVisible()

    // + Content-Type menu: 6 media types + Custom… with its sublabel
    await editor.getByRole('button', { name: '+ Content-Type' }).click()
    const ctMenu = page.getByRole('menu')
    for (const mediaType of [
      'application/json',
      'application/xml',
      'text/plain',
      'text/html',
      'application/yaml',
      'application/octet-stream',
    ]) {
      await expect(ctMenu.getByRole('menuitem', { name: mediaType })).toBeVisible()
    }
    const customItem = ctMenu.getByRole('menuitem', { name: /Custom…/ })
    await expect(customItem).toBeVisible()
    await expect(customItem).toContainText('empty row, key prefilled')
    await page.keyboard.press('Escape')
    await editor.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(editor).not.toBeVisible()
    await closeSheet(page, sheet)

    // The scaffold renders in every body mode
    const formSheet = await openConfig(page, 'http-form')
    const formEditor = await openHeadersEditor(page, formSheet)
    await expect(formEditor.getByRole('button', { name: '+ Content-Type' })).toBeVisible()
    await expect(formEditor.getByRole('button', { name: '+ Auth' })).toHaveCount(0)
  })

  test('V-HTTP-01-S2: Auth generated row - two-way sync + duplicate-against-generated', async ({
    page,
  }) => {
    const testId = await importValidateAndNavigate(page, buildFixture())

    // Enable direction: flipping Enable Auth on renders the generated row
    const sheet = await openConfig(page, 'http-everyday')
    await sheet.locator('[data-testid="group-header-Auth"]').click()
    const enableAuth = sheet.locator(
      '[data-testid="param-row-auth_enabled"] button[role="checkbox"]',
    )
    await enableAuth.click()
    await expect(sheet.locator('[data-testid="param-row-auth_mode"]')).toBeVisible()

    const editor = await openHeadersEditor(page, sheet)
    await expect(editor.locator('[data-testid="map-generated-key-0"]')).toHaveValue('Authorization')
    await expect(editor.locator('[data-testid="map-generated-value-0"]')).toHaveValue('********')

    // The manual Authorization row now duplicates the GENERATED row
    const strip = editor.locator('[data-testid="value-editor-validation"]')
    await expect(strip).toContainText(/Duplicate header "authorization"/i)
    await expect(strip).toContainText('(header names are case-insensitive)')
    await editor.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(editor).not.toBeVisible()
    // The http-everyday sheet is dirty (Auth enabled): Cancel asks, and Close drops the change.
    await closeSheet(page, sheet)

    // Delete direction on the seeded auth-on node: removing the generated row
    // sets Enable Auth off, and the SAVED config carries auth_enabled=false
    const authSheet = await openConfig(page, 'http-auth-on')
    const authEditor = await openHeadersEditor(page, authSheet)
    await expect(authEditor.locator('[data-testid="map-generated-key-0"]')).toHaveValue(
      'Authorization',
    )
    await authEditor.locator('[data-testid="map-generated-remove-0"]').click()
    await expect(authEditor.locator('[data-testid="map-generated-key-0"]')).toHaveCount(0)
    // The removal writes auth_enabled on the sheet behind, not the editor's own
    // map, so the editor has nothing of its own to save.
    await expect(authEditor.locator('[data-testid="value-editor-save-button"]')).toBeDisabled()
    await authEditor.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(authEditor).not.toBeVisible()

    await authSheet.locator('[data-testid="group-header-Auth"]').click()
    await expect(
      authSheet.locator('[data-testid="param-row-auth_enabled"] button[role="checkbox"]'),
    ).toHaveAttribute('data-state', 'unchecked')

    await authSheet.getByRole('button', { name: 'Save' }).last().click()
    await expect(authSheet).not.toBeVisible()
    const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()

    const readAuthEnabled = async () => {
      const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
      const body = await resp.json().catch(() => null)
      const entity = body?.data ?? body
      const node = entity?.workflow?.nodes?.find((n: { id: string }) => n.id === 'http-auth-on')
      return node?.data?.config?.values?.auth_enabled
    }
    await expect.poll(readAuthEnabled, { timeout: 10_000 }).toBe(false)
  })

  test('V-HTTP-01-S3: guard rails - reworded blocked key, legal TE, duplicates, advisories', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, buildFixture())
    const sheet = await openConfig(page, 'http-form')
    const editor = await openHeadersEditor(page, sheet)

    // A Transfer-Encoding row is legal - no error, Save enabled
    await addRow(editor, 0, 'Transfer-Encoding', 'chunked')
    await expect(editor.locator('[data-testid="value-editor-validation"]')).toHaveCount(0)
    await expect(editor.locator('[data-testid="value-editor-save-button"]')).toBeEnabled()

    // Credential rows: calm secret expression + 3 unprotected carriers
    await addExpressionRow(page, editor, 1, 'Authorization', 'api_token')
    await addRow(editor, 2, 'authorization', 'Basic dXNlcjpwYXNz')
    await addRow(editor, 3, 'X-Api-Key', 'sk_live_9f2d41c8a7')
    await addExpressionRow(page, editor, 4, 'X-Auth-Token', "f'tok_{suffix}'")
    // Canonical casing renders regardless of the typed casing
    await addRow(editor, 5, 'content-length', '10')

    // Offending KEY inputs are error-styled; clean keys are not
    await expect(editor.locator('[data-testid="map-edit-key-2"]')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(editor.locator('[data-testid="map-edit-key-5"]')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(editor.locator('[data-testid="map-edit-key-3"]')).not.toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(editor.locator('[data-testid="map-edit-key-0"]')).not.toHaveAttribute(
      'aria-invalid',
      'true',
    )

    // Strip: first exact message + "(+1 more)" expander carrying the other
    const strip = editor.locator('[data-testid="value-editor-validation"]')
    await expect(strip).toBeVisible()
    await expect(strip).toContainText(MSG_DUPLICATE)
    const more = editor.locator('[data-testid="value-editor-validation-more"]')
    await expect(more).toHaveText('(+1 more)')
    await more.click()
    await expect(page.locator('[data-testid="value-editor-validation-more-list"]')).toContainText(
      MSG_BLOCKED,
    )
    await page.keyboard.press('Escape')

    // No inline row messages - the sentence lives only in the strip
    await expect(editor.locator('[data-testid="map-edit-body"]')).not.toContainText(
      'cannot be set manually',
    )

    // Save disabled while key errors exist
    await expect(editor.locator('[data-testid="value-editor-save-button"]')).toBeDisabled()

    // Advisories: literal Basic + literal X-Api-Key + an
    // expression carrying literal material fire; the pure secret-variable
    // expression (row 1) stays calm - exactly 3 amber icons
    await expect(editor.locator('[aria-label="Unsecured credential"]')).toHaveCount(3)

    // Removing the offenders clears the strip; TE still present, Save enabled
    await editor.locator('[data-testid="map-remove-5"]').click()
    await editor.locator('[data-testid="map-remove-2"]').click()
    await expect(editor.locator('[data-testid="value-editor-validation"]')).toHaveCount(0)
    await expect(editor.locator('[data-testid="value-editor-save-button"]')).toBeEnabled()
  })

  test('V-HTTP-01-S4: Code view - quoted literal vs bare {{ }} grammar, reject + lock', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, buildFixture())
    const sheet = await openConfig(page, 'http-everyday')
    const editor = await openHeadersEditor(page, sheet)

    await editor.locator('[data-testid="view-dropdown"]').click()
    await page.getByRole('option', { name: 'Code' }).click()

    // Literal = quoted JSON string; expression = bare {{ expr }}; no $expr
    const code = editor.locator('.cm-content').first()
    await expect(code).toContainText('"X-Trace-Id": "wave-1"')
    await expect(code).toContainText('{{ api_token }}')
    await expect(code).not.toContainText('$expr')

    // A bare {{ expr }} produces no lint error
    await expect(editor.locator('[data-testid="value-editor-validation"]')).toHaveCount(0)
    // Save only wakes on a change, so edit the doc while keeping the bare {{ }}.
    await replaceCode(page, editor, '{"X-Trace-Id": "wave-2", "Authorization": {{ api_token }}}')
    await expect(editor.locator('[data-testid="value-editor-validation"]')).toHaveCount(0)
    await expect(editor.locator('[data-testid="value-editor-save-button"]')).toBeEnabled()

    // Visual <-> Code round-trip preserves the classification
    await editor.locator('[data-testid="view-dropdown"]').click()
    await page.getByRole('option', { name: 'Visual' }).click()
    await expect(editor.locator('[data-testid="map-expr-toggle-1"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await editor.locator('[data-testid="view-dropdown"]').click()
    await page.getByRole('option', { name: 'Code' }).click()

    // Neither quoted string nor bare {{ }} -> exact reject, Save blocked,
    // Visual switch locked
    await replaceCode(page, editor, '{"X-Trace-Id": "wave-1", "Authorization": 123}')
    const strip = editor.locator('[data-testid="value-editor-validation"]')
    await expect(strip).toContainText(MSG_CODE_REJECT)
    await expect(editor.locator('[data-testid="value-editor-save-button"]')).toBeDisabled()
    await editor.locator('[data-testid="view-dropdown"]').click()
    const visualOption = page.getByRole('option', { name: 'Visual' })
    await expect(visualOption).toHaveAttribute('data-disabled', /.*/)
    await expect(visualOption.locator('[data-testid="view-locked-alert"]')).toBeVisible()
    await page.keyboard.press('Escape')

    // The source-level duplicate scan still flags what Visual flags
    await replaceCode(page, editor, '{"A": "1", "a": "2"}')
    await expect(strip).toContainText('Duplicate header')
    await expect(strip).toContainText('(header names are case-insensitive)')

    // A QUOTED {{ }} stays a literal through the round-trip
    await replaceCode(page, editor, '{"K": "{{ keep }}"}')
    await expect(editor.locator('[data-testid="value-editor-validation"]')).toHaveCount(0)
    await editor.locator('[data-testid="view-dropdown"]').click()
    await page.getByRole('option', { name: 'Visual' }).click()
    await expect(editor.locator('[data-testid="map-edit-key-0"]')).toHaveValue('K')
    await expect(editor.locator('[data-testid="map-edit-value-0"]')).toHaveValue('{{ keep }}')
    await expect(editor.locator('[data-testid="map-expr-toggle-0"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  test('V-HTTP-01-S5: load-validation parity + node badges ', async ({
    page,
  }) => {
    // Save validation REJECTS these sets, so stage them through the admin
    // bulk endpoint and let LOAD validation + node issues surface them.
    // Content-Length carries a non-string value (the coercion pin).
    const badHeadersId = await rawPersistTest(page.request, {
      name: `V-HTTP-01 bad headers ${Date.now()}`,
      nodes: [
        httpNode('http-bad', 160, {
          url: 'https://api.example.com/v1/orders',
          method: 'POST',
          body_mode: 'form',
          form_fields: { a: '1' },
          headers: {
            Authorization: 'Bearer abc',
            authorization: 'Basic abc',
            'Content-Length': 10,
          },
          timeout: 30,
        }),
      ],
      edges: [{ id: 'e-start', source: 'start-node', target: 'http-bad' }],
    })

    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    await page.goto(`/workbench?editTest=${badHeadersId}`)

    // The load dialog carries the verbatim messages; the retired
    // mode-conflict sentence appears NOWHERE
    const dialog = page.locator('[data-testid="validation-error-dialog"]')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText('Test Issues Found')).toBeVisible()
    const errorList = dialog.locator('[data-testid="validation-error-list"]')
    await expect(errorList).toContainText(MSG_DUPLICATE)
    await expect(errorList).toContainText(MSG_BLOCKED)
    await expect(errorList).not.toContainText('sets the Content-Type header automatically')
    await dialog.locator('[data-testid="validation-close-btn"]').click()
    await expect(dialog).not.toBeVisible()

    // After dismissal the canvas badge carries the same messages (the FE
    // MAP_KEY_POLICY mirror coerces the non-string value instead of crashing)
    await waitForCanvasLoad(page)
    const badge = page
      .locator('[data-testid="workflow-node-http-bad"]')
      .locator('[data-testid="node-validation-alert"]')
    await expect(badge).toBeVisible()
    await badge.hover()
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toContainText(MSG_DUPLICATE)
    await expect(tooltip).toContainText(MSG_BLOCKED)

    // Remote Execution body + file body mode + artifact:// source
    // fires only the file-body REMOTE_UNSUPPORTED finding (FIO-10)
    const remoteId = await rawPersistTest(page.request, {
      name: `V-HTTP-01 remote scheme ${Date.now()}`,
      nodes: [
        {
          id: 'container',
          type: 'workflowNode',
          position: { x: 320, y: 160 },
          data: {
            label: 'Remote Execution',
            elementType: 'remote-execution',
            nodeType: 'plugin',
            category: 'remote',
            version: '1.0.0',
            description: 'container',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            config: { values: { session_id: 'sid' }, outputBindings: {}, profileBindings: [] },
          },
          measured: { width: 200, height: 62 },
        },
        httpNode('http-remote-file', 320, {
          url: 'https://api.example.com/v1/import',
          method: 'PUT',
          body_mode: 'file',
          file_source: 'artifact://data/in.bin',
          timeout: 30,
        }),
      ],
      edges: [
        { id: 'e-start', source: 'start-node', target: 'container' },
        {
          id: 'e-body',
          source: 'container',
          sourceHandle: 'body',
          target: 'http-remote-file',
          type: 'default',
        },
      ],
    })

    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    await page.goto(`/workbench?editTest=${remoteId}`)
    const remoteDialog = page.locator('[data-testid="validation-error-dialog"]')
    await expect(remoteDialog).toBeVisible({ timeout: 15_000 })
    const remoteList = remoteDialog.locator('[data-testid="validation-error-list"]')
    await expect(remoteList).toContainText(MSG_REMOTE_FILE_BODY)
    await expect(remoteList).not.toContainText('artifact://')
    await remoteDialog.locator('[data-testid="validation-close-btn"]').click()
    await expect(remoteDialog).not.toBeVisible()

    // REMOTE_UNSUPPORTED routes through the dialog only and the scheme raises
    // nothing, so the node carries no badge
    await waitForCanvasLoad(page)
    await expect(
      page
        .locator('[data-testid="workflow-node-http-remote-file"]')
        .locator('[data-testid="node-validation-alert"]'),
    ).toHaveCount(0)
  })
})
