/**
 * Tests for FillCodeMirror - the shared CodeMirror fill mechanism behind the
 * string editor and the complex Code view. CodeMirror is mocked to a textarea
 * exposing its props; these cover the readOnly gating, autoFocus + the absolute-inset-0 fill
 * host. The actual fill/scroll needs real layout (a Playwright concern, not jsdom).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@uiw/react-codemirror', () => ({
  default: (props: {
    value: string
    onChange?: (v: string) => void
    readOnly?: boolean
    editable?: boolean
    autoFocus?: boolean
  }) => (
    <textarea
      data-testid="cm"
      value={props.value}
      readOnly={!!props.readOnly}
      autoFocus={props.autoFocus}
      data-editable={String(props.editable)}
      data-has-onchange={props.onChange ? 'yes' : 'no'}
      onChange={(e) => props.onChange?.(e.target.value)}
    />
  ),
}))

import { FillCodeMirror } from '@/components/shared/variable-bodies/fill-code-mirror'

function cm(): HTMLTextAreaElement {
  return screen.getByTestId('cm') as HTMLTextAreaElement
}

describe('FillCodeMirror', () => {
  it('renders the editor as absolute inset-0 (the definite-height fill host)', () => {
    render(<FillCodeMirror value="hi" extensions={[]} />)
    expect(cm().parentElement?.className).toContain('absolute inset-0')
  })

  it('forwards changes when editable', () => {
    const onChange = vi.fn()
    render(<FillCodeMirror value="a" extensions={[]} onChange={onChange} />)
    expect(cm()).toHaveValue('a')
    expect(cm().dataset.editable).toBe('true')
    expect(cm().dataset.hasOnchange).toBe('yes')
    fireEvent.change(cm(), { target: { value: 'b' } })
    expect(onChange).toHaveBeenLastCalledWith('b')
  })

  it('drops onChange and marks the editor read-only when readOnly', () => {
    const onChange = vi.fn()
    render(<FillCodeMirror value="a" extensions={[]} onChange={onChange} readOnly />)
    expect(cm().dataset.editable).toBe('false')
    expect(cm().dataset.hasOnchange).toBe('no')
    expect(cm().readOnly).toBe(true)
  })

  it('focuses the editor when it mounts with autoFocus', () => {
    render(<FillCodeMirror value="" extensions={[]} onChange={vi.fn()} autoFocus />)
    expect(cm()).toHaveFocus()
  })

  it('leaves focus where it was when autoFocus is omitted', () => {
    render(<FillCodeMirror value="" extensions={[]} onChange={vi.fn()} />)
    expect(cm()).not.toHaveFocus()
    expect(document.body).toHaveFocus()
  })
})
