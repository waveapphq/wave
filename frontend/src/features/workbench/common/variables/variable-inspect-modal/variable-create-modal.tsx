/**
 * VariableCreateModal - the one variable window (VMGR-106): Test variable, local, input or output.
 *
 * REQ-3.1.3.11: Variable Manager UI panel
 * REQ-3.1.3.24: Set to null by hand
 * REQ-3.1.1.5: Function parameter configuration forms
 * REQ-3.1.2.1: Create custom Functions with input parameters
 * REQ-3.1.2.8: Function output kind
 * REQ-3.1.2.11: Enum inputs
 * REQ-3.1.3.13: Computed variables with expressions
 * REQ-3.1.3.15: Template variables
 * REQ-3.2.1.6: Runtime variable override during pause
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react'
import { GripVertical, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import {
  ChildEditorsProvider,
  useChildEditorScope,
} from '@/components/shared/child-editors/child-editor-scope'
import { UnsavedChangesDialog } from '@/components/shared/child-editors/unsaved-changes-dialog'
import { NameField } from '@/components/shared/fields/name-field'
import { DraggableSheet } from '@/components/shared/draggable-sheet'
import type { ListItemType } from '@/components/shared/variable-bodies/array-edit-body'
import { useProtectedValueConfirm } from '@/components/shared/variable-bodies/protected-value-field'
import { RequiredMark } from '@/components/shared/fields/required-mark'
import type { WorkbenchVariableOverrideBody } from '@/features/workbench/api/workbench'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'
import { SaveCanceledError, usePendingCurrentEdits } from '@/features/workbench/live/pending-current-edits'
import { cn } from '@/lib/utils'
import { ROLE_BADGE_CLASS } from '@/lib/variable-format'
import { MAX_VARIABLE_NAME_LENGTH } from '@/lib/field-constraints'
import { TYPE_LABELS, type VariableType } from '@/lib/variable-types'
import {
  isEnumerableType,
  RUN_LOCK_REASON,
  useInspectCreate,
  type DefinitionSaveResult,
  type VariableCreateKind,
  type VariableCreateMode,
  type VariableCreateSpec,
  type UseInspectCreate,
  type WindowEditTarget,
  type WindowSaveOutcome,
} from './use-inspect-create'
import { CreateParamFields, NULL_FORCED_REASON } from './create-param-fields'
import { TypeChangeConfirmDialog } from '@/components/shared/dialogs/type-change-confirm-dialog'
import { KindChangeConfirmDialog } from './kind-change-confirm-dialog'
import { SecretVisibilityNotice, type SecretSaveTarget } from './secret-visibility-notice'
import { cascadeOffset, getCreateSheetWidth } from './sheet-sizes'
import { ModeDropdown, type InspectMode } from './mode-dropdown'
import { ValidationStrip } from './validation-strip'
import { WindowValueField, type WindowNullState } from './window-value-field'

const MODE_TITLES: Record<'add' | 'edit', Record<VariableCreateMode, string>> = {
  add: { variable: 'New variable', input: 'New input parameter', output: 'New output parameter' },
  edit: { variable: 'Edit variable', input: 'Edit input parameter', output: 'Edit output parameter' },
}

const TYPE_DESCRIPTIONS: Record<VariableType, string> = {
  string: 'Text value',
  integer: 'Whole number',
  float: 'Decimal number',
  boolean: 'True or false',
  array: 'List of values',
  map: 'Key-value pairs',
  table: 'Tabular data',
}

interface TypeOption {
  value: VariableType
  label: string
  description: string
}

const TYPE_OPTIONS: TypeOption[] = (Object.keys(TYPE_LABELS) as VariableType[]).map((value) => ({
  value,
  label: TYPE_LABELS[value],
  description: TYPE_DESCRIPTIONS[value],
}))

// While Create enum is set the Type is the allowed values' type (VMGR-112).
const ENUM_TYPE_OPTIONS = TYPE_OPTIONS.filter((option) => isEnumerableType(option.value))

const KIND_LABELS: Record<VariableCreateKind, string> = {
  literal: 'Literal',
  expression: 'Expression',
  template: 'Template',
}

const SCALAR_KINDS: VariableCreateKind[] = ['literal', 'expression']
const STRING_KINDS: VariableCreateKind[] = ['literal', 'expression', 'template']

const VALUE_SWITCH_OPTIONS: InspectMode[] = ['initial', 'current']
const INPUT_VALUE_LABELS: Partial<Record<InspectMode, string>> = { initial: 'Default' }

// Block, so the 6px gap below the 24px label line reaches its field (I-O).
const FIELD_LABEL_CLASS = 'block text-base font-medium'

const REMOVE_SECRET_TEXT =
  'Removing secret protection will permanently delete the stored value. This action cannot be undone.'

function makeSecretText(name: string): string {
  return `Saving makes the plain variable ${name} a secret. Its value is masked from then on. Making it plain again clears its value.`
}

/** The value caption: an input's value is its Default value in Add (VMGR-113). */
function valueCaption(mode: VariableCreateMode, isEdit: boolean): string {
  return !isEdit && mode === 'input' ? 'Default value' : 'Value'
}

