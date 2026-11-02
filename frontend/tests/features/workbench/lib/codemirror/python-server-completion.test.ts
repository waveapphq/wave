/**
 * Tests for the Python-mode completion source (PYRUN-19).
 *
 * The source merges the WAVE expression catalog - with the blocked builtins
 * unlocked, because a Python script is not the sandboxed expression engine -
 * with the answers of the server-side python-tools completion endpoint, which
 * are asked for only after a dot. The debounce, abort and fallback of the
 * shared skeleton are covered in server-completion.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import {
  CompletionContext,
  type Completion,
  type CompletionResult,
  type CompletionSection,
} from '@codemirror/autocomplete'
import {
  getBuiltinByName,
  getMethodByName,
} from '@/features/workbench/lib/python-builtins'
import {
  createExpressionCompletionSource,
  type AvailableVariable,
} from '@/features/workbench/lib/codemirror/expression-completion'

// ============================================
// Mocks - the python-tools client is never allowed to reach the network
// ============================================

const completePythonMock = vi.fn()
const renamePythonMock = vi.fn()

vi.mock('@/features/workbench/api/python-tools', () => ({
  completePython: (...args: unknown[]) => completePythonMock(...args),
  renamePython: (...args: unknown[]) => renamePythonMock(...args),
}))

import { createPythonServerCompletionSource } from '@/features/workbench/lib/codemirror/python-server-completion'

// ============================================
// Fixtures
// ============================================

/** The debounce window the editor holds a keystroke for before asking the server. */
const DEBOUNCE_MS = 150

/** The raw Interpreter row text - it travels to the server exactly as typed. */
const INTERPRETER = '{{py}}'

interface ServerCompletionItem {
  label: string
  kind: 'variable' | 'function' | 'class' | 'module' | 'member' | 'keyword'
  signature: string | null
  doc: string | null
}

const GETCWD_DOC = 'Return a unicode string representing the current working directory.'
const ENVIRON_DOC = 'A mapping object where keys and values are strings of the process environment.'

const SERVER_ITEMS: ServerCompletionItem[] = [
  { label: 'getcwd', kind: 'function', signature: 'getcwd() -> str', doc: GETCWD_DOC },
  {
    label: 'PathLike',
    kind: 'class',
    signature: 'PathLike(*args, **kwargs)',
    doc: 'Abstract base class for the file system path protocol.',
  },
  { label: 'environ', kind: 'variable', signature: null, doc: ENVIRON_DOC },
  {
    label: 'sep',
    kind: 'member',
    signature: null,
    doc: 'The character the operating system uses to separate pathname components.',
  },
  { label: 'path', kind: 'module', signature: null, doc: 'Common pathname manipulations.' },
  { label: 'curdir', kind: 'member', signature: null, doc: null },
  { label: 'return', kind: 'keyword', signature: null, doc: null },
]

/**
 * Input Variables of the block. The name is the `input_vars` key; the type is
 * the bound variable's type only when the row value is a bare `{{name}}`
 * reference, and `string` for anything else.
 */
const INPUT_VARIABLES: AvailableVariable[] = [
  // row value `{{dataset}}` - a bare reference to a table variable
  { name: 'rows', type: 'table' },
  // row value `{{host}}` - a bare reference to a string variable
  { name: 'label', type: 'string' },
  // row value `prefix-{{env}}` - not a bare reference, so the type is string
  { name: 'tag', type: 'string' },
]

// ============================================
// Helpers
// ============================================

type PythonSource = ReturnType<typeof createPythonServerCompletionSource>

function makeSource(
  variables: AvailableVariable[] = INPUT_VARIABLES,
  interpreter: string = INTERPRETER
): PythonSource {
  return createPythonServerCompletionSource(variables, interpreter)
}

function contextFor(doc: string, pos: number = doc.length): CompletionContext {
  return new CompletionContext(EditorState.create({ doc }), pos, false)
}

/** Invoke a source and let the debounce window and the server answer land. */
async function completeWith(
  source: PythonSource,
  doc: string,
  pos: number = doc.length
): Promise<CompletionResult | null> {
  const pending = source(contextFor(doc, pos))
  await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 50)
  return (await pending) as CompletionResult | null
}

async function complete(
  doc: string,
  pos: number = doc.length,
  variables: AvailableVariable[] = INPUT_VARIABLES,
  interpreter: string = INTERPRETER
): Promise<CompletionResult | null> {
  return completeWith(makeSource(variables, interpreter), doc, pos)
}

function optionsOf(result: CompletionResult | null | undefined): readonly Completion[] {
  return result?.options ?? []
}

function labelsOf(result: CompletionResult | null | undefined): string[] {
  return optionsOf(result).map((o) => o.label)
}

function optionFor(
  result: CompletionResult | null | undefined,
  label: string
): Completion | undefined {
  return optionsOf(result).find((o) => o.label === label)
}

function sectionNameOf(option: Completion | undefined): string | undefined {
  if (!option?.section) return undefined
  if (typeof option.section === 'string') return option.section
  return (option.section as CompletionSection).name
}

