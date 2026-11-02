/**
 * ValueEditorSheet - the Variable Setter's "Edit value" sheet for a string or complex row value (REQ-3.5.5.1).
 *
 * REQ-3.1.3.11: Variable Manager UI panel
 * REQ-3.4.1.14: Variable setter control
 * REQ-3.1.3.15: Template variables
 * REQ-3.4.1.2: Python script execution
 * REQ-3.4.1.6: SQL database operations
 * REQ-3.3.2.6: OpenSearch query editor
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import { GripVertical, Loader2, Play, Square, X } from 'lucide-react'
import type { CompletionSource } from '@codemirror/autocomplete'
import { tooltips, type EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { DraggableSheet, type SheetHandle } from '@/components/shared/draggable-sheet'
import { useChildEditor } from '@/components/shared/child-editors/child-editor-scope'
import { UnsavedChangesDialog } from '@/components/shared/child-editors/unsaved-changes-dialog'
import { ScalarEditBody } from '@/components/shared/variable-bodies/scalar-edit-body'
import type { ArrayEditBodyProps, ListItemType } from '@/components/shared/variable-bodies/array-edit-body'
import type { ItemTextEditorProps } from '@/components/shared/variable-bodies/body-parts'
import { unmetHeaderAdvisories } from '@/features/workbench/common/element-config/parameters/expected-headers-advisory'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'
import { useTemplateExtensions } from '@/features/workbench/hooks/use-template-extensions'
import { useScriptSyntaxIssues } from '@/features/workbench/hooks/use-script-syntax-issues'
import { useSqlCatalog, type UseSqlCatalogResult } from '@/features/workbench/hooks/use-sql-catalog'
import {
  useOpenSearchFields,
  type UseOpenSearchFieldsResult,
} from '@/features/workbench/hooks/use-opensearch-fields'
import { checkPython } from '@/features/workbench/api/python-tools'
import type { SqlCatalogRequest, SqlTable } from '@/features/workbench/api/sql-tools'
import type { OpenSearchField, OpenSearchFieldsRequest } from '@/features/workbench/api/opensearch-tools'
import { buildPythonModeExtensions } from '@/features/workbench/lib/codemirror/python-mode'
import { insertAtCursor } from '@/features/workbench/lib/codemirror/script-body'
import { buildSqlModeExtensions } from '@/features/workbench/lib/codemirror/sql-mode'
import { createSqlCompletionSource } from '@/features/workbench/lib/codemirror/sql-completion'
import { buildDqlModeExtensions } from '@/features/workbench/lib/codemirror/dql-mode'
import { buildQueryDslModeExtensions } from '@/features/workbench/lib/codemirror/query-dsl-mode'
import { createOpenSearchCompletionSource } from '@/features/workbench/lib/codemirror/opensearch-completion'
import { FILL_IN_INDEX_PATTERN, indexPatternIsBlank } from '@/features/workbench/lib/opensearch/connection'
import {
  isScriptWarning,
  mergeScriptIssues,
  OPENSEARCH_LANGUAGES,
  scriptIssueText,
  type OpenSearchMode,
  type ScriptIssue,
  type ScriptMode,
  type ScriptSyntaxError,
} from '@/features/workbench/lib/python-script-validation/script-issues'
import type { ScriptSyntaxOptions } from '@/features/workbench/hooks/use-script-syntax-issues'
import type { ScriptInputs } from '@/features/workbench/lib/python-script-validation/check-script'
import { createPythonRenameExtension } from '@/features/workbench/lib/codemirror/python-rename'
import { createPythonServerCompletionSource } from '@/features/workbench/lib/codemirror/python-server-completion'
import { suggestionList } from '@/features/workbench/lib/codemirror/suggestion-list'
import { formatContent, validateFormatSyntax } from '@/lib/codemirror/format-utils'
import type { TextFormat, ResolvedFormat, SqlDatabaseType } from '@/lib/codemirror/format-editor'
import type { VariableType } from '@/lib/variable-types'
import { isTableShape } from '@/lib/variable-table-model'
import { formatComplexMetric, getTypeBadgeClass } from '@/lib/variable-format'
import { nestedValueFromText, nestedValueText } from '@/lib/variable-validation'
import { ComplexValueBody, type ListEditorSlots } from './complex-value-body'
import {
  isComplexEditorType,
  useComplexValueEditor,
  type MapEntryEditorOptions,
} from './use-complex-value-editor'
import type { ElementTypes } from '@/lib/variable-validation'
import { ViewDropdown, type InspectView } from './view-dropdown'
import { FormatDropdown } from './format-dropdown'
import { KindDropdown, type ValueKind } from './kind-dropdown'
import { ValidationStrip } from './validation-strip'
import { PythonHelpPopover } from './python-help-popover'
import {
  AggregationHelpPopover,
  OpenSearchHelpPopover,
  SqlHelpPopover,
  type ScriptHelpPopoverProps,
} from './script-help-popover'
import {
  CatalogChip,
  OPENSEARCH_CATALOG_NOUNS,
  SQL_CATALOG_NOUNS,
  type CatalogChipNouns,
} from './catalog-chip'
import type { CatalogItem } from './catalog-popover'
import { cascadeOffset, getValueEditorSheetSize } from './sheet-sizes'
import { useTransientFormat } from './use-transient-format'

const NO_NAMES: string[] = []
const NO_VARIABLES: AvailableVariable[] = []
const NO_TYPES: Record<string, string> = {}
// A text item's own editor stacks above the list or map editor it was opened from.
const ITEM_SHEET_ID = 'value-editor-item'
// Each nested level keeps its own place, stepped off the level it was opened from.
const NESTED_SHEET_ID = 'value-editor-level'
// CodeMirror's editable surface, never the tabbable scroller around it.
const EDITOR_FOCUS_TARGET = '.cm-content'

const VALUE_EDITOR_DIALOG_TEST_IDS = {
  dialog: 'value-editor-unsaved-dialog',
  keepEditing: 'value-editor-unsaved-keep-button',
  close: 'value-editor-unsaved-discard-button',
  save: 'value-editor-unsaved-save-button',
}

/** A table lists its columns under its name. */
function sqlTableItem(table: SqlTable): CatalogItem {
  return {
    name: table.name,
    detail: '',
    children: table.columns.map((column) => ({ name: column.name, detail: column.type })),
  }
}

