/**
 * ConfigModalBody Tests - Switch editor dispatch and namespace-root filtering.
 *
 * Design decisions: namespace roots excluded from pickers, Switch branch
 * record + case cards, SWITCH-2, VARPICK-1.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/** Renders the variable names an editor was handed, for prop inspection. */
function VarNames({
  testId,
  vars,
}: Readonly<{ testId: string; vars: Array<{ name: string }> }>) {
  return <span data-testid={testId}>{JSON.stringify(vars.map((v) => v.name))}</span>
}

vi.mock('@/features/workbench/common/element-config/parameters/parameter-table', () => ({
  ParameterTable: (props: {
    mode: string
    availableVariables: Array<{ name: string }>
    runsOnRemoteHost?: boolean
    readOnly?: boolean
    testId?: string | null
    secretSaveTarget?: string
  }) => (
    <div
      data-testid="parameter-table-mock"
      data-mode={props.mode}
      data-inside-remote-body={String(!!props.runsOnRemoteHost)}
      data-read-only={String(!!props.readOnly)}
      data-test-id-prop={props.testId ?? ''}
      data-secret-save-target={props.secretSaveTarget ?? ''}
    >
      <VarNames testId="parameter-table-vars" vars={props.availableVariables} />
    </div>
  ),
}))

vi.mock('@/features/workbench/common/config/assertion-builder', () => ({
  AssertionBuilder: (props: {
    assertions: unknown[]
    availableVariables: Array<{ name: string }>
  }) => (
    <div data-testid="assertion-builder-mock">
      <VarNames testId="assertion-builder-vars" vars={props.availableVariables} />
      <span data-testid="mock-assertion-count">{props.assertions.length}</span>
    </div>
  ),
}))

vi.mock('@/features/workbench/common/config/condition-branch-editor', () => ({
  ConditionBranchEditor: (props: {
    branches: unknown[]
    availableVariables: Array<{ name: string }>
  }) => (
    <div data-testid="condition-branch-editor-mock">
      <VarNames testId="condition-branch-editor-vars" vars={props.availableVariables} />
      <span data-testid="mock-branch-count">{props.branches.length}</span>
    </div>
  ),
}))

vi.mock('@/features/workbench/common/config/case-branch-editor', () => ({
  CaseBranchEditor: (props: {
    branches: unknown[]
    availableVariables: Array<{ name: string; type: string; source?: string }>
    onBranchesChange: (branches: unknown[]) => void
    onValidChange: (valid: boolean) => void
  }) => (
    <div data-testid="case-branch-editor-mock">
      <VarNames testId="case-branch-editor-vars" vars={props.availableVariables} />
      <span data-testid="case-branch-editor-vars-json">
        {JSON.stringify(props.availableVariables)}
      </span>
      <span data-testid="case-branch-editor-branches">{JSON.stringify(props.branches)}</span>
      <button
        data-testid="mock-case-branches-change"
        onClick={() =>
          props.onBranchesChange([
            { id: 'branch_0', type: 'case', label: 'Fast', conditions: [], break: false },
          ])
        }
      >
        ChangeBranches
      </button>
      <button data-testid="mock-case-invalidate" onClick={() => props.onValidChange(false)}>
        Invalidate
      </button>
    </div>
  ),
}))

vi.mock('@/features/workbench/common/variables/variable-setter-editor', () => ({
  VariableSetterEditor: (props: { availableVariables: Array<{ name: string }> }) => (
    <div data-testid="variable-setter-editor-mock">
      <span data-testid="variable-setter-editor-vars-json">
        {JSON.stringify(props.availableVariables)}
      </span>
      <VarNames testId="variable-setter-editor-vars" vars={props.availableVariables} />
    </div>
  ),
}))

vi.mock('@/features/workbench/common/config/table-transform', () => ({
  TableTransformSections: (props: { availableVariables: Array<{ name: string }> }) => (
    <div data-testid="table-transform-mock">
      <VarNames testId="table-transform-vars" vars={props.availableVariables} />
    </div>
  ),
}))

vi.mock('@/features/workbench/common/element-config/loop-target-selector', () => ({
  LoopTargetSelector: (props: { nodeId: string; value: string }) => (
    <div data-testid="loop-target-selector-mock" data-node-id={props.nodeId}>
      {props.value}
    </div>
  ),
}))

vi.mock('@/features/workbench/common/element-config/expressions/expression-field', () => ({
  ExpressionField: (props: { name: string; value: string }) => (
    <input data-testid={`mock-expression-field-${props.name}`} value={props.value} readOnly />
  ),
}))

// Import after mocks
import { ConfigModalBody } from '@/features/workbench/common/element-config/config-modal-body'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

