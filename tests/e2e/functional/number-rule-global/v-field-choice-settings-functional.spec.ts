/**
 * V-FIELD-CHOICE-SETTINGS-FUNCTIONAL: SSH Session Open takes its host key action from Settings when it is made
 * Design Decisions: FIELD-8, SSH-12
 * REQ: REQ-3.1.1.5, REQ-4.5.14
 *
 * Changes the stack-wide default host key action, so it lives in the destructive project; the network settings
 * are reset to the stack's own before and after. Fixtures: `fixture-choice-settings.json` (Start and a Log
 * `Anchor`) and `fixture-choice-settings-run.json` (an SSH Session Open to the untrusted `sshd-no-sftp` port, a Log,
 * a Close and a bookend Log; its host key action is set from a placed Block). Every Test is `zz-11541-s10-*` and
 * deleted.
 *
 * Pass Criteria:
 * 1. With the Settings default Disabled, a dropped SSH Session Open is stored with `host_key_verification: disabled`.
 * 2. After the default changes to Strict (and the app reads the policy again), the Block placed before keeps
 *    `disabled` in its window and in storage, a duplicate of it copies `disabled`, and a newly dropped Block holds
 *    `strict`.
 * 3. Recipe compile under the Strict default writes `host_key_verification: strict` and the readback says so.
 * 4. On `sshd`, the value a Block holds is the one the run uses: `strict` to an untrusted host fails with the strict
 *    refusal and never connects; `disabled` connects and the run passes.
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL, SSH_NO_SFTP_PORT, SSH_TARGET_HOST, ensureEnvironment } from '../../helpers/config'
import { clickNodeKebabItem } from '../../helpers/canvas'
import { readFixture, runToken } from '../../helpers/element-types'
import { importFixtureTest } from '../../helpers/fixture-import'
import { runTrackedTest } from '../../helpers/k8s-run'
import { deleteSeededTest, openGroup } from '../../helpers/list-fields'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetNetworkSettings } from '../../helpers/network-settings'
import { resetOwnership } from '../../helpers/ownership'
import { saveTest } from '../../helpers/workbench'
import {
  addsOneBlock,
  choiceTrigger,
  setHostKeyDefault,
  storedNodes,
  storedValues,
  type HostKeyAction,
} from '../../helpers/choice-tls'
import { disableBlock, dropBelow, openConfig, openLaneCanvas } from '../canvas-lanes/lanes-helpers'

const MCP_PORT = Number(BACKEND_PORT) + 765
const ANCHOR = '2d829f11-78e6-4dd4-aeae-5eb8a1a44ce7'
const RUN_OPEN = 'c157caa5-83fd-416c-9a7b-3f38a88177b3'
const SSH_SESSION_OPEN = { term: 'SSH Session Open', testId: 'palette-item-ssh-session-open' }
const UNTRUSTED_PORT = Number(SSH_NO_SFTP_PORT)

const STRICT_REFUSAL =
  `SSH host key verification failed for ${SSH_TARGET_HOST}:${UNTRUSTED_PORT}: the host is not in WAVE's trusted ` +
  `hosts list and the host key policy is 'strict'. Add it in Settings > Network > SSH Hosts`

const LABEL: Record<HostKeyAction, string> = { strict: 'strict', 'accept-new': 'accept-new', disabled: 'disabled' }

/** Open the Test on the canvas and wait for the app to read the host key policy. */
async function openWithPolicy(page: Page, testId: string): Promise<void> {
  const policyRead = page.waitForResponse((response) => response.url().includes('/network/ssh-hosts/policy'))
  await openLaneCanvas(page, testId)
  expect((await policyRead).ok(), 'the app read the host key policy').toBeTruthy()
}

async function hostKeyOf(request: APIRequestContext, testId: string, nodeId: string): Promise<unknown> {
  return (await storedValues(request, testId, nodeId)).host_key_verification
}

async function logMessages(request: APIRequestContext, executionId: string): Promise<string[]> {
  const response = await request.get(`${BACKEND_URL}/executions/history/${executionId}`)
  expect(response.ok(), `GET /executions/history/${executionId}: ${response.status()}`).toBeTruthy()
  const logs = (((await response.json()).data ?? {}) as { logs?: Array<{ message?: string }> }).logs ?? []
  return logs.map((entry) => entry.message ?? '')
}

/** Run the SSH fixture to the untrusted port with `action` as its host key action. */
async function runWith(page: Page, action: unknown, created: string[]): Promise<{ verdict: string; messages: string[] }> {
  const fixture = readFixture(__dirname, 'fixture-choice-settings-run.json')
  const open = fixture.workflow.nodes.find((node: { id: string }) => node.id === RUN_OPEN)
  open.data.config.values.host_key_verification = action
  const testId = await importFixtureTest(page, fixture, { injectSsh: true })
  created.push(testId)
  const { executionId, verdict } = await runTrackedTest(page.request, testId)
  return { verdict, messages: await logMessages(page.request, executionId) }
}

