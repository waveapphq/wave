/**
 * The server completion skeleton every server-backed script suggestion list builds on: the word start, the
 * expression catalog merged in front of the server's options (inside {{ }} for a Template body), the 150 ms
 * debounce, the abort of a superseded request and the silent fallback when the server fails. The fetcher is
 * passed in, so nothing here reaches the network.
 *
 * REQ-3.3.2.6; PYRUN-19, SQL-11, OS-12
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import {
  CompletionContext,
  type Completion,
  type CompletionResult,
} from '@codemirror/autocomplete'

import {
  createTemplateCompletionSource,
  type AvailableVariable,
} from '@/features/workbench/lib/codemirror/expression-completion'
import {
  createServerCompletionSource,
  type ServerAnswer,
} from '@/features/workbench/lib/codemirror/server-completion'

// ============================================
// Fixtures
// ============================================

/** The debounce window the editor holds a keystroke for before asking the server. */
const DEBOUNCE_MS = 150

interface Body {
  text: string
  cursor: number
}

const CATALOG_OPTIONS: Completion[] = [
  { label: 'rows', type: 'variable' },
  { label: 'len', type: 'function' },
]

const SERVER_OPTIONS: Completion[] = [
  { label: 'getcwd', type: 'function' },
  { label: 'environ', type: 'variable' },
]

const VARIABLES: AvailableVariable[] = [
  { name: 'service', type: 'string' },
  { name: 'region', type: 'string' },
]

type Source = (context: CompletionContext) => Promise<CompletionResult | null>

const fetcher = vi.fn<(body: Body, signal: AbortSignal) => Promise<ServerAnswer>>()

/** A catalog that always answers the same two options. */
const fullCatalog = (): CompletionResult => ({ from: 0, options: CATALOG_OPTIONS })
const emptyCatalog = (): CompletionResult | null => null

/** Asks the server at every position, with the whole text and the cursor. */
const alwaysAsk = (context: CompletionContext): Body => ({
  text: context.state.doc.toString(),
  cursor: context.pos,
})
const neverAsk = (): Body | null => null

function makeSource(
  catalog: (context: CompletionContext) => CompletionResult | null = fullCatalog,
  requestOf: (context: CompletionContext, from: number) => Body | null = alwaysAsk,
): Source {
  return createServerCompletionSource<Body>({ catalog, requestOf, fetcher })
}

function contextFor(doc: string, pos: number = doc.length): CompletionContext {
  return new CompletionContext(EditorState.create({ doc }), pos, false)
}

/** Invoke a source and let the debounce window and the server answer land. */
async function completeWith(
  source: Source,
  doc: string,
  pos: number = doc.length,
): Promise<CompletionResult | null> {
  const pending = source(contextFor(doc, pos))
  await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50)
  return pending
}

function labelsOf(result: CompletionResult | null | undefined): string[] {
  return (result?.options ?? []).map((option) => option.label)
}

function bodyOfCall(index: number): Body {
  return fetcher.mock.calls[index][0]
}

function signalOfCall(index: number): AbortSignal {
  return fetcher.mock.calls[index][1]
}

/** Settles a promise into a readable state without awaiting it forever. */
function track<T>(promise: Promise<T>): { settled: () => boolean; value: () => T | undefined } {
  let done = false
  let result: T | undefined
  void promise.then((value) => {
    done = true
    result = value
  })
  return { settled: () => done, value: () => result }
}

