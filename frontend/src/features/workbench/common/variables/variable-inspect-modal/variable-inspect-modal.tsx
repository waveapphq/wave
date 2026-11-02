/**
 * VariableInspectModal - a draggable, read-only inspect sheet per watched variable.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.1.3.12: Auto-refresh watched variables on change
 * REQ-3.1.3.13: Computed variables with expressions and runtime evaluation
 * REQ-3.2.2.18: Live variable values display
 */

import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { GripVertical, X } from 'lucide-react'
import type { Extension } from '@codemirror/state'

import { Button } from '@/components/ui/button'
import { DraggableSheet } from '@/components/shared/draggable-sheet'
import { ScalarBody } from '@/components/shared/variable-bodies/scalar-body'
import { ArrayBody } from '@/components/shared/variable-bodies/array-body'
import { MapBody } from '@/components/shared/variable-bodies/map-body'
import { TableBody } from '@/components/shared/variable-bodies/table-body'
import { MismatchBody } from '@/components/shared/variable-bodies/mismatch-body'
import { BodyEmptyLine, NullText } from '@/components/shared/variable-bodies/body-parts'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'
import { cn } from '@/lib/utils'
import { MASK_PLACEHOLDER, holdsSecretValue } from '@/lib/secret-envelope'
import {
  formatCompareMetric,
  formatComplexMetric,
  formatScalarMetric,
  getTypeBadgeClass,
  isNullValue,
  isSummaryEnvelope,
  METRIC_TYPE_MISMATCH,
  valueMatchesType,
} from '@/lib/variable-format'
import { serializeComplexForCode, type ElementTypes } from '@/lib/variable-validation'
import type { Variable } from '@/features/workbench/common/variables/variable-manager-content/types'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'
import { CompareBody } from './compare-body'
import { ModeDropdown, type InspectMode } from './mode-dropdown'
import { ViewDropdown, type InspectView } from './view-dropdown'
import { FormatDropdown } from './format-dropdown'
import { SecretVisibilityNotice, type SecretSaveTarget } from './secret-visibility-notice'
import { scopedVariableKey } from '@/features/workbench/lib/variable-scope-key'
import {
  useFullVariableValue,
  type VariableValueRefreshFailure,
} from './use-full-variable-value'
import { cascadeOffset, getSheetSize, isCompactScalarWatcher, stringWatcherHeight } from './sheet-sizes'
import type { ResolvedFormat } from '@/lib/codemirror/format-editor'
import { useStringFormat } from './use-string-format'
import { ConditionalTooltip } from '@/components/ui/tooltip'

const EMPTY_AVAILABLE_VARIABLES: AvailableVariable[] = []

const CodeBody = lazy(() =>
  import('@/components/shared/variable-bodies/code-body').then((module) => ({
    default: module.CodeBody,
  })),
)

// The one body for a whole null, whatever the type (VMGR-93, VMGR-94); Initial dims it like any value.
const NULL_BODY = <BodyEmptyLine label="null" />
const NULL_BODY_INITIAL = <div className="h-full opacity-70">{NULL_BODY}</div>

function nullBody(variant: 'current' | 'initial'): ReactNode {
  return variant === 'initial' ? NULL_BODY_INITIAL : NULL_BODY
}

// Stacked Compare rows read as inline values, so a whole null sits where the value would.
const NULL_STACKED = (
  <div className="text-sm">
    <NullText />
  </div>
)
const NULL_STACKED_INITIAL = (
  <div className="text-sm opacity-70">
    <NullText />
  </div>
)

function stackedNode(node: ReactNode): ReactNode {
  if (node === NULL_BODY) return NULL_STACKED
  if (node === NULL_BODY_INITIAL) return NULL_STACKED_INITIAL
  return node
}

const COMPLEX_BODIES = {
  array: ArrayBody,
  map: MapBody,
  table: TableBody,
} as const

type ComplexType = keyof typeof COMPLEX_BODIES

function asComplexType(type: Variable['type']): ComplexType | null {
  return type === 'array' || type === 'map' || type === 'table' ? type : null
}

// A template scalar's views; Initial and Compare pin to the Template source.
const TEMPLATE_VIEWS: InspectView[] = ['rendered', 'template']
const TEMPLATE_SOURCE_VIEWS: InspectView[] = ['template']

// A template opens on Rendered; complex/expression/literal keep their own default.
function initialTemplateView(
  isTemplate: boolean,
  complexType: ComplexType | null,
): InspectView {
  if (isTemplate) return 'rendered'
  return complexType === null ? 'literal' : 'visual'
}

