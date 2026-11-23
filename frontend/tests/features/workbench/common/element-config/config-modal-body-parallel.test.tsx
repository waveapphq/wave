/**
 * ConfigModalBody - the Parallel arm.
 *
 * The panel is a small parameter table (Section Time Limit), the BRANCHES
 * editor, no Output Variables section, then the JOIN MODE radio - where Wait
 * Until puts WAIT MODE. Lanes and the join mode live in the shared values.
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

vi.mock('@/features/workbench/common/config/assertion-builder/builder', () => ({
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
    branches?: Array<{ id: string; name: string; time_limit?: unknown }>
    onBranchesChange?: (branches: Array<{ id: string; name: string; time_limit?: unknown }>, flags: string[]) => void
    expressionFields?: string[]
    onExpressionFieldsChange?: (next: string[]) => void
    messages?: Record<string, string>
    onValidChange?: unknown
  }) => (
    <div data-testid="parallel-branch-editor-mock" data-valid-callback={String(props.onValidChange !== undefined)}>
      <span data-testid="parallel-branch-ids">
        {JSON.stringify((props.branches ?? []).map((b) => b.id))}
      </span>
      <span data-testid="parallel-branch-flags">{JSON.stringify(props.expressionFields ?? null)}</span>
      <span data-testid="parallel-branch-messages">{JSON.stringify(props.messages ?? null)}</span>
      <button
        data-testid="mock-parallel-branches-change"
        onClick={() =>
          props.onBranchesChange?.(
            [{ id: 'branch_9', name: 'added', time_limit: 500 }, { id: 'branch_1', name: 'ingest' }],
            ['branches.1.time_limit'],
          )
        }
      >
        ChangeBranches
      </button>
      <button
        data-testid="mock-parallel-limit-toggle"
        onClick={() => props.onExpressionFieldsChange?.(['branches.0.time_limit'])}
      >
        ToggleLimit
      </button>
    </div>
  ),
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

function renderParallel(overrides: Partial<BodyProps> = {}) {
  return render(
    <ConfigModalBody
      {...makeProps({
        isParallel: true,
        displayParameters: PARALLEL_PARAMETERS,
        values: { branches: PARALLEL_BRANCHES },
        ...overrides,
      })}
    />,
  )
}

/** The list a Block-list setter was last given: the list itself, or an updater applied to `previous`. */
function lastListWrite(setter: ReturnType<typeof vi.fn>, previous: string[]): unknown {
  const written = setter.mock.calls.at(-1)?.[0]
  return typeof written === 'function' ? (written as (prev: string[]) => string[])(previous) : written
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

    it('hands the branch editor the lanes from values.branches', () => {
      renderParallel()

      const ids = JSON.parse(screen.getByTestId('parallel-branch-ids').textContent ?? '[]')
      expect(ids).toEqual(['branch_1', 'branch_2'])
    })

    it('hands the branch editor the Block {x} list its lane limits read', () => {
      renderParallel({ expressionFields: ['branches.1.time_limit'] })

      expect(JSON.parse(screen.getByTestId('parallel-branch-flags').textContent ?? 'null')).toEqual([
        'branches.1.time_limit',
      ])
    })

    it('routes a lane change to values.branches and the re-keyed {x} list to the Block flags', async () => {
      const user = userEvent.setup()
      const handleInputChange = vi.fn()
      const setExpressionFields = vi.fn()
      renderParallel({ handleInputChange, setExpressionFields, expressionFields: ['branches.0.time_limit'] })

      await user.click(screen.getByTestId('mock-parallel-branches-change'))

      expect(handleInputChange).toHaveBeenCalledWith('branches', [
        { id: 'branch_9', name: 'added', time_limit: 500 },
        { id: 'branch_1', name: 'ingest' },
      ])
      expect(lastListWrite(setExpressionFields, ['branches.0.time_limit'])).toEqual(['branches.1.time_limit'])
    })

    it('routes a lane limit {x} toggle to the Block flags', async () => {
      const user = userEvent.setup()
      const setExpressionFields = vi.fn()
      renderParallel({ setExpressionFields })

      await user.click(screen.getByTestId('mock-parallel-limit-toggle'))

      expect(lastListWrite(setExpressionFields, [])).toEqual(['branches.0.time_limit'])
    })

    it('hands the branch editor the blank {x} lane limit line of the window messages', () => {
      renderParallel({ entryErrors: { 'branches.0.time_limit': 'Time Limit is required' } })

      const messages = JSON.parse(screen.getByTestId('parallel-branch-messages').textContent ?? 'null') as Record<string, string> | null
      expect(messages?.['branches.0.time_limit']).toBe('Time Limit is required')
    })

    it('hands the branch editor no validity callback: the shared check decides', () => {
      renderParallel()

      expect(screen.getByTestId('parallel-branch-editor-mock')).toHaveAttribute('data-valid-callback', 'false')
    })

    it('renders none of the other control editors', () => {
      renderParallel()

      expect(screen.queryByTestId('case-branch-editor-mock')).not.toBeInTheDocument()
      expect(screen.queryByTestId('condition-branch-editor-mock')).not.toBeInTheDocument()
      expect(screen.queryByTestId('assertion-builder-mock')).not.toBeInTheDocument()
    })
  })

  describe('Output variables', () => {
    // Guard: Parallel declares no output, so the section must not
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
      renderParallel({ values: { branches: PARALLEL_BRANCHES, join: 'first' } })

      const [waitForAll, firstToFinish] = screen.getAllByRole('radio')
      expect(waitForAll).not.toBeChecked()
      expect(firstToFinish).toBeChecked()
    })

    it('routes a mode click to values.join through handleInputChange', async () => {
      const user = userEvent.setup()
      const handleInputChange = vi.fn()
      renderParallel({ handleInputChange })

      await user.click(screen.getByText('First to finish'))

      expect(handleInputChange).toHaveBeenCalledWith('join', 'first')
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