/** A field shows its types beside its name. */
function openSearchFieldItem(field: OpenSearchField): CatalogItem {
  return { name: field.name, detail: field.types.join(', ') }
}

type CatalogPull = Pick<
  UseSqlCatalogResult & UseOpenSearchFieldsResult,
  'state' | 'count' | 'error' | 'start' | 'stop' | 'refresh' | 'settle'
>

/** The catalog a script body pulls into its footer chip: tables for SQL, fields for OpenSearch (SQL-12, OS-12). */
interface FooterCatalog {
  pull: CatalogPull
  items: readonly CatalogItem[] | null
  nouns: CatalogChipNouns
  /** Why nothing can be pulled yet, or null. */
  blockedNote: string | null
}

function footerCatalogOf(
  scriptMode: ScriptMode | null,
  tables: UseSqlCatalogResult,
  fields: UseOpenSearchFieldsResult,
  fieldsBlocked: boolean,
): FooterCatalog | null {
  if (scriptMode === 'sql') {
    return {
      pull: tables,
      items: tables.tables?.map(sqlTableItem) ?? null,
      nouns: SQL_CATALOG_NOUNS,
      blockedNote: null,
    }
  }
  if (openSearchModeOf(scriptMode) === null) return null
  return {
    pull: fields,
    items: fields.fields?.map(openSearchFieldItem) ?? null,
    nouns: OPENSEARCH_CATALOG_NOUNS,
    blockedNote: fieldsBlocked ? FILL_IN_INDEX_PATTERN : null,
  }
}

/** The Get tables and Get fields pulls a script body makes, and the footer chip they feed. */
function useScriptCatalogs(
  scriptMode: ScriptMode | null,
  sqlCatalogRequest: SqlCatalogRequest | null,
  openSearchFieldsRequest: OpenSearchFieldsRequest | null,
) {
  const catalog = useSqlCatalog(scriptMode === 'sql' ? sqlCatalogRequest : null)
  const fields = useOpenSearchFields(openSearchModeOf(scriptMode) === null ? null : openSearchFieldsRequest)
  // A field list needs an Index pattern; a blank one's pull lists indexes only (OS-13).
  const fieldsBlocked = openSearchFieldsRequest !== null && indexPatternIsBlank(openSearchFieldsRequest)
  const fieldsJobId = fieldsBlocked ? null : fields.jobId
  const footerCatalog = footerCatalogOf(scriptMode, catalog, fields, fieldsBlocked)
  return { catalog, fields, fieldsBlocked, fieldsJobId, footerCatalog }
}

/** Body-parent tooltips, so the suggestion list escapes the sheet's clipped edges. */
function suggestionExtensions(source: CompletionSource): Extension[] {
  return [
    tooltips({ parent: document.body, position: 'fixed' }),
    suggestionList({ override: [source], activateOnTyping: true }),
  ]
}

const VISUAL_CODE_VIEWS: InspectView[] = ['visual', 'code']
const VISUAL_DISABLED: InspectView[] = ['visual']

interface ScriptModeConfig {
  /** The footer keeps Kind and Format; a Python body has neither (PYRUN-13). */
  valueControls: boolean
  /** The body may be Template kind; a Custom (JSON) aggregation is literal only (OS-12). */
  templateKind: boolean
  /** Run / Stop and Shift+Enter; a Custom (JSON) aggregation never runs (OS-12). */
  runs: boolean
  Help: (props: Readonly<ScriptHelpPopoverProps>) => ReactNode
}

const QUERY_MODE: ScriptModeConfig = {
  valueControls: true,
  templateKind: true,
  runs: true,
  Help: OpenSearchHelpPopover,
}

const SCRIPT_MODES: Record<ScriptMode, ScriptModeConfig> = {
  python: { valueControls: false, templateKind: true, runs: true, Help: PythonHelpPopover },
  sql: { valueControls: true, templateKind: true, runs: true, Help: SqlHelpPopover },
  dql: QUERY_MODE,
  'query-dsl': QUERY_MODE,
  'aggregation-json': { valueControls: true, templateKind: false, runs: false, Help: AggregationHelpPopover },
}

const SCRIPT_FORMATS: ReadonlySet<ResolvedFormat | undefined> = new Set(Object.keys(SCRIPT_MODES) as ScriptMode[])

/** PYRUN-13, SQL-10, OS-12: a body locked to a script format is a script editor, not a value field. */
function scriptModeOf(lockedFormat: ResolvedFormat | undefined): ScriptMode | null {
  return SCRIPT_FORMATS.has(lockedFormat) ? (lockedFormat as ScriptMode) : null
}

