/**
 * V-PLUGIN-HTTP-FILEPATH: where a download lands, and what `body` then holds
 *
 * Phase: functional-workflow. File response mode writes the response to disk.
 * An explicit File Path is the full target and replaces whatever is already
 * there - it never grows a numbered sibling. An empty File Path keeps the
 * naming it always had (Content-Disposition first, the URL basename after) and
 * a repeat download takes the next free numbered name instead of overwriting.
 * `body` is the reference to what was written: artifact:// while the file is
 * inside the run's artifacts, the absolute path when it is not.
 *
 * Every leg downloads from a REAL service: the published http-echo listener
 * (HTTP_TARGET_HOST + HTTP_MAIN_PORT) and, for the Content-Disposition leg,
 * WAVE's own test data zip route - the only reachable endpoint whose declared
 * filename differs from its URL basename, so it is the one that can tell the
 * two naming rules apart.
 *
 * Behavior: file_path replaces file_name (empty keeps today's naming and
 * location, an explicit path replaces, an auto-named download keeps the
 * numbered suffix); the body reference is artifact:// inside the run's
 * artifacts and the absolute path otherwise; the payload test's own
 * folder; HTTP File Path is the save-as reference field.
 * REQ: REQ-3.4.1.4, REQ-3.4.3.1, REQ-3.4.3.2, REQ-5.2.4.12
 *
 * Pass Criteria:
 *  1. Two downloads with the SAME explicit File Path leave ONE artifact at that
 *     path holding the SECOND response, and no numbered sibling beside it.
 *  2. `body` for those two legs is artifact://downloads/report.json - the path
 *     as given, relative to the run's artifacts root.
 *  3. An empty File Path names the first download from the URL basename
 *     (wave-drop.json) and the second wave-drop-2.json: two artifacts, the
 *     first untouched.
 *  4. An empty File Path prefers the response's Content-Disposition filename
 *     over the URL basename: the zip route's declared name lands, and no
 *     artifact is named after the URL's last segment.
 *  5. An explicit File Path outside the run's artifacts writes there and `body`
 *     is the ABSOLUTE path, not an artifact:// reference; File I/O stats on the
 *     same path reports the same byte count and sha256 the block returned, and
 *     the run's artifacts never list that file.
 *  6. The last block removes the directory the run created outside the
 *     artifacts folder.
 *
 * Run: ./scripts/e2e-targeted-local.sh functional/http-plugin/v-plugin-http-filepath.spec.ts
 */

import {
  test,
  expect,
  type APIRequestContext,
} from '../../helpers/playwright-fixtures'
import {
  BACKEND_URL,
  HTTP_MAIN_PORT,
  HTTP_TARGET_HOST,
  ensureEnvironment,
} from '../../helpers/config'
import { createValidTest, openTest, releaseWorkbenchOwnership, validateTest } from '../../helpers/fn-seed'
import { chainEdges, markerNode, pluginNode, stackNodes } from '../../helpers/k8s-nodes'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { getActiveSessionId, getSessionVariables } from '../../helpers/fixture-import'
import { uploadTestData } from '../../helpers/testdata'

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const ECHO = `https://${HTTP_TARGET_HOST}:${HTTP_MAIN_PORT}`

const AUTO_NAME = 'wave-drop.json'
const AUTO_NAME_2 = 'wave-drop-2.json'
const EXPLICIT_REL = 'downloads/report.json'
const EXPLICIT_SIBLING = 'downloads/report-2.json'
const OUTSIDE_DIR = `/tmp/wave-e2e-httpfp-${SUFFIX}`
const OUTSIDE_PATH = `${OUTSIDE_DIR}/outside.json`

const PAYLOAD_NAME = `HTTP File Path Payload ${SUFFIX}`
const PAYLOAD_FILE = 'payload.txt'
const PAYLOAD_CONTENT = `http-filepath-payload-${SUFFIX}\n`

