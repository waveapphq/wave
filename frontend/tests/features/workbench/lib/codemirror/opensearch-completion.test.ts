/**
 * The Query editor's suggestion source for DQL, Query DSL and Custom (JSON): the server's suggestions with the
 * FIELDS section, the Get fields action row while nothing is loaded, WAVE variables inside {{ }}, and positions
 * converted between CodeMirror offsets (UTF-16 code units) and the server's characters (code points).
 *
 * REQ-3.3.2.6, REQ-5.1.2; OS-12
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  CompletionContext,
  type Completion,
  type CompletionResult,
  type CompletionSection,
} from '@codemirror/autocomplete'

const api = vi.hoisted(() => ({
  suggestOpenSearch: vi.fn(),
  checkOpenSearch: vi.fn(),
  startFields: vi.fn(),
  getFields: vi.fn(),
  cancelFields: vi.fn(),
}))

vi.mock('@/features/workbench/api/opensearch-tools', () => api)

import {
  createOpenSearchCompletionSource,
  type OpenSearchCompletionOptions,
} from '@/features/workbench/lib/codemirror/opensearch-completion'
import {
  createTemplateCompletionSource,
  type AvailableVariable,
} from '@/features/workbench/lib/codemirror/expression-completion'
import type { OpenSearchField, OpenSearchSuggestions } from '@/features/workbench/api/opensearch-tools'
import { SAMPLE_DQL, SAMPLE_FIELDS } from '../../opensearch-fixtures'

// ============================================
// Test Helpers
// ============================================

/** The pause the editor waits after a keystroke before asking the server. */
const DEBOUNCE_MS = 150
const JOB_ID = 'job-fields-1'
const GET_FIELDS = 'Get fields from the cluster'
const VARIABLES: AvailableVariable[] = [{ name: 'svc', type: 'str', source: 'Test' }]

type Item = OpenSearchSuggestions['items'][number]

/** A field as the suggest endpoint answers it: its types joined by `, ` as the detail. */
function fieldItem(field: OpenSearchField): Item {
  return { label: field.name, kind: 'field', detail: field.types.join(', '), info: '' }
}

const byName = (name: string): OpenSearchField => {
  const field = SAMPLE_FIELDS.find((candidate) => candidate.name === name)
  if (!field) throw new Error(`no fixture field ${name}`)
  return field
}

const SERVICE_ITEMS: Item[] = [fieldItem(byName('service.name')), fieldItem(byName('service.version'))]

const OPERATOR_ITEMS: Item[] = [
  { label: 'and', kind: 'operator', detail: '', info: '' },
  { label: 'or', kind: 'operator', detail: '', info: '' },
]

const MATCH_INFO =
  'Returns documents that match a provided text, number, date or boolean value. Added in 1.0.'

const KEY_ITEMS: Item[] = [
  { label: 'match', kind: 'key', detail: 'object', info: MATCH_INFO },
  { label: 'match_all', kind: 'key', detail: 'object', info: '' },
]

const views: EditorView[] = []

function optionsWith(overrides: Partial<OpenSearchCompletionOptions> = {}): OpenSearchCompletionOptions {
  return {
    language: 'dql',
    fieldsJobId: JOB_ID,
    variables: VARIABLES,
    template: false,
    onGetFields: vi.fn(),
    ...overrides,
  }
}

type Source = ReturnType<typeof createOpenSearchCompletionSource>

function contextFor(doc: string, pos: number = doc.length): CompletionContext {
  return new CompletionContext(EditorState.create({ doc }), pos, false)
}

/** Asks the source at `pos` and lets the pause and the server answer land. */
async function completeWith(source: Source, doc: string, pos: number = doc.length): Promise<CompletionResult | null> {
  const pending = source(contextFor(doc, pos))
  await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50)
  return (await pending) as CompletionResult | null
}

async function complete(
  doc: string,
  overrides: Partial<OpenSearchCompletionOptions> = {},
  pos: number = doc.length,
): Promise<CompletionResult | null> {
  return completeWith(createOpenSearchCompletionSource(optionsWith(overrides)), doc, pos)
}