function nullStateOf(ticked: boolean, locked: boolean): WindowNullState {
  if (ticked) return 'ticked'
  return locked ? 'locked-off' : 'off'
}

function FieldError({ id, testId, message }: Readonly<{ id?: string; testId: string; message: string }>) {
  return (
    <p id={id} className="text-xs text-destructive" role="alert" data-testid={testId}>
      {message}
    </p>
  )
}

interface TypeSelectFieldProps {
  value: VariableType
  options: TypeOption[]
  disabled: boolean
  onValueChange: (type: VariableType) => void
}

function TypeSelectField({ value, options, disabled, onValueChange }: Readonly<TypeSelectFieldProps>) {
  const triggerId = useId()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={triggerId} className={FIELD_LABEL_CLASS}>Type</Label>
      <Select value={value} onValueChange={(next) => onValueChange(next as VariableType)} disabled={disabled}>
        <SelectTrigger id={triggerId} data-testid="create-type-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex items-center gap-2">
                <span className="font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.description}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

interface KindSelectFieldProps {
  value: VariableCreateKind
  options: VariableCreateKind[]
  disabled: boolean
  onValueChange: (kind: VariableCreateKind) => void
}

function KindSelectField({ value, options, disabled, onValueChange }: Readonly<KindSelectFieldProps>) {
  const triggerId = useId()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={triggerId} className={FIELD_LABEL_CLASS}>Kind</Label>
      <Select value={value} onValueChange={(next) => onValueChange(next as VariableCreateKind)} disabled={disabled}>
        <SelectTrigger id={triggerId} data-testid="create-kind-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** A rename is never a silent identity change: the window names what it refactors. */
function RenameNotice({ oldName, across }: Readonly<{ oldName: string; across: 'test' | 'Function' }>) {
  return (
    <output
      data-testid="window-rename-notice"
      className="block rounded-md border border-sky-500/20 bg-sky-500/[0.06] px-3 py-1.5 text-xs text-sky-700 dark:text-sky-300"
    >
      Renaming updates all references to{' '}
      <code className="font-mono font-semibold [overflow-wrap:anywhere]">{oldName}</code> across the {across}.
    </output>
  )
}

interface NameBlockProps {
  value: string
  error: string | null
  readOnly: boolean
  onChange: (value: string) => void
  nameRef?: Ref<HTMLTextAreaElement>
  children?: ReactNode
}

function NameBlock({ value, error, readOnly, onChange, nameRef, children }: Readonly<NameBlockProps>) {
  const nameId = useId()
  const errorId = useId()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={nameId} className={FIELD_LABEL_CLASS}>
        Name
        <RequiredMark />
      </Label>
      <NameField
        id={nameId}
        name="variable-name"
        data-testid="create-variable-name"
        value={value}
        onChange={onChange}
        placeholder="variable_name"
        maxLength={MAX_VARIABLE_NAME_LENGTH}
        readOnly={readOnly}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        className={cn('font-mono', error && 'border-destructive focus-visible:ring-destructive')}
        autoFocus
        ref={nameRef}
      />
      {error && <FieldError id={errorId} testId="create-name-error" message={error} />}
      {children}
    </div>
  )
}

interface CreateValueAreaProps {
  caption: string
  /** The value field the caption names and focuses. */
  captionFor: string
  /** The caption's own id, naming a true / false group. */
  captionId: string
  /** A held null field dims its caption with it. */
  dimmed: boolean
  /** The caption carries the red star (FIELD-12). */
  required: boolean
  /** The value switch, right after the caption (Edit only). */
  pill?: ReactNode
  children: ReactNode
}

// Never shrinks below its field, so a short window scrolls to it.
function CreateValueArea({ caption, captionFor, captionId, dimmed, required, pill, children }: Readonly<CreateValueAreaProps>) {
  const label = (
    <Label id={captionId} htmlFor={captionFor} className={cn(FIELD_LABEL_CLASS, dimmed && 'opacity-50')}>
      {caption}
      {required ? <RequiredMark /> : null}
    </Label>
  )
  return (
    <div data-testid="create-value-area" className="flex flex-1 flex-col gap-1.5">
      {pill === undefined ? (
        label
      ) : (
        <div className="flex items-center gap-2">
          {label}
          {pill}
        </div>
      )}
      {children}
    </div>
  )
}

interface CreateSheetHeaderProps {
  title: string
  mode: VariableCreateMode
  closeLabel: string
  onClose: () => void
}

function CreateSheetHeader({ title, mode, closeLabel, onClose }: Readonly<CreateSheetHeaderProps>) {
  return (
    <>
      <div className="flex flex-1 items-center gap-2 min-w-0">
        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-lg font-semibold truncate">{title}</h2>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {mode !== 'variable' && (
          <span
            data-testid="create-role-badge"
            className={cn(
              'text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded',
              ROLE_BADGE_CLASS[mode],
            )}
          >
            {mode === 'input' ? 'IN' : 'OUT'}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={closeLabel}
          onClick={onClose}
          onPointerDown={(event) => event.stopPropagation()}
          className="!h-7 !w-7"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </>
  )
}

interface SubmitButtonProps {
  label: string
  loading: boolean
  /** The window cannot be saved yet. */
  invalid: boolean
  /** Held by the running run: focusable, with the reason as its tooltip. */
  lockReason: string | null
  onClick: () => void
}

function SubmitButton({ label, loading, invalid, lockReason, onClick }: Readonly<SubmitButtonProps>) {
  const locked = lockReason !== null
  // A natively disabled button gets no hover, so the run lock is aria-disabled with a click guard.
  return (
    <ConditionalTooltip content={lockReason ?? undefined} disabled>
      <Button
        type="button"
        size="sm"
        data-testid="create-submit-button"
        loading={loading}
        disabled={!locked && invalid}
        aria-disabled={locked ? 'true' : undefined}
        className={locked ? 'opacity-50 cursor-not-allowed' : undefined}
        onClick={locked ? undefined : onClick}
      >
        {label}
      </Button>
    </ConditionalTooltip>
  )
}

export interface VariableCreateModalProps {
  mode: VariableCreateMode
  availableVariables: AvailableVariable[]
  /** Add: writes the new variable. */
  onCreate: (spec: VariableCreateSpec) => DefinitionSaveResult
  onClose: () => void
  checkNameExists: (name: string, excludeId: string) => boolean
  validateExpressionCycle: (params: {
    variableName: string
    value: unknown
    isExpression: boolean
  }) => string | null
  /** Names this window's sheet `variable-create-<windowId>`, one per open window (VMGR-101). */
  windowId: string
  /** This window's place among the open ones, setting its cascade offset. */
  cascadeIndex?: number
  /** The Name field, for an opener that hands focus to it once its own menu has closed. */
  nameRef?: Ref<HTMLTextAreaElement>
  /** The row the pencil opened; absent in Add. */
  editTarget?: WindowEditTarget
  /** The window's scope has a saved baseline: an unsaved secret stays visible until that definition is saved. */
  tracksUnsavedSecret?: boolean
  /** What saving seals the secret: the Test, or the Function a library View shows. */
  secretSaveTarget?: SecretSaveTarget
  /** The run is actively running: Save is held. */
  runLocked: boolean
  sessionId?: string | null
  /** Edit: writes the changed definition. */
  onSaveDefinition: (spec: VariableCreateSpec) => DefinitionSaveResult
  /** Edit: writes the Current value; rejects when the write did not land. */
  onSaveCurrent: (name: string, body: WorkbenchVariableOverrideBody, functionPath?: string[]) => void | Promise<void>
}

interface WindowLabelContext {
  mode: VariableCreateMode
  create: UseInspectCreate
  editTarget: WindowEditTarget | undefined
  tracksUnsavedSecret: boolean
}

interface WindowLabels {
  title: string
  caption: string
  kind: VariableCreateKind
  stripMessage: string | undefined
  showSecretNotice: boolean
  renameAcross: 'Function' | 'test'
  valueReadOnly: boolean
}

/** What the window shows around its fields, read from the definition and the view. */
function windowLabels({ mode, create, editTarget, tracksUnsavedSecret }: WindowLabelContext): WindowLabels {
  const isEdit = editTarget !== undefined
  const inFunction = mode !== 'variable' || !!editTarget?.inFunction || (editTarget?.scope?.length ?? 0) > 0
  // The value the Test stores (never Current; a secret input keeps no default) is new or changed, visible until saved.
  const storedValueChanged = !isEdit || !!editTarget.secretChanged || create.initialValueChanged
  return {
    title: MODE_TITLES[isEdit ? 'edit' : 'add'][mode],
    caption: valueCaption(mode, isEdit),
    kind: mode === 'input' ? 'literal' : create.draftKind,
    stripMessage: create.draftNull ? undefined : create.valueProblems[0],
    showSecretNotice:
      tracksUnsavedSecret && mode !== 'input' && create.draftSecret && create.valueView === 'initial' && storedValueChanged,
    renameAcross: inFunction ? 'Function' : 'test',
    // A read-only definition takes only a Current value: its Initial value is shown, never changed.
    valueReadOnly: create.definitionReadOnly && create.valueView === 'initial',
  }
}

/** Type, and Kind beside it except on an input or while Set to null is ticked. */
function TypeKindRow({ mode, create }: Readonly<{ mode: VariableCreateMode; create: UseInspectCreate }>) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <TypeSelectField
        value={create.draftType}
        options={create.enumOn ? ENUM_TYPE_OPTIONS : TYPE_OPTIONS}
        disabled={create.definitionReadOnly}
        onValueChange={create.setDraftType}
      />
      {mode !== 'input' && !create.draftNull && (
        <KindSelectField
          value={create.draftKind}
          options={create.draftType === 'string' ? STRING_KINDS : SCALAR_KINDS}
          disabled={create.definitionReadOnly}
          onValueChange={create.setDraftKind}
        />
      )}
    </div>
  )
}

