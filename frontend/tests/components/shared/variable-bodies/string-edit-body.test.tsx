/**
 * Tests for StringEditBody - the controlled string editor for the inspect-modal
 * edit state. A wrapping, line-numbered CodeMirror that the watcher
 * auto-heights to. CodeMirror is mocked to a textarea here (the gutter, soft
 * wrapping, and 5-line cap are visual, validated via the wireframes + Playwright);
 * these tests cover the controlled value + change contract.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@uiw/react-codemirror', () => ({
  default: ({
    value,
    onChange,
    extensions,
  }: {
    value: string
    onChange?: (value: string) => void
    extensions?: unknown[]
  }) => (
    <textarea
      data-testid="codemirror-editor"
      data-extensions={JSON.stringify(extensions ?? [])}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}))

vi.mock('@/lib/codemirror/plain-text-editor', () => ({
  createPlainTextEditorExtensions: () => [],
}))

vi.mock('@/lib/codemirror/format-editor', () => ({
  createFormatExtensions: (format: string) => [`FMT:${format}`],
}))

import { StringEditBody } from '@/components/shared/variable-bodies/string-edit-body'

interface RenderOptions {
  value?: unknown
  onChange?: (value: string) => void
  onValidChange?: (valid: boolean) => void
  format?: 'json' | 'yaml' | 'xml' | 'plain'
  extraExtensions?: unknown[]
}

function renderBody({
  value = 'hello',
  onChange = vi.fn(),
  onValidChange = vi.fn(),
  format,
  extraExtensions,
}: RenderOptions = {}) {
  render(
    <StringEditBody
      value={value}
      onChange={onChange}
      onValidChange={onValidChange}
      format={format}
      extraExtensions={extraExtensions as never}
    />,
  )
  return { onChange, onValidChange }
}

function readExtensions(): unknown[] {
  return JSON.parse(getEditor().getAttribute('data-extensions') ?? '[]')
}

function getEditor(): HTMLTextAreaElement {
  return screen.getByTestId('codemirror-editor') as HTMLTextAreaElement
}

describe('StringEditBody', () => {
  it('seeds the editor with the string value', () => {
    renderBody({ value: 'https://example.com/path' })
    expect(getEditor()).toHaveValue('https://example.com/path')
  })

  it('coerces a non-string value to its string form', () => {
    renderBody({ value: 42 })
    expect(getEditor()).toHaveValue('42')
  })

  it('emits onChange with the new text and onValidChange(true)', () => {
    const { onChange, onValidChange } = renderBody({ value: 'a' })
    fireEvent.change(getEditor(), { target: { value: 'updated' } })
    expect(onChange).toHaveBeenLastCalledWith('updated')
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('treats an emptied field as a valid empty string', () => {
    const { onChange, onValidChange } = renderBody({ value: 'a' })
    fireEvent.change(getEditor(), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith('')
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('renders inside the bordered editor container', () => {
    renderBody()
    expect(screen.getByTestId('string-edit-editor')).toBeInTheDocument()
  })
})

// ===========================================================================
// The edit string body threads the per-watcher Format + host-injected template
// extensions down to the shared StringCodeMirror.
//
// REQ-3.1.3.11: Variable watching UI panel
// ===========================================================================

describe('StringEditBody - format threading', () => {
  it('threads the format extension into the editor', () => {
    renderBody({ value: 'x', format: 'json' })
    expect(readExtensions()).toContain('FMT:json')
  })

  it('threads host-injected extra extensions into the editor', () => {
    renderBody({ value: 'x', extraExtensions: ['EXTRA_A'] })
    expect(readExtensions()).toContain('EXTRA_A')
  })
})
