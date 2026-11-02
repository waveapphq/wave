/**
 * V-SECRET-MASKING-FUNCTIONAL: runtime secret masking end-to-end.
 *
 * REQ: REQ-3.1.3.5 / REQ-4.5.3 (secret masking in logs)
 *
 * Imports a fixture whose test declares a secret string (api_token), a
 * secret map (cred_map), and plain variables, then runs it and proves the
 * composed-expression masking model on every runtime surface:
 *
 * Pass Criteria:
 *  1. Composed expression: plain parts readable, ONLY the secret bytes
 *     masked ("Authorization: Bearer ******** host=api.example.local")
 *  2. Direct leak paths: Log of {{ secret }} and of an output variable
 *     holding a response credential header (Set-Cookie) masked in console,
 *     WS stream, and report content
 *  3. Verbatim copy into a plain variable stays masked (pushed value + text)
 *  4. Byte-transform escape: a sliced secret IS visible (deliberate hatch)
 *  5. Per-node secret_masking="reveal": that node's lines show the real value;
 *     every other node's lines stay masked
 *  7. No-cleartext sweep: console, WS log/variable payloads, session
 *     variables read, step-debug (paused) variable view, execution
 *     variables view, report content
 * 10. Full opacity: the secret map displays as bare ******** (no keys,
 *     no shape, no entry counts) and printing the whole map logs a single
 *     ********
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import {
  importValidateAndNavigate,
  getActiveSessionId,
  getSessionVariables,
} from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'
import { openSessionEventCollector } from '../../helpers/ws-events'
import { BACKEND_URL, E2E_ENV_NAME } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

// Planted secrets (must match fixture.json / the http-echo /cookie default).
const RAW_TOKEN = 's3cr3t-Bearer-Tok3n-9917'
const COOKIE_SECRET = 'wave-c00kie-s3cr3t-4417'
const MAP_LEAF_KEY = 'map-k3y-v4lue-8842'
const MAP_LEAF_PASS = 'map-p4ss-v4lue-7731'
const MASK = '********'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'),
  ) as Record<string, unknown>
}

function variableRowValue(page: Page, name: string) {
  return page
    .locator('[data-testid="variable-manager-content"]')
    .locator(`[aria-label="Variable ${name}"]`)
    .locator('[data-testid^="variable-value-"]')
}

async function getEnvironmentId(page: Page): Promise<string> {
  const resp = await page.request.get(`${BACKEND_URL}/environments/`)
  const body = await resp.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const env = envs.find((e: { name: string }) => e.name === E2E_ENV_NAME)
  expect(env, `environment "${E2E_ENV_NAME}" must exist`).toBeTruthy()
  return env.id as string
}

test.describe('V-SECRET-MASKING-FUNCTIONAL', () => {
  test('leak matrix: composed / direct / copy / transform / unmask / map opacity across console, WS, variables, report', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    await importValidateAndNavigate(page, loadFixture(), { injectHttp: true })

    // The backend session exists only once the run starts, and there is no
    // event replay for late subscribers - so the fixture's leading Delay
    // node holds the run while we grab the session id and subscribe.
    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId, [
      `log:${sessionId}`,
      `variable:${sessionId}`,
    ])

    await test.step('Run workflow to passed', async () => {
      await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
      await expect(status).toHaveAttribute('data-status', 'passed')
    })

    let logTexts: string[] = []
    await test.step('Item 1: composed expression masks ONLY the secret bytes', async () => {
      logTexts = await getLogTexts(page)
      const all = logTexts.join('\n')
      expect(
        logTexts.some((t) => t === `Authorization: Bearer ${MASK} host=api.example.local`),
        `Expected composed line "Authorization: Bearer ${MASK} host=api.example.local". Got:\n${all}`,
      ).toBeTruthy()
    })

    await test.step('Items 2+3+10: direct print, verbatim copy, and whole-map print each collapse to ********', async () => {
      const all = logTexts.join('\n')
      // log-direct (api_token), log-copy (leaked_copy), log-map-whole
      // (str(cred_map)) each scrub their whole message to one placeholder.
      const bareMaskLines = logTexts.filter((t) => t === MASK)
      expect(
        bareMaskLines.length,
        `Expected >= 3 bare "${MASK}" lines (direct + copy + whole-map). Got:\n${all}`,
      ).toBeGreaterThanOrEqual(3)
      // The whole-map print must NOT leak shape - no key names, no
      // braces-with-mask forms anywhere in the console.
      expect(all).not.toContain(MAP_LEAF_KEY)
      expect(all).not.toContain(MAP_LEAF_PASS)
      expect(all).not.toContain('api_key\':')
      expect(all).not.toContain('db_password')
    })

    await test.step('Item 2: response credential header masked in the printed output variable', async () => {
      const all = logTexts.join('\n')
      expect(all).not.toContain(COOKIE_SECRET)
      // The headers map itself stays viewable - only the credential bytes mask.
      expect(
        /set-cookie'?: '?\*{8}/i.test(all),
        `Expected the printed headers map to carry Set-Cookie: ${MASK}. Got:\n${all}`,
      ).toBeTruthy()
      expect(
        all.toLowerCase().includes('application/json'),
        `Non-credential headers must stay readable in the printed map. Got:\n${all}`,
      ).toBeTruthy()
    })

    await test.step('Item 4: byte-transformed secret IS visible (deliberate escape hatch)', async () => {
      const all = logTexts.join('\n')
      expect(
        logTexts.some((t) => t === 'transformed=Bearer-Tok3n-9917'),
        `Expected the sliced secret to pass through unmasked. Got:\n${all}`,
      ).toBeTruthy()
    })

    await test.step('Item 5: only the secret_masking="reveal" node prints the real value', async () => {
      const rawLines = logTexts.filter((t) => t.includes(RAW_TOKEN))
      expect(
        rawLines.length,
        `Exactly ONE console line (the unmask node's) may carry the raw token. Got: ${JSON.stringify(rawLines)}`,
      ).toBe(1)
      expect(rawLines[0]).toBe(RAW_TOKEN)
    })

    await test.step('Item 7: WS sweep - no cleartext in any log or variable payload except the unmask node line', async () => {
      const events = await collector.harvest()
      expect(events.length, 'the WS collector must have captured the run').toBeGreaterThan(0)

      for (const evt of events) {
        const json = JSON.stringify(evt)
        if (json.includes(RAW_TOKEN)) {
          // The per-node exemption is the only sanctioned raw path.
          expect(
            (evt as { blockId?: string }).blockId,
            `Only unmask-node log entries may carry the raw token. Offending event: ${json}`,
          ).toBe('log-unmask')
        }
        expect(json, `WS payload leaked the cookie secret: ${json}`).not.toContain(COOKIE_SECRET)
        expect(json, `WS payload leaked a map leaf: ${json}`).not.toContain(MAP_LEAF_KEY)
        expect(json, `WS payload leaked a map leaf: ${json}`).not.toContain(MAP_LEAF_PASS)
      }

      // variable_changed payloads: flagged + verbatim-copy scalars push the
      // bare placeholder; the flagged map pushes a count-0 summary
      // (no keys, no true entry count).
      const varEvents = events.filter((e) => e.type === 'variable_changed')
      const changedFor = (name: string) =>
        varEvents.filter((e) => (e as { path?: string }).path === name)
      for (const name of ['api_token', 'leaked_copy']) {
        for (const evt of changedFor(name)) {
          expect(
            (evt as { value?: unknown }).value,
            `variable_changed for ${name} must be masked`,
          ).toBe(MASK)
        }
      }
      const mapPushes = changedFor('cred_map')
      for (const evt of mapPushes) {
        expect(
          (evt as { value?: { count?: number } }).value?.count,
          `flagged map push must carry count 0, got ${JSON.stringify(evt)}`,
        ).toBe(0)
      }
      await collector.close()
    })

    await test.step('Items 7+10: session variables read masked; secret map is FULLY opaque', async () => {
      const variables = await getSessionVariables(page, sessionId)
      expect(variables.api_token.value).toBe(MASK)
      // Bare placeholder - no keys, no shape, no counts.
      expect(variables.cred_map.value).toBe(MASK)
      expect(variables.leaked_copy.value).toBe(MASK)
      expect(variables.host.value).toBe('api.example.local')

      const json = JSON.stringify(variables)
      for (const secret of [RAW_TOKEN, COOKIE_SECRET, MAP_LEAF_KEY, MAP_LEAF_PASS]) {
        expect(json, `session variables leaked: ${secret}`).not.toContain(secret)
      }
    })

    await test.step('Item 10: variable rows show bare ******** (no entry counts) for the secret map', async () => {
      await expect(variableRowValue(page, 'api_token')).toHaveText(MASK)
      await expect(variableRowValue(page, 'cred_map')).toHaveText(MASK)
      await expect(variableRowValue(page, 'cred_map')).not.toContainText('entries')
      await expect(variableRowValue(page, 'leaked_copy')).toHaveText(MASK)
    })

    await test.step('Items 2+7+10: report content masked (unmask line is the only sanctioned raw occurrence)', async () => {
      const genResp = await page.request.post(`${BACKEND_URL}/workbench/session/report`)
      expect(genResp.status(), await genResp.text()).toBe(200)

      const contentResp = await page.request.get(
        `${BACKEND_URL}/workbench/session/artifacts/content/report.html`,
      )
      expect(contentResp.ok()).toBeTruthy()
      const report = await contentResp.text()

      expect(report).toContain(`Authorization: Bearer ${MASK} host=api.example.local`)
      expect(report).not.toContain(COOKIE_SECRET)
      expect(report).not.toContain(MAP_LEAF_KEY)
      expect(report).not.toContain(MAP_LEAF_PASS)
      // No two-tier masking: the reveal node's lines flow raw into the
      // report; a masked node never leaks the token. Under the engine's uniform
      // I/O logging the reveal node emits three raw lines - its message plus the
      // Inputs/Output echoes, which render raw because that node reveals - and
      // those are the ONLY raw occurrences (every masked node scrubs the token).
      const rawOccurrences = report.split(RAW_TOKEN).length - 1
      expect(
        rawOccurrences,
        `Expected 3 raw-token occurrences (the reveal node's message + Inputs + Output echoes), got ${rawOccurrences}`,
      ).toBe(3)
    })
  })

  test('item 7: execution variables view serves masked values for a tracked run', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const testId = await importValidateAndNavigate(page, loadFixture(), { injectHttp: true })
    const environmentId = await getEnvironmentId(page)

    const startResp = await page.request.post(`${BACKEND_URL}/executions`, {
      data: { type: 'test', id: testId, environment_id: environmentId },
    })
    expect(startResp.ok(), `POST /executions failed: ${await startResp.text()}`).toBeTruthy()
    const executionId = ((await startResp.json()).data ?? {}).id as string
    expect(executionId).toBeTruthy()

    await expect
      .poll(
        async () => {
          const resp = await page.request.get(`${BACKEND_URL}/executions/${executionId}`)
          const data = (await resp.json()).data ?? {}
          return data.status as string
        },
        { timeout: 120_000, intervals: [1000] },
      )
      .toBe('passed')

    const varsResp = await page.request.get(`${BACKEND_URL}/executions/${executionId}/variables`)
    expect(varsResp.ok()).toBeTruthy()
    const body = await varsResp.json()
    const json = JSON.stringify(body)
    for (const secret of [RAW_TOKEN, COOKIE_SECRET, MAP_LEAF_KEY, MAP_LEAF_PASS]) {
      expect(json, `execution variables leaked: ${secret}`).not.toContain(secret)
    }
    // Mask-on-write (I5): flagged values persisted as the bare placeholder.
    expect(json).toContain(MASK)
  })

  test('item 7: step-debug variable view stays masked while paused at a breakpoint', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await importValidateAndNavigate(page, loadFixture(), { injectHttp: true })

    // Breakpoint mid-workflow (after the secret realized + was copied).
    const node = page.locator('[data-testid="workflow-node-log-transform"]')
    await node.click({ button: 'right' })
    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    await menu.getByText('Toggle Breakpoint', { exact: true }).click()
    await expect(menu).not.toBeVisible()

    await selectEnvironment(page)
    await page.locator('[data-testid="debug-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).toHaveAttribute('data-status', 'paused', { timeout: 30_000 })
    const sessionId = await getActiveSessionId(page)

    // Paused variable views: row + session endpoint both masked.
    await expect(variableRowValue(page, 'api_token')).toHaveText(MASK)
    await expect(variableRowValue(page, 'leaked_copy')).toHaveText(MASK)
    const variables = await getSessionVariables(page, sessionId)
    expect(variables.api_token.value).toBe(MASK)
    expect(variables.leaked_copy.value).toBe(MASK)
    expect(JSON.stringify(variables)).not.toContain(RAW_TOKEN)

    // Resume to terminal so the stack is left clean.
    await page.locator('[data-testid="action-continue-button"]').click()
    await expect(status).not.toHaveAttribute('data-status', 'paused', { timeout: 30_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
    await expect(status).toHaveAttribute('data-status', 'passed')
  })
})
