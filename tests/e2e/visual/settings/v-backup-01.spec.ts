/**
 * V-BACKUP-01: Backup & Restore - Create and Periodic Sections
 *
 * Phase: no-data (parallel). The schedule frame (P7-P9)
 * draws the fresh-install schedule over the real read and stages only: a PUT is refused by the spec.
 * Design Decisions: SETTINGS-1 through SETTINGS-16 (existing settings page), SETTINGS-18, SETTINGS-21,
 *   BACKUP-1
 * REQ: selective backup, full backup, periodic backup; REQ-4.7.16, REQ-4.7.20
 *
 * Main Purpose: Verify the Create Backup and Periodic Backup sections
 * render correctly in the Settings page Backup tab.
 *
 * Pass Criteria - Navigation (N1-N3):
 * 1. Backup nav item visible in settings navigation
 * 2. Seven total navigation sections (General, Environments, Variables, MCP Server, WAVE Server, Backup, About) plus the Network group toggle
 * 3. Navigating to /settings/backup shows backup tab content
 *
 * Pass Criteria - Tab Structure (T1-T2):
 * 4. Three sections visible: Create Backup, Restore from Backup, Periodic Backup
 * 5. Sections separated by dividers
 *
 * Pass Criteria - Create Backup Section (C1-C12):
 * 6. Part list (BACKUP-1): nine parts, none disabled, in three columns and three rows: Tests,
 *    Environments, Profiles / Suites, Regressions, Functions / System Variables, SSH Hosts,
 *    Additional Certificates. The Create Backup and Periodic Backup lists hold no other entry
 *    and never the text "Not implemented". The list holds in the other theme.
 * 7. Select all / Deselect all links tick and untick all nine parts
 * 8. Format dropdown with YAML and JSON options
 * 9. Compression method dropdown with 4 options
 * 10. Compression level slider (1-9)
 * 11. Compression level disabled for Stored method
 * 12. Compression level disabled for LZMA method
 * 13. Secret values picker sits after Compression Level; Decrypt shows the backup warning
 * 14. Create & Download button disabled when no entities selected
 * 15. Part names (BACKUP-1): with both lists showing, a click on the name of Tests or Functions
 *     ticks or unticks that part's box in the list the name sits in and changes nothing in the
 *     other list. No id under the page's main content is held by more than one element.
 *
 * Pass Criteria - Periodic Backup Section (P1-P6):
 * 16. Enable toggle visible (disabled by default)
 * 17. Periodic controls hidden when disabled
 * 18. Toggling on reveals cron input and settings; the heading line's Save is the only save
 *     button (no "Save Schedule" under the fields)
 * 19. Cron input shows description for valid expression
 * 20. Cron input shows error for invalid expression
 * 21. Max backups and save directory inputs visible when enabled; Max Backups to Keep is a text box
 *     (`type="text"`, `inputmode="numeric"`) with no spinner arrows
 *
 * Pass Criteria - Schedule frame `backup-schedule` (P7-P9):
 * 22. The drawn schedule has exactly the fields the real GET /api/backup/schedule answers. The
 *     heading line "Periodic Backup" carries Cancel, then Save (disk icon) at its right end, on the
 *     heading's centerline (within 2px); both are disabled and faded (opacity 0.5) while nothing
 *     changed; the description under it reads "Schedule automatic backups at regular intervals."
 * 23. The switch "Enable periodic backups" is staged: switching it on sends no PUT, shows the
 *     fields and enables Cancel and Save. The frame: cron "0 2 * * *" reads "At 02:00", the nine
 *     backup parts checked, YAML, Deflate, Compression Level 6, Mask, Max Backups to Keep 5,
 *     Save Directory "~/wave-backups" with no placeholder and no help line; no "Save Schedule"
 *     button. Cancel switches it off again and disables both buttons.
 * 24. In the other theme (flipped from the sidebar) the heading line, the faded buttons, the
 *     staged switch and the Save Directory value hold.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { apiPathMatcher } from '../../helpers/api-route'
import { toggleTheme } from '../../helpers/theme'

async function waitForSettingsPageLoad(page: Page) {
  await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
  await page.waitForSelector('[data-testid="settings-page"][aria-busy="false"]', {
    state: 'attached',
  })
}

const CENTER_TOLERANCE_PX = 2
const SCHEDULE_DESCRIPTION = 'Schedule automatic backups at regular intervals.'

/** The nine parts of a backup in display order, each with the name it is shown under (BACKUP-1). */
const PARTS = [
  ['tests', 'Tests'],
  ['environments', 'Environments'],
  ['profiles', 'Profiles'],
  ['suites', 'Suites'],
  ['regressions', 'Regressions'],
  ['functions', 'Functions'],
  ['system_variables', 'System Variables'],
  ['ssh_hosts', 'SSH Hosts'],
  ['certificates', 'Additional Certificates'],
] as const
const PART_IDS: string[] = PARTS.map(([id]) => id)
const PART_NAMES: string[] = PARTS.map(([, name]) => name)

