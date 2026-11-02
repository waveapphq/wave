/**
 * V-FN-REQUIRED-INPUT (functional): a Required Function input and running the Function alone
 * Design Decisions: FNCFG-8, VMGR-103, VMGR-107, VMGR-108, VMGR-113
 * REQ: REQ-3.1.2.10 (a Required input may have a default; a run of the Function alone uses the Current
 *      value set before the run, also right after Reset), REQ-3.1.3.21 (a Required input given null
 *      fails and names it), REQ-3.2.1.1 (normal execution)
 *
 * Phase: functional-workflow.
 *
 * Seeds (API): `zz-` library Functions (POST /functions) with a Required string input and a body
 * Log printing it; `zz-` Tests (POST /tests) holding a Local Function with the same input (its
 * Function Block binds the input to `'caller'`), an empty Local Function, or the library Function's
 * Block with `who` unbound next to a declared variable `who_src` with no value (stored through the
 * admin bulk path, since an unbound Required input refuses POST /tests). The two kept-default tests
 * seed a Required input with the default `old`.
 * The things under test (the input window, the Current value, Run, Reset, the save, the library
 * Function Block and its binding) are done through the UI.
 *
 * Pass Criteria:
 * 1. Library: with `who` given the Current value `ann` before any run, the first Run prints `who=ann`.
 * 2. Library: right after Reset, the next Run prints `who=ann` again.
 * 3. Library: with no Current value on `who`, a Run from the library View stops before the first
 *    block: the run fails, the body Log prints nothing and the console names the input with
 *    `'who' is null`.
 * 4. For every type (string, integer, float, boolean, array, map, table), ticking Required in the
 *    input window keeps the default the window holds and turns Set to null off and locks it
 *    (`aria-disabled`, hint `off while Required is set`; a click, a label click and Space leave it
 *    unticked; a Boolean input has it off before, hint `off for a Boolean input`); the saved input is
 *    Required and keeps the String, Integer, Float and Boolean default.
 * 5. A default on a Required input is kept after the Test holding the Local Function is saved from the
 *    toolbar, and after a new library version is published from the library View.
 * 6. Local: drilled into the Local Function with `who` given the Current value `ann`, Run prints
 *    `who=ann` (not the Function Block's `caller`), also right after Reset.
 * 7. Local: with no Current value on `who`, Run while drilled in fails, the body Log prints nothing
 *    and the console names `'who' is null`.
 * 8. A library Function Block whose Required input is bound to a Test variable holding null fails
 *    in a Test run and names `'who' is null`; its body Log never prints.
 * 9. Drilled into a library Function Block in a Test (not in edit mode), the author sets the
 *    Required input's Current value `ann` in its window; the pencil opens the window with the name,
 *    type and default read-only, the row delete stays locked and the Test stays unchanged; Run
 *    prints `who=ann` (not the Function Block's `caller`), also right after Reset.
 * 10. The same for a secret input: its Current value is set write-only, the row stays masked, the
 *    run uses it (`len=` of the value) and the value never shows on the page or the console.
 * 11. The standalone library View, not in edit mode: the pencil on an input opens `Edit input
 *    parameter` with Name, Type and the default `dflt` shown read-only; only the Current value is set,
 *    and the run prints it.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import {
  createValidTest,
  dismissLoadDialogIfPresent,
  expressionInputs,
  localFunctionNode,
  logNode,
  openFunctionView,
  openTest,
  publishLibraryFunction,
  rawPersistTest,
  setFunctionFields,
  sharedNode,
  startEdge,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'
import { setRowExpression } from '../../helpers/config-sheet'
import { expectNodeStatus } from '../../helpers/k8s-run'
import { escapeRegExp, formatEntries, getLogEntries, type LogEntry } from '../../helpers/log-reader'
import {
  cancelWindow,
  createFunctionParam,
  createNullField,
  expectWindowValue,
  openEditWindow,
  openFunctionCreateModal,
  saveWindow,
  setCreateName,
  setCreateType,
  setValueView,
  setWindowCheckbox,
  setWindowValue,
  submitCreate,
  valueField,
  variableRow,
  windowCheckbox,
  type WindowValue,
} from '../../helpers/variable-create'
import {
  bindFunctionInputExpression,
  digIn,
  dragNodeBy,
  openFunctionBlockSheet,
  popToBreadcrumbSegment,
  resetRun,
  runToEnd,
  saveBlockSheet,
  saveTest,
  selectEnvironment,
  setCurrentValue,
} from '../../helpers/workbench'
import { closeInspector, expandVariableManager, rowFor } from '../var-current-edit/helpers'
import { randomUUID } from 'node:crypto'

const WHO_INPUT = { name: 'who', type: 'string', required: true, description: '' }
const DEFAULTED_INPUT = { name: 'dflt_who', type: 'string', required: true, description: '', default: 'old' }
const LOG_ID = 'who-log'
const FN_ID = 'fn-required'

const INPUT_TYPES = ['string', 'integer', 'float', 'boolean', 'array', 'map', 'table'] as const
type InputType = (typeof INPUT_TYPES)[number]

/** A value of each type the Function Block passes, written as an expression. */
const BLOCK_VALUES: Record<InputType, string> = {
  string: "'s'",
  integer: '1',
  float: '1.5',
  boolean: 'True',
  array: '[1]',
  map: "{'k': 1}",
  table: "[{'id': 1}]",
}

