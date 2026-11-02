/**
 * The pulled fields and indexes of the OpenSearch block whose sheet is open, for the rows that suggest them (OS-13).
 */

import { createContext } from 'react'

import type {
  OpenSearchField,
  OpenSearchFieldsRequest,
  OpenSearchIndex,
} from '@/features/workbench/api/opensearch-tools'
import type { CatalogChipState } from '@/features/workbench/common/variables/variable-inspect-modal/catalog-chip'

export interface FieldSuggestValue {
  /** Null until the Get fields pull has loaded. */
  fields: readonly OpenSearchField[] | null
  indexes: readonly OpenSearchIndex[] | null
  state: CatalogChipState
  /** Starts the Get fields pull. */
  start: () => void
  /** Starts the same pull from the Index pattern row, whose failure toast speaks of indexes. */
  startIndexes?: () => void
  /** The block's Get fields request: its Index pattern gates the field rows, and a Custom (JSON) stat joins it. */
  request?: OpenSearchFieldsRequest | null
  /** The Index pattern as written, which that editor's check names. */
  index?: string
}

/** Outside an OpenSearch block nothing is pulled, so a suggesting row is a plain text input. */
export const NO_FIELD_SUGGESTIONS: FieldSuggestValue = {
  fields: null,
  indexes: null,
  state: 'idle',
  start: () => {},
}

export const FieldSuggestContext = createContext<FieldSuggestValue>(NO_FIELD_SUGGESTIONS)
