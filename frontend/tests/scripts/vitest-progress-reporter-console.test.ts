/**
 * @vitest-environment node
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The CI's stderr gate must still see a test's console output through the reporter.
const FRONTEND_DIR = fileURLToPath(new URL('../..', import.meta.url))
const REPORTER = path.join(FRONTEND_DIR, 'scripts', 'vitest-progress-reporter.mjs')
const VITEST = path.join(FRONTEND_DIR, 'node_modules', 'vitest', 'vitest.mjs')

const STDERR_TEXT = 'Warning: a React warning the CI stderr gate must see'
const STDOUT_TEXT = 'a console.log line from a test'

let fixtureDir = ''
let run: { status: number | null; stdout: string; stderr: string }

beforeAll(() => {
  fixtureDir = mkdtempSync(path.join(tmpdir(), 'vitest-reporter-console-'))
  writeFileSync(
    path.join(fixtureDir, 'vitest.config.mjs'),
    "export default { test: { globals: true, environment: 'node', include: ['*.test.mjs'] } }\n",
  )
  writeFileSync(
    path.join(fixtureDir, 'logs.test.mjs'),
    [
      "test('writes to the console', () => {",
      `  console.error(${JSON.stringify(STDERR_TEXT)})`,
      `  console.log(${JSON.stringify(STDOUT_TEXT)})`,
      '  expect(1).toBe(1)',
      '})',
      '',
    ].join('\n'),
  )
  writeFileSync(
    path.join(fixtureDir, 'counts.test.mjs'),
    [
      "test('passes', () => {",
      '  expect(2).toBe(2)',
      '})',
      '',
      "test.skip('is skipped', () => {",
      '  expect(1).toBe(2)',
      '})',
      '',
    ].join('\n'),
  )
  const result = spawnSync(
    process.execPath,
    [VITEST, 'run', '--root', fixtureDir, '--config', path.join(fixtureDir, 'vitest.config.mjs'), `--reporter=${REPORTER}`],
    { cwd: fixtureDir, encoding: 'utf8', env: { ...process.env, CI: '1', WAVE_CI_PROGRESS_SECONDS: '60' }, timeout: 60_000 },
  )
  run = { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}, 90_000)

afterAll(() => {
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true })
})

describe('vitest progress reporter, test console output and count line', () => {
  it('runs the fixture test file green', () => {
    expect(run.status).toBe(0)
  })

  it("passes a test's console.error text through to stderr, where the CI stderr gate reads it", () => {
    expect(run.stderr).toContain(STDERR_TEXT)
  })

  it("passes a test's console.log text through to stdout", () => {
    expect(run.stdout).toContain(STDOUT_TEXT)
  })

  it('ends a real run with the one test count line', () => {
    const counts = run.stdout.split('\n').filter((line) => line.startsWith('Tests:'))

    expect(counts).toEqual(['Tests: 2 passed, 0 failed, 1 skipped (2 files)'])
  })
})
