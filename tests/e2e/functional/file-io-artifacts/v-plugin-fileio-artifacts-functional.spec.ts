/**
 * V-PLUGIN-FILEIO-ARTIFACTS-FUNCTIONAL: File I/O artifact:// session round-trip
 * Wireframe: N/A (backend-only, no visual surface)
 * Design Decisions: session artifacts dir + context injection, session dir
 * lifecycle, artifact:// containment, session artifacts API
 * REQ: REQ-3.7.1.4
 *
 * Imports a pre-built workflow fixture with 4 nodes:
 *   - File I/O write artifact://result.json (JSON content, replacing an existing file)
 *   - File I/O read artifact://result.json (content -> file_content variable)
 *   - Log file_content (proves variable propagation of round-tripped content)
 *   - File I/O write artifact://logs/service.log (subdirectory auto-creation)
 *
 * Pass Criteria:
 * 1. POST /tests imports the fixture successfully
 * 2. POST /tests/{id}/validate returns zero validation errors
 * 3. Workflow runs via workbench UI and the session ends with status passed
 * 4. Console log shows the exact round-tripped JSON content
 * 5. All 4 nodes show success execution status
 * 6. GET /workbench/session/artifacts lists result.json and logs/service.log with the
 *    written byte lengths (Write has no output; the listing proves what landed)
 * 7. GET /workbench/session/artifacts/content/result.json returns the content
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/file-io-artifacts/v-plugin-fileio-artifacts-functional.spec.ts
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { validateTest } from '../../helpers/fn-seed'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

function loadFixture(): Record<string, any> {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8')
  return JSON.parse(raw)
}

// ---------------------------------------------------------------------------
// Node mapping
// ---------------------------------------------------------------------------

type NodeName =
  | 'FILEIO_WRITE_JSON'
  | 'FILEIO_READ_JSON'
  | 'LOG_ROUNDTRIP'
  | 'FILEIO_WRITE_SUBDIR'

const DESCRIPTION_TO_NODE: Record<string, NodeName> = {
  'Write Artifact JSON': 'FILEIO_WRITE_JSON',
  'Read Artifact JSON': 'FILEIO_READ_JSON',
  'Log Round-Trip Content': 'LOG_ROUNDTRIP',
  'Write Artifact Subdir': 'FILEIO_WRITE_SUBDIR',
}

const ALL_NODE_NAMES: NodeName[] = [
  'FILEIO_WRITE_JSON',
  'FILEIO_READ_JSON',
  'LOG_ROUNDTRIP',
  'FILEIO_WRITE_SUBDIR',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildNodeIds(fixture: Record<string, any>): Map<NodeName, string> {
  const nodeIds = new Map<NodeName, string>()
  for (const node of fixture.workflow.nodes) {
    const displayName = node.data?.description
    const nodeName = DESCRIPTION_TO_NODE[displayName]
    if (nodeName) {
      nodeIds.set(nodeName, `workflow-node-${node.id}`)
    }
  }
  return nodeIds
}

function findConfigValue(fixture: Record<string, any>, nodeId: string, key: string): string {
  const node = fixture.workflow.nodes.find((n: Record<string, any>) => n.id === nodeId)
  return node.data.config.values[key]
}

async function selectEnvironment(page: Page, envName: string) {
  const envSelector = page.locator('[data-testid="environment-selector"]')
  await envSelector.click()
  const envPopover = page.locator('[data-testid="environment-popover"]')
  await expect(envPopover).toBeVisible()
  await envPopover.locator(`button:has-text("${envName}")`).first().click()
  await expect(envPopover).not.toBeVisible()
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('File I/O Artifacts E2E Execution', () => {
  test('Import fixture, validate, run, verify artifact round-trip and session artifact listing', async ({
    page,
  }) => {
    const fixture = loadFixture()
    const nodeIds = buildNodeIds(fixture)
    const jsonContent = findConfigValue(fixture, 'fileio-write-json', 'content')
    const subdirContent = findConfigValue(fixture, 'fileio-write-subdir', 'content')
    const jsonByteLength = Buffer.byteLength(jsonContent, 'utf-8')

    // Verify all nodes mapped correctly
    for (const name of ALL_NODE_NAMES) {
      expect(nodeIds.has(name), `Node "${name}" not found in fixture`).toBeTruthy()
    }

    let testId = ''

    // ================================================================
    // STEP 1: Import test via API and validate (zero errors)
    // ================================================================
    await test.step('Import test via API and validate', async () => {
      // Clear any existing session
      await page.request
        .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
        .catch(() => {})

      // Ensure shared environment exists
      await ensureEnvironment(page.request)

      const createResponse = await page.request.post(
        `http://localhost:${BACKEND_PORT}/tests`,
        { data: fixture }
      )
      expect(
        createResponse.ok(),
        `POST /tests failed: ${createResponse.status()}`
      ).toBeTruthy()

      const created = (await createResponse.json()) as Record<string, any>
      testId = created.data?.id || created.id

      const validation = await validateTest(page.request, testId, 'run')
      expect(
        validation.errors,
        `Fixture must pass validation with zero errors. Got: ${JSON.stringify(validation.errors)}`
      ).toHaveLength(0)
      expect(validation.status).toBe(200)

      await page.goto(`/workbench?editTest=${testId}`)
      await page.evaluate(() => localStorage.clear())
      await page.goto(`/workbench?editTest=${testId}`)
      await waitForCanvasLoad(page)
    })

    // ================================================================
    // STEP 2: Run workflow via workbench UI
    // ================================================================
    await test.step('Select environment and run', async () => {
      await selectEnvironment(page, E2E_ENV_NAME)

      const runButton = page.locator('[data-testid="run-button"]')
      await runButton.click()

      const statusIndicator = page.locator('[data-testid="workflow-status"]')

      // Wait for execution to actually start (async validation + API call before status changes)
      await expect(statusIndicator).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })

      // Wait for workflow to finish
      await expect(statusIndicator).not.toHaveAttribute('data-status', 'running', {
        timeout: 10_000,
      })

      // Diagnostic: if not passed, dump node statuses and console errors
      const status = await statusIndicator.getAttribute('data-status')
      if (status !== 'passed') {
        const nodeStatuses = await page.evaluate(() => {
          const nodes = document.querySelectorAll('[data-testid^="workflow-node-"]')
          return Array.from(nodes).map((n) => ({
            testId: n.getAttribute('data-testid'),
            status: n.getAttribute('data-execution-status'),
            name:
              n.querySelector('[class*="description"], [class*="name"]')?.textContent ||
              n.textContent?.substring(0, 80),
          }))
        })
        const logEntries: string[] = await getLogLines(page)
        const errorLogs = logEntries.filter(
          (e) => e.startsWith('[ERROR]') || e.startsWith('[WARN]')
        )
        console.log('=== WORKFLOW FAILED ===')
        console.log('Node statuses:', JSON.stringify(nodeStatuses, null, 2))
        console.log('Error/warn logs:', JSON.stringify(errorLogs, null, 2))
      }

      expect(status).toBe('passed')
    })

    // ================================================================
    // STEP 3: Verify round-tripped content and node statuses
    // ================================================================
    await test.step('Verify round-tripped content in console and node statuses', async () => {
      const logTexts = await getLogTexts(page)
      const allLogText = logTexts.join('\n')

      // The Log node prints exactly what File I/O read back from the artifact
      expect(
        logTexts.some((t) => t === jsonContent),
        `Expected round-tripped artifact content ${jsonContent} in logs. Got:\n${allLogText}`
      ).toBeTruthy()

      for (const name of ALL_NODE_NAMES) {
        const node = page.locator(`[data-testid="${nodeIds.get(name)}"]`)
        await expect(node).toHaveAttribute('data-execution-status', 'success')
      }
    })

    // ================================================================
    // STEP 4: Verify session artifact listing and content endpoints
    // ================================================================
    await test.step('Verify session artifacts API lists written artifacts', async () => {
      const listResponse = await page.request.get(
        `http://localhost:${BACKEND_PORT}/workbench/session/artifacts`
      )
      expect(
        listResponse.ok(),
        `GET /workbench/session/artifacts failed: ${listResponse.status()}`
      ).toBeTruthy()

      const body = (await listResponse.json()) as {
        items: Array<{ path: string; size_bytes: number; created_at: string }>
      }
      const paths = body.items.map((item) => item.path)

      expect(
        paths,
        `Expected result.json in session artifact listing. Got: ${JSON.stringify(paths)}`
      ).toContain('result.json')
      expect(
        paths,
        `Expected logs/service.log in session artifact listing. Got: ${JSON.stringify(paths)}`
      ).toContain('logs/service.log')

      const resultEntry = body.items.find((item) => item.path === 'result.json')!
      expect(resultEntry.size_bytes).toBe(jsonByteLength)
      const logEntry = body.items.find((item) => item.path === 'logs/service.log')!
      expect(logEntry.size_bytes).toBe(Buffer.byteLength(subdirContent, 'utf-8'))

      const contentResponse = await page.request.get(
        `http://localhost:${BACKEND_PORT}/workbench/session/artifacts/content/result.json`
      )
      expect(
        contentResponse.ok(),
        `GET /workbench/session/artifacts/content/result.json failed: ${contentResponse.status()}`
      ).toBeTruthy()
      expect(await contentResponse.text()).toBe(jsonContent)
    })
  })
})
