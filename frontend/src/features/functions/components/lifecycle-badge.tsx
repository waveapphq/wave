/**
 * Shared lifecycle badge for Function nodes (Local / Published).
 *
 * Single source of truth for the `L` / `S` glyph used by both the canvas
 * node status bar and the Function instance config modal header. Wraps the
 * badge with the shared ``ConditionalTooltip`` so the hover hint
 * ("Local Function" / "Shared Function") is identical wherever the badge
 * appears.
 *
 * When the wrapping Published instance
 * carries an in-Test edit-mode draft, the badge overlays a small red SVG
 * asterisk (``EditModeMark``) at the top-right corner with its own tooltip
 * naming the source version. The overlay is ignored on Local lifecycle.
 */

import { ConditionalTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { EditModeMark } from '@/features/functions/components/edit-mode-mark'

export type FunctionLifecycle = 'local' | 'shared'

const COLOR_BY_LIFECYCLE: Record<FunctionLifecycle, string> = {
  local: 'bg-slate-500/15 text-slate-700 dark:text-slate-200 border-slate-500/30',
  shared: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/30',
}

const TOOLTIP_BY_LIFECYCLE: Record<FunctionLifecycle, string> = {
  local: 'Local Function',
  shared: 'Shared Function',
}

const SIZE_CLASS: Record<'sm' | 'md', string> = {
  sm: 'h-4 w-4 text-[10px]',
  md: 'h-6 w-6 text-xs',
}

export interface FunctionLifecycleBadgeProps {
  lifecycle: FunctionLifecycle
  /** Canvas uses `sm` (h-4); modal header uses `md` (h-6). Default: `sm`. */
  size?: 'sm' | 'md'
  /** Override the default test id so each surface can be targeted distinctly. */
  testId?: string
  /** Render the edit-mode asterisk overlay (Published Functions only). */
  editMode?: boolean
  /** Source version the draft was snapshotted from; appears in the tooltip. */
  editModeSourceVersion?: string
}

function editModeTooltipBody(sourceVersion?: string): string {
  if (sourceVersion) {
    return `Function in edit mode - may differ from published v${sourceVersion}.`
  }
  return 'Function in edit mode - may differ from the published version.'
}

function EditModeOverlay({
  sourceVersion,
}: Readonly<{
  sourceVersion?: string
}>) {
  const body = editModeTooltipBody(sourceVersion)
  // ConditionalTooltip portals the popup to the document root, so it escapes
  // the React Flow viewport transform (no zoom-scaled font) and the node
  // stacking context (no egress-handle overlap).
  return (
    <ConditionalTooltip content={body}>
      <button
        type="button"
        data-testid="edit-mode-mark-wrapper"
        aria-label={body}
        className={cn(
          'absolute top-0 right-0 translate-x-1/2 -translate-y-1/2 inline-flex items-center justify-center cursor-help text-red-600 dark:text-red-400 border-0 bg-transparent p-0',
          'drop-shadow-[0_0_1px_white] dark:drop-shadow-[0_0_1px_black]',
        )}
      >
        <EditModeMark />
      </button>
    </ConditionalTooltip>
  )
}

export function FunctionLifecycleBadge({
  lifecycle,
  size = 'sm',
  testId = 'node-function-lifecycle-badge',
  editMode = false,
  editModeSourceVersion,
}: Readonly<FunctionLifecycleBadgeProps>) {
  const tooltip = TOOLTIP_BY_LIFECYCLE[lifecycle]
  const showOverlay = editMode && lifecycle === 'shared'

  return (
    <span className="relative inline-flex shrink-0">
      <ConditionalTooltip content={tooltip}>
        <span
          data-testid={testId}
          data-state={lifecycle}
          aria-label={tooltip}
          className={cn(
            'inline-flex items-center justify-center rounded border font-semibold leading-none cursor-default select-none shrink-0',
            SIZE_CLASS[size],
            COLOR_BY_LIFECYCLE[lifecycle],
          )}
        >
          {lifecycle === 'local' ? 'L' : 'S'}
        </span>
      </ConditionalTooltip>
      {showOverlay ? <EditModeOverlay sourceVersion={editModeSourceVersion} /> : null}
    </span>
  )
}
