/** A Function Block's window and the floating editors opened from it, on the shared Block window (CANVAS-207, REQ-3.1.1.5). */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'

vi.mock('@/features/functions/hooks/use-function-versions', () => ({
  useFunctionVersions: () => ({ versions: [], latest: '', isLoading: false, failed: false, retry: () => {} }),
}))

vi.mock('@/components/shared/variable-bodies/scalar-edit-body', () => ({
  ScalarEditBody: ({
    onChange,
    onValidChange,
  }: {
    onChange: (value: unknown) => void
    onValidChange: (valid: boolean) => void
  }) => (
    <div data-testid="scalar-edit-body">
      <button data-testid="scalar-edit-body-change" onClick={() => onChange('typed')}>
        change
      </button>
      <button data-testid="scalar-edit-body-invalid" onClick={() => onValidChange(false)}>
        invalid
      </button>
    </div>
  ),
}))

vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: vi.fn(async () => ({
    data: [],
    pagination: { total: 0, page: 1, per_page: 100, total_pages: 1 },
  })),
}))

import { ConfigSheetHost } from '@/features/workbench/common/canvas/workflow-canvas/canvas'
import { CanvasReadOnlyProvider } from '@/features/workbench/common/canvas/read-only-context'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

const NODE_ID = 'fn-node-1'
const GREETING_INPUT = { name: 'greeting', type: 'string', required: false }

function localBlock(inputs: unknown[] = [GREETING_INPUT]) {
  return {
    id: NODE_ID,
    type: 'workflowNode' as const,
    position: { x: 0, y: 0 },
    data: {
      label: 'my_function',
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: {
        name: 'my_function',
        workflow: { nodes: [], edges: [] },
        inputs,
        outputs: [{ name: 'result', type: 'string' }],
      },
      config: { values: {}, outputBindings: {} },
    },
  }
}

function windowTree(readOnly: boolean) {
  return (
    <ReactFlowProvider>
      <CanvasReadOnlyProvider value={readOnly}>
        <ConfigSheetHost nodeId={NODE_ID} cascadeIndex={0} />
      </CanvasReadOnlyProvider>
    </ReactFlowProvider>
  )
}

/** Opens the Block's window the way the canvas does for an open sheet. */
function openWindow(node = localBlock()) {
  useWorkflowStore.setState({
    nodes: [node] as never,
    edges: [],
    variables: [],
    drillPath: [],
    openConfigNodeIds: [NODE_ID],
  })
  const view = render(windowTree(false))
  return { setReadOnly: (readOnly: boolean) => view.rerender(windowTree(readOnly)) }
}

const sheet = () => screen.getByTestId('element-config-sheet')
const parentSave = () => within(sheet()).getByRole('button', { name: 'Save' })
const parentCancel = () => within(sheet()).getByRole('button', { name: 'Cancel' })
const isOpen = () => useWorkflowStore.getState().openConfigNodeIds.includes(NODE_ID)
const storedValues = () =>
  (useWorkflowStore.getState().nodes.find((node) => node.id === NODE_ID)?.data.config as { values: Record<string, unknown> })
    .values

// A plain Function input opens in plain mode; its expand button opens the editor.
async function openGreeting(user: ReturnType<typeof userEvent.setup>) {
  expect(within(screen.getByTestId('param-row-greeting')).getByTestId('expression-toggle')).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await user.click(screen.getByTestId('param-expand-greeting'))
}

async function openGreetingWithChange(user: ReturnType<typeof userEvent.setup>) {
  await openGreeting(user)
  const editor = screen.getByTestId('value-editor-sheet')
  await user.click(within(editor).getByTestId('scalar-edit-body-change'))
  return editor
}

function dialogAnswers() {
  return within(screen.getByTestId('unsaved-changes-dialog'))
    .getAllByRole('button')
    .filter((button) => button.dataset.testid !== undefined)
    .map((button) => button.textContent)
}

beforeEach(() => {
  useWorkflowStore.getState().reset()
})

