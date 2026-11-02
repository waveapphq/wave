/**
 * V-NULL-SETTINGS-FUNCTIONAL: a block setting given null fails and names the setting
 * Wireframe: none (functional)
 * Design Decisions: FIELD-13
 * REQ: REQ-3.1.3.21, REQ-3.1.3.23, REQ-3.4.2.2, REQ-3.4.2.3
 *
 * Real stack: sshd, http-echo, kwok direct and kwok through k8s-gateway (reachable only from
 * the SSH host, so those Blocks run in a Remote Execution container), per-run namespace.
 * Test 1 is one run whose null legs each sit in a Try/Catch, so it passes. Test 2 is the
 * gateway null leg: a container cannot sit in a Try/Catch, so that run must fail.
 *
 * Pass Criteria:
 * 1. A Log of a variable that holds null prints `null`; of boolean variables `true` and `false`
 *    (each boolean Log in a Try/Catch, which must not catch anything).
 * 2. SSH Tunnel Open with Local Port given None by an expression fails with
 *    `'local_port' is null`: the Try/Catch binds that exact message for that block, the
 *    catch path runs, the block is failed and no tunnel is bound.
 * 3. The same block with the Local Port expression left blank auto-assigns a port, and a GET
 *    through it reaches the health target behind the SSH host (200, healthy).
 * 4. An HTTP header entry given a variable that holds null is sent with an empty value: the
 *    headers http-echo received carry `x-null: ''` beside `x-set`, nothing is refused and the
 *    catch path of its Try/Catch never runs.
 * 5. An empty header entry and a header expression giving empty text are sent as empty headers:
 *    the headers http-echo received carry `x-empty: ''` and `x-blank: ''` beside `x-set`. A Test
 *    save whose `X-Blank` expression entry is blank is refused `REQUIRED_PARAM_EMPTY`
 *    `'X-Blank' in 'headers' is required` and stores nothing.
 * 6. K8s Get with namespace given None fails with `'namespace' is null`.
 * 7. K8s Get with the namespace left blank reads from the session's namespace (the per-run
 *    namespace): it finds the seeded pod and its read line names that namespace; the same
 *    holds for a Get through k8s-gateway on the SSH host.
 * 8. The run passes; every block outside the two refused ones succeeded.
 * 9. Through k8s-gateway on the SSH host, a K8s Get with namespace given None fails with
 *    `'namespace' is null` before any request: no read line, nothing bound, the Block after it
 *    and the bookend never run, and the run fails.
 * 10. The Log message takes a value of any type: a message expression giving a whole integer
 *    prints `42`, a list holding null `[1,null]` and a map its JSON text
 *    `{"host":"web-1","port":null}`, and each of those Logs succeeds.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import {
  expectConsoleLine,
  formatEntries,
  getLogCopyTexts,
  waitForLogText,
  type LogEntry,
} from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionValue,
  type SessionVariables,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, SEEDED, type SeededRun } from '../../helpers/k8s-seed'
import { readFixture, substitute } from '../../helpers/element-types'
import { deleteTest } from '../file-picker/picker'
import { BACKEND_URL, K8S_ADMIN_TOKEN, K8S_CA_PEM } from '../../helpers/config'
import { blockSource, consoleEntriesFromCopy } from '../shell-blocks/shell-helpers'
import { findingRows, refusedBlockSave } from './null-entry-helpers'

const DONE_MARKER = 'null-settings-done'
const GATEWAY_DONE_MARKER = 'null-gateway-done'

const IDS = {
  logNull: '0c5ec07f-2cba-492f-878e-20128e07b722',
  tcTrue: '0128983d-7dd2-4625-97fa-2ac03632d3f5',
  tcFalse: 'be669769-e03c-4c0c-8332-d4791e9e747e',
  openSession: '82a1324c-5128-4e60-9095-e2685273b76e',
  tcPortNull: '49bf8cde-cf19-4296-8626-e0ff8a615c6a',
  tunnelPortNull: '090bdd7e-2a40-47aa-8f40-957e93b6a193',
  portNullCaught: '4e6f5c45-9d0c-4518-903c-5d1654119a16',
  tunnelBlank: '9b5e13e8-b2fa-47a6-aa28-c37386d9cc6d',
  httpBlank: '681fa7ec-e8bf-4d28-bc1c-3c2ff3728a67',
  tcHeaderNull: '868b9f58-49ac-4db3-a3d3-53ecdae19e05',
  httpHeaderNull: '37dbebcf-3d40-467e-9212-ae2fd576936f',
  headerNullCaught: '6d82370c-3eb8-4bef-af05-c87bdddbc4ba',
  httpEcho: '3fe1263d-7089-49ed-89d8-d76250e2d2f4',
  connectK8s: '68f79073-b29c-453b-a47a-893de2a59f7e',
  tcNamespaceNull: 'b6856b62-24e0-4b4b-bb61-9daa847c95cc',
  getNamespaceNull: 'd8781c48-be0f-4caf-a4b2-e11f56dbb9cc',
  namespaceNullCaught: '2d10736a-efae-410a-817b-3c3241ffbeb1',
  getNamespaceBlank: 'c0d18036-9672-4270-9716-bf09fc8e88dd',
  gatewayContainer: 'c47d2d97-df44-4a8d-8e47-ac7993cfb84a',
  gatewayConnect: 'e6f60f4a-4070-4f18-ab61-74250b1ddb4a',
  gatewayGetBlank: '1caf2247-17c2-432e-8131-18362a19d092',
  closeSession: '94606637-db48-4f61-9444-7c69b84aac8e',
  done: 'fb66bd99-a8c7-40aa-a5c8-96714f183b6d',
} as const

const REFUSED_IDS: readonly string[] = [IDS.tunnelPortNull, IDS.getNamespaceNull]
/** Catch path of the header guard: HTTP Request sends a null header empty, so it never runs. */
const NOT_RUN_IDS: readonly string[] = [IDS.headerNullCaught]