const SCALAR_EXPRESSION_VIEWS: InspectView[] = ['literal', 'expression']
// Compare on an expression shows Initial source vs Current source (comparing a
// formula to an evaluated value is meaningless), so it pins to the source view.
const SCALAR_COMPARE_VIEWS: InspectView[] = ['expression']
const COMPLEX_LITERAL_VIEWS: InspectView[] = ['visual', 'code']
const COMPLEX_EXPRESSION_VIEWS: InspectView[] = ['visual', 'code', 'expression']
const NO_VIEWS: InspectView[] = []

function getViewOptions(isComplex: boolean, isExpression: boolean): InspectView[] {
  if (isComplex) {
    return isExpression ? COMPLEX_EXPRESSION_VIEWS : COMPLEX_LITERAL_VIEWS
  }
  return isExpression ? SCALAR_EXPRESSION_VIEWS : NO_VIEWS
}

// Compare drives both panes from one View, so the Expression item drops out
// (the left pane is always the source): expression complex keeps Visual/Code,
// an expression scalar is left with a single disabled Literal.
function getCompareViewOptions(
  isComplex: boolean,
  isExpression: boolean,
): InspectView[] {
  if (isComplex) return COMPLEX_LITERAL_VIEWS
  return isExpression ? SCALAR_COMPARE_VIEWS : NO_VIEWS
}

function InspectBodySkeleton() {
  return (
    <div
      data-testid="inspect-body-skeleton"
      aria-busy="true"
      className="space-y-2.5 py-1"
    >
      <div className="h-4 w-4/5 rounded bg-muted motion-safe:animate-pulse" />
      <div className="h-4 w-3/5 rounded bg-muted motion-safe:animate-pulse" />
      <div className="h-4 w-2/3 rounded bg-muted motion-safe:animate-pulse" />
    </div>
  )
}

interface InspectResolution {
  variable: Variable
  complexType: ComplexType | null
  displayedView: InspectView
  bodyVariant: 'current' | 'initial'
  showingSource: boolean
  showEmptyState: boolean
  /** The displayed value (or source) is a whole null. */
  wholeNull: boolean
  mismatch: boolean
  scalarDisplayedValue: unknown
  complexDisplayedValue: unknown
  /** The displayed array / map value's element types (REQ-3.1.3.19). */
  complexElementTypes: ElementTypes | undefined
  complexFetchPending: boolean
  runtimeValue: unknown
  /** The expression source to render: the active Current override in Current
   *  mode, else the definition source. */
  sourceValue: unknown
  /** Literal string body only: format highlighting + host-injected extensions. */
  stringFormat: ResolvedFormat | undefined
  stringExtraExtensions: Extension[] | undefined
}

function resolveMetric(r: InspectResolution): string | null {
  // A source (expression / template) and an empty state carry no metric - only a
  // real displayed value gets one ("N chars" for strings).
  if (r.showingSource || r.showEmptyState || r.wholeNull) return null
  if (r.mismatch) return METRIC_TYPE_MISMATCH
  if (r.complexType === null) {
    return formatScalarMetric(r.scalarDisplayedValue, r.variable.type)
  }
  // Undefined only while the first fetch is pending - the envelope's counts
  // are known before the full value lands.
  const metricValue =
    r.complexDisplayedValue === undefined ? r.runtimeValue : r.complexDisplayedValue
  return formatComplexMetric(metricValue, r.variable.type)
}

// A complex value's skeleton while its first fetch is pending, or its Code view;
// null when the value is read another way.
function complexFetchOrCodeBody(
  r: InspectResolution,
): { node: ReactNode; tableGrid: boolean } | null {
  if (r.complexType === null || r.showingSource) return null
  if (r.complexFetchPending) {
    return { node: <InspectBodySkeleton />, tableGrid: false }
  }
  if (r.displayedView !== 'code') return null
  // Code view never lies and never caps: raw payload even on mismatch.
  return {
    node: (
      <Suspense fallback={<InspectBodySkeleton />}>
        <CodeBody
          value={r.wholeNull ? null : r.complexDisplayedValue}
          variant={r.bodyVariant}
          serialize={(v) => serializeComplexForCode(r.variable.type, v, r.complexElementTypes)}
        />
      </Suspense>
    ),
    tableGrid: false,
  }
}

