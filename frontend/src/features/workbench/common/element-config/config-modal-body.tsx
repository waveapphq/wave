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
import { VariableSetterEditor } from '@/features/workbench/common/variables/variable-setter-editor/editor'
import type { SetterSlots } from '@/features/workbench/common/variables/variable-setter-editor/types'
import { AssertionBuilder } from '../config/assertion-builder/builder'
import type { AssertionItem } from '../config/assertion-builder/types'
import {
  ConditionBranchEditor,
  type ConditionBranch,
} from '../config/condition-branch-editor'
import { CaseBranchEditor, type CaseBranch } from '../config/case-branch-editor'
import {
  ParallelBranchEditor,
  type ParallelLane,
} from '../config/parallel-branch-editor'
import { TableTransformSections } from '../config/table-transform'
import { controlDefault } from '@/features/workbench/lib/node-parameters'
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
  // Values: every field, control lists and choices and the Setter rows included (REQ-3.1.1.5)
  values: Record<string, unknown>
  setValues: React.Dispatch<React.SetStateAction<Record<string, unknown>>>
  // Parameters
  displayParameters: Parameter[]
  outputParameters: OutputTableParameter[]
  /** The window lines under the rows: a blank {x} entry (FIELD-13), a For step, a lane limit. */
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
  /** Element types of typed block settings and of Setter list / map rows (REQ-3.1.3.19). */
  settingElementTypes?: Record<string, ElementTypes>
  // Expression/template fields
  expressionFields: string[]
  templateFields: string[]
  /** Variable Setter rows marked secret, `variables.<row>`. */
  secretFields: string[]
  /** Variable Setter: the type each row picked, window state for a new target. */
  setterRowTypes?: Record<string, string>
  /** Changes when the canvas changed the stored Setter, so its editor rebuilds its rows. */
  setterRevision?: number
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
  /** The element's author-declared export rows (only an element with an output list) */
  outputList?: OutputListEditState
  // Callbacks
  handleInputChange: (name: string, value: unknown) => void
  handleOutputChange: (name: string, value: unknown) => void
  handleFieldValidationChange: (state: { isValid: boolean; errors: Record<string, string> }) => void
  setExpressionFields: React.Dispatch<React.SetStateAction<string[]>>
  setTemplateFields: React.Dispatch<React.SetStateAction<string[]>>
  setSecretFields: React.Dispatch<React.SetStateAction<string[]>>
  setSetterRowTypes?: (types: Record<string, string>) => void
  setOutputSecretFields: React.Dispatch<React.SetStateAction<string[]>>
  setSettingElementTypes?: (name: string, types: ElementTypes | undefined) => void
  setVarSetterValid: (valid: boolean) => void
  setXmlQueryValid: (valid: boolean) => void
  setJsonQueryValid: (valid: boolean) => void
}

const EMPTY_LIST: never[] = []
const NO_TYPES: Record<string, never> = {}
const NO_OP = () => {}

const SETTER_PLACE = 'variables.'

function isSetterPlace(place: string): boolean {
  return place.startsWith(SETTER_PLACE)
}

/** The Setter's own places of a Block list: `variables.<row>` and its entries. */
function setterPlaces(places: readonly string[]): string[] {
  return places.filter(isSetterPlace)
}

/** The list with its Setter places replaced by the editor's. */
function withSetterPlaces(places: readonly string[], next: readonly string[]): string[] {
  return [...places.filter((place) => !isSetterPlace(place)), ...setterPlaces(next)]
}

/** The element types of the Setter rows, `variables.<row>`. */
function setterElementTypes(types: Record<string, ElementTypes> | undefined): Record<string, ElementTypes> {
  return Object.fromEntries(Object.entries(types ?? {}).filter(([place]) => isSetterPlace(place)))
}

/** The value a choice section shows: the stored one, else the field list default. */
function shownChoice(values: Record<string, unknown>, elementType: string, name: string): string {
  return String(values[name] ?? controlDefault(elementType, name))
}

