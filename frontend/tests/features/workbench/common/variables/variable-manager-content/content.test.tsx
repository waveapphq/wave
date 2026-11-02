/**
 * Tests for the Variable Manager panel content.
 *
 * The panel holds a header (uppercase title + "+ Add" button), a toolbar
 * (filter + sort dropdown) and a flat row list.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.1.3.12: Auto-refresh watched variables on change
 * REQ-3.2.2.18: Live variable values display
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The live-value refresh reports a failed read through the toast API; the provider lives in the app shell.
vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  useToast: () => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

// Watchers and the variable window read and write the live session through this API.
vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: {
    getSessionVariables: vi.fn(async () => ({})),
    setVariableOverride: vi.fn(async () => ({ name: '', value: null, pending: false })),
  },
}))

// The test-variables reveal reads the saved Test and its workflow.
const { fetchTestMock, fetchTestWorkflowMock } = vi.hoisted(() => ({
  fetchTestMock: vi.fn(),
  fetchTestWorkflowMock: vi.fn(),
}))
vi.mock('@/features/tests/api/crud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/tests/api/crud')>()),
  fetchTest: fetchTestMock,
  fetchTestWorkflow: fetchTestWorkflowMock,
}))

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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

// ---------------------------------------------------------------------------
// Mock the heavy editor-modal dispatcher so unit tests don't pull CodeMirror
// or the lazy-loaded array/map/table editors. The dispatcher's surface is
// covered by its own test file.
// ---------------------------------------------------------------------------
vi.mock(
  '@/features/workbench/common/variables/variable-manager-content/variable-editor-modals',
  () => ({
    VariableEditorModals: () => null,
  }),
)

// ---------------------------------------------------------------------------
// Pass-through spy on the real VirtualizedList so the props the panel hands
// it (slot pitch, window height) can be asserted while the rows stay real.
// ---------------------------------------------------------------------------
const { virtualizedListPropsSpy } = vi.hoisted(() => ({ virtualizedListPropsSpy: vi.fn() }))

vi.mock('@/components/ui/virtualized-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/virtualized-list')>()
  const ActualVirtualizedList = actual.VirtualizedList
  function SpiedVirtualizedList(props: VirtualizedListProps<Variable>) {
    virtualizedListPropsSpy(props)
    return <ActualVirtualizedList {...props} />
  }
  return { ...actual, VirtualizedList: SpiedVirtualizedList }
})

// ---------------------------------------------------------------------------
// Pass-through spy on the real DraggableSheet so each creation window's sheet
// id can be read while the sheets stay real.
// ---------------------------------------------------------------------------
const { sheetPropsSpy, refocusSheetSpy } = vi.hoisted(() => ({ sheetPropsSpy: vi.fn(), refocusSheetSpy: vi.fn() }))

vi.mock('@/components/shared/draggable-sheet', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shared/draggable-sheet')>()
  const ActualDraggableSheet = actual.DraggableSheet
  function SpiedDraggableSheet(props: DraggableSheetProps) {
    sheetPropsSpy(props)
    return <ActualDraggableSheet {...props} />
  }
  const refocusSheet = (sheetId: string) => {
    refocusSheetSpy(sheetId)
    return actual.refocusSheet(sheetId)
  }
  return { ...actual, DraggableSheet: SpiedDraggableSheet, refocusSheet }
})

import type { DraggableSheetProps } from '@/components/shared/draggable-sheet'
import type { VirtualizedListProps } from '@/components/ui/virtualized-list'
import { VARIABLE_LIST_FALLBACK_HEIGHT, INLINE_VARIABLE_ROW_HEIGHT } from '@/features/workbench/common/variables/variable-manager-content/types'
import { NULL_LOOK_CLASS } from '@/lib/variable-format'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { usePendingCurrentEdits } from '@/features/workbench/live/pending-current-edits'
import { workbenchApi } from '@/features/workbench/api/workbench'
import { scopedVariableKey } from '@/features/workbench/lib/variable-scope-key'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'

// Height the jsdom ResizeObserver mock reports for an element with no inline height.
const MEASURED_BODY_HEIGHT = 200

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createVariable(overrides: Partial<Variable> = {}): Variable {
  return {
    id: `var-${Math.random().toString(36).slice(2)}`,
    name: 'testVar',
    value: 'test value',
    type: 'string',
    ...overrides,
  }
}

/** The element holding the text `null` carries every class of the one null look (VMGR-93). */
function expectNullLook(element: HTMLElement) {
  expect(typeof NULL_LOOK_CLASS).toBe('string')
  for (const cls of NULL_LOOK_CLASS.split(/\s+/).filter(Boolean)) expect(element).toHaveClass(cls)
}

const baseProps: VariableManagerContentProps = {
  variables: [],
  runtimeValues: new Map(),
  isExecuting: false,
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  // The masking flags have loaded, every reveal off.
  useMaskingSettingsStore.setState({
    runOutput: false,
    testVariables: false,
    sharedVariables: false,
    credentialInputs: false,
    hydrated: true,
  })
})

// ===========================================================================
// Header
// ===========================================================================

describe('VariableManagerContent - header', () => {
  it('renders the panel content container with the variable-manager-content testid', () => {
    render(<VariableManagerContent {...baseProps} />)
    expect(screen.getByTestId('variable-manager-content')).toBeInTheDocument()
  })

  it('renders the uppercase VARIABLE MANAGER title', () => {
    render(<VariableManagerContent {...baseProps} />)
    // The element's text content must read "VARIABLE MANAGER" (uppercase
    // visible to the user, regardless of CSS uppercase tricks).
    expect(screen.getByText('VARIABLE MANAGER')).toBeInTheDocument()
  })

  it('renders the "+ Add" button in the header (testid: add-variable-button)', () => {
    render(
      <VariableManagerContent {...baseProps} onCreateVariable={vi.fn(() => ({ success: true }))} />,
    )
    expect(screen.getByTestId('add-variable-button')).toBeInTheDocument()
  })

  it('opens the create modal in variable mode when the + Add button is clicked', async () => {
    const user = userEvent.setup()

    render(
      <VariableManagerContent
        {...baseProps}
        onCreateVariable={vi.fn(() => ({ success: true }))}
      />,
    )

    await user.click(screen.getByTestId('add-variable-button'))
    expect(screen.getByTestId('variable-create-modal')).toBeInTheDocument()
    expect(screen.getByText('New variable')).toBeInTheDocument()
  })

  it('does NOT render a count badge next to the title', () => {
    const variables = [
      createVariable({ id: 'v1', name: 'a' }),
      createVariable({ id: 'v2', name: 'b' }),
    ]

    render(
      <VariableManagerContent
        {...baseProps}
        variables={variables}
        onCreateVariable={vi.fn(() => ({ success: true }))}
      />,
    )

    // No element shows the bare numeric count "2" inside the panel header chrome.
    const header = screen.getByText('VARIABLE MANAGER').closest('div')
    expect(header).not.toBeNull()
    if (header) {
      // No standalone numeric badge.
      expect(within(header).queryByText(/^\s*2\s*$/)).not.toBeInTheDocument()
    }
  })

  it('does NOT render the legacy Watch List section', () => {
    render(<VariableManagerContent {...baseProps} />)
    expect(
      screen.queryByRole('region', { name: /watch list/i }),
    ).not.toBeInTheDocument()
  })

  it('does NOT render the legacy "All Variables" scope group header', () => {
    const variables = [createVariable({ id: 'v1', name: 'a' })]
    render(<VariableManagerContent {...baseProps} variables={variables} />)
    expect(
      screen.queryByRole('region', { name: /all variables/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/^All Variables$/)).not.toBeInTheDocument()
  })
})

// ===========================================================================
// Toolbar (filter + sort)
// ===========================================================================

describe('VariableManagerContent - toolbar', () => {
  it('renders the filter input with the searchbox role', () => {
    render(<VariableManagerContent {...baseProps} />)
    expect(
      screen.getByRole('searchbox', { name: /filter variables/i }),
    ).toBeInTheDocument()
  })

  it('names the filter input and turns off browser history and spellcheck for it', () => {
    render(<VariableManagerContent {...baseProps} />)

    const filter = screen.getByRole('searchbox', { name: /filter variables/i })
    expect(filter).toHaveAttribute('name', 'variable-filter')
    expect(filter).toHaveAttribute('autocomplete', 'off')
    expect(filter).toHaveAttribute('spellcheck', 'false')
  })

  it('renders the sort dropdown alongside the filter input', () => {
    render(<VariableManagerContent {...baseProps} />)
    // Sort dropdown is the shadcn Select trigger (role=combobox).
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('filters variables case-insensitively by name', async () => {
    const user = userEvent.setup()
    const variables = [
      createVariable({ id: '1', name: 'apiUrl' }),
      createVariable({ id: '2', name: 'apiKey' }),
      createVariable({ id: '3', name: 'timeout' }),
    ]

    render(<VariableManagerContent {...baseProps} variables={variables} />)

    await user.type(screen.getByRole('searchbox'), 'API')

    expect(screen.getByText('apiUrl')).toBeInTheDocument()
    expect(screen.getByText('apiKey')).toBeInTheDocument()
    expect(screen.queryByText('timeout')).not.toBeInTheDocument()
  })

  it('clears the filter when the X button is clicked', async () => {
    const user = userEvent.setup()
    const variables = [createVariable({ id: '1', name: 'foo' })]
    render(<VariableManagerContent {...baseProps} variables={variables} />)

    const input = screen.getByRole('searchbox')
    await user.type(input, 'xyz')

    await user.click(screen.getByRole('button', { name: /clear filter/i }))
    expect(input).toHaveValue('')
    expect(screen.getByText('foo')).toBeInTheDocument()
  })
})

// ===========================================================================
// List rendering & sort
// ===========================================================================

describe('VariableManagerContent - list rendering and sort', () => {
  it('renders variables sorted by name ascending by default (Name A-Z)', () => {
    const variables = [
      createVariable({ id: '1', name: 'zebra' }),
      createVariable({ id: '2', name: 'alpha' }),
      createVariable({ id: '3', name: 'mike' }),
    ]
    render(<VariableManagerContent {...baseProps} variables={variables} />)

    const rows = screen.getAllByTestId(/^variable-row-/)
    const names = rows
      .map((r) => r.textContent ?? '')
      .map((t) => t.match(/alpha|mike|zebra/)?.[0])
      .filter(Boolean)
    expect(names).toEqual(['alpha', 'mike', 'zebra'])
  })

  it('reorders variables when the sort dropdown selection changes', async () => {
    const user = userEvent.setup()
    const variables = [
      createVariable({ id: '1', name: 'alpha' }),
      createVariable({ id: '2', name: 'zebra' }),
      createVariable({ id: '3', name: 'mike' }),
    ]
    render(<VariableManagerContent {...baseProps} variables={variables} />)

    await user.click(screen.getByRole('combobox'))
    const option = await screen.findByRole('option', { name: /name z-a/i })
    await user.click(option)

    const rows = screen.getAllByTestId(/^variable-row-/)
    const names = rows
      .map((r) => r.textContent ?? '')
      .map((t) => t.match(/alpha|mike|zebra/)?.[0])
      .filter(Boolean)
    expect(names).toEqual(['zebra', 'mike', 'alpha'])
  })

  it('persists the sort selection to localStorage under "var-mgr.sort"', async () => {
    const user = userEvent.setup()
    const variables = [createVariable({ id: '1', name: 'foo' })]
    render(<VariableManagerContent {...baseProps} variables={variables} />)

    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: /name z-a/i }))

    expect(localStorage.getItem('var-mgr.sort')).toBe('name-desc')
  })

  it('reads the persisted sort selection from localStorage on mount', () => {
    localStorage.setItem('var-mgr.sort', 'type')
    const variables = [
      createVariable({ id: '1', name: 'a', type: 'string' }),
      createVariable({ id: '2', name: 'b', type: 'integer' }),
    ]
    render(<VariableManagerContent {...baseProps} variables={variables} />)
    // The trigger should reflect the persisted choice.
    expect(screen.getByText('Type')).toBeInTheDocument()
  })

  it('overlays runtimeValues onto each row when present', () => {
    const variables = [
      createVariable({
        id: 'v1',
        name: 'counter',
        value: 0,
        type: 'integer',
      }),
    ]
    const runtimeValues = new Map<string, unknown>([['counter', 99]])

    render(
      <VariableManagerContent
        {...baseProps}
        variables={variables}
        runtimeValues={runtimeValues}
      />,
    )

    // Default eye is ON (runtime), so the row should show 99 instead of 0.
    const value = screen.getByTestId('variable-value-v1')
    expect(value.textContent).toContain('99')
  })
})

