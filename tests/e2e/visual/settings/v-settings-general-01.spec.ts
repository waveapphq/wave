/**
 * V-SET-GENERAL-01: Settings > General, clean and with a change waiting for Save
 *
 * Phase: no-data (parallel). Staged edits only, never saved: a PUT of the log level or the masking
 * flags is refused by the spec; both reads stay real. Each test starts from all four masking flags
 * off, set through the API.
 * Design Decisions: SETTINGS-14, SETTINGS-18, SETTINGS-19, SETTINGS-20, SETTINGS-22, NET-11
 * REQ: REQ-4.7.16, REQ-3.7.2.6, REQ-5.2.1.42
 *
 * Pass Criteria:
 * 1. Clean frame: the headings read Logging, Time Zone, Secret Masking in that order. Cancel then
 *    Save (save icon) sit at the right end of the Logging heading line and nowhere else, both
 *    disabled and faded (opacity 0.5, not-allowed cursor).
 * 2. Each section carries one subtitle (14px, muted) between its heading and its rows:
 *    "Verbosity of the WAVE server's own log. Block output in runs is not affected.",
 *    "How timestamps are shown in this browser." and the Secret Masking line. Logging and
 *    Time Zone hold no other text line.
 * 3. The Log Level and Time Zone rows are a label (14px, normal weight) and a select (128px and
 *    176px) with no help line; the select is centered against the label (NET-11) and the six
 *    controls of the page share one right edge.
 * 4. The Log Level select shows the level GET /admin/log-level reports (a real read); Time Zone
 *    shows Browser local.
 * 5. Secret Masking: four labeled rows, every switch off, no "Revealing" cue, the carve-out footnote.
 * 6. Staged frame: another level and "Reveal secrets in run output" switched on show in the page,
 *    the "Revealing" cue sits on that row's label line, Cancel and Save are enabled and not faded.
 *    Nothing is saved: both GETs answer as before, `wave.timezone` is unset, no PUT was sent.
 * 7. Cancel restores every staged value, a staged Time Zone included, and the clean frame.
 * 8. Both frames hold in the other theme (flipped from the sidebar).
 * 9. A first read of GET /admin/log-level answered with 500 shows the heading "Logging" alone, with
 *    no Cancel and no Save, and the section error under it (alert icon, exactly the API's reason,
 *    Try Again); no other heading, no subtitle, no control. With the route removed, Try Again loads
 *    the clean frame.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from '../../helpers/playwright-fixtures'
import { apiPathMatcher, failApiRoute } from '../../helpers/api-route'
import { BACKEND_URL } from '../../helpers/config'
import { toggleTheme } from '../../helpers/theme'

const CENTER_TOLERANCE_PX = 2
const EDGE_TOLERANCE_PX = 1
const TIMEZONE_KEY = 'wave.timezone'

const LOGGING_SUBTITLE = "Verbosity of the WAVE server's own log. Block output in runs is not affected."
const TIME_ZONE_SUBTITLE = 'How timestamps are shown in this browser.'
const MASKING_SUBTITLE = 'Secrets are masked everywhere by default. Reveal them system-wide per surface:'
const MASKING_FOOTNOTE =
  'Exports (per-export choice) and encryption at rest are governed separately and are unaffected.'
const MASKING_LABELS = [
  'Reveal secrets in run output',
  'Reveal test variables',
  'Reveal global, regression, and suite variables',
  'Unmask plugin credential input fields',
]
const MASKING_KEYS = ['run-output', 'test-variables', 'shared-variables', 'credential-inputs']

const MASKING_ALL_OFF = {
  run_output: false,
  test_variables: false,
  shared_variables: false,
  credential_inputs: false,
}

const READ_REASON = 'Log level unreadable: settings-general E2E 7c1d'

const LOG_LEVEL_ROUTE = apiPathMatcher('/admin/log-level')
const MASKING_ROUTE = apiPathMatcher('/admin/secret-masking')
const GENERAL_ROUTES = (url: URL): boolean => LOG_LEVEL_ROUTE(url) || MASKING_ROUTE(url)

interface Writes {
  count: number
}

/** A write of the General settings never reaches the backend; the reads pass through untouched. */
async function refuseWrites(page: Page): Promise<Writes> {
  const writes: Writes = { count: 0 }
  await page.route(GENERAL_ROUTES, async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fallback()
      return
    }
    writes.count += 1
    await route.abort()
  })
  return writes
}

