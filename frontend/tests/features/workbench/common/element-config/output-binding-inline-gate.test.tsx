/**
 * Tests for the inline output-binding type gate.
 *
 * Contract:
 *   - As soon as the user picks an output binding to a wrong-type variable,
 *     an inline error appears under the row in the parameter table AND the
 *     config modal's Save button is disabled.
 *   - When the user picks a compatible variable, the error clears and Save is
 *     re-enabled.
 *
 * The error/disabled state is reactive on every output change, not just on
 * Save click.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/profiles/api/crud', () => ({
  fetchProfiles: vi.fn().mockResolvedValue({
    data: [],
    pagination: { total: 0, page: 1, per_page: 100, total_pages: 0 },
  }),
  fetchProfileTypeSchema: vi.fn().mockResolvedValue({ type: 'http', fields: [] }),
}))

const mockWorkflowStore = {
  variables: [
    { name: 'response_code', type: 'integer' },
    { name: 'is_ok', type: 'boolean' },
    { name: 'response_body', type: 'string' },
    { name: 'pods_map', type: 'map' },
    { name: 'pods_table', type: 'table' },
  ],
  namespaceVariables: { system: [], suite: [], regression: [] },
  nodes: [],
  edges: [],
  drillPath: [],
  selectNodesInRect: vi.fn(),
  setConfigSheetDirty: vi.fn(),
  chainSelect: vi.fn(),
  handleShiftPaneClick: vi.fn(),
}

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector?: (s: typeof mockWorkflowStore) => unknown) =>
    selector ? selector(mockWorkflowStore) : mockWorkflowStore,
}))

const mockElementData = {
  id: 'node-1',
  name: 'HTTP Client',
  elementType: 'http-client',
  version: '1.0.0',
  availableVersions: ['1.0.0'],
  parameters: [
    { name: 'url', type: 'string' as const, required: true, description: 'Request URL' },
    {
      name: 'method',
      type: 'string' as const,
      required: true,
      enumValues: ['GET', 'POST'],
      defaultValue: 'GET',
    },
  ],
  outputs: [
    { name: 'status_code', type: 'integer', description: 'HTTP status' },
    { name: 'body', type: 'string', description: 'Response body' },
  ],
  currentValues: { url: 'https://example.com', method: 'GET' },
  outputBindings: { status_code: 'response_code', body: 'response_body' },
}

// A K8s Get reading in Table mode: its Result declares `table`, not the
// schema's static `map` (K8SREAD-6). Parameters and outputs come from the
// registry, so only the stored values differ between the two modes.
const k8sGetElement = (outputFormat: string) => ({
  id: 'node-2',
  name: 'Read pods',
  elementType: 'k8s-get',
  version: '1.0.0',
  availableVersions: ['1.0.0'],
  parameters: [],
  outputs: [],
  currentValues: { search_by: 'name', kind: 'Pod', name: 'api', output_format: outputFormat },
  outputBindings: { result: '' },
})

async function loadModal() {
  return await import('@/features/workbench/common/element-config')
}

describe('Output-binding inline gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows inline error AND disables Save as soon as the user picks a wrong-type variable', async () => {
    const user = userEvent.setup({ delay: null })
    const { ElementConfigModal } = await loadModal()
    render(
      <ElementConfigModal
        isOpen={true}
        onClose={vi.fn()}
        element={mockElementData}
        onSave={vi.fn()}
      />
    )

    // status_code output expects an integer. The dropdown only lists
    // type-compatible variables, but the input still accepts free text -
    // typing the name of a wrong-type variable triggers the inline gate.
    const statusRow = screen.getByTestId('output-row-status_code')
    const combobox = within(statusRow).getByRole('combobox')
    await user.click(combobox)
    await user.clear(combobox)
    await user.type(combobox, 'is_ok')

    // Inline error appears under the status_code row WITHOUT clicking Save.
    const fieldError = screen.getByTestId('field-error-status_code')
    expect(fieldError).toBeInTheDocument()
    expect(fieldError).toHaveTextContent(/is_ok|boolean|integer|mismatch/i)

    // The field itself is marked and points at the visible alert.
    expect(combobox).toHaveAttribute('aria-invalid', 'true')
    expect(combobox).toHaveAttribute('aria-describedby', fieldError.id)

    // Save button is disabled while the error is present.
    const saveButton = screen.getByRole('button', { name: /save/i })
    expect(saveButton).toBeDisabled()
  })

  it('clears the inline error AND re-enables Save when a compatible variable is picked', async () => {
    const user = userEvent.setup({ delay: null })
    const { ElementConfigModal } = await loadModal()
    // Start with an incompatible binding so we land in the error state.
    const dirtyElement = {
      ...mockElementData,
      outputBindings: { status_code: 'is_ok', body: 'response_body' },
    }
    render(
      <ElementConfigModal
        isOpen={true}
        onClose={vi.fn()}
        element={dirtyElement}
        onSave={vi.fn()}
      />
    )

    // Inline error visible immediately on open since the existing binding is wrong-type.
    expect(screen.getByTestId('field-error-status_code')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()

    // Switch to a compatible variable (response_code is integer).
    const statusRow = screen.getByTestId('output-row-status_code')
    const combobox = within(statusRow).getByRole('combobox')
    await user.click(combobox)
    const option = await screen.findByRole('option', { name: /response_code/i })
    await user.click(option)

    expect(screen.queryByTestId('field-error-status_code')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
  })

  it('offers the variables of the type Output Format resolves to (K8SREAD-6)', async () => {
    const user = userEvent.setup({ delay: null })
    const { ElementConfigModal } = await loadModal()
    render(
      <ElementConfigModal
        isOpen={true}
        onClose={vi.fn()}
        element={k8sGetElement('table')}
        onSave={vi.fn()}
      />
    )

    const resultRow = screen.getByTestId('output-row-result')
    await user.click(within(resultRow).getByRole('combobox'))

    expect(await screen.findByRole('option', { name: /pods_table/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /pods_map/i })).not.toBeInTheDocument()
  })

  it('offers map variables again once Output Format is back to Map', async () => {
    const user = userEvent.setup({ delay: null })
    const { ElementConfigModal } = await loadModal()
    render(
      <ElementConfigModal
        isOpen={true}
        onClose={vi.fn()}
        element={k8sGetElement('map')}
        onSave={vi.fn()}
      />
    )

    const resultRow = screen.getByTestId('output-row-result')
    await user.click(within(resultRow).getByRole('combobox'))

    expect(await screen.findByRole('option', { name: /pods_map/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /pods_table/i })).not.toBeInTheDocument()
  })
})

describe('Output-binding name gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes the suggestions and reveals the name error while the typed name is invalid', async () => {
    const user = userEvent.setup({ delay: null })
    const { ElementConfigModal } = await loadModal()
    render(
      <ElementConfigModal
        isOpen={true}
        onClose={vi.fn()}
        element={mockElementData}
        onSave={vi.fn()}
      />
    )

    const statusRow = screen.getByTestId('output-row-status_code')
    const combobox = within(statusRow).getByRole('combobox')
    await user.click(combobox)
    await user.clear(combobox)
    await user.type(combobox, 'k8s-')

    // The dropdown is gone: no list, no footer, no "new variable" promise.
    expect(screen.queryByTestId('output-binding-footer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('output-new-var-hint')).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /response_code/i })).not.toBeInTheDocument()
    expect(combobox).toHaveAttribute('aria-expanded', 'false')

    // The error under the input is the only thing left, and the input points at it.
    const fieldError = screen.getByTestId('field-error-status_code')
    expect(fieldError).toBeVisible()
    expect(fieldError).toHaveAttribute('role', 'alert')
    expect(fieldError).toHaveTextContent("'k8s-' is not a valid variable name")
    expect(combobox).toHaveAttribute('aria-invalid', 'true')
    expect(combobox).toHaveAttribute('aria-describedby', fieldError.id)
    expect(fieldError.id).toBeTruthy()

    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('points each open sheet\'s binding field at its own error when two sheets show one on the same output', async () => {
    const user = userEvent.setup({ delay: null })
    const { ElementConfigModal } = await loadModal()
    render(
      <>
        <ElementConfigModal isOpen={true} onClose={vi.fn()} element={mockElementData} onSave={vi.fn()} />
        <ElementConfigModal isOpen={true} onClose={vi.fn()} element={{ ...mockElementData, id: 'node-3' }} onSave={vi.fn()} />
      </>
    )

    const comboboxes = screen
      .getAllByTestId('output-row-status_code')
      .map((row) => within(row).getByRole('combobox'))
    for (const combobox of comboboxes) {
      await user.click(combobox)
      await user.clear(combobox)
      await user.type(combobox, 'k8s-')
    }

    const errors = screen.getAllByTestId('field-error-status_code')
    expect(errors).toHaveLength(2)
    expect(errors[0].id).not.toBe(errors[1].id)
    expect(comboboxes[0]).toHaveAttribute('aria-describedby', errors[0].id)
    expect(comboboxes[1]).toHaveAttribute('aria-describedby', errors[1].id)
  })

  it('brings the suggestions back the moment the name becomes valid again', async () => {
    const user = userEvent.setup({ delay: null })
    const { ElementConfigModal } = await loadModal()
    render(
      <ElementConfigModal
        isOpen={true}
        onClose={vi.fn()}
        element={mockElementData}
        onSave={vi.fn()}
      />
    )

    const statusRow = screen.getByTestId('output-row-status_code')
    const combobox = within(statusRow).getByRole('combobox')
    await user.click(combobox)
    await user.clear(combobox)
    await user.type(combobox, 'k8s-')
    expect(screen.queryByTestId('output-binding-footer')).not.toBeInTheDocument()

    // Fixing the name reopens the dropdown with no extra key press or refocus.
    await user.keyboard('{Backspace}')

    expect(await screen.findByTestId('output-binding-footer')).toBeInTheDocument()
    expect(screen.getByTestId('output-new-var-hint')).toHaveTextContent(/k8s.+will be created as a new variable/)
    expect(screen.queryByTestId('field-error-status_code')).not.toBeInTheDocument()
    expect(combobox).toHaveAttribute('aria-expanded', 'true')
    expect(combobox).not.toHaveAttribute('aria-describedby')
  })
})
