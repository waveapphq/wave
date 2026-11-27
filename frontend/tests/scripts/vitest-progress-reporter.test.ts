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
  diff?: string
}

interface FakeModule {
  type: 'module'
  moduleId: string
  state: () => string
  ok: () => boolean
  errors: () => FakeError[]
  children?: { allTests: (state?: string) => Generator<FakeTestCase, void, void> }
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
  onUserConsoleLog: (log: { type: 'stdout' | 'stderr'; content: string }) => void
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

type TestStateName = 'passed' | 'failed' | 'skipped'

interface FakeRun {
  modules: FakeModule[]
  cases: FakeTestCase[]
}

// Test files with their test cases; each module also lists its cases the way vitest's TestModule does.
function fakeRun(files: Record<string, TestStateName[]>): FakeRun {
  const modules: FakeModule[] = []
  const cases: FakeTestCase[] = []
  for (const [relativePath, states] of Object.entries(files)) {
    const own: FakeTestCase[] = []
    const testModule: FakeModule = {
      ...fakeModule(relativePath),
      children: {
        *allTests(state?: string) {
          for (const testCase of own) {
            if (state === undefined || testCase.result().state === state) yield testCase
          }
        },
      },
    }
    states.forEach((state, index) => {
      own.push(fakeStateCase(testModule, `case ${index + 1}`, state))
    })
    modules.push(testModule)
    cases.push(...own)
  }
  return { modules, cases }
}

function fakeStateCase(module: FakeModule, name: string, state: TestStateName): FakeTestCase {
  const errors = state === 'failed' ? [fakeError(`${name} failed`)] : []
  return {
    type: 'test',
    name,
    fullName: `math > ${name}`,
    module,
    ok: () => state !== 'failed',
    result: () => ({ state, errors }),
  }
}

async function finishRun(reporter: ProgressReporter, run: FakeRun): Promise<void> {
  for (const testCase of run.cases) {
    await reporter.onTestCaseResult(testCase)
  }
  for (const testModule of run.modules) {
    await reporter.onTestModuleEnd(testModule)
  }
  const failed = run.cases.some((testCase) => testCase.result().state === 'failed')
  await reporter.onTestRunEnd(run.modules, [], failed ? 'failed' : 'passed')
}

function countLines(): string[] {
  return lines().filter((line) => line.startsWith('Tests:'))
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

describe('vitest progress reporter, test count line', () => {
  it('prints the passed, failed and skipped counts and the file count once the run ends', async () => {
    const run = fakeRun({
      [FILES[0]]: ['passed', 'passed', 'failed'],
      [FILES[1]]: ['skipped', 'passed'],
      [FILES[2]]: ['skipped'],
    })
    const reporter = await startRun(FILES.slice(0, 3))

    await finishRun(reporter, run)

    expect(countLines()).toEqual(['Tests: 3 passed, 1 failed, 2 skipped (3 files)'])
  })

  it('prints zero failed and zero skipped for an all green run', async () => {
    const run = fakeRun({ [FILES[0]]: ['passed', 'passed'], [FILES[1]]: ['passed', 'passed'] })
    const reporter = await startRun(FILES.slice(0, 2))

    await finishRun(reporter, run)

    expect(countLines()).toEqual(['Tests: 4 passed, 0 failed, 0 skipped (2 files)'])
  })

  it('counts every failed test, across files', async () => {
    const run = fakeRun({
      [FILES[0]]: ['failed', 'failed'],
      [FILES[1]]: ['passed'],
      [FILES[2]]: ['failed'],
      [FILES[3]]: ['passed', 'skipped'],
    })
    const reporter = await startRun()

    await finishRun(reporter, run)

    expect(countLines()).toEqual(['Tests: 2 passed, 3 failed, 1 skipped (4 files)'])
  })

  it('prints no count line before the run ends', async () => {
    const run = fakeRun({ [FILES[0]]: ['passed'], [FILES[1]]: ['failed'] })
    const reporter = await startRun(FILES.slice(0, 2))
    for (const testCase of run.cases) {
      await reporter.onTestCaseResult(testCase)
    }
    for (const testModule of run.modules) {
      await reporter.onTestModuleEnd(testModule)
    }

    await vi.advanceTimersByTimeAsync(120_000)

    expect(countLines()).toEqual([])
  })

  it('prints the count line as the last line of the run', async () => {
    const run = fakeRun({ [FILES[0]]: ['passed'], [FILES[1]]: ['failed'] })
    const reporter = await startRun(FILES.slice(0, 2))

    await finishRun(reporter, run)

    expect(lines().filter((line) => line !== '').at(-1)).toBe('Tests: 1 passed, 1 failed, 0 skipped (2 files)')
  })

  it('prints the count line after an unhandled error too', async () => {
    const run = fakeRun({ [FILES[0]]: ['passed', 'skipped'], [FILES[1]]: ['passed'] })
    const reporter = await startRun(FILES.slice(0, 2))
    for (const testCase of run.cases) {
      await reporter.onTestCaseResult(testCase)
    }
    for (const testModule of run.modules) {
      await reporter.onTestModuleEnd(testModule)
    }

    await reporter.onTestRunEnd(run.modules, [fakeError('a timer threw after the test')], 'failed')

    expect(countLines()).toEqual(['Tests: 2 passed, 0 failed, 1 skipped (2 files)'])
  })

  it('prints exactly one count line, also when progress lines keep coming', async () => {
    const run = fakeRun({ [FILES[0]]: ['passed'], [FILES[1]]: ['passed'] })
    const reporter = await startRun(FILES.slice(0, 2))
    await vi.advanceTimersByTimeAsync(60_000)

    await finishRun(reporter, run)
    await vi.advanceTimersByTimeAsync(300_000)

    expect(countLines()).toHaveLength(1)
  })

  it('starts counting again for each run in the same process', async () => {
    const first = fakeRun({ [FILES[0]]: ['passed', 'failed'] })
    const second = fakeRun({ [FILES[1]]: ['passed'], [FILES[2]]: ['skipped'] })
    const reporter = await startRun(FILES.slice(0, 1))
    await finishRun(reporter, first)
    output = ''

    await reporter.onTestRunStart(FILES.slice(1, 3).map(fakeSpecification))
    await finishRun(reporter, second)

    expect(countLines()).toEqual(['Tests: 1 passed, 0 failed, 1 skipped (2 files)'])
  })
})

describe('vitest progress reporter, error text', () => {
  it('prints an assertion diff under its message', async () => {
    const reporter = await startRun()
    const diff = '- Expected\n+ Received\n\n- 4\n+ 3'

    await reporter.onTestCaseResult(
      fakeTestCase(fakeModule(FILES[0]), 'adds two numbers', { ...fakeError('expected 3 to be 4'), diff }),
    )

    expect(output).toContain(`AssertionError: expected 3 to be 4\n${diff}\n    at math.test.ts:12:5`)
  })

  it('prints a thrown value that is not an Error by its text, with no stack', async () => {
    const reporter = await startRun()

    await reporter.onTestRunEnd([], ['a plain string was thrown'], 'failed')

    expect(output).toContain('Unhandled error\nError: a plain string was thrown\nTests:')
  })
})

describe('vitest progress reporter, console output', () => {
  it.each([
    ['stdout', 'a log line\n', 'a log line\n'],
    ['stdout', 'a log line', 'a log line\n'],
    ['stderr', 'a warning\n', 'a warning\n'],
    ['stderr', 'a warning', 'a warning\n'],
  ] as const)('passes a test\'s %s line %j through as one whole line', async (type, content, written) => {
    const reporter = await startRun()
    const own = type === 'stderr' ? process.stderr : process.stdout
    const other = type === 'stderr' ? process.stdout : process.stderr

    reporter.onUserConsoleLog({ type, content })

    expect(own.write).toHaveBeenCalledWith(written)
    expect(other.write).not.toHaveBeenCalled()
  })
})

describe('vitest progress reporter, empty run', () => {
  it('prints 0% for a run with no test files', async () => {
    await startRun([])

    await vi.advanceTimersByTimeAsync(60_000)

    expect(progressLines()).toEqual(['Progress: 0%'])
  })
})