// ===========================================================================
// Empty state
// ===========================================================================

describe('VariableManagerContent - virtualization', () => {
  const sixtyVariables = Array.from({ length: 60 }, (_, i) =>
    createVariable({ id: `v${i}`, name: `var_${String(i).padStart(3, '0')}` }),
  )
  // measured window / 63px rows = visible slots, plus the list's 5 overscan
  const LAST_VISIBLE_INDEX = Math.ceil(MEASURED_BODY_HEIGHT / INLINE_VARIABLE_ROW_HEIGHT) + 5

  it('renders the virtualized list above the threshold (>50 variables)', () => {
    render(<VariableManagerContent {...baseProps} variables={sixtyVariables} />)

    expect(screen.getByTestId('virtualized-list')).toBeInTheDocument()
  })

  it('draws every row of the visible window with its own name, not only the first slot', () => {
    render(<VariableManagerContent {...baseProps} variables={sixtyVariables} />)

    for (let i = 0; i <= LAST_VISIBLE_INDEX; i++) {
      expect(screen.getByTestId(`variable-name-v${i}`)).toHaveTextContent(
        `var_${String(i).padStart(3, '0')}`,
      )
    }
    expect(screen.queryByTestId(`variable-name-v${LAST_VISIBLE_INDEX + 1}`)).not.toBeInTheDocument()
    expect(screen.queryByTestId('variable-name-v59')).not.toBeInTheDocument()
  })

  it('sizes the virtualized window to the measured panel body, not a fixed window', () => {
    render(<VariableManagerContent {...baseProps} variables={sixtyVariables} />)

    const settled = virtualizedListPropsSpy.mock.calls.at(-1)?.[0]
    expect(settled).toEqual(expect.objectContaining({ containerHeight: MEASURED_BODY_HEIGHT }))
    expect(MEASURED_BODY_HEIGHT).not.toBe(VARIABLE_LIST_FALLBACK_HEIGHT)
  })

  it('falls back to the bounded window while the panel body is unmeasured', () => {
    const observe = vi.spyOn(window.ResizeObserver.prototype, 'observe').mockImplementation(() => {})
    try {
      render(<VariableManagerContent {...baseProps} variables={sixtyVariables} />)

      expect(virtualizedListPropsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ containerHeight: VARIABLE_LIST_FALLBACK_HEIGHT }),
      )
    } finally {
      observe.mockRestore()
    }
  })

  it('hands the shared inline row height to the virtualized list as the slot pitch', () => {
    render(<VariableManagerContent {...baseProps} variables={sixtyVariables} />)

    expect(virtualizedListPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        itemHeight: INLINE_VARIABLE_ROW_HEIGHT,
        containerHeight: MEASURED_BODY_HEIGHT,
      }),
    )

    const slot = screen.getByTestId('v1')
    expect(slot).toHaveAttribute('data-offset', String(INLINE_VARIABLE_ROW_HEIGHT))
    expect(slot.style.height).toBe(`${INLINE_VARIABLE_ROW_HEIGHT}px`)
    expect(slot).toContainElement(screen.getByTestId('variable-row-v1'))

    const spacer = screen
      .getByTestId('virtualized-list')
      .querySelector<HTMLElement>('[data-virtualized-spacer]')
    expect(spacer?.style.height).toBe(`${60 * INLINE_VARIABLE_ROW_HEIGHT}px`)
  })

  it('moves focus to the next drawn row on ArrowDown inside the virtualized list', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} variables={sixtyVariables} />)

    screen.getByTestId('variable-row-v0').focus()
    await user.keyboard('{ArrowDown}')

    expect(screen.getByTestId('variable-row-v1')).toHaveFocus()
  })
})

describe('VariableManagerContent - empty state', () => {
  it('shows the new empty-state copy when there are no variables', () => {
    render(
      <VariableManagerContent {...baseProps} onCreateVariable={vi.fn(() => ({ success: true }))} />,
    )
    expect(
      screen.getByText('No variables yet. Click + Add to create one.'),
    ).toBeInTheDocument()
  })

  it('keeps the filter input and Add button visible in the empty state', () => {
    render(
      <VariableManagerContent {...baseProps} onCreateVariable={vi.fn(() => ({ success: true }))} />,
    )
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
    expect(screen.getByTestId('add-variable-button')).toBeInTheDocument()
  })

  it('shows the snapshot empty-state copy in readOnly history workbench', () => {
    render(<VariableManagerContent {...baseProps} readOnly />)
    expect(
      screen.getByText('No variables in this snapshot.'),
    ).toBeInTheDocument()
  })

  it('shows the no-match empty state when the filter excludes everything', async () => {
    const user = userEvent.setup()
    const variables = [createVariable({ id: '1', name: 'alpha' })]
    render(<VariableManagerContent {...baseProps} variables={variables} />)

    await user.type(screen.getByRole('searchbox'), 'xyz')

    expect(screen.getByText('No variables match filter')).toBeInTheDocument()
  })
})

// ===========================================================================
// readOnly mode (history workbench)
// ===========================================================================