const BOOKEND = `http-filepath-done-${SUFFIX}`
const NODES = [
  'http-auto-1',
  'http-auto-2',
  'http-disposition',
  'http-explicit-1',
  'http-explicit-2',
  'fileio-read-report',
  'http-outside',
  'fileio-stats-outside',
  'fileio-clean-outside',
  'log-done',
] as const

/** The value rows every HTTP block in this fixture carries, mirroring the suite's other fixtures. */
const HTTP_BASE = {
  method: 'GET',
  timeout: 15,
  retry_count: 0,
  retry_delay: 1,
  retry_backoff_factor: 2,
  retryable_status_codes: ['502', '503', '504'],
  verify_ssl: false,
  allow_redirects: true,
  max_redirects: 10,
  response_mode: 'file',
} as const

function downloadNode(
  id: string,
  description: string,
  url: string,
  outputBindings: Record<string, string>,
  filePath?: string,
) {
  return pluginNode({
    id,
    label: 'HTTP',
    elementType: 'http-client',
    category: 'network',
    description,
    values: filePath ? { ...HTTP_BASE, url, file_path: filePath } : { ...HTTP_BASE, url },
    outputBindings,
  })
}

interface ArtifactItem {
  path: string
  size_bytes: number
}

async function listSessionArtifacts(request: APIRequestContext): Promise<ArtifactItem[]> {
  const resp = await request.get(`${BACKEND_URL}/workbench/session/artifacts`)
  expect(
    resp.ok(),
    `GET /workbench/session/artifacts failed: ${resp.status()} ${await resp.text()}`,
  ).toBeTruthy()
  const body = (await resp.json()) as { items: ArtifactItem[] }
  return body.items
}

/** The filename the zip route declares, read from the live response rather than recomputed. */
function dispositionFilename(header: string | null): string {
  const match = /filename="([^"]+)"/.exec(header ?? '')
  expect(match, `no filename in Content-Disposition: ${header}`).toBeTruthy()
  return (match as RegExpExecArray)[1]
}

let payloadId = ''
let workflowId = ''
let zipUrl = ''
let zipArtifactName = ''

