/**
 * HTTP artifact:// parent segments (REQ-3.4.1.4, REQ-3.4.3.1; FIO-2, HTTP-11).
 *
 * A `..` segment in an artifact:// reference is followed wherever it leads, on
 * HTTP as on every block that resolves a file through the shared plugin path
 * resolver.
 *
 * The spec plants a marker file outside the artifacts directory, points an HTTP
 * upload at it through an artifact:// reference that climbs out of the run's
 * artifacts, and proves the reference resolved: the node succeeds and the
 * recording server receives exactly the planted bytes.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/http-plugin/v-plugin-http-artifact-containment.spec.ts
 */

import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { selectEnvironment } from '../../helpers/workbench'

const PLANTED_CONTENT = 'PLANTED-BESIDE-THE-ARTIFACTS'
/** Deep enough to climb out of any artifacts directory; extra `..` at root are inert. */
const ESCAPE_PREFIX = '../'.repeat(12)

interface SeenRequest {
  method: string
  url: string
  body: Buffer
}

function startRecordingServer(seen: SeenRequest[]): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', body: Buffer.concat(chunks) })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, port })
    })
  })
}

function loadFixture(baseUrl: string, outsidePath: string): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'artifact-traversal.fixture.json'), 'utf-8'),
  ) as { variables: Record<string, { value: unknown }> }
  fixture.variables.base_url.value = baseUrl
  fixture.variables.outside_path.value = outsidePath
  // Leading separator dropped: the reference is relative to the artifacts root.
  fixture.variables.traversing_source.value = `artifact://${ESCAPE_PREFIX}${outsidePath.replace(/^\/+/, '')}`
  return fixture as unknown as Record<string, unknown>
}

async function runToTerminal(page: Page): Promise<string> {
  await selectEnvironment(page)
  await page.locator('[data-testid="run-button"]').click()
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
  await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
  return (await status.getAttribute('data-status')) ?? 'unknown'
}

test('an artifact:// file source that climbs out of the artifacts directory is uploaded', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const seen: SeenRequest[] = []
  const { server, port } = await startRecordingServer(seen)
  const outsidePath = path.join(
    '/tmp',
    `wave-e2e-traversal-${crypto.randomBytes(6).toString('hex')}.bin`,
  )

  try {
    await importValidateAndNavigate(page, loadFixture(`http://127.0.0.1:${port}`, outsidePath))

    const status = await runToTerminal(page)
    const logs = await getLogTexts(page)
    const lines = await getLogLines(page)

    expect(
      status,
      `the upload through the parent segments must pass. Console:\n${lines.join('\n')}`,
    ).toBe('passed')

    await expect(page.locator('[data-testid="workflow-node-http-traverse"]')).toHaveAttribute(
      'data-execution-status',
      'success',
    )

    expect(seen, 'the upload reached the server once').toHaveLength(1)
    expect(seen[0].method, 'the file body mode sends a PUT').toBe('PUT')
    expect(
      seen[0].body.toString('utf-8'),
      'the bytes sent are the file planted outside the artifacts directory',
    ).toBe(PLANTED_CONTENT)
    expect(logs).toContain('traversal-upload-completed')
    expect(
      lines.some((line) => line.includes('Path traversal not allowed')),
      `no line may refuse the reference.\n${lines.join('\n')}`,
    ).toBeFalsy()
  } finally {
    server.close()
    fs.rmSync(outsidePath, { force: true })
  }
})
