/**
 * V-K8S-REMOTE-WRITE-SECRETS: a Secret written twice inside a Remote Execution
 * container surfaces in neither of its two forms.
 *
 * One value is minted for the run and planted twice on the SSH host: once
 * through the Apply form's declared credential, and once through a manifest
 * whose stringData reads a secret variable. The manifest carries the value
 * that way on purpose. A manifest is not a declared credential and cannot be,
 * so a literal typed into it would sit in the saved test in cleartext and
 * would be echoed on the block's Inputs line before the run registry has
 * anything to scrub with. A template naming a secret variable is sealed at
 * rest and registered before any Block runs, which is the boundary K8SWRITE-3
 * draws. The form node lists no template field, because listing a declared
 * credential there would unseal it at rest; the run proves both halves.
 *
 * Both Secrets are read back, so the cluster's base64 echo crosses the remote
 * boundary too. The run then sweeps every surface it is recorded on for the
 * plaintext and for its base64 form, plus the admin token and the SSH
 * password: the console, the websocket feed, the session variables, the
 * generated report and the raw store.
 *
 * A sweep alone would pass on a run that wrote nothing, so every surface
 * carries a positive control: the names and counts prove both objects landed,
 * the read-backs prove the cluster holds the keys the form and the template
 * named, the summary line prints all four results, and the mask stands where
 * the value would.
 *
 * The store sweep leaves out the SSH password: other suites in the same shard
 * store it as a literal Block value on purpose, so a hit there would not be
 * this run's leak. It is swept on every other surface.
 *
 * The websocket feed has no replay for a late subscriber, so a Delay Block at
 * the head of the chain holds the run open while the collector subscribes.
 *
 * REQ: REQ-3.4.1.3, REQ-5.1.1, REQ-3.4.1.5, REQ-4.5.5, REQ-4.5.6
 * Design Decisions: K8SWRITE-1, K8SWRITE-2, K8SWRITE-3
 *
 * Pass Criteria:
 *   KR-9  both Secrets land on the cluster from inside the container and read
 *         back carrying the keys the form and the manifest template named, and
 *         the planted value appears nowhere in cleartext and nowhere as its
 *         base64 encoding - not on the console, not in the websocket feed, not
 *         in the session variables, not in the report and not in the store -
 *         while every surface that would have shown it shows the mask; the
 *         admin token and the SSH password never appear in cleartext either
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import {
  expectNoSecret,
  SECRET_ENVELOPE,
  SECRET_MASK,
  sweepStore,
} from '../../helpers/secret-canary'
import { openSessionEventCollector } from '../../helpers/ws-events'
import { fetchSessionReport, finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM, SSH_STACK_PASSWORD } from '../../helpers/config'
import { appliedLine, expectLine } from '../k8s-write/cases-write'
import {
  buildWriteSecretsFixture,
  cell,
  connectedLine,
  expectLocusBadges,
  expectStatuses,
  K8S_DIRECT_URL,
  K8S_VERSION,
  numberOf,
  objectOf,
  textOf,
  WRITE_SECRETS_CANARY_VAR,
  WRITE_SECRETS_DONE_MARKER,
  WRITE_SECRETS_MARKER,
  WRITE_SECRETS_VARS,
  WRITTEN_REMOTE,
  type K8sObject,
  type SessionVariables,
} from './cases-remote'

/** How long the Delay holds the run open while the collector subscribes. */
const HOLD_MS = 3000