beforeEach(() => {
  vi.useFakeTimers()
  fetcher.mockReset()
  fetcher.mockResolvedValue({ options: SERVER_OPTIONS })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ============================================
// Word start
// ============================================

describe('createServerCompletionSource - word start', () => {
  it('replaces only the word typed before the cursor', async () => {
    const doc = 'import os\nos.ge'

    const result = await completeWith(makeSource(), doc)

    expect(result?.from).toBe(doc.length - 2)
  })

  it('starts at the cursor right after a non-word character', async () => {
    const doc = 'import os\nos.'

    const result = await completeWith(makeSource(), doc)

    expect(result?.from).toBe(doc.length)
  })

  it('starts at 0 in an empty body', async () => {
    const result = await completeWith(makeSource(), '')

    expect(result?.from).toBe(0)
  })

  it('counts letters, digits and underscores as one word', async () => {
    const doc = 'x = my_var2'

    const result = await completeWith(makeSource(), doc)

    expect(result?.from).toBe(4)
  })

  it('reads only the text before the cursor', async () => {
    const doc = 'print(val)\nnext'

    const result = await completeWith(makeSource(), doc, 9)

    expect(result?.from).toBe(6)
  })

  it('hands the context and the word start to requestOf', async () => {
    const requestOf = vi.fn<(context: CompletionContext, from: number) => Body | null>(() => null)
    const doc = 'import os\nos.ge'

    await completeWith(makeSource(fullCatalog, requestOf), doc)

    expect(requestOf).toHaveBeenCalledTimes(1)
    expect(requestOf.mock.calls[0][0].pos).toBe(doc.length)
    expect(requestOf.mock.calls[0][1]).toBe(doc.length - 2)
  })
})

// ============================================
// Catalog alone
// ============================================

describe('createServerCompletionSource - catalog alone', () => {
  it('answers the catalog at once and never asks the server when requestOf answers null', async () => {
    const pending = track(makeSource(fullCatalog, neverAsk)(contextFor('le')))

    await vi.advanceTimersByTimeAsync(0)

    expect(pending.settled()).toBe(true)
    expect(labelsOf(pending.value())).toEqual(['rows', 'len'])
    expect(pending.value()?.from).toBe(0)
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('answers null when requestOf answers null and the catalog answers null', async () => {
    const result = await completeWith(makeSource(emptyCatalog, neverAsk), 'le')

    expect(result).toBeNull()
  })

  it('answers null when requestOf answers null and the catalog offers no option', async () => {
    const result = await completeWith(makeSource(() => ({ from: 0, options: [] }), neverAsk), 'le')

    expect(result).toBeNull()
  })
})

// ============================================
// Merge with the expression catalog
// ============================================

describe('createServerCompletionSource - merge with the catalog', () => {
  it('lists the catalog options first, then the server options', async () => {
    const result = await completeWith(makeSource(), 'os.')

    expect(labelsOf(result)).toEqual(['rows', 'len', 'getcwd', 'environ'])
  })

  it('lists the server options alone when the catalog answers null', async () => {
    const result = await completeWith(makeSource(emptyCatalog), 'os.')

    expect(labelsOf(result)).toEqual(['getcwd', 'environ'])
  })

  it('keeps the catalog options when the server answers none', async () => {
    fetcher.mockResolvedValue({ options: [] })

    const result = await completeWith(makeSource(), 'os.')

    expect(labelsOf(result)).toEqual(['rows', 'len'])
  })

  it('answers null when neither the catalog nor the server offers anything', async () => {
    fetcher.mockResolvedValue({ options: [] })

    const result = await completeWith(makeSource(emptyCatalog), 'os.')

    expect(result).toBeNull()
  })

  it('merges the WAVE variables inside {{ }} of a Template body with the server options', async () => {
    fetcher.mockResolvedValue({ options: [] })
    const source = makeSource(createTemplateCompletionSource(VARIABLES, true))

    const result = await completeWith(source, 'service.name: {{ serv')

    expect(labelsOf(result)).toContain('service')
    expect(result?.from).toBe('service.name: {{ '.length)
  })

  it('offers no WAVE variable outside {{ }} of a Template body', async () => {
    fetcher.mockResolvedValue({ options: [{ label: 'service.name', type: 'property' }] })
    const source = makeSource(createTemplateCompletionSource(VARIABLES, true))

    const result = await completeWith(source, '{{ region }} and serv')

    expect(labelsOf(result)).toEqual(['service.name'])
  })

  it('hands the body requestOf built to the fetcher', async () => {
    await completeWith(makeSource(), 'import os\nos.', 13)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(bodyOfCall(0)).toEqual({ text: 'import os\nos.', cursor: 13 })
  })

  it("keeps the server's own from and to when it sends options", async () => {
    fetcher.mockResolvedValue({ from: 0, to: 9, options: [{ label: 'log.level', type: 'property' }] })

    const result = await completeWith(makeSource(emptyCatalog), 'log.lev: x', 7)

    expect(result?.from).toBe(0)
    expect(result?.to).toBe(9)
    expect(labelsOf(result)).toEqual(['log.level'])
  })

  it('uses the word start, and no end, when the server sends no options with its own from', async () => {
    fetcher.mockResolvedValue({ from: 20, to: 20, options: [] })
    const source = makeSource(createTemplateCompletionSource(VARIABLES, true))
    const doc = 'service.name: {{ reg'

    const result = await completeWith(source, doc)

    expect(labelsOf(result)).toContain('region')
    expect(result?.from).toBe(doc.length - 3)
    expect(result?.to).toBeUndefined()
  })

  it('leaves the end open when the server sends options without one', async () => {
    const result = await completeWith(makeSource(), 'os.')

    expect(result?.to).toBeUndefined()
  })
})

// ============================================
// Debounce
// ============================================

describe('createServerCompletionSource - debounce', () => {
  it('does not reach the server before the debounce window elapses', async () => {
    const source = makeSource()
    const pending = source(contextFor('import os\nos.'))

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1)
    expect(fetcher).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(fetcher).toHaveBeenCalledTimes(1)

    await pending
  })

  it('sends one request for two keystrokes inside the debounce window', async () => {
    const source = makeSource()
    const first = track(source(contextFor('import os\nos.')))
    await vi.advanceTimersByTimeAsync(100)

    const second = source(contextFor('import os\nos.g'))
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(bodyOfCall(0).text).toBe('import os\nos.g')
    expect(first.settled()).toBe(true)
    expect(first.value()).toBeNull()

    await second
  })
})

// ============================================
// Abort and supersede
// ============================================

describe('createServerCompletionSource - abort and supersede', () => {
  it('sends an abort signal with every request', async () => {
    await completeWith(makeSource(), 'os.')

    expect(signalOfCall(0)).toBeInstanceOf(AbortSignal)
    expect(signalOfCall(0).aborted).toBe(false)
  })

  it('aborts the in-flight request when the next keystroke arrives', async () => {
    fetcher.mockReturnValue(new Promise(() => {}))
    const source = makeSource()

    void source(contextFor('import os\nos.'))
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const firstSignal = signalOfCall(0)
    expect(firstSignal.aborted).toBe(false)

    void source(contextFor('import os\nos.g'))
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(firstSignal.aborted).toBe(true)
  })

  it('answers null for the superseded keystroke', async () => {
    fetcher.mockReturnValueOnce(new Promise(() => {}))
    const source = makeSource()

    const first = track(source(contextFor('import os\nos.')))
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    void source(contextFor('import os\nos.g'))
    await vi.advanceTimersByTimeAsync(0)

    expect(first.settled()).toBe(true)
    expect(first.value()).toBeNull()
  })

  it('answers the latest keystroke after canceling the previous request', async () => {
    fetcher.mockReturnValueOnce(new Promise(() => {})).mockResolvedValue({ options: SERVER_OPTIONS })
    const source = makeSource()

    void source(contextFor('import os\nos.'))
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    const second = source(contextFor('import os\nos.g'))
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50)

    expect(labelsOf(await second)).toContain('getcwd')
  })

  it('never answers the superseded keystroke with a server answer that lands late', async () => {
    let answerFirst: (answer: ServerAnswer) => void = () => undefined
    fetcher.mockReturnValueOnce(
      new Promise<ServerAnswer>((resolve) => {
        answerFirst = resolve
      }),
    )
    const source = makeSource()

    const first = track(source(contextFor('import os\nos.')))
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    const second = source(contextFor('import os\nos.g'))
    answerFirst({ options: [{ label: 'late', type: 'function' }] })
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50)

    expect(first.value()).toBeNull()
    expect(labelsOf(await second)).not.toContain('late')
  })

  it('supersedes the pending request with a keystroke answered from the catalog alone', async () => {
    fetcher.mockReturnValue(new Promise(() => {}))
    const asks = vi.fn<(context: CompletionContext) => Body | null>()
    asks.mockImplementationOnce(alwaysAsk).mockImplementation(() => null)
    const source = makeSource(fullCatalog, asks)

    const first = track(source(contextFor('os.')))
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    const firstSignal = signalOfCall(0)
    const second = await source(contextFor('os.x '))

    await vi.advanceTimersByTimeAsync(0)
    expect(firstSignal.aborted).toBe(true)
    expect(first.value()).toBeNull()
    expect(labelsOf(second)).toEqual(['rows', 'len'])
  })

  it('drops a keystroke still inside the debounce window without asking the server', async () => {
    const asks = vi.fn<(context: CompletionContext) => Body | null>()
    asks.mockImplementationOnce(alwaysAsk).mockImplementation(() => null)
    const source = makeSource(fullCatalog, asks)

    const first = track(source(contextFor('os.')))
    await vi.advanceTimersByTimeAsync(50)
    await source(contextFor('os.x '))
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2)

    expect(fetcher).not.toHaveBeenCalled()
    expect(first.value()).toBeNull()
  })

  it('keeps the pending requests of two sources apart', async () => {
    fetcher.mockReturnValue(new Promise(() => {}))
    const python = makeSource()
    const dql = makeSource()

    void python(contextFor('os.'))
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    void dql(contextFor('log.'))
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(signalOfCall(0).aborted).toBe(false)
    expect(signalOfCall(1).aborted).toBe(false)
  })
})

// ============================================
// Server failure
// ============================================

describe('createServerCompletionSource - server failure', () => {
  it('falls back to the catalog when the request rejects', async () => {
    fetcher.mockRejectedValue(new Error('server down'))

    const result = await completeWith(makeSource(), 'os.')

    expect(labelsOf(result)).toEqual(['rows', 'len'])
    expect(result?.from).toBe(3)
  })

  it('offers nothing rather than throwing when the catalog is empty too', async () => {
    fetcher.mockRejectedValue(new Error('server down'))

    const result = await completeWith(makeSource(emptyCatalog), 'os.')

    expect(result).toBeNull()
  })

  it('degrades silently - a failed request writes nothing to the console', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetcher.mockRejectedValue(new Error('server down'))

    await completeWith(makeSource(), 'os.')

    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('asks again on the next keystroke after a failure', async () => {
    fetcher.mockRejectedValueOnce(new Error('server down'))
    const source = makeSource(emptyCatalog)

    await completeWith(source, 'os.')
    const result = await completeWith(source, 'os.g')

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(labelsOf(result)).toEqual(['getcwd', 'environ'])
  })
})
