/**
 * Multipart Parts editor sheet (REQ-3.4.1.4).
 *
 * On the Block window the Parts row is a one-line list field (FIELD-10): the parts as JSON records on one line, a {x}
 * part value drawn as a bare {{ expr }}, and expand opening this sheet (REQ-3.1.1.5).
 *
 * A bespoke sheet: one row per part with a Kind (Text/File) select, Name, and
 * Value-or-Source input. A text-part value is a literal string OR a whole-value
 * expression - the per-row {x} toggle swaps the plain input for the
 * host-injected expression editor; expression-ness is a sidecar set of text-part
 * indices, never embedded in the value. The Code view is a JSON array of part
 * objects where an expression value renders as a bare {{ expr }}.
 */
import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  PartsEditorSheet,
  type Part,
} from '@/features/workbench/common/element-config/parts-editor/parts-editor-sheet'
import {
  parsePartsCode,
  serializePartsForCode,
} from '@/features/workbench/common/element-config/parts-editor/parts-code'
import { ParameterTable } from '@/features/workbench/common/element-config/parameters/parameter-table'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import type { MapExpressionEditorProps } from '@/components/shared/variable-bodies/map-edit-body'
import {
  ChildEditorParent,
  applyParentChildren,
  parentChildren,
} from '../../../../utils/child-editor-parent'

