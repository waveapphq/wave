/**
 * V-MCP-TESTDATA-CONTAINMENT: nothing outside a test's own folder is ever a test data entry.
 * Wireframes: none (service surface; the sheet that shows the folder is V-TESTDATA-01)
 * Design Decisions: TDATA-1 (one folder per test, copied when the test is cloned),
 *   TDATA-12 (the MCP tools go through the same service with the same messages)
 * REQ: REQ-5.2.7.9, REQ-3.4.3.2
 *
 * Pass Criteria:
 * 1. A path holding a NUL byte is refused as an invalid path, never answered as a
 *    server error.
 * 2. A path through a folder link that leads out of the test's folder is refused by
 *    delete_testdata, write_testdata and rename_testdata, even when its last entry
 *    links back inside, and the folder outside keeps its files and modes.
 * 3. An upload into a folder named through a link inside lands in the real folder,
 *    which is read-only again afterwards.
 * 4. Two links that point at each other are an invalid path for content and
 *    delete_testdata, never a server error.
 * 5. A clone copies a link that stays inside the source's folder as its content, and
 *    leaves out every link whose real location is outside it, every link back into
 *    a folder the copy is in, and every link that leads nowhere.
 * 6. A test whose data folder is itself a link to a folder elsewhere lists nothing,
 *    serves nothing from it, writes nothing into it, and deleting the test removes
 *    the link and leaves the folder it points at as it was.
 * 7. rename_testdata and delete_testdata refuse "." as an invalid path, because the
 *    empty path alone names the folder itself, and every stored file stays.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, BACKEND_PORT, STORAGE_BASE_PATH } from '../../helpers/config'
import { callTool, enableMcpUntilRestart, type McpToolResult, resetMcpSettings } from '../../helpers/mcp'
import { resetOwnership } from '../../helpers/ownership'
import { importFixtureTest } from '../../helpers/fixture-import'
import {
  createTestDataFolder,
  listTestDataPaths,
  readTestDataContent,
  uploadTestData,
} from '../../helpers/testdata'

// The MCP listener port sits 765 above the shard backend port.
const MCP_PORT = Number(BACKEND_PORT) + 766

const KEPT = 'id,name\n1,Ada\n'
const OUTSIDE_FILE = 'not test data\n'
const OUTSIDE_KEY = 'private key\n'

interface Finding {
  step: string
  code: string
  severity: string
  problem: string
  fix: string | null
}

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

function testFolder(testId: string): string {
  return path.join(STORAGE_BASE_PATH, 'testdata', testId)
}

/** A folder outside WAVE's data folder holding one file and one subfolder with a file. */
function makeOutsideFolder(): string {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-e2e-outside-'))
  fs.writeFileSync(path.join(outside, 'secret.txt'), OUTSIDE_FILE)
  fs.mkdirSync(path.join(outside, 'sub'))
  fs.writeFileSync(path.join(outside, 'sub', 'key'), OUTSIDE_KEY)
  return outside
}

function modeOf(target: string): string {
  return (fs.lstatSync(target).mode & 0o777).toString(8)
}

/** Every mode under a folder, by relative path, so a spec can prove nothing changed it. */
function modesUnder(root: string): Record<string, string> {
  const modes: Record<string, string> = {}
  const walk = (folder: string): void => {
    for (const name of fs.readdirSync(folder)) {
      const full = path.join(folder, name)
      modes[path.relative(root, full)] = modeOf(full)
      if (fs.lstatSync(full).isDirectory()) walk(full)
    }
  }
  modes['.'] = modeOf(root)
  walk(root)
  return modes
}

/** Give back the write bit WAVE may have taken, then remove the folder. */
function removeOutsideFolder(outside: string): void {
  if (!fs.existsSync(outside)) return
  const unlock = (folder: string): void => {
    fs.chmodSync(folder, 0o700)
    for (const name of fs.readdirSync(folder)) {
      const full = path.join(folder, name)
      if (fs.lstatSync(full).isDirectory()) unlock(full)
    }
  }
  unlock(outside)
  fs.rmSync(outside, { recursive: true, force: true })
}

/** Add links to a locked test data folder the way a shared data folder could carry them. */
function plantLinks(folder: string, links: Array<[name: string, target: string]>): void {
  fs.chmodSync(folder, 0o700)
  try {
    for (const [name, target] of links) fs.symlinkSync(target, path.join(folder, name))
  } finally {
    fs.chmodSync(folder, 0o500)
  }
}

