/**
 * useStagedFields Hook Tests
 *
 * REQ-4.7.16: the staging core the staged Settings pages share (SETTINGS-18) - staged values
 * over the saved ones, the dirty flag with a page's own compare rule, Cancel, and a Save that
 * sends what the page's own function returns.
 *
 * Module under test: frontend/src/features/settings/container/use-staged-fields.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCallback } from 'react'

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, warning: vi.fn(), info: vi.fn() }),
}))

import { stagedPassword, useStagedFields } from '@/features/settings/container/use-staged-fields'

// ============================================================================
// Fixtures
// ============================================================================

/** The fields of a page that stages plain values and one list. */
interface Fields {
  enabled: boolean
  port: number
  name: string
  tags: string[]
}

type Update = Partial<Fields>
type Options = Parameters<typeof useStagedFields<Fields, Update>>[0]
type StagedRef = { current: ReturnType<typeof useStagedFields<Fields, Update>> }
type FieldEdit = [keyof Fields, Fields[keyof Fields]]

const SAVED: Fields = {
  enabled: false,
  port: 8765,
  name: 'wave',
  tags: ['environments', 'tests'],
}

const SAVED_ON: Fields = { ...SAVED, enabled: true }

const OTHER_SAVED: Fields = { enabled: true, port: 9100, name: 'lab', tags: ['suites'] }

/** One new value per field, each different from the saved one. */
const FIELD_EDITS: FieldEdit[] = [
  ['enabled', true],
  ['port', 9001],
  ['name', 'ops'],
  ['tags', ['tests']],
]

const REORDERED_TAGS = ['tests', 'environments']

const FAILURE_TITLE = 'Could Not Save Proxy'

const SAVE_FAILURE =
  'Settings cannot be saved: the config file /srv/wave/config/config.yaml is read-only'

/** A page's "what to send": only the fields whose staged value is not the saved one. */
function changedFields(saved: Fields, staged: Fields): Update {
  const update: Update = {}
  if (staged.enabled !== saved.enabled) update.enabled = staged.enabled
  if (staged.port !== saved.port) update.port = staged.port
  if (staged.name !== saved.name) update.name = staged.name
  if (staged.tags !== saved.tags) update.tags = staged.tags
  return update
}

/** A page's "what to send": every staged field while on, the switch alone when off. */
function wholeOrOff(_saved: Fields, staged: Fields): Update {
  return staged.enabled ? staged : { enabled: false }
}

function sameMembers(a: string[], b: string[]): boolean {
  const members = new Set(b)
  return new Set(a).size === members.size && a.every((item) => members.has(item))
}

/** A page's compare rule: tags compare as a set, every other field by value. */
function tagsAsSet(field: keyof Fields, saved: Fields, staged: Fields): boolean {
  if (field === 'tags') return !sameMembers(saved.tags, staged.tags)
  return saved[field] !== staged[field]
}

const toUpdate = vi.fn<(saved: Fields, staged: Fields) => Update>()
const send = vi.fn<(update: Update) => Promise<Fields>>()

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

// ============================================================================
// Utilities
// ============================================================================

function optionsWith(overrides: Partial<Options> = {}): Options {
  return { saved: SAVED, toUpdate, send, failureTitle: FAILURE_TITLE, ...overrides }
}

function renderStaged(overrides: Partial<Options> = {}) {
  return renderHook((options: Options) => useStagedFields<Fields, Update>(options), {
    initialProps: optionsWith(overrides),
  })
}

/** A page hook that wraps stage: naming the endpoint also turns it on. */
function useNamedEndpoint(options: Options) {
  const fields = useStagedFields<Fields, Update>(options)
  const { stage } = fields
  const stageName = useCallback(
    (name: string) => {
      stage('name', name)
      stage('enabled', true)
    },
    [stage],
  )
  return { ...fields, stageName }
}

function renderNamedEndpoint() {
  return renderHook((options: Options) => useNamedEndpoint(options), {
    initialProps: optionsWith(),
  })
}

/** Stages each edit in its own update, as separate gestures on the page do. */
function stageAll(result: StagedRef, edits: Partial<Fields>) {
  for (const [field, value] of Object.entries(edits) as FieldEdit[]) {
    act(() => {
      result.current.stage(field, value)
    })
  }
}

/** Starts a Save and leaves its request open. */
function startSave(result: StagedRef): Promise<boolean> {
  let pending!: Promise<boolean>
  act(() => {
    pending = result.current.save()
  })
  return pending
}

