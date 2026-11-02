/**
 * Inline Variable Row
 *
 * Per-variable row in the redesigned Variable Manager panel. Two-line grid:
 * line 1 holds the variable name (left) and the four-icon action cluster
 * (right) - eye, expand, edit, delete in that order. Line 2 holds the
 * type-colored value text (left) and the flag + type badges (right), with
 * the type badge always rightmost.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.2.2.18: Live variable values display
 */

import { useEffect, useRef } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import {
  EyeIcon,
  EyeOffIcon,
  PencilIcon,
  TrashIcon,
} from '@/components/ui/icon'
import { Search } from 'lucide-react'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { NullText } from '@/components/shared/variable-bodies/body-parts'
import { hidesSecretValue } from '@/lib/secret-envelope'
import { cn } from '@/lib/utils'
import {
  ROLE_BADGE_CLASS,
  TYPE_PILL_CLASS,
  formatValue,
  getTypeBadgeClass,
  getValueColorClass,
  isNullValue,
  valueToText,
} from '@/lib/variable-format'
import type { Variable } from './types'
import { INLINE_VARIABLE_ROW_HEIGHT, MAX_VALUE_LENGTH } from './types'

// Fixed height so the virtualized slot pitch and the plain list lay rows out identically.
const ROW_STYLE: CSSProperties = { height: INLINE_VARIABLE_ROW_HEIGHT }

// ===========================================================================
// Types
// ===========================================================================

export interface InlineVariableRowProps {
  variable: Variable
  runtimeValue: unknown
  hasRuntimeValue: boolean
  viewMode: 'runtime' | 'definition'
  onToggleViewMode: () => void
  /** The run is actively running: the pencil and the row delete lock (VMGR-107). */
  isExpressionExecutionLocked: boolean
  readOnly: boolean
  /** A read-only row whose Current value can still be set keeps its pencil (REQ-3.1.2.10). */
  currentOnly?: boolean
  /**
   * True when the panel has runtime data to show (executing, holding stale
   * values from a prior run, or in readOnly snapshot mode). Idle mode
   * (`false`) disables the eye toggle since both views would render the
   * same definition. Defaults to `true` so the row component stays usable
   * in isolation without the parent threading a flag through.
   */
  runtimeAvailable?: boolean
  isOutputBound?: boolean
  isWorkflowReferenced?: boolean
  isExpressionReferenced?: boolean
  recentlyChanged?: boolean
  /** True while the session is mirrored live: a recentlyChanged row gets a
   *  temporary violet bar + pulse (the watcher/inspect bar stays otherwise). */
  isMirroring?: boolean
  /**
   * Function-scope row classification. When set to 'input' the row carries
   * an IN badge; when 'output' it carries the existing OUT badge with the
   * "Declared output parameter" tooltip. Defaults to undefined for normal
   * (test-local) variables.
   */
  kind?: 'input' | 'output' | 'local'
  /** A secret whose value is still unsaved (new / edited): expand is enabled and
   *  the value is inspectable until the test is saved. */
  secretUnlocked?: boolean
  /** System test-variables reveal is on: the value column shows the plaintext
   *  runtime value instead of the mask. */
  revealSecret?: boolean
  /** System test-variables reveal is on: a saved secret becomes inspectable
   *  (expand enabled) so its watcher can show the revealed value. */
  revealInspection?: boolean
  /** True while this row's inspect modal is open (renders the indigo indicator). */
  isInspected?: boolean
  onExpand?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onKeyDown?: (e: ReactKeyboardEvent) => void
}

// ===========================================================================
// Display helpers
// ===========================================================================

const NOT_EVALUATED_PLACEHOLDER = '<not evaluated yet>'

// The IN / OUT badges keep the row's compact shape; their colors are the window's (ROLE_BADGE_CLASS).
const ROW_BADGE_SHAPE_CLASS = 'text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0'

/** What the value column shows: a whole null (one null look) or the formatted text. */
type RowValue = { isNull: true } | { isNull: false; text: string }

const NULL_ROW_VALUE: RowValue = { isNull: true }

function shownValue(value: unknown, format: (value: unknown) => string): RowValue {
  return isNullValue(value) ? NULL_ROW_VALUE : { isNull: false, text: format(value) }
}

function getExpressionRowValue(
  variable: Variable,
  runtimeValue: unknown,
  hasRuntimeValue: boolean,
  viewMode: 'runtime' | 'definition',
  runtimeAvailable: boolean,
): RowValue {
  if (viewMode === 'definition') return shownValue(variable.value, valueToText)
  if (hasRuntimeValue) {
    return shownValue(runtimeValue, (value) => formatValue(value, variable.type, false))
  }
  // Idle mode (no runtime data anywhere): show the expression text - the
  // "<not evaluated yet>" placeholder only makes sense during a live run
  // when the expression has not yet produced a value.
  if (!runtimeAvailable) return shownValue(variable.value, valueToText)
  return { isNull: false, text: NOT_EVALUATED_PLACEHOLDER }
}

