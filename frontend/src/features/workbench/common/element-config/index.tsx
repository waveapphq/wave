/**
 * ElementConfigModal Component - V-CANVAS-12 Config Sheet
 *
 * Non-blocking config sheet for block/plugin parameters and output bindings.
 * - CANVAS-124: Single sheet for blocks AND plugins
 * - CANVAS-128-131: INPUT/OUTPUT sections structure
 * - CANVAS-135: Footer: [Cancel] [Save]
 * - CANVAS-227..230: DraggableSheet shell (header drag handle, X, cascade)
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  getColorClass,
  getIcon,
} from '@/features/workbench/common/canvas/workflow-node/icon-registry'
import { ReadOnlyPill } from '@/features/workbench/common/canvas/chrome/read-only-pill'
import { DescriptionField } from '@/components/shared/fields/description-field'
import { NameField } from '@/components/shared/fields/name-field'
import {
  DraggableSheet,
  hasOpenModalDialog,
  openOrRefocus,
  type SheetHandle,
} from '@/components/shared/draggable-sheet'
import { FreezableFieldset } from '@/components/shared/sheet-layer'
import {
  ChildEditorsProvider,
  useChildEditorScope,
} from '@/components/shared/child-editors/child-editor-scope'
import { SaveBlockedNote } from '@/components/shared/child-editors/save-blocked-note'
import { UnsavedChangesDialog } from '@/components/shared/child-editors/unsaved-changes-dialog'
import { formErrorsNote, saveBlockedNote, type ChildEditorStatus } from '@/lib/child-editors'
import { savedBlockFields, type SavedBlockFields } from '@/features/workbench/lib/saved-block-fields'
import { MAX_BLOCK_NAME_LENGTH } from '@/lib/field-constraints'
import { getPluginById } from '@/features/workbench/lib/plugin-definitions'
import { getControlById } from '@/features/workbench/lib/control-definitions'
import { getGroupMeta, getSecretMaskFields } from '@/features/workbench/lib/node-parameters'
import { resolveEffectiveReveal } from '@/features/workbench/lib/node-parameters/secret-reveal'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'
import { VersionSelector } from './dialogs/version-selector'
import { ProfileBindingModal } from './dialogs/profile-binding-modal'
import { ChangelogDialog } from './dialogs/changelog-dialog'
import { DetailsDialog } from './dialogs/details-dialog'
import { ConfigModalBody } from './config-modal-body'
import { CredentialRevealContext, useCredentialReveal } from './use-credential-reveal'
import { useConfigModalState } from './use-config-modal-state'
import type { ScriptEditorProps } from './parameters/parameter-value-inputs'
import { EnvironmentSelectionDialog } from '@/features/workbench/common/canvas/canvas-action-bar/environment-selection-dialog'
import { useWorkbenchRun } from '@/features/workbench/hooks/use-workbench-run'
import {
  isRunningStatus,
  type WorkbenchStatus,
} from '@/features/workbench/hooks/use-workbench-run/types'
import { sqlCatalogRequestOf } from '@/features/workbench/lib/sql-connection'
import { openSearchFieldsRequestOf } from '@/features/workbench/lib/opensearch/connection'
import { SCRIPT_PARAMS } from '@/features/workbench/lib/python-script-validation/script-issues'
import { useOpenSearchFields } from '@/features/workbench/hooks/use-opensearch-fields'
import type { OpenSearchFieldsRequest } from '@/features/workbench/api/opensearch-tools'
import {
  FieldSuggestContext,
  type FieldSuggestValue,
} from './parameters/field-suggest-context'
import type { SqlDatabaseType } from '@/lib/codemirror/format-editor'
import { useEnvironments } from '@/hooks/use-environments'
import { useCanvasReadOnly } from '@/features/workbench/common/canvas/read-only-context'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import {
  useAdHocActions,
  useAdHocActionsOffered,
  useAdHocEnvironment,
  useAdHocRepeatDraft,
} from '@/features/workbench/common/canvas/adhoc-actions-context'
import {
  isInRemoteBody,
  runsOnExecutionHost,
} from '@/features/workbench/lib/remote-body-membership'
import type { ElementConfigModalProps } from './types'

export type { ElementData, ElementConfigModalProps } from './types'

/** The draft a Run uses runs as Source, whatever the saved Script Type; an OpenSearch query has none. */
const SOURCE_MODE = { script_type: 'source' }
const RUN_PINS: Readonly<Partial<Record<string, Readonly<Record<string, unknown>>>>> = {
  python: SOURCE_MODE,
  'sql-client': SOURCE_MODE,
}

