/**
 * Connection Status Banner
 *
 * Compact bottom-right pill that surfaces a BE outage without covering
 * page content. A pulsing dot signals the active probe loop; the
 * "Retry" button fires an immediate /health probe.
 */

import { WifiOff } from 'lucide-react'
import {
  useConnectionStatus,
  requestRetry,
} from '@/services/connection-monitor'
import { Button } from '@/components/ui/button'

export function ConnectionStatusBanner(): React.JSX.Element | null {
  const status = useConnectionStatus()
  if (status === 'online') return null

  return (
    <output
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[100] flex items-center gap-3 rounded-full border border-destructive/30 bg-background/95 px-4 py-2 text-sm shadow-lg backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-300"
    >
      <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
      </span>
      <WifiOff className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <span className="text-foreground">Backend offline. Reconnecting…</span>
      <Button
        variant="outline"
        size="sm"
        onClick={requestRetry}
        className="h-7 rounded-full px-3 text-xs"
      >
        Retry
      </Button>
    </output>
  )
}
