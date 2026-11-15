/**
 * V-BINDING-ASSIGN-HINT (functional): the empty Assign to box shows its hint `variable_name` in the gray of a not-set
 * default, in the light and the dark theme.
 * Design Decisions: CANVAS-131, FIELD-2
 * REQ: REQ-3.1.1.5
 *
 * Seeds (API, POST /tests; the Test is named `V-BINDING-ASSIGN-HINT <id>` and deleted afterwards): an HTTP Request
 * Block with no output bound and Retry Delay not set.
 *
 * Pass Criteria (each in both themes):
 * 1. Retry Delay is not set: its box holds the default `1` in Text Muted with no reset icon.
 * 2. The `Assign Body to` box is empty and its hint is `variable_name`.
 * 3. The computed color of that hint equals the computed color of the gray default `1` of Retry Delay.
 *
 * Phase: functional-workflow. Nothing is run or saved: the open Block window is the behavior.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { openTest } from '../../helpers/fn-seed'
import { cleanUp, createTest, openBlockWindow, pluginBlock } from '../../helpers/fn-block'
import { elementColor, outputRow, resolvedColor } from '../../helpers/config-sheet'
import { closeUnchangedSheet, openGroup } from '../../helpers/list-fields'
import { expectGrayDefault } from '../../helpers/default-rule'
import { fieldInput } from '../../helpers/value-field'
import { inBothThemes, parkPointer } from '../../helpers/entry-editors'

const SPEC = 'V-BINDING-ASSIGN-HINT'
const HTTP_ID = 'assign-hint-http'
const RETRIES = 'Timeouts & Retries'
const HINT = 'variable_name'

/** The computed color of a text box's placeholder, as sRGB hex. */
async function placeholderColor(page: Page, box: Locator): Promise<string> {
  const computed = await box.evaluate((el) => getComputedStyle(el, '::placeholder').color)
  return resolvedColor(page, computed)
}

test.describe('V-BINDING-ASSIGN-HINT (functional): the empty Assign to hint is the gray of a not-set default', () => {
  const testIds: string[] = []

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds)
  })

  test('the Assign Body to hint has the color of the not-set Retry Delay default in both themes', async ({
    page,
    request,
  }) => {
    const testId = await createTest(request, {
      name: `${SPEC} ${randomUUID().slice(0, 8)}`,
      nodes: [
        pluginBlock(HTTP_ID, 'HTTP Request', 'http-client', 'network', {
          values: { method: 'GET', url: 'https://example.com/assign-hint', response_mode: 'body' },
        }),
      ],
    })
    testIds.push(testId)
    await openTest(page, testId)

    await inBothThemes(page, async (theme) => {
      const sheet = await openBlockWindow(page, HTTP_ID)
      await openGroup(sheet, RETRIES)
      await expectGrayDefault(sheet, 'retry_delay', '1')

      const hintBox = outputRow(sheet, 'body').getByRole('combobox', { name: 'Assign Body to' })
      await hintBox.scrollIntoViewIfNeeded()
      await expect(hintBox, `${theme}: the Assign Body to box is empty`).toHaveValue('')
      await expect(hintBox, `${theme}: its hint`).toHaveAttribute('placeholder', HINT)

      await parkPointer(page)
      const defaultGray = await elementColor(fieldInput(sheet, 'retry_delay'), 'color')
      await expect
        .poll(() => placeholderColor(page, hintBox), {
          message: `${theme}: the ${HINT} hint has the color ${defaultGray} of the not-set Retry Delay default`,
        })
        .toBe(defaultGray)

      await closeUnchangedSheet(sheet)
    })
  })
})
