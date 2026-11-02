/**
 * V-FIELD-SWITCH-WARNING-FUNCTIONAL: the switch warning on every field type, both directions, every answer, checked in the stored Test.
 * Design Decisions: FIELD-7 (switch warning), FIELD-2 (not set), FIELD-4 (`<empty string>`), FIELD-5 (null), FIELD-8 (choice values)
 * REQ: REQ-3.1.1.5
 *
 * Pass Criteria:
 * 1. {x} on a field holding a value asks `Switch the field to an expression?` / `The current value is cleared.`;
 *    switching back asks `Switch the field to a plain value?` with the same body.
 * 2. Text, code, list, map and table fields offer `Cancel`, `Clear & Default` (`Clear` with no default) and
 *    `Clear & Empty` (primary); integer, float, choice-list and true / false fields offer `Cancel` and
 *    `Clear & Default` (`Clear` with no default) as the primary; focus starts on Cancel.
 * 3. Esc and a click on the backdrop leave the dialog open (and the Block window under it).
 * 4. Cancel keeps the value and the mode, in both directions.
 * 5. Into {x}: Clear & Empty puts `''` / `[]` / `{}` (a table: `[]`) in as the expression, stored with its {x} flag;
 *    Clear & Default (or Clear) leaves the box empty with the default as its gray hint (none with no default), and
 *    Save stores nothing.
 * 6. Out of {x}: Clear & Empty leaves empty text / `[]` / `{}` / an empty table as the user's value, stored with no
 *    flag; Clear & Default (or Clear) leaves the field not set (the gray default; `null` on a field that takes null;
 *    an empty box otherwise), and Save stores nothing; a choice list or true / false gets its default written.
 * 7. A field holding nothing switches with no warning and copies nothing in.
 * 8. A masked stored secret asks its own `Discard protected value?` (confirm `Switch to expression`), never the switch
 *    warning; Cancel keeps it masked; the switch leaves {x} empty and Save stores nothing for it.
 *
 * Phase: functional-workflow (imports its own fixture, deletes it after). The stored Test is the behavior: nothing is run.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { readFixture } from '../../helpers/element-types'
import { checkbox, enumTrigger } from '../../helpers/config-sheet'
import { openBlockSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'
import { deleteSeededTest, openGroup, storedBlock } from '../../helpers/list-fields'
import {
  SWITCH_TO_EXPRESSION_TITLE,
  SWITCH_TO_PLAIN_TITLE,
  expressionToggle,
  fieldInput,
  nullButton,
  resetButton,
  switchWarning,
} from '../../helpers/value-field'
import {
  expectEmptyNotSet,
  expectEmptyStringMarker,
  expectExpression,
  expectGrayDefault,
  expectGrayEmptyDefault,
  expectNothingStored,
  expectNullNotSet,
  expectStored,
  expectSwitchWarning,
  expectUserValue,
  storedFields,
  switchSilently,
  switchWithAnswer,
  typeExpression,
  type FreeEntryType,
  type StoredFields,
  type SwitchAnswer,
} from '../../helpers/default-rule'

interface BlockRef {
  id: string
  label: string
}

/** How a field looks when it holds nothing. */
type NotSetLook = { kind: 'default'; shown: string } | { kind: 'empty-default' } | { kind: 'null' } | { kind: 'empty' }

interface FieldBase {
  block: BlockRef
  name: string
  group?: string
  /** The default as the {x} hint shows it; null when the field has no default. */
  hint: string | null
  /** Typed into {x} on a field that holds nothing. */
  expression: string
}

/** Text, code, list, map and table: the fields with an empty value (FIELD-7). */
interface EmptyField extends FieldBase {
  type: FreeEntryType
  /** The fixture's value as the box shows it. */
  start: string
  notSet: NotSetLook
  nullable: boolean
  emptyExpression: string
  emptyStored: unknown
}

interface NumberField extends FieldBase {
  type: 'integer' | 'float'
  start: string
  notSet: NotSetLook
}

interface ChoiceField extends FieldBase {
  look: 'choice' | 'boolean'
  start: string | boolean
  storedDefault: string | boolean
}

const SHELL: BlockRef = { id: 'e2987488-9aad-4207-9450-027fd249d1c9', label: 'Shell Switch' }
const HTTP: BlockRef = { id: '858cfd7e-aca2-4d1e-b99c-e77b93154b1d', label: 'HTTP Switch' }
const SEARCH: BlockRef = { id: '9f8e46a1-3261-47d2-ab2d-0efdc09985da', label: 'Query Switch' }
const FN: BlockRef = { id: '6fe1f528-1d1f-4965-b185-843031e205b9', label: 'switch_fn' }

