/**
 * The server completion skeleton every server-backed script body builds on (PYRUN-19, OS-12).
 */

import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'

/** What a server answers: its options and, with them, the span they replace. */
export interface ServerAnswer {
  options: Completion[]
  from?: number
  to?: number
}

export interface ServerCompletionOptions<Body> {
  /** The expression catalog, merged in front of the server's options. */
  catalog: (context: CompletionContext) => CompletionResult | null
  /** The request body at this position, or null to answer from the catalog alone. */
  requestOf: (context: CompletionContext, from: number) => Body | null
  fetcher: (body: Body, signal: AbortSignal) => Promise<ServerAnswer>
}

const REQUEST_DEBOUNCE_MS = 150
const WORD_CHAR = /\w/

function trailingWordLength(text: string): number {
  let length = 0
  while (length < text.length && WORD_CHAR.test(text[text.length - 1 - length])) {
    length += 1
  }
  return length
}

function resultOf(from: number, options: Completion[]): CompletionResult | null {
  return options.length > 0 ? { from, options } : null
}

function mergedResult(
  wordStart: number,
  catalogOptions: Completion[],
  answer: ServerAnswer,
): CompletionResult | null {
  const options = [...catalogOptions, ...answer.options]
  if (answer.options.length === 0 || answer.from === undefined) return resultOf(wordStart, options)
  return { from: answer.from, to: answer.to, options }
}

/** Settles with the server's options after the catalog's; a failed request settles with the catalog's alone. */
function settleWithAnswer(
  request: Promise<ServerAnswer>,
  from: number,
  catalogOptions: Completion[],
  resolve: (result: CompletionResult | null) => void,
): void {
  void request.then(
    (answer) => resolve(mergedResult(from, catalogOptions, answer)),
    () => resolve(resultOf(from, catalogOptions)),
  )
}

export function createServerCompletionSource<Body>(
  options: ServerCompletionOptions<Body>,
): (context: CompletionContext) => Promise<CompletionResult | null> {
  let cancelPending: (() => void) | null = null

  return (context: CompletionContext): Promise<CompletionResult | null> => {
    const before = context.state.doc.sliceString(0, context.pos)
    const from = context.pos - trailingWordLength(before)
    const catalog = options.catalog(context)
    const catalogOptions = catalog === null ? [] : catalog.options.slice()

    const superseded = cancelPending
    cancelPending = null
    superseded?.()

    const body = options.requestOf(context, from)
    if (body === null) return Promise.resolve(resultOf(from, catalogOptions))

    return new Promise<CompletionResult | null>((resolve) => {
      const controller = new AbortController()
      const timer = setTimeout(() => {
        settleWithAnswer(options.fetcher(body, controller.signal), from, catalogOptions, resolve)
      }, REQUEST_DEBOUNCE_MS)
      cancelPending = () => {
        clearTimeout(timer)
        controller.abort()
        resolve(null)
      }
    })
  }
}
