/**
 * V-HTTP-03: Multipart Parts Editor + File Mode
 *
 * Phase: no-data (parallel) - seeds its own Test via POST /tests; no DB reset.
 * Design Decisions: HTTP-11, FIELD-10
 * A text-part value is a literal or a whole-value expression (part-expr-toggle /
 * part-expr-value, no expand on a part); multipart Auto Headers is locked on and
 * its generated Content-Type row cannot be deleted; the parts Code array view
 * round-trips and validates with exact per-part messages; file mode exposes the
 * Type dropdown + the auto-from-extension generated row and the body-headers-off
 * advisory.
 * REQ: REQ-3.4.1.4, REQ-3.1.1.5
 *
 * Pass Criteria:
 * 1. Anatomy: the Parts row is the one value field holding both parts on one
 *    line, its expand opens the Parts editor; seeded expression text part
 *    (part-expr-value), file part, no expand icon on a part; multipart Auto
 *    Headers checked+disabled; generated CT delete locked with the
 *    transport-owns tooltip
 * 2. Persistence: rename survives all three save layers + the dotted expression
 *    field; Code array view round-trips; the exact validation strings fire;
 *    duplicate part names are legal
 * 3. File mode: italic placeholder + Type dropdown + (auto from file extension)
 *    generated row + the body-headers-off advisory
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { configSheet } from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'

const FILE_PLACEHOLDER = 'artifact://…, testdata://…, or /abs/path on host'
const MULTIPART_CT_TOOLTIP =
  'The transport owns this header - multipart bodies always send a generated Content-Type'
const FILE_CT_MISSING = 'Content-Type is not set - add a header row to send one'

function httpNode(id: string, y: number, values: Record<string, unknown>, expr: string[] = []) {
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
      expressionFields: expr,
      templateFields: [],
      config: { values, outputBindings: {}, profileBindings: [] },
    },
    measured: { width: 120, height: 62 },
  }
}

function buildFixture() {
  return {
    name: 'V-HTTP-03 Parts + File',
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: [
        httpNode(
          'http-multipart',
          160,
          {
            url: 'https://api.example.com/v1/upload',
            method: 'POST',
            body_mode: 'multipart',
            parts: [
              { kind: 'text', name: 'metadata', value: 'meta_json' },
              { kind: 'file', name: 'report', source: 'artifact://reports/run-42.pdf' },
            ],
            timeout: 30,
          },
          ['parts.0.value'],
        ),
        httpNode('http-file', 280, {
          url: 'https://api.example.com/v1/import',
          method: 'PUT',
          body_mode: 'text',
          timeout: 30,
        }),
      ],
      edges: [
        { id: 'e-start', source: 'start-node', target: 'http-multipart' },
        { id: 'e-1', source: 'http-multipart', target: 'http-file' },
      ],
    },
    variables: {
      meta_json: { value: '{"kind": "report"}', type: 'string', scope: 'test' },
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

async function expandGroup(sheet: Locator, name: string) {
  await sheet.locator(`[data-testid="group-header-${name}"]`).click()
}

/** Open the Parts editor from the (Body-group) Parts row's expand. */
async function openPartsEditor(page: Page, sheet: Locator): Promise<Locator> {
  await sheet.getByRole('button', { name: 'Open editor for Parts', exact: true }).click()
  const editor = page.locator('[data-testid="parts-editor-sheet"]')
  await expect(editor).toBeVisible()
  return editor
}

async function openHeadersEditor(page: Page, sheet: Locator): Promise<Locator> {
  await sheet.getByRole('button', { name: 'Open editor for Headers', exact: true }).click()
  const editor = page.locator('[data-testid="value-editor-sheet"]')
  await expect(editor).toBeVisible()
  return editor
}

/** Replace a CodeMirror document with `text`. */
async function replaceCode(page: Page, editor: Locator, text: string) {
  const code = editor.locator('.cm-content').first()
  await code.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(text)
}

async function switchView(page: Page, editor: Locator, name: 'Visual' | 'Code') {
  await editor.locator('[data-testid="view-dropdown"]').click()
  await page.getByRole('option', { name }).click()
}