async function levelInForce(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${BACKEND_URL}/admin/log-level`)
  expect(response.status(), 'GET /admin/log-level').toBe(200)
  return ((await response.json()) as { level: string }).level
}

async function storedMasking(request: APIRequestContext): Promise<typeof MASKING_ALL_OFF> {
  const response = await request.get(`${BACKEND_URL}/admin/secret-masking`)
  expect(response.status(), 'GET /admin/secret-masking').toBe(200)
  const body = (await response.json()) as typeof MASKING_ALL_OFF
  return {
    run_output: body.run_output,
    test_variables: body.test_variables,
    shared_variables: body.shared_variables,
    credential_inputs: body.credential_inputs,
  }
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  if (!box) throw new Error('element has no bounding box')
  return box
}

async function centerY(locator: Locator): Promise<number> {
  const box = await boxOf(locator)
  return box.y + box.height / 2
}

async function rightEdge(locator: Locator): Promise<number> {
  const box = await boxOf(locator)
  return box.x + box.width
}

/** The computed color of a theme token, read through a probe element. */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    document.body.appendChild(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, token)
}

function generalTab(page: Page): Locator {
  return page.getByTestId('general-tab')
}

function loggingSection(page: Page): Locator {
  return page.getByTestId('log-level-section')
}

function timeZoneSection(page: Page): Locator {
  return page.getByTestId('timezone-section')
}

function maskingSection(page: Page): Locator {
  return page.getByTestId('secret-masking-section')
}

function headerButton(page: Page, name: 'Cancel' | 'Save'): Locator {
  return generalTab(page).getByRole('button', { name, exact: true })
}

function maskingSwitch(page: Page, key: string): Locator {
  return page.getByTestId(`masking-${key}-toggle`)
}

/** Cancel and Save show only once the first read has answered. */
async function openGeneral(page: Page): Promise<void> {
  await page.goto('/settings')
  await expect(headerButton(page, 'Save')).toBeVisible()
}

async function expectClean(page: Page): Promise<void> {
  for (const name of ['Cancel', 'Save'] as const) {
    const button = headerButton(page, name)
    await expect(button, `${name} is disabled while clean`).toBeDisabled()
    await expect(button, `${name} is faded while clean`).toHaveCSS('opacity', '0.5')
    await expect(button, `${name} shows the not-allowed cursor while clean`).toHaveCSS('cursor', 'not-allowed')
  }
}

async function expectDirty(page: Page): Promise<void> {
  for (const name of ['Cancel', 'Save'] as const) {
    const button = headerButton(page, name)
    await expect(button, `${name} is enabled with a change waiting`).toBeEnabled()
    await expect(button, `${name} is not faded with a change waiting`).toHaveCSS('opacity', '1')
    await expect(button).toHaveCSS('cursor', 'pointer')
  }
}

/** SETTINGS-18: Cancel then Save end the Logging heading line, and no other heading carries them. */
async function expectButtonsOnLoggingLine(page: Page): Promise<void> {
  const section = loggingSection(page)
  const heading = section.getByRole('heading', { level: 2, name: 'Logging', exact: true })
  const cancel = section.getByRole('button', { name: 'Cancel', exact: true })
  const save = section.getByRole('button', { name: 'Save', exact: true })
  for (const name of ['Cancel', 'Save'] as const) {
    await expect(headerButton(page, name), `the page holds one ${name}`).toHaveCount(1)
  }
  await expect(save.locator('svg'), 'Save carries the save icon').toHaveCount(1)
  await expect(cancel.locator('svg'), 'Cancel carries no icon').toHaveCount(0)

  const lineCenter = await centerY(heading)
  for (const button of [cancel, save]) {
    expect(
      Math.abs((await centerY(button)) - lineCenter),
      'the button sits on the Logging heading line',
    ).toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
  }
  const sectionBox = await boxOf(section)
  expect(await rightEdge(cancel), 'Cancel comes before Save').toBeLessThanOrEqual((await boxOf(save)).x)
  expect(
    Math.abs((await rightEdge(save)) - (sectionBox.x + sectionBox.width)),
    'Save ends the heading line',
  ).toBeLessThanOrEqual(EDGE_TOLERANCE_PX)
  expect(
    Math.abs((await boxOf(heading)).x - sectionBox.x),
    'the title starts the heading line',
  ).toBeLessThanOrEqual(EDGE_TOLERANCE_PX)
}

/** One 14px muted subtitle between the section's heading and its first row. */
async function expectSubtitle(page: Page, section: Locator, title: string, text: string): Promise<void> {
  const subtitle = section.locator(':scope > p').first()
  await expect(subtitle).toHaveText(text)
  await expect(subtitle).toHaveCSS('font-size', '14px')
  await expect(subtitle).toHaveCSS('color', await tokenColor(page, '--muted-foreground'))
  const subtitleBox = await boxOf(subtitle)
  const headingBox = await boxOf(section.getByRole('heading', { level: 2, name: title, exact: true }))
  const firstRow = await boxOf(section.locator('label').first())
  expect(subtitleBox.y, `the ${title} subtitle sits under its heading`).toBeGreaterThanOrEqual(
    headingBox.y + headingBox.height,
  )
  expect(subtitleBox.y + subtitleBox.height, `the ${title} subtitle sits above its rows`).toBeLessThanOrEqual(
    firstRow.y,
  )
}

/** SETTINGS-19, SETTINGS-20: the row is a label and a select, with no help line. */
async function expectLabelOnlyRow(
  section: Locator,
  label: string,
  testId: string,
  width: string,
): Promise<Locator> {
  const rowLabel = section.locator('label')
  await expect(rowLabel, 'the section holds one row').toHaveText([label])
  await expect(rowLabel).toHaveCSS('font-size', '14px')
  await expect(rowLabel).toHaveCSS('font-weight', '400')

  await expect(section.getByRole('combobox')).toHaveCount(1)
  const select = section.getByRole('combobox', { name: label, exact: true })
  await expect(select).toHaveAttribute('data-testid', testId)
  await expect(select).toHaveCSS('width', width)
  await expect(select, `no help line describes ${label}`).not.toHaveAttribute('aria-describedby')

  expect(
    Math.abs((await centerY(select)) - (await centerY(rowLabel))),
    `the ${label} select is centered against its label (NET-11)`,
  ).toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
  expect(await rightEdge(rowLabel), `${label}: the label is left of the select`).toBeLessThan(
    (await boxOf(select)).x,
  )
  return select
}

async function expectControlsShareRightEdge(page: Page): Promise<void> {
  const controls = [
    page.getByTestId('log-level-select'),
    page.getByTestId('timezone-select'),
    ...MASKING_KEYS.map((key) => maskingSwitch(page, key)),
  ]
  const edge = await rightEdge(controls[0])
  for (const control of controls.slice(1)) {
    expect(
      Math.abs((await rightEdge(control)) - edge),
      'every control ends at the same right edge',
    ).toBeLessThanOrEqual(EDGE_TOLERANCE_PX)
  }
}

/** Frame settings-general: nothing changed. */
async function expectCleanFrame(page: Page, level: string): Promise<void> {
  const tab = generalTab(page)
  await expect(tab.getByRole('heading', { level: 2 })).toHaveText(['Logging', 'Time Zone', 'Secret Masking'])
  await expectButtonsOnLoggingLine(page)
  await expectClean(page)

  const logging = loggingSection(page)
  const timeZone = timeZoneSection(page)
  const masking = maskingSection(page)
  await expect(logging.locator('p'), 'Logging holds its subtitle and no other text line').toHaveText([
    LOGGING_SUBTITLE,
  ])
  await expect(timeZone.locator('p'), 'Time Zone holds its subtitle and no other text line').toHaveText([
    TIME_ZONE_SUBTITLE,
  ])
  await expect(masking.locator(':scope > p')).toHaveText([MASKING_SUBTITLE, MASKING_FOOTNOTE])
  await expectSubtitle(page, logging, 'Logging', LOGGING_SUBTITLE)
  await expectSubtitle(page, timeZone, 'Time Zone', TIME_ZONE_SUBTITLE)
  await expectSubtitle(page, masking, 'Secret Masking', MASKING_SUBTITLE)

  const logLevel = await expectLabelOnlyRow(logging, 'Log Level', 'log-level-select', '128px')
  const zone = await expectLabelOnlyRow(timeZone, 'Time Zone', 'timezone-select', '176px')
  await expect(logLevel, 'the select shows the level in force').toHaveText(level)
  await expect(zone).toHaveText('Browser local')

  await expect(masking.locator('label')).toHaveText(MASKING_LABELS)
  await expect(masking.getByRole('switch')).toHaveCount(MASKING_KEYS.length)
  for (const key of MASKING_KEYS) {
    await expect(maskingSwitch(page, key), `${key} is off`).toHaveAttribute('aria-checked', 'false')
  }
  await expect(tab.getByText('Revealing', { exact: true })).toHaveCount(0)
  await expect(page.getByTestId('masking-carveout-footnote')).toHaveText(MASKING_FOOTNOTE)
  await expectControlsShareRightEdge(page)
}

async function stageLevelAndRunOutput(page: Page, level: string): Promise<void> {
  await page.getByTestId('log-level-select').click()
  await page.getByRole('option', { name: level, exact: true }).click()
  await maskingSwitch(page, 'run-output').click()
}

/** Frame settings-general-staged: a level and one masking switch wait for Save. */
async function expectStagedFrame(page: Page, stagedLevel: string): Promise<void> {
  await expect(page.getByTestId('log-level-select')).toHaveText(stagedLevel)
  await expect(page.getByTestId('timezone-select')).toHaveText('Browser local')
  await expect(maskingSwitch(page, 'run-output')).toHaveAttribute('aria-checked', 'true')
  for (const key of MASKING_KEYS.slice(1)) {
    await expect(maskingSwitch(page, key), `${key} stays off`).toHaveAttribute('aria-checked', 'false')
  }

  await expect(generalTab(page).getByText('Revealing', { exact: true }), 'one row reveals').toHaveCount(1)
  const row = page.getByTestId('masking-run-output-row')
  const cue = row.getByTestId('masking-run-output-revealing')
  await expect(cue).toHaveText('Revealing')
  const rowLabel = row.locator('label')
  expect(
    Math.abs((await centerY(cue)) - (await centerY(rowLabel))),
    'the cue sits on the label line',
  ).toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
  expect((await boxOf(cue)).x, 'the cue follows the label').toBeGreaterThanOrEqual(await rightEdge(rowLabel))

  await expectDirty(page)
  await expectButtonsOnLoggingLine(page)
  await expectControlsShareRightEdge(page)
}

/** A level that differs from the one in force, so selecting it is a change. */
function otherLevel(level: string): string {
  return level === 'DEBUG' ? 'INFO' : 'DEBUG'
}

let writes: Writes

test.describe('V-SET-GENERAL-01: Settings > General', () => {
  // The frames are drawn at this scale.
  test.use({ viewport: { width: 1440, height: 900 } })

  test.beforeEach(async ({ page, request }) => {
    const reset = await request.put(`${BACKEND_URL}/admin/secret-masking`, { data: MASKING_ALL_OFF })
    expect(reset.status(), 'PUT /admin/secret-masking').toBe(200)
    writes = await refuseWrites(page)
  })

  test.afterEach(() => {
    expect(writes.count, 'a visual spec never saves the General settings').toBe(0)
  })

  test('clean frame: faded Cancel and Save on the Logging heading line, one subtitle per section, label-only rows', async ({
    page,
    request,
  }) => {
    const level = await levelInForce(request)
    await openGeneral(page)

    await test.step('1-5. settings-general: header, subtitles, rows, level in force, Secret Masking', async () => {
      await expectCleanFrame(page, level)
    })
  })

  test('staged frame: Cancel and Save enable, nothing is saved, Cancel restores the clean frame', async ({
    page,
    request,
  }) => {
    const level = await levelInForce(request)
    const staged = otherLevel(level)
    await openGeneral(page)
    await expectClean(page)

    await test.step('6. settings-general-staged: a level and a masking switch wait for Save', async () => {
      await stageLevelAndRunOutput(page, staged)
      await expectStagedFrame(page, staged)
    })

    await test.step('6. nothing is saved while the change waits', async () => {
      expect(await levelInForce(request), 'the level in force is unchanged').toBe(level)
      expect(await storedMasking(request), 'the stored flags are unchanged').toEqual(MASKING_ALL_OFF)
      expect(
        await page.evaluate((key) => window.localStorage.getItem(key), TIMEZONE_KEY),
        'the browser holds no time zone choice',
      ).toBeNull()
    })

    await test.step('7. Cancel restores every staged value and the clean frame', async () => {
      await page.getByTestId('timezone-select').click()
      await page.getByRole('option', { name: 'UTC', exact: true }).click()
      await expect(page.getByTestId('timezone-select')).toHaveText('UTC')
      await expectDirty(page)

      await headerButton(page, 'Cancel').click()
      await expectCleanFrame(page, level)
      expect(await page.evaluate((key) => window.localStorage.getItem(key), TIMEZONE_KEY)).toBeNull()
    })
  })

  test('both frames hold in the other theme', async ({ page, request }) => {
    const level = await levelInForce(request)
    const staged = otherLevel(level)
    await openGeneral(page)
    const theme = await toggleTheme(page)

    await test.step(`8. ${theme}: the clean frame`, async () => {
      await expectCleanFrame(page, level)
    })

    await test.step(`8. ${theme}: the staged frame, then Cancel`, async () => {
      await stageLevelAndRunOutput(page, staged)
      await expectStagedFrame(page, staged)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await headerButton(page, 'Cancel').click()
      await expectClean(page)
      await expect(page.getByTestId('log-level-select')).toHaveText(level)
    })
  })

  test('a failed first read shows the section error and Try Again loads the page', async ({
    page,
    request,
  }) => {
    const level = await levelInForce(request)
    await failApiRoute(page, LOG_LEVEL_ROUTE, { detail: READ_REASON })
    await page.goto('/settings')

    const tab = generalTab(page)
    const error = tab.getByRole('alert')

    await test.step('9. the heading "Logging" stands alone over the section error', async () => {
      await expect(error.locator('p'), 'the error states exactly the API reason').toHaveText(READ_REASON)
      await expect(error.locator('svg.text-error'), 'the alert icon').toBeVisible()
      await expect(error.getByRole('button')).toHaveText(['Try Again'])

      const heading = tab.getByRole('heading', { level: 2, name: 'Logging', exact: true })
      await expect(tab.getByRole('heading'), 'Logging is the only heading').toHaveText(['Logging'])
      await expect(headerButton(page, 'Cancel')).toHaveCount(0)
      await expect(headerButton(page, 'Save')).toHaveCount(0)
      await expect(tab.getByRole('button'), 'Try Again is the only button').toHaveText(['Try Again'])
      await expect(tab.locator('p'), 'the reason is the only text line').toHaveText([READ_REASON])
      await expect(tab.getByRole('combobox')).toHaveCount(0)
      await expect(tab.getByRole('switch')).toHaveCount(0)

      const headingBox = await boxOf(heading)
      const tabBox = await boxOf(tab)
      const errorBox = await boxOf(error)
      expect(Math.abs(headingBox.x - tabBox.x), 'the heading starts the page').toBeLessThanOrEqual(EDGE_TOLERANCE_PX)
      expect(errorBox.y, 'the section error sits under the heading').toBeGreaterThanOrEqual(
        headingBox.y + headingBox.height,
      )
    })

    await test.step('9. route removed, Try Again loads the clean frame', async () => {
      await page.unroute(LOG_LEVEL_ROUTE)
      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === 'GET' &&
            LOG_LEVEL_ROUTE(new URL(response.url())) &&
            response.status() === 200,
        ),
        error.getByRole('button', { name: 'Try Again', exact: true }).click(),
      ])
      await expect(error).toHaveCount(0)
      await expectCleanFrame(page, level)
    })
  })
})