// The table mini-grid is full-bleed (its sticky header band spans the sheet)
// and scrolls inside its own wrapper; other bodies use the padded host scroller.
function resolveBody(r: InspectResolution): { node: ReactNode; tableGrid: boolean } {
  if (r.showEmptyState) {
    return { node: <BodyEmptyLine label="Not evaluated yet." />, tableGrid: false }
  }
  const complexEarlyBody = complexFetchOrCodeBody(r)
  if (complexEarlyBody) return complexEarlyBody
  if (r.wholeNull) {
    return { node: nullBody(r.bodyVariant), tableGrid: false }
  }
  if (r.showingSource) {
    return {
      node: (
        <ScalarBody
          value={r.sourceValue}
          type={r.variable.type}
          isExpression
          variant={r.bodyVariant}
        />
      ),
      tableGrid: false,
    }
  }
  if (r.complexType === null) {
    if (r.mismatch) {
      return {
        node: <MismatchBody value={r.scalarDisplayedValue} declaredType={r.variable.type} />,
        tableGrid: false,
      }
    }
    return {
      node: (
        <ScalarBody
          value={r.scalarDisplayedValue}
          type={r.variable.type}
          isExpression={false}
          variant={r.bodyVariant}
          format={r.stringFormat}
          extraExtensions={r.stringExtraExtensions}
        />
      ),
      tableGrid: false,
    }
  }
  if (r.mismatch) {
    return {
      node: <MismatchBody value={r.complexDisplayedValue} declaredType={r.variable.type} />,
      tableGrid: false,
    }
  }
  const TypedBody = COMPLEX_BODIES[r.complexType]
  return {
    node: (
      <TypedBody
        value={r.complexDisplayedValue}
        variant={r.bodyVariant}
        elementTypes={r.complexElementTypes}
      />
    ),
    tableGrid: r.complexType === 'table',
  }
}

interface TemplateRender {
  viewOptions: InspectView[]
  displayedView: InspectView
  viewDisabled: boolean
  metric: string | null
  bodyNode: ReactNode
}

// A template's source or rendered text; a whole null takes the one null body.
function templateBody(
  value: unknown,
  type: Variable['type'],
  variant: 'current' | 'initial',
  templateExtensions: Extension[] | undefined,
): ReactNode {
  if (isNullValue(value)) return nullBody(variant)
  return (
    <ScalarBody
      value={value}
      type={type}
      isExpression={false}
      variant={variant}
      extraExtensions={templateExtensions}
    />
  )
}

// Template read resolution. Current shows Rendered (the realized string) or
// Template (the {{ }} source); Initial pins to the source; Compare shows the two
// sources side-by-side (source-vs-source, like a scalar expression). The source
// body carries the {{ }} highlight stack; the rendered body is a plain string.
// A source / empty state carries no metric - only a realized value gets "N chars".
function resolveTemplateRead(
  mode: InspectMode,
  view: InspectView,
  variable: Variable,
  hasRuntimeValue: boolean,
  runtimeValue: unknown,
  templateExtensions: Extension[] | undefined,
): TemplateRender {
  if (mode === 'compare') {
    return {
      viewOptions: TEMPLATE_SOURCE_VIEWS,
      displayedView: 'template',
      viewDisabled: true,
      metric: null,
      bodyNode: (
        <CompareBody
          initialNode={templateBody(variable.value, variable.type, 'initial', templateExtensions)}
          currentNode={templateBody(variable.value, variable.type, 'current', templateExtensions)}
          initialLabel="Initial - source"
          currentLabel="Current - source"
          tableGrid={false}
          stacked={false}
          fill
        />
      ),
    }
  }
  const isCurrent = mode === 'current'
  const safeView: InspectView = view === 'template' ? 'template' : 'rendered'
  const displayedView = isCurrent ? safeView : 'template'
  const viewOptions = TEMPLATE_VIEWS
  const viewDisabled = !isCurrent
  if (displayedView === 'template') {
    return {
      viewOptions,
      displayedView,
      viewDisabled,
      metric: null,
      bodyNode: templateBody(
        variable.value,
        variable.type,
        mode === 'initial' ? 'initial' : 'current',
        templateExtensions,
      ),
    }
  }
  if (!hasRuntimeValue) {
    return {
      viewOptions,
      displayedView,
      viewDisabled,
      metric: null,
      bodyNode: <BodyEmptyLine label="Not rendered yet." />,
    }
  }
  return {
    viewOptions,
    displayedView,
    viewDisabled,
    metric: formatScalarMetric(runtimeValue, variable.type),
    bodyNode: templateBody(runtimeValue, variable.type, 'current', undefined),
  }
}

interface ResolutionBase {
  variable: Variable
  isExpression: boolean
  complexType: ComplexType | null
  hasRuntimeValue: boolean
  runtimeValue: unknown
  /** Element types of a runtime value that is not a summary (an override / baseline). */
  runtimeElementTypes: ElementTypes | undefined
  fullValue: unknown
  fullElementTypes: ElementTypes | undefined
  isFirstFetchPending: boolean
  /** Active Current-mode override source (else undefined) for the source view. */
  currentSource: string | undefined
  /** Literal string body only: format highlighting + host-injected extensions. */
  stringFormat: ResolvedFormat | undefined
  stringExtraExtensions: Extension[] | undefined
}

