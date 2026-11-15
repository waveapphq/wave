/** The suite's page files and the check that a page opened inline cannot read WAVE (see README.md). */

import fs from 'fs'
import path from 'path'
import { expect, type Page } from '../../helpers/playwright-fixtures'

/** Each page the fixture writes and the type its download carries. */
export const PAGE_ARTIFACTS = [
  { path: 'page.html', type: 'text/html' },
  { path: 'drawing.svg', type: 'image/svg+xml' },
] as const

interface FixtureNode {
  data: { config: { values: { path?: string; content?: string } } }
}

export function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'),
  ) as Record<string, unknown>
}

/** The text the fixture's File I/O block writes to artifact://<name>. */
export function pageContent(fixture: Record<string, unknown>, name: string): string {
  const nodes = (fixture.workflow as { nodes: FixtureNode[] }).nodes
  const values = nodes.find((node) => node.data.config.values.path === `artifact://${name}`)
    ?.data.config.values
  if (!values?.content) {
    throw new Error(`fixture.json writes no artifact://${name}`)
  }
  return values.content
}

/** Open the page in the browser: its script must run, and its read of WAVE's API must be refused. */
export async function expectReadBlocked(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url)
  await expect
    .poll(() => page.evaluate(() => document.getElementById('verdict')?.textContent), {
      timeout: 10_000,
      message: `the script in ${name} must run and its read of WAVE's API must be refused`,
    })
    .toBe('blocked')
}