describe('VariableManagerContent - readOnly mode', () => {
  it('hides the + Add button even when onCreateVariable is provided', () => {
    render(
      <VariableManagerContent
        {...baseProps}
        onCreateVariable={vi.fn(() => ({ success: true }))}
        readOnly
      />,
    )
    expect(screen.queryByTestId('add-variable-button')).not.toBeInTheDocument()
  })

  it('disables the per-row edit pencil', () => {
    const variables = [createVariable({ id: 'v1' })]
    render(
      <VariableManagerContent
        {...baseProps}
        variables={variables}
        onVariableEdit={vi.fn()}
        readOnly
      />,
    )
    expect(screen.getByTestId('edit-button-v1')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('disables the per-row delete trash even when onVariableDelete is provided', () => {
    const variables = [createVariable({ id: 'v1' })]
    render(
      <VariableManagerContent
        {...baseProps}
        variables={variables}
        onVariableDelete={vi.fn()}
        readOnly
      />,
    )
    expect(screen.getByTestId('delete-button-v1')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('keeps the eye toggle usable in readOnly mode (snapshot inspection)', async () => {
    const user = userEvent.setup()
    const variables = [createVariable({ id: 'v1' })]
    render(
      <VariableManagerContent
        {...baseProps}
        variables={variables}
        readOnly
      />,
    )
    const eye = screen.getByTestId('view-toggle-button-v1')
    expect(eye).not.toHaveAttribute('aria-disabled', 'true')
    // Clicking should not throw.
    await user.click(eye)
  })
})

// ===========================================================================
// isExecuting mode
// ===========================================================================

describe('VariableManagerContent - isExecuting mode', () => {
  it('disables the per-row edit pencil while executing', () => {
    const variables = [createVariable({ id: 'v1' })]
    render(
      <VariableManagerContent
        {...baseProps}
        variables={variables}
        isExecuting
        runStatus="running"
        onVariableEdit={vi.fn()}
      />,
    )
    expect(screen.getByTestId('edit-button-v1')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('disables the per-row delete trash while executing', () => {
    const variables = [createVariable({ id: 'v1' })]
    render(
      <VariableManagerContent
        {...baseProps}
        variables={variables}
        isExecuting
        runStatus="running"
        onVariableDelete={vi.fn()}
      />,
    )
    expect(screen.getByTestId('delete-button-v1')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('keeps the + Add button visible while executing (only the rows lock)', () => {
    render(
      <VariableManagerContent
        {...baseProps}
        isExecuting
        onCreateVariable={vi.fn(() => ({ success: true }))}
      />,
    )
    expect(screen.getByTestId('add-variable-button')).toBeInTheDocument()
  })

  it('keeps the eye toggle usable while executing', () => {
    const variables = [createVariable({ id: 'v1' })]
    render(
      <VariableManagerContent
        {...baseProps}
        variables={variables}
        isExecuting
      />,
    )
    expect(screen.getByTestId('view-toggle-button-v1')).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})

// ===========================================================================
// Pencil and row delete follow the run state (VMGR-107)
// ===========================================================================

describe('VariableManagerContent - pencil and row delete follow the run state (VMGR-107)', () => {
  const rows = [createVariable({ id: 'v1', name: 'greeting', value: 'hello' })]
  const onVariableDelete = vi.fn()

  // The live container's flags: isExecuting holds while the run is running or paused.
  function runProps(runStatus: string): VariableManagerContentProps {
    return {
      ...baseProps,
      variables: rows,
      isExecuting: runStatus === 'running' || runStatus === 'paused',
      runStatus,
      onVariableEdit: vi.fn(),
      onVariableDelete,
      onCreateVariable: vi.fn(() => ({ success: true })),
    }
  }

  // Keyboard focus opens the tooltip at once, without the hover delay.
  async function tooltipOn(testId: string) {
    act(() => screen.getByTestId(testId).focus())
    return screen.findByRole('tooltip')
  }

  it.each(['idle', 'paused', 'passed', 'failed', 'stopped'])(
    'enables the pencil and the row delete while the run is %s',
    (runStatus) => {
      render(<VariableManagerContent {...runProps(runStatus)} />)

      expect(screen.getByTestId('edit-button-v1')).not.toHaveAttribute('aria-disabled')
      expect(screen.getByTestId('delete-button-v1')).not.toHaveAttribute('aria-disabled')
    },
  )

  it.each([
    ['edit-button-v1', 'Edit variable'],
    ['delete-button-v1', 'Delete variable'],
  ])('shows the %s tooltip "%s" while paused', async (testId, text) => {
    render(<VariableManagerContent {...runProps('paused')} />)

    expect(await tooltipOn(testId)).toHaveTextContent(new RegExp(`^${text}$`))
  })

  it('opens the Edit window from the pencil while paused', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...runProps('paused')} />)

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(screen.getByTestId('variable-create-modal')).toHaveAttribute('data-window-mode', 'edit')
  })

  it('deletes the row from its trash while paused', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...runProps('paused')} />)

    await user.click(screen.getByTestId('delete-button-v1'))

    expect(onVariableDelete).toHaveBeenCalledTimes(1)
    expect(onVariableDelete).toHaveBeenCalledWith('v1')
  })

  it('locks the pencil and the row delete while the run is running', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...runProps('running')} />)

    expect(screen.getByTestId('edit-button-v1')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('delete-button-v1')).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByTestId('edit-button-v1'))
    await user.click(screen.getByTestId('delete-button-v1'))
    expect(screen.queryByTestId('variable-create-modal')).not.toBeInTheDocument()
    expect(onVariableDelete).not.toHaveBeenCalled()
  })

  it.each(['edit-button-v1', 'delete-button-v1'])(
    'shows "Locked while the test is executing" on %s while the run is running',
    async (testId) => {
      render(<VariableManagerContent {...runProps('running')} />)

      expect(await tooltipOn(testId)).toHaveTextContent(/^Locked while the test is executing$/)
    },
  )

  it.each(['edit-button-v1', 'delete-button-v1'])(
    'shows "Read-only snapshot - editing is not available" on %s in a read-only snapshot',
    async (testId) => {
      render(<VariableManagerContent {...runProps('passed')} readOnly />)

      expect(screen.getByTestId(testId)).toHaveAttribute('aria-disabled', 'true')
      expect(await tooltipOn(testId)).toHaveTextContent(/^Read-only snapshot - editing is not available$/)
    },
  )

  it('keeps + Add enabled while the run is running', () => {
    render(<VariableManagerContent {...runProps('running')} />)

    expect(screen.getByTestId('add-variable-button')).toBeEnabled()
  })
})

// ===========================================================================
// Loading state
// ===========================================================================

describe('VariableManagerContent - loading state', () => {
  it('shows the skeleton while isLoading is true', () => {
    render(<VariableManagerContent {...baseProps} isLoading />)
    expect(screen.getByTestId('variable-manager-skeleton')).toBeInTheDocument()
  })
})

// ===========================================================================
// Keyboard navigation across rows
// ===========================================================================

describe('VariableManagerContent - keyboard navigation', () => {
  it('moves focus from one row to the next on ArrowDown', async () => {
    const user = userEvent.setup()
    const variables = [
      createVariable({ id: 'v1', name: 'alpha' }),
      createVariable({ id: 'v2', name: 'beta' }),
    ]

    render(<VariableManagerContent {...baseProps} variables={variables} />)

    const first = screen.getByTestId('variable-row-v1')
    first.focus()
    await user.keyboard('{ArrowDown}')

    expect(document.activeElement).toBe(screen.getByTestId('variable-row-v2'))
  })

  it('moves focus from one row to the previous on ArrowUp', async () => {
    const user = userEvent.setup()
    const variables = [
      createVariable({ id: 'v1', name: 'alpha' }),
      createVariable({ id: 'v2', name: 'beta' }),
    ]

    render(<VariableManagerContent {...baseProps} variables={variables} />)

    const second = screen.getByTestId('variable-row-v2')
    second.focus()
    await user.keyboard('{ArrowUp}')

    expect(document.activeElement).toBe(screen.getByTestId('variable-row-v1'))
  })
})

// ===========================================================================
// Variable inspect modal integration
// ===========================================================================

describe('VariableManagerContent - variable inspect modal', () => {
  const inspectVariables = [
    createVariable({ id: 'v1', name: 'greeting', value: 'hello', type: 'string' }),
  ]

  it('opens the inspect modal when a scalar row expand button is clicked', async () => {
    const user = userEvent.setup()
    render(
      <VariableManagerContent {...baseProps} variables={inspectVariables} />,
    )

    await user.click(screen.getByTestId('expand-button-v1'))

    expect(screen.getByTestId('variable-inspect-modal-v1')).toBeInTheDocument()
  })

  it('shows no "stays visible" strip in the watcher of an untouched saved null secret', async () => {
    const user = userEvent.setup()
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[createVariable({ id: 'v1', name: 'ssh_session', isSecret: true, value: null })]}
        unsavedSecretIds={new Set(['ssh_session'])}
        changedSecretIds={new Set()}
      />,
    )

    await user.click(screen.getByTestId('expand-button-v1'))

    expect(within(screen.getByTestId('variable-inspect-modal-v1')).queryByTestId('inspect-secret-notice')).not.toBeInTheDocument()
  })

  it('shows the "stays visible" strip in the watcher of a new or edited secret', async () => {
    const user = userEvent.setup()
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[createVariable({ id: 'v1', name: 'token', isSecret: true, value: 'sk-new' })]}
        unsavedSecretIds={new Set(['token'])}
        changedSecretIds={new Set(['token'])}
      />,
    )

    await user.click(screen.getByTestId('expand-button-v1'))

    expect(within(screen.getByTestId('variable-inspect-modal-v1')).getByTestId('inspect-secret-notice')).toBeInTheDocument()
  })

  it('forwards the unsaved-secret flag to the inspect modal when provided', async () => {
    const user = userEvent.setup()
    render(
      <VariableManagerContent
        {...baseProps}
        variables={inspectVariables}
        unsavedSecretIds={new Set(['greeting'])}
      />,
    )

    await user.click(screen.getByTestId('expand-button-v1'))

    expect(screen.getByTestId('variable-inspect-modal-v1')).toBeInTheDocument()
  })

  it('re-expanding an inspected variable focuses the existing modal instead of duplicating', async () => {
    const user = userEvent.setup()
    render(
      <VariableManagerContent {...baseProps} variables={inspectVariables} />,
    )

    await user.click(screen.getByTestId('expand-button-v1'))
    await user.click(screen.getByTestId('expand-button-v1'))

    expect(screen.getAllByTestId('variable-inspect-modal-v1')).toHaveLength(1)
  })

  it('marks the source row with the indigo indicator while its modal is open, clearing on close', async () => {
    const user = userEvent.setup()
    render(
      <VariableManagerContent {...baseProps} variables={inspectVariables} />,
    )

    expect(screen.getByTestId('variable-row-v1').className).not.toMatch(/indigo/)

    await user.click(screen.getByTestId('expand-button-v1'))
    expect(screen.getByTestId('variable-row-v1').className).toMatch(/indigo/)

    await user.click(
      screen.getByRole('button', { name: 'Close inspector for greeting' }),
    )
    expect(
      screen.queryByTestId('variable-inspect-modal-v1'),
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('variable-row-v1').className).not.toMatch(/indigo/)
  })

  it('drops restored watchers of locked secrets on mount (the refresh re-mask)', () => {
    // Persisted watchers restore per test; a LOCKED secret's watcher must not
    // come back (there is nothing it may show), and ALL of them must close,
    // not just the last-opened one.
    localStorage.setItem(
      'var-mgr.open-inspectors',
      JSON.stringify({ testId: 'test-1', names: ['tok1', 'tok2', 'plain'] }),
    )
    const variables = [
      createVariable({ id: 's1', name: 'tok1', isSecret: true, value: '********' }),
      createVariable({ id: 's2', name: 'tok2', isSecret: true, value: '********' }),
      createVariable({ id: 'p1', name: 'plain', value: 'visible' }),
    ]

    render(
      <VariableManagerContent
        {...baseProps}
        variables={variables}
        persistenceKey="test-1"
      />,
    )

    expect(screen.queryByTestId('variable-inspect-modal-s1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('variable-inspect-modal-s2')).not.toBeInTheDocument()
    expect(screen.getByTestId('variable-inspect-modal-p1')).toBeInTheDocument()
  })

  it('keeps the watcher of a secret holding no value open, so its Current value can be set (REQ-3.1.2.10)', async () => {
    const user = userEvent.setup()
    const variables = [createVariable({ id: 's1', name: 'api_key', isSecret: true, value: null })]

    render(<VariableManagerContent {...baseProps} variables={variables} />)
    await user.click(screen.getByTestId('expand-button-s1'))

    expect(screen.getByTestId('variable-inspect-modal-s1')).toBeInTheDocument()
  })

  it('closes EVERY open secret watcher when the test save re-locks them', async () => {
    const user = userEvent.setup()
    const variables = [
      createVariable({ id: 's1', name: 'tok1', isSecret: true, value: 'raw-1' }),
      createVariable({ id: 's2', name: 'tok2', isSecret: true, value: 'raw-2' }),
    ]
    const unlocked = { ...baseProps, variables, unsavedSecretIds: new Set(['tok1', 'tok2']) }

    const { rerender } = render(<VariableManagerContent {...unlocked} />)
    await user.click(screen.getByTestId('expand-button-s1'))
    await user.click(screen.getByTestId('expand-button-s2'))
    expect(screen.getByTestId('variable-inspect-modal-s1')).toBeInTheDocument()
    expect(screen.getByTestId('variable-inspect-modal-s2')).toBeInTheDocument()

    rerender(
      <VariableManagerContent
        {...baseProps}
        variables={variables}
        unsavedSecretIds={new Set()}
      />,
    )

    expect(screen.queryByTestId('variable-inspect-modal-s1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('variable-inspect-modal-s2')).not.toBeInTheDocument()
  })

  it('closes the modal when the variable is deleted', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <VariableManagerContent {...baseProps} variables={inspectVariables} />,
    )

    await user.click(screen.getByTestId('expand-button-v1'))
    expect(screen.getByTestId('variable-inspect-modal-v1')).toBeInTheDocument()

    rerender(<VariableManagerContent {...baseProps} variables={[]} />)

    expect(
      screen.queryByTestId('variable-inspect-modal-v1'),
    ).not.toBeInTheDocument()
  })

  it('keeps the watcher visible across a scope drill round-trip (size/position retained by the sheet)', async () => {
    // Drilling into a Function swaps the variables prop to the Function's
    // namespace and sets the scope; the open watcher must STAY VISIBLE
    // (rendered from the last-seen snapshot) and keep tracking the live
    // variable again after popping back. Watchers are never lost to drills.
    const user = userEvent.setup()
    const fnScope = {
      insideFunction: true,
      scopeId: 'fn-node-1',
      declaredInputNames: [],
      declaredOutputNames: [],
      allowedVarNames: new Set(['fn_local']),
    }
    const functionScopeVariables = [
      createVariable({ id: 'fn-local', name: 'fn_local', value: 1, type: 'integer' }),
    ]
    const { rerender } = render(
      <VariableManagerContent {...baseProps} variables={inspectVariables} />,
    )

    await user.click(screen.getByTestId('expand-button-v1'))
    expect(screen.getByTestId('variable-inspect-modal-v1')).toBeInTheDocument()

    // The store drill and the panel props change in one render, as in the workbench.
    act(() => {
      useWorkflowStore.setState({ drillPath: [{ nodeId: 'fn-node-1', label: 'Fn' }] })
      rerender(
        <VariableManagerContent
          {...baseProps}
          variables={functionScopeVariables}
          scope={fnScope}
        />,
      )
    })
    const drilledModal = screen.getByTestId('variable-inspect-modal-v1')
    expect(drilledModal).toBeInTheDocument()
    expect(within(drilledModal).getByTestId('scalar-body').textContent).toContain(
      'hello',
    )

    act(() => {
      useWorkflowStore.setState({ drillPath: [] })
      rerender(
        <VariableManagerContent {...baseProps} variables={inspectVariables} />,
      )
    })
    expect(screen.getByTestId('variable-inspect-modal-v1')).toBeInTheDocument()
    expect(screen.getByTestId('variable-row-v1').className).toMatch(/indigo/)
  })

  it('keeps a function-local watcher visible after popping back to root', async () => {
    const user = userEvent.setup()
    const fnScope = {
      insideFunction: true,
      scopeId: 'fn-node-1',
      declaredInputNames: [],
      declaredOutputNames: [],
      allowedVarNames: new Set(['fn_local']),
    }
    const functionScopeVariables = [
      createVariable({ id: 'fn-local', name: 'fn_local', value: 7, type: 'integer' }),
    ]
    act(() => {
      useWorkflowStore.setState({ drillPath: [{ nodeId: 'fn-node-1', label: 'Fn' }] })
    })
    const { rerender } = render(
      <VariableManagerContent
        {...baseProps}
        variables={functionScopeVariables}
        scope={fnScope}
      />,
    )

    await user.click(screen.getByTestId('expand-button-fn-local'))
    expect(
      screen.getByTestId('variable-inspect-modal-fn-local'),
    ).toBeInTheDocument()

    act(() => {
      useWorkflowStore.setState({ drillPath: [] })
      rerender(
        <VariableManagerContent {...baseProps} variables={inspectVariables} />,
      )
    })
    expect(
      screen.getByTestId('variable-inspect-modal-fn-local'),
    ).toBeInTheDocument()
  })

  it('keeps a restored watcher dormant when its variable no longer exists (deleted while away)', () => {
    localStorage.setItem(
      'var-mgr.open-inspectors',
      JSON.stringify({ testId: 'test-1', names: ['ghost_var'] }),
    )
    render(
      <VariableManagerContent
        {...baseProps}
        variables={inspectVariables}
        persistenceKey="test-1"
      />,
    )
    expect(
      screen.queryByTestId(/^variable-inspect-modal-/),
    ).not.toBeInTheDocument()
  })

  it('restores open watchers after a panel remount (navigation/reload)', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <VariableManagerContent
        {...baseProps}
        variables={inspectVariables}
        persistenceKey="test-1"
      />,
    )

    await user.click(screen.getByTestId('expand-button-v1'))
    expect(screen.getByTestId('variable-inspect-modal-v1')).toBeInTheDocument()

    unmount()
    render(
      <VariableManagerContent
        {...baseProps}
        variables={inspectVariables}
        persistenceKey="test-1"
      />,
    )

    expect(screen.getByTestId('variable-inspect-modal-v1')).toBeInTheDocument()
  })

  it('keeps restored watchers while the variable list is still loading after a reload', () => {
    localStorage.setItem(
      'var-mgr.open-inspectors',
      JSON.stringify({ testId: 'test-1', names: ['greeting', 'count'] }),
    )
    const loaded = [
      ...inspectVariables,
      createVariable({ id: 'v2', name: 'count', value: 3, type: 'integer' }),
    ]
    const { rerender } = render(
      <VariableManagerContent {...baseProps} variables={[]} persistenceKey="test-1" />,
    )
    expect(JSON.parse(localStorage.getItem('var-mgr.open-inspectors')!)).toEqual({
      testId: 'test-1',
      names: ['greeting', 'count'],
    })

    rerender(<VariableManagerContent {...baseProps} variables={loaded} persistenceKey="test-1" />)

    expect(screen.getByTestId('variable-inspect-modal-v1')).toBeInTheDocument()
    expect(screen.getByTestId('variable-inspect-modal-v2')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('var-mgr.open-inspectors')!)).toEqual({
      testId: 'test-1',
      names: ['greeting', 'count'],
    })
  })

  it('keeps restored watchers when the Test id arrives before its variable list', () => {
    localStorage.setItem(
      'var-mgr.open-inspectors',
      JSON.stringify({ testId: 'test-1', names: ['greeting'] }),
    )
    const { rerender } = render(
      <VariableManagerContent {...baseProps} variables={[]} persistenceKey={null} />,
    )
    rerender(<VariableManagerContent {...baseProps} variables={[]} persistenceKey="test-1" />)
    rerender(
      <VariableManagerContent {...baseProps} variables={inspectVariables} persistenceKey="test-1" />,
    )

    expect(screen.getByTestId('variable-inspect-modal-v1')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('var-mgr.open-inspectors')!)).toEqual({
      testId: 'test-1',
      names: ['greeting'],
    })
  })

  it('closes a restored watcher once its loaded variable is deleted', () => {
    localStorage.setItem(
      'var-mgr.open-inspectors',
      JSON.stringify({ testId: 'test-1', names: ['greeting'] }),
    )
    const { rerender } = render(
      <VariableManagerContent {...baseProps} variables={[]} persistenceKey="test-1" />,
    )
    rerender(
      <VariableManagerContent {...baseProps} variables={inspectVariables} persistenceKey="test-1" />,
    )
    expect(screen.getByTestId('variable-inspect-modal-v1')).toBeInTheDocument()

    rerender(<VariableManagerContent {...baseProps} variables={[]} persistenceKey="test-1" />)

    expect(screen.queryByTestId('variable-inspect-modal-v1')).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('var-mgr.open-inspectors')!)).toEqual({
      testId: 'test-1',
      names: [],
    })
  })

  it('keeps same-name watchers of other scopes when one scope restores, loads and deletes its own', () => {
    const fnKey = scopedVariableKey('count', ['fn-node-1'])
    localStorage.setItem(
      'var-mgr.open-inspectors',
      JSON.stringify({ testId: 'test-1', names: ['count', fnKey] }),
    )
    const fnScope = {
      insideFunction: true,
      scopeId: 'fn-node-1',
      declaredInputNames: [],
      declaredOutputNames: [],
      allowedVarNames: new Set(['count']),
    }
    act(() => {
      useWorkflowStore.setState({ drillPath: [{ nodeId: 'fn-node-1', label: 'Fn' }] })
    })
    try {
      const { rerender } = render(
        <VariableManagerContent {...baseProps} variables={[]} scope={fnScope} persistenceKey="test-1" />,
      )
      rerender(
        <VariableManagerContent
          {...baseProps}
          variables={[createVariable({ id: 'fn-count', name: 'count', value: 1, type: 'integer' })]}
          scope={fnScope}
          persistenceKey="test-1"
        />,
      )
      expect(screen.getByTestId('variable-inspect-modal-fn-count')).toBeInTheDocument()

      rerender(<VariableManagerContent {...baseProps} variables={[]} scope={fnScope} persistenceKey="test-1" />)

      expect(screen.queryByTestId('variable-inspect-modal-fn-count')).not.toBeInTheDocument()
      expect(JSON.parse(localStorage.getItem('var-mgr.open-inspectors')!)).toEqual({
        testId: 'test-1',
        names: ['count'],
      })
    } finally {
      act(() => {
        useWorkflowStore.setState({ drillPath: [] })
      })
    }
  })

  it('drops watchers when switching to another test (no cross-test bleed)', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <VariableManagerContent
        {...baseProps}
        variables={inspectVariables}
        persistenceKey="test-1"
      />,
    )

    await user.click(screen.getByTestId('expand-button-v1'))
    expect(screen.getByTestId('variable-inspect-modal-v1')).toBeInTheDocument()

    // The next test even has a variable with the SAME name - it must not
    // inherit the watcher.
    rerender(
      <VariableManagerContent
        {...baseProps}
        variables={[
          createVariable({ id: 'v9', name: 'greeting', value: 'other', type: 'string' }),
        ]}
        persistenceKey="test-2"
      />,
    )

    expect(
      screen.queryByTestId('variable-inspect-modal-v1'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByTestId('variable-inspect-modal-v9'),
    ).not.toBeInTheDocument()
  })

  it('does not restore watchers from a previously closed test (close drops them)', async () => {
    const user = userEvent.setup()
    const { rerender, unmount } = render(
      <VariableManagerContent
        {...baseProps}
        variables={inspectVariables}
        persistenceKey="test-1"
      />,
    )

    await user.click(screen.getByTestId('expand-button-v1'))

    // Closing the test transitions the key to null (no saved test open).
    rerender(
      <VariableManagerContent
        {...baseProps}
        variables={[]}
        persistenceKey={null}
      />,
    )
    unmount()

    render(
      <VariableManagerContent
        {...baseProps}
        variables={inspectVariables}
        persistenceKey="test-1"
      />,
    )
    expect(
      screen.queryByTestId('variable-inspect-modal-v1'),
    ).not.toBeInTheDocument()
  })

  it('threads the runtime overlay into the modal (Current shows the live value)', async () => {
    const user = userEvent.setup()
    const runtimeValues = new Map<string, unknown>([['greeting', 'live']])
    render(
      <VariableManagerContent
        {...baseProps}
        variables={inspectVariables}
        runtimeValues={runtimeValues}
      />,
    )

    await user.click(screen.getByTestId('expand-button-v1'))

    const modal = screen.getByTestId('variable-inspect-modal-v1')
    expect(within(modal).getByTestId('scalar-body').textContent).toContain(
      'live',
    )
  })

  it('threads edits from other surfaces into the open modal (live view)', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <VariableManagerContent {...baseProps} variables={inspectVariables} />,
    )

    await user.click(screen.getByTestId('expand-button-v1'))
    const modal = screen.getByTestId('variable-inspect-modal-v1')
    expect(within(modal).getByTestId('scalar-body').textContent).toContain(
      'hello',
    )

    rerender(
      <VariableManagerContent
        {...baseProps}
        variables={[
          createVariable({
            id: 'v1',
            name: 'greeting',
            value: 'edited elsewhere',
            type: 'string',
          }),
        ]}
      />,
    )

    expect(
      within(screen.getByTestId('variable-inspect-modal-v1')).getByTestId(
        'scalar-body',
      ).textContent,
    ).toContain('edited elsewhere')
  })
})

