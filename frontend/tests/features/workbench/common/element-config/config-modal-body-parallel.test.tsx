/**
 * ConfigModalBody - the Parallel arm.
 *
 * The panel is a small parameter table (Section Time Limit), the BRANCHES
 * editor, no Output Variables section, then the JOIN MODE radio - where Wait
 * Until puts WAIT MODE.
 *
 * Design decisions PARALLEL-3, PARALLEL-4, PARALLEL-5, PARALLEL-6.
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

vi.mock('@/features/workbench/common/config/assertion-builder', () => ({
  AssertionBuilder: () => <div data-testid="assertion-builder-mock" />,
}))

vi.mock('@/features/workbench/common/config/condition-branch-editor', () => ({
  ConditionBranchEditor: () => <div data-testid="condition-branch-editor-mock" />,
}))

vi.mock('@/features/workbench/common/config/case-branch-editor', () => ({
  CaseBranchEditor: () => <div data-testid="case-branch-editor-mock" />,
}))

vi.mock('@/features/workbench/common/config/parallel-branch-editor', () => ({
  ParallelBranchEditor: (props: {
    branches: Array<{ id: string; name: string; timeLimit?: number }>
    onBranchesChange: (branches: Array<{ id: string; name: string }>) => void
    onValidChange: (valid: boolean) => void
  }) => (
    <div data-testid="parallel-branch-editor-mock">
      <span data-testid="parallel-branch-ids">
        {JSON.stringify(props.branches.map((b) => b.id))}
      </span>
      <button
        data-testid="mock-parallel-branches-change"
        onClick={() => props.onBranchesChange([{ id: 'branch_9', name: 'added' }])}
      >
        ChangeBranches
      </button>
      <button data-testid="mock-parallel-invalidate" onClick={() => props.onValidChange(false)}>
        Invalidate
      </button>
    </div>
  ),
}))

vi.mock('@/features/workbench/common/variables/variable-setter-editor', () => ({
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

const PARALLEL_PARAMETERS = [
  {
    name: 'time_limit',
    type: 'integer' as const,
    required: false,
    description: 'Section time limit',
  },
]

const PARALLEL_BRANCHES = [
  { id: 'branch_1', name: 'ingest' },
  { id: 'branch_2', name: 'probe' },
]

function makeProps(overrides: Partial<BodyProps> = {}): BodyProps {
  return {
    elementId: 'par-1',
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
    isParallel: false,
    values: {},
    setValues: vi.fn(),
    displayParameters: [],
    outputParameters: [],
    outputBindings: {},
    outputErrors: {},
    enrichedVariables: [],
    variableExpressionKeys: [],
    variableTemplateKeys: [],
    variableSecretKeys: [],
    variableTypes: {},
    expressionFields: [],
    templateFields: [],
    outputSecretFields: [],
    isPlugin: false,
    secretMasking: 'system',
    onSecretMaskingChange: vi.fn(),
    effectiveRevealing: false,
    secretMaskFields: [],
    unmaskedSecretFields: [],
    setUnmaskedSecretFields: vi.fn(),
    assertAssertions: [],
    assertMode: 'split',
    assertFailCurrentScope: false,
    ifElseBranches: [],
    whileConditions: [],
    switchBranches: [],
    waitConditions: [],
    waitMode: 'retry',
    waitFailCurrentScope: false,
    parallelBranches: [],
    parallelJoin: 'all',
    handleInputChange: vi.fn(),
    handleOutputChange: vi.fn(),
    handleFieldValidationChange: vi.fn(),
    setExpressionFields: vi.fn(),
    setTemplateFields: vi.fn(),
    setVariableExpressionKeys: vi.fn(),
    setVariableTemplateKeys: vi.fn(),
    setVariableSecretKeys: vi.fn(),
    setOutputSecretFields: vi.fn(),
    setVariableTypes: vi.fn(),
    setVarSetterValid: vi.fn(),
    setXmlQueryValid: vi.fn(),
    setJsonQueryValid: vi.fn(),
    setAssertValid: vi.fn(),
    setIfElseValid: vi.fn(),
    setWhileValid: vi.fn(),
    setSwitchValid: vi.fn(),
    setWaitValid: vi.fn(),
    setParallelValid: vi.fn(),
    setAssertAssertions: vi.fn(),
    setAssertMode: vi.fn(),
    setAssertFailCurrentScope: vi.fn(),
    setIfElseBranches: vi.fn(),
    setWhileConditions: vi.fn(),
    setSwitchBranches: vi.fn(),
    setWaitConditions: vi.fn(),
    setWaitMode: vi.fn(),
    setWaitFailCurrentScope: vi.fn(),
    setParallelBranches: vi.fn(),
    setParallelJoin: vi.fn(),
    ...overrides,
  }
}

function renderParallel(overrides: Partial<BodyProps> = {}) {
  return render(
    <ConfigModalBody
      {...makeProps({
        isParallel: true,
        displayParameters: PARALLEL_PARAMETERS,
        parallelBranches: PARALLEL_BRANCHES,
        ...overrides,
      })}
    />,
  )
}

describe('ConfigModalBody - Parallel', () => {
  describe('Input parameters', () => {
    it('renders the parameter table and the branch editor together', () => {
      renderParallel()

      expect(screen.getByTestId('parameter-table-input')).toBeInTheDocument()
      expect(screen.getByTestId('parallel-branch-editor-mock')).toBeInTheDocument()
    })

    it('shows the section time limit as the only parameter row (PARALLEL-5)', () => {
      // The branch list and the join mode are edited by their own affordances,
      // never as parameter rows.
      renderParallel()

      const names = JSON.parse(
        screen.getByTestId('parameter-table-input-names').textContent ?? '[]',
      )
      expect(names).toEqual(['time_limit'])
    })

    it('hands the branch editor the parallel branches', () => {
      renderParallel()

      const ids = JSON.parse(screen.getByTestId('parallel-branch-ids').textContent ?? '[]')
      expect(ids).toEqual(['branch_1', 'branch_2'])
    })

    it('routes a branch-list change to setParallelBranches', async () => {
      const user = userEvent.setup()
      const setParallelBranches = vi.fn()
      renderParallel({ setParallelBranches })

      await user.click(screen.getByTestId('mock-parallel-branches-change'))

      expect(setParallelBranches).toHaveBeenCalledWith([{ id: 'branch_9', name: 'added' }])
    })

    it('routes the branch editor validity to setParallelValid', async () => {
      const user = userEvent.setup()
      const setParallelValid = vi.fn()
      renderParallel({ setParallelValid })

      await user.click(screen.getByTestId('mock-parallel-invalidate'))

      expect(setParallelValid).toHaveBeenCalledWith(false)
    })

    it('renders none of the other control editors', () => {
      renderParallel()

      expect(screen.queryByTestId('case-branch-editor-mock')).not.toBeInTheDocument()
      expect(screen.queryByTestId('condition-branch-editor-mock')).not.toBeInTheDocument()
      expect(screen.queryByTestId('assertion-builder-mock')).not.toBeInTheDocument()
    })
  })

  describe('Output variables', () => {
    // Guard: the placeholder `results` output is gone, so the section must not
    // render an empty shell where authors would look for a binding.
    it('renders no Output Variables section', () => {
      renderParallel()

      expect(screen.queryByText('Output Variables')).not.toBeInTheDocument()
    })

    it('renders no output parameter table', () => {
      renderParallel()

      expect(screen.queryByTestId('parameter-table-output')).not.toBeInTheDocument()
    })
  })

  describe('Join mode (PARALLEL-4)', () => {
    it('renders the JOIN MODE heading', () => {
      renderParallel()

      expect(screen.getByText('JOIN MODE')).toBeInTheDocument()
    })

    it('offers exactly two modes with their descriptions', () => {
      renderParallel()

      expect(screen.getByText('Wait for all')).toBeInTheDocument()
      expect(
        screen.getByText(
          'The exit runs once every branch has finished. A branch that fails ends the section.',
        ),
      ).toBeInTheDocument()
      expect(screen.getByText('First to finish')).toBeInTheDocument()
      expect(
        screen.getByText(
          'The exit runs as soon as one branch finishes; the others stop at their next block.',
        ),
      ).toBeInTheDocument()
      expect(screen.getAllByRole('radio')).toHaveLength(2)
    })

    it('selects Wait for all by default', () => {
      renderParallel()

      const [waitForAll, firstToFinish] = screen.getAllByRole('radio')
      expect(waitForAll).toBeChecked()
      expect(firstToFinish).not.toBeChecked()
    })

    it('reflects a stored first-to-finish join', () => {
      renderParallel({ parallelJoin: 'first' })

      const [waitForAll, firstToFinish] = screen.getAllByRole('radio')
      expect(waitForAll).not.toBeChecked()
      expect(firstToFinish).toBeChecked()
    })

    it('routes a mode click to setParallelJoin', async () => {
      const user = userEvent.setup()
      const setParallelJoin = vi.fn()
      renderParallel({ setParallelJoin })

      await user.click(screen.getByText('First to finish'))

      expect(setParallelJoin).toHaveBeenCalledWith('first')
    })

    it('carries no Fail Current Scope checkbox', () => {
      // Only Assert and Wait Until own a scope-failure decision.
      renderParallel()

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    })

    it('renders no Wait Mode or Branching Mode section', () => {
      renderParallel()

      expect(screen.queryByText('Wait Mode')).not.toBeInTheDocument()
      expect(screen.queryByText('Branching Mode')).not.toBeInTheDocument()
    })
  })

  describe('Other element types', () => {
    it('renders no branch editor or join mode when the element is not parallel', () => {
      render(<ConfigModalBody {...makeProps({ isParallel: false })} />)

      expect(screen.queryByTestId('parallel-branch-editor-mock')).not.toBeInTheDocument()
      expect(screen.queryByText('JOIN MODE')).not.toBeInTheDocument()
    })
  })
})
