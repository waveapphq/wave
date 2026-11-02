/**
 * V-TEXT-REFUSAL-FUNCTIONAL: text that cannot be written as UTF-8 is refused at every way into WAVE
 * Wireframe: none
 * Design Decisions: none (what each way in answers)
 * REQ: REQ-4.6.9, REQ-5.2.4.9, REQ-5.2.4.9.6
 *
 * The text is half of a character pair (U+DCE9), written as its escape so that every file and
 * message here is plain ASCII on the wire. Each test names its own entities and removes them.
 *
 * Pass Criteria:
 * 1. REFUSE-1: a YAML file and a JSON file whose Test description holds the escape are refused by
 *    the Import dialog of the Tests page: the dry run answers 400 with code `PARSE_ERROR` and
 *    exactly `The file has a character at description that cannot be encoded as UTF-8, so it was
 *    not imported: remove or replace it`, the dialog shows that sentence and offers nothing to
 *    import. The import itself, sent with the same file, answers the same. The Tests list does
 *    not hold the Test.
 * 2. REFUSE-2: a YAML file that writes one character (U+1F600) as its two escapes passes the same
 *    dialog, and the stored description holds that one character.
 * 3. REFUSE-3: an MCP recipe whose Log message holds the YAML escape gets one finding from
 *    `validate_recipe` and from `create_test_from_recipe`: step `recipe`, code
 *    `RECIPE_PARSE_ERROR`, `Recipe has a character at flow[0].settings.message that cannot be
 *    encoded as UTF-8: remove or replace it`. Nothing is created. The same recipe with a plain
 *    message creates its Test.
 * 4. REFUSE-4: a subscribe frame on the live connection whose topic holds the escape is answered
 *    with the error frame `INVALID_MESSAGE` and exactly `The message has a character at topic
 *    that cannot be encoded as UTF-8, so it was refused: remove or replace it`; it is not
 *    subscribed. A clean subscribe frame sent next on the same connection is confirmed.
 * 5. REFUSE-5: a backup archive holding two environments, one whose description holds the escape:
 *    the Restore section counts both, one of them under Errors; the Environments row starts open
 *    and names that member by its file name with `Cannot be restored. Cannot be read`; the
 *    restore reads `Environments: 1 imported, 0 skipped, 1 failed` and names the member again
 *    with `Not restored. Cannot be read`; afterwards WAVE holds the clean environment and not
 *    the other.
 * 6. REFUSE-6: a Test Data upload whose form names the charset `unicode_escape` answers 422 with
 *    code `VALIDATION_ERROR` and exactly `The upload names the charset unicode_escape, and WAVE
 *    reads UTF-8 only, so it was refused: send it as UTF-8`, and nothing is stored. The same
 *    upload naming `utf-8` is stored with its bytes.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, BACKEND_URL } from '../../helpers/config'
import { openImportDialog, type ImportFile } from '../../helpers/fixture-import'
import { logNode, startEdge } from '../../helpers/fn-seed'
import { callTool, enableMcpUntilRestart, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { listTestDataPaths, readTestDataContent } from '../../helpers/testdata'
import { listZipEntries, readZipEntry } from '../../helpers/zip-reader'
import { buildZip, type ZipMember } from '../../helpers/zip-writer'
import { deleteTest } from '../file-picker/picker'

type Json = Record<string, any>

const BACKSLASH = String.fromCharCode(92)
/** U+DCE9, half of a character pair, as a YAML writer and as a JSON writer escape it. */
const YAML_LONE = `${BACKSLASH}uDCE9`
const JSON_LONE = `${BACKSLASH}udce9`
const LONE = String.fromCharCode(0xdce9)
/** U+1F600 written as its two halves, and the one character they make. */
const PAIR_ESCAPES = `${BACKSLASH}uD83D${BACKSLASH}uDE00`
const PAIR = String.fromCodePoint(0x1f600)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MCP_PORT = Number(BACKEND_PORT) + 765
const LIVE_CONNECTION = `ws://localhost:${BACKEND_PORT}/ws`