describe('VariableManagerContent - a restored watcher of a saved secret waits for the reveal (REQ-3.1.3.17)', () => {
  const savedToken = [createVariable({ id: 'v1', name: 'token', value: '********', isSecret: true })]
  const REVEALED = { variables: { token: { value: 'sk-real', type: 'string', secret: true } } }
  const MASKED = { variables: { token: { value: '********', type: 'string', secret: true, masked: true } } }

  const storedWatchers = () => JSON.parse(localStorage.getItem('var-mgr.open-inspectors')!)
  const watcherValue = () =>
    within(screen.getByTestId('variable-inspect-modal-v1')).getByTestId('codemirror-editor').textContent

  function deferDetail() {
    let resolve: (detail: unknown) => void = () => {}
    fetchTestMock.mockReturnValue(new Promise((r) => (resolve = r)))
    return (detail: unknown) => resolve(detail)
  }

  function renderRestored() {
    return render(<VariableManagerContent {...baseProps} variables={savedToken} persistenceKey="test-1" />)
  }

  beforeEach(() => {
    localStorage.setItem('var-mgr.open-inspectors', JSON.stringify({ testId: 'test-1', names: ['token'] }))
    fetchTestWorkflowMock.mockResolvedValue({ nodes: [], edges: [] })
    act(() => {
      useWorkflowStore.getState().setEditingTest('test-1', 'Test One')
    })
  })

  afterEach(() => {
    act(() => {
      useWorkflowStore.getState().clearEditingTest()
    })
  })

  it('keeps the watcher while the reveal read is pending, then shows the revealed value', async () => {
    useMaskingSettingsStore.setState({ testVariables: true })
    const resolveDetail = deferDetail()
    renderRestored()

    expect(screen.queryByTestId('variable-inspect-modal-v1')).not.toBeInTheDocument()
    expect(storedWatchers()).toEqual({ testId: 'test-1', names: ['token'] })

    await act(async () => resolveDetail(REVEALED))

    await waitFor(() => expect(watcherValue()).toBe('sk-real'))
    expect(storedWatchers()).toEqual({ testId: 'test-1', names: ['token'] })
  })

  it('closes the watcher once the reveal read returns the value masked', async () => {
    useMaskingSettingsStore.setState({ testVariables: true })
    const resolveDetail = deferDetail()
    renderRestored()
    expect(storedWatchers()).toEqual({ testId: 'test-1', names: ['token'] })

    await act(async () => resolveDetail(MASKED))

    await waitFor(() => expect(storedWatchers()).toEqual({ testId: 'test-1', names: [] }))
    expect(screen.queryByTestId('variable-inspect-modal-v1')).not.toBeInTheDocument()
  })

  it('keeps the watcher waiting, showing nothing, when the reveal read fails', async () => {
    useMaskingSettingsStore.setState({ testVariables: true })
    fetchTestMock.mockRejectedValue(new Error('network'))
    renderRestored()

    await waitFor(() => expect(fetchTestMock).toHaveBeenCalled())
    await act(async () => {})

    expect(screen.queryByTestId('variable-inspect-modal-v1')).not.toBeInTheDocument()
    expect(storedWatchers()).toEqual({ testId: 'test-1', names: ['token'] })
  })

  it('keeps the watcher while the masking settings load, then shows the value they reveal', async () => {
    useMaskingSettingsStore.setState({ hydrated: false })
    fetchTestMock.mockResolvedValue(REVEALED)
    renderRestored()

    expect(screen.queryByTestId('variable-inspect-modal-v1')).not.toBeInTheDocument()
    expect(storedWatchers()).toEqual({ testId: 'test-1', names: ['token'] })

    act(() => {
      useMaskingSettingsStore.setState({ testVariables: true, hydrated: true })
    })

    await waitFor(() => expect(watcherValue()).toBe('sk-real'))
    expect(storedWatchers()).toEqual({ testId: 'test-1', names: ['token'] })
  })

  it('closes the watcher once the masking settings load with the reveal off', () => {
    useMaskingSettingsStore.setState({ hydrated: false })
    renderRestored()
    expect(storedWatchers()).toEqual({ testId: 'test-1', names: ['token'] })

    act(() => {
      useMaskingSettingsStore.setState({ hydrated: true })
    })

    expect(storedWatchers()).toEqual({ testId: 'test-1', names: [] })
    expect(screen.queryByTestId('variable-inspect-modal-v1')).not.toBeInTheDocument()
    expect(fetchTestMock).not.toHaveBeenCalled()
  })
})

