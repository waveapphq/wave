/**
 * V-PROFILE-SSH-FUNCTIONAL: an SSH Profile drives a real SSH session.
 *
 * The profile's own fields are the only source of the connection: host, port,
 * username, password and connect_timeout are all bound from it, and nothing but
 * host_key_verification (which the ssh profile schema has no field for) is
 * typed into the Block. The workflow runs against the stack's real OpenSSH
 * service and the assertions are on the execution result, not on a Log Block
 * echoing a profile value back.
 *
 * This is also the assertion for the ssh `timeout` (ms) -> `connect_timeout` (s)
 * re-home: the bound value reaches the plugin as the integer 30, which asyncssh
 * spends as thirty SECONDS covering the TCP connect, the handshake and auth.
 *
 * Pass criteria:
 *   1. The fixture validates with zero errors and the run passes.
 *   2. The SSH Session Open Block reports success.
 *   3. connected is True and hop_count is 1 (a direct session really opened).
 *   4. server_banner carries a real OpenSSH version string (SSH-2.0-...).
 *   5. The profile's connect_timeout arrives at the plugin parameter as 30.
 *   6. The profile password never renders in cleartext on any console line.
 *   7. Nothing outlives the run: the imported Test and the profile are gone.
 *
 * REQ: REQ-4.7.4, REQ-4.7.10, REQ-5.1.1, REQ-3.4.1.5
 * Design decisions: K8SPROF-9 (a profile must be proven to drive a plugin)
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/profile-drives-plugin/v-profile-ssh-functional.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogCopyTexts } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { startRun, finishRun, expectNodesSuccess, resolveEnvironmentId } from '../../helpers/k8s-run'
import { expectNoSecret } from '../../helpers/secret-canary'
import {
  BACKEND_URL,
  SSH_TARGET_HOST,
  SSH_MAIN_PORT,
  SSH_STACK_USER,
  SSH_STACK_PASSWORD,
} from '../../helpers/config'
import fs from 'fs'
import path from 'path'

/** The connect budget the profile declares, in seconds (schema default). */
const CONNECT_TIMEOUT_SECONDS = 30

/** Read a profile JSON and fill its deliberately empty fields from the stack
 *  constants - no host, port or credential is ever committed to the file. */
function loadProfile(): Record<string, any> {
  const profile = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'profile-ssh.json'), 'utf-8'),
  ) as Record<string, any>
  profile.config.host = SSH_TARGET_HOST
  profile.config.port = Number(SSH_MAIN_PORT)
  profile.config.username = SSH_STACK_USER
  profile.config.password = SSH_STACK_PASSWORD
  return profile
}

/** Create the profile under a per-run unique name, for the shared E2E environment. */
async function createProfile(
  page: Page,
  environmentId: string,
): Promise<{ id: string; name: string }> {
  const profile = loadProfile()
  profile.name = `${profile.name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  profile.environment_values = { [environmentId]: profile.config }
  const resp = await page.request.post(`${BACKEND_URL}/profiles`, { data: profile })
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `POST /profiles failed: ${resp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  return { id: (body.data?.id ?? body.id) as string, name: profile.name as string }
}

/** The fixture references the profile by placeholder until it is created. */
function loadFixture(profileId: string, profileName: string): Record<string, unknown> {
  const raw = fs
    .readFileSync(path.resolve(__dirname, 'fixture-ssh.json'), 'utf-8')
    .replace(/__SSH_PROFILE_ID__/g, profileId)
    .replace(/__SSH_PROFILE_NAME__/g, profileName)
  return JSON.parse(raw) as Record<string, unknown>
}

/** Open the console and drop its minimum level to DEBUG so the masked
 *  `Inputs:` echo (the resolved plugin parameters) renders. */
async function setConsoleDebug(page: Page): Promise<void> {
  const panel = page.locator('[data-testid="console-panel"]').first()
  if ((await panel.getAttribute('data-state')) === 'collapsed') {
    await page
      .locator('[data-testid="console-panel-header"] button[aria-label="Toggle console"]')
      .click()
  }
  await page.locator('button[aria-label="Minimum log level"]').click()
  await page.getByRole('option', { name: 'DEBUG' }).click()
}


/** A profile only deletes once no Test references it, so the imported Test goes
 *  first. Nothing this suite creates may outlive it on the shared stack. */
async function cleanUp(page: Page, testId: string, profileIds: string[]): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  if (testId) await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
  for (const id of profileIds) {
    await page.request.delete(`${BACKEND_URL}/profiles/${id}`).catch(() => {})
  }
}