/** The boolean Logs sit in Try/Catch blocks so a refusal cannot stop the run; their catch Logs must not run. */
const BOOLEAN_LOGS = [
  {
    name: 'Print True Variable',
    id: '18165d21-cfd6-4c52-9a2c-075cd31ac2b4',
    caughtId: '51958f38-48ac-4dd2-9724-98049ceb006c',
    errorVar: 'log_true_err',
    caughtLine: 'true-log-caught',
    printed: 'true',
  },
  {
    name: 'Print False Variable',
    id: 'cc39775b-f1cb-445b-a30c-4c9e85ed55cb',
    caughtId: '5521a9e0-11ec-4565-80ca-ecd74abe1e0d',
    errorVar: 'log_false_err',
    caughtLine: 'false-log-caught',
    printed: 'false',
  },
] as const

/** Logs whose message expression gives a whole value of another type (REQ-3.4.2.2). */
const WHOLE_VALUE_LOGS = [
  { name: 'Print Integer Expression', id: '3f012fbe-9fea-4bcf-8331-f8f9a308abfa', printed: '42' },
  { name: 'Print List Expression', id: '2b5aaa7f-a86e-4728-b3ae-bca56e50ae09', printed: '[1,null]' },
  {
    name: 'Print Map Expression',
    id: 'eb075b3c-6c18-44b6-a058-8a152b64039d',
    printed: '{"host":"web-1","port":null}',
  },
] as const

const GATEWAY_NULL_IDS = {
  openSession: '44b6e4f8-cca3-4289-b98d-280aac248bf0',
  container: '14467e7c-c4e0-4976-b17f-50b5be94faf5',
  connect: 'dac5cd8e-a1ef-4c79-994a-8bef673bf0de',
  getNull: 'ead03807-f1e2-47a3-8d0f-ce53a8e47aad',
  getAfter: '508d851e-04c1-4fdd-bb90-44e1e5ce2d3d',
  done: 'fd3752ad-f18f-46e2-9d03-d4881692fa8e',
} as const