/** The server answers `items` over [from, to), counted in characters. */
function answer(from: number, to: number, items: Item[]): void {
  api.suggestOpenSearch.mockResolvedValue({ from, to, items })
}

function optionsOf(result: CompletionResult | null | undefined): readonly Completion[] {
  return result?.options ?? []
}

function labelsOf(result: CompletionResult | null | undefined): string[] {
  return optionsOf(result).map((option) => option.label)
}

function optionFor(result: CompletionResult | null | undefined, label: string): Completion | undefined {
  return optionsOf(result).find((option) => option.label === label)
}

function sectionNameOf(option: Completion | undefined): string | undefined {
  const section = option?.section
  return typeof section === 'string' ? section : section?.name
}

function sectionHeaderOf(option: Completion | undefined): HTMLElement | undefined {
  const section = option?.section
  if (!section || typeof section === 'string' || !section.header) return undefined
  return (section as CompletionSection).header?.(section as CompletionSection) as HTMLElement
}

function infoText(option: Completion | undefined): string {
  const info = option?.info
  if (info == null) return ''
  if (typeof info === 'string') return info
  const rendered = info(option as Completion)
  if (rendered == null) return ''
  if (rendered instanceof Node) return rendered.textContent ?? ''
  return (rendered as { dom?: Node }).dom?.textContent ?? ''
}

function bodyOfCall(index = 0): {
  language: string
  text: string
  cursor: number
  template: boolean
  fields_job_id: string | null
} {
  return api.suggestOpenSearch.mock.calls[index][0]
}

/** Characters (code points) in `text`, as the server counts them. */
const characters = (text: string): number => Array.from(text).length

function mount(doc: string): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.cursor(doc.length) }),
    parent: document.body,
  })
  views.push(view)
  return view
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  answer(0, 0, [])
})

afterEach(() => {
  for (const view of views) {
    view.destroy()
  }
  views.length = 0
  vi.useRealTimers()
})

// ============================================
// Request (OS-12)
// ============================================

describe('createOpenSearchCompletionSource - request', () => {
  it.each(['dql', 'query_dsl', 'aggregation'] as const)('asks the suggest endpoint in the %s language', async (language) => {
    await complete('{"', { language })

    expect(api.suggestOpenSearch).toHaveBeenCalledTimes(1)
    expect(bodyOfCall().language).toBe(language)
  })

  it('sends the whole body, the cursor, the kind and the fields job', async () => {
    const doc = `${SAMPLE_DQL}\nand serv`
    await complete(doc, { template: true }, 3)

    expect(bodyOfCall()).toEqual({
      language: 'dql',
      text: doc,
      cursor: 3,
      template: true,
      fields_job_id: JOB_ID,
    })
  })

  it('sends no fields job while nothing is loaded', async () => {
    await complete('serv', { fieldsJobId: null })

    expect(bodyOfCall()).toEqual({
      language: 'dql',
      text: 'serv',
      cursor: 4,
      template: false,
      fields_job_id: null,
    })
  })

  it('sends an abort signal with every request', async () => {
    await complete('serv')

    expect(api.suggestOpenSearch.mock.calls[0][1]).toBeInstanceOf(AbortSignal)
  })

  it('asks the server only once the 150 ms pause has passed', async () => {
    const source = createOpenSearchCompletionSource(optionsWith())
    const pending = source(contextFor('serv'))

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1)
    expect(api.suggestOpenSearch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(api.suggestOpenSearch).toHaveBeenCalledTimes(1)

    await pending
  })

  it('aborts the request in flight when the next keystroke asks again', async () => {
    api.suggestOpenSearch.mockReturnValue(new Promise(() => {}))
    const source = createOpenSearchCompletionSource(optionsWith())

    void source(contextFor('serv'))
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    const first = api.suggestOpenSearch.mock.calls[0][1] as AbortSignal

    void source(contextFor('servi'))
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(api.suggestOpenSearch).toHaveBeenCalledTimes(2)
    expect(first.aborted).toBe(true)
    expect(bodyOfCall(1).text).toBe('servi')
  })
})

// ============================================
// FIELDS section (OS-12)
// ============================================

