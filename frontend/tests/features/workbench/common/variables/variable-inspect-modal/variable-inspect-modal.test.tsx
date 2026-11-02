/**
 * Tests for VariableInspectModal, the view-only per-variable watcher (REQ-3.1.3.11, REQ-3.1.3.13, REQ-3.2.2.18).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The modal's full-value fetch hook calls the workbench API - mock the
// client (unit tests never call real APIs) and the CodeMirror stack the lazy
// CodeBody pulls in.
vi.mock('@/features/workbench/api/workbench', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/workbench/api/workbench')>()
  return {
    ...actual,
    workbenchApi: {
      ...actual.workbenchApi,
      getSessionVariables: vi.fn(),
    },
  }
})

vi.mock('@uiw/react-codemirror', () => ({
  default: (props: { value: string }) => (
    <div data-testid="codemirror-editor">{props.value}</div>
  ),
}))

vi.mock('@/lib/codemirror/json-data-editor', () => ({
  createJsonDataEditorExtensions: () => [],
}))

vi.mock('@/lib/codemirror/plain-text-editor', () => ({
  createPlainTextEditorExtensions: () => [],
}))

// The host folds the promoted format core + the host-composed template
// stack into the string watcher. Stub them so the format/template selection is
// observable without pulling the real CodeMirror language modules or tree-sitter.
vi.mock('@/lib/codemirror/format-editor', () => ({
  createFormatExtensions: () => [],
}))

vi.mock('@/features/workbench/lib/codemirror/template-editor', () => ({
  buildTemplateExtensions: () => [],
}))

vi.mock('@/features/workbench/hooks/use-template-validation', () => ({
  useTemplateValidation: () => ({ templateHighlighter: null, templateTooltip: null }),
}))

import { workbenchApi } from '@/features/workbench/api/workbench'
import { VariableInspectModal } from '@/features/workbench/common/variables/variable-inspect-modal/variable-inspect-modal'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'
import { getSheetSize } from '@/features/workbench/common/variables/variable-inspect-modal/sheet-sizes'
import type { Variable } from '@/features/workbench/common/variables/variable-manager-content/types'
import { NULL_LOOK_CLASS } from '@/lib/variable-format'

const mockGetSessionVariables = vi.mocked(
  (workbenchApi as unknown as {
    getSessionVariables: (
      sessionId: string,
      names?: string[],
    ) => Promise<Record<string, { value: unknown; type: string; elementTypes?: unknown }>>
  }).getSessionVariables,
)

// ===========================================================================
// Helpers
// ===========================================================================

function createVariable(overrides: Partial<Variable> = {}): Variable {
  return {
    id: 'v1',
    name: 'user_name',
    value: 'bob',
    type: 'string',
    ...overrides,
  }
}

interface ModalOverrides {
  variable?: Partial<Variable>
  runtimeValue?: unknown
  hasRuntimeValue?: boolean
  runtimeAvailable?: boolean
  cascadeIndex?: number
  sessionId?: string | null
  currentSource?: string
  onClose?: () => void
  secretUnlocked?: boolean
  secretChanged?: boolean
  secretSaveTarget?: 'test' | 'Function'
}

function modalProps(overrides: ModalOverrides = {}) {
  const variable = createVariable(overrides.variable)
  return {
    variable,
    runtimeValue: overrides.runtimeValue,
    hasRuntimeValue: overrides.hasRuntimeValue ?? false,
    runtimeAvailable: overrides.runtimeAvailable ?? false,
    cascadeIndex: overrides.cascadeIndex ?? 0,
    sessionId: overrides.sessionId,
    currentSource: overrides.currentSource,
    onClose: overrides.onClose ?? vi.fn(),
    secretUnlocked: overrides.secretUnlocked,
    secretChanged: overrides.secretChanged,
    secretSaveTarget: overrides.secretSaveTarget,
  }
}

function renderModal(overrides: ModalOverrides = {}) {
  const props = modalProps(overrides)
  return {
    variable: props.variable,
    ...render(<VariableInspectModal {...props} />),
  }
}

function getModal(id = 'v1'): HTMLElement {
  return screen.getByTestId(`variable-inspect-modal-${id}`)
}

function getBody(id = 'v1'): HTMLElement {
  return within(getModal(id)).getByTestId('scalar-body')
}

async function switchMode(
  user: ReturnType<typeof userEvent.setup>,
  mode: 'Initial' | 'Current' | 'Compare',
  id = 'v1',
) {
  await user.click(within(getModal(id)).getByTestId('mode-dropdown'))
  await user.click(await screen.findByRole('option', { name: mode }))
}

// ===========================================================================
// Shell anatomy
// ===========================================================================

describe('VariableInspectModal - shell anatomy', () => {
  it('renders a region labeled "Inspect variable <name>" with the per-id testid', () => {
    renderModal()
    expect(
      screen.getByRole('region', { name: 'Inspect variable user_name' }),
    ).toBeInTheDocument()
    expect(getModal()).toBeInTheDocument()
  })

  it('exposes the header drag handle derived from the modal testid', () => {
    renderModal()
    expect(
      screen.getByTestId('variable-inspect-modal-v1-drag-handle'),
    ).toBeInTheDocument()
  })

  it('renders the variable name in mono in the header', () => {
    renderModal()
    const name = within(getModal()).getByTestId('inspect-variable-name')
    expect(name).toHaveTextContent('user_name')
    expect(name.className).toMatch(/font-mono/)
  })

  it('makes the variable name the heading of the watcher', () => {
    renderModal()
    expect(within(getModal()).getByRole('heading', { level: 2, name: 'user_name' })).toBe(
      within(getModal()).getByTestId('inspect-variable-name'),
    )
  })

  it('renders the type badge in the panel badge palette', () => {
    renderModal()
    const badge = within(getModal()).getByTestId('inspect-type-badge')
    expect(badge).toHaveTextContent(/string/i)
    expect(badge.className).toMatch(/sky/)
  })

  it('uses the row badge palette for non-string types too', () => {
    renderModal({ variable: { type: 'integer', value: 1 } })
    const badge = within(getModal()).getByTestId('inspect-type-badge')
    expect(badge).toHaveTextContent(/integer/i)
    expect(badge.className).toMatch(/violet/)
  })

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderModal({ onClose })
    await user.click(
      screen.getByRole('button', { name: 'Close inspector for user_name' }),
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('opens at the configured single-mode string width', () => {
    renderModal()
    expect(getModal().style.width).toBe(
      `${getSheetSize('string', false, 'current').width}px`,
    )
  })

  it.each([
    ['integer', 42],
    ['float', 3.14],
    ['boolean', true],
  ] as const)('opens %s watchers at the compact configured width', (type, value) => {
    renderModal({ variable: { type, value } })
    expect(getModal().style.width).toBe(
      `${getSheetSize(type, false, 'current').width}px`,
    )
  })

  it('opens expression watchers at the configured expression width', () => {
    renderModal({
      variable: { type: 'integer', value: 'x + 1', isExpression: true },
    })
    expect(getModal().style.width).toBe(
      `${getSheetSize('integer', true, 'current').width}px`,
    )
  })

  it.each(['integer', 'float', 'boolean'] as const)(
    'renders %s watchers width-resizable (so a long name/value can be widened to fit)',
    (type) => {
      renderModal({ variable: { type, value: type === 'boolean' ? true : 1 } })
      expect(screen.getByTestId('dialog-resize-handle')).toBeInTheDocument()
      expect(screen.getByTestId('dialog-resize-corner')).toBeInTheDocument()
    },
  )

  it('keeps the resize affordance for resizable types (string)', () => {
    renderModal()
    expect(screen.getByTestId('dialog-resize-handle')).toBeInTheDocument()
    expect(screen.getByTestId('dialog-resize-corner')).toBeInTheDocument()
  })

  it('resizes a compact watcher to the Compare default when switching modes', async () => {
    const user = userEvent.setup()
    renderModal({ variable: { type: 'float', value: 3.14 } })
    expect(getModal().style.width).toBe(
      `${getSheetSize('float', false, 'current').width}px`,
    )
    await switchMode(user, 'Compare')
    expect(getModal().style.width).toBe(
      `${getSheetSize('float', false, 'compare').width}px`,
    )
    expect(getModal().style.height).toBe(
      `${getSheetSize('float', false, 'compare').height}px`,
    )
  })

  it('stacks the Compare layout for a compact scalar (int/float) instead of side-by-side', async () => {
    const user = userEvent.setup()
    renderModal({ variable: { type: 'integer', value: 123 } })
    await switchMode(user, 'Compare')
    expect(
      within(getModal()).getByTestId('compare-body').className,
    ).not.toMatch(/grid-cols-2/)
  })

  it('caps the watcher height at the viewport so the footer stays reachable', () => {
    // A huge multiline value must scroll inside the body,
    // never push the footer below the viewport (config-modal max-h pattern).
    renderModal({ variable: { value: 'line\n'.repeat(500) } })
    expect(getModal().className).toMatch(/max-h-screen/)
  })

  it('restores persisted geometry from localStorage (reload survival)', () => {
    // The geometry key is the variable NAME - ids regenerate on every load.
    localStorage.setItem(
      'draggable-sheet.geometry',
      JSON.stringify({
        'var-inspect-geom_var': { offset: { x: 10, y: 20 }, width: 500, height: 300 },
      }),
    )
    renderModal({ variable: { id: 'v-geom', name: 'geom_var' } })
    const modal = getModal('v-geom')
    expect(modal.style.width).toBe('500px')
    expect(modal.style.height).toBe('300px')
    expect(modal.style.transform).toBe(
      'translate(calc(-50% + 10px), calc(-50% + 20px))',
    )
  })

  it('unmounting removes the modal (variable deleted closes its inspector)', () => {
    const { unmount } = renderModal()
    expect(getModal()).toBeInTheDocument()
    unmount()
    expect(
      screen.queryByTestId('variable-inspect-modal-v1'),
    ).not.toBeInTheDocument()
  })
})

// ===========================================================================
// Cascade placement
// ===========================================================================

describe('VariableInspectModal - cascade placement', () => {
  it('offsets the sheet by 24px per cascade index', () => {
    renderModal({ cascadeIndex: 2 })
    expect(getModal().style.transform).toBe(
      'translate(calc(-50% + 48px), calc(-50% + 48px))',
    )
  })

  it('wraps the cascade offset every 8 modals', () => {
    renderModal({ cascadeIndex: 9 })
    expect(getModal().style.transform).toBe(
      'translate(calc(-50% + 24px), calc(-50% + 24px))',
    )
  })
})

// ===========================================================================
// Modes
// ===========================================================================

describe('VariableInspectModal - modes', () => {
  it('defaults to Current mode on open', () => {
    renderModal()
    expect(within(getModal()).getByTestId('mode-dropdown')).toHaveTextContent(
      'Current',
    )
  })

  it('keeps the mode control visible and usable while idle', async () => {
    const user = userEvent.setup()
    renderModal({ runtimeAvailable: false })
    await user.click(within(getModal()).getByTestId('mode-dropdown'))
    expect(
      await screen.findByRole('option', { name: 'Initial' }),
    ).toBeInTheDocument()
  })

  it('lists Initial, Current, and Compare in the mode menu', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(within(getModal()).getByTestId('mode-dropdown'))
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Initial',
      'Current',
      'Compare',
    ])
  })

  it('switches to Initial and updates the trigger label', async () => {
    const user = userEvent.setup()
    renderModal()
    await switchMode(user, 'Initial')
    expect(within(getModal()).getByTestId('mode-dropdown')).toHaveTextContent(
      'Initial',
    )
  })

  it('renders the Initial body dimmed (eye-OFF treatment)', async () => {
    const user = userEvent.setup()
    renderModal()
    await switchMode(user, 'Initial')
    // A string dims via opacity only - the editor renders italics broken.
    expect(getBody().className).toMatch(/opacity/)
  })

  it('idle Current renders the definition content with normal styling', async () => {
    const user = userEvent.setup()
    renderModal({ runtimeAvailable: false, hasRuntimeValue: false })

    const currentText = getBody().textContent
    expect(currentText).toContain('bob')
    expect(getBody().className).not.toMatch(/italic/)

    await switchMode(user, 'Initial')
    // Identical content, definition styling (dimmed via opacity for a string).
    expect(getBody().textContent).toBe(currentText)
    expect(getBody().className).toMatch(/opacity/)
  })
})

// ===========================================================================
// Body values (literal rows of the state table)
// ===========================================================================

describe('VariableInspectModal - literal body values', () => {
  it('renders the full untruncated value (no 100-char list truncation)', () => {
    const long = 'x'.repeat(150)
    renderModal({ variable: { value: long } })
    const body = getBody()
    expect(body.textContent).toContain(long)
    expect(body.textContent).not.toContain('…')
  })

  it('Current shows the runtime value when one exists', () => {
    renderModal({
      runtimeValue: 'live-value',
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    expect(getBody().textContent).toContain('live-value')
    expect(getBody().textContent).not.toContain('bob')
  })

  it('Current falls back to the definition when no runtime value exists', () => {
    renderModal({ hasRuntimeValue: false, runtimeAvailable: true })
    expect(getBody().textContent).toContain('bob')
  })

  it('Initial keeps showing the definition even when a runtime value exists', async () => {
    const user = userEvent.setup()
    renderModal({
      runtimeValue: 'live-value',
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    await switchMode(user, 'Initial')
    expect(getBody().textContent).toContain('bob')
    expect(getBody().textContent).not.toContain('live-value')
  })
})

// ===========================================================================
// Expression scalar states (badge and evaluated rendering)
// ===========================================================================

const EXPRESSION_SOURCE = "'https://api/' + service_name"

function expressionVariable(overrides: Partial<Variable> = {}): Partial<Variable> {
  return {
    id: 'v1',
    name: 'api_url',
    value: EXPRESSION_SOURCE,
    type: 'string',
    isExpression: true,
    ...overrides,
  }
}

describe('VariableInspectModal - expression scalar states', () => {
  it('renders the {x} flag badge in the header next to the type badge', () => {
    renderModal({ variable: expressionVariable() })
    const badge = within(getModal()).getByTestId('inspect-expr-badge')
    expect(badge).toHaveTextContent('{x}')
    expect(badge.className).toMatch(/cyan/)
  })

  it('omits the {x} badge for literal variables', () => {
    renderModal()
    expect(
      within(getModal()).queryByTestId('inspect-expr-badge'),
    ).not.toBeInTheDocument()
  })

  it('Initial shows the expression source in cyan, dim + italic, with no metric', async () => {
    const user = userEvent.setup()
    renderModal({ variable: expressionVariable() })
    await switchMode(user, 'Initial')

    const body = getBody()
    expect(body.textContent).toContain(EXPRESSION_SOURCE)
    expect(body.className).toMatch(/text-cyan/)
    expect(body.className).toMatch(/italic/)
    // A source (formula) is not a counted value - no metric.
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })

  // No runtime value = empty state.
  it('Current without a runtime value shows "Not evaluated yet." with no metric', () => {
    renderModal({
      variable: expressionVariable(),
      hasRuntimeValue: false,
      runtimeAvailable: true,
    })
    expect(
      within(getModal()).getByText('Not evaluated yet.'),
    ).toBeInTheDocument()
    expect(
      within(getModal()).queryByTestId('scalar-body'),
    ).not.toBeInTheDocument()
    // An unevaluated expression carries no metric.
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })

  // Cyan = source only.
  it('Current with a runtime value renders the evaluated value like a literal (not cyan)', () => {
    renderModal({
      variable: expressionVariable(),
      runtimeValue: 'bobby',
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    const body = getBody()
    expect(body.textContent).toContain('bobby')
    expect(body.textContent).not.toContain(EXPRESSION_SOURCE)
    // The evaluated string renders through the editor (not the cyan source).
    expect(body.className).not.toMatch(/text-cyan/)
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      '5 chars',
    )
  })

  it('evaluated non-string expression shows no metric (empty center zone)', () => {
    renderModal({
      variable: expressionVariable({ type: 'integer', value: 'x + 1' }),
      runtimeValue: 42,
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    expect(getBody().textContent).toContain('42')
    expect(
      within(getModal()).queryByTestId('inspect-metric'),
    ).not.toBeInTheDocument()
  })
})

// ===========================================================================
// Footer: metric + read-only hint
// ===========================================================================

describe('VariableInspectModal - footer metric', () => {
  it('shows "N chars" for string values, counting the raw value', () => {
    renderModal()
    // "bob" is 3 raw chars; the metric counts the raw value, not the display.
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      '3 chars',
    )
  })

  it('describes the value the body currently displays', () => {
    renderModal({
      runtimeValue: 'live-value',
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      '10 chars',
    )
  })

  it.each([
    ['integer', 42],
    ['float', 3.14],
    ['boolean', true],
  ] as const)('renders an empty metric zone for %s values', (type, value) => {
    renderModal({ variable: { type, value } })
    expect(
      within(getModal()).queryByTestId('inspect-metric'),
    ).not.toBeInTheDocument()
  })
})

describe('VariableInspectModal - no action zone (VMGR-18)', () => {
  it('shows no "read-only" hint in Current mode', () => {
    renderModal()
    expect(within(getModal()).queryByTestId('inspect-readonly-hint')).not.toBeInTheDocument()
    expect(within(getModal()).queryByText('read-only')).not.toBeInTheDocument()
  })

  it('shows no "read-only" hint in Initial mode either', async () => {
    const user = userEvent.setup()
    renderModal()
    await switchMode(user, 'Initial')
    expect(within(getModal()).queryByTestId('inspect-readonly-hint')).not.toBeInTheDocument()
    expect(within(getModal()).queryByText('read-only')).not.toBeInTheDocument()
  })
})

// ===========================================================================
// Sizing minimums
// ===========================================================================

describe('VariableInspectModal - resize minimums', () => {
  // Per-type minimum geometry: the floors are the tunable sheet-sizes
  // constants. A string is resizable (opens auto-fit, then drags to a floor).
  it('clamps the corner resize at the per-type (string) minimum', () => {
    const heightSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(400)
    const widthSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetWidth', 'get')
      .mockReturnValue(400)
    try {
      // Unique id: corner drag stores session geometry under the sheetId.
      renderModal({ variable: { id: 'v-minbounds', name: 'min_var', type: 'string' } })
      const corner = within(getModal('v-minbounds')).getByTestId(
        'dialog-resize-corner',
      )
      fireEvent.mouseDown(corner, { clientX: 0, clientY: 0 })
      fireEvent.mouseMove(document, { clientX: -10000, clientY: -10000 })
      fireEvent.mouseUp(document)

      const modal = getModal('v-minbounds')
      const min = getSheetSize('string', false, 'current')
      expect(modal.style.width).toBe(`${min.minWidth}px`)
      expect(modal.style.height).toBe(`${min.minHeight}px`)
    } finally {
      heightSpy.mockRestore()
      widthSpy.mockRestore()
    }
  })

  it('grows a resized watcher up to the new mode minimum on a mode switch', async () => {
    const user = userEvent.setup()
    renderModal({ variable: { id: 'v-grow', name: 'grow_var', type: 'array', value: ['a'] } })
    // Shrink to the single-mode floor (below the Compare floor) via the corner.
    const corner = within(getModal('v-grow')).getByTestId('dialog-resize-corner')
    fireEvent.mouseDown(corner, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(document, { clientX: -10000, clientY: -10000 })
    fireEvent.mouseUp(document)
    const single = getSheetSize('array', false, 'current')
    expect(getModal('v-grow').style.width).toBe(`${single.minWidth}px`)

    await switchMode(user, 'Compare', 'v-grow')

    // Compare's min is larger, so the modal grows up to it on both axes.
    const compare = getSheetSize('array', false, 'compare')
    expect(getModal('v-grow').style.width).toBe(`${compare.minWidth}px`)
    expect(getModal('v-grow').style.height).toBe(`${compare.minHeight}px`)
  })

  it('keeps a resized watcher already larger than the new mode minimum', async () => {
    const user = userEvent.setup()
    renderModal({ variable: { id: 'v-keep', name: 'keep_var', type: 'array', value: ['a'] } })
    // Grow well past the Compare floor via the corner.
    const corner = within(getModal('v-keep')).getByTestId('dialog-resize-corner')
    fireEvent.mouseDown(corner, { clientX: 0, clientY: 0 })
    fireEvent.mouseMove(document, { clientX: 300, clientY: 200 })
    fireEvent.mouseUp(document)
    const grownWidth = getModal('v-keep').style.width
    const grownHeight = getModal('v-keep').style.height

    await switchMode(user, 'Compare', 'v-keep')

    // Already larger than Compare's min on both axes, so the size is untouched.
    expect(getModal('v-keep').style.width).toBe(grownWidth)
    expect(getModal('v-keep').style.height).toBe(grownHeight)
  })
})

// ===========================================================================
// Accessibility
// ===========================================================================

describe('VariableInspectModal - accessibility', () => {
  it('labels the section "Inspect variable <name>"', () => {
    renderModal({ variable: { name: 'api_url' } })
    expect(
      screen.getByRole('region', { name: 'Inspect variable api_url' }),
    ).toBeInTheDocument()
  })

  it('labels the close button "Close inspector for <name>"', () => {
    renderModal({ variable: { name: 'api_url' } })
    expect(
      screen.getByRole('button', { name: 'Close inspector for api_url' }),
    ).toBeInTheDocument()
  })
})

// ===========================================================================
// Complex Visual bodies
// ===========================================================================

beforeEach(() => {
  mockGetSessionVariables.mockReset()
  mockGetSessionVariables.mockResolvedValue({})
})

const ARRAY_VARIABLE: Partial<Variable> = {
  type: 'array',
  value: ['alpha', 42],
}

const MAP_VARIABLE: Partial<Variable> = {
  type: 'map',
  value: { host: 'localhost', port: 8000 },
}

const TABLE_VARIABLE: Partial<Variable> = {
  type: 'table',
  value: [
    { id: 1, name: 'alpha' },
    { id: 2, name: 'beta' },
  ],
}

async function switchView(
  user: ReturnType<typeof userEvent.setup>,
  view: 'Visual' | 'Code' | 'Last Evaluated' | 'Expression',
  id = 'v1',
) {
  await user.click(within(getModal(id)).getByTestId('view-dropdown'))
  await user.click(await screen.findByRole('option', { name: view }))
}

describe('VariableInspectModal - complex Visual bodies', () => {
  it('renders the array body for array variables (idle definition, no fetch)', () => {
    renderModal({ variable: ARRAY_VARIABLE })
    const body = within(getModal()).getByTestId('array-body')
    expect(body.textContent).toContain('"alpha"')
    expect(within(getModal()).queryByTestId('scalar-body')).not.toBeInTheDocument()
    expect(mockGetSessionVariables).not.toHaveBeenCalled()
  })

  it('renders the map body for map variables', () => {
    renderModal({ variable: MAP_VARIABLE })
    const body = within(getModal()).getByTestId('map-body')
    expect(body.textContent).toContain('host')
    expect(within(getModal()).queryByTestId('scalar-body')).not.toBeInTheDocument()
  })

  it('renders the table body for table variables', () => {
    renderModal({ variable: TABLE_VARIABLE })
    const body = within(getModal()).getByTestId('table-body')
    expect(body.textContent).toContain('"alpha"')
    expect(within(getModal()).queryByTestId('scalar-body')).not.toBeInTheDocument()
  })

  it('keeps the scalar body for scalar variables', () => {
    renderModal()
    expect(within(getModal()).getByTestId('scalar-body')).toBeInTheDocument()
    expect(within(getModal()).queryByTestId('array-body')).not.toBeInTheDocument()
  })

  it('renders the Initial mode complex body dim + italic', async () => {
    const user = userEvent.setup()
    renderModal({ variable: ARRAY_VARIABLE })
    await switchMode(user, 'Initial')
    const body = within(getModal()).getByTestId('array-body')
    expect(body.className).toMatch(/italic/)
    expect(body.className).toMatch(/opacity/)
  })
})

// ===========================================================================
// View dropdown gating
// ===========================================================================

describe('VariableInspectModal - View dropdown gating', () => {
  it('shows the View dropdown defaulting to Visual on complex watchers', () => {
    renderModal({ variable: ARRAY_VARIABLE })
    const dropdown = within(getModal()).getByTestId('view-dropdown')
    expect(dropdown).toHaveTextContent('Visual')
  })

  it('hides the View dropdown on scalar watchers', () => {
    renderModal()
    expect(
      within(getModal()).queryByTestId('view-dropdown'),
    ).not.toBeInTheDocument()
  })

  it('shows the View dropdown on expression-typed complex watchers', () => {
    renderModal({
      variable: { type: 'array', value: 'a + b', isExpression: true },
    })
    expect(within(getModal()).getByTestId('view-dropdown')).toBeInTheDocument()
  })

  it('switches to the Code body when Code is picked', async () => {
    const user = userEvent.setup()
    renderModal({ variable: MAP_VARIABLE })
    await switchView(user, 'Code')
    expect(
      await within(getModal()).findByTestId('code-body'),
    ).toBeInTheDocument()
    expect(within(getModal()).queryByTestId('map-body')).not.toBeInTheDocument()
  })

  it('renders the Code document as 2-space JSON of the displayed value', async () => {
    const user = userEvent.setup()
    renderModal({ variable: MAP_VARIABLE })
    await switchView(user, 'Code')
    const editor = (await within(getModal()).findByTestId(
      'codemirror-editor',
    )) as HTMLElement
    expect(editor.textContent).toBe(
      JSON.stringify({ host: 'localhost', port: 8000 }, null, 2),
    )
  })

  it('resets the view to Visual on every open (never persisted)', async () => {
    const user = userEvent.setup()
    const first = renderModal({ variable: MAP_VARIABLE })
    await switchView(user, 'Code')
    await within(getModal()).findByTestId('code-body')
    first.unmount()

    renderModal({ variable: MAP_VARIABLE })
    expect(within(getModal()).getByTestId('view-dropdown')).toHaveTextContent(
      'Visual',
    )
    expect(within(getModal()).getByTestId('map-body')).toBeInTheDocument()
  })
})

// ===========================================================================
// Complex metrics
// ===========================================================================

describe('VariableInspectModal - complex metrics', () => {
  it('shows "N items" for arrays', () => {
    renderModal({ variable: { type: 'array', value: ['a', 'b', 'c'] } })
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      '3 items',
    )
  })

  it('shows "N keys" for maps', () => {
    renderModal({ variable: MAP_VARIABLE })
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      '2 keys',
    )
  })

  it('shows "N rows × M cols" for tables (U+00D7)', () => {
    renderModal({ variable: TABLE_VARIABLE })
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      '2 rows × 2 cols',
    )
  })

  it('keeps the identical metric in Code view', async () => {
    const user = userEvent.setup()
    renderModal({ variable: { type: 'array', value: ['a', 'b', 'c'] } })
    await switchView(user, 'Code')
    await within(getModal()).findByTestId('code-body')
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      '3 items',
    )
  })

  it('shows the zero-count metric and the empty body line together', () => {
    renderModal({ variable: { type: 'array', value: [] } })
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      '0 items',
    )
    expect(within(getModal()).getByText('no items')).toBeInTheDocument()
  })
})

// ===========================================================================
// Default sizing by type
// ===========================================================================

describe('VariableInspectModal - complex default widths', () => {
  it('opens array watchers at the configured array width', () => {
    renderModal({ variable: ARRAY_VARIABLE })
    expect(getModal().style.width).toBe(
      `${getSheetSize('array', false, 'current').width}px`,
    )
  })

  it('opens map watchers at the configured map width', () => {
    renderModal({ variable: MAP_VARIABLE })
    expect(getModal().style.width).toBe(
      `${getSheetSize('map', false, 'current').width}px`,
    )
  })

  it('opens table watchers at the configured table width', () => {
    renderModal({ variable: TABLE_VARIABLE })
    expect(getModal().style.width).toBe(
      `${getSheetSize('table', false, 'current').width}px`,
    )
  })
})

// ===========================================================================
// Live full-value fetch states
// ===========================================================================

const ARRAY_ENVELOPE = { count: 2, changed: true }

describe('VariableInspectModal - live full-value fetch', () => {
  it('shows the aria-busy skeleton while the FIRST fetch is pending', () => {
    mockGetSessionVariables.mockImplementation(() => new Promise(() => {}))
    renderModal({
      variable: { type: 'array', value: [] },
      runtimeValue: ARRAY_ENVELOPE,
      hasRuntimeValue: true,
      runtimeAvailable: true,
      sessionId: 'session-1',
    })
    const skeleton = within(getModal()).getByTestId('inspect-body-skeleton')
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(skeleton.innerHTML).toMatch(/motion-safe/)
    expect(within(getModal()).queryByTestId('array-body')).not.toBeInTheDocument()
  })

  it('reads the in-flight metric from the summary envelope', () => {
    mockGetSessionVariables.mockImplementation(() => new Promise(() => {}))
    renderModal({
      variable: { type: 'array', value: [] },
      runtimeValue: ARRAY_ENVELOPE,
      hasRuntimeValue: true,
      runtimeAvailable: true,
      sessionId: 'session-1',
    })
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      '2 items',
    )
  })

  it('renders the fetched full value once the fetch lands', async () => {
    mockGetSessionVariables.mockResolvedValue({
      user_name: { value: ['live-a', 'live-b'], type: 'array' },
    })
    renderModal({
      variable: { type: 'array', value: [] },
      runtimeValue: ARRAY_ENVELOPE,
      hasRuntimeValue: true,
      runtimeAvailable: true,
      sessionId: 'session-1',
    })
    const body = await within(getModal()).findByTestId('array-body')
    expect(body.textContent).toContain('"live-a"')
    expect(body.textContent).toContain('"live-b"')
    expect(mockGetSessionVariables).toHaveBeenCalledWith('session-1', [
      'user_name',
    ])
  })

  it('renders a history snapshot value directly without fetching', async () => {
    renderModal({
      variable: { type: 'array', value: [] },
      runtimeValue: ['snap-a', 'snap-b'],
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    const body = within(getModal()).getByTestId('array-body')
    expect(body.textContent).toContain('"snap-a"')
    // The 250ms debounce window must elapse before "never called" is proven.
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(mockGetSessionVariables).not.toHaveBeenCalled()
  })

  it('updates in place on a later envelope - no skeleton, stale value holds', async () => {
    mockGetSessionVariables.mockResolvedValueOnce({
      user_name: { value: ['first'], type: 'array' },
    })
    const props = modalProps({
      variable: { type: 'array', value: [] },
      runtimeValue: ARRAY_ENVELOPE,
      hasRuntimeValue: true,
      runtimeAvailable: true,
      sessionId: 'session-1',
    })
    const { rerender } = render(<VariableInspectModal {...props} />)
    await within(getModal()).findByTestId('array-body')
    expect(getBody1Text()).toContain('"first"')

    mockGetSessionVariables.mockImplementationOnce(() => new Promise(() => {}))
    rerender(
      <VariableInspectModal
        {...props}
        runtimeValue={{ count: 1, changed: true }}
      />,
    )
    // Stale-while-revalidate: previous value holds, no first-fetch skeleton.
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(
      within(getModal()).queryByTestId('inspect-body-skeleton'),
    ).not.toBeInTheDocument()
    expect(getBody1Text()).toContain('"first"')
  })
})

function getBody1Text(): string {
  return within(getModal()).getByTestId('array-body').textContent ?? ''
}

// ===========================================================================
// A failed refresh tick reports itself beside the value it could not refresh
// ===========================================================================

describe('VariableInspectModal - failed value refresh', () => {
  const LIVE_ARRAY = {
    variable: { type: 'array', value: [] } as Partial<Variable>,
    hasRuntimeValue: true,
    runtimeAvailable: true,
    sessionId: 'session-1',
  }

  function getNotice(): HTMLElement | null {
    return within(getModal()).queryByTestId('inspect-refresh-failure')
  }

  async function renderWithFirstValue() {
    mockGetSessionVariables.mockResolvedValueOnce({
      user_name: { value: ['first'], type: 'array' },
    })
    const props = modalProps({ ...LIVE_ARRAY, runtimeValue: ARRAY_ENVELOPE })
    const { rerender } = render(<VariableInspectModal {...props} />)
    await within(getModal()).findByTestId('array-body')
    return { props, rerender }
  }

  it('keeps the last value on screen and says the refresh failed', async () => {
    const { props, rerender } = await renderWithFirstValue()

    mockGetSessionVariables.mockRejectedValueOnce(new Error('session 1 is gone'))
    rerender(
      <VariableInspectModal {...props} runtimeValue={{ count: 3, changed: true }} />,
    )

    const notice = await within(getModal()).findByTestId('inspect-refresh-failure')
    expect(notice).toHaveTextContent(
      'Could not refresh the value (showing the last one received). session 1 is gone',
    )
    expect(getBody1Text()).toContain('"first"')
  })

  it('says the value could not be read when no value has landed yet', async () => {
    mockGetSessionVariables.mockRejectedValue(new Error('session 1 is gone'))
    renderModal({ ...LIVE_ARRAY, runtimeValue: ARRAY_ENVELOPE })

    const notice = await within(getModal()).findByTestId('inspect-refresh-failure')
    expect(notice).toHaveTextContent('Could not read the value. session 1 is gone')
    expect(notice.textContent).not.toContain('last one received')
  })

  it('clears the notice when a later tick succeeds', async () => {
    const { props, rerender } = await renderWithFirstValue()

    mockGetSessionVariables.mockRejectedValueOnce(new Error('session 1 is gone'))
    rerender(
      <VariableInspectModal {...props} runtimeValue={{ count: 3, changed: true }} />,
    )
    await within(getModal()).findByTestId('inspect-refresh-failure')

    mockGetSessionVariables.mockResolvedValueOnce({
      user_name: { value: ['second'], type: 'array' },
    })
    rerender(
      <VariableInspectModal {...props} runtimeValue={{ count: 4, changed: true }} />,
    )
    await waitFor(() => {
      expect(getBody1Text()).toContain('"second"')
    })
    expect(getNotice()).not.toBeInTheDocument()
  })

  it('does not report the refresh in Initial mode, which shows the definition', async () => {
    const user = userEvent.setup()
    mockGetSessionVariables.mockRejectedValue(new Error('session 1 is gone'))
    renderModal({ ...LIVE_ARRAY, runtimeValue: ARRAY_ENVELOPE })
    await within(getModal()).findByTestId('inspect-refresh-failure')

    await switchMode(user, 'Initial')
    expect(getNotice()).not.toBeInTheDocument()

    await switchMode(user, 'Current')
    expect(getNotice()).toBeInTheDocument()
  })

  it('reports nothing while the refresh keeps succeeding', async () => {
    await renderWithFirstValue()
    expect(getNotice()).not.toBeInTheDocument()
  })
})

// ===========================================================================
// Expression complex watcher
// ===========================================================================

describe('VariableInspectModal - expression complex watcher', () => {
  const EXPR_COMPLEX: Partial<Variable> = {
    name: 'user_name',
    type: 'array',
    value: 'base_list + extra',
    isExpression: true,
  }

  // No runtime value = empty state.
  it('shows "Not evaluated yet." in the default Visual view while no runtime value exists', () => {
    renderModal({ variable: EXPR_COMPLEX, runtimeAvailable: true })
    expect(
      within(getModal()).getByText('Not evaluated yet.'),
    ).toBeInTheDocument()
    expect(
      within(getModal()).queryByTestId('scalar-body'),
    ).not.toBeInTheDocument()
    expect(within(getModal()).queryByTestId('array-body')).not.toBeInTheDocument()
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })

  it('Code view of an unevaluated expression shows the same empty line', async () => {
    const user = userEvent.setup()
    renderModal({ variable: EXPR_COMPLEX, runtimeAvailable: true })
    await switchView(user, 'Code')
    expect(
      within(getModal()).getByText('Not evaluated yet.'),
    ).toBeInTheDocument()
    expect(within(getModal()).queryByTestId('code-body')).not.toBeInTheDocument()
  })

  it('Expression view shows the cyan raw source with no metric', async () => {
    const user = userEvent.setup()
    renderModal({ variable: EXPR_COMPLEX, runtimeAvailable: true })
    await switchView(user, 'Expression')
    const body = within(getModal()).getByTestId('scalar-body')
    expect(body.textContent).toContain('base_list + extra')
    expect(body.className).toMatch(/text-cyan/)
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })

  it('renders the Initial source dim + italic with no metric', async () => {
    const user = userEvent.setup()
    renderModal({ variable: EXPR_COMPLEX, runtimeAvailable: true })
    await switchMode(user, 'Initial')
    const body = within(getModal()).getByTestId('scalar-body')
    expect(body.className).toMatch(/italic/)
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })

  it('fetches and renders the typed body for a live evaluated summary', async () => {
    mockGetSessionVariables.mockResolvedValue({
      user_name: { value: ['eval-a'], type: 'array' },
    })
    renderModal({
      variable: EXPR_COMPLEX,
      runtimeValue: ARRAY_ENVELOPE,
      hasRuntimeValue: true,
      runtimeAvailable: true,
      sessionId: 'session-1',
    })
    const body = await within(getModal()).findByTestId('array-body')
    expect(body.textContent).toContain('"eval-a"')
  })

  it('waits for the full value instead of rendering the envelope (no {count} body)', async () => {
    mockGetSessionVariables.mockImplementation(() => new Promise(() => {}))
    renderModal({
      variable: EXPR_COMPLEX,
      runtimeValue: ARRAY_ENVELOPE,
      hasRuntimeValue: true,
      runtimeAvailable: true,
      sessionId: 'session-1',
    })
    await waitFor(() => {
      expect(
        within(getModal()).getByTestId('inspect-body-skeleton'),
      ).toBeInTheDocument()
    })
    expect(getModal().textContent).not.toContain('count')
  })
})

// ===========================================================================
// View dropdown matrix
// ===========================================================================

function expressionArrayVariable(
  overrides: Partial<Variable> = {},
): Partial<Variable> {
  return {
    id: 'v1',
    name: 'user_name',
    value: 'base_list + extra',
    type: 'array',
    isExpression: true,
    ...overrides,
  }
}

async function getViewOptions(
  user: ReturnType<typeof userEvent.setup>,
  id = 'v1',
): Promise<string[]> {
  await user.click(within(getModal(id)).getByTestId('view-dropdown'))
  const options = await screen.findAllByRole('option')
  return options.map((option) => option.textContent?.trim() ?? '')
}

describe('VariableInspectModal - View dropdown matrix', () => {
  it.each([
    ['string', 'bob'],
    ['integer', 42],
    ['boolean', true],
  ] as const)('literal %s watchers render no View dropdown at all', (type, value) => {
    renderModal({ variable: { type, value } })
    expect(
      within(getModal()).queryByTestId('view-dropdown'),
    ).not.toBeInTheDocument()
  })

  it('expression scalar watchers default to the Literal view on open', () => {
    renderModal({ variable: expressionVariable() })
    expect(within(getModal()).getByTestId('view-dropdown')).toHaveTextContent(
      'Last Evaluated',
    )
  })

  it('expression scalar menus list exactly Literal and Expression', async () => {
    const user = userEvent.setup()
    renderModal({ variable: expressionVariable() })
    expect(await getViewOptions(user)).toEqual(['Last Evaluated', 'Expression'])
  })

  it('literal complex menus keep exactly Visual and Code', async () => {
    const user = userEvent.setup()
    renderModal({ variable: ARRAY_VARIABLE })
    expect(await getViewOptions(user)).toEqual(['Visual', 'Code'])
  })

  it('expression complex watchers default to the Visual view on open', () => {
    renderModal({ variable: expressionArrayVariable() })
    expect(within(getModal()).getByTestId('view-dropdown')).toHaveTextContent(
      'Visual',
    )
  })

  it('expression complex menus list exactly Visual, Code, and Expression', async () => {
    const user = userEvent.setup()
    renderModal({ variable: expressionArrayVariable() })
    expect(await getViewOptions(user)).toEqual(['Visual', 'Code', 'Expression'])
  })

  it('resets the expression scalar view to Literal on every open', async () => {
    const user = userEvent.setup()
    const first = renderModal({ variable: expressionVariable() })
    await switchView(user, 'Expression')
    expect(within(getModal()).getByTestId('view-dropdown')).toHaveTextContent(
      'Expression',
    )
    first.unmount()

    renderModal({ variable: expressionVariable() })
    expect(within(getModal()).getByTestId('view-dropdown')).toHaveTextContent(
      'Last Evaluated',
    )
  })

  it('shows the active Current override source in the Expression view, not the definition', async () => {
    const user = userEvent.setup()
    const overrideSource = "'http://staging/' + service_name"
    renderModal({
      variable: expressionVariable(),
      currentSource: overrideSource,
      hasRuntimeValue: false,
      runtimeAvailable: true,
    })
    await switchView(user, 'Expression')
    const body = getBody()
    expect(body.textContent).toContain(overrideSource)
    expect(body.textContent).not.toContain(EXPRESSION_SOURCE)
  })

  it('keeps the Initial source as the definition even when a Current override source is set', async () => {
    const user = userEvent.setup()
    renderModal({
      variable: expressionVariable(),
      currentSource: "'http://staging/' + service_name",
    })
    await switchMode(user, 'Initial')
    expect(getBody().textContent).toContain(EXPRESSION_SOURCE)
  })
})

// ===========================================================================
// Expression scalar body resolution
// ===========================================================================

describe('VariableInspectModal - expression scalar body resolution', () => {
  it.each([
    ['idle', false],
    ['live but unreferenced', true],
  ])(
    'Literal view without a runtime value shows the muted italic empty line (%s)',
    (_label, runtimeAvailable) => {
      renderModal({
        variable: expressionVariable(),
        hasRuntimeValue: false,
        runtimeAvailable,
      })
      const empty = within(getModal()).getByText('Not evaluated yet.')
      expect(empty.className).toMatch(/italic/)
      expect(empty.className).toMatch(/muted/)
      expect(
        within(getModal()).queryByTestId('scalar-body'),
      ).not.toBeInTheDocument()
      expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
    },
  )

  it('Expression view shows the cyan raw source with no metric', async () => {
    const user = userEvent.setup()
    renderModal({ variable: expressionVariable(), runtimeAvailable: true })
    await switchView(user, 'Expression')
    const body = getBody()
    expect(body.textContent).toContain(EXPRESSION_SOURCE)
    expect(body.className).toMatch(/text-cyan/)
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })

  it('Expression view still shows the source after evaluation', async () => {
    const user = userEvent.setup()
    renderModal({
      variable: expressionVariable(),
      runtimeValue: 'bobby',
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    await switchView(user, 'Expression')
    const body = getBody()
    expect(body.textContent).toContain(EXPRESSION_SOURCE)
    expect(body.textContent).not.toContain('bobby')
    expect(body.className).toMatch(/text-cyan/)
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })
})

// ===========================================================================
// Type-mismatch guard
// ===========================================================================

describe('VariableInspectModal - type-mismatch guard', () => {
  it('renders MismatchBody for an expression scalar whose runtime value mismatches', () => {
    renderModal({
      variable: expressionVariable({ type: 'integer', value: 'x + 1' }),
      runtimeValue: {},
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    const guard = within(getModal()).getByTestId('mismatch-body')
    expect(
      within(guard).getByText('received map - declared integer'),
    ).toBeInTheDocument()
    expect(
      within(getModal()).queryByTestId('scalar-body'),
    ).not.toBeInTheDocument()
  })

  it('shows the amber "type mismatch" metric while the guard is displayed', () => {
    renderModal({
      variable: expressionVariable({ type: 'integer', value: 'x + 1' }),
      runtimeValue: {},
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    const metric = within(getModal()).getByTestId('inspect-metric')
    expect(metric).toHaveTextContent('type mismatch')
    expect(metric.className).toMatch(/amber/)
  })

  it('guards literal scalar watchers too', () => {
    renderModal({
      runtimeValue: 42,
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    const guard = within(getModal()).getByTestId('mismatch-body')
    expect(
      within(guard).getByText('received integer - declared string'),
    ).toBeInTheDocument()
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      'type mismatch',
    )
  })

  it.each([
    ['expression', true],
    ['literal', false],
  ])('a null runtime value passes the guard on %s watchers', (_label, isExpression) => {
    renderModal({
      variable: { type: 'integer', value: isExpression ? 'x + 1' : 7, isExpression },
      runtimeValue: null,
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    expect(
      within(getModal()).queryByTestId('mismatch-body'),
    ).not.toBeInTheDocument()
    expectNullLook()
  })

  it('guards literal complex watchers in Visual view (history snapshot value)', () => {
    renderModal({
      variable: ARRAY_VARIABLE,
      runtimeValue: { a: 1 },
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    const guard = within(getModal()).getByTestId('mismatch-body')
    expect(
      within(guard).getByText('received map - declared array'),
    ).toBeInTheDocument()
    expect(within(getModal()).queryByTestId('array-body')).not.toBeInTheDocument()
  })

  it('Code view of a mismatched literal complex value still renders the raw payload', async () => {
    const user = userEvent.setup()
    renderModal({
      variable: ARRAY_VARIABLE,
      runtimeValue: { a: 1 },
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    await switchView(user, 'Code')
    const editor = (await within(getModal()).findByTestId(
      'codemirror-editor',
    )) as HTMLElement
    expect(editor.textContent).toBe(JSON.stringify({ a: 1 }, null, 2))
    expect(
      within(getModal()).queryByTestId('mismatch-body'),
    ).not.toBeInTheDocument()
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      'type mismatch',
    )
  })

  it('never guards definitions: Initial shows the definition, not the guard', async () => {
    const user = userEvent.setup()
    renderModal({
      runtimeValue: 42,
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    expect(within(getModal()).getByTestId('mismatch-body')).toBeInTheDocument()
    await switchMode(user, 'Initial')
    expect(
      within(getModal()).queryByTestId('mismatch-body'),
    ).not.toBeInTheDocument()
    expect(getBody().textContent).toContain('bob')
  })

  it('guards the fetch-resolved value of an expression complex watcher', async () => {
    mockGetSessionVariables.mockResolvedValue({
      user_name: { value: { oops: true }, type: 'map' },
    })
    renderModal({
      variable: expressionArrayVariable(),
      runtimeValue: ARRAY_ENVELOPE,
      hasRuntimeValue: true,
      runtimeAvailable: true,
      sessionId: 'session-1',
    })
    const guard = await within(getModal()).findByTestId('mismatch-body')
    expect(
      within(guard).getByText('received map - declared array'),
    ).toBeInTheDocument()
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      'type mismatch',
    )
  })

  it('Code view of a mismatched expression complex value renders the raw payload', async () => {
    const user = userEvent.setup()
    mockGetSessionVariables.mockResolvedValue({
      user_name: { value: { oops: true }, type: 'map' },
    })
    renderModal({
      variable: expressionArrayVariable(),
      runtimeValue: ARRAY_ENVELOPE,
      hasRuntimeValue: true,
      runtimeAvailable: true,
      sessionId: 'session-1',
    })
    await within(getModal()).findByTestId('mismatch-body')
    await switchView(user, 'Code')
    const editor = (await within(getModal()).findByTestId(
      'codemirror-editor',
    )) as HTMLElement
    expect(editor.textContent).toBe(JSON.stringify({ oops: true }, null, 2))
    expect(
      within(getModal()).queryByTestId('mismatch-body'),
    ).not.toBeInTheDocument()
  })
})

// ===========================================================================
// Initial view lock + Current restore
// ===========================================================================

describe('VariableInspectModal - Initial view lock + restore', () => {
  it('disables the View dropdown in Initial mode, forcing the "Expression" display (scalar)', async () => {
    const user = userEvent.setup()
    renderModal({ variable: expressionVariable() })
    await switchMode(user, 'Initial')
    const dropdown = within(getModal()).getByTestId('view-dropdown')
    expect(dropdown).toBeDisabled()
    expect(dropdown).toHaveTextContent('Expression')
  })

  it('disables the View dropdown in Initial mode on expression complex watchers too', async () => {
    const user = userEvent.setup()
    renderModal({ variable: expressionArrayVariable() })
    await switchMode(user, 'Initial')
    const dropdown = within(getModal()).getByTestId('view-dropdown')
    expect(dropdown).toBeDisabled()
    expect(dropdown).toHaveTextContent('Expression')
  })

  it('keeps the View dropdown enabled in Initial mode on literal complex watchers', async () => {
    const user = userEvent.setup()
    renderModal({ variable: ARRAY_VARIABLE })
    await switchMode(user, 'Initial')
    expect(within(getModal()).getByTestId('view-dropdown')).not.toBeDisabled()
  })

  it('Initial renders the source dim + italic cyan regardless of the prior view', async () => {
    const user = userEvent.setup()
    renderModal({
      variable: expressionVariable(),
      runtimeValue: 'bobby',
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    await switchMode(user, 'Initial')
    const body = getBody()
    expect(body.textContent).toContain(EXPRESSION_SOURCE)
    expect(body.className).toMatch(/text-cyan/)
    expect(body.className).toMatch(/italic/)
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })

  it('returning to Current restores the default Literal view (scalar)', async () => {
    const user = userEvent.setup()
    renderModal({
      variable: expressionVariable(),
      runtimeValue: 'bobby',
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    await switchMode(user, 'Initial')
    expect(within(getModal()).getByTestId('view-dropdown')).toHaveTextContent(
      'Expression',
    )
    await switchMode(user, 'Current')
    expect(within(getModal()).getByTestId('view-dropdown')).toHaveTextContent(
      'Last Evaluated',
    )
    expect(getBody().textContent).toContain('bobby')
  })

  it('returning to Current restores the view selected before Initial (complex)', async () => {
    const user = userEvent.setup()
    renderModal({ variable: expressionArrayVariable() })
    await switchView(user, 'Code')
    await switchMode(user, 'Initial')
    expect(within(getModal()).getByTestId('view-dropdown')).toHaveTextContent(
      'Expression',
    )
    await switchMode(user, 'Current')
    expect(within(getModal()).getByTestId('view-dropdown')).toHaveTextContent(
      'Code',
    )
  })
})

// ===========================================================================
// Compare mode (REQ-3.1.3.11): Initial and Current panes side by side; the
// footer metric becomes the delta.
// ===========================================================================

function comparePanes(id = 'v1') {
  const modal = getModal(id)
  return {
    initial: within(modal).getByTestId('compare-pane-initial'),
    current: within(modal).getByTestId('compare-pane-current'),
  }
}

describe('VariableInspectModal - Compare mode shell', () => {
  it('splits the body into an Initial and a Current pane when Compare is selected', async () => {
    const user = userEvent.setup()
    renderModal()
    await switchMode(user, 'Compare')
    expect(within(getModal()).getByTestId('compare-body')).toBeInTheDocument()
    const { initial, current } = comparePanes()
    expect(initial).toBeInTheDocument()
    expect(current).toBeInTheDocument()
  })

  it('fills the Compare panes in Code view so the editors scale with the watcher', async () => {
    const user = userEvent.setup()
    renderModal({ variable: { id: 'v1', name: 'arr', type: 'array', value: ['a', 'b'] } })
    await switchMode(user, 'Compare')
    await switchView(user, 'Code')
    // Code panes are CodeMirror editors, so the grid fills + the panes become
    // flex columns; the editors scale with the watcher instead of collapsing.
    expect(within(getModal()).getByTestId('compare-body').className).toMatch(/h-full/)
  })

  it('idle Compare renders the definition in both panes with the always-arrow metric', async () => {
    const user = userEvent.setup()
    renderModal()
    await switchMode(user, 'Compare')
    const { initial, current } = comparePanes()
    expect(within(initial).getByTestId('scalar-body').textContent).toContain('bob')
    expect(within(current).getByTestId('scalar-body').textContent).toContain('bob')
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      '3 -> 3 chars',
    )
  })

  it('dims the Initial pane and keeps the Current pane normal', async () => {
    const user = userEvent.setup()
    renderModal()
    await switchMode(user, 'Compare')
    const { initial, current } = comparePanes()
    const left = within(initial).getByTestId('scalar-body')
    const right = within(current).getByTestId('scalar-body')
    // A string dims via opacity (the editor renders italics broken).
    expect(left.className).toMatch(/opacity/)
    expect(right.className).not.toMatch(/opacity/)
  })

  it('places a whole null where the value sits in a stacked scalar Compare (VMGR-93)', async () => {
    const user = userEvent.setup()
    renderModal({
      variable: { id: 'v1', name: 'count', type: 'integer', value: 1 },
      runtimeValue: null,
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    await switchMode(user, 'Compare')
    const { initial, current } = comparePanes()
    const nullText = within(current).getByText('null')
    expect(nullText.className).toContain(NULL_LOOK_CLASS)
    expect(current.querySelector('.justify-center')).toBeNull()
    expect(within(initial).getByTestId('scalar-body').textContent).toBe('1')
  })

  it('dims a whole null Initial in a stacked scalar Compare without centering it', async () => {
    const user = userEvent.setup()
    renderModal({
      variable: { id: 'v1', name: 'count', type: 'integer', value: null },
      runtimeValue: 3,
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    await switchMode(user, 'Compare')
    const { initial } = comparePanes()
    const nullText = within(initial).getByText('null')
    expect(nullText.closest('.opacity-70')).not.toBeNull()
    expect(initial.querySelector('.justify-center')).toBeNull()
  })
})

describe('VariableInspectModal - Compare live string delta', () => {
  it('keeps the definition on the left and shows the live value on the right', async () => {
    const user = userEvent.setup()
    renderModal({
      runtimeValue: 'live-value',
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    await switchMode(user, 'Compare')
    const { initial, current } = comparePanes()
    expect(within(initial).getByTestId('scalar-body').textContent).toContain('bob')
    expect(within(current).getByTestId('scalar-body').textContent).toContain(
      'live-value',
    )
    expect(within(initial).getByTestId('scalar-body').textContent).not.toContain(
      'live-value',
    )
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      '3 -> 10 chars',
    )
  })
})

describe('VariableInspectModal - Compare expression watcher', () => {
  // Compare on an expression compares the two SOURCES (Initial vs the active
  // Current override), not the source against the evaluated value.
  it('shows the Initial source on the left and the Current override source on the right', async () => {
    const user = userEvent.setup()
    const overrideSource = "'overridden/' + service_name"
    renderModal({
      variable: expressionVariable(),
      currentSource: overrideSource,
      runtimeValue: 'bobby',
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    await switchMode(user, 'Compare')
    const { initial, current } = comparePanes()
    const left = within(initial).getByTestId('scalar-body')
    const right = within(current).getByTestId('scalar-body')
    expect(left.textContent).toContain(EXPRESSION_SOURCE)
    expect(left.className).toMatch(/text-cyan/)
    expect(left.className).toMatch(/italic/)
    // Both panes render the source (cyan); the evaluated value is not shown here.
    expect(right.textContent).toContain(overrideSource)
    expect(right.textContent).not.toContain('bobby')
    expect(right.className).toMatch(/text-cyan/)
    // Comparing two formulas yields no char metric.
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })

  it('annotates the panes "Initial - source" / "Current - source" for expressions', async () => {
    const user = userEvent.setup()
    renderModal({
      variable: expressionVariable(),
      runtimeValue: 'bobby',
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    await switchMode(user, 'Compare')
    const { initial, current } = comparePanes()
    expect(within(initial).getByText('Initial - source')).toBeInTheDocument()
    expect(within(current).getByText('Current - source')).toBeInTheDocument()
  })

  it('shows both sources in Compare even before evaluation (no "Not evaluated yet.")', async () => {
    const user = userEvent.setup()
    renderModal({
      variable: expressionVariable(),
      hasRuntimeValue: false,
      runtimeAvailable: true,
    })
    await switchMode(user, 'Compare')
    const { initial, current } = comparePanes()
    // Without an override, the Current source equals the Initial (definition) source.
    expect(within(initial).getByTestId('scalar-body').textContent).toContain(EXPRESSION_SOURCE)
    expect(within(current).getByTestId('scalar-body').textContent).toContain(EXPRESSION_SOURCE)
    expect(within(getModal()).queryByText('Not evaluated yet.')).not.toBeInTheDocument()
  })

  it('keeps the expression scalar View dropdown disabled showing Expression in Compare', async () => {
    const user = userEvent.setup()
    renderModal({
      variable: expressionVariable(),
      runtimeValue: 'bobby',
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    await switchMode(user, 'Compare')
    const dropdown = within(getModal()).getByTestId('view-dropdown')
    expect(dropdown).toHaveTextContent('Expression')
    expect(dropdown).toBeDisabled()
  })

  it('compares the two sources in Compare and restores the Current view on leaving', async () => {
    const user = userEvent.setup()
    const overrideSource = "'overridden/' + service_name"
    renderModal({
      variable: expressionVariable(),
      currentSource: overrideSource,
      runtimeValue: 'bobby',
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    await switchView(user, 'Expression')
    expect(within(getModal()).getByTestId('view-dropdown')).toHaveTextContent('Expression')

    await switchMode(user, 'Compare')
    expect(within(getModal()).getByTestId('view-dropdown')).toHaveTextContent('Expression')
    // The Current pane shows the override SOURCE, not the evaluated value.
    const { current } = comparePanes()
    expect(within(current).getByTestId('scalar-body').textContent).toContain(overrideSource)
    expect(within(current).getByTestId('scalar-body').textContent).not.toContain('bobby')

    await switchMode(user, 'Current')
    expect(within(getModal()).getByTestId('view-dropdown')).toHaveTextContent('Expression')
  })
})

describe('VariableInspectModal - Compare type-mismatch', () => {
  it('renders the mismatch guard in the Current pane only and the amber "type mismatch" metric', async () => {
    const user = userEvent.setup()
    renderModal({
      runtimeValue: 42,
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    await switchMode(user, 'Compare')
    const { initial, current } = comparePanes()
    expect(within(current).getByTestId('mismatch-body')).toBeInTheDocument()
    expect(
      within(current).getByText('received integer - declared string'),
    ).toBeInTheDocument()
    expect(within(initial).queryByTestId('mismatch-body')).not.toBeInTheDocument()
    expect(within(initial).getByTestId('scalar-body').textContent).toContain('bob')
    const metric = within(getModal()).getByTestId('inspect-metric')
    expect(metric).toHaveTextContent('type mismatch')
    expect(metric.className).toMatch(/amber/)
  })
})

describe('VariableInspectModal - Compare literal complex', () => {
  it('drives both panes with the Visual view and an items delta metric', async () => {
    const user = userEvent.setup()
    renderModal({ variable: ARRAY_VARIABLE })
    await switchMode(user, 'Compare')
    const { initial, current } = comparePanes()
    expect(within(initial).getByTestId('array-body')).toBeInTheDocument()
    expect(within(current).getByTestId('array-body')).toBeInTheDocument()
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      '2 -> 2 items',
    )
  })

  it('drives both panes to the Code body when Code is picked', async () => {
    const user = userEvent.setup()
    renderModal({ variable: ARRAY_VARIABLE })
    await switchMode(user, 'Compare')
    await switchView(user, 'Code')
    const { initial, current } = comparePanes()
    expect(await within(initial).findByTestId('code-body')).toBeInTheDocument()
    expect(await within(current).findByTestId('code-body')).toBeInTheDocument()
  })

  it('renders per-pane table grids with a rows-only delta metric', async () => {
    const user = userEvent.setup()
    renderModal({ variable: TABLE_VARIABLE })
    await switchMode(user, 'Compare')
    const { initial, current } = comparePanes()
    expect(within(initial).getByTestId('table-body')).toBeInTheDocument()
    expect(within(current).getByTestId('table-body')).toBeInTheDocument()
    const metric = within(getModal()).getByTestId('inspect-metric')
    expect(metric).toHaveTextContent('2 -> 2 rows')
    expect(metric.textContent).not.toContain('cols')
  })
})

describe('VariableInspectModal - Compare first-fetch skeleton', () => {
  it('renders the skeleton in the Current pane only while the Initial pane keeps the definition', async () => {
    mockGetSessionVariables.mockImplementation(() => new Promise(() => {}))
    const user = userEvent.setup()
    renderModal({
      variable: { type: 'array', value: ['def-a', 'def-b'] },
      runtimeValue: ARRAY_ENVELOPE,
      hasRuntimeValue: true,
      runtimeAvailable: true,
      sessionId: 'session-1',
    })
    await switchMode(user, 'Compare')
    const { initial, current } = comparePanes()
    expect(within(current).getByTestId('inspect-body-skeleton')).toBeInTheDocument()
    expect(within(initial).queryByTestId('inspect-body-skeleton')).not.toBeInTheDocument()
    expect(within(initial).getByTestId('array-body').textContent).toContain('"def-a"')
  })
})

describe('VariableInspectModal - Compare expression complex', () => {
  it('renders the source on the left, the evaluated body on the right, and keeps Visual/Code', async () => {
    mockGetSessionVariables.mockResolvedValue({
      user_name: { value: ['eval-a', 'eval-b'], type: 'array' },
    })
    const user = userEvent.setup()
    renderModal({
      variable: expressionArrayVariable(),
      runtimeValue: ARRAY_ENVELOPE,
      hasRuntimeValue: true,
      runtimeAvailable: true,
      sessionId: 'session-1',
    })
    await within(getModal()).findByTestId('array-body')
    await switchMode(user, 'Compare')
    const { initial, current } = comparePanes()
    expect(within(initial).getByTestId('scalar-body').textContent).toContain(
      'base_list + extra',
    )
    expect(within(initial).getByTestId('scalar-body').className).toMatch(/text-cyan/)
    expect(await within(current).findByTestId('array-body')).toBeInTheDocument()
    expect(await getViewOptions(user)).toEqual(['Visual', 'Code'])
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      'expression -> 2 items',
    )
  })

  it('shows the not-evaluated metric for an unevaluated expression complex in Compare', async () => {
    const user = userEvent.setup()
    renderModal({
      variable: expressionArrayVariable(),
      hasRuntimeValue: false,
      runtimeAvailable: true,
    })
    await switchMode(user, 'Compare')
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      'expression -> no value yet',
    )
  })

  it('coerces a carried-in Expression view to Visual for a complex watcher in Compare', async () => {
    mockGetSessionVariables.mockResolvedValue({
      user_name: { value: ['eval-a', 'eval-b'], type: 'array' },
    })
    const user = userEvent.setup()
    renderModal({
      variable: expressionArrayVariable(),
      runtimeValue: ARRAY_ENVELOPE,
      hasRuntimeValue: true,
      runtimeAvailable: true,
      sessionId: 'session-1',
    })
    await within(getModal()).findByTestId('array-body')
    await switchView(user, 'Expression')
    expect(within(getModal()).getByTestId('view-dropdown')).toHaveTextContent(
      'Expression',
    )

    await switchMode(user, 'Compare')
    // Expression drops out for a complex watcher in Compare; the carried-in
    // Expression view coerces to Visual, driving the evaluated body.
    expect(within(getModal()).getByTestId('view-dropdown')).toHaveTextContent(
      'Visual',
    )
    const { initial, current } = comparePanes()
    expect(within(initial).getByTestId('scalar-body').className).toMatch(/text-cyan/)
    expect(await within(current).findByTestId('array-body')).toBeInTheDocument()
  })
})

// ===========================================================================
// String value formatting (REQ-3.1.3.11): a literal string watcher has a
// footer Format dropdown; Auto detects once on open and resets on reopen.
//
// REQ-3.1.3.11: Variable watching UI panel
// ===========================================================================

async function switchFormat(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  id = 'v1',
) {
  await user.click(within(getModal(id)).getByTestId('format-dropdown'))
  await user.click(await screen.findByRole('option', { name: label }))
}

describe('VariableInspectModal - string Format control (read)', () => {
  it('shows the Format dropdown on a literal string watcher', () => {
    renderModal()
    expect(
      within(getModal()).getByTestId('format-dropdown'),
    ).toBeInTheDocument()
  })

  it.each([
    ['integer', 1],
    ['float', 3.14],
    ['boolean', true],
  ] as const)('hides the Format dropdown on %s watchers', (type, value) => {
    renderModal({ variable: { type, value } })
    expect(
      within(getModal()).queryByTestId('format-dropdown'),
    ).not.toBeInTheDocument()
  })

  it('hides the Format dropdown on complex watchers (they keep the View dropdown)', () => {
    renderModal({ variable: ARRAY_VARIABLE })
    expect(
      within(getModal()).queryByTestId('format-dropdown'),
    ).not.toBeInTheDocument()
  })

  it('hides the Format dropdown on expression string watchers (literals only)', () => {
    renderModal({ variable: expressionVariable() })
    expect(
      within(getModal()).queryByTestId('format-dropdown'),
    ).not.toBeInTheDocument()
  })

  it('detects the format once on open and surfaces it in the Auto trigger', () => {
    renderModal({ variable: { value: '{"a":1}' } })
    expect(within(getModal()).getByTestId('format-dropdown')).toHaveTextContent(
      'Auto (JSON)',
    )
  })

  it('re-detects Auto when the definition value changes (a save)', () => {
    const props = modalProps({ variable: { value: '{"a":1}' } })
    const { rerender } = render(<VariableInspectModal {...props} />)
    expect(within(getModal()).getByTestId('format-dropdown')).toHaveTextContent(
      'Auto (JSON)',
    )
    // A save swaps the stored value to YAML; the Auto trigger re-detects.
    rerender(
      <VariableInspectModal
        {...props}
        variable={{ ...props.variable, value: 'name: test\nport: 8080' }}
      />,
    )
    expect(within(getModal()).getByTestId('format-dropdown')).toHaveTextContent(
      'Auto (YAML)',
    )
  })

  it('shows a plain Auto trigger for plain string content', () => {
    renderModal()
    const trigger = within(getModal()).getByTestId('format-dropdown')
    expect(trigger).toHaveTextContent('Auto')
    expect(trigger).not.toHaveTextContent('Auto (')
  })

  it('switches the rendered format when a new format is picked', async () => {
    const user = userEvent.setup()
    renderModal({ variable: { value: '{"a":1}' } })
    await switchFormat(user, 'Plain')
    expect(within(getModal()).getByTestId('format-dropdown')).toHaveTextContent(
      'Plain',
    )
    await switchFormat(user, 'YAML')
    expect(within(getModal()).getByTestId('format-dropdown')).toHaveTextContent(
      'YAML',
    )
  })


  it('resets the format to Auto on every open (never persisted)', async () => {
    const user = userEvent.setup()
    const first = renderModal({ variable: { value: '{"a":1}' } })
    await switchFormat(user, 'Plain')
    expect(within(getModal()).getByTestId('format-dropdown')).toHaveTextContent(
      'Plain',
    )
    first.unmount()

    renderModal({ variable: { value: '{"a":1}' } })
    expect(within(getModal()).getByTestId('format-dropdown')).toHaveTextContent(
      'Auto (JSON)',
    )
  })
})

describe('VariableInspectModal - locked secret read view (full opacity)', () => {
  it('renders the masked body for a locked secret array without crashing', () => {
    // A saved secret loads as the masked read: value is the placeholder STRING.
    // Feeding it into the array machinery crashed the page (value.map).
    renderModal({
      variable: { isSecret: true, name: 'tokens', type: 'array', value: '********' },
      secretUnlocked: false,
    })
    const masked = within(getModal('v1')).getByTestId('inspect-secret-masked')
    expect(masked).toHaveTextContent('********')
  })

  it('renders the masked body for a locked secret map (no keyed rows)', () => {
    renderModal({
      variable: { isSecret: true, name: 'creds', type: 'map', value: '********' },
      secretUnlocked: false,
    })
    expect(within(getModal('v1')).getByTestId('inspect-secret-masked')).toBeInTheDocument()
    expect(within(getModal('v1')).queryByTestId('map-body')).not.toBeInTheDocument()
  })

  it('renders the masked body for a locked secret string', () => {
    renderModal({
      variable: { isSecret: true, name: 'token', value: 's3cr3t' },
      secretUnlocked: false,
    })
    expect(within(getModal('v1')).getByTestId('inspect-secret-masked')).toHaveTextContent(
      '********',
    )
  })

  it.each(['string', 'array', 'map'] as const)('shows a locked %s secret holding nothing as empty', (type) => {
    renderModal({
      variable: { isSecret: true, name: 'token', type, value: '' },
      secretUnlocked: false,
    })
    expect(within(getModal('v1')).getByTestId('inspect-secret-masked').textContent).toBe('')
  })

  it('shows an empty runtime value of a locked secret as empty', () => {
    renderModal({
      variable: { isSecret: true, name: 'token', type: 'string', value: '********' },
      runtimeValue: '',
      hasRuntimeValue: true,
      runtimeAvailable: true,
      secretUnlocked: false,
    })
    expect(within(getModal('v1')).getByTestId('inspect-secret-masked').textContent).toBe('')
  })

  it.each(['string', 'array', 'map'] as const)(
    'shows a locked %s secret holding null with the null look, not the mask',
    (type) => {
      renderModal({
        variable: { isSecret: true, name: 'token', type, value: null },
        secretUnlocked: false,
      })
      expect(within(getModal('v1')).queryByTestId('inspect-secret-masked')).not.toBeInTheDocument()
      expectNullLook()
    },
  )

  it('shows a null runtime value of a locked secret with the null look, not the mask', () => {
    renderModal({
      variable: { isSecret: true, name: 'token', type: 'string', value: '********' },
      runtimeValue: null,
      hasRuntimeValue: true,
      runtimeAvailable: true,
      secretUnlocked: false,
    })
    expect(within(getModal('v1')).queryByTestId('inspect-secret-masked')).not.toBeInTheDocument()
    expectNullLook()
  })

  it.each([
    ['whitespace', '   '],
    ['a sealed envelope', 'wave:enc:v1:abc'],
  ])('masks a locked secret holding %s', (_label, value) => {
    renderModal({
      variable: { isSecret: true, name: 'token', type: 'string', value },
      secretUnlocked: false,
    })
    expect(within(getModal('v1')).getByTestId('inspect-secret-masked').textContent).toBe('********')
  })

  it('shows no visibility notice on a locked read view (strip only once changed)', () => {
    renderModal({
      variable: { isSecret: true, name: 'token' },
      secretUnlocked: false,
    })
    expect(
      within(getModal('v1')).queryByTestId('inspect-secret-notice'),
    ).not.toBeInTheDocument()
  })
})

describe('VariableInspectModal - test_variables reveal', () => {
  // Reset before each test (nothing mounted yet) to avoid an out-of-act re-render.
  beforeEach(() => {
    useMaskingSettingsStore.setState({ testVariables: false })
  })

  it('reveals a saved secret runtime value in the watcher when test_variables is on', () => {
    useMaskingSettingsStore.setState({ testVariables: true })
    renderModal({
      variable: { isSecret: true, name: 'token', type: 'string', value: 's3cr3t' },
      runtimeValue: 'revealed-plaintext',
      hasRuntimeValue: true,
      runtimeAvailable: true,
      secretUnlocked: false,
    })
    expect(
      within(getModal('v1')).queryByTestId('inspect-secret-masked'),
    ).not.toBeInTheDocument()
    expect(getModal('v1')).toHaveTextContent('revealed-plaintext')
  })

  it('keeps the watcher masked when test_variables is off', () => {
    useMaskingSettingsStore.setState({ testVariables: false })
    renderModal({
      variable: { isSecret: true, name: 'token', type: 'string', value: 's3cr3t' },
      runtimeValue: 'revealed-plaintext',
      hasRuntimeValue: true,
      runtimeAvailable: true,
      secretUnlocked: false,
    })
    expect(within(getModal('v1')).getByTestId('inspect-secret-masked')).toBeInTheDocument()
  })
})

describe('VariableInspectModal - secret + table serialize', () => {
  it('shows the secret-visibility notice while a new or edited secret is on screen', () => {
    renderModal({ variable: { isSecret: true, name: 'token' }, secretUnlocked: true, secretChanged: true })
    expect(within(getModal()).getByTestId('inspect-secret-notice')).toHaveTextContent(
      /^Secret value stays visible until you save the test\.$/,
    )
  })

  it('names the Function as what to save for a secret of the library View', () => {
    renderModal({ variable: { isSecret: true, name: 'token' }, secretUnlocked: true, secretChanged: true, secretSaveTarget: 'Function' })
    expect(within(getModal()).getByTestId('inspect-secret-notice')).toHaveTextContent(
      /^Secret value stays visible until you save the Function\.$/,
    )
  })

  it('shows no notice for an unlocked secret unchanged from the saved Test (a saved null secret)', () => {
    renderModal({
      variable: { isSecret: true, name: 'ssh_session', value: null },
      secretUnlocked: true,
      secretChanged: false,
    })
    expect(within(getModal()).queryByTestId('inspect-secret-notice')).not.toBeInTheDocument()
  })

  it('closes the modal when an unlocked secret re-locks (the save re-mask)', () => {
    const onClose = vi.fn()
    const props = modalProps({
      variable: { isSecret: true, name: 'token' },
      secretUnlocked: true,
      onClose,
    })
    const { rerender } = render(<VariableInspectModal {...props} />)
    rerender(<VariableInspectModal {...props} secretUnlocked={false} />)
    expect(onClose).toHaveBeenCalled()
  })

  it('serializes a table value to JSON for the Code view', async () => {
    const user = userEvent.setup()
    renderModal({ variable: { type: 'table', value: [{ id: 1, name: 'a' }] } })
    await switchView(user, 'Code')
    expect(within(getModal()).getByTestId('codemirror-editor')).toBeInTheDocument()
  })
})

// ===========================================================================
// Null values (VMGR-93, VMGR-94, VMGR-95; REQ-3.1.3.20)
// ===========================================================================

function nullLookTokens(): string[] {
  expect(typeof NULL_LOOK_CLASS).toBe('string')
  return NULL_LOOK_CLASS.split(/\s+/).filter(Boolean)
}

/** The one `null` text in the watcher carries the shared null-look class and no role. */
function expectNullLook(id = 'v1') {
  const nullText = within(getModal(id)).getByText('null')
  expect(nullText).toHaveClass(...nullLookTokens())
  expect(nullText).not.toHaveAttribute('role')
}