interface ValueFieldProps {
  create: UseInspectCreate
  id: string
  captionId: string
  caption: string
  kind: VariableCreateKind
  readOnly: boolean
  availableVariables: AvailableVariable[]
  onEditSecret: () => void
}

/** The window's value field for the shown value, with the cycle message under it. */
function WindowValue({ create, id, captionId, caption, kind, readOnly, availableVariables, onEditSecret }: Readonly<ValueFieldProps>) {
  return (
    <>
      <WindowValueField
        key={create.valueFieldKey}
        id={id}
        labeledBy={captionId}
        label={caption}
        type={create.draftType}
        kind={kind}
        value={create.enumValueError === null ? create.draftValue : ''}
        elementTypes={create.draftElementTypes}
        nullState={nullStateOf(create.draftNull, create.nullLocked)}
        secret={create.secretFace}
        name={create.draftName}
        availableVariables={availableVariables}
        onChange={create.setDraftValue}
        onValidation={create.setValueProblems}
        onEmptyBlur={() => create.setDraftNull(true)}
        onExpressionBlur={create.handleExpressionBlur}
        onEditSecret={onEditSecret}
        blank={create.blankMeansNoDefault ? 'unset' : 'refuse'}
        nullReason={create.nullForced === null ? undefined : NULL_FORCED_REASON[create.nullForced]}
        enumValues={create.enumOn ? create.paramMeta.enumValues : undefined}
        enumError={create.enumValueError ?? undefined}
        readOnly={readOnly}
      />
      {create.errors.cycle && !create.draftNull && <FieldError testId="create-cycle-error" message={create.errors.cycle} />}
    </>
  )
}

