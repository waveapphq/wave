/**
 * Tests for InlineVariableRow.
 *
 * Pins the two-line grid layout, the four-icon action cluster
 * (eye / expand / edit / delete), the per-row eye toggle (runtime vs
 * definition view), the secret-disabled eye with tooltip, the
 * "<not evaluated yet>" placeholder for unevaluated expressions, and the
 * row-state matrix.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.2.2.18: Live variable values display
 */

import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InlineVariableRow } from '@/features/workbench/common/variables/variable-manager-content/variable-row-inline'
import { NULL_LOOK_CLASS, ROLE_BADGE_CLASS, getValueColorClass } from '@/lib/variable-format'
import type { Variable } from '@/features/workbench/common/variables/variable-manager-content/types'
import { INLINE_VARIABLE_ROW_HEIGHT } from '@/features/workbench/common/variables/variable-manager-content/types'

// ===========================================================================
// Helpers
// ===========================================================================

const ALL_TYPES: ReadonlyArray<Variable['type']> = [
  'string',
  'integer',
  'float',
  'boolean',
  'array',
  'map',
  'table',
]

const SAMPLE_VALUES: Readonly<Record<Variable['type'], unknown>> = {
  string: 'held',
  integer: 3,
  float: 1.5,
  boolean: true,
  array: [1],
  map: { a: 1 },
  table: [{ a: 1 }],
}

function nullLookClasses(): string[] {
  expect(typeof NULL_LOOK_CLASS).toBe('string')
  return NULL_LOOK_CLASS.split(/\s+/).filter(Boolean)
}

function hasNullLook(element: HTMLElement): boolean {
  return nullLookClasses().every((cls) => element.classList.contains(cls))
}

/** The value cell reads exactly `null`, and the element holding that text carries the null look. */
function expectNullLook(valueCell: HTMLElement) {
  expect(valueCell.textContent).toBe('null')
  const text = within(valueCell).getByText('null')
  for (const cls of nullLookClasses()) expect(text).toHaveClass(cls)
}

/** The null row (`nullId`) is styled like a row holding a value (`valuedId`): no opacity, same name style. */
function expectNotDimmed(nullId: string, valuedId: string) {
  const row = screen.getByTestId(`variable-row-${nullId}`)
  const value = screen.getByTestId(`variable-value-${nullId}`)
  expect(value.textContent).toBe('null')
  for (const element of [row, value, within(value).getByText('null')]) {
    expect(element.className).not.toMatch(/(^|\s)opacity-/)
  }
  expect(row.className).toBe(screen.getByTestId(`variable-row-${valuedId}`).className)
  expect(screen.getByTestId(`variable-name-${nullId}`).className).toBe(
    screen.getByTestId(`variable-name-${valuedId}`).className,
  )
}

function createVariable(overrides: Partial<Variable> = {}): Variable {
  return {
    id: 'var-1',
    name: 'my_var',
    value: 'hello',
    type: 'string',
    ...overrides,
  }
}

interface RowOverrides {
  variable?: Partial<Variable>
  runtimeValue?: unknown
  hasRuntimeValue?: boolean
  viewMode?: 'runtime' | 'definition'
  isExpressionExecutionLocked?: boolean
  readOnly?: boolean
  currentOnly?: boolean
  runtimeAvailable?: boolean
  isOutputBound?: boolean
  isWorkflowReferenced?: boolean
  isExpressionReferenced?: boolean
  recentlyChanged?: boolean
  isMirroring?: boolean
  isInspected?: boolean
  secretUnlocked?: boolean
  revealSecret?: boolean
  revealInspection?: boolean
  kind?: 'input' | 'output' | 'local'
  onToggleViewMode?: () => void
  onExpand?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onKeyDown?: (e: React.KeyboardEvent) => void
}

function renderRow(overrides: RowOverrides = {}) {
  const variable = createVariable(overrides.variable)
  const props = {
    variable,
    runtimeValue: overrides.runtimeValue,
    hasRuntimeValue: overrides.hasRuntimeValue ?? false,
    viewMode: overrides.viewMode ?? ('runtime' as const),
    onToggleViewMode: overrides.onToggleViewMode ?? vi.fn(),
    isExpressionExecutionLocked: overrides.isExpressionExecutionLocked ?? false,
    readOnly: overrides.readOnly ?? false,
    currentOnly: overrides.currentOnly,
    runtimeAvailable: overrides.runtimeAvailable,
    isOutputBound: overrides.isOutputBound,
    isWorkflowReferenced: overrides.isWorkflowReferenced,
    isExpressionReferenced: overrides.isExpressionReferenced,
    recentlyChanged: overrides.recentlyChanged,
    isMirroring: overrides.isMirroring,
    isInspected: overrides.isInspected,
    secretUnlocked: overrides.secretUnlocked,
    revealSecret: overrides.revealSecret,
    revealInspection: overrides.revealInspection,
    kind: overrides.kind,
    onExpand: overrides.onExpand,
    onEdit: overrides.onEdit,
    onDelete: overrides.onDelete,
    onKeyDown: overrides.onKeyDown,
  }
  return render(<InlineVariableRow {...props} />)
}

// ===========================================================================
// Layout
// ===========================================================================

describe('InlineVariableRow - idle expression display', () => {
  it('shows the expression text (not the placeholder) when runtimeAvailable is false', () => {
    renderRow({
      variable: { id: 'v1', name: 'derived', value: 'x + 1', type: 'integer', isExpression: true },
      hasRuntimeValue: false,
      viewMode: 'runtime',
      runtimeAvailable: false,
    })
    const value = screen.getByTestId('variable-value-v1')
    expect(value.textContent).toContain('x + 1')
    expect(value.textContent).not.toContain('<not evaluated yet>')
  })
})

describe('InlineVariableRow - recently changed highlight', () => {
  it('applies the highlight class when recentlyChanged is true', () => {
    renderRow({ variable: { id: 'v1' }, recentlyChanged: true })
    const row = screen.getByTestId('variable-row-v1')
    expect(row.className).toMatch(/variable-highlight/)
  })

  it('omits the highlight class when recentlyChanged is false', () => {
    renderRow({ variable: { id: 'v1' }, recentlyChanged: false })
    const row = screen.getByTestId('variable-row-v1')
    expect(row.className).not.toMatch(/variable-highlight/)
  })
})

