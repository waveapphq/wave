/** The no match line is a block <output>; variable rows are <fieldset> groups. */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/components/ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/toast')>()),
  useToast: () => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

vi.mock('@/features/workbench/api/workbench', () => ({
  workbenchApi: {
    getSessionVariables: vi.fn(async () => ({})),
    setVariableOverride: vi.fn(async () => ({ name: '', value: null, pending: false })),
  },
}))

vi.mock('@/features/tests/api/crud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/tests/api/crud')>()),
  fetchTest: vi.fn(),
  fetchTestWorkflow: vi.fn(),
}))

vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value }: { value: string }) => <div data-testid="codemirror-editor">{value}</div>,
}))

vi.mock('@/lib/codemirror/plain-text-editor', () => ({
  createPlainTextEditorExtensions: () => [],
}))

vi.mock(
  '@/features/workbench/common/variables/variable-manager-content/variable-editor-modals',
  () => ({ VariableEditorModals: () => null }),
)

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VariableManagerContent } from '@/features/workbench/common/variables/variable-manager-content/content'
import type {
  Variable,
  VariableManagerContentProps,
} from '@/features/workbench/common/variables/variable-manager-content/types'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'

const baseProps: VariableManagerContentProps = {
  variables: [],
  runtimeValues: new Map(),
  isExecuting: false,
}

function createVariable(overrides: Partial<Variable> = {}): Variable {
  return { id: 'var-1', name: 'alpha', value: 'one', type: 'string', ...overrides }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  useMaskingSettingsStore.setState({
    runOutput: false,
    testVariables: false,
    sharedVariables: false,
    credentialInputs: false,
    hydrated: true,
  })
})

describe('VariableManagerContent native elements', () => {
  it('shows No variables match filter in an output element with the status role', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} variables={[createVariable()]} />)

    await user.type(screen.getByRole('searchbox'), 'xyz')

    const status = screen.getByRole('status')
    expect(status.tagName).toBe('OUTPUT')
    expect(status).toHaveTextContent(/^No variables match filter$/)
  })

  it('drops the explicit role attribute, adds block and keeps every other class on the no match line', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} variables={[createVariable()]} />)

    await user.type(screen.getByRole('searchbox'), 'xyz')

    const status = screen.getByText('No variables match filter')
    expect(status.tagName).toBe('OUTPUT')
    expect(status).not.toHaveAttribute('role')
    expect(status).toHaveClass('block', 'py-8', 'text-center', 'text-sm', 'text-muted-foreground')
  })

  it('renders each variable row as a fieldset with the group role and its name', () => {
    const variables = [
      createVariable({ id: 'var-a', name: 'alpha' }),
      createVariable({ id: 'var-b', name: 'beta' }),
    ]
    render(<VariableManagerContent {...baseProps} variables={variables} />)

    for (const name of ['alpha', 'beta']) {
      const row = screen.getByRole('group', { name: `Variable ${name}` })
      expect(row.tagName).toBe('FIELDSET')
      expect(row).not.toHaveAttribute('role')
    }
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('removes the no match output once the filter matches again', async () => {
    const user = userEvent.setup()
    render(<VariableManagerContent {...baseProps} variables={[createVariable()]} />)

    const filter = screen.getByRole('searchbox')
    await user.type(filter, 'xyz')
    expect(screen.getByRole('status').tagName).toBe('OUTPUT')

    await user.clear(filter)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Variable alpha' }).tagName).toBe('FIELDSET')
  })
})
