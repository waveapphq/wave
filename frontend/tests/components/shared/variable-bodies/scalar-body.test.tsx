/**
 * Tests for ScalarBody - the shared scalar/string Visual value body used by
 * the per-variable inspect modal (first file of the shared variable-bodies
 * family).
 *
 * Contract under test:
 *   - a string renders through the read-only StringCodeMirror (line numbers,
 *     wrapping); other scalars render full + untruncated in mono + the type color
 *   - literal values render through formatValue (strings raw, no display quotes)
 *   - expression content renders the raw text in cyan (no quoting)
 *   - variant='initial' dims (a string via opacity only; others + italic)
 *
 * REQ-3.2.2.18: Live variable values display
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, extensions }: { value: string; extensions?: unknown[] }) => (
    <div
      data-testid="codemirror-editor"
      data-extensions={JSON.stringify(extensions ?? [])}
    >
      {value}
    </div>
  ),
}))

vi.mock('@/lib/codemirror/plain-text-editor', () => ({
  createPlainTextEditorExtensions: () => [],
}))

vi.mock('@/lib/codemirror/format-editor', () => ({
  createFormatExtensions: (format: string) => [`FMT:${format}`],
}))

import { ScalarBody } from '@/components/shared/variable-bodies/scalar-body'
import type { VariableType } from '@/lib/variable-types'

interface RenderOptions {
  value?: unknown
  type?: VariableType
  isExpression?: boolean
  variant?: 'current' | 'initial'
  format?: 'json' | 'yaml' | 'xml' | 'plain'
  extraExtensions?: unknown[]
}

function renderBody({
  value = 'bob',
  type = 'string',
  isExpression,
  variant = 'current',
  format,
  extraExtensions,
}: RenderOptions = {}) {
  return render(
    <ScalarBody
      value={value}
      type={type}
      isExpression={isExpression}
      variant={variant}
      format={format}
      extraExtensions={extraExtensions as never}
    />,
  )
}

function readExtensions(): unknown[] {
  return JSON.parse(
    screen.getByTestId('codemirror-editor').getAttribute('data-extensions') ?? '[]',
  )
}

function getBody(): HTMLElement {
  return screen.getByTestId('scalar-body')
}

describe('ScalarBody - literal value rendering', () => {
  it('renders a string value through the read-only editor (raw, no display quotes)', () => {
    renderBody({ value: 'bob', type: 'string' })
    expect(getBody().textContent).toContain('bob')
    expect(screen.getByTestId('codemirror-editor')).toBeInTheDocument()
  })

  it.each([
    ['integer', 42, '42', /text-violet/],
    ['float', 3.14, '3.14', /text-pink/],
    ['boolean', true, 'true', /text-orange/],
  ] as const)(
    'renders %s values with the type color',
    (type, value, expected, colorPattern) => {
      renderBody({ value, type })
      const body = getBody()
      expect(body.textContent).toContain(expected)
      expect(body.className).toMatch(colorPattern)
    },
  )

  it('renders boolean false as "false"', () => {
    renderBody({ value: false, type: 'boolean' })
    expect(getBody().textContent).toContain('false')
  })
})

describe('ScalarBody - no truncation', () => {
  it('renders a 150-char string in full with no ellipsis (list truncation does not apply)', () => {
    const long = 'x'.repeat(150)
    renderBody({ value: long, type: 'string' })
    const body = getBody()
    expect(body.textContent).toContain(long)
    expect(body.textContent).not.toContain('…')
  })
})

describe('ScalarBody - expression content (cyan, raw)', () => {
  it('renders expression text raw in cyan, without string quoting', () => {
    renderBody({
      value: "'https://api/' + service_name",
      type: 'string',
      isExpression: true,
    })
    const body = getBody()
    // Raw source - NOT wrapped in formatValue's double quotes.
    expect(body.textContent).toContain("'https://api/' + service_name")
    expect(body.textContent).not.toContain('"\'https://api/\' + service_name"')
    expect(body.className).toMatch(/text-cyan/)
    expect(body.className).not.toMatch(/text-sky/)
  })

  it('renders expression content for non-string types in cyan too', () => {
    renderBody({ value: 42, type: 'integer', isExpression: true })
    const body = getBody()
    expect(body.textContent).toContain('42')
    expect(body.className).toMatch(/text-cyan/)
    expect(body.className).not.toMatch(/text-violet/)
  })
})

describe('ScalarBody - variant styling', () => {
  it('renders a string variant=initial dimmed via opacity (editor: no italic)', () => {
    renderBody({ value: 'bob', type: 'string', variant: 'initial' })
    const body = getBody()
    expect(body.className).toMatch(/opacity/)
    expect(body.className).not.toMatch(/italic/)
  })

  it('renders variant=current without the dim treatment', () => {
    renderBody({ value: 'bob', type: 'string', variant: 'current' })
    const body = getBody()
    expect(body.className).not.toMatch(/opacity/)
  })

  it('combines initial treatment with expression cyan', () => {
    renderBody({
      value: 'x + 1',
      type: 'integer',
      isExpression: true,
      variant: 'initial',
    })
    const body = getBody()
    expect(body.className).toMatch(/text-cyan/)
    expect(body.className).toMatch(/italic/)
  })
})

// ===========================================================================
// The string read body threads the per-watcher Format + host-injected template
// extensions into the read-only StringCodeMirror. Non-string scalars render a
// plain div and ignore them.
//
// REQ-3.1.3.11: Variable watching UI panel
// ===========================================================================

describe('ScalarBody - format threading (string branch)', () => {
  it('threads the format extension into the read string editor', () => {
    renderBody({ value: '{"a":1}', type: 'string', format: 'json' })
    expect(readExtensions()).toContain('FMT:json')
  })

  it('threads host-injected extra extensions into the read string editor', () => {
    renderBody({ value: 'x', type: 'string', extraExtensions: ['EXTRA_A'] })
    expect(readExtensions()).toContain('EXTRA_A')
  })

  it('ignores format on non-string scalars (no string editor rendered)', () => {
    renderBody({ value: 42, type: 'integer', format: 'json' })
    expect(screen.queryByTestId('codemirror-editor')).not.toBeInTheDocument()
    expect(getBody().textContent).toContain('42')
  })
})

describe('ScalarBody - unset variables', () => {
  it('never renders the text "not set" for a scalar with no value (REQ-3.1.3.20)', () => {
    for (const type of ['string', 'integer', 'float', 'boolean'] as VariableType[]) {
      for (const isExpression of [false, true]) {
        const { unmount } = render(
          <ScalarBody type={type} variant="current" isExpression={isExpression} />,
        )
        expect(screen.queryByText('not set')).not.toBeInTheDocument()
        expect(getBody().textContent).not.toMatch(/not set/)
        unmount()
      }
    }
  })

  it('still renders an expression source with no declared value as raw text', () => {
    renderBody({ value: 'a + b', isExpression: true })
    expect(getBody().textContent).toBe('a + b')
  })

  it('an empty string is a value, not unset', () => {
    renderBody({ value: '' })
    expect(screen.getByTestId('codemirror-editor').textContent).toBe('')
  })
})
