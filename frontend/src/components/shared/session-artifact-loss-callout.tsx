/**
 * Amber warning row rendered by session-teardown dialogs (reset / close /
 * switch / new-test) when the live workbench session holds artifacts.
 * Single source of the pinned copy; renders nothing when count < 1.
 */

import { AlertTriangle } from 'lucide-react'

export interface SessionArtifactLossCalloutProps {
  count: number
}

export function SessionArtifactLossCallout({
  count,
}: Readonly<SessionArtifactLossCalloutProps>) {
  if (count < 1) return null
  const noun = count === 1 ? 'session artifact' : 'session artifacts'
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-left text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <p>
        <span className="font-semibold">
          {count} {noun} will be permanently deleted.
        </span>{' '}
        <span className="text-muted-foreground">
          Download anything you need from the Artifacts panel first.
        </span>
      </p>
    </div>
  )
}