describe('createOpenSearchCompletionSource - fields', () => {
  it('offers the server fields in its order under the Fields section', async () => {
    answer(4, 12, SERVICE_ITEMS)

    const result = await complete('and service.')

    expect(labelsOf(result)).toEqual(['service.name', 'service.version'])
    for (const option of optionsOf(result)) {
      expect(sectionNameOf(option)).toBe('Fields')
    }
  })

  it('draws the Fields header with the shared section header', async () => {
    answer(4, 12, SERVICE_ITEMS)

    const header = sectionHeaderOf(optionFor(await complete('and service.'), 'service.name'))

    expect(header?.className).toBe('cm-completionSection')
    expect(header?.textContent).toBe('Fields')
  })

  it('shows the types of each field as its detail', async () => {
    answer(0, 3, [fieldItem(byName('status')), fieldItem(byName('log.level'))])

    const result = await complete('sta')

    expect(optionFor(result, 'status')?.detail).toBe('keyword, long')
    expect(optionFor(result, 'log.level')?.detail).toBe('keyword')
  })

  it('offers the fields at a Query DSL field position the same way', async () => {
    const doc = '{"term": {"'
    answer(11, 11, [fieldItem(byName('trace.id'))])

    const result = await complete(doc, { language: 'query_dsl' })

    expect(labelsOf(result)).toEqual(['trace.id'])
    expect(sectionNameOf(optionFor(result, 'trace.id'))).toBe('Fields')
    expect(optionFor(result, 'trace.id')?.detail).toBe('keyword')
  })

  it('offers no Get fields row once the fields are loaded', async () => {
    answer(4, 12, SERVICE_ITEMS)

    expect(labelsOf(await complete('and service.'))).not.toContain(GET_FIELDS)
  })

  it('offers nothing when the fields are loaded and the server has no suggestion', async () => {
    answer(11, 11, [])

    expect(labelsOf(await complete('log.level: '))).toEqual([])
  })
})

// ============================================
// Operators, keys and values (OS-12)
// ============================================

describe('createOpenSearchCompletionSource - operators, keys and values', () => {
  it('offers and and or after a complete expression, outside the Fields section', async () => {
    const doc = 'log.level: ERROR '
    answer(characters(doc), characters(doc), OPERATOR_ITEMS)

    const result = await complete(doc)

    expect(labelsOf(result)).toEqual(['and', 'or'])
    for (const option of optionsOf(result)) {
      expect(sectionNameOf(option)).not.toBe('Fields')
      expect(option.detail ?? '').toBe('')
    }
  })

  it('offers the Query DSL keys with their value kind as the detail and their description as the info', async () => {
    answer(2, 7, KEY_ITEMS)

    const result = await complete('{"match', { language: 'query_dsl' })

    expect(labelsOf(result)).toEqual(['match', 'match_all'])
    expect(optionFor(result, 'match')?.detail).toBe('object')
    expect(infoText(optionFor(result, 'match'))).toBe(MATCH_INFO)
    expect(sectionNameOf(optionFor(result, 'match'))).not.toBe('Fields')
  })

  it('shows no description for a key the specification does not describe', async () => {
    answer(2, 7, KEY_ITEMS)

    expect(infoText(optionFor(await complete('{"match', { language: 'query_dsl' }), 'match_all'))).toBe('')
  })

  it('offers the enum values of a key', async () => {
    const doc = '{"match": {"message": {"query": "x", "operator": "'
    answer(characters(doc), characters(doc), [
      { label: 'and', kind: 'value', detail: '', info: '' },
      { label: 'or', kind: 'value', detail: '', info: '' },
    ])

    expect(labelsOf(await complete(doc, { language: 'query_dsl' }))).toEqual(['and', 'or'])
  })

  it('offers the aggregation types of a Custom (JSON) stat', async () => {
    answer(2, 4, [
      { label: 'percentiles', kind: 'key', detail: 'object', info: '' },
      { label: 'percentile_ranks', kind: 'key', detail: 'object', info: '' },
    ])

    const result = await complete('{"pe', { language: 'aggregation' })

    expect(bodyOfCall().language).toBe('aggregation')
    expect(labelsOf(result)).toEqual(['percentiles', 'percentile_ranks'])
  })
})