/** The default typed into the window per type, as its stored text; list, map and table keep their preset. */
const TYPED_DEFAULTS: Partial<Record<InputType, string>> = {
  integer: '4242',
  float: '42.5',
}

const statusBadge = (page: Page): Locator => page.locator('[data-testid="workflow-status"]')

/** Standalone run sessions this test started, swept after it. */
const sessionIds: string[] = []
/** Current-value writes sent to a live session, kept for the report. */
const overridePatches: string[] = []

const libraryRun = (fn: SeededLibraryFunction) => (url: string) => url.includes(`/functions/${fn.functionId}/run`)
const workbenchRun = (url: string) => new URL(url).pathname.endsWith('/workbench/run')

/** Click Run, keep the run request for the report, and return the run's console lines. */
async function runAndRead(
  page: Page,
  isRunRequest: (url: string) => boolean,
  label: string,
  current?: string,
): Promise<LogEntry[]> {
  const before = (await getLogEntries(page)).length
  const runRequest = page.waitForRequest((r) => r.method() === 'POST' && isRunRequest(r.url()))
  await page.locator('[data-testid="run-button"]').click()
  const sent = (await runRequest).postDataJSON() as Record<string, unknown>
  const draft = (sent.draft ?? null) as Record<string, unknown> | null
  sessionIds.push(String(sent.session_id ?? ''))
  test.info().annotations.push({
    type: `${label}-request`,
    description: JSON.stringify({
      keys: Object.keys(sent),
      inputs: draft?.inputs ?? null,
      variables: sent.variables ?? null,
      carriesCurrent: current === undefined ? null : JSON.stringify(sent).includes(JSON.stringify(current)),
      overridePatches: overridePatches.splice(0),
    }),
  })
  await expect(statusBadge(page)).toHaveAttribute('data-status', /passed|failed|stopped/, { timeout: 60_000 })
  let entries: LogEntry[] = []
  await expect
    .poll(
      async () => {
        entries = (await getLogEntries(page)).slice(before)
        return entries.some((e) => e.message.startsWith('who=') || e.level === 'ERROR')
      },
      { timeout: 15_000, message: `${label}: the console shows the Log line or an error` },
    )
    .toBe(true)
  test.info().annotations.push({ type: `${label}-console`, description: formatEntries(entries) })
  return entries
}

const printed = (entries: LogEntry[]): string[] =>
  entries.filter((e) => e.message.startsWith('who=')).map((e) => e.message)

/** The ERROR line that names a null input, with or without the failed-Block prefix. */
const namesNullInput = (entries: LogEntry[], input: string): boolean =>
  entries.some(
    (e) => e.level === 'ERROR' && new RegExp(`^(Block '[^']+' failed: )?'${escapeRegExp(input)}' is null$`).test(e.message),
  )

/** A Local Function Block whose Function holds the given input and a body Log printing it. */
function localFunctionBlock(input: Record<string, unknown>, binding: string): Record<string, unknown> {
  const name = String(input.name)
  const block = localFunctionNode(FN_ID, 'Required Fn', {
    nodes: [logNode(LOG_ID, 'Print Who', `f'who={${name}}'`, { x: 200, y: 180 })],
    edges: [startEdge(LOG_ID)],
    inputs: [input],
  }) as { data: Record<string, unknown> }
  setFunctionFields(block, expressionInputs({ [name]: binding }))
  return block as unknown as Record<string, unknown>
}

