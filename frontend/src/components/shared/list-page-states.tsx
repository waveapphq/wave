/**
 * Shared List Page State Components
 *
 * Reusable error, empty, and loading states for entity list pages.
 * Extracted from suites, tests, and regressions pages to eliminate duplication.
 *
 * Design decisions:
 * - LIST-5: Error: empathetic tone, "Try Again" button, red alert icon
 * - LIST-6: Empty: entity-specific icon, encouraging message, primary CTA
 */

/* v8 ignore next - COV-V8-001 */
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Icon, AlertTriangleIcon } from '@/components/ui/icon'

export interface ListErrorStateProps {
  /** Entity name for the error message (e.g. "suites", "tests"). */
  entityName: string
  /** Optional error detail message. */
  error?: string
  /** Callback when user clicks "Try Again". */
  onRetry: () => void
}

export interface ListEmptyStateProps {
  /** Plural entity name (e.g. "suites", "tests"). */
  entityName: string
  /** Singular entity name for CTA (e.g. "Suite", "Test"). */
  entityNameSingular: string
  /** Icon to display in the empty state. */
  icon: LucideIcon
  /** Description text below the title. */
  emptyDescription: string
  /** Additional CSS class for the icon (e.g. "text-muted", "text-violet-400"). */
  iconClassName?: string
  /** Whether this is a filtered-empty state (no matching results). */
  isFilteredEmpty: boolean
  /** Callback when user clicks "Clear Filters". */
  onClearFilters: () => void
  /** Callback when user clicks the create CTA. Omit to hide the CTA entirely
   *  (e.g. Functions are born inside a Test, so the library has no create CTA). */
  onCreateNew?: () => void
}


/**
 * Error state for list pages.
 * Displays an alert icon, entity-specific title, optional error detail, and retry button.
 */
export function ListErrorState({ entityName, error, onRetry }: Readonly<ListErrorStateProps>) {
  return (
    <div data-testid="error-state" className="flex flex-col items-center justify-center py-16">
      <Icon
        icon={AlertTriangleIcon}
        size="xl"
        data-testid="error-state-icon"
        className="text-error mb-4"
      />
      <p data-testid="error-state-title" className="mb-4 text-lg font-medium">
        Unable to load {entityName}
      </p>
      <p data-testid="error-state-description" className="mb-6 max-w-md text-center text-muted">
        Something went wrong while loading. Please try again.
        {error && <span className="mt-2 block text-sm">({error})</span>}
      </p>
      <Button onClick={onRetry}>Try Again</Button>
    </div>
  )
}

/**
 * Empty state for list pages.
 * Handles both unfiltered (no items yet) and filtered (no matching items) states.
 */
export function ListEmptyState({
  entityName,
  entityNameSingular,
  icon,
  emptyDescription,
  iconClassName = 'text-muted',
  isFilteredEmpty,
  onClearFilters,
  onCreateNew,
}: Readonly<ListEmptyStateProps>) {
  return (
    <div
      data-testid={isFilteredEmpty ? 'no-results-state' : 'empty-state'}
      className="flex flex-col items-center justify-center py-16"
    >
      <Icon
        icon={icon}
        size="2xl"
        data-testid={isFilteredEmpty ? 'no-results-state-icon' : 'empty-state-icon'}
        className={`mb-4 ${iconClassName}`}
      />
      <h2
        data-testid={isFilteredEmpty ? 'no-results-state-title' : 'empty-state-title'}
        className="mb-2 text-lg font-medium"
      >
        {isFilteredEmpty ? `No matching ${entityName} found` : `No ${entityName} yet`}
      </h2>
      <p
        data-testid={isFilteredEmpty ? 'no-results-state-description' : 'empty-state-description'}
        className="mb-6 max-w-md text-center text-muted"
      >
        {isFilteredEmpty
          ? `No ${entityName} match your current filters. Try adjusting your search criteria.`
          : emptyDescription}
      </p>
      {isFilteredEmpty && (
        <Button
          variant="outline"
          onClick={onClearFilters}
          className="border-warning text-warning hover:bg-warning/10"
        >
          Clear Filters
        </Button>
      )}
      {!isFilteredEmpty && onCreateNew && (
        <Button className="btn-primary" onClick={onCreateNew}>
          Create Your First {entityNameSingular}
        </Button>
      )}
    </div>
  )
}

/**
 * Loading skeleton for the pagination area of list pages.
 */
export function ListLoadingPagination() {
  return (
    <div data-testid="pagination" className="flex flex-shrink-0 items-center justify-between">
      <Skeleton className="h-4 w-32" />
      <div className="flex items-center gap-4">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-40" />
      </div>
    </div>
  )
}
