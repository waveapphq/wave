/**
 * Query DSL CodeMirror bundle for the OpenSearch Query row and a Custom (JSON) stat: JSON in both kinds (OS-7, OS-12).
 *
 * REQ-3.3.2.6: OpenSearch query editor
 * REQ-3.3.3.2: OpenSearch statistics
 */

import { json } from '@codemirror/lang-json'
import type { Extension } from '@codemirror/state'

import { buildQueryBodyExtensions, type DqlModeOptions } from '@/features/workbench/lib/codemirror/dql-mode'

export type QueryDslModeOptions = DqlModeOptions

// No parse linter: the server check reports JSON findings as warnings, never red.
const jsonLanguage = json()

export function buildQueryDslModeExtensions(options: QueryDslModeOptions): Extension[] {
  return buildQueryBodyExtensions(jsonLanguage, options)
}
