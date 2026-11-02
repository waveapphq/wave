/**
 * The Get Tables pull behind the SQL editor chip (REQ-3.4.1.6; SQL-12).
 */

import {
  cancelCatalog,
  getCatalog,
  startCatalog,
  type SqlCatalogRequest,
  type SqlTable,
} from '@/features/workbench/api/sql-tools'
import type { CatalogChipState } from '@/features/workbench/common/variables/variable-inspect-modal/catalog-chip'
import { useCatalogPull, type CatalogPullApi } from '@/features/workbench/hooks/use-catalog-pull'

export interface UseSqlCatalogResult {
  state: CatalogChipState
  /** Loaded tables, null until the entry is loaded. */
  tables: readonly SqlTable[] | null
  count: number
  error: string | null
  start: () => void
  stop: () => void
  refresh: () => void
  /** Ends the Done hold at once. */
  settle: () => void
}

interface SqlCatalogData {
  tables: SqlTable[]
}

const SQL_CATALOG_API: CatalogPullApi<SqlCatalogData, SqlCatalogRequest> = {
  start: startCatalog,
  get: getCatalog,
  cancel: cancelCatalog,
  dataOf: (answer) => ({ tables: answer.tables ?? [] }),
  empty: { tables: [] },
}

/** The Get Tables state of one catalog request, shared by every editor on the same pull. */
export function useSqlCatalog(request: SqlCatalogRequest | null): UseSqlCatalogResult {
  const pull = useCatalogPull('sql', request, SQL_CATALOG_API)
  const tables = pull.data?.tables ?? null
  return {
    state: pull.state,
    tables,
    count: tables?.length ?? 0,
    error: pull.error,
    start: () => pull.start(),
    stop: pull.stop,
    refresh: pull.refresh,
    settle: pull.settle,
  }
}
