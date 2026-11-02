/**
 * SH-19: the INFO start line of the three local blocks, and the non-zero exit message
 * Wireframe: N/A (no visual surface)
 * Design Decisions: SHRUN-12, PYRUN-11
 * REQ: REQ-3.4.1.1, REQ-3.4.1.2, REQ-3.4.1.18
 *
 * Pass Criteria:
 * 1. Shell Script, Shell Exec and Python each write exactly ONE INFO console line as
 *    they start, naming the program that runs the script: `Running the script under
 *    {program} on the WAVE server` and, for Shell Exec, `Running the command under
 *    {shell} on the WAVE server`. The eleven blocks write eleven such lines and no more,
 *    all at INFO, sourced to the block that wrote them.
 * 2. No start line carries the typed script's own text, and none carries Shell Exec's
 *    command: the three planted body markers appear nowhere on the console.
 * 3. In File mode the line names the script file as written:
 *    `Running testdata://scripts/sl-probe.sh under /bin/sh on the WAVE server`.
 * 4. A Python block with an empty Interpreter row says `WAVE's own interpreter`.
 * 5. A non-zero exit whose Stderr has a non-blank line fails with
 *    `Script exited with code {n}: {last non-blank Stderr line}`, trimmed and cut to 200
 *    characters, and `Command exited with code {n}: ...` for Shell Exec.
 * 6. Empty or whitespace-only Stderr keeps the bare `Script exited with code {n}`.
 * 7. A Stderr marked secret gives the bare message, masks the bound Stderr variable, and
 *    puts no secret text on the console.
 * 8. The run passes and reaches its bookend.
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import { getActiveSessionId, getSessionVariables } from '../../helpers/fixture-import'
import { expectNodeStatus, expectNodesSuccess, finishRun, startRun } from '../../helpers/k8s-run'
import { getLogCopyTexts, type LogEntry } from '../../helpers/log-reader'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import { deleteTest, importWithTestData, type SeedFile } from '../file-picker/picker'
import {
  blockSource,
  consoleEntriesFromCopy,
  newToken,
  sourcePlugin,
  withToken,
} from './shell-helpers'

/** Every block in the fixture writes one start line; the Log bookend writes none. */
const BLOCK_COUNT = 11

const RECORDED_NODES = [
  'sl-exit-short',
  'sl-exit-long',
  'sl-exit-bare',
  'sl-exit-ws',
  'sl-secret',
  'sl-exec-exit',
  'sl-py-exit',
]

const createdTests: string[] = []

function loadFixture(token: string): Record<string, unknown> {
  const raw = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-start-line.json'), 'utf-8'),
  ) as Record<string, unknown>
  return withToken(raw, token)
}

// The palette name of each block type that writes a start line.
const PALETTE_NAMES: Record<string, string> = {
  'shell-script': 'Shell Script',
  'shell-exec': 'Shell Exec',
  python: 'Python',
}

/** The source every block in the fixture writes (EXEC-25); the Log bookend writes no start line. */
function fixtureBlockSources(token: string): string[] {
  const workflow = loadFixture(token).workflow as {
    nodes: Array<{ data: Record<string, string> }>
  }
  return workflow.nodes
    .filter((node) => node.data.elementType !== 'log')
    .map((node) => blockSource(PALETTE_NAMES[node.data.elementType], node.data.label))
    .sort()
}

function seedFiles(token: string): SeedFile[] {
  return [
    {
      folder: 'scripts',
      name: 'sl-probe.sh',
      body: Buffer.from(`echo sl-file-ran-${token}\n`),
    },
  ]
}

