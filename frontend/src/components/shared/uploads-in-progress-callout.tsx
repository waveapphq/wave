/**
 * Amber warning row the close and switch dialogs render while a test's files
 * are still arriving (TDATA-14). Single source of the pinned copy; renders
 * nothing when count < 1.
 */

import { AlertTriangle } from 'lucide-react'

export interface UploadsInProgressCalloutProps {
  count: number
}

export function UploadsInProgressCallout({ count }: Readonly<UploadsInProgressCalloutProps>) {
  if (count < 1) return null
  const subject = count === 1 ? 'upload is' : 'uploads are'
  const object = count === 1 ? 'it' : 'them'
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-left text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <p>
        <span className="font-semibold">
          {count} test data {subject} still going.
        </span>{' '}
        <span className="text-muted-foreground">
          Leaving this test does not stop {object}; closing the tab does.
        </span>
      </p>
    </div>
  )
}
