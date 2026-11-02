/**
 * Admin-disconnect flow: an administrator ended this session, so close the
 * Workbench (redirect to the dashboard) and announce it with a reconnect action.
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlugZap } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useWebSocketStore } from '@/features/workbench/stores/websocket-store'

// Where a terminated session lands once its Workbench closes.
const DISCONNECT_REDIRECT = '/dashboard'

export function AdminDisconnectDialog(): React.JSX.Element | null {
  const terminated = useWebSocketStore((state) => state.state === 'terminated')
  const navigate = useNavigate()

  useEffect(() => {
    if (terminated) navigate(DISCONNECT_REDIRECT)
  }, [terminated, navigate])

  if (!terminated) return null

  return (
    <AlertDialog open>
      <AlertDialogContent data-testid="admin-disconnect-dialog" className="max-w-md">
        <div className="flex justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/15">
            <PlugZap className="h-6 w-6 text-destructive" aria-hidden="true" />
          </span>
        </div>
        <AlertDialogTitle className="text-center">Session disconnected</AlertDialogTitle>
        <AlertDialogDescription className="text-center">
          An administrator disconnected this session. Reconnect to continue working.
        </AlertDialogDescription>
        <div className="flex justify-center pt-2">
          <Button onClick={() => globalThis.location.reload()}>Reconnect</Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