type BodyProps = React.ComponentProps<typeof ConfigModalBody>

const ENRICHED_VARIABLES = [
  { id: 'ns-system', name: 'system', value: null, type: 'object', source: 'System Variables', isNamespaceRoot: true },
  { id: 'ns-system.timeout', name: 'system.timeout', value: null, type: 'integer', source: 'System Variables' },
  { id: 'ns-suite', name: 'suite', value: null, type: 'object', source: 'Suite', isNamespaceRoot: true },
  { id: 'ns-suite.base_url', name: 'suite.base_url', value: null, type: 'string', source: 'Suite' },
  { id: 'ns-regression', name: 'regression', value: null, type: 'object', source: 'Regression', isNamespaceRoot: true },
  { id: 'ns-regression.run_id', name: 'regression.run_id', value: null, type: 'string', source: 'Regression' },
  { id: 'v1', name: 'user_id', value: '', type: 'string' },
  { id: 'v2', name: 'payload', value: {}, type: 'map', source: 'HTTP Call', isOutputBinding: true },
]

const PICKER_NAMES = [
  'system.timeout',
  'suite.base_url',
  'regression.run_id',
  'user_id',
  'payload',
]

function makeProps(overrides: Partial<BodyProps> = {}): BodyProps {
  return {
    elementId: 'node-1',
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
    enrichedVariables: ENRICHED_VARIABLES,
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
    setAssertAssertions: vi.fn(),
    setAssertMode: vi.fn(),
    setAssertFailCurrentScope: vi.fn(),
    setIfElseBranches: vi.fn(),
    setWhileConditions: vi.fn(),
    setSwitchBranches: vi.fn(),
    setSwitchValid: vi.fn(),
    ...overrides,
  }
}

function renderBody(overrides: Partial<BodyProps> = {}) {
  return render(<ConfigModalBody {...makeProps(overrides)} />)
}

function namesFrom(testId: string): string[] {
  return JSON.parse(screen.getByTestId(testId).textContent ?? '[]') as string[]
}