/** Ids a backup has no part for; the list draws no entry for them. */
const NON_PART_IDS = ['plugins', 'blocks', 'artifacts', 'reports', 'executions', 'users']

const PART_COLUMNS = 3
const PART_GAP_PX = 12
const PART_TOLERANCE_PX = 0.5

/** The schedule of a fresh install, every field the real read answers. */
const FRESH_SCHEDULE = {
  enabled: false,
  cron: '',
  entity_types: [
    'certificates',
    'environments',
    'functions',
    'profiles',
    'regressions',
    'ssh_hosts',
    'suites',
    'system_variables',
    'tests',
  ],
  max_backups: 5,
  save_directory: '~/wave-backups',
  format: 'yaml',
  compression_method: 'deflate',
  compression_level: 6,
  secrets: 'mask',
  last_run: null,
  last_run_status: null,
  cron_description: '',
  next_run: null,
}

interface ScheduleDraw {
  realFields: string[]
  writes: number
}

/** Draw the fresh-install schedule over the real read; a save never reaches the backend. */
async function drawFreshSchedule(page: Page): Promise<ScheduleDraw> {
  const draw: ScheduleDraw = { realFields: [], writes: 0 }
  await page.route(apiPathMatcher('/api/backup/schedule'), async (route) => {
    const method = route.request().method()
    if (method === 'PUT') {
      draw.writes += 1
      await route.abort()
      return
    }
    if (method !== 'GET') {
      await route.fallback()
      return
    }
    const response = await route.fetch()
    const body = (await response.json()) as { data: Record<string, unknown> }
    draw.realFields = Object.keys(body.data).sort()
    await route.fulfill({ response, json: { ...body, data: FRESH_SCHEDULE } })
  })
  return draw
}

function periodicSection(page: Page): Locator {
  return page.locator('[data-testid="periodic-backup-section"]')
}

function createSection(page: Page): Locator {
  return page.locator('[data-testid="create-backup-section"]')
}

function partList(section: Locator): Locator {
  return section.locator('[data-testid="entity-selector"]')
}

function partCheckboxes(list: Locator): Locator {
  return list.locator('[data-testid^="entity-checkbox-"]')
}

function tickedParts(list: Locator): Locator {
  return list.locator('[data-testid^="entity-checkbox-"][data-state="checked"]')
}

function partBox(list: Locator, id: string): Locator {
  return list.locator(`[data-testid="entity-checkbox-${id}"]`)
}

function partName(list: Locator, id: string): Locator {
  return list.locator(`[data-testid="entity-item-${id}"] label`)
}

function enableSwitch(page: Page): Locator {
  return periodicSection(page).getByRole('switch', { name: 'Enable periodic backups', exact: true })
}

function headingLine(page: Page): Locator {
  return periodicSection(page)
    .getByRole('heading', { name: 'Periodic Backup', exact: true })
    .locator('xpath=..')
}

function headerButton(page: Page, name: 'Cancel' | 'Save'): Locator {
  return headingLine(page).getByRole('button', { name, exact: true })
}

async function openSchedule(page: Page): Promise<void> {
  await page.goto('/settings/backup')
  await waitForSettingsPageLoad(page)
  await expect(enableSwitch(page)).toBeVisible()
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  if (!box) throw new Error('element has no bounding box')
  return box
}

/** Cancel, then Save with its icon, at the right end of the heading line and on its centerline. */
async function expectHeadingLine(page: Page): Promise<void> {
  const heading = periodicSection(page).getByRole('heading', { name: 'Periodic Backup', exact: true })
  const save = headerButton(page, 'Save')
  const lineBox = await boxOf(headingLine(page))
  const headingBox = await boxOf(heading)
  const cancelBox = await boxOf(headerButton(page, 'Cancel'))
  const saveBox = await boxOf(save)
  const centerOf = (box: { y: number; height: number }) => box.y + box.height / 2

  for (const [name, box] of [['Cancel', cancelBox], ['Save', saveBox]] as const) {
    expect(
      Math.abs(centerOf(box) - centerOf(headingBox)),
      `${name} sits on the heading's centerline`,
    ).toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
  }
  expect(headingBox.x + headingBox.width, 'the heading is left of Cancel').toBeLessThanOrEqual(cancelBox.x)
  expect(cancelBox.x + cancelBox.width, 'Cancel comes before Save').toBeLessThanOrEqual(saveBox.x)
  expect(
    Math.abs(saveBox.x + saveBox.width - (lineBox.x + lineBox.width)),
    'Save ends the heading line',
  ).toBeLessThanOrEqual(1)
  await expect(save.locator('svg'), 'Save carries the disk icon').toHaveCount(1)
}

async function expectClean(page: Page): Promise<void> {
  for (const name of ['Cancel', 'Save'] as const) {
    await expect(headerButton(page, name), `${name} is disabled while clean`).toBeDisabled()
    await expect(headerButton(page, name), `${name} is faded while clean`).toHaveCSS('opacity', '0.5')
  }
}

