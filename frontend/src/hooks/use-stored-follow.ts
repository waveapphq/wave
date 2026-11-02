import { useState } from 'react'
import { sameStored } from '@/lib/draft-follow'

/** Calls `follow(base, next)` while rendering, once each time a stored field changes by content. */
export function useStoredFollow<T extends Record<string, unknown>>(
  stored: T,
  follow: (base: T, next: T) => void,
): void {
  const [followed, setFollowed] = useState(stored)
  if (Object.keys(stored).some((key) => !sameStored(followed[key], stored[key]))) {
    setFollowed(stored)
    follow(followed, stored)
  }
}