describe('ConfigModalBody', () => {
  describe('Namespace roots in the editor pickers', () => {
    it('hands the If/Else editor the namespace members and ordinary variables only', () => {
      renderBody({ isIfElse: true })

      expect(namesFrom('condition-branch-editor-vars')).toEqual(PICKER_NAMES)
    })

    it('hands the Assert builder the namespace members and ordinary variables only', () => {
      renderBody({ isAssert: true })

      expect(namesFrom('assertion-builder-vars')).toEqual(PICKER_NAMES)
    })

    it('hands the While conditions builder the namespace members and ordinary variables only', () => {
      renderBody({ isWhile: true })

      expect(namesFrom('assertion-builder-vars')).toEqual(PICKER_NAMES)
    })

    it('hands the Switch case editor the namespace members and ordinary variables only', () => {
      renderBody({ isSwitch: true })

      expect(namesFrom('case-branch-editor-vars')).toEqual(PICKER_NAMES)
    })

    it('marks only the output-bound variable, and keeps every origin label', () => {
      // The picker's OUT badge reads `isOutputBinding`, so narrowing it must not
      // strip `source`: the Variable Setter validator uses that origin to refuse
      // writes to a Function input and to flag profile-alias collisions.
      renderBody({ isSwitch: true })

      const handed = JSON.parse(
        screen.getByTestId('case-branch-editor-vars-json').textContent ?? '[]',
      )
      expect(handed).toEqual([
        { name: 'system.timeout', type: 'integer', source: 'System Variables' },
        { name: 'suite.base_url', type: 'string', source: 'Suite' },
        { name: 'regression.run_id', type: 'string', source: 'Regression' },
        { name: 'user_id', type: 'string' },
        { name: 'payload', type: 'map', source: 'HTTP Call', isOutputBinding: true },
      ])
    })

    it('hands the Variable Setter the origins its read-only guards depend on', () => {
      renderBody({ isVariableSetter: true })

      const handed = JSON.parse(
        screen.getByTestId('variable-setter-editor-vars-json').textContent ?? '[]',
      )
      expect(handed).toContainEqual({
        name: 'system.timeout',
        type: 'integer',
        source: 'System Variables',
      })
    })

    it('keeps the bare roots in the variables handed to the parameter table', () => {
      renderBody()

      expect(namesFrom('parameter-table-vars')).toEqual([
        'system',
        'system.timeout',
        'suite',
        'suite.base_url',
        'regression',
        'regression.run_id',
        'user_id',
        'payload',
      ])
    })
  })

  describe('Switch dispatch', () => {
    it('renders the case branch editor instead of the generic parameter table', () => {
      renderBody({
        isSwitch: true,
        displayParameters: [
          { name: 'branches', type: 'array', required: true, description: 'Branches' },
        ],
      })

      expect(screen.getByTestId('case-branch-editor-mock')).toBeInTheDocument()
      expect(screen.queryByTestId('parameter-table-mock')).not.toBeInTheDocument()
    })

    it('passes the configured branches through to the case branch editor', () => {
      renderBody({
        isSwitch: true,
        switchBranches: [
          { id: 'branch_0', type: 'case', label: '', conditions: [], break: true },
          { id: 'branch_1', type: 'default', label: '' },
        ],
      })

      expect(JSON.parse(screen.getByTestId('case-branch-editor-branches').textContent ?? '[]')).toEqual([
        { id: 'branch_0', type: 'case', label: '', conditions: [], break: true },
        { id: 'branch_1', type: 'default', label: '' },
      ])
    })

    it('forwards a branch change to setSwitchBranches', async () => {
      const user = userEvent.setup()
      const setSwitchBranches = vi.fn()
      renderBody({ isSwitch: true, setSwitchBranches })

      await user.click(screen.getByTestId('mock-case-branches-change'))

      expect(setSwitchBranches).toHaveBeenCalledWith([
        { id: 'branch_0', type: 'case', label: 'Fast', conditions: [], break: false },
      ])
    })

    it('forwards a validity change to setSwitchValid', async () => {
      const user = userEvent.setup()
      const setSwitchValid = vi.fn()
      renderBody({ isSwitch: true, setSwitchValid })

      await user.click(screen.getByTestId('mock-case-invalidate'))

      expect(setSwitchValid).toHaveBeenCalledWith(false)
    })
  })

  describe('Editor dispatch for the other element types', () => {
    it('renders the condition branch editor for an if-else element', () => {
      renderBody({ isIfElse: true, ifElseBranches: [{ id: 'branch_0', type: 'if', label: '' }] })

      expect(screen.getByTestId('condition-branch-editor-mock')).toBeInTheDocument()
      expect(screen.getByTestId('mock-branch-count')).toHaveTextContent('1')
      expect(screen.queryByTestId('case-branch-editor-mock')).not.toBeInTheDocument()
      expect(screen.queryByTestId('parameter-table-mock')).not.toBeInTheDocument()
    })

    it('renders the assertion builder for an assert element', () => {
      renderBody({ isAssert: true })

      expect(screen.getByTestId('assertion-builder-mock')).toBeInTheDocument()
      expect(screen.queryByTestId('case-branch-editor-mock')).not.toBeInTheDocument()
      expect(screen.queryByTestId('parameter-table-mock')).not.toBeInTheDocument()
    })

    it('renders the parameter table and the assertion builder for a while element', () => {
      renderBody({ isWhile: true })

      expect(screen.getByTestId('parameter-table-mock')).toBeInTheDocument()
      expect(screen.getByTestId('assertion-builder-mock')).toBeInTheDocument()
      expect(screen.queryByTestId('case-branch-editor-mock')).not.toBeInTheDocument()
    })

    it('renders the variable setter editor for a variable setter element', () => {
      renderBody({ isVariableSetter: true })

      expect(screen.getByTestId('variable-setter-editor-mock')).toBeInTheDocument()
      expect(screen.queryByTestId('parameter-table-mock')).not.toBeInTheDocument()
    })

    it('renders the input parameter table for a plain plugin element', () => {
      renderBody()

      expect(screen.getByTestId('parameter-table-mock')).toHaveAttribute('data-mode', 'input')
      expect(screen.queryByTestId('case-branch-editor-mock')).not.toBeInTheDocument()
      expect(screen.queryByTestId('condition-branch-editor-mock')).not.toBeInTheDocument()
      expect(screen.queryByTestId('assertion-builder-mock')).not.toBeInTheDocument()
    })
  })

  describe('Assert Branching Mode after the shared-section promotion', () => {
    // The radio-plus-checkbox block moved into ModeRadioSection. Assert is a
    // shipped control - the move must be invisible to it.
    it('still renders the Branching Mode heading and both options', () => {
      renderBody({ isAssert: true })

      expect(screen.getByText('Branching Mode')).toBeInTheDocument()
      expect(screen.getByLabelText('Single')).toBeInTheDocument()
      expect(screen.getByLabelText('Split')).toBeInTheDocument()
    })

    it('still describes each option', () => {
      renderBody({ isAssert: true })

      expect(
        screen.getByText('One output handle - continues to next block regardless of pass/fail')
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          'Two output handles - pass (green) and fail (red) branch to different paths'
        )
      ).toBeInTheDocument()
    })

    it('still marks the saved mode as selected', () => {
      renderBody({ isAssert: true, assertMode: 'single' })

      expect(screen.getByRole('radio', { name: 'Single' })).toBeChecked()
    })

    it('still forwards a mode change to setAssertMode', async () => {
      const user = userEvent.setup()
      const setAssertMode = vi.fn()
      renderBody({ isAssert: true, assertMode: 'split', setAssertMode })

      await user.click(screen.getByLabelText('Single'))

      expect(setAssertMode).toHaveBeenCalledWith('single')
    })

    it('still renders Fail Current Scope with its description', () => {
      renderBody({ isAssert: true })

      expect(screen.getByLabelText('Fail Current Scope')).toBeInTheDocument()
      expect(
        screen.getByText(
          'When enabled, a failed assertion in single mode fails the block (shown red) and stops the flow. In split mode the flow continues down the fail branch, and the Test or Function it runs in ends failed. When disabled, a failure is informational only (shown amber).'
        )
      ).toBeInTheDocument()
    })

    it('still forwards a Fail Current Scope toggle', async () => {
      const user = userEvent.setup()
      const setAssertFailCurrentScope = vi.fn()
      renderBody({ isAssert: true, setAssertFailCurrentScope })

      await user.click(screen.getByLabelText('Fail Current Scope'))

      expect(setAssertFailCurrentScope).toHaveBeenCalledWith(true)
    })

    it('is absent for a non-assert element', () => {
      renderBody()

      expect(screen.queryByText('Branching Mode')).not.toBeInTheDocument()
    })
  })
})

