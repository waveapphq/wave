/**
 * Settings section read failure: alert icon, the API's reason and "Try Again".
 */

import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface SectionErrorProps {
  message: string
  onRetry: () => void
  'data-testid'?: string
}

export function SectionError({
  message,
  onRetry,
  'data-testid': testId,
}: Readonly<SectionErrorProps>) {
  return (
    <div
      data-testid={testId}
      role="alert"
      className="flex flex-col items-center justify-center py-8 text-center"
    >
      <AlertCircle className="mb-3 h-8 w-8 text-error" aria-hidden="true" />
      <p className="mb-3 text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try Again
      </Button>
    </div>
  )
}
