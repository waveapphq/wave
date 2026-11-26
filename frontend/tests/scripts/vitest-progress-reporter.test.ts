/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const REPORTER_URL = new URL('../../scripts/vitest-progress-reporter.mjs', import.meta.url)

const ROOT = '/workspace/frontend'

interface FakeError {
  name: string
  message: string
  stack: string
}

interface FakeModule {
  type: 'module'
  moduleId: string
  state: () => string
  ok: () => boolean
  errors: () => FakeError[]
}

interface FakeTestCase {
  type: 'test'
  name: string
  fullName: string
  module: FakeModule
  ok: () => boolean
  result: () => { state: string; errors: FakeError[] }
}

interface ProgressReporter {
  onInit?: (ctx: unknown) => void
  onTestRunStart: (specifications: ReadonlyArray<unknown>) => void | Promise<void>
  onTestModuleEnd: (testModule: FakeModule) => void | Promise<void>
  onTestCaseResult: (testCase: FakeTestCase) => void | Promise<void>
  onTestRunEnd: (
    testModules: ReadonlyArray<FakeModule>,
    unhandledErrors: ReadonlyArray<unknown>,
    reason: string,
  ) => void | Promise<void>
}

type ReporterClass = new (options?: Record<string, unknown>) => ProgressReporter

async function loadReporter(): Promise<ReporterClass> {
  const reporterModule = (await import(/* @vite-ignore */ REPORTER_URL.href)) as {
    default: ReporterClass
  }
  return reporterModule.default
}

function fakeError(message: string): FakeError {
  return { name: 'AssertionError', message, stack: `AssertionError: ${message}\n    at math.test.ts:12:5` }
}

function fakeModule(relativePath: string, errors: FakeError[] = []): FakeModule {
  return {
    type: 'module',
    moduleId: `${ROOT}/${relativePath}`,
    state: () => (errors.length > 0 ? 'failed' : 'passed'),
    ok: () => errors.length === 0,
    errors: () => errors,
  }
}

function fakeSpecification(relativePath: string) {
  return { moduleId: `${ROOT}/${relativePath}`, project: { name: '', config: { root: ROOT } } }
}

function fakeTestCase(module: FakeModule, name: string, error?: FakeError): FakeTestCase {
  return {
    type: 'test',
    name,
    fullName: `math > ${name}`,
    module,
    ok: () => error === undefined,
    result: () =>
      error === undefined ? { state: 'passed', errors: [] } : { state: 'failed', errors: [error] },
  }
}

const FILES = [
  'tests/lib/math.test.ts',
  'tests/lib/strings.test.ts',
  'tests/lib/dates.test.ts',
  'tests/lib/lists.test.ts',
]

let output = ''

function record(chunk: unknown): boolean {
  output += typeof chunk === 'string' ? chunk : String(chunk)
  return true
}

function recordLine(...args: unknown[]): void {
  output += `${args.map(String).join(' ')}\n`
}

function lines(): string[] {
  return output.split('\n').map((line) => line.trimEnd())
}

function progressLines(): string[] {
  return lines().filter((line) => line.includes('Progress:'))
}

const fakeVitest = {
  config: { root: ROOT },
  logger: { log: recordLine, error: recordLine, warn: recordLine, info: recordLine, console },
}

async function startRun(files: string[] = FILES): Promise<ProgressReporter> {
  const Reporter = await loadReporter()
  const reporter = new Reporter()
  reporter.onInit?.(fakeVitest)
  await reporter.onTestRunStart(files.map(fakeSpecification))
  return reporter
}

