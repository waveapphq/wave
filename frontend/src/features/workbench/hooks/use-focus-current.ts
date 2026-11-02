/**
 * useFocusCurrent - a Focus Current click handler bound to the current target.
 *
 * Returns a callback that navigates to the current block's Function level (if
 * needed) and centers on it, or does nothing when there is no current block.
 */

import { useCallback } from 'react'
import { focusCurrentBlock } from '@/features/workbench/lib/focus-current'

export function useFocusCurrent(target: string | null): () => void {
  return useCallback(() => {
    if (target !== null) focusCurrentBlock(target)
  }, [target])
}