function fileRefusal(where: string): string {
  return `The file has a character at ${where} that cannot be encoded as UTF-8, so it was not imported: remove or replace it`
}

function runToken(): string {
  return randomBytes(5).toString('hex')
}

// ---------------------------------------------------------------------------
// Tests and their import files
// ---------------------------------------------------------------------------

/** Create a one-block Test with the given description and return its id. */
async function createTest(request: APIRequestContext, name: string, description: string): Promise<string> {
  const blockId = randomUUID()
  const response = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name,
      version: '1.0.0',
      description,
      workflow: { nodes: [logNode(blockId, 'Log', "'text-refusal'")], edges: [startEdge(blockId)] },
      variables: {},
      metadata: { tags: [], suite_id: null, parent_suite: null },
    },
  })
  const body = await response.json().catch(() => null)
  expect(response.status(), `POST /tests answered ${JSON.stringify(body)}`).toBe(201)
  return body.data.id as string
}

async function testsNamed(request: APIRequestContext, name: string): Promise<Json[]> {
  const response = await request.get(`${BACKEND_URL}/tests?search=${encodeURIComponent(name)}&per_page=100`)
  expect(response.status(), 'GET /tests answered').toBe(200)
  return ((await response.json()).data as Json[]).filter((entry) => entry.name === name)
}

interface Exports {
  /** The YAML export with its description line rewritten as a double-quoted text. */
  yaml(description: string): ImportFile
  /** The JSON export with its description text rewritten. */
  json(description: string): ImportFile
}

