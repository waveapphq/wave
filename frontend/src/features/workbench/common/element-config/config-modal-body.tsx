/**
 * ConfigModalBody - Input parameters, output variables, and assert mode sections
 *
 * Renders the main body content of the ElementConfigModal.
 */

import type { ReactNode } from 'react'
import { ModeRadioSection } from '../config/mode-radio-section'
import { ParameterTable } from './parameters/parameter-table'
import { deriveHeaderMapExtras } from './parameters/generated-header-rows'
import { ConfigModalOutputs } from './outputs/config-modal-outputs'
import { VariableSetterEditor } from '@/features/workbench/common/variables/variable-setter-editor'
import {
  AssertionBuilder,
  type AssertionItem,
} from '../config/assertion-builder'
import {
  ConditionBranchEditor,
  type ConditionBranch,
} from '../config/condition-branch-editor'
import { CaseBranchEditor, type CaseBranch } from '../config/case-branch-editor'
import {
  ParallelBranchEditor,
  type ParallelBranch,
} from '../config/parallel-branch-editor'
import { TableTransformSections } from '../config/table-transform'
import type { TableFilterBlock, TableSort } from '../config/table-transform/types'
import { LoopTargetSelector } from './loop-target-selector'
import { SecretsSection } from './secrets-section'
import type { GroupMeta, SecretMaskField } from '@/features/workbench/lib/node-parameters/types'
import type { Parameter, OutputTableParameter, EnrichedVariable } from './types'
import type { OutputListEditState } from './use-output-list'
import type { ScriptEditorProps } from './parameters/parameter-value-inputs'
import type { SecretMaskingSetting } from '@/features/workbench/lib/node-parameters/secret-reveal'
import type { ElementTypes } from '@/lib/variable-validation'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import type { SecretSaveTarget } from '@/features/workbench/common/variables/variable-inspect-modal/secret-visibility-notice'

const ASSERT_MODE_OPTIONS = [
  {
    value: 'single',
    label: 'Single',
    description: 'One output handle - continues to next block regardless of pass/fail',
  },
  {
    value: 'split',
    label: 'Split',
    description: 'Two output handles - pass (green) and fail (red) branch to different paths',
  },
]

const ASSERT_FAIL_SCOPE_DESCRIPTION =
  'When enabled, a failed assertion in single mode fails the block (shown red) and stops the flow. In split mode the flow continues down the fail branch, and the Test or Function it runs in ends failed. When disabled, a failure is informational only (shown amber).'

const WAIT_MODE_OPTIONS = [
  {
    value: 'retry',
    label: 'Retry',
    description:
      'Two outputs - a retry branch that runs on every round to try to make the condition true, and the exit the flow continues down.',
  },
  {
    value: 'watch',
    label: 'Watch',
    description:
      'One output. The wait just re-checks the condition each round and continues when it comes true.',
  },
]

const JOIN_MODE_OPTIONS = [
  {
    value: 'all',
    label: 'Wait for all',
    description:
      'The exit runs once every branch has finished. A branch that fails ends the section.',
  },
  {
    value: 'first',
    label: 'First to finish',
    description:
      'The exit runs as soon as one branch finishes; the others stop at their next block.',
  },
]

const WAIT_FAIL_SCOPE_DESCRIPTION =
  'When enabled, running out of time fails the block (shown red) and stops the flow. When disabled, it is informational only (shown amber).'

