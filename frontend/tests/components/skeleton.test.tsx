/**
 * Skeleton Component Tests
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 * REQ-5.2.1.20: Loading skeletons and spinners
 *
 * Tests for Skeleton component following design system specifications.
 *
 * Skeleton specifications:
 * - Base background: --color-bg-muted
 * - Shimmer highlight: --color-bg-subtle
 * - Border radius: text=4px (rounded), card=8px (rounded-lg), circular=full
 * - Shimmer animation: 1500ms duration, ease-in-out timing, infinite
 * - Shimmer highlight band: ~40% of skeleton width
 * - Variants: Text (14-16px height), Circular, Rectangular, Custom
 * - Reduced motion: static placeholder without shimmer animation
 * - Loading state transitions: 150ms crossfade when content loads
 * - Error state: if loading fails, transition to error state with error styling
 *   (stops shimmer, applies error colors from semantic palette)
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  Skeleton,
  SkeletonText,
  SkeletonCircle,
  SkeletonCard,
  SkeletonParagraph,
} from '@/components/ui/skeleton'

describe('Skeleton Component', () => {
  describe('Basic Rendering', () => {
    it('renders skeleton element', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toBeInTheDocument()
    })

    it('renders as div element by default', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton').tagName.toLowerCase()).toBe('div')
    })

    it('applies skeleton base class', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('skeleton')
    })

    it('has aria-hidden for accessibility (decorative element)', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true')
    })
  })

  describe('Visual Styling', () => {
    it('applies bg-muted background color', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('bg-muted')
    })

    it('applies rounded border radius by default (4px)', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('rounded')
    })

    it('applies overflow-hidden for shimmer containment', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('overflow-hidden')
    })

    it('has relative positioning for shimmer overlay', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('relative')
    })
  })

  describe('Shimmer Animation', () => {
    it('applies shimmer animation class', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('animate-shimmer')
    })

    it('has animation duration of 1500ms', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('duration-1500')
    })

    it('has ease-in-out timing function', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('ease-in-out')
    })

    it('indicates infinite animation via animate-shimmer class', () => {
      render(<Skeleton data-testid="skeleton" />)
      // animate-shimmer implies infinite animation
      expect(screen.getByTestId('skeleton')).toHaveClass('animate-shimmer')
    })

    it('has shimmer gradient overlay element', () => {
      render(<Skeleton data-testid="skeleton" />)
      const skeleton = screen.getByTestId('skeleton')
      const shimmer = skeleton.querySelector('[data-skeleton-shimmer]')
      expect(shimmer).toBeInTheDocument()
    })

    it('shimmer uses bg-subtle gradient', () => {
      render(<Skeleton data-testid="skeleton" />)
      const skeleton = screen.getByTestId('skeleton')
      const shimmer = skeleton.querySelector('[data-skeleton-shimmer]')
      expect(shimmer).toHaveClass('bg-gradient-to-r')
    })

    it('shimmer spans full width as pseudo-element or child', () => {
      render(<Skeleton data-testid="skeleton" />)
      const skeleton = screen.getByTestId('skeleton')
      const shimmer = skeleton.querySelector('[data-skeleton-shimmer]')
      expect(shimmer).toHaveClass('absolute')
      expect(shimmer).toHaveClass('inset-0')
    })
  })

  describe('Reduced Motion Support', () => {
    it('applies motion-reduce class to disable animation', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('motion-reduce:animate-none')
    })

    it('shimmer is hidden with reduced motion preference', () => {
      render(<Skeleton data-testid="skeleton" />)
      const skeleton = screen.getByTestId('skeleton')
      const shimmer = skeleton.querySelector('[data-skeleton-shimmer]')
      expect(shimmer).toHaveClass('motion-reduce:hidden')
    })
  })

  describe('Size Props', () => {
    it('applies custom width', () => {
      render(<Skeleton width="200px" data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveStyle({ width: '200px' })
    })

    it('applies custom height', () => {
      render(<Skeleton height="40px" data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveStyle({ height: '40px' })
    })

    it('supports numeric width values', () => {
      render(<Skeleton width={100} data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveStyle({ width: '100px' })
    })

    it('supports numeric height values', () => {
      render(<Skeleton height={50} data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveStyle({ height: '50px' })
    })

    it('supports percentage width', () => {
      render(<Skeleton width="50%" data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveStyle({ width: '50%' })
    })

    it('defaults to 100% width when not specified', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('w-full')
    })

    it('defaults to 16px height when not specified', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('h-4')
    })
  })

  describe('Border Radius Variants', () => {
    it('applies rounded (4px) by default', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('rounded')
    })

    it('applies rounded-lg (8px) for card variant', () => {
      render(<Skeleton variant="card" data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('rounded-lg')
    })

    it('applies rounded-full for circular variant', () => {
      render(<Skeleton variant="circular" data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('rounded-full')
    })

    it('applies rounded-none when radius="none"', () => {
      render(<Skeleton radius="none" data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('rounded-none')
    })

    it('applies custom radius prop', () => {
      render(<Skeleton radius="lg" data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('rounded-lg')
    })
  })

  describe('Custom Styling', () => {
    it('applies additional className', () => {
      render(<Skeleton className="custom-class" data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('custom-class')
    })

    it('merges className with base classes', () => {
      render(<Skeleton className="custom-class" data-testid="skeleton" />)
      const skeleton = screen.getByTestId('skeleton')
      expect(skeleton).toHaveClass('skeleton')
      expect(skeleton).toHaveClass('custom-class')
    })

    it('passes through additional HTML attributes', () => {
      render(<Skeleton data-custom="value" id="custom-id" data-testid="skeleton" />)
      const skeleton = screen.getByTestId('skeleton')
      expect(skeleton).toHaveAttribute('data-custom', 'value')
      expect(skeleton).toHaveAttribute('id', 'custom-id')
    })
  })
})

describe('SkeletonText Component', () => {
  describe('Basic Rendering', () => {
    it('renders skeleton text element', () => {
      render(<SkeletonText data-testid="skeleton-text" />)
      expect(screen.getByTestId('skeleton-text')).toBeInTheDocument()
    })

    it('applies skeleton-text class', () => {
      render(<SkeletonText data-testid="skeleton-text" />)
      expect(screen.getByTestId('skeleton-text')).toHaveClass('skeleton-text')
    })

    it('has default height of 14-16px for text lines', () => {
      render(<SkeletonText data-testid="skeleton-text" />)
      // Design system specifies 14-16px for text skeleton height
      const skeleton = screen.getByTestId('skeleton-text')
      expect(skeleton).toHaveClass('h-4')
    })

    it('applies rounded border radius (4px)', () => {
      render(<SkeletonText data-testid="skeleton-text" />)
      expect(screen.getByTestId('skeleton-text')).toHaveClass('rounded')
    })
  })

  describe('Width Variations', () => {
    it('supports full width by default', () => {
      render(<SkeletonText data-testid="skeleton-text" />)
      expect(screen.getByTestId('skeleton-text')).toHaveClass('w-full')
    })

    it('supports custom width for simulating varying text line lengths', () => {
      render(<SkeletonText width="75%" data-testid="skeleton-text" />)
      expect(screen.getByTestId('skeleton-text')).toHaveStyle({ width: '75%' })
    })

    it('supports preset width "short" (40%)', () => {
      render(<SkeletonText preset="short" data-testid="skeleton-text" />)
      expect(screen.getByTestId('skeleton-text')).toHaveClass('w-2/5')
    })

    it('supports preset width "medium" (60%)', () => {
      render(<SkeletonText preset="medium" data-testid="skeleton-text" />)
      expect(screen.getByTestId('skeleton-text')).toHaveClass('w-3/5')
    })

    it('supports preset width "long" (80%)', () => {
      render(<SkeletonText preset="long" data-testid="skeleton-text" />)
      expect(screen.getByTestId('skeleton-text')).toHaveClass('w-4/5')
    })
  })
})

describe('SkeletonCircle Component', () => {
  describe('Basic Rendering', () => {
    it('renders skeleton circle element', () => {
      render(<SkeletonCircle data-testid="skeleton-circle" />)
      expect(screen.getByTestId('skeleton-circle')).toBeInTheDocument()
    })

    it('applies skeleton-circle class', () => {
      render(<SkeletonCircle data-testid="skeleton-circle" />)
      expect(screen.getByTestId('skeleton-circle')).toHaveClass('skeleton-circle')
    })

    it('applies rounded-full for circular shape', () => {
      render(<SkeletonCircle data-testid="skeleton-circle" />)
      expect(screen.getByTestId('skeleton-circle')).toHaveClass('rounded-full')
    })
  })

  describe('Size Presets', () => {
    it('applies small size (32px)', () => {
      render(<SkeletonCircle size="sm" data-testid="skeleton-circle" />)
      const circle = screen.getByTestId('skeleton-circle')
      expect(circle).toHaveClass('w-8')
      expect(circle).toHaveClass('h-8')
    })

    it('applies medium size (40px) by default', () => {
      render(<SkeletonCircle data-testid="skeleton-circle" />)
      const circle = screen.getByTestId('skeleton-circle')
      expect(circle).toHaveClass('w-10')
      expect(circle).toHaveClass('h-10')
    })

    it('applies large size (48px)', () => {
      render(<SkeletonCircle size="lg" data-testid="skeleton-circle" />)
      const circle = screen.getByTestId('skeleton-circle')
      expect(circle).toHaveClass('w-12')
      expect(circle).toHaveClass('h-12')
    })

    it('applies extra-large size (64px)', () => {
      render(<SkeletonCircle size="xl" data-testid="skeleton-circle" />)
      const circle = screen.getByTestId('skeleton-circle')
      expect(circle).toHaveClass('w-16')
      expect(circle).toHaveClass('h-16')
    })

    it('supports custom size via diameter prop', () => {
      render(<SkeletonCircle diameter={56} data-testid="skeleton-circle" />)
      const circle = screen.getByTestId('skeleton-circle')
      expect(circle).toHaveStyle({ width: '56px', height: '56px' })
    })
  })

  describe('Use Cases', () => {
    it('suitable for avatar placeholders', () => {
      render(<SkeletonCircle data-testid="skeleton-circle" />)
      const circle = screen.getByTestId('skeleton-circle')
      expect(circle).toHaveClass('rounded-full')
      expect(circle).toHaveClass('skeleton')
    })

    it('suitable for icon placeholders with small size', () => {
      render(<SkeletonCircle size="sm" data-testid="skeleton-circle" />)
      expect(screen.getByTestId('skeleton-circle')).toBeInTheDocument()
    })
  })
})

describe('SkeletonCard Component', () => {
  describe('Basic Rendering', () => {
    it('renders skeleton card element', () => {
      render(<SkeletonCard data-testid="skeleton-card" />)
      expect(screen.getByTestId('skeleton-card')).toBeInTheDocument()
    })

    it('applies skeleton-card class', () => {
      render(<SkeletonCard data-testid="skeleton-card" />)
      expect(screen.getByTestId('skeleton-card')).toHaveClass('skeleton-card')
    })

    it('applies rounded-lg border radius (8px)', () => {
      render(<SkeletonCard data-testid="skeleton-card" />)
      expect(screen.getByTestId('skeleton-card')).toHaveClass('rounded-lg')
    })
  })

  describe('Default Layout', () => {
    it('has default height suitable for cards', () => {
      render(<SkeletonCard data-testid="skeleton-card" />)
      // Cards typically have more height
      const card = screen.getByTestId('skeleton-card')
      expect(card).toHaveClass('h-32')
    })

    it('has full width by default', () => {
      render(<SkeletonCard data-testid="skeleton-card" />)
      expect(screen.getByTestId('skeleton-card')).toHaveClass('w-full')
    })

    it('supports custom dimensions', () => {
      render(<SkeletonCard width="300px" height="200px" data-testid="skeleton-card" />)
      const card = screen.getByTestId('skeleton-card')
      expect(card).toHaveStyle({ width: '300px', height: '200px' })
    })
  })

  describe('Aspect Ratio Support', () => {
    it('supports aspect-video ratio', () => {
      render(<SkeletonCard aspectRatio="video" data-testid="skeleton-card" />)
      expect(screen.getByTestId('skeleton-card')).toHaveClass('aspect-video')
    })

    it('supports aspect-square ratio', () => {
      render(<SkeletonCard aspectRatio="square" data-testid="skeleton-card" />)
      expect(screen.getByTestId('skeleton-card')).toHaveClass('aspect-square')
    })

    it('removes fixed height when aspect ratio is set', () => {
      render(<SkeletonCard aspectRatio="video" data-testid="skeleton-card" />)
      const card = screen.getByTestId('skeleton-card')
      expect(card).not.toHaveClass('h-32')
    })
  })
})

describe('SkeletonParagraph Component', () => {
  describe('Basic Rendering', () => {
    it('renders multiple skeleton text lines', () => {
      render(<SkeletonParagraph data-testid="skeleton-paragraph" />)
      const container = screen.getByTestId('skeleton-paragraph')
      const lines = container.querySelectorAll('.skeleton-text')
      expect(lines.length).toBeGreaterThan(1)
    })

    it('applies skeleton-paragraph class to container', () => {
      render(<SkeletonParagraph data-testid="skeleton-paragraph" />)
      expect(screen.getByTestId('skeleton-paragraph')).toHaveClass('skeleton-paragraph')
    })
  })

  describe('Line Count', () => {
    it('renders 3 lines by default', () => {
      render(<SkeletonParagraph data-testid="skeleton-paragraph" />)
      const container = screen.getByTestId('skeleton-paragraph')
      const lines = container.querySelectorAll('.skeleton-text')
      expect(lines.length).toBe(3)
    })

    it('supports custom line count', () => {
      render(<SkeletonParagraph lines={5} data-testid="skeleton-paragraph" />)
      const container = screen.getByTestId('skeleton-paragraph')
      const lines = container.querySelectorAll('.skeleton-text')
      expect(lines.length).toBe(5)
    })

    it('renders single line when lines=1', () => {
      render(<SkeletonParagraph lines={1} data-testid="skeleton-paragraph" />)
      const container = screen.getByTestId('skeleton-paragraph')
      const lines = container.querySelectorAll('.skeleton-text')
      expect(lines.length).toBe(1)
    })
  })

  describe('Variable Line Widths', () => {
    it('last line is shorter than full width (simulating natural text)', () => {
      render(<SkeletonParagraph data-testid="skeleton-paragraph" />)
      const container = screen.getByTestId('skeleton-paragraph')
      const lines = container.querySelectorAll('.skeleton-text')
      const lastLine = lines[lines.length - 1]
      // Last line should have reduced width class
      expect(lastLine).not.toHaveClass('w-full')
    })

    it('applies consistent spacing between lines', () => {
      render(<SkeletonParagraph data-testid="skeleton-paragraph" />)
      const container = screen.getByTestId('skeleton-paragraph')
      // Container should have gap spacing
      expect(container).toHaveClass('space-y-2')
    })
  })
})

describe('Loading State Transitions', () => {
  describe('Fade Transition When Content Loads', () => {
    it('skeleton has transition classes for smooth fade out', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('transition-opacity')
    })

    it('transition duration is 150ms per design spec', () => {
      render(<Skeleton data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('duration-150')
    })
  })

  describe('Error State Transition', () => {
    /**
     * Per design spec (REQ-5.2.1.20):
     * "If loading fails, the skeleton should transition to an appropriate
     * error state rather than remaining indefinitely."
     */
    it('supports isError prop for error state', () => {
      render(<Skeleton isError data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveAttribute('data-error', 'true')
    })

    it('applies error styling when isError is true', () => {
      render(<Skeleton isError data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('skeleton-error')
    })

    it('stops shimmer animation in error state', () => {
      render(<Skeleton isError data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).not.toHaveClass('animate-shimmer')
    })

    it('applies error background color in error state', () => {
      render(<Skeleton isError data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('bg-error-bg')
    })

    it('applies error border in error state', () => {
      render(<Skeleton isError data-testid="skeleton" />)
      expect(screen.getByTestId('skeleton')).toHaveClass('border-error-border')
    })

    it('transitions smoothly to error state', () => {
      render(<Skeleton isError data-testid="skeleton" />)
      // Should still have transition classes for smooth visual change
      expect(screen.getByTestId('skeleton')).toHaveClass('transition-colors')
    })

    it('SkeletonText supports error state', () => {
      render(<SkeletonText isError data-testid="skeleton-text" />)
      expect(screen.getByTestId('skeleton-text')).toHaveClass('skeleton-error')
    })

    it('SkeletonCircle supports error state', () => {
      render(<SkeletonCircle isError data-testid="skeleton-circle" />)
      expect(screen.getByTestId('skeleton-circle')).toHaveClass('skeleton-error')
    })

    it('SkeletonCard supports error state', () => {
      render(<SkeletonCard isError data-testid="skeleton-card" />)
      expect(screen.getByTestId('skeleton-card')).toHaveClass('skeleton-error')
    })

    it('SkeletonParagraph applies error state to all lines', () => {
      render(<SkeletonParagraph isError data-testid="skeleton-paragraph" />)
      const container = screen.getByTestId('skeleton-paragraph')
      const lines = container.querySelectorAll('.skeleton-text')
      lines.forEach((line) => {
        expect(line).toHaveClass('skeleton-error')
      })
    })
  })
})

