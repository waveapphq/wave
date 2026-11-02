/**
 * Icon Component Tests
 *
 * REQ-5.2.1.11: Icon library integration
 *
 * Tests for Icon component that wraps Lucide icons with design system
 * integration.
 *
 * Icon size scale:
 * - xs: 14px
 * - sm: 16px
 * - md: 18px (default)
 * - lg: 20px
 * - xl: 24px
 * - 2xl: 32px
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Icon, type IconSize, type LucideIcon } from '@/components/ui/icon'

// Common Lucide icon for testing
const MockLucideIcon = vi.fn(({ size, className, ...props }: { size?: number | string; className?: string }) => (
  <svg
    data-testid="mock-icon"
    width={size}
    height={size}
    className={className}
    {...props}
  >
    <circle cx="12" cy="12" r="10" />
  </svg>
))

describe('Icon Component', () => {
  beforeEach(() => {
    MockLucideIcon.mockClear()
  })

  describe('Rendering', () => {
    it('renders Lucide icon as child', () => {
      render(<Icon icon={MockLucideIcon} />)
      expect(screen.getByTestId('mock-icon')).toBeInTheDocument()
    })

    it('renders with wrapper span element', () => {
      render(<Icon icon={MockLucideIcon} data-testid="icon-wrapper" />)
      expect(screen.getByTestId('icon-wrapper').tagName).toBe('SPAN')
    })

    it('forwards icon prop to Lucide icon component', () => {
      render(<Icon icon={MockLucideIcon} />)
      expect(MockLucideIcon).toHaveBeenCalled()
    })
  })

  describe('Size Scale', () => {
    it('renders xs size with 14px dimensions', () => {
      render(<Icon icon={MockLucideIcon} size="xs" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ size: 14 }),
        undefined
      )
    })

    it('renders sm size with 16px dimensions', () => {
      render(<Icon icon={MockLucideIcon} size="sm" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ size: 16 }),
        undefined
      )
    })

    it('renders md size with 18px dimensions (default)', () => {
      render(<Icon icon={MockLucideIcon} />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ size: 18 }),
        undefined
      )
    })

    it('renders lg size with 20px dimensions', () => {
      render(<Icon icon={MockLucideIcon} size="lg" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ size: 20 }),
        undefined
      )
    })

    it('renders xl size with 24px dimensions', () => {
      render(<Icon icon={MockLucideIcon} size="xl" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ size: 24 }),
        undefined
      )
    })

    it('renders 2xl size with 32px dimensions', () => {
      render(<Icon icon={MockLucideIcon} size="2xl" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ size: 32 }),
        undefined
      )
    })
  })

  describe('Color Inheritance', () => {
    it('passes currentColor as stroke color by default', () => {
      render(<Icon icon={MockLucideIcon} />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ stroke: 'currentColor' }),
        undefined
      )
    })

    it('allows custom color via color prop', () => {
      render(<Icon icon={MockLucideIcon} color="#FF0000" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ stroke: '#FF0000' }),
        undefined
      )
    })

    it('accepts design system color token names', () => {
      render(<Icon icon={MockLucideIcon} color="primary" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ stroke: 'var(--color-primary)' }),
        undefined
      )
    })

    it('accepts success semantic color', () => {
      render(<Icon icon={MockLucideIcon} color="success" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ stroke: 'var(--color-success-text)' }),
        undefined
      )
    })

    it('accepts warning semantic color', () => {
      render(<Icon icon={MockLucideIcon} color="warning" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ stroke: 'var(--color-warning-text)' }),
        undefined
      )
    })

    it('accepts error semantic color', () => {
      render(<Icon icon={MockLucideIcon} color="error" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ stroke: 'var(--color-error-text)' }),
        undefined
      )
    })

    it('accepts info semantic color', () => {
      render(<Icon icon={MockLucideIcon} color="info" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ stroke: 'var(--color-info-text)' }),
        undefined
      )
    })

    it('accepts muted text color', () => {
      render(<Icon icon={MockLucideIcon} color="muted" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ stroke: 'var(--color-text-muted)' }),
        undefined
      )
    })
  })

  describe('Accessibility', () => {
    it('sets aria-hidden="true" by default for decorative icons', () => {
      render(<Icon icon={MockLucideIcon} data-testid="icon-wrapper" />)
      expect(screen.getByTestId('icon-wrapper')).toHaveAttribute('aria-hidden', 'true')
    })

    it('does not set aria-hidden when label is provided', () => {
      render(<Icon icon={MockLucideIcon} label="Settings" data-testid="icon-wrapper" />)
      expect(screen.getByTestId('icon-wrapper')).not.toHaveAttribute('aria-hidden')
    })

    it('sets aria-label when label prop is provided', () => {
      render(<Icon icon={MockLucideIcon} label="Settings" data-testid="icon-wrapper" />)
      expect(screen.getByTestId('icon-wrapper')).toHaveAttribute('aria-label', 'Settings')
    })

    it('sets role="img" when label is provided', () => {
      render(<Icon icon={MockLucideIcon} label="Settings" data-testid="icon-wrapper" />)
      expect(screen.getByTestId('icon-wrapper')).toHaveAttribute('role', 'img')
    })

    it('icon has focusable="false" attribute', () => {
      render(<Icon icon={MockLucideIcon} />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ focusable: 'false' }),
        undefined
      )
    })
  })

  describe('Custom Styling', () => {
    it('applies custom className to wrapper', () => {
      render(<Icon icon={MockLucideIcon} className="custom-class" data-testid="icon-wrapper" />)
      expect(screen.getByTestId('icon-wrapper')).toHaveClass('custom-class')
    })

    it('merges className with default icon classes', () => {
      render(<Icon icon={MockLucideIcon} className="custom-class" data-testid="icon-wrapper" />)
      const wrapper = screen.getByTestId('icon-wrapper')
      expect(wrapper).toHaveClass('icon')
      expect(wrapper).toHaveClass('custom-class')
    })

    it('passes additional props to wrapper', () => {
      render(<Icon icon={MockLucideIcon} data-testid="icon-wrapper" data-custom="value" />)
      expect(screen.getByTestId('icon-wrapper')).toHaveAttribute('data-custom', 'value')
    })

    it('applies inline-flex display to wrapper', () => {
      render(<Icon icon={MockLucideIcon} data-testid="icon-wrapper" />)
      expect(screen.getByTestId('icon-wrapper')).toHaveClass('inline-flex')
    })
  })

  describe('Stroke Width', () => {
    it('uses strokeWidth of 2 by default (md size)', () => {
      render(<Icon icon={MockLucideIcon} />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ strokeWidth: 2 }),
        undefined
      )
    })

    it('uses strokeWidth of 1.5 for xs size', () => {
      render(<Icon icon={MockLucideIcon} size="xs" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ strokeWidth: 1.5 }),
        undefined
      )
    })

    it('uses strokeWidth of 1.5 for sm size', () => {
      render(<Icon icon={MockLucideIcon} size="sm" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ strokeWidth: 1.5 }),
        undefined
      )
    })

    it('uses strokeWidth of 2 for md size', () => {
      render(<Icon icon={MockLucideIcon} size="md" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ strokeWidth: 2 }),
        undefined
      )
    })

    it('uses strokeWidth of 2 for lg size', () => {
      render(<Icon icon={MockLucideIcon} size="lg" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ strokeWidth: 2 }),
        undefined
      )
    })

    it('uses strokeWidth of 2 for xl size', () => {
      render(<Icon icon={MockLucideIcon} size="xl" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ strokeWidth: 2 }),
        undefined
      )
    })

    it('uses strokeWidth of 2 for 2xl size', () => {
      render(<Icon icon={MockLucideIcon} size="2xl" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ strokeWidth: 2 }),
        undefined
      )
    })

    it('allows custom strokeWidth to override size-based default', () => {
      render(<Icon icon={MockLucideIcon} size="xs" strokeWidth={3} />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ strokeWidth: 3 }),
        undefined
      )
    })
  })

  describe('Icon Variants', () => {
    it('applies filled variant class', () => {
      render(<Icon icon={MockLucideIcon} variant="filled" data-testid="icon-wrapper" />)
      expect(screen.getByTestId('icon-wrapper')).toHaveClass('icon-filled')
    })

    it('applies outlined variant class by default', () => {
      render(<Icon icon={MockLucideIcon} data-testid="icon-wrapper" />)
      expect(screen.getByTestId('icon-wrapper')).toHaveClass('icon-outlined')
    })

    it('sets fill="currentColor" for filled variant', () => {
      render(<Icon icon={MockLucideIcon} variant="filled" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ fill: 'currentColor' }),
        undefined
      )
    })

    it('sets fill="none" for outlined variant', () => {
      render(<Icon icon={MockLucideIcon} variant="outlined" />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ fill: 'none' }),
        undefined
      )
    })
  })

  describe('Spin Animation', () => {
    it('applies spin animation class when spin prop is true', () => {
      render(<Icon icon={MockLucideIcon} spin data-testid="icon-wrapper" />)
      expect(screen.getByTestId('icon-wrapper')).toHaveClass('animate-spin')
    })

    it('does not apply spin animation by default', () => {
      render(<Icon icon={MockLucideIcon} data-testid="icon-wrapper" />)
      expect(screen.getByTestId('icon-wrapper')).not.toHaveClass('animate-spin')
    })
  })

  describe('Size Props Mapping', () => {
    const sizeMapping: Record<IconSize, number> = {
      xs: 14,
      sm: 16,
      md: 18,
      lg: 20,
      xl: 24,
      '2xl': 32,
    }

    it.each(Object.entries(sizeMapping))('size "%s" maps to %dpx', (size, pixels) => {
      render(<Icon icon={MockLucideIcon} size={size as IconSize} />)
      expect(MockLucideIcon).toHaveBeenCalledWith(
        expect.objectContaining({ size: pixels }),
        undefined
      )
    })
  })

  describe('Type Safety', () => {
    it('accepts any valid Lucide icon component', () => {
      // This test ensures the Icon component type accepts LucideIcon types
      const CustomIcon = vi.fn(({ size }: { size?: number | string }) => (
        <svg width={size} height={size} data-testid="custom-icon">
          <path d="M0 0" />
        </svg>
      )) as unknown as LucideIcon

      render(<Icon icon={CustomIcon} />)
      expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
    })
  })
})

describe('Icon with Common Lucide Icons', () => {
  // These tests verify that the Icon component works correctly with actual Lucide icons
  // The implementation should re-export commonly used icons for convenience

  it('exports commonly used icons from lucide-react', async () => {
    const iconExports = await import('@/components/ui/icon')

    // Common icons that should be re-exported
    expect(iconExports.ChevronRightIcon).toBeDefined()
    expect(iconExports.ChevronDownIcon).toBeDefined()
    expect(iconExports.ChevronLeftIcon).toBeDefined()
    expect(iconExports.ChevronUpIcon).toBeDefined()
    expect(iconExports.XIcon).toBeDefined()
    expect(iconExports.CheckIcon).toBeDefined()
    expect(iconExports.PlusIcon).toBeDefined()
    expect(iconExports.MinusIcon).toBeDefined()
    expect(iconExports.SearchIcon).toBeDefined()
    expect(iconExports.MenuIcon).toBeDefined()
    expect(iconExports.SettingsIcon).toBeDefined()
    expect(iconExports.UserIcon).toBeDefined()
    expect(iconExports.HomeIcon).toBeDefined()
    expect(iconExports.AlertCircleIcon).toBeDefined()
    expect(iconExports.InfoIcon).toBeDefined()
    expect(iconExports.AlertTriangleIcon).toBeDefined()
    expect(iconExports.CheckCircleIcon).toBeDefined()
    expect(iconExports.LoaderIcon).toBeDefined()
    expect(iconExports.RefreshCwIcon).toBeDefined()
    expect(iconExports.TrashIcon).toBeDefined()
    expect(iconExports.EditIcon).toBeDefined()
    expect(iconExports.CopyIcon).toBeDefined()
    expect(iconExports.ExternalLinkIcon).toBeDefined()
    expect(iconExports.DownloadIcon).toBeDefined()
    expect(iconExports.UploadIcon).toBeDefined()
    expect(iconExports.FolderIcon).toBeDefined()
    expect(iconExports.FileIcon).toBeDefined()
    expect(iconExports.PlayIcon).toBeDefined()
    expect(iconExports.PauseIcon).toBeDefined()
    expect(iconExports.StopCircleIcon).toBeDefined()
    expect(iconExports.SunIcon).toBeDefined()
    expect(iconExports.MoonIcon).toBeDefined()
  })
})

describe('icon module surface', () => {
  it.each(['ExpandIcon', 'Maximize2Icon'])('no longer exports %s (FIELD-11)', async (name) => {
    const iconExports = await import('@/components/ui/icon')
    expect(name in iconExports).toBe(false)
  })
})