async function expectDirty(page: Page): Promise<void> {
  for (const name of ['Cancel', 'Save'] as const) {
    await expect(headerButton(page, name), `${name} is enabled by a staged change`).toBeEnabled()
    await expect(headerButton(page, name), `${name} is not faded`).toHaveCSS('opacity', '1')
  }
}

/** Save Directory shows the fresh-install folder with no placeholder and no help line. */
async function expectSaveDirectory(page: Page): Promise<void> {
  const section = periodicSection(page)
  const input = section.locator('[data-testid="save-directory-input"]')
  await expect(input).toHaveValue('~/wave-backups')
  await expect(input, 'no placeholder').not.toHaveAttribute('placeholder')
  await expect(
    section.getByText('Save Directory', { exact: true }).locator('xpath=..'),
    'the field holds its label and its input, no help line',
  ).toHaveText('Save Directory')
}

/** Nine enabled entries, drawn alike, in three columns and three rows under the links (BACKUP-1). */
async function expectPartList(section: Locator): Promise<void> {
  const list = partList(section)
  const items = list.locator('[data-testid^="entity-item-"]')
  await expect(items, 'the list holds nine entries').toHaveCount(PARTS.length)
  expect(
    await items.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid'))),
    'the entries come in the display order',
  ).toEqual(PART_IDS.map((id) => `entity-item-${id}`))
  await expect(partCheckboxes(list), 'one checkbox per entry').toHaveCount(PARTS.length)
  await expect(list.locator('label'), 'the names, in order').toHaveText(PART_NAMES, {
    useInnerText: true,
  })

  const headingColor = await section
    .getByRole('heading', { level: 2 })
    .evaluate((heading) => getComputedStyle(heading).color)
  const itemBoxes: Array<{ x: number; y: number; width: number; height: number }> = []
  for (const [id, name] of PARTS) {
    const item = list.locator(`[data-testid="entity-item-${id}"]`)
    const checkbox = item.locator(`[data-testid="entity-checkbox-${id}"]`)
    const label = item.locator('label')
    await expect(checkbox, `${name} is enabled`).toBeEnabled()
    await expect(checkbox, `${name}: the checkbox is not faded`).toHaveCSS('opacity', '1')
    await expect(label, `${name}: the name is not faded`).toHaveCSS('opacity', '1')
    await expect(label, `${name}: the name is not gray`).toHaveCSS('color', headingColor)
    await expect(label, `${name}: 14 px name`).toHaveCSS('font-size', '14px')
    await expect(label, `${name}: medium name`).toHaveCSS('font-weight', '500')
    const checkboxBox = await boxOf(checkbox)
    const labelBox = await boxOf(label)
    expect(checkboxBox.width, `${name}: 16 px checkbox`).toBeCloseTo(16, 0)
    expect(checkboxBox.height, `${name}: 16 px checkbox`).toBeCloseTo(16, 0)
    expect(
      labelBox.x - (checkboxBox.x + checkboxBox.width),
      `${name}: 8 px between the checkbox and the name`,
    ).toBeCloseTo(8, 0)
    itemBoxes.push(await boxOf(item))
  }

  itemBoxes.forEach((box, index) => {
    const columnHead = itemBoxes[index % PART_COLUMNS]
    const rowHead = itemBoxes[index - (index % PART_COLUMNS)]
    expect(
      Math.abs(box.x - columnHead.x),
      `${PART_NAMES[index]} starts at the x of its column`,
    ).toBeLessThanOrEqual(PART_TOLERANCE_PX)
    expect(
      Math.abs(box.y - rowHead.y),
      `${PART_NAMES[index]} starts at the y of its row`,
    ).toBeLessThanOrEqual(PART_TOLERANCE_PX)
  })
  for (const next of [1, 2]) {
    const left = itemBoxes[next - 1]
    const above = itemBoxes[(next - 1) * PART_COLUMNS]
    expect(
      itemBoxes[next].x - (left.x + left.width),
      `column ${next + 1} starts 12 px after column ${next}`,
    ).toBeCloseTo(PART_GAP_PX, 0)
    expect(
      itemBoxes[next * PART_COLUMNS].y - (above.y + above.height),
      `row ${next + 1} starts 12 px under row ${next}`,
    ).toBeCloseTo(PART_GAP_PX, 0)
  }

  const selectAll = await boxOf(list.getByRole('button', { name: 'Select all', exact: true }))
  const deselectAll = await boxOf(list.getByRole('button', { name: 'Deselect all', exact: true }))
  expect(selectAll.x + selectAll.width, 'Select all comes before Deselect all').toBeLessThanOrEqual(
    deselectAll.x,
  )
  for (const link of [selectAll, deselectAll]) {
    expect(link.y + link.height, 'the links sit above the grid').toBeLessThanOrEqual(itemBoxes[0].y)
  }
}

