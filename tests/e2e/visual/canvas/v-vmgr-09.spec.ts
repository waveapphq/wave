/**
 * V-VMGR-09: Variable Manager Rows - Null Look
 * Design Decisions: VMGR-93 (one null look; a Function output can be null), REQ-3.1.3.24 (the
 * parameter rows holding null are seeded through the API)
 * REQ: REQ-3.1.3.20 (null is the only empty value), REQ-3.1.3.11 (variable watching UI panel)
 *
 * Pass Criteria:
 * 1. The stored Test holds what was seeded: seven whole-null variables, seven empty ones, the text "null",
 *    and a local Function whose input default, output default and local variable are null.
 * 2. Every null_<type> row's value reads exactly `null`, italic, monospace, in Text Muted (FIELD-5),
 *    the same for all seven types; the label "not set" appears nowhere.
 * 3. A null row is not dimmed: effective opacity 1 from its value up; its name has the same color, weight
 *    and opacity as the name on the empty row of the same type.
 * 4. Every empty_<type> row keeps its own text and type color, upright: `[0 items]` amber, `false` orange,
 *    `0` pink (float), `0` violet (integer), `{0 keys}` emerald, blank sky (string), `0×0 table` blue.
 * 5. `text_null`, a string holding the text "null", reads `null` as an ordinary sky string, upright.
 * 6. The Unused badge and the type pill on each null row match its empty twin's (text and classes).
 * 7. Drilled into the Function: PARAMETERS > INPUTS `fn_in` (IN, string), OUTPUTS `fn_out` (OUT,
 *    integer) and VARIABLES `fn_local` (string) each read `null` in the null look, not dimmed, Unused.
 * 8. Screenshots of the null rows, the empty rows and the Function parameter rows are attached.
 */

import {
  test,
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { getTest } from '../../helpers/element-types'
import { expandVariableManager } from '../../helpers/variable-create'
import { digIn } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

const FIXTURE_PATH = path.resolve(__dirname, '../../fixtures/canvas/v-vmgr-09/fixture.json')
const FN_NODE = 'e081b010-e87f-403f-b539-9ceb52e0ed24'
// Tall enough for the fifteen rows to show without scrolling the panel.
const VIEWPORT = { width: 1600, height: 1300 }

const TYPES = ['array', 'boolean', 'float', 'integer', 'map', 'string', 'table'] as const
type VarType = (typeof TYPES)[number]

const EMPTY_ROWS: Record<VarType, { text: string; color: RegExp }> = {
  array: { text: '[0 items]', color: /\btext-amber-/ },
  boolean: { text: 'false', color: /\btext-orange-/ },
  float: { text: '0', color: /\btext-pink-/ },
  integer: { text: '0', color: /\btext-violet-/ },
  map: { text: '{0 keys}', color: /\btext-emerald-/ },
  string: { text: '', color: /\btext-sky-/ },
  table: { text: '0×0 table', color: /\btext-blue-/ },
}

const TYPE_PILL: Record<VarType, RegExp> = {
  array: /\bbg-amber-500/,
  boolean: /\bbg-orange-500/,
  float: /\bbg-pink-500/,
  integer: /\bbg-violet-500/,
  map: /\bbg-emerald-500/,
  string: /\bbg-sky-500/,
  table: /\bbg-blue-500/,
}

const createdTests: string[] = []

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8'))
}

async function openSeededTest(page: Page): Promise<string> {
  await page.setViewportSize(VIEWPORT)
  const testId = await importValidateAndNavigate(page, loadFixture())
  createdTests.push(testId)
  await expandVariableManager(page)
  return testId
}

// ---------------------------------------------------------------------------
// Locators and readers
// ---------------------------------------------------------------------------

const content = (page: Page): Locator => page.locator('[data-testid="variable-manager-content"]')

const rowFor = (page: Page, name: string): Locator =>
  content(page).locator(`[aria-label="Variable ${name}"]`)

const valueOf = (row: Locator): Locator => row.locator('[data-testid^="variable-value-"]')

/** Text Muted, the one gray of null (FIELD-5), as the browser resolves it in the current theme. */
async function mutedForeground(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-text-muted)'
    document.body.appendChild(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  })
}

/** Product of every opacity from the element up to the document root. */
async function effectiveOpacity(element: Locator): Promise<number> {
  return element.evaluate((node) => {
    let product = 1
    for (let current: Element | null = node; current; current = current.parentElement) {
      product *= Number(getComputedStyle(current).opacity)
    }
    return product
  })
}

async function nameLook(row: Locator): Promise<{ color: string; weight: string; opacity: number }> {
  const name = row.locator('[data-testid^="variable-name-"]')
  const style = await name.evaluate((el) => {
    const computed = getComputedStyle(el)
    return { color: computed.color, weight: computed.fontWeight }
  })
  return { ...style, opacity: await effectiveOpacity(name) }
}

