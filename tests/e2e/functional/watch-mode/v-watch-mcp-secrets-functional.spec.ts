/**
 * V-WATCH-MCP-SECRETS-FUNCTIONAL: secrets in an assistant's watched build or change over the real
 * MCP endpoint.
 * Design Decisions: WATCH-5, WATCH-9
 * REQ: REQ-5.2.7.17, REQ-5.2.7.18
 *
 * Pass Criteria:
 *  1. A watched build whose recipe gives a secret variable a value, taken over mid-build by the tab
 *     that gave way: the build answers taken over and saves nothing; the tab is told it now holds
 *     the session, holds the half-built draft as unsaved and saves it from the New Test window; the
 *     stored secret is the recipe's value (read with reveal_secret), never the mask; neither that
 *     tab nor a tab watching throughout ever got the value in a socket frame or showed it.
 *  2. A watched build and a watched change whose recipe gives the mask for an SSH password the
 *     test does not store are refused before anything streams: the answer names the password
 *     with its exact MASKED_SECRET_VALUE finding and no other error, the tab never shows the
 *     assistant's banner and keeps the session, and nothing is written.
 *
 * Run: ./scripts/e2e/e2e-targeted-local.sh functional/watch-mode/v-watch-mcp-secrets-functional.spec.ts
 */