// The file-reference picker has its own test file; a file part only has to open
// it in file mode and take the value back.
vi.mock('@/features/workbench/common/element-config/parameters/file-reference-picker-sheet', () => ({
  FileReferencePickerSheet: ({
    label,
    mode,
    initialValue,
    onChoose,
    onClose,
  }: {
    label: string
    mode: string
    initialValue: string
    onChoose: (value: string) => void
    onClose: () => void
  }) => (
    <div data-testid="picker-mock" data-label={label} data-mode={mode} data-initial-value={initialValue}>
      <button
        type="button"
        data-testid="picker-mock-choose"
        onClick={() => {
          onChoose('testdata://fixtures/users.csv')
          onClose()
        }}
      >
        choose
      </button>
      <button type="button" data-testid="picker-mock-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}))

vi.mock('@/components/shared/variable-bodies/code-body', () => ({
  CodeBody: ({
    onChange,
    onValidChange,
    serialize,
    value,
  }: {
    onChange?: (text: string) => void
    onValidChange?: (valid: boolean) => void
    serialize?: (value: unknown) => string
    value: unknown
  }) => (
    <textarea
      data-testid="code-body"
      defaultValue={serialize?.(value)}
      onChange={(event) => {
        const text = event.target.value
        try {
          JSON.parse(text)
          onValidChange?.(true)
        } catch {
          onValidChange?.(false)
        }
        onChange?.(text)
      }}
    />
  ),
}))

// Real ViewDropdown plus a raw channel firing onValueChange('visual') directly,
// so the sheet's own broken-document guard is testable at its prop boundary
// (Radix suppresses selection of the disabled Visual item).
vi.mock(
  '@/features/workbench/common/variables/variable-inspect-modal/view-dropdown',
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('@/features/workbench/common/variables/variable-inspect-modal/view-dropdown')
    >()
    return {
      ...actual,
      ViewDropdown: (props: React.ComponentProps<typeof actual.ViewDropdown>) => (
        <>
          <actual.ViewDropdown {...props} />
          <button
            type="button"
            data-testid="force-view-visual"
            onClick={() => props.onValueChange('visual')}
          />
        </>
      ),
    }
  },
)

const FILE_SOURCE_PLACEHOLDER = 'artifact://…, testdata://…, or /abs/path on host'

const EXPR_PART: Part = { kind: 'text', name: 'metadata', value: 'run_id' }
const PLAIN_PART: Part = { kind: 'text', name: 'plain', value: 'hello' }
const FILE_PART: Part = { kind: 'file', name: 'report', source: 'artifact://reports/run-42.pdf' }

function fakeExpressionEditor(props: MapExpressionEditorProps) {
  return (
    <input
      data-testid={props.testId}
      aria-label={props.ariaLabel}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  )
}

function renderSheet(value: Part[] = [PLAIN_PART, FILE_PART], expressionIndices?: ReadonlySet<number>) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(
    <PartsEditorSheet
      label="Parts"
      value={value}
      expressionEditor={fakeExpressionEditor}
      expressionIndices={expressionIndices}
      onSave={onSave}
      onClose={onClose}
    />,
  )
  return { onSave, onClose }
}

const save = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Save' }))

const switchView = async (user: ReturnType<typeof userEvent.setup>, view: string) => {
  await user.click(screen.getByTestId('view-dropdown'))
  await user.click(await screen.findByRole('option', { name: view }))
}

describe('rows render per part', () => {
  it('renders a kind select, name, and value input for a plain text part', () => {
    renderSheet([PLAIN_PART])
    expect(screen.getByTestId('part-kind-0')).toHaveTextContent('Text')
    expect(screen.getByTestId('part-name-0')).toHaveValue('plain')
    expect(screen.getByTestId('part-value-0')).toHaveValue('hello')
    expect(screen.queryByTestId('part-source-0')).not.toBeInTheDocument()
  })

  it('renders a source input with the host-path placeholder for a file part', () => {
    renderSheet([FILE_PART])
    expect(screen.getByTestId('part-kind-0')).toHaveTextContent('File')
    expect(screen.getByTestId('part-source-0')).toHaveValue('artifact://reports/run-42.pdf')
    expect(screen.getByTestId('part-source-0')).toHaveAttribute(
      'placeholder',
      FILE_SOURCE_PLACEHOLDER,
    )
    expect(screen.queryByTestId('part-value-0')).not.toBeInTheDocument()
  })

  it('shows the expression toggle only on text parts', () => {
    renderSheet([PLAIN_PART, FILE_PART])
    expect(screen.getByTestId('part-expr-toggle-0')).toBeInTheDocument()
    expect(screen.queryByTestId('part-expr-toggle-1')).not.toBeInTheDocument()
  })

  it('shows the part count in the footer', () => {
    renderSheet([PLAIN_PART, FILE_PART])
    expect(screen.getByText('2 parts')).toBeInTheDocument()
  })

  it('shows the singular part count in the footer', () => {
    renderSheet([PLAIN_PART])
    expect(screen.getByText('1 part')).toBeInTheDocument()
  })

  // Every box of a row is one 32px height, as the Kind select is (FIELD-1).
  it('draws the name, value and source boxes at the one 32px row height', () => {
    renderSheet([PLAIN_PART, FILE_PART])
    for (const testId of ['part-kind-0', 'part-name-0', 'part-value-0', 'part-name-1', 'part-source-1']) {
      expect(screen.getByTestId(testId)).toHaveClass('h-8')
    }
  })
})

describe('parts CRUD', () => {
  it('adds a fresh text part via + Add Part', async () => {
    const user = userEvent.setup()
    renderSheet([PLAIN_PART])
    await user.click(screen.getByTestId('parts-add-part'))
    expect(screen.getByTestId('part-kind-1')).toHaveTextContent('Text')
    expect(screen.getByTestId('part-name-1')).toHaveValue('')
    expect(screen.getByTestId('part-value-1')).toHaveValue('')
  })

  it('removes the targeted row', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet([PLAIN_PART, FILE_PART])
    await user.click(screen.getByTestId('part-remove-0'))
    await save(user)
    expect(onSave).toHaveBeenCalledWith([FILE_PART], [])
  })

  it('saves edited names and values in the stored JSON shapes', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet([PLAIN_PART, FILE_PART])
    fireEvent.change(screen.getByTestId('part-name-0'), { target: { value: 'summary' } })
    fireEvent.change(screen.getByTestId('part-value-0'), { target: { value: 'hi' } })
    fireEvent.change(screen.getByTestId('part-source-1'), {
      target: { value: 'testdata://fixtures/report.pdf' },
    })
    await save(user)
    expect(onSave).toHaveBeenCalledWith(
      [
        { kind: 'text', name: 'summary', value: 'hi' },
        { kind: 'file', name: 'report', source: 'testdata://fixtures/report.pdf' },
      ],
      [],
    )
  })

  it('drops a fully-empty row on save', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet([PLAIN_PART])
    await user.click(screen.getByTestId('parts-add-part'))
    await save(user)
    expect(onSave).toHaveBeenCalledWith([PLAIN_PART], [])
  })

  it('allows duplicate part names (multipart repeats are legal)', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet([PLAIN_PART, { kind: 'text', name: 'plain', value: 'two' }])
    await save(user)
    expect(onSave).toHaveBeenCalledWith(
      [PLAIN_PART, { kind: 'text', name: 'plain', value: 'two' }],
      [],
    )
    expect(screen.queryByTestId('parts-editor-validation')).not.toBeInTheDocument()
  })

  it('switches a text part to a file part through the kind select', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet([PLAIN_PART])
    await user.click(screen.getByTestId('part-kind-0'))
    await user.click(await screen.findByRole('option', { name: 'File' }))
    fireEvent.change(screen.getByTestId('part-source-0'), {
      target: { value: '/data/payload.bin' },
    })
    await save(user)
    expect(onSave).toHaveBeenCalledWith([{ kind: 'file', name: 'plain', source: '/data/payload.bin' }], [])
  })

  it('switches a file part back to a text part through the kind select', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet([FILE_PART])
    await user.click(screen.getByTestId('part-kind-0'))
    await user.click(await screen.findByRole('option', { name: 'Text' }))
    fireEvent.change(screen.getByTestId('part-value-0'), {
      target: { value: 'now text' },
    })
    await save(user)
    expect(onSave).toHaveBeenCalledWith([{ kind: 'text', name: 'report', value: 'now text' }], [])
  })
})

