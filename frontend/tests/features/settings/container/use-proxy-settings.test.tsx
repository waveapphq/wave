/**
 * useProxySettings Hook Tests
 *
 * REQ-4.7.14, REQ-4.7.16: the Proxy Setup page state - read on activation while
 * clean, staged fields, one PATCH with the changed fields on Save, Cancel, and
 * the backend check asked 300 ms after the last staged change.
 *
 * Module under test: frontend/src/features/settings/container/use-proxy-settings.ts
 */

import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, warning: vi.fn(), info: vi.fn() }),
}))

// Every request is replaced; anything else the module exports stays real.
vi.mock('@/features/settings/api/proxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/settings/api/proxy')>()),
  fetchProxySettings: vi.fn(),
  updateProxySettings: vi.fn(),
  validateProxySettings: vi.fn(),
  fetchProxyBlocks: vi.fn(),
}))

// The real hook runs; the spy only records the text it was given.
vi.mock('@/features/settings/container/use-debounced-parse', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/settings/container/use-debounced-parse')>()
  return { ...actual, useDebouncedParse: vi.fn(actual.useDebouncedParse) }
})

import {
  fetchProxySettings,
  updateProxySettings,
  validateProxySettings,
  type ProxyEntry,
  type ProxyProblem,
  type ProxyProblems,
  type ProxySettings,
} from '@/features/settings/api/proxy'
import type { PageReadStatus } from '@/features/settings/container/use-activation-read'
import { useDebouncedParse } from '@/features/settings/container/use-debounced-parse'
import {
  useProxySettings,
  type ProxyStaged,
  type UseProxySettingsResult,
} from '@/features/settings/container/use-proxy-settings'

const mockFetchProxySettings = vi.mocked(fetchProxySettings)
const mockUpdateProxySettings = vi.mocked(updateProxySettings)
const mockValidateProxySettings = vi.mocked(validateProxySettings)
const mockUseDebouncedParse = vi.mocked(useDebouncedParse)

// ============================================================================
// Fixtures
// ============================================================================

const CHECK_DELAY_MS = 300

const SAVED_ENTRIES: ProxyEntry[] = [
  { kind: 'exact', address: 'https://registry.lab.internal' },
  { kind: 'regex', address: '\\.svc\\.cluster\\.local$' },
]

/** The saved list with one more row. */
const LONGER_ENTRIES: ProxyEntry[] = [
  ...SAVED_ENTRIES,
  { kind: 'exact', address: 'http://charts.lab.internal:8080' },
]

/** The saved list with its first address again in a third row. */
const REPEATING_ENTRIES: ProxyEntry[] = [
  ...SAVED_ENTRIES,
  { kind: 'exact', address: 'https://registry.lab.internal' },
]

/** The saved rows as new objects in a new array, as the list hands them back after an edit. */
function savedRowsAgain(): ProxyEntry[] {
  return SAVED_ENTRIES.map((entry) => ({ ...entry }))
}

/** Lists as long as the saved one that differ from it in one way each. */
const CHANGED_ENTRY_LISTS: [label: string, entries: ProxyEntry[]][] = [
  ['the rows are in another order', [SAVED_ENTRIES[1], SAVED_ENTRIES[0]]],
  [
    'one row has another kind',
    [{ kind: 'regex', address: 'https://registry.lab.internal' }, SAVED_ENTRIES[1]],
  ],
  [
    'one row has another address',
    [SAVED_ENTRIES[0], { kind: 'regex', address: '\\.svc\\.cluster\\.example$' }],
  ],
]

/** A custom proxy with a stored password and two list entries. */
const CUSTOM_PROXY: ProxySettings = {
  enabled: true,
  source: 'custom',
  host: 'proxy.lab.internal',
  port: 3128,
  username: 'wave',
  password_set: true,
  list_mode: 'except',
  entries: SAVED_ENTRIES,
  proxy_local_addresses: false,
  host_values: {
    https_proxy: 'http://wave:********@proxy.corp.example:3128',
    http_proxy: null,
    no_proxy: 'localhost,.lab.internal',
  },
}

/** What a fresh install answers: off, with the defaults. */
const FRESH_PROXY: ProxySettings = {
  enabled: false,
  source: 'host',
  host: '',
  port: null,
  username: '',
  password_set: false,
  list_mode: 'except',
  entries: [],
  proxy_local_addresses: false,
  host_values: { https_proxy: null, http_proxy: null, no_proxy: null },
}

type StagedField = keyof ProxyStaged
type StagedValue = ProxyStaged[StagedField]
type StagedEdit = [StagedField, StagedValue]
type LabeledEdit = [label: string, field: StagedField, value: StagedValue]

/** One new value per case, each different from the custom proxy's saved value. */
const FIELD_EDITS: LabeledEdit[] = [
  ['the switch turned off', 'enabled', false],
  ["the WAVE host's settings as the source", 'source', 'host'],
  ['another address', 'host', 'proxy-b.lab.internal'],
  ['another port', 'port', 8080],
  ['an emptied port', 'port', null],
  ['another username', 'username', 'ci-runner'],
  ['a typed password', 'password', 'n3w-s3cret'],
  ['a removed password', 'password', ''],
  ['the other list mode', 'list_mode', 'only'],
  ['another entry list', 'entries', LONGER_ENTRIES],
  ['local addresses sent through the proxy', 'proxy_local_addresses', true],
]

/** The plain fields; the password and the entry list have their own cases. */
const PLAIN_FIELD_EDITS: LabeledEdit[] = FIELD_EDITS.filter(
  ([, field]) => field !== 'password' && field !== 'entries',
)

const HOST_PROBLEM: ProxyProblem = {
  field: 'host',
  row: null,
  message: 'IP or Hostname must be an IP address or a host name, with no protocol and no port',
}

const PORT_PROBLEM: ProxyProblem = {
  field: 'port',
  row: null,
  message: 'Port must be a whole number from 1 to 65535',
}

const ROW_PROBLEM: ProxyProblem = {
  field: 'entries',
  row: 3,
  message: 'The same address as entry 1',
}

const LIST_PROBLEM: ProxyProblem = {
  field: 'entries',
  row: null,
  message: 'Add at least one address, or choose "All addresses except the list"',
}

const NO_PROBLEMS: ProxyProblems = { problems: [] }

const BAD_HOST = 'http://proxy.lab.internal:3128'
const BAD_PORT = 70000

const READ_FAILURE = 'Service Unavailable'

const SAVE_FAILURE_TITLE = 'Could Not Save Proxy'

const REFUSED_ENTRY = 'Entry 3: The same address as entry 1'

const READ_ONLY_CONFIG =
  'Settings cannot be saved: the config file /srv/wave/config/config.yaml is read-only'

/** What the PATCH answers for a refused list entry, and for a config file it cannot write. */
const SAVE_FAILURES: [label: string, message: string, status: number][] = [
  ['a refused value', REFUSED_ENTRY, 400],
  ['a config file that cannot be written', READ_ONLY_CONFIG, 500],
]

const RESULT_FIELDS = [
  'cancel',
  'checking',
  'dirty',
  'error',
  'problems',
  'retry',
  'save',
  'saving',
  'settings',
  'stage',
  'staged',
  'status',
]