interface ConfigModalBodyProps {
  // Element identity
  elementId: string
  // Element type flags
  isVariableSetter: boolean
  isXmlParser: boolean
  isJsonParser: boolean
  /** The element's schema drives a Transform section and it is currently visible */
  showTransformSections: boolean
  /** The Transform's source is a bound table, whose columns are always named */
  transformOnBoundTable: boolean
  isAssert: boolean
  isIfElse: boolean
  isBreakOrContinue: boolean
  isWhile: boolean
  isSwitch: boolean
  isWaitUntil: boolean
  isParallel?: boolean
  /** The block runs on the execution host: path rows show no Browse. */
  runsOnRemoteHost?: boolean
  /** Read-only canvas: rows show no Browse. */
  readOnly?: boolean
  /** The open test, for the file-reference picker; null while the test is unsaved. */
  testId?: string | null
  /** Python and SQL blocks only: what their script body carries into the editor sheet. */
  scriptEditor?: ScriptEditorProps
  // Values
  values: Record<string, unknown>
  setValues: React.Dispatch<React.SetStateAction<Record<string, unknown>>>
  // Parameters
  displayParameters: Parameter[]
  outputParameters: OutputTableParameter[]
  /** A blank {x} entry's message under its row (FIELD-13). */
  entryErrors?: Record<string, string>
  /** What the Input and Output sections show when the Block has no fields there. */
  emptyInputs?: ReactNode
  emptyOutputs?: ReactNode
  /** Group header description + default expansion for the input table's groups */
  groupMeta?: Record<string, GroupMeta>
  // Output bindings
  outputBindings: Record<string, string>
  outputErrors: Record<string, string>
  // Variables
  enrichedVariables: EnrichedVariable[]
  variableExpressionKeys: string[]
  variableTemplateKeys: string[]
  variableSecretKeys: string[]
  variableTypes: Record<string, string>
  /** Element types of Setter rows and of typed block settings (REQ-3.1.3.19). */
  variableElementTypes?: Record<string, ElementTypes>
  settingElementTypes?: Record<string, ElementTypes>
  // Expression/template fields
  expressionFields: string[]
  templateFields: string[]
  // Output secret fields (bound-variable secrecy)
  outputSecretFields: string[]
  // Per-block secret controls (tri-state run-output reveal + field list)
  isPlugin: boolean
  secretMasking: SecretMaskingSetting
  onSecretMaskingChange: (setting: SecretMaskingSetting) => void
  effectiveRevealing: boolean
  secretMaskFields: SecretMaskField[]
  unmaskedSecretFields: string[]
  setUnmaskedSecretFields: React.Dispatch<React.SetStateAction<string[]>>
  // Assert state
  assertAssertions: AssertionItem[]
  assertMode: 'single' | 'split'
  assertFailCurrentScope: boolean
  // If-Else state
  ifElseBranches: ConditionBranch[]
  // While state
  whileConditions: AssertionItem[]
  // Switch/Case state
  switchBranches: CaseBranch[]
  // Wait Until state (only read while isWaitUntil)
  waitConditions?: AssertionItem[]
  waitMode?: 'retry' | 'watch'
  waitFailCurrentScope?: boolean
  // Parallel state (only read while isParallel)
  parallelBranches?: ParallelBranch[]
  parallelJoin?: 'all' | 'first'
  /** The element's author-declared export rows (only an element with an output list) */
  outputList?: OutputListEditState
  // Callbacks
  handleInputChange: (name: string, value: unknown) => void
  handleOutputChange: (name: string, value: unknown) => void
  handleFieldValidationChange: (state: { isValid: boolean; errors: Record<string, string> }) => void
  setExpressionFields: React.Dispatch<React.SetStateAction<string[]>>
  setTemplateFields: React.Dispatch<React.SetStateAction<string[]>>
  setVariableExpressionKeys: React.Dispatch<React.SetStateAction<string[]>>
  setVariableTemplateKeys: React.Dispatch<React.SetStateAction<string[]>>
  setVariableSecretKeys: React.Dispatch<React.SetStateAction<string[]>>
  setOutputSecretFields: React.Dispatch<React.SetStateAction<string[]>>
  setVariableTypes: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setVariableElementTypes?: (types: Record<string, ElementTypes>) => void
  setSettingElementTypes?: (name: string, types: ElementTypes | undefined) => void
  setVarSetterValid: (valid: boolean) => void
  setXmlQueryValid: (valid: boolean) => void
  setJsonQueryValid: (valid: boolean) => void
  setAssertValid: (valid: boolean) => void
  setIfElseValid: (valid: boolean) => void
  setWhileValid: (valid: boolean) => void
  setSwitchValid: (valid: boolean) => void
  setWaitValid?: (valid: boolean) => void
  setParallelValid?: (valid: boolean) => void
  setAssertAssertions: React.Dispatch<React.SetStateAction<AssertionItem[]>>
  setAssertMode: React.Dispatch<React.SetStateAction<'single' | 'split'>>
  setAssertFailCurrentScope: React.Dispatch<React.SetStateAction<boolean>>
  setIfElseBranches: React.Dispatch<React.SetStateAction<ConditionBranch[]>>
  setWhileConditions: React.Dispatch<React.SetStateAction<AssertionItem[]>>
  setSwitchBranches: React.Dispatch<React.SetStateAction<CaseBranch[]>>
  setWaitConditions?: React.Dispatch<React.SetStateAction<AssertionItem[]>>
  setWaitMode?: React.Dispatch<React.SetStateAction<'retry' | 'watch'>>
  setWaitFailCurrentScope?: React.Dispatch<React.SetStateAction<boolean>>
  setParallelBranches?: React.Dispatch<React.SetStateAction<ParallelBranch[]>>
  setParallelJoin?: React.Dispatch<React.SetStateAction<'all' | 'first'>>
}