describe('expression affordance on text-part values', () => {
  it('seeds isExpr from expressionIndices and renders the injected editor', () => {
    renderSheet([EXPR_PART, PLAIN_PART], new Set([0]))
    expect(screen.getByTestId('part-expr-toggle-0')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('part-expr-value-0')).toHaveValue('run_id')
    expect(screen.getByTestId('part-expr-toggle-1')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('part-value-1')).toHaveValue('hello')
  })

  it('leaves a text value with {{ }} chars a literal when not seeded as an expression', () => {
    renderSheet([{ kind: 'text', name: 'note', value: '{{ not an expr }}' }])
    expect(screen.getByTestId('part-expr-toggle-0')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('part-value-0')).toHaveValue('{{ not an expr }}')
  })

  it('shows the mode by the pressed look alone, with no tooltip or browser popup', async () => {
    const user = userEvent.setup()
    renderSheet([PLAIN_PART])
    const toggle = () => screen.getByTestId('part-expr-toggle-0')
    expect(toggle()).not.toHaveAttribute('title')
    expect(toggle()).toHaveAttribute('data-state', 'off')
    fireEvent.focus(toggle())
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull()
    await user.click(toggle())
    expect(toggle()).toHaveAttribute('data-state', 'on')
    fireEvent.focus(toggle())
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull()
  })

  it('draws the shared {x} toggle on a text part and Browse in its place on a file part', () => {
    renderSheet([PLAIN_PART, FILE_PART])
    expect(screen.getByTestId('part-expr-toggle-0')).toHaveAttribute('data-slot', 'expression-toggle')
    expect(screen.getByTestId('part-browse-1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Part 1 expression mode' })).not.toBeInTheDocument()
  })

  it('draws Browse and Remove at the 32px row height, so file and text parts line up', () => {
    renderSheet([PLAIN_PART, FILE_PART])
    for (const id of ['part-browse-1', 'part-remove-0', 'part-remove-1']) {
      expect(screen.getByTestId(id)).toHaveClass('h-8', 'w-8')
      expect(screen.getByTestId(id)).not.toHaveClass('h-9')
    }
  })

  it('draws the shared {x} toggle locked when the host gives no expression editor', () => {
    render(<PartsEditorSheet label="Parts" value={[PLAIN_PART]} onSave={vi.fn()} onClose={vi.fn()} />)
    const locked = screen.getByRole('button', { name: 'Part 0 expression mode' })
    expect(locked).toHaveAttribute('data-slot', 'expression-toggle')
    expect(locked).toBeDisabled()
    expect(locked).toHaveAttribute('aria-pressed', 'false')
  })

  it('toggling a literal to expression swaps the input and saves the index', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet([PLAIN_PART])
    await user.click(screen.getByTestId('part-expr-toggle-0'))
    expect(screen.getByTestId('part-expr-value-0')).toHaveValue('hello')
    fireEvent.change(screen.getByTestId('part-expr-value-0'), {
      target: { value: 'user_var' },
    })
    await save(user)
    expect(onSave).toHaveBeenCalledWith([{ kind: 'text', name: 'plain', value: 'user_var' }], [0])
  })

  it('clears expression mode when a text part becomes a file part', async () => {
    const user = userEvent.setup()
    renderSheet([EXPR_PART], new Set([0]))
    expect(screen.getByTestId('part-expr-value-0')).toBeInTheDocument()
    await user.click(screen.getByTestId('part-kind-0'))
    await user.click(await screen.findByRole('option', { name: 'File' }))
    expect(screen.queryByTestId('part-expr-toggle-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('part-source-0')).toBeInTheDocument()
  })

  it('recomputes exprIndices against the emitted parts after an empty row is dropped', async () => {
    const user = userEvent.setup()
    const first: Part = { kind: 'text', name: 'first', value: 'a' }
    const second: Part = { kind: 'text', name: 'second', value: 'run_id' }
    const { onSave } = renderSheet([first, second], new Set([1]))
    fireEvent.change(screen.getByTestId('part-name-0'), { target: { value: '' } })
    fireEvent.change(screen.getByTestId('part-value-0'), { target: { value: '' } })
    await save(user)
    expect(onSave).toHaveBeenCalledWith([{ kind: 'text', name: 'second', value: 'run_id' }], [0])
  })

  it('renders no expression editor slot when the host injects none', () => {
    const onSave = vi.fn()
    render(
      <PartsEditorSheet label="Parts" value={[PLAIN_PART]} onSave={onSave} onClose={vi.fn()} />,
    )
    expect(screen.queryByTestId('part-expr-toggle-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('part-value-0')).toBeInTheDocument()
  })
})

describe('Code view', () => {
  it('switches to Code with the parts serialized as a plain JSON array', async () => {
    const user = userEvent.setup()
    renderSheet([PLAIN_PART, FILE_PART])
    await switchView(user, 'Code')
    const code = await screen.findByTestId('code-body')
    expect(JSON.parse((code as HTMLTextAreaElement).value)).toEqual([PLAIN_PART, FILE_PART])
  })

  it('serializes an expression text part as a bare {{ }} value in Code', async () => {
    const user = userEvent.setup()
    renderSheet([EXPR_PART], new Set([0]))
    await switchView(user, 'Code')
    const code = await screen.findByTestId('code-body')
    expect((code as HTMLTextAreaElement).value).toContain('"value":{{ run_id }}')
  })

  it('round-trips an edited Code document back to Visual rows, order preserved', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet([PLAIN_PART])
    await switchView(user, 'Code')
    const code = await screen.findByTestId('code-body')
    fireEvent.change(code, {
      target: {
        value: JSON.stringify([FILE_PART, PLAIN_PART]),
      },
    })
    await switchView(user, 'Visual')
    expect(screen.getByTestId('part-name-0')).toHaveValue('report')
    expect(screen.getByTestId('part-name-1')).toHaveValue('plain')
    await save(user)
    expect(onSave).toHaveBeenCalledWith([FILE_PART, PLAIN_PART], [])
  })

  it('rejects a non-string value with the exact message and disables Save', async () => {
    const user = userEvent.setup()
    renderSheet([PLAIN_PART])
    await switchView(user, 'Code')
    fireEvent.change(await screen.findByTestId('code-body'), {
      target: { value: '[{"kind": "text", "name": "n", "value": 7}]' },
    })
    expect(screen.getByTestId('parts-editor-validation')).toHaveTextContent(
      'Part #0: "value" must be a quoted string or a {{ expression }}',
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('rejects an unknown kind with the exact message', async () => {
    const user = userEvent.setup()
    renderSheet([PLAIN_PART])
    await switchView(user, 'Code')
    fireEvent.change(await screen.findByTestId('code-body'), {
      target: {
        value:
          '[{"kind": "blob", "name": "n", "value": "v"}, {"kind": "text", "name": "n", "value": "v", "extra": "x"}]',
      },
    })
    const stripe = screen.getByTestId('parts-editor-validation')
    expect(stripe).toHaveTextContent('Part #0: kind must be "text" or "file"')
  })

  it('renders an invalid JSON document as a syntax error and disables Save', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet([PLAIN_PART])
    await switchView(user, 'Code')
    fireEvent.change(await screen.findByTestId('code-body'), {
      target: { value: '[{"kind": "text",' },
    })
    const stripe = screen.getByTestId('parts-editor-validation')
    expect(stripe.textContent).not.toBe('')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps the Code view when Visual is chosen while the document is broken', async () => {
    const user = userEvent.setup()
    renderSheet([PLAIN_PART])
    await switchView(user, 'Code')
    fireEvent.change(await screen.findByTestId('code-body'), {
      target: { value: '[{' },
    })
    await user.click(screen.getByTestId('view-dropdown'))
    await user.click(await screen.findByRole('option', { name: 'Visual' }))
    expect(screen.getByTestId('code-body')).toBeInTheDocument()
    expect(screen.queryByTestId('part-value-0')).not.toBeInTheDocument()
  })

  it('guards a forced visual switch while broken: stays in Code, errors kept', async () => {
    const user = userEvent.setup()
    renderSheet([PLAIN_PART])
    await switchView(user, 'Code')
    fireEvent.change(await screen.findByTestId('code-body'), {
      target: { value: '[{' },
    })
    fireEvent.click(screen.getByTestId('force-view-visual'))
    expect(screen.getByTestId('code-body')).toBeInTheDocument()
    expect(screen.getByTestId('parts-editor-validation')).toBeInTheDocument()
  })
})

describe('parts Code codec (parse + serialize)', () => {
  it('serializes text and file parts with a fixed key order', () => {
    const text = serializePartsForCode([PLAIN_PART, FILE_PART])
    expect(JSON.parse(text)).toEqual([PLAIN_PART, FILE_PART])
  })

  it('serializes no parts as the compact empty array', () => {
    expect(serializePartsForCode([])).toBe('[]')
  })

  it('renders an expression text part as a bare {{ }} value', () => {
    const text = serializePartsForCode([EXPR_PART], new Set([0]))
    expect(text).toBe('[\n  {"kind":"text","name":"metadata","value":{{ run_id }}}\n]')
  })

  it('keeps a literal text value quoted even when it contains {{ }} chars', () => {
    const text = serializePartsForCode([{ kind: 'text', name: 'note', value: '{{ nope }}' }])
    expect(text).toBe('[\n  {"kind":"text","name":"note","value":"{{ nope }}"}\n]')
  })

  it('parses a valid literal document, preserving order and duplicates', () => {
    const doc = JSON.stringify([FILE_PART, PLAIN_PART, PLAIN_PART])
    expect(parsePartsCode(doc)).toEqual({
      parts: [FILE_PART, PLAIN_PART, PLAIN_PART],
      exprIndices: [],
      errors: [],
    })
  })

  it('round-trips a bare-expression text part, recovering the raw expression and index', () => {
    const doc = serializePartsForCode([EXPR_PART], new Set([0]))
    expect(parsePartsCode(doc)).toEqual({ parts: [EXPR_PART], exprIndices: [0], errors: [] })
  })

  it('captures a bare expression that itself contains single braces', () => {
    const parsed = parsePartsCode('[{"kind":"text","name":"n","value":{{ obj["k"] }}}]')
    expect(parsed.parts).toEqual([{ kind: 'text', name: 'n', value: 'obj["k"]' }])
    expect(parsed.exprIndices).toEqual([0])
    expect(parsed.errors).toEqual([])
  })

  it('computes exprIndices against the emitted array when a leading part is dropped', () => {
    const parsed = parsePartsCode(
      '[{"kind":"blob","name":"n","value":"v"},{"kind":"text","name":"m","value":{{ x }}}]',
    )
    expect(parsed.errors).toEqual(['Part #0: kind must be "text" or "file"'])
    expect(parsed.parts).toEqual([{ kind: 'text', name: 'm', value: 'x' }])
    expect(parsed.exprIndices).toEqual([0])
  })

  it('rejects a non-array document', () => {
    expect(parsePartsCode('{"kind": "text"}').errors).toEqual([
      'Parts must be a JSON array of part objects',
    ])
  })

  it('rejects a non-object element', () => {
    expect(parsePartsCode('["x"]').errors).toEqual(['Part #0: must be an object'])
  })

  it('rejects an unknown kind', () => {
    expect(parsePartsCode('[{"kind": "blob", "name": "n", "value": "v"}]').errors).toEqual([
      'Part #0: kind must be "text" or "file"',
    ])
  })

  it('rejects unknown keys', () => {
    expect(
      parsePartsCode('[{"kind": "text", "name": "n", "value": "v", "expr": true}]').errors,
    ).toEqual(['Part #0: unknown key "expr"'])
  })

  it('rejects a file part carrying "value" instead of "source"', () => {
    expect(parsePartsCode('[{"kind": "file", "name": "n", "value": "v"}]').errors).toEqual([
      'Part #0: unknown key "value"',
      'Part #0: file parts need "name" and "source"',
    ])
  })

  it('rejects missing fields per kind', () => {
    expect(parsePartsCode('[{"kind": "text", "name": "n"}]').errors).toEqual([
      'Part #0: text parts need "name" and "value"',
    ])
  })

  it('rejects a non-string name with the must-be-a-string message', () => {
    expect(parsePartsCode('[{"kind": "file", "name": 3, "source": "s"}]').errors).toEqual([
      'Part #0: "name" must be a string',
    ])
  })

  it('rejects a non-string source with the must-be-a-string message', () => {
    expect(parsePartsCode('[{"kind": "file", "name": "n", "source": 5}]').errors).toEqual([
      'Part #0: "source" must be a string',
    ])
  })

  it('rejects a non-string value with the quoted-or-expression message', () => {
    expect(parsePartsCode('[{"kind": "text", "name": "n", "value": 7}]').errors).toEqual([
      'Part #0: "value" must be a quoted string or a {{ expression }}',
    ])
  })

  it('rejects a bare {{ }} in the name position (name stays a quoted string)', () => {
    expect(parsePartsCode('[{"kind": "text", "name": {{ x }}, "value": "v"}]').errors).toEqual([
      'Part #0: "name" must be a string',
    ])
  })

  it('throws on invalid JSON (the sheet renders the syntax error)', () => {
    expect(() => parsePartsCode('[{')).toThrow()
  })

  it('throws on an unterminated bare expression', () => {
    expect(() => parsePartsCode('[{"kind": "text", "name": "n", "value": {{ oops }]')).toThrow()
  })
})

describe('sheet chrome', () => {
  it('saves the parts and then closes', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderSheet([PLAIN_PART])
    await save(user)
    expect(onSave).toHaveBeenCalledExactlyOnceWith([PLAIN_PART], [])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('cancels without saving', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderSheet()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('closes from the header X and keeps a pointer-down from starting a drag', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet()
    const close = screen.getByRole('button', { name: 'Close parts editor' })
    fireEvent.pointerDown(close)
    await user.click(close)
    expect(onClose).toHaveBeenCalled()
  })
})

const PARTS_PARAM: Parameter = {
  name: 'parts',
  label: 'Parts',
  type: 'array',
  required: false,
  partsEditor: true,
}

interface PartsTableProps {
  parameter?: Parameter
  values: Record<string, unknown>
  expressionFields?: string[]
  onChange?: (name: string, value: unknown) => void
  onExpressionFieldsChange?: (fields: string[]) => void
}

/** The Parts row as the Block window draws it. */
function PartsTable({
  parameter = PARTS_PARAM,
  values,
  expressionFields,
  onChange = vi.fn(),
  onExpressionFieldsChange,
}: Readonly<PartsTableProps>) {
  return (
    <ParameterTable
      mode="input"
      parameters={[parameter]}
      values={values}
      onChange={onChange}
      availableVariables={[]}
      expressionFields={expressionFields}
      onExpressionFieldsChange={onExpressionFieldsChange}
    />
  )
}

function partsRow(): HTMLElement {
  return screen.getByTestId('param-row-parts')
}

/** Every text the row shows: its text nodes and the values of its text boxes. */
function shownText(container: HTMLElement): string {
  const boxes = Array.from(container.querySelectorAll<HTMLInputElement>('input, textarea')).map((box) => box.value)
  return [container.textContent ?? '', ...boxes].join('\n')
}

/** The text box holding exactly this text, else the deepest element whose text it is. */
function elementShowing(container: HTMLElement, text: string): HTMLElement | undefined {
  const box = Array.from(container.querySelectorAll<HTMLInputElement>('input, textarea')).find(
    (candidate) => candidate.value === text,
  )
  if (box) return box
  return Array.from(container.querySelectorAll<HTMLElement>('*'))
    .filter((element) => element.textContent === text)
    .at(-1)
}

/** Writes the table made to the Parts row. */
function partsWrites(onChange: ReturnType<typeof vi.fn>): unknown[][] {
  return onChange.mock.calls.filter(([name]) => name === 'parts')
}

async function openFromExpand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('param-expand-parts'))
}

describe('Parts field - the one-line list (FIELD-10)', () => {
  it('shows the parts as JSON records on one line', () => {
    render(<PartsTable values={{ parts: [PLAIN_PART, FILE_PART] }} />)

    expect(shownText(partsRow())).toMatch(
      /\[\{"kind": ?"text", ?"name": ?"plain", ?"value": ?"hello"\}, ?\{"kind": ?"file", ?"name": ?"report", ?"source": ?"artifact:\/\/reports\/run-42\.pdf"\}\]/,
    )
  })

  it('draws a {x} part value as a bare {{ expr }}', () => {
    render(<PartsTable values={{ parts: [EXPR_PART] }} expressionFields={['parts.0.value']} />)

    const text = shownText(partsRow())
    expect(text).toMatch(/\{"kind": ?"text", ?"name": ?"metadata", ?"value": ?\{\{ run_id \}\}\}/)
    expect(text).not.toContain('"{{ run_id }}"')
    expect(text).not.toContain('"run_id"')
  })

  it('keeps a literal value that reads like {{ }} quoted', () => {
    render(<PartsTable values={{ parts: [{ kind: 'text', name: 'note', value: '{{ nope }}' }] }} />)

    expect(shownText(partsRow())).toMatch(/"value": ?"\{\{ nope \}\}"/)
  })

  it('shows an empty list as []', () => {
    render(<PartsTable values={{ parts: [] }} />)

    expect(elementShowing(partsRow(), '[]')).toBeDefined()
  })

  it('draws expand beside the field, with no count button', () => {
    render(<PartsTable values={{ parts: [PLAIN_PART, FILE_PART] }} />)

    expect(within(partsRow()).getByTestId('param-expand-parts')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Parts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Array' })).not.toBeInTheDocument()
  })
})

describe('Parts field - expand opens the Parts editor', () => {
  it('names an unlabeled row by its parameter name', async () => {
    const user = userEvent.setup()
    render(
      <ChildEditorParent>
        <PartsTable
          parameter={{ name: 'parts', type: 'array', required: false, partsEditor: true }}
          values={{ parts: [PLAIN_PART] }}
        />
      </ChildEditorParent>,
    )
    await openFromExpand(user)
    await user.type(screen.getByTestId('part-name-0'), 'x')
    expect(parentChildren()).toEqual([{ label: 'parts', hasChanges: true, cannotBeSaved: false }])
  })

  it('opens the Parts editor seeded with the stored parts, not the generic value editor', async () => {
    const user = userEvent.setup()
    render(<PartsTable values={{ parts: [PLAIN_PART, FILE_PART] }} />)
    await openFromExpand(user)
    expect(screen.getByTestId('parts-editor-sheet')).toBeInTheDocument()
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    expect(screen.getByTestId('part-name-0')).toHaveValue('plain')
    expect(screen.getByTestId('part-source-1')).toHaveValue('artifact://reports/run-42.pdf')
  })

  it('routes a sheet save through onChange and closes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<PartsTable values={{ parts: [PLAIN_PART] }} onChange={onChange} />)
    await openFromExpand(user)
    await user.click(screen.getByTestId('parts-editor-save-button'))
    expect(onChange).toHaveBeenCalledWith('parts', [PLAIN_PART])
    expect(screen.queryByTestId('parts-editor-sheet')).not.toBeInTheDocument()
  })

  it('closes without saving on cancel', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<PartsTable values={{ parts: [PLAIN_PART] }} onChange={onChange} />)
    await openFromExpand(user)
    await user.click(screen.getByTestId('parts-editor-cancel-button'))
    expect(partsWrites(onChange)).toEqual([])
    expect(screen.queryByTestId('parts-editor-sheet')).not.toBeInTheDocument()
  })

  it('injects the workbench expression editor for a seeded expression part', async () => {
    const user = userEvent.setup()
    render(<PartsTable values={{ parts: [EXPR_PART] }} expressionFields={['parts.0.value']} />)
    await openFromExpand(user)
    expect(screen.getByTestId('part-expr-toggle-0')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('part-expr-value-0')).toBeInTheDocument()
  })

  it('writes the dotted part-value expression field on save', async () => {
    const user = userEvent.setup()
    const onExpressionFieldsChange = vi.fn()
    render(
      <PartsTable
        values={{ parts: [EXPR_PART] }}
        expressionFields={['parts.0.value']}
        onExpressionFieldsChange={onExpressionFieldsChange}
      />,
    )
    await openFromExpand(user)
    await user.click(screen.getByTestId('parts-editor-save-button'))
    expect(onExpressionFieldsChange).toHaveBeenCalledWith(['parts.0.value'])
  })
})