/** The exact run-time messages (REQ-3.1.3.21). */
const LOCAL_PORT_NULL = "'local_port' is null"
const BLANK_HEADER = "'X-Blank' in 'headers' is required"
const NAMESPACE_NULL = "'namespace' is null"

type CaughtError = { message?: string; node_id?: string }

function loadFixture(run: SeededRun, file: string): Record<string, unknown> {
  const fixture = substitute(readFixture(__dirname, file), { __NAMESPACE__: run.namespace })
  if (fixture.variables.k8s_ca) fixture.variables.k8s_ca.value = K8S_CA_PEM
  fixture.variables.k8s_admin_token.value = K8S_ADMIN_TOKEN
  return fixture
}

/** The messages one block wrote, in console order. */
function messagesOf(entries: readonly LogEntry[], source: string): string[] {
  return entries.filter((entry) => entry.source === source).map((entry) => entry.message)
}

/** The plugin's read line for the seeded pod read by name in `namespace`. */
function podReadLine(namespace: string): string {
  return `Read 1 Pod object(s) from /api/v1/namespaces/${namespace}/pods/${SEEDED.podLabeled}`
}

async function expectNotSucceeded(page: Page, nodeId: string, why: string): Promise<void> {
  const status = await page
    .locator(`[data-testid="workflow-node-${nodeId}"]`)
    .getAttribute('data-execution-status')
  expect(status, why).not.toBe('success')
}