beforeEach(() => {
  output = ''
  vi.useFakeTimers()
  vi.stubEnv('WAVE_CI_PROGRESS_SECONDS', undefined)
  vi.spyOn(process.stdout, 'write').mockImplementation(record)
  vi.spyOn(process.stderr, 'write').mockImplementation(record)
  vi.spyOn(console, 'log').mockImplementation(recordLine)
  vi.spyOn(console, 'info').mockImplementation(recordLine)
  vi.spyOn(console, 'warn').mockImplementation(recordLine)
  vi.spyOn(console, 'error').mockImplementation(recordLine)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('vitest progress reporter', () => {
  it('is the default export, a class vitest can construct', async () => {
    const Reporter = await loadReporter()

    expect(typeof Reporter).toBe('function')
    expect(() => new Reporter()).not.toThrow()
  })

  it('prints no progress line before the first interval ends', async () => {
    const reporter = await startRun()
    await reporter.onTestModuleEnd(fakeModule(FILES[0]))

    await vi.advanceTimersByTimeAsync(59_000)

    expect(progressLines()).toEqual([])
  })

  it('prints the share of test files done every 60 seconds by default', async () => {
    const reporter = await startRun()

    await reporter.onTestModuleEnd(fakeModule(FILES[0]))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(progressLines()).toEqual(['Progress: 25%'])

    await reporter.onTestModuleEnd(fakeModule(FILES[1]))
    await reporter.onTestModuleEnd(fakeModule(FILES[2]))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(progressLines()).toEqual(['Progress: 25%', 'Progress: 75%'])
  })

  it('prints the progress line as one whole line', async () => {
    const reporter = await startRun()
    await reporter.onTestModuleEnd(fakeModule(FILES[0]))

    await vi.advanceTimersByTimeAsync(60_000)

    expect(lines()).toContain('Progress: 25%')
  })

  it('prints 0% while no test file has finished yet', async () => {
    await startRun()

    await vi.advanceTimersByTimeAsync(60_000)

    expect(progressLines()).toEqual(['Progress: 0%'])
  })

  it('keeps printing at each interval while a long test file runs', async () => {
    const reporter = await startRun()
    await reporter.onTestModuleEnd(fakeModule(FILES[0]))
    await reporter.onTestModuleEnd(fakeModule(FILES[1]))

    await vi.advanceTimersByTimeAsync(180_000)

    expect(progressLines()).toEqual(['Progress: 50%', 'Progress: 50%', 'Progress: 50%'])
  })

  it('takes its interval from WAVE_CI_PROGRESS_SECONDS', async () => {
    vi.stubEnv('WAVE_CI_PROGRESS_SECONDS', '5')
    const reporter = await startRun()
    await reporter.onTestModuleEnd(fakeModule(FILES[0]))

    await vi.advanceTimersByTimeAsync(4_000)
    expect(progressLines()).toEqual([])

    await vi.advanceTimersByTimeAsync(1_000)
    expect(progressLines()).toEqual(['Progress: 25%'])

    await vi.advanceTimersByTimeAsync(5_000)
    expect(progressLines()).toEqual(['Progress: 25%', 'Progress: 25%'])
  })

  it('counts against the total of the run it is given', async () => {
    const reporter = await startRun(FILES.slice(0, 2))
    await reporter.onTestModuleEnd(fakeModule(FILES[0]))

    await vi.advanceTimersByTimeAsync(60_000)

    expect(progressLines()).toEqual(['Progress: 50%'])
  })

  it('counts a failed test file as done', async () => {
    const reporter = await startRun()
    const failed = fakeModule(FILES[0])
    await reporter.onTestCaseResult(fakeTestCase(failed, 'adds two numbers', fakeError('expected 3 to be 4')))
    await reporter.onTestModuleEnd({ ...failed, state: () => 'failed', ok: () => false })

    await vi.advanceTimersByTimeAsync(60_000)

    expect(progressLines()).toEqual(['Progress: 25%'])
  })

  it('stops printing progress once the run ends', async () => {
    const reporter = await startRun()
    const modules = FILES.map((file) => fakeModule(file))
    for (const testModule of modules) {
      await reporter.onTestModuleEnd(testModule)
    }
    await reporter.onTestRunEnd(modules, [], 'passed')
    const before = progressLines().length

    await vi.advanceTimersByTimeAsync(300_000)

    expect(progressLines()).toHaveLength(before)
  })

  it('prints a failed test with its file, test name and error at once, before any interval ends', async () => {
    const reporter = await startRun()
    const testModule = fakeModule(FILES[0])

    await reporter.onTestCaseResult(
      fakeTestCase(testModule, 'adds two numbers', fakeError('expected 3 to be 4')),
    )

    expect(output).toContain('tests/lib/math.test.ts')
    expect(output).toContain('adds two numbers')
    expect(output).toContain('expected 3 to be 4')
    expect(progressLines()).toEqual([])
  })

  it('prints every failure, one after another', async () => {
    const reporter = await startRun()
    const math = fakeModule(FILES[0])
    const strings = fakeModule(FILES[1])

    await reporter.onTestCaseResult(fakeTestCase(math, 'adds two numbers', fakeError('expected 3 to be 4')))
    await reporter.onTestCaseResult(fakeTestCase(strings, 'trims the label', fakeError('expected "a " to be "a"')))

    const first = output.indexOf('adds two numbers')
    const second = output.indexOf('trims the label')
    expect(first).toBeGreaterThanOrEqual(0)
    expect(second).toBeGreaterThan(first)
    expect(output).toContain('tests/lib/strings.test.ts')
    expect(output).toContain('expected "a " to be "a"')
  })

  it('prints a test file that fails before its tests run, with its error', async () => {
    const reporter = await startRun()
    const broken = fakeModule(FILES[2], [fakeError('Failed to resolve import "./missing"')])

    await reporter.onTestModuleEnd(broken)

    expect(output).toContain('tests/lib/dates.test.ts')
    expect(output).toContain('Failed to resolve import "./missing"')
  })

  it('prints nothing for a passing test, no dots', async () => {
    const reporter = await startRun()
    const testModule = fakeModule(FILES[0])

    await reporter.onTestCaseResult(fakeTestCase(testModule, 'adds two numbers'))
    await reporter.onTestCaseResult(fakeTestCase(testModule, 'subtracts two numbers'))
    await reporter.onTestModuleEnd(testModule)

    expect(output).not.toContain('adds two numbers')
    expect(output).not.toContain('subtracts two numbers')
    expect(output).not.toContain('.')
  })
})
