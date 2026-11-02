/** useGeneralSettings: the General page state - read on activation, staged values, ordered Save, Cancel (REQ-4.7.16, REQ-4.7.18, REQ-4.7.19, REQ-3.1.3.17). */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, warning: vi.fn(), info: vi.fn() }),
}))

vi.mock('@/features/settings/api/admin', () => ({
  ADMIN_NOT_ENABLED_MESSAGE: 'Admin API is not enabled on this server',
  fetchLogLevel: vi.fn(),
  setLogLevel: vi.fn(),
  fetchMaskingSettings: vi.fn(),
  setMaskingSettings: vi.fn(),
}))

import {
  fetchLogLevel,
  fetchMaskingSettings,
  setLogLevel,
  setMaskingSettings,
  type MaskingSettingsApiResponse,
  type MaskingSettingsPartial,
} from '@/features/settings/api/admin'
import { useGeneralSettings } from '@/features/settings/container/use-general-settings'
import type { LogLevel } from '@/lib/log-levels'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'
import { TIMEZONE_STORAGE_KEY, useTimezoneStore } from '@/stores/timezone-store'

const mockFetchLogLevel = vi.mocked(fetchLogLevel)
const mockSetLogLevel = vi.mocked(setLogLevel)
const mockFetchMaskingSettings = vi.mocked(fetchMaskingSettings)
const mockSetMaskingSettings = vi.mocked(setMaskingSettings)

// ============================================================================
// Fixtures
// ============================================================================

type General = ReturnType<typeof useGeneralSettings>
type Masking = General['staged']['masking']

const SAVED_LEVEL: LogLevel = 'INFO'

const SAVED_FLAGS: MaskingSettingsApiResponse = {
  run_output: false,
  test_variables: true,
  shared_variables: false,
  credential_inputs: false,
}

const SAVED_MASKING: Masking = {
  runOutput: false,
  testVariables: true,
  sharedVariables: false,
  credentialInputs: false,
}

const ALL_MASKED: Masking = {
  runOutput: false,
  testVariables: false,
  sharedVariables: false,
  credentialInputs: false,
}

const FLAG_CASES = [
  { key: 'runOutput', wire: 'run_output' },
  { key: 'testVariables', wire: 'test_variables' },
  { key: 'sharedVariables', wire: 'shared_variables' },
  { key: 'credentialInputs', wire: 'credential_inputs' },
] as const

const READ_FAILURE = 'Admin API service unavailable'

const SAVE_FAILURE =
  'Settings cannot be saved: the config file /srv/wave/config/config.yaml is read-only'

const SAVE_FAILURE_TITLE = 'Could Not Save General Settings'

const realSetMode = useTimezoneStore.getState().setMode
const realInitializeFromStorage = useTimezoneStore.getState().initializeFromStorage
const realMaskingSet = useMaskingSettingsStore.getState().set

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// ============================================================================
// Utilities
// ============================================================================

function spyOnStores() {
  return {
    setMode: vi.spyOn(useTimezoneStore.getState(), 'setMode'),
    initializeFromStorage: vi.spyOn(useTimezoneStore.getState(), 'initializeFromStorage'),
    maskingSet: vi.spyOn(useMaskingSettingsStore.getState(), 'set'),
  }
}

let spies: ReturnType<typeof spyOnStores>

function resetStores() {
  act(() => {
    useTimezoneStore.setState({
      mode: 'local',
      setMode: realSetMode,
      initializeFromStorage: realInitializeFromStorage,
    })
    useMaskingSettingsStore.setState({ ...ALL_MASKED, loadError: undefined, set: realMaskingSet })
  })
}