function getRowValue(
  variable: Variable,
  runtimeValue: unknown,
  hasRuntimeValue: boolean,
  viewMode: 'runtime' | 'definition',
  runtimeAvailable: boolean,
  revealSecret: boolean,
): RowValue {
  // Declared with no value and nothing written at run time yet: it holds null.
  if (isNullValue(variable.value) && !hasRuntimeValue) return NULL_ROW_VALUE

  // A secret shows its runtime value, else its definition: masked unless the
  // test-variables reveal is on, and empty when it holds nothing.
  if (variable.isSecret) {
    const shown = hasRuntimeValue ? runtimeValue : variable.value
    return shownValue(shown, (value) => formatValue(value, variable.type, !revealSecret))
  }

  if (variable.isExpression) {
    return getExpressionRowValue(
      variable,
      runtimeValue,
      hasRuntimeValue,
      viewMode,
      runtimeAvailable,
    )
  }

  const sourceValue =
    viewMode === 'runtime' && hasRuntimeValue ? runtimeValue : variable.value
  return shownValue(sourceValue, (value) => formatValue(value, variable.type, false))
}

function truncate(text: string): string {
  if (text.length <= MAX_VALUE_LENGTH) return text
  return text.slice(0, MAX_VALUE_LENGTH) + '…'
}

function getValueClasses(
  variable: Variable,
  viewMode: 'runtime' | 'definition',
  isNull: boolean,
): string {
  // The null text carries its own look; the definition view still dims it like any value.
  if (isNull) return viewMode === 'definition' ? 'opacity-70' : ''
  if (variable.isSecret) return 'text-slate-400'
  const baseColor = variable.isExpression
    ? 'text-cyan-400'
    : getValueColorClass(variable.type)
  if (viewMode === 'definition') return `${baseColor} italic opacity-70`
  return baseColor
}

function getEyeAriaLabel(
  name: string,
  isSecret: boolean,
  runtimeAvailable: boolean,
  revealSecret: boolean,
): string {
  if (isSecret && !revealSecret) return `Secret value for ${name} is always masked`
  if (!runtimeAvailable) return `Toggle view for ${name} (no runtime data)`
  return `Toggle runtime / definition view for ${name}`
}

function getEyeTooltip(
  isSecret: boolean,
  runtimeAvailable: boolean,
  viewMode: 'runtime' | 'definition',
  revealSecret: boolean,
): string {
  if (isSecret && !revealSecret) return 'Secret values are always masked'
  if (!runtimeAvailable) return 'No runtime data yet - run the test to populate'
  return viewMode === 'runtime'
    ? 'Showing runtime value - click to show definition'
    : 'Showing definition - click to show runtime value'
}

function getLockReasonTooltip(
  isExpressionExecutionLocked: boolean,
  readOnly: boolean,
): string | undefined {
  if (isExpressionExecutionLocked) return 'Locked while the test is executing'
  if (readOnly) return 'Read-only snapshot - editing is not available'
  return undefined
}

interface ExpandPresentation {
  disabled: boolean
  ariaLabel: string
  tooltip: string
}

function getExpandPresentation(
  variable: Variable,
  secretUnlocked: boolean,
  revealInspection: boolean,
): ExpandPresentation {
  // A secret is inspectable only while its value is unsaved (new / edited) OR the
  // system test-variables reveal is on: otherwise a saved secret's value is
  // masked and expand locks.
  // A secret holding nothing hides nothing; its inspector sets its Current value (REQ-3.1.2.10).
  if (hidesSecretValue(variable) && !secretUnlocked && !revealInspection) {
    return {
      disabled: true,
      ariaLabel: `Secret value for ${variable.name} cannot be inspected`,
      tooltip: 'Secret values cannot be expanded',
    }
  }
  return {
    disabled: false,
    ariaLabel: `Inspect ${variable.name}`,
    tooltip: `Inspect ${variable.name}`,
  }
}

// ===========================================================================
// Action button (shared shell for the eye / expand / edit / delete cluster)
// ===========================================================================

interface RowActionButtonProps {
  testId: string
  ariaLabel: string
  tooltip?: string
  disabled: boolean
  onAction?: () => void
  destructiveHover?: boolean
  accentClass?: string
  children: ReactNode
}