// ============================================
// Get fields action row (OS-12)
// ============================================

describe('createOpenSearchCompletionSource - Get fields row', () => {
  it('offers the one Get fields row under the Fields section while nothing is loaded', async () => {
    answer(4, 12, [])

    const result = await complete('and service.', { fieldsJobId: null })

    expect(labelsOf(result)).toEqual([GET_FIELDS])
    expect(sectionNameOf(optionFor(result, GET_FIELDS))).toBe('Fields')
    expect(sectionHeaderOf(optionFor(result, GET_FIELDS))?.textContent).toBe('Fields')
  })

  it('offers the row at a Query DSL field position while nothing is loaded', async () => {
    answer(11, 11, [])

    expect(labelsOf(await complete('{"term": {"', { language: 'query_dsl', fieldsJobId: null }))).toEqual([
      GET_FIELDS,
    ])
  })

  it('keeps the row in the list whatever prefix is typed before the cursor', async () => {
    const doc = 'and service.'
    answer(4, 12, [])

    const result = await complete(doc, { fieldsJobId: null })

    // The list filters its rows by the text between `from` and the cursor.
    expect(result?.filter === false || result?.from === doc.length).toBe(true)
  })

  it('starts the pull once and leaves the body unchanged when the row is picked', async () => {
    const onGetFields = vi.fn()
    const doc = 'and service.'
    answer(4, 12, [])
    const view = mount(doc)

    const result = await complete(doc, { fieldsJobId: null, onGetFields })
    const option = optionFor(result, GET_FIELDS)

    expect(typeof option?.apply).toBe('function')
    const apply = option?.apply as (view: EditorView, completion: Completion, from: number, to: number) => void
    apply(view, option as Completion, result?.from ?? doc.length, doc.length)

    expect(onGetFields).toHaveBeenCalledTimes(1)
    expect(view.state.doc.toString()).toBe(doc)
  })

  it('starts nothing while the row is only offered', async () => {
    const onGetFields = vi.fn()
    answer(4, 12, [])

    await complete('and service.', { fieldsJobId: null, onGetFields })

    expect(onGetFields).not.toHaveBeenCalled()
  })

  it('offers the operators alone after a complete expression while nothing is loaded', async () => {
    const doc = 'log.level: ERROR '
    answer(characters(doc), characters(doc), OPERATOR_ITEMS)

    expect(labelsOf(await complete(doc, { fieldsJobId: null }))).toEqual(['and', 'or'])
  })
})

// ============================================
// WAVE variables inside {{ }} (OS-5, OS-12)
// ============================================

describe('createOpenSearchCompletionSource - {{ }} regions', () => {
  it('offers the WAVE variables inside {{ in Template kind', async () => {
    const doc = 'service.name: {{ sv'
    answer(characters(doc), characters(doc), [])

    const result = await complete(doc, { template: true })
    const expected = createTemplateCompletionSource(VARIABLES, true)(contextFor(doc))

    expect(labelsOf(result)).toContain('svc')
    expect(labelsOf(result)).toEqual(expect.arrayContaining(labelsOf(expected)))
    expect(result?.from).toBe(doc.length - 2)
  })

  it('offers the WAVE variables inside {{ in a Query DSL string in Template kind', async () => {
    const doc = '{"term": {"service.name": "{{ '
    answer(characters(doc), characters(doc), [])

    expect(labelsOf(await complete(doc, { language: 'query_dsl', template: true }))).toContain('svc')
  })

  it('offers no Get fields row inside {{ while nothing is loaded', async () => {
    const doc = 'service.name: {{ '
    answer(characters(doc), characters(doc), [])

    const result = await complete(doc, { template: true, fieldsJobId: null })

    expect(labelsOf(result)).toContain('svc')
    expect(labelsOf(result)).not.toContain(GET_FIELDS)
  })

  it('offers no WAVE variable inside {{ in Literal kind', async () => {
    const doc = 'service.name: {{ sv'
    answer(characters(doc), characters(doc), [])

    expect(labelsOf(await complete(doc, { template: false }))).not.toContain('svc')
  })

  it('offers no WAVE variable once the {{ }} region is closed', async () => {
    const doc = 'service.name: {{ svc }} and '
    answer(characters(doc), characters(doc), [fieldItem(byName('host.name'))])

    const result = await complete(doc, { template: true })

    expect(labelsOf(result)).toEqual(['host.name'])
  })
})

