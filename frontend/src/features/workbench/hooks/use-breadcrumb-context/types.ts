/**
 * Types for the workbench breadcrumb-context hook.
 */

export type BreadcrumbSegmentType =
  | 'execution-root'
  | 'execution'
  | 'test'
  | 'suite'
  | 'regression'
  | 'function'

export interface BreadcrumbSegment {
  type: BreadcrumbSegmentType
  label: string
  href?: string
  id?: string
  /**
   * When true, the canvas bar renders a skeleton in place of the label so
   * the segment slot is stable from first paint even while the entity name
   * is still loading.
   */
  isPending?: boolean
}

export interface BreadcrumbContext {
  segments: BreadcrumbSegment[]
  backHref: string | null
  isLoading: boolean
  /**
   * Parent-segment placeholders to render while their names are still being
   * fetched. The canvas bar renders one skeleton item per entry, preceding
   * the loaded `segments`, so opening a suite-origin or regression-origin
   * workbench does not flash the leaf alone before the parents arrive.
   */
  pendingParents: Array<{ type: BreadcrumbSegmentType }>
}

/**
 * Minimal shape of the parent-execution fetch result that the hook uses to
 * decide whether the path is a suite child, a regression child, or a 3-deep
 * regression child.
 */
export interface ParentExecutionInfo {
  id: string
  name: string
  entityType: string
  parentExecutionId: string | null
}