/** Export a Test whose description is `marker` in both formats; each file can then carry any description. */
async function exportBothFormats(request: APIRequestContext, testId: string, marker: string): Promise<Exports> {
  const read = async (format: string): Promise<string> => {
    const response = await request.get(`${BACKEND_URL}/tests/${testId}/export?format=${format}&secrets=mask`)
    expect(response.status(), `the ${format} export answered`).toBe(200)
    return response.text()
  }
  const yamlText = await read('yaml')
  const jsonText = await read('json')
  const yamlLine = `description: ${marker}`
  const jsonField = `"description": "${marker}"`
  expect(yamlText.split(yamlLine), `the YAML export holds the line "${yamlLine}" once`).toHaveLength(2)
  expect(jsonText.split(jsonField), `the JSON export holds ${jsonField} once`).toHaveLength(2)
  return {
    yaml: (description) => ({
      name: 'text-refusal.yaml',
      mimeType: 'application/x-yaml',
      buffer: Buffer.from(yamlText.replace(yamlLine, `description: "${description}"`), 'utf-8'),
    }),
    json: (description) => ({
      name: 'text-refusal.json',
      mimeType: 'application/json',
      buffer: Buffer.from(jsonText.replace(jsonField, `"description": "${description}"`), 'utf-8'),
    }),
  }
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

/** A one-step recipe; its Log message sits at `flow[0].settings.message`. */
function recipeText(name: string, message: string): string {
  return [
    'test:',
    `  name: ${name}`,
    '  description: Text refusal recipe',
    'flow:',
    '  - block: log',
    `    settings: {message: "${message}"}`,
    '',
  ].join('\n')
}

const RECIPE_MESSAGE_PLACE = 'flow[0].settings.message'

// ---------------------------------------------------------------------------
// Backup archives
// ---------------------------------------------------------------------------

/** The reason of an archive member that cannot be parsed (REQ-5.2.4.9.6). */
const CANNOT_BE_READ = 'Cannot be read'
/** What the line of that member reads in the preview and in the result (BACKUP-9). */
const NOT_READ_IN_PREVIEW = `Cannot be restored. ${CANNOT_BE_READ}`
const NOT_READ_IN_RESULT = `Not restored. ${CANNOT_BE_READ}`

async function createEnvironment(request: APIRequestContext, name: string, description: string): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/environments`, { data: { name, description } })
  const body = await response.json().catch(() => null)
  expect(response.status(), `POST /environments answered ${JSON.stringify(body)}`).toBe(201)
  return body.data.id as string
}

async function environmentsNamed(request: APIRequestContext, token: string): Promise<Json[]> {
  const response = await request.get(`${BACKEND_URL}/environments?search=${token}&per_page=100`)
  expect(response.status(), 'GET /environments answered').toBe(200)
  return (await response.json()).data as Json[]
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

interface UploadBody {
  boundary: string
  body: Buffer
}

/** The form a Test Data upload sends: the folder, the replace flag, then the file. */
function uploadForm(fileName: string, content: string): UploadBody {
  const boundary = `text-refusal-${runToken()}`
  const field = (name: string, value: string): string =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  const file =
    `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${fileName}"\r\n` +
    `Content-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`
  return { boundary, body: Buffer.from(field('path', '') + field('replace', 'false') + file, 'utf-8') }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const cleanups: Array<() => Promise<unknown>> = []

test.describe('V-TEXT-REFUSAL-FUNCTIONAL: text that cannot be written as UTF-8 is refused at every way in', () => {
  test.afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => undefined)
  })

  test('REFUSE-1: a YAML file and a JSON file that hold the escape are refused by the Import dialog', async ({
    page,
    request,
  }) => {
    const token = runToken()
    const name = `Text refusal import ${token}`
    cleanups.push(async () => {
      for (const entry of await testsNamed(request, name)) await deleteTest(request, entry.id as string)
    })
    const marker = `Marker ${token}`
    const seedId = await createTest(request, name, marker)
    const exported = await exportBothFormats(request, seedId, marker)
    await deleteTest(request, seedId)
    const message = fileRefusal('description')

    for (const [format, file] of [
      ['YAML', exported.yaml(`Free text ${YAML_LONE}`)],
      ['JSON', exported.json(`Free text ${JSON_LONE}`)],
    ] as const) {
      expect(file.buffer.toString('utf-8'), `the ${format} file holds the escape`).toMatch(/"Free text \\u[dD][cC][eE]9"/)
      await test.step(`${format}: the dialog refuses the file and says where the text is`, async () => {
        const dialog = await openImportDialog(page, '/tests', file)
        const answered = page.waitForResponse((response) => response.url().includes('/tests/import/validate'))
        await dialog.locator('[data-testid="validate-button"]').click()
        const response = await answered
        expect(response.status(), `the dry run of the ${format} file answered`).toBe(400)
        expect(await response.json()).toEqual({ success: false, error: { message, code: 'PARSE_ERROR' } })

        const shown = dialog.locator('[data-testid="import-dialog-error"]')
        await expect(shown).toHaveText(message)
        await expect(shown).toHaveAttribute('role', 'alert')
        await expect(dialog.locator('[data-testid="review-step"]'), 'nothing is offered for import').toHaveCount(0)
        await expect(dialog.locator('[data-testid="import-button"]')).toHaveCount(0)
      })

      await test.step(`${format}: the import itself refuses the same file`, async () => {
        const response = await request.post(`${BACKEND_URL}/tests/import`, {
          multipart: { file, conflict_resolutions: '{}' },
        })
        expect(response.status(), `the import of the ${format} file answered`).toBe(400)
        expect(await response.json()).toEqual({ success: false, error: { message, code: 'PARSE_ERROR' } })
      })
    }

    await test.step('the Tests list does not hold the Test', async () => {
      expect(await testsNamed(request, name)).toEqual([])
      await page.goto('/tests')
      await expect(page.locator('[data-testid="tests-page"]')).toBeVisible({ timeout: 15_000 })
      const searched = page.waitForResponse(
        (response) => /\/tests\?.*search=/.test(response.url()) && response.url().includes(token),
      )
      await page.locator('[data-testid="search-input"] input').fill(name)
      expect(((await (await searched).json()) as Json).data, 'the search for the name finds nothing').toEqual([])
      await expect(page.locator('[data-testid="test-row"]')).toHaveCount(0)
    })
  })

  test('REFUSE-2: a YAML file that writes one character as two escapes is imported as that character', async ({
    page,
    request,
  }) => {
    const token = runToken()
    const name = `Text refusal pair ${token}`
    cleanups.push(async () => {
      for (const entry of await testsNamed(request, name)) await deleteTest(request, entry.id as string)
    })
    const marker = `Marker ${token}`
    const seedId = await createTest(request, name, marker)
    const exported = await exportBothFormats(request, seedId, marker)
    await deleteTest(request, seedId)

    const dialog = await openImportDialog(page, '/tests', exported.yaml(`Free text ${PAIR_ESCAPES}`))
    await dialog.locator('[data-testid="validate-button"]').click()
    await expect(dialog.locator('[data-testid="import-summary"]')).toHaveText('1 importable, 0 blocked')
    await expect(dialog.locator('[data-testid="import-dialog-error"]')).toHaveCount(0)
    await dialog.locator('[data-testid="import-button"]').click()
    await expect(dialog).toBeHidden()

    let stored: Json[] = []
    await expect
      .poll(async () => (stored = await testsNamed(request, name)).length, {
        message: `the imported Test "${name}" is in the Tests list`,
      })
      .toBe(1)
    const read = await request.get(`${BACKEND_URL}/tests/${stored[0].id as string}`)
    expect(read.status()).toBe(200)
    const description = (await read.json()).data.description as string
    expect(description, 'the two escapes are stored as the one character').toBe(`Free text ${PAIR}`)
    expect(Array.from(description).at(-1)?.codePointAt(0)).toBe(0x1f600)
  })

  test('REFUSE-3: an MCP recipe that holds the escape gets one finding and makes nothing', async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000)
    const token = runToken()
    const refusedName = `Text refusal recipe ${token}`
    const cleanName = `Text refusal clean recipe ${token}`
    await resetOwnership(request)
    cleanups.push(
      () => resetMcpSettings(page),
      () => resetOwnership(request),
      async () => {
        for (const name of [refusedName, cleanName]) {
          for (const entry of await testsNamed(request, name)) await deleteTest(request, entry.id as string)
        }
      },
    )
    await enableMcpUntilRestart(page, MCP_PORT)

    const refused = recipeText(refusedName, `cafe${YAML_LONE}`)
    const finding = {
      step: 'recipe',
      code: 'RECIPE_PARSE_ERROR',
      severity: 'error',
      problem: `Recipe has a character at ${RECIPE_MESSAGE_PLACE} that cannot be encoded as UTF-8: remove or replace it`,
      fix: null,
    }

    await test.step('validate_recipe answers the one finding', () => {
      const verdict = callTool(MCP_PORT, 'validate_recipe', { recipe: refused })
      expect(verdict.isError).toBe(false)
      expect(verdict.payload.valid).toBe(false)
      expect(verdict.payload.findings).toEqual([finding])
    })

    await test.step('create_test_from_recipe answers the one finding and creates nothing', async () => {
      const result = callTool(MCP_PORT, 'create_test_from_recipe', { recipe: refused })
      expect(result.isError).toBe(false)
      expect(result.payload.created).toBe(false)
      expect(result.payload.findings).toEqual([finding])
      expect(result.payload.test_id).toBeUndefined()
      expect(await testsNamed(request, refusedName)).toEqual([])
    })

    await test.step('the same recipe with a plain message creates its Test', async () => {
      const result = callTool(MCP_PORT, 'create_test_from_recipe', { recipe: recipeText(cleanName, 'cafe') })
      expect(result.payload.created, JSON.stringify(result.payload)).toBe(true)
      expect(await testsNamed(request, cleanName)).toHaveLength(1)
    })
  })

  test('REFUSE-4: a frame on the live connection that holds the escape is refused and the connection stays open', async ({
    page,
  }) => {
    const token = runToken()
    const refusedFrame = JSON.stringify({ type: 'subscribe', topic: `text-refusal-${token}-${LONE}` })
    expect(refusedFrame, 'the frame carries the escape, not the character').toContain(JSON_LONE)
    const cleanTopic = `text-refusal-${token}-clean`
    const cleanFrame = JSON.stringify({ type: 'subscribe', topic: cleanTopic })

    await page.goto('/tests')
    await expect(page.locator('[data-testid="tests-page"]')).toBeVisible({ timeout: 15_000 })
    const frames = await page.evaluate(
      ([url, refused, clean]) =>
        new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
          const received: Array<Record<string, unknown>> = []
          const socket = new WebSocket(url)
          const giveUp = setTimeout(() => {
            socket.close()
            resolve(received)
          }, 10_000)
          socket.addEventListener('open', () => socket.send(refused))
          socket.addEventListener('error', () => {
            clearTimeout(giveUp)
            reject(new Error('the live connection failed'))
          })
          socket.addEventListener('message', (event) => {
            const frame = JSON.parse(String(event.data)) as Record<string, unknown>
            received.push(frame)
            if (frame.type === 'error') socket.send(clean)
            if (frame.type === 'subscribed') {
              clearTimeout(giveUp)
              socket.close()
              resolve(received)
            }
          })
        }),
      [LIVE_CONNECTION, refusedFrame, cleanFrame] as const,
    )

    const answers = frames.filter((frame) => frame.type === 'error' || frame.type === 'subscribed')
    expect(answers, JSON.stringify(frames)).toEqual([
      {
        type: 'error',
        error_code: 'INVALID_MESSAGE',
        message:
          'The message has a character at topic that cannot be encoded as UTF-8, so it was refused: remove or replace it',
        timestamp: expect.any(String),
      },
      { type: 'subscribed', topic: cleanTopic, timestamp: expect.any(Number) },
    ])
  })

  test('REFUSE-5: a backup member that holds the escape is not restored and the other member is', async ({
    page,
    request,
  }) => {
    const token = runToken()
    const keptName = `Text refusal kept ${token}`
    const leftOutName = `Text refusal left out ${token}`
    cleanups.push(async () => {
      for (const entry of await environmentsNamed(request, token)) {
        await request.delete(`${BACKEND_URL}/environments/${entry.id as string}`)
      }
    })
    const keptId = await createEnvironment(request, keptName, 'Member text')
    const leftOutId = await createEnvironment(request, leftOutName, `Member text ${token}`)

    const backup = await request.post(`${BACKEND_URL}/api/backup/create`, {
      data: {
        entity_types: ['environments'],
        format: 'json',
        compression_method: 'deflate',
        compression_level: 6,
        secrets: 'mask',
      },
    })
    expect(backup.status(), 'POST /api/backup/create answered').toBe(200)
    const original = await backup.body()

    const members: ZipMember[] = []
    let leftOutFile = ''
    for (const entry of listZipEntries(original)) {
      const data = readZipEntry(original, entry.name)
      const text = data.toString('utf-8')
      if (entry.name === 'manifest.json') {
        members.push({ name: entry.name, data })
      } else if (text.includes(`"${keptName}"`)) {
        members.push({ name: entry.name, data })
      } else if (text.includes(`"${leftOutName}"`)) {
        const marked = `"description": "Member text ${token}"`
        expect(text.split(marked), `the member holds ${marked} once`).toHaveLength(2)
        const changed = text.replace(marked, `"description": "Member text ${JSON_LONE}"`)
        members.push({ name: entry.name, data: Buffer.from(changed, 'utf-8') })
        leftOutFile = entry.name.replace(/^environments\//, '')
      }
    }
    expect(members.map((member) => member.name).filter((entry) => entry.startsWith('environments/'))).toHaveLength(2)
    expect(leftOutFile, 'the file name of the member that holds the escape').toMatch(/^[^/]+\.json$/)
    const archive = buildZip(members)
    for (const member of members) expect(readZipEntry(archive, member.name).equals(member.data)).toBe(true)

    for (const id of [keptId, leftOutId]) {
      expect((await request.delete(`${BACKEND_URL}/environments/${id}`)).status()).toBe(204)
    }
    expect(await environmentsNamed(request, token)).toEqual([])

    await test.step('the Restore section names the member that cannot be read and restores the clean environment', async () => {
      await page.goto('/settings/backup')
      await expect(page.getByTestId('restore-backup-section')).toBeVisible({ timeout: 20_000 })
      await page
        .getByTestId('upload-input')
        .setInputFiles({ name: `text-refusal-${token}.zip`, mimeType: 'application/zip', buffer: archive })
      await expect(page.getByTestId('validation-preview')).toBeVisible({ timeout: 20_000 })
      await expect(page.getByTestId('restore-validate-error')).toHaveCount(0)
      // Cells: checkbox, type, total, OK, conflicts, fixable, errors.
      const counted = page.getByTestId('entity-row-environments').locator('td')
      await expect(counted.nth(2), 'both members are counted').toHaveText('2')
      await expect(counted.nth(6), 'the member that cannot be read is counted under Errors').toHaveText('1')

      const toggle = page.getByTestId('entity-row-toggle-environments')
      await expect(toggle, 'a row with a fatal entry starts open').toHaveAttribute('aria-expanded', 'true')
      await expect(toggle).toHaveAttribute('aria-label', 'Collapse environments')
      const listed = page.getByTestId('entity-row-items-environments').getByTestId('restore-item')
      await expect(listed, 'the list names the one member that cannot be read').toHaveCount(1)
      await expect(listed).toHaveAttribute('data-status', 'fatal')
      await expect(listed.locator('span')).toHaveText([leftOutFile, NOT_READ_IN_PREVIEW])

      const restore = page.getByTestId('restore-button')
      await expect(restore).toBeEnabled({ timeout: 20_000 })
      await restore.click()
      const result = page.getByTestId('restore-result')
      await expect(result).toBeVisible({ timeout: 20_000 })
      await expect(result.locator('p')).toHaveText(['Environments: 1 imported, 0 skipped, 1 failed'], {
        ignoreCase: true,
      })
      const leftOut = page.getByTestId('restore-result-items-environments').getByTestId('restore-item')
      await expect(leftOut, 'the result names the member that was left out').toHaveCount(1)
      await expect(leftOut).toHaveAttribute('data-status', 'fatal')
      await expect(leftOut.locator('span')).toHaveText([leftOutFile, NOT_READ_IN_RESULT])
      await expect(page.getByTestId('restore-backup-error')).toHaveCount(0)
    })

    await test.step('WAVE holds the clean environment and not the other', async () => {
      const stored = await environmentsNamed(request, token)
      expect(stored.map((entry) => entry.name)).toEqual([keptName])
      expect(stored[0].description).toBe('Member text')
    })
  })

  test('REFUSE-6: an upload whose form names another charset is refused, and the same upload as UTF-8 is stored', async ({
    request,
  }) => {
    const token = runToken()
    const testId = await createTest(request, `Text refusal upload ${token}`, 'Upload target')
    cleanups.push(() => deleteTest(request, testId))
    const url = `${BACKEND_URL}/tests/${testId}/testdata/upload`
    const content = `uploaded ${token}`

    await test.step('charset=unicode_escape: refused, nothing stored', async () => {
      const form = uploadForm('refused.txt', content)
      const response = await request.post(url, {
        headers: { 'content-type': `multipart/form-data; boundary=${form.boundary}; charset=unicode_escape` },
        data: form.body,
      })
      expect(response.status()).toBe(422)
      const answer = (await response.json()) as Json
      expect(answer.success).toBe(false)
      expect(answer.error.code).toBe('VALIDATION_ERROR')
      expect(answer.error.message).toBe(
        'The upload names the charset unicode_escape, and WAVE reads UTF-8 only, so it was refused: send it as UTF-8',
      )
      expect(answer.meta.request_id, 'the answer carries the request id').toMatch(UUID)
      expect(response.headers()['x-request-id']).toBe(answer.meta.request_id)
      expect(await listTestDataPaths(request, testId), 'nothing is stored').toEqual([])
    })

    await test.step('charset=utf-8: stored with its bytes', async () => {
      const form = uploadForm('stored.txt', content)
      const response = await request.post(url, {
        headers: { 'content-type': `multipart/form-data; boundary=${form.boundary}; charset=utf-8` },
        data: form.body,
      })
      expect(response.status(), await response.text()).toBe(201)
      expect(await listTestDataPaths(request, testId)).toEqual(['stored.txt'])
      expect(await readTestDataContent(request, testId, 'stored.txt')).toBe(content)
    })
  })
})