/** A script editor keeps its own remembered size, apart from the plain value editor. */
function defaultSheetIdOf(scriptMode: ScriptMode | null): string {
  return scriptMode === null ? 'value-editor' : `value-editor-${scriptMode}`
}

function openSearchModeOf(scriptMode: ScriptMode | null): OpenSearchMode | null {
  return scriptMode === null || scriptMode === 'python' || scriptMode === 'sql' ? null : scriptMode
}

function scriptConfigOf(scriptMode: ScriptMode | null): ScriptModeConfig | null {
  return scriptMode === null ? null : SCRIPT_MODES[scriptMode]
}

/** The text the script checks read; a value field has none. */
function scriptTextOf(scriptMode: ScriptMode | null, draft: unknown): string {
  return scriptMode === null ? '' : String(draft)
}

/** A script body stays in its language in Template kind too. */
function bodyFormatOf(
  kind: ValueKind,
  scriptMode: ScriptMode | null,
  resolvedFormat: ResolvedFormat,
): ResolvedFormat | undefined {
  return kind === 'literal' || scriptMode !== null ? resolvedFormat : undefined
}

/** The complex body's Visual or Code view; a string body is always visual. */
function bodyViewOf(isComplex: boolean, view: 'visual' | 'code'): 'visual' | 'code' {
  return isComplex ? view : 'visual'
}

/** Run, or while a run started here is in flight, a spinner and Stop (SQL-13, PYRUN-21). */
function RunStopControl({
  runBusy,
  runDisabled,
  runBlockedNote,
  onRun,
  onStop,
}: Readonly<{
  runBusy: boolean
  runDisabled: boolean
  runBlockedNote: string | null
  onRun: () => void
  onStop?: () => void
}>) {
  return (
    <>
      {runBusy ? (
        <Loader2
          data-testid="value-editor-run-spinner"
          aria-hidden="true"
          className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none text-muted-foreground"
        />
      ) : null}
      <ConditionalTooltip content={runBusy ? null : runBlockedNote} disabled wide>
        <span className="inline-flex shrink-0">
          {/* Run and Stop share one button, so focus on it stays as it turns. */}
          {runBusy ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              data-testid="value-editor-stop-button"
              aria-label="Stop"
              onClick={onStop}
            >
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
              Stop
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              data-testid="value-editor-run-button"
              disabled={runDisabled}
              onClick={onRun}
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              Run
            </Button>
          )}
        </span>
      </ConditionalTooltip>
    </>
  )
}

/** A template value opens in Template kind only where the host allows one. */
function initialKind(allowTemplate: boolean, isTemplate: boolean): ValueKind {
  return allowTemplate && isTemplate ? 'template' : 'literal'
}

/** A complex type holding a value of another shape opens on that type's empty value. */
function coerceInitialValue(type: VariableType, value: unknown): unknown {
  if (type === 'array') return Array.isArray(value) ? value : []
  // A table opens as stored: a list of rows or {columns, rows} with its column types.
  if (type === 'table') return isTableShape(value) ? value : []
  if (type === 'map') {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  }
  return value
}

/** The parser's verdict for one exact script text. */
interface ServerCheck {
  script: string
  issues: ScriptSyntaxError[]
}

/** Two issue lists that read the same on screen. */
function sameIssues(left: ScriptIssue[], right: ScriptIssue[]): boolean {
  return left.map(scriptIssueText).join('\n') === right.map(scriptIssueText).join('\n')
}

/** What a host adds to the list editor (array only): its {x} items travel as index keys on Save. */
export interface ListEditorOptions
  extends Pick<ArrayEditBodyProps, 'expressionEditor' | 'renderItemInput' | 'positionLabel' | 'newItem'> {
  /** The items held as {x} when the sheet opens. */
  expressionIndices?: Iterable<number>
  /** The list keeps the Visual / Code switch, its {x} items written bare in Code. */
  codeView?: boolean
}

/** The keys held as {x} when the sheet opens: map keys, or list indices as text. */
function seededExpressionKeys(
  mapEntryOptions: MapEntryEditorOptions | undefined,
  listEditor: ListEditorOptions | undefined,
): Set<string> {
  if (mapEntryOptions?.expressionKeys) return new Set(mapEntryOptions.expressionKeys)
  return new Set([...(listEditor?.expressionIndices ?? [])].map(String))
}

/** Serialized save payload (value + kind + expr keys + element types) for the dirty check. */
function editorSnapshot(
  draft: unknown,
  kind: ValueKind,
  exprKeys: Set<string>,
  elementTypes: ElementTypes | undefined,
): string {
  return JSON.stringify([draft, kind, [...exprKeys].sort((a, b) => a.localeCompare(b)), elementTypes])
}

/** A malformed locked json/xml literal blocks Save. */
function lockedLiteralErrorOf(
  lockedFormat: ResolvedFormat | undefined,
  kind: ValueKind,
  draft: unknown,
): string | null {
  return lockedFormat && kind === 'literal' ? validateFormatSyntax(String(draft), lockedFormat) : null
}

/** A single allowedFormats pins the picker to that one format (disabled, no Auto).
 *  Strings only - complex types have no format picker. */
function lockedFormatOf(
  isComplex: boolean,
  allowedFormats: TextFormat[] | undefined,
): ResolvedFormat | undefined {
  return !isComplex && allowedFormats?.length === 1 ? (allowedFormats[0] as ResolvedFormat) : undefined
}