test.describe('V-PLUGIN-HTTP-FILEPATH: where a download lands', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)

    // A second, tiny Test that exists only to give the zip route something to
    // serve. Its zip is the one response whose declared filename differs from
    // the URL's last segment.
    payloadId = await createValidTest(request, {
      name: PAYLOAD_NAME,
      nodes: [
        markerNode({ id: 'payload-log', description: 'Payload', text: 'payload' }),
      ],
      edges: chainEdges(['payload-log']),
    })
    await uploadTestData(request, payloadId, '', PAYLOAD_FILE, PAYLOAD_CONTENT, {
      mimeType: 'text/plain',
    })

    zipUrl = `${BACKEND_URL}/tests/${payloadId}/testdata/zip`
    const zipResp = await request.get(zipUrl)
    expect(zipResp.ok(), `GET testdata zip failed: ${zipResp.status()}`).toBeTruthy()
    zipArtifactName = dispositionFilename(zipResp.headers()['content-disposition'] ?? null)
    expect(
      zipArtifactName.endsWith('.zip'),
      `the zip route must declare a .zip filename, got ${zipArtifactName}`,
    ).toBeTruthy()
    expect(
      zipArtifactName,
      'the declared filename must differ from the URL basename, or the leg proves nothing',
    ).not.toBe('zip')

    const nodes = stackNodes([
      downloadNode('http-auto-1', 'Auto-named download', `${ECHO}/${AUTO_NAME}`, {
        body: 'auto1_ref',
      }),
      downloadNode('http-auto-2', 'Auto-named download again', `${ECHO}/${AUTO_NAME}`, {
        body: 'auto2_ref',
      }),
      downloadNode('http-disposition', 'Content-Disposition named download', zipUrl, {
        body: 'cd_ref',
      }),
      downloadNode(
        'http-explicit-1',
        'Explicit File Path first write',
        `${ECHO}/wave-one.json`,
        { body: 'explicit1_ref' },
        `artifact://${EXPLICIT_REL}`,
      ),
      downloadNode(
        'http-explicit-2',
        'Explicit File Path replaces',
        `${ECHO}/wave-two.json`,
        { body: 'explicit2_ref', sha256: 'explicit2_sha', size: 'explicit2_size' },
        `artifact://${EXPLICIT_REL}`,
      ),
      pluginNode({
        id: 'fileio-read-report',
        label: 'File I/O',
        elementType: 'file-io',
        category: 'system',
        description: 'Read The Replaced Artifact',
        values: { operation: 'read', path: `artifact://${EXPLICIT_REL}` },
        outputBindings: { content: 'report_text' },
      }),
      downloadNode(
        'http-outside',
        'Explicit File Path outside the artifacts',
        `${ECHO}/wave-outside.json`,
        { body: 'outside_ref', sha256: 'outside_sha', size: 'outside_size' },
        OUTSIDE_PATH,
      ),
      pluginNode({
        id: 'fileio-stats-outside',
        label: 'File I/O',
        elementType: 'file-io',
        category: 'system',
        description: 'Stat The Outside File',
        values: {
          operation: 'stats',
          path: OUTSIDE_PATH,
          size: true,
          checksum: 'sha256',
          output_format: 'individual',
        },
        outputBindings: {
          exists: 'outside_exists',
          size: 'outside_stat_size',
          checksum: 'outside_checksum',
        },
      }),
      pluginNode({
        id: 'fileio-clean-outside',
        label: 'File I/O',
        elementType: 'file-io',
        category: 'system',
        description: 'Remove The Outside Folder',
        values: { operation: 'delete', path: OUTSIDE_DIR, missing_ok: false },
      }),
      markerNode({ id: 'log-done', description: 'Bookend', text: BOOKEND }),
    ])

    workflowId = await createValidTest(request, {
      name: `HTTP File Path ${SUFFIX}`,
      nodes,
      edges: chainEdges(NODES),
      variables: {
        auto1_ref: { value: '', type: 'string', scope: 'test' },
        auto2_ref: { value: '', type: 'string', scope: 'test' },
        cd_ref: { value: '', type: 'string', scope: 'test' },
        explicit1_ref: { value: '', type: 'string', scope: 'test' },
        explicit2_ref: { value: '', type: 'string', scope: 'test' },
        explicit2_sha: { value: '', type: 'string', scope: 'test' },
        explicit2_size: { value: null, type: 'integer', scope: 'test' },
        report_text: { value: '', type: 'string', scope: 'test' },
        outside_ref: { value: '', type: 'string', scope: 'test' },
        outside_sha: { value: '', type: 'string', scope: 'test' },
        outside_size: { value: null, type: 'integer', scope: 'test' },
        outside_exists: { value: false, type: 'boolean', scope: 'test' },
        outside_stat_size: { value: null, type: 'integer', scope: 'test' },
        outside_checksum: { value: '', type: 'string', scope: 'test' },
      },
    })

    const validation = await validateTest(request, workflowId, 'run')
    expect(
      validation.errors,
      `the built Test must validate clean. Got: ${JSON.stringify(validation.errors)}`,
    ).toEqual([])
  })

  test.afterAll(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    await releaseWorkbenchOwnership(request)
    if (workflowId) await request.delete(`${BACKEND_URL}/tests/${workflowId}`).catch(() => undefined)
    if (payloadId) await request.delete(`${BACKEND_URL}/tests/${payloadId}`).catch(() => undefined)
  })

  test('an explicit File Path replaces, an empty one numbers, and body names what was written', async ({
    page,
    request,
  }) => {
    await openTest(page, workflowId)
    const status = await startRun(page)
    const logs = await finishRun(page, status, BOOKEND)
    expect(
      logs.some((line) => line === BOOKEND),
      'the bookend marker closed the run',
    ).toBeTruthy()

    for (const id of NODES) {
      await expect(
        page.locator(`[data-testid="workflow-node-${id}"]`),
        `${id} must have succeeded`,
      ).toHaveAttribute('data-execution-status', 'success')
    }

    const vars = await getSessionVariables(page, await getActiveSessionId(page))
    const artifacts = await listSessionArtifacts(request)
    const paths = artifacts.map((item) => item.path)
    const where = `Artifacts: ${JSON.stringify(paths)}`

    await test.step('the explicit File Path replaced in place, with no numbered sibling', async () => {
      expect(paths.filter((p) => p === EXPLICIT_REL), where).toHaveLength(1)
      expect(
        paths,
        `an explicit File Path must never uniquify. ${where}`,
      ).not.toContain(EXPLICIT_SIBLING)

      const content = await request.get(
        `${BACKEND_URL}/workbench/session/artifacts/content/${EXPLICIT_REL}`,
      )
      expect(content.ok(), `GET artifact content failed: ${content.status()}`).toBeTruthy()
      const stored = await content.text()
      expect(
        stored,
        'the artifact holds the SECOND response',
      ).toContain('/wave-two.json')
      expect(
        stored,
        'nothing of the first response survived the replace',
      ).not.toContain('/wave-one.json')
      expect(vars.report_text?.value, 'the File I/O read agrees with the stored bytes').toBe(stored)

      const entry = artifacts.find((item) => item.path === EXPLICIT_REL)
      expect(entry?.size_bytes, 'the stored size is the second response size').toBe(
        vars.explicit2_size?.value,
      )
    })

    await test.step('body is the artifact reference for a path inside the run artifacts', () => {
      expect(vars.explicit1_ref?.value).toBe(`artifact://${EXPLICIT_REL}`)
      expect(vars.explicit2_ref?.value).toBe(`artifact://${EXPLICIT_REL}`)
    })

    await test.step('an empty File Path names from the URL and numbers the repeat', async () => {
      expect(vars.auto1_ref?.value).toBe(`artifact://${AUTO_NAME}`)
      expect(vars.auto2_ref?.value).toBe(`artifact://${AUTO_NAME_2}`)
      expect(paths, where).toContain(AUTO_NAME)
      expect(paths, `the first download must survive the second. ${where}`).toContain(AUTO_NAME_2)

      const first = await request.get(
        `${BACKEND_URL}/workbench/session/artifacts/content/${AUTO_NAME}`,
      )
      expect(first.ok(), `GET ${AUTO_NAME} failed: ${first.status()}`).toBeTruthy()
      expect(
        await first.text(),
        'the first auto-named artifact still holds its own response',
      ).toContain(`/${AUTO_NAME}`)
    })

    await test.step('an empty File Path prefers Content-Disposition over the URL basename', () => {
      expect(vars.cd_ref?.value).toBe(`artifact://${zipArtifactName}`)
      expect(paths, where).toContain(zipArtifactName)
      expect(
        paths,
        `the URL's last segment must not name the file. ${where}`,
      ).not.toContain('zip')
    })

    await test.step('body is the absolute path for a target outside the run artifacts', () => {
      expect(vars.outside_ref?.value).toBe(OUTSIDE_PATH)
      expect(
        String(vars.outside_ref?.value).startsWith('artifact://'),
        'a file outside the artifacts root is never reported as an artifact reference',
      ).toBeFalsy()
      expect(paths, `the outside download must not be listed. ${where}`).not.toContain(
        'outside.json',
      )

      // File I/O read the same absolute path back: same bytes, same digest.
      expect(vars.outside_exists?.value, 'the file really landed outside').toBe(true)
      expect(vars.outside_checksum?.value).toBe(vars.outside_sha?.value)
      expect(vars.outside_stat_size?.value).toBe(vars.outside_size?.value)
      expect(Number(vars.outside_size?.value)).toBeGreaterThan(0)
    })
  })
})