/** The heading line's Save is the only save button of the section. */
async function expectNoSaveScheduleButton(page: Page): Promise<void> {
  await expect(periodicSection(page).getByRole('button', { name: /save/i })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Save Schedule/i })).toHaveCount(0)
}

test.describe('V-BACKUP-01: Navigation', () => {
  test('V-BACKUP-01-N1: Backup nav item visible in settings navigation', async ({ page }) => {
    await page.goto('/settings')
    await waitForSettingsPageLoad(page)

    const backupNav = page.locator('[data-testid="settings-nav-backup"]')
    await expect(backupNav, 'Backup nav item should be visible').toBeVisible()
    await expect(backupNav).toContainText('Backup')
  })

  test('V-BACKUP-01-N2: seven total navigation sections', async ({ page }) => {
    await page.goto('/settings')
    await waitForSettingsPageLoad(page)

    const navItems = page.locator('[data-testid="settings-nav"] button')
    // Seven section entries plus the collapsed Network group's toggle.
    await expect(navItems, 'Should have 7 sections plus the Network toggle').toHaveCount(8)

    // Verify all sections exist
    await expect(page.locator('[data-testid="settings-nav-general"]')).toBeVisible()
    await expect(page.locator('[data-testid="settings-nav-environments"]')).toBeVisible()
    await expect(page.locator('[data-testid="settings-nav-variables"]')).toBeVisible()
    await expect(page.locator('[data-testid="settings-nav-mcp"]')).toBeVisible()
    await expect(page.locator('[data-testid="settings-nav-server"]')).toBeVisible()
    await expect(page.locator('[data-testid="settings-nav-backup"]')).toBeVisible()
    await expect(page.locator('[data-testid="settings-nav-about"]')).toBeVisible()
  })

  test('V-BACKUP-01-N3: navigating to /settings/backup shows backup tab', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    const backupTab = page.locator('[data-testid="backup-restore-tab"]')
    await expect(backupTab, 'Backup tab content should be visible').toBeVisible()

    // Backup nav should be active
    const backupNav = page.locator('[data-testid="settings-nav-backup"]')
    await expect(backupNav).toHaveAttribute('aria-current', 'page')
  })
})

test.describe('V-BACKUP-01: Tab Structure', () => {
  test('V-BACKUP-01-T1: three sections visible', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    await expect(
      page.locator('[data-testid="create-backup-section"]'),
      'Create Backup section should be visible'
    ).toBeVisible()

    await expect(
      page.locator('[data-testid="restore-backup-section"]'),
      'Restore from Backup section should be visible'
    ).toBeVisible()

    await expect(
      page.locator('[data-testid="periodic-backup-section"]'),
      'Periodic Backup section should be visible'
    ).toBeVisible()
  })

  test('V-BACKUP-01-T2: sections have headings and descriptions', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    // Create Backup heading
    const createSection = page.locator('[data-testid="create-backup-section"]')
    await expect(createSection.getByRole('heading', { name: 'Create Backup' })).toBeVisible()
    await expect(createSection).toContainText('Select entity types')

    // Restore heading
    const restoreSection = page.locator('[data-testid="restore-backup-section"]')
    await expect(restoreSection.getByRole('heading', { name: 'Restore from Backup' })).toBeVisible()
    await expect(restoreSection).toContainText('Upload a backup archive')

    // Periodic heading
    const periodicSection = page.locator('[data-testid="periodic-backup-section"]')
    await expect(periodicSection.getByRole('heading', { name: 'Periodic Backup' })).toBeVisible()
    await expect(periodicSection).toContainText('Schedule automatic backups')
  })
})