function sectionHeaderTextOf(option: Completion | undefined): string | undefined {
  if (!option?.section || typeof option.section === 'string') return undefined
  const section = option.section as CompletionSection
  if (!section.header) return undefined
  return section.header(section).textContent ?? undefined
}

/** Read the documentation panel content of an option, string or rendered node. */
function infoText(option: Completion | undefined): string {
  const info = option?.info
  if (info == null) return ''
  if (typeof info === 'string') return info
  const rendered = info(option as Completion)
  if (rendered == null) return ''
  if (rendered instanceof Node) return rendered.textContent ?? ''
  return (rendered as { dom?: Node }).dom?.textContent ?? ''
}

function bodyOfCall(index: number): {
  script: string
  line: number
  column: number
  interpreter: string
} {
  return completePythonMock.mock.calls[index][0]
}

// ============================================
// Setup
// ============================================

beforeEach(() => {
  vi.useFakeTimers()
  completePythonMock.mockReset()
  completePythonMock.mockResolvedValue({ items: SERVER_ITEMS })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ============================================
// Catalog merge - blocked builtins
// ============================================

describe('createPythonServerCompletionSource - catalog builtins', () => {
  it('offers the blocked builtins because a script is not sandboxed', async () => {
    const result = await complete('')

    const labels = labelsOf(result)
    expect(labels).toContain('print')
    expect(labels).toContain('open')
    expect(labels).toContain('eval')
    expect(labels).toContain('exec')
    expect(labels).toContain('isinstance')
    expect(labels).toContain('zip')
    expect(labels).toContain('enumerate')
  })

  it('still offers the builtins an expression is allowed to use', async () => {
    const result = await complete('')

    const labels = labelsOf(result)
    expect(labels).toContain('len')
    expect(labels).toContain('str')
    expect(labels).toContain('int')
    expect(labels).toContain('sorted')
  })

  it('places a builtin in the Functions section with its signature as the detail', async () => {
    const result = await complete('')

    const lenOption = optionFor(result, 'len')
    expect(sectionNameOf(lenOption)).toBe('Functions')
    expect(lenOption?.detail).toBe('len(s)')
  })

  it('leaves the expression catalog alone - an expression still hides the blocked builtins', () => {
    const source = createExpressionCompletionSource([], false, false)
    const result = source(contextFor(''))

    const labels = labelsOf(result)
    expect(labels).not.toContain('print')
    expect(labels).not.toContain('eval')
    expect(labels).not.toContain('exec')
    expect(labels).not.toContain('open')
    expect(labels).toContain('len')
  })
})

// ============================================
// Input Variables
// ============================================

describe('createPythonServerCompletionSource - Input Variables', () => {
  it('offers every Input Variable by its name', async () => {
    const result = await complete('')

    const labels = labelsOf(result)
    expect(labels).toContain('rows')
    expect(labels).toContain('label')
    expect(labels).toContain('tag')
  })

  it('shows the bound type of a row whose value is a bare reference', async () => {
    const result = await complete('')

    expect(optionFor(result, 'rows')?.detail).toBe('table')
    expect(optionFor(result, 'label')?.detail).toBe('string')
  })

  it('shows string for a row whose value is not a bare reference', async () => {
    const result = await complete('')

    expect(optionFor(result, 'tag')?.detail).toBe('string')
  })

  it('places Input Variables in the Variables section', async () => {
    const result = await complete('')

    expect(sectionNameOf(optionFor(result, 'rows'))).toBe('Variables')
    expect(sectionHeaderTextOf(optionFor(result, 'rows'))).toBe('Variables')
  })

  it('offers the methods of an Input Variable type after its dot', async () => {
    const result = await complete('label.')

    const upper = optionFor(result, 'upper')
    expect(upper).toBeDefined()
    expect(sectionNameOf(upper)).toBe('Methods')
    expect(upper?.detail).toBe('.upper() -> str')
  })
})

// ============================================
// Server items after a dot
// ============================================

describe('createPythonServerCompletionSource - server items', () => {
  it('does not ask the server when the cursor is not after a dot', async () => {
    const result = await complete('import os\nle')

    expect(completePythonMock).not.toHaveBeenCalled()
    expect(labelsOf(result)).toContain('len')
  })

  it('offers the server items after a dot', async () => {
    const result = await complete('import os\nos.')

    expect(completePythonMock).toHaveBeenCalledTimes(1)
    const labels = labelsOf(result)
    expect(labels).toContain('getcwd')
    expect(labels).toContain('PathLike')
    expect(labels).toContain('environ')
    expect(labels).toContain('sep')
    expect(labels).toContain('path')
  })

  it('groups a variable item under Variables', async () => {
    const result = await complete('import os\nos.')

    expect(sectionNameOf(optionFor(result, 'environ'))).toBe('Variables')
  })

  it('groups function and class items under Functions', async () => {
    const result = await complete('import os\nos.')

    expect(sectionNameOf(optionFor(result, 'getcwd'))).toBe('Functions')
    expect(sectionNameOf(optionFor(result, 'PathLike'))).toBe('Functions')
  })

  it('groups member and module items under Members', async () => {
    const result = await complete('import os\nos.')

    expect(sectionNameOf(optionFor(result, 'sep'))).toBe('Members')
    expect(sectionNameOf(optionFor(result, 'path'))).toBe('Members')
    expect(sectionHeaderTextOf(optionFor(result, 'sep'))).toBe('Members')
  })

  it('never offers a keyword item', async () => {
    const result = await complete('import os\nos.')

    expect(labelsOf(result)).not.toContain('return')
  })

  it('carries the signature of a server item as its detail', async () => {
    const result = await complete('import os\nos.')

    expect(optionFor(result, 'getcwd')?.detail).toBe('getcwd() -> str')
  })

  it('leaves the detail empty when the server sent no signature', async () => {
    const result = await complete('import os\nos.')

    expect(optionFor(result, 'environ')?.detail).toBeUndefined()
  })

  it('keeps the catalog methods beside the server items on a WAVE variable', async () => {
    const result = await complete('label.')

    expect(completePythonMock).toHaveBeenCalledTimes(1)
    const labels = labelsOf(result)
    expect(labels).toContain('upper')
    expect(labels).toContain('sep')
  })
})

// ============================================
// Documentation panel
// ============================================

describe('createPythonServerCompletionSource - documentation', () => {
  it('shows the signature and the doc of a server item', async () => {
    const result = await complete('import os\nos.')

    const info = infoText(optionFor(result, 'getcwd'))
    expect(info).toContain('getcwd() -> str')
    expect(info).toContain(GETCWD_DOC)
  })

  it('shows the doc alone when the server item has no signature', async () => {
    const result = await complete('import os\nos.')

    expect(infoText(optionFor(result, 'environ'))).toBe(ENVIRON_DOC)
  })

  it('shows nothing when the server item has neither signature nor doc', async () => {
    const result = await complete('import os\nos.')

    expect(infoText(optionFor(result, 'curdir'))).toBe('')
  })

  it('shows the catalog entry of a builtin', async () => {
    const result = await complete('')

    expect(infoText(optionFor(result, 'len'))).toBe(getBuiltinByName('len')?.description)
  })

  it('shows the catalog entry of a WAVE-type method', async () => {
    const result = await complete('label.')

    expect(infoText(optionFor(result, 'upper'))).toBe(getMethodByName('upper', 'str')?.description)
  })

  it('shows the documentation of an Input Variable beside its entry', async () => {
    const described: AvailableVariable[] = [
      {
        name: 'readings',
        type: 'table',
        description:
          'Input Variable. Arrives as a table with 3 columns: sensor, temp_c, taken_at. ' +
          'Rows are dicts; iterate, index, len(); .columns and .rows.',
      },
    ]

    const result = await complete('', 0, described)

    expect(infoText(optionFor(result, 'readings'))).toBe(described[0].description)
  })

  it('leaves the type as the detail of an Input Variable that carries documentation', async () => {
    const described: AvailableVariable[] = [
      { name: 'readings', type: 'table', description: 'Input Variable. Arrives as a table.' },
    ]

    const result = await complete('', 0, described)

    expect(optionFor(result, 'readings')?.detail).toBe('table')
  })

  it('shows no documentation for an Input Variable that carries none', async () => {
    const result = await complete('')

    expect(infoText(optionFor(result, 'rows'))).toBe('')
  })
})

// ============================================
// Request body
// ============================================

describe('createPythonServerCompletionSource - request', () => {
  it('sends the whole script, not only the text before the cursor', async () => {
    const doc = 'import os\nos.\nprint(1)'
    await complete(doc, 13)

    expect(bodyOfCall(0).script).toBe(doc)
  })

  it('sends a 1-based line and a 0-based column', async () => {
    await complete('import os\nos.\nprint(1)', 13)

    expect(bodyOfCall(0).line).toBe(2)
    expect(bodyOfCall(0).column).toBe(3)
  })

  it('sends the Interpreter row text exactly as typed, unresolved', async () => {
    await complete('import os\nos.')

    expect(bodyOfCall(0).interpreter).toBe('{{py}}')
  })

  it('sends an empty Interpreter row as an empty string', async () => {
    await complete('import os\nos.', undefined, INPUT_VARIABLES, '')

    expect(bodyOfCall(0).interpreter).toBe('')
  })
})

// ============================================
// Server failure
// ============================================

describe('createPythonServerCompletionSource - server failure', () => {
  it('falls back to the catalog when the request rejects', async () => {
    completePythonMock.mockRejectedValue(new Error('server down'))

    const result = await complete('label.')

    const labels = labelsOf(result)
    expect(labels).toContain('upper')
    expect(labels).not.toContain('sep')
  })

  it('keeps the top-level catalog when the request rejects', async () => {
    completePythonMock.mockRejectedValue(new Error('server down'))

    const result = await complete('')

    const labels = labelsOf(result)
    expect(labels).toContain('len')
    expect(labels).toContain('print')
    expect(labels).toContain('rows')
  })
})
