/**
 * Drag Preview Tests - REQ-3.1.1.1 Drag-and-drop interface for block arrangement
 *
 * Tests for the drag preview component that provides visual feedback during
 * drag operations. The preview follows the cursor with specific visual properties.
 *
 * Drag Visual Feedback Requirements:
 * - Dragged element follows cursor with slight offset
 * - Opacity reduction (50%)
 * - Subtle scale increase (1.02×)
 * - Cursor changes to grabbing during drags
 * - Cursor indicates not-allowed over invalid targets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock viewport position
const mockViewport = {
  clientX: 200,
  clientY: 150,
}

describe('DragPreview Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset cursor position
    mockViewport.clientX = 200
    mockViewport.clientY = 150
  })

  describe('Visual Properties', () => {
    it('renders with 50% opacity as specified in design system', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={true}
          position={{ x: 100, y: 100 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
        />
      )

      const preview = screen.getByTestId('drag-preview')
      expect(preview).toHaveStyle({ opacity: '0.5' })
    })

    it('renders with 1.02 scale as specified in design system', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={true}
          position={{ x: 100, y: 100 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
        />
      )

      const preview = screen.getByTestId('drag-preview')
      // Check transform includes scale(1.02) - use style property directly as toHaveStyle doesn't support asymmetric matchers
      expect(preview.style.transform).toContain('scale(1.02)')
    })

    it('is positioned at cursor location with offset', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={true}
          position={{ x: 200, y: 150 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
        />
      )

      const preview = screen.getByTestId('drag-preview')
      // Preview should be positioned near cursor (exact offset may vary)
      expect(preview).toHaveStyle({ position: 'fixed' })
      // Should have transform with translate
      expect(preview.style.transform).toContain('translate')
    })

    it('is not rendered when isDragging is false', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={false}
          position={{ x: 100, y: 100 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
        />
      )

      expect(screen.queryByTestId('drag-preview')).not.toBeInTheDocument()
    })

    it('displays block icon and name', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={true}
          position={{ x: 100, y: 100 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
        />
      )

      const preview = screen.getByTestId('drag-preview')
      expect(preview).toHaveTextContent('Shell Script')
      expect(screen.getByTestId('drag-preview-icon')).toBeInTheDocument()
    })

    it('has pointer-events: none to not interfere with drop detection', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={true}
          position={{ x: 100, y: 100 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
        />
      )

      const preview = screen.getByTestId('drag-preview')
      expect(preview).toHaveStyle({ pointerEvents: 'none' })
    })

    it('has high z-index to appear above other elements', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={true}
          position={{ x: 100, y: 100 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
        />
      )

      const preview = screen.getByTestId('drag-preview')
      const zIndex = parseInt(window.getComputedStyle(preview).zIndex, 10)
      expect(zIndex).toBeGreaterThanOrEqual(1000)
    })
  })

  describe('Position Tracking', () => {
    it('updates position as cursor moves', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      const { rerender } = render(
        <DragPreview
          isDragging={true}
          position={{ x: 100, y: 100 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
        />
      )

      const preview = screen.getByTestId('drag-preview')
      const initialTransform = preview.style.transform

      // Update position
      rerender(
        <DragPreview
          isDragging={true}
          position={{ x: 250, y: 300 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
        />
      )

      expect(preview.style.transform).not.toBe(initialTransform)
    })

    it('applies cursor offset to prevent preview from being under cursor', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={true}
          position={{ x: 100, y: 100 }}
          cursorOffset={{ x: 10, y: 10 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
        />
      )

      const preview = screen.getByTestId('drag-preview')
      // Transform should include offset
      expect(preview.style.transform).toContain('translate')
    })
  })

  describe('Invalid Target Indication', () => {
    it('changes appearance when over invalid drop target', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={true}
          position={{ x: 100, y: 100 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
          isOverInvalidTarget={true}
        />
      )

      const preview = screen.getByTestId('drag-preview')
      expect(preview).toHaveAttribute('data-invalid-target', 'true')
    })

    it('displays not-allowed indicator icon when over invalid target', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={true}
          position={{ x: 100, y: 100 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
          isOverInvalidTarget={true}
        />
      )

      expect(screen.getByTestId('invalid-drop-indicator')).toBeInTheDocument()
    })

    it('reduces opacity further when over invalid target', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={true}
          position={{ x: 100, y: 100 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
          isOverInvalidTarget={true}
        />
      )

      const preview = screen.getByTestId('drag-preview')
      // Should be more transparent when invalid
      const opacity = parseFloat(window.getComputedStyle(preview).opacity)
      expect(opacity).toBeLessThan(0.5)
    })

    it('shows not-allowed cursor style when over invalid target', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={true}
          position={{ x: 100, y: 100 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
          isOverInvalidTarget={true}
        />
      )

      const preview = screen.getByTestId('drag-preview')
      expect(preview).toHaveStyle({ cursor: 'not-allowed' })
    })
  })

  describe('Block Type Styling', () => {
    it('applies correct styling for control flow blocks', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={true}
          position={{ x: 100, y: 100 }}
          blockData={{
            id: 'if-else',
            name: 'If/Else',
            icon: 'git-branch',
            type: 'control',
          }}
        />
      )

      const preview = screen.getByTestId('drag-preview')
      expect(preview).toHaveAttribute('data-block-type', 'control')
    })

    it('applies correct styling for parallel branch blocks', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={true}
          position={{ x: 100, y: 100 }}
          blockData={{
            id: 'parallel',
            name: 'Parallel',
            icon: 'git-fork',
            type: 'parallel',
          }}
        />
      )

      const preview = screen.getByTestId('drag-preview')
      expect(preview).toHaveAttribute('data-block-type', 'parallel')
    })

    it('applies correct styling for error handler blocks', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={true}
          position={{ x: 100, y: 100 }}
          blockData={{
            id: 'try-catch-finally',
            name: 'Try/Catch',
            icon: 'shield',
            type: 'error-handler',
          }}
        />
      )

      const preview = screen.getByTestId('drag-preview')
      expect(preview).toHaveAttribute('data-block-type', 'error-handler')
    })
  })

  describe('Reduced Motion Support', () => {
    it('disables animations when prefers-reduced-motion is set', async () => {
      // Mock matchMedia to return reduced motion preference
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))

      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={true}
          position={{ x: 100, y: 100 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
        />
      )

      const preview = screen.getByTestId('drag-preview')
      // Should not have scale transform when reduced motion is preferred
      expect(preview.style.transform).not.toContain('scale')
    })
  })

  describe('Accessibility', () => {
    it('has aria-hidden since it is decorative', async () => {
      const { DragPreview } = await import(
        '@/features/workbench/common/canvas/chrome/drag-preview'
      )
      render(
        <DragPreview
          isDragging={true}
          position={{ x: 100, y: 100 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
        />
      )

      const preview = screen.getByTestId('drag-preview')
      expect(preview).toHaveAttribute('aria-hidden', 'true')
    })
  })
})


describe('DragPreviewPortal', () => {
  it('renders preview in a portal outside the component tree', async () => {
    const { DragPreviewPortal } = await import(
      '@/features/workbench/common/canvas/chrome/drag-preview'
    )
    render(
      <div data-testid="parent">
        <DragPreviewPortal
          isDragging={true}
          position={{ x: 100, y: 100 }}
          blockData={{ id: 'shell-script', name: 'Shell Script', icon: 'terminal' }}
        />
      </div>
    )

    const parent = screen.getByTestId('parent')
    const preview = screen.getByTestId('drag-preview')

    // Preview should not be a child of parent
    expect(parent).not.toContainElement(preview)
    // Preview should be in document.body
    expect(document.body).toContainElement(preview)
  })
})

describe('DragPreview Icon Fallback', () => {
  it('renders fallback icon for unknown icon type', async () => {
    const { DragPreview } = await import(
      '@/features/workbench/common/canvas/chrome/drag-preview'
    )
    render(
      <DragPreview
        isDragging={true}
        position={{ x: 100, y: 100 }}
        blockData={{ id: 'test', name: 'Test', icon: 'unknown-icon-type' }}
      />
    )

    const iconElement = screen.getByTestId('drag-preview-icon')
    expect(iconElement).toHaveTextContent('●')
  })
})