function RowActionButton({
  testId,
  ariaLabel,
  tooltip,
  disabled,
  onAction,
  destructiveHover,
  accentClass,
  children,
}: Readonly<RowActionButtonProps>) {
  const handleClick = (e: ReactMouseEvent) => {
    e.stopPropagation()
    if (!disabled) onAction?.()
  }
  const hoverText = destructiveHover ? 'hover:text-destructive' : 'hover:text-foreground'
  const disabledClasses = disabled ? ' opacity-50 cursor-not-allowed' : ''
  const textColor = accentClass ?? 'text-muted-foreground'
  const className = `p-1 rounded-sm ${textColor} ${hoverText} hover:bg-muted${disabledClasses}`
  return (
    <ConditionalTooltip content={tooltip} disabled={disabled}>
      <button
        type="button"
        data-testid={testId}
        className={className}
        aria-label={ariaLabel}
        aria-disabled={disabled ? 'true' : undefined}
        onClick={handleClick}
      >
        {children}
      </button>
    </ConditionalTooltip>
  )
}

// Row left-edge cue classes. While mirroring, a modified row gets a temporary
// violet bar + pulse; the watcher/inspect indigo bar shows otherwise (yielding
// the edge to the violet cue while it is active). Off-mirror, a modified row
// keeps the ordinary yellow highlight.
function rowCueClasses(
  recentlyChanged: boolean,
  isMirroring: boolean,
  isInspected: boolean,
): string {
  const mirrorChanged = isMirroring && recentlyChanged
  const highlight = recentlyChanged && !isMirroring ? 'variable-highlight' : ''
  const mirrorCue = mirrorChanged
    ? 'shadow-[inset_2px_0_0_0_var(--color-violet-500)] animate-variable-mirror-pulse'
    : ''
  const inspected = isInspected && !mirrorChanged
    ? 'bg-indigo-500/5 shadow-[inset_2px_0_0_0_var(--color-indigo-500)]'
    : ''
  return `${highlight} ${inspected} ${mirrorCue}`
}

// ===========================================================================
// Component
// ===========================================================================