test.describe('V-HTTP-03: multipart parts editor + file mode', () => {
  test('V-HTTP-03-S1: parts anatomy - literal/expression rows, locked multipart CT', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, buildFixture())
    const sheet = await openConfig(page, 'http-multipart')
    await expandGroup(sheet, 'Body')

    // 1. The Parts field holds both parts on one line (FIELD-10) + the exact boundary note
    const partsLine = sheet.locator('[data-testid="param-row-parts"] [data-slot="input-group"] input').first()
    await expect(partsLine).toHaveValue(/metadata.*meta_json.*report.*artifact:\/\/reports\/run-42\.pdf/)
    await expect(sheet.locator('[data-testid="param-note-parts"]')).toContainText(
      'Content-Type: multipart/form-data; boundary=(generated) - set automatically',
    )

    // Multipart Auto Headers is forced on and locked (lockedWhen)
    const autoHeaders = sheet.locator(
      '[data-testid="param-row-body_auto_headers"] button[role="checkbox"]',
    )
    await expect(autoHeaders).toHaveAttribute('data-state', 'checked')
    await expect(autoHeaders).toBeDisabled()

    // 2. Parts editor anatomy: PARTS badge
    const editor = await openPartsEditor(page, sheet)
    await expect(editor.locator('[data-testid="parts-editor-type-badge"]')).toHaveText('parts')

    // Text part 0: seeded as an expression (parts.0.value) - toggle pressed, the
    // shared expression editor carries the raw text; no plain literal input, no expand
    await expect(editor.locator('[data-testid="part-kind-0"]')).toContainText('Text')
    await expect(editor.locator('[data-testid="part-name-0"]')).toHaveValue('metadata')
    await expect(editor.locator('[data-testid="part-expr-toggle-0"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(editor.locator('[data-testid="part-expr-value-0"]')).toContainText('meta_json')
    await expect(editor.locator('[data-testid="part-value-0"]')).toHaveCount(0)
    await expect(editor.locator('[data-testid$="-expand"]')).toHaveCount(0)

    // The flip changes only the classification, never the stored text
    await editor.locator('[data-testid="part-expr-toggle-0"]').click()
    await expect(editor.locator('[data-testid="part-value-0"]')).toHaveValue('meta_json')
    await editor.locator('[data-testid="part-expr-toggle-0"]').click()

    // File part 1: kind File, name report, artifact:// source
    await expect(editor.locator('[data-testid="part-kind-1"]')).toContainText('File')
    await expect(editor.locator('[data-testid="part-name-1"]')).toHaveValue('report')
    await expect(editor.locator('[data-testid="part-source-1"]')).toHaveValue(
      'artifact://reports/run-42.pdf',
    )
    await expect(editor.locator('[data-testid="parts-editor-metric"]')).toHaveText('2 parts')
    await editor.locator('[data-testid="parts-editor-cancel-button"]').click()
    await expect(editor).not.toBeVisible()

    // The generated multipart Content-Type row cannot be deleted (transport owns it)
    const headersEditor = await openHeadersEditor(page, sheet)
    await expect(headersEditor.locator('[data-testid="map-generated-key-0"]')).toHaveValue(
      'Content-Type',
    )
    const lockedRemove = headersEditor.locator('[data-testid="map-generated-remove-0"]')
    await expect(lockedRemove).toBeDisabled()
    // The disabled delete is wrapped in a tooltip span (hover the span, not the button)
    await lockedRemove.locator('xpath=..').hover()
    await expect(page.getByRole('tooltip')).toContainText(MULTIPART_CT_TOOLTIP)
  })

  test('V-HTTP-03-S2: persistence + Code array view + validation strings', async ({
    page,
  }) => {
    const testId = await importValidateAndNavigate(page, buildFixture())
    const sheet = await openConfig(page, 'http-multipart')
    await expandGroup(sheet, 'Body')
    let editor = await openPartsEditor(page, sheet)

    // Add a part -> a Text row appends; Kind File swaps value input for source
    await editor.locator('[data-testid="parts-add-part"]').click()
    await expect(editor.locator('[data-testid="parts-editor-metric"]')).toHaveText('3 parts')
    await editor.locator('[data-testid="part-kind-2"]').click()
    await page.getByRole('option', { name: 'File' }).click()
    const newSource = editor.locator('[data-testid="part-source-2"]')
    await expect(newSource).toHaveAttribute('placeholder', FILE_PLACEHOLDER)
    await expect(editor.locator('[data-testid="part-value-2"]')).toHaveCount(0)
    await editor.locator('[data-testid="part-remove-2"]').click()
    await expect(editor.locator('[data-testid="parts-editor-metric"]')).toHaveText('2 parts')

    // Code array view: an expression value serializes bare, a file source quoted
    await switchView(page, editor, 'Code')
    const code = editor.locator('.cm-content').first()
    await expect(code).toContainText('"name":"metadata"')
    await expect(code).toContainText('"value":{{ meta_json }}')
    await expect(code).toContainText('"source":"artifact://reports/run-42.pdf"')

    // Exact per-part validation strings - source is the authority here
    const strip = editor.locator('[data-testid="parts-editor-validation"]')
    await replaceCode(page, editor, '{}')
    await expect(strip).toContainText('Parts must be a JSON array of part objects')
    await replaceCode(page, editor, '[123]')
    await expect(strip).toContainText('Part #0: must be an object')
    await replaceCode(page, editor, '[{"kind":"other","name":"x","value":"y"}]')
    await expect(strip).toContainText('Part #0: kind must be "text" or "file"')
    await replaceCode(page, editor, '[{"kind":"text","name":123,"value":"y"}]')
    await expect(strip).toContainText('Part #0: "name" must be a string')
    await replaceCode(page, editor, '[{"kind":"text","name":"x","value":123}]')
    await expect(strip).toContainText('Part #0: "value" must be a quoted string or a {{ expression }}')
    await replaceCode(page, editor, '[{"kind":"text","name":"x","value":"y","extra":"z"}]')
    await expect(strip).toContainText('Part #0: unknown key "extra"')
    await replaceCode(page, editor, '[{"kind":"text","name":"x"}]')
    await expect(strip).toContainText('Part #0: text parts need "name" and "value"')

    // Duplicate part NAMES are legal - no error, Save enabled, round-trips to Visual
    await replaceCode(
      page,
      editor,
      '[{"kind":"text","name":"dup","value":"1"},{"kind":"text","name":"dup","value":"2"}]',
    )
    await expect(strip).toHaveCount(0)
    await expect(editor.locator('[data-testid="parts-editor-save-button"]')).toBeEnabled()
    await switchView(page, editor, 'Visual')
    await expect(editor.locator('[data-testid="part-name-0"]')).toHaveValue('dup')
    await expect(editor.locator('[data-testid="part-name-1"]')).toHaveValue('dup')
    await editor.locator('[data-testid="parts-editor-cancel-button"]').click()
    await expect(editor).not.toBeVisible()

    // Persistence: rename part 0 through all three save layers; the dotted
    // expression field survives (parts.0.value stays an expression)
    editor = await openPartsEditor(page, sheet)
    await editor.locator('[data-testid="part-name-0"]').fill('metadata2')
    await editor.locator('[data-testid="parts-editor-save-button"]').click()
    await expect(editor).not.toBeVisible()
    await sheet.getByRole('button', { name: 'Save' }).last().click()
    await expect(sheet).not.toBeVisible()
    const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()

    const readNode = async () => {
      const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
      const body = await resp.json().catch(() => null)
      const entity = body?.data ?? body
      return entity?.workflow?.nodes?.find((n: { id: string }) => n.id === 'http-multipart')
    }
    await expect
      .poll(async () => (await readNode())?.data?.config?.values?.parts?.[0]?.name, {
        timeout: 10_000,
      })
      .toBe('metadata2')
    const savedNode = await readNode()
    expect(savedNode?.data?.expressionFields ?? []).toContain('parts.0.value')
    expect(savedNode?.data?.config?.values?.parts?.[1]).toMatchObject({
      kind: 'file',
      name: 'report',
      source: 'artifact://reports/run-42.pdf',
    })
  })

  test('V-HTTP-03-S3: file mode - placeholder, Type dropdown, auto row + off advisory (HTTP-11)', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, buildFixture())
    const sheet = await openConfig(page, 'http-file')
    await expandGroup(sheet, 'Body')

    // Switch Body Mode to File (the option's accessible name includes its sublabel)
    await sheet.locator('[data-testid="param-row-body_mode"] button[role="combobox"]').click()
    await page.getByRole('option', { name: 'File file as body' }).click()

    // File Source row: the one value field with the exact empty-state placeholder
    const fileRow = sheet.locator('[data-testid="param-row-file_source"]')
    await expect(fileRow).toBeVisible()
    const fileBox = fileRow.locator('[data-slot="input-group"] input').first()
    await expect(fileBox).toHaveValue('')
    await expect(fileBox).toHaveAttribute('placeholder', FILE_PLACEHOLDER)

    // Type dropdown: Auto + the six media types
    const typeTrigger = sheet.locator('[data-testid="param-row-file_content_type"] button[role="combobox"]')
    await expect(typeTrigger).toContainText('Auto')
    await typeTrigger.click()
    const typeOptions = page.locator('[role="option"]')
    await expect(typeOptions).toHaveCount(7)
    await expect(typeOptions.nth(0)).toHaveText('Auto')
    for (const mediaType of ['application/json', 'text/plain', 'application/octet-stream']) {
      await expect(page.getByRole('option', { name: mediaType })).toBeVisible()
    }
    await page.keyboard.press('Escape')

    // Auto Headers on -> the generated Content-Type row reads the auto display
    let editor = await openHeadersEditor(page, sheet)
    await expect(editor.locator('[data-testid="map-generated-value-0"]')).toHaveValue(
      '(auto from file extension)',
    )
    await editor.locator('[data-testid="value-editor-cancel-button"]').click()
    await expect(editor).not.toBeVisible()

    // Auto Headers off -> amber Expected-headers icon + the file-mode advisory
    await sheet.locator('[data-testid="param-row-body_auto_headers"] button[role="checkbox"]').click()
    await expect(
      sheet.locator('[data-testid="param-row-headers"]').locator('[aria-label="Expected headers missing"]'),
    ).toBeVisible()
    editor = await openHeadersEditor(page, sheet)
    await expect(editor.locator('[data-testid="value-editor-advisory"]')).toContainText(FILE_CT_MISSING)
    await editor.locator('[data-testid="value-editor-cancel-button"]').click()

    // Body / Form Fields / Parts rows are hidden in file mode
    await expect(sheet.locator('[data-testid="param-row-body"]')).not.toBeVisible()
    await expect(sheet.locator('[data-testid="param-row-form_fields"]')).not.toBeVisible()
    await expect(sheet.locator('[data-testid="param-row-parts"]')).not.toBeVisible()
  })
})
