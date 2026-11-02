/** Owner-side handle on the page block; a block dies with the owner that raised it. */

import { useEffect, useMemo, useState } from 'react'
import { randomUUID } from '@/lib/uuid'
import { usePageBlockStore, type FailedRead } from '@/stores/page-block-store'

export function usePageBlock(): {
  blockPage: (failure: FailedRead) => void
  clearPageBlock: (label?: string) => void
} {
  const [owner] = useState(randomUUID)
  const setBlock = usePageBlockStore((state) => state.setBlock)
  const clearBlock = usePageBlockStore((state) => state.clearBlock)
  const registerOwner = usePageBlockStore((state) => state.registerOwner)
  const retireOwner = usePageBlockStore((state) => state.retireOwner)

  useEffect(() => {
    registerOwner(owner)
    return () => retireOwner(owner)
  }, [owner, registerOwner, retireOwner])

  return useMemo(
    () => ({
      blockPage: (failure: FailedRead) => setBlock({ ...failure, owner }),
      clearPageBlock: (label?: string) => clearBlock(owner, label),
    }),
    [owner, setBlock, clearBlock]
  )
}