export function InlineVariableRow({
  variable,
  runtimeValue,
  hasRuntimeValue,
  viewMode,
  onToggleViewMode,
  isExpressionExecutionLocked,
  readOnly,
  currentOnly = false,
  runtimeAvailable = true,
  isOutputBound,
  isWorkflowReferenced,
  isExpressionReferenced,
  recentlyChanged,
  isMirroring,
  kind,
  secretUnlocked = false,
  revealSecret = false,
  revealInspection = false,
  isInspected,
  onExpand,
  onEdit,
  onDelete,
  onKeyDown,
}: Readonly<InlineVariableRowProps>) {
  const { id, name, type, isSecret, isExpression, isTemplate } = variable

  const rowValue = getRowValue(
    variable,
    runtimeValue,
    hasRuntimeValue,
    viewMode,
    runtimeAvailable,
    revealSecret,
  )
  const valueClasses = getValueClasses(variable, viewMode, rowValue.isNull)

  const isUnused = !isWorkflowReferenced && !isExpressionReferenced
  const editLocked = isExpressionExecutionLocked || (readOnly && !currentOnly)
  const deleteLocked = isExpressionExecutionLocked || readOnly

  const rowCueClass = rowCueClasses(!!recentlyChanged, !!isMirroring, !!isInspected)

  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = rowRef.current
    /* v8 ignore next - COV-DEF-110 */
    if (!el) return
    el.tabIndex = 0
    const onKeyDownHandler = (e: globalThis.KeyboardEvent) => {
      onKeyDown?.(e as unknown as ReactKeyboardEvent)
    }
    el.addEventListener('keydown', onKeyDownHandler)
    return () => {
      el.removeEventListener('keydown', onKeyDownHandler)
    }
  }, [onKeyDown])

  // The value column resolves a revealed secret deterministically (runtime value),
  // so the runtime/definition eye stays disabled for every secret.
  const eyeDisabled = isSecret || !runtimeAvailable
  const eyeAriaLabel = getEyeAriaLabel(name, !!isSecret, runtimeAvailable, revealSecret)
  const eyeTooltip = getEyeTooltip(!!isSecret, runtimeAvailable, viewMode, revealSecret)
  const eyeIcon = viewMode === 'runtime'
    ? <EyeIcon size={14} className="lucide-eye" />
    : <EyeOffIcon size={14} className="lucide-eye-off" />

  const expand = getExpandPresentation(variable, secretUnlocked, revealInspection)

  const lockReasonTooltip = getLockReasonTooltip(isExpressionExecutionLocked, readOnly)

  const editTooltip = editLocked ? lockReasonTooltip : 'Edit variable'
  const deleteTooltip = deleteLocked ? lockReasonTooltip : 'Delete variable'

  const editAriaLabel = editLocked ? `Locked: edit ${name}` : `Edit ${name}`
  const deleteAriaLabel = deleteLocked ? `Locked: delete ${name}` : `Delete ${name}`

  return (
    <div
      ref={rowRef}
      data-testid={`variable-row-${id}`}
      className={`group flex flex-col gap-1 px-3 py-2 hover:bg-muted/50 border-b border-border/50 transition-colors overflow-hidden ${rowCueClass}`}
      style={ROW_STYLE}
      aria-label={`Variable ${name}`}
    >
      {/* Row 1: Name + 4-icon action cluster */}
      <div className="flex items-center gap-2 min-w-0">
        <ConditionalTooltip content={name} wide>
          <span
            data-testid={`variable-name-${id}`}
            className="flex-1 font-mono text-sm truncate min-w-0 text-foreground"
          >
            {name}
          </span>
        </ConditionalTooltip>

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <RowActionButton
            testId={`view-toggle-button-${id}`}
            ariaLabel={eyeAriaLabel}
            tooltip={eyeTooltip}
            disabled={eyeDisabled}
            onAction={onToggleViewMode}
          >
            {eyeIcon}
          </RowActionButton>

          <RowActionButton
            testId={`expand-button-${id}`}
            ariaLabel={expand.ariaLabel}
            tooltip={expand.tooltip}
            disabled={expand.disabled}
            onAction={onExpand}
            accentClass={isInspected ? 'text-indigo-400' : undefined}
          >
            <Search size={14} />
          </RowActionButton>

          <RowActionButton
            testId={`edit-button-${id}`}
            ariaLabel={editAriaLabel}
            tooltip={editTooltip}
            disabled={editLocked}
            onAction={onEdit}
          >
            <PencilIcon size={14} />
          </RowActionButton>

          <RowActionButton
            testId={`delete-button-${id}`}
            ariaLabel={deleteAriaLabel}
            tooltip={deleteTooltip}
            disabled={deleteLocked}
            onAction={onDelete}
            destructiveHover
          >
            <TrashIcon size={14} />
          </RowActionButton>
        </div>
      </div>

      {/* Row 2: Value (left) + flag + type badges (right). Flag order is
            Unused first (visual warning), then OUT, {x}, SECRET; the type
            badge is always rightmost. */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          data-testid={`variable-value-${id}`}
          className={`flex-1 text-sm font-mono truncate min-w-0 ${valueClasses}`}
        >
          {rowValue.isNull ? <NullText /> : truncate(rowValue.text)}
        </span>

        {isUnused && (
          <ConditionalTooltip content="Not referenced by any block or other variable." wide>
            <span
              data-testid={`unused-badge-${id}`}
              className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded flex-shrink-0"
            >
              Unused
            </span>
          </ConditionalTooltip>
        )}

        {kind === 'input' && (
          <ConditionalTooltip content="Declared input parameter">
            <span
              data-testid={`in-badge-${id}`}
              className={cn(ROW_BADGE_SHAPE_CLASS, ROLE_BADGE_CLASS.input)}
            >
              IN
            </span>
          </ConditionalTooltip>
        )}

        {(isOutputBound || kind === 'output') && (
          <ConditionalTooltip
            content={kind === 'output' ? 'Declared output parameter' : 'Bound to block output'}
          >
            <span
              data-testid={`out-badge-${id}`}
              className={cn(ROW_BADGE_SHAPE_CLASS, ROLE_BADGE_CLASS.output)}
            >
              OUT
            </span>
          </ConditionalTooltip>
        )}

        {isExpression && (
          <span
            data-testid={`expr-badge-${id}`}
            className="text-[10px] font-medium text-cyan-400 bg-cyan-500/20 px-1.5 py-0.5 rounded flex-shrink-0"
          >
            {'{x}'}
          </span>
        )}

        {isTemplate && (
          <span
            data-testid={`template-badge-${id}`}
            className="text-[10px] font-medium text-cyan-400 bg-cyan-500/20 px-1.5 py-0.5 rounded flex-shrink-0"
          >
            {'{{ }}'}
          </span>
        )}

        {isSecret && (
          <span
            data-testid={`secret-badge-${id}`}
            className="text-[10px] font-medium uppercase tracking-wider text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded flex-shrink-0"
          >
            SECRET
          </span>
        )}

        <span
          data-testid={`type-badge-${id}`}
          className={`${TYPE_PILL_CLASS} ${getTypeBadgeClass(type)}`}
        >
          {type}
        </span>
      </div>
    </div>
  )
}