describe('InlineVariableRow - mirror change cue', () => {
  it('shows NO bar for an unmodified row while mirroring (no all-rows bar)', () => {
    renderRow({ variable: { id: 'v1' }, isMirroring: true, recentlyChanged: false })
    const row = screen.getByTestId('variable-row-v1')
    expect(row.className).not.toMatch(/violet/)
    expect(row.className).not.toMatch(/animate-variable-mirror-pulse/)
  })

  it('shows a temporary violet bar + pulse for a modified row while mirroring', () => {
    renderRow({ variable: { id: 'v1' }, isMirroring: true, recentlyChanged: true })
    const row = screen.getByTestId('variable-row-v1')
    expect(row.className).toMatch(/violet/)
    expect(row.className).toMatch(/animate-variable-mirror-pulse/)
  })

  it('omits the violet cue when not mirroring', () => {
    renderRow({ variable: { id: 'v1' }, isMirroring: false, recentlyChanged: true })
    const row = screen.getByTestId('variable-row-v1')
    expect(row.className).not.toMatch(/violet/)
  })

  it('keeps the yellow highlight for a modified row when not mirroring', () => {
    renderRow({ variable: { id: 'v1' }, isMirroring: false, recentlyChanged: true })
    const row = screen.getByTestId('variable-row-v1')
    expect(row.className).toMatch(/variable-highlight/)
  })

  it('shows the inspected (watcher) indigo bar even while mirroring', () => {
    renderRow({ variable: { id: 'v1' }, isMirroring: true, isInspected: true, onExpand: vi.fn() })
    const row = screen.getByTestId('variable-row-v1')
    expect(row.className).toMatch(/indigo/)
  })

  it('lets the temporary violet cue own the edge over the watcher bar while modified', () => {
    renderRow({
      variable: { id: 'v1' },
      isMirroring: true,
      isInspected: true,
      recentlyChanged: true,
      onExpand: vi.fn(),
    })
    const row = screen.getByTestId('variable-row-v1')
    expect(row.className).toMatch(/violet/)
    expect(row.className).not.toMatch(/indigo/)
  })
})

describe('InlineVariableRow - value truncation', () => {
  it('truncates a long value to MAX_VALUE_LENGTH with an ellipsis', () => {
    // 200 characters - well over the 100-char default cap
    const longValue = 'x'.repeat(200)
    renderRow({
      variable: { id: 'v1', name: 'long', value: longValue, type: 'string' },
    })
    const value = screen.getByTestId('variable-value-v1')
    expect(value.textContent).toContain('…')
    // Capped to MAX_VALUE_LENGTH plus the wrapping quotes and the ellipsis.
    expect(value.textContent!.length).toBeLessThan(longValue.length)
  })
})

