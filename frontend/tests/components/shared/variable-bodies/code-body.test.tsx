/**
 * Tests for CodeBody - the shared read-only Code view body (VMGR-28).
 *
 * Contract under test:
 *   - read-only CodeMirror JSON via the shared json-data-editor extensions
 *     factory ({readOnly: true})
 *   - 2-space pretty-printed JSON document
 *   - tables serialize as array-of-row-objects (both input shapes)
 *   - variant='initial': dim (opacity) WITHOUT italics (italic code renders
 *     broken)
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@uiw/react-codemirror', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string
    onChange?: (value: string) => void
  }) => (
    <textarea
      data-testid="codemirror-editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}))

const mockCreateExtensions = vi.fn((_options?: { readOnly?: boolean }) => [])
vi.mock('@/lib/codemirror/json-data-editor', () => ({
  createJsonDataEditorExtensions: (options?: { readOnly?: boolean }) =>
    mockCreateExtensions(options),
}))

import { CodeBody } from '@/components/shared/variable-bodies/code-body'
import { maskBareExpressionsForLint } from '@/lib/variable-validation'

function renderBody(value: unknown, variant: 'current' | 'initial' = 'current') {
  return render(<CodeBody value={value} variant={variant} />)
}

function getEditorDoc(): string {
  return (screen.getByTestId('codemirror-editor') as HTMLTextAreaElement).value
}

beforeEach(() => {
  mockCreateExtensions.mockClear()
})

describe('CodeBody - JSON document', () => {
  it('renders the value as 2-space pretty-printed JSON', () => {
    renderBody({ host: 'localhost', port: 8000 })
    expect(getEditorDoc()).toBe(
      JSON.stringify({ host: 'localhost', port: 8000 }, null, 2),
    )
  })

  it('renders arrays as 2-space pretty-printed JSON', () => {
    renderBody(['alpha', 42, true])
    expect(getEditorDoc()).toBe(JSON.stringify(['alpha', 42, true], null, 2))
  })

  it('serializes a {columns, rows} dict table as array-of-row-objects', () => {
    renderBody({
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'name', type: 'string' },
      ],
      rows: [
        [1, 'alpha'],
        [2, 'beta'],
      ],
    })
    expect(getEditorDoc()).toBe(
      JSON.stringify(
        [
          { id: 1, name: 'alpha' },
          { id: 2, name: 'beta' },
        ],
        null,
        2,
      ),
    )
  })

  it('keeps an array-of-row-objects table as row objects', () => {
    const rows = [
      { id: 1, name: 'alpha' },
      { id: 2, name: 'beta' },
    ]
    renderBody(rows)
    expect(getEditorDoc()).toBe(JSON.stringify(rows, null, 2))
  })
})

describe('CodeBody - read-only editor', () => {
  it('builds the editor with the shared factory in read-only mode', () => {
    renderBody({ a: 1 })
    expect(mockCreateExtensions).toHaveBeenCalledWith(
      expect.objectContaining({ readOnly: true }),
    )
  })
})

describe('CodeBody - initial variant', () => {
  it('dims the body WITHOUT italics (italic code renders broken)', () => {
    renderBody({ a: 1 }, 'initial')
    const root = screen.getByTestId('code-body')
    expect(root.className).toMatch(/opacity/)
    expect(root.className).not.toMatch(/italic/)
  })

  it('keeps the current variant un-dimmed', () => {
    renderBody({ a: 1 }, 'current')
    expect(screen.getByTestId('code-body').className).not.toMatch(/opacity-70/)
  })
})

// ===========================================================================
// Editable Code mode. The read-only body gains an `editable` + `onChange`
// mode (CodeMirror readOnly:false via the same factory); the JSON parse state
// propagates up as onValidChange so the host gates Save and the invalid-JSON
// View guard.
//
// REQ-3.1.3.11: Variable watching UI panel
// ===========================================================================

describe('CodeBody - editable mode', () => {
  function renderEditable(value: unknown = { a: 1 }) {
    const onChange = vi.fn()
    const onValidChange = vi.fn()
    render(
      <CodeBody
        value={value}
        variant="current"
        editable
        onChange={onChange}
        onValidChange={onValidChange}
      />,
    )
    return { onChange, onValidChange }
  }

  it('builds the editor with the shared factory in writable mode', () => {
    renderEditable()
    expect(mockCreateExtensions).toHaveBeenCalledWith(
      expect.objectContaining({ readOnly: false }),
    )
  })

  it('forwards the edited document text to onChange', () => {
    const { onChange } = renderEditable({ a: 1 })
    fireEvent.change(screen.getByTestId('codemirror-editor'), {
      target: { value: '{"a":2}' },
    })
    expect(onChange).toHaveBeenLastCalledWith('{"a":2}')
  })

  it('emits onValidChange(true) for valid JSON', () => {
    const { onValidChange } = renderEditable({ a: 1 })
    fireEvent.change(screen.getByTestId('codemirror-editor'), {
      target: { value: '{"a":2}' },
    })
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('forwards a jsonMask to the shared factory', () => {
    const jsonMask = (text: string) => text
    render(<CodeBody value={{ a: 1 }} variant="current" editable jsonMask={jsonMask} />)
    expect(mockCreateExtensions).toHaveBeenCalledWith(expect.objectContaining({ jsonMask }))
  })

  it('runs validity through the jsonMask so a masked-valid document counts as valid', () => {
    const onValidChange = vi.fn()
    // A raw {{ }} is not JSON, but the mask rewrites it to a string.
    render(
      <CodeBody
        value={{ a: 1 }}
        variant="current"
        editable
        jsonMask={maskBareExpressionsForLint}
        onValidChange={onValidChange}
      />,
    )
    fireEvent.change(screen.getByTestId('codemirror-editor'), {
      target: { value: '{"k": {{ abs(-1) }}}' },
    })
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('emits onValidChange(false) for invalid JSON', () => {
    const { onValidChange } = renderEditable({ a: 1 })
    fireEvent.change(screen.getByTestId('codemirror-editor'), {
      target: { value: '{bad' },
    })
    expect(onValidChange).toHaveBeenLastCalledWith(false)
  })

  it('does not crash in editable mode without change handlers', () => {
    render(<CodeBody value={{ a: 1 }} variant="current" editable />)
    fireEvent.change(screen.getByTestId('codemirror-editor'), {
      target: { value: '{"a":3}' },
    })
    expect(screen.getByTestId('code-body')).toBeInTheDocument()
  })
})