const SETTINGS_NOTE = formErrorsNote('settings')
const BLOCK_DESCRIPTION_PLACEHOLDER = 'Optional. Short description of what this block does in this test.'

/** SQL-2: the Parameters entry names; null while Parameters is an expression. */
function sqlParameterNames(parameters: unknown, expressionFields: readonly string[]): string[] | null {
  if (expressionFields.includes('parameters')) return null
  return parameters !== null && typeof parameters === 'object' ? Object.keys(parameters) : []
}

/** The Run half of a script editor's props: run state plus an Environment dialog (PYRUN-21, SQL-13). */
type ScriptRunControl = Pick<
  ScriptEditorProps,
  'onRun' | 'onStop' | 'runBusy' | 'runAllowed' | 'runBlockedNote' | 'runPausedHere'
>

function ScriptRunHost({
  nodeId,
  param,
  pins,
  blockedNote,
  previewDraft,
  children,
}: Readonly<{
  nodeId: string
  /** The script body a Run substitutes. */
  param: string
  /** The values every Run sets besides the script body. */
  pins: Readonly<Record<string, unknown>> | undefined
  /** What blocks the config's Save besides this script; Run waits on it too. */
  blockedNote: string | null
  /** The config as Save would save it with these values on top, for one run. */
  previewDraft: (overrides: Record<string, unknown>) => SavedBlockFields
  children: (run: ScriptRunControl) => ReactNode
}>) {
  const { status, runBusy, repeatBlockDraft, canRunBlockDraft, stopRun } = useWorkbenchRun()
  const runAdHoc = useAdHocActions()
  const adHocOffered = useAdHocActionsOffered()
  const environment = useAdHocEnvironment()
  const repeatDraft = useAdHocRepeatDraft() ?? repeatBlockDraft
  const { environments } = useEnvironments()
  const pausedHere = useWorkflowStore((s) => s.pausedNodeId === nodeId)
  const [envDialogOpen, setEnvDialogOpen] = useState(false)
  const [envSearch, setEnvSearch] = useState('')
  const [dialogEnv, setDialogEnv] = useState('')
  const draftRef = useRef<SavedBlockFields | null>(null)
  // The status seen since this editor's own Run Current went out; one that is not running ends it.
  const [ownRunStatus, setOwnRunStatus] = useState<WorkbenchStatus | null>(null)
  if (ownRunStatus !== null && ownRunStatus !== status) {
    setOwnRunStatus(isRunningStatus(status) ? status : null)
  }

  // A session paused on this block repeats it; otherwise Run is the canvas's
  // Run Current of this block alone, and a run needs an Environment.
  const repeatsInPlace = status === 'paused' && pausedHere
  const runAllowed = repeatsInPlace || (adHocOffered && canRunBlockDraft(nodeId))

  const runCurrent = (environmentId: string) => {
    setOwnRunStatus(status)
    runAdHoc('run-current', nodeId, {
      environmentId,
      blockDraft: draftRef.current as SavedBlockFields,
    })
  }

  // Like the action bar's Run Current: the selected Environment, or ask for one.
  const handleRun = (draft: string) => {
    draftRef.current = previewDraft({ [param]: draft, ...pins })
    if (repeatsInPlace) {
      // The hook reports its own failures; the modal only keeps the promise handled.
      Promise.resolve(repeatDraft(nodeId, param, draft)).catch(() => undefined)
      return
    }
    if (environment.selected) {
      runCurrent(environment.selected)
      return
    }
    setDialogEnv('')
    setEnvSearch('')
    setEnvDialogOpen(true)
  }

  const handleConfirmEnvironment = () => {
    setEnvDialogOpen(false)
    environment.select(dialogEnv)
    runCurrent(dialogEnv)
  }

  // Stop ends the whole run, a paused repeat included; the hook reports its own failures.
  const handleStop = () => {
    stopRun().catch(() => undefined)
  }

  return (
    <>
      {children({
        onRun: handleRun,
        onStop: handleStop,
        runBusy: runBusy || (ownRunStatus !== null && isRunningStatus(status)),
        runAllowed,
        runBlockedNote: blockedNote,
        runPausedHere: repeatsInPlace,
      })}
      <EnvironmentSelectionDialog
        open={envDialogOpen}
        onOpenChange={setEnvDialogOpen}
        action="run"
        environments={environments}
        searchValue={envSearch}
        onSearchChange={setEnvSearch}
        selectedEnv={dialogEnv}
        onSelectEnv={setDialogEnv}
        onConfirm={handleConfirmEnvironment}
      />
    </>
  )
}