interface PaneValues {
  complexDisplayedValue: unknown
  complexElementTypes: ElementTypes | undefined
  complexFetchPending: boolean
  scalarDisplayedValue: unknown
  /** A summary whose full value has not landed is unread, not null. */
  fullValueUnread: boolean
}

// The value a pane shows: the run's value (a summary's full value once fetched)
// when it shows the run, else the definition's.
function paneValues(base: ResolutionBase, showRuntime: boolean): PaneValues {
  const { variable } = base
  if (!showRuntime) {
    return {
      complexDisplayedValue: variable.value,
      complexElementTypes: variable.elementTypes,
      complexFetchPending: false,
      scalarDisplayedValue: variable.value,
      fullValueUnread: false,
    }
  }
  const runtimeIsSummary = isSummaryEnvelope(base.runtimeValue)
  return {
    complexDisplayedValue: runtimeIsSummary ? base.fullValue : base.runtimeValue,
    complexElementTypes: runtimeIsSummary ? base.fullElementTypes : base.runtimeElementTypes,
    complexFetchPending: runtimeIsSummary && base.isFirstFetchPending,
    scalarDisplayedValue: base.runtimeValue,
    fullValueUnread: runtimeIsSummary && base.fullValue === undefined,
  }
}

// One pane's full resolution under a given mode. Compare builds two (an
// Initial-side and a Current-side); single mode builds one.
function computeResolution(
  base: ResolutionBase,
  effectiveMode: 'initial' | 'current',
  displayedView: InspectView,
): InspectResolution {
  const {
    variable,
    isExpression,
    complexType,
    hasRuntimeValue,
    runtimeValue,
    currentSource,
    stringFormat,
    stringExtraExtensions,
  } = base
  const inInitial = effectiveMode === 'initial'
  // Initial renders the definition source; Current renders the active override
  // source (re-armed expression) when present, else the definition.
  const sourceValue = inInitial ? variable.value : (currentSource ?? variable.value)
  const showRuntime = effectiveMode === 'current' && hasRuntimeValue
  const bodyVariant: 'current' | 'initial' = inInitial ? 'initial' : 'current'

  const {
    complexDisplayedValue,
    complexElementTypes,
    complexFetchPending,
    scalarDisplayedValue,
    fullValueUnread,
  } = paneValues(base, showRuntime)
  const showingSource = isExpression && (inInitial || displayedView === 'expression')
  const showEmptyState =
    isExpression && !showingSource && !inInitial && !hasRuntimeValue
  const guardedValue =
    complexType === null ? scalarDisplayedValue : complexDisplayedValue
  const mismatch =
    showRuntime && !showingSource && !valueMatchesType(guardedValue, variable.type)
  const wholeNull = showingSource
    ? isNullValue(sourceValue)
    : !fullValueUnread && isNullValue(guardedValue)

  return {
    variable,
    complexType,
    displayedView,
    bodyVariant,
    showingSource,
    showEmptyState,
    wholeNull,
    mismatch,
    scalarDisplayedValue,
    complexDisplayedValue,
    complexElementTypes,
    complexFetchPending,
    runtimeValue,
    sourceValue,
    stringFormat,
    stringExtraExtensions,
  }
}

// The Current-pane value the Compare delta metric describes: the empty state
// reads as "no value yet", a pending first fetch falls back to the envelope.
function compareCurrentMetricValue(
  currentRes: InspectResolution,
  complexType: ComplexType | null,
): unknown {
  if (currentRes.showEmptyState) return undefined
  if (complexType === null) return currentRes.scalarDisplayedValue
  return currentRes.complexDisplayedValue === undefined
    ? currentRes.runtimeValue
    : currentRes.complexDisplayedValue
}

interface ViewState {
  viewOptions: InspectView[]
  displayedView: InspectView
  viewDisabled: boolean
  effectiveMode: 'initial' | 'current'
}

// Compare drives both panes from one View: an expression scalar coerces to the
// literal display; expression complex swaps a carried-in Expression for Visual.
function resolveCompareView(
  complexType: ComplexType | null,
  isExpression: boolean,
  view: InspectView,
): InspectView {
  // An expression scalar compares its two sources, so it stays in the source view.
  if (complexType === null) return isExpression ? 'expression' : view
  return view === 'expression' ? 'visual' : view
}