describe('VariableManagerContent - Current source for expression inspectors', () => {
  const exprVar = createVariable({
    id: 'v1',
    name: 'api_url',
    value: "'def/' + host",
    type: 'string',
    isExpression: true,
  })

  it('opens an expression inspector using the applied override source', async () => {
    const user = userEvent.setup()
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[exprVar]}
        appliedOverrides={new Map([['api_url', { expression: "'ovr/' + host", type: 'string' }]])}
      />,
    )
    await user.click(screen.getByTestId('expand-button-v1'))
    expect(screen.getByTestId('variable-inspect-modal-v1')).toBeInTheDocument()
  })

  it('opens an expression inspector beside a run-start literal when not overridden', async () => {
    const user = userEvent.setup()
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[exprVar]}
        runStartSnapshot={new Map([['api_url', "'base/' + host"]])}
      />,
    )
    await user.click(screen.getByTestId('expand-button-v1'))
    expect(screen.getByTestId('variable-inspect-modal-v1')).toBeInTheDocument()
  })

  it('opens an expression inspector falling back to the definition source when idle', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} variables={[exprVar]} />)
    await user.click(screen.getByTestId('expand-button-v1'))
    expect(screen.getByTestId('variable-inspect-modal-v1')).toBeInTheDocument()
  })
})

describe('VariableManagerContent - Current of a variable no run gave a value (REQ-3.2.1.5)', () => {
  const edited = createVariable({ id: 'v1', name: 'host', value: 'edited.example', type: 'string' })
  const atRunStart = new Map<string, unknown>([['host', 'run-start.example']])

  async function currentValueShown(runStatus: string) {
    const user = userEvent.setup()
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[edited]}
        runStartSnapshot={atRunStart}
        runStatus={runStatus}
      />,
    )
    await user.click(screen.getByTestId('expand-button-v1'))
    return within(screen.getByTestId('variable-inspect-modal-v1')).getByTestId('codemirror-editor')
      .textContent
  }

  it.each(['running', 'paused'])(
    'shows the value the run started with while the run is %s',
    async (runStatus) => {
      expect(await currentValueShown(runStatus)).toBe('run-start.example')
    },
  )

  it.each(['passed', 'failed', 'stopped', 'skipped'])(
    'shows the definition once the run has %s, as the next block run reads it',
    async (runStatus) => {
      expect(await currentValueShown(runStatus)).toBe('edited.example')
    },
  )

  it('shows the definition when a run did not start (idle with a session)', async () => {
    expect(await currentValueShown('idle')).toBe('edited.example')
  })
})

describe('VariableManagerContent - the row shows the value the next block run uses (REQ-3.2.1.6)', () => {
  const port = createVariable({ id: 'v1', name: 'port', value: 5, type: 'integer' })
  const url = createVariable({
    id: 'v1',
    name: 'url',
    value: "'def/' + host",
    type: 'string',
    isExpression: true,
  })
  const otherRunValue = new Map<string, unknown>([['other', 'ran']])

  function rowValue(variable: Variable, props: Partial<VariableManagerContentProps> = {}) {
    render(<VariableManagerContent {...baseProps} variables={[variable]} {...props} />)
    return screen.getByTestId('variable-value-v1')
  }

  it('shows a Current-mode value staged before any run', () => {
    const staged = new Map([['port', { value: 7, type: 'integer' }]])

    expect(rowValue(port, { appliedOverrides: staged }).textContent).toBe('7')
  })

  it('shows the definition while nothing is staged', () => {
    expect(rowValue(port).textContent).toBe('5')
  })

  it('shows a value staged on a variable that has none', () => {
    const unset = createVariable({ id: 'v1', name: 'port', value: undefined, type: 'integer' })
    const staged = new Map([['port', { value: 7, type: 'integer' }]])

    expect(rowValue(unset, { appliedOverrides: staged }).textContent).toBe('7')
  })

  it('shows the value a run gave over the staged one', () => {
    const staged = new Map([['port', { value: 7, type: 'integer' }]])
    const live = new Map<string, unknown>([['port', 9]])

    expect(rowValue(port, { appliedOverrides: staged, runtimeValues: live }).textContent).toBe('9')
  })

  it('still shows the definition in the definition view while a value is staged', async () => {
    const user = userEvent.setup()
    const staged = new Map([['port', { value: 7, type: 'integer' }]])
    const value = rowValue(port, { appliedOverrides: staged })

    await user.click(screen.getByTestId('view-toggle-button-v1'))

    expect(value.textContent).toBe('5')
  })

  it('keeps a staged secret value masked', () => {
    const secret = createVariable({ id: 'v1', name: 'port', value: 5, type: 'integer', isSecret: true })
    const staged = new Map([['port', { value: 7, type: 'integer' }]])

    expect(rowValue(secret, { appliedOverrides: staged }).textContent).toBe('********')
  })

  it('shows a staged expression source in place of the definition source', () => {
    const staged = new Map([['url', { expression: "'ovr/' + host", type: 'string' }]])

    expect(rowValue(url, { appliedOverrides: staged }).textContent).toBe("'ovr/' + host")
  })

  it('shows a staged template source in place of the definition source', () => {
    const template = createVariable({
      id: 'v1',
      name: 'url',
      value: 'http://{{ host }}',
      type: 'string',
      isTemplate: true,
    })
    const staged = new Map([['url', { template: 'https://{{ host }}', type: 'string' }]])

    expect(rowValue(template, { appliedOverrides: staged }).textContent).toBe('https://{{ host }}')
  })

  it('reads as not evaluated yet when the panel holds run values and the source was edited', () => {
    const staged = new Map([['url', { expression: "'ovr/' + host", type: 'string' }]])

    const value = rowValue(url, { appliedOverrides: staged, runtimeValues: otherRunValue })

    expect(value.textContent).toBe('<not evaluated yet>')
  })

  it('keeps the saved source in the definition view', async () => {
    const user = userEvent.setup()
    const staged = new Map([['url', { expression: "'ovr/' + host", type: 'string' }]])
    const value = rowValue(url, { appliedOverrides: staged, runtimeValues: otherRunValue })

    await user.click(screen.getByTestId('view-toggle-button-v1'))

    expect(value.textContent).toBe("'def/' + host")
  })
})

describe('VariableManagerContent - the row of a variable a live run gave no value (VMGR-19)', () => {
  const edited = createVariable({ id: 'v1', name: 'host', value: 'edited.example', type: 'string' })
  const atRunStart = new Map<string, unknown>([['host', 'run-start.example']])

  function rowValue(props: Partial<VariableManagerContentProps>, variable: Variable = edited) {
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[variable]}
        runStartSnapshot={atRunStart}
        {...props}
      />,
    )
    return screen.getByTestId('variable-value-v1')
  }

  it.each(['running', 'paused'])(
    'shows the value the run started with while the run is %s',
    (runStatus) => {
      expect(rowValue({ runStatus }).textContent).toBe('run-start.example')
    },
  )

  it.each(['passed', 'failed', 'stopped', 'skipped', 'idle'])(
    'shows the definition once the run is %s, as the next block run reads it',
    (runStatus) => {
      expect(rowValue({ runStatus }).textContent).toBe('edited.example')
    },
  )

  it.each<[string, unknown]>([
    ['without a value', undefined],
    ['null', null],
  ])('reads null in the null look while the run that started %s is paused', (_label, started) => {
    const givenLater = createVariable({ id: 'v1', name: 'port', value: 9874, type: 'integer' })
    const startedNull = new Map<string, unknown>([['port', started]])

    const value = rowValue({ runStatus: 'paused', runStartSnapshot: startedNull }, givenLater)

    expect(value.textContent).toBe('null')
    expectNullLook(within(value).getByText('null'))
  })

  it('shows the value the run gave over the one it started with', () => {
    const live = new Map<string, unknown>([['host', 'written.example']])

    expect(rowValue({ runStatus: 'paused', runtimeValues: live }).textContent).toBe('written.example')
  })

  it('shows a Current-mode value over the one the run started with', () => {
    const staged = new Map([['host', { value: 'staged.example', type: 'string' }]])

    const value = rowValue({ runStatus: 'running', appliedOverrides: staged })

    expect(value.textContent).toBe('staged.example')
  })

  it('still shows the saved value in the definition view while the run is paused', async () => {
    const user = userEvent.setup()
    const value = rowValue({ runStatus: 'paused' })

    await user.click(screen.getByTestId('view-toggle-button-v1'))

    expect(value.textContent).toBe('edited.example')
  })

  it('shows the definition of a variable the snapshot does not hold', () => {
    const value = rowValue({ runStatus: 'paused', runStartSnapshot: new Map() })

    expect(value.textContent).toBe('edited.example')
  })
})

describe('VariableManagerContent - Current of a variable a live run started without (VMGR-19)', () => {
  const givenLater = createVariable({ id: 'v1', name: 'port', value: 9874, type: 'integer' })
  const startedNull = new Map<string, unknown>([['port', undefined]])

  async function openCurrent(props: Partial<VariableManagerContentProps>) {
    const user = userEvent.setup()
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[givenLater]}
        runStartSnapshot={startedNull}
        {...props}
      />,
    )
    await user.click(screen.getByTestId('expand-button-v1'))
    return screen.getByTestId('variable-inspect-modal-v1')
  }

  async function currentBody(props: Partial<VariableManagerContentProps>) {
    return within(await openCurrent(props)).getByTestId('scalar-body').textContent
  }

  it.each(['running', 'paused'])('reads null in the null look while the run is %s', async (runStatus) => {
    const modal = await openCurrent({ runStatus })

    expectNullLook(within(modal).getByText('null'))
    expect(within(modal).queryByText('not set')).not.toBeInTheDocument()
  })

  it.each(['passed', 'failed', 'stopped', 'skipped', 'idle'])(
    'shows the definition once the run is %s',
    async (runStatus) => {
      expect(await currentBody({ runStatus })).toBe('9874')
    },
  )

  it('shows the value the run gave', async () => {
    const live = new Map<string, unknown>([['port', 7]])

    expect(await currentBody({ runStatus: 'paused', runtimeValues: live })).toBe('7')
  })

  it('shows a Current-mode value', async () => {
    const staged = new Map([['port', { value: 5, type: 'integer' }]])

    expect(await currentBody({ runStatus: 'paused', appliedOverrides: staged })).toBe('5')
  })
})

describe('VariableManagerContent - eye state when a session drops its last value (VMGR-10)', () => {
  const host = createVariable({ id: 'v1', name: 'host', value: 'saved.example', type: 'string' })

  it('keeps a row in the definition view', async () => {
    const user = userEvent.setup()
    const props = { ...baseProps, variables: [host], sessionId: 'sess-1', runStatus: 'passed' }
    const { rerender } = render(
      <VariableManagerContent {...props} runtimeValues={new Map([['host', 'ran.example']])} />,
    )
    await user.click(screen.getByTestId('view-toggle-button-v1'))
    expect(screen.getByTestId('variable-value-v1')).toHaveClass('italic')

    rerender(<VariableManagerContent {...props} runtimeValues={new Map()} />)

    expect(screen.getByTestId('variable-value-v1')).toHaveClass('italic')
  })
})

// ===========================================================================
// Create modal integration: the panel mounts VariableCreateModal locally,
// the + Add button opens it, and a successful create threads the create
// handler with the chosen mode and closes the modal.
// ===========================================================================

describe('VariableManagerContent - create modal', () => {
  it('threads the create handler with the variable mode and closes on a successful create', async () => {
    const user = userEvent.setup()
    const onCreateVariable = vi.fn(() => ({ success: true }))
    render(
      <VariableManagerContent {...baseProps} onCreateVariable={onCreateVariable} />,
    )

    await user.click(screen.getByTestId('add-variable-button'))
    await user.type(screen.getByTestId('create-variable-name'), 'fresh')
    await user.click(screen.getByTestId('create-submit-button'))

    expect(onCreateVariable).toHaveBeenCalledWith(
      'variable',
      expect.objectContaining({ name: 'fresh' }),
    )
    expect(screen.queryByTestId('variable-create-modal')).not.toBeInTheDocument()
  })

  it('does not mount the create modal in readOnly mode', () => {
    render(
      <VariableManagerContent
        {...baseProps}
        onCreateVariable={vi.fn(() => ({ success: true }))}
        readOnly
      />,
    )
    expect(screen.queryByTestId('variable-create-modal')).not.toBeInTheDocument()
  })
})

