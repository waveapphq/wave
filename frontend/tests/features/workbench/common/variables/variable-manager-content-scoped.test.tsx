/**
 * VariableManagerContent - Function-scoped layout (REQ-3.1.1.5).
 *
 * Contract (FN-VMGR-1, FN-VMGR-2, FN-VMGR-3, FN-VMGR-4, FN-PARAM-1):
 *   - When `scope.insideFunction === false` (or scope is omitted), the panel
 *     renders today's flat list - no PARAMETERS group, no INPUTS/OUTPUTS
 *     sub-separators, and the "+ Add" button is single-action.
 *   - When `scope.insideFunction === true`:
 *       * A collapsible PARAMETERS group renders ABOVE the existing list.
 *         The group has a header containing the text "PARAMETERS".
 *       * Inside the group, an "INPUTS" sub-separator precedes input rows;
 *         an "OUTPUTS" sub-separator precedes output rows.
 *       * Variables whose name is in `scope.declaredInputNames` appear in
 *         the INPUTS section with the IN badge (testid: `in-badge-<id>`).
 *       * Variables whose name is in `scope.declaredOutputNames` appear in
 *         the OUTPUTS section with the existing OUT badge.
 *       * Other variables (Function-local) appear in a collapsible
 *         "VARIABLES" group below PARAMETERS.
 *       * Variables whose name is NOT in `scope.allowedVarNames` are
 *         filtered out entirely.
 *       * The "+ Add" button morphs to "+ Add ▾" and opens a dropdown
 *         with Input parameter / Output parameter / Variable entries.
 *
 * REQ scope: REQ-3.1.1.4, REQ-3.1.1.5, REQ-3.1.2.1.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// CodeMirror-backed value bodies render inside the create modal the panel now
// mounts; stub them so these unit tests don't pull the real editor.
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value }: { value: string }) => (
    <div data-testid="codemirror-editor">{value}</div>
  ),
}))
vi.mock('@/lib/codemirror/plain-text-editor', () => ({
  createPlainTextEditorExtensions: () => [],
}))

import { VariableManagerContent } from '@/features/workbench/common/variables/variable-manager-content/content'
import type {
  Variable,
  VariableManagerContentProps,
} from '@/features/workbench/common/variables/variable-manager-content/types'

// The +Add callback is a create handler
// (onCreateVariable) on VariableManagerContentProps; the panel mounts the
// create modal locally and the +Add dropdown opens it in the chosen mode. The
// test's local FunctionScope is a structural subset of the real one, so the
// scope prop is cast at the boundary.
type ScopedProps = VariableManagerContentProps & {
  scope?: FunctionScope
}
function ScopedContent(props: ScopedProps) {
  return <VariableManagerContent {...(props as unknown as VariableManagerContentProps)} />
}

// Mock the heavy editor-modal dispatcher so unit tests don't pull CodeMirror
// or the lazy-loaded array/map/table editors.
vi.mock(
  '@/features/workbench/common/variables/variable-manager-content/variable-editor-modals',
  () => ({
    VariableEditorModals: () => null,
  }),
)

interface FunctionScope {
  insideFunction: boolean
  declaredInputNames: string[]
  declaredOutputNames: string[]
  allowedVarNames: Set<string>
}

function variable(overrides: Partial<Variable> = {}): Variable {
  return {
    id: `var-${Math.random().toString(36).slice(2)}`,
    name: 'tmp',
    value: 'value',
    type: 'string',
    ...overrides,
  }
}

const baseProps: VariableManagerContentProps = {
  variables: [],
  runtimeValues: new Map(),
  isExecuting: false,
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Outside a Function
// ---------------------------------------------------------------------------

describe('VariableManagerContent - outside Function (scope omitted or insideFunction=false)', () => {
  it('does NOT render a PARAMETERS group when scope is omitted', () => {
    render(<ScopedContent {...baseProps} onCreateVariable={vi.fn(() => ({ success: true }))} />)
    expect(screen.queryByText(/^PARAMETERS$/)).not.toBeInTheDocument()
  })

  it('does NOT render a PARAMETERS group when scope.insideFunction is false', () => {
    const scope: FunctionScope = {
      insideFunction: false,
      declaredInputNames: [],
      declaredOutputNames: [],
      allowedVarNames: new Set(),
    }
    render(
      <ScopedContent
        {...baseProps}
        onCreateVariable={vi.fn(() => ({ success: true }))}
        scope={scope}
      />,
    )
    expect(screen.queryByText(/^PARAMETERS$/)).not.toBeInTheDocument()
  })

  it('renders the single-action "+ Add" button (no dropdown chevron) when not inside a Function', () => {
    render(<ScopedContent {...baseProps} onCreateVariable={vi.fn(() => ({ success: true }))} />)
    const btn = screen.getByTestId('add-variable-button')
    expect(btn).toBeInTheDocument()
    // No dropdown-trigger testid - the button is a direct click target.
    expect(screen.queryByTestId('add-variable-dropdown-trigger')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Inside a Function - PARAMETERS group
// ---------------------------------------------------------------------------

describe('VariableManagerContent - inside Function (scope.insideFunction=true)', () => {
  const variables: Variable[] = [
    variable({ id: 'i1', name: 'user_id', type: 'string' }),
    variable({ id: 'i2', name: 'count', type: 'integer' }),
    variable({ id: 'o1', name: 'result', type: 'string' }),
    variable({ id: 'l1', name: 'tmp', type: 'integer' }),
  ]

  const scope: FunctionScope = {
    insideFunction: true,
    declaredInputNames: ['user_id', 'count'],
    declaredOutputNames: ['result'],
    allowedVarNames: new Set(['user_id', 'count', 'result', 'tmp']),
  }

  function renderScoped(extra: Partial<VariableManagerContentProps> = {}) {
    return render(
      <ScopedContent
        {...baseProps}
        variables={variables}
        onCreateVariable={vi.fn(() => ({ success: true }))}
        scope={scope}
        {...extra}
      />,
    )
  }

  it('renders the PARAMETERS group header', () => {
    renderScoped()
    expect(screen.getByText(/^PARAMETERS$/)).toBeInTheDocument()
  })

  it('renders an INPUTS sub-separator inside the PARAMETERS group', () => {
    renderScoped()
    expect(screen.getByText(/^INPUTS$/)).toBeInTheDocument()
  })

  it('renders an OUTPUTS sub-separator inside the PARAMETERS group', () => {
    renderScoped()
    expect(screen.getByText(/^OUTPUTS$/)).toBeInTheDocument()
  })

  it('renders a VARIABLES group header for Function-local variables', () => {
    renderScoped()
    expect(screen.getByText(/^VARIABLES$/)).toBeInTheDocument()
  })

  it('renders declared input rows with an IN badge', () => {
    renderScoped()
    expect(screen.getByTestId('in-badge-i1')).toBeInTheDocument()
    expect(screen.getByTestId('in-badge-i2')).toBeInTheDocument()
    // The local var does NOT get an IN badge.
    expect(screen.queryByTestId('in-badge-l1')).not.toBeInTheDocument()
  })

  it('renders declared output rows with the existing OUT badge', () => {
    renderScoped()
    expect(screen.getByTestId('out-badge-o1')).toBeInTheDocument()
    // Inputs do NOT carry an OUT badge.
    expect(screen.queryByTestId('out-badge-i1')).not.toBeInTheDocument()
  })

  it('filters out variables whose name is not in scope.allowedVarNames', () => {
    const noisy = [...variables, variable({ id: 'orphan', name: 'system_env' })]
    render(
      <ScopedContent
        {...baseProps}
        variables={noisy}
        onCreateVariable={vi.fn(() => ({ success: true }))}
        scope={scope}
      />,
    )
    expect(screen.queryByTestId('variable-row-orphan')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// "+ Add" -> "+ Add ▾" dropdown
// ---------------------------------------------------------------------------

describe('VariableManagerContent - "+ Add ▾" dropdown when inside a Function', () => {
  const scope: FunctionScope = {
    insideFunction: true,
    declaredInputNames: [],
    declaredOutputNames: [],
    allowedVarNames: new Set(),
  }

  it('renders an Add dropdown trigger (with a chevron) instead of the single-action button', () => {
    render(
      <ScopedContent
        {...baseProps}
        onCreateVariable={vi.fn(() => ({ success: true }))}
        scope={scope}
      />,
    )
    expect(screen.getByTestId('add-variable-dropdown-trigger')).toBeInTheDocument()
  })

  it('opens a menu with Input parameter / Output parameter / Variable entries', async () => {
    const user = userEvent.setup()
    render(
      <ScopedContent
        {...baseProps}
        onCreateVariable={vi.fn(() => ({ success: true }))}
        scope={scope}
      />,
    )
    await user.click(screen.getByTestId('add-variable-dropdown-trigger'))
    expect(screen.getByRole('menuitem', { name: /Input parameter/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Output parameter/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Variable$/i })).toBeInTheDocument()
  })

  it('opens the create modal in input mode when Input parameter is selected', async () => {
    const user = userEvent.setup()
    render(
      <ScopedContent
        {...baseProps}
        onCreateVariable={vi.fn(() => ({ success: true }))}
        scope={scope}
      />,
    )
    await user.click(screen.getByTestId('add-variable-dropdown-trigger'))
    await user.click(screen.getByRole('menuitem', { name: /Input parameter/i }))
    expect(screen.getByTestId('variable-create-modal')).toBeInTheDocument()
    expect(screen.getByText('New input parameter')).toBeInTheDocument()
    expect(screen.getByTestId('create-role-badge')).toHaveTextContent('IN')
  })

  it('opens the create modal in output mode when Output parameter is selected', async () => {
    const user = userEvent.setup()
    render(
      <ScopedContent
        {...baseProps}
        onCreateVariable={vi.fn(() => ({ success: true }))}
        scope={scope}
      />,
    )
    await user.click(screen.getByTestId('add-variable-dropdown-trigger'))
    await user.click(screen.getByRole('menuitem', { name: /Output parameter/i }))
    expect(screen.getByText('New output parameter')).toBeInTheDocument()
    expect(screen.getByTestId('create-role-badge')).toHaveTextContent('OUT')
  })

  it('opens the create modal in variable mode when Variable is selected', async () => {
    const user = userEvent.setup()
    render(
      <ScopedContent
        {...baseProps}
        onCreateVariable={vi.fn(() => ({ success: true }))}
        scope={scope}
      />,
    )
    await user.click(screen.getByTestId('add-variable-dropdown-trigger'))
    await user.click(screen.getByRole('menuitem', { name: /^Variable$/i }))
    expect(screen.getByText('New variable')).toBeInTheDocument()
  })

  // REQ-3.1.2.11, VMGR-112: an enum input is typed by its value type and carries a default.
  it('creates an Integer enum input with the allowed values 1 and 2 and the default 1', async () => {
    const user = userEvent.setup()
    const onCreateVariable = vi.fn((..._args: unknown[]) => ({ success: true }))
    render(<ScopedContent {...baseProps} onCreateVariable={onCreateVariable} scope={scope} />)
    const pickOption = async (trigger: HTMLElement, matches: (text: string) => boolean) => {
      await user.click(trigger)
      const options = await screen.findAllByRole('option')
      const option = options.find((o) => matches((o.textContent ?? '').trim()))
      if (!option) throw new Error('Select option not found')
      await user.click(option)
    }

    await user.click(screen.getByTestId('add-variable-dropdown-trigger'))
    await user.click(screen.getByRole('menuitem', { name: /Input parameter/i }))
    await user.type(screen.getByTestId('create-variable-name'), 'level')
    await pickOption(screen.getByTestId('create-type-select'), (text) => text.startsWith('Integer'))
    await user.click(screen.getByTestId('param-create-enum-checkbox'))
    // The caption carries the red star and its screen-reader word "required" (FIELD-12).
    const allowed = screen.getByLabelText(/^Allowed values\*? ?(required)?$/)
    await user.clear(allowed)
    await user.click(allowed)
    await user.paste('[1, 2]')
    await user.tab()
    const select = screen.getByTestId('enum-value-select')
    const defaultSelect = select.getAttribute('role') === 'combobox' ? select : within(select).getByRole('combobox')
    await pickOption(defaultSelect, (text) => text === '1')

    expect(screen.queryByTestId('create-enum-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('create-enum-default-error')).not.toBeInTheDocument()
    expect(screen.getByTestId('create-submit-button')).toBeEnabled()
    await user.click(screen.getByTestId('create-submit-button'))

    expect(onCreateVariable).toHaveBeenCalledTimes(1)
    const [mode, spec] = onCreateVariable.mock.calls[0]
    expect(mode).toBe('input')
    expect(spec).toEqual(
      expect.objectContaining({
        name: 'level',
        type: 'integer',
        required: true,
        enumValues: [1, 2],
        value: 1,
      }),
    )
    expect(spec).not.toHaveProperty('enumValueType')
    expect(spec).not.toHaveProperty('secret')
  })
})

// ---------------------------------------------------------------------------
// Section ordering
// ---------------------------------------------------------------------------

describe('VariableManagerContent - section ordering inside a Function', () => {
  it('renders PARAMETERS before VARIABLES in document order', () => {
    const scope: FunctionScope = {
      insideFunction: true,
      declaredInputNames: ['x'],
      declaredOutputNames: ['y'],
      allowedVarNames: new Set(['x', 'y', 'z']),
    }
    const variables: Variable[] = [
      variable({ id: 'i', name: 'x' }),
      variable({ id: 'o', name: 'y' }),
      variable({ id: 'l', name: 'z' }),
    ]
    render(
      <ScopedContent
        {...baseProps}
        variables={variables}
        onCreateVariable={vi.fn(() => ({ success: true }))}
        scope={scope}
      />,
    )

    const container = screen.getByTestId('variable-manager-content')
    const text = container.textContent ?? ''
    const paramsIdx = text.indexOf('PARAMETERS')
    const varsIdx = text.indexOf('VARIABLES')
    expect(paramsIdx).toBeGreaterThan(-1)
    expect(varsIdx).toBeGreaterThan(paramsIdx)
  })

  it('collapses the PARAMETERS group when the user clicks the header trigger', async () => {
    const user = userEvent.setup()
    const scope: FunctionScope = {
      insideFunction: true,
      declaredInputNames: ['x'],
      declaredOutputNames: [],
      allowedVarNames: new Set(['x']),
    }
    const variables: Variable[] = [variable({ id: 'i', name: 'x' })]
    render(
      <ScopedContent
        {...baseProps}
        variables={variables}
        onCreateVariable={vi.fn(() => ({ success: true }))}
        scope={scope}
      />,
    )
    // Click the PARAMETERS collapsible trigger to toggle it closed.
    await user.click(screen.getByTestId('var-group-parameters-trigger'))
    // Visible label still exists, but the chevron's rotate class is gone.
    const trigger = screen.getByTestId('var-group-parameters-trigger')
    const chevron = trigger.querySelector('svg')
    expect(chevron?.className.toString()).not.toMatch(/rotate-90/)
  })

  it('renders INPUTS sub-separator before OUTPUTS sub-separator', () => {
    const scope: FunctionScope = {
      insideFunction: true,
      declaredInputNames: ['x'],
      declaredOutputNames: ['y'],
      allowedVarNames: new Set(['x', 'y']),
    }
    const variables: Variable[] = [
      variable({ id: 'i', name: 'x' }),
      variable({ id: 'o', name: 'y' }),
    ]
    render(
      <ScopedContent
        {...baseProps}
        variables={variables}
        onCreateVariable={vi.fn(() => ({ success: true }))}
        scope={scope}
      />,
    )

    const container = screen.getByTestId('variable-manager-content')
    const text = container.textContent ?? ''
    const inputsIdx = text.indexOf('INPUTS')
    const outputsIdx = text.indexOf('OUTPUTS')
    expect(inputsIdx).toBeGreaterThan(-1)
    expect(outputsIdx).toBeGreaterThan(inputsIdx)
  })
})
