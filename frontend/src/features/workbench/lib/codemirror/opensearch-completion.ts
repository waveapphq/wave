/**
 * The suggestion source of the OpenSearch Query editor and a Custom (JSON) stat: the server's suggestions, the Get
 * fields row while nothing is loaded, and WAVE variables inside {{ }} (OS-12).
 *
 * REQ-3.3.2.6: OpenSearch query editor
 * REQ-5.1.2: OpenSearch connectivity
 */

import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSection,
} from '@codemirror/autocomplete'

import {
  suggestOpenSearch,
  type OpenSearchLanguage,
  type OpenSearchSuggestRequest,
  type OpenSearchSuggestion,
} from '@/features/workbench/api/opensearch-tools'
import {
  createSectionHeader,
  createTemplateCompletionSource,
  type AvailableVariable,
} from './expression-completion'
import { OPENSEARCH_GET_FIELDS_TYPE } from './dql-mode'
import { createServerCompletionSource, type ServerAnswer } from './server-completion'

export interface OpenSearchCompletionOptions {
  language: OpenSearchLanguage
  /** The job of the loaded fields; null while nothing is loaded. */
  fieldsJobId: string | null
  /** WAVE variables offered inside {{ }}. */
  variables: AvailableVariable[]
  /** The body is Template kind: {{ }} regions are expressions. */
  template: boolean
  /** The Get fields action row: starts (or joins) the fields pull; null offers no row. */
  onGetFields: (() => void) | null
}

/** Characters (code points) in the first `offset` UTF-16 code units of `text`. */
export function characterCount(text: string, offset: number): number {
  return Array.from(text.slice(0, offset)).length
}

/** The UTF-16 length of the `characters` characters (code points) of `text` from `start` on. */
export function codeUnitLength(text: string, start: number, characters: number): number {
  let units = 0
  let count = 0
  for (const character of text.slice(start)) {
    if (count === characters) break
    units += character.length
    count += 1
  }
  return units
}

const GET_FIELDS_LABEL = 'Get fields from the cluster'

function sectionHeader(section: CompletionSection): HTMLElement {
  return createSectionHeader(section.name)
}

const FIELDS_SECTION: CompletionSection = { name: 'Fields', header: sectionHeader }

type SuggestionKind = OpenSearchSuggestion['kind']

const KIND_TYPES: Readonly<Record<SuggestionKind, string>> = {
  field: 'property',
  key: 'property',
  operator: 'keyword',
  value: 'enum',
}

const KIND_SECTIONS: Readonly<Partial<Record<SuggestionKind, CompletionSection>>> = { field: FIELDS_SECTION }

function optionOf(item: OpenSearchSuggestion): Completion {
  return {
    label: item.label,
    type: KIND_TYPES[item.kind],
    detail: item.detail,
    info: item.info,
    section: KIND_SECTIONS[item.kind],
  }
}

/** One suggest request and the cursor it was asked at, in editor offsets. */
interface SuggestCall {
  request: OpenSearchSuggestRequest
  pos: number
}

const NO_CATALOG = (): CompletionResult | null => null

/** The cursor sits in a {{ with no }} after it. */
function insideOpenRegion(before: string): boolean {
  const open = before.lastIndexOf('{{')
  return open !== -1 && !before.includes('}}', open)
}

function getFieldsRowOf(onGetFields: () => void): Completion {
  return {
    label: GET_FIELDS_LABEL,
    type: OPENSEARCH_GET_FIELDS_TYPE,
    section: FIELDS_SECTION,
    apply: () => {
      onGetFields()
    },
  }
}

export function createOpenSearchCompletionSource(
  options: OpenSearchCompletionOptions,
): (context: CompletionContext) => Promise<CompletionResult | null> {
  const getFieldsRow = options.onGetFields === null ? null : getFieldsRowOf(options.onGetFields)

  const answerOf = async ({ request, pos }: SuggestCall, signal: AbortSignal): Promise<ServerAnswer> => {
    const answer = await suggestOpenSearch(request, signal)
    // With nothing loaded the server has no fields to offer, so the row that loads them stands in.
    if (getFieldsRow !== null && answer.items.length === 0 && request.fields_job_id === null) {
      return { options: [getFieldsRow], from: pos, to: pos }
    }
    const from = codeUnitLength(request.text, 0, answer.from)
    return {
      options: answer.items.map(optionOf),
      from,
      to: from + codeUnitLength(request.text, from, answer.to - answer.from),
    }
  }

  return createServerCompletionSource<SuggestCall>({
    catalog: options.template ? createTemplateCompletionSource(options.variables, true) : NO_CATALOG,
    // Inside an open {{ }} region only the WAVE variables apply.
    requestOf: ({ state, pos }) => {
      const text = state.doc.toString()
      if (options.template && insideOpenRegion(text.slice(0, pos))) return null
      return {
        pos,
        request: {
          language: options.language,
          text,
          cursor: characterCount(text, pos),
          template: options.template,
          fields_job_id: options.fieldsJobId,
        },
      }
    },
    fetcher: answerOf,
  })
}
