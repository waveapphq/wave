/**
 * ConfigModalBody - the Wait Until arm.
 *
 * The panel is Assert-shaped: a small parameter table (Timeout / Check Interval
 * / Timeout Message), the shared assertion builder for the condition, the two
 * outputs, then the WAIT MODE radio with Fail Current Scope beneath it.
 *
 * Design decisions WAIT-1, WAIT-2, WAIT-3, WAIT-4, WAIT-6.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The outputs section renders its own ParameterTable, so the mock is keyed on
// the table's mode to keep the input table addressable.
vi.mock('@/features/workbench/common/element-config/parameters/parameter-table', () => ({
  ParameterTable: (props: { mode: string; parameters: Array<{ name: string }> }) => (
    <div data-testid={`parameter-table-${props.mode}`}>
      <span data-testid={`parameter-table-${props.mode}-names`}>
        {JSON.stringify(props.parameters.map((p) => p.name))}
      </span>
    </div>
  ),
}))

vi.mock('@/features/workbench/common/config/assertion-builder/builder', () => ({
  AssertionBuilder: (props: {
    assertions?: unknown[]
    onAssertionsChange?: (items: unknown[]) => void
    onValidChange?: unknown
  }) => (
    <div data-testid="assertion-builder-mock" data-valid-callback={String(props.onValidChange !== undefined)}>
      <span data-testid="assertion-builder-count">{(props.assertions ?? []).length}</span>
      <button
        data-testid="mock-wait-conditions-change"
        onClick={() => props.onAssertionsChange?.([{ id: 'c-1', type: 'expression', expression: 'ready' }])}
      >
        ChangeConditions
      </button>
    </div>
  ),
}))

vi.mock('@/features/workbench/common/config/condition-branch-editor', () => ({
  ConditionBranchEditor: () => <div data-testid="condition-branch-editor-mock" />,
}))

vi.mock('@/features/workbench/common/config/case-branch-editor', () => ({
  CaseBranchEditor: () => <div data-testid="case-branch-editor-mock" />,
}))

vi.mock('@/features/workbench/common/variables/variable-setter-editor/editor', () => ({
  VariableSetterEditor: () => <div data-testid="variable-setter-editor-mock" />,
}))

vi.mock('@/features/workbench/common/config/table-transform', () => ({
  TableTransformSections: () => <div data-testid="table-transform-mock" />,
}))

vi.mock('@/features/workbench/common/element-config/loop-target-selector', () => ({
  LoopTargetSelector: () => <div data-testid="loop-target-selector-mock" />,
}))

// Import after mocks
import { ConfigModalBody } from '@/features/workbench/common/element-config/config-modal-body'

type BodyProps = React.ComponentProps<typeof ConfigModalBody>

const WAIT_PARAMETERS = [
  { name: 'timeout', type: 'integer' as const, required: true, description: 'Deadline' },
  { name: 'check_interval', type: 'integer' as const, required: false, description: 'Interval' },
  { name: 'message', type: 'string' as const, required: false, description: 'Timeout message' },
]

const WAIT_OUTPUTS = [
  { name: 'passed', label: 'Passed', type: 'boolean' as const, required: false as const },
  { name: 'elapsed', label: 'Elapsed', type: 'integer' as const, required: false as const },
]

function makeProps(overrides: Partial<BodyProps> = {}): BodyProps {
  return {
    elementId: 'wait-1',
    isVariableSetter: false,
    isXmlParser: false,
    isJsonParser: false,
    showTransformSections: false,
    transformOnBoundTable: false,
    isAssert: false,
    isIfElse: false,
    isBreakOrContinue: false,
    isWhile: false,
    isSwitch: false,
    isWaitUntil: false,
    values: {},
    setValues: vi.fn(),
    displayParameters: [],
    outputParameters: [],
    outputBindings: {},
    outputErrors: {},
    enrichedVariables: [],
    expressionFields: [],
    templateFields: [],
    secretFields: [],
    outputSecretFields: [],
    isPlugin: false,
    secretMasking: 'system',
    onSecretMaskingChange: vi.fn(),
    effectiveRevealing: false,
    secretMaskFields: [],
    unmaskedSecretFields: [],
    setUnmaskedSecretFields: vi.fn(),
    handleInputChange: vi.fn(),
    handleOutputChange: vi.fn(),
    handleFieldValidationChange: vi.fn(),
    setExpressionFields: vi.fn(),
    setTemplateFields: vi.fn(),
    setSecretFields: vi.fn(),
    setOutputSecretFields: vi.fn(),
    setVarSetterValid: vi.fn(),
    setXmlQueryValid: vi.fn(),
    setJsonQueryValid: vi.fn(),
    ...overrides,
  }
}

function renderWait(overrides: Partial<BodyProps> = {}) {
  return render(
    <ConfigModalBody
      {...makeProps({
        isWaitUntil: true,
        displayParameters: WAIT_PARAMETERS,
        outputParameters: WAIT_OUTPUTS,
        ...overrides,
      })}
    />
  )
}

describe('ConfigModalBody - Wait Until', () => {
  describe('Input parameters', () => {
    it('renders the parameter table and the condition builder together', () => {
      renderWait()

      expect(screen.getByTestId('parameter-table-input')).toBeInTheDocument()
      expect(screen.getByTestId('assertion-builder-mock')).toBeInTheDocument()
    })

    it('shows only the three authored fields as table rows', () => {
      // WAIT-2: the condition, the mode and the scope checkbox are edited by
      // their own affordances, never as parameter rows.
      renderWait()

      const names = JSON.parse(screen.getByTestId('parameter-table-input-names').textContent ?? '[]')
      expect(names).toEqual(['timeout', 'check_interval', 'message'])
    })

    it('hands the condition builder values.conditions, not the assertions list', () => {
      renderWait({
        values: {
          conditions: [{ id: 'c-1', type: 'expression', expression: 'ready' }],
          assertions: [
            { id: 'a-1', type: 'expression', expression: 'x' },
            { id: 'a-2', type: 'expression', expression: 'y' },
          ],
        },
      })

      expect(screen.getByTestId('assertion-builder-count')).toHaveTextContent('1')
    })

    it('forwards a condition change to values.conditions through handleInputChange', async () => {
      const user = userEvent.setup()
      const handleInputChange = vi.fn()
      renderWait({ handleInputChange })

      await user.click(screen.getByTestId('mock-wait-conditions-change'))

      expect(handleInputChange).toHaveBeenCalledWith('conditions', [
        { id: 'c-1', type: 'expression', expression: 'ready' },
      ])
    })

    it('hands the condition builder no validity callback: the shared check decides', () => {
      renderWait()

      expect(screen.getByTestId('assertion-builder-mock')).toHaveAttribute('data-valid-callback', 'false')
    })

    it('does not render any other element type editor', () => {
      renderWait()

      expect(screen.queryByTestId('case-branch-editor-mock')).not.toBeInTheDocument()
      expect(screen.queryByTestId('condition-branch-editor-mock')).not.toBeInTheDocument()
      expect(screen.queryByTestId('variable-setter-editor-mock')).not.toBeInTheDocument()
    })
  })

  describe('Wait Mode section', () => {
    it('renders the WAIT MODE heading', () => {
      renderWait()

      expect(screen.getByText('Wait Mode')).toBeInTheDocument()
    })

    it('offers Retry and Watch, with Retry selected by default', () => {
      renderWait()

      expect(screen.getByRole('radio', { name: 'Retry' })).toBeChecked()
      expect(screen.getByRole('radio', { name: 'Watch' })).not.toBeChecked()
    })

    it('reflects a node saved in Watch mode', () => {
      renderWait({ values: { mode: 'watch' } })

      expect(screen.getByRole('radio', { name: 'Watch' })).toBeChecked()
    })

    it('forwards a mode change to values.mode through handleInputChange', async () => {
      const user = userEvent.setup()
      const handleInputChange = vi.fn()
      renderWait({ handleInputChange })

      await user.click(screen.getByLabelText('Watch'))

      expect(handleInputChange).toHaveBeenCalledWith('mode', 'watch')
    })

    it('renders Fail Current Scope under the mode options', () => {
      renderWait()

      expect(screen.getByLabelText('Fail Current Scope')).toBeInTheDocument()
    })

    it('says Fail Current Scope fails the block and stops the flow', () => {
      renderWait()

      expect(
        screen.getByText(
          'When enabled, running out of time fails the block (shown red) and stops the flow. When disabled, it is informational only (shown amber).'
        )
      ).toBeInTheDocument()
    })

    it('reflects a node saved with Fail Current Scope on', () => {
      renderWait({ values: { fail_current_scope: true } })

      expect(screen.getByRole('checkbox', { name: 'Fail Current Scope' })).toBeChecked()
    })

    it('forwards a Fail Current Scope toggle to values.fail_current_scope through handleInputChange', async () => {
      const user = userEvent.setup()
      const handleInputChange = vi.fn()
      renderWait({ handleInputChange })

      await user.click(screen.getByLabelText('Fail Current Scope'))

      expect(handleInputChange).toHaveBeenCalledWith('fail_current_scope', true)
    })

    it('places the Wait Mode section after the Output Variables section', () => {
      // WAIT-4: the wireframe order is parameters, conditions, outputs,
      // then the mode choice.
      renderWait()

      const outputs = screen.getByText('Output Variables')
      const modeHeading = screen.getByText('Wait Mode')
      const order = outputs.compareDocumentPosition(modeHeading)

      expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('is absent for every other element type', () => {
      render(<ConfigModalBody {...makeProps({ isWhile: true })} />)

      expect(screen.queryByText('Wait Mode')).not.toBeInTheDocument()
    })

    it('does not render the Assert Branching Mode section', () => {
      renderWait()

      expect(screen.queryByText('Branching Mode')).not.toBeInTheDocument()
    })
  })
})
