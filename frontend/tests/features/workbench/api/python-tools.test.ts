/**
 * Python tools API client tests - PYRUN-19 / REQ-3.4.1.2.
 *
 * Pins the wire shapes of the two python-tools endpoints: a completion item is
 * {label, kind, signature, doc} and a rename edit is {from_line, from_column, to_line, to_column, text}, with
 * lines 1-based and columns 0-based in both directions. The interpreter text
 * travels raw (an unresolved expression is sent as typed).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/api', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  getApiBaseUrl: vi.fn().mockReturnValue('http://localhost:8000'),
}))

import { apiClient } from '@/lib/api'
import { checkPython, completePython, renamePython } from '@/features/workbench/api/python-tools'

const SCRIPT = 'import os\nos.\n'
const INTERPRETER = '/opt/venv311/bin/python'

/** Every `kind` the endpoint may answer with. */
const ITEMS = [
  {
    label: 'getcwd',
    kind: 'function',
    signature: 'getcwd() -> str',
    doc: 'Return a unicode string representing the current working directory.',
  },
  { label: 'PathLike', kind: 'class', signature: 'PathLike(*args, **kwargs)', doc: null },
  { label: 'environ', kind: 'variable', signature: null, doc: 'The process environment.' },
  { label: 'sep', kind: 'member', signature: null, doc: null },
  { label: 'path', kind: 'module', signature: null, doc: 'Common pathname manipulations.' },
  { label: 'return', kind: 'keyword', signature: null, doc: null },
]

/** Sorted by position and non-overlapping, as the endpoint answers them. */
const EDITS = [
  { from_line: 1, from_column: 0, to_line: 1, to_column: 5, text: 'ceiling' },
  { from_line: 2, from_column: 6, to_line: 2, to_column: 11, text: 'ceiling' },
]

function callOf(index: number) {
  return vi.mocked(apiClient.post).mock.calls[index]
}

