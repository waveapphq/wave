/**
 * Pagination controls for DataTable.
 *
 * Matches the layout and data-testid conventions of the existing
 * shared Pagination component for consistent E2E testing.
 */

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { PageInfo } from '@/components/shared/tables/table-utils'

interface DataTablePaginationProps {
  pageInfo: PageInfo
  entityName?: string
  loading?: boolean
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

export function DataTablePagination({
  pageInfo,
  entityName,
  loading = false,
  onPageChange,
  onPageSizeChange,
}: Readonly<DataTablePaginationProps>) {
  if (loading) {
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

  const { currentPage, pageSize, totalItems, totalPages } = pageInfo
  /* v8 ignore next - COV-BRANCH-128 */
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const endItem = Math.min(currentPage * pageSize, totalItems)

  return (
    <div
      data-testid="pagination"
      className="flex flex-shrink-0 items-center justify-between"
    >
      <div data-testid="pagination-item-count" className="text-sm text-muted">
        Showing {startItem}-{endItem} of {totalItems}{entityName ? ` ${entityName}` : ''}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Select
            value={pageSize.toString()}
            /* v8 ignore next - COV-RADIX-001 */
            onValueChange={(value) => onPageSizeChange(Number.parseInt(value, 10))}
          >
            <SelectTrigger data-testid="page-size-selector" className="w-[70px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted">per page</span>
        </div>

        <nav
          data-testid="pagination-navigation"
          aria-label="Pagination"
          className="flex items-center gap-1"
        >
          <Button
            variant="outline"
            size="sm"
            aria-label="First page"
            disabled={currentPage === 1}
            onClick={() => onPageChange(1)}
          >
            &laquo;
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Previous page"
            disabled={currentPage === 1}
            onClick={() => onPageChange(currentPage - 1)}
          >
            &lsaquo;
          </Button>

          <span className="px-3 text-sm">
            Page {currentPage} of {totalPages}
          </span>

          <Button
            variant="outline"
            size="sm"
            aria-label="Next page"
            disabled={currentPage === totalPages}
            onClick={() => onPageChange(currentPage + 1)}
          >
            &rsaquo;
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Last page"
            disabled={currentPage === totalPages}
            onClick={() => onPageChange(totalPages)}
          >
            &raquo;
          </Button>
        </nav>
      </div>
    </div>
  )
}