const RETRIES = 'Timeouts & Retries'

const EMPTY_FIELDS: readonly EmptyField[] = [
  {
    block: SHELL, name: 'shell', type: 'string', start: '/bin/bash', notSet: { kind: 'default', shown: '/bin/sh' },
    hint: "'/bin/sh'", nullable: false, emptyExpression: "''", emptyStored: '', expression: "'/bin/zsh'",
  },
  {
    block: SHELL, name: 'env_vars', type: 'map', start: '{"MODE": "x"}', notSet: { kind: 'default', shown: '{}' },
    hint: '{}', nullable: false, emptyExpression: '{}', emptyStored: {}, expression: "{'B': '2'}",
  },
  {
    block: SHELL, name: 'working_dir', type: 'string', group: 'Execution', start: '/tmp', notSet: { kind: 'empty' },
    hint: null, nullable: false, emptyExpression: "''", emptyStored: '', expression: "'/var'",
  },
  {
    block: HTTP, name: 'retryable_status_codes', type: 'array', group: RETRIES, start: '["500"]',
    notSet: { kind: 'default', shown: '["502", "503", "504"]' }, hint: "['502', '503', '504']", nullable: false,
    emptyExpression: '[]', emptyStored: [], expression: "['599']",
  },
  {
    block: HTTP, name: 'headers', type: 'map', start: '{"X-A": "1"}', notSet: { kind: 'empty' }, hint: null,
    nullable: false, emptyExpression: '{}', emptyStored: {}, expression: "{'X-B': '2'}",
  },
  {
    block: SEARCH, name: 'query', type: 'string', start: 'msg:alpha', notSet: { kind: 'empty-default' }, hint: "''",
    nullable: false, emptyExpression: "''", emptyStored: '', expression: "'msg:beta'",
  },
  {
    block: FN, name: 'grid', type: 'table', start: '[{"name": "gamma"}]', notSet: { kind: 'default', shown: '[{"name": "alpha"}]' },
    hint: "[{'name': 'alpha'}]", nullable: false, emptyExpression: '[]', emptyStored: [], expression: "[{'name': 'zeta'}]",
  },
  {
    block: FN, name: 'note', type: 'string', start: 'hello', notSet: { kind: 'null' }, hint: null, nullable: true,
    emptyExpression: "''", emptyStored: '', expression: "'later'",
  },
  {
    block: FN, name: 'items', type: 'array', start: '["a", "b"]', notSet: { kind: 'null' }, hint: null, nullable: true,
    emptyExpression: '[]', emptyStored: [], expression: "['c']",
  },
  {
    block: FN, name: 'conf', type: 'map', start: '{"k": "v"}', notSet: { kind: 'null' }, hint: null, nullable: true,
    emptyExpression: '{}', emptyStored: {}, expression: "{'k': 'w'}",
  },
  {
    block: FN, name: 'rows', type: 'table', start: '[{"name": "r1"}]', notSet: { kind: 'null' }, hint: null, nullable: true,
    emptyExpression: '[]', emptyStored: [], expression: "[{'name': 'r2'}]",
  },
]

const NUMBER_FIELDS: readonly NumberField[] = [
  { block: SHELL, name: 'timeout', type: 'integer', group: 'Execution', start: '120', notSet: { kind: 'default', shown: '300' }, hint: '300', expression: '45' },
  { block: HTTP, name: 'retry_delay', type: 'float', group: RETRIES, start: '2.5', notSet: { kind: 'default', shown: '1' }, hint: '1.0', expression: '0.5' },
  { block: FN, name: 'count', type: 'integer', start: '5', notSet: { kind: 'null' }, hint: null, expression: '7' },
  { block: FN, name: 'level', type: 'float', start: '0.5', notSet: { kind: 'null' }, hint: null, expression: '0.25' },
]

const CHOICE_FIELDS: readonly ChoiceField[] = [
  { block: HTTP, name: 'method', look: 'choice', start: 'POST', hint: "'GET'", expression: "'PUT'", storedDefault: 'GET' },
  {
    block: HTTP, name: 'allow_redirects', look: 'boolean', group: 'Connection', start: false, hint: 'True',
    expression: 'False', storedDefault: true,
  },
]

const BLOCKS: readonly BlockRef[] = [SHELL, HTTP, SEARCH, FN]

