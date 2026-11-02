/**
 * Reveals a row the user just appended: scrolls the grid to the bottom once the
 * new row has rendered, so Add never appears to do nothing on a scrolled list.
 */

import { useLayoutEffect, useRef } from 'react'

export function useScrollOnAppend(rowCount: number) {
  const listRef = useRef<HTMLDivElement>(null)
  const pendingRef = useRef(false)

  useLayoutEffect(() => {
    if (!pendingRef.current) return
    pendingRef.current = false
    const list = listRef.current
    // A list that does not overflow simply stays where it is.
    if (list) list.scrollTop = list.scrollHeight
  }, [rowCount])

  return {
    listRef,
    markAppended: () => {
      pendingRef.current = true
    },
  }
}
