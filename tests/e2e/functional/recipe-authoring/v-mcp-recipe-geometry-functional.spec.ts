/**
 * V-MCP-RECIPE-GEOMETRY-FUNCTIONAL: the geometry a recipe-built block
 * carries - stored width, canvas width, amend stability, and a clean readback.
 * Wireframes: none (block sizing on the existing canvas card)
 * Design Decisions: none (deterministic layout + node-N ids)
 * REQ: REQ-5.2.7.3, REQ-5.2.7.4, REQ-5.2.7.6
 *
 * Pass Criteria:
 * 1. The compiler stores a fitted width per element node: a 28-character name
 *    is stored at 338 (wider than the 160 floor), a 51-character name clamps
 *    at the 360 maximum instead of growing, an unlabeled block sits at 160,
 *    and no node carries a height.
 * 2. The canvas draws each block at its stored width; the 28-character title
 *    is laid out in full and the 51-character title is clipped.
 * 3. A hand-set width survives an amend, together with the node's pinned
 *    position, while a width that equaled the compiler's own fit for the old
 *    name is regenerated for the new name; no node carries a height after the
 *    amend (a Block's height follows its content and is never set by hand),
 *    and an appended block is compiler-sized.
 * 4. The recipe readback of that hand-resized test is expressible and carries
 *    no width, height or position.
 * 5. An amend that inserts a Block first in the body of a Remote Execution
 *    inside an If/Else branch keeps every untouched Block at its exact stored
 *    position, including the Remote's continuation, which runs beside the body;
 *    moves each body Block below the insert down exactly one 140 px row; and
 *    leaves no two stored Blocks overlapping.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, BACKEND_PORT, ensureEnvironment } from '../../helpers/config'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { deleteTest } from '../../helpers/element-types'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'

// The MCP listener port sits 765 above the shard backend port.
const MCP_PORT = Number(BACKEND_PORT) + 765

function uniqueName(base: string): string {
  return `${base} ${Date.now()}-${randomUUID().slice(0, 6)}`
}

const LABEL_LONG = 'Write push file on sshd host'
const LABEL_CLAMPED = 'apply the gateway manifest to the staging namespace'
const LABEL_RENAMED = 'A much longer block name here'

// 58 px title chrome + 10 px per character, clamped to [160, 360].
const WIDTH_LONG = 338
const WIDTH_CLAMPED = 360
const WIDTH_FLOOR = 160
const WIDTH_RENAMED = 348
// The chrome the title span sits inside: borders, side padding, icon and gap.
const TITLE_CHROME_PX = 58

// 230 must differ from the compiler's fit or the amend discards it as generated.
const HAND_WIDTH = 230

interface StoredNode {
  id: string
  width?: number
  height?: number
  position?: { x: number; y: number }
  data?: { recipeKey?: string; label?: string }
}

async function fetchNodes(request: APIRequestContext, testId: string): Promise<StoredNode[]> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return (body.data.workflow as { nodes: StoredNode[] }).nodes
}

function byId(nodes: StoredNode[], id: string): StoredNode {
  const node = nodes.find((n) => n.id === id)
  expect(node, `no node "${id}" among ${nodes.map((n) => n.id).join(', ')}`).toBeDefined()
  return node as StoredNode
}

function byRecipeKey(nodes: StoredNode[], key: string): StoredNode {
  const node = nodes.find((n) => (n.data ?? {}).recipeKey === key)
  const keys = nodes.map((n) => (n.data ?? {}).recipeKey ?? 'none').join(', ')
  expect(node, `no node with recipeKey "${key}" among ${keys}`).toBeDefined()
  return node as StoredNode
}

// The whole card of a block with no description: a 44 px body and the 29 px status bar.
const NODE_HEIGHT = 73
const ROW_PX = 140

type Position = { x: number; y: number }

function positionsByLabel(nodes: StoredNode[]): Record<string, Position> {
  return Object.fromEntries(
    nodes.map((n) => [(n.data ?? {}).label ?? n.id, n.position as Position]),
  )
}

/** Every pair of stored blocks whose boxes overlap, as "label / label". */
function overlappingPairs(nodes: StoredNode[]): string[] {
  const pairs: string[] = []
  nodes.forEach((a, index) => {
    for (const b of nodes.slice(index + 1)) {
      const [pa, pb] = [a.position as Position, b.position as Position]
      const [wa, wb] = [a.width ?? 160, b.width ?? 160]
      // A block's height follows its content; these blocks carry no description.
      if (pa.x < pb.x + wb && pb.x < pa.x + wa && pa.y < pb.y + NODE_HEIGHT && pb.y < pa.y + NODE_HEIGHT) {
        pairs.push(`${a.data?.label} / ${b.data?.label}`)
      }
    }
  })
  return pairs
}

