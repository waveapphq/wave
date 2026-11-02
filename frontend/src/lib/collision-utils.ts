import type { ApiError } from '@/services/api-client/types'

export function extractCollisions<T>(err: unknown): T[] | null {
  const apiErr = err as ApiError | undefined
  const details = apiErr?.details as unknown as { collisions?: T[] } | undefined
  return details?.collisions?.length ? details.collisions : null
}