/** An OpenSearch block's rows suggest from its Get fields pull; other blocks keep the plain default (OS-13). */
function FieldSuggestHost({
  request,
  index,
  children,
}: Readonly<{ request: OpenSearchFieldsRequest | null; index: string | undefined; children: ReactNode }>) {
  if (request === null) return children
  return (
    <OpenSearchFieldSuggest request={request} index={index}>
      {children}
    </OpenSearchFieldSuggest>
  )
}

function OpenSearchFieldSuggest({
  request,
  index,
  children,
}: Readonly<{ request: OpenSearchFieldsRequest; index: string | undefined; children: ReactNode }>) {
  const pull = useOpenSearchFields(request)
  const value: FieldSuggestValue = {
    fields: pull.fields,
    indexes: pull.indexes,
    state: pull.state,
    start: pull.start,
    startIndexes: pull.startIndexes,
    request,
    index,
  }
  return <FieldSuggestContext value={value}>{children}</FieldSuggestContext>
}

/** The Save gate of the window: what is wrong, and whether Save is offered (SAVE-1). */
function windowSaveGate(args: {
  formValid: boolean
  nameMissing: boolean
  hasChanges: boolean
  savesUnchanged: boolean
  children: readonly ChildEditorStatus[]
}): { note: string | null; disabled: boolean } {
  const note = saveBlockedNote(args.formValid && !args.nameMissing ? null : SETTINGS_NOTE, args.children)
  return { note, disabled: note !== null || (!args.hasChanges && !args.savesUnchanged) }
}

/** The Block name and version list of a plugin or control Block. */
function BlockNameRow({
  elementId,
  name,
  onNameChange,
  version,
  availableVersions,
  onVersionChange,
  readOnly,
}: Readonly<{
  elementId: string
  name: string
  onNameChange: (name: string) => void
  version: string
  availableVersions: string[]
  onVersionChange: (version: string) => void
  readOnly: boolean
}>) {
  const nameId = `element-name-${elementId}`
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 items-start">
      <div className="space-y-2 min-w-0">
        <label htmlFor={nameId} className="block text-sm font-medium">
          Name
        </label>
        <NameField
          id={nameId}
          name="block-name"
          data-testid="element-name-input"
          aria-label="Block name"
          value={name}
          onChange={onNameChange}
          maxLength={MAX_BLOCK_NAME_LENGTH}
          placeholder="Block name"
          disabled={readOnly}
        />
      </div>
      <div className="space-y-2">
        <span className="block text-sm font-medium">Version</span>
        <VersionSelector
          currentVersion={version}
          availableVersions={availableVersions}
          onVersionChange={onVersionChange}
          disabled={readOnly}
        />
      </div>
    </div>
  )
}

/** Changelog, Details and Profiles of a plugin or control Block. */
function BlockFooterActions({
  hasVersions,
  showProfiles,
  onChangelog,
  onDetails,
  onProfiles,
}: Readonly<{
  hasVersions: boolean
  showProfiles: boolean
  onChangelog: () => void
  onDetails: () => void
  onProfiles: () => void
}>) {
  return (
    <>
      <Button variant="outline" size="sm" onClick={onChangelog} disabled={!hasVersions}>
        Changelog
      </Button>
      <Button variant="outline" size="sm" onClick={onDetails}>
        Details
      </Button>
      {showProfiles && (
        <Button
          variant="outline"
          size="sm"
          className="text-blue-600 border-blue-300 hover:bg-blue-50"
          onClick={onProfiles}
        >
          Profiles
        </Button>
      )}
    </>
  )
}

/** Palette display label for an element type ("http-client" -> "HTTP"). */
function getElementTypeLabel(elementType: string): string {
  return (
    getPluginById(elementType)?.name ??
    getControlById(elementType)?.name ??
    elementType
  )
}

