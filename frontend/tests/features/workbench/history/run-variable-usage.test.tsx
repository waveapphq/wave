/**
 * The run page's Variable Manager reads usage and table values as the live one does.
 *
 * Module: frontend/src/features/workbench/history/variable-manager.tsx (through the
 * page in history/container.tsx)
 *
 * A row is Unused only when no Block of the run's canvas reads or writes the name and
 * no other variable reads it; a name an output binding writes shows OUT; a stored
 * table, kept as named typed columns plus rows, reads as a table (REQ-3.1.3.6,
 * REQ-3.1.3.11, VMGR-105).
 */

import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from '@/design-system/theme-provider'
import { ToastProvider } from '@/components/ui/toast'
import { ExecutionTestCanvasPage } from '@/features/workbench/history/container'
import { getHistoricalTestRun } from '@/features/executions/api/executions'

vi.mock('@/features/executions/api/executions', () => ({
  getHistoricalTestRun: vi.fn(),
}))

// jsdom gives the resizable side panel no width, so the shell would keep it collapsed;
// only the panel chrome passes through, the page and the panel content stay real.
vi.mock('@/features/workbench/common/variables/variable-manager-panel', () => ({
  VariableManagerPanel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

const PARSED_ROWS = {
  columns: [
    { name: 'lbl', type: 'string' },
    { name: 'tok', type: 'string' },
    { name: 'prt', type: 'integer' },
  ],
  rows: [
    ['eu-west-prod', '********', 8080],
    ['second-row', 'plain-cell', 9090],
  ],
}

const WORKFLOW = {
  nodes: [
    { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: { label: 'Start' } },
    {
      id: 'parse',
      type: 'workflowNode',
      position: { x: 160, y: 0 },
      data: {
        label: 'Parse CSV',
        elementType: 'csv-parser',
        nodeType: 'plugin',
        expressionFields: ['csv_content'],
        config: {
          values: { csv_content: 'region_label + api_token' },
          outputBindings: { table: 'parsed_rows' },
        },
      },
    },
    {
      id: 'log',
      type: 'workflowNode',
      position: { x: 320, y: 0 },
      data: {
        label: 'Log',
        elementType: 'log',
        nodeType: 'plugin',
        expressionFields: ['message'],
        config: { values: { message: 'log_note' } },
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'parse' },
    { id: 'e2', source: 'parse', target: 'log' },
  ],
}

type Payload = Awaited<ReturnType<typeof getHistoricalTestRun>>

function payload(overrides: Partial<Payload> = {}): Payload {
  return {
    run_id: 'run-1',
    execution_id: 'exec-1',
    test_id: 'test-1',
    suite_id: null,
    status: 'passed',
    started_at: '2026-04-18T10:00:00+00:00',
    ended_at: '2026-04-18T10:00:05+00:00',
    workflow: WORKFLOW,
    block_states: { parse: 'passed', log: 'passed' },
    lanes_taken: {},
    variables: {
      region_label: 'eu-west-prod',
      api_token: '********',
      log_note: 'note',
      parsed_rows: PARSED_ROWS,
      spare_count: 0,
      greeting: 'Hi eu-west-prod',
    },
    variable_definitions: {
      region_label: { type: 'string', value: 'eu-west-prod' },
      api_token: { type: 'string', value: '********', secret: true },
      log_note: { type: 'string', value: 'note' },
      parsed_rows: { type: 'table', value: [] },
      spare_count: { type: 'integer', value: 0 },
      greeting: { type: 'string', value: 'Hi {{ region_label }}', isTemplate: true },
    },
    secret_variables: ['api_token'],
    logs: [],
    environment_id: null,
    environment_name: null,
    ...overrides,
  }
}

function renderPage() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={['/executions/history/run-1']}>
          <Routes>
            <Route path="/executions/history/:runId" element={<ExecutionTestCanvasPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </ThemeProvider>,
  )
}

describe('run page Variable Manager - usage and table values', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks only the variable nothing uses Unused and shows OUT on the output-bound one', async () => {
    vi.mocked(getHistoricalTestRun).mockResolvedValue(payload())
    renderPage()

    await waitFor(() => expect(screen.getByTestId('variable-row-spare_count')).toBeInTheDocument())

    for (const name of ['region_label', 'api_token', 'log_note', 'parsed_rows']) {
      expect(screen.queryByTestId(`unused-badge-${name}`)).not.toBeInTheDocument()
    }
    expect(screen.getByTestId('unused-badge-spare_count')).toHaveTextContent('Unused')
    // The Template variable reads region_label; nothing reads the Template variable itself.
    expect(screen.getByTestId('unused-badge-greeting')).toBeInTheDocument()
    expect(screen.getByTestId('out-badge-parsed_rows')).toHaveTextContent('OUT')
    expect(screen.queryByTestId('out-badge-region_label')).not.toBeInTheDocument()
  })

  it('counts a name only a Template variable reads as used', async () => {
    const base = payload()
    vi.mocked(getHistoricalTestRun).mockResolvedValue(
      payload({
        workflow: { ...WORKFLOW, nodes: WORKFLOW.nodes.filter((node) => node.id !== 'parse') },
        variable_definitions: {
          ...base.variable_definitions,
          greeting: { type: 'string', value: 'Hi {{ spare_count }}', isTemplate: true },
        },
      }),
    )
    renderPage()

    await waitFor(() => expect(screen.getByTestId('variable-row-spare_count')).toBeInTheDocument())

    expect(screen.queryByTestId('unused-badge-spare_count')).not.toBeInTheDocument()
    expect(screen.getByTestId('template-badge-greeting')).toBeInTheDocument()
  })

  it('reads the stored table as a table', async () => {
    vi.mocked(getHistoricalTestRun).mockResolvedValue(payload())
    renderPage()

    await waitFor(() => expect(screen.getByTestId('variable-value-parsed_rows')).toBeInTheDocument())

    expect(screen.getByTestId('variable-value-parsed_rows')).toHaveTextContent('2×3 table')
    expect(screen.getByTestId('type-badge-parsed_rows')).toHaveTextContent('table')

    await userEvent.setup().click(screen.getByTestId('expand-button-parsed_rows'))

    expect(await screen.findByTestId('inspect-metric')).toHaveTextContent('2 rows × 3 cols')
    expect(screen.getByTestId('table-body')).toHaveTextContent('eu-west-prod')
    expect(screen.getByTestId('table-body')).toHaveTextContent('plain-cell')
  })

  it('with the source Test deleted, still types the stored table as a table', async () => {
    vi.mocked(getHistoricalTestRun).mockResolvedValue(payload({ test_id: null, variable_definitions: {} }))
    renderPage()

    await waitFor(() => expect(screen.getByTestId('variable-value-parsed_rows')).toBeInTheDocument())

    expect(screen.getByTestId('type-badge-parsed_rows')).toHaveTextContent('table')
    expect(screen.getByTestId('variable-value-parsed_rows')).toHaveTextContent('2×3 table')
    expect(screen.getByTestId('type-badge-region_label')).toHaveTextContent('string')
  })

  it('with the source Test deleted, only the names the run held secret carry the SECRET badge', async () => {
    vi.mocked(getHistoricalTestRun).mockResolvedValue(
      payload({
        test_id: null,
        variable_definitions: {},
        variables: { api_token: '********', token_copy: '********' },
      }),
    )
    renderPage()

    await waitFor(() => expect(screen.getByTestId('variable-value-token_copy')).toBeInTheDocument())

    expect(screen.getByTestId('secret-badge-api_token')).toHaveTextContent('SECRET')
    expect(screen.getByTestId('variable-value-token_copy')).toHaveTextContent('********')
    expect(screen.queryByTestId('secret-badge-token_copy')).not.toBeInTheDocument()
  })
})
