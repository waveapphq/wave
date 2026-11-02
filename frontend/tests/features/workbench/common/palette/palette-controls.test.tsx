/**
 * Palette Controls Tests - V-CONTROL-01
 *
 * Tests for the control palette that displays 15 flow controls in 5 categories.
 *
 * V-CONTROL-01 Requirements:
 * - 15 controls in 5 categories
 * - Conditional (orange): If/Else, Switch/Case, Assert
 * - Loop (cyan): For, ForEach, While, Break, Continue
 * - Flow (green): Parallel, Try/Catch, Halt, Variable Setter
 * - Timing (yellow): Delay, Wait Until
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'

// Wrapper component to provide TooltipProvider context
function Wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>
}

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })

vi.mock('@/features/workbench/stores/palette-usage-store', () => ({
  usePaletteUsageStore: () => ({
    recentItems: [],
    frequentItems: [],
    trackUsage: vi.fn(),
  }),
}))

describe('Palette Controls - V-CONTROL-01', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
  })

  describe('Control Count', () => {
    it('renders all 15 controls in flyout', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      // Open Controls flyout
      await userEvent.click(screen.getByTestId('palette-icon-controls'))
      const flyout = await screen.findByTestId('palette-flyout-controls')

      // All 15 control ids
      const expectedControls = [
        'if-else', 'switch-case', 'assert',           // Conditionals
        'for', 'for-each', 'while', 'break', 'continue', // Loops
        'parallel', 'try-catch-finally', 'halt', 'variable-setter', // Flow
        'delay', 'wait-until',                         // Timing
        'note',                                        // Misc
      ]

      for (const id of expectedControls) {
        expect(within(flyout).getByTestId(`flyout-item-${id}`)).toBeInTheDocument()
      }
    })
  })

  describe('Category Grouping', () => {
    it('displays 5 category headers in flyout', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await userEvent.click(screen.getByTestId('palette-icon-controls'))
      const flyout = await screen.findByTestId('palette-flyout-controls')

      expect(within(flyout).getByText('Conditionals')).toBeInTheDocument()
      expect(within(flyout).getByText('Loops')).toBeInTheDocument()
      expect(within(flyout).getByText('Flow')).toBeInTheDocument()
      expect(within(flyout).getByText('Timing')).toBeInTheDocument()
      expect(within(flyout).getByText('Misc')).toBeInTheDocument()
    })

    it('shows 5 subgroups in expanded palette', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      expect(screen.getByTestId('palette-subgroup-conditionals')).toBeInTheDocument()
      expect(screen.getByTestId('palette-subgroup-loops')).toBeInTheDocument()
      expect(screen.getByTestId('palette-subgroup-flow')).toBeInTheDocument()
      expect(screen.getByTestId('palette-subgroup-timing')).toBeInTheDocument()
      expect(screen.getByTestId('palette-subgroup-misc')).toBeInTheDocument()
    })
  })

  describe('Draggability', () => {
    it('controls are draggable', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await userEvent.click(screen.getByTestId('palette-icon-controls'))
      const flyout = await screen.findByTestId('palette-flyout-controls')

      const delay = within(flyout).getByTestId('flyout-item-delay')
      expect(delay).toHaveAttribute('draggable', 'true')
    })

    it('carries the control identity in the drag payload', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await userEvent.click(screen.getByTestId('palette-icon-controls'))
      const flyout = await screen.findByTestId('palette-flyout-controls')

      const delay = within(flyout).getByTestId('flyout-item-delay')
      const dataTransfer = { effectAllowed: '', setData: vi.fn<(type: string, value: string) => void>() }
      fireEvent.dragStart(delay, { dataTransfer })

      expect(dataTransfer.effectAllowed).toBe('move')
      expect(dataTransfer.setData.mock.calls[0][0]).toBe('application/wave-block')
      expect(JSON.parse(dataTransfer.setData.mock.calls[0][1])).toEqual({
        id: 'delay',
        name: 'Delay',
        type: 'control',
        source: 'palette',
      })
    })

    it('leaves the drag inert when the event carries no dataTransfer', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await userEvent.click(screen.getByTestId('palette-icon-controls'))
      const flyout = await screen.findByTestId('palette-flyout-controls')

      const delay = within(flyout).getByTestId('flyout-item-delay')
      expect(() => fireEvent.dragStart(delay)).not.toThrow()
    })

    it('sets dataTransfer with block data', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await userEvent.click(screen.getByTestId('palette-icon-controls'))
      const flyout = await screen.findByTestId('palette-flyout-controls')

      const delay = within(flyout).getByTestId('flyout-item-delay')

      const setDataMock = vi.fn()
      const dragEvent = new Event('dragstart', { bubbles: true })
      Object.assign(dragEvent, {
        dataTransfer: { setData: setDataMock, effectAllowed: 'move' },
      })

      fireEvent(delay, dragEvent)

      expect(setDataMock).toHaveBeenCalledWith(
        'application/wave-block',
        expect.stringContaining('delay')
      )
    })
  })

  describe('Accessibility', () => {
    it('controls have aria-label for accessibility', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await userEvent.click(screen.getByTestId('palette-icon-controls'))
      const flyout = await screen.findByTestId('palette-flyout-controls')

      const delay = within(flyout).getByTestId('flyout-item-delay')
      expect(delay).toHaveAttribute('aria-label', 'Delay')
    })
  })

  describe('Search', () => {
    it('filters controls in expanded palette', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const searchInput = screen.getByTestId('palette-search-input')
      await userEvent.type(searchInput, 'delay')

      // Delay should be visible in search results
      expect(screen.getByTestId('palette-item-delay')).toBeInTheDocument()
    })
  })

  describe('Break and Continue Controls', () => {
    it('should include Break control in loops category', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await userEvent.click(screen.getByTestId('palette-icon-controls'))
      const flyout = await screen.findByTestId('palette-flyout-controls')

      expect(within(flyout).getByTestId('flyout-item-break')).toBeInTheDocument()
    })

    it('should include Continue control in loops category', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await userEvent.click(screen.getByTestId('palette-icon-controls'))
      const flyout = await screen.findByTestId('palette-flyout-controls')

      expect(within(flyout).getByTestId('flyout-item-continue')).toBeInTheDocument()
    })
  })
})