// ===========================================================================
// One creation window per Add, each keeping its own Function (VMGR-101, VMGR-102)
// ===========================================================================

describe('VariableManagerContent - one creation window per Add (VMGR-101, VMGR-102)', () => {
  type DrillPath = Array<{ nodeId: string; label: string }>
  const PATH_A: DrillPath = [{ nodeId: 'fn-a', label: 'Function_A' }]
  const PATH_B: DrillPath = [{ nodeId: 'fn-b', label: 'Function_B' }]

  function localFunction(id: string, label: string) {
    return {
      id,
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label,
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables: [] },
      },
    }
  }

  function functionScope(scopeId: string) {
    return {
      insideFunction: true,
      scopeId,
      declaredInputNames: [],
      declaredOutputNames: [],
      allowedVarNames: new Set<string>(),
    }
  }

  function drillTo(path: DrillPath) {
    useWorkflowStore.setState({
      nodes: [localFunction('fn-a', 'Function_A'), localFunction('fn-b', 'Function_B')] as never,
      drillPath: path,
    })
  }

  afterEach(() => {
    act(() => {
      useWorkflowStore.setState({ nodes: [] as never, drillPath: [] })
    })
  })

  const createWindows = () => screen.queryAllByTestId('variable-create-modal')
  const createSpy = () => vi.fn((..._args: unknown[]) => ({ success: true }))
  const cascade = (px: number) => `translate(calc(-50% + ${px}px), calc(-50% + ${px}px))`

  function addAtRoot(times: number) {
    for (let i = 0; i < times; i++) fireEvent.click(screen.getByTestId('add-variable-button'))
  }

  async function addFromMenu(user: ReturnType<typeof userEvent.setup>, entry: RegExp) {
    await user.click(screen.getByTestId('add-variable-dropdown-trigger'))
    await user.click(screen.getByRole('menuitem', { name: entry }))
  }

  async function nameAndCreate(user: ReturnType<typeof userEvent.setup>, sheet: HTMLElement, name: string) {
    await user.type(within(sheet).getByTestId('create-variable-name'), name)
    await user.click(within(sheet).getByTestId('create-submit-button'))
  }

  it('opens a second window on a second Add at the test root', () => {
    render(<VariableManagerContent {...baseProps} onCreateVariable={createSpy()} />)

    addAtRoot(2)

    expect(createWindows()).toHaveLength(2)
  })

  it('opens one window per Add inside a Function, each holding its own draft', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} onCreateVariable={createSpy()} scope={functionScope('fn-a')} />)

    await addFromMenu(user, /Input parameter/i)
    await addFromMenu(user, /Output parameter/i)

    expect(createWindows()).toHaveLength(2)
    const [inputWindow, outputWindow] = createWindows()
    expect(within(inputWindow).getByText('New input parameter')).toBeInTheDocument()
    expect(within(outputWindow).getByText('New output parameter')).toBeInTheDocument()
    await user.type(within(inputWindow).getByTestId('create-variable-name'), 'in_name')
    await user.type(within(outputWindow).getByTestId('create-variable-name'), 'out_name')
    expect(within(inputWindow).getByTestId('create-variable-name')).toHaveValue('in_name')
    expect(within(outputWindow).getByTestId('create-variable-name')).toHaveValue('out_name')
  })

  const settleFocus = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

  it('keeps the focus in the Name field of a window opened from the Add menu', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} onCreateVariable={createSpy()} scope={functionScope('fn-a')} />)

    await addFromMenu(user, /Output parameter/i)
    await settleFocus()

    const [outputWindow] = createWindows()
    expect(within(outputWindow).getByTestId('create-variable-name')).toHaveFocus()
    expect(screen.getByTestId('add-variable-dropdown-trigger')).not.toHaveFocus()
  })

  it('returns the focus to Add when the picked window closed before the menu did', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} onCreateVariable={createSpy()} scope={functionScope('fn-a')} />)

    await user.click(screen.getByTestId('add-variable-dropdown-trigger'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Output parameter/i }))
    fireEvent.click(within(createWindows()[0]).getByRole('button', { name: 'Close create form' }))
    await settleFocus()

    expect(createWindows()).toHaveLength(0)
    expect(screen.getByTestId('add-variable-dropdown-trigger')).toHaveFocus()
  })

  it('returns the focus to Add when the menu is dismissed without a pick', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} onCreateVariable={createSpy()} scope={functionScope('fn-a')} />)

    await user.click(screen.getByTestId('add-variable-dropdown-trigger'))
    await user.keyboard('{Escape}')
    await settleFocus()

    expect(createWindows()).toHaveLength(0)
    expect(screen.getByTestId('add-variable-dropdown-trigger')).toHaveFocus()
  })

  it('lets focus leave the open Add menu, so the window it opens keeps the focus it takes at open', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} onCreateVariable={createSpy()} scope={functionScope('fn-a')} />)

    await user.click(screen.getByTestId('add-variable-dropdown-trigger'))
    const outside = screen.getByPlaceholderText('Filter variables…')
    act(() => outside.focus())
    await settleFocus()

    expect(outside).toHaveFocus()
  })

  it('gives every window its own sheet id', () => {
    render(<VariableManagerContent {...baseProps} onCreateVariable={createSpy()} />)

    addAtRoot(2)

    const sheetIds = new Set(
      sheetPropsSpy.mock.calls
        .map(([props]) => props as DraggableSheetProps)
        .filter((props) => props['data-testid'] === 'variable-create-modal')
        .map((props) => props.sheetId),
    )
    expect(sheetIds.size).toBe(2)
    for (const sheetId of sheetIds) expect(sheetId).toMatch(/^variable-create-.+$/)
  })

  it('cascades each new window 24 px from the one before', () => {
    render(<VariableManagerContent {...baseProps} onCreateVariable={createSpy()} />)

    addAtRoot(3)

    expect(createWindows().map((sheet) => sheet.style.transform)).toEqual([
      cascade(0),
      cascade(24),
      cascade(48),
    ])
  })

  it('wraps the cascade every 8 windows and never caps the count', () => {
    render(<VariableManagerContent {...baseProps} onCreateVariable={createSpy()} />)

    addAtRoot(10)

    const windows = createWindows()
    expect(windows).toHaveLength(10)
    expect(windows[7].style.transform).toBe(cascade(168))
    expect(windows[8].style.transform).toBe(cascade(0))
    expect(windows[9].style.transform).toBe(cascade(24))
  })

  it('closes only the window whose Cancel is pressed', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} onCreateVariable={createSpy()} />)
    addAtRoot(2)
    expect(createWindows()).toHaveLength(2)
    const [first, second] = createWindows()
    await user.type(within(second).getByTestId('create-variable-name'), 'kept_draft')

    await user.click(within(first).getByTestId('create-cancel-button'))

    expect(createWindows()).toHaveLength(1)
    expect(within(createWindows()[0]).getByTestId('create-variable-name')).toHaveValue('kept_draft')
  })

  it('closes only the window whose Create succeeded', async () => {
    const user = userEvent.setup()
    const onCreateVariable = createSpy()
    render(<VariableManagerContent {...baseProps} onCreateVariable={onCreateVariable} />)
    addAtRoot(2)
    expect(createWindows()).toHaveLength(2)
    const [first, second] = createWindows()
    await user.type(within(first).getByTestId('create-variable-name'), 'first_draft')

    await nameAndCreate(user, second, 'second_var')

    expect(onCreateVariable).toHaveBeenCalledTimes(1)
    expect(onCreateVariable.mock.calls[0][0]).toBe('variable')
    expect(onCreateVariable.mock.calls[0][1]).toEqual(expect.objectContaining({ name: 'second_var' }))
    expect(createWindows()).toHaveLength(1)
    expect(within(createWindows()[0]).getByTestId('create-variable-name')).toHaveValue('first_draft')
  })

  it('creates into the Function a window was opened in after the author drills elsewhere', async () => {
    const user = userEvent.setup()
    const onCreateVariable = createSpy()
    const panel = (scopeId: string) => (
      <VariableManagerContent {...baseProps} onCreateVariable={onCreateVariable} scope={functionScope(scopeId)} />
    )
    act(() => drillTo(PATH_A))
    const { rerender } = render(panel('fn-a'))

    await addFromMenu(user, /Input parameter/i)
    await nameAndCreate(user, createWindows()[0], 'made_in_a')
    await addFromMenu(user, /Input parameter/i)
    act(() => drillTo(PATH_B))
    rerender(panel('fn-b'))
    await addFromMenu(user, /Input parameter/i)

    const windows = createWindows()
    expect(windows).toHaveLength(2)
    await nameAndCreate(user, windows[0], 'kept_from_a')
    await nameAndCreate(user, windows[1], 'made_in_b')

    const pathOf = (name: string) =>
      onCreateVariable.mock.calls.find((call) => (call[1] as { name?: string }).name === name)?.[2]
    expect(pathOf('made_in_a')).toBeDefined()
    expect(pathOf('kept_from_a')).toEqual(pathOf('made_in_a'))
    expect(pathOf('made_in_b')).toBeDefined()
    expect(pathOf('made_in_b')).not.toEqual(pathOf('made_in_a'))
  })

  it('creates at the Test root from a window opened there after the author drills into a Function', async () => {
    const user = userEvent.setup()
    const onCreateVariable = createSpy()
    const { rerender } = render(<VariableManagerContent {...baseProps} onCreateVariable={onCreateVariable} />)
    addAtRoot(1)
    act(() => drillTo(PATH_A))
    rerender(<VariableManagerContent {...baseProps} onCreateVariable={onCreateVariable} scope={functionScope('fn-a')} />)

    await nameAndCreate(user, createWindows()[0], 'root_var')

    expect(onCreateVariable).toHaveBeenCalledTimes(1)
    expect(onCreateVariable.mock.calls[0]).toEqual(['variable', expect.objectContaining({ name: 'root_var' }), []])
  })

  const renderedCreateSheetIds = () =>
    new Set(
      sheetPropsSpy.mock.calls
        .map(([props]) => props as DraggableSheetProps)
        .filter((props) => props['data-testid'] === 'variable-create-modal')
        .map((props) => props.sheetId),
    )

  it('gives a window added after a close the sheet id the closed window had', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} onCreateVariable={createSpy()} />)
    sheetPropsSpy.mockClear()
    addAtRoot(1)
    const [closedId] = renderedCreateSheetIds()

    await user.click(within(createWindows()[0]).getByTestId('create-cancel-button'))
    sheetPropsSpy.mockClear()
    addAtRoot(1)

    expect(createWindows()).toHaveLength(1)
    expect(renderedCreateSheetIds()).toEqual(new Set([closedId]))
  })

  it('gives the lowest free sheet id to a window added while others stay open', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} onCreateVariable={createSpy()} />)
    sheetPropsSpy.mockClear()
    addAtRoot(1)
    const [firstId] = renderedCreateSheetIds()
    addAtRoot(1)
    const secondId = [...renderedCreateSheetIds()].find((id) => id !== firstId)
    expect(secondId).toMatch(/^variable-create-.+$/)

    await user.click(within(createWindows()[0]).getByTestId('create-cancel-button'))
    sheetPropsSpy.mockClear()
    addAtRoot(1)

    expect(createWindows()).toHaveLength(2)
    const ids = renderedCreateSheetIds()
    expect(ids.size).toBeGreaterThan(0)
    for (const id of ids) expect([firstId, secondId]).toContain(id)
  })

  it('reopens a moved creation window where the author left it', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} onCreateVariable={createSpy()} />)
    addAtRoot(1)
    const handle = screen.getByTestId('variable-create-modal-drag-handle')
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 130, clientY: 145 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(createWindows()[0].style.transform).toBe('translate(calc(-50% + 30px), calc(-50% + 45px))')

    await user.click(within(createWindows()[0]).getByTestId('create-cancel-button'))
    addAtRoot(1)

    expect(createWindows()[0].style.transform).toBe('translate(calc(-50% + 30px), calc(-50% + 45px))')
  })

  it('keeps a moved creation window place in browser storage so it outlives a page reload', () => {
    render(<VariableManagerContent {...baseProps} onCreateVariable={createSpy()} />)
    addAtRoot(1)
    const sheetId = [...renderedCreateSheetIds()][0] ?? ''
    expect(sheetId).toMatch(/^variable-create-.+$/)
    const handle = screen.getByTestId('variable-create-modal-drag-handle')
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 120, clientY: 110 })
    fireEvent.pointerUp(handle, { pointerId: 1 })

    const stored = JSON.parse(localStorage.getItem('draggable-sheet.geometry') ?? '{}')
    const { x, y } = stored[sheetId].offset as { x: number; y: number }
    expect(createWindows()[0].style.transform).toBe(`translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`)
  })
})

