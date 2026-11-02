/**
 * ValidationErrorDialog Component
 *
 * Single-component validation modal parameterised by `mode` and `fatal`.
 *
 * - mode='save'  -> "Cannot Save Test" (Close)
 * - mode='run'   -> "Cannot Run Test" (Close)
 * - mode='debug' -> "Cannot Debug Test" (Close)
 * - mode='load'  + fatal=true  -> "Cannot Load Test" (Close, Delete Test)
 * - mode='load'  + fatal=false -> "Test Issues Found" (Close, Fix All) - shows Fix column
 *
 * Built on Radix AlertDialog - no ESC/backdrop dismiss.
 */

import { AlertTriangle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import {
  ValidationPathRow,
  type PathSegment,
} from '@/features/workbench/common/canvas/dialogs/validation-path-row'

export interface ValidationError {
  path: string
  node_id?: string
  node_label?: string
  element_type?: string
  code: string
  message: string
  severity?: 'error' | 'warning'
  fix_action?: string | null
  /** Root-to-leaf trail of enclosing Functions (mirrors the backend
   *  `function_path`); absent for a top-level issue. */
  functionPath?: PathSegment[]
}

export type ValidationDialogMode = 'load' | 'save' | 'run' | 'debug'

const EMPTY_PATH: PathSegment[] = []
function noopNavigate(): void {}

// Codes whose leaf names a Published Function reference (rendered italic/muted).
const SHARED_REF_CODES = new Set(['MISSING_FUNCTION_VERSION', 'MISSING_FUNCTION_ID'])

interface RawFunctionPathSegment {
  node_id?: string
  label?: string
}

/** Map a backend `function_path` (`[{node_id, label, element_type}]`) to the
 *  FE `PathSegment[]` the dialog renders. Returns undefined for a top-level
 *  issue (no trail). */
export function mapFunctionPath(raw: unknown): PathSegment[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.map((segment) => {
    const seg = (segment ?? {}) as RawFunctionPathSegment
    return { label: seg.label ?? '', nodeId: seg.node_id }
  })
}

export interface ValidationErrorDialogProps {
  isOpen: boolean
  fatal: boolean
  errors: ValidationError[]
  onClose: () => void
  onFixAll?: () => void
  onDeleteTest?: () => void
  isFixing?: boolean
  mode?: ValidationDialogMode
  /** Drill to + focus the issue's location, dismissing the dialog. */
  onNavigateToIssue?: (error: ValidationError, depthIndex?: number) => void
}

interface ModeContent {
  title: string
  trailing: string
  iconClass: string
  IconComponent: typeof AlertTriangle | typeof XCircle
}

const MODE_CONTENT: Record<Exclude<ValidationDialogMode, 'load'>, ModeContent> = {
  save: {
    title: 'Cannot Save Test',
    trailing: 'validation error(s) must be resolved before saving.',
    iconClass: 'text-error',
    IconComponent: XCircle,
  },
  run: {
    title: 'Cannot Run Test',
    trailing: 'validation error(s) must be resolved before running.',
    iconClass: 'text-error',
    IconComponent: XCircle,
  },
  debug: {
    title: 'Cannot Debug Test',
    trailing: 'validation error(s) must be resolved before debugging.',
    iconClass: 'text-error',
    IconComponent: XCircle,
  },
}

const LOAD_NON_FATAL_CONTENT: ModeContent = {
  title: 'Test Issues Found',
  trailing: 'item(s) can be automatically fixed.',
  iconClass: 'text-warning',
  IconComponent: AlertTriangle,
}

// Load-mode headline trailing text. The leading bold count is the auto-fixable
// count when any issue is fixable (it reads "<n> ... can be automatically
// fixed"), else the total. Keeps the headline honest with the per-row Fix
// column + the Fix All button.
function loadTrailingText(total: number, fixable: number): string {
  if (fixable === 0) return 'item(s) must be resolved manually.'
  if (fixable < total) return `of ${total} item(s) can be automatically fixed.`
  return 'item(s) can be automatically fixed.'
}

export function ValidationErrorDialog({
  isOpen,
  fatal,
  errors,
  onClose,
  onFixAll,
  onDeleteTest,
  isFixing = false,
  mode = 'load',
  onNavigateToIssue = noopNavigate,
}: Readonly<ValidationErrorDialogProps>) {
  if (mode === 'load' && fatal) {
    return (
      <AlertDialog open={isOpen}>
        <AlertDialogContent
          data-testid="validation-error-dialog"
          className={cn(
            'max-w-[480px]',
            'max-h-[90vh]',
            'p-6',
            'rounded-xl',
            'shadow-lg',
            'bg-elevated',
            'gap-0'
          )}
        >
          <div className="icon-xl mb-4 text-error text-center" aria-hidden="true">
            <XCircle size={24} className="mx-auto" />
          </div>

          <AlertDialogTitle className="text-primary mb-2 text-center">
            Cannot Load Test
          </AlertDialogTitle>

          <AlertDialogDescription className="font-normal text-secondary leading-normal mb-4 text-center">
            This test has fatal structural errors that prevent loading.
          </AlertDialogDescription>

          <div
            data-testid="validation-error-list"
            className="overflow-y-auto max-h-64 text-left mb-6 p-3 border rounded bg-subtle text-sm"
          >
            <ul className="list-disc list-inside space-y-1">
              {errors.map((error) => (
                <li key={`${error.code}-${error.path}-${error.message.slice(0, 40)}`} className="text-secondary">
                  <span className="font-mono text-xs text-tertiary mr-1">
                    [{error.code}]
                  </span>
                  {error.message}
                </li>
              ))}
            </ul>
          </div>

          <div data-action-group className="flex justify-end gap-3">
            <AlertDialogCancel asChild>
              <Button
                data-testid="validation-close-btn"
                variant="secondary"
                size="md"
                onClick={onClose}
              >
                Close
              </Button>
            </AlertDialogCancel>
            {onDeleteTest && (
              <Button
                data-testid="validation-delete-test-btn"
                variant="destructive"
                size="md"
                onClick={onDeleteTest}
              >
                Delete Test
              </Button>
            )}
          </div>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  const isLoadNonFatal = mode === 'load'
  const content = isLoadNonFatal ? LOAD_NON_FATAL_CONTENT : MODE_CONTENT[mode]
  const IconComponent = content.IconComponent
  const showFixColumn = isLoadNonFatal
  // Auto-fixable issues carry a BE fix_action; content issues carry none.
  const fixableCount = errors.filter((e) => e.fix_action != null).length
  const headlineCount = isLoadNonFatal && fixableCount > 0 ? fixableCount : errors.length
  const trailing = isLoadNonFatal
    ? loadTrailingText(errors.length, fixableCount)
    : content.trailing
  // Invariant: a "Fix All" button is shown only when at least one row has a
  // real fix - never when every Fix cell is "-".
  const showFixAll = Boolean(onFixAll) && (!isLoadNonFatal || fixableCount > 0)

  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent
        data-testid="validation-error-dialog"
        className={cn(
          'max-w-[640px]',
          'max-h-[90vh]',
          'p-6',
          'rounded-xl',
          'shadow-lg',
          'bg-elevated',
          'gap-0'
        )}
      >
        <div className={cn('icon-xl mb-4 text-center', content.iconClass)} aria-hidden="true">
          <IconComponent size={24} className="mx-auto" />
        </div>

        <AlertDialogTitle className="text-primary mb-2 text-center">
          {content.title}
        </AlertDialogTitle>

        <AlertDialogDescription className="font-normal text-secondary leading-normal mb-4 text-center">
          <span data-testid="validation-error-count" className="font-semibold">
            {headlineCount}
          </span>{' '}
          {trailing}
        </AlertDialogDescription>

        <div
          data-testid="validation-error-list"
          className="overflow-y-auto max-h-64 text-left mb-6 border rounded bg-subtle text-sm"
        >
          <table className="w-full">
            <thead>
              <tr className="border-b text-tertiary text-xs uppercase tracking-wide">
                <th className="text-left p-2 font-medium">Issue</th>
                {showFixColumn && <th className="text-left p-2 font-medium">Fix</th>}
              </tr>
            </thead>
            <tbody>
              {errors.map((error, index) => (
                <tr
                  key={`${error.code}-${error.node_id ?? error.path}-${index}`}
                  className="border-b last:border-b-0"
                >
                  <td className="p-2">
                    <ValidationPathRow
                      path={error.functionPath ?? EMPTY_PATH}
                      leafLabel={error.node_label ?? error.code}
                      message={error.message}
                      leafIsShared={SHARED_REF_CODES.has(error.code)}
                      onSegmentNavigate={(depthIndex) => onNavigateToIssue(error, depthIndex)}
                      onLeafFocus={() => onNavigateToIssue(error)}
                    />
                  </td>
                  {showFixColumn && (
                    <td className="p-2 text-tertiary align-top">{error.fix_action ?? '-'}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div data-action-group className="flex justify-end gap-3">
          <AlertDialogCancel asChild>
            <Button
              data-testid="validation-close-btn"
              variant="secondary"
              size="md"
              disabled={isFixing}
              onClick={onClose}
            >
              Close
            </Button>
          </AlertDialogCancel>
          {showFixAll && (
            <Button
              data-testid="validation-fix-all-btn"
              variant="default"
              size="md"
              onClick={onFixAll}
              disabled={isFixing}
              loading={isFixing}
              aria-busy={isFixing || undefined}
            >
              Fix All
            </Button>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
