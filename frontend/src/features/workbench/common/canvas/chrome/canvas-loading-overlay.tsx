/**
 * CanvasLoadingOverlay - REQ-3.1.1.12.1, REQ-3.1.1.12.3
 *
 * Loading overlay that covers the canvas area during test fetch
 * and canvas preparation. Shows a spinner and contextual message,
 * then fades out smoothly when the canvas is ready.
 */

import { Loader2 } from 'lucide-react'

interface CanvasLoadingOverlayProps {
  isReady: boolean
  message: string
}

export function CanvasLoadingOverlay({ isReady, message }: Readonly<CanvasLoadingOverlayProps>) {
  return (
    <div
      data-testid="canvas-loading-overlay"
      className={`absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-card transition-opacity duration-200 ease-out ${
        isReady ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={isReady ? undefined : { transitionDuration: '0ms' }}
    >
      <div data-testid="canvas-loading-spinner" className="h-10 w-10 animate-spin">
        <Loader2 className="h-full w-full text-muted-foreground" />
      </div>
      {message && (
        <span className="text-sm text-muted-foreground">{message}</span>
      )}
    </div>
  )
}