const ALL_TYPES = ['string', 'integer', 'float', 'boolean', 'array', 'map', 'table'] as const
const COMPLEX_TYPES = ['array', 'map', 'table'] as const
type NullShape = 'value null' | 'no value key'
const NULL_SHAPES: NullShape[] = ['value null', 'no value key']

function nullVariable(
  type: Variable['type'],
  shape: NullShape,
  extra: Partial<Variable> = {},
): Variable {
  const variable: Variable = { id: 'v1', name: 'user_name', type, ...extra }
  if (shape === 'value null') variable.value = null
  return variable
}

function renderNull(variable: Variable, overrides: ModalOverrides = {}) {
  return render(<VariableInspectModal {...modalProps(overrides)} variable={variable} />)
}

describe('VariableInspectModal - variables with no value', () => {
  it('shows the null look and no metric for a string with no value', () => {
    renderModal({ variable: { value: undefined } })
    expectNullLook()
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })

  it('never prints the literal word undefined or the label "not set"', () => {
    renderModal({ variable: { value: undefined } })
    expect(getModal().textContent).not.toContain('undefined')
    expect(getModal().textContent).not.toContain('not set')
  })

  it('shows the null look, not the empty line, for an array with no value', () => {
    renderModal({ variable: { value: undefined, type: 'array' } })
    expectNullLook()
    expect(within(getModal()).queryByText('no items')).not.toBeInTheDocument()
  })
})