/** The inputs of the stored Local Function `FN_ID`. */
async function storedLocalInputs(request: APIRequestContext, testId: string): Promise<Array<Record<string, unknown>>> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId}: ${resp.status()}`).toBeTruthy()
  const nodes = (await resp.json()).data.workflow.nodes as Array<Record<string, any>>
  const fn = nodes.find((node) => node.id === FN_ID)
  expect(fn, 'the Local Function is stored').toBeTruthy()
  return fn!.data.localDefinition.inputs
}

/** A library version's stored definition. */
async function versionDefinition(
  request: APIRequestContext,
  functionId: string,
  version: string,
): Promise<Record<string, any>> {
  const resp = await request.get(`${BACKEND_URL}/functions/${functionId}/versions/${version}`)
  expect(resp.ok(), `GET /functions/${functionId}/versions/${version}: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data.definition
}

const inputNamed = (inputs: Array<Record<string, unknown>>, name: string): Record<string, unknown> => {
  const input = inputs.find((entry) => entry.name === name)
  expect(input, `the input ${name} is stored: ${JSON.stringify(inputs)}`).toBeTruthy()
  return input!
}

/** The hint a locked window checkbox points at. */
async function hintOf(win: Locator, box: Locator): Promise<Locator> {
  const id = await box.getAttribute('aria-describedby')
  expect(id, 'the locked box points at its hint').toBeTruthy()
  return win.locator(`[id="${id}"]`)
}

/** A read-only definition (VMGR-107): Name, Type, Description, Required and the default are shown, none editable. */
async function expectReadOnlyDefinition(page: Page, win: Locator, name: string, shownDefault: WindowValue): Promise<void> {
  await expect(win.getByText('Edit input parameter', { exact: true }), 'the pencil opens the input window').toBeVisible()
  const nameField = win.locator('[data-testid="create-variable-name"]')
  await expect(nameField).toHaveValue(name)
  await expect(nameField, 'the name stays read-only').toHaveAttribute('readonly', '')
  const typeSelect = win.locator('[data-testid="create-type-select"]')
  await expect(typeSelect).toContainText('String')
  await expect(typeSelect, 'the type stays read-only').toBeDisabled()
  await expect(win.locator('[data-testid="param-description"]'), 'the description stays read-only').toBeDisabled()
  await expect(windowCheckbox(win, 'required'), 'Required stays read-only').toHaveAttribute('aria-disabled', 'true')
  await setValueView(page, win, 'Default')
  await expectWindowValue(win, shownDefault)
  await expect(valueField(win).locator('input').first(), 'the default stays read-only').toHaveAttribute('readonly', '')
}