describe('python-tools API client', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('completePython', () => {
    it('POSTs the completion request with a 1-based line and a 0-based column', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { items: ITEMS },
        meta: { requestId: 'req-complete' },
        status: 200,
      })

      await completePython({
        script: SCRIPT,
        line: 2,
        column: 3,
        interpreter: INTERPRETER,
      })

      const [path, body] = callOf(0)
      expect(path).toBe('/python-tools/complete')
      expect(body).toEqual({
        script: SCRIPT,
        line: 2,
        column: 3,
        interpreter: INTERPRETER,
      })
    })

    it('returns every item in the server shape, unchanged', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { items: ITEMS },
        meta: { requestId: 'req-items' },
        status: 200,
      })

      const result = await completePython({
        script: SCRIPT,
        line: 2,
        column: 3,
        interpreter: INTERPRETER,
      })

      expect(result).toEqual({ items: ITEMS })
      for (const item of result.items) {
        expect(Object.keys(item).sort()).toEqual(['doc', 'kind', 'label', 'signature'])
      }
    })

    it('carries every kind the server may answer with', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { items: ITEMS },
        meta: { requestId: 'req-kinds' },
        status: 200,
      })

      const result = await completePython({
        script: SCRIPT,
        line: 2,
        column: 3,
        interpreter: INTERPRETER,
      })

      const kinds: unknown[] = []
      for (const item of result.items) {
        kinds.push(item.kind)
      }

      expect(kinds).toEqual([
        'function',
        'class',
        'variable',
        'member',
        'module',
        'keyword',
      ])
    })

    it('sends the raw interpreter row text, expression unresolved', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { items: [] },
        meta: { requestId: 'req-raw' },
        status: 200,
      })

      await completePython({
        script: SCRIPT,
        line: 1,
        column: 0,
        interpreter: '{{py}}',
      })

      const [, body] = callOf(0)
      expect(body).toEqual({
        script: SCRIPT,
        line: 1,
        column: 0,
        interpreter: '{{py}}',
      })
    })

    it('forwards the abort signal to the request, so the next keystroke cancels it', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { items: [] },
        meta: { requestId: 'req-signal' },
        status: 200,
      })

      const controller = new AbortController()
      await completePython(
        { script: SCRIPT, line: 2, column: 3, interpreter: INTERPRETER },
        controller.signal
      )

      const [path, body, config] = callOf(0)
      expect(path).toBe('/python-tools/complete')
      expect(body).toEqual({
        script: SCRIPT,
        line: 2,
        column: 3,
        interpreter: INTERPRETER,
      })
      expect(config?.signal).toBe(controller.signal)
    })

    it('resolves to an empty result when the request fails', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Network request failed'), {
          type: 'network',
          isRetryable: true,
        })
      )

      await expect(
        completePython({ script: SCRIPT, line: 2, column: 3, interpreter: INTERPRETER })
      ).resolves.toEqual({ items: [] })
    })

    it('resolves to an empty result when the interpreter cannot be introspected', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Interpreter is not a local path'), {
          type: 'client',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(
        completePython({ script: SCRIPT, line: 2, column: 3, interpreter: 'uv run --project /opt/lab-env' })
      ).resolves.toEqual({ items: [] })
    })
  })

  describe('renamePython', () => {
    const RENAME_SCRIPT = 'limit = 1\nprint(limit)\n'

    it('POSTs the rename request with the new name, a 1-based line and a 0-based column', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { edits: EDITS },
        meta: { requestId: 'req-rename' },
        status: 200,
      })

      await renamePython({
        script: RENAME_SCRIPT,
        line: 1,
        column: 0,
        new_name: 'ceiling',
        interpreter: INTERPRETER,
      })

      const [path, body] = callOf(0)
      expect(path).toBe('/python-tools/rename')
      expect(body).toEqual({
        script: RENAME_SCRIPT,
        line: 1,
        column: 0,
        new_name: 'ceiling',
        interpreter: INTERPRETER,
      })
    })

    it('returns the edits in the server shape and order, unchanged', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { edits: EDITS },
        meta: { requestId: 'req-rename-edits' },
        status: 200,
      })

      const result = await renamePython({
        script: RENAME_SCRIPT,
        line: 1,
        column: 0,
        new_name: 'ceiling',
        interpreter: INTERPRETER,
      })

      expect(result).toEqual({ edits: EDITS })
      for (const edit of result.edits) {
        expect(Object.keys(edit).sort()).toEqual([
          'from_column',
          'from_line',
          'text',
          'to_column',
          'to_line',
        ])
      }
    })

    it('throws the server message on a 400', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Cannot rename: no symbol at the cursor'), {
          type: 'client',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(
        renamePython({
          script: RENAME_SCRIPT,
          line: 2,
          column: 0,
          new_name: 'output',
          interpreter: INTERPRETER,
        })
      ).rejects.toThrow('Cannot rename: no symbol at the cursor')
    })

    it('carries the 400 status on the thrown error', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error("Invalid variable name: '__x'"), {
          type: 'client',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(
        renamePython({
          script: RENAME_SCRIPT,
          line: 1,
          column: 0,
          new_name: '__x',
          interpreter: INTERPRETER,
        })
      ).rejects.toMatchObject({ status: 400, message: "Invalid variable name: '__x'" })
    })
  })

  describe('checkPython', () => {
    const CHECK_SCRIPT = 'def f(:\n    return 1\n'

    /** The backend answers a 1-based line and a 0-based column. */
    const ISSUES = [{ line: 1, column: 6, message: "invalid syntax" }]

    it('POSTs the script to the check endpoint', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { issues: ISSUES },
        meta: { requestId: 'req-check' },
        status: 200,
      })

      await checkPython({ script: CHECK_SCRIPT })

      const [path, body] = callOf(0)
      expect(path).toBe('/python-tools/check')
      expect(body).toEqual({ script: CHECK_SCRIPT })
    })

    it('returns the issues in the server shape, unchanged', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { issues: ISSUES },
        meta: { requestId: 'req-check-issues' },
        status: 200,
      })

      const result = await checkPython({ script: CHECK_SCRIPT })

      expect(result).toEqual({ issues: ISSUES })
      for (const issue of result.issues) {
        expect(Object.keys(issue).sort()).toEqual(['column', 'line', 'message'])
      }
    })

    it('returns no issues for a script that parses', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { issues: [] },
        meta: { requestId: 'req-check-clean' },
        status: 200,
      })

      await expect(checkPython({ script: 'a = 1\n' })).resolves.toEqual({ issues: [] })
    })

    it('resolves to an empty result when the request fails', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Network request failed'), {
          type: 'network',
          isRetryable: true,
        })
      )

      await expect(checkPython({ script: CHECK_SCRIPT })).resolves.toEqual({ issues: [] })
    })

    it('resolves to an empty result when the script is over the size cap', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(
        Object.assign(new Error('Script exceeds 200 KB'), {
          type: 'client',
          status: 400,
          isRetryable: false,
        })
      )

      await expect(checkPython({ script: 'x'.repeat(10) })).resolves.toEqual({ issues: [] })
    })
  })
})