// ===========================================================================
// The pencil opens the variable's one window, filled (VMGR-106)
// ===========================================================================

describe('VariableManagerContent - the pencil opens the variable window filled (VMGR-106)', () => {
  const rows = [createVariable({ id: 'v1', name: 'greeting', value: 'hello', type: 'string' })]
  const editProps: VariableManagerContentProps = {
    ...baseProps,
    variables: rows,
    onVariableEdit: vi.fn(),
    onVariableCurrentEdit: vi.fn(),
  }

  const editWindows = () =>
    screen.queryAllByTestId('variable-create-modal').filter((node) => node.dataset.windowMode === 'edit')

  it('opens the window in Edit, titled "Edit variable" and filled with the row', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...editProps} />)

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(editWindows()).toHaveLength(1)
    const sheet = editWindows()[0]
    expect(within(sheet).getByText('Edit variable')).toBeInTheDocument()
    expect(within(sheet).getByTestId('create-variable-name')).toHaveValue('greeting')
    expect(within(sheet).getAllByDisplayValue('hello').length).toBeGreaterThan(0)
  })

  it('opens no watcher from the pencil', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...editProps} />)

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(screen.queryByTestId('variable-inspect-modal-v1')).not.toBeInTheDocument()
  })

  it('gives the Name field the focus when the pencil opens the window', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...editProps} />)

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(editWindows()).toHaveLength(1)
    await waitFor(() => expect(within(editWindows()[0]).getByTestId('create-variable-name')).toHaveFocus())
  })

  it('raises the open window instead of opening a second one for the same variable', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...editProps} />)
    await user.click(screen.getByTestId('edit-button-v1'))
    const sheetIds = new Set(
      sheetPropsSpy.mock.calls
        .map(([props]) => props as DraggableSheetProps)
        .filter((props) => props['data-testid'] === 'variable-create-modal')
        .map((props) => props.sheetId),
    )
    expect(sheetIds.size).toBe(1)
    refocusSheetSpy.mockClear()

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(editWindows()).toHaveLength(1)
    expect(refocusSheetSpy).toHaveBeenCalledWith([...sheetIds][0])
  })

  it('opens a saved secret\'s window at once with the Name field focused and the stored value masked', async () => {
    const user = userEvent.setup()
    const secret = createVariable({ id: 'v1', name: 'token', isSecret: true, value: '********' })
    render(<VariableManagerContent {...editProps} variables={[secret]} />)

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(screen.queryByText('Edit Protected Value?')).not.toBeInTheDocument()
    expect(editWindows()).toHaveLength(1)
    await waitFor(() => expect(within(editWindows()[0]).getByTestId('create-variable-name')).toHaveFocus())
    expect(within(editWindows()[0]).getByRole('button', { name: 'Value: Edit protected value' })).toBeInTheDocument()
  })

  it('asks before clearing only from the window\'s masked field, then shows the empty value field', async () => {
    const user = userEvent.setup()
    const secret = createVariable({ id: 'v1', name: 'token', isSecret: true, value: '********' })
    render(<VariableManagerContent {...editProps} variables={[secret]} />)
    await user.click(screen.getByTestId('edit-button-v1'))

    await user.click(within(editWindows()[0]).getByRole('button', { name: 'Value: Edit protected value' }))
    expect(screen.getByText('Edit Protected Value?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))

    expect(screen.queryByText('Edit Protected Value?')).not.toBeInTheDocument()
    expect(within(editWindows()[0]).queryByRole('button', { name: 'Value: Edit protected value' })).not.toBeInTheDocument()
    expect(within(editWindows()[0]).getByRole('textbox', { name: 'Value' })).toHaveValue('')
  })
})

// ===========================================================================
// An Edit window closes when the canvas drills to another scope (VMGR-102, VMGR-106)
// ===========================================================================

describe('VariableManagerContent - an Edit window closes when the canvas drills to another scope (VMGR-102, VMGR-106)', () => {
  type DrillPath = Array<{ nodeId: string; label: string }>
  type Where = 'root' | 'a' | 'b'
  const PATHS: Record<Where, DrillPath> = {
    root: [],
    a: [{ nodeId: 'fn-a', label: 'Function_A' }],
    b: [{ nodeId: 'fn-b', label: 'Function_B' }],
  }
  const ROWS: Record<Where, Variable[]> = {
    root: [createVariable({ id: 'v1', name: 'greeting', value: 'hello' })],
    a: [createVariable({ id: 'loc-a', name: 'loc_a', value: 'a' })],
    b: [createVariable({ id: 'loc-b', name: 'loc_b', value: 'b' })],
  }

  function localFunction(id: string, label: string, variables: Variable[]) {
    return {
      id,
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label,
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables },
      },
    }
  }

  const NODES = [localFunction('fn-a', 'Function_A', ROWS.a), localFunction('fn-b', 'Function_B', ROWS.b)]
  const onVariableEdit = vi.fn()
  const onVariableCurrentEdit = vi.fn()
  const onCreateVariable = vi.fn(() => ({ success: true }))

  /** Points the canvas at a scope and returns the panel as the container renders it there. */
  function shown(where: Where, rows: Variable[] = ROWS[where]) {
    act(() => {
      useWorkflowStore.setState({ nodes: NODES as never, variables: ROWS.root as never, drillPath: PATHS[where] })
    })
    const scope = where === 'root'
      ? undefined
      : {
          insideFunction: true,
          scopeId: PATHS[where][0].nodeId,
          declaredInputNames: [],
          declaredOutputNames: [],
          allowedVarNames: new Set(rows.map((row) => row.name)),
        }
    return (
      <VariableManagerContent
        {...baseProps}
        variables={rows}
        scope={scope}
        onVariableEdit={onVariableEdit}
        onVariableCurrentEdit={onVariableCurrentEdit}
        onCreateVariable={onCreateVariable}
      />
    )
  }

  const windowsIn = (mode: 'add' | 'edit') =>
    screen.queryAllByTestId('variable-create-modal').filter((node) => node.dataset.windowMode === mode)
  const storeSnapshot = () => JSON.stringify({
    nodes: useWorkflowStore.getState().nodes,
    variables: useWorkflowStore.getState().variables,
  })

  function expectNothingWritten(before: string) {
    expect(onVariableEdit).not.toHaveBeenCalled()
    expect(onVariableCurrentEdit).not.toHaveBeenCalled()
    expect(onCreateVariable).not.toHaveBeenCalled()
    expect(storeSnapshot()).toBe(before)
  }

  afterEach(() => {
    act(() => {
      useWorkflowStore.setState({ nodes: [] as never, variables: [] as never, drillPath: [] })
      usePendingCurrentEdits.getState().clearAll()
    })
  })

  it('drops the unsaved change of an Edit window the drill closes, so no run is held for it', async () => {
    const user = userEvent.setup()
    const { rerender } = render(shown('root'))
    await user.click(screen.getByTestId('edit-button-v1'))
    expect(windowsIn('edit')).toHaveLength(1)
    const name = within(windowsIn('edit')[0]).getByTestId('create-variable-name')
    await user.clear(name)
    await user.type(name, 'renamed')
    expect(usePendingCurrentEdits.getState().pending.size).toBe(1)

    rerender(shown('a'))

    expect(windowsIn('edit')).toHaveLength(0)
    expect(usePendingCurrentEdits.getState().pending.size).toBe(0)
  })

  it('closes an Edit window opened at the Test root when the canvas drills into a Function, writing nothing', async () => {
    const user = userEvent.setup()
    const { rerender } = render(shown('root'))
    await user.click(screen.getByTestId('edit-button-v1'))
    expect(windowsIn('edit')).toHaveLength(1)
    const name = within(windowsIn('edit')[0]).getByTestId('create-variable-name')
    await user.clear(name)
    await user.type(name, 'renamed')
    const before = storeSnapshot()

    rerender(shown('a'))

    expect(windowsIn('edit')).toHaveLength(0)
    expectNothingWritten(before)
  })

  it('does not bring a closed Edit window back when the canvas returns to its scope', async () => {
    const user = userEvent.setup()
    const { rerender } = render(shown('root'))
    await user.click(screen.getByTestId('edit-button-v1'))
    expect(windowsIn('edit')).toHaveLength(1)

    rerender(shown('a'))
    rerender(shown('root'))

    expect(windowsIn('edit')).toHaveLength(0)
  })

  it('closes an Edit window opened in a Function when the canvas drills into another Function, writing nothing', async () => {
    const user = userEvent.setup()
    const { rerender } = render(shown('a'))
    await user.click(screen.getByTestId('edit-button-loc-a'))
    expect(windowsIn('edit')).toHaveLength(1)
    const before = storeSnapshot()

    rerender(shown('b'))

    expect(windowsIn('edit')).toHaveLength(0)
    expectNothingWritten(before)
  })

  it('closes an Edit window opened in a Function when the canvas returns to the Test root, writing nothing', async () => {
    const user = userEvent.setup()
    const { rerender } = render(shown('a'))
    await user.click(screen.getByTestId('edit-button-loc-a'))
    expect(windowsIn('edit')).toHaveLength(1)
    const before = storeSnapshot()

    rerender(shown('root'))

    expect(windowsIn('edit')).toHaveLength(0)
    expectNothingWritten(before)
  })

  it('keeps an Add window open across the drill that closes an Edit window', async () => {
    const user = userEvent.setup()
    const { rerender } = render(shown('root'))
    await user.click(screen.getByTestId('add-variable-button'))
    await user.click(screen.getByTestId('edit-button-v1'))
    expect(windowsIn('add')).toHaveLength(1)
    expect(windowsIn('edit')).toHaveLength(1)

    rerender(shown('a'))

    expect(windowsIn('add')).toHaveLength(1)
    expect(windowsIn('edit')).toHaveLength(0)
  })

  it('keeps an Edit window open while the canvas stays in its scope', async () => {
    const user = userEvent.setup()
    const { rerender } = render(shown('root'))
    await user.click(screen.getByTestId('edit-button-v1'))
    expect(windowsIn('edit')).toHaveLength(1)

    rerender(shown('root', [...ROWS.root, createVariable({ id: 'v2', name: 'added_later' })]))

    expect(windowsIn('edit')).toHaveLength(1)
  })
})

// ===========================================================================
// A window refuses a name of its own Function before Create (REQ-3.1.2.4)
// ===========================================================================

