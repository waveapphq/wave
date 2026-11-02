/**
 * The Get fields pull behind the OpenSearch Query editor chip and the field suggestions (REQ-3.3.2.5; OS-12, OS-13).
 */

import {
  cancelFields,
  getFields,
  startFields,
  type OpenSearchField,
  type OpenSearchFieldsRequest,
  type OpenSearchIndex,
} from '@/features/workbench/api/opensearch-tools'
import type { CatalogChipState } from '@/features/workbench/common/variables/variable-inspect-modal/catalog-chip'
import { useCatalogPull, type CatalogPullApi } from '@/features/workbench/hooks/use-catalog-pull'

export interface UseOpenSearchFieldsResult {
  /** Never connecting: a connecting pull reads as reading. */
  state: CatalogChipState
  /** Loaded fields, null until the entry is loaded. */
  fields: readonly OpenSearchField[] | null
  indexes: readonly OpenSearchIndex[] | null
  /** The job the loaded lists came from, which the check and the suggestions read. */
  jobId: string | null
  /** The number of fields. */
  count: number
  error: string | null
  start: () => void
  /** Starts the same pull from the Index pattern row, whose failure toast speaks of indexes. */
  startIndexes: () => void
  stop: () => void
  refresh: () => void
  /** Ends the Done hold at once. */
  settle: () => void
}

interface OpenSearchFieldsData {
  indexes: OpenSearchIndex[]
  fields: OpenSearchField[]
}

const OPENSEARCH_FIELDS_API: CatalogPullApi<OpenSearchFieldsData, OpenSearchFieldsRequest> = {
  start: startFields,
  get: getFields,
  cancel: cancelFields,
  dataOf: (answer) => ({ indexes: answer.indexes ?? [], fields: answer.fields ?? [] }),
  empty: { indexes: [], fields: [] },
}

const INDEXES_FAILED_TITLE = 'Could not get indexes'

/** The Get fields state of one fields request, shared by every editor and row of the block. */
export function useOpenSearchFields(request: OpenSearchFieldsRequest | null): UseOpenSearchFieldsResult {
  const pull = useCatalogPull('opensearch', request, OPENSEARCH_FIELDS_API)
  const fields = pull.data?.fields ?? null
  return {
    state: pull.state === 'connecting' ? 'reading' : pull.state,
    fields,
    indexes: pull.data?.indexes ?? null,
    jobId: pull.jobId,
    count: fields?.length ?? 0,
    error: pull.error,
    start: () => pull.start(),
    startIndexes: () => pull.start(INDEXES_FAILED_TITLE),
    stop: pull.stop,
    refresh: pull.refresh,
    settle: pull.settle,
  }
}