async function badgeLook(row: Locator): Promise<{ unused: string | null; pill: string | null }> {
  return {
    unused: await row.locator('[data-testid^="unused-badge-"]').getAttribute('class'),
    pill: await row.locator('[data-testid^="type-badge-"]').getAttribute('class'),
  }
}

/** A row value in the one null look (VMGR-93): `null`, italic mono, muted, at full opacity. */
async function expectNullLook(row: Locator, muted: string): Promise<void> {
  const value = valueOf(row)
  await expect(value).toHaveText('null')
  const nullText = value.locator('span')
  await expect(nullText).toHaveCount(1)
  await expect(nullText).toHaveText('null')
  await expect(nullText).toHaveCSS('font-style', 'italic')
  await expect(nullText).toHaveCSS('font-family', /mono/i)
  await expect(nullText).toHaveCSS('color', muted)
  await expect.poll(() => effectiveOpacity(nullText)).toBe(1)
}

async function attachRowsShot(
  page: Page,
  testInfo: TestInfo,
  first: string,
  last: string,
  name: string,
): Promise<void> {
  await expect(rowFor(page, first)).toBeInViewport({ ratio: 1 })
  await expect(rowFor(page, last)).toBeInViewport({ ratio: 1 })
  const top = (await rowFor(page, first).boundingBox())!
  const bottom = (await rowFor(page, last).boundingBox())!
  const clip = {
    x: top.x,
    y: top.y,
    width: top.width,
    height: bottom.y + bottom.height - top.y,
  }
  await testInfo.attach(name, { body: await page.screenshot({ clip }), contentType: 'image/png' })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('V-VMGR-09: Variable Manager rows in the null look', () => {
  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
    while (createdTests.length > 0) {
      const testId = createdTests.pop()!
      const resp = await request.delete(`${BACKEND_URL}/tests/${testId}`)
      expect(resp.ok(), `DELETE /tests/${testId}: ${resp.status()}`).toBeTruthy()
    }
  })

  test('null rows take the null look beside their empty twins (VMGR-93)', async ({ page }, testInfo) => {
    const testId = await openSeededTest(page)

    await test.step('the stored Test holds the seeded null and empty values', async () => {
      const stored = await getTest(page.request, testId)
      const seeded = loadFixture().variables as Record<string, { value: unknown; type: string }>
      for (const type of TYPES) {
        const nullVar = stored.variables[`null_${type}`]
        expect(nullVar?.type, `null_${type} type`).toBe(type)
        expect(nullVar?.value ?? null, `null_${type} is stored null`).toBeNull()
        const emptyVar = stored.variables[`empty_${type}`]
        expect(emptyVar?.type, `empty_${type} type`).toBe(type)
        expect(emptyVar?.value, `empty_${type} is stored empty`).toEqual(seeded[`empty_${type}`].value)
      }
      expect(stored.variables.text_null?.value).toBe('null')
    })

    const muted = await mutedForeground(page)

    await test.step('every null row reads null in the null look, not dimmed', async () => {
      await expect(rowFor(page, 'null_array')).toBeVisible()
      for (const type of TYPES) {
        await expectNullLook(rowFor(page, `null_${type}`), muted)
      }
      await expect(content(page)).not.toContainText('not set')
    })

    await test.step('a null row name looks like its empty twin name', async () => {
      for (const type of TYPES) {
        const nullName = await nameLook(rowFor(page, `null_${type}`))
        const emptyName = await nameLook(rowFor(page, `empty_${type}`))
        expect(nullName, `null_${type} name look`).toEqual(emptyName)
        expect(nullName.opacity, `null_${type} name opacity`).toBe(1)
      }
    })

    await test.step('every empty row keeps its own text and type color, upright', async () => {
      for (const type of TYPES) {
        const { text, color } = EMPTY_ROWS[type]
        const value = valueOf(rowFor(page, `empty_${type}`))
        await expect(value, `empty_${type} text`).toHaveText(text)
        await expect(value.locator('span'), `empty_${type} has no null text`).toHaveCount(0)
        await expect(value, `empty_${type} type color`).toHaveClass(color)
        await expect(value, `empty_${type} upright`).toHaveCSS('font-style', 'normal')
        expect(
          await value.evaluate((el) => getComputedStyle(el).color),
          `empty_${type} is not drawn in the null color`,
        ).not.toBe(muted)
      }
    })

    await test.step('a string holding the text "null" is an ordinary string', async () => {
      const value = valueOf(rowFor(page, 'text_null'))
      await expect(value).toHaveText('null')
      await expect(value.locator('span')).toHaveCount(0)
      await expect(value).toHaveClass(/\btext-sky-/)
      await expect(value).toHaveCSS('font-style', 'normal')
      expect(await value.evaluate((el) => getComputedStyle(el).color)).not.toBe(muted)
    })

    await test.step('the Unused badge and the type pill match the empty twin', async () => {
      for (const type of TYPES) {
        for (const name of [`null_${type}`, `empty_${type}`]) {
          const row = rowFor(page, name)
          await expect(row.locator('[data-testid^="unused-badge-"]'), `${name} Unused`).toHaveText(
            'Unused',
          )
          const pill = row.locator('[data-testid^="type-badge-"]')
          await expect(pill, `${name} type pill`).toHaveText(type)
          await expect(pill, `${name} type pill color`).toHaveClass(TYPE_PILL[type])
        }
        expect(
          await badgeLook(rowFor(page, `null_${type}`)),
          `null_${type} badges match empty_${type}`,
        ).toEqual(await badgeLook(rowFor(page, `empty_${type}`)))
      }
    })

    await test.step('attach the null and empty columns', async () => {
      await attachRowsShot(page, testInfo, 'null_array', 'null_table', 'null-rows.png')
      await attachRowsShot(page, testInfo, 'empty_array', 'empty_table', 'empty-rows.png')
    })
  })

  test('Function parameter and local rows stored null take the null look (VMGR-93)', async ({
    page,
  }, testInfo) => {
    const testId = await openSeededTest(page)

    await test.step('the stored Function holds a null input default, output default and local', async () => {
      const stored = await getTest(page.request, testId)
      const fnNode = (stored.workflow.nodes as Array<Record<string, any>>).find(
        (node) => node.id === FN_NODE,
      )
      const definition = fnNode?.data.localDefinition
      const input = definition?.inputs.find((p: { name: string }) => p.name === 'fn_in')
      const output = definition?.outputs.find((p: { name: string }) => p.name === 'fn_out')
      const local = definition?.variables.find((v: { name: string }) => v.name === 'fn_local')
      expect(input?.type).toBe('string')
      expect(input?.default ?? null, 'fn_in default is stored null').toBeNull()
      expect(output?.type).toBe('integer')
      expect(output?.default ?? null, 'fn_out default is stored null').toBeNull()
      expect(local?.type).toBe('string')
      expect(local?.value ?? null, 'fn_local is stored null').toBeNull()
    })

    await digIn(page, FN_NODE)
    await expandVariableManager(page)
    const parameters = page.locator('[data-testid="var-group-parameters"]')
    await expect(parameters).toBeVisible()
    const muted = await mutedForeground(page)

    await test.step('fn_in sits under INPUTS, fn_out under OUTPUTS, fn_local under VARIABLES', async () => {
      const inputs = parameters.locator('[data-testid="var-group-sub-inputs"]')
      const outputs = parameters.locator('[data-testid="var-group-sub-outputs"]')
      const fnIn = parameters.locator('[aria-label="Variable fn_in"]')
      const fnOut = parameters.locator('[aria-label="Variable fn_out"]')
      await expect(fnIn).toBeVisible()
      await expect(fnOut).toBeVisible()
      await expect(
        page.locator('[data-testid="var-group-variables"] [aria-label="Variable fn_local"]'),
      ).toBeVisible()
      const tops = await Promise.all(
        [inputs, fnIn, outputs, fnOut].map(async (el) => (await el.boundingBox())!.y),
      )
      expect(tops, 'INPUTS, fn_in, OUTPUTS, fn_out from top to bottom').toEqual(
        [...tops].sort((a, b) => a - b),
      )
    })

    await test.step('each Function row reads null in the null look with its badges', async () => {
      const expected: Array<{ name: string; type: string; flag: 'in' | 'out' | null }> = [
        { name: 'fn_in', type: 'string', flag: 'in' },
        { name: 'fn_out', type: 'integer', flag: 'out' },
        { name: 'fn_local', type: 'string', flag: null },
      ]
      for (const { name, type, flag } of expected) {
        const row = rowFor(page, name)
        await expectNullLook(row, muted)
        await expect(row.locator('[data-testid^="unused-badge-"]'), `${name} Unused`).toHaveText(
          'Unused',
        )
        await expect(row.locator('[data-testid^="type-badge-"]'), `${name} type pill`).toHaveText(
          type,
        )
        await expect(row.locator('[data-testid^="in-badge-"]')).toHaveCount(flag === 'in' ? 1 : 0)
        await expect(row.locator('[data-testid^="out-badge-"]')).toHaveCount(flag === 'out' ? 1 : 0)
        if (flag) {
          await expect(row.locator(`[data-testid^="${flag}-badge-"]`)).toHaveText(flag.toUpperCase())
        }
      }
      await expect(content(page)).not.toContainText('not set')
    })

    await test.step('attach the Function parameter rows', async () => {
      const panel = page.locator('[data-testid="variable-manager"]')
      await testInfo.attach('function-parameter-rows.png', {
        body: await panel.screenshot(),
        contentType: 'image/png',
      })
    })
  })
})