describe('VariableManagerContent - a window refuses a name its own Function uses (REQ-3.1.2.4)', () => {
  const PATH_A = [{ nodeId: 'fn-a', label: 'Function_A' }]
  const PATH_B = [{ nodeId: 'fn-b', label: 'Function_B' }]
  const ROWS_A = [createVariable({ id: 'loc-a', name: 'loc_n', type: 'integer', value: 1 })]
  const ROWS_B = [createVariable({ id: 'loc-b', name: 'only_b', value: 'b' })]

  function localFunction(id: string, label: string, variables: Variable[]) {
    return {
      id,
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label,
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables },
      },
    }
  }

  function shownIn(path: typeof PATH_A, rows: Variable[]) {
    act(() => {
      useWorkflowStore.setState({
        nodes: [localFunction('fn-a', 'Function_A', ROWS_A), localFunction('fn-b', 'Function_B', ROWS_B)] as never,
        drillPath: path,
      })
    })
    const scope = {
      insideFunction: true,
      scopeId: path[0].nodeId,
      declaredInputNames: [],
      declaredOutputNames: [],
      allowedVarNames: new Set(rows.map((row) => row.name)),
    }
    return (
      <VariableManagerContent
        {...baseProps}
        variables={rows}
        scope={scope}
        onCreateVariable={vi.fn(() => ({ success: true }))}
      />
    )
  }

  afterEach(() => {
    act(() => {
      useWorkflowStore.setState({ nodes: [] as never, drillPath: [] })
    })
  })

  async function inputWindowOfAThenDrillToB(user: ReturnType<typeof userEvent.setup>) {
    const { rerender } = render(shownIn(PATH_A, ROWS_A))
    await user.click(screen.getByTestId('add-variable-dropdown-trigger'))
    await user.click(screen.getByRole('menuitem', { name: /Input parameter/i }))
    rerender(shownIn(PATH_B, ROWS_B))
    return screen.getByTestId('variable-create-modal')
  }

  it('refuses in an input window the name of a local of its Function after the author drills elsewhere', async () => {
    const user = userEvent.setup()
    const sheet = await inputWindowOfAThenDrillToB(user)

    await user.type(within(sheet).getByTestId('create-variable-name'), 'loc_n')

    expect(within(sheet).getByTestId('create-name-error')).toHaveTextContent(
      /^A variable with this name already exists$/,
    )
    expect(within(sheet).getByTestId('create-submit-button')).toBeDisabled()
  })

  it('shows "Name is required" in a new input window before anything is typed, with Create disabled (FIELD-12)', async () => {
    const user = userEvent.setup()
    render(shownIn(PATH_A, ROWS_A))
    await user.click(screen.getByTestId('add-variable-dropdown-trigger'))
    await user.click(screen.getByRole('menuitem', { name: /Input parameter/i }))
    const sheet = screen.getByTestId('variable-create-modal')

    expect(within(sheet).getByTestId('create-name-error')).toHaveTextContent(/^Name is required$/)
    expect(within(sheet).getByTestId('create-variable-name')).toHaveAttribute('aria-invalid', 'true')
    expect(within(sheet).getByTestId('create-submit-button')).toBeDisabled()
  })

  it('accepts in an input window a name free in its Function though the shown Function uses it', async () => {
    const user = userEvent.setup()
    const sheet = await inputWindowOfAThenDrillToB(user)

    await user.type(within(sheet).getByTestId('create-variable-name'), 'only_b')

    expect(within(sheet).queryByTestId('create-name-error')).not.toBeInTheDocument()
  })
})

// ===========================================================================
// A watcher reads a Function's full list, map or table from that Function (REQ-3.2.2.18)
// ===========================================================================

describe('VariableManagerContent - a watcher reads the full value from its own scope (REQ-3.2.2.18)', () => {
  type DrillPath = Array<{ nodeId: string; label: string }>

  const SUMMARY = { changed: true, count: 2 }

  function functionScope(path: DrillPath, names: string[]) {
    return {
      insideFunction: true,
      scopeId: path.map((entry) => entry.nodeId).join('/'),
      declaredInputNames: [],
      declaredOutputNames: [],
      allowedVarNames: new Set(names),
    }
  }

  const lastRead = () => vi.mocked(workbenchApi.getSessionVariables).mock.lastCall

  async function openMapWatcher(name: string, path: DrillPath) {
    const user = userEvent.setup()
    act(() => {
      useWorkflowStore.setState({ drillPath: path })
    })
    const row = createVariable({ id: `${name}-row`, name, value: {}, type: 'map' })
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[row]}
        scope={path.length > 0 ? functionScope(path, [name]) : undefined}
        runtimeValues={new Map([[scopedVariableKey(name, path.map((entry) => entry.nodeId)), SUMMARY]])}
        sessionId="sess-1"
        runStatus="paused"
      />,
    )
    await user.click(screen.getByTestId(`expand-button-${name}-row`))
    await waitFor(() => expect(workbenchApi.getSessionVariables).toHaveBeenCalled())
  }

  afterEach(() => {
    act(() => {
      useWorkflowStore.setState({ drillPath: [] })
    })
  })

  it('reads the full value of a Function local map from that Function', async () => {
    await openMapWatcher('loc_map', [{ nodeId: 'fn-a', label: 'Function_A' }])
    expect(lastRead()).toEqual(['sess-1', ['loc_map'], ['fn-a']])
  })

  it('reads the full value of a nested Function local map by the whole path, outermost first', async () => {
    await openMapWatcher('loc_map', [
      { nodeId: 'fn-a', label: 'Function_A' },
      { nodeId: 'fn-inner', label: 'Inner' },
    ])
    expect(lastRead()).toEqual(['sess-1', ['loc_map'], ['fn-a', 'fn-inner']])
  })

  it('reads a Test variable map from the Test scope, naming no Function', async () => {
    await openMapWatcher('root_map', [])
    expect(lastRead()?.slice(0, 2)).toEqual(['sess-1', ['root_map']])
    expect(lastRead()?.[2] ?? []).toEqual([])
  })
})

// ===========================================================================
// A read-only definition (a Function opened in View, a drilled-in Shared Function) takes only a Current value
// ===========================================================================

describe('VariableManagerContent - a read-only definition takes only a Current value (REQ-3.1.2.10)', () => {
  const rows = [createVariable({ id: 'v1', name: 'greeting', value: 'hello', type: 'string' })]
  const readOnlyScopeProps: VariableManagerContentProps = {
    ...baseProps,
    variables: rows,
    readOnly: true,
    onVariableEdit: vi.fn(),
    onVariableDelete: vi.fn(),
    onVariableCurrentEdit: vi.fn(),
  }

  const editWindows = () =>
    screen.queryAllByTestId('variable-create-modal').filter((node) => node.dataset.windowMode === 'edit')

  function isReadOnlyField(element: HTMLElement): boolean {
    return (
      element.hasAttribute('disabled') ||
      element.hasAttribute('readonly') ||
      element.getAttribute('aria-disabled') === 'true' ||
      element.getAttribute('aria-readonly') === 'true'
    )
  }

  it('enables the pencil when the panel can set a Current value', () => {
    render(<VariableManagerContent {...readOnlyScopeProps} />)
    expect(screen.getByTestId('edit-button-v1')).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps the row delete locked', () => {
    render(<VariableManagerContent {...readOnlyScopeProps} />)
    expect(screen.getByTestId('delete-button-v1')).toHaveAttribute('aria-disabled', 'true')
  })

  it('opens the window on the Current value with the Name locked', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...readOnlyScopeProps} />)

    await user.click(screen.getByTestId('edit-button-v1'))

    expect(editWindows()).toHaveLength(1)
    const sheet = editWindows()[0]
    expect(within(sheet).getByTestId('value-switch')).toHaveTextContent('Current')
    expect(isReadOnlyField(within(sheet).getByTestId('create-variable-name'))).toBe(true)
  })

  it('keeps the pencil locked when no Current value can be set (history, mirroring)', () => {
    render(<VariableManagerContent {...readOnlyScopeProps} onVariableCurrentEdit={undefined} />)
    expect(screen.getByTestId('edit-button-v1')).toHaveAttribute('aria-disabled', 'true')
  })
})

// ===========================================================================
// The window saves through the panel's handlers in its own scope (VMGR-106, REQ-3.2.1.6)
// ===========================================================================

describe("VariableManagerContent - an Edit window saves through the panel's handlers in its own scope (VMGR-106)", () => {
  const PATH_A = [{ nodeId: 'fn-a', label: 'Function_A' }]
  const LOCAL_A = createVariable({ id: 'loc-a', name: 'loc_a', value: 'a', type: 'string' })

  function functionA() {
    return {
      id: 'fn-a',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        label: 'Function_A',
        nodeType: 'function',
        functionLifecycle: 'local',
        localDefinition: { workflow: { nodes: [], edges: [] }, inputs: [], outputs: [], variables: [LOCAL_A] },
      },
    }
  }

  const scopeA: VariableManagerContentProps['scope'] = {
    insideFunction: true,
    scopeId: 'fn-a',
    declaredInputNames: [],
    declaredOutputNames: [],
    allowedVarNames: new Set(['loc_a']),
  }

  const editWindow = () =>
    screen.getAllByTestId('variable-create-modal').find((node) => node.dataset.windowMode === 'edit') as HTMLElement

  afterEach(() => {
    act(() => {
      useWorkflowStore.setState({ nodes: [] as never, drillPath: [] })
    })
  })

  it('writes a changed definition of a Test variable through the edit handler with the row the pencil opened', async () => {
    const user = userEvent.setup()
    const onVariableEdit = vi.fn(() => ({ success: true }))
    const row = createVariable({ id: 'v1', name: 'greeting', value: 'hello', type: 'string' })
    render(<VariableManagerContent {...baseProps} variables={[row]} onVariableEdit={onVariableEdit} />)

    await user.click(screen.getByTestId('edit-button-v1'))
    fireEvent.change(within(editWindow()).getByTestId('create-variable-name'), { target: { value: 'salutation' } })
    await user.click(within(editWindow()).getByRole('button', { name: 'Save' }))

    expect(onVariableEdit).toHaveBeenCalledTimes(1)
    expect(onVariableEdit).toHaveBeenCalledWith(row, expect.objectContaining({ name: 'salutation' }), undefined)
    expect(screen.queryByTestId('variable-create-modal')).not.toBeInTheDocument()
  })

  it('writes a Current value of a Function local through the Current handler with the Function the window was opened in', async () => {
    const user = userEvent.setup()
    const onVariableCurrentEdit = vi.fn(async () => undefined)
    act(() => {
      useWorkflowStore.setState({ nodes: [functionA()] as never, drillPath: PATH_A })
    })
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[LOCAL_A]}
        scope={scopeA}
        onVariableEdit={vi.fn(() => ({ success: true }))}
        onVariableCurrentEdit={onVariableCurrentEdit}
      />,
    )

    await user.click(screen.getByTestId('edit-button-loc-a'))
    await user.click(within(editWindow()).getByTestId('value-switch'))
    await user.click(await screen.findByRole('option', { name: 'Current' }))
    const valueText = within(within(editWindow()).getByTestId('window-value-field')).getByRole('textbox')
    fireEvent.change(valueText, { target: { value: 'b' } })
    fireEvent.blur(valueText)
    await user.click(within(editWindow()).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onVariableCurrentEdit).toHaveBeenCalledTimes(1))
    expect(onVariableCurrentEdit).toHaveBeenCalledWith('loc_a', { value: 'b', type: 'string' }, PATH_A)
  })
})

// ===========================================================================
// Test variable rows read live values by their bare name in any drill (REQ-3.1.3.12)
// ===========================================================================

describe('VariableManagerContent - Test variable rows read their live value by name while the canvas is drilled', () => {
  afterEach(() => {
    act(() => {
      useWorkflowStore.setState({ drillPath: [] })
    })
  })

  it('shows the live value of a Test variable row while the canvas is drilled into a Function', () => {
    act(() => {
      useWorkflowStore.setState({ drillPath: [{ nodeId: 'fn-a', label: 'Function_A' }] })
    })
    const row = createVariable({ id: 'v1', name: 'greeting', value: 'hello', type: 'string' })
    render(
      <VariableManagerContent
        {...baseProps}
        variables={[row]}
        runtimeValues={new Map([['greeting', 'from the run']])}
        readOnly
      />,
    )

    expect(within(screen.getByTestId('variable-row-v1')).getByText('from the run')).toBeInTheDocument()
  })
})