describe('Browse on file-kind part rows', () => {
  const browseButton = () => screen.getByRole('button', { name: /^Browse files for / })

  it('offers Browse on a file part', () => {
    renderSheet([FILE_PART])

    expect(browseButton()).toBeInTheDocument()
  })

  it('offers no Browse on a text part', () => {
    renderSheet([PLAIN_PART])

    expect(screen.queryByRole('button', { name: /^Browse files for / })).not.toBeInTheDocument()
  })

  it('offers Browse only on the file part of a mixed list', () => {
    renderSheet([PLAIN_PART, FILE_PART])

    expect(screen.getAllByRole('button', { name: /^Browse files for / })).toHaveLength(1)
  })

  it('offers Browse once a text part is switched to a file part', async () => {
    const user = userEvent.setup()
    renderSheet([PLAIN_PART])

    await user.click(screen.getByTestId('part-kind-0'))
    await user.click(await screen.findByRole('option', { name: 'File' }))

    expect(browseButton()).toBeInTheDocument()
  })

  it('opens the picker in file mode on the part source', async () => {
    const user = userEvent.setup()
    renderSheet([FILE_PART])

    await user.click(browseButton())

    expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-mode', 'file')
    expect(screen.getByTestId('picker-mock')).toHaveAttribute(
      'data-initial-value',
      'artifact://reports/run-42.pdf',
    )
  })

  it('writes the chosen reference into the part source', async () => {
    const user = userEvent.setup()
    renderSheet([FILE_PART])

    await user.click(browseButton())
    await user.click(screen.getByTestId('picker-mock-choose'))

    expect(screen.getByTestId('part-source-0')).toHaveValue('testdata://fixtures/users.csv')
    expect(screen.queryByTestId('picker-mock')).not.toBeInTheDocument()
  })

  it('saves the part with the chosen reference', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet([FILE_PART])

    await user.click(browseButton())
    await user.click(screen.getByTestId('picker-mock-choose'))
    await save(user)

    expect(onSave).toHaveBeenCalledWith(
      [{ kind: 'file', name: 'report', source: 'testdata://fixtures/users.csv' }],
      [],
    )
  })

  it('closes the picker of a part row that is removed', async () => {
    const user = userEvent.setup()
    renderSheet([PLAIN_PART, FILE_PART])

    await user.click(browseButton())
    await user.click(screen.getByTestId('part-remove-1'))

    expect(screen.queryByTestId('picker-mock')).not.toBeInTheDocument()
  })

  it('keeps the picker of the browsed row when a later row is removed', async () => {
    const user = userEvent.setup()
    renderSheet([FILE_PART, PLAIN_PART])

    await user.click(browseButton())
    await user.click(screen.getByTestId('part-remove-1'))

    expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-label', 'Part 1')
  })

  it('keeps the picker of a part row that stays, on the row it belongs to', async () => {
    const user = userEvent.setup()
    renderSheet([PLAIN_PART, FILE_PART])

    await user.click(browseButton())
    await user.click(screen.getByTestId('part-remove-0'))

    expect(screen.getByTestId('picker-mock')).toHaveAttribute(
      'data-initial-value',
      'artifact://reports/run-42.pdf',
    )
    expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-label', 'Part 1')
  })

  it('leaves the part source alone when the picker is canceled', async () => {
    const user = userEvent.setup()
    renderSheet([FILE_PART])

    await user.click(browseButton())
    await user.click(screen.getByTestId('picker-mock-close'))

    expect(screen.getByTestId('part-source-0')).toHaveValue('artifact://reports/run-42.pdf')
    expect(screen.queryByTestId('picker-mock')).not.toBeInTheDocument()
  })
})