/** A refused write tool: the boolean is false and the service message is the finding. */
function expectRefusal(result: McpToolResult, key: string, problem: string): void {
  expect(result.isError, `a refusal is a result, never a raised error: ${JSON.stringify(result.payload)}`).toBe(false)
  expect(result.payload[key], `${key} must be false on a refusal: ${JSON.stringify(result.payload)}`).toBe(false)
  const findings = (result.payload.findings ?? []) as Finding[]
  expect(findings, `one finding carries the refusal: ${JSON.stringify(result.payload)}`).toHaveLength(1)
  expect(findings[0]).toEqual({
    step: 'input',
    code: 'VALIDATION',
    severity: 'error',
    problem,
    fix: null,
  })
}

async function expectInvalidContent(
  request: APIRequestContext,
  testId: string,
  rel: string,
): Promise<void> {
  const response = await request.get(`${BACKEND_URL}/tests/${testId}/testdata/content/${rel}`)
  const raw = await response.text()
  expect(response.status(), `GET testdata/content/${rel} must be refused: ${raw}`).toBe(400)
  expect(JSON.parse(raw).error.message).toBe(`Invalid test data path: ${rel}`)
}

async function cloneTest(request: APIRequestContext, testId: string): Promise<string> {
  const response = await request.post(`${BACKEND_URL}/tests/${testId}/clone`, { data: {} })
  const raw = await response.text()
  expect(response.status(), `POST /tests/${testId}/clone answered ${response.status()}: ${raw}`).toBe(201)
  return JSON.parse(raw).data.id as string
}

