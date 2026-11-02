/**
 * Internal shared bits for the per-entity execution detail tables.
 *
 * Private to the detail folder - not re-exported from the dispatcher.
 * The three per-entity table files (test/suite/regression) import
 * everything they need from here.
 */

import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'
import type { Column } from '@/components/shared/filters/entity-filters'
import { downloadExecutionExport } from '@/features/executions/api/export'

export interface ExecutionTestRow {
  id: string
  name: string
  status: string
  duration: number | null
  tags?: string[]
  /**
   * Opaque per-run identifier. Present once the backend has issued a
   * rollup entry for this test run - absent only for rows that were
   * unselected (excluded) at dispatch. The Historical Test Canvas URL
   * (`/executions/history/:runId`) is keyed on this value, so a
   * regression where the same `id` (test) appears in two suites shows
   * two distinct history pages, one per run_id.
   */
  run_id?: string | null
}

export interface ExecutionSuiteRow {
  id: string
  name: string
  status: string
  duration: number | null
  tests: ExecutionTestRow[]
  tags?: string[]
}

export interface ExecutionFilters {
  search: string
  status: string[]
  tags: string[]
}

export const TEST_STATUS_OPTIONS = [
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'running', label: 'Running' },
  { value: 'pending', label: 'Pending' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'stopped', label: 'Stopped' },
  { value: 'excluded', label: 'Excluded' },
]

// Default Status filter selection hides only 'excluded' (unselected at
// dispatch) - those rows are noise for subset runs. Mid-run 'skipped'
// entries stay visible because they describe something that actually
// happened during the run (halt fan-out, stop cascade, per-entry halt).
export const TEST_STATUS_DEFAULT = TEST_STATUS_OPTIONS
  .filter((o) => o.value !== 'excluded')
  .map((o) => o.value)

export const DEFAULT_TEST_FILTERS: ExecutionFilters = {
  search: '',
  status: TEST_STATUS_DEFAULT,
  tags: [],
}

export function isTestViewable(status: string): boolean {
  // 'skipped' means the test actually ran but its Halt plugin short-circuited
  // with skipped status - there IS a recorded canvas to view. 'excluded'
  // means the test was never selected for the run, so there is no history
  // to open.
  return (
    status === 'passed' ||
    status === 'failed' ||
    status === 'stopped' ||
    status === 'skipped'
  )
}

export function useColumnToggle(
  columnSpecs: Array<{ id: string; label: string }>,
  defaultVisible: string[],
) {
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(defaultVisible)

  const columnDefs = useMemo<Column[]>(
    () => columnSpecs.map((c) => ({ id: c.id, label: c.label, visible: visibleColumnIds.includes(c.id) })),
    [visibleColumnIds, columnSpecs],
  )

  const handleColumnToggle = useCallback((columnId: string, visible: boolean) => {
    setVisibleColumnIds((prev) => (visible ? [...prev, columnId] : prev.filter((id) => id !== columnId)))
  }, [])

  const columnVisibility = useMemo(() => {
    const vis: Record<string, boolean> = {}
    for (const c of columnSpecs) vis[c.id] = visibleColumnIds.includes(c.id)
    return vis
  }, [visibleColumnIds, columnSpecs])

  return { columnDefs, handleColumnToggle, columnVisibility }
}

/** Row-level export. A failed download reports where the user is looking. */
export function useExecutionDownload(executionId: string): (testIds: string[]) => void {
  const { error: toastError } = useToast()
  // The row buttons cannot await, so a failed download names itself in a toast.
  return useCallback(
    (testIds: string[]) => {
      downloadExecutionExport(executionId, { testIds }).catch((err: unknown) => {
        toastError(toFailureDetail(err).message, 'Download Failed')
      })
    },
    [executionId, toastError],
  )
}

export function TestActions({
  executionId,
  testId,
  runId,
  status,
}: Readonly<{
  executionId: string
  testId: string
  /**
   * Opaque identifier for THIS test run, used to key the Historical
   * Test Canvas URL. For a regression running the same test in two
   * suites, the two runs carry different run_ids and thus open
   * independent history pages. Rows without a run_id (excluded tests
   * that never ran) hide the Open Detail button entirely.
   */
  runId?: string | null
  status: string
}>) {
  const viewable = isTestViewable(status) && !!runId
  const download = useExecutionDownload(executionId)
  return (
    <div className="flex items-center gap-1">
      {viewable && (
        <Button variant="ghost" size="sm" asChild aria-label="Open test detail">
          <Link to={`/executions/history/${runId}`}>
            <Eye className="h-4 w-4" />
          </Link>
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        aria-label="Download test"
        onClick={() => { download([testId]) }}
      >
        <Download className="h-4 w-4" />
      </Button>
    </div>
  )
}