test.describe('K8s Secrets written inside a Remote Execution container', () => {
  let run: SeededRun
  /** The planted value in both forms the cluster and the Block handle it in. */
  let canary: string
  let encoded: string

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
    canary = `wave-remote-secret-${run.suffix}`
    encoded = Buffer.from(canary).toString('base64')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('KR-9: a Secret written twice inside the container surfaces in neither form on any surface the run is recorded on', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const v = WRITE_SECRETS_VARS

    /** Everything that must never cross a surface in cleartext. */
    const NEEDLES = [canary, encoded, K8S_ADMIN_TOKEN, SSH_STACK_PASSWORD]
    /** The needles this run minted or declared secret, so a store hit is ours. */
    const STORE_NEEDLES = [canary, encoded, K8S_ADMIN_TOKEN]

    const fixture = buildWriteSecretsFixture({
      suffix: run.suffix,
      namespace: run.namespace,
      caCert: K8S_CA_PEM,
      adminToken: K8S_ADMIN_TOKEN,
      canary,
      holdMs: HOLD_MS,
    })
    await importValidateAndNavigate(page, fixture, { injectSsh: true })
    await expectLocusBadges(page, fixture)

    const status = await startRun(page)
    const sessionId = await getActiveSessionId(page)
    const collector = await openSessionEventCollector(page, sessionId, [
      `log:${sessionId}`,
      `variable:${sessionId}`,
    ])
    const logs = await finishRun(page, status, WRITE_SECRETS_DONE_MARKER, 180_000)
    const all = logs.join('\n')
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    await test.step('both Secrets landed on the cluster and read back', async () => {
      expect(textOf(vars, v.version), `the cluster version.\n${all}`).toBe(K8S_VERSION)
      expectLine(logs, connectedLine(K8S_DIRECT_URL))

      expect(numberOf(vars, v.formCount), `the form Apply count.\n${all}`).toBe(1)
      expect(cell(vars, v.formNames).value, 'the form Apply names').toEqual([
        WRITTEN_REMOTE.secretForm,
      ])
      expect(objectOf(vars, v.formResult).type, 'the Secret type reaches the cluster').toBe(
        'Opaque',
      )
      expect(numberOf(vars, v.formReadCount), `the form read-back count.\n${all}`).toBe(1)
      expect(
        Object.keys(objectOf(vars, v.formRead).data ?? {}),
        'the cluster holds the key the form typed',
      ).toEqual([WRITTEN_REMOTE.secretFormKey])

      expect(numberOf(vars, v.manCount), `the manifest Apply count.\n${all}`).toBe(1)
      expect(cell(vars, v.manNames).value, 'the manifest Apply names').toEqual([
        WRITTEN_REMOTE.secretManifest,
      ])
      const appliedDocuments = cell(vars, v.manResult)
      expect(appliedDocuments.type, 'a manifest Apply binds an array').toBe('array')
      const documents = appliedDocuments.value as K8sObject[]
      expect(documents, 'the manifest holds one document').toHaveLength(1)
      expect(documents[0].type, 'the manifest Secret type reaches the cluster').toBe('Opaque')
      expect(numberOf(vars, v.manReadCount), `the manifest read-back count.\n${all}`).toBe(1)
      // The key is only there if the template resolved, so this is the template's proof.
      expect(
        Object.keys(objectOf(vars, v.manRead).data ?? {}),
        'the cluster holds the key the manifest stringData named',
      ).toEqual([WRITTEN_REMOTE.secretManifestKey])

      expect(
        logs.filter((text) => text === appliedLine(1)).length,
        `both Applies printed their own line.\n${all}`,
      ).toBe(2)
      await expectStatuses(page, fixture, {})
    })

    await test.step('the console carries both results, and the value reads as the mask', () => {
      expectNoSecret(all, 'console log', NEEDLES)
      const summary = logs.find((text) => text.startsWith(WRITE_SECRETS_MARKER)) ?? ''
      expect(summary, `the summary line is missing.\n${all}`).toContain(WRITE_SECRETS_MARKER)
      expect(summary, 'the written value was never printed').toContain(SECRET_MASK)
    })

    await test.step('the websocket feed carries the run and not the value', async () => {
      const events = await collector.harvest()
      await collector.close()
      expect(events.length, 'the WS collector must have captured the run').toBeGreaterThan(0)
      const feed = JSON.stringify(events)
      expect(feed, 'the feed must carry the real run').toContain(WRITE_SECRETS_MARKER)
      expectNoSecret(feed, 'WS stream', NEEDLES)
    })

    await test.step('the session variables mask both written forms and the credentials', () => {
      const results: Array<[string, string]> = [
        [v.formResult, 'the applied form Secret result'],
        [v.manResult, 'the applied manifest Secret result'],
        [v.formRead, 'the form Secret read back'],
        [v.manRead, 'the manifest Secret read back'],
      ]
      for (const [name, where] of results) {
        const stored = JSON.stringify(cell(vars, name).value)
        expectNoSecret(stored, where, NEEDLES)
        expect(stored, `${where} must read as the mask`).toContain(SECRET_MASK)
      }
      expect(cell(vars, WRITE_SECRETS_CANARY_VAR).value, 'the canary variable masks').toBe(
        SECRET_MASK,
      )
      expect(cell(vars, 'k8s_admin_token').value, 'the token variable masks').toBe(SECRET_MASK)
      expect(cell(vars, 'ssh_pwd').value, 'the password variable masks').toBe(SECRET_MASK)
      expect(cell(vars, v.session).value, 'the session output masks').toBe(SECRET_MASK)
      expectNoSecret(JSON.stringify(vars), 'session variables', NEEDLES)
    })

    await test.step('the report carries the run and not the value', async () => {
      const report = await fetchSessionReport(page)
      expect(report, 'the report must carry the real run').toContain(WRITE_SECRETS_MARKER)
      expectNoSecret(report, 'report', NEEDLES)
    })

    await test.step('the store holds neither form nor the admin token; the SSH password is shared across the shard and is not swept here', () => {
      expect(
        sweepStore(SECRET_ENVELOPE).length,
        'the store must hold sealed material from some suite, or this sweep proves nothing',
      ).toBeGreaterThan(0)
      for (const needle of STORE_NEEDLES) {
        expect(sweepStore(needle), `${needle} persisted by the run`).toEqual([])
      }
    })
  })
})