import { randomUUID } from 'node:crypto'
import type { APIRequestContext, BrowserContext } from '@playwright/test'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL } from '../../helpers/config'
import { cleanUp, storedTest, testIdsNamed } from '../../helpers/fn-block'
import { callTool, callToolAsync, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { SEL, ownershipState, resetOwnership, waitUntilHeld } from '../../helpers/ownership'
import {
  NOT_WATCHED,
  importFixture,
  loadFixture,
  openHolder,
  openWatcher,
  recordView,
  saveAsNewTest,
  uniqueName,
  viewSamples,
  waitForAssistantFrame,
  watchForText,
} from './helpers'

// One MCP port per stack so host-mode parallel workers never collide.
const MCP_PORT = Number(BACKEND_PORT) + 765
const MASK = '********'
const SAVE_BUTTON = '[data-testid="toolbar-save-button"]'
const BUILD_STEPS = 12
const STORED_BLOCKS = ['node-1=Alpha', 'node-2=Bravo', 'node-3=Pause']
const MASKED_PASSWORD = {
  code: 'MASKED_SECRET_VALUE',
  severity: 'error',
  problem: "The value of secret field 'password' in Block 'Open SSH' has to be entered again",
  fix: 'Clear the masked value and type the secret in again',
}

interface Finding {
  step: string
  code: string
  severity: string
  problem: string
  fix: string | null
}

const open: BrowserContext[] = []
const track = (context: BrowserContext): void => {
  open.push(context)
}
const created: string[] = []
const names: string[] = []

async function setTestVariableReveal(page: Page, on: boolean): Promise<void> {
  const resp = await page.request.put(`${BACKEND_URL}/admin/secret-masking`, { data: { test_variables: on } })
  expect(resp.ok(), `PUT /admin/secret-masking failed: ${resp.status()} - ${await resp.text()}`).toBeTruthy()
}

async function storedBlocks(request: APIRequestContext, testId: string): Promise<{ version: unknown; blocks: string[] }> {
  const saved = (await storedTest(request, testId)) as {
    version: unknown
    workflow: { nodes: { id: string; data: { label: string } }[] }
  }
  return { version: saved.version, blocks: saved.workflow.nodes.map((node) => `${node.id}=${node.data.label}`).sort() }
}

/** A build of Logs whose recipe gives a secret variable its value inline. */
function secretBuildRecipe(name: string, secret: string): string {
  const steps = Array.from(
    { length: BUILD_STEPS },
    (_, index) => `  - block: log\n    settings: {message: secret-build-${index + 1}}`,
  )
  return [
    'test:',
    `  name: ${JSON.stringify(name)}`,
    '  description: Watched build with a secret',
    'variables:',
    `  token: {type: string, secret: true, value: ${JSON.stringify(secret)}}`,
    'flow:',
    ...steps,
    '',
  ].join('\n')
}

/** An SSH Session Open whose password is the mask a read shows, after the given steps. */
function maskedPasswordRecipe(name: string, steps: readonly string[]): string {
  return [
    'test:',
    `  name: ${JSON.stringify(name)}`,
    '  description: The mask is not a value',
    'flow:',
    ...steps,
    '  - block: ssh-session-open',
    '    label: Open SSH',
    `    settings: {host: sshd, username: wave, password: ${JSON.stringify(MASK)}}`,
    '',
  ].join('\n')
}

const ALPHA_STEP = ['  - block: log', '    label: Alpha', '    settings: {message: alpha}']
const BRAVO_STEP = ['  - block: log', '    label: Bravo', '    key: bravo', '    settings: {message: bravo}']

/** The watched tool refuses the masked password before it claims: nothing streams into the holding tab. */
async function expectRefusedBeforeStreaming(
  tab: Page,
  request: APIRequestContext,
  holderId: string,
  call: { tool: string; args: Record<string, unknown>; answered: 'built' | 'amended'; step: string },
): Promise<void> {
  const result = await callToolAsync(MCP_PORT, call.tool, call.args)
  expect(result.isError, JSON.stringify(result.payload)).toBe(false)
  expect(result.payload[call.answered], JSON.stringify(result.payload)).toBe(false)
  const findings = (result.payload.findings ?? []) as Finding[]
  expect(
    findings.filter((finding) => finding.severity === 'error'),
    'the masked password is the one refusal',
  ).toEqual([{ step: call.step, ...MASKED_PASSWORD }])

  expect((await ownershipState(request)).holder?.id, 'the tab keeps the session').toBe(holderId)
  await expect(tab.locator(SEL.banner)).toHaveCount(0)
  const samples = await viewSamples(tab)
  expect(
    samples.filter((sample) => sample.watchingMcp),
    `the assistant's banner never showed: ${JSON.stringify(samples)}`,
  ).toEqual([])
}

/** Hold the session in the tab and record what it shows from now on. */
async function holdAndRecord(tab: Page, request: APIRequestContext): Promise<string> {
  const holding = await waitUntilHeld(request)
  expect(holding.kind).toBe('person')
  await recordView(tab)
  await expect.poll(async () => (await viewSamples(tab)).length).toBeGreaterThan(0)
  return holding.id
}

test.describe('V-WATCH-MCP-SECRETS-FUNCTIONAL: secrets in a watched build or change', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    for (const context of open.splice(0)) await context.close().catch(() => {})
    await resetOwnership(request)
    for (const name of names.splice(0)) created.push(...(await testIdsNamed(request, name)))
    await cleanUp(request, created)
    await setTestVariableReveal(page, false)
    await resetMcpSettings(page)
  })

  test('a person who takes over a watched build and saves it stores the recipe\'s secret, and no tab ever shows it', async ({
    browser,
    page,
    request,
  }) => {
    await enableMcpUntilRestart(page, MCP_PORT)
    const secret = `kept-secret-${Date.now()}-${randomUUID().slice(0, 8)}`
    let takerSaw = NOT_WATCHED
    let watcherSaw = NOT_WATCHED
    const taker = await openWatcher(browser, track, async (opened) => {
      takerSaw = await watchForText(opened, secret)
    })
    const gaveWay = await waitUntilHeld(request)
    expect(gaveWay.kind, 'the first tab holds the free session').toBe('person')
    const watcher = await openWatcher(browser, track, async (opened) => {
      watcherSaw = await watchForText(opened, secret)
    })
    await expect(watcher.locator(SEL.bannerPerson)).toBeVisible()

    const name = uniqueName('Watch Build Secret')
    names.push(name)
    const build = callToolAsync(MCP_PORT, 'build_test_from_recipe', { recipe: secretBuildRecipe(name, secret) })

    await test.step('the tab that gave way takes over mid-build', async () => {
      await waitForAssistantFrame(taker, { present: ['node-3'] })
      await taker.locator(SEL.bannerMcp).locator(SEL.takeOver).click()
      const result = await build
      expect(result.isError, JSON.stringify(result.payload)).toBe(false)
      expect(result.payload, 'the build stops for the take-over and saves nothing').toEqual({
        built: false,
        released: 'taken_over',
      })
      expect(await testIdsNamed(request, name), 'the build saved nothing').toEqual([])
    })

    await test.step('it holds the half-built draft as unsaved work and saves it', async () => {
      const told = taker.getByRole('alertdialog', { name: 'You now hold the session' })
      await expect(told).toBeVisible({ timeout: 15_000 })
      await told.getByRole('button').click()
      await expect(told).toHaveCount(0)
      expect((await ownershipState(request)).holder?.id).toBe(gaveWay.id)
      await expect(taker.locator(SEL.banner)).toHaveCount(0)
      await expect(taker.locator(SAVE_BUTTON)).toBeEnabled()
      await saveAsNewTest(taker, name)
    })
    const found = await testIdsNamed(request, name)
    expect(found, 'the person saved one test').toHaveLength(1)

    await test.step('no tab ever got the secret or showed it', async () => {
      await expect(
        watcher.locator('[data-testid="workflow-node-node-3"]'),
        'the watching tab mirrored the build and then the tab that took it over',
      ).toBeVisible()
      for (const [saw, role] of [
        [watcherSaw, 'the watching tab'],
        [takerSaw, 'the tab that took over'],
      ] as const) {
        expect(saw.received(), `no socket frame ${role} got carries the secret`).toBe(false)
        expect(await saw.shown(), `${role} never shows the secret`).toBe(false)
      }
    })

    await test.step('the stored secret is the recipe\'s value, never the mask', async () => {
      for (const context of open.splice(0)) await context.close().catch(() => {})
      await setTestVariableReveal(page, true)
      const revealed = callTool(MCP_PORT, 'reveal_secret', {
        entity_type: 'test',
        ref: found[0],
        secret_name: 'token',
        consent: true,
      })
      expect(revealed.isError, JSON.stringify(revealed.payload)).toBe(false)
      expect(revealed.payload).toEqual({ revealed: true, value: secret })
    })
  })

  test('a watched build that gives the mask for an SSH password is refused before anything streams', async ({
    browser,
    page,
    request,
  }) => {
    await enableMcpUntilRestart(page, MCP_PORT)
    const tab = await openWatcher(browser, track)
    const holderId = await holdAndRecord(tab, request)
    const name = uniqueName('Watch Masked Password')
    names.push(name)

    await expectRefusedBeforeStreaming(tab, request, holderId, {
      tool: 'build_test_from_recipe',
      args: { recipe: maskedPasswordRecipe(name, ALPHA_STEP) },
      answered: 'built',
      step: 'flow[1]',
    })
    expect(await testIdsNamed(request, name), 'nothing is written').toEqual([])
  })

  test('a watched change that gives the mask for an SSH password the test does not store is refused before anything streams', async ({
    browser,
    page,
    request,
  }) => {
    await enableMcpUntilRestart(page, MCP_PORT)
    const testId = await importFixture(request, loadFixture('fixture-change.json'))
    created.push(testId)
    const name = String((await storedTest(request, testId)).name)
    const tab = await openHolder(browser, testId, track)
    const holderId = await holdAndRecord(tab, request)

    await expectRefusedBeforeStreaming(tab, request, holderId, {
      tool: 'amend_test_live_from_recipe',
      args: { test_ref: testId, recipe: maskedPasswordRecipe(name, [...ALPHA_STEP, ...BRAVO_STEP]) },
      answered: 'amended',
      step: 'flow[2]',
    })
    expect(await storedBlocks(request, testId), 'nothing is written').toEqual({
      version: '1.0.0',
      blocks: STORED_BLOCKS,
    })
  })
})
