/**
 * V-SECREV-SETTINGS-01: Settings > General "Secret Masking" section
 *
 * Phase: no-data (parallel) - reads/writes the runtime admin masking flags, no
 * DB seeding. Resets all flags in beforeEach/afterEach so a revealed flag never
 * leaks to another spec sharing this backend.
 * Design Decisions: SECREV-6, SECREV-7, SETTINGS-18, NET-11
 * REQ: REQ-3.1.3.17 / REQ-3.1.3.18 (system-wide secret reveal controls), REQ-4.7.16
 *
 * Pass Criteria:
 * 1. The General tab renders a "Secret Masking" section with FOUR scope-based reveal
 *    toggles (run output / test variables / shared variables / credential inputs),
 *    each OFF by default, plus the exports/encryption carve-out footnote. Cancel and
 *    Save on the Logging heading line are disabled and faded (opacity 0.5, not-allowed
 *    cursor).
 * 2. A click on "Reveal secrets in run output" stages it: the switch turns on, the amber
 *    "Revealing" cue shows, Cancel and Save enable. Nothing is stored: GET
 *    /admin/secret-masking still reports every flag off, and a full page reload shows
 *    the switch off again.
 * 3. Cancel drops a staged switch: off, no cue, Cancel and Save disabled and faded.
 * 4. Save writes it: one PUT /admin/secret-masking, no toast, Cancel and Save disabled
 *    and faded again, GET reports run_output on and the other three off, and the
 *    on-state persists across a full page reload (backend round-trip).
 * 5. Switching it off and saving writes run_output off; the cue clears and stays
 *    cleared after a reload.
 * 6. The four rows sit in the shared settings row group (NET-11): every row label
 *    is normal weight (computed font-weight 400), and every switch is vertically
 *    centered against its label + help line (box centers within 2px).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { apiPathMatcher } from '../../helpers/api-route'
import { BACKEND_URL } from '../../helpers/config'

const MASKING_ALL_OFF = {
  run_output: false,
  test_variables: false,
  shared_variables: false,
  credential_inputs: false,
}

type MaskingFlags = typeof MASKING_ALL_OFF

const MASKING_ROUTE = apiPathMatcher('/admin/secret-masking')

async function resetMaskingFlags(page: Page) {
  await page.request.put(`${BACKEND_URL}/admin/secret-masking`, { data: MASKING_ALL_OFF })
}

async function storedMaskingFlags(page: Page): Promise<MaskingFlags> {
  const response = await page.request.get(`${BACKEND_URL}/admin/secret-masking`)
  expect(response.status(), 'GET /admin/secret-masking').toBe(200)
  const body = (await response.json()) as MaskingFlags
  return {
    run_output: body.run_output,
    test_variables: body.test_variables,
    shared_variables: body.shared_variables,
    credential_inputs: body.credential_inputs,
  }
}

function headerButton(page: Page, name: 'Cancel' | 'Save'): Locator {
  return page.getByTestId('general-tab').getByRole('button', { name, exact: true })
}

/** Cancel and Save show only once the first read has answered. */
async function waitForGeneralLoaded(page: Page) {
  await page.waitForSelector('[data-testid="general-tab"]', { state: 'visible' })
  await expect(headerButton(page, 'Save')).toBeVisible()
}

async function gotoGeneral(page: Page) {
  await page.goto('/settings')
  await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
  await waitForGeneralLoaded(page)
}

async function expectClean(page: Page) {
  for (const name of ['Cancel', 'Save'] as const) {
    const button = headerButton(page, name)
    await expect(button, `${name} is disabled while clean`).toBeDisabled()
    await expect(button, `${name} is not busy`).not.toHaveAttribute('aria-busy', 'true')
    await expect(button, `${name} is faded while clean`).toHaveCSS('opacity', '0.5')
    await expect(button, `${name} shows the not-allowed cursor while clean`).toHaveCSS('cursor', 'not-allowed')
  }
}

async function expectDirty(page: Page) {
  for (const name of ['Cancel', 'Save'] as const) {
    const button = headerButton(page, name)
    await expect(button, `${name} is enabled with a change waiting`).toBeEnabled()
    await expect(button, `${name} is not faded with a change waiting`).toHaveCSS('opacity', '1')
  }
}

/** Clicks Save and returns once the masking write answered; counts the writes the page sent. */
async function saveAndCountWrites(page: Page): Promise<number> {
  let sent = 0
  const count = (request: { method(): string; url(): string }) => {
    if (request.method() === 'PUT' && MASKING_ROUTE(new URL(request.url()))) sent += 1
  }
  page.on('request', count)
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        MASKING_ROUTE(new URL(response.url())) &&
        response.status() === 200,
    ),
    headerButton(page, 'Save').click(),
  ])
  await expectClean(page)
  page.off('request', count)
  return sent
}

const TOGGLE_KEYS = ['run-output', 'test-variables', 'shared-variables', 'credential-inputs']