function logStep(indent: string, label: string, message: string): string {
  return `${indent}- block: log\n${indent}  label: ${label}\n${indent}  settings: {message: ${message}}\n`
}

/** An If/Else whose then-branch holds a Remote Execution running `body`, then the main flow. */
function releaseRecipe(name: string, body: Array<[string, string]>): string {
  const bodySteps = body.map(([label, message]) => logStep('              ', label, message)).join('')
  return `test:
  name: ${name}
  description: Amend insert geometry
  tags: [e2e, recipe]
variables:
  svc_ok: {type: boolean, value: true}
  ssh_session: {type: string, value: session}
flow:
${logStep('  ', 'Connect to app server', 'connect')}${logStep('  ', 'Check orders-api service', 'check')}  - if:
      when: "svc_ok"
      then:
        - remote:
            settings: {session_id: {expr: "ssh_session"}}
            body:
${bodySteps}      else:
${logStep('        ', 'Alert on-call', 'alert')}        - halt: {scope: test, status: failed, message: service down}
${logStep('  ', 'Query release DB', 'query')}${logStep('  ', 'Verify release', 'verify-release')}${logStep('  ', 'Disconnect', 'disconnect')}`
}

const RELEASE_BODY: Array<[string, string]> = [
  ['API health check', 'api'],
  ['Verify API health', 'verify-api'],
]
const UNTOUCHED = [
  'Connect to app server',
  'Check orders-api service',
  'If/Else',
  'Remote Execution',
  'Alert on-call',
  'Halt',
  // The Remote's continuation runs beside its body, so the body grows past it.
  'Query release DB',
  'Verify release',
  'Disconnect',
]
const BELOW_THE_INSERT = ['API health check', 'Verify API health']

/** The title span: the sibling right after the icon, the only stable anchor. */
function titleSelector(nodeId: string): string {
  return `[data-testid="workflow-node-${nodeId}"] [data-testid="workflow-node-icon"] + span`
}

