/**
 * V-HTTP-REMOTE-PROXY-CHOICE-FUNCTIONAL: the HTTP block's Proxy choice across a move into
 * and out of a Remote Execution body
 * Design Decisions: HTTP-13, SHELL-10
 * REQ: REQ-3.4.3.9, REQ-4.7.16
 *
 * The block is moved the way a user moves it: its incoming link is deleted from the link's
 * own menu and a new link is dragged from the Remote Execution block's `body` or `then` dot.
 *
 * Pass Criteria:
 * 1. After the Remote Execution block the HTTP block's Proxy row reads "Off" and can be changed.
 * 2. Linked from the `body` dot the block shows the R badge and its Proxy row is at 50 percent
 *    opacity with the not-allowed cursor, disabled, reading "Remote host's settings".
 * 3. A Save of the block dialog there (the name changed) stores no proxy choice, like a hidden
 *    row: the Test saved inside the body holds no `proxy_mode`, the new name and the link from
 *    the `body` dot. Moved back out, the row starts on its default and reads "WAVE setting";
 *    the canvas move writes nothing (the Test saved then holds no `proxy_mode`). The next Save
 *    of the dialog, after another field changes, stores the `wave-setting` the row shows
 *    (FIELD-8, SHELL-10), and the run uses WAVE setting.
 * 4. Moved in and out with the dialog closed by Cancel, the row still reads "Off". The Test
 *    saved while the block is inside the body holds `proxy_mode: off` and the link from the
 *    `body` dot; saved again after the move out it holds `proxy_mode: off` and the link from
 *    the `then` dot.
 */