describe('Accessibility', () => {
  it('all skeleton variants have aria-hidden', () => {
    render(
      <div>
        <Skeleton data-testid="skeleton" />
        <SkeletonText data-testid="skeleton-text" />
        <SkeletonCircle data-testid="skeleton-circle" />
        <SkeletonCard data-testid="skeleton-card" />
      </div>
    )
    expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('skeleton-text')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('skeleton-circle')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('skeleton-card')).toHaveAttribute('aria-hidden', 'true')
  })

  it('paragraph container does not interfere with screen readers', () => {
    render(<SkeletonParagraph data-testid="skeleton-paragraph" />)
    const container = screen.getByTestId('skeleton-paragraph')
    expect(container).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('Composite Skeleton Layouts', () => {
  describe('List Item Skeleton', () => {
    it('renders list item layout with avatar and text', async () => {
      const { SkeletonListItem } = await import('@/components/ui/skeleton')
      render(<SkeletonListItem data-testid="skeleton-list-item" />)
      expect(screen.getByTestId('skeleton-list-item')).toBeInTheDocument()
    })

    it('contains avatar placeholder', async () => {
      const { SkeletonListItem } = await import('@/components/ui/skeleton')
      render(<SkeletonListItem data-testid="skeleton-list-item" />)
      const container = screen.getByTestId('skeleton-list-item')
      expect(container.querySelector('.skeleton-circle')).toBeInTheDocument()
    })

    it('contains text lines', async () => {
      const { SkeletonListItem } = await import('@/components/ui/skeleton')
      render(<SkeletonListItem data-testid="skeleton-list-item" />)
      const container = screen.getByTestId('skeleton-list-item')
      const textLines = container.querySelectorAll('.skeleton-text')
      expect(textLines.length).toBeGreaterThan(0)
    })

    it('has flex layout for horizontal arrangement', async () => {
      const { SkeletonListItem } = await import('@/components/ui/skeleton')
      render(<SkeletonListItem data-testid="skeleton-list-item" />)
      expect(screen.getByTestId('skeleton-list-item')).toHaveClass('flex')
    })

    it('has gap between avatar and text', async () => {
      const { SkeletonListItem } = await import('@/components/ui/skeleton')
      render(<SkeletonListItem data-testid="skeleton-list-item" />)
      expect(screen.getByTestId('skeleton-list-item')).toHaveClass('gap-3')
    })
  })

  describe('Table Row Skeleton', () => {
    it('renders table row layout', async () => {
      const { SkeletonTableRow } = await import('@/components/ui/skeleton')
      render(<SkeletonTableRow data-testid="skeleton-table-row" />)
      expect(screen.getByTestId('skeleton-table-row')).toBeInTheDocument()
    })

    it('renders multiple cells', async () => {
      const { SkeletonTableRow } = await import('@/components/ui/skeleton')
      render(<SkeletonTableRow columns={4} data-testid="skeleton-table-row" />)
      const container = screen.getByTestId('skeleton-table-row')
      const cells = container.querySelectorAll('.skeleton-text')
      expect(cells.length).toBe(4)
    })

    it('has grid layout for cells', async () => {
      const { SkeletonTableRow } = await import('@/components/ui/skeleton')
      render(<SkeletonTableRow data-testid="skeleton-table-row" />)
      expect(screen.getByTestId('skeleton-table-row')).toHaveClass('grid')
    })
  })
})