describe('the parent the Parts editor was opened from', () => {
  function renderInParent(value: Part[] = [PLAIN_PART]) {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(
      <ChildEditorParent>
        <PartsEditorSheet label="Parts" value={value} onSave={onSave} onClose={onClose} />
      </ChildEditorParent>,
    )
    return { onSave, onClose }
  }

  it('reports its row label with no changes while the parts are untouched', () => {
    renderInParent()
    expect(parentChildren()).toEqual([{ label: 'Parts', hasChanges: false, cannotBeSaved: false }])
  })

  it('reports changes once a part is edited', async () => {
    const user = userEvent.setup()
    renderInParent()
    await user.type(screen.getByTestId('part-name-0'), 'x')
    expect(parentChildren()).toEqual([{ label: 'Parts', hasChanges: true, cannotBeSaved: false }])
  })

  it('reports changes it cannot save while the Code view does not parse', async () => {
    renderInParent()
    const user = userEvent.setup()
    await switchView(user, 'Code')
    fireEvent.change(await screen.findByTestId('code-body'), { target: { value: '[{' } })
    expect(parentChildren()).toEqual([{ label: 'Parts', hasChanges: true, cannotBeSaved: true }])
  })

  it('lets the parent write the parts without closing', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderInParent()
    await user.type(screen.getByTestId('part-name-0'), 'x')

    act(() => applyParentChildren())

    expect(onSave).toHaveBeenCalledExactlyOnceWith([{ ...PLAIN_PART, name: 'plainx' }], [])
    expect(onClose).not.toHaveBeenCalled()
  })

  it('names the part row a file picker was opened from', async () => {
    const user = userEvent.setup()
    renderSheet([PLAIN_PART, FILE_PART])
    await user.click(screen.getByRole('button', { name: /^Browse files for / }))
    expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-label', 'Part 2')
  })
})