// View-dropdown state per mode: Compare collapses an expression scalar to a
// disabled Literal; single Initial locks an expression watcher to its source.
function resolveViewState(
  mode: InspectMode,
  complexType: ComplexType | null,
  isExpression: boolean,
  view: InspectView,
): ViewState {
  const isComplex = complexType !== null
  if (mode === 'compare') {
    return {
      viewOptions: getCompareViewOptions(isComplex, isExpression),
      displayedView: resolveCompareView(complexType, isExpression, view),
      viewDisabled: complexType === null && isExpression,
      effectiveMode: 'current',
    }
  }
  const viewLocked = mode === 'initial' && isExpression
  return {
    viewOptions: getViewOptions(isComplex, isExpression),
    displayedView: viewLocked ? 'expression' : view,
    viewDisabled: viewLocked,
    effectiveMode: mode === 'initial' ? 'initial' : 'current',
  }
}

interface InspectRender {
  metric: string | null
  mismatch: boolean
  bodyNode: ReactNode
  bodyTableGrid: boolean
}

// Compare builds an Initial-side + Current-side body into CompareBody; single
// mode resolves one body. Both share the per-pane resolution helpers.
function resolveInspectRender(
  base: ResolutionBase,
  mode: InspectMode,
  displayedView: InspectView,
  effectiveMode: 'initial' | 'current',
): InspectRender {
  const { variable, complexType, isExpression } = base
  if (mode === 'compare') {
    const initialRes = computeResolution(base, 'initial', displayedView)
    const currentRes = computeResolution(base, 'current', displayedView)
    const initialBody = resolveBody(initialRes)
    const currentBody = resolveBody(currentRes)
    const tableGrid = initialBody.tableGrid || currentBody.tableGrid
    // A SCALAR expression compares the two SOURCES (Initial vs the active Current
    // override) - a formula has no char metric; a complex expression keeps
    // source-vs-evaluated, and a literal compares Initial vs Current value.
    const scalarExpression = isExpression && complexType === null
    const stacked = isCompactScalarWatcher(variable.type, isExpression)
    const metric = scalarExpression
      ? null
      : formatCompareMetric(
          variable.value,
          compareCurrentMetricValue(currentRes, complexType),
          variable.type,
          isExpression,
        )
    return {
      metric,
      mismatch: currentRes.mismatch,
      bodyTableGrid: tableGrid,
      bodyNode: (
        <CompareBody
          initialNode={stacked ? stackedNode(initialBody.node) : initialBody.node}
          currentNode={stacked ? stackedNode(currentBody.node) : currentBody.node}
          initialLabel={isExpression ? 'Initial - source' : 'Initial'}
          currentLabel={compareCurrentLabel(isExpression, scalarExpression)}
          tableGrid={tableGrid}
          stacked={stacked}
          // Panes fill when their body is a CodeMirror editor (a string, or any
          // type in the Code view) so it scales with the watcher; Visual complex
          // bodies stay content-height (they scroll via the body scroller).
          fill={(!isExpression && variable.type === 'string') || displayedView === 'code'}
        />
      ),
    }
  }
  const resolution = computeResolution(base, effectiveMode, displayedView)
  const body = resolveBody(resolution)
  return {
    metric: resolveMetric(resolution),
    mismatch: resolution.mismatch,
    bodyNode: body.node,
    bodyTableGrid: body.tableGrid,
  }
}

interface InspectFooterMetricProps {
  metric: string | null
  mismatch: boolean
}

// Footer center zone: the type-aware metric, else an empty flex spacer.
// (Validation errors live in the dedicated strip above the footer.)
function InspectFooterMetric({ metric, mismatch }: Readonly<InspectFooterMetricProps>) {
  if (metric === null) {
    return <span className="flex-1" />
  }
  return (
    <span
      data-testid="inspect-metric"
      className={cn(
        'flex-1 text-center font-mono text-xs truncate',
        mismatch ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
      )}
    >
      {metric}
    </span>
  )
}

// A locked secret's read view is the bare placeholder - no keys, no shape, no
// counts - and never feeds the masked-read string into the typed bodies.
function SecretMaskedBody({ holdsValue }: Readonly<{ holdsValue: boolean }>) {
  return (
    <div
      data-testid="inspect-secret-masked"
      className="font-mono text-sm text-muted-foreground select-text"
    >
      {holdsValue ? MASK_PLACEHOLDER : ''}
    </div>
  )
}

// A refresh tick that failed is reported beside the value it could not refresh,
// so a dropped tick never passes for fresh data.
function RefreshFailureNotice({
  failure,
}: Readonly<{ failure: VariableValueRefreshFailure }>) {
  return (
    <output
      data-testid="inspect-refresh-failure"
      aria-live="polite"
      className="block select-text cursor-text border-t border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300"
    >
      {failure.hasLastValue
        ? 'Could not refresh the value (showing the last one received).'
        : 'Could not read the value.'}{' '}
      <span className="font-mono">{failure.reason}</span>
    </output>
  )
}

