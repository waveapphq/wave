/**
 * V-CTRL-FIELDS-OPERATOR-FIT: an operator change keeps a compare value only when it still fits
 * Design Decisions: FIELD-13, FIELD-15
 * REQ: REQ-3.5.1.5, REQ-3.1.1.5
 *
 * The Test holds one Assert with two rows on the list `tags`: `contains abc` and `contains` a Template.
 *
 * Pass Criteria:
 * 1. Changing `contains abc` to `length equals` (an integer compare) asks `Change operator?` with
 *    `Changing operator to length equals will clear 1 existing string value. This cannot be undone.`;
 *    nothing changes before the answer.
 * 2. Cancel keeps `contains` and `abc`.
 * 3. Change operator drops the value: the box is empty, `Value is required` shows and Save is held; after `2`
 *    and Save the row stores `length_equals` with `reference_value: "2"` and no flag.
 * 4. A value that still fits stays with no question: `length equals 2` back to `contains` keeps `2`.
 * 5. A Template compare value under `length equals` asks too; confirming drops the value and the Template flag,
 *    and after `3` and Save the row stores `length_equals` with `reference_value: "3"` and no flag.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { operatorTrigger, valueBox } from '../../helpers/condition-builder'
import { saveButton } from '../../helpers/config-sheet'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { deleteTestQuietly, storedNode, typeNumber } from '../../helpers/number-rule'
import { openBlockSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'

const ASSERT = 'of-assert'
const LITERAL_ROW = 'of-tags-literal'
const TEMPLATE_ROW = 'of-tags-template'
const QUESTION = 'Changing operator to length equals will clear 1 existing string value. This cannot be undone.'

type Item = Record<string, any>

function fixture(): Record<string, unknown> {
  return {
    name: 'zz-ctrl-fields-operator-fit-1',
    version: '1.0.0',
    description: 'An Assert whose list rows change operator',
    variables: {
      tags: { value: ['abc', 'web'], type: 'array', scope: 'test' },
      prefix: { value: 'web', type: 'string', scope: 'test' },
    },
    metadata: { tags: [], suite_id: null, parent_suite: null },
    workflow: {
      nodes: [
        {
          id: ASSERT,
          type: 'workflowNode',
          position: { x: 200, y: 160 },
          data: {
            label: 'Check tags',
            elementType: 'assert',
            nodeType: 'control',
            category: 'flow',
            version: '1.0.0',
            description: 'Check tags',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            config: {
              values: {
                assertions: [
                  { id: LITERAL_ROW, type: 'literal', variable: 'tags', value_type: 'array', operator: 'contains', reference_value: 'abc' },
                  { type: 'operator', value: 'and' },
                  {
                    id: TEMPLATE_ROW,
                    type: 'literal',
                    variable: 'tags',
                    value_type: 'array',
                    operator: 'contains',
                    reference_value: '{{ prefix }}',
                    reference_is_template: true,
                  },
                ],
                mode: 'single',
                fail_current_scope: false,
              },
              outputBindings: {},
              profileBindings: [],
            },
          },
        },
      ],
      edges: [{ id: 'e-of-0', source: 'start-node', target: ASSERT, type: 'default' }],
    },
  }
}

async function storedRows(request: APIRequestContext, testId: string): Promise<Item[]> {
  return (await storedNode(request, testId, ASSERT)).data.config.values.assertions as Item[]
}

function rowById(rows: Item[], id: string): Item {
  const row = rows.find((item) => item.id === id)
  expect(row, `the row ${id} is stored`).toBeTruthy()
  return row as Item
}

function operatorQuestion(page: Page): Locator {
  return page.getByRole('alertdialog').filter({ hasText: 'Change operator?' })
}

/** Pick `length equals` on a row that holds a value it cannot keep: the question opens and nothing changes yet. */
async function pickLengthEqualsAsked(page: Page, body: Locator, path: string): Promise<Locator> {
  const operator = operatorTrigger(body, path)
  await operator.click()
  await page.getByRole('option', { name: 'length equals', exact: true }).click()
  const question = operatorQuestion(page)
  await expect(question).toBeVisible()
  await expect(question).toContainText(QUESTION)
  await expect(operator, 'nothing changes before the answer').toHaveText('contains')
  return question
}

test.describe('V-CTRL-FIELDS-OPERATOR-FIT: an operator change keeps only a value that fits', () => {
  const created: string[] = []

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const id of created.splice(0)) await deleteTestQuietly(request, id)
  })

  test('a held value that no longer fits asks first; one that fits stays', async ({ page, request }) => {
    test.setTimeout(240_000)
    const testId = await importValidateAndNavigate(page, fixture())
    created.push(testId)

    await test.step('1-3. contains abc to length equals asks; Cancel keeps it; Change operator drops it', async () => {
      const sheet = await openBlockSheet(page, ASSERT)
      const cancelQuestion = await pickLengthEqualsAsked(page, sheet, '0')
      await cancelQuestion.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(cancelQuestion).toHaveCount(0)
      await expect(operatorTrigger(sheet, '0')).toHaveText('contains')
      await expect(valueBox(sheet, '0')).toHaveValue('abc')

      const question = await pickLengthEqualsAsked(page, sheet, '0')
      await question.getByRole('button', { name: 'Change operator', exact: true }).click()
      await expect(question).toHaveCount(0)
      await expect(operatorTrigger(sheet, '0')).toHaveText('length equals')
      await expect(valueBox(sheet, '0')).toHaveValue('')
      await expect(sheet.locator('[data-testid="param-error-assert-value-0"]')).toHaveText('Value is required')
      await expect(saveButton(sheet)).toBeDisabled()

      await typeNumber(page, valueBox(sheet, '0'), '2')
      await saveBlockSheet(sheet)
      await saveTest(page)
      expect(rowById(await storedRows(request, testId), LITERAL_ROW)).toEqual({
        id: LITERAL_ROW,
        type: 'literal',
        variable: 'tags',
        value_type: 'array',
        operator: 'length_equals',
        reference_value: '2',
      })
    })

    await test.step('4-5. a value that fits stays with no question; a Template under length equals asks and goes', async () => {
      const sheet = await openBlockSheet(page, ASSERT)
      const operator = operatorTrigger(sheet, '0')
      await operator.click()
      await page.getByRole('option', { name: 'contains', exact: true }).click()
      await expect(operator).toHaveText('contains')
      await expect(operatorQuestion(page), 'a value that still fits asks nothing').toHaveCount(0)
      await expect(valueBox(sheet, '0')).toHaveValue('2')

      await expect(valueBox(sheet, '2').locator('.cm-content')).toHaveText('{{ prefix }}')
      const question = await pickLengthEqualsAsked(page, sheet, '2')
      await question.getByRole('button', { name: 'Change operator', exact: true }).click()
      await expect(question).toHaveCount(0)
      await expect(operatorTrigger(sheet, '2')).toHaveText('length equals')
      await expect(valueBox(sheet, '2')).toHaveValue('')
      await typeNumber(page, valueBox(sheet, '2'), '3')
      await saveBlockSheet(sheet)
      await saveTest(page)

      const rows = await storedRows(request, testId)
      expect(rowById(rows, LITERAL_ROW)).toEqual({
        id: LITERAL_ROW,
        type: 'literal',
        variable: 'tags',
        value_type: 'array',
        operator: 'contains',
        reference_value: '2',
      })
      expect(rowById(rows, TEMPLATE_ROW)).toEqual({
        id: TEMPLATE_ROW,
        type: 'literal',
        variable: 'tags',
        value_type: 'array',
        operator: 'length_equals',
        reference_value: '3',
      })
    })
  })
})
