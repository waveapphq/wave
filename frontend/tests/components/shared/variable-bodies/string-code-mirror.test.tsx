/**
 * Tests for StringCodeMirror's format + extra-extension threading. The shared
 * string editor layers a per-format language/lint extension and host-injected
 * template extensions over its plain-text base, in both read and edit.
 * CodeMirror is mocked to a textarea and the extension factories to string
 * markers so these cover the composition + controlled-value contract (the
 * actual highlighting is visual, validated by the wireframes + Playwright).
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.4.1.6: SQL database operations (SQL-10)
 */

import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@uiw/react-codemirror', () => ({
  default: ({
    value,
    onChange,
    extensions,
    editable,
    readOnly,
  }: {
    value: string
    onChange?: (value: string) => void
    extensions: unknown[]
    editable?: boolean
    readOnly?: boolean
  }) => (
    <textarea
      data-testid="cm"
      data-extensions={JSON.stringify(extensions)}
      data-editable={String(editable)}
      data-readonly={String(readOnly)}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}))

const plainBase = vi.hoisted(() => ({ options: [] as { valueColor?: boolean }[] }))

vi.mock('@/lib/codemirror/plain-text-editor', () => ({
  createPlainTextEditorExtensions: (options: { valueColor?: boolean }) => {
    plainBase.options.push(options)
    return ['PLAIN_BASE']
  },
}))

vi.mock('@/lib/codemirror/format-editor', () => ({
  createFormatExtensions: (format: string) => [`FMT:${format}`],
}))

import { StringCodeMirror } from '@/components/shared/variable-bodies/string-code-mirror'

function getEditor(): HTMLTextAreaElement {
  return screen.getByTestId('cm') as HTMLTextAreaElement
}

function extensionsOf(): unknown[] {
  return JSON.parse(getEditor().getAttribute('data-extensions') ?? '[]')
}

describe('StringCodeMirror - controlled value', () => {
  it('renders the read-only value coerced to a string', () => {
    render(<StringCodeMirror value={42} readOnly />)
    expect(getEditor()).toHaveValue('42')
    expect(getEditor()).toHaveAttribute('data-readonly', 'true')
  })

  it('renders a structure as its compact JSON, never "[object Object]"', () => {
    render(<StringCodeMirror value={{ a: 1 }} readOnly />)
    expect(getEditor()).toHaveValue('{"a":1}')
  })

  it('seeds the editable draft and forwards every change', () => {
    const onChange = vi.fn()
    render(<StringCodeMirror value="hi" onChange={onChange} />)
    expect(getEditor()).toHaveValue('hi')
    fireEvent.change(getEditor(), { target: { value: 'updated' } })
    expect(onChange).toHaveBeenLastCalledWith('updated')
    expect(getEditor()).toHaveValue('updated')
  })
})

describe('StringCodeMirror - a variable that carries no value', () => {
  it('renders an empty read-only editor, never the word undefined', () => {
    render(<StringCodeMirror value={undefined} readOnly />)
    expect(getEditor().value).toBe('')
  })

  it('starts the editable draft empty when there is no value', () => {
    render(<StringCodeMirror value={undefined} onChange={vi.fn()} />)
    expect(getEditor().value).toBe('')
  })
})

describe('StringCodeMirror - format extensions', () => {
  it('keeps only the plain-text base when no format is given', () => {
    render(<StringCodeMirror value="x" readOnly />)
    expect(extensionsOf()).toEqual(['PLAIN_BASE'])
  })

  it('layers the format extension over the base for a data format', () => {
    render(<StringCodeMirror value="x" format="json" readOnly />)
    expect(extensionsOf()).toContain('PLAIN_BASE')
    expect(extensionsOf()).toContain('FMT:json')
  })

  it('injects host-supplied extra extensions after the base and format', () => {
    render(
      <StringCodeMirror
        value="x"
        format="yaml"
        extraExtensions={['EXTRA_A' as never]}
        readOnly
      />,
    )
    expect(extensionsOf()).toEqual(['PLAIN_BASE', 'FMT:yaml', 'EXTRA_A'])
  })

  it('injects extra extensions even without a format', () => {
    render(
      <StringCodeMirror value="x" extraExtensions={['EXTRA_B' as never]} readOnly />,
    )
    expect(extensionsOf()).toEqual(['PLAIN_BASE', 'EXTRA_B'])
  })
})

// A script body is code, not a string value: it keeps the normal text color.
describe('StringCodeMirror - value color of the plain-text base', () => {
  beforeEach(() => {
    plainBase.options.length = 0
  })

  function lastValueColor(): boolean | undefined {
    return plainBase.options.at(-1)?.valueColor
  }

  it('turns the value color off for a SQL body', () => {
    render(<StringCodeMirror value="SELECT 1" format="sql" onChange={vi.fn()} />)
    expect(lastValueColor()).toBe(false)
  })

  it('turns the value color off for a Python body', () => {
    render(<StringCodeMirror value="x = 1" format="python" onChange={vi.fn()} />)
    expect(lastValueColor()).toBe(false)
  })

  it('keeps the value color for a data format', () => {
    render(<StringCodeMirror value="{}" format="json" readOnly />)
    expect(lastValueColor()).toBe(true)
  })

  it('keeps the value color when no format is given', () => {
    render(<StringCodeMirror value="x" readOnly />)
    expect(lastValueColor()).toBe(true)
  })

  it('layers the SQL format extension over the base', () => {
    render(<StringCodeMirror value="SELECT 1" format="sql" readOnly />)
    expect(extensionsOf()).toEqual(['PLAIN_BASE', 'FMT:sql'])
  })
})

// An OpenSearch query body is code too: its bare values read in the normal text color (OS-12).
describe('StringCodeMirror - value color of an OpenSearch query body', () => {
  beforeEach(() => {
    plainBase.options.length = 0
  })

  it.each([['dql'], ['query-dsl'], ['aggregation-json']] as const)(
    'turns the value color off for a %s body',
    (format) => {
      render(<StringCodeMirror value="log.level: ERROR" format={format} onChange={vi.fn()} />)
      expect(plainBase.options.at(-1)?.valueColor).toBe(false)
    },
  )
})
