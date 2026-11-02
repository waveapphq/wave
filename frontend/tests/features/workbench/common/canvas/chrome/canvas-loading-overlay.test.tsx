/**
 * CanvasLoadingOverlay Tests - REQ-3.1.1.12.1, REQ-3.1.1.12.3
 *
 * Tests for the loading overlay component that covers the canvas area
 * during test fetch and canvas preparation. The overlay provides visual
 * feedback with a spinner and contextual message, then transitions out
 * smoothly when the canvas is ready.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// The component under test (will be created during implementation)
// Expected path: @/features/workbench/common/canvas/chrome/canvas-loading-overlay
// Props: { isReady: boolean; message: string }

describe('CanvasLoadingOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('REQ-3.1.1.12.1: Loading overlay structure', () => {
    it('renders overlay with spinner and message when not ready', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={false} message="Loading test…" />)

      const overlay = screen.getByTestId('canvas-loading-overlay')
      expect(overlay).toBeInTheDocument()

      // Spinner should be visible (Loader2 icon with animate-spin)
      const spinner = screen.getByTestId('canvas-loading-spinner')
      expect(spinner).toBeInTheDocument()

      // Message should display the contextual text
      expect(screen.getByText('Loading test…')).toBeInTheDocument()
    })

    it('shows "Loading test…" message for test fetch scenario', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={false} message="Loading test…" />)

      expect(screen.getByText('Loading test…')).toBeInTheDocument()
    })

    it('shows "Preparing workbench…" message for draft/blank scenario', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={false} message="Preparing workbench…" />)

      expect(screen.getByText('Preparing workbench…')).toBeInTheDocument()
    })

    it('renders spinner at large size (40px - h-10 w-10)', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={false} message="Loading test…" />)

      const spinner = screen.getByTestId('canvas-loading-spinner')
      // Spinner should have h-10 w-10 classes (40px per Tailwind)
      expect(spinner.className).toMatch(/\bh-10\b/)
      expect(spinner.className).toMatch(/\bw-10\b/)
    })

    it('renders spinner with animate-spin class', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={false} message="Loading test…" />)

      const spinner = screen.getByTestId('canvas-loading-spinner')
      expect(spinner.className).toMatch(/\banimate-spin\b/)
    })

    it('renders message with muted text color (text-muted-foreground)', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={false} message="Loading test…" />)

      const message = screen.getByText('Loading test…')
      expect(message.className).toMatch(/\btext-muted-foreground\b/)
    })

    it('renders message with small text size (text-sm)', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={false} message="Loading test…" />)

      const message = screen.getByText('Loading test…')
      expect(message.className).toMatch(/\btext-sm\b/)
    })

    it('positions overlay absolutely to fill canvas panel', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={false} message="Loading test…" />)

      const overlay = screen.getByTestId('canvas-loading-overlay')
      // Should be absolutely positioned to fill its container
      expect(overlay.className).toMatch(/\babsolute\b/)
      expect(overlay.className).toMatch(/\binset-0\b/)
    })

    it('centers spinner and message within overlay', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={false} message="Loading test…" />)

      const overlay = screen.getByTestId('canvas-loading-overlay')
      // Should use flex centering
      expect(overlay.className).toMatch(/\bflex\b/)
      expect(overlay.className).toMatch(/\bitems-center\b/)
      expect(overlay.className).toMatch(/\bjustify-center\b/)
    })

    it('uses bg-card for overlay backdrop', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={false} message="Loading test…" />)

      const overlay = screen.getByTestId('canvas-loading-overlay')
      // Design doc specifies --color-bg-card at high opacity
      expect(overlay.className).toMatch(/\bbg-card\b/)
    })

    it('renders overlay at high z-index to sit above canvas content', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={false} message="Loading test…" />)

      const overlay = screen.getByTestId('canvas-loading-overlay')
      // Should have z-index to layer above React Flow content
      expect(overlay.className).toMatch(/\bz-/)
    })

    it('has spacing between spinner and message (gap-3)', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={false} message="Loading test…" />)

      const overlay = screen.getByTestId('canvas-loading-overlay')
      // Design doc: space-3 (12px) between spinner and message
      expect(overlay.className).toMatch(/\bgap-3\b/)
    })
  })

  describe('REQ-3.1.1.12.3: Smooth transition from loading to ready', () => {
    it('applies opacity-0 and pointer-events-none when ready', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={true} message="Loading test…" />)

      const overlay = screen.getByTestId('canvas-loading-overlay')
      // When ready, overlay should fade out (opacity-0) and be non-interactive
      expect(overlay.className).toMatch(/\bopacity-0\b/)
      expect(overlay.className).toMatch(/\bpointer-events-none\b/)
    })

    it('applies opacity-100 when not ready', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={false} message="Loading test…" />)

      const overlay = screen.getByTestId('canvas-loading-overlay')
      expect(overlay.className).toMatch(/\bopacity-100\b/)
    })

    it('has 200ms transition duration for crossfade', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={false} message="Loading test…" />)

      const overlay = screen.getByTestId('canvas-loading-overlay')
      // Design: 200ms crossfade
      expect(overlay.className).toMatch(/\btransition-opacity\b/)
      expect(overlay.className).toMatch(/\bduration-200\b/)
    })

    it('uses ease-out timing function', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={false} message="Loading test…" />)

      const overlay = screen.getByTestId('canvas-loading-overlay')
      expect(overlay.className).toMatch(/\bease-out\b/)
    })
  })

  describe('REQ-3.1.1.12.3: Reduced motion support', () => {
    it('renders correctly regardless of motion preference (CSS handles it)', async () => {
      // Reduced motion is handled via CSS media query, not JS state.
      // The component always applies transition classes; the browser
      // respects prefers-reduced-motion to disable animation.
      // This test verifies the component renders without errors
      // and has the transition classes that CSS can override.
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )

      const { container } = render(
        <CanvasLoadingOverlay isReady={false} message="Loading test…" />
      )
      expect(container).toBeInTheDocument()

      // Transition classes are present (CSS @media handles reduced motion)
      const overlay = screen.getByTestId('canvas-loading-overlay')
      expect(overlay.className).toMatch(/\btransition-opacity\b/)
    })
  })

  describe('Edge cases', () => {
    it('renders with empty message string', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      render(<CanvasLoadingOverlay isReady={false} message="" />)

      const overlay = screen.getByTestId('canvas-loading-overlay')
      expect(overlay).toBeInTheDocument()
      // Spinner should still be visible even without message
      expect(screen.getByTestId('canvas-loading-spinner')).toBeInTheDocument()
    })

    it('toggles from not-ready to ready (simulating load completion)', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      const { rerender } = render(
        <CanvasLoadingOverlay isReady={false} message="Loading test…" />
      )

      // Initially visible
      let overlay = screen.getByTestId('canvas-loading-overlay')
      expect(overlay.className).toMatch(/\bopacity-100\b/)

      // Transition to ready
      rerender(<CanvasLoadingOverlay isReady={true} message="Loading test…" />)

      overlay = screen.getByTestId('canvas-loading-overlay')
      expect(overlay.className).toMatch(/\bopacity-0\b/)
      expect(overlay.className).toMatch(/\bpointer-events-none\b/)
    })

    it('can change message while loading', async () => {
      const { CanvasLoadingOverlay } = await import(
        '@/features/workbench/common/canvas/chrome/canvas-loading-overlay'
      )
      const { rerender } = render(
        <CanvasLoadingOverlay isReady={false} message="Loading test…" />
      )

      expect(screen.getByText('Loading test…')).toBeInTheDocument()

      rerender(
        <CanvasLoadingOverlay isReady={false} message="Preparing workbench…" />
      )

      expect(screen.getByText('Preparing workbench…')).toBeInTheDocument()
      expect(screen.queryByText('Loading test…')).not.toBeInTheDocument()
    })
  })
})