describe('VariableInspectModal - null read view (VMGR-93, VMGR-94)', () => {
  const cases = ALL_TYPES.flatMap((type) => NULL_SHAPES.map((shape) => [type, shape] as const))

  it.each(cases)('shows the null look with no count when the %s variable holds %s', (type, shape) => {
    renderNull(nullVariable(type, shape))
    expectNullLook()
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
    expect(getModal().textContent).not.toContain('not set')
  })

  it.each(['string', 'array'] as const)('shows the null look in Initial mode when the %s variable holds null', async (type) => {
    const user = userEvent.setup()
    renderNull(nullVariable(type, 'value null'))
    await switchMode(user, 'Initial')
    expectNullLook()
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })

  it.each([
    ['string', 'bob'],
    ['integer', 7],
    ['boolean', true],
    ['array', ['a']],
    ['map', { a: 1 }],
    ['table', [{ id: 1 }]],
  ] as const)('shows the null look for a null live %s value in Current mode', (type, value) => {
    renderModal({
      variable: { type, value },
      runtimeValue: null,
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    expectNullLook()
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })

  it.each(COMPLEX_TYPES)('keeps the Visual / Code select for a null %s', async (type) => {
    const user = userEvent.setup()
    renderNull(nullVariable(type, 'value null'))
    expect(within(getModal()).getByTestId('view-dropdown')).toHaveTextContent(/^Visual$/)
    expect(await getViewOptions(user)).toEqual(['Visual', 'Code'])
  })

  it('keeps the format select for a null string', () => {
    renderNull(nullVariable('string', 'value null'))
    expect(within(getModal()).getByTestId('format-dropdown')).toBeInTheDocument()
  })

  it.each(COMPLEX_TYPES.flatMap((type) => NULL_SHAPES.map((shape) => [type, shape] as const)))(
    'shows null in the Code view, with no count, when the %s variable holds %s',
    async (type, shape) => {
      const user = userEvent.setup()
      renderNull(nullVariable(type, shape))
      await switchView(user, 'Code')
      const editor = await within(getModal()).findByTestId('codemirror-editor')
      expect(editor.textContent).toBe('null')
      expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
    },
  )

  it('reads a string holding the text "null" as an ordinary string', () => {
    renderModal({ variable: { type: 'string', value: 'null' } })
    const shown = within(getModal()).getAllByText('null')
    expect(shown).toHaveLength(1)
    expect(shown[0]).toHaveAttribute('data-testid', 'codemirror-editor')
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(/^4 chars$/)
  })

  it.each([
    ['array', [], 'no items', /^0 items$/],
    ['map', {}, 'no entries', /^0 keys$/],
    ['table', [], 'no rows', /^0 rows × 0 cols$/],
  ] as const)('keeps the empty line and the zero count for an empty %s', (type, value, line, metric) => {
    renderModal({ variable: { type, value } })
    expect(within(getModal()).getByText(line)).toBeInTheDocument()
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(metric)
    expect(within(getModal()).queryByText('null')).not.toBeInTheDocument()
  })

  it('keeps an empty string an empty value with a zero count', () => {
    renderModal({ variable: { type: 'string', value: '' } })
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(/^0 chars$/)
    expect(within(getModal()).queryByText('null')).not.toBeInTheDocument()
  })
})

describe('VariableInspectModal - expression / template with no source (VMGR-93)', () => {
  it.each(NULL_SHAPES)('shows the null look for an expression source holding %s in Initial', async (shape) => {
    const user = userEvent.setup()
    renderNull(nullVariable('string', shape, { name: 'api_url', isExpression: true }))
    await switchMode(user, 'Initial')
    expectNullLook()
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })

  it.each(NULL_SHAPES)('keeps "Not evaluated yet." for an expression holding %s in Current', (shape) => {
    renderNull(nullVariable('string', shape, { name: 'api_url', isExpression: true }), {
      runtimeAvailable: true,
    })
    expect(within(getModal()).getByText('Not evaluated yet.')).toBeInTheDocument()
    expect(getModal().textContent).not.toContain('not set')
  })

  it.each(NULL_SHAPES)('shows the null look for a template source holding %s in Initial', async (shape) => {
    const user = userEvent.setup()
    renderNull(nullVariable('string', shape, { name: 'greeting', isTemplate: true }))
    await switchMode(user, 'Initial')
    expectNullLook()
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })

  it.each(NULL_SHAPES)('keeps "Not rendered yet." for a template holding %s in Current', (shape) => {
    renderNull(nullVariable('string', shape, { name: 'greeting', isTemplate: true }))
    expect(within(getModal()).getByText('Not rendered yet.')).toBeInTheDocument()
    expect(getModal().textContent).not.toContain('not set')
  })
})

// ===========================================================================
// View only (VMGR-106, VMGR-18; REQ-3.1.3.11)
// ===========================================================================

// The edit half's controls and strips; none may appear in a watcher.
const EDIT_HALF_TEST_IDS = [
  'inspect-edit-button',
  'inspect-save-button',
  'inspect-cancel-button',
  'inspect-string-format-button',
  'inspect-format-button',
  'inspect-validation',
  'inspect-rename-input',
  'inspect-name-counter',
  'inspect-rename-notice',
  'inspect-readonly-hint',
] as const

function expectViewOnly(name: string, viewControls: string[]) {
  const modal = getModal()
  for (const testId of EDIT_HALF_TEST_IDS) {
    expect(within(modal).queryByTestId(testId)).not.toBeInTheDocument()
  }
  expect(within(modal).queryByText('read-only')).not.toBeInTheDocument()
  expect(within(modal).queryByRole('button', { name: /^(Edit|Save|Cancel)$/ })).not.toBeInTheDocument()
  expect(within(modal).queryByRole('button', { name: /^Format\b/ })).not.toBeInTheDocument()
  expect(within(modal).queryByRole('textbox', { name: /^Rename variable / })).not.toBeInTheDocument()
  expect(within(modal).getByTestId('inspect-variable-name')).toHaveTextContent(new RegExp(`^${name}$`))
  expect(within(modal).getAllByRole('combobox').map((control) => control.dataset.testid)).toEqual(
    viewControls,
  )
}

// The edit wiring a watcher took before it became view only; a watcher must ignore it.
const FORMER_EDIT_WIRING: object = {
  onVariableEdit: vi.fn(),
  onVariableRename: vi.fn(() => ({ success: true })),
  checkNameExists: () => false,
  validateExpressionCycle: () => null,
  onVariableCurrentEdit: vi.fn(),
  runStatus: 'paused',
}

function renderWithFormerEditWiring(overrides: ModalOverrides = {}, extra: object = {}) {
  const props = modalProps(overrides)
  render(<VariableInspectModal {...props} {...FORMER_EDIT_WIRING} {...extra} />)
  return props.variable
}

interface ViewOnlyCase {
  label: string
  overrides: ModalOverrides
  arrange?: (user: ReturnType<typeof userEvent.setup>) => Promise<void>
  viewControls: string[]
}

const VIEW_ONLY_CASES: ViewOnlyCase[] = [
  { label: 'a literal string in Current', overrides: {}, viewControls: ['mode-dropdown', 'format-dropdown'] },
  {
    label: 'a literal string in Initial',
    overrides: {},
    arrange: (user) => switchMode(user, 'Initial'),
    viewControls: ['mode-dropdown', 'format-dropdown'],
  },
  {
    label: 'a literal string in Compare',
    overrides: {},
    arrange: (user) => switchMode(user, 'Compare'),
    viewControls: ['mode-dropdown'],
  },
  { label: 'an integer', overrides: { variable: { type: 'integer', value: 7 } }, viewControls: ['mode-dropdown'] },
  {
    label: 'an array in the Code view',
    overrides: { variable: ARRAY_VARIABLE },
    arrange: (user) => switchView(user, 'Code'),
    viewControls: ['mode-dropdown', 'view-dropdown'],
  },
  {
    label: 'an expression',
    overrides: { variable: expressionVariable() },
    viewControls: ['mode-dropdown', 'view-dropdown'],
  },
  {
    label: 'a template',
    overrides: { variable: { isTemplate: true, value: 'Hello {{ user }}' } },
    viewControls: ['mode-dropdown', 'view-dropdown'],
  },
  {
    label: 'an unlocked secret',
    overrides: { variable: { isSecret: true, name: 'token' }, secretUnlocked: true },
    viewControls: ['mode-dropdown', 'format-dropdown'],
  },
  {
    label: 'a locked secret',
    overrides: { variable: { isSecret: true, name: 'tokens', type: 'array', value: '********' } },
    viewControls: ['mode-dropdown'],
  },
  {
    label: 'a whole null value',
    overrides: { variable: { type: 'integer', value: null } },
    viewControls: ['mode-dropdown'],
  },
  {
    label: 'a live value of a paused run',
    overrides: { sessionId: 'session-1', runtimeValue: 'alice', hasRuntimeValue: true, runtimeAvailable: true },
    viewControls: ['mode-dropdown', 'format-dropdown'],
  },
]

describe('VariableInspectModal - view only (VMGR-106, VMGR-18)', () => {
  it.each(VIEW_ONLY_CASES)(
    'offers no edit for $label: the footer keeps the Mode pill and the view controls',
    async ({ overrides, arrange, viewControls }) => {
      const user = userEvent.setup()
      const variable = renderWithFormerEditWiring(overrides)
      await arrange?.(user)
      expectViewOnly(variable.name, viewControls)
    },
  )

  it('opens in the view, never in edit, when asked to open in edit', () => {
    const variable = renderWithFormerEditWiring({}, { initialEditing: true, editNonce: 1 })
    expectViewOnly(variable.name, ['mode-dropdown', 'format-dropdown'])
  })

  it('keeps the Mode pill open, with its chevron, in every mode', async () => {
    const user = userEvent.setup()
    renderWithFormerEditWiring({}, { initialEditing: true })
    for (const mode of ['Initial', 'Compare', 'Current'] as const) {
      const pill = within(getModal()).getByTestId('mode-dropdown')
      expect(pill).toBeEnabled()
      expect(within(pill).getByTestId('mode-pill-chevron')).toBeInTheDocument()
      await switchMode(user, mode)
    }
    expect(within(getModal()).getByTestId('mode-dropdown')).toBeEnabled()
  })

  it('keeps a locked secret watcher open on mount and across parent renders (VMGR-11)', () => {
    const onClose = vi.fn()
    const props = modalProps({
      variable: { isSecret: true, name: 'token', value: '' },
      secretUnlocked: false,
      onClose,
    })
    const { rerender } = render(<VariableInspectModal {...props} />)
    rerender(<VariableInspectModal {...props} />)
    expect(onClose).not.toHaveBeenCalled()
    expect(within(getModal()).getByTestId('inspect-secret-masked').textContent).toBe('')
  })
})

// ===========================================================================
// Declared element types (REQ-3.1.3.19)
// ===========================================================================

describe('VariableInspectModal - declared element types', () => {
  const TYPED_MAP = {
    type: 'map' as const,
    value: { n: '16', f: '1.0', zip: '02134' },
    elementTypes: { n: 'integer' as const, f: 'float' as const, zip: 'string' as const },
  }

  function mapCells(): string[] {
    return within(within(getModal()).getByTestId('map-body'))
      .getAllByTestId('map-row')
      .map((row) => row.querySelectorAll('td')[1]?.textContent ?? '')
  }

  it('shows the definition\'s numbers as numbers and its text quoted in Initial', async () => {
    const user = userEvent.setup()
    renderModal({ variable: TYPED_MAP })
    await switchMode(user, 'Initial')
    expect(mapCells()).toEqual(['16', '1.0', '"02134"'])
  })

  it('shows a live map with the element types its full read reports', async () => {
    mockGetSessionVariables.mockResolvedValue({
      user_name: { value: { n: 17, f: '2.0', zip: '02134' }, type: 'map', elementTypes: TYPED_MAP.elementTypes },
    })
    renderModal({
      variable: TYPED_MAP,
      runtimeValue: { count: 3, changed: true },
      hasRuntimeValue: true,
      runtimeAvailable: true,
      sessionId: 'session-1',
    })
    await within(getModal()).findByTestId('map-body')
    expect(mapCells()).toEqual(['17', '2.0', '"02134"'])
  })

  it('writes each element as its declared type in the Code view', async () => {
    const user = userEvent.setup()
    renderModal({ variable: TYPED_MAP })
    await switchMode(user, 'Initial')
    await user.click(within(getModal()).getByTestId('view-dropdown'))
    await user.click(await screen.findByRole('option', { name: 'Code' }))
    const editor = await within(getModal()).findByTestId('codemirror-editor')
    expect(editor.textContent).toBe('{\n  "n": 16,\n  "f": 1.0,\n  "zip": "02134"\n}')
  })
})