import { test, expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { HTTP_MAIN_PORT, HTTP_TARGET_HOST } from '../../helpers/config'
import { getNode } from '../../helpers/element-types'
import { pluginNode } from '../../helpers/k8s-nodes'
import { setConsoleMinimumLevel } from '../../helpers/log-reader'
import {
  LANE_VIEWPORT,
  deleteTest,
  dragFromLane,
  edge,
  edgeOnCanvas,
  expectDrawnFromLane,
  nodeLocator,
  openConfig,
  openLaneCanvas,
  remoteExecutionNode,
  saveCanvas,
  saveConfig,
  runToPass,
  savedEdges,
  seedTest,
  sshOpenBlock,
} from '../canvas-lanes/lanes-helpers'

test.use({ viewport: LANE_VIEWPORT })

const SSH = 'px-ssh'
const RX = 'px-rx'
const HTTP = 'px-http'
const NEW_NAME = 'HTTP renamed'
const REMOTE_PROXY_TEXT = "Remote host's settings"

async function seedProxyTest(request: APIRequestContext, title: string): Promise<string> {
  return seedTest(request, {
    name: `V-HTTP-REMOTE-PROXY-CHOICE ${title}`,
    ssh: true,
    nodes: [
      sshOpenBlock(SSH, 'sid', { x: 200, y: 0 }),
      remoteExecutionNode({
        id: RX,
        description: RX,
        values: { session_id: 'sid' },
        expressionFields: ['session_id'],
        position: { x: 200, y: 160 },
      }),
      pluginNode({
        id: HTTP,
        label: 'HTTP',
        elementType: 'http-client',
        category: 'network',
        values: {
          url: `https://${HTTP_TARGET_HOST}:${HTTP_MAIN_PORT}/health`,
          method: 'GET',
          verify_ssl: false,
          proxy_mode: 'off',
        },
        position: { x: 200, y: 340 },
      }),
    ],
    edges: [edge('start-node', SSH), edge(SSH, RX), edge(RX, HTTP, 'then')],
    variables: { sid: { value: '', type: 'string', scope: 'test' } },
  })
}

function locusBadge(page: Page): Locator {
  return nodeLocator(page, HTTP).locator('[data-testid="node-remote-locus-badge"]')
}

/** Delete the block's incoming link from the link's own menu. */
async function removeIncomingLink(page: Page): Promise<void> {
  const link = edgeOnCanvas(page, RX, HTTP)
  await expect(link, 'the block has one incoming link').toHaveCount(1)
  const middle = await link.locator('path.react-flow__edge-path').evaluate((path) => {
    const line = path as SVGPathElement
    const point = line.getPointAtLength(line.getTotalLength() / 2)
    const matrix = line.getScreenCTM()
    const screen = matrix ? new DOMPoint(point.x, point.y).matrixTransform(matrix) : point
    return { x: screen.x, y: screen.y }
  })
  await page.mouse.click(middle.x, middle.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await expect(link, 'the link is gone').toHaveCount(0)
}

async function moveIntoBody(page: Page): Promise<void> {
  await removeIncomingLink(page)
  await dragFromLane(page, RX, 'body', HTTP)
  await expectDrawnFromLane(page, RX, 'body', HTTP)
  await expect(locusBadge(page), 'the block runs on the remote host').toHaveAttribute('data-locus', 'R')
}

async function moveOutOfBody(page: Page): Promise<void> {
  await removeIncomingLink(page)
  await dragFromLane(page, RX, 'then', HTTP)
  await expectDrawnFromLane(page, RX, 'then', HTTP)
  await expect(locusBadge(page), 'the block runs on the WAVE host').toHaveCount(0)
}

/** Open the block dialog with the Connection group expanded. */
async function openConnection(page: Page): Promise<Locator> {
  const sheet = await openConfig(page, HTTP)
  const header = sheet.locator('[data-testid="group-header-Connection"]')
  await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
  return sheet
}

function proxyRow(sheet: Locator): Locator {
  return sheet.locator('[data-testid="param-row-proxy_mode"]')
}

/** The Proxy row shows the block's own choice and can be changed. */
async function expectOwnChoice(sheet: Locator, label: string): Promise<void> {
  const row = proxyRow(sheet)
  await expect(row).toHaveCSS('opacity', '1')
  await expect(row.getByRole('combobox')).toBeEnabled()
  await expect(row.getByRole('combobox')).toHaveText(label)
}

/** The Proxy row is grayed out and names the remote host's settings (HTTP-13). */
async function expectRemoteLock(sheet: Locator): Promise<void> {
  const row = proxyRow(sheet)
  await expect(row).toHaveCSS('opacity', '0.5')
  await expect(row).toHaveCSS('cursor', 'not-allowed')
  await expect(row.getByRole('combobox')).toBeDisabled()
  await expect(row.getByRole('combobox')).toHaveText(REMOTE_PROXY_TEXT)
}

async function cancelDialog(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(sheet).toHaveCount(0)
}

/** The saved Test's Proxy value, block name and incoming lane, read over the API. */
async function savedBlock(request: APIRequestContext, testId: string) {
  const node = await getNode(request, testId, HTTP)
  const incoming = (await savedEdges(request, testId)).filter((link) => link.target === HTTP)
  return {
    proxyMode: node.data.config.values.proxy_mode as unknown,
    name: node.data.label as unknown,
    incoming: incoming.map((link) => [link.source, link.sourceHandle ?? null]),
  }
}

test.describe('V-HTTP-REMOTE-PROXY-CHOICE-FUNCTIONAL: Proxy choice of an HTTP block moved into Remote Execution', () => {
  let testId: string | undefined

  test.afterEach(async ({ request }) => {
    await deleteTest(request, testId)
    testId = undefined
  })

  test('a Save of the block dialog inside the body stores no proxy choice', async ({ page, request }) => {
    testId = await seedProxyTest(request, 'saved inside')
    await openLaneCanvas(page, testId)

    await test.step('after the Remote Execution block the row reads Off', async () => {
      await expect(locusBadge(page)).toHaveCount(0)
      const sheet = await openConnection(page)
      await expectOwnChoice(sheet, 'Off')
      await cancelDialog(sheet)
    })

    await test.step('moved into the body the row is gray; the name is changed and the dialog saved', async () => {
      await moveIntoBody(page)
      const sheet = await openConnection(page)
      await expectRemoteLock(sheet)
      await sheet.locator('[data-testid="element-name-input"]').fill(NEW_NAME)
      await saveConfig(sheet)
      await expect(nodeLocator(page, HTTP)).toContainText(NEW_NAME)
    })

    await test.step('the Test saved inside the body holds no proxy choice', async () => {
      await saveCanvas(page)
      expect(await savedBlock(request, testId as string)).toEqual({
        proxyMode: undefined,
        name: NEW_NAME,
        incoming: [[RX, 'body']],
      })
    })

    await test.step('moved back out the row starts on WAVE setting', async () => {
      await moveOutOfBody(page)
      const sheet = await openConnection(page)
      await expect(sheet.locator('[data-testid="element-name-input"]')).toHaveValue(NEW_NAME)
      await expectOwnChoice(sheet, 'WAVE setting')
      await cancelDialog(sheet)
    })

    await test.step('the Test saved outside the body holds the new name and still no proxy choice', async () => {
      await saveCanvas(page)
      expect(await savedBlock(request, testId as string)).toEqual({
        proxyMode: undefined,
        name: NEW_NAME,
        incoming: [[RX, 'then']],
      })
    })

    await test.step('a dialog Save after another change stores the WAVE setting the row shows', async () => {
      const sheet = await openConnection(page)
      await expectOwnChoice(sheet, 'WAVE setting')
      const redirects = sheet.locator('[data-testid="param-row-allow_redirects"] button[role="checkbox"]')
      await redirects.click()
      await expect(redirects).toHaveAttribute('data-state', 'unchecked')
      await saveConfig(sheet)
      await saveCanvas(page)
      expect(await savedBlock(request, testId as string)).toEqual({
        proxyMode: 'wave-setting',
        name: NEW_NAME,
        incoming: [[RX, 'then']],
      })
    })

    await test.step('the run uses WAVE setting', async () => {
      await setConsoleMinimumLevel(page, 'DEBUG')
      const entries = await runToPass(page)
      const inputs = entries.filter((entry) => entry.source.endsWith(NEW_NAME) && entry.message.startsWith('Inputs: '))
      expect(inputs, 'the HTTP block echoes its inputs once').toHaveLength(1)
      expect(inputs[0].message).toMatch(/"proxy_mode":\s*"wave-setting"/)
      await expect(nodeLocator(page, HTTP)).toHaveAttribute('data-execution-status', 'success')
    })
  })

  test('moved in and out without a Save of the block dialog, the block keeps its choice', async ({
    page,
    request,
  }) => {
    testId = await seedProxyTest(request, 'not saved inside')
    await openLaneCanvas(page, testId)

    await test.step('moved into the body the row is gray; the dialog is closed with Cancel', async () => {
      await moveIntoBody(page)
      const sheet = await openConnection(page)
      await expectRemoteLock(sheet)
      await cancelDialog(sheet)
    })

    await test.step('the Test saved with the block inside the body still holds Off', async () => {
      await saveCanvas(page)
      expect(await savedBlock(request, testId as string)).toEqual({
        proxyMode: 'off',
        name: 'HTTP',
        incoming: [[RX, 'body']],
      })
    })

    await test.step('moved back out the row still reads Off', async () => {
      await moveOutOfBody(page)
      const sheet = await openConnection(page)
      await expectOwnChoice(sheet, 'Off')
      await cancelDialog(sheet)
    })

    await test.step('the Test saved with the block back outside still holds Off', async () => {
      await saveCanvas(page)
      expect(await savedBlock(request, testId as string)).toEqual({
        proxyMode: 'off',
        name: 'HTTP',
        incoming: [[RX, 'then']],
      })
    })
  })
})