function storeFlags(): Masking {
  const { runOutput, testVariables, sharedVariables, credentialInputs } =
    useMaskingSettingsStore.getState()
  return { runOutput, testVariables, sharedVariables, credentialInputs }
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function renderGeneral(active: boolean) {
  return renderHook(({ active: isActive }: { active: boolean }) => useGeneralSettings(isActive), {
    initialProps: { active },
  })
}

async function renderLoaded() {
  const view = renderGeneral(true)
  await flush()
  expect(view.result.current.status).toBe('loaded')
  // A store write made by the read is not part of what a Save test counts.
  spies.maskingSet.mockClear()
  return view
}

async function save(result: { current: General }) {
  await act(async () => {
    result.current.save()
  })
  await flush()
}

// ============================================================================
// Tests
// ============================================================================

describe('useGeneralSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    spies = spyOnStores()
    mockFetchLogLevel.mockReset().mockResolvedValue(SAVED_LEVEL)
    mockFetchMaskingSettings.mockReset().mockResolvedValue(SAVED_FLAGS)
    mockSetLogLevel.mockReset().mockImplementation(async (level: LogLevel) => level)
    mockSetMaskingSettings
      .mockReset()
      .mockImplementation(async (partial: MaskingSettingsPartial) => ({ ...SAVED_FLAGS, ...partial }))
  })

  afterEach(() => {
    // Unmount first, so no mounted hook reacts to the store reset.
    cleanup()
    resetStores()
    vi.restoreAllMocks()
  })

  describe('read', () => {
    it('does not read while the page is inactive', async () => {
      const { result } = renderGeneral(false)
      await flush()

      expect(mockFetchLogLevel).not.toHaveBeenCalled()
      expect(mockFetchMaskingSettings).not.toHaveBeenCalled()
      expect(result.current.status).toBe('pending')
      expect(result.current.logLevel).toBeUndefined()
    })

    it('reads the log level and the masking flags together and is pending until both answer', async () => {
      const levelRead = deferred<LogLevel>()
      const maskingRead = deferred<MaskingSettingsApiResponse>()
      mockFetchLogLevel.mockReturnValueOnce(levelRead.promise)
      mockFetchMaskingSettings.mockReturnValueOnce(maskingRead.promise)

      const { result } = renderGeneral(true)
      await flush()
      expect(mockFetchLogLevel).toHaveBeenCalledTimes(1)
      expect(mockFetchMaskingSettings).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe('pending')
      expect(result.current.logLevel).toBeUndefined()

      await act(async () => {
        levelRead.resolve(SAVED_LEVEL)
      })
      await flush()
      expect(result.current.status).toBe('pending')

      await act(async () => {
        maskingRead.resolve(SAVED_FLAGS)
      })
      await flush()

      expect(result.current.status).toBe('loaded')
      expect(result.current.error).toBeUndefined()
      expect(result.current.logLevel).toBe(SAVED_LEVEL)
      expect(result.current.staged).toEqual({
        logLevel: SAVED_LEVEL,
        timezone: 'local',
        masking: SAVED_MASKING,
      })
      expect(result.current.dirty).toBe(false)
      expect(result.current.saving).toBe(false)
    })

    it('reads once the page turns active', async () => {
      const view = renderGeneral(false)
      await flush()

      view.rerender({ active: true })
      await flush()

      expect(mockFetchLogLevel).toHaveBeenCalledTimes(1)
      expect(mockFetchMaskingSettings).toHaveBeenCalledTimes(1)
      expect(view.result.current.status).toBe('loaded')
    })

    it('does not read again while the page stays active', async () => {
      const view = await renderLoaded()

      view.rerender({ active: true })
      await flush()

      expect(mockFetchLogLevel).toHaveBeenCalledTimes(1)
      expect(mockFetchMaskingSettings).toHaveBeenCalledTimes(1)
    })

    it('is failed with the API reason when the log level read fails', async () => {
      mockFetchLogLevel.mockRejectedValueOnce(new Error(READ_FAILURE))

      const { result } = renderGeneral(true)
      await flush()

      expect(result.current.status).toBe('failed')
      expect(result.current.error).toBe(READ_FAILURE)
    })

    it('is failed with the API reason when the masking read fails', async () => {
      mockFetchMaskingSettings.mockRejectedValueOnce(new Error(READ_FAILURE))

      const { result } = renderGeneral(true)
      await flush()

      expect(result.current.status).toBe('failed')
      expect(result.current.error).toBe(READ_FAILURE)
    })

    it('retry reads both again: pending, then loaded', async () => {
      mockFetchMaskingSettings.mockRejectedValueOnce(new Error(READ_FAILURE))
      const { result } = renderGeneral(true)
      await flush()
      expect(result.current.status).toBe('failed')

      const levelRead = deferred<LogLevel>()
      mockFetchLogLevel.mockReturnValueOnce(levelRead.promise)
      act(() => {
        result.current.retry()
      })
      await flush()
      expect(mockFetchLogLevel).toHaveBeenCalledTimes(2)
      expect(mockFetchMaskingSettings).toHaveBeenCalledTimes(2)
      expect(result.current.status).toBe('pending')
      expect(result.current.error).toBeUndefined()

      await act(async () => {
        levelRead.resolve('WARN')
      })
      await flush()

      expect(result.current.status).toBe('loaded')
      expect(result.current.error).toBeUndefined()
      expect(result.current.logLevel).toBe('WARN')
      expect(result.current.staged.masking).toEqual(SAVED_MASKING)
    })

    it('reads again and takes the fresh values when a clean page turns active again', async () => {
      const view = await renderLoaded()
      mockFetchLogLevel.mockResolvedValueOnce('ERROR')
      mockFetchMaskingSettings.mockResolvedValueOnce({ ...SAVED_FLAGS, credential_inputs: true })

      view.rerender({ active: false })
      await flush()
      view.rerender({ active: true })
      await flush()

      expect(mockFetchLogLevel).toHaveBeenCalledTimes(2)
      expect(mockFetchMaskingSettings).toHaveBeenCalledTimes(2)
      expect(view.result.current.logLevel).toBe('ERROR')
      expect(view.result.current.staged.logLevel).toBe('ERROR')
      expect(view.result.current.staged.masking).toEqual({ ...SAVED_MASKING, credentialInputs: true })
      expect(view.result.current.dirty).toBe(false)
    })

    it('keeps the staged values and does not read when a dirty page turns active again', async () => {
      const view = await renderLoaded()
      act(() => {
        view.result.current.stageLogLevel('ERROR')
        view.result.current.stageMasking('sharedVariables', true)
      })

      view.rerender({ active: false })
      await flush()
      view.rerender({ active: true })
      await flush()

      expect(mockFetchLogLevel).toHaveBeenCalledTimes(1)
      expect(mockFetchMaskingSettings).toHaveBeenCalledTimes(1)
      expect(view.result.current.status).toBe('loaded')
      expect(view.result.current.dirty).toBe(true)
      expect(view.result.current.staged.logLevel).toBe('ERROR')
      expect(view.result.current.staged.masking).toEqual({ ...SAVED_MASKING, sharedVariables: true })
    })

    it('does not read on re-activation when only the time zone is staged', async () => {
      const view = await renderLoaded()
      act(() => {
        view.result.current.stageTimezone('utc')
      })

      view.rerender({ active: false })
      await flush()
      view.rerender({ active: true })
      await flush()

      expect(mockFetchLogLevel).toHaveBeenCalledTimes(1)
      expect(mockFetchMaskingSettings).toHaveBeenCalledTimes(1)
      expect(view.result.current.dirty).toBe(true)
      expect(view.result.current.staged.timezone).toBe('utc')
    })
  })

  describe('time zone baseline', () => {
    it('initializes the time zone store once on mount', async () => {
      const view = renderGeneral(false)
      await flush()
      expect(spies.initializeFromStorage).toHaveBeenCalledTimes(1)

      view.rerender({ active: true })
      await flush()
      view.rerender({ active: false })
      await flush()

      expect(spies.initializeFromStorage).toHaveBeenCalledTimes(1)
    })

    it("takes the browser's saved zone as the baseline before the read answers", async () => {
      localStorage.setItem(TIMEZONE_STORAGE_KEY, 'utc')
      mockFetchLogLevel.mockReturnValueOnce(deferred<LogLevel>().promise)

      const { result } = renderGeneral(true)
      await flush()

      expect(result.current.status).toBe('pending')
      expect(result.current.staged.timezone).toBe('utc')
      expect(result.current.dirty).toBe(false)
    })

    it('never writes the time zone store on mount or on read', async () => {
      await renderLoaded()

      expect(spies.setMode).not.toHaveBeenCalled()
    })
  })

  describe('staging', () => {
    it('stageLogLevel stages the level, keeps the level in force and marks the page dirty', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.stageLogLevel('DEBUG')
      })

      expect(result.current.staged.logLevel).toBe('DEBUG')
      expect(result.current.logLevel).toBe(SAVED_LEVEL)
      expect(result.current.dirty).toBe(true)
    })

    it('stageTimezone stages the zone without touching the browser store', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.stageTimezone('utc')
      })

      expect(result.current.staged.timezone).toBe('utc')
      expect(result.current.dirty).toBe(true)
      expect(spies.setMode).not.toHaveBeenCalled()
      expect(useTimezoneStore.getState().mode).toBe('local')
      expect(localStorage.getItem(TIMEZONE_STORAGE_KEY)).toBeNull()
    })

    it.each(FLAG_CASES)('stageMasking stages $key alone and marks the page dirty', async ({ key }) => {
      const { result } = await renderLoaded()
      const storeBefore = storeFlags()

      act(() => {
        result.current.stageMasking(key, !SAVED_MASKING[key])
      })

      expect(result.current.staged.masking).toEqual({ ...SAVED_MASKING, [key]: !SAVED_MASKING[key] })
      expect(result.current.dirty).toBe(true)
      expect(spies.maskingSet).not.toHaveBeenCalled()
      expect(storeFlags()).toEqual(storeBefore)
    })

    it('writes nothing to the server while staging', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.stageLogLevel('DEBUG')
        result.current.stageTimezone('utc')
        result.current.stageMasking('runOutput', true)
      })

      expect(mockSetLogLevel).not.toHaveBeenCalled()
      expect(mockSetMaskingSettings).not.toHaveBeenCalled()
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(toastError).not.toHaveBeenCalled()
      expect(result.current.saving).toBe(false)
    })

    it('is clean again when every staged value returns to its baseline', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageLogLevel('DEBUG')
        result.current.stageTimezone('utc')
        result.current.stageMasking('testVariables', false)
      })
      expect(result.current.dirty).toBe(true)

      act(() => {
        result.current.stageLogLevel(SAVED_LEVEL)
      })
      expect(result.current.dirty).toBe(true)
      act(() => {
        result.current.stageTimezone('local')
      })
      expect(result.current.dirty).toBe(true)
      act(() => {
        result.current.stageMasking('testVariables', true)
      })

      expect(result.current.dirty).toBe(false)
    })
  })

  describe('cancel', () => {
    it('restores every baseline and writes nothing', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageLogLevel('FATAL')
        result.current.stageTimezone('utc')
        result.current.stageMasking('runOutput', true)
        result.current.stageMasking('testVariables', false)
      })

      act(() => {
        result.current.cancel()
      })

      expect(result.current.staged).toEqual({
        logLevel: SAVED_LEVEL,
        timezone: 'local',
        masking: SAVED_MASKING,
      })
      expect(result.current.logLevel).toBe(SAVED_LEVEL)
      expect(result.current.dirty).toBe(false)
      expect(mockSetLogLevel).not.toHaveBeenCalled()
      expect(mockSetMaskingSettings).not.toHaveBeenCalled()
      expect(spies.setMode).not.toHaveBeenCalled()
      expect(spies.maskingSet).not.toHaveBeenCalled()
    })
  })

  describe('save', () => {
    it('writes the log level, then the masking flags, then the time zone', async () => {
      const levelWrite = deferred<LogLevel>()
      const maskingWrite = deferred<MaskingSettingsApiResponse>()
      mockSetLogLevel.mockReturnValueOnce(levelWrite.promise)
      mockSetMaskingSettings.mockReturnValueOnce(maskingWrite.promise)
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageLogLevel('DEBUG')
        result.current.stageMasking('runOutput', true)
        result.current.stageTimezone('utc')
      })

      await act(async () => {
        result.current.save()
      })
      expect(mockSetLogLevel).toHaveBeenCalledTimes(1)
      expect(mockSetLogLevel).toHaveBeenCalledWith('DEBUG')
      expect(mockSetMaskingSettings).not.toHaveBeenCalled()
      expect(spies.setMode).not.toHaveBeenCalled()
      expect(result.current.saving).toBe(true)

      await act(async () => {
        levelWrite.resolve('DEBUG')
      })
      await flush()
      expect(mockSetMaskingSettings).toHaveBeenCalledTimes(1)
      expect(spies.setMode).not.toHaveBeenCalled()
      expect(useTimezoneStore.getState().mode).toBe('local')
      expect(result.current.saving).toBe(true)

      await act(async () => {
        maskingWrite.resolve({ ...SAVED_FLAGS, run_output: true })
      })
      await flush()

      expect(spies.setMode).toHaveBeenCalledTimes(1)
      expect(spies.setMode).toHaveBeenCalledWith('utc')
      expect(mockSetLogLevel).toHaveBeenCalledTimes(1)
      expect(mockSetMaskingSettings).toHaveBeenCalledTimes(1)
      expect(result.current.saving).toBe(false)
    })

    it('sends only the masking flags that changed', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageMasking('runOutput', true)
        result.current.stageMasking('testVariables', false)
      })

      await save(result)

      expect(mockSetMaskingSettings).toHaveBeenCalledTimes(1)
      expect(mockSetMaskingSettings.mock.calls[0][0]).toStrictEqual({
        run_output: true,
        test_variables: false,
      })
    })

    it.each(FLAG_CASES)('sends $wire alone when only $key changed', async ({ key, wire }) => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageMasking(key, !SAVED_MASKING[key])
      })

      await save(result)

      expect(mockSetMaskingSettings).toHaveBeenCalledTimes(1)
      expect(mockSetMaskingSettings.mock.calls[0][0]).toStrictEqual({ [wire]: !SAVED_MASKING[key] })
    })

    it('leaves out a flag that was staged and then put back', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageMasking('runOutput', true)
        result.current.stageMasking('sharedVariables', true)
        result.current.stageMasking('sharedVariables', false)
      })

      await save(result)

      expect(mockSetMaskingSettings.mock.calls[0][0]).toStrictEqual({ run_output: true })
    })

    it('skips the log level write when the level did not change', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageMasking('runOutput', true)
        result.current.stageTimezone('utc')
      })

      await save(result)

      expect(mockSetLogLevel).not.toHaveBeenCalled()
      expect(mockSetMaskingSettings).toHaveBeenCalledTimes(1)
      expect(spies.setMode).toHaveBeenCalledWith('utc')
      expect(result.current.dirty).toBe(false)
    })

    it('skips the masking write when no flag changed', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageLogLevel('WARN')
        result.current.stageTimezone('utc')
      })

      await save(result)

      expect(mockSetLogLevel).toHaveBeenCalledTimes(1)
      expect(mockSetLogLevel).toHaveBeenCalledWith('WARN')
      expect(mockSetMaskingSettings).not.toHaveBeenCalled()
      expect(spies.maskingSet).not.toHaveBeenCalled()
      expect(spies.setMode).toHaveBeenCalledWith('utc')
      expect(result.current.dirty).toBe(false)
    })

    it('leaves the time zone store alone when the zone did not change', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageLogLevel('WARN')
        result.current.stageMasking('runOutput', true)
      })

      await save(result)

      expect(spies.setMode).not.toHaveBeenCalled()
      expect(localStorage.getItem(TIMEZONE_STORAGE_KEY)).toBeNull()
      expect(result.current.dirty).toBe(false)
    })

    it('saves a time zone change alone without a server write', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageTimezone('utc')
      })

      await save(result)

      expect(mockSetLogLevel).not.toHaveBeenCalled()
      expect(mockSetMaskingSettings).not.toHaveBeenCalled()
      expect(spies.setMode).toHaveBeenCalledTimes(1)
      expect(spies.setMode).toHaveBeenCalledWith('utc')
      expect(useTimezoneStore.getState().mode).toBe('utc')
      expect(localStorage.getItem(TIMEZONE_STORAGE_KEY)).toBe('utc')
      expect(result.current.staged.timezone).toBe('utc')
      expect(result.current.dirty).toBe(false)
      expect(result.current.saving).toBe(false)
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(toastError).not.toHaveBeenCalled()
    })

    it('is saving while a write is in flight', async () => {
      const write = deferred<LogLevel>()
      mockSetLogLevel.mockReturnValueOnce(write.promise)
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageLogLevel('DEBUG')
      })

      await act(async () => {
        result.current.save()
      })
      expect(result.current.saving).toBe(true)

      await act(async () => {
        write.resolve('DEBUG')
      })
      await flush()

      expect(result.current.saving).toBe(false)
    })

    it('makes the responses the new baselines and updates both stores, with no toast', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageLogLevel('DEBUG')
        result.current.stageMasking('runOutput', true)
        result.current.stageMasking('testVariables', false)
        result.current.stageTimezone('utc')
      })

      await save(result)

      const savedMasking: Masking = { ...SAVED_MASKING, runOutput: true, testVariables: false }
      expect(result.current.status).toBe('loaded')
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(false)
      expect(result.current.logLevel).toBe('DEBUG')
      expect(result.current.staged).toEqual({ logLevel: 'DEBUG', timezone: 'utc', masking: savedMasking })
      expect(spies.maskingSet).toHaveBeenCalled()
      expect(storeFlags()).toEqual(savedMasking)
      expect(spies.setMode).toHaveBeenCalledTimes(1)
      expect(spies.setMode).toHaveBeenCalledWith('utc')
      expect(useTimezoneStore.getState().mode).toBe('utc')
      expect(localStorage.getItem(TIMEZONE_STORAGE_KEY)).toBe('utc')
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(toastError).not.toHaveBeenCalled()
      expect(mockFetchLogLevel).toHaveBeenCalledTimes(1)
      expect(mockFetchMaskingSettings).toHaveBeenCalledTimes(1)

      act(() => {
        result.current.cancel()
      })
      expect(result.current.staged).toEqual({ logLevel: 'DEBUG', timezone: 'utc', masking: savedMasking })
      expect(result.current.dirty).toBe(false)
    })

    it('takes the whole masking response as the baseline, a flag changed elsewhere included', async () => {
      const response: MaskingSettingsApiResponse = {
        run_output: true,
        test_variables: true,
        shared_variables: false,
        credential_inputs: true,
      }
      mockSetMaskingSettings.mockResolvedValueOnce(response)
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageMasking('runOutput', true)
      })

      await save(result)

      const savedMasking: Masking = {
        runOutput: true,
        testVariables: true,
        sharedVariables: false,
        credentialInputs: true,
      }
      expect(result.current.dirty).toBe(false)
      expect(result.current.staged.masking).toEqual(savedMasking)
      expect(storeFlags()).toEqual(savedMasking)
    })

    it('does not resend a saved part on the next Save after a success', async () => {
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageLogLevel('DEBUG')
        result.current.stageMasking('runOutput', true)
      })
      await save(result)

      act(() => {
        result.current.stageMasking('sharedVariables', true)
      })
      await save(result)

      expect(mockSetLogLevel).toHaveBeenCalledTimes(1)
      expect(mockSetMaskingSettings).toHaveBeenCalledTimes(2)
      expect(mockSetMaskingSettings.mock.calls[1][0]).toStrictEqual({ shared_variables: true })
    })
  })

  describe('save failure', () => {
    it('stops at a failed log level write: toast with the exact message, nothing else written, staged kept', async () => {
      mockSetLogLevel.mockRejectedValueOnce(new Error(SAVE_FAILURE))
      const { result } = await renderLoaded()
      const storeBefore = storeFlags()
      act(() => {
        result.current.stageLogLevel('DEBUG')
        result.current.stageMasking('runOutput', true)
        result.current.stageTimezone('utc')
      })

      await save(result)

      expect(mockSetLogLevel).toHaveBeenCalledTimes(1)
      expect(mockSetMaskingSettings).not.toHaveBeenCalled()
      expect(spies.setMode).not.toHaveBeenCalled()
      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith(SAVE_FAILURE, SAVE_FAILURE_TITLE)
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(result.current.status).toBe('loaded')
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(true)
      expect(result.current.logLevel).toBe(SAVED_LEVEL)
      expect(result.current.staged).toEqual({
        logLevel: 'DEBUG',
        timezone: 'utc',
        masking: { ...SAVED_MASKING, runOutput: true },
      })
      expect(spies.maskingSet).not.toHaveBeenCalled()
      expect(storeFlags()).toEqual(storeBefore)
      expect(useTimezoneStore.getState().mode).toBe('local')
      expect(localStorage.getItem(TIMEZONE_STORAGE_KEY)).toBeNull()
      expect(mockFetchLogLevel).toHaveBeenCalledTimes(1)
    })

    it('stops at a failed masking write: the saved log level becomes the baseline and the time zone is not applied', async () => {
      mockSetMaskingSettings.mockRejectedValueOnce(new Error(SAVE_FAILURE))
      const { result } = await renderLoaded()
      const storeBefore = storeFlags()
      act(() => {
        result.current.stageLogLevel('DEBUG')
        result.current.stageMasking('runOutput', true)
        result.current.stageTimezone('utc')
      })

      await save(result)

      expect(mockSetLogLevel).toHaveBeenCalledTimes(1)
      expect(mockSetMaskingSettings).toHaveBeenCalledTimes(1)
      expect(spies.setMode).not.toHaveBeenCalled()
      expect(useTimezoneStore.getState().mode).toBe('local')
      expect(localStorage.getItem(TIMEZONE_STORAGE_KEY)).toBeNull()
      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith(SAVE_FAILURE, SAVE_FAILURE_TITLE)
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(result.current.status).toBe('loaded')
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(true)
      expect(result.current.logLevel).toBe('DEBUG')
      expect(result.current.staged).toEqual({
        logLevel: 'DEBUG',
        timezone: 'utc',
        masking: { ...SAVED_MASKING, runOutput: true },
      })
      expect(spies.maskingSet).not.toHaveBeenCalled()
      expect(storeFlags()).toEqual(storeBefore)
    })

    it('does not send the saved log level again on the next Save after a masking failure', async () => {
      mockSetMaskingSettings.mockRejectedValueOnce(new Error(SAVE_FAILURE))
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageLogLevel('DEBUG')
        result.current.stageMasking('runOutput', true)
        result.current.stageTimezone('utc')
      })
      await save(result)

      await save(result)

      expect(mockSetLogLevel).toHaveBeenCalledTimes(1)
      expect(mockSetMaskingSettings).toHaveBeenCalledTimes(2)
      expect(mockSetMaskingSettings.mock.calls[1][0]).toStrictEqual({ run_output: true })
      expect(spies.setMode).toHaveBeenCalledTimes(1)
      expect(spies.setMode).toHaveBeenCalledWith('utc')
      expect(toastError).toHaveBeenCalledTimes(1)
      expect(result.current.dirty).toBe(false)
      expect(result.current.staged).toEqual({
        logLevel: 'DEBUG',
        timezone: 'utc',
        masking: { ...SAVED_MASKING, runOutput: true },
      })
    })

    it('Cancel after a masking failure keeps the saved log level and restores the rest', async () => {
      mockSetMaskingSettings.mockRejectedValueOnce(new Error(SAVE_FAILURE))
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageLogLevel('DEBUG')
        result.current.stageMasking('runOutput', true)
        result.current.stageTimezone('utc')
      })
      await save(result)

      act(() => {
        result.current.cancel()
      })

      expect(result.current.logLevel).toBe('DEBUG')
      expect(result.current.staged).toEqual({
        logLevel: 'DEBUG',
        timezone: 'local',
        masking: SAVED_MASKING,
      })
      expect(result.current.dirty).toBe(false)
    })

    it('sends the same writes again on the next Save after a log level failure', async () => {
      mockSetLogLevel.mockRejectedValueOnce(new Error(SAVE_FAILURE))
      const { result } = await renderLoaded()
      act(() => {
        result.current.stageLogLevel('DEBUG')
        result.current.stageMasking('runOutput', true)
      })
      await save(result)

      await save(result)

      expect(mockSetLogLevel).toHaveBeenCalledTimes(2)
      expect(mockSetLogLevel).toHaveBeenLastCalledWith('DEBUG')
      expect(mockSetMaskingSettings).toHaveBeenCalledTimes(1)
      expect(mockSetMaskingSettings.mock.calls[0][0]).toStrictEqual({ run_output: true })
      expect(result.current.dirty).toBe(false)
      expect(result.current.logLevel).toBe('DEBUG')
    })
  })
})