/** The confirms a Type or Kind change asks before it clears the values (VMGR-108). */
function DefinitionChangeConfirms({ create }: Readonly<{ create: UseInspectCreate }>) {
  return (
    <>
      {create.pendingTypeChange && (
        <TypeChangeConfirmDialog
          open
          subject="variable"
          prevType={create.pendingTypeChange.prevType}
          nextType={create.pendingTypeChange.nextType}
          currentLength={create.pendingTypeChange.currentLength}
          onConfirm={create.confirmTypeChange}
          onCancel={create.cancelTypeChange}
        />
      )}
      {create.pendingKindChange && (
        <KindChangeConfirmDialog
          open
          prevKind={create.pendingKindChange.prevKind}
          nextKind={create.pendingKindChange.nextKind}
          type={create.pendingKindChange.type}
          currentLength={create.pendingKindChange.currentLength}
          onConfirm={create.confirmKindChange}
          onCancel={create.cancelKindChange}
        />
      )}
    </>
  )
}

export function VariableCreateModal({
  mode,
  availableVariables,
  onCreate,
  onClose,
  checkNameExists,
  validateExpressionCycle,
  windowId,
  cascadeIndex = 0,
  nameRef,
  editTarget,
  tracksUnsavedSecret = false,
  secretSaveTarget = 'test',
  runLocked,
  sessionId,
  onSaveDefinition,
  onSaveCurrent,
}: Readonly<VariableCreateModalProps>) {
  const isEdit = editTarget !== undefined
  const childEditors = useChildEditorScope()
  const protectedConfirm = useProtectedValueConfirm()
  const [askClose, setAskClose] = useState(false)
  const [askMakeSecret, setAskMakeSecret] = useState(false)
  const [askRemoveSecret, setAskRemoveSecret] = useState(false)
  const valueId = useId()
  const valueCaptionId = useId()
  const allowedValuesId = useId()
  const enumErrorId = useId()

  const create = useInspectCreate({
    mode,
    editTarget,
    sessionId,
    runLocked,
    checkNameExists,
    validateExpressionCycle,
    onSaveDefinition: isEdit ? onSaveDefinition : onCreate,
    onSaveCurrent,
    onSaved: onClose,
  })

  const unsaved = create.dirty.definition || create.dirty.current || childEditors.hasChanges
  // An open "Edit value" sheet's change may be either value, so it counts as more than a Current change.
  const definitionChanged = create.dirty.definition || childEditors.hasChanges
  const runLock = isEdit && runLocked

  // The make-secret confirm's answer, awaited by the Save that asked it.
  const makeSecretAnswerRef = useRef<((proceed: boolean) => void) | null>(null)
  const answerMakeSecret = useCallback((proceed: boolean) => {
    const answer = makeSecretAnswerRef.current
    makeSecretAnswerRef.current = null
    setAskMakeSecret(false)
    answer?.(proceed)
  }, [])
  // A window closed while its confirm is open never saves.
  useEffect(() => () => answerMakeSecret(false), [answerMakeSecret])
  const askMakeSecretFirst = () =>
    new Promise<boolean>((resolve) => {
      makeSecretAnswerRef.current = resolve
      setAskMakeSecret(true)
    })

  const trySaveRef = useRef(create.trySave)
  trySaveRef.current = create.trySave
  const resetRef = useRef(create.reset)
  resetRef.current = create.reset

  // The window's Save with every confirm it asks; null when the person canceled one.
  const saveWithConfirms = async (): Promise<WindowSaveOutcome | null> => {
    if (create.makesSecret && !(await askMakeSecretFirst())) return null
    return trySaveRef.current()
  }
  // An open "Edit value" sheet writes its draft first, so Save must read the window after it (SAVE-1).
  const saveRef = useRef(saveWithConfirms)
  saveRef.current = saveWithConfirms
  const { applyAll } = childEditors
  const runSave = useCallback(() => {
    applyAll()
    return saveRef.current()
  }, [applyAll])
  // The Save reports a refused or rejected write itself and never rejects.
  const handleSave = () => {
    runSave().catch(() => undefined)
  }

  // VMGR-64: an Edit window holding any unsaved change holds a Run / Resume behind the run-conflict dialog.
  const setPending = usePendingCurrentEdits((state) => state.setPending)
  const clearPending = usePendingCurrentEdits((state) => state.clearPending)
  const pendingName = editTarget?.row.name ?? null
  const scopeKey = JSON.stringify(editTarget?.scope ?? null)
  useEffect(() => {
    if (!unsaved || pendingName === null) return
    const functionPath = JSON.parse(scopeKey) as string[] | null
    setPending({
      name: pendingName,
      functionPath,
      definitionChanged,
      save: async () => {
        const outcome = await runSave()
        if (outcome === null) throw new SaveCanceledError()
        if (!outcome.saved) throw outcome.problem
      },
      drop: () => resetRef.current(),
    })
    return () => clearPending(pendingName, functionPath)
  }, [unsaved, definitionChanged, pendingName, scopeKey, runSave, setPending, clearPending])

  const requestClose = () => {
    if (unsaved) {
      setAskClose(true)
      return
    }
    onClose()
  }

  // Unticking Mark as secret on a saved secret deletes its stored value, so it asks first (VMGR-109).
  const handleSecretChange = (next: boolean) => {
    if (!next && create.holdsSavedSecret) {
      setAskRemoveSecret(true)
      return
    }
    create.setDraftSecret(next)
  }

  const { title, caption, kind, stripMessage, showSecretNotice, renameAcross, valueReadOnly } = windowLabels({
    mode,
    create,
    editTarget,
    tracksUnsavedSecret,
  })
  // Width only: the height follows the fields until the person resizes the window by hand.
  const size = getCreateSheetWidth(mode)
  const offset = cascadeOffset(cascadeIndex)

  const pill = isEdit ? (
    <ModeDropdown
      size="label"
      value={create.valueView}
      onValueChange={(view) => create.setValueView(view === 'current' ? 'current' : 'initial')}
      options={VALUE_SWITCH_OPTIONS}
      labels={mode === 'input' ? INPUT_VALUE_LABELS : undefined}
      ariaLabel="Value to edit"
    />
  ) : undefined

  const allowedValues = create.enumOn && (
    <div className="space-y-1.5">
      <Label htmlFor={allowedValuesId} className={FIELD_LABEL_CLASS}>
        Allowed values
        <RequiredMark />
      </Label>
      <WindowValueField
        key={create.allowedValuesKey}
        field="allowed-values"
        id={allowedValuesId}
        label="Allowed values"
        type="array"
        kind="literal"
        value={create.paramMeta.enumValues}
        itemType={create.draftType as ListItemType}
        nullState="off"
        secret="none"
        name={create.draftName}
        availableVariables={availableVariables}
        onChange={(next) => create.setEnumValues(next as unknown[])}
        onValidation={create.setAllowedValuesProblems}
        readOnly={create.definitionReadOnly}
        errorId={create.enumError ? enumErrorId : undefined}
      />
      {create.enumError && <FieldError id={enumErrorId} testId="create-enum-error" message={create.enumError} />}
    </div>
  )

  const valueBody = (
    <>
      {allowedValues}
      <CreateValueArea
        caption={caption}
        captionFor={valueId}
        captionId={valueCaptionId}
        dimmed={create.nullForced !== null}
        // The star marks an enum input's Default value (FIELD-12), the Add caption.
        required={create.enumOn && !isEdit}
        pill={pill}
      >
        <WindowValue
          create={create}
          id={valueId}
          captionId={valueCaptionId}
          caption={caption}
          kind={kind}
          readOnly={valueReadOnly}
          availableVariables={availableVariables}
          onEditSecret={() => protectedConfirm.open(create.clearSecret)}
        />
      </CreateValueArea>
    </>
  )

  return (
    <>
      <DraggableSheet
        open
        onClose={requestClose}
        sheetId={`variable-create-${windowId}`}
        persistGeometry
        resizable
        ariaLabel={title}
        data-testid="variable-create-modal"
        dataAttributes={{ 'data-window-mode': isEdit ? 'edit' : 'add' }}
        initialOffset={{ x: offset, y: offset }}
        initialWidth={size.width}
        minWidth={size.minWidth}
        className="max-w-[90vw] max-h-screen shadow-xl"
        header={
          <CreateSheetHeader
            title={title}
            mode={mode}
            closeLabel={isEdit ? 'Close edit form' : 'Close create form'}
            onClose={requestClose}
          />
        }
      >
        <ChildEditorsProvider scope={childEditors}>
          <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-3 pb-4">
            <NameBlock
              value={create.draftName}
              error={create.errors.name}
              readOnly={create.definitionReadOnly}
              onChange={create.setDraftName}
              nameRef={nameRef}
            >
              {create.renamedFrom !== null && <RenameNotice oldName={create.renamedFrom} across={renameAcross} />}
            </NameBlock>
            <CreateParamFields
              mode={mode}
              type={create.draftType}
              typeIsEnumerable={isEnumerableType(create.draftType)}
              required={create.paramMeta.required}
              createEnum={create.paramMeta.createEnum}
              description={create.paramMeta.description}
              onRequiredChange={create.setRequired}
              onCreateEnumChange={create.setCreateEnum}
              onDescriptionChange={create.setDescription}
              typeField={<TypeKindRow mode={mode} create={create} />}
              valueBody={valueBody}
              secret={create.draftSecret}
              onSecretChange={handleSecretChange}
              enumLocksSecret={create.enumLocksSecret}
              secretLocksEnum={create.secretLocksEnum}
              setToNull={{
                ticked: create.draftNull,
                forcedBy: create.nullForced,
                disabledByEnum: create.nullDisabledByEnum,
                onChange: create.setDraftNull,
                hidden: kind !== 'literal',
                locked: valueReadOnly,
              }}
              readOnly={create.definitionReadOnly}
            />
            {create.errors.submit && <FieldError testId="create-submit-error" message={create.errors.submit} />}
          </div>

          {stripMessage !== undefined && (
            <ValidationStrip testId="create-validation" message={stripMessage} messages={create.valueProblems} />
          )}
          {showSecretNotice && <SecretVisibilityNotice saveTarget={secretSaveTarget} />}

          <div className="flex items-center justify-end gap-2 px-3 py-2 border-t bg-muted/30 rounded-b-lg shrink-0">
            <Button type="button" variant="outline" size="sm" data-testid="create-cancel-button" onClick={requestClose}>
              Cancel
            </Button>
            <SubmitButton
              label={isEdit ? 'Save' : 'Create'}
              loading={create.saving}
              invalid={create.saveDisabledReason !== null}
              lockReason={runLock ? RUN_LOCK_REASON : null}
              onClick={handleSave}
            />
          </div>
        </ChildEditorsProvider>
      </DraggableSheet>
      <DefinitionChangeConfirms create={create} />
      {protectedConfirm.dialog}
      {editTarget && (
        <ConfirmationDialog
          isOpen={askMakeSecret}
          onClose={() => answerMakeSecret(false)}
          onConfirm={() => answerMakeSecret(true)}
          variant="make-secret"
          description={makeSecretText(editTarget.row.name)}
        />
      )}
      <ConfirmationDialog
        isOpen={askRemoveSecret}
        onClose={() => setAskRemoveSecret(false)}
        onConfirm={() => {
          setAskRemoveSecret(false)
          create.setDraftSecret(false)
        }}
        variant="delete"
        title="Remove Secret Protection?"
        description={REMOVE_SECRET_TEXT}
        confirmLabel="Remove & Delete Value"
      />
      <UnsavedChangesDialog
        open={askClose}
        onKeepEditing={() => setAskClose(false)}
        onClose={() => {
          setAskClose(false)
          onClose()
        }}
        onSave={() => {
          setAskClose(false)
          handleSave()
        }}
        saveDisabled={create.saveDisabledReason !== null}
      />
    </>
  )
}