test.describe('SH-19: the start line and the non-zero exit message', () => {
  test.afterAll(async ({ request }) => {
    while (createdTests.length > 0) await deleteTest(request, createdTests.pop() as string)
  })

  test('SH-19 each block says what runs its script, and a non-zero exit names the last Stderr line', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const token = newToken()
    const testId = await importWithTestData(page, loadFixture(token), seedFiles(token))
    createdTests.push(testId)

    const status = await startRun(page)
    const sessionId = await getActiveSessionId(page)
    await finishRun(page, status, `SH-19-done-${token}`, 150_000)

    const entries: LogEntry[] = consoleEntriesFromCopy(await getLogCopyTexts(page))
    const consoleText = entries.map((entry) => `[${entry.level}] ${entry.source}: ${entry.message}`).join('\n')
    const variables = await getSessionVariables(page, sessionId)

    const startLines = entries.filter((entry) => entry.message.startsWith('Running '))
    const warns = entries.filter((entry) => entry.level === 'WARN').map((entry) => entry.message)

    const EXPECTED_START_LINES: Record<string, number> = {
      'Running the script under /bin/bash on the WAVE server': 5,
      'Running testdata://scripts/sl-probe.sh under /bin/sh on the WAVE server': 1,
      'Running the command under /bin/sh on the WAVE server': 1,
      "Running the script under WAVE's own interpreter on the WAVE server": 1,
      'Running the script under /bin/bash -o pipefail on the WAVE server': 1,
      'Running the command under /bin/bash on the WAVE server': 1,
      'Running the script under python3 on the WAVE server': 1,
    }

    await test.step('one INFO start line per block, naming the program that runs it', async () => {
      expect(
        startLines.length,
        `eleven blocks write eleven start lines.\n${consoleText}`,
      ).toBe(BLOCK_COUNT)
      expect([...new Set(startLines.map((entry) => entry.level))]).toEqual(['INFO'])
      expect(
        [...new Set(startLines.map((entry) => sourcePlugin(entry.source)))].sort(),
      ).toEqual(['Python', 'Shell Exec', 'Shell Script'])
      expect(
        startLines.map((entry) => entry.source).sort(),
        `each start line is sourced to the block that wrote it.\n${consoleText}`,
      ).toEqual(fixtureBlockSources(token))

      const counted: Record<string, number> = {}
      for (const entry of startLines) counted[entry.message] = (counted[entry.message] ?? 0) + 1
      expect(counted, `start lines seen:\n${startLines.map((e) => e.message).join('\n')}`).toEqual(
        EXPECTED_START_LINES,
      )
    })

    await test.step('File mode names the script file as written', async () => {
      const line = startLines.find((entry) => entry.message.includes('testdata://'))
      expect(line?.message).toBe(
        'Running testdata://scripts/sl-probe.sh under /bin/sh on the WAVE server',
      )
      expect(sourcePlugin(line?.source ?? '')).toBe('Shell Script')
    })

    await test.step("an empty Interpreter row says WAVE's own interpreter", async () => {
      const line = startLines.find((entry) => entry.message.includes("WAVE's own interpreter"))
      expect(line?.message).toBe(
        "Running the script under WAVE's own interpreter on the WAVE server",
      )
      expect(sourcePlugin(line?.source ?? '')).toBe('Python')
    })

    await test.step('no typed script body and no command text reaches the console', async () => {
      for (const marker of [
        `sl-typed-body-${token}`,
        `sl-exec-cmd-${token}`,
        `sl-py-body-${token}`,
      ]) {
        expect(consoleText, `the console must never echo ${marker}`).not.toContain(marker)
      }
    })

    await test.step('a non-zero exit names the last non-blank Stderr line, trimmed', async () => {
      const shortMessage = `Script exited with code 3: sl-last-${token}`
      expect(variables.e_short.value).toBe(shortMessage)
      expect(variables.c_short.value).toBe(3)
      expect(variables.r_short.value).toBe('NonZeroExit')
      expect(warns).toContain(`Script failed (NonZeroExit): ${shortMessage}`)
    })

    await test.step('a long Stderr line is cut to 200 characters', async () => {
      expect(variables.e_long.value).toBe(`Script exited with code 4: ${'L'.repeat(200)}`)
    })

    await test.step('Shell Exec says Command exited with code n and names the line', async () => {
      const execMessage = `Command exited with code 9: sl-cmd-err-${token}`
      expect(variables.e_exec.value).toBe(execMessage)
      expect(warns).toContain(`Command failed (NonZeroExit): ${execMessage}`)
    })

    await test.step('a Python non-zero exit names its Stderr line too', async () => {
      const pyMessage = `Script exited with code 8: sl-py-err-${token}`
      expect(variables.e_py.value).toBe(pyMessage)
      expect(variables.c_py.value).toBe(8)
    })

    await test.step('empty or whitespace-only Stderr keeps the bare message', async () => {
      expect(variables.e_bare.value).toBe('Script exited with code 5')
      expect(variables.e_ws.value).toBe('Script exited with code 6')
    })

    await test.step('a Stderr marked secret gives the bare message and leaks nothing', async () => {
      const canary = `sl-canary-${token}-real`
      expect(variables.e_secret.value).toBe('Script exited with code 7')
      expect(variables.sec_err.value, 'the marked Stderr masks').toBe(SECRET_MASK)
      expect(warns).toContain('Script failed (NonZeroExit): Script exited with code 7')
      expectNoSecret(consoleText, 'console log', [canary], 'sl-canary-')
      expectNoSecret(JSON.stringify(variables), 'session variables', [canary], 'sl-canary-')
    })

    await expectNodesSuccess(page, ['sl-typed', 'sl-file', 'sl-exec', 'sl-py'])
    for (const node of RECORDED_NODES) await expectNodeStatus(page, node, 'warning')
  })
})