test.describe('V-NULL-SETTINGS-FUNCTIONAL: block settings refuse null, blank takes the default', () => {
  let run: SeededRun
  const testIds: string[] = []

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    for (const id of testIds) await deleteTest(request, id)
    await run?.teardown()
  })

  test('null fails the Local Port and a namespace, a null header is sent empty; blank ones fall back', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    testIds.push(
      await importValidateAndNavigate(page, loadFixture(run, 'fixture-settings.json'), {
        injectSsh: true,
        injectHttp: true,
      }),
    )

    const status = await startRun(page)
    const logs = await finishRun(page, status, DONE_MARKER, 180_000)
    const all = logs.join('\n')
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const consoleText = formatEntries(entries)
    const vars: SessionVariables = await getSessionVariables(page, await getActiveSessionId(page))
    const caught = (name: string): CaughtError => sessionValue(vars, name) as CaughtError

    /** One refused leg: the exact message bound for the block, its WARN line and its catch path. */
    const expectRefused = (errorVar: string, nodeId: string, message: string, marker: string) => {
      const error = caught(errorVar)
      expect(error.message, `${errorVar} carries the exact refusal.\n${consoleText}`).toBe(message)
      expect(error.node_id, `${errorVar} names the refused block`).toBe(nodeId)
      expectConsoleLine(entries, 'WARN', `Try-path error caught: ${message}`)
      expect(logs.includes(marker), `the catch path ran: "${marker}".\n${all}`).toBeTruthy()
    }

    await test.step('a Log of a null variable prints null', () => {
      expect(sessionValue(vars, 'nothing'), 'the variable the Log prints holds null').toBeNull()
      expect(messagesOf(entries, blockSource('Log', 'Print Null Variable')), consoleText).toEqual([
        'null',
      ])
    })

    await test.step("SSH Tunnel Open: a Local Port given None fails with 'local_port' is null", async () => {
      expectRefused('port_null_err', IDS.tunnelPortNull, LOCAL_PORT_NULL, 'port-null-caught')
      expect(sessionValue(vars, 'tid_port_null'), 'the refused block opened no tunnel').toBeNull()
      expect(sessionValue(vars, 'lport_port_null'), 'the refused block bound no port').toBeNull()
      await expectNodeStatus(page, IDS.tunnelPortNull, 'failed')
    })

    await test.step('SSH Tunnel Open: a blank Local Port auto-assigns a port that carries traffic', async () => {
      const localPort = sessionValue(vars, 'lport_blank') as number
      expect(Number.isInteger(localPort), `an integer port was bound, got ${localPort}`).toBeTruthy()
      expect(localPort, 'a blank Local Port takes the default 0 and auto-assigns').toBeGreaterThan(0)
      expect(String(sessionValue(vars, 'tid_blank'))).toMatch(/^tunnel_\w+$/)
      expect(sessionValue(vars, 'status_blank'), 'the GET through the tunnel').toBe(200)
      expect(String(sessionValue(vars, 'body_blank'))).toContain('"healthy"')
      await expectNodeStatus(page, IDS.tunnelBlank, 'success')
    })

    await test.step('HTTP: a header entry given null is sent with an empty value', async () => {
      expect(sessionValue(vars, 'hdr_null_err'), 'nothing was refused').toBeNull()
      expect(logs.includes('header-null-caught'), `the catch path must not run.\n${all}`).toBeFalsy()
      expect(sessionValue(vars, 'hdr_null_status'), 'http-echo answered').toBe(200)
      const echoed = JSON.parse(String(sessionValue(vars, 'hdr_null_body'))) as {
        headers: Record<string, string>
      }
      expect(echoed.headers['x-set'], 'the control header reached http-echo').toBe('set-value')
      expect(echoed.headers, 'the null header was sent empty').toHaveProperty('x-null', '')
      await expectNodeStatus(page, IDS.httpHeaderNull, 'success')
    })

    await test.step('HTTP: an empty header and a header expression giving empty text are sent empty', () => {
      expect(sessionValue(vars, 'echo_status'), 'http-echo answered').toBe(200)
      const echoed = JSON.parse(String(sessionValue(vars, 'echo_body'))) as {
        headers: Record<string, string>
      }
      expect(echoed.headers['x-set'], 'the control header reached http-echo').toBe('set-value')
      expect(echoed.headers, 'the empty header reached http-echo').toHaveProperty('x-empty', '')
      expect(echoed.headers, 'the header expression giving empty text was sent empty').toHaveProperty(
        'x-blank',
        '',
      )
    })

    await test.step("HTTP: a save whose X-Blank expression entry is blank is refused naming the entry", async () => {
      const findings = await refusedBlockSave(request, testIds[0], IDS.httpEcho, (data) => {
        data.config.values.headers['X-Blank'] = ''
      })
      expect(findingRows(findings)).toEqual([['REQUIRED_PARAM_EMPTY', BLANK_HEADER, IDS.httpEcho]])
    })

    await test.step("K8s Get: a namespace given None fails with 'namespace' is null", async () => {
      expectRefused('ns_null_err', IDS.getNamespaceNull, NAMESPACE_NULL, 'namespace-null-caught')
      expect(sessionValue(vars, 'ns_null_names'), 'the refused read bound nothing').toBeNull()
      await expectNodeStatus(page, IDS.getNamespaceNull, 'failed')
    })

    await test.step("K8s Get: a blank namespace reads from the session's namespace", async () => {
      expect(sessionValue(vars, 'ns_blank_names')).toEqual([SEEDED.podLabeled])
      expect(Number(sessionValue(vars, 'ns_blank_count'))).toBe(1)
      const readLine = podReadLine(run.namespace)
      expect(logs.includes(readLine), `the read names the session namespace: ${readLine}\n${all}`).toBeTruthy()
      await expectNodeStatus(page, IDS.getNamespaceBlank, 'success')
    })

    await test.step("K8s Get through k8s-gateway on the SSH host: a blank namespace reads from the session's", async () => {
      expect(sessionValue(vars, 'gw_blank_names')).toEqual([SEEDED.podLabeled])
      expect(Number(sessionValue(vars, 'gw_blank_count'))).toBe(1)
      const readLine = podReadLine(run.namespace)
      expect(
        logs.filter((line) => line === readLine).length,
        `the direct read and the gateway read each name the session namespace: ${readLine}\n${all}`,
      ).toBe(2)
      await expectNodeStatus(page, IDS.gatewayGetBlank, 'success')
    })

    await test.step('every block outside the refused ones succeeded', async () => {
      const passing = Object.values(IDS).filter((id) => !REFUSED_IDS.includes(id) && !NOT_RUN_IDS.includes(id))
      for (const id of passing) await expectNodeStatus(page, id, 'success')
      for (const id of NOT_RUN_IDS) await expectNotSucceeded(page, id, 'the header catch Log must not run')
    })

    await test.step('a Log of a boolean variable prints true and false', async () => {
      for (const leg of BOOLEAN_LOGS) {
        expect(
          sessionValue(vars, leg.errorVar),
          `the Log of a boolean variable is not refused (${leg.name})`,
        ).toBeNull()
        expect(messagesOf(entries, blockSource('Log', leg.name)), consoleText).toEqual([leg.printed])
        expect(logs.includes(leg.caughtLine), `the catch path of ${leg.name} must not run`).toBeFalsy()
        await expectNotSucceeded(page, leg.caughtId, `the catch Log of ${leg.name} must not run`)
        await expectNodeStatus(page, leg.id, 'success')
      }
    })

    await test.step('a Log of a whole integer, list or map prints it in the print form', async () => {
      for (const leg of WHOLE_VALUE_LOGS) {
        expect(messagesOf(entries, blockSource('Log', leg.name)), consoleText).toEqual([leg.printed])
        await expectNodeStatus(page, leg.id, 'success')
      }
    })
  })

  test("through k8s-gateway on the SSH host, a namespace given None fails before any request", async ({
    page,
  }) => {
    test.setTimeout(180_000)
    testIds.push(
      await importValidateAndNavigate(page, loadFixture(run, 'fixture-settings-gateway-null.json'), {
        injectSsh: true,
      }),
    )

    const failedLine = `Block 'Gateway Get Null Namespace' failed: ${NAMESPACE_NULL}`
    const status = await startRun(page)
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 120_000 })
    const logs = await waitForLogText(page, failedLine, 30_000)
    const all = logs.join('\n')
    const entries = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const vars: SessionVariables = await getSessionVariables(page, await getActiveSessionId(page))

    await test.step("the Get fails with exactly 'namespace' is null at ERROR level", () => {
      const refusals = entries.filter((entry) => entry.message === failedLine)
      expect(refusals.length, `exactly one failure line.\n${formatEntries(entries)}`).toBe(1)
      expect(refusals[0].level, 'the refusal is reported at ERROR level').toBe('ERROR')
    })

    await test.step('no request was sent and nothing after the refused Get ran', async () => {
      expect(
        logs.some((line) => line.startsWith('Read ')),
        `no read may run once the namespace was refused.\n${all}`,
      ).toBeFalsy()
      expect(sessionValue(vars, 'gw_null_names'), 'the refused Get bound nothing').toBeNull()
      expect(sessionValue(vars, 'gw_after_names'), 'the Get after it never ran').toBeNull()
      expect(logs.includes(GATEWAY_DONE_MARKER), `the then branch must not run.\n${all}`).toBeFalsy()
      await expectNotSucceeded(page, GATEWAY_NULL_IDS.getAfter, 'the Get after the refusal must not run')
      await expectNotSucceeded(page, GATEWAY_NULL_IDS.done, 'the bookend must not run')
    })

    await test.step('the canvas reads the failure on the Get and the container, and the run failed', async () => {
      await expectNodeStatus(page, GATEWAY_NULL_IDS.openSession, 'success')
      await expectNodeStatus(page, GATEWAY_NULL_IDS.connect, 'success')
      await expectNodeStatus(page, GATEWAY_NULL_IDS.getNull, 'failed')
      await expectNodeStatus(page, GATEWAY_NULL_IDS.container, 'failed')
      await expect(status).toHaveAttribute('data-status', 'failed')
    })
  })
})