// A literal string watcher opens auto-fit to its content (the editor fills +
// scrolls); other types - including templates, whose default Rendered view is
// usually empty/short, not the {{ }} source - use the configured compact size.
function resolveStringOpenHeight(
  variable: Variable,
  isExpression: boolean,
  width: number,
  isCompare: boolean,
  minHeight: number,
): number | undefined {
  if (isExpression || !!variable.isTemplate || variable.type !== 'string') return undefined
  // Never open below the resize floor: a 1-line string fits in fewer px than
  // minHeight, which would otherwise open the watcher below its own minimum.
  return Math.max(stringWatcherHeight([String(variable.value)], width, isCompare), minHeight)
}

export interface VariableInspectModalProps {
  variable: Variable
  /** A secret whose value is still unsaved: its value stays visible with an amber notice. */
  secretUnlocked?: boolean
  /** The saved Test does not hold this secret's value yet (new, or a changed value): the amber notice shows. */
  secretChanged?: boolean
  /** What saving seals this secret: the Test, or the Function a library View shows. */
  secretSaveTarget?: SecretSaveTarget
  runtimeValue: unknown
  hasRuntimeValue: boolean
  /** Element types of a non-summary runtime value (an override or run-start baseline). */
  runtimeElementTypes?: ElementTypes
  /** Carried for the state-table contract; idle and live Current render the
   *  same way because hasRuntimeValue is false while idle. */
  runtimeAvailable: boolean
  cascadeIndex: number
  /** Live workbench session id; absent in history workbench and while idle. */
  sessionId?: string | null
  /** Node ids of the Function instance the watched variable lives in; absent or empty at the Test root. */
  functionPath?: string[]
  onClose: () => void
  /** Template highlight source for a template watcher. */
  availableVariables?: AvailableVariable[]
  /** The definition is read-only (history canvas, a read-only scope). */
  readOnly?: boolean
  /** The active Current-mode expression source (override or run-start baseline). */
  currentSource?: string
}

/** Compare's Current pane label: an expression compares source (scalar) or its
 *  evaluated body (complex); a literal is just "Current". */
function compareCurrentLabel(isExpression: boolean, scalarExpression: boolean): string {
  if (isExpression) return scalarExpression ? 'Current - source' : 'Current - evaluated'
  return 'Current'
}

interface InspectModalHeaderProps {
  variable: Variable
  isExpression: boolean
  isTemplate: boolean
  onClose: () => void
}

// Sheet header: drag grip + the name and the expression / template / type badges with the close button.
function InspectModalHeader({
  variable,
  isExpression,
  isTemplate,
  onClose,
}: Readonly<InspectModalHeaderProps>) {
  return (
    <>
      <div className="flex flex-1 items-center gap-2 min-w-0">
        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <ConditionalTooltip content={variable.name} wide>
          <h2
            data-testid="inspect-variable-name"
            className="font-mono text-sm font-semibold truncate max-w-[35rem]"
          >
            {variable.name}
          </h2>
        </ConditionalTooltip>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isExpression && (
          <span
            data-testid="inspect-expr-badge"
            className="text-[10px] font-medium text-cyan-400 bg-cyan-500/20 px-1.5 py-0.5 rounded"
          >
            {'{x}'}
          </span>
        )}
        {isTemplate && (
          <span
            data-testid="inspect-template-badge"
            className="text-[10px] font-medium text-cyan-400 bg-cyan-500/20 px-1.5 py-0.5 rounded"
          >
            {'{{ }}'}
          </span>
        )}
        <span
          data-testid="inspect-type-badge"
          className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${getTypeBadgeClass(variable.type)}`}
        >
          {variable.type}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Close inspector for ${variable.name}`}
          onClick={onClose}
          onPointerDown={(event) => event.stopPropagation()}
          className="h-7 w-7"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </>
  )
}

interface InspectModalFooterProps {
  mode: InspectMode
  onModeChange: (mode: InspectMode) => void
  stringFmt: ReturnType<typeof useStringFormat>
  viewOptions: InspectView[]
  displayedView: InspectView
  viewDisabled: boolean
  onViewChange: (view: InspectView) => void
  metric: string | null
  mismatch: boolean
}

// Footer toolbar: the Mode pill, the view controls and the metric (VMGR-18).
function InspectModalFooter({
  mode,
  onModeChange,
  stringFmt,
  viewOptions,
  displayedView,
  viewDisabled,
  onViewChange,
  metric,
  mismatch,
}: Readonly<InspectModalFooterProps>) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-t bg-muted/30 rounded-b-lg shrink-0">
      <ModeDropdown value={mode} onValueChange={onModeChange} />
      {stringFmt.showFormatControl && (
        <FormatDropdown
          value={stringFmt.format}
          onValueChange={stringFmt.onFormatChange}
          detectedFormat={stringFmt.detectedFormat}
        />
      )}
      {viewOptions.length > 0 && (
        <ViewDropdown
          value={displayedView}
          onValueChange={onViewChange}
          options={viewOptions}
          disabled={viewDisabled}
        />
      )}
      <InspectFooterMetric metric={metric} mismatch={mismatch} />
    </div>
  )
}