// ============================================
// Positions: UTF-16 offsets and characters (OS-12)
// ============================================

describe('createOpenSearchCompletionSource - positions', () => {
  // The emoji is one character and two UTF-16 code units.
  const doc = 'message: "😀" and service.name: x'
  const fieldAt = doc.indexOf('service.name')
  const cursor = fieldAt + 'serv'.length

  it('sends the cursor counted in characters', async () => {
    await complete(doc, {}, cursor)

    expect(characters(doc.slice(0, cursor))).toBe(cursor - 1)
    expect(bodyOfCall().cursor).toBe(cursor - 1)
  })

  it('counts every character before the cursor, across lines', async () => {
    const body = '"😀 🚀"\nserv'

    await complete(body)

    expect(bodyOfCall().cursor).toBe(characters(body))
    expect(bodyOfCall().cursor).toBe(body.length - 2)
  })

  it('sends the cursor unchanged when the body holds no wide character', async () => {
    await complete(SAMPLE_DQL, {}, 12)

    expect(bodyOfCall().cursor).toBe(12)
  })

  it('turns the answer range back into editor offsets', async () => {
    const from = characters(doc.slice(0, fieldAt))
    answer(from, from + 'service.name'.length, SERVICE_ITEMS)

    const result = await complete(doc, {}, cursor)

    expect(result?.from).toBe(fieldAt)
    expect(result?.to).toBe(fieldAt + 'service.name'.length)
  })

  it('turns a range that holds a wide character back into editor offsets', async () => {
    const body = '{"term": {"tag": "a😀b'
    const valueAt = body.indexOf('"a😀b') + 1
    answer(characters(body.slice(0, valueAt)), characters(body), [
      { label: 'a😀bc', kind: 'value', detail: '', info: '' },
    ])

    const result = await complete(body, { language: 'query_dsl' })

    expect(result?.from).toBe(valueAt)
    expect(result?.to).toBe(body.length)
  })
})

// ============================================
// Get fields row icon (OS-12)
// ============================================

describe('createOpenSearchCompletionSource - Get fields row icon', () => {
  it('gives the Get fields row the Database icon type', async () => {
    const { OPENSEARCH_GET_FIELDS_TYPE } = await import('@/features/workbench/lib/codemirror/dql-mode')
    answer(4, 12, [])

    const option = optionFor(await complete('and service.', { fieldsJobId: null }), GET_FIELDS)

    expect(option?.type).toBe(OPENSEARCH_GET_FIELDS_TYPE)
  })
})

// ============================================
// No Get fields row while it cannot pull (OS-13)
// ============================================

describe('createOpenSearchCompletionSource - no Get fields action', () => {
  it('offers no Get fields row while nothing is loaded', async () => {
    answer(4, 12, [])

    const result = await complete('and service.', { fieldsJobId: null, onGetFields: null })

    expect(labelsOf(result)).not.toContain(GET_FIELDS)
    expect(optionsOf(result)).toEqual([])
  })

  it('offers no Get fields row at a Query DSL field position', async () => {
    answer(11, 11, [])

    const result = await complete('{"term": {"', { language: 'query_dsl', fieldsJobId: null, onGetFields: null })

    expect(labelsOf(result)).not.toContain(GET_FIELDS)
  })

  it("still offers the server's operators", async () => {
    const doc = 'log.level: ERROR '
    answer(characters(doc), characters(doc), OPERATOR_ITEMS)

    expect(labelsOf(await complete(doc, { fieldsJobId: null, onGetFields: null }))).toEqual(['and', 'or'])
  })

  it('offers no Get fields row outside {{ }} in Template kind', async () => {
    answer(4, 12, [])

    const result = await complete('and service.', { fieldsJobId: null, onGetFields: null, template: true })

    expect(labelsOf(result)).not.toContain(GET_FIELDS)
  })
})