describe('ConfigModalBody file-reference threading', () => {
  const CONTEXT = { runsOnRemoteHost: true, readOnly: true, testId: 'test-42' }

  function tableProps() {
    const table = screen.getByTestId('parameter-table-mock')
    return {
      insideRemoteBody: table.getAttribute('data-inside-remote-body'),
      readOnly: table.getAttribute('data-read-only'),
      testId: table.getAttribute('data-test-id-prop'),
    }
  }

  it('hands the plain parameter table the remote-body flag, the read-only flag and the open test', () => {
    renderBody(CONTEXT)

    expect(tableProps()).toEqual({
      insideRemoteBody: 'true',
      readOnly: 'true',
      testId: 'test-42',
    })
  })

  it('hands the same three to the Parallel branch table', () => {
    renderBody({ ...CONTEXT, isParallel: true })

    expect(tableProps()).toEqual({
      insideRemoteBody: 'true',
      readOnly: 'true',
      testId: 'test-42',
    })
  })

  it('hands the same three to the While table', () => {
    renderBody({ ...CONTEXT, isWhile: true })

    expect(tableProps()).toEqual({
      insideRemoteBody: 'true',
      readOnly: 'true',
      testId: 'test-42',
    })
  })

  it('hands the same three to the Wait Until table', () => {
    renderBody({ ...CONTEXT, isWaitUntil: true })

    expect(tableProps()).toEqual({
      insideRemoteBody: 'true',
      readOnly: 'true',
      testId: 'test-42',
    })
  })

  it('reports an editable local block on a saved test', () => {
    renderBody({ runsOnRemoteHost: false, readOnly: false, testId: 'test-1' })

    expect(tableProps()).toEqual({
      insideRemoteBody: 'false',
      readOnly: 'false',
      testId: 'test-1',
    })
  })

  it('reports no open test for an unsaved canvas', () => {
    renderBody({ runsOnRemoteHost: false, readOnly: false, testId: null })

    expect(tableProps().testId).toBe('')
  })
})

describe('ConfigModalBody unsaved-secret save target (REQ-3.1.3.18)', () => {
  afterEach(() => {
    act(() => useWorkflowStore.setState({ functionViewMode: null }))
  })

  const saveTargets = () =>
    screen.getAllByTestId('parameter-table-mock').map((table) => table.getAttribute('data-secret-save-target'))

  it.each([
    ['the plain table', {}],
    ['the Parallel table', { isParallel: true }],
    ['the While table', { isWhile: true }],
    ['the Wait Until table', { isWaitUntil: true }],
  ])('names the test as the save of %s on a Test canvas', (_label, flags) => {
    renderBody(flags)
    expect(saveTargets()).toEqual(['test'])
  })

  it('names the Function inside a library Function view', () => {
    useWorkflowStore.setState({
      functionViewMode: { functionId: '00000000-0000-0000-0000-0000000000aa', version: '1.0.0', editable: true },
    })
    renderBody()
    expect(saveTargets()).toEqual(['Function'])
  })
})
