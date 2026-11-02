/**
 * useDebouncedParse - one parse request 300 ms after the text stops changing, with responses
 * for an older text ignored; a blank text asks nothing and forgets the last outcome.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { toFailureDetail } from '@/lib/failure-detail'

const PARSE_DELAY_MS = 300

export type DebouncedParseStatus = 'idle' | 'pending' | 'done' | 'failed'

export interface DebouncedParse<R> {
  status: DebouncedParseStatus
  result?: R
  /** The last successful result, kept while a newer parse is pending or failed. */
  lastGoodResult?: R
  error?: string
  /** Records the result of a text so no request is made for it. */
  prime: (text: string, result: R) => void
}

type Settled<R> =
  | { text: string; status: 'done'; result: R }
  | { text: string; status: 'failed'; error: string }

function isBlank(text: string): boolean {
  return text.trim() === ''
}

export function useDebouncedParse<R>(
  text: string,
  parse: (text: string) => Promise<R>,
): DebouncedParse<R> {
  const [settled, setSettled] = useState<Settled<R> | undefined>()
  const [lastGoodResult, setLastGoodResult] = useState<R | undefined>()
  // Each request and each prime takes a new token; a response counts only while its token is the latest.
  const tokenRef = useRef(0)
  // The text whose successful result is on screen, so going back to it needs no request.
  const doneTextRef = useRef<string | undefined>(undefined)
  const parseRef = useRef(parse)

  useEffect(() => {
    parseRef.current = parse
  }, [parse])

  useEffect(() => {
    tokenRef.current += 1
    if (isBlank(text)) {
      // A blank text forgets the last outcome, so it cannot show again under the next text.
      doneTextRef.current = undefined
      setSettled(undefined)
      setLastGoodResult(undefined)
      return undefined
    }
    if (doneTextRef.current === text) return undefined
    const token = tokenRef.current
    const timer = setTimeout(() => {
      parseRef.current(text).then(
        (result) => {
          if (tokenRef.current !== token) return
          doneTextRef.current = text
          setSettled({ text, status: 'done', result })
          setLastGoodResult(result)
        },
        (error: unknown) => {
          if (tokenRef.current !== token) return
          doneTextRef.current = undefined
          setSettled({ text, status: 'failed', error: toFailureDetail(error).message })
        },
      )
    }, PARSE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text])

  const prime = useCallback((primedText: string, result: R) => {
    tokenRef.current += 1
    doneTextRef.current = primedText
    setSettled({ text: primedText, status: 'done', result })
    setLastGoodResult(result)
  }, [])

  if (isBlank(text)) return { status: 'idle', prime }
  // While a newer text waits, the last settled outcome stays on screen.
  const status = settled?.text === text ? settled.status : 'pending'
  return {
    status,
    result: settled?.status === 'done' ? settled.result : undefined,
    lastGoodResult,
    error: settled?.status === 'failed' ? settled.error : undefined,
    prime,
  }
}
