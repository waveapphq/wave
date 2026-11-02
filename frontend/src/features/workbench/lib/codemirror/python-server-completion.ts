/**
 * Python-mode completion source (PYRUN-19).
 *
 * Merges the WAVE expression catalog - with the blocked builtins unlocked,
 * because a script is not the sandboxed expression engine - with the answers of
 * the server-side python-tools endpoint, which are asked for only after a dot.
 */

import type {
  CompletionContext,
  Completion,
  CompletionResult,
  CompletionSection,
} from '@codemirror/autocomplete'

import {
  completePython,
  type PythonCompletionItem,
  type PythonCompletionRequest,
} from '@/features/workbench/api/python-tools'
import {
  createExpressionCompletionSource,
  createSectionHeader,
  type AvailableVariable,
} from './expression-completion'
import { createServerCompletionSource } from './server-completion'

// ============================================
// Sections
// ============================================

function sectionHeader(section: CompletionSection): HTMLElement {
  return createSectionHeader(section.name)
}

const VARIABLES_SECTION: CompletionSection = { name: 'Variables', rank: 0, header: sectionHeader }
const FUNCTIONS_SECTION: CompletionSection = { name: 'Functions', rank: 3, header: sectionHeader }
const MEMBERS_SECTION: CompletionSection = { name: 'Members', rank: 4, header: sectionHeader }

/** A `keyword` item has no entry: CodeMirror already offers the language keywords. */
const SERVER_KINDS: Record<string, { section: CompletionSection; type: string }> = {
  variable: { section: VARIABLES_SECTION, type: 'variable' },
  function: { section: FUNCTIONS_SECTION, type: 'function' },
  class: { section: FUNCTIONS_SECTION, type: 'class' },
  member: { section: MEMBERS_SECTION, type: 'property' },
  module: { section: MEMBERS_SECTION, type: 'namespace' },
}

// ============================================
// Server items
// ============================================

function infoFor(item: PythonCompletionItem): (() => Node) | undefined {
  const parts = [item.signature, item.doc].filter((part): part is string => part !== null)
  if (parts.length === 0) return undefined
  return () => {
    const dom = document.createElement('div')
    dom.className = 'cm-python-completion-info'
    for (const part of parts) {
      const paragraph = document.createElement('div')
      paragraph.textContent = part
      dom.appendChild(paragraph)
    }
    return dom
  }
}

function serverOption(item: PythonCompletionItem): Completion | null {
  const kind = SERVER_KINDS[item.kind]
  if (kind === undefined) return null
  return {
    label: item.label,
    type: kind.type,
    detail: item.signature ?? undefined,
    info: infoFor(item),
    section: kind.section,
  }
}

function serverOptions(items: PythonCompletionItem[]): Completion[] {
  const options: Completion[] = []
  for (const item of items) {
    const option = serverOption(item)
    if (option !== null) options.push(option)
  }
  return options
}

// ============================================
// Completion source
// ============================================

export function createPythonServerCompletionSource(
  variables: AvailableVariable[],
  interpreter: string
): (context: CompletionContext) => Promise<CompletionResult | null> {
  return createServerCompletionSource<PythonCompletionRequest>({
    catalog: createExpressionCompletionSource(variables, false, true, {
      includeBlockedBuiltins: true,
    }),
    // The server is asked only right after a dot.
    requestOf: ({ state, pos }, from) => {
      if (state.doc.sliceString(from - 1, from) !== '.') return null
      const line = state.doc.lineAt(pos)
      return { script: state.doc.toString(), line: line.number, column: pos - line.from, interpreter }
    },
    fetcher: async (body, signal) => ({ options: serverOptions((await completePython(body, signal)).items) }),
  })
}