test.describe('V-BACKUP-01: Create Backup Section', () => {
  test('V-BACKUP-01-C1: the part list holds nine enabled parts in three columns and three rows (BACKUP-1)', async ({
    page,
  }) => {
    await drawFreshSchedule(page)
    await openSchedule(page)

    await test.step('Create Backup', async () => {
      await expectPartList(createSection(page))
    })

    await test.step('Periodic Backup', async () => {
      await enableSwitch(page).click()
      await expectPartList(periodicSection(page))
    })
  })

  test('V-BACKUP-01-C2: no entry for a part a backup does not hold and no "Not implemented" text in either list (BACKUP-1)', async ({
    page,
  }) => {
    await drawFreshSchedule(page)
    await openSchedule(page)
    await enableSwitch(page).click()

    for (const [name, section] of [
      ['Create Backup', createSection(page)],
      ['Periodic Backup', periodicSection(page)],
    ] as const) {
      const list = partList(section)
      await expect(list.locator('label'), `${name} names the nine parts only`).toHaveText(
        PART_NAMES,
        { useInnerText: true },
      )
      for (const id of NON_PART_IDS) {
        await expect(
          list.locator(`[data-testid="entity-item-${id}"]`),
          `${name} has no entry for ${id}`,
        ).toHaveCount(0)
        await expect(
          list.locator(`[data-testid="entity-checkbox-${id}"]`),
          `${name} has no checkbox for ${id}`,
        ).toHaveCount(0)
      }
      await expect(list, `${name} never reads "Not implemented"`).not.toContainText(
        /not implemented/i,
      )
    }
  })

  test('V-BACKUP-01-C3: Select all ticks all nine parts and Deselect all unticks them (BACKUP-1)', async ({
    page,
  }) => {
    // The create request is refused after it is read, so no archive is written.
    const sent: { parts: string[] | null } = { parts: null }
    await page.route(apiPathMatcher('/api/backup/create'), async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback()
        return
      }
      sent.parts = (route.request().postDataJSON() as { entity_types: string[] }).entity_types
      await route.abort()
    })
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    const section = createSection(page)
    const list = partList(section)
    const createButton = section.getByRole('button', { name: 'Create & Download', exact: true })

    await test.step('Nothing is ticked at the start', async () => {
      await expect(partCheckboxes(list)).toHaveCount(PARTS.length)
      await expect(tickedParts(list)).toHaveCount(0)
      await expect(createButton).toBeDisabled()
    })

    await test.step('Select all ticks all nine, Functions included', async () => {
      await list.getByRole('button', { name: 'Select all', exact: true }).click()
      for (const [id, name] of PARTS) {
        await expect(
          list.locator(`[data-testid="entity-checkbox-${id}"]`),
          `${name} is ticked after Select all`,
        ).toBeChecked()
      }
      await expect(tickedParts(list)).toHaveCount(PARTS.length)
    })

    await test.step('Create & Download sends the nine parts', async () => {
      await createButton.click()
      await expect
        .poll(() => (sent.parts ? [...sent.parts].sort() : null), {
          message: 'the create request names all nine parts',
        })
        .toEqual([...PART_IDS].sort())
      await expect(createButton, 'the button comes back with the nine still ticked').toBeEnabled()
    })

    await test.step('Deselect all unticks all nine', async () => {
      await list.getByRole('button', { name: 'Deselect all', exact: true }).click()
      for (const [id, name] of PARTS) {
        await expect(
          list.locator(`[data-testid="entity-checkbox-${id}"]`),
          `${name} is unticked after Deselect all`,
        ).not.toBeChecked()
      }
      await expect(tickedParts(list)).toHaveCount(0)
      await expect(createButton, 'nothing ticked, nothing to create').toBeDisabled()
    })
  })

  test('V-BACKUP-01-C4: format dropdown with YAML and JSON', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    const formatSelect = page.locator('[data-testid="format-select"]')
    await expect(formatSelect, 'Format dropdown should be visible').toBeVisible()

    // Default is YAML
    await expect(formatSelect).toContainText('YAML')

    // Open and verify options
    await formatSelect.click()
    await expect(page.getByRole('option', { name: 'YAML' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'JSON' })).toBeVisible()

    // Select JSON
    await page.getByRole('option', { name: 'JSON' }).click()
    await expect(formatSelect).toContainText('JSON')
  })

  test('V-BACKUP-01-C5: compression method dropdown with 4 options', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    const compSelect = page.locator('[data-testid="compression-method-select"]')
    await expect(compSelect, 'Compression dropdown should be visible').toBeVisible()

    // Default is Deflate
    await expect(compSelect).toContainText('Deflate')

    // Open and verify all options
    await compSelect.click()
    await expect(page.getByRole('option', { name: /None.*Stored/i })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Deflate' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Bzip2' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'LZMA' })).toBeVisible()

    // Close dropdown
    await page.keyboard.press('Escape')
  })

  test('V-BACKUP-01-C6: compression level slider visible', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    const slider = page.locator('[data-testid="compression-level-slider"]')
    await expect(slider, 'Compression level slider should be visible').toBeVisible()

    // Default label shows level 6
    const createSection = page.locator('[data-testid="create-backup-section"]')
    await expect(createSection).toContainText('Compression Level: 6')
  })

  test('V-BACKUP-01-C7: compression level disabled for Stored method', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    // Select "None (Stored)" compression
    const compSelect = page.locator('[data-testid="compression-method-select"]')
    await compSelect.click()
    await page.getByRole('option', { name: /None.*Stored/i }).click()

    // Slider should be disabled
    const slider = page.locator('[data-testid="compression-level-slider"]')
    await expect(slider, 'Slider should be disabled for Stored method').toHaveAttribute(
      'data-disabled',
      ''
    )
  })

  test('V-BACKUP-01-C8: compression level disabled for LZMA method', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    // Select "LZMA" compression
    const compSelect = page.locator('[data-testid="compression-method-select"]')
    await compSelect.click()
    await page.getByRole('option', { name: 'LZMA' }).click()

    // Slider should be disabled
    const slider = page.locator('[data-testid="compression-level-slider"]')
    await expect(slider, 'Slider should be disabled for LZMA method').toHaveAttribute(
      'data-disabled',
      ''
    )
  })

  test('V-BACKUP-01-C9: secret values picker after compression; Decrypt shows backup warning', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    const createSection = page.locator('[data-testid="create-backup-section"]')

    // No Include-credentials toggle.
    await expect(
      createSection.locator('[data-testid="include-credentials-toggle"]'),
      'legacy include-credentials toggle removed'
    ).toHaveCount(0)

    // Secret values picker present with Mask default.
    const picker = createSection.locator('[data-testid="secrets-mode-picker"]')
    await expect(picker, 'Secret values picker should be visible').toBeVisible()
    await expect(
      createSection.locator('[data-testid="secrets-mode-mask"]'),
      'Mask selected by default'
    ).toHaveAttribute('data-state', 'checked')

    // Picker sits after the Compression Level slider in DOM order.
    const pickerFollowsSlider = await createSection.evaluate((section) => {
      const s = section.querySelector('[data-testid="compression-level-slider"]')
      const p = section.querySelector('[data-testid="secrets-mode-picker"]')
      if (!s || !p) return false
      return Boolean(s.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    expect(pickerFollowsSlider, 'picker follows the compression level slider').toBe(true)

    // No warning until Decrypt is chosen.
    const warning = createSection.locator('[data-testid="secrets-plaintext-warning"]')
    await expect(warning, 'no warning by default').not.toBeVisible()

    // Selecting Decrypt reveals the backup-variant warning copy.
    await createSection.locator('[data-testid="secrets-mode-plaintext"]').click()
    await expect(warning, 'Decrypt reveals the backup warning').toBeVisible()
    await expect(warning).toContainText(
      'Secrets will be written in plain text. Handle the backup file securely.'
    )
  })

  test('V-BACKUP-01-C10: Create & Download button disabled when no entities selected', async ({
    page,
  }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    // No entities selected by default
    const createButton = page.getByRole('button', { name: /Create & Download/i })
    await expect(createButton, 'Button should be visible').toBeVisible()
    await expect(
      createButton,
      'Button should be disabled when no entities selected'
    ).toBeDisabled()

    // Select an entity
    const createSection = page.locator('[data-testid="create-backup-section"]')
    await createSection.locator('[data-testid="entity-checkbox-tests"]').click()

    // Button should now be enabled
    await expect(
      createButton,
      'Button should be enabled when entities are selected'
    ).toBeEnabled()
  })

  test('V-BACKUP-01-C11: the part list holds in the other theme (BACKUP-1)', async ({ page }) => {
    await drawFreshSchedule(page)
    await openSchedule(page)
    const theme = await toggleTheme(page)

    await test.step(`${theme}: Create Backup`, async () => {
      await expectPartList(createSection(page))
      await expect(partList(createSection(page))).not.toContainText(/not implemented/i)
    })

    await test.step(`${theme}: Periodic Backup`, async () => {
      await enableSwitch(page).click()
      await expectPartList(periodicSection(page))
      await expect(partList(periodicSection(page))).not.toContainText(/not implemented/i)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    })
  })

  test('V-BACKUP-01-C12: a click on a part name changes that part in its own list only, and no id is held by two elements (BACKUP-1)', async ({
    page,
  }) => {
    await drawFreshSchedule(page)
    await openSchedule(page)
    await enableSwitch(page).click()

    const create = partList(createSection(page))
    const periodic = partList(periodicSection(page))
    const ticked = { create: 0, periodic: PARTS.length }
    await expect(tickedParts(create), 'Create Backup starts with nothing ticked').toHaveCount(ticked.create)
    await expect(tickedParts(periodic), 'Periodic Backup starts with all nine ticked').toHaveCount(
      ticked.periodic,
    )

    await test.step('No id is held by more than one element', async () => {
      const ids = await page.locator('main [id]').evaluateAll((nodes) => nodes.map((node) => node.id))
      const shared = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort()
      // Soft: the name clicks below still run and report beside a shared id.
      expect
        .soft(ids.length, `ids held by more than one element: ${shared.join(', ')}`)
        .toBe(new Set(ids).size)
    })

    for (const [id, name] of PARTS.filter(([part]) => part === 'tests' || part === 'functions')) {
      await test.step(`${name}: its name in Periodic Backup unticks the Periodic box only`, async () => {
        await partName(periodic, id).click()
        ticked.periodic -= 1
        await expect(partBox(periodic, id), `${name} is unticked in Periodic Backup`).not.toBeChecked()
        await expect(partBox(create, id), `${name} stays unticked in Create Backup`).not.toBeChecked()
        await expect(tickedParts(periodic), 'one part fewer in Periodic Backup').toHaveCount(
          ticked.periodic,
        )
        await expect(tickedParts(create), 'Create Backup is as it was').toHaveCount(ticked.create)
      })

      await test.step(`${name}: its name in Create Backup ticks the Create box only`, async () => {
        await partName(create, id).click()
        ticked.create += 1
        await expect(partBox(create, id), `${name} is ticked in Create Backup`).toBeChecked()
        await expect(partBox(periodic, id), `${name} stays unticked in Periodic Backup`).not.toBeChecked()
        await expect(tickedParts(create), 'one part more in Create Backup').toHaveCount(ticked.create)
        await expect(tickedParts(periodic), 'Periodic Backup is as it was').toHaveCount(
          ticked.periodic,
        )
      })
    }
  })
})

