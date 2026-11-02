/**
 * ParameterRow: an expression finding shows under the field in amber and never blocks Save.
 *
 * REQ-3.4.2.2; FIELDERR-3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ValidationIssue } from '@/features/workbench/lib/expression-validation/types'

const { validator } = vi.hoisted(() => ({
  validator: { issues: [] as ValidationIssue[] },
}))

vi.mock('@/features/workbench/lib/expression-validation/validation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/workbench/lib/expression-validation/validation')>()),
  validateExpressions: () => validator.issues,
}))
vi.mock('@/features/workbench/lib/tree-sitter-init', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/workbench/lib/tree-sitter-init')>()),
  initializeTreeSitter: () => Promise.resolve(),
  isInitialized: () => true,
}))

vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: () => null,
}))

import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'

const USERNAME = {
  name: 'username',
  label: 'Username',
  type: 'string' as const,
  required: false,
}

const UNKNOWN_USR: ValidationIssue = {
  type: 'unknown_variable',
  from: 0,
  to: 3,
  message: "Variable 'usr' is not defined",
  identifier: 'usr',
}

const UNKNOWN_HOST: ValidationIssue = {
  type: 'unknown_variable',
  from: 6,
  to: 10,
  message: "Variable 'host' is not defined",
  identifier: 'host',
}

const baseRowProps = {
  mode: 'input' as const,
  parameter: USERNAME,
  onChange: vi.fn(),
  availableVariables: [] as { name: string; type: string }[],
  onExpressionFieldsChange: vi.fn(),
  templateFields: [] as string[],
  onTemplateFieldsChange: vi.fn(),
}

type RowProps = React.ComponentProps<typeof ParameterRow>

function renderRow(props: Partial<RowProps> = {}) {
  const onValidationChange = vi.fn()
  render(
    <table>
      <tbody>
        <ParameterRow
          {...baseRowProps}
          value="usr"
          expressionFields={['username']}
          onValidationChange={onValidationChange}
          {...props}
        />
      </tbody>
    </table>,
  )
  return { onValidationChange }
}

beforeEach(() => {
  vi.clearAllMocks()
  validator.issues = []
})

describe('ParameterRow expression warning (FIELDERR-3)', () => {
  it('shows the finding under an expression field', () => {
    validator.issues = [UNKNOWN_USR]
    renderRow()
    expect(screen.getByTestId('param-warning-username').textContent).toBe(
      "Variable 'usr' is not defined",
    )
  })

  it('hangs the warning in the value cell of the row', () => {
    validator.issues = [UNKNOWN_USR]
    renderRow()
    const valueCell = screen.getByTestId('param-input-username').closest('td') as HTMLElement
    expect(valueCell).toContainElement(screen.getByTestId('param-warning-username'))
  })

  it('is not an alert', () => {
    validator.issues = [UNKNOWN_USR]
    renderRow()
    expect(screen.getByTestId('param-warning-username')).not.toHaveAttribute('role', 'alert')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('marks the field not invalid', () => {
    validator.issues = [UNKNOWN_USR]
    renderRow()
    expect(screen.getByTestId('param-input-username')).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('never reaches the save-blocking errors', () => {
    validator.issues = [UNKNOWN_USR]
    const { onValidationChange } = renderRow()
    expect(onValidationChange).toHaveBeenCalledWith('username', null)
    expect(onValidationChange).not.toHaveBeenCalledWith('username', expect.any(String))
  })

  it('shows only the first finding when there are several', () => {
    validator.issues = [UNKNOWN_USR, UNKNOWN_HOST]
    renderRow({ value: 'usr + host' })
    expect(screen.getByTestId('param-warning-username').textContent).toBe(
      "Variable 'usr' is not defined",
    )
    expect(screen.queryByText("Variable 'host' is not defined")).not.toBeInTheDocument()
  })

  it('shows nothing for an expression with no finding', () => {
    renderRow()
    expect(screen.queryByTestId('param-warning-username')).not.toBeInTheDocument()
  })

  it('shows nothing on a literal row, which holds no expression', () => {
    validator.issues = [UNKNOWN_USR]
    renderRow({ expressionFields: [] })
    expect(screen.queryByTestId('param-warning-username')).not.toBeInTheDocument()
  })
})