interface ModalRenderArgs {
  isTemplate: boolean
  variable: Variable
  secretUnlocked: boolean
  isExpression: boolean
  complexType: ComplexType | null
  view: InspectView
  stringFmt: ReturnType<typeof useStringFormat>
  base: ResolutionBase
  mode: InspectMode
  hasRuntimeValue: boolean
  runtimeValue: unknown
  revealInspection: boolean
}

interface ModalRender {
  viewOptions: InspectView[]
  displayedView: InspectView
  viewDisabled: boolean
  metric: string | null
  mismatch: boolean
  bodyNode: ReactNode
  bodyTableGrid: boolean
}

// Full opacity: a locked secret's read view bypasses the typed render
// machinery entirely (the masked read is a placeholder STRING; the complex
// bodies would crash on it or render it as rows). A null secret hides nothing.
function maskedSecretRender(value: unknown): ModalRender {
  return {
    viewOptions: NO_VIEWS,
    displayedView: 'literal',
    viewDisabled: false,
    metric: null,
    mismatch: false,
    bodyNode: isNullValue(value) ? NULL_BODY : <SecretMaskedBody holdsValue={holdsSecretValue(value)} />,
    bodyTableGrid: false,
  }
}

// Resolve the view controls, metric, and body: a locked secret's masked read, a template read, or a plain read.
function resolveModalRender(args: Readonly<ModalRenderArgs>): ModalRender {
  const {
    isTemplate,
    variable,
    secretUnlocked,
    isExpression,
    complexType,
    view,
    stringFmt,
    base,
    mode,
    hasRuntimeValue,
    runtimeValue,
    revealInspection,
  } = args
  // A saved secret masks unless the system test-variables reveal is on, in which case its runtime value shows.
  if (variable.isSecret && !secretUnlocked && !revealInspection) {
    return maskedSecretRender(hasRuntimeValue ? runtimeValue : variable.value)
  }
  if (isTemplate) {
    const tr = resolveTemplateRead(
      mode,
      view,
      variable,
      hasRuntimeValue,
      runtimeValue,
      stringFmt.stringExtraExtensions,
    )
    return {
      viewOptions: tr.viewOptions,
      displayedView: tr.displayedView,
      viewDisabled: tr.viewDisabled,
      metric: tr.metric,
      mismatch: false,
      bodyNode: tr.bodyNode,
      bodyTableGrid: false,
    }
  }
  const viewState = resolveViewState(mode, complexType, isExpression, view)
  const render = resolveInspectRender(base, mode, viewState.displayedView, viewState.effectiveMode)
  return {
    viewOptions: viewState.viewOptions,
    displayedView: viewState.displayedView,
    viewDisabled: viewState.viewDisabled,
    metric: render.metric,
    mismatch: render.mismatch,
    bodyNode: render.bodyNode,
    bodyTableGrid: render.bodyTableGrid,
  }
}