export interface ValueEditorSheetProps {
  /** Lets the opener raise this sheet again. */
  ref?: Ref<SheetHandle>
  /** The label of the row this editor was opened from, as the row shows it. */
  label: string
  /** The owning row's variable name (for the template autocomplete scope only;
   *  never shown - the sheet edits the value, not the name). */
  name: string
  type: VariableType
  value: unknown
  /** Seeds Kind=Template for a string value (a row already flagged template). */
  isTemplate: boolean
  /** When false, the Kind dropdown is suppressed and the kind is forced literal
   *  (the Format dropdown stays) - for literal-only consumers like profiles. */
  allowTemplate?: boolean
  /** Restricts the literal-string Format dropdown to a parameter's permitted
   *  formats (a JSON-only Body param). Omitted -> the full menu. */
  allowedFormats?: TextFormat[]
  /** Map only: keeps a parameter map string->string (HTTP headers). */
  stringValuesOnly?: boolean
  /** Map only: key policy / scaffolds / advisory / generated rows / template slot. */
  mapEntryOptions?: MapEntryEditorOptions
  /** Array only: per-item {x}, a row input, position labels, the value Add appends; a Code view only with `codeView`. */
  listEditor?: ListEditorOptions
  /** Array / map only: the value's declared element types (REQ-3.1.3.19). */
  elementTypes?: ElementTypes
  /** Array only: every item takes this type (an enum input's allowed values, VMGR-112). */
  itemType?: ListItemType
  availableVariables: AvailableVariable[]
  /** The canvas block this value belongs to - the syntax-issue store key. */
  nodeId?: string
  /** Python mode: this block's Input Variables, completed by name. */
  inputVariables?: AvailableVariable[]
  /** Python mode: the WAVE type of each Input Variable whose type is known, for the live checks. */
  inputVariableTypes?: Record<string, string>
  /** Python mode: the Variable Export names a rename may reach. */
  exportNames?: string[]
  /** Python mode: the Interpreter row text, raw and unresolved. */
  interpreter?: string
  /** Script modes: run the draft once without saving it (PYRUN-21, SQL-13). */
  onRun?: (draft: string) => void
  /** Script modes: stop the run started from this editor (SQL-13). */
  onStop?: () => void
  /** Script modes: a run started from this editor is in flight, so Run turns into Stop. */
  runBusy?: boolean
  /** Script modes: the run state allows a run from this block. */
  runAllowed?: boolean
  /** Script modes: what blocks the parent's Save besides this script; Run waits on it too. */
  runBlockedNote?: string | null
  /** Python mode: F2 renamed a symbol the block declares as a row. */
  onRenameSymbol?: (oldName: string, newName: string) => void
  /** Python mode: the parser's verdict after a Save or a Run, with the live check warnings, for the block. */
  onSyntaxIssues?: (issues: ScriptIssue[]) => void
  /** SQL mode: the block's Database type. */
  databaseType?: SqlDatabaseType
  /** SQL mode: the Parameters entry names; null while Parameters is an expression. */
  parameterNames?: readonly string[] | null
  /** SQL mode: the request the Get Tables pull sends. */
  sqlCatalogRequest?: SqlCatalogRequest | null
  /** OpenSearch modes: the request the Get fields pull sends. */
  openSearchFieldsRequest?: OpenSearchFieldsRequest | null
  /** OpenSearch modes: the Index pattern the check findings name. */
  openSearchIndex?: string
  /** Distinct geometry/focus id when stacking above another value editor. */
  sheetId?: string
  /** The nested level of a list or map: 1 opened from the field, one more per List or Map entry it opened from. */
  level?: number
  /** Hosts inside a dialog that owns ESC intercept it in the capture phase so
   *  ESC reaches this sheet (and its unsaved-draft guard) first. */
  captureEsc?: boolean
  onSave: (
    value: unknown,
    isTemplate: boolean,
    exprKeys: string[],
    elementTypes: ElementTypes | undefined,
  ) => void
  onClose: () => void
}

/** The parse options a script's live syntax check takes: SQL its catalog, OpenSearch its index. */
function scriptSyntaxOptionsOf(
  scriptMode: ScriptMode | null,
  openSearchMode: OpenSearchMode | null,
  all: Omit<ScriptSyntaxOptions, 'openSearch'> & Required<Pick<ScriptSyntaxOptions, 'inputs' | 'openSearch'>>,
): ScriptSyntaxOptions {
  if (scriptMode === 'sql') {
    const { inputs, databaseType, parameterNames, tables, variables, template } = all
    return { inputs, databaseType, parameterNames, tables, variables, template }
  }
  if (openSearchMode !== null) return { template: all.template, openSearch: all.openSearch }
  return { inputs: all.inputs }
}

/** Whether Save and Run take a click: a run in flight holds both (SQL-13); syntax never blocks Save (PYRUN-13). */
function sheetGates(state: {
  bodyValid: boolean
  semanticInvalid: boolean
  lockedLiteralError: string | null
  isDirty: boolean
  runBusy: boolean
  runAllowed: boolean
  hasSyntaxError: boolean
  runBlockedNote: string | null
}) {
  const cannotBeSaved = !state.bodyValid || state.semanticInvalid || state.lockedLiteralError !== null
  return {
    cannotBeSaved,
    saveDisabled: cannotBeSaved || !state.isDirty || state.runBusy,
    runDisabled: state.runBusy || !state.runAllowed || state.hasSyntaxError || state.runBlockedNote !== null,
  }
}

