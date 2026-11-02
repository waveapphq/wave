/**
 * The names a field or index row suggests from the block's pulled fields (OS-13, REQ-3.3.2.5, REQ-3.3.2.6):
 * the list, the footer that starts or retries the pull, and the empty line.
 */

import { use } from 'react'
import { Loader2 } from 'lucide-react'
import type { OpenSearchField, OpenSearchIndex } from '@/features/workbench/api/opensearch-tools'
import type { CatalogChipState } from '@/features/workbench/common/variables/variable-inspect-modal/catalog-chip'
import type { FieldSuggestPolicy } from '@/features/workbench/lib/node-parameters/types'
import { FILL_IN_INDEX_PATTERN, indexPatternIsBlank } from '@/features/workbench/lib/opensearch/connection'
import type { ComboboxVariable, SuggestionList } from '../shared/variable-combobox-base'
import { FieldSuggestContext, NO_FIELD_SUGGESTIONS, type FieldSuggestValue } from './field-suggest-context'

type FieldKind = NonNullable<FieldSuggestPolicy['types']>

const DATE_TYPES: ReadonlySet<string> = new Set(['date', 'date_nanos'])
const NUMERIC_TYPES: ReadonlySet<string> = new Set([
  'long',
  'integer',
  'short',
  'byte',
  'double',
  'float',
  'half_float',
  'scaled_float',
  'unsigned_long',
])

const FIELD_KINDS: Record<FieldKind, (field: OpenSearchField) => boolean> = {
  date: (field) => field.types.some((type) => DATE_TYPES.has(type)),
  aggregatable: (field) => field.aggregatable,
  numeric: (field) => field.types.some((type) => NUMERIC_TYPES.has(type)),
}

const INDEX_KIND_WORDS: Record<Exclude<OpenSearchIndex['kind'], 'folded'>, string> = {
  index: 'index',
  alias: 'alias',
  data_stream: 'data stream',
}

const FOOTER_ACTION_CLASS =
  'flex w-full items-center border-t px-3 py-2 text-left text-sm text-primary hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'

function indexWords(index: OpenSearchIndex): string {
  return index.kind === 'folded' ? `${index.count} indexes` : INDEX_KIND_WORDS[index.kind]
}

const NO_ITEMS: ComboboxVariable[] = []

/** The footer and empty-line words of a row, by what it lists. */
interface SourceWords {
  idle: string
  busy: string
  failed: string
  noMatch: string
}

const SOURCE_WORDS: Record<FieldSuggestPolicy['source'], SourceWords> = {
  fields: {
    idle: 'Get fields',
    busy: 'Getting fields...',
    failed: 'Could not get fields. Try again',
    noMatch: 'No matching fields',
  },
  indexes: {
    idle: 'Get indexes',
    busy: 'Getting indexes...',
    failed: 'Could not get indexes. Try again',
    noMatch: 'No matching indexes',
  },
}

// Only a loaded list says nothing matched; before that the footer tells the pull's state.
function emptyTextOf(state: CatalogChipState, words: SourceWords): string | null {
  return state === 'done' || state === 'settled' ? words.noMatch : null
}

function fieldItems(fields: readonly OpenSearchField[], types: FieldKind | undefined): ComboboxVariable[] {
  const offered = types === undefined ? fields : fields.filter(FIELD_KINDS[types])
  return offered.map((field) => ({ name: field.name, type: field.types.join(', ') }))
}

function indexItems(indexes: readonly OpenSearchIndex[]): ComboboxVariable[] {
  return indexes.map((index) => ({ name: index.name, type: indexWords(index) }))
}

/** The pulled list the row offers; empty until the pull has loaded. */
function suggestedItems(
  suggest: FieldSuggestValue,
  source: FieldSuggestPolicy['source'],
  types: FieldKind | undefined,
): ComboboxVariable[] {
  const pulled =
    source === 'indexes'
      ? suggest.indexes && indexItems(suggest.indexes)
      : suggest.fields && fieldItems(suggest.fields, types)
  return pulled ?? NO_ITEMS
}

/** The list footer: start or retry the pull, or show it running; nothing once loaded. */
function PullFooter({
  state,
  words,
  start,
}: Readonly<{ state: CatalogChipState; words: SourceWords; start: () => void }>) {
  switch (state) {
    case 'idle':
      return (
        <button type="button" className={FOOTER_ACTION_CLASS} onClick={start}>
          {words.idle}
        </button>
      )
    case 'connecting':
    case 'reading':
      return (
        <p className="flex items-center gap-2 border-t px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          {words.busy}
        </p>
      )
    case 'failed':
      return (
        <button type="button" className={FOOTER_ACTION_CLASS} onClick={start}>
          {words.failed}
        </button>
      )
    default:
      return null
  }
}

/** A field row waits for an Index pattern: no pull can start from it. */
function FillInFooter() {
  return <p className="border-t px-3 py-2 text-sm text-muted-foreground">{FILL_IN_INDEX_PATTERN}</p>
}

/** What a suggesting row offers under its text box; none without a policy or outside an OpenSearch sheet. */
export function useFieldSuggestions(policy: FieldSuggestPolicy | undefined): SuggestionList | undefined {
  const suggest = use(FieldSuggestContext)
  if (policy === undefined || suggest === NO_FIELD_SUGGESTIONS) return undefined
  const { source, types } = policy
  if (source === 'fields' && suggest.request != null && indexPatternIsBlank(suggest.request)) {
    return { items: NO_ITEMS, emptyText: null, footer: <FillInFooter /> }
  }
  const words = SOURCE_WORDS[source]
  const start = (source === 'indexes' && suggest.startIndexes) || suggest.start
  return {
    items: suggestedItems(suggest, source, types),
    emptyText: emptyTextOf(suggest.state, words),
    footer: <PullFooter state={suggest.state} words={words} start={start} />,
    unfiltered: source === 'indexes',
  }
}