test.describe('V-MCP-RECIPE-GEOMETRY-FUNCTIONAL: recipe-built block geometry', () => {
  test.beforeEach(async ({ request }) => {
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('a recipe-built block is sized to its name, keeps a hand-set width across an amend, and reads back without geometry', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)

    const name = uniqueName('Recipe Block Sizing')
    // No `version:` key: the hand-set-size PUT bumps the stored version, and a
    // versioned recipe would then be refused with STALE_RECIPE_VERSION.
    const recipeA = `test:
  name: ${name}
  description: Block sizing geometry
  tags: [e2e, recipe]
flow:
  - block: log
    label: ${LABEL_LONG}
    settings: {message: geo-long}
  - block: log
    label: ${LABEL_CLAMPED}
    settings: {message: geo-clamped}
  - block: log
    settings: {message: geo-plain}
`
    const recipeB = `test:
  name: ${name}
  description: Block sizing geometry
  tags: [e2e, recipe]
flow:
  - block: log
    label: ${LABEL_LONG}
    settings: {message: geo-long}
  - block: log
    label: ${LABEL_CLAMPED}
    settings: {message: geo-clamped}
  - block: log
    label: ${LABEL_RENAMED}
    settings: {message: geo-plain}
  - block: log
    settings: {message: geo-added}
`

    let testId = ''
    let pinnedPosition: { x: number; y: number } = { x: 0, y: 0 }

    await test.step('enable the MCP listener until-restart via REST', async () => {
      await ensureEnvironment(request)
      const url = await enableMcpUntilRestart(page, MCP_PORT)
      expect(url).toBe(`http://127.0.0.1:${MCP_PORT}/mcp`)
    })

    await test.step('create_test_from_recipe stores a fitted width on every block', async () => {
      const created = callTool(MCP_PORT, 'create_test_from_recipe', { recipe: recipeA })
      expect(created.isError, JSON.stringify(created.payload)).toBe(false)
      // A held workbench slot also arrives here as created:false, hence the payload.
      expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
      expect(created.payload.version).toBe('1.0.0')
      testId = created.payload.test_id as string
      expect(testId).toBeTruthy()

      const nodes = await fetchNodes(request, testId)
      expect(byId(nodes, 'node-1').width, `${LABEL_LONG} is stored wider than the floor`).toBe(
        WIDTH_LONG,
      )
      expect(byId(nodes, 'node-2').width, `${LABEL_CLAMPED} clamps at the maximum`).toBe(
        WIDTH_CLAMPED,
      )
      expect(byId(nodes, 'node-3').width, 'an unlabeled block sits at the floor').toBe(WIDTH_FLOOR)
      for (const id of ['node-1', 'node-2', 'node-3']) {
        expect('height' in byId(nodes, id), `${id} must carry no compiler height`).toBe(false)
      }
    })

    await test.step('the stored width reaches the canvas and the name fits inside it', async () => {
      await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
      await ensureEnvironment(page.request)
      await page.goto(`/workbench?editTest=${testId}`)
      await page.evaluate(() => localStorage.clear())
      await page.goto(`/workbench?editTest=${testId}`)
      await waitForCanvasLoad(page)

      for (const [id, width] of [
        ['node-1', WIDTH_LONG],
        ['node-2', WIDTH_CLAMPED],
        ['node-3', WIDTH_FLOOR],
      ] as const) {
        await expect(page.locator(`[data-testid="workflow-node-${id}"]`)).toHaveAttribute(
          'style',
          new RegExp(`width:\\s*${width}px`),
        )
      }

      await expect(page.locator(titleSelector('node-1'))).toHaveText(LABEL_LONG)
      await expect(page.locator(titleSelector('node-2'))).toHaveText(LABEL_CLAMPED)

      const fits = await page
        .locator(titleSelector('node-1'))
        .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
      expect(
        fits.scroll <= fits.client + 1,
        `"${LABEL_LONG}" must be laid out in full inside the ${WIDTH_LONG - TITLE_CHROME_PX}px text box: scrollWidth ${fits.scroll}, clientWidth ${fits.client}`,
      ).toBe(true)

      const clips = await page
        .locator(titleSelector('node-2'))
        .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
      expect(
        clips.scroll > clips.client,
        `"${LABEL_CLAMPED}" must be clipped by the ${WIDTH_CLAMPED - TITLE_CHROME_PX}px text box, not laid out at full width: scrollWidth ${clips.scroll}, clientWidth ${clips.client}`,
      ).toBe(true)
    })

    await test.step('install a hand-set width through the REST write the canvas save uses', async () => {
      const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
      expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
      const workflow = (await resp.json()).data.workflow as { nodes: StoredNode[] }
      const first = byId(workflow.nodes, 'node-1')
      pinnedPosition = { ...(first.position as { x: number; y: number }) }
      first.width = HAND_WIDTH

      const put = await request.put(`${BACKEND_URL}/tests/${testId}`, { data: { workflow } })
      expect(put.ok(), `PUT /tests/${testId} failed: ${put.status()}`).toBeTruthy()

      const stored = byId(await fetchNodes(request, testId), 'node-1')
      expect(stored.width, 'the hand-set width must land before the amend').toBe(HAND_WIDTH)
    })

    await test.step('amend keeps the hand-set width and regenerates the compiler-set one', async () => {
      await page.goto('/tests')
      await resetOwnership(request)
      await page.request.delete(`${BACKEND_URL}/workbench/session/`)

      const amended = callTool(MCP_PORT, 'amend_test_from_recipe', { test_ref: testId, recipe: recipeB })
      expect(amended.isError, JSON.stringify(amended.payload)).toBe(false)
      // A held workbench slot arrives here as amended:false with a SESSION_HELD finding.
      expect(amended.payload.amended, JSON.stringify(amended.payload)).toBe(true)

      const nodes = await fetchNodes(request, testId)
      const first = byRecipeKey(nodes, 'flow[0]')
      expect(first.width, 'a hand-set width survives an amend').toBe(HAND_WIDTH)
      expect('height' in first, 'a Block carries no height after an amend').toBe(false)
      expect(first.position, 'the pinned position survives an amend').toEqual(pinnedPosition)

      expect(
        byRecipeKey(nodes, 'flow[2]').width,
        `a width equal to the compiler's own fit is regenerated for "${LABEL_RENAMED}"`,
      ).toBe(WIDTH_RENAMED)

      const appended = byRecipeKey(nodes, 'flow[3]')
      expect(appended.width, 'an appended block is compiler-sized').toBe(WIDTH_FLOOR)
      expect('height' in appended, 'an appended block carries no height').toBe(false)
    })

    await test.step('the recipe readback carries no geometry', () => {
      const readback = callTool(MCP_PORT, 'get_test_recipe', { test_ref: testId })
      expect(readback.isError, JSON.stringify(readback.payload)).toBe(false)
      expect(
        readback.payload.expressible,
        `a hand-resized test must stay expressible: ${JSON.stringify(readback.payload.inexpressible)}`,
      ).toBe(true)

      const recipe = readback.payload.recipe as string
      for (const key of [/\bwidth\b/, /\bheight\b/, /\bposition\b/]) {
        expect(recipe, `the readback must carry no ${key.source}:\n${recipe}`).not.toMatch(key)
      }
    })
  })

  test('an amend that inserts a block keeps every untouched block in place and overlaps nothing', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)

    const name = uniqueName('Recipe Insert Geometry')
    let testId = ''

    try {
      await test.step('enable the MCP listener until-restart via REST', async () => {
        await ensureEnvironment(request)
        const url = await enableMcpUntilRestart(page, MCP_PORT)
        expect(url).toBe(`http://127.0.0.1:${MCP_PORT}/mcp`)
      })

      let before: Record<string, Position> = {}
      await test.step('create_test_from_recipe stores a layout with no overlap', async () => {
        const created = callTool(MCP_PORT, 'create_test_from_recipe', {
          recipe: releaseRecipe(name, RELEASE_BODY),
        })
        expect(created.isError, JSON.stringify(created.payload)).toBe(false)
        expect(created.payload.created, JSON.stringify(created.payload)).toBe(true)
        testId = created.payload.test_id as string

        const nodes = await fetchNodes(request, testId)
        expect(overlappingPairs(nodes), 'a fresh layout must overlap nothing').toEqual([])
        before = positionsByLabel(nodes)
      })

      await test.step('amend_test_from_recipe with a block inserted first in the body', async () => {
        const amended = callTool(MCP_PORT, 'amend_test_from_recipe', {
          test_ref: testId,
          recipe: releaseRecipe(name, [['Ping app server', 'ping'], ...RELEASE_BODY]),
        })
        expect(amended.isError, JSON.stringify(amended.payload)).toBe(false)
        // A held workbench slot arrives here as amended:false with a SESSION_HELD finding.
        expect(amended.payload.amended, JSON.stringify(amended.payload)).toBe(true)
      })

      await test.step('the saved test keeps the untouched blocks and overlaps nothing', async () => {
        const nodes = await fetchNodes(request, testId)
        expect(overlappingPairs(nodes), 'no two stored blocks may overlap').toEqual([])

        const after = positionsByLabel(nodes)
        for (const label of UNTOUCHED) {
          expect(after[label], `${label} keeps its stored position`).toEqual(before[label])
        }
        for (const label of BELOW_THE_INSERT) {
          expect(after[label], `${label} moves down exactly one row`).toEqual({
            x: before[label].x,
            y: before[label].y + ROW_PX,
          })
        }
        // The inserted block takes the first body row, centered in the body column.
        const center = (label: string, position: Position): number =>
          position.x + (nodes.find((n) => n.data?.label === label)?.width ?? 0) / 2
        const ping = after['Ping app server']
        expect(ping.y, 'the inserted block takes the first body row').toBe(before['API health check'].y)
        expect(center('Ping app server', ping)).toBe(
          center('API health check', after['API health check']),
        )
      })
    } finally {
      if (testId) await deleteTest(request, testId)
    }
  })
})