const NO_ASSERTIONS: AssertionItem[] = []
const NO_BRANCHES: ParallelBranch[] = []
const NO_OP = () => {}

export function ConfigModalBody({
  elementId,
  isVariableSetter,
  isXmlParser,
  isJsonParser,
  showTransformSections,
  transformOnBoundTable,
  isAssert,
  isIfElse,
  isBreakOrContinue,
  isWhile,
  isSwitch,
  isWaitUntil,
  isParallel = false,
  runsOnRemoteHost = false,
  readOnly = false,
  testId = null,
  scriptEditor,
  values,
  setValues,
  displayParameters,
  outputParameters,
  entryErrors,
  emptyInputs,
  emptyOutputs,
  groupMeta,
  outputBindings,
  outputErrors,
  enrichedVariables,
  variableExpressionKeys,
  variableTemplateKeys,
  variableSecretKeys,
  variableTypes,
  variableElementTypes,
  settingElementTypes,
  expressionFields,
  templateFields,
  outputSecretFields,
  isPlugin,
  secretMasking,
  onSecretMaskingChange,
  effectiveRevealing,
  secretMaskFields,
  unmaskedSecretFields,
  setUnmaskedSecretFields,
  assertAssertions,
  assertMode,
  assertFailCurrentScope,
  ifElseBranches,
  whileConditions,
  switchBranches,
  waitConditions = NO_ASSERTIONS,
  waitMode = 'retry',
  waitFailCurrentScope = false,
  parallelBranches = NO_BRANCHES,
  parallelJoin = 'all',
  outputList,
  handleInputChange,
  handleOutputChange,
  handleFieldValidationChange,
  setExpressionFields,
  setTemplateFields,
  setVariableExpressionKeys,
  setVariableTemplateKeys,
  setVariableSecretKeys,
  setOutputSecretFields,
  setVariableTypes,
  setVariableElementTypes,
  setSettingElementTypes,
  setVarSetterValid,
  setXmlQueryValid,
  setJsonQueryValid,
  setAssertValid,
  setIfElseValid,
  setWhileValid,
  setSwitchValid,
  setWaitValid = NO_OP,
  setParallelValid = NO_OP,
  setAssertAssertions,
  setAssertMode,
  setAssertFailCurrentScope,
  setIfElseBranches,
  setWhileConditions,
  setSwitchBranches,
  setWaitConditions = NO_OP,
  setWaitMode = NO_OP,
  setWaitFailCurrentScope = NO_OP,
  setParallelBranches = NO_OP,
  setParallelJoin = NO_OP,
}: Readonly<ConfigModalBodyProps>) {
  // A bare namespace root is a container, never a pickable variable. Origins
  // stay on every entry - the Variable Setter's read-only guards read them;
  // only `isOutputBinding` decides the picker's OUT badge.
  const simpleVars = enrichedVariables
    .filter((v) => v.isNamespaceRoot !== true)
    .map((v) => ({
      name: v.name,
      type: v.type,
      ...(v.source !== undefined && { source: v.source }),
      ...(v.isOutputBinding && { isOutputBinding: true }),
    }))

  // The plugin's credential-key catalog backs map-entry advisories.
  const credentialCatalogKeys = secretMaskFields.map((field) => field.key)

  // Generated header rows + missing-header advisories (schema-gated).
  const mapExtras = deriveHeaderMapExtras(displayParameters, values, handleInputChange)

  // A library View's credentials are sealed by the Function save; everything else by the Test save.
  const inFunctionView = useWorkflowStore((s) => s.functionViewMode !== null)
  const secretSaveTarget: SecretSaveTarget = inFunctionView ? 'Function' : 'test'

  // What a file-reference row needs to decide on Browse and open the picker.
  const rowContext = {
    fieldErrors: entryErrors,
    runsOnRemoteHost,
    readOnly,
    testId,
    scriptEditor,
    elementTypes: settingElementTypes,
    onElementTypesChange: setSettingElementTypes,
    secretSaveTarget,
  }

  return (
    <>
      {/* Break/Continue: minimal UI - just the loop target selector */}
      {isBreakOrContinue && (
        <LoopTargetSelector
          nodeId={elementId}
          value={(values.target_loop as string) ?? ''}
          onChange={(v) => handleInputChange('target_loop', v)}
        />
      )}

      {/* Input Parameters Section (hidden for break/continue) */}
      {!isBreakOrContinue && <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Input Parameters
        </h3>
        {(() => {
          if (isVariableSetter) {
            return (
              <VariableSetterEditor
                variables={(values.variables as Record<string, unknown>) ?? {}}
                expressionKeys={variableExpressionKeys}
                templateKeys={variableTemplateKeys}
                secretKeys={variableSecretKeys}
                variableTypes={variableTypes}
                variableElementTypes={variableElementTypes}
                availableVariables={simpleVars}
                onVariablesChange={(vars) =>
                  setValues((prev) => ({ ...prev, variables: vars }))
                }
                onExpressionKeysChange={setVariableExpressionKeys}
                onTemplateKeysChange={setVariableTemplateKeys}
                onSecretKeysChange={setVariableSecretKeys}
                onTypesChange={setVariableTypes}
                onElementTypesChange={setVariableElementTypes}
                onValidChange={setVarSetterValid}
              />
            )
          }
          if (isAssert) {
            return (
              <AssertionBuilder
                assertions={assertAssertions}
                availableVariables={simpleVars}
                onAssertionsChange={setAssertAssertions}
                onValidChange={setAssertValid}
              />
            )
          }
          if (isIfElse) {
            return (
              <ConditionBranchEditor
                branches={ifElseBranches}
                availableVariables={simpleVars}
                onBranchesChange={setIfElseBranches}
                onValidChange={setIfElseValid}
              />
            )
          }
          if (isSwitch) {
            return (
              <CaseBranchEditor
                branches={switchBranches}
                availableVariables={simpleVars}
                onBranchesChange={setSwitchBranches}
                onValidChange={setSwitchValid}
              />
            )
          }
          if (isParallel) {
            return (
              <>
                <ParameterTable
                  mode="input"
                  parameters={displayParameters}
                  values={values}
                  onChange={handleInputChange}
                  onValidationChange={handleFieldValidationChange}
                  availableVariables={enrichedVariables}
                  expressionFields={expressionFields}
                  onExpressionFieldsChange={setExpressionFields}
                  templateFields={templateFields}
                  onTemplateFieldsChange={setTemplateFields}
                  groupMeta={groupMeta}
                  credentialCatalogKeys={credentialCatalogKeys}
                  mapExtras={mapExtras}
                  {...rowContext}
                />
                <ParallelBranchEditor
                  branches={parallelBranches}
                  onBranchesChange={setParallelBranches}
                  onValidChange={setParallelValid}
                />
              </>
            )
          }
          if (isWhile || isWaitUntil) {
            return (
              <>
                <ParameterTable
                  mode="input"
                  parameters={displayParameters}
                  values={values}
                  onChange={handleInputChange}
                  onValidationChange={handleFieldValidationChange}
                  availableVariables={enrichedVariables}
                  expressionFields={expressionFields}
                  onExpressionFieldsChange={setExpressionFields}
                  templateFields={templateFields}
                  onTemplateFieldsChange={setTemplateFields}
                  groupMeta={groupMeta}
                  credentialCatalogKeys={credentialCatalogKeys}
                  mapExtras={mapExtras}
                  {...rowContext}
                />
                <AssertionBuilder
                  assertions={isWaitUntil ? waitConditions : whileConditions}
                  availableVariables={simpleVars}
                  onAssertionsChange={isWaitUntil ? setWaitConditions : setWhileConditions}
                  onValidChange={isWaitUntil ? setWaitValid : setWhileValid}
                />
              </>
            )
          }
          if (emptyInputs !== undefined && displayParameters.length === 0) return emptyInputs
          return (
            <ParameterTable
              mode="input"
              parameters={displayParameters}
              values={values}
              onChange={handleInputChange}
              onValidationChange={handleFieldValidationChange}
              availableVariables={enrichedVariables}
              expressionFields={expressionFields}
              onExpressionFieldsChange={setExpressionFields}
              templateFields={templateFields}
              onTemplateFieldsChange={setTemplateFields}
              groupMeta={groupMeta}
              credentialCatalogKeys={credentialCatalogKeys}
              mapExtras={mapExtras}
              {...rowContext}
            />
          )
        })()}
        {/* Secrets - last collapsible under Input Parameters. Renders for every
            plugin block (the run-output masking control applies to secret inputs
            and outputs, not only declared credential fields); never for controls. */}
        {isPlugin && (
          <SecretsSection
            secretMasking={secretMasking}
            onSecretMaskingChange={onSecretMaskingChange}
            effectiveRevealing={effectiveRevealing}
            fields={secretMaskFields}
            unmaskedFields={unmaskedSecretFields}
            onUnmaskedFieldsChange={setUnmaskedSecretFields}
          />
        )}
      </div>}

      {/* Transform Section (Sorts + Filters), schema-driven */}
      {showTransformSections && (
        <div className="space-y-3 mt-6">
          <TableTransformSections
            sorts={(values.sorts as TableSort[] | undefined) ?? []}
            filters={(values.filters as TableFilterBlock[] | undefined) ?? []}
            hasHeader={transformOnBoundTable || ((values.has_header as boolean | undefined) ?? true)}
            availableVariables={simpleVars}
            onSortsChange={(next) => handleInputChange('sorts', next)}
            onFiltersChange={(next) => handleInputChange('filters', next)}
          />
        </div>
      )}

      {/* Output Variables Section */}
      <ConfigModalOutputs
        isXmlParser={isXmlParser}
        isJsonParser={isJsonParser}
        values={values}
        setValues={setValues}
        outputParameters={outputParameters}
        emptyNote={emptyOutputs}
        outputBindings={outputBindings}
        outputErrors={outputErrors}
        enrichedVariables={enrichedVariables}
        expressionFields={expressionFields}
        templateFields={templateFields}
        outputSecretFields={outputSecretFields}
        setOutputSecretFields={setOutputSecretFields}
        setExpressionFields={setExpressionFields}
        handleOutputChange={handleOutputChange}
        setXmlQueryValid={setXmlQueryValid}
        setJsonQueryValid={setJsonQueryValid}
        outputList={outputList}
      />

      {/* Assert Mode toggle */}
      {isAssert && (
        <ModeRadioSection
          title="Branching Mode"
          value={assertMode}
          options={ASSERT_MODE_OPTIONS}
          onValueChange={(v) => setAssertMode(v as 'single' | 'split')}
          idPrefix="mode"
          checkbox={{
            id: 'fail-current-scope',
            label: 'Fail Current Scope',
            description: ASSERT_FAIL_SCOPE_DESCRIPTION,
            checked: assertFailCurrentScope,
            onChange: setAssertFailCurrentScope,
          }}
        />
      )}

      {/* Join Mode toggle */}
      {isParallel && (
        <ModeRadioSection
          title="JOIN MODE"
          value={parallelJoin}
          options={JOIN_MODE_OPTIONS}
          onValueChange={(v) => setParallelJoin(v as 'all' | 'first')}
          idPrefix="join-mode"
        />
      )}

      {/* Wait Mode toggle */}
      {isWaitUntil && (
        <ModeRadioSection
          title="Wait Mode"
          value={waitMode}
          options={WAIT_MODE_OPTIONS}
          onValueChange={(v) => setWaitMode(v as 'retry' | 'watch')}
          idPrefix="wait-mode"
          checkbox={{
            id: 'wait-fail-current-scope',
            label: 'Fail Current Scope',
            description: WAIT_FAIL_SCOPE_DESCRIPTION,
            checked: waitFailCurrentScope,
            onChange: setWaitFailCurrentScope,
          }}
        />
      )}
    </>
  )
}