const STAGED_FIELDS = [
  'enabled',
  'entries',
  'host',
  'list_mode',
  'password',
  'port',
  'proxy_local_addresses',
  'source',
  'username',
]

/** The fields of the settings the page stages; the stored password is never read back. */
function stagedOf(settings: ProxySettings): ProxyStaged {
  return {
    enabled: settings.enabled,
    source: settings.source,
    host: settings.host,
    port: settings.port,
    username: settings.username,
    password: undefined,
    list_mode: settings.list_mode,
    entries: settings.entries,
    proxy_local_addresses: settings.proxy_local_addresses,
  }
}

function apiError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A check that never answers. */
function unanswered(): Promise<ProxyProblems> {
  return new Promise<ProxyProblems>(() => {})
}

// ============================================================================
// Utilities
// ============================================================================

type ProxyHook = { current: UseProxySettingsResult }

// Microtasks only, so it also settles under fake timers.
async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve()
    }
  })
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function renderProxy(active: boolean) {
  return renderHook(({ active: isActive }: { active: boolean }) => useProxySettings(isActive), {
    initialProps: { active },
  })
}

async function renderLoaded(settings: ProxySettings = CUSTOM_PROXY) {
  mockFetchProxySettings.mockResolvedValueOnce(settings)
  const view = renderProxy(true)
  await flush()
  expect(view.result.current.status).toBe('loaded')
  return view
}

function stageOne(result: ProxyHook, field: StagedField, value: StagedValue) {
  act(() => {
    result.current.stage(field, value)
  })
}

/** Stages each edit in its own update, as separate gestures on the page do. */
function stageAll(result: ProxyHook, edits: Partial<ProxyStaged>) {
  for (const [field, value] of Object.entries(edits) as StagedEdit[]) {
    stageOne(result, field, value)
  }
}

/** Lets the wait pass and the check answer, as it has before Save can be pressed. */
async function answerCheck() {
  advance(CHECK_DELAY_MS)
  await flush()
}

async function save(result: ProxyHook) {
  await act(async () => {
    result.current.save()
  })
  await flush()
}

function cancel(result: ProxyHook) {
  act(() => {
    result.current.cancel()
  })
}

function sentBody(call = 0) {
  return mockUpdateProxySettings.mock.calls[call][0]
}

function checkedBody(call = 0) {
  return mockValidateProxySettings.mock.calls[call][0]
}

/** The text the shared debounced hook was given on the latest render. */
function checkText(): string {
  const call = mockUseDebouncedParse.mock.calls.at(-1)
  if (!call) throw new Error('useDebouncedParse was never called')
  return call[0]
}

/** The fields that hold a value, sorted. */
function definedKeys(value: object): string[] {
  return Object.entries(value)
    .filter(([, held]) => held !== undefined)
    .map(([key]) => key)
    .sort((a, b) => a.localeCompare(b))
}

/** A loaded page whose staged port stands refused by the check. */
async function renderWithPortProblem() {
  mockValidateProxySettings.mockResolvedValueOnce({ problems: [PORT_PROBLEM] })
  const view = await renderLoaded()
  stageAll(view.result, { port: BAD_PORT })
  await answerCheck()
  expect(view.result.current.problems).toEqual([PORT_PROBLEM])
  return view
}

/** The three ways the problems go without a new answer. */
const EMPTYING_WAYS: [label: string, empty: (result: ProxyHook) => Promise<void>][] = [
  ['Cancel', (result) => Promise.resolve(cancel(result))],
  ['a successful Save', (result) => save(result)],
  [
    'staging the saved value again',
    (result) => Promise.resolve(stageAll(result, { port: CUSTOM_PROXY.port })),
  ],
]

// ============================================================================
// Tests
// ============================================================================