describe('Function Block window - nothing changed anywhere', () => {
  it('keeps Save disabled and closes at once with a clean editor open', async () => {
    const user = userEvent.setup()
    openWindow()
    expect(parentSave()).toBeDisabled()
    await openGreeting(user)

    await user.click(parentCancel())

    expect(isOpen()).toBe(false)
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
  })
})

describe('Function Block window - an open editor has changes', () => {
  it("saves once with the editor's unsaved value written into the Block's config values", async () => {
    const user = userEvent.setup()
    openWindow()
    await openGreetingWithChange(user)

    await user.click(parentSave())

    expect(isOpen()).toBe(false)
    expect(storedValues()).toEqual({ greeting: 'typed' })
  })

  it('asks Keep Editing / Close / Save on close, and Close discards everything', async () => {
    const user = userEvent.setup()
    openWindow()
    await openGreetingWithChange(user)

    await user.click(parentCancel())
    expect(dialogAnswers()).toEqual(['Keep Editing', 'Close', 'Save'])

    await user.click(screen.getByTestId('unsaved-close'))
    expect(isOpen()).toBe(false)
    expect(storedValues()).toEqual({})
  })

  it("Save in the question saves exactly as the window's Save", async () => {
    const user = userEvent.setup()
    openWindow()
    await openGreetingWithChange(user)
    await user.click(parentCancel())

    await user.click(screen.getByTestId('unsaved-save'))

    expect(isOpen()).toBe(false)
    expect(storedValues()).toEqual({ greeting: 'typed' })
  })

  it('counts as unsaved on the canvas', async () => {
    const user = userEvent.setup()
    openWindow()
    await openGreetingWithChange(user)
    expect(useWorkflowStore.getState().dirtyConfigNodeIds).toEqual([NODE_ID])
  })
})

describe('Function Block window - something cannot be saved', () => {
  it('disables both Saves and names the editor that has errors', async () => {
    const user = userEvent.setup()
    openWindow()
    const editor = await openGreetingWithChange(user)
    await user.click(within(editor).getByTestId('scalar-edit-body-invalid'))

    expect(parentSave()).toBeDisabled()
    expect(within(sheet()).getByTestId('save-blocked-note')).toHaveTextContent(
      /^Save is disabled: the greeting editor has errors$/,
    )

    await user.click(parentCancel())
    expect(screen.getByTestId('unsaved-save')).toBeDisabled()
    expect(
      within(screen.getByTestId('unsaved-changes-dialog')).getByTestId('save-blocked-note'),
    ).toHaveTextContent(/^Save is disabled: the greeting editor has errors$/)
  })

  it('names the settings while the Function name is empty', async () => {
    const user = userEvent.setup()
    openWindow()
    await user.clear(screen.getByTestId('function-name-input'))

    expect(parentSave()).toBeDisabled()
    expect(within(sheet()).getByTestId('save-blocked-note')).toHaveTextContent(
      /^Save is disabled: the settings have errors$/,
    )
  })
})

describe('Function Block window - read-only', () => {
  it('asks Keep Editing / Close only', async () => {
    const user = userEvent.setup()
    const { setReadOnly } = openWindow()
    await openGreetingWithChange(user)
    setReadOnly(true)

    await user.click(within(sheet()).getAllByRole('button', { name: 'Close' })[0])

    expect(dialogAnswers()).toEqual(['Keep Editing', 'Close'])
  })
})

describe('Function Block window - a secret input given a value in its editor (FNCFG-7)', () => {
  it('stores the typed secret literal in the config values', async () => {
    const user = userEvent.setup()
    openWindow(localBlock([{ name: 'api_key', type: 'string', required: false, secret: true }]))
    await user.click(screen.getByTestId('param-expand-api_key'))
    await user.click(within(screen.getByTestId('value-editor-sheet')).getByTestId('scalar-edit-body-change'))

    await user.click(parentSave())

    expect(isOpen()).toBe(false)
    expect(storedValues()).toEqual({ api_key: 'typed' })
  })
})