function clearLabel(field: FieldBase): SwitchAnswer {
  return field.hint === null ? 'Clear' : 'Clear & Default'
}

function emptyButtons(field: EmptyField): SwitchAnswer[] {
  return ['Cancel', clearLabel(field), 'Clear & Empty']
}

function plainButtons(field: FieldBase): SwitchAnswer[] {
  return ['Cancel', clearLabel(field)]
}

/** The look of a field that holds nothing. */
async function expectNotSet(sheet: Locator, name: string, look: NotSetLook): Promise<void> {
  if (look.kind === 'default') await expectGrayDefault(sheet, name, look.shown)
  else if (look.kind === 'empty-default') await expectGrayEmptyDefault(sheet, name)
  else if (look.kind === 'null') await expectNullNotSet(sheet, name)
  else await expectEmptyNotSet(sheet, name)
}

/** The empty value Clear & Empty leaves out of {x}: `<empty string>`, `[]`, `{}` or an empty table, held as the user's value. */
async function expectEmptyUserValue(sheet: Locator, field: EmptyField): Promise<void> {
  const { name } = field
  const hasDefault = field.hint !== null
  if (field.type === 'string') {
    await expect(expressionToggle(sheet, name), `${name}: literal mode`).toHaveAttribute('aria-pressed', 'false')
    await expect(fieldInput(sheet, name)).toHaveValue('')
    await expectEmptyStringMarker(sheet, name)
    await expect(resetButton(sheet, name), `${name}: empty text is the user's value`).toHaveCount(hasDefault ? 1 : 0)
  } else {
    await expectUserValue(sheet, name, field.type, field.type === 'map' ? '{}' : '[]', hasDefault)
  }
  if (field.nullable) {
    await expect(nullButton(sheet, name), `${name}: the null button is not pressed`).toHaveAttribute('aria-pressed', 'false')
  }
}

/** A choice list or true / false showing `value` in literal mode. */
async function expectChoice(sheet: Locator, field: ChoiceField, value: string | boolean): Promise<void> {
  await expect(expressionToggle(sheet, field.name), `${field.name}: literal mode`).toHaveAttribute('aria-pressed', 'false')
  if (field.look === 'choice') await expect(enumTrigger(sheet, field.name)).toHaveText(String(value))
  else await expect(checkbox(sheet, field.name)).toHaveAttribute('data-state', value === true ? 'checked' : 'unchecked')
}

type Act<F> = (page: Page, sheet: Locator, field: F) => Promise<void>
type Check<F> = (stored: StoredFields, field: F) => void

/** One round: open each Block's window, act on its fields, Save it, Save the Test, then check every field as stored. */
async function round<F extends FieldBase>(
  page: Page,
  testId: string,
  label: string,
  fields: readonly F[],
  act: Act<F>,
  check: Check<F>,
): Promise<void> {
  await test.step(label, async () => {
    for (const block of BLOCKS) {
      const own = fields.filter((field) => field.block === block)
      if (own.length === 0) continue
      await test.step(block.label, async () => {
        const sheet = await openBlockSheet(page, block.id)
        for (const group of new Set(own.flatMap((field) => field.group ?? []))) await openGroup(sheet, group)
        for (const field of own) await test.step(field.name, () => act(page, sheet, field))
        await saveBlockSheet(sheet)
      })
    }
    await saveTest(page)
    for (const block of BLOCKS) {
      const own = fields.filter((field) => field.block === block)
      if (own.length === 0) continue
      const stored = storedFields(await storedBlock(page.request, testId, block.id))
      for (const field of own) check(stored, field)
    }
  })
}

/** Esc and a click on the backdrop leave the open switch warning, and the window under it, open. */
async function expectDialogStays(page: Page, sheet: Locator): Promise<void> {
  const dialog = switchWarning(page)
  await page.keyboard.press('Escape')
  await expect(dialog, 'Esc leaves the warning open').toBeVisible()
  await page.mouse.click(4, 4)
  await expect(dialog, 'a backdrop click leaves the warning open').toBeVisible()
  await expect(sheet, 'the Block window stays open under the warning').toBeVisible()
}