test.describe('V-FIELD-CHOICE-SETTINGS-FUNCTIONAL: the host key action comes from Settings at creation', () => {
  const created: string[] = []

  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
    await resetNetworkSettings(BACKEND_URL)
  })

  test.afterEach(async ({ page, request }) => {
    try {
      await resetNetworkSettings(BACKEND_URL)
      await resetMcpSettings(page)
    } finally {
      for (const id of created.splice(0)) await deleteSeededTest(page, id)
      await resetOwnership(request)
    }
  })

  test('a Settings change reaches only Blocks made after it, and the run uses the value the Block holds', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000)
    await ensureEnvironment(request)
    const testId = await importFixtureTest(page, readFixture(__dirname, 'fixture-choice-settings.json'))
    created.push(testId)

    const before = await test.step('with the default Disabled a dropped Block holds disabled', async () => {
      await openWithPolicy(page, testId)
      const id = await dropBelow(page, ANCHOR, null, SSH_SESSION_OPEN)
      await disableBlock(page, id)
      await saveTest(page)
      expect(await hostKeyOf(request, testId, id)).toBe('disabled')
      return id
    })

    const { after, duplicate } = await test.step('after the change to Strict only a new Block holds strict', async () => {
      await setHostKeyDefault(request, 'strict')
      await openWithPolicy(page, testId)

      const sheet = await openConfig(page, before)
      await openGroup(sheet, 'Advanced')
      await expect(choiceTrigger(sheet, 'host_key_verification'), 'the placed Block keeps its own value').toHaveText(
        LABEL.disabled,
      )
      await sheet.getByRole('button', { name: 'Cancel', exact: true }).last().click()
      await expect(sheet).toHaveCount(0)

      const made = await dropBelow(page, before, null, SSH_SESSION_OPEN)
      const copy = await addsOneBlock(page, () => clickNodeKebabItem(page, before, 'Duplicate'))
      for (const id of [copy, made]) {
        const disabled = await page.locator(`[data-testid="workflow-node-${id}"]`).getAttribute('data-disabled')
        if (disabled !== 'true') await disableBlock(page, id)
      }
      await saveTest(page)
      return { after: made, duplicate: copy }
    })

    await test.step('storage holds disabled, disabled for the duplicate and strict for the new Block', async () => {
      expect(await hostKeyOf(request, testId, before), 'placed before the change').toBe('disabled')
      expect(await hostKeyOf(request, testId, duplicate), 'the duplicate copies its value').toBe('disabled')
      expect(await hostKeyOf(request, testId, after), 'placed after the change').toBe('strict')
    })

    await test.step('recipe compile under Strict writes strict and the readback says so', async () => {
      await enableMcpUntilRestart(page, MCP_PORT)
      const recipe = `test:
  name: zz-11541-s10-settings-recipe-${runToken()}
  description: Host key action at compile
flow:
  - block: ssh-session-open
    label: Recipe open
    settings:
      host: 127.0.0.1
      username: wave
`
      const result = callTool(MCP_PORT, 'create_test_from_recipe', { recipe })
      expect(result.payload.created, JSON.stringify(result.payload)).toBe(true)
      const recipeTestId = result.payload.test_id as string
      created.push(recipeTestId)
      const node = (await storedNodes(request, recipeTestId)).find((entry) => entry.data?.elementType === 'ssh-session-open')
      expect(node?.data?.config?.values?.host_key_verification).toBe('strict')
      const readback = callTool(MCP_PORT, 'get_test_recipe', { test_ref: recipeTestId })
      expect(readback.payload.recipe as string).toMatch(/^\s+host_key_verification: ['"]?strict['"]?$/m)
    })

    await test.step('on sshd the stored strict refuses the untrusted host; the stored disabled connects', async () => {
      const strict = await runWith(page, await hostKeyOf(request, testId, after), created)
      expect(strict.verdict, strict.messages.join('\n')).toBe('failed')
      expect(strict.messages.some((line) => line.includes(STRICT_REFUSAL)), strict.messages.join('\n')).toBe(true)
      expect(strict.messages.some((line) => line.startsWith('placed connected=')), 'the strict run never connected').toBe(false)

      const disabled = await runWith(page, await hostKeyOf(request, testId, before), created)
      expect(disabled.verdict, disabled.messages.join('\n')).toBe('passed')
      expect(disabled.messages).toContain('placed connected=True hops=1')
      expect(disabled.messages).toContain('placed-done closed=1')
    })
  })
})