/** The item or entry count a list, map or table shows in the footer. */
function complexMetricOf(draft: unknown, type: VariableType): string | null {
  return isComplexEditorType(type) ? formatComplexMetric(draft, type) : null
}

/** A plain value shows its Kind and format pickers unless its script editor hides them. */
function showsValueControls(type: VariableType, scriptConfig: ScriptModeConfig | null): boolean {
  return !isComplexEditorType(type) && (scriptConfig?.valueControls ?? true)
}

/** A plain value in its literal kind, the one that takes the string editor's format tools. */
function isLiteralText(isComplex: boolean, kind: ValueKind): boolean {
  return !isComplex && kind === 'literal'
}

export function ValueEditorSheet({
  ref,
  label,
  type,
  value,
  isTemplate,
  allowTemplate = true,
  allowedFormats,
  stringValuesOnly,
  mapEntryOptions,
  listEditor,
  elementTypes,
  itemType,
  availableVariables,
  nodeId = '',
  inputVariables = NO_VARIABLES,
  inputVariableTypes = NO_TYPES,
  exportNames = NO_NAMES,
  interpreter = '',
  onRun,
  onStop,
  runBusy = false,
  runAllowed = false,
  runBlockedNote = null,
  onRenameSymbol,
  onSyntaxIssues,
  databaseType = 'postgresql',
  parameterNames = null,
  sqlCatalogRequest = null,
  openSearchFieldsRequest = null,
  openSearchIndex = '',
  sheetId,
  level = 1,
  captureEsc = false,
  onSave,
  onClose,
}: Readonly<ValueEditorSheetProps>) {
  const isComplex = isComplexEditorType(type)
  const [draft, setDraft] = useState<unknown>(() => coerceInitialValue(type, value))
  const [draftExprKeys, setDraftExprKeys] = useState<Set<string>>(() =>
    seededExpressionKeys(mapEntryOptions, listEditor),
  )
  const [bodyValid, setBodyValid] = useState(true)
  const lockedFormat = lockedFormatOf(isComplex, allowedFormats)
  const scriptMode = scriptModeOf(lockedFormat)
  const scriptConfig = scriptConfigOf(scriptMode)
  const openSearchMode = openSearchModeOf(scriptMode)
  const templateAllowed = allowTemplate && scriptConfig?.templateKind !== false
  const [kind, setKind] = useState<ValueKind>(initialKind(templateAllowed, isTemplate))
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [view, setView] = useState<'visual' | 'code'>('visual')
  const [formatKey, setFormatKey] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpAnchor, setHelpAnchor] = useState<HTMLElement | null>(null)
  const [serverCheck, setServerCheck] = useState<ServerCheck | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const lockedLiteralError = lockedLiteralErrorOf(lockedFormat, kind, draft)

  // Auto detects live from the current draft so highlighting tracks what you type.
  const { format, setFormat, detectedFormat, resolvedFormat, isDataFormat } = useTransientFormat(
    String(draft),
    isLiteralText(isComplex, kind),
    lockedFormat,
  )

  const template = kind === 'template'
  const runs = scriptConfig?.runs === true

  const templateExtensions = useTemplateExtensions(
    template && scriptMode === null,
    String(draft),
    availableVariables,
  )

  const script = scriptTextOf(scriptMode, draft)
  const scriptInputs = useMemo<ScriptInputs>(
    () => ({ names: inputVariables.map((variable) => variable.name), types: inputVariableTypes }),
    [inputVariables, inputVariableTypes],
  )
  const { catalog, fields, fieldsBlocked, fieldsJobId, footerCatalog } = useScriptCatalogs(
    scriptMode,
    sqlCatalogRequest,
    openSearchFieldsRequest,
  )
  const catalogTables = catalog.tables
  const syntaxOptions = scriptSyntaxOptionsOf(scriptMode, openSearchMode, {
    inputs: scriptInputs,
    databaseType,
    parameterNames,
    tables: catalogTables,
    variables: availableVariables,
    template,
    openSearch: { index: openSearchIndex, fieldsJobId },
  })
  const liveIssues = useScriptSyntaxIssues(nodeId, script, scriptMode, syntaxOptions)
  const liveWarnings = useMemo(() => liveIssues.filter(isScriptWarning), [liveIssues])
  // The parser's verdict for this exact script outranks the live parse; the check warnings stay.
  const issues = useMemo(
    () =>
      serverCheck?.script === script
        ? mergeScriptIssues(serverCheck.issues, liveWarnings)
        : liveIssues,
    [serverCheck, script, liveIssues, liveWarnings],
  )
  const hasSyntaxError = issues.some((issue) => !isScriptWarning(issue))
  const issueMessages = issues.map(scriptIssueText)

  const pythonExtensions = useMemo<Extension[] | undefined>(() => {
    if (scriptMode !== 'python') return undefined
    return [
      ...buildPythonModeExtensions({ issues }),
      // The rename box is a body-parent tooltip too.
      ...suggestionExtensions(createPythonServerCompletionSource(inputVariables, interpreter)),
      createPythonRenameExtension({
        interpreter,
        inputVariableNames: inputVariables.map((variable) => variable.name),
        exportNames,
        onRenameSymbol,
      }),
    ]
  }, [scriptMode, issues, inputVariables, interpreter, exportNames, onRenameSymbol])

  // The latest pull starters, so a changed catalog result never rebuilds the editor.
  const startCatalogRef = useRef(catalog.start)
  startCatalogRef.current = catalog.start
  const startFieldsRef = useRef(fields.start)
  startFieldsRef.current = fields.start
  const scriptViewRef = useRef<EditorView | null>(null)
  const sqlExtensions = useMemo<Extension[] | undefined>(() => {
    if (scriptMode !== 'sql') return undefined
    return [
      ...buildSqlModeExtensions({ databaseType, issues, template, viewRef: scriptViewRef }),
      ...suggestionExtensions(
        createSqlCompletionSource({
          databaseType,
          parameterNames,
          tables: catalogTables,
          variables: availableVariables,
          template,
          onGetTables: () => startCatalogRef.current(),
        }),
      ),
    ]
  }, [scriptMode, databaseType, issues, parameterNames, catalogTables, availableVariables, template])

  const openSearchExtensions = useMemo<Extension[] | undefined>(() => {
    if (openSearchMode === null) return undefined
    const buildMode = openSearchMode === 'dql' ? buildDqlModeExtensions : buildQueryDslModeExtensions
    return [
      ...buildMode({ issues, template, viewRef: scriptViewRef }),
      ...suggestionExtensions(
        createOpenSearchCompletionSource({
          language: OPENSEARCH_LANGUAGES[openSearchMode],
          fieldsJobId,
          variables: availableVariables,
          template,
          onGetFields: fieldsBlocked ? null : () => startFieldsRef.current(),
        }),
      ),
    ]
  }, [openSearchMode, issues, template, fieldsJobId, availableVariables, fieldsBlocked])

  const effectiveView = bodyViewOf(isComplex, view)
  const inCode = effectiveView === 'code'
  // A list's {x} items ride the same draft as a map's {x} keys, as index text.
  const listExprIndices = useMemo(() => new Set([...draftExprKeys].map(Number)), [draftExprKeys])
  const setListExprIndices = (indices: Iterable<number>) => setDraftExprKeys(new Set([...indices].map(String)))

  const complex = useComplexValueEditor({
    type,
    value: draft,
    onChange: setDraft,
    onValidChange: setBodyValid,
    view: effectiveView,
    seedKey: type,
    stringValuesOnly,
    mapEntry: mapEntryOptions,
    mapExprKeys: draftExprKeys,
    onMapExprKeysChange: setDraftExprKeys,
    listExprIndices: listEditor?.expressionEditor === undefined ? undefined : listExprIndices,
    onListExprIndicesChange: setListExprIndices,
    elementTypes,
    itemType,
  })

  // PYRUN-20: Save is dead until the draft differs from what was last saved.
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    editorSnapshot(
      value,
      initialKind(templateAllowed, isTemplate),
      seededExpressionKeys(mapEntryOptions, listEditor),
      complex.elementTypes,
    ),
  )
  const draftSnapshot = editorSnapshot(draft, kind, draftExprKeys, complex.elementTypes)
  const isDirty = draftSnapshot !== savedSnapshot

  // Syntax errors and check warnings never block Save (PYRUN-13); a run in flight does (SQL-13).
  const { cannotBeSaved, saveDisabled, runDisabled } = sheetGates({
    bodyValid,
    semanticInvalid: complex.semanticInvalid,
    lockedLiteralError,
    isDirty,
    runBusy,
    runAllowed,
    hasSyntaxError,
    runBlockedNote,
  })
  const metric = complexMetricOf(draft, type)
  // Amber-stripe data: expected headers with no manual equivalent in the draft.
  const advisoryMessages = unmetHeaderAdvisories(
    mapEntryOptions?.missingHeaderAdvisories,
    draft,
  ).map((advisory) => advisory.message)

  // Pretty-print the string draft in place; the formatKey bump re-mounts the
  // editor onto the formatted text. Shown only for a data format (not plain).
  const showStringFormatButton = isLiteralText(isComplex, kind) && isDataFormat
  const valueControls = showsValueControls(type, scriptConfig)
  const handleStringFormat = () => {
    setDraft(formatContent(String(draft), resolvedFormat))
    setFormatKey((key) => key + 1)
  }

  // The interpreter's own message replaces the live one; the save never waits
  // on it and is never blocked by it (PYRUN-13).
  const publishServerCheck = (checked: string): void => {
    // checkPython answers an empty result instead of rejecting; the handler is
    // the floating-promise rule's price.
    checkPython({ script: checked })
      .then((result) => {
        const found: ScriptSyntaxError[] = result.issues.map((issue) => ({
          line: issue.line,
          message: issue.message,
        }))
        const verdict = mergeScriptIssues(found, liveWarnings)
        onSyntaxIssues?.(verdict)
        if (sameIssues(issues, verdict)) return
        setServerCheck({ script: checked, issues: found })
      })
      .catch(() => {})
  }

  const commit = () =>
    onSave(complex.storedValue, !isComplex && kind === 'template', Array.from(draftExprKeys), complex.elementTypes)

  useChildEditor({ label, hasChanges: isDirty, cannotBeSaved, apply: commit })

  // PYRUN-20: Save applies and keeps the sheet open; only Close closes it.
  const handleSave = () => {
    commit()
    setSavedSnapshot(draftSnapshot)
    if (scriptMode === 'python') publishServerCheck(String(draft))
  }

  // PYRUN-21: Run executes the draft as it sits; it never writes the value.
  const runScript = () => {
    if (runDisabled) return
    onRun?.(String(draft))
    if (scriptMode === 'python') publishServerCheck(String(draft))
  }

  // SQL-12, OS-12: Got N tables / Got N fields settles at the next keystroke.
  const handleDraftChange = (next: unknown) => {
    setDraft(next)
    if (footerCatalog?.pull.state === 'done') footerCatalog.pull.settle()
  }

  const focusEditor = useCallback(() => {
    // The editor library hands focus back after its own teardown, by which
    // time the sheet may already be gone.
    const host = bodyRef.current
    if (!host) return
    const target = host.querySelector(EDITOR_FOCUS_TARGET) as HTMLElement
    target.focus()
  }, [])

  // A chord the sheet takes never reaches the editor inside, so it never edits the draft (PYRUN-20, PYRUN-21).
  const takeChord = (event: KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const handleSheetKey = (event: KeyboardEvent) => {
    if (event.ctrlKey && event.key === 'Enter') {
      takeChord(event)
      if (!saveDisabled) handleSave()
      return
    }
    if (scriptMode === null) return
    if (event.key === 'F1') {
      takeChord(event)
      setHelpOpen(true)
      return
    }
    if (runs && event.shiftKey && event.key === 'Enter') {
      takeChord(event)
      runScript()
    }
  }

  const keyHandlerRef = useRef(handleSheetKey)
  keyHandlerRef.current = handleSheetKey

  // The sheet section is rendered by DraggableSheet, so the chords bind to it
  // through the body it owns - keeping them out of every other open sheet.
  useEffect(() => {
    const section = (bodyRef.current as HTMLDivElement).closest(
      '[data-draggable-sheet]',
    ) as HTMLElement
    const onKeyDown = (event: Event) => keyHandlerRef.current(event as KeyboardEvent)
    // Capture: the editor's own keymap would otherwise act on the chord first.
    section.addEventListener('keydown', onKeyDown, true)
    return () => section.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Escape closes the help first: the sheet's own handler stands down on an
  // Escape that is already spoken for.
  useEffect(() => {
    if (!helpOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setHelpOpen(false)
      focusEditor()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [helpOpen, focusEditor])

  // Mirrors the element-config sheet's guard: a dismissal with a dirty draft
  // raises the Unsaved-changes confirm instead of silently dropping the draft.
  const requestClose = () => {
    if (showUnsavedDialog) {
      setShowUnsavedDialog(false)
      return
    }
    if (isDirty) {
      setShowUnsavedDialog(true)
    } else {
      onClose()
    }
  }

  const sheetSize = getValueEditorSheetSize(type, scriptMode, mapEntryOptions !== undefined)
  const levelOffset = cascadeOffset(level - 1)

  const listSlots: ListEditorSlots | undefined = listEditor && {
    expressionEditor: listEditor.expressionEditor,
    renderItemInput: listEditor.renderItemInput,
    positionLabel: listEditor.positionLabel,
    newItem: listEditor.newItem,
    expressionIndices: listExprIndices,
    onExpressionIndicesChange: setListExprIndices,
  }

  // A text entry opens its own string editor, a List or Map entry this sheet one level deeper; a host row input is its own editor.
  const renderItemTextEditor = (item: ItemTextEditorProps) => {
    if (item.type === 'string') {
      return (
        <ValueEditorSheet
          label={item.label}
          name=""
          type="string"
          value={item.value}
          isTemplate={false}
          allowTemplate={false}
          availableVariables={availableVariables}
          sheetId={ITEM_SHEET_ID}
          captureEsc={captureEsc}
          onSave={(text) => item.onSave(String(text))}
          onClose={item.onClose}
        />
      )
    }
    const nestedType = item.type
    const nested = nestedValueFromText(nestedType, item.value)
    return (
      <ValueEditorSheet
        label={item.label}
        name=""
        type={nestedType}
        value={nested.value}
        elementTypes={nested.types}
        isTemplate={false}
        allowTemplate={false}
        availableVariables={availableVariables}
        sheetId={`${NESTED_SHEET_ID}-${level + 1}`}
        level={level + 1}
        captureEsc={captureEsc}
        onSave={(next, _isTemplate, _exprKeys, types) => item.onSave(nestedValueText(nestedType, next, types))}
        onClose={item.onClose}
      />
    )
  }
  const textEditor =
    type !== 'table' && listEditor?.renderItemInput === undefined ? renderItemTextEditor : undefined

  const body = isComplex ? (
    <ComplexValueBody
      {...complex.bodyData}
      view={effectiveView}
      formatKey={formatKey}
      listEditor={listSlots}
      textEditor={textEditor}
      level={level}
    />
  ) : (
    <ScalarEditBody
      key={formatKey}
      value={draft}
      type="string"
      onChange={handleDraftChange}
      onValidChange={setBodyValid}
      format={bodyFormatOf(kind, scriptMode, resolvedFormat)}
      extraExtensions={pythonExtensions ?? sqlExtensions ?? openSearchExtensions ?? templateExtensions}
      ariaLabel={label}
    />
  )

  return (
    <>
    <DraggableSheet
      ref={ref}
      open
      onClose={requestClose}
      sheetId={sheetId ?? defaultSheetIdOf(scriptMode)}
      captureEsc={captureEsc}
      resizable
      ariaLabel="Edit value"
      data-testid="value-editor-sheet"
      initialOffset={{ x: levelOffset, y: levelOffset }}
      initialWidth={sheetSize.width}
      initialHeight={sheetSize.height}
      minWidth={sheetSize.minWidth}
      minHeight={sheetSize.minHeight}
      onMaximize={scriptMode === null ? undefined : focusEditor}
      className="max-w-[90vw] max-h-screen shadow-xl"
      headerClassName="py-2"
      header={
        <>
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-sm font-semibold truncate">Edit value</h2>
            <span
              data-testid="value-editor-type-badge"
              className={cn(
                'text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded',
                getTypeBadgeClass(type),
              )}
            >
              {type}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close value editor"
            onClick={requestClose}
            onPointerDown={(event) => event.stopPropagation()}
            className="h-7 w-7"
          >
            <X className="h-4 w-4" />
          </Button>
        </>
      }
    >
      <div className="flex flex-1 min-h-0 flex-col px-4 py-3">
        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto">
          {body}
        </div>
      </div>

      {isComplex && complex.stripMessage && (
        <ValidationStrip
          testId="value-editor-validation"
          message={complex.stripMessage}
          messages={complex.stripMessages}
        />
      )}

      {!isComplex && lockedLiteralError && (
        <ValidationStrip
          testId="value-editor-validation"
          message={lockedLiteralError}
          messages={null}
        />
      )}

      {scriptMode !== null && issueMessages.length > 0 && (
        <ValidationStrip
          testId="value-editor-validation"
          severity={hasSyntaxError ? 'error' : 'advisory'}
          message={issueMessages[0]}
          messages={issueMessages}
        />
      )}

      {advisoryMessages.length > 0 && (
        <ValidationStrip
          testId="value-editor-advisory"
          severity="advisory"
          message={advisoryMessages[0]}
          messages={advisoryMessages}
        />
      )}

      {/* One line at the 720 floor whatever the font: only the catalog chip gives way (OS-12). */}
      <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/30 rounded-b-lg shrink-0">
        {valueControls && templateAllowed && <KindDropdown value={kind} onValueChange={setKind} />}
        {valueControls && kind === 'literal' && lockedFormat !== 'plain' && (
          <FormatDropdown
            value={format}
            onValueChange={setFormat}
            detectedFormat={detectedFormat}
            allowedFormats={allowedFormats}
          />
        )}
        {scriptConfig && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              ref={setHelpAnchor}
              data-testid="value-editor-help-chip"
              onClick={() => setHelpOpen(true)}
              className="!h-7 shrink-0 gap-1 px-2 !text-xs"
            >
              <Kbd>F1</Kbd>
              Help
            </Button>
            <scriptConfig.Help
              open={helpOpen}
              onOpenChange={setHelpOpen}
              anchor={helpAnchor}
              onClosed={focusEditor}
            />
          </>
        )}
        {footerCatalog && (
          <CatalogChip
            state={footerCatalog.pull.state}
            count={footerCatalog.pull.count}
            items={footerCatalog.items}
            nouns={footerCatalog.nouns}
            error={footerCatalog.pull.error}
            blockedNote={footerCatalog.blockedNote}
            onStart={footerCatalog.pull.start}
            onStop={footerCatalog.pull.stop}
            onRefresh={footerCatalog.pull.refresh}
            onInsert={(name) => insertAtCursor(scriptViewRef.current, name)}
            onPopoverClosed={focusEditor}
          />
        )}
        {showStringFormatButton && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="value-editor-string-format-button"
            onClick={handleStringFormat}
            className={cn('!h-7 px-2 !text-xs')}
          >
            Format
          </Button>
        )}
        {isComplex && (listEditor === undefined || listEditor.codeView === true) && (
          <ViewDropdown
            value={view}
            onValueChange={(next) => {
              const nextView = next === 'code' ? 'code' : 'visual'
              if (nextView === 'visual' && type === 'table') complex.seedTableSchema()
              if (nextView === 'code') complex.syncCodeText()
              setView(nextView)
            }}
            options={VISUAL_CODE_VIEWS}
            disabledOptions={complex.visualLocked ? VISUAL_DISABLED : undefined}
            disabledOptionTooltip={complex.visualLockTooltip}
          />
        )}
        {inCode && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="value-editor-format-button"
            disabled={complex.formatBlocked}
            onClick={() => {
              setFormatKey((key) => key + 1)
              complex.markFormatted()
            }}
            className={cn('!h-7 px-2 !text-xs')}
          >
            Format
          </Button>
        )}
        {metric && (
          <span
            data-testid="value-editor-metric"
            className="text-xs text-muted-foreground tabular-nums"
          >
            {metric}
          </span>
        )}
        <span className="flex-1" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="value-editor-cancel-button"
          onClick={requestClose}
          className="shrink-0"
        >
          Close
        </Button>
        <Button
          type="button"
          variant={runs ? 'outline' : 'primary'}
          size="sm"
          data-testid="value-editor-save-button"
          disabled={saveDisabled}
          onClick={handleSave}
          className="shrink-0"
        >
          Save
        </Button>
        {runs && (
          <RunStopControl
            runBusy={runBusy}
            runDisabled={runDisabled}
            runBlockedNote={runBlockedNote}
            onRun={runScript}
            onStop={onStop}
          />
        )}
      </div>
    </DraggableSheet>

    <UnsavedChangesDialog
      open={showUnsavedDialog}
      onKeepEditing={() => setShowUnsavedDialog(false)}
      onClose={() => {
        setShowUnsavedDialog(false)
        onClose()
      }}
      onSave={() => {
        setShowUnsavedDialog(false)
        handleSave()
        onClose()
      }}
      saveDisabled={saveDisabled}
      testIds={VALUE_EDITOR_DIALOG_TEST_IDS}
    />
    </>
  )
}