/** Runs a Save to its end and gives what it resolved to. */
function saveAndSettle(result: StagedRef): Promise<boolean> {
  return act(() => result.current.save())
}

// ============================================================================
// Tests
// ============================================================================

describe('useStagedFields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset, not clear: an answer queued by a failed test must not reach the next one.
    toUpdate.mockReset().mockImplementation(changedFields)
    send.mockReset().mockResolvedValue(SAVED)
  })

  describe('saved values', () => {
    it('holds no staged values and is clean until the saved values arrive', () => {
      const { result } = renderStaged({ saved: undefined })

      expect(result.current.staged).toBeUndefined()
      expect(result.current.dirty).toBe(false)
      expect(result.current.saving).toBe(false)
      expect(send).not.toHaveBeenCalled()
    })

    it('a Save asked before the saved values arrive resolves false and sends nothing', async () => {
      const { result } = renderStaged({ saved: undefined })

      const outcome = await saveAndSettle(result)

      expect(outcome).toBe(false)
      expect(toUpdate).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
      expect(toastError).not.toHaveBeenCalled()
      expect(result.current.saving).toBe(false)
    })

    it('shows the saved values once they arrive', () => {
      const view = renderStaged({ saved: undefined })

      view.rerender(optionsWith({ saved: SAVED }))

      expect(view.result.current.staged).toEqual(SAVED)
      expect(view.result.current.dirty).toBe(false)
    })

    it('follows new saved values while nothing is staged', () => {
      const view = renderStaged()
      expect(view.result.current.staged).toEqual(SAVED)

      view.rerender(optionsWith({ saved: OTHER_SAVED }))

      expect(view.result.current.staged).toEqual(OTHER_SAVED)
      expect(view.result.current.dirty).toBe(false)
    })
  })

  describe('stage', () => {
    it.each(FIELD_EDITS)(
      'stage(%s) holds the new value, marks the page dirty and sends nothing',
      (field, value) => {
        const { result } = renderStaged()

        act(() => {
          result.current.stage(field, value)
        })

        expect(result.current.staged).toEqual({ ...SAVED, [field]: value })
        expect(result.current.dirty).toBe(true)
        expect(result.current.saving).toBe(false)
        expect(send).not.toHaveBeenCalled()
      },
    )

    it.each(FIELD_EDITS)(
      'stage(%s) back to the saved value makes the page clean again',
      (field, value) => {
        const { result } = renderStaged()
        act(() => {
          result.current.stage(field, value)
        })
        expect(result.current.dirty).toBe(true)

        act(() => {
          result.current.stage(field, SAVED[field])
        })

        expect(result.current.dirty).toBe(false)
        expect(result.current.staged).toEqual(SAVED)
        expect(send).not.toHaveBeenCalled()
      },
    )

    it('holds several staged fields together', () => {
      const { result } = renderStaged()

      stageAll(result, { enabled: true, port: 9001, name: 'ops' })

      expect(result.current.staged).toEqual({ ...SAVED, enabled: true, port: 9001, name: 'ops' })
      expect(result.current.dirty).toBe(true)
    })

    it('stays dirty until every staged field is back at its saved value', () => {
      const { result } = renderStaged()
      stageAll(result, { port: 9001, name: 'ops' })

      stageAll(result, { port: 8765 })
      expect(result.current.dirty).toBe(true)

      stageAll(result, { name: 'wave' })
      expect(result.current.dirty).toBe(false)
      expect(result.current.staged).toEqual(SAVED)
    })
  })

  describe('compare rule', () => {
    it('without a rule counts the same members in another order as a change', () => {
      const { result } = renderStaged()

      stageAll(result, { tags: REORDERED_TAGS })

      expect(result.current.dirty).toBe(true)
    })

    it('asks the rule with the field, the saved values and the staged values', () => {
      const differs = vi.fn(tagsAsSet)
      const { result } = renderStaged({ differs })

      stageAll(result, { tags: REORDERED_TAGS })

      expect(differs).toHaveBeenCalledWith('tags', SAVED, { ...SAVED, tags: REORDERED_TAGS })
    })

    it('is clean when the rule calls the staged value equal: the same members in another order', () => {
      const { result } = renderStaged({ differs: tagsAsSet })

      stageAll(result, { tags: ['tests'] })
      expect(result.current.dirty).toBe(true)
      stageAll(result, { tags: REORDERED_TAGS })

      expect(result.current.dirty).toBe(false)
    })

    it.each([
      ['one member fewer', ['tests']],
      ['one member more', ['environments', 'tests', 'suites']],
      ['as many members, one of them another', ['environments', 'suites']],
    ])('is dirty when the rule calls the staged value different: %s', (_case, tags) => {
      const { result } = renderStaged({ differs: tagsAsSet })

      stageAll(result, { tags })

      expect(result.current.dirty).toBe(true)
    })

    it('is dirty while the rule calls one staged field different, and clean once it calls none', () => {
      const { result } = renderStaged({ differs: tagsAsSet })

      stageAll(result, { tags: REORDERED_TAGS, port: 9001 })
      expect(result.current.dirty).toBe(true)

      stageAll(result, { port: 8765 })
      expect(result.current.dirty).toBe(false)
    })
  })

  describe('cancel', () => {
    it('restores the saved values and sends nothing', () => {
      const { result } = renderStaged()
      stageAll(result, { enabled: true, port: 9001, tags: ['tests'] })
      expect(result.current.dirty).toBe(true)

      act(() => {
        result.current.cancel()
      })

      expect(result.current.staged).toEqual(SAVED)
      expect(result.current.dirty).toBe(false)
      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('a page wrapper around stage', () => {
    it('holds both fields when the wrapper stages two in one gesture', async () => {
      const { result } = renderNamedEndpoint()

      act(() => {
        result.current.stageName('ops')
      })

      expect(result.current.staged).toEqual({ ...SAVED, name: 'ops', enabled: true })
      expect(result.current.dirty).toBe(true)

      await saveAndSettle(result)

      expect(toUpdate).toHaveBeenCalledWith(SAVED, { ...SAVED, name: 'ops', enabled: true })
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0]).toStrictEqual([{ enabled: true, name: 'ops' }])
    })

    it('lets each of the two fields go back to its saved value on its own', () => {
      const { result } = renderNamedEndpoint()
      act(() => {
        result.current.stageName('ops')
      })

      stageAll(result, { enabled: false })
      expect(result.current.staged).toEqual({ ...SAVED, name: 'ops' })
      expect(result.current.dirty).toBe(true)

      stageAll(result, { name: 'wave' })
      expect(result.current.staged).toEqual(SAVED)
      expect(result.current.dirty).toBe(false)
    })

    it('Cancel restores both fields', () => {
      const { result } = renderNamedEndpoint()
      act(() => {
        result.current.stageName('ops')
      })

      act(() => {
        result.current.cancel()
      })

      expect(result.current.staged).toEqual(SAVED)
      expect(result.current.dirty).toBe(false)
    })
  })

  describe('save', () => {
    it('hands the page function the saved values and the staged values', async () => {
      const { result } = renderStaged()
      stageAll(result, { port: 9001, name: 'ops' })

      await saveAndSettle(result)

      expect(toUpdate).toHaveBeenCalledWith(SAVED, { ...SAVED, port: 9001, name: 'ops' })
    })

    it('sends exactly what the page function returned: the changed fields only', async () => {
      const { result } = renderStaged()
      stageAll(result, { port: 9001, name: 'ops' })

      await saveAndSettle(result)

      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0]).toStrictEqual([{ port: 9001, name: 'ops' }])
    })

    it('sends exactly what the page function returned: every staged field, changed or not', async () => {
      toUpdate.mockImplementation(wholeOrOff)
      const { result } = renderStaged({ saved: SAVED_ON })
      stageAll(result, { port: 9001 })

      await saveAndSettle(result)

      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0]).toStrictEqual([{ ...SAVED_ON, port: 9001 }])
    })

    it('sends exactly what the page function returned: one field, other staged edits left out', async () => {
      toUpdate.mockImplementation(wholeOrOff)
      const { result } = renderStaged({ saved: SAVED_ON })
      stageAll(result, { port: 9001, name: 'ops', enabled: false })

      await saveAndSettle(result)

      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0]).toStrictEqual([{ enabled: false }])
    })

    it('is saving while the request is open', async () => {
      const write = deferred<Fields>()
      send.mockReturnValueOnce(write.promise)
      const { result } = renderStaged()
      stageAll(result, { port: 9001 })
      expect(result.current.saving).toBe(false)

      const pending = startSave(result)
      expect(result.current.saving).toBe(true)
      expect(result.current.staged).toEqual({ ...SAVED, port: 9001 })

      const outcome = await act(() => {
        write.resolve({ ...SAVED, port: 9001 })
        return pending
      })

      expect(outcome).toBe(true)
      expect(result.current.saving).toBe(false)
    })

    it('resolves true and is clean again when the request succeeds', async () => {
      send.mockResolvedValueOnce({ ...SAVED, port: 9001 })
      const { result } = renderStaged()
      stageAll(result, { port: 9001 })

      const outcome = await saveAndSettle(result)

      expect(outcome).toBe(true)
      expect(result.current.dirty).toBe(false)
      expect(result.current.saving).toBe(false)
    })

    it('shows no toast when the request succeeds', async () => {
      const { result } = renderStaged()
      stageAll(result, { port: 9001 })

      await saveAndSettle(result)

      expect(toastSuccess).not.toHaveBeenCalled()
      expect(toastError).not.toHaveBeenCalled()
    })

    it('shows the new saved values after a successful Save, not the edits it sent', async () => {
      const answer: Fields = { ...SAVED, port: 9001, name: 'ops' }
      send.mockResolvedValueOnce(answer)
      const view = renderStaged()
      stageAll(view.result, { port: 9001, name: ' ops ' })

      await saveAndSettle(view.result)
      view.rerender(optionsWith({ saved: answer }))

      expect(view.result.current.staged).toEqual(answer)
      expect(view.result.current.dirty).toBe(false)

      stageAll(view.result, { port: 9002 })
      act(() => {
        view.result.current.cancel()
      })
      expect(view.result.current.staged).toEqual(answer)
      expect(view.result.current.dirty).toBe(false)
    })

    it('on a failure resolves false, shows the failure toast with the given title and keeps the staged values', async () => {
      send.mockRejectedValueOnce(apiError(SAVE_FAILURE, 500))
      const { result } = renderStaged()
      stageAll(result, { port: 9001, name: 'ops' })

      const outcome = await saveAndSettle(result)

      expect(outcome).toBe(false)
      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith(SAVE_FAILURE, FAILURE_TITLE)
      expect(toastSuccess).not.toHaveBeenCalled()
      expect(result.current.saving).toBe(false)
      expect(result.current.dirty).toBe(true)
      expect(result.current.staged).toEqual({ ...SAVED, port: 9001, name: 'ops' })
    })

    it('is saving until a failing request has answered', async () => {
      const write = deferred<Fields>()
      send.mockReturnValueOnce(write.promise)
      const { result } = renderStaged()
      stageAll(result, { port: 9001 })

      const pending = startSave(result)
      expect(result.current.saving).toBe(true)

      const outcome = await act(() => {
        write.reject(apiError(SAVE_FAILURE, 500))
        return pending
      })

      expect(outcome).toBe(false)
      expect(result.current.saving).toBe(false)
    })

    it('reports "Request failed" when the rejection carries no reason', async () => {
      send.mockRejectedValueOnce({ code: 500 })
      const { result } = renderStaged()
      stageAll(result, { port: 9001 })

      const outcome = await saveAndSettle(result)

      expect(outcome).toBe(false)
      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith('Request failed', FAILURE_TITLE)
    })

    it('keeps the saved values as the Cancel target after a failed Save', async () => {
      send.mockRejectedValueOnce(apiError(SAVE_FAILURE, 500))
      const { result } = renderStaged()
      stageAll(result, { port: 9001 })
      await saveAndSettle(result)

      act(() => {
        result.current.cancel()
      })

      expect(result.current.staged).toEqual(SAVED)
      expect(result.current.dirty).toBe(false)
    })

    it('sends the same request again on the next Save after a failure', async () => {
      send.mockRejectedValueOnce(apiError(SAVE_FAILURE, 500))
      send.mockResolvedValueOnce({ ...SAVED, port: 9001 })
      const { result } = renderStaged()
      stageAll(result, { port: 9001 })
      await saveAndSettle(result)

      const outcome = await saveAndSettle(result)

      expect(outcome).toBe(true)
      expect(send).toHaveBeenCalledTimes(2)
      expect(send.mock.calls[1]).toStrictEqual(send.mock.calls[0])
      expect(toastError).toHaveBeenCalledTimes(1)
      expect(result.current.dirty).toBe(false)
    })
  })
})

describe('stagedPassword', () => {
  it('stages an empty password as undefined while no password is stored', () => {
    expect(stagedPassword(false, '')).toBeUndefined()
  })

  it('stages an empty password as the empty text while a password is stored', () => {
    expect(stagedPassword(true, '')).toBe('')
  })

  it.each([true, false])('stages a typed password as typed (stored: %s)', (stored) => {
    expect(stagedPassword(stored, 'n3w-s3cret')).toBe('n3w-s3cret')
  })

  it.each([true, false])('leaves an untouched password undefined (stored: %s)', (stored) => {
    expect(stagedPassword(stored, undefined)).toBeUndefined()
  })
})