/** Whether the shared store still lists a profile under this exact name. */
async function profileExists(page: Page, name: string): Promise<boolean> {
  const resp = await page.request.get(
    `${BACKEND_URL}/profiles?search=${encodeURIComponent(name)}`,
  )
  const body = await resp.json().catch(() => null)
  const rows = (Array.isArray(body) ? body : (body?.data ?? [])) as Array<{ name?: string }>
  return rows.some((p) => p.name === name)
}

/** Positive control for the cleanup sweep: the query really does find a profile
 *  that exists, so the absence check below cannot pass vacuously. */
async function expectProfileListed(page: Page, name: string): Promise<void> {
  expect(await profileExists(page, name), `profile "${name}" was not created`).toBeTruthy()
}

/** Assert the named profile is really gone from the shared store. */
async function expectProfileGone(page: Page, name: string): Promise<void> {
  expect(
    await profileExists(page, name),
    `profile "${name}" outlived its test on the shared stack`,
  ).toBeFalsy()
}

test.describe('V-PROFILE-SSH-FUNCTIONAL', () => {
  test('an ssh profile opens a real session against the stack sshd', async ({ page }) => {
    const environmentId = await resolveEnvironmentId(page.request)
    const profile = await createProfile(page, environmentId)
    await expectProfileListed(page, profile.name)
    let testId = ''

    try {
      testId = await importValidateAndNavigate(page, loadFixture(profile.id, profile.name))
      await setConsoleDebug(page)

      const status = await startRun(page)
      const logs = await finishRun(page, status, 'profile-ssh-e2e-done')
      const all = logs.join('\n')
      const line = (marker: string) => logs.find((t) => t.includes(marker)) ?? ''

      await test.step('the profile-driven session really opened', async () => {
        await expectNodesSuccess(page, ['open-from-profile', 'close-from-profile'])
        expect(line('sshprof connected='), all).toContain('connected=True')
        expect(line('sshprof connected='), all).toContain('hop=1')
      })

      await test.step('the banner is a real OpenSSH server banner', () => {
        expect(line('sshprof connected='), all).toMatch(/banner=SSH-2\.0-OpenSSH_/)
      })

      await test.step('connect_timeout arrives as thirty seconds, not thirty thousand', async () => {
        const copy = await getLogCopyTexts(page)
        const inputs = copy.filter(
          (t) => t.includes('Inputs:') && t.includes('"host_key_verification":'),
        )
        expect(
          // The delimiter after the number rules out 30000.
          inputs.some((t) => new RegExp(`"connect_timeout":${CONNECT_TIMEOUT_SECONDS}[,}]`).test(t)),
          `expected the SSH Open Inputs echo to carry connect_timeout ${CONNECT_TIMEOUT_SECONDS}.\n${copy.join('\n@@\n')}`,
        ).toBeTruthy()
      })

      await test.step('the profile password never renders in cleartext', async () => {
        const copy = await getLogCopyTexts(page)
        expectNoSecret([...logs, ...copy].join('\n'), 'run console', [SSH_STACK_PASSWORD])
      })
    } finally {
      await cleanUp(page, testId, [profile.id])
    }

    await expectProfileGone(page, profile.name)
  })
})