test.describe('V-BACKUP-01: Periodic Backup Section', () => {
  test('V-BACKUP-01-P1: enable toggle visible and disabled by default', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    const periodicSection = page.locator('[data-testid="periodic-backup-section"]')
    const enableToggle = periodicSection.locator('[data-testid="periodic-enable-toggle"]')
    await expect(enableToggle, 'Enable toggle should be visible').toBeVisible()

    // Should not be checked by default
    await expect(
      enableToggle,
      'Toggle should be off by default'
    ).not.toBeChecked()
  })

  test('V-BACKUP-01-P2: periodic controls hidden when disabled', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    // Cron input should not be visible when toggle is off
    const cronInput = page.locator('[data-testid="cron-input"]')
    await expect(cronInput, 'Cron input should not be visible when disabled').not.toBeVisible()

    // Max backups and save directory should not be visible
    const maxBackups = page.locator('[data-testid="max-backups-input"]')
    await expect(maxBackups, 'Max backups should not be visible when disabled').not.toBeVisible()
  })

  test('V-BACKUP-01-P3: toggling on reveals cron input and settings', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    // Enable periodic backups
    const enableToggle = page.locator('[data-testid="periodic-enable-toggle"]')
    await enableToggle.click()

    // Cron input should now be visible
    const cronInput = page.locator('[data-testid="cron-input"]')
    await expect(cronInput, 'Cron input should be visible after enabling').toBeVisible()
    await expect(cronInput).toHaveAttribute('placeholder', '0 2 * * *')

    // Entity selector should be visible
    const periodicSection = page.locator('[data-testid="periodic-backup-section"]')
    const entitySelector = periodicSection.locator('[data-testid="entity-selector"]')
    await expect(entitySelector, 'Entity selector should be visible').toBeVisible()

    // Format and compression controls
    await expect(
      page.locator('[data-testid="periodic-format-select"]'),
      'Format dropdown should be visible'
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="periodic-compression-method-select"]'),
      'Compression dropdown should be visible'
    ).toBeVisible()

    // Max backups and save directory; Max Backups to Keep is a text box with no spinner arrows (REQ-3.1.3.14)
    const maxBackups = page.locator('[data-testid="max-backups-input"]')
    await expect(maxBackups, 'Max backups should be visible').toBeVisible()
    await expect(maxBackups, 'Max backups is a text box, so it draws no spinner').toHaveAttribute('type', 'text')
    await expect(maxBackups, 'Max backups opens a number keyboard').toHaveAttribute('inputmode', 'numeric')
    await expect(
      page.locator('[data-testid="save-directory-input"]'),
      'Save directory should be visible'
    ).toBeVisible()

    // The heading line's Save is the only save button (SETTINGS-21)
    await expectNoSaveScheduleButton(page)
    await expect(headerButton(page, 'Save'), 'Save is enabled by the staged switch').toBeEnabled()
  })

  test('V-BACKUP-01-P4: cron input shows description for valid expression', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    // Enable periodic
    await page.locator('[data-testid="periodic-enable-toggle"]').click()

    // Type a valid cron expression
    const cronInput = page.locator('[data-testid="cron-input"]')
    await cronInput.fill('0 2 * * *')

    // Description should appear
    const description = page.locator('[data-testid="cron-description"]')
    await expect(description, 'Cron description should be visible').toBeVisible()
    await expect(description).toContainText('At 02:00')
  })

  test('V-BACKUP-01-P5: cron input shows error for invalid expression', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    // Enable periodic
    await page.locator('[data-testid="periodic-enable-toggle"]').click()

    // Type an invalid cron expression
    const cronInput = page.locator('[data-testid="cron-input"]')
    await cronInput.fill('invalid cron')

    // Error should appear
    const error = page.locator('[data-testid="cron-error"]')
    await expect(error, 'Cron error should be visible').toBeVisible()
    await expect(error).toContainText('Invalid cron expression')
  })

  test('V-BACKUP-01-P6: periodic secret values picker after compression; Decrypt shows warning', async ({ page }) => {
    await page.goto('/settings/backup')
    await waitForSettingsPageLoad(page)

    // Enable periodic
    await page.locator('[data-testid="periodic-enable-toggle"]').click()

    const periodicSection = page.locator('[data-testid="periodic-backup-section"]')

    // Legacy periodic include-credentials toggle is gone.
    await expect(
      periodicSection.locator('[data-testid="periodic-include-credentials-toggle"]'),
      'legacy periodic include-credentials toggle removed'
    ).toHaveCount(0)

    // Secret values picker present with Mask default.
    const picker = periodicSection.locator('[data-testid="secrets-mode-picker"]')
    await expect(picker, 'Periodic secret values picker should be visible').toBeVisible()
    await expect(
      periodicSection.locator('[data-testid="secrets-mode-mask"]'),
      'Mask selected by default'
    ).toHaveAttribute('data-state', 'checked')

    // Picker sits after the periodic Compression Level slider in DOM order.
    const pickerFollowsSlider = await periodicSection.evaluate((section) => {
      const s = section.querySelector('[data-testid="periodic-compression-level-slider"]')
      const p = section.querySelector('[data-testid="secrets-mode-picker"]')
      if (!s || !p) return false
      return Boolean(s.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    expect(pickerFollowsSlider, 'picker follows the periodic compression level slider').toBe(true)

    // Selecting Decrypt reveals the backup-variant warning copy.
    await periodicSection.locator('[data-testid="secrets-mode-plaintext"]').click()
    const warning = periodicSection.locator('[data-testid="secrets-plaintext-warning"]')
    await expect(warning, 'Decrypt reveals the periodic backup warning').toBeVisible()
    await expect(warning).toContainText(
      'Secrets will be written in plain text. Handle the backup file securely.'
    )
  })
})

test.describe('V-BACKUP-01: Periodic Backup schedule frame', () => {
  test('V-BACKUP-01-P7: Cancel and Save sit on the Periodic Backup heading line, faded while nothing changed', async ({
    page,
  }) => {
    const draw = await drawFreshSchedule(page)
    await openSchedule(page)

    expect(draw.realFields, 'the drawn schedule has the fields the API answers').toEqual(
      Object.keys(FRESH_SCHEDULE).sort(),
    )
    await expectHeadingLine(page)
    await expectClean(page)
    await expect(periodicSection(page).getByText(SCHEDULE_DESCRIPTION, { exact: true })).toBeVisible()
    await expect(enableSwitch(page)).not.toBeChecked()
  })

  test('V-BACKUP-01-P8: the switch is staged and the frame shows the fresh-install schedule, all nine parts ticked (BACKUP-1)', async ({
    page,
  }) => {
    const draw = await drawFreshSchedule(page)
    await openSchedule(page)
    const section = periodicSection(page)

    await test.step('Switching on stages: fields show, Cancel and Save enable, nothing is sent', async () => {
      await enableSwitch(page).click()
      await expect(enableSwitch(page)).toBeChecked()
      await expect(section.locator('[data-testid="cron-input"]')).toBeVisible()
      await expectDirty(page)
      await expectHeadingLine(page)
      expect(draw.writes, 'the switch sends no PUT').toBe(0)
    })

    await test.step('Frame backup-schedule: the fresh-install values', async () => {
      await section.locator('[data-testid="cron-input"]').fill('0 2 * * *')
      await expect(section.locator('[data-testid="cron-description"]')).toHaveText('At 02:00')
      for (const type of FRESH_SCHEDULE.entity_types) {
        await expect(
          section.locator(`[data-testid="entity-checkbox-${type}"]`),
          `${type} is checked`,
        ).toBeChecked()
      }
      await expect(tickedParts(partList(section)), 'all nine parts are ticked').toHaveCount(
        PARTS.length,
      )
      await expect(section.locator('[data-testid="periodic-format-select"]')).toHaveText('YAML')
      await expect(section.locator('[data-testid="periodic-compression-method-select"]')).toHaveText(
        'Deflate',
      )
      await expect(section.getByText('Compression Level: 6', { exact: true })).toBeVisible()
      await expect(section.locator('[data-testid="secrets-mode-mask"]')).toHaveAttribute(
        'data-state',
        'checked',
      )
      await expect(section.locator('[data-testid="max-backups-input"]')).toHaveValue('5')
      await expectSaveDirectory(page)
      await expectNoSaveScheduleButton(page)
    })

    await test.step('Cancel switches it off again and disables both buttons', async () => {
      await headerButton(page, 'Cancel').click()
      await expect(enableSwitch(page)).not.toBeChecked()
      await expect(section.locator('[data-testid="cron-input"]')).toHaveCount(0)
      await expectClean(page)
      expect(draw.writes, 'Cancel sends no PUT').toBe(0)
    })
  })

  test('V-BACKUP-01-P9: the schedule frame holds in the other theme', async ({ page }) => {
    const draw = await drawFreshSchedule(page)
    await openSchedule(page)
    const theme = await toggleTheme(page)

    await test.step(`${theme}: heading line and faded buttons`, async () => {
      await expectHeadingLine(page)
      await expectClean(page)
    })

    await test.step(`${theme}: staged switch and Save Directory`, async () => {
      await enableSwitch(page).click()
      await expectDirty(page)
      await expectHeadingLine(page)
      await expectSaveDirectory(page)
      await expectNoSaveScheduleButton(page)
      expect(draw.writes, 'the switch sends no PUT').toBe(0)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    })
  })
})
