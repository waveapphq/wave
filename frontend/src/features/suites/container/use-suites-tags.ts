/**
 * Suite tag universe (REQ-9.5.3.2) as a blocking read: a failed fetch blocks
 * the page and the blocked card's Try Again re-runs only this fetch.
 */

import { useEffect, useMemo, useState } from 'react'
import { useBlockingReads, type BlockingRead, type PrimaryState } from '@/hooks/use-blocking-reads'
import { fetchSuitesTags } from '@/features/suites/api/crud'

export function useSuitesTags(primary: PrimaryState): string[] {
  const [allTags, setAllTags] = useState<string[]>([])
  const blocking = useBlockingReads(primary)

  const tagReads = useMemo<BlockingRead[]>(
    () => [{ label: 'tags', run: async () => setAllTags(await fetchSuitesTags()) }],
    []
  )

  useEffect(() => {
    blocking.start(tagReads)
  }, [blocking, tagReads])

  return allTags
}