describe('useProxySettings', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    // Reset, not clear: an answer queued by a failed test must not reach the next one.
    mockFetchProxySettings.mockReset().mockResolvedValue(CUSTOM_PROXY)
    mockUpdateProxySettings.mockReset().mockResolvedValue(CUSTOM_PROXY)
    mockValidateProxySettings.mockReset().mockResolvedValue(NO_PROBLEMS)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('read', () => {
    it('does not read while the page is inactive', async () => {
      const { result } = renderProxy(false)
      await flush()

      expect(mockFetchProxySettings).not.toHaveBeenCalled()
      expect(result.current.status).toBe('pending')
      expect(result.current.settings).toBeUndefined()
      expect(result.current.dirty).toBe(false)
      expect(result.current.saving).toBe(false)
      expect(result.current.problems).toEqual([])
      expect(result.current.checking).toBe(false)
    })

    it('is pending while the first read is in flight, then loaded with the saved settings', async () => {
      const read = deferred<ProxySettings>()
      mockFetchProxySettings.mockReturnValueOnce(read.promise)

      const { result } = renderProxy(true)
      await flush()
      expect(mockFetchProxySettings).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe('pending')
      expect(result.current.settings).toBeUndefined()

      await act(async () => {
        read.resolve(CUSTOM_PROXY)
      })
      await flush()

      expect(result.current.status).toBe('loaded')
      expect(result.current.error).toBeUndefined()
      expect(result.current.settings).toEqual(CUSTOM_PROXY)
      expect(result.current.staged).toEqual(stagedOf(CUSTOM_PROXY))
      expect(result.current.dirty).toBe(false)
      expect(result.current.saving).toBe(false)
    })

    it('stages what the read answered, without the stored-password flag and the host values', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)

      expect(result.current.staged).toEqual({
        enabled: true,
        source: 'custom',
        host: 'proxy.lab.internal',
        port: 3128,
        username: 'wave',
        password: undefined,
        list_mode: 'except',
        entries: SAVED_ENTRIES,
        proxy_local_addresses: false,
      })
      expect('password_set' in result.current.staged).toBe(false)
      expect('host_values' in result.current.staged).toBe(false)
    })

    it('stages the password as undefined while one is stored, and the port as a number', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)

      expect(result.current.settings?.password_set).toBe(true)
      expect(result.current.staged.password).toBeUndefined()
      expect(result.current.staged.port).toBe(3128)
    })

    it('stages the fresh-install defaults with the password undefined and the port null', async () => {
      const { result } = await renderLoaded(FRESH_PROXY)

      expect(result.current.settings).toEqual(FRESH_PROXY)
      expect(result.current.staged).toEqual({
        enabled: false,
        source: 'host',
        host: '',
        port: null,
        username: '',
        password: undefined,
        list_mode: 'except',
        entries: [],
        proxy_local_addresses: false,
      })
      expect(result.current.staged.password).toBeUndefined()
      expect(result.current.staged.port).toBeNull()
      expect(result.current.dirty).toBe(false)
    })

    it('reads once the page turns active', async () => {
      const view = renderProxy(false)
      await flush()

      view.rerender({ active: true })
      await flush()

      expect(mockFetchProxySettings).toHaveBeenCalledTimes(1)
      expect(view.result.current.status).toBe('loaded')
    })

    it('does not read again while the page stays active', async () => {
      const view = await renderLoaded()

      view.rerender({ active: true })
      await flush()

      expect(mockFetchProxySettings).toHaveBeenCalledTimes(1)
    })

    it('is failed with the API message when the read fails', async () => {
      mockFetchProxySettings.mockReset().mockRejectedValueOnce(apiError(READ_FAILURE, 503))

      const { result } = renderProxy(true)
      await flush()

      expect(result.current.status).toBe('failed')
      expect(result.current.error).toBe(READ_FAILURE)
      expect(result.current.settings).toBeUndefined()
      expect(result.current.dirty).toBe(false)
    })

    it('retry after a failed first read reads again: pending, then loaded', async () => {
      mockFetchProxySettings.mockReset().mockRejectedValueOnce(apiError(READ_FAILURE, 503))
      const { result } = renderProxy(true)
      await flush()
      expect(result.current.status).toBe('failed')

      const read = deferred<ProxySettings>()
      mockFetchProxySettings.mockReturnValueOnce(read.promise)
      act(() => {
        result.current.retry()
      })
      await flush()
      expect(mockFetchProxySettings).toHaveBeenCalledTimes(2)
      expect(result.current.status).toBe('pending')

      await act(async () => {
        read.resolve(CUSTOM_PROXY)
      })
      await flush()

      expect(result.current.status).toBe('loaded')
      expect(result.current.error).toBeUndefined()
      expect(result.current.settings).toEqual(CUSTOM_PROXY)
      expect(result.current.staged).toEqual(stagedOf(CUSTOM_PROXY))
    })

    it('reads again when a clean page turns active again', async () => {
      const view = await renderLoaded(FRESH_PROXY)
      mockFetchProxySettings.mockResolvedValueOnce(CUSTOM_PROXY)

      view.rerender({ active: false })
      await flush()
      view.rerender({ active: true })
      await flush()

      expect(mockFetchProxySettings).toHaveBeenCalledTimes(2)
      expect(view.result.current.settings).toEqual(CUSTOM_PROXY)
      expect(view.result.current.staged).toEqual(stagedOf(CUSTOM_PROXY))
    })

    it('keeps the staged values and does not read when a dirty page turns active again', async () => {
      const view = await renderLoaded(CUSTOM_PROXY)
      stageAll(view.result, { host: 'proxy-b.lab.internal', port: 8080 })

      view.rerender({ active: false })
      await flush()
      view.rerender({ active: true })
      await flush()

      expect(mockFetchProxySettings).toHaveBeenCalledTimes(1)
      expect(view.result.current.dirty).toBe(true)
      expect(view.result.current.staged).toEqual({
        ...stagedOf(CUSTOM_PROXY),
        host: 'proxy-b.lab.internal',
        port: 8080,
      })
    })

    it('reads again on the next activation once the staged values are back at the saved ones', async () => {
      const view = await renderLoaded(CUSTOM_PROXY)
      stageAll(view.result, { host: 'proxy-b.lab.internal' })
      stageAll(view.result, { host: CUSTOM_PROXY.host })
      mockFetchProxySettings.mockResolvedValueOnce(FRESH_PROXY)

      view.rerender({ active: false })
      await flush()
      view.rerender({ active: true })
      await flush()

      expect(mockFetchProxySettings).toHaveBeenCalledTimes(2)
      expect(view.result.current.settings).toEqual(FRESH_PROXY)
    })
  })

  describe('staging', () => {
    it.each(FIELD_EDITS)(
      'holds %s, marks the page dirty and sends nothing',
      async (_label, field, value) => {
        const { result } = await renderLoaded(CUSTOM_PROXY)

        stageOne(result, field, value)

        expect(result.current.staged).toEqual({ ...stagedOf(CUSTOM_PROXY), [field]: value })
        expect(result.current.staged[field]).toEqual(value)
        expect(result.current.dirty).toBe(true)
        expect(result.current.settings).toEqual(CUSTOM_PROXY)
        expect(mockUpdateProxySettings).not.toHaveBeenCalled()
        expect(mockFetchProxySettings).toHaveBeenCalledTimes(1)
      },
    )

    it.each(PLAIN_FIELD_EDITS)(
      'is clean again when %s is staged back to the saved value',
      async (_label, field, value) => {
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageOne(result, field, value)
        expect(result.current.dirty).toBe(true)

        stageOne(result, field, stagedOf(CUSTOM_PROXY)[field])

        expect(result.current.dirty).toBe(false)
        expect(result.current.staged).toEqual(stagedOf(CUSTOM_PROXY))
        expect(mockUpdateProxySettings).not.toHaveBeenCalled()
      },
    )

    it('takes the whole entry list as one value', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)

      stageAll(result, { entries: LONGER_ENTRIES })

      expect(result.current.staged.entries).toEqual([
        { kind: 'exact', address: 'https://registry.lab.internal' },
        { kind: 'regex', address: '\\.svc\\.cluster\\.local$' },
        { kind: 'exact', address: 'http://charts.lab.internal:8080' },
      ])
      expect(result.current.settings?.entries).toEqual(SAVED_ENTRIES)
      expect(result.current.dirty).toBe(true)
    })

    it('takes an emptied entry list', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)

      stageAll(result, { entries: [] })

      expect(result.current.staged.entries).toEqual([])
      expect(result.current.dirty).toBe(true)
    })

    it('is clean when the saved rows are staged as a new array', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)

      stageAll(result, { entries: savedRowsAgain() })

      expect(result.current.dirty).toBe(false)
      expect(result.current.staged.entries).toEqual(SAVED_ENTRIES)
    })

    it('is clean again when a row is added and removed again', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { entries: LONGER_ENTRIES })
      expect(result.current.dirty).toBe(true)

      stageAll(result, { entries: savedRowsAgain() })

      expect(result.current.dirty).toBe(false)
      expect(result.current.staged).toEqual(stagedOf(CUSTOM_PROXY))
      expect(mockUpdateProxySettings).not.toHaveBeenCalled()
    })

    it('is clean when an empty list is staged over a saved empty list', async () => {
      const { result } = await renderLoaded(FRESH_PROXY)

      stageAll(result, { entries: [] })

      expect(result.current.dirty).toBe(false)
    })

    it.each(CHANGED_ENTRY_LISTS)('is dirty when %s', async (_label, entries) => {
      const { result } = await renderLoaded(CUSTOM_PROXY)

      stageAll(result, { entries })

      expect(result.current.dirty).toBe(true)
      expect(result.current.staged.entries).toEqual(entries)
    })

    it('holds the password emptied for typing as an empty text, and the page is dirty', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)

      stageAll(result, { password: '' })

      expect(result.current.staged.password).toBe('')
      expect(result.current.dirty).toBe(true)
    })

    it('with no stored password, a password typed and erased again is undefined and the page is clean', async () => {
      const { result } = await renderLoaded(FRESH_PROXY)
      stageAll(result, { password: 'n3w-s3cret' })
      expect(result.current.staged.password).toBe('n3w-s3cret')
      expect(result.current.dirty).toBe(true)

      stageAll(result, { password: '' })

      expect(result.current.staged.password).toBeUndefined()
      expect(result.current.staged).toEqual(stagedOf(FRESH_PROXY))
      expect(result.current.dirty).toBe(false)
    })

    it('with no stored password, an empty password staged over the untouched one leaves the page clean', async () => {
      const { result } = await renderLoaded(FRESH_PROXY)

      stageAll(result, { password: '' })

      expect(result.current.staged.password).toBeUndefined()
      expect(result.current.dirty).toBe(false)
    })

    it('once the stored password was removed by a Save, a password typed and erased again leaves the page clean', async () => {
      mockUpdateProxySettings.mockResolvedValueOnce({ ...CUSTOM_PROXY, password_set: false })
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { password: '' })
      await answerCheck()
      await save(result)
      expect(result.current.settings?.password_set).toBe(false)

      stageAll(result, { password: 'n3w-s3cret' })
      stageAll(result, { password: '' })

      expect(result.current.staged.password).toBeUndefined()
      expect(result.current.dirty).toBe(false)
    })

    it('holds several staged fields together', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)

      stageAll(result, {
        host: 'proxy-b.lab.internal',
        port: 8080,
        list_mode: 'only',
      })

      expect(result.current.staged).toEqual({
        ...stagedOf(CUSTOM_PROXY),
        host: 'proxy-b.lab.internal',
        port: 8080,
        list_mode: 'only',
      })
      expect(result.current.dirty).toBe(true)
    })

    it('stays dirty until every staged field is back at its saved value', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { host: 'proxy-b.lab.internal', port: 8080 })

      stageAll(result, { host: 'proxy.lab.internal' })
      expect(result.current.dirty).toBe(true)

      stageAll(result, { port: 3128 })
      expect(result.current.dirty).toBe(false)
      expect(result.current.staged).toEqual(stagedOf(CUSTOM_PROXY))
    })

    it.each<[string, Partial<ProxyStaged>]>([
      ['turning the proxy off', { enabled: false }],
      ["choosing the WAVE host's settings", { source: 'host' }],
    ])('%s keeps the custom values staged', async (_label, edit) => {
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { username: 'ci-runner', entries: LONGER_ENTRIES })

      stageAll(result, edit)

      expect(result.current.staged).toEqual({
        ...stagedOf(CUSTOM_PROXY),
        username: 'ci-runner',
        entries: LONGER_ENTRIES,
        ...edit,
      })
      expect(result.current.staged.host).toBe('proxy.lab.internal')
      expect(result.current.staged.port).toBe(3128)
      expect(mockUpdateProxySettings).not.toHaveBeenCalled()
    })
  })

  describe('cancel', () => {
    it('restores the saved values and sends nothing', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, {
        host: 'proxy-b.lab.internal',
        port: null,
        entries: LONGER_ENTRIES,
        proxy_local_addresses: true,
      })
      expect(result.current.dirty).toBe(true)

      cancel(result)

      expect(result.current.staged).toEqual(stagedOf(CUSTOM_PROXY))
      expect(result.current.settings).toEqual(CUSTOM_PROXY)
      expect(result.current.dirty).toBe(false)
      expect(mockUpdateProxySettings).not.toHaveBeenCalled()
      expect(mockFetchProxySettings).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['a typed password', 'n3w-s3cret'],
      ['a removed password', ''],
    ])('puts %s back to undefined, so the stored one shows again', async (_label, password) => {
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { password })
      expect(result.current.staged.password).toBe(password)

      cancel(result)

      expect(result.current.staged.password).toBeUndefined()
      expect(result.current.settings?.password_set).toBe(true)
      expect(result.current.dirty).toBe(false)
    })
  })

  describe('save', () => {
    it.each(FIELD_EDITS)('sends %s alone in one PATCH', async (_label, field, value) => {
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageOne(result, field, value)
      await answerCheck()

      await save(result)

      expect(mockUpdateProxySettings).toHaveBeenCalledTimes(1)
      expect(sentBody()).toStrictEqual({ [field]: value })
    })

    it('sends every changed field in one PATCH and leaves the others out', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, {
        host: 'proxy-b.lab.internal',
        port: 8080,
        list_mode: 'only',
        proxy_local_addresses: true,
      })
      await answerCheck()

      await save(result)

      expect(mockUpdateProxySettings).toHaveBeenCalledTimes(1)
      expect(sentBody()).toStrictEqual({
        host: 'proxy-b.lab.internal',
        port: 8080,
        list_mode: 'only',
        proxy_local_addresses: true,
      })
    })

    it('leaves out a field that was staged back to its saved value', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { host: 'proxy-b.lab.internal', port: 8080 })
      stageAll(result, { host: 'proxy.lab.internal' })
      await answerCheck()

      await save(result)

      expect(mockUpdateProxySettings).toHaveBeenCalledTimes(1)
      expect(sentBody()).toStrictEqual({ port: 8080 })
    })

    it('sends the whole entry list when the list changed, not only the new row', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { entries: LONGER_ENTRIES })
      await answerCheck()

      await save(result)

      expect(sentBody()).toStrictEqual({
        entries: [
          { kind: 'exact', address: 'https://registry.lab.internal' },
          { kind: 'regex', address: '\\.svc\\.cluster\\.local$' },
          { kind: 'exact', address: 'http://charts.lab.internal:8080' },
        ],
      })
    })

    it.each(CHANGED_ENTRY_LISTS)('sends the whole entry list when %s', async (_label, entries) => {
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { entries })
      await answerCheck()

      await save(result)

      expect(mockUpdateProxySettings).toHaveBeenCalledTimes(1)
      expect(sentBody()).toStrictEqual({ entries })
    })

    it('sends no entries key when the list holds the saved rows again', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { username: 'ci-runner', entries: LONGER_ENTRIES })
      stageAll(result, { entries: savedRowsAgain() })
      await answerCheck()

      await save(result)

      expect(mockValidateProxySettings).toHaveBeenCalledTimes(1)
      expect(checkedBody()).toStrictEqual({ username: 'ci-runner' })
      expect(mockUpdateProxySettings).toHaveBeenCalledTimes(1)
      expect(sentBody()).toStrictEqual({ username: 'ci-runner' })
      expect('entries' in sentBody()).toBe(false)
    })

    it('sends an empty password after the stored one was emptied and nothing was typed', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { password: '' })
      await answerCheck()

      await save(result)

      expect(mockUpdateProxySettings).toHaveBeenCalledTimes(1)
      expect(sentBody()).toStrictEqual({ password: '' })
    })

    it('sends no password key while the password is untouched', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { username: 'ci-runner' })
      await answerCheck()

      await save(result)

      expect(sentBody()).toStrictEqual({ username: 'ci-runner' })
      expect('password' in sentBody()).toBe(false)
    })

    it('with no stored password, checks and sends no password after one was typed and erased again', async () => {
      const { result } = await renderLoaded(FRESH_PROXY)
      stageAll(result, { username: 'ci-runner', password: 'n3w-s3cret' })
      stageAll(result, { password: '' })
      await answerCheck()

      await save(result)

      expect(mockValidateProxySettings).toHaveBeenCalledTimes(1)
      expect(checkedBody()).toStrictEqual({ username: 'ci-runner' })
      expect(mockUpdateProxySettings).toHaveBeenCalledTimes(1)
      expect(sentBody()).toStrictEqual({ username: 'ci-runner' })
      expect('password' in sentBody()).toBe(false)
    })

    it('with no stored password, sends a typed password as typed', async () => {
      const { result } = await renderLoaded(FRESH_PROXY)
      stageAll(result, { password: 'n3w-s3cret' })
      await answerCheck()

      await save(result)

      expect(sentBody()).toStrictEqual({ password: 'n3w-s3cret' })
    })

    it('is saving while the request is open', async () => {
      const write = deferred<ProxySettings>()
      mockUpdateProxySettings.mockReturnValueOnce(write.promise)
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { port: 8080 })
      await answerCheck()
      expect(result.current.saving).toBe(false)

      await act(async () => {
        result.current.save()
      })
      expect(result.current.saving).toBe(true)

      await act(async () => {
        write.resolve({ ...CUSTOM_PROXY, port: 8080 })
      })
      await flush()

      expect(result.current.saving).toBe(false)
    })

    it('makes the response the new baseline: entries as returned, the password undefined again', async () => {
      const response: ProxySettings = {
        ...CUSTOM_PROXY,
        username: 'ci-runner',
        password_set: true,
        entries: [
          { kind: 'exact', address: 'https://registry.lab.internal' },
          { kind: 'exact', address: 'https://charts.lab.internal' },
        ],
      }
      mockUpdateProxySettings.mockResolvedValueOnce(response)
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, {
        username: 'ci-runner',
        password: 'n3w-s3cret',
        entries: [
          { kind: 'exact', address: 'https://registry.lab.internal' },
          { kind: 'exact', address: 'https://Charts.Lab.Internal:443' },
        ],
      })
      await answerCheck()

      await save(result)

      expect(result.current.status).toBe('loaded')
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(false)
      expect(result.current.settings).toEqual(response)
      expect(result.current.staged).toEqual(stagedOf(response))
      expect(result.current.staged.entries).toEqual([
        { kind: 'exact', address: 'https://registry.lab.internal' },
        { kind: 'exact', address: 'https://charts.lab.internal' },
      ])
      expect(result.current.staged.password).toBeUndefined()
      expect(mockFetchProxySettings).toHaveBeenCalledTimes(1)

      cancel(result)
      expect(result.current.staged).toEqual(stagedOf(response))
      expect(result.current.dirty).toBe(false)
    })

    it('compares later changes with the response, not with the first read', async () => {
      mockUpdateProxySettings.mockResolvedValueOnce({ ...CUSTOM_PROXY, port: 8080 })
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { port: 8080 })
      await answerCheck()
      await save(result)
      expect(result.current.dirty).toBe(false)

      stageAll(result, { port: 3128 })
      expect(result.current.dirty).toBe(true)

      stageAll(result, { port: 8080 })
      expect(result.current.dirty).toBe(false)
    })

    it('shows no toast when the Save succeeds', async () => {
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { enabled: false })
      await answerCheck()

      await save(result)

      expect(mockUpdateProxySettings).toHaveBeenCalledTimes(1)
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(toastError).not.toHaveBeenCalled()
    })

    it.each(SAVE_FAILURES)(
      'on %s shows the failure toast with the exact message and keeps the staged values',
      async (_label, message, status) => {
        mockUpdateProxySettings.mockReset().mockRejectedValueOnce(apiError(message, status))
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageAll(result, { entries: REPEATING_ENTRIES, port: 8080 })
        await answerCheck()
        const stagedBefore = result.current.staged

        await save(result)

        expect(toastError).toHaveBeenCalledTimes(1)
        expect(toastError).toHaveBeenCalledWith(message, SAVE_FAILURE_TITLE)
        expect(toastSuccess).not.toHaveBeenCalled()
        expect(result.current.status).toBe('loaded')
        expect(result.current.saving).toBe(false)
        expect(result.current.dirty).toBe(true)
        expect(result.current.staged).toEqual(stagedBefore)
        expect(result.current.staged).toEqual({
          ...stagedOf(CUSTOM_PROXY),
          entries: REPEATING_ENTRIES,
          port: 8080,
        })
        expect(result.current.settings).toEqual(CUSTOM_PROXY)
        expect(mockFetchProxySettings).toHaveBeenCalledTimes(1)
      },
    )

    it('keeps a typed password staged after a failed Save', async () => {
      mockUpdateProxySettings.mockReset().mockRejectedValueOnce(apiError(READ_ONLY_CONFIG, 500))
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { password: 'n3w-s3cret' })
      await answerCheck()

      await save(result)

      expect(result.current.staged.password).toBe('n3w-s3cret')
      expect(result.current.dirty).toBe(true)
    })

    it('keeps the saved values as the Cancel target after a failed Save', async () => {
      mockUpdateProxySettings.mockReset().mockRejectedValueOnce(apiError(READ_ONLY_CONFIG, 500))
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { host: 'proxy-b.lab.internal' })
      await answerCheck()
      await save(result)

      cancel(result)

      expect(result.current.staged).toEqual(stagedOf(CUSTOM_PROXY))
      expect(result.current.dirty).toBe(false)
    })

    it('sends the same request again on the next Save after a failure', async () => {
      mockUpdateProxySettings
        .mockReset()
        .mockRejectedValueOnce(apiError(READ_ONLY_CONFIG, 500))
        .mockResolvedValueOnce({ ...CUSTOM_PROXY, port: 8080 })
      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { port: 8080 })
      await answerCheck()
      await save(result)

      await save(result)

      expect(mockUpdateProxySettings).toHaveBeenCalledTimes(2)
      expect(sentBody(1)).toStrictEqual(sentBody(0))
      expect(toastError).toHaveBeenCalledTimes(1)
      expect(result.current.dirty).toBe(false)
      expect(result.current.settings).toEqual({ ...CUSTOM_PROXY, port: 8080 })
    })
  })

  describe('check while typing', () => {
    describe('when it is asked', () => {
      it('asks 300 ms after a staged change, not at 299 ms, with the staged change as the body', async () => {
        mockValidateProxySettings.mockReturnValueOnce(unanswered())
        const { result } = await renderLoaded(CUSTOM_PROXY)

        stageAll(result, { port: BAD_PORT })
        advance(CHECK_DELAY_MS - 1)
        expect(mockValidateProxySettings).not.toHaveBeenCalled()

        advance(1)
        expect(mockValidateProxySettings).toHaveBeenCalledTimes(1)
        expect(checkedBody()).toStrictEqual({ port: BAD_PORT })
      })

      it('asks once for several quick changes, 300 ms after the last one, with all of them', async () => {
        mockValidateProxySettings.mockReturnValueOnce(unanswered())
        const { result } = await renderLoaded(CUSTOM_PROXY)

        stageAll(result, { host: 'proxy-b.lab.internal' })
        advance(200)
        stageAll(result, { port: 8080 })
        advance(200)
        stageAll(result, { username: 'ci-runner' })

        advance(CHECK_DELAY_MS - 1)
        expect(mockValidateProxySettings).not.toHaveBeenCalled()

        advance(1)
        expect(mockValidateProxySettings).toHaveBeenCalledTimes(1)
        expect(checkedBody()).toStrictEqual({
          host: 'proxy-b.lab.internal',
          port: 8080,
          username: 'ci-runner',
        })
      })

      it('asks once per staged state and not again while nothing changes', async () => {
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageAll(result, { port: 8080 })
        await answerCheck()
        expect(mockValidateProxySettings).toHaveBeenCalledTimes(1)

        advance(5000)
        await flush()

        expect(mockValidateProxySettings).toHaveBeenCalledTimes(1)
      })

      it('asks again for the next change, with every change staged so far', async () => {
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageAll(result, { port: 8080 })
        await answerCheck()

        stageAll(result, { entries: LONGER_ENTRIES })
        await answerCheck()

        expect(mockValidateProxySettings).toHaveBeenCalledTimes(2)
        expect(checkedBody(1)).toStrictEqual({ port: 8080, entries: LONGER_ENTRIES })
      })

      it('asks with exactly what a Save then sends', async () => {
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageAll(result, {
          host: 'proxy-b.lab.internal',
          password: '',
          entries: LONGER_ENTRIES,
        })
        await answerCheck()

        await save(result)

        expect(mockValidateProxySettings).toHaveBeenCalledTimes(1)
        expect(checkedBody()).toStrictEqual({
          host: 'proxy-b.lab.internal',
          password: '',
          entries: LONGER_ENTRIES,
        })
        expect(sentBody()).toStrictEqual(checkedBody())
      })

      it('writes nothing: the check never calls the PATCH', async () => {
        const { result } = await renderLoaded(CUSTOM_PROXY)

        stageAll(result, { port: BAD_PORT })
        await answerCheck()

        expect(mockValidateProxySettings).toHaveBeenCalledTimes(1)
        expect(mockUpdateProxySettings).not.toHaveBeenCalled()
      })
    })

    describe('the shared debounced hook', () => {
      it('gets an empty text while the page is clean', async () => {
        const { result } = await renderLoaded(CUSTOM_PROXY)

        expect(mockUseDebouncedParse).toHaveBeenCalled()
        expect(checkText().trim()).toBe('')
        expect(result.current.checking).toBe(false)
      })

      it('gets the staged change as its text: one text per staged state', async () => {
        const { result } = await renderLoaded(CUSTOM_PROXY)

        stageAll(result, { port: 8080 })
        const portText = checkText()
        expect(portText.trim()).not.toBe('')

        stageAll(result, { host: 'proxy-b.lab.internal' })
        const portAndHostText = checkText()
        expect(portAndHostText.trim()).not.toBe('')
        expect(portAndHostText).not.toBe(portText)

        stageAll(result, { host: CUSTOM_PROXY.host })
        expect(checkText()).toBe(portText)
      })

      it.each(EMPTYING_WAYS)('gets an empty text again after %s', async (_label, empty) => {
        mockUpdateProxySettings.mockResolvedValueOnce({ ...CUSTOM_PROXY, port: BAD_PORT })
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageAll(result, { port: BAD_PORT })
        await answerCheck()
        expect(checkText().trim()).not.toBe('')

        await empty(result)

        expect(result.current.dirty).toBe(false)
        expect(checkText().trim()).toBe('')
      })
    })

    describe('a clean page', () => {
      it('asks no check after the read', async () => {
        const { result } = await renderLoaded(CUSTOM_PROXY)

        advance(5000)
        await flush()

        expect(mockValidateProxySettings).not.toHaveBeenCalled()
        expect(result.current.checking).toBe(false)
        expect(result.current.problems).toEqual([])
      })

      it('asks no check while the page is inactive', async () => {
        renderProxy(false)
        await flush()

        advance(5000)
        await flush()

        expect(mockValidateProxySettings).not.toHaveBeenCalled()
      })

      it('drops the waiting check when the change is staged back inside the wait', async () => {
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageAll(result, { port: BAD_PORT })
        advance(100)

        stageAll(result, { port: CUSTOM_PROXY.port })

        expect(result.current.checking).toBe(false)
        advance(5000)
        await flush()
        expect(mockValidateProxySettings).not.toHaveBeenCalled()
      })

      it('drops the waiting check when a password is typed and erased again with none stored', async () => {
        const { result } = await renderLoaded(FRESH_PROXY)
        stageAll(result, { password: 'n3w-s3cret' })
        advance(100)

        stageAll(result, { password: '' })

        expect(result.current.checking).toBe(false)
        advance(5000)
        await flush()
        expect(mockValidateProxySettings).not.toHaveBeenCalled()
      })

      it('drops the waiting check on Cancel', async () => {
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageAll(result, { port: BAD_PORT })
        advance(100)

        cancel(result)

        expect(result.current.checking).toBe(false)
        advance(5000)
        await flush()
        expect(mockValidateProxySettings).not.toHaveBeenCalled()
      })

      it('asks no check when the saved rows are staged as a new array', async () => {
        const { result } = await renderLoaded(CUSTOM_PROXY)

        stageAll(result, { entries: savedRowsAgain() })

        expect(result.current.checking).toBe(false)
        expect(checkText().trim()).toBe('')
        advance(5000)
        await flush()
        expect(mockValidateProxySettings).not.toHaveBeenCalled()
      })

      it('drops the waiting check when a row is added and removed again inside the wait', async () => {
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageAll(result, { entries: LONGER_ENTRIES })
        advance(100)

        stageAll(result, { entries: savedRowsAgain() })

        expect(result.current.checking).toBe(false)
        advance(5000)
        await flush()
        expect(mockValidateProxySettings).not.toHaveBeenCalled()
      })
    })

    describe('checking', () => {
      it('is checking from the change until its answer arrives', async () => {
        const check = deferred<ProxyProblems>()
        mockValidateProxySettings.mockReturnValueOnce(check.promise)
        const { result } = await renderLoaded(CUSTOM_PROXY)
        expect(result.current.checking).toBe(false)

        stageAll(result, { port: BAD_PORT })
        expect(result.current.checking).toBe(true)
        expect(result.current.problems).toEqual([])

        advance(CHECK_DELAY_MS)
        expect(mockValidateProxySettings).toHaveBeenCalledTimes(1)
        expect(result.current.checking).toBe(true)
        expect(result.current.problems).toEqual([])

        await act(async () => {
          check.resolve({ problems: [PORT_PROBLEM] })
        })
        await flush()

        expect(result.current.checking).toBe(false)
        expect(result.current.problems).toEqual([PORT_PROBLEM])
      })

      it('is checking again as soon as the next change is staged', async () => {
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageAll(result, { port: 8080 })
        await answerCheck()
        expect(result.current.checking).toBe(false)

        stageAll(result, { username: 'ci-runner' })

        expect(result.current.checking).toBe(true)
      })
    })

    describe('problems', () => {
      it('has no problems when the answer holds none', async () => {
        const { result } = await renderLoaded(CUSTOM_PROXY)

        stageAll(result, { port: 8080 })
        await answerCheck()

        expect(result.current.problems).toEqual([])
        expect(result.current.checking).toBe(false)
        expect(result.current.dirty).toBe(true)
      })

      it('gives every problem of the answer, in the order received', async () => {
        mockValidateProxySettings.mockResolvedValueOnce({
          problems: [HOST_PROBLEM, PORT_PROBLEM, ROW_PROBLEM],
        })
        const { result } = await renderLoaded(CUSTOM_PROXY)

        stageAll(result, { host: BAD_HOST, port: BAD_PORT, entries: REPEATING_ENTRIES })
        await answerCheck()

        expect(result.current.problems).toStrictEqual([
          {
            field: 'host',
            row: null,
            message:
              'IP or Hostname must be an IP address or a host name, with no protocol and no port',
          },
          { field: 'port', row: null, message: 'Port must be a whole number from 1 to 65535' },
          { field: 'entries', row: 3, message: 'The same address as entry 1' },
        ])
      })

      it('keeps a problem of the whole list as it is: the entries field with a null row', async () => {
        mockValidateProxySettings.mockResolvedValueOnce({ problems: [LIST_PROBLEM] })
        const { result } = await renderLoaded(CUSTOM_PROXY)

        stageAll(result, { list_mode: 'only', entries: [] })
        await answerCheck()

        expect(result.current.problems).toStrictEqual([
          {
            field: 'entries',
            row: null,
            message: 'Add at least one address, or choose "All addresses except the list"',
          },
        ])
      })

      it('keeps the staged values and the saved settings when the answer holds problems', async () => {
        const { result } = await renderWithPortProblem()

        expect(result.current.staged).toEqual({ ...stagedOf(CUSTOM_PROXY), port: BAD_PORT })
        expect(result.current.settings).toEqual(CUSTOM_PROXY)
        expect(result.current.dirty).toBe(true)
        expect(toastError).not.toHaveBeenCalled()
      })

      it('keeps the problems on screen until the answer for the next change arrives', async () => {
        const next = deferred<ProxyProblems>()
        const { result } = await renderWithPortProblem()
        mockValidateProxySettings.mockReturnValueOnce(next.promise)

        stageAll(result, { port: 8080 })
        expect(result.current.checking).toBe(true)
        expect(result.current.problems).toEqual([PORT_PROBLEM])

        advance(CHECK_DELAY_MS)
        expect(mockValidateProxySettings).toHaveBeenCalledTimes(2)
        expect(result.current.problems).toEqual([PORT_PROBLEM])

        await act(async () => {
          next.resolve(NO_PROBLEMS)
        })
        await flush()

        expect(result.current.problems).toEqual([])
        expect(result.current.checking).toBe(false)
      })
    })

    describe('an answer for an older state', () => {
      it('is ignored when it arrives while the newer check is open', async () => {
        const first = deferred<ProxyProblems>()
        const second = deferred<ProxyProblems>()
        mockValidateProxySettings
          .mockReturnValueOnce(first.promise)
          .mockReturnValueOnce(second.promise)
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageAll(result, { port: BAD_PORT })
        advance(CHECK_DELAY_MS)
        stageAll(result, { host: BAD_HOST })
        advance(CHECK_DELAY_MS)
        expect(mockValidateProxySettings).toHaveBeenCalledTimes(2)
        expect(checkedBody(1)).toStrictEqual({ port: BAD_PORT, host: BAD_HOST })

        await act(async () => {
          first.resolve({ problems: [PORT_PROBLEM] })
        })
        await flush()

        expect(result.current.problems).toEqual([])
        expect(result.current.checking).toBe(true)

        await act(async () => {
          second.resolve({ problems: [HOST_PROBLEM, PORT_PROBLEM] })
        })
        await flush()

        expect(result.current.problems).toEqual([HOST_PROBLEM, PORT_PROBLEM])
        expect(result.current.checking).toBe(false)
      })

      it('is ignored when it arrives after the newer answer', async () => {
        const first = deferred<ProxyProblems>()
        const second = deferred<ProxyProblems>()
        mockValidateProxySettings
          .mockReturnValueOnce(first.promise)
          .mockReturnValueOnce(second.promise)
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageAll(result, { port: BAD_PORT })
        advance(CHECK_DELAY_MS)
        stageAll(result, { host: BAD_HOST })
        advance(CHECK_DELAY_MS)

        await act(async () => {
          second.resolve({ problems: [HOST_PROBLEM, PORT_PROBLEM] })
        })
        await flush()
        expect(result.current.problems).toEqual([HOST_PROBLEM, PORT_PROBLEM])

        await act(async () => {
          first.resolve({ problems: [PORT_PROBLEM] })
        })
        await flush()

        expect(result.current.problems).toEqual([HOST_PROBLEM, PORT_PROBLEM])
        expect(result.current.checking).toBe(false)
      })

      it('is ignored when the older check fails late', async () => {
        const first = deferred<ProxyProblems>()
        mockValidateProxySettings
          .mockReturnValueOnce(first.promise)
          .mockResolvedValueOnce({ problems: [HOST_PROBLEM, PORT_PROBLEM] })
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageAll(result, { port: BAD_PORT })
        advance(CHECK_DELAY_MS)
        stageAll(result, { host: BAD_HOST })
        await answerCheck()
        expect(result.current.problems).toEqual([HOST_PROBLEM, PORT_PROBLEM])

        await act(async () => {
          first.reject(new TypeError('Failed to fetch'))
        })
        await flush()

        expect(result.current.problems).toEqual([HOST_PROBLEM, PORT_PROBLEM])
        expect(result.current.checking).toBe(false)
      })

      it('is ignored when it arrives after Cancel', async () => {
        const check = deferred<ProxyProblems>()
        mockValidateProxySettings.mockReturnValueOnce(check.promise)
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageAll(result, { port: BAD_PORT })
        advance(CHECK_DELAY_MS)
        expect(mockValidateProxySettings).toHaveBeenCalledTimes(1)

        cancel(result)
        await act(async () => {
          check.resolve({ problems: [PORT_PROBLEM] })
        })
        await flush()

        expect(result.current.problems).toEqual([])
        expect(result.current.checking).toBe(false)
        expect(result.current.dirty).toBe(false)
      })
    })

    describe('a failed check', () => {
      it('leaves no problems and is not checking, with the staged values kept', async () => {
        mockValidateProxySettings.mockReset().mockRejectedValueOnce(new TypeError('Failed to fetch'))
        const { result } = await renderLoaded(CUSTOM_PROXY)

        stageAll(result, { port: BAD_PORT })
        await answerCheck()

        expect(mockValidateProxySettings).toHaveBeenCalledTimes(1)
        expect(result.current.problems).toEqual([])
        expect(result.current.checking).toBe(false)
        expect(result.current.dirty).toBe(true)
        expect(result.current.staged).toEqual({ ...stagedOf(CUSTOM_PROXY), port: BAD_PORT })
      })

      it('shows no toast: only a failed Save does', async () => {
        mockValidateProxySettings.mockReset().mockRejectedValueOnce(apiError('Service Unavailable', 503))
        const { result } = await renderLoaded(CUSTOM_PROXY)

        stageAll(result, { port: 8080 })
        await answerCheck()

        expect(result.current.checking).toBe(false)
        expect(toastError).not.toHaveBeenCalled()
        expect(toastSuccess).not.toHaveBeenCalled()
      })

      it('clears the problems the answer before it gave', async () => {
        const { result } = await renderWithPortProblem()
        mockValidateProxySettings.mockRejectedValueOnce(apiError('Service Unavailable', 503))

        stageAll(result, { host: BAD_HOST })
        await answerCheck()

        expect(mockValidateProxySettings).toHaveBeenCalledTimes(2)
        expect(result.current.problems).toEqual([])
        expect(result.current.checking).toBe(false)
      })

      it('leaves Save possible: the PATCH goes out with the staged change', async () => {
        mockValidateProxySettings.mockReset().mockRejectedValueOnce(new TypeError('Failed to fetch'))
        mockUpdateProxySettings.mockResolvedValueOnce({ ...CUSTOM_PROXY, port: 8080 })
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageAll(result, { port: 8080 })
        await answerCheck()

        await save(result)

        expect(mockUpdateProxySettings).toHaveBeenCalledTimes(1)
        expect(sentBody()).toStrictEqual({ port: 8080 })
        expect(result.current.dirty).toBe(false)
        expect(result.current.settings).toEqual({ ...CUSTOM_PROXY, port: 8080 })
      })
    })

    describe('emptying the problems', () => {
      it('Cancel empties them and asks no further check', async () => {
        const { result } = await renderWithPortProblem()

        cancel(result)

        expect(result.current.problems).toEqual([])
        expect(result.current.checking).toBe(false)
        advance(5000)
        await flush()
        expect(mockValidateProxySettings).toHaveBeenCalledTimes(1)
      })

      it('a successful Save empties them', async () => {
        const { result } = await renderWithPortProblem()
        mockUpdateProxySettings.mockResolvedValueOnce({ ...CUSTOM_PROXY, port: BAD_PORT })

        await save(result)

        expect(mockUpdateProxySettings).toHaveBeenCalledTimes(1)
        expect(result.current.dirty).toBe(false)
        expect(result.current.problems).toEqual([])
        expect(result.current.checking).toBe(false)
      })

      it('a failed Save keeps them, with the staged values', async () => {
        const { result } = await renderWithPortProblem()
        mockUpdateProxySettings
          .mockReset()
          .mockRejectedValueOnce(apiError(PORT_PROBLEM.message, 400))

        await save(result)

        expect(toastError).toHaveBeenCalledWith(
          'Port must be a whole number from 1 to 65535',
          SAVE_FAILURE_TITLE,
        )
        expect(result.current.dirty).toBe(true)
        expect(result.current.problems).toEqual([PORT_PROBLEM])
      })

      it('staging the value back to the saved one empties them and asks no further check', async () => {
        const { result } = await renderWithPortProblem()

        stageAll(result, { port: CUSTOM_PROXY.port })

        expect(result.current.dirty).toBe(false)
        expect(result.current.problems).toEqual([])
        expect(result.current.checking).toBe(false)
        advance(5000)
        await flush()
        expect(mockValidateProxySettings).toHaveBeenCalledTimes(1)
      })

      it('asks again when the same change is staged again after the page was clean', async () => {
        const { result } = await renderWithPortProblem()
        stageAll(result, { port: CUSTOM_PROXY.port })
        expect(result.current.problems).toEqual([])
        mockValidateProxySettings.mockResolvedValueOnce({ problems: [PORT_PROBLEM] })

        stageAll(result, { port: BAD_PORT })
        expect(result.current.checking).toBe(true)
        expect(result.current.problems).toEqual([])
        await answerCheck()

        expect(mockValidateProxySettings).toHaveBeenCalledTimes(2)
        expect(checkedBody(1)).toStrictEqual({ port: BAD_PORT })
        expect(result.current.checking).toBe(false)
        expect(result.current.problems).toEqual([PORT_PROBLEM])
      })

      it('putting the saved rows back in the list empties them and asks no further check', async () => {
        mockValidateProxySettings.mockResolvedValueOnce({ problems: [ROW_PROBLEM] })
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageAll(result, { entries: REPEATING_ENTRIES })
        await answerCheck()
        expect(result.current.problems).toEqual([ROW_PROBLEM])

        stageAll(result, { entries: savedRowsAgain() })

        expect(result.current.dirty).toBe(false)
        expect(result.current.problems).toEqual([])
        expect(result.current.checking).toBe(false)
        advance(5000)
        await flush()
        expect(mockValidateProxySettings).toHaveBeenCalledTimes(1)
      })

      it('keeps them while another staged change is still left', async () => {
        mockValidateProxySettings
          .mockResolvedValueOnce({ problems: [HOST_PROBLEM] })
          .mockReturnValueOnce(unanswered())
        const { result } = await renderLoaded(CUSTOM_PROXY)
        stageAll(result, { host: BAD_HOST, username: 'ci-runner' })
        await answerCheck()
        expect(result.current.problems).toEqual([HOST_PROBLEM])

        stageAll(result, { username: CUSTOM_PROXY.username })

        expect(result.current.dirty).toBe(true)
        expect(result.current.problems).toEqual([HOST_PROBLEM])
      })

      it.each(EMPTYING_WAYS)(
        'after %s they stay away while the check for the next change is open',
        async (_label, empty) => {
          const { result } = await renderWithPortProblem()
          mockUpdateProxySettings.mockResolvedValueOnce({ ...CUSTOM_PROXY, port: BAD_PORT })
          await empty(result)
          expect(result.current.problems).toEqual([])
          mockValidateProxySettings.mockReturnValueOnce(unanswered())

          stageAll(result, { username: 'ci-runner' })
          expect(result.current.checking).toBe(true)
          expect(result.current.problems).toEqual([])

          advance(CHECK_DELAY_MS)
          await flush()

          expect(mockValidateProxySettings).toHaveBeenCalledTimes(2)
          expect(result.current.checking).toBe(true)
          expect(result.current.problems).toEqual([])
        },
      )
    })
  })

  describe('result', () => {
    it('carries exactly the fields the page reads: all but the read error once loaded', async () => {
      expectTypeOf<keyof UseProxySettingsResult>().toEqualTypeOf<
        | 'status'
        | 'error'
        | 'settings'
        | 'staged'
        | 'dirty'
        | 'saving'
        | 'problems'
        | 'checking'
        | 'stage'
        | 'cancel'
        | 'save'
        | 'retry'
      >()
      expectTypeOf<UseProxySettingsResult['status']>().toEqualTypeOf<PageReadStatus>()
      expectTypeOf<UseProxySettingsResult['problems']>().toEqualTypeOf<ProxyProblem[]>()
      expectTypeOf<UseProxySettingsResult['staged']>().toEqualTypeOf<ProxyStaged>()

      const { result } = await renderLoaded(CUSTOM_PROXY)

      expect(definedKeys(result.current)).toEqual(RESULT_FIELDS.filter((key) => key !== 'error'))
    })

    it('carries every field but the settings after a failed first read', async () => {
      mockFetchProxySettings.mockReset().mockRejectedValueOnce(apiError(READ_FAILURE, 503))

      const { result } = renderProxy(true)
      await flush()

      expect(definedKeys(result.current)).toEqual(RESULT_FIELDS.filter((key) => key !== 'settings'))
    })

    it('carries no other field, set or not, while a problem stands', async () => {
      const { result } = await renderWithPortProblem()

      expect(Object.keys(result.current).filter((key) => !RESULT_FIELDS.includes(key))).toEqual([])
    })

    it('stages the nine writable fields and no other', async () => {
      expectTypeOf<keyof ProxyStaged>().toEqualTypeOf<
        | 'enabled'
        | 'source'
        | 'host'
        | 'port'
        | 'username'
        | 'password'
        | 'list_mode'
        | 'entries'
        | 'proxy_local_addresses'
      >()
      expectTypeOf<ProxyStaged['password']>().toEqualTypeOf<string | undefined>()
      expectTypeOf<ProxyStaged['port']>().toEqualTypeOf<number | string | null>()
      expectTypeOf<ProxyStaged['entries']>().toEqualTypeOf<ProxyEntry[]>()

      const { result } = await renderLoaded(CUSTOM_PROXY)
      stageAll(result, { password: 'n3w-s3cret' })

      expect(definedKeys(result.current.staged)).toEqual(STAGED_FIELDS)
    })
  })
})