test.describe('V-SECREV-SETTINGS-01: Secret Masking settings section', () => {
  test.beforeEach(async ({ page }) => {
    await resetMaskingFlags(page)
  })

  test.afterEach(async ({ page }) => {
    await resetMaskingFlags(page)
  })

  test('four scope-based reveal toggles default off with a carve-out footnote; a switch click stages and Cancel drops it', async ({
    page,
  }) => {
    await gotoGeneral(page)

    const section = page.locator('[data-testid="secret-masking-section"]')
    await expect(section).toBeVisible()
    await expect(section.getByRole('heading', { name: 'Secret Masking' })).toBeVisible()

    await test.step('SECREV-6/7: four toggles off by default + carve-out footnote; Cancel and Save faded', async () => {
      for (const key of TOGGLE_KEYS) {
        const toggle = page.locator(`[data-testid="masking-${key}-toggle"]`)
        await expect(toggle).toBeVisible()
        await expect(toggle).toHaveAttribute('role', 'switch')
        await expect(toggle).toHaveAttribute('data-state', 'unchecked')
      }
      await expect(page.locator('[data-testid="masking-carveout-footnote"]')).toBeVisible()
      await expect(page.locator('[data-testid="masking-run-output-revealing"]')).toHaveCount(0)
      await expectClean(page)
    })

    const runOutput = page.locator('[data-testid="masking-run-output-toggle"]')
    await test.step('SECREV-6, SETTINGS-18: a click stages run output ON with the amber "Revealing" cue', async () => {
      await runOutput.click()
      await expect(runOutput).toHaveAttribute('data-state', 'checked')
      await expect(page.locator('[data-testid="masking-run-output-revealing"]')).toBeVisible()
      await expectDirty(page)
      expect(await storedMaskingFlags(page), 'a staged switch stores nothing').toEqual(MASKING_ALL_OFF)
    })

    await test.step('SETTINGS-18: a staged switch is gone after a full reload', async () => {
      await page.reload()
      await waitForGeneralLoaded(page)
      await expect(runOutput).toHaveAttribute('data-state', 'unchecked')
      await expect(page.locator('[data-testid="masking-run-output-revealing"]')).toHaveCount(0)
      await expectClean(page)
    })

    await test.step('SETTINGS-18: Cancel drops a staged switch and disables both buttons', async () => {
      await runOutput.click()
      await expect(runOutput).toHaveAttribute('data-state', 'checked')
      await expectDirty(page)

      await headerButton(page, 'Cancel').click()
      await expect(runOutput).toHaveAttribute('data-state', 'unchecked')
      await expect(page.locator('[data-testid="masking-run-output-revealing"]')).toHaveCount(0)
      await expectClean(page)
      expect(await storedMaskingFlags(page), 'Cancel stores nothing').toEqual(MASKING_ALL_OFF)
    })
  })

  test('Save writes a staged switch with no toast and the on-state persists across reload', async ({
    page,
  }) => {
    await gotoGeneral(page)
    const runOutput = page.locator('[data-testid="masking-run-output-toggle"]')
    const cue = page.locator('[data-testid="masking-run-output-revealing"]')

    await test.step('SETTINGS-18: Save writes run output ON and both buttons disable again', async () => {
      await runOutput.click()
      await expect(runOutput).toHaveAttribute('data-state', 'checked')
      await expectDirty(page)

      expect(await saveAndCountWrites(page), 'one Save sends one masking write').toBe(1)
      await expect(page.locator('[data-toast]'), 'a successful Save shows no toast').toHaveCount(0)
      await expect(runOutput).toHaveAttribute('data-state', 'checked')
      await expect(cue).toBeVisible()
      expect(await storedMaskingFlags(page), 'only run output is stored on').toEqual({
        ...MASKING_ALL_OFF,
        run_output: true,
      })
    })

    await test.step('the on-state persists across a full reload', async () => {
      await page.reload()
      await waitForGeneralLoaded(page)
      await expect(runOutput).toHaveAttribute('data-state', 'checked')
      await expect(cue).toBeVisible()
      for (const key of TOGGLE_KEYS.slice(1)) {
        await expect(page.locator(`[data-testid="masking-${key}-toggle"]`)).toHaveAttribute(
          'data-state',
          'unchecked',
        )
      }
      await expectClean(page)
    })

    await test.step('SETTINGS-18: switching it off and saving stores run output OFF; the cue clears', async () => {
      await runOutput.click()
      await expect(runOutput).toHaveAttribute('data-state', 'unchecked')
      await expect(cue).toHaveCount(0)
      await expectDirty(page)
      expect(await storedMaskingFlags(page), 'the staged off is not stored yet').toEqual({
        ...MASKING_ALL_OFF,
        run_output: true,
      })

      expect(await saveAndCountWrites(page), 'one Save sends one masking write').toBe(1)
      await expect(page.locator('[data-toast]'), 'a successful Save shows no toast').toHaveCount(0)
      expect(await storedMaskingFlags(page), 'every flag is stored off').toEqual(MASKING_ALL_OFF)

      await page.reload()
      await waitForGeneralLoaded(page)
      await expect(runOutput).toHaveAttribute('data-state', 'unchecked')
      await expect(cue).toHaveCount(0)
    })
  })

  test('NET-11: normal-weight row labels and switches centered against label + help', async ({
    page,
  }) => {
    await gotoGeneral(page)
    const section = page.locator('[data-testid="secret-masking-section"]')
    await expect(section.getByRole('switch')).toHaveCount(TOGGLE_KEYS.length)

    for (const key of TOGGLE_KEYS) {
      await test.step(`${key}: label weight and switch centering`, async () => {
        const row = page.locator(`[data-testid="masking-${key}-row"]`)
        const label = row.locator('label')
        await expect(label).toHaveCount(1)
        await expect(label, 'row labels are normal weight').toHaveCSS('font-weight', '400')

        // The text block is the row's first column: the label line plus its help line.
        const textBlock = row.locator(':scope > div').first()
        await expect(textBlock.locator('p'), 'every Secret Masking row has a help line').toHaveCount(1)
        const textBox = (await textBlock.boundingBox())!
        const switchBox = (await page.locator(`[data-testid="masking-${key}-toggle"]`).boundingBox())!
        const textCenter = textBox.y + textBox.height / 2
        const switchCenter = switchBox.y + switchBox.height / 2
        expect(
          Math.abs(switchCenter - textCenter),
          `${key}: the switch is centered against its label + help`,
        ).toBeLessThanOrEqual(2)
      })
    }
  })
})