test.describe('V-FN-REQUIRED-INPUT (functional): Required inputs and running a Function alone', () => {
  let fn: SeededLibraryFunction | null = null
  let testId = ''

  test.afterEach(async ({ request }) => {
    overridePatches.splice(0)
    for (const sid of sessionIds.splice(0)) {
      if (sid) await request.delete(`${BACKEND_URL}/functions/view-session/${sid}`).catch(() => undefined)
    }
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    if (fn) await request.delete(`${BACKEND_URL}/functions/${fn.functionId}?cascade=true`).catch(() => undefined)
    fn = null
    testId = ''
  })

  test('a Current value set before a run is what the run uses, also right after Reset', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    fn = await publishLibraryFunction(request, {
      name: `zz-req-input-${randomUUID().slice(0, 8)}`,
      inputs: [WHO_INPUT],
      workflow: {
        nodes: [logNode(LOG_ID, 'Print Who', "f'who={who}'", { x: 200, y: 180 })],
        edges: [startEdge(LOG_ID)],
      },
    })

    page.on('request', (r) => {
      if (r.method() === 'PATCH' && /\/workbench\/[^/]+\/variables\//.test(r.url())) {
        overridePatches.push(`${r.url()} ${r.postData() ?? ''}`)
      }
    })
    await openFunctionView(page, fn.functionId, fn.version)
    await selectEnvironment(page)
    await page.locator('[data-testid="action-bar-edit-function-button"]').click()
    await expect(page.locator('[data-testid="action-bar-publish-button"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(`[data-testid="workflow-node-${LOG_ID}"]`)).toBeVisible()

    await expandVariableManager(page)
    await expect(rowFor(page, 'who')).toBeVisible()
    await setCurrentValue(page, 'who', 'ann')
    await closeInspector(page, 'who')
    const whoValue = rowFor(page, 'who').locator('[data-testid^="variable-value-"]')
    await expect(whoValue, 'the row shows the Current value before the run').toHaveText('ann')

    const first = await runAndRead(page, libraryRun(fn), 'run-1', 'ann')
    // Per FNCFG-8: a Current value set before the run is what the run uses.
    expect.soft(printed(first), `run 1 prints the Current value\n${formatEntries(first)}`).toEqual(['who=ann'])

    await resetRun(page)
    test.info().annotations.push({ type: 'row-after-reset', description: (await whoValue.textContent()) ?? '' })
    const second = await runAndRead(page, libraryRun(fn), 'run-2', 'ann')
    // Per FNCFG-8: also right after Reset.
    expect(printed(second), `run 2 (after Reset) prints the Current value\n${formatEntries(second)}`).toEqual([
      'who=ann',
    ])
  })

  test('a Required input with no value stops a run of the Function alone and names it', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    fn = await publishLibraryFunction(request, {
      name: `zz-req-input-${randomUUID().slice(0, 8)}`,
      inputs: [WHO_INPUT],
      workflow: {
        nodes: [logNode(LOG_ID, 'Print Who', "f'who={who}'", { x: 200, y: 180 })],
        edges: [startEdge(LOG_ID)],
      },
    })

    await openFunctionView(page, fn.functionId, fn.version)
    await selectEnvironment(page)
    await expect(page.locator(`[data-testid="workflow-node-${LOG_ID}"]`)).toBeVisible({ timeout: 15_000 })
    await expandVariableManager(page)
    await expect(rowFor(page, 'who')).toBeVisible()
    await expect(
      rowFor(page, 'who').locator('[data-testid^="variable-value-"]'),
      'who has no Current value before the run',
    ).toHaveText('null')

    const entries = await runAndRead(page, libraryRun(fn), 'run-alone')
    const consoleText = formatEntries(entries)
    const named = new RegExp(`^(Block '${escapeRegExp(fn.name)}' failed: )?'who' is null$`)
    // Per FNCFG-8: a Required input with no value stops the run before the first block and names it.
    expect.soft(printed(entries), `the body Log never runs\n${consoleText}`).toEqual([])
    expect
      .soft(
        entries.some((e) => e.level === 'ERROR' && named.test(e.message)),
        `the console names the input: [ERROR] "'who' is null"\n${consoleText}`,
      )
      .toBe(true)
    await expect.soft(statusBadge(page), 'the run fails').toHaveAttribute('data-status', 'failed')
  })

  test('a Required input of every type keeps its default, with Set to null off and locked', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const kept = `kept-${randomUUID().slice(0, 8)}`
    const typedDefaults: Partial<Record<InputType, WindowValue>> = { ...TYPED_DEFAULTS, string: kept, boolean: true }
    const testName = `zz-req-window-${randomUUID().slice(0, 8)}`
    testId = await createValidTest(request, {
      name: testName,
      nodes: [localFunctionNode(FN_ID, 'Function_1', { nodes: [] })],
      edges: [startEdge(FN_ID)],
    })
    await openTest(page, testId)
    await digIn(page, FN_ID)

    for (const type of INPUT_TYPES) {
      await test.step(`${type}: Required keeps the default and locks Set to null off`, async () => {
        const name = `req_${type}`
        const modal = await openFunctionCreateModal(page, 'input')
        await setCreateName(page, name, modal)
        if (type !== 'string') await setCreateType(page, type, modal)
        const nullBox = windowCheckbox(modal, 'set-to-null')
        const nullLabel = modal.getByText('Set to null', { exact: true })
        const typed = typedDefaults[type]
        if (typed !== undefined) await setWindowValue(page, modal, typed)
        await expect(nullBox).toHaveAttribute('data-state', 'unchecked')
        if (type === 'boolean') {
          // Per REQ-3.1.2.10: a true / false input always declares a default, so Set to null is off before Required.
          await expect(nullBox).toHaveAttribute('aria-disabled', 'true')
          await expect(await hintOf(modal, nullBox)).toHaveText('off for a Boolean input')
        } else {
          await expect(nullBox).not.toHaveAttribute('aria-disabled', 'true')
        }

        await setWindowCheckbox(modal, 'required', true)

        // Per VMGR-103: Required does not force null; Set to null is off and locked, and says why.
        await expect(nullBox).toHaveAttribute('data-state', 'unchecked')
        await expect(nullBox).toHaveAttribute('aria-disabled', 'true')
        await expect(await hintOf(modal, nullBox)).toHaveText('off while Required is set')
        await nullBox.click({ force: true })
        await expect(nullBox, 'a click leaves it unticked').toHaveAttribute('data-state', 'unchecked')
        await nullLabel.click({ force: true })
        await expect(nullBox, 'a label click leaves it unticked').toHaveAttribute('data-state', 'unchecked')
        await nullBox.focus()
        await page.keyboard.press('Space')
        await expect(nullBox, 'Space leaves it unticked').toHaveAttribute('data-state', 'unchecked')
        await expect(createNullField(page, modal), 'no null field while Required').toHaveCount(0)
        // Per VMGR-113: a Required input may have a default.
        if (typed !== undefined) await expectWindowValue(modal, typed)

        await submitCreate(page, modal)
        await expect(modal).toBeHidden()
        await expect(variableRow(page, name)).toBeVisible()
      })
    }

    await test.step('the Function Block sets every Required input, so the Test saves', async () => {
      await popToBreadcrumbSegment(page, testName)
      const sheet = await openFunctionBlockSheet(page, FN_ID)
      for (const type of INPUT_TYPES) await setRowExpression(page, sheet, `req_${type}`, BLOCK_VALUES[type])
      await saveBlockSheet(sheet)
    })
    await saveTest(page)
    const inputs = await storedLocalInputs(request, testId)
    for (const type of INPUT_TYPES) {
      const input = inputNamed(inputs, `req_${type}`)
      expect(input, `req_${type} is stored Required`).toMatchObject({ type, required: true })
      const typed = typedDefaults[type]
      if (typed !== undefined) expect(String(input.default), `req_${type} keeps its default`).toBe(String(typed))
    }
  })

  test('a default on a Required input of a Local Function is kept when the Test is saved', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    testId = await createValidTest(request, {
      name: `zz-req-default-local-${randomUUID().slice(0, 8)}`,
      nodes: [localFunctionBlock(DEFAULTED_INPUT, "'caller'")],
      edges: [startEdge(FN_ID)],
    })
    expect(
      inputNamed(await storedLocalInputs(request, testId), DEFAULTED_INPUT.name).default,
      'the seeded Test holds the default',
    ).toBe('old')

    await openTest(page, testId)
    await dragNodeBy(page, FN_ID, { confirmTestId: 'toolbar-save-button' })
    await saveTest(page)

    // Per VMGR-113: a Required input may have a default, and a save keeps it.
    const saved = inputNamed(await storedLocalInputs(request, testId), DEFAULTED_INPUT.name)
    expect(saved, 'the input stays Required with its default').toMatchObject({ required: true, default: 'old' })
  })

  test('a default on a Required input of a library Function is kept when a new version is published', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    fn = await publishLibraryFunction(request, {
      name: `zz-req-default-${randomUUID().slice(0, 8)}`,
      inputs: [DEFAULTED_INPUT],
      workflow: {
        nodes: [logNode(LOG_ID, 'Print Who', `f'who={${DEFAULTED_INPUT.name}}'`, { x: 200, y: 180 })],
        edges: [startEdge(LOG_ID)],
      },
    })
    expect(
      inputNamed((await versionDefinition(request, fn.functionId, fn.version)).inputs, DEFAULTED_INPUT.name).default,
      'the seeded version holds the default',
    ).toBe('old')

    await openFunctionView(page, fn.functionId, fn.version)
    await page.locator('[data-testid="action-bar-edit-function-button"]').click()
    const publishButton = page.locator('[data-testid="action-bar-publish-button"]')
    await expect(publishButton).toBeVisible({ timeout: 15_000 })
    await createFunctionParam(page, 'variable', 'note', { value: 'edited' })

    await publishButton.click()
    const dialog = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await dialog.locator('[data-testid="publish-edit-mode-changelog-input"]').fill('a new version')
    await dialog.locator('[data-testid="publish-edit-mode-details-input"]').fill('kept default')
    await dialog.getByRole('button', { name: 'Publish' }).click()
    const confirm = page.locator('[data-testid="publish-outcome-single-confirm"]')
    await expect(confirm).toBeVisible({ timeout: 10_000 })
    await confirm.click()
    await expect(confirm).toBeHidden({ timeout: 15_000 })

    const listed = await request.get(`${BACKEND_URL}/functions/${fn.functionId}/versions`)
    expect(listed.ok(), `GET /functions/${fn.functionId}/versions: ${listed.status()}`).toBeTruthy()
    const latest = (await listed.json()).data.latest as string
    expect(latest, 'a new version was published').not.toBe(fn.version)
    // Per VMGR-113: the published version keeps the input Required with its default.
    const published = inputNamed((await versionDefinition(request, fn.functionId, latest)).inputs, DEFAULTED_INPUT.name)
    expect(published, 'the input stays Required with its default').toMatchObject({ required: true, default: 'old' })
  })

  test('a Current value set before running a Local Function alone is what the run uses, also right after Reset', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    testId = await createValidTest(request, {
      name: `zz-req-local-${randomUUID().slice(0, 8)}`,
      nodes: [localFunctionBlock(WHO_INPUT, "'caller'")],
      edges: [startEdge(FN_ID)],
    })
    await openTest(page, testId)
    await selectEnvironment(page)
    await digIn(page, FN_ID)
    await expect(page.locator(`[data-testid="workflow-node-${LOG_ID}"]`)).toBeVisible({ timeout: 15_000 })
    await expandVariableManager(page)
    await expect(rowFor(page, 'who')).toBeVisible()
    await setCurrentValue(page, 'who', 'ann')
    await closeInspector(page, 'who')
    const whoValue = rowFor(page, 'who').locator('[data-testid^="variable-value-"]')
    await expect(whoValue, 'the row shows the Current value before the run').toHaveText('ann')

    const first = await runAndRead(page, workbenchRun, 'local-run-1', 'ann')
    // Per FNCFG-8: a run of the Function alone uses the Current value, not the Function Block's value.
    expect.soft(printed(first), `run 1 prints the Current value\n${formatEntries(first)}`).toEqual(['who=ann'])

    await resetRun(page)
    test.info().annotations.push({ type: 'row-after-reset', description: (await whoValue.textContent()) ?? '' })
    const second = await runAndRead(page, workbenchRun, 'local-run-2', 'ann')
    // Per FNCFG-8: also right after Reset.
    expect(printed(second), `run 2 (after Reset) prints the Current value\n${formatEntries(second)}`).toEqual([
      'who=ann',
    ])
  })

  test('a Required input with no value stops a run of the Local Function alone and names it', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    await ensureEnvironment(request)
    testId = await createValidTest(request, {
      name: `zz-req-local-${randomUUID().slice(0, 8)}`,
      nodes: [localFunctionBlock(WHO_INPUT, "'caller'")],
      edges: [startEdge(FN_ID)],
    })
    await openTest(page, testId)
    await selectEnvironment(page)
    await digIn(page, FN_ID)
    await expect(page.locator(`[data-testid="workflow-node-${LOG_ID}"]`)).toBeVisible({ timeout: 15_000 })
    await expandVariableManager(page)
    await expect(rowFor(page, 'who')).toBeVisible()
    test.info().annotations.push({
      type: 'who-row-before-run',
      description: (await rowFor(page, 'who').locator('[data-testid^="variable-value-"]').textContent()) ?? '',
    })

    const entries = await runAndRead(page, workbenchRun, 'local-run-alone')
    const consoleText = formatEntries(entries)
    // Per FNCFG-8: a Required input with no value stops the run before the first block and names it.
    expect.soft(printed(entries), `the body Log never runs\n${consoleText}`).toEqual([])
    expect
      .soft(namesNullInput(entries, 'who'), `the console names the input: [ERROR] "'who' is null"\n${consoleText}`)
      .toBe(true)
    await expect.soft(statusBadge(page), 'the run fails').toHaveAttribute('data-status', 'failed')
  })

  test('a Required input left null fails the library Function Block in a Test run and names the input', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    await ensureEnvironment(request)
    fn = await publishLibraryFunction(request, {
      name: `zz-req-lib-${randomUUID().slice(0, 8)}`,
      inputs: [WHO_INPUT],
      workflow: {
        nodes: [logNode(LOG_ID, 'Print Who', "f'who={who}'", { x: 200, y: 180 })],
        edges: [startEdge(LOG_ID)],
      },
    })
    // An unbound Required input refuses POST /tests, so the Block is stored through the admin path.
    const blockId = 'lib-required'
    testId = await rawPersistTest(request, {
      name: `zz-req-lib-null-${randomUUID().slice(0, 8)}`,
      nodes: [
        sharedNode(blockId, {
          functionId: fn.functionId,
          functionVersion: fn.version,
          label: fn.name,
          originalLibraryName: fn.name,
        }),
      ],
      edges: [startEdge(blockId)],
      variables: { who_src: { type: 'string', value: null } },
    })
    await openTest(page, testId)
    // The load check lists the unbound Required input; the binding below is its fix.
    await dismissLoadDialogIfPresent(page)
    await bindFunctionInputExpression(page, blockId, 'who', 'who_src')
    await saveTest(page)

    await selectEnvironment(page)
    const { verdict, entries } = await runToEnd(page)
    const consoleText = formatEntries(entries)
    // Per REQ-3.1.3.21: a Required input given null fails the Function Block and names the input.
    expect(verdict, `the run fails\n${consoleText}`).toBe('failed')
    await expectNodeStatus(page, blockId, 'failed')
    expect(namesNullInput(entries, 'who'), `the console names the input\n${consoleText}`).toBe(true)
    expect(printed(entries), `the body Log never runs\n${consoleText}`).toEqual([])
  })

  test.describe('drilled into a library Function Block in a Test', () => {
    const LIB_BLOCK_ID = 'lib-drilled'

    /** Publish `inputs` with `body` Logs, and open a Test whose library Function Block binds `bindings`, drilled in. */
    async function openDrilledLibraryBlock(
      page: Page,
      request: APIRequestContext,
      inputs: Array<Record<string, unknown>>,
      logs: Array<[string, string]>,
      bindings: Record<string, string>,
    ): Promise<void> {
      await ensureEnvironment(request)
      fn = await publishLibraryFunction(request, {
        name: `zz-req-drill-${randomUUID().slice(0, 8)}`,
        inputs,
        workflow: {
          nodes: logs.map(([id, message], index) => logNode(id, `Print ${index + 1}`, message, { x: 200, y: 180 + 120 * index })),
          edges: [startEdge(logs[0][0]), ...logs.slice(1).map(([id], index) => ({ id: `e-${index}`, source: logs[index][0], target: id }))],
        },
      })
      testId = await createValidTest(request, {
        name: `zz-req-drill-${randomUUID().slice(0, 8)}`,
        nodes: [
          sharedNode(LIB_BLOCK_ID, {
            functionId: fn.functionId,
            functionVersion: fn.version,
            label: fn.name,
            originalLibraryName: fn.name,
            ...expressionInputs(bindings),
          }),
        ],
        edges: [startEdge(LIB_BLOCK_ID)],
      })
      await openTest(page, testId)
      await selectEnvironment(page)
      await digIn(page, LIB_BLOCK_ID)
      await expect(page.locator(`[data-testid="workflow-node-${logs[0][0]}"]`)).toBeVisible({ timeout: 15_000 })
      await expandVariableManager(page)
    }

    test('a Current value set on a Required input is what the run uses, also right after Reset', async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000)
      await openDrilledLibraryBlock(page, request, [WHO_INPUT], [[LOG_ID, "f'who={who}'"]], { who: "'caller'" })
      await expect(rowFor(page, 'who')).toBeVisible()

      await setCurrentValue(page, 'who', 'ann')
      await closeInspector(page, 'who')
      const whoValue = rowFor(page, 'who').locator('[data-testid^="variable-value-"]')
      await expect(whoValue, 'the row shows the Current value before the run').toHaveText('ann')

      await test.step('the definition stays read-only and the Test unchanged', async () => {
        // Per VMGR-107: on a read-only definition the pencil opens the window with only the Current value editable.
        const win = await openEditWindow(page, 'who')
        await expectReadOnlyDefinition(page, win, 'who', '')
        await cancelWindow(page, win)
        await expect(rowFor(page, 'who').locator('[data-testid^="delete-button-"]')).toHaveAttribute('aria-disabled', 'true')
        await expect(page.locator('[data-testid="toolbar-save-button"]'), 'a Current value is not a Test change').toBeDisabled()
      })

      const first = await runAndRead(page, workbenchRun, 'drilled-run-1', 'ann')
      // Per FNCFG-8: a run of the Function alone uses the Current value, not the Function Block's value.
      expect.soft(printed(first), `run 1 prints the Current value\n${formatEntries(first)}`).toEqual(['who=ann'])

      await resetRun(page)
      const second = await runAndRead(page, workbenchRun, 'drilled-run-2', 'ann')
      // Per FNCFG-8: also right after Reset.
      expect(printed(second), `run 2 (after Reset) prints the Current value\n${formatEntries(second)}`).toEqual([
        'who=ann',
      ])
    })

    test('in the library View, not in edit mode, a Current value set on a Required input is what the run uses', async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000)
      await ensureEnvironment(request)
      fn = await publishLibraryFunction(request, {
        name: `zz-req-view-${randomUUID().slice(0, 8)}`,
        inputs: [{ ...WHO_INPUT, default: 'dflt' }],
        workflow: {
          nodes: [logNode(LOG_ID, 'Print Who', "f'who={who}'", { x: 200, y: 180 })],
          edges: [startEdge(LOG_ID)],
        },
      })
      await openFunctionView(page, fn.functionId, fn.version)
      await selectEnvironment(page)
      await expect(page.locator(`[data-testid="workflow-node-${LOG_ID}"]`)).toBeVisible({ timeout: 15_000 })
      await expandVariableManager(page)
      await expect(rowFor(page, 'who')).toBeVisible()

      await test.step('the pencil opens the input window with only its Current value editable', async () => {
        // Per VMGR-107: a Function opened in View takes only a Current value; Name, Type and Default stay read-only.
        const win = await openEditWindow(page, 'who')
        await expectReadOnlyDefinition(page, win, 'who', 'dflt')
        await setValueView(page, win, 'Current')
        await setWindowValue(page, win, 'ann')
        await saveWindow(page, win)
      })
      await expect(page.locator('[data-testid="action-bar-publish-button"]'), 'the View stays out of edit mode').toHaveCount(0)

      const entries = await runAndRead(page, libraryRun(fn), 'view-run', 'ann')
      // Per FNCFG-8: the read-only View still takes the Current value.
      expect(printed(entries), `the run prints the Current value\n${formatEntries(entries)}`).toEqual(['who=ann'])
    })

    test('a Current value set on a secret input is what the run uses and stays masked, also right after Reset', async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000)
      const canary = `cur-${randomUUID()}`
      await openDrilledLibraryBlock(
        page,
        request,
        [{ name: 'api_key', type: 'string', required: false, secret: true, description: '' }],
        [
          [LOG_ID, "'who=len' + str(len(api_key))"],
          ['key-log', "'key=' + api_key"],
        ],
        { api_key: "'caller-key'" },
      )
      await expect(rowFor(page, 'api_key')).toBeVisible()

      await setCurrentValue(page, 'api_key', canary)
      await closeInspector(page, 'api_key')
      await expect(
        rowFor(page, 'api_key').locator('[data-testid^="variable-value-"]'),
        'the row stays masked',
      ).toHaveText('********')
      expect(await page.content(), 'the Current value never shows on the page').not.toContain(canary)

      for (const [label, reset] of [
        ['secret-run-1', false],
        ['secret-run-2', true],
      ] as const) {
        if (reset) await resetRun(page)
        const entries = await runAndRead(page, workbenchRun, label)
        const consoleText = formatEntries(entries)
        // Per FNCFG-8: the run uses the Current value (its length), not the Function Block's literal.
        expect(printed(entries), `${label}: the body reads the Current value\n${consoleText}`).toEqual([
          `who=len${canary.length}`,
        ])
        expect(consoleText, `${label}: the Current value is masked on the console`).not.toContain(canary)
      }
    })
  })
})