test.describe('V-FIELD-SWITCH-WARNING-FUNCTIONAL: the switch warning on every field type', () => {
  let testId = ''

  test.afterEach(async ({ page }) => {
    await deleteSeededTest(page, testId)
    testId = ''
  })

  test('text, code, list, map and table fields: Cancel, Clear & Default / Clear and Clear & Empty, both directions', async ({
    page,
  }) => {
    test.setTimeout(480_000)
    testId = await importValidateAndNavigate(page, readFixture(__dirname, 'fixture-switch.json'), {
      injectHttp: true,
      rejectRepairs: true,
    })
    let askedFirst = false

    await round(page, testId, 'into {x}: Cancel keeps the value, Clear & Empty puts the empty value in', EMPTY_FIELDS,
      async (p, sheet, field) => {
        await expressionToggle(sheet, field.name).click()
        await expectSwitchWarning(switchWarning(p), SWITCH_TO_EXPRESSION_TITLE, emptyButtons(field))
        if (!askedFirst) {
          askedFirst = true
          await expectDialogStays(p, sheet)
        }
        await switchWarning(p).getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(switchWarning(p)).toHaveCount(0)
        await expectUserValue(sheet, field.name, field.type, field.start, field.hint !== null)
        await switchWithAnswer(p, sheet, field.name, SWITCH_TO_EXPRESSION_TITLE, emptyButtons(field), 'Clear & Empty')
        await expectExpression(sheet, field.name, field.emptyExpression, null)
      },
      (stored, field) => expectStored(stored, field.name, field.emptyExpression, true, `${field.name} after Clear & Empty into {x}`),
    )

    await round(page, testId, 'out of {x}: Cancel keeps the expression, Clear & Default / Clear leaves the field not set', EMPTY_FIELDS,
      async (p, sheet, field) => {
        await expectExpression(sheet, field.name, field.emptyExpression, null)
        await switchWithAnswer(p, sheet, field.name, SWITCH_TO_PLAIN_TITLE, emptyButtons(field), 'Cancel')
        await expectExpression(sheet, field.name, field.emptyExpression, null)
        await switchWithAnswer(p, sheet, field.name, SWITCH_TO_PLAIN_TITLE, emptyButtons(field), clearLabel(field))
        await expectNotSet(sheet, field.name, field.notSet)
      },
      (stored, field) => expectNothingStored(stored, field.name, `${field.name} after ${clearLabel(field)} out of {x}`),
    )

    await round(page, testId, 'a field holding nothing switches into {x} with no warning and copies nothing in', EMPTY_FIELDS,
      async (p, sheet, field) => {
        await expectNotSet(sheet, field.name, field.notSet)
        await switchSilently(p, sheet, field.name, true)
        await expectExpression(sheet, field.name, '', field.hint)
        await typeExpression(p, sheet, field.name, field.expression)
      },
      (stored, field) => expectStored(stored, field.name, field.expression, true, `${field.name} typed in {x}`),
    )

    await round(page, testId, 'out of {x}: Clear & Empty leaves the empty value as the user value', EMPTY_FIELDS,
      async (p, sheet, field) => {
        await expectExpression(sheet, field.name, field.expression, null)
        await switchWithAnswer(p, sheet, field.name, SWITCH_TO_PLAIN_TITLE, emptyButtons(field), 'Clear & Empty')
        await expectEmptyUserValue(sheet, field)
      },
      (stored, field) => expectStored(stored, field.name, field.emptyStored, false, `${field.name} after Clear & Empty out of {x}`),
    )

    await round(page, testId, 'into {x}: Clear & Default / Clear leaves the box empty under the default hint', EMPTY_FIELDS,
      async (p, sheet, field) => {
        await expectEmptyUserValue(sheet, field)
        await switchWithAnswer(p, sheet, field.name, SWITCH_TO_EXPRESSION_TITLE, emptyButtons(field), clearLabel(field))
        await expectExpression(sheet, field.name, '', field.hint)
      },
      (stored, field) => expectNothingStored(stored, field.name, `${field.name} after ${clearLabel(field)} into {x}`),
    )
  })

  test('integer, float, choice-list and true / false fields: Cancel and Clear & Default / Clear, both directions', async ({
    page,
  }) => {
    test.setTimeout(360_000)
    testId = await importValidateAndNavigate(page, readFixture(__dirname, 'fixture-switch.json'), {
      injectHttp: true,
      rejectRepairs: true,
    })
    const fields: readonly (NumberField | ChoiceField)[] = [...NUMBER_FIELDS, ...CHOICE_FIELDS]
    const isChoice = (field: NumberField | ChoiceField): field is ChoiceField => 'look' in field
    let askedFirst = false

    await round(page, testId, 'into {x}: Cancel keeps the value, Clear & Default / Clear leaves the box empty', fields,
      async (p, sheet, field) => {
        await expressionToggle(sheet, field.name).click()
        await expectSwitchWarning(switchWarning(p), SWITCH_TO_EXPRESSION_TITLE, plainButtons(field))
        if (!askedFirst) {
          askedFirst = true
          await expectDialogStays(p, sheet)
        }
        await switchWarning(p).getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(switchWarning(p)).toHaveCount(0)
        if (isChoice(field)) await expectChoice(sheet, field, field.start)
        else await expectUserValue(sheet, field.name, field.type, field.start, field.hint !== null)
        await switchWithAnswer(p, sheet, field.name, SWITCH_TO_EXPRESSION_TITLE, plainButtons(field), clearLabel(field))
        await expectExpression(sheet, field.name, '', field.hint)
      },
      (stored, field) => expectNothingStored(stored, field.name, `${field.name} after ${clearLabel(field)} into {x}`),
    )

    await round(page, testId, 'a field holding nothing switches into {x} with no warning and copies nothing in', fields,
      async (p, sheet, field) => {
        if (!isChoice(field)) await expectNotSet(sheet, field.name, field.notSet)
        await switchSilently(p, sheet, field.name, true)
        await expectExpression(sheet, field.name, '', field.hint)
        await typeExpression(p, sheet, field.name, field.expression)
      },
      (stored, field) => expectStored(stored, field.name, field.expression, true, `${field.name} typed in {x}`),
    )

    await round(page, testId, 'out of {x}: Cancel keeps the expression, Clear & Default / Clear clears it', fields,
      async (p, sheet, field) => {
        await expectExpression(sheet, field.name, field.expression, null)
        await switchWithAnswer(p, sheet, field.name, SWITCH_TO_PLAIN_TITLE, plainButtons(field), 'Cancel')
        await expectExpression(sheet, field.name, field.expression, null)
        await switchWithAnswer(p, sheet, field.name, SWITCH_TO_PLAIN_TITLE, plainButtons(field), clearLabel(field))
        if (isChoice(field)) await expectChoice(sheet, field, field.storedDefault)
        else await expectNotSet(sheet, field.name, field.notSet)
      },
      (stored, field) => {
        const what = `${field.name} after ${clearLabel(field)} out of {x}`
        if (isChoice(field)) expectStored(stored, field.name, field.storedDefault, false, `${what}: the default is written`)
        else expectNothingStored(stored, field.name, what)
      },
    )
  })

  test('a masked stored secret asks its own discard question, never the switch warning', async ({ page }) => {
    testId = await importValidateAndNavigate(page, readFixture(__dirname, 'fixture-switch.json'), {
      injectHttp: true,
      rejectRepairs: true,
    })
    const sheet = await openBlockSheet(page, SEARCH.id)
    await openGroup(sheet, 'Authentication')
    const discard = page.getByRole('alertdialog').filter({ hasText: 'Discard protected value?' })

    await test.step('{x} on the masked Password asks Discard protected value?', async () => {
      await expect(fieldInput(sheet, 'password'), 'the stored password is masked, with no text box').toHaveCount(0)
      await expressionToggle(sheet, 'password').click()
      await expect(discard).toBeVisible()
      await expect(switchWarning(page), 'not the switch warning').toHaveCount(0)
      await expect(discard).toHaveAccessibleName('Discard protected value?')
      await expect(discard).toHaveAccessibleDescription(
        'The protected value stored in Password will be discarded when you switch to an expression. The field will then reference a variable instead.',
      )
      await expect(discard.locator('[data-action-group] button')).toHaveText(['Cancel', 'Switch to expression'])
    })

    await test.step('Cancel keeps the password masked in literal mode', async () => {
      await discard.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(discard).toHaveCount(0)
      await expect(expressionToggle(sheet, 'password')).toHaveAttribute('aria-pressed', 'false')
      await expect(fieldInput(sheet, 'password')).toHaveCount(0)
    })

    await test.step('Switch to expression leaves {x} empty; Save stores nothing for the password', async () => {
      await expressionToggle(sheet, 'password').click()
      await discard.getByRole('button', { name: 'Switch to expression', exact: true }).click()
      await expect(discard).toHaveCount(0)
      await expectExpression(sheet, 'password', '', null)
      await saveBlockSheet(sheet)
      await saveTest(page)
      const stored = storedFields(await storedBlock(page.request, testId, SEARCH.id))
      expectNothingStored(stored, 'password', 'the discarded password')
      expectStored(stored, 'username', 'wave', false, 'the login name stays')
    })
  })
})
