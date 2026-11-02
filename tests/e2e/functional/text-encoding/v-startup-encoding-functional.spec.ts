/**
 * V-STARTUP-ENCODING-FUNCTIONAL: WAVE starts only on a host whose text encoding is UTF-8
 * Wireframe: none (no page is opened; every step runs against a backend the test starts)
 * Design Decisions: none (startup behavior)
 * REQ: REQ-4.6.9
 *
 * Each test starts its own backend (`helpers/spawn-backend.ts`) on a free port, with a config file
 * and a data folder in a new folder under the temp folder. The stack's backend is never used.
 *
 * Pass Criteria:
 * 1. ENCODING-1: started with `LC_ALL=C`, `PYTHONUTF8=0` and `PYTHONCOERCECLOCALE=0`, the backend
 *    exits with code 1 and its output holds one ERROR line that reads exactly
 *    `WAVE needs UTF-8 and this host's encoding is {encoding}: set PYTHONUTF8=1 in the environment
 *    that starts WAVE`, where `{encoding}` is the host's own name for its encoding and is not
 *    UTF-8. The refusal comes before anything else: the output names no config file and no data
 *    folder, and no data folder is made.
 * 2. ENCODING-2: with `PYTHONUTF8=1` in place of `PYTHONUTF8=0` the same start runs: `/health`
 *    answers 200, the output names the config file and the data folder and holds no refusal.
 */

import fs from 'fs'
import { test, expect } from '../../helpers/playwright-fixtures'
import { removeSpawnedBackends, spawnBackend } from '../../helpers/spawn-backend'

/** A host that is not UTF-8: the C locale with Python's own UTF-8 switches turned off. */
const NOT_UTF8 = { LC_ALL: 'C', PYTHONUTF8: '0', PYTHONCOERCECLOCALE: '0' }

const REFUSAL =
  /^\d{2}:\d{2}:\d{2}\.\d{3} ERROR WAVE needs UTF-8 and this host's encoding is (\S+): set PYTHONUTF8=1 in the environment that starts WAVE$/m

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function infoLine(message: string): RegExp {
  return new RegExp(`^\\d{2}:\\d{2}:\\d{2}\\.\\d{3} INFO  ${escapeRegExp(message)}$`, 'm')
}

test.describe('V-STARTUP-ENCODING-FUNCTIONAL: WAVE starts only on a host whose text encoding is UTF-8', () => {
  test.afterEach(async () => {
    await removeSpawnedBackends()
  })

  test('ENCODING-1: a host whose encoding is not UTF-8 stops the start and names the setting', async () => {
    const backend = await spawnBackend({ env: NOT_UTF8 })

    expect(backend.exitCode, `the backend should have exited:\n${backend.output()}`).toBe(1)
    const output = backend.output()
    const refusal = REFUSAL.exec(output)
    expect(refusal, `the output holds the refusal:\n${output}`).not.toBeNull()
    expect(refusal![1].toLowerCase(), 'the line names an encoding that is not UTF-8').not.toBe('utf-8')
    expect(output.match(new RegExp(REFUSAL.source, 'gm')), 'the refusal is logged once').toHaveLength(1)

    expect(output, 'the refusal comes before the config file is read').not.toContain('Config file: ')
    expect(output).not.toContain('Data folder: ')
    expect(fs.existsSync(backend.dataDir), 'no data folder is made').toBe(false)
  })

  test('ENCODING-2: the same host starts once PYTHONUTF8=1 is set', async ({ request }) => {
    const backend = await spawnBackend({ env: { ...NOT_UTF8, PYTHONUTF8: '1' } })

    expect(backend.exitCode, `the backend should be running:\n${backend.output()}`).toBeNull()
    expect((await request.get(`${backend.baseUrl}/health`)).status()).toBe(200)
    await expect.poll(() => backend.output()).toMatch(infoLine(`Data folder: ${backend.dataDir}`))
    expect(backend.output()).toMatch(infoLine(`Config file: ${backend.configFile}`))
    expect(backend.output()).not.toContain('WAVE needs UTF-8')
    expect(fs.statSync(backend.dataDir).isDirectory()).toBe(true)
  })
})