export function VariableInspectModal({
  variable,
  secretUnlocked = false,
  secretChanged = false,
  secretSaveTarget = 'test',
  runtimeValue,
  hasRuntimeValue,
  runtimeElementTypes,
  cascadeIndex,
  sessionId,
  functionPath,
  onClose,
  availableVariables = EMPTY_AVAILABLE_VARIABLES,
  currentSource,
}: Readonly<VariableInspectModalProps>) {
  const [mode, setMode] = useState<InspectMode>('current')
  // System test-variables reveal: a saved secret's watcher shows its value.
  const revealInspection = useMaskingSettingsStore((s) => s.testVariables)
  const isExpression = !!variable.isExpression
  const isTemplate = !!variable.isTemplate
  const complexType = asComplexType(variable.type)
  // View resets to the evaluated view on every open - never persisted. A template
  // opens on its Rendered (realized) view.
  const [view, setView] = useState<InspectView>(
    initialTemplateView(isTemplate, complexType),
  )

  // A Function's list, map or table is read from that Function's scope (REQ-3.2.2.18).
  const { fullValue, fullElementTypes, isFirstFetchPending, refreshFailure } = useFullVariableValue({
    sessionId,
    variableName: variable.name,
    runtimeValue,
    hasRuntimeValue,
    isComplex: complexType !== null,
    functionPath,
  })

  // String Format view (literal string watchers only) and the template highlight stack.
  const stringFmt = useStringFormat({
    variable,
    isExpression,
    isComplex: complexType !== null,
    isTemplate,
    mode,
    hasRuntimeValue,
    runtimeValue,
    availableVariables,
  })

  // Close only on the transition into locked, so a locked secret opened empty stays open (VMGR-11).
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const prevUnlockedRef = useRef(secretUnlocked)
  useEffect(() => {
    const becameLocked = variable.isSecret && prevUnlockedRef.current && !secretUnlocked
    prevUnlockedRef.current = secretUnlocked
    if (becameLocked) closeRef.current()
  }, [variable.isSecret, secretUnlocked])

  const base: ResolutionBase = {
    variable,
    isExpression,
    complexType,
    hasRuntimeValue,
    runtimeValue,
    runtimeElementTypes,
    fullValue,
    fullElementTypes,
    isFirstFetchPending,
    currentSource,
    stringFormat: stringFmt.stringFormat,
    stringExtraExtensions: stringFmt.stringExtraExtensions,
  }

  const {
    viewOptions,
    displayedView,
    viewDisabled,
    metric,
    mismatch,
    bodyNode,
    bodyTableGrid,
  } = resolveModalRender({
    isTemplate,
    variable,
    secretUnlocked,
    isExpression,
    complexType,
    view,
    stringFmt,
    base,
    mode,
    hasRuntimeValue,
    runtimeValue,
    revealInspection,
  })

  const isCompare = mode === 'compare'

  // Only a secret the saved Test does not hold yet re-masks on save; an untouched saved null secret does not.
  const showSecretNotice = !!variable.isSecret && secretChanged

  // The failed refresh belongs beside the value it refreshes: it is shown only
  // where that value is what the body is displaying.
  const shownRefreshFailure = mode === 'initial' ? null : refreshFailure

  // Notices add to the sheet height so they never squeeze the body.
  const noticeStripRef = useRef<HTMLDivElement>(null)
  const [noticeStripHeight, setNoticeStripHeight] = useState(0)
  useLayoutEffect(() => {
    const el = noticeStripRef.current
    if (!el) {
      setNoticeStripHeight(0)
      return
    }
    const measure = () => setNoticeStripHeight(el.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [showSecretNotice, shownRefreshFailure])

  const offset = cascadeOffset(cascadeIndex)
  const size = getSheetSize(variable.type, isExpression, mode)
  // A string watcher OPENS auto-fit to its content and stays resizable; the body fills the watcher and scrolls past it.
  const stringOpenHeight = resolveStringOpenHeight(
    variable,
    isExpression,
    size.width,
    isCompare,
    size.minHeight,
  )

  return (
    <DraggableSheet
      open
      onClose={onClose}
      sheetId={`var-inspect-${scopedVariableKey(variable.name, functionPath)}`}
      persistGeometry
      responsiveSize
      resizable
      ariaLabel={`Inspect variable ${variable.name}`}
      data-testid={`variable-inspect-modal-${variable.id}`}
      initialOffset={{ x: offset, y: offset }}
      initialWidth={size.width}
      initialHeight={stringOpenHeight ?? size.height}
      extraHeight={noticeStripHeight}
      minWidth={size.minWidth}
      minHeight={size.minHeight}
      className="max-w-[90vw] max-h-screen shadow-xl"
      headerClassName="py-0"
      header={
        <InspectModalHeader
          variable={variable}
          isExpression={isExpression}
          isTemplate={isTemplate}
          onClose={onClose}
        />
      }
    >
      {/* Inner scroll wrapper - keeps scrollbar left of resize handle. Compare
          pads per pane, so the wrapper only keeps the scrollbar gutter. */}
      <div
        className={cn(
          'overflow-y-auto overflow-x-hidden overscroll-contain flex-1 min-h-0 min-w-0',
          isCompare ? 'mr-2' : !bodyTableGrid && 'px-4 py-3 mr-2',
        )}
      >
        {bodyNode}
      </div>
      {(shownRefreshFailure || showSecretNotice) && (
        <div ref={noticeStripRef} className="shrink-0">
          {shownRefreshFailure && <RefreshFailureNotice failure={shownRefreshFailure} />}
          {showSecretNotice && <SecretVisibilityNotice saveTarget={secretSaveTarget} />}
        </div>
      )}
      <InspectModalFooter
        mode={mode}
        onModeChange={setMode}
        stringFmt={stringFmt}
        viewOptions={viewOptions}
        displayedView={displayedView}
        viewDisabled={viewDisabled}
        onViewChange={setView}
        metric={metric}
        mismatch={mismatch}
      />
    </DraggableSheet>
  )
}
