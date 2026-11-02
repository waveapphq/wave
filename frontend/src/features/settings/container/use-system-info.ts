/**
 * useSystemInfo Hook (REQ-5.2.1.42, SETTINGS-16)
 *
 * Reads the system info the About section shows.
 */

import { useCallback, useState } from 'react'
import { fetchSystemInfo, type SystemInfo } from '@/features/settings/api/system-info'

export interface UseSystemInfoResult {
  systemInfo?: SystemInfo
  systemInfoLoading: boolean
  systemInfoError?: string
  loadSystemInfo: () => Promise<void>
}

export function useSystemInfo(): UseSystemInfoResult {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | undefined>()
  const [systemInfoLoading, setSystemInfoLoading] = useState(false)
  const [systemInfoError, setSystemInfoError] = useState<string | undefined>()

  const loadSystemInfo = useCallback(async () => {
    setSystemInfoLoading(true)
    setSystemInfoError(undefined)
    try {
      setSystemInfo(await fetchSystemInfo())
    } catch (err) {
      setSystemInfoError(err instanceof Error ? err.message : 'Failed to load system info')
    } finally {
      setSystemInfoLoading(false)
    }
  }, [])

  return { systemInfo, systemInfoLoading, systemInfoError, loadSystemInfo }
}