test.describe('V-MCP-TESTDATA-CONTAINMENT: nothing outside a test folder is test data', () => {
  const created: string[] = []
  const outsides: string[] = []

  /** A fixture test holding kept.csv, tracked for teardown. */
  async function testWithKeptFile(page: Page, request: APIRequestContext): Promise<string> {
    const testId = await importFixtureTest(page, loadFixture())
    created.push(testId)
    await uploadTestData(request, testId, '', 'kept.csv', KEPT, { mimeType: 'text/csv' })
    return testId
  }

  function outsideFolder(): string {
    const outside = makeOutsideFolder()
    outsides.push(outside)
    return outside
  }

  test.beforeEach(async ({ request }) => {
    created.length = 0
    outsides.length = 0
    await resetOwnership(request)
  })

  test.afterEach(async ({ page, request }) => {
    for (const testId of created) {
      await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => {})
    }
    for (const outside of outsides) removeOutsideFolder(outside)
    await resetOwnership(request)
    await resetMcpSettings(page)
  })

  test('a NUL byte in a path is refused as an invalid path', async ({ page, request }) => {
    test.setTimeout(120_000)

    const testId = await testWithKeptFile(page, request)
    await enableMcpUntilRestart(page, MCP_PORT)

    const deleted = callTool(MCP_PORT, 'delete_testdata', { test_ref: testId, path: 'kept\u0000.csv' })
    expectRefusal(deleted, 'deleted', 'Invalid test data path: kept\u0000.csv')
    expect(await readTestDataContent(request, testId, 'kept.csv')).toBe(KEPT)
  })

  test('a path through a folder outside is refused even where its entry links back inside', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)

    const testId = await testWithKeptFile(page, request)
    await enableMcpUntilRestart(page, MCP_PORT)
    const folder = testFolder(testId)
    const outside = outsideFolder()
    fs.symlinkSync(path.join(folder, 'kept.csv'), path.join(outside, 'back.csv'))
    fs.chmodSync(outside, 0o755)
    plantLinks(folder, [['linked', outside]])
    const modesBefore = modesUnder(outside)

    await test.step('delete_testdata refuses it and the link outside stays', async () => {
      const deleted = callTool(MCP_PORT, 'delete_testdata', { test_ref: testId, path: 'linked/back.csv' })
      expectRefusal(deleted, 'deleted', 'Invalid test data path: linked/back.csv')
      expect(fs.lstatSync(path.join(outside, 'back.csv')).isSymbolicLink()).toBe(true)
      expect(modesUnder(outside)).toEqual(modesBefore)
    })

    await test.step('write_testdata refuses it and writes nothing outside', async () => {
      const written = callTool(MCP_PORT, 'write_testdata', {
        test_ref: testId,
        path: 'linked/back.csv',
        content: 'planted',
        replace: true,
      })
      expectRefusal(written, 'written', 'Invalid test data path: linked')
      expect(fs.lstatSync(path.join(outside, 'back.csv')).isSymbolicLink()).toBe(true)
      expect(modesUnder(outside)).toEqual(modesBefore)
      expect(await readTestDataContent(request, testId, 'kept.csv')).toBe(KEPT)
    })
  })

  test('a rename through a folder outside is refused and moves nothing', async ({ page, request }) => {
    test.setTimeout(120_000)

    const testId = await testWithKeptFile(page, request)
    await enableMcpUntilRestart(page, MCP_PORT)
    const folder = testFolder(testId)
    const outside = outsideFolder()
    fs.symlinkSync(path.join(folder, 'kept.csv'), path.join(outside, 'back.csv'))
    fs.chmodSync(outside, 0o755)
    plantLinks(folder, [['linked', outside]])
    const modesBefore = modesUnder(outside)

    const renamed = callTool(MCP_PORT, 'rename_testdata', {
      test_ref: testId,
      path: 'linked/back.csv',
      new_path: 'moved.csv',
    })
    expectRefusal(renamed, 'renamed', 'Invalid test data path: linked/back.csv')
    expect(fs.lstatSync(path.join(outside, 'back.csv')).isSymbolicLink()).toBe(true)
    expect(modesUnder(outside)).toEqual(modesBefore)
    expect(await listTestDataPaths(request, testId)).toEqual(['kept.csv'])
  })

  test('an upload through a folder link lands in the real folder and leaves it read-only', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)

    const testId = await testWithKeptFile(page, request)
    await createTestDataFolder(request, testId, 'fixtures')
    const folder = testFolder(testId)
    plantLinks(folder, [['alias', path.join(folder, 'fixtures')]])

    const stored = await uploadTestData(request, testId, 'alias', 'a.csv', KEPT, { mimeType: 'text/csv' })

    expect(stored.path).toBe('alias/a.csv')
    expect(fs.readFileSync(path.join(folder, 'fixtures', 'a.csv'), 'utf-8')).toBe(KEPT)
    expect(modeOf(path.join(folder, 'fixtures')), 'the real folder is read-only again').toBe('500')
    expect(modeOf(path.join(folder, 'fixtures', 'a.csv'))).toBe('400')
  })

  test('two links that point at each other are an invalid path, not a server error', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)

    const testId = await testWithKeptFile(page, request)
    await enableMcpUntilRestart(page, MCP_PORT)
    plantLinks(testFolder(testId), [
      ['ping', 'pong'],
      ['pong', 'ping'],
    ])

    await expectInvalidContent(request, testId, 'ping')
    await expectInvalidContent(request, testId, 'ping/x')
    const deleted = callTool(MCP_PORT, 'delete_testdata', { test_ref: testId, path: 'ping' })
    expectRefusal(deleted, 'deleted', 'Invalid test data path: ping')
    expect(await listTestDataPaths(request, testId)).toEqual(['kept.csv'])
  })

  test('a clone copies links that stay inside the folder and none that lead out of it', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)

    const testId = await testWithKeptFile(page, request)
    const outside = outsideFolder()
    const folder = testFolder(testId)
    plantLinks(folder, [
      ['alias.csv', path.join(folder, 'kept.csv')],
      ['escape.txt', path.join(outside, 'secret.txt')],
      ['escdir', path.join(outside, 'sub')],
    ])

    const cloneId = await cloneTest(request, testId)
    created.push(cloneId)

    expect(await listTestDataPaths(request, cloneId)).toEqual(['alias.csv', 'kept.csv'])
    expect(await readTestDataContent(request, cloneId, 'alias.csv')).toBe(KEPT)
  })

  test('a clone leaves out a link back up into the folder it is copying', async ({ page, request }) => {
    test.setTimeout(120_000)

    const testId = await testWithKeptFile(page, request)
    await createTestDataFolder(request, testId, 'sub')
    await uploadTestData(request, testId, 'sub', 'a.csv', KEPT, { mimeType: 'text/csv' })
    plantLinks(path.join(testFolder(testId), 'sub'), [['up', '..']])

    const cloneId = await cloneTest(request, testId)
    created.push(cloneId)

    expect(await listTestDataPaths(request, cloneId)).toEqual(['kept.csv', 'sub', 'sub/a.csv'])
    expect(modesUnder(testFolder(cloneId))).toEqual({
      '.': '500',
      'kept.csv': '400',
      sub: '500',
      'sub/a.csv': '400',
    })
  })

  test('a clone copies two folders that link to each other once each', async ({ page, request }) => {
    test.setTimeout(120_000)

    const testId = await testWithKeptFile(page, request)
    for (const name of ['one', 'two']) {
      await createTestDataFolder(request, testId, name)
      await uploadTestData(request, testId, name, `${name}.csv`, name, { mimeType: 'text/csv' })
    }
    const folder = testFolder(testId)
    plantLinks(path.join(folder, 'one'), [['to-two', path.join(folder, 'two')]])
    plantLinks(path.join(folder, 'two'), [['to-one', path.join(folder, 'one')]])

    const cloneId = await cloneTest(request, testId)
    created.push(cloneId)

    expect(await listTestDataPaths(request, cloneId)).toEqual([
      'kept.csv',
      'one',
      'one/one.csv',
      'one/to-two',
      'one/to-two/two.csv',
      'two',
      'two/to-one',
      'two/to-one/one.csv',
      'two/two.csv',
    ])
  })

  test('a clone leaves out links that lead nowhere', async ({ page, request }) => {
    test.setTimeout(120_000)

    const testId = await testWithKeptFile(page, request)
    plantLinks(testFolder(testId), [
      ['gone.csv', 'missing.csv'],
      ['ping', 'pong'],
      ['pong', 'ping'],
    ])

    const cloneId = await cloneTest(request, testId)
    created.push(cloneId)

    expect(fs.readdirSync(testFolder(cloneId))).toEqual(['kept.csv'])
    expect(await readTestDataContent(request, cloneId, 'kept.csv')).toBe(KEPT)
  })

  test('a data folder that is a link reaches nothing outside, and deleting the test leaves its target as it was', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)

    const testId = await importFixtureTest(page, loadFixture())
    created.push(testId)
    await enableMcpUntilRestart(page, MCP_PORT)
    const outside = outsideFolder()
    const folder = testFolder(testId)
    fs.mkdirSync(path.dirname(folder), { recursive: true })
    fs.symlinkSync(outside, folder)
    const modesBefore = modesUnder(outside)

    await test.step('the listing is empty and no file it points at is served', async () => {
      expect(await listTestDataPaths(request, testId)).toEqual([])
      await expectInvalidContent(request, testId, 'secret.txt')
      await expectInvalidContent(request, testId, 'sub/key')
    })

    await test.step('a write into the folder is refused and lands nowhere', async () => {
      const written = callTool(MCP_PORT, 'write_testdata', {
        test_ref: testId,
        path: 'planted.txt',
        content: 'x',
      })
      expectRefusal(written, 'written', 'Invalid test data path: ')
      expect(fs.readdirSync(outside).sort()).toEqual(['secret.txt', 'sub'])
    })

    await test.step('deleting the test removes the link and leaves the folder it points at untouched', async () => {
      const response = await request.delete(`${BACKEND_URL}/tests/${testId}`)
      expect(response.ok(), `DELETE /tests/${testId} answered ${response.status()}: ${await response.text()}`).toBe(true)
      created.splice(created.indexOf(testId), 1)
      expect(fs.existsSync(folder), 'the link is gone with the test').toBe(false)
      expect(fs.readFileSync(path.join(outside, 'sub', 'key'), 'utf-8')).toBe(OUTSIDE_KEY)
      expect(modesUnder(outside)).toEqual(modesBefore)
    })
  })

  test('rename_testdata refuses "." as an invalid path, not as a server error', async ({ page, request }) => {
    test.setTimeout(120_000)

    const testId = await testWithKeptFile(page, request)
    await enableMcpUntilRestart(page, MCP_PORT)

    const renamed = callTool(MCP_PORT, 'rename_testdata', { test_ref: testId, path: '.', new_path: 'moved' })
    expectRefusal(renamed, 'renamed', 'Invalid test data path: .')
    expect(await listTestDataPaths(request, testId)).toEqual(['kept.csv'])
  })

  test('delete_testdata refuses "." and every file stays', async ({ page, request }) => {
    test.setTimeout(120_000)

    const testId = await testWithKeptFile(page, request)
    await enableMcpUntilRestart(page, MCP_PORT)

    const deleted = callTool(MCP_PORT, 'delete_testdata', { test_ref: testId, path: '.' })
    expectRefusal(deleted, 'deleted', 'Invalid test data path: .')
    expect(await listTestDataPaths(request, testId)).toEqual(['kept.csv'])
  })
})