export function ElementConfigModal({
  isOpen,
  onClose,
  element,
  onSave,
  initialOffset,
  chrome,
}: Readonly<ElementConfigModalProps>) {
  // File-reference rows: no Browse when the block runs on the execution host;
  // the picker lists the open test's data.
  const insideBody = useWorkflowStore((s) =>
    isInRemoteBody(s.nodes, s.edges, s.drillPath, element.id),
  )
  const runsOnRemoteHost = runsOnExecutionHost(insideBody, element.elementType)
  const state = useConfigModalState(element, onSave, onClose, runsOnRemoteHost)
  const profileSheetRef = useRef<SheetHandle>(null)
  const childEditors = useChildEditorScope()
  const readOnly = useCanvasReadOnly()
  const ElementIcon = getIcon(element.elementType)
  const elementIconColor = getColorClass(element.elementType)
  const setConfigSheetDirty = useWorkflowStore((s) => s.setConfigSheetDirty)
  const testId = useWorkflowStore((s) => s.editingTestId)
  const setNodeSyntaxIssues = useWorkflowStore((s) => s.setNodeSyntaxIssues)
  // Each window's captions tie to its own fields, so two open windows never share an id.
  const descriptionId = `element-description-${element.id}`

  // The canvas layer reads sheet dirtiness, open editors and the chrome's own change included, for delete / close prompts.
  const chromeChanged = chrome?.gate.changed ?? false
  const hasChanges = state.hasChanges || childEditors.hasChanges || chromeChanged
  useEffect(() => {
    setConfigSheetDirty(element.id, hasChanges)
  }, [element.id, hasChanges, setConfigSheetDirty])
  useEffect(() => {
    return () => setConfigSheetDirty(element.id, false)
  }, [element.id, setConfigSheetDirty])

  // Authored changelog entries are discrete bullets; present them as markdown
  // list lines so the (markdown-rendering) ChangelogDialog shows a real list.
  const changelogVersions = useMemo(
    () =>
      (element.versions ?? []).map((v) => ({
        ...v,
        changelog: v.changelog.map((entry) => `- ${entry}`),
      })),
    [element.versions],
  )

  // The title live-follows the Name field so several open sheets are
  // tellable apart; an empty name falls back to the element-type label.
  const displayName = state.name.trim() ? state.name : chrome?.typeLabel ?? getElementTypeLabel(element.elementType)

  // Per-block credential-field catalog (empty for elements without one - the
  // field list then renders nothing, but the tri-state control still shows).
  const secretMaskFields = useMemo(
    () => getSecretMaskFields(element.elementType) ?? [],
    [element.elementType],
  )

  // The "Secrets" section shows only for plugin blocks (never controls). Its
  // effective run-output reveal resolves the block's tri-state against the
  // system run_output default from the global masking store.
  const isPlugin = element.nodeType === 'plugin'
  const systemRunOutput = useMaskingSettingsStore((s) => s.runOutput)
  const effectiveRevealing = resolveEffectiveReveal(state.secretMasking, systemRunOutput)

  // Revealed plaintext for this node's declared credential params, when the
  // system credential-inputs unmask is on (display overlay - never mutates the
  // canvas store, so toggling it can never clobber unsaved edits).
  const revealedCredentials = useCredentialReveal(element.id, isPlugin)

  // The Python editor's non-run half: the draft context the sheet sends with
  // every python-tools request (PYRUN-13/19).
  const scriptParam = SCRIPT_PARAMS[element.elementType]
  const { interpreter, inputVariables, inputVariableTypes, exportNames, onRenameSymbol } = state
  const pythonEditorContext = useMemo<ScriptEditorProps>(
    () => ({
      nodeId: element.id,
      inputVariables,
      inputVariableTypes,
      exportNames,
      interpreter,
      onRenameSymbol,
      onSyntaxIssues: (issues) => setNodeSyntaxIssues(element.id, issues),
    }),
    [element.id, inputVariables, inputVariableTypes, exportNames, interpreter, onRenameSymbol, setNodeSyntaxIssues],
  )

  // The SQL editor's non-run half: its checks and its Get Tables request (SQL-10, SQL-12).
  const isSql = element.elementType === 'sql-client'
  const environmentId = useAdHocEnvironment().selected
  const { values, expressionFields, templateFields, profileBindings, settingElementTypes } = state
  const parameterNames = useMemo(
    () => sqlParameterNames(values.parameters, expressionFields),
    [values.parameters, expressionFields],
  )
  const sqlEditorContext = useMemo<ScriptEditorProps | null>(
    () =>
      isSql
        ? {
            nodeId: element.id,
            databaseType: (values.database_type ?? 'postgresql') as SqlDatabaseType,
            parameterNames,
            sqlCatalogRequest: sqlCatalogRequestOf({
              values,
              expressionFields,
              templateFields,
              profileBindings,
              environmentId,
              testId,
              elementTypes: settingElementTypes,
            }),
          }
        : null,
    [isSql, element.id, values, parameterNames, expressionFields, templateFields, profileBindings, environmentId, testId, settingElementTypes],
  )

  // The Query editor and the rows' field suggestions share the block's one Get fields pull (OS-12, OS-13).
  const isOpenSearch = element.elementType === 'opensearch'
  const openSearchFieldsRequest = useMemo(
    () =>
      isOpenSearch
        ? openSearchFieldsRequestOf({ values, expressionFields, templateFields, profileBindings, environmentId, testId })
        : null,
    [isOpenSearch, values, expressionFields, templateFields, profileBindings, environmentId, testId],
  )
  // The check names the Index pattern only as written; an expression or a template is not known here.
  const indexIsLiteral = !expressionFields.includes('index') && !templateFields.includes('index')
  const openSearchIndex = indexIsLiteral ? (values.index as string | undefined) : undefined
  const openSearchEditorContext = useMemo<ScriptEditorProps | null>(
    () => (isOpenSearch ? { nodeId: element.id, openSearchFieldsRequest, openSearchIndex } : null),
    [isOpenSearch, element.id, openSearchFieldsRequest, openSearchIndex],
  )

  // A Function Block's Name has no fallback, so a blank one holds the Save (FIELDERR-3).
  const { note: saveNote, disabled: saveDisabled } = windowSaveGate({
    formValid: state.isFormValid,
    nameMissing: chrome !== undefined && state.name.trim() === '',
    hasChanges,
    savesUnchanged: chrome?.gate.savesUnchanged ?? false,
    children: childEditors.children,
  })

  // Children write through their own save paths first, so Save must read the form after them.
  const saveRef = useRef(state.handleSave)
  saveRef.current = state.handleSave
  const handleSave = () => {
    childEditors.applyAll()
    saveRef.current()
  }

  const previewDraft = (overrides: Record<string, unknown>) =>
    savedBlockFields(state.previewSave(() => childEditors.applyAll({ flush: false }), overrides))

  // Unsaved edits, the form's or an open editor's, route through the guard even when read-only.
  const handleSheetClose = () => {
    if (hasOpenModalDialog()) return
    state.tryClose(childEditors.hasChanges || chromeChanged)
  }

  const renderBody = (scriptEditor?: ScriptEditorProps) => (
    <ConfigModalBody
      scriptEditor={scriptEditor}
      elementId={element.id}
      isVariableSetter={state.isVariableSetter}
      isXmlParser={state.isXmlParser}
      isJsonParser={state.isJsonParser}
      showTransformSections={state.showTransformSections}
      transformOnBoundTable={state.transformOnBoundTable}
      isAssert={state.isAssert}
      isIfElse={state.isIfElse}
      isBreakOrContinue={state.isBreakOrContinue}
      isWhile={state.isWhile}
      isSwitch={state.isSwitch}
      isWaitUntil={state.isWaitUntil}
      isParallel={state.isParallel}
      runsOnRemoteHost={runsOnRemoteHost}
      readOnly={readOnly}
      testId={testId}
      values={state.values}
      setValues={state.setValues}
      displayParameters={state.displayParameters}
      outputParameters={state.outputParameters}
      entryErrors={state.entryErrors}
      emptyInputs={chrome?.emptyInputs}
      emptyOutputs={chrome?.emptyOutputs}
      groupMeta={getGroupMeta(element.elementType)}
      outputBindings={state.outputBindings}
      outputErrors={state.outputErrors}
      enrichedVariables={state.enrichedVariables}
      variableExpressionKeys={state.variableExpressionKeys}
      variableTemplateKeys={state.variableTemplateKeys}
      variableSecretKeys={state.variableSecretKeys}
      variableTypes={state.variableTypes}
      variableElementTypes={state.variableElementTypes}
      settingElementTypes={state.settingElementTypes}
      expressionFields={state.expressionFields}
      templateFields={state.templateFields}
      outputSecretFields={state.outputSecretFields}
      isPlugin={isPlugin}
      secretMasking={state.secretMasking}
      onSecretMaskingChange={state.setSecretMasking}
      effectiveRevealing={effectiveRevealing}
      secretMaskFields={secretMaskFields}
      unmaskedSecretFields={state.unmaskedSecretFields}
      setUnmaskedSecretFields={state.setUnmaskedSecretFields}
      assertAssertions={state.assertAssertions}
      assertMode={state.assertMode}
      assertFailCurrentScope={state.assertFailCurrentScope}
      ifElseBranches={state.ifElseBranches}
      whileConditions={state.whileConditions}
      switchBranches={state.switchBranches}
      waitConditions={state.waitConditions}
      waitMode={state.waitMode}
      waitFailCurrentScope={state.waitFailCurrentScope}
      parallelBranches={state.parallelBranches}
      parallelJoin={state.parallelJoin}
      outputList={state.outputList}
      handleInputChange={state.handleInputChange}
      handleOutputChange={state.handleOutputChange}
      handleFieldValidationChange={state.handleFieldValidationChange}
      setExpressionFields={state.setExpressionFields}
      setTemplateFields={state.setTemplateFields}
      setVariableExpressionKeys={state.setVariableExpressionKeys}
      setVariableTemplateKeys={state.setVariableTemplateKeys}
      setVariableSecretKeys={state.setVariableSecretKeys}
      setOutputSecretFields={state.setOutputSecretFields}
      setVariableTypes={state.setVariableTypes}
      setVariableElementTypes={state.setVariableElementTypes}
      setSettingElementTypes={state.setSettingElementTypes}
      setVarSetterValid={state.setVarSetterValid}
      setXmlQueryValid={state.setXmlQueryValid}
      setJsonQueryValid={state.setJsonQueryValid}
      setAssertValid={state.setAssertValid}
      setIfElseValid={state.setIfElseValid}
      setWhileValid={state.setWhileValid}
      setSwitchValid={state.setSwitchValid}
      setWaitValid={state.setWaitValid}
      setAssertAssertions={state.setAssertAssertions}
      setAssertMode={state.setAssertMode}
      setAssertFailCurrentScope={state.setAssertFailCurrentScope}
      setIfElseBranches={state.setIfElseBranches}
      setWhileConditions={state.setWhileConditions}
      setSwitchBranches={state.setSwitchBranches}
      setWaitConditions={state.setWaitConditions}
      setWaitMode={state.setWaitMode}
      setWaitFailCurrentScope={state.setWaitFailCurrentScope}
      setParallelBranches={state.setParallelBranches}
      setParallelJoin={state.setParallelJoin}
      setParallelValid={state.setParallelValid}
    />
  )

  return (
    <DraggableSheet
      open={isOpen}
      onClose={handleSheetClose}
      sheetId={`config-${element.id}`}
      ariaLabel={`${displayName} configuration`}
      data-testid="element-config-sheet"
      initialOffset={initialOffset}
      minWidth={520}
      minHeight={400}
      className="max-w-[90vw] max-h-[90vh]"
      header={
        <>
          <h2 className="flex items-center gap-2 text-base font-semibold min-w-0">
            <ElementIcon className={`h-5 w-5 shrink-0 ${elementIconColor}`} aria-hidden="true" />
            <span className="truncate">{displayName} - Edit Config</span>
          </h2>
          <div className="flex items-center gap-2">
            {readOnly ? (
              <ReadOnlyPill data-testid="element-config-read-only-pill" />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close"
              onClick={handleSheetClose}
              onPointerDown={(event) => event.stopPropagation()}
              className="h-7 w-7"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </>
      }
    >
      <ChildEditorsProvider scope={childEditors}>
        {/* Inner scroll wrapper - keeps scrollbar left of resize handle */}
        <div className="overflow-y-auto overflow-x-hidden overscroll-contain flex-1 min-h-0 min-w-0 p-6 mr-2 grid grid-cols-1 gap-4 [&>*]:min-w-0">
          {/* Read-only form surface: <fieldset disabled> freezes every
              native form control beneath it (inputs, selects, textareas,
              buttons) without each child having to re-implement a disabled
              code path. */}
          {chrome?.banner}
          <FreezableFieldset disabled={readOnly}>
          {chrome ? (
            chrome.renderNameRow({ value: state.name, onChange: state.setName })
          ) : (
            <BlockNameRow
              elementId={element.id}
              name={state.name}
              onNameChange={state.setName}
              version={state.selectedVersion}
              availableVersions={element.availableVersions}
              onVersionChange={state.setSelectedVersion}
              readOnly={readOnly}
            />
          )}
          <div className="space-y-2">
            <label htmlFor={descriptionId} className="block text-sm font-medium">
              Description
            </label>
            <DescriptionField
              id={descriptionId}
              name="block-description"
              data-testid="element-description-input"
              value={state.description}
              onChange={state.setDescription}
              placeholder={chrome?.descriptionPlaceholder ?? BLOCK_DESCRIPTION_PLACEHOLDER}
              disabled={readOnly}
              maxLength={64}
              showCount
            />
          </div>

          <CredentialRevealContext value={revealedCredentials}>
          <FieldSuggestHost request={openSearchFieldsRequest} index={openSearchIndex}>
          {scriptParam === undefined ? (
            renderBody()
          ) : (
            <ScriptRunHost
              nodeId={element.id}
              param={scriptParam}
              pins={RUN_PINS[element.elementType]}
              blockedNote={saveBlockedNote(
                state.isFormValidBesides(scriptParam) ? null : SETTINGS_NOTE,
                childEditors.children,
              )}
              previewDraft={previewDraft}
            >
              {(run) =>
                renderBody({ ...(sqlEditorContext ?? openSearchEditorContext ?? pythonEditorContext), ...run })
              }
            </ScriptRunHost>
          )}
          </FieldSuggestHost>
          </CredentialRevealContext>
          </FreezableFieldset>

          <DialogFooter className="flex justify-between items-center sm:justify-between mt-6">
            <div className="flex gap-2">
              {chrome ? (
                chrome.footerActions
              ) : (
                <BlockFooterActions
                  hasVersions={(element.versions ?? []).length > 0}
                  showProfiles={!state.isBreakOrContinue && !readOnly}
                  onChangelog={() => state.setShowChangelog(true)}
                  onDetails={() => state.setShowDetails(true)}
                  onProfiles={() =>
                    openOrRefocus(state.showProfileModal, profileSheetRef, () => state.setShowProfileModal(true))
                  }
                />
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleSheetClose}>
                {readOnly ? 'Close' : 'Cancel'}
              </Button>
              {!readOnly && (
                <Button onClick={handleSave} disabled={saveDisabled}>
                  Save
                </Button>
              )}
            </div>
          </DialogFooter>
          {!readOnly && <SaveBlockedNote note={saveNote} className="-mt-2 text-right" />}

          {/* Changelog Dialog */}
          {changelogVersions.length > 0 && (
            <ChangelogDialog
              isOpen={state.showChangelog}
              onClose={() => state.setShowChangelog(false)}
              elementName={element.name}
              versions={changelogVersions}
              initialVersion={state.selectedVersion}
            />
          )}

          {/* Details Dialog - shows details for selected version */}
          <DetailsDialog
            isOpen={state.showDetails}
            onClose={() => state.setShowDetails(false)}
            elementName={element.name}
            version={state.selectedVersion}
            description={element.summary}
            details={state.selectedVersionDetails}
          />

          {/* Save here is the config's own Save; read-only offers none, as the scope cannot take the write. */}
          <UnsavedChangesDialog
            open={state.showUnsavedDialog}
            onKeepEditing={state.handleKeepEditing}
            onClose={() => {
              state.setShowUnsavedDialog(false)
              onClose()
            }}
            onSave={
              readOnly
                ? undefined
                : () => {
                    state.setShowUnsavedDialog(false)
                    handleSave()
                  }
            }
            saveBlockedNote={saveNote}
          />
          {/* Profile Binding Modal */}
          <ProfileBindingModal
            ref={profileSheetRef}
            isOpen={state.showProfileModal}
            onClose={() => state.setShowProfileModal(false)}
            bindings={state.profileBindings}
            availableVariables={state.enrichedVariables}
            onDone={state.setProfileBindings}
          />
        </div>
      </ChildEditorsProvider>
    </DraggableSheet>
  )
}

// Re-export sub-components
export { VersionSelector } from './dialogs/version-selector'
export { ParameterTable } from './parameters/parameter-table'
export { ProfileBindingModal } from './dialogs/profile-binding-modal'
export type { ProfileBinding } from './dialogs/profile-binding-modal'