describe('InlineVariableRow - layout', () => {
  it('renders the variable row with the parameterized testid', () => {
    renderRow({ variable: { id: 'abc-123' } })
    expect(screen.getByTestId('variable-row-abc-123')).toBeInTheDocument()
  })

  it('pins the row height to the shared inline row height', () => {
    renderRow({ variable: { id: 'v1' } })
    expect(screen.getByTestId('variable-row-v1').style.height).toBe(`${INLINE_VARIABLE_ROW_HEIGHT}px`)
  })

  it('renders the variable name in the top row', () => {
    renderRow({ variable: { name: 'api_url' } })
    expect(screen.getByText('api_url')).toBeInTheDocument()
  })

  it('renders all four action icons in the action cluster: eye, expand, edit, delete', () => {
    renderRow({
      variable: { id: 'v1', name: 'foo' },
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onExpand: vi.fn(),
    })

    const eye = screen.getByTestId('view-toggle-button-v1')
    const expand = screen.getByTestId('expand-button-v1')
    const edit = screen.getByTestId('edit-button-v1')
    const del = screen.getByTestId('delete-button-v1')

    expect(eye).toBeInTheDocument()
    expect(expand).toBeInTheDocument()
    expect(edit).toBeInTheDocument()
    expect(del).toBeInTheDocument()

    // The four icons must appear in this order: eye, expand, edit, delete.
    const positions = [eye, expand, edit, del].map(
      (el) => Number(el.compareDocumentPosition(eye)) | 0,
    )
    // Easier check: walk the DOM order via Array indexOf inside the row.
    const row = screen.getByTestId('variable-row-v1')
    const buttons: HTMLElement[] = Array.from(row.querySelectorAll('button'))
    const eyeIndex = buttons.indexOf(eye as HTMLElement)
    const expandIndex = buttons.indexOf(expand as HTMLElement)
    const editIndex = buttons.indexOf(edit as HTMLElement)
    const deleteIndex = buttons.indexOf(del as HTMLElement)

    expect(eyeIndex).toBeGreaterThanOrEqual(0)
    expect(eyeIndex).toBeLessThan(expandIndex)
    expect(expandIndex).toBeLessThan(editIndex)
    expect(editIndex).toBeLessThan(deleteIndex)

    // Suppress unused-var eslint by referencing positions.
    void positions
  })

  it('places the type badge as the rightmost element in the bottom row', () => {
    renderRow({
      variable: { id: 'v1', name: 'foo', type: 'integer' },
      isOutputBound: true,
      isWorkflowReferenced: true,
    })

    const typeBadge = screen.getByTestId('type-badge-v1')
    const outBadge = screen.getByTestId('out-badge-v1')

    // Type badge must come after the OUT badge in document order.
    const position = outBadge.compareDocumentPosition(typeBadge)
    // Node.DOCUMENT_POSITION_FOLLOWING === 0x04
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// ===========================================================================
// Eye toggle (runtime vs definition view)
// ===========================================================================

describe('InlineVariableRow - secret reveal', () => {
  it('masks a secret value by default (test-variables off)', () => {
    renderRow({
      variable: { id: 'v1', isSecret: true },
      runtimeValue: 'plaintext',
      hasRuntimeValue: true,
    })
    expect(screen.getByTestId('variable-value-v1')).toHaveTextContent('********')
  })

  it('reveals the runtime value when revealSecret is on', () => {
    renderRow({
      variable: { id: 'v1', isSecret: true },
      runtimeValue: 'plaintext-token',
      hasRuntimeValue: true,
      revealSecret: true,
    })
    const value = screen.getByTestId('variable-value-v1')
    expect(value).toHaveTextContent('plaintext-token')
    expect(value).not.toHaveTextContent('********')
  })

  it('shows a secret holding nothing as empty, never masked', () => {
    renderRow({ variable: { id: 'v1', isSecret: true, value: '' } })
    expect(screen.getByTestId('variable-value-v1').textContent).toBe('')
  })

  it('shows an empty runtime value of a secret as empty, never masked', () => {
    renderRow({
      variable: { id: 'v1', isSecret: true, value: '********' },
      runtimeValue: '',
      hasRuntimeValue: true,
    })
    expect(screen.getByTestId('variable-value-v1').textContent).toBe('')
  })

  it.each([
    ['whitespace', '   '],
    ['a sealed envelope', 'wave:enc:v1:abc'],
    ['the mask', '********'],
  ])('masks a secret holding %s', (_label, value) => {
    renderRow({ variable: { id: 'v1', isSecret: true, value } })
    expect(screen.getByTestId('variable-value-v1').textContent).toBe('********')
  })

  it('falls back to the definition value when revealed with no runtime value', () => {
    renderRow({
      variable: { id: 'v1', isSecret: true, value: 'def-val' },
      hasRuntimeValue: false,
      revealSecret: true,
    })
    expect(screen.getByTestId('variable-value-v1')).toHaveTextContent('def-val')
  })

  it('keeps a saved secret un-inspectable when test-variables is off', () => {
    renderRow({ variable: { id: 'v1', isSecret: true }, runtimeAvailable: true })
    expect(screen.getByTestId('expand-button-v1')).toHaveAttribute('aria-disabled', 'true')
  })

  it('makes a secret inspectable when test-variables is on', () => {
    renderRow({
      variable: { id: 'v1', isSecret: true },
      revealInspection: true,
      runtimeAvailable: true,
    })
    expect(screen.getByTestId('expand-button-v1')).not.toHaveAttribute('aria-disabled', 'true')
  })
})

describe('InlineVariableRow - eye toggle', () => {
  it('renders the eye-on icon (runtime view) by default', () => {
    renderRow({ variable: { id: 'v1' }, viewMode: 'runtime' })
    const btn = screen.getByTestId('view-toggle-button-v1')
    // eye-on icon is the lucide Eye glyph
    expect(btn.querySelector('.lucide-eye')).toBeInTheDocument()
  })

  it('renders the eye-off icon (definition view) when viewMode is definition', () => {
    renderRow({ variable: { id: 'v1' }, viewMode: 'definition' })
    const btn = screen.getByTestId('view-toggle-button-v1')
    expect(btn.querySelector('.lucide-eye-off')).toBeInTheDocument()
  })

  it('fires onToggleViewMode when the eye is clicked', async () => {
    const user = userEvent.setup()
    const onToggleViewMode = vi.fn()
    renderRow({ variable: { id: 'v1' }, viewMode: 'runtime', onToggleViewMode })

    await user.click(screen.getByTestId('view-toggle-button-v1'))

    expect(onToggleViewMode).toHaveBeenCalledTimes(1)
  })

  it('shows runtime value when viewMode is runtime and a runtime value exists', () => {
    renderRow({
      variable: { id: 'v1', value: 'definition value', type: 'string' },
      runtimeValue: 'runtime value',
      hasRuntimeValue: true,
      viewMode: 'runtime',
    })
    const value = screen.getByTestId('variable-value-v1')
    expect(value.textContent).toContain('runtime value')
    expect(value.textContent).not.toContain('definition value')
  })

  it('shows definition value when viewMode is definition', () => {
    renderRow({
      variable: { id: 'v1', value: 'definition value', type: 'string' },
      runtimeValue: 'runtime value',
      hasRuntimeValue: true,
      viewMode: 'definition',
    })
    const value = screen.getByTestId('variable-value-v1')
    expect(value.textContent).toContain('definition value')
  })

  it('applies italic + dim classes when viewMode is definition (eye-off styling)', () => {
    renderRow({
      variable: { id: 'v1', value: 'definition value', type: 'string' },
      viewMode: 'definition',
    })
    const value = screen.getByTestId('variable-value-v1')
    expect(value.className).toMatch(/italic/)
    expect(value.className).toMatch(/text-muted-foreground|opacity-/)
  })
})

// ===========================================================================
// Expression rows
// ===========================================================================

describe('InlineVariableRow - expression rows', () => {
  it('renders the expression text as the value when viewMode is definition', () => {
    renderRow({
      variable: {
        id: 'v1',
        name: 'derived',
        value: 'x + 1',
        type: 'integer',
        isExpression: true,
      },
      viewMode: 'definition',
    })
    const value = screen.getByTestId('variable-value-v1')
    expect(value.textContent).toContain('x + 1')
  })

  it('renders the evaluated runtime value when viewMode is runtime and hasRuntimeValue is true', () => {
    renderRow({
      variable: {
        id: 'v1',
        name: 'derived',
        value: 'x + 1',
        type: 'integer',
        isExpression: true,
      },
      runtimeValue: 42,
      hasRuntimeValue: true,
      viewMode: 'runtime',
    })
    const value = screen.getByTestId('variable-value-v1')
    expect(value.textContent).toContain('42')
    expect(value.textContent).not.toContain('x + 1')
  })

  it('renders "<not evaluated yet>" when expression has no runtime value and view is runtime', () => {
    renderRow({
      variable: {
        id: 'v1',
        name: 'derived',
        value: 'x + 1',
        type: 'integer',
        isExpression: true,
      },
      hasRuntimeValue: false,
      viewMode: 'runtime',
    })
    const value = screen.getByTestId('variable-value-v1')
    expect(value.textContent).toContain('<not evaluated yet>')
  })

  it('keeps the eye button enabled for unevaluated expressions', () => {
    renderRow({
      variable: { id: 'v1', value: 'x + 1', type: 'integer', isExpression: true },
      hasRuntimeValue: false,
      viewMode: 'runtime',
    })
    const eye = screen.getByTestId('view-toggle-button-v1')
    expect(eye).not.toHaveAttribute('aria-disabled', 'true')
    expect(eye).not.toBeDisabled()
  })

  it('renders the expression value in cyan (overriding the type color)', () => {
    renderRow({
      variable: {
        id: 'v1',
        value: 'x + 1',
        type: 'integer',
        isExpression: true,
      },
      viewMode: 'definition',
    })
    const value = screen.getByTestId('variable-value-v1')
    expect(value.className).toMatch(/text-cyan/)
  })

  it('renders the {x} flag badge for expression rows, sitting before the type badge', () => {
    renderRow({
      variable: {
        id: 'v1',
        value: 'x + 1',
        type: 'integer',
        isExpression: true,
      },
    })
    const expr = screen.getByTestId('expr-badge-v1')
    expect(expr).toHaveTextContent('{x}')

    // expr badge appears before type badge in document order.
    const type = screen.getByTestId('type-badge-v1')
    const position = expr.compareDocumentPosition(type)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// ===========================================================================
// Secret rows
// ===========================================================================

describe('InlineVariableRow - secret rows', () => {
  it('renders the secret value as ******** in slate', () => {
    renderRow({
      variable: {
        id: 'v1',
        value: 'super-secret',
        type: 'string',
        isSecret: true,
      },
    })
    const value = screen.getByTestId('variable-value-v1')
    expect(value.textContent).toContain('********')
    expect(value.textContent).not.toContain('super-secret')
    expect(value.className).toMatch(/text-slate|text-muted/)
  })

  it('renders the SECRET flag badge before the type badge', () => {
    renderRow({
      variable: {
        id: 'v1',
        value: 'sssh',
        type: 'string',
        isSecret: true,
      },
    })
    const secret = screen.getByTestId('secret-badge-v1')
    expect(secret).toHaveTextContent(/secret/i)

    const type = screen.getByTestId('type-badge-v1')
    const position = secret.compareDocumentPosition(type)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('disables the eye button on secret rows (aria-disabled)', () => {
    renderRow({
      variable: { id: 'v1', value: 'sssh', type: 'string', isSecret: true },
    })
    const eye = screen.getByTestId('view-toggle-button-v1')
    expect(eye).toHaveAttribute('aria-disabled', 'true')
  })

  it('applies opacity-50 + cursor-not-allowed to the disabled secret eye (visual disabled policy)', () => {
    renderRow({
      variable: { id: 'v1', value: 'sssh', type: 'string', isSecret: true },
    })
    const eye = screen.getByTestId('view-toggle-button-v1')
    expect(eye.className).toMatch(/opacity-50/)
    expect(eye.className).toMatch(/cursor-not-allowed/)
  })

  it('does NOT call onToggleViewMode when the disabled secret eye is clicked', async () => {
    const user = userEvent.setup()
    const onToggleViewMode = vi.fn()
    renderRow({
      variable: { id: 'v1', value: 'sssh', type: 'string', isSecret: true },
      onToggleViewMode,
    })
    await user.click(screen.getByTestId('view-toggle-button-v1'))
    expect(onToggleViewMode).not.toHaveBeenCalled()
  })

  it('exposes a tooltip explaining secrets are always masked', () => {
    renderRow({
      variable: { id: 'v1', value: 'sssh', type: 'string', isSecret: true },
    })
    const eye = screen.getByTestId('view-toggle-button-v1')
    const labeled =
      eye.getAttribute('aria-label') ??
      eye.getAttribute('title') ??
      eye.parentElement?.getAttribute('aria-label') ??
      eye.parentElement?.getAttribute('title') ??
      ''
    expect(labeled.toLowerCase()).toMatch(/secret|masked|hidden/)
  })
})

// ===========================================================================
// Type-colored value text (per the new wireframe palette)
// ===========================================================================

describe('InlineVariableRow - value color by type', () => {
  it.each([
    ['string', /text-sky/],
    ['integer', /text-violet/],
    ['float', /text-pink/],
    ['boolean', /text-orange/],
    ['array', /text-amber/],
    ['map', /text-emerald/],
    ['table', /text-blue/],
  ] as const)('uses the spec color for %s', (type, colorPattern) => {
    renderRow({
      variable: {
        id: 'v1',
        value: type === 'boolean' ? true : 'val',
        type,
      },
    })
    const value = screen.getByTestId('variable-value-v1')
    expect(value.className).toMatch(colorPattern)
  })
})

// ===========================================================================
// Flag badges (OUT, {x}, SECRET, Unused) - color, ordering, mounting
// ===========================================================================

describe('InlineVariableRow - flag badges', () => {
  it('renders the OUT badge in indigo when isOutputBound is true', () => {
    renderRow({
      variable: { id: 'v1' },
      isOutputBound: true,
      isWorkflowReferenced: true,
    })
    const out = screen.getByTestId('out-badge-v1')
    expect(out).toHaveTextContent(/out/i)
    expect(out.className).toMatch(/indigo/)
  })

  it('renders the {x} badge in cyan for expression variables', () => {
    renderRow({
      variable: { id: 'v1', isExpression: true, value: 'x + 1' },
      isWorkflowReferenced: true,
    })
    const expr = screen.getByTestId('expr-badge-v1')
    expect(expr).toHaveTextContent('{x}')
    expect(expr.className).toMatch(/cyan/)
  })

  it('renders the {{ }} badge in cyan for template variables', () => {
    renderRow({
      variable: { id: 'v1', isTemplate: true, value: 'Hi {{name}}' },
      isWorkflowReferenced: true,
    })
    const tmpl = screen.getByTestId('template-badge-v1')
    expect(tmpl).toHaveTextContent('{{ }}')
    expect(tmpl.className).toMatch(/cyan/)
    expect(screen.queryByTestId('expr-badge-v1')).not.toBeInTheDocument()
  })

  it('renders the SECRET badge in red for secret variables', () => {
    renderRow({
      variable: { id: 'v1', isSecret: true },
      isWorkflowReferenced: true,
    })
    const secret = screen.getByTestId('secret-badge-v1')
    expect(secret.className).toMatch(/red/)
  })

  it('renders the Unused badge in amber when neither workflow nor expression refs exist', () => {
    renderRow({ variable: { id: 'v1' }, isWorkflowReferenced: false, isExpressionReferenced: false })
    const unused = screen.getByTestId('unused-badge-v1')
    expect(unused).toHaveTextContent(/unused/i)
    expect(unused).toHaveClass('bg-amber-500/15', 'text-amber-600', 'dark:text-amber-400')
    expect(unused.className).not.toMatch(/slate|muted/)
  })

  it('hides the Unused badge when isWorkflowReferenced is true', () => {
    renderRow({ variable: { id: 'v1' }, isWorkflowReferenced: true })
    expect(screen.queryByTestId('unused-badge-v1')).not.toBeInTheDocument()
  })

  it('hides the Unused badge when isExpressionReferenced is true', () => {
    renderRow({ variable: { id: 'v1' }, isExpressionReferenced: true })
    expect(screen.queryByTestId('unused-badge-v1')).not.toBeInTheDocument()
  })

  it('exposes the spec tooltip copy for the Unused badge', () => {
    renderRow({ variable: { id: 'v1' }, isWorkflowReferenced: false, isExpressionReferenced: false })

    // The hint moved from the browser title popup onto the shared tooltip.
    fireEvent.focus(screen.getByTestId('unused-badge-v1'))

    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
      'Not referenced by any block or other variable.',
    )
  })

  it('says a bound variable is bound to a block output on the OUT badge tooltip', () => {
    renderRow({ variable: { id: 'v1' }, isOutputBound: true, isWorkflowReferenced: true })

    fireEvent.focus(screen.getByTestId('out-badge-v1'))

    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
      'Bound to block output',
    )
  })

  it('orders flag badges Unused first, then OUT, {x}, SECRET, with the type badge rightmost', () => {
    renderRow({
      variable: { id: 'v1', isExpression: true, isSecret: true, value: 'x' },
      isOutputBound: true,
      isWorkflowReferenced: false,
      isExpressionReferenced: false,
    })

    const unused = screen.getByTestId('unused-badge-v1')
    const out = screen.getByTestId('out-badge-v1')
    const expr = screen.getByTestId('expr-badge-v1')
    const secret = screen.getByTestId('secret-badge-v1')
    const type = screen.getByTestId('type-badge-v1')

    const order = [unused, out, expr, secret, type]
    for (let i = 0; i < order.length - 1; i++) {
      const position = order[i].compareDocumentPosition(order[i + 1])
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })
})

// ===========================================================================
// Expand icon (opens the per-variable inspect modal, VMGR-11)
// ===========================================================================

describe('InlineVariableRow - expand icon (scalar rows)', () => {
  it('renders the expand button enabled on scalar rows', () => {
    renderRow({ variable: { id: 'v1' }, onExpand: vi.fn() })
    const expand = screen.getByTestId('expand-button-v1')
    expect(expand).toBeInTheDocument()
    expect(expand).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('calls onExpand when clicked on a scalar row', async () => {
    const user = userEvent.setup()
    const onExpand = vi.fn()
    renderRow({ variable: { id: 'v1' }, onExpand })
    await user.click(screen.getByTestId('expand-button-v1'))
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it.each(['string', 'integer', 'float', 'boolean'] as const)(
    'keeps the expand button enabled for %s rows',
    (type) => {
      renderRow({
        variable: { id: 'v1', type, value: type === 'boolean' ? true : '1' },
        onExpand: vi.fn(),
      })
      expect(screen.getByTestId('expand-button-v1')).not.toHaveAttribute(
        'aria-disabled',
        'true',
      )
    },
  )

  it('keeps the expand button enabled for expression rows', async () => {
    const user = userEvent.setup()
    const onExpand = vi.fn()
    renderRow({
      variable: { id: 'v1', value: 'x + 1', type: 'integer', isExpression: true },
      onExpand,
    })
    const expand = screen.getByTestId('expand-button-v1')
    expect(expand).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(expand)
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it('labels the enabled expand button "Inspect <name>"', () => {
    renderRow({ variable: { id: 'v1', name: 'greeting' }, onExpand: vi.fn() })
    expect(screen.getByTestId('expand-button-v1')).toHaveAttribute(
      'aria-label',
      'Inspect greeting',
    )
  })

  it('shows the "Inspect <name>" tooltip on hover', async () => {
    const user = userEvent.setup()
    renderRow({ variable: { id: 'v1', name: 'greeting' }, onExpand: vi.fn() })
    await user.hover(screen.getByTestId('expand-button-v1'))
    await waitFor(() => {
      expect(
        screen.getByRole('tooltip', { name: 'Inspect greeting' }),
      ).toBeInTheDocument()
    })
  })
})

describe('InlineVariableRow - Inspect icon is a magnifying glass (FIELD-11)', () => {
  it.each([
    ['a string row', 'string', 'hello', false],
    ['an array row', 'array', [1, 2], false],
    ['a map row', 'map', { a: 1 }, false],
    ['a table row', 'table', [{ id: 1 }], false],
    ['a secret row', 'string', 'sssh', true],
  ] as const)('draws the magnifying glass on %s', (_case, type, value, isSecret) => {
    renderRow({ variable: { id: 'v1', type, value, isSecret }, onExpand: vi.fn() })
    const inspect = screen.getByTestId('expand-button-v1')
    expect(inspect.querySelector('.lucide-search')).toBeInTheDocument()
    expect(inspect.querySelector('.lucide-maximize-2')).not.toBeInTheDocument()
  })
})

describe('InlineVariableRow - expand icon (complex rows enabled)', () => {
  it.each([
    ['array', [1, 2]],
    ['map', { a: 1 }],
    ['table', [{ id: 1 }]],
  ] as const)(
    'renders the expand button enabled for %s rows',
    (type, value) => {
      renderRow({ variable: { id: 'v1', type, value }, onExpand: vi.fn() })
      const expand = screen.getByTestId('expand-button-v1')
      expect(expand).not.toHaveAttribute('aria-disabled', 'true')
      expect(expand.className).not.toMatch(/opacity-50/)
      expect(expand.className).not.toMatch(/cursor-not-allowed/)
    },
  )

  it('calls onExpand for complex rows', async () => {
    const user = userEvent.setup()
    const onExpand = vi.fn()
    renderRow({ variable: { id: 'v1', type: 'array', value: [1] }, onExpand })
    await user.click(screen.getByTestId('expand-button-v1'))
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it('labels the enabled complex expand "Inspect <name>"', () => {
    renderRow({
      variable: { id: 'v1', name: 'headers', type: 'map', value: {} },
      onExpand: vi.fn(),
    })
    expect(screen.getByTestId('expand-button-v1')).toHaveAttribute(
      'aria-label',
      'Inspect headers',
    )
  })

  it('shows the "Inspect <name>" tooltip on hover for complex rows', async () => {
    const user = userEvent.setup()
    renderRow({
      variable: { id: 'v1', name: 'headers', type: 'map', value: { a: 1 } },
      onExpand: vi.fn(),
    })
    await user.hover(screen.getByTestId('expand-button-v1'))
    await waitFor(() => {
      expect(
        screen.getByRole('tooltip', { name: 'Inspect headers' }),
      ).toBeInTheDocument()
    })
  })

  it('marks a complex row with the indigo indicator while inspected', () => {
    renderRow({
      variable: { id: 'v1', type: 'array', value: [1] },
      isInspected: true,
      onExpand: vi.fn(),
    })
    expect(screen.getByTestId('variable-row-v1').className).toMatch(/indigo/)
  })
})

describe('InlineVariableRow - expand icon (secret rows stay blocked)', () => {
  it('renders the expand button as visually disabled on secret rows', () => {
    renderRow({
      variable: { id: 'v1', value: 'sssh', isSecret: true },
    })
    const expand = screen.getByTestId('expand-button-v1')
    expect(expand).toHaveAttribute('aria-disabled', 'true')
    expect(expand.className).toMatch(/opacity-50/)
    expect(expand.className).toMatch(/cursor-not-allowed/)
  })

  it('does not call onExpand on secret rows', async () => {
    const user = userEvent.setup()
    const onExpand = vi.fn()
    renderRow({
      variable: { id: 'v1', value: 'sssh', isSecret: true },
      onExpand,
    })
    await user.click(screen.getByTestId('expand-button-v1'))
    expect(onExpand).not.toHaveBeenCalled()
  })

  it('shows the exact secret tooltip on hover', async () => {
    const user = userEvent.setup()
    renderRow({
      variable: { id: 'v1', value: 'sssh', isSecret: true },
      onExpand: vi.fn(),
    })
    await user.hover(screen.getByTestId('expand-button-v1'))
    await waitFor(() => {
      expect(
        screen.getByRole('tooltip', { name: 'Secret values cannot be expanded' }),
      ).toBeInTheDocument()
    })
  })

  it('labels the secret expand "Secret value for <name> cannot be inspected"', () => {
    renderRow({
      variable: { id: 'v1', name: 'apiKey', value: 'sssh', isSecret: true },
    })
    expect(screen.getByTestId('expand-button-v1')).toHaveAttribute(
      'aria-label',
      'Secret value for apiKey cannot be inspected',
    )
  })

  it.each([
    ['null', null],
    ['empty text', ''],
  ])('opens a secret whose definition holds %s, so its Current value can be set', async (_label, value) => {
    const user = userEvent.setup()
    const onExpand = vi.fn()
    renderRow({
      variable: { id: 'v1', name: 'apiKey', value, isSecret: true },
      onExpand,
    })
    const expand = screen.getByTestId('expand-button-v1')
    expect(expand).not.toHaveAttribute('aria-disabled')
    expect(expand).toHaveAttribute('aria-label', 'Inspect apiKey')
    await user.click(expand)
    expect(onExpand).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// Inspected-row indicator
// ===========================================================================

describe('InlineVariableRow - inspected-row indicator', () => {
  it('marks the row with the indigo indicator while its modal is open', () => {
    renderRow({ variable: { id: 'v1' }, isInspected: true, onExpand: vi.fn() })
    expect(screen.getByTestId('variable-row-v1').className).toMatch(/indigo/)
  })

  it('renders the expand icon indigo while inspected', () => {
    renderRow({ variable: { id: 'v1' }, isInspected: true, onExpand: vi.fn() })
    expect(screen.getByTestId('expand-button-v1').className).toMatch(/indigo/)
  })

  it('omits the indicator when the variable is not inspected', () => {
    renderRow({ variable: { id: 'v1' }, isInspected: false, onExpand: vi.fn() })
    expect(screen.getByTestId('variable-row-v1').className).not.toMatch(/indigo/)
    expect(screen.getByTestId('expand-button-v1').className).not.toMatch(/indigo/)
  })

  it('keeps the expand button enabled while inspected (re-click focuses)', async () => {
    const user = userEvent.setup()
    const onExpand = vi.fn()
    renderRow({ variable: { id: 'v1' }, isInspected: true, onExpand })
    const expand = screen.getByTestId('expand-button-v1')
    expect(expand).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(expand)
    expect(onExpand).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// Edit / Delete - lock states (executing + readOnly)
// ===========================================================================

describe('InlineVariableRow - edit and delete locking', () => {
  it('renders the edit pencil and calls onEdit when not locked', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    renderRow({ variable: { id: 'v1' }, onEdit })
    const edit = screen.getByTestId('edit-button-v1')
    expect(edit).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(edit)
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('disables the edit pencil when isExpressionExecutionLocked is true', () => {
    renderRow({
      variable: { id: 'v1' },
      onEdit: vi.fn(),
      isExpressionExecutionLocked: true,
    })
    const edit = screen.getByTestId('edit-button-v1')
    expect(edit).toHaveAttribute('aria-disabled', 'true')
    expect(edit.className).toMatch(/opacity-50/)
    expect(edit.className).toMatch(/cursor-not-allowed/)
  })

  it('does not call onEdit while isExpressionExecutionLocked', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    renderRow({
      variable: { id: 'v1' },
      onEdit,
      isExpressionExecutionLocked: true,
    })
    await user.click(screen.getByTestId('edit-button-v1'))
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('exposes the "Locked during execution" tooltip on the disabled edit button', () => {
    renderRow({
      variable: { id: 'v1' },
      onEdit: vi.fn(),
      isExpressionExecutionLocked: true,
    })
    const edit = screen.getByTestId('edit-button-v1')
    const labeled =
      edit.getAttribute('aria-label') ??
      edit.getAttribute('title') ??
      edit.parentElement?.getAttribute('aria-label') ??
      edit.parentElement?.getAttribute('title') ??
      ''
    expect(labeled.toLowerCase()).toMatch(/lock|execution/)
  })

  it('disables the edit pencil when readOnly is true', () => {
    renderRow({ variable: { id: 'v1' }, onEdit: vi.fn(), readOnly: true })
    const edit = screen.getByTestId('edit-button-v1')
    expect(edit).toHaveAttribute('aria-disabled', 'true')
  })

  it('renders the delete trash and calls onDelete when not locked', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderRow({ variable: { id: 'v1' }, onDelete })
    const del = screen.getByTestId('delete-button-v1')
    expect(del).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(del)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('disables the delete trash when isExpressionExecutionLocked is true', () => {
    renderRow({
      variable: { id: 'v1' },
      onDelete: vi.fn(),
      isExpressionExecutionLocked: true,
    })
    const del = screen.getByTestId('delete-button-v1')
    expect(del).toHaveAttribute('aria-disabled', 'true')
    expect(del.className).toMatch(/opacity-50/)
    expect(del.className).toMatch(/cursor-not-allowed/)
  })

  it('does not call onDelete while isExpressionExecutionLocked', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderRow({
      variable: { id: 'v1' },
      onDelete,
      isExpressionExecutionLocked: true,
    })
    await user.click(screen.getByTestId('delete-button-v1'))
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('disables the delete trash when readOnly is true', () => {
    renderRow({ variable: { id: 'v1' }, onDelete: vi.fn(), readOnly: true })
    const del = screen.getByTestId('delete-button-v1')
    expect(del).toHaveAttribute('aria-disabled', 'true')
  })
})

// The panel passes the run lock only while the run is actively running (VMGR-107).
describe('InlineVariableRow - pencil and delete tooltips per lock (VMGR-107)', () => {
  // Keyboard focus opens the tooltip at once, without the hover delay.
  async function tooltipOn(testId: string) {
    act(() => screen.getByTestId(testId).focus())
    return screen.findByRole('tooltip')
  }

  const handlers = { onEdit: vi.fn(), onDelete: vi.fn() }

  it.each([
    ['edit-button-v1', 'Edit variable'],
    ['delete-button-v1', 'Delete variable'],
  ])('enables %s with the tooltip "%s" when nothing locks it', async (testId, text) => {
    renderRow({ variable: { id: 'v1' }, ...handlers })

    expect(screen.getByTestId(testId)).not.toHaveAttribute('aria-disabled')
    expect(await tooltipOn(testId)).toHaveTextContent(new RegExp(`^${text}$`))
  })

  it.each(['edit-button-v1', 'delete-button-v1'])(
    'shows "Locked while the test is executing" on %s under the run lock',
    async (testId) => {
      renderRow({ variable: { id: 'v1' }, ...handlers, isExpressionExecutionLocked: true })

      expect(await tooltipOn(testId)).toHaveTextContent(/^Locked while the test is executing$/)
    },
  )

  it.each(['edit-button-v1', 'delete-button-v1'])(
    'shows "Read-only snapshot - editing is not available" on %s in a read-only snapshot',
    async (testId) => {
      renderRow({ variable: { id: 'v1' }, ...handlers, readOnly: true })

      expect(await tooltipOn(testId)).toHaveTextContent(/^Read-only snapshot - editing is not available$/)
    },
  )

  it('keeps the pencil of a read-only row whose Current value can be set, and locks its delete', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    renderRow({ variable: { id: 'v1', name: 'greeting' }, onEdit, onDelete: vi.fn(), readOnly: true, currentOnly: true })

    expect(screen.getByTestId('edit-button-v1')).not.toHaveAttribute('aria-disabled')
    expect(screen.getByTestId('edit-button-v1')).toHaveAttribute('aria-label', 'Edit greeting')
    expect(screen.getByTestId('delete-button-v1')).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByTestId('edit-button-v1'))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('names the locked actions in their accessible names', () => {
    renderRow({ variable: { id: 'v1', name: 'greeting' }, ...handlers, isExpressionExecutionLocked: true })

    expect(screen.getByTestId('edit-button-v1')).toHaveAttribute('aria-label', 'Locked: edit greeting')
    expect(screen.getByTestId('delete-button-v1')).toHaveAttribute('aria-label', 'Locked: delete greeting')
  })
})

// ===========================================================================
// Row body interactivity
// ===========================================================================

describe('InlineVariableRow - row body interactivity', () => {
  it('clicking the row body does not call onEdit (no-op per redesign)', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    const onExpand = vi.fn()
    renderRow({ variable: { id: 'v1', name: 'foo' }, onEdit, onExpand })

    const row = screen.getByTestId('variable-row-v1')
    // Click on the row name (away from any action button).
    const name = within(row).getByText('foo')
    await user.click(name)

    expect(onEdit).not.toHaveBeenCalled()
    expect(onExpand).not.toHaveBeenCalled()
  })

  it('row remains focusable for keyboard navigation', () => {
    renderRow({ variable: { id: 'v1' } })
    const row = screen.getByTestId('variable-row-v1')
    row.focus()
    expect(document.activeElement).toBe(row)
  })

  it('forwards ArrowDown to onKeyDown for cross-row focus navigation', async () => {
    const user = userEvent.setup()
    const onKeyDown = vi.fn()
    renderRow({ variable: { id: 'v1' }, onKeyDown })

    const row = screen.getByTestId('variable-row-v1')
    row.focus()
    await user.keyboard('{ArrowDown}')

    expect(onKeyDown).toHaveBeenCalled()
    const event = onKeyDown.mock.calls[0][0]
    expect(event.key).toBe('ArrowDown')
  })

  it('forwards ArrowUp to onKeyDown for cross-row focus navigation', async () => {
    const user = userEvent.setup()
    const onKeyDown = vi.fn()
    renderRow({ variable: { id: 'v1' }, onKeyDown })

    const row = screen.getByTestId('variable-row-v1')
    row.focus()
    await user.keyboard('{ArrowUp}')

    expect(onKeyDown).toHaveBeenCalled()
    const event = onKeyDown.mock.calls[0][0]
    expect(event.key).toBe('ArrowUp')
  })

  it('Enter key on the row body is a no-op (inspect opens via the expand button only)', async () => {
    const user = userEvent.setup()
    const onExpand = vi.fn()
    const onEdit = vi.fn()
    renderRow({ variable: { id: 'v1' }, onExpand, onEdit })

    const row = screen.getByTestId('variable-row-v1')
    row.focus()
    await user.keyboard('{Enter}')

    expect(onExpand).not.toHaveBeenCalled()
    expect(onEdit).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Accessibility labels
// ===========================================================================

describe('InlineVariableRow - accessibility labels', () => {
  it('action buttons expose aria-labels including the variable name', () => {
    renderRow({
      variable: { id: 'v1', name: 'apiKey' },
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onExpand: vi.fn(),
    })

    // Edit + delete both name the variable in their aria-label so screen
    // readers announce which row is being acted on.
    expect(
      screen.getAllByRole('button', { name: /apiKey/i, hidden: false }).length,
    ).toBeGreaterThan(0)
  })
})

// ===========================================================================
// Null values (VMGR-93, REQ-3.1.3.20)
// ===========================================================================

describe('InlineVariableRow - null values (VMGR-93)', () => {
  it('draws a declared variable that carries no value in the null look', () => {
    renderRow({ variable: { id: 'v1', name: 'k8s_session', type: 'string', value: undefined } })
    expectNullLook(screen.getByTestId('variable-value-v1'))
  })

  it('reads null, never the literal word undefined', () => {
    renderRow({ variable: { id: 'v1', name: 'k8s_session', type: 'string', value: undefined } })
    expect(screen.getByTestId('variable-value-v1').textContent).toBe('null')
  })

  it('draws a secret that holds nothing in the null look instead of the mask', () => {
    renderRow({
      variable: { id: 'v1', name: 'k8s_session', type: 'string', value: undefined, isSecret: true },
    })
    const value = screen.getByTestId('variable-value-v1')
    expectNullLook(value)
    expect(value.textContent).not.toContain('********')
  })

  it('does not dim the row of a variable that holds null', () => {
    renderRow({ variable: { id: 'v1', name: 'k8s_session', type: 'string', value: undefined } })
    renderRow({ variable: { id: 'v2', name: 'k8s_session', type: 'string', value: 'ready' } })
    expectNotDimmed('v1', 'v2')
  })

  it('still masks a saved secret that holds a value', () => {
    renderRow({ variable: { id: 'v1', name: 'token', type: 'string', value: 'sk-1', isSecret: true } })
    expect(screen.getByTestId('variable-value-v1').textContent).toContain('********')
  })

  it('shows the runtime value once a Block writes one', () => {
    renderRow({
      variable: { id: 'v1', name: 'k8s_session', type: 'string', value: undefined },
      hasRuntimeValue: true,
      runtimeValue: 'written-at-run-time',
      viewMode: 'runtime',
    })
    expect(screen.getByTestId('variable-value-v1').textContent).toContain('written-at-run-time')
  })

  it('leaves an unset secret inspectable - there is no stored value to protect', () => {
    renderRow({
      variable: { id: 'v1', name: 'k8s_session', type: 'string', value: undefined, isSecret: true },
      secretUnlocked: true,
      onExpand: vi.fn(),
    })
    expect(screen.getByLabelText('Inspect k8s_session')).not.toBeDisabled()
  })

  it('draws a source-less expression in the null look in the definition view', () => {
    renderRow({
      variable: { id: 'v1', name: 'derived', type: 'integer', value: undefined, isExpression: true },
      hasRuntimeValue: true,
      runtimeValue: 42,
      viewMode: 'definition',
    })
    const value = screen.getByTestId('variable-value-v1')
    expectNullLook(value)
    expect(value.textContent).not.toContain('undefined')
  })

  it('never draws a string holding the text "null" in the null look', () => {
    renderRow({
      variable: { id: 'v1', name: 'phase', type: 'string', value: 'null' },
      viewMode: 'runtime',
    })
    const value = screen.getByTestId('variable-value-v1')
    expect(value.textContent).toBe('null')
    expect(value).toHaveClass(getValueColorClass('string'))
    expect(hasNullLook(within(value).getByText('null'))).toBe(false)
  })
})

describe('InlineVariableRow - one null look for every type (VMGR-93)', () => {
  it.each(ALL_TYPES)('draws a null %s in the null look, not dimmed', (type) => {
    renderRow({ variable: { id: 'v1', name: 'same_name', type, value: null } })
    renderRow({ variable: { id: 'v2', name: 'same_name', type, value: SAMPLE_VALUES[type] } })
    expectNullLook(screen.getByTestId('variable-value-v1'))
    expectNotDimmed('v1', 'v2')
  })

  it.each(ALL_TYPES)('draws a %s with no value key in the same null look', (type) => {
    renderRow({ variable: { id: 'v1', name: `no_value_${type}`, type, value: undefined } })
    expectNullLook(screen.getByTestId('variable-value-v1'))
  })

  it.each(ALL_TYPES)('draws a null %s a run wrote in the null look', (type) => {
    renderRow({
      variable: { id: 'v1', name: `written_${type}`, type, value: SAMPLE_VALUES[type] },
      hasRuntimeValue: true,
      runtimeValue: null,
      viewMode: 'runtime',
    })
    expectNullLook(screen.getByTestId('variable-value-v1'))
  })

  it.each<[string, unknown, Partial<RowOverrides>]>([
    ['stored', null, {}],
    ['written by a run', 'sk-1', { hasRuntimeValue: true, runtimeValue: null }],
  ])('draws a null secret (%s) in the null look instead of the mask', (_label, stored, run) => {
    renderRow({
      variable: { id: 'v1', name: 'api_token', type: 'string', value: stored, isSecret: true },
      ...run,
    })
    const value = screen.getByTestId('variable-value-v1')
    expectNullLook(value)
    expect(value.textContent).not.toContain('********')
  })

  it('draws an expression whose run gave null in the null look', () => {
    renderRow({
      variable: { id: 'v1', name: 'derived', type: 'integer', value: 'x + 1', isExpression: true },
      hasRuntimeValue: true,
      runtimeValue: null,
      viewMode: 'runtime',
    })
    expectNullLook(screen.getByTestId('variable-value-v1'))
  })

  it.each<[string, Partial<Variable>]>([
    ['expression', { isExpression: true }],
    ['template', { isTemplate: true }],
  ])('draws a %s variable with no source in the null look', (_kind, flags) => {
    renderRow({
      variable: { id: 'v1', name: 'derived', type: 'string', value: undefined, ...flags },
      runtimeAvailable: false,
    })
    expectNullLook(screen.getByTestId('variable-value-v1'))
  })

  it.each<[Variable['type'], unknown, string]>([
    ['string', '', ''],
    ['integer', 0, '0'],
    ['float', 0, '0'],
    ['boolean', false, 'false'],
    ['array', [], '[0 items]'],
    ['map', {}, '{0 keys}'],
    ['table', [], '0\u00D70 table'],
  ])('keeps the empty %s look in its type color', (type, value, text) => {
    renderRow({ variable: { id: 'v1', name: `empty_${type}`, type, value } })
    const cell = screen.getByTestId('variable-value-v1')
    expect(cell.textContent).toBe(text)
    expect(cell).toHaveClass(getValueColorClass(type))
  })
})

describe('InlineVariableRow - IN / OUT badge colors', () => {
  it.each<['input' | 'output', string]>([
    ['input', 'in-badge'],
    ['output', 'out-badge'],
  ])('draws the %s badge in the role colors the variable window uses, readable in both themes', (kind, badge) => {
    renderRow({ variable: { id: 'v1', name: 'fn_param', type: 'string', value: 'x' }, kind })
    expect(screen.getByTestId(`${badge}-v1`)).toHaveClass(...ROLE_BADGE_CLASS[kind].split(' '))
  })
})

describe('InlineVariableRow - Function parameter rows holding null (VMGR-93)', () => {
  it.each<['input' | 'output', string, Variable['type'], string]>([
    ['input', 'in-badge', 'string', 'fn_in'],
    ['output', 'out-badge', 'integer', 'fn_out'],
  ])('draws an %s parameter with a null default in the null look, not dimmed', (kind, badge, type, name) => {
    renderRow({ variable: { id: 'v1', name, type, value: null }, kind })
    renderRow({ variable: { id: 'v2', name, type, value: SAMPLE_VALUES[type] }, kind })
    expect(screen.getByTestId(`${badge}-v1`)).toBeInTheDocument()
    expectNullLook(screen.getByTestId('variable-value-v1'))
    expectNotDimmed('v1', 'v2')
  })

  it('draws a Function local holding null in the null look', () => {
    renderRow({ variable: { id: 'v1', name: 'fn_local', type: 'string', value: null }, kind: 'local' })
    expectNullLook(screen.getByTestId('variable-value-v1'))
  })
})

describe('InlineVariableRow - live complex values', () => {
  const envelope = { count: 4, rows: 4, cols: 9, changed: true }

  it('shows the record count for a variable declared array', () => {
    renderRow({
      variable: { id: 'v1', name: 'events', type: 'array', value: undefined },
      hasRuntimeValue: true,
      runtimeValue: envelope,
      viewMode: 'runtime',
    })
    expect(screen.getByTestId('variable-value-v1')).toHaveTextContent('[4 items]')
  })

  it('shows the dimensions for a variable declared table', () => {
    renderRow({
      variable: { id: 'v1', name: 'grid', type: 'table', value: undefined },
      hasRuntimeValue: true,
      runtimeValue: envelope,
      viewMode: 'runtime',
    })
    expect(screen.getByTestId('variable-value-v1')).toHaveTextContent('4\u00D79 table')
  })
})

describe('InlineVariableRow - a table stored in its {columns, rows} form', () => {
  it('reads the stored rows and columns, not 0x0', () => {
    const value = {
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'name', type: 'string' },
        { name: 'active', type: 'boolean' },
      ],
      rows: [
        [1, null, true],
        [null, 'beta', null],
      ],
    }
    renderRow({ variable: { id: 'v1', name: 'grid', type: 'table', value } })
    expect(screen.getByTestId('variable-value-v1').textContent).toBe('2\u00D73 table')
  })
})

describe('InlineVariableRow - amber Unused badge on every row (VMGR-105)', () => {
  it.each<[string, RowOverrides['kind']]>([
    ['a test variable', undefined],
    ['a Function input', 'input'],
    ['a Function output', 'output'],
    ['a Function local', 'local'],
  ])('draws the Unused badge of %s in amber with its tooltip', (_row, kind) => {
    renderRow({ variable: { id: 'v1' }, kind, isWorkflowReferenced: false, isExpressionReferenced: false })
    const unused = screen.getByTestId('unused-badge-v1')

    expect(unused).toHaveTextContent(/^Unused$/)
    expect(unused).toHaveClass('bg-amber-500/15', 'text-amber-600', 'dark:text-amber-400')
    expect(unused.className).not.toMatch(/slate/)

    fireEvent.focus(unused)
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      /^Not referenced by any block or other variable\.$/,
    )
  })
})

describe('InlineVariableRow - secret and kind on Function parameter rows (SECUI-10, SECUI-11, VMGR-99)', () => {
  it.each<['input' | 'output']>([['input'], ['output']])(
    'shows the SECRET badge and masks the default on a secret %s parameter row',
    (kind) => {
      renderRow({
        variable: { id: 'v1', name: 'api_key', isSecret: true, value: 'canary-default' },
        kind,
        isWorkflowReferenced: true,
      })

      expect(screen.getByTestId('secret-badge-v1')).toHaveTextContent(/^SECRET$/)
      expect(screen.getByTestId('variable-value-v1')).toHaveTextContent(/^\*{8}$/)
      expect(screen.getByTestId('variable-row-v1')).not.toHaveTextContent('canary-default')
    },
  )

  it.each<[string, Partial<Variable>, string, string]>([
    ['Expression', { type: 'integer', isExpression: true, value: 'a + b' }, 'expr-badge-v1', '{x}'],
    ['Template', { type: 'string', isTemplate: true, value: 'Hi {{ who }}' }, 'template-badge-v1', '{{ }}'],
  ])('shows the %s kind badge on an output parameter row', (_kind, variable, badgeId, badgeText) => {
    renderRow({ variable: { id: 'v1', name: 'result', ...variable }, kind: 'output', isWorkflowReferenced: true })

    expect(screen.getByTestId('out-badge-v1')).toBeInTheDocument()
    expect(screen.getByTestId(badgeId).textContent).toBe(badgeText)
  })
})
