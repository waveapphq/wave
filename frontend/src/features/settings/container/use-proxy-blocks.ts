/**
 * useProxyBlocks (REQ-4.7.14, NET-10): reads which blocks follow the proxy each time the
 * Proxy Blocks page turns active. Nothing is staged.
 */

import { useState } from 'react'
import { fetchProxyBlocks, type ProxyBlocks } from '@/features/settings/api/proxy'
import {
  useActivationRead,
  type PageReadStatus,
} from '@/features/settings/container/use-activation-read'

export interface UseProxyBlocksResult {
  status: PageReadStatus
  error?: string
  blocks?: ProxyBlocks
  retry: () => void
}

export function useProxyBlocks(active: boolean): UseProxyBlocksResult {
  const [blocks, setBlocks] = useState<ProxyBlocks | undefined>()
  // The page holds no edits, so every activation reads.
  const { status, error, retry } = useActivationRead(active, false, fetchProxyBlocks, setBlocks)
  return { status, error, blocks, retry }
}