/** The tick a true / false section shows: the stored one, else the field list default. */
function shownTick(values: Record<string, unknown>, elementType: string, name: string): boolean {
  return (values[name] ?? controlDefault(elementType, name)) === true
}

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
  settingElementTypes,
  expressionFields,
  templateFields,
  secretFields,
  setterRowTypes = NO_TYPES,
  setterRevision = 0,
  outputSecretFields,
  isPlugin,
  secretMasking,
  onSecretMaskingChange,
  effectiveRevealing,
  secretMaskFields,
  unmaskedSecretFields,
  setUnmaskedSecretFields,
  outputList,
  handleInputChange,
  handleOutputChange,
  handleFieldValidationChange,
  setExpressionFields,
  setTemplateFields,
  setSecretFields,
  setSetterRowTypes = NO_OP,
  setOutputSecretFields,
  setSettingElementTypes,
  setVarSetterValid,
  setXmlQueryValid,
  setJsonQueryValid,
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

  // The Setter rows and their marks, as the editor reads them: only the Setter's own places (REQ-3.4.1.14).
  const setterSlots: SetterSlots = {
    variables: (values.variables as Record<string, unknown> | undefined) ?? NO_TYPES,
    expressionFields: setterPlaces(expressionFields),
    templateFields: setterPlaces(templateFields),
    elementTypes: setterElementTypes(settingElementTypes),
    secretFields: setterPlaces(secretFields),
    rowTypes: setterRowTypes,
  }

  // The editor writes its rows into the shared values and its marks into the Block lists.
  const handleSetterSlotsChange = (next: SetterSlots) => {
    setValues((prev) => ({ ...prev, variables: next.variables }))
    setExpressionFields((prev) => withSetterPlaces(prev, next.expressionFields))
    setTemplateFields((prev) => withSetterPlaces(prev, next.templateFields))
    setSecretFields((prev) => withSetterPlaces(prev, next.secretFields))
    const nextTypes = setterElementTypes(next.elementTypes)
    for (const place of Object.keys(setterSlots.elementTypes)) {
      if (!Object.hasOwn(nextTypes, place)) setSettingElementTypes?.(place, undefined)
    }
    for (const [place, types] of Object.entries(nextTypes)) setSettingElementTypes?.(place, types)
    setSetterRowTypes(next.rowTypes)
  }

  // A lane change carries the Block {x} list re-keyed with it (REQ-3.2.3.7).
  const handleLanesChange = (lanes: ParallelLane[], flags: string[]) => {
    handleInputChange('branches', lanes)
    setExpressionFields(flags)
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
                key={setterRevision}
                slots={setterSlots}
                availableVariables={simpleVars}
                onSlotsChange={handleSetterSlotsChange}
                onValidChange={setVarSetterValid}
                secretSaveTarget={secretSaveTarget}
              />
            )
          }
          if (isAssert) {
            return (
              <AssertionBuilder
                assertions={(values.assertions as AssertionItem[] | undefined) ?? EMPTY_LIST}
                availableVariables={simpleVars}
                onAssertionsChange={(next) => handleInputChange('assertions', next)}
              />
            )
          }
          if (isIfElse) {
            return (
              <ConditionBranchEditor
                branches={(values.branches as ConditionBranch[] | undefined) ?? EMPTY_LIST}
                availableVariables={simpleVars}
                onBranchesChange={(next) => handleInputChange('branches', next)}
              />
            )
          }
          if (isSwitch) {
            return (
              <CaseBranchEditor
                branches={(values.branches as CaseBranch[] | undefined) ?? EMPTY_LIST}
                availableVariables={simpleVars}
                onBranchesChange={(next) => handleInputChange('branches', next)}
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
                  branches={(values.branches as ParallelLane[] | undefined) ?? EMPTY_LIST}
                  onBranchesChange={handleLanesChange}
                  expressionFields={expressionFields}
                  onExpressionFieldsChange={setExpressionFields}
                  availableVariables={enrichedVariables}
                  messages={entryErrors ?? NO_TYPES}
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
                  assertions={(values.conditions as AssertionItem[] | undefined) ?? EMPTY_LIST}
                  availableVariables={simpleVars}
                  onAssertionsChange={(next) => handleInputChange('conditions', next)}
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
          value={shownChoice(values, 'assert', 'mode')}
          options={ASSERT_MODE_OPTIONS}
          onValueChange={(v) => handleInputChange('mode', v)}
          idPrefix="mode"
          checkbox={{
            id: 'fail-current-scope',
            label: 'Fail Current Scope',
            description: ASSERT_FAIL_SCOPE_DESCRIPTION,
            checked: shownTick(values, 'assert', 'fail_current_scope'),
            onChange: (checked) => handleInputChange('fail_current_scope', checked),
          }}
        />
      )}

      {/* Join Mode toggle */}
      {isParallel && (
        <ModeRadioSection
          title="JOIN MODE"
          value={shownChoice(values, 'parallel', 'join')}
          options={JOIN_MODE_OPTIONS}
          onValueChange={(v) => handleInputChange('join', v)}
          idPrefix="join-mode"
        />
      )}

      {/* Wait Mode toggle */}
      {isWaitUntil && (
        <ModeRadioSection
          title="Wait Mode"
          value={shownChoice(values, 'wait-until', 'mode')}
          options={WAIT_MODE_OPTIONS}
          onValueChange={(v) => handleInputChange('mode', v)}
          idPrefix="wait-mode"
          checkbox={{
            id: 'wait-fail-current-scope',
            label: 'Fail Current Scope',
            description: WAIT_FAIL_SCOPE_DESCRIPTION,
            checked: shownTick(values, 'wait-until', 'fail_current_scope'),
            onChange: (checked) => handleInputChange('fail_current_scope', checked),
          }}
        />
      )}
    </>
  )
}
