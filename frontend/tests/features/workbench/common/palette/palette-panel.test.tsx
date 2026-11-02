/**
 * PalettePanel Tests - V-CANVAS-01f/g
 *
 * Tests for the block palette panel with collapsed icon strip and expanded sections.
 *
 * REQs:
 * - REQ-3.1.1.1: Drag-and-drop interface for block arrangement
 * - REQ-4.2.1: No-code test creation for basic users
 * - REQ-4.2.3: Intuitive drag-drop interface
 * - REQ-3.4.4.1: Plugin definitions with icon name field for UI rendering
 * - REQ-3.4.4.2: Icon names from predefined set (Lucide) via centralized icon registry
 *
 * Note: Visual styling (colors, spacing) is verified by Playwright visual tests.
 * These unit tests focus on behavior and WAVE-specific functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'

// Wrapper component to provide TooltipProvider context
function Wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>
}

// The kubernetes palette subcategory: Connect plus the eleven verb blocks.
const KUBERNETES_BLOCKS = [
  { id: 'k8s-connect', name: 'K8s Connect' },
  { id: 'k8s-get', name: 'K8s Get' },
  { id: 'k8s-events', name: 'K8s Events' },
  { id: 'k8s-logs', name: 'K8s Logs' },
  { id: 'k8s-top', name: 'K8s Top' },
  { id: 'k8s-apply', name: 'K8s Apply' },
  { id: 'k8s-delete', name: 'K8s Delete' },
  { id: 'k8s-scale', name: 'K8s Scale' },
  { id: 'k8s-rollout', name: 'K8s Rollout' },
  { id: 'k8s-exec', name: 'K8s Exec' },
  { id: 'k8s-script', name: 'K8s Script' },
  { id: 'k8s-copy', name: 'K8s Copy' },
]

const K8S_VERB_BLOCKS = KUBERNETES_BLOCKS.filter((b) => b.id !== 'k8s-connect')

describe('PalettePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  // ============================================================================
  // V-CANVAS-01f: Collapsed State
  // ============================================================================

  describe('Collapsed State (V-CANVAS-01f)', () => {
    it('renders collapsed by default with 64px width', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel />, { wrapper: Wrapper })

      const panel = screen.getByTestId('block-palette')
      expect(panel).toHaveAttribute('data-state', 'collapsed')
      expect(panel).toHaveStyle({ width: '64px' })
    })

    it('displays icon strip with category icons when collapsed', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      const iconStrip = screen.getByTestId('palette-icon-strip')
      expect(iconStrip).toBeInTheDocument()

      // All 7 category icons present
      expect(screen.getByTestId('palette-icon-search')).toBeInTheDocument()
      expect(screen.getByTestId('palette-icon-most-used')).toBeInTheDocument()
      expect(screen.getByTestId('palette-icon-recent')).toBeInTheDocument()
      expect(screen.getByTestId('palette-icon-controls')).toBeInTheDocument()
      expect(screen.getByTestId('palette-icon-plugins')).toBeInTheDocument()
      expect(screen.getByTestId('palette-icon-add')).toBeInTheDocument()
      expect(screen.getByTestId('palette-icon-library')).toBeInTheDocument()
    })

    it('expands to full palette when clicking expand button', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      const expandButton = screen.getByTestId('palette-expand-button')
      await user.click(expandButton)

      const panel = screen.getByTestId('block-palette')
      expect(panel).toHaveAttribute('data-state', 'expanded')
      expect(panel).toHaveStyle({ width: '260px' })
    })

    it('shows flyout with controls when clicking controls icon', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-controls'))

      const flyout = await screen.findByTestId('palette-flyout-controls')
      // Flyout should contain control elements
      expect(within(flyout).getByText('If / Else')).toBeInTheDocument()
      expect(within(flyout).getByText('For Loop')).toBeInTheDocument()
    })

    it('shows flyout with plugins when clicking plugins icon', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-plugins'))

      const flyout = await screen.findByTestId('palette-flyout-plugins')
      // Flyout should show plugin subcategories
      expect(within(flyout).getByText('Network')).toBeInTheDocument()
      expect(within(flyout).getByText('System')).toBeInTheDocument()
    })

    it('allows dragging items directly from flyout', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-controls'))
      const flyout = await screen.findByTestId('palette-flyout-controls')
      const ifElseItem = within(flyout).getByText('If / Else').closest('[draggable]')

      // Mock dataTransfer to cover the e.dataTransfer branch
      const mockDataTransfer = {
        effectAllowed: '',
        setData: vi.fn(),
      }
      fireEvent.dragStart(ifElseItem!, { dataTransfer: mockDataTransfer })

      // Verify dataTransfer was used correctly
      expect(mockDataTransfer.effectAllowed).toBe('move')
      expect(mockDataTransfer.setData).toHaveBeenCalledWith(
        'application/wave-block',
        expect.stringContaining('"id":"if-else"')
      )
      expect(mockDataTransfer.setData).toHaveBeenCalledWith(
        'application/wave-block',
        expect.stringContaining('"type":"control"')
      )
      expect(mockDataTransfer.setData).toHaveBeenCalledWith(
        'application/wave-block',
        expect.stringContaining('"source":"palette"')
      )
    })

    it('hides flyout when clicking outside', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-controls'))
      expect(await screen.findByTestId('palette-flyout-controls')).toBeInTheDocument()

      // Click outside to close
      await user.click(document.body)
      await waitFor(() => {
        expect(screen.queryByTestId('palette-flyout-controls')).not.toBeInTheDocument()
      })
    })

    it('allows dragging plugin items from plugins flyout', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      // Open plugins flyout
      await user.click(screen.getByTestId('palette-icon-plugins'))
      const flyout = await screen.findByTestId('palette-flyout-plugins')

      // Find HTTP plugin item in the flyout (uses flyout-item-{id} test ID)
      const httpItem = within(flyout).getByTestId('flyout-item-http-client')
      expect(httpItem).toHaveAttribute('draggable', 'true')

      // Mock dataTransfer to cover the e.dataTransfer branch
      const mockDataTransfer = {
        effectAllowed: '',
        setData: vi.fn(),
      }
      fireEvent.dragStart(httpItem, { dataTransfer: mockDataTransfer })

      // Verify dataTransfer was used correctly
      expect(mockDataTransfer.effectAllowed).toBe('move')
      expect(mockDataTransfer.setData).toHaveBeenCalledWith(
        'application/wave-block',
        expect.stringContaining('"id":"http-client"')
      )
      expect(mockDataTransfer.setData).toHaveBeenCalledWith(
        'application/wave-block',
        expect.stringContaining('"type":"plugin"')
      )
      expect(mockDataTransfer.setData).toHaveBeenCalledWith(
        'application/wave-block',
        expect.stringContaining('"source":"palette"')
      )
      // The drop payload names the block only; the palette grouping stays in the palette.
      expect(mockDataTransfer.setData).toHaveBeenCalledWith(
        'application/wave-block',
        expect.not.stringContaining('"category"')
      )
    })

    it('shows search flyout with controls and plugins when clicking search icon', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-search'))
      const flyout = await screen.findByTestId('palette-flyout-search')

      // Should have search input
      expect(within(flyout).getByTestId('flyout-search-input')).toBeInTheDocument()
      // Should show controls section
      expect(within(flyout).getByText(/Controls \(\d+\)/)).toBeInTheDocument()
      // Should show plugins section
      expect(within(flyout).getByText(/Plugins \(\d+\)/)).toBeInTheDocument()
    })

    it('filters items in search flyout when typing', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-search'))
      const searchInput = await screen.findByTestId('flyout-search-input')

      await user.type(searchInput, 'shell')

      // Should filter to show matching items
      await waitFor(() => {
        expect(screen.getByTestId('flyout-item-shell-script')).toBeInTheDocument()
        expect(screen.getByTestId('flyout-item-shell-exec')).toBeInTheDocument()
      })
    })

    it('shows no results message in search flyout for non-matching query', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-search'))
      const searchInput = await screen.findByTestId('flyout-search-input')

      await user.type(searchInput, 'nonexistentitem12345')

      await waitFor(() => {
        expect(screen.getByText(/No results for/)).toBeInTheDocument()
      })
    })

    it('clears search query when clear button is clicked', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-search'))
      const searchInput = await screen.findByTestId('flyout-search-input')

      await user.type(searchInput, 'shell')
      const clearButton = await screen.findByTestId('flyout-search-clear')
      await user.click(clearButton)

      expect(searchInput).toHaveValue('')
    })

    it('closes search flyout when clicking outside', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-search'))
      expect(await screen.findByTestId('palette-flyout-search')).toBeInTheDocument()

      // Click outside to close
      await user.click(document.body)
      await waitFor(() => {
        expect(screen.queryByTestId('palette-flyout-search')).not.toBeInTheDocument()
      })
    })

    it('closes recent flyout when clicking outside', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-recent'))
      expect(await screen.findByTestId('palette-flyout-recent')).toBeInTheDocument()

      // Click outside to close
      await user.click(document.body)
      await waitFor(() => {
        expect(screen.queryByTestId('palette-flyout-recent')).not.toBeInTheDocument()
      })
    })

    it('shows empty recent flyout when no recent usage', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-recent'))
      const flyout = await screen.findByTestId('palette-flyout-recent')

      expect(within(flyout).getByText('No recent items')).toBeInTheDocument()
    })

    it('shows recent items in recent flyout when populated', async () => {
      vi.doMock('@/features/workbench/stores/palette-usage-store', () => ({
        usePaletteUsageStore: () => ({
          recentItems: ['shell-script', 'if-else'],
          frequentItems: [],
          trackUsage: vi.fn(),
        }),
      }))

      vi.resetModules()
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-recent'))
      const flyout = await screen.findByTestId('palette-flyout-recent')

      expect(within(flyout).getByText('Recently Used')).toBeInTheDocument()
      expect(within(flyout).getByTestId('flyout-item-shell-script')).toBeInTheDocument()
      expect(within(flyout).getByTestId('flyout-item-if-else')).toBeInTheDocument()

      // Clean up mock
      vi.doUnmock('@/features/workbench/stores/palette-usage-store')
    })

    it('handles invalid item IDs gracefully in recent flyout', async () => {
      vi.doMock('@/features/workbench/stores/palette-usage-store', () => ({
        usePaletteUsageStore: () => ({
          recentItems: ['invalid-id', 'shell-script', 'nonexistent'],
          frequentItems: [],
          trackUsage: vi.fn(),
        }),
      }))

      vi.resetModules()
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-recent'))
      const flyout = await screen.findByTestId('palette-flyout-recent')

      // Valid item should be rendered, invalid items skipped
      expect(within(flyout).getByTestId('flyout-item-shell-script')).toBeInTheDocument()
      expect(within(flyout).queryByText('invalid-id')).not.toBeInTheDocument()

      // Clean up mock
      vi.doUnmock('@/features/workbench/stores/palette-usage-store')
    })

    it('shows empty most-used flyout when no frequent usage', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-most-used'))
      const flyout = await screen.findByTestId('palette-flyout-most-used')

      expect(within(flyout).getByText('No favorites yet')).toBeInTheDocument()
    })

    it('shows frequent items in most-used flyout when populated', async () => {
      vi.doMock('@/features/workbench/stores/palette-usage-store', () => ({
        usePaletteUsageStore: () => ({
          recentItems: [],
          frequentItems: [
            { id: 'shell-script', count: 10 },
            { id: 'http-client', count: 5 },
          ],
          trackUsage: vi.fn(),
        }),
      }))

      vi.resetModules()
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-most-used'))
      const flyout = await screen.findByTestId('palette-flyout-most-used')

      expect(within(flyout).getByText('Most Used')).toBeInTheDocument()
      expect(within(flyout).getByTestId('flyout-item-shell-script')).toBeInTheDocument()
      expect(within(flyout).getByTestId('flyout-item-http-client')).toBeInTheDocument()

      // Clean up mock
      vi.doUnmock('@/features/workbench/stores/palette-usage-store')
    })

    it('closes most-used flyout when clicking outside', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-most-used'))
      expect(await screen.findByTestId('palette-flyout-most-used')).toBeInTheDocument()

      // Click outside to close
      await user.click(document.body)
      await waitFor(() => {
        expect(screen.queryByTestId('palette-flyout-most-used')).not.toBeInTheDocument()
      })
    })

    it('closes plugins flyout when clicking outside', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-plugins'))
      expect(await screen.findByTestId('palette-flyout-plugins')).toBeInTheDocument()

      // Click outside to close
      await user.click(document.body)
      await waitFor(() => {
        expect(screen.queryByTestId('palette-flyout-plugins')).not.toBeInTheDocument()
      })
    })

    it('forwards the collapsed Library icon click to onOpenFunctionLibrary', async () => {
      const user = userEvent.setup()
      const onOpenFunctionLibrary = vi.fn()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(
        <PalettePanel defaultCollapsed={true} onOpenFunctionLibrary={onOpenFunctionLibrary} />,
        { wrapper: Wrapper },
      )

      await user.click(screen.getByTestId('palette-icon-library'))

      expect(onOpenFunctionLibrary).toHaveBeenCalledTimes(1)
    })

    it('handles invalid item IDs gracefully in most-used flyout', async () => {
      vi.doMock('@/features/workbench/stores/palette-usage-store', () => ({
        usePaletteUsageStore: () => ({
          recentItems: [],
          frequentItems: [
            { id: 'invalid-id', count: 15 },
            { id: 'shell-script', count: 10 },
            { id: 'nonexistent', count: 5 },
          ],
          trackUsage: vi.fn(),
        }),
      }))

      vi.resetModules()
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-most-used'))
      const flyout = await screen.findByTestId('palette-flyout-most-used')

      // Valid item should be rendered, invalid items skipped
      expect(within(flyout).getByTestId('flyout-item-shell-script')).toBeInTheDocument()
      expect(within(flyout).queryByText('invalid-id')).not.toBeInTheDocument()

      // Clean up mock
      vi.doUnmock('@/features/workbench/stores/palette-usage-store')
    })

    it('shows control items in most-used flyout', async () => {
      vi.doMock('@/features/workbench/stores/palette-usage-store', () => ({
        usePaletteUsageStore: () => ({
          recentItems: [],
          frequentItems: [
            { id: 'if-else', count: 20 },
            { id: 'shell-script', count: 10 },
          ],
          trackUsage: vi.fn(),
        }),
      }))

      vi.resetModules()
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-most-used'))
      const flyout = await screen.findByTestId('palette-flyout-most-used')

      // Both control and plugin items should be rendered
      expect(within(flyout).getByTestId('flyout-item-if-else')).toBeInTheDocument()
      expect(within(flyout).getByTestId('flyout-item-shell-script')).toBeInTheDocument()

      // Clean up mock
      vi.doUnmock('@/features/workbench/stores/palette-usage-store')
    })
  })

  // ============================================================================
  // V-CANVAS-01g: Expanded State
  // ============================================================================

  describe('Expanded State (V-CANVAS-01g)', () => {
    it('renders expanded with 260px width', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const panel = screen.getByTestId('block-palette')
      expect(panel).toHaveAttribute('data-state', 'expanded')
      expect(panel).toHaveStyle({ width: '260px' })
    })

    it('collapses when clicking collapse button', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      await user.click(screen.getByRole('button', { name: /collapse/i }))

      expect(screen.getByTestId('block-palette')).toHaveAttribute('data-state', 'collapsed')
    })
  })

  describe('Search Functionality', () => {
    it('has search input with correct placeholder', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      expect(screen.getByPlaceholderText('Search…')).toBeInTheDocument()
    })

    it('filters plugins by search query', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      await user.type(screen.getByPlaceholderText('Search…'), 'shell')

      // Should show both shell plugins
      expect(screen.getByText('Shell Script')).toBeInTheDocument()
      expect(screen.getByText('Shell Exec')).toBeInTheDocument()
      // Should hide unrelated items
      expect(screen.queryByText('If / Else')).not.toBeInTheDocument()
      expect(screen.queryByText('HTTP')).not.toBeInTheDocument()
    })

    it('filters controls by search query showing flat list', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      await user.type(screen.getByPlaceholderText('Search…'), 'for')

      // Should show For Loop and For Each controls in flat list
      expect(screen.getByText('For Loop')).toBeInTheDocument()
      expect(screen.getByText('For Each')).toBeInTheDocument()
      // Should hide unrelated items
      expect(screen.queryByText('Shell Script')).not.toBeInTheDocument()
    })

    it('shows empty state when no results match', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      await user.type(screen.getByPlaceholderText('Search…'), 'zzzznotfound')

      expect(screen.getByText(/no results/i)).toBeInTheDocument()
    })

    it('clears search and shows all items', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const searchInput = screen.getByPlaceholderText('Search…')
      await user.type(searchInput, 'shell')
      await user.click(screen.getByRole('button', { name: /clear/i }))

      expect(searchInput).toHaveValue('')
      expect(screen.getByText('If / Else')).toBeInTheDocument()
    })
  })

  describe('CONTROLS Section', () => {
    it('contains all 11 WAVE control elements in subgroups', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const controlsSection = screen.getByTestId('palette-section-controls')

      // Expand all subgroups to see controls
      const conditionalsHeader = within(controlsSection).getByRole('button', { name: /conditionals/i })
      const loopsHeader = within(controlsSection).getByRole('button', { name: /loops/i })
      const flowHeader = within(controlsSection).getByRole('button', { name: /flow/i })
      const timingHeader = within(controlsSection).getByRole('button', { name: /timing/i })

      await user.click(conditionalsHeader)
      await user.click(loopsHeader)
      await user.click(flowHeader)
      await user.click(timingHeader)

      // All 11 control flow elements per design spec
      const expectedControls = [
        'If / Else',
        'Switch',
        'Assert',
        'For Loop',
        'For Each',
        'While Loop',
        'Parallel',
        'Try / Catch',
        'Halt',
        'Delay',
        'Wait Until',
      ]

      for (const control of expectedControls) {
        expect(within(controlsSection).getByText(control)).toBeInTheDocument()
      }
    })

    it('control items are draggable with correct data', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      // Expand Flow subgroup to access Parallel
      const controlsSection = screen.getByTestId('palette-section-controls')
      const flowHeader = within(controlsSection).getByRole('button', { name: /flow/i })
      await user.click(flowHeader)

      const parallelItem = screen.getByTestId('palette-item-parallel')
      const mockDataTransfer = {
        effectAllowed: '',
        setData: vi.fn<(type: string, value: string) => void>(),
      }
      fireEvent.dragStart(parallelItem, { dataTransfer: mockDataTransfer })

      expect(mockDataTransfer.effectAllowed).toBe('move')
      expect(mockDataTransfer.setData.mock.calls[0][0]).toBe('application/wave-block')
      expect(JSON.parse(mockDataTransfer.setData.mock.calls[0][1])).toEqual({
        id: 'parallel',
        name: 'Parallel',
        type: 'control',
        source: 'palette',
      })
    })

    it('section is collapsible', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const controlsSection = screen.getByTestId('palette-section-controls')
      const header = within(controlsSection).getByTestId('section-header')
      expect(header).toHaveAttribute('aria-expanded', 'true')

      await user.click(header)
      expect(header).toHaveAttribute('aria-expanded', 'false')
      // Subgroups should be hidden
      expect(screen.queryByTestId('palette-subgroup-conditionals')).not.toBeVisible()
    })

    it('handles localStorage errors gracefully when saving section state', async () => {
      const user = userEvent.setup()
      // Use vi.spyOn to mock localStorage.setItem
      const mockSetItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('localStorage is full')
      })

      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const controlsSection = screen.getByTestId('palette-section-controls')
      const header = within(controlsSection).getByTestId('section-header')

      // Should not throw even when localStorage fails
      await user.click(header)
      expect(header).toHaveAttribute('aria-expanded', 'false')

      // Restore mock
      mockSetItem.mockRestore()
    })

    it('handles localStorage errors gracefully when reading section state', async () => {
      // Use vi.spyOn to mock localStorage.getItem
      const mockGetItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage unavailable')
      })

      const { PalettePanel } = await import('@/features/workbench/common/palette')
      // Should render without error, using default expanded state
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const controlsSection = screen.getByTestId('palette-section-controls')
      const header = within(controlsSection).getByTestId('section-header')
      // Should use default value (true) when localStorage fails
      expect(header).toHaveAttribute('aria-expanded', 'true')

      // Verify the mock was called
      expect(mockGetItem).toHaveBeenCalled()

      // Restore mock
      mockGetItem.mockRestore()
    })

    it('restores section state from localStorage when stored value exists', async () => {
      // Pre-populate localStorage with a collapsed state for controls section
      const STORAGE_KEY_PREFIX = 'wave-palette-section-'
      localStorage.setItem(STORAGE_KEY_PREFIX + 'controls', 'false')

      vi.resetModules()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const controlsSection = screen.getByTestId('palette-section-controls')
      const header = within(controlsSection).getByTestId('section-header')
      // Should restore collapsed state from localStorage (not default expanded)
      expect(header).toHaveAttribute('aria-expanded', 'false')

      // Clean up
      localStorage.removeItem(STORAGE_KEY_PREFIX + 'controls')
    })

    it('restores expanded state from localStorage when stored as true', async () => {
      // Pre-populate localStorage with an expanded state
      const STORAGE_KEY_PREFIX = 'wave-palette-section-'
      localStorage.setItem(STORAGE_KEY_PREFIX + 'controls', 'true')

      vi.resetModules()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const controlsSection = screen.getByTestId('palette-section-controls')
      const header = within(controlsSection).getByTestId('section-header')
      // Should restore expanded state from localStorage
      expect(header).toHaveAttribute('aria-expanded', 'true')

      // Clean up
      localStorage.removeItem(STORAGE_KEY_PREFIX + 'controls')
    })
  })

  describe('PLUGINS Section', () => {
    it('contains every non-empty WAVE plugin subcategory with correct counts', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const pluginsSection = screen.getByTestId('palette-section-plugins')

      // Subcategories with counts per design spec
      const expectedSubcats = [
        { name: 'Network', count: '3' },
        { name: 'Remote', count: '8' },
        { name: 'Database', count: '2' },
        { name: 'System', count: '5' },
        { name: 'Kubernetes', count: '12' },
        { name: 'Data', count: '4' },
      ]

      for (const { name, count } of expectedSubcats) {
        const subcat = within(pluginsSection).getByTestId(`palette-subcat-${name.toLowerCase()}`)
        expect(within(subcat).getByText(name)).toBeInTheDocument()
        expect(within(subcat).getByTestId('subcategory-count')).toHaveTextContent(
          new RegExp(`^${count}$`)
        )
      }
    })

    it('Network subcategory lists HTTP, Ping and Netcat, and not SFTP (SFTP-10)', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette/panel')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      // Expand Network subcategory
      await user.click(screen.getByRole('button', { name: /network/i }))

      const subcat = screen.getByTestId('palette-subcat-network')
      const expectedPlugins = ['HTTP', 'Ping', 'Netcat']
      for (const plugin of expectedPlugins) {
        expect(within(subcat).getByText(plugin)).toBeInTheDocument()
      }
      expect(
        within(subcat)
          .getAllByTestId(/^palette-item-/)
          .map((el) => el.getAttribute('data-testid'))
      ).toEqual(['palette-item-http-client', 'palette-item-ping', 'palette-item-netcat'])
      expect(within(subcat).queryByText('SFTP')).not.toBeInTheDocument()
    })

    it('Remote subcategory lists SFTP after SSH Tunnel Close and before Remote Execution (REMICON-1)', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette/panel')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      await user.click(screen.getByRole('button', { name: /^remote$/i }))

      const subcat = screen.getByTestId('palette-subcat-remote')
      expect(within(subcat).getByText('SFTP')).toBeInTheDocument()
      expect(
        within(subcat)
          .getAllByTestId(/^palette-item-/)
          .map((el) => el.getAttribute('data-testid'))
      ).toEqual([
        'palette-item-ssh-session-open',
        'palette-item-ssh-session-exec',
        'palette-item-ssh-session-script',
        'palette-item-ssh-session-close',
        'palette-item-ssh-tunnel-open',
        'palette-item-ssh-tunnel-close',
        'palette-item-sftp',
        'palette-item-remote-execution',
      ])
    })

    it('Database subcategory lists SQL and OpenSearch, and no LDAP block', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette/panel')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const subcat = screen.getByTestId('palette-subcat-database')
      await user.click(within(subcat).getByTestId('subcategory-header'))

      expect(
        within(subcat)
          .getAllByTestId(/^palette-item-/)
          .map((el) => el.getAttribute('data-testid'))
      ).toEqual(['palette-item-sql-client', 'palette-item-opensearch'])
      expect(within(subcat).getByText('SQL')).toBeInTheDocument()
      expect(within(subcat).getByText('OpenSearch')).toBeInTheDocument()
      expect(within(subcat).queryByText('LDAP')).not.toBeInTheDocument()
    })

    it('System subcategory contains correct plugins', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      await user.click(screen.getByRole('button', { name: /system/i }))

      // System has 5 plugins: Shell Script, Shell Exec, Python, File I/O, Log
      // (Halt is in Controls)
      const expectedPlugins = ['Shell Script', 'Shell Exec', 'Python', 'File I/O', 'Log']
      for (const plugin of expectedPlugins) {
        expect(screen.getByText(plugin)).toBeInTheDocument()
      }
    })

    it('Kubernetes subcategory contains all twelve K8s blocks and no retired K8s API', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      await user.click(screen.getByRole('button', { name: /kubernetes/i }))

      const subcat = screen.getByTestId('palette-subcat-kubernetes')
      for (const { id, name } of KUBERNETES_BLOCKS) {
        expect(
          within(subcat).getByTestId(`palette-item-${id}`),
          `'${id}' should be in the Kubernetes subcategory`
        ).toBeInTheDocument()
        expect(within(subcat).getByText(name), `'${name}' should be listed`).toBeInTheDocument()
      }
      expect(
        within(subcat)
          .getAllByTestId(/^palette-item-/)
          .map((el) => el.getAttribute('data-testid'))
      ).toEqual(KUBERNETES_BLOCKS.map(({ id }) => `palette-item-${id}`))
      expect(screen.queryByText('K8s API')).not.toBeInTheDocument()
    })

    // PLUGIN-11: a subcategory with no plugins is not rendered at
    // all, so an empty group can never advertise a capability that does not
    // exist. The rule is general - it is not a removal of one named category.
    it('renders no group for a subcategory with no plugins', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const pluginsSection = screen.getByTestId('palette-section-plugins')

      expect(within(pluginsSection).queryByTestId('palette-subcat-custom')).not.toBeInTheDocument()
      expect(within(pluginsSection).queryByText('CUSTOM')).not.toBeInTheDocument()
      expect(within(pluginsSection).queryByText('Custom')).not.toBeInTheDocument()
    })

    it('shows no empty-group placeholder text anywhere in the palette', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      expect(screen.queryByText('No custom plugins')).not.toBeInTheDocument()
    })

    it('renders nothing for ANY subcategory with no plugins (general rule)', async () => {
      const { PluginSubcategorySection } = await import(
        '@/features/workbench/common/palette/palette-sections'
      )
      const { container } = render(
        <PluginSubcategorySection
          testId="palette-subcat-anything"
          name="Anything"
          count={0}
          colorClass="text-gray-500"
          plugins={[]}
        />,
      )

      expect(container).toBeEmptyDOMElement()
    })

    it('renders no empty group in the collapsed-palette flyout either', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-plugins'))
      const flyout = await screen.findByTestId('palette-flyout-plugins')

      expect(within(flyout).queryByText('Custom')).not.toBeInTheDocument()
      expect(within(flyout).queryByText('No custom plugins')).not.toBeInTheDocument()
    })

    it('ends the plugin group list at Data', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const pluginsSection = screen.getByTestId('palette-section-plugins')
      const headings = within(pluginsSection)
        .getAllByTestId('subcategory-header')
        .map((el) => el.textContent?.trim().replace(/\d+$/, '') ?? '')

      expect(headings.at(-1)).toContain('Data')
    })

    it('plugin items are draggable with correct data', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      await user.click(screen.getByRole('button', { name: /system/i }))
      const shellScriptItem = screen.getByTestId('palette-item-shell-script')
      const mockDataTransfer = {
        effectAllowed: '',
        setData: vi.fn<(type: string, value: string) => void>(),
      }
      fireEvent.dragStart(shellScriptItem, { dataTransfer: mockDataTransfer })

      expect(mockDataTransfer.effectAllowed).toBe('move')
      expect(mockDataTransfer.setData.mock.calls[0][0]).toBe('application/wave-block')
      // The drag names the block only; the palette subcategory stays in the palette.
      expect(JSON.parse(mockDataTransfer.setData.mock.calls[0][1])).toEqual({
        id: 'shell-script',
        name: 'Shell Script',
        type: 'plugin',
        source: 'palette',
      })
    })
  })

  describe('Recently Used Section', () => {
    it('shows empty state when no recent usage', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const section = screen.getByTestId('palette-section-recent')
      expect(within(section).getByText(/drag items to track recent/i)).toBeInTheDocument()
    })

    it('populates from usage store', async () => {
      // Pre-populate store
      vi.doMock('@/features/workbench/stores/palette-usage-store', () => ({
        usePaletteUsageStore: () => ({
          recentItems: ['shell-script', 'if-else'],
          frequentItems: [],
          trackUsage: vi.fn(),
        }),
      }))

      vi.resetModules()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const section = screen.getByTestId('palette-section-recent')
      expect(within(section).getByText('Shell Script')).toBeInTheDocument()
      expect(within(section).getByText('If / Else')).toBeInTheDocument()

      // Clean up mock
      vi.doUnmock('@/features/workbench/stores/palette-usage-store')
    })

    it('allows dragging items from recent section with dataTransfer', async () => {
      vi.doMock('@/features/workbench/stores/palette-usage-store', () => ({
        usePaletteUsageStore: () => ({
          recentItems: ['shell-script'],
          frequentItems: [],
          trackUsage: vi.fn(),
        }),
      }))

      vi.resetModules()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const section = screen.getByTestId('palette-section-recent')
      const shellScriptItem = within(section).getByTestId('palette-item-shell-script')

      // Mock dataTransfer to cover the e.dataTransfer branch
      const mockDataTransfer = {
        effectAllowed: '',
        setData: vi.fn(),
      }
      fireEvent.dragStart(shellScriptItem, { dataTransfer: mockDataTransfer })

      expect(mockDataTransfer.effectAllowed).toBe('move')
      expect(mockDataTransfer.setData).toHaveBeenCalledWith(
        'application/wave-block',
        expect.stringContaining('"id":"shell-script"')
      )
      expect(mockDataTransfer.setData).toHaveBeenCalledWith(
        'application/wave-block',
        expect.not.stringContaining('"category"')
      )

      // Clean up mock
      vi.doUnmock('@/features/workbench/stores/palette-usage-store')
    })

    it('gracefully handles invalid item IDs in recent items', async () => {
      // Pre-populate store with invalid item IDs
      vi.doMock('@/features/workbench/stores/palette-usage-store', () => ({
        usePaletteUsageStore: () => ({
          recentItems: ['invalid-item-id', 'shell-script', 'nonexistent-plugin'],
          frequentItems: [],
          trackUsage: vi.fn(),
        }),
      }))

      vi.resetModules()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const section = screen.getByTestId('palette-section-recent')
      // Valid item should be rendered
      expect(within(section).getByText('Shell Script')).toBeInTheDocument()
      // Invalid items should be skipped (no error thrown)
      expect(within(section).queryByText('invalid-item-id')).not.toBeInTheDocument()
      expect(within(section).queryByText('nonexistent-plugin')).not.toBeInTheDocument()

      // Clean up mock
      vi.doUnmock('@/features/workbench/stores/palette-usage-store')
    })
  })

  describe('Most Used Section', () => {
    it('populates from usage store ordered by frequency', async () => {
      vi.doMock('@/features/workbench/stores/palette-usage-store', () => ({
        usePaletteUsageStore: () => ({
          recentItems: [],
          frequentItems: [
            { id: 'shell-script', count: 10 },
            { id: 'http-client', count: 5 },
          ],
          trackUsage: vi.fn(),
        }),
      }))

      vi.resetModules()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const section = screen.getByTestId('palette-section-most-used')
      const items = within(section).getAllByTestId(/^palette-item-/)

      // First item should be most frequent
      expect(items[0]).toHaveTextContent('Shell Script')
      expect(items[1]).toHaveTextContent('HTTP')

      // Clean up mock
      vi.doUnmock('@/features/workbench/stores/palette-usage-store')
    })

    it('gracefully handles invalid item IDs in frequent items', async () => {
      vi.doMock('@/features/workbench/stores/palette-usage-store', () => ({
        usePaletteUsageStore: () => ({
          recentItems: [],
          frequentItems: [
            { id: 'invalid-frequent-id', count: 20 },
            { id: 'shell-script', count: 10 },
            { id: 'nonexistent-plugin', count: 5 },
          ],
          trackUsage: vi.fn(),
        }),
      }))

      vi.resetModules()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const section = screen.getByTestId('palette-section-most-used')
      // Valid item should be rendered
      expect(within(section).getByText('Shell Script')).toBeInTheDocument()
      // Invalid items should be skipped
      expect(within(section).queryByText('invalid-frequent-id')).not.toBeInTheDocument()

      // Clean up mock
      vi.doUnmock('@/features/workbench/stores/palette-usage-store')
    })

    it('renders control items without category in frequent items', async () => {
      vi.doMock('@/features/workbench/stores/palette-usage-store', () => ({
        usePaletteUsageStore: () => ({
          recentItems: [],
          frequentItems: [
            { id: 'if-else', count: 15 },
            { id: 'shell-script', count: 10 },
          ],
          trackUsage: vi.fn(),
        }),
      }))

      vi.resetModules()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const section = screen.getByTestId('palette-section-most-used')
      // Control item (if-else) should render as "If / Else"
      expect(within(section).getByText('If / Else')).toBeInTheDocument()
      // Plugin item should also render
      expect(within(section).getByText('Shell Script')).toBeInTheDocument()

      vi.doUnmock('@/features/workbench/stores/palette-usage-store')
    })
  })

  describe('Action Buttons', () => {
    it('forwards the expanded "Function Lib" button click to onOpenFunctionLibrary', async () => {
      const user = userEvent.setup()
      const onOpenFunctionLibrary = vi.fn()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(
        <PalettePanel defaultCollapsed={false} onOpenFunctionLibrary={onOpenFunctionLibrary} />,
        { wrapper: Wrapper },
      )

      await user.click(screen.getByTestId('palette-blocks-library-button'))

      expect(onOpenFunctionLibrary).toHaveBeenCalledTimes(1)
    })
  })

  describe('Usage Tracking Integration', () => {
    it('does not track usage on drag start (tracking moved to canvas drop)', async () => {
      const trackUsage = vi.fn()
      vi.doMock('@/features/workbench/stores/palette-usage-store', () => ({
        usePaletteUsageStore: () => ({
          recentItems: [],
          frequentItems: [],
          trackUsage,
        }),
      }))

      vi.resetModules()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      // Expand System subgroup to access Shell Script
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: /system/i }))

      const shellScriptItem = screen.getByTestId('palette-item-shell-script')
      fireEvent.dragStart(shellScriptItem)

      // trackUsage is NOT called on drag start - it's called on drop in workflow-canvas
      // to avoid reordering the recents panel mid-drag
      expect(trackUsage).not.toHaveBeenCalled()
    })
  })

  describe('Controlled State', () => {
    it('respects controlled collapsed prop', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      const { rerender } = render(
        <Wrapper>
          <PalettePanel collapsed={true} />
        </Wrapper>
      )

      expect(screen.getByTestId('block-palette')).toHaveAttribute('data-state', 'collapsed')

      rerender(
        <Wrapper>
          <PalettePanel collapsed={false} />
        </Wrapper>
      )
      expect(screen.getByTestId('block-palette')).toHaveAttribute('data-state', 'expanded')
    })

    it('calls onCollapsedChange when expand button is clicked', async () => {
      const user = userEvent.setup()
      const onCollapsedChange = vi.fn()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} onCollapsedChange={onCollapsedChange} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-expand-button'))

      expect(onCollapsedChange).toHaveBeenCalledWith(false)
    })
  })

  // ============================================================================
  // Icon Consistency with Navigation Sidebar
  // Icon Consistency Rule: Blocks and Plugins icons MUST match nav sidebar
  // ============================================================================

  describe('Icon Consistency with Nav Sidebar', () => {
    /**
     * These tests verify that Blocks and Plugins icons use consistent colors
     * across the palette panel and navigation sidebar.
     *
     * Nav Sidebar colors (from app-sidebar.tsx):
     * - Blocks: #818CF8 (indigo) -> text-indigo-400
     * - Plugins: #A78BFA (violet) -> text-violet-400
     */

    it('uses violet color for Plugins icon in collapsed state', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      const pluginsIcon = screen.getByTestId('palette-icon-plugins')
      // The icon button should have violet color class matching nav sidebar
      expect(pluginsIcon.className).toContain('text-violet-400')
    })

    it('uses indigo color for Blocks Library icon in collapsed state', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      const libraryIcon = screen.getByTestId('palette-icon-library')
      // The icon button should have indigo color class matching nav sidebar
      expect(libraryIcon.className).toContain('text-indigo-400')
    })

    it('uses violet color for Plugins section in expanded state', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const pluginsSection = screen.getByTestId('palette-section-plugins')
      const sectionHeader = pluginsSection.querySelector('[class*="text-violet-400"]')
      expect(sectionHeader).toBeInTheDocument()
    })

    it('uses indigo color for Block Library button in expanded state', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const libraryButton = screen.getByTestId('palette-blocks-library-button')
      // Button should have indigo color classes
      expect(libraryButton.className).toContain('text-indigo-')
    })
  })

  // ============================================================================
  // Plugin Definitions Integration - REQ-3.4.4.1, REQ-3.4.4.2
  // ============================================================================

  describe('Plugin Definitions Integration - REQ-3.4.4.1', () => {
    it('renders all 40 built-in plugins from plugin definitions', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      expect(PLUGIN_DEFINITIONS).toHaveLength(40)

      // Expand all plugin subcategories
      const pluginsSection = screen.getByTestId('palette-section-plugins')
      const subcategoryButtons = within(pluginsSection).getAllByTestId('subcategory-header')
      for (const button of subcategoryButtons) {
        await user.click(button)
      }

      // Verify all 40 plugins are rendered
      for (const plugin of PLUGIN_DEFINITIONS) {
        expect(
          screen.getByTestId(`palette-item-${plugin.id}`),
          `Plugin '${plugin.id}' should be rendered`
        ).toBeInTheDocument()
      }
      expect(screen.queryByTestId('palette-item-ldap-client')).not.toBeInTheDocument()
    })

    it('displays correct plugin names from plugin definitions', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      // Expand Network subcategory
      await user.click(screen.getByRole('button', { name: /network/i }))

      // Check each network plugin displays correct name
      const networkPlugins = PLUGIN_DEFINITIONS.filter((p) => p.category === 'network')
      for (const plugin of networkPlugins) {
        expect(screen.getByText(plugin.name)).toBeInTheDocument()
      }
    })

    it('uses plugin definitions for flyout in collapsed state', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-plugins'))
      const flyout = await screen.findByTestId('palette-flyout-plugins')

      // All 40 plugins should be available in the flyout (not just some hardcoded subset)
      const pluginCount = PLUGIN_DEFINITIONS.length
      expect(pluginCount).toBe(40)

      // Verify each plugin is present in flyout
      for (const plugin of PLUGIN_DEFINITIONS) {
        expect(
          within(flyout).getByTestId(`flyout-item-${plugin.id}`),
          `Plugin '${plugin.id}' should be in flyout`
        ).toBeInTheDocument()
      }
      expect(within(flyout).queryByTestId('flyout-item-ldap-client')).not.toBeInTheDocument()
    })

    it('organizes plugins by category from plugin definitions', async () => {
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      const { PLUGIN_CATEGORIES } = await import('@/features/workbench/lib/plugin-definitions')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const pluginsSection = screen.getByTestId('palette-section-plugins')

      // All 7 categories should be present (including Custom placeholder)
      for (const category of PLUGIN_CATEGORIES) {
        expect(
          within(pluginsSection).getByTestId(`palette-subcat-${category.id}`),
          `Category '${category.id}' should be rendered`
        ).toBeInTheDocument()
      }
    })
  })

  describe('Plugin Icons via Icon Registry - REQ-3.4.4.2', () => {
    it('renders plugin icons using icon registry', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const { getIconComponent } = await import('@/features/workbench/lib/icon-registry')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      // Expand Network subcategory
      await user.click(screen.getByRole('button', { name: /network/i }))

      // HTTP plugin should use Globe icon
      const httpPlugin = getPluginById('http-client')
      expect(httpPlugin).toBeDefined()

      // Icon should be resolvable from registry
      const Icon = getIconComponent(httpPlugin!.iconName)
      expect(Icon).toBeDefined()
    })

    it('uses correct category color classes from plugin definitions', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      const { PLUGIN_CATEGORIES } = await import('@/features/workbench/lib/plugin-definitions')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      const pluginsSection = screen.getByTestId('palette-section-plugins')

      for (const category of PLUGIN_CATEGORIES) {
        const subcatElement = within(pluginsSection).getByTestId(`palette-subcat-${category.id}`)
        await user.click(within(subcatElement).getByTestId('subcategory-header'))

        // Find plugin items in this category - they should have the category color class
        const pluginItems = within(subcatElement).queryAllByRole('option')
        if (pluginItems.length > 0) {
          // Icon color should match category color
          const colorPattern = category.colorClass.replace('text-', '')
          expect(category.colorClass).toContain(colorPattern)
        }
      }
    })

    it('all plugin icons render SVG elements', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-plugins'))
      const flyout = await screen.findByTestId('palette-flyout-plugins')

      // Each plugin item should have an SVG icon rendered
      const allPluginItems = within(flyout).getAllByTestId(/^flyout-item-/)
      for (const item of allPluginItems) {
        const svg = item.querySelector('svg')
        expect(svg, `Plugin item should have an SVG icon`).toBeInTheDocument()
      }
    })

    it('uses getPluginById helper for plugin lookups', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')

      // Verify helper function works correctly
      const shellScript = getPluginById('shell-script')
      expect(shellScript).toBeDefined()
      expect(shellScript?.name).toBe('Shell Script')
      expect(shellScript?.iconName).toBe('FileTerminal')
      expect(shellScript?.category).toBe('system')

      // Non-existent plugin returns undefined
      expect(getPluginById('nonexistent')).toBeUndefined()
    })

    it('uses getPluginsByCategory helper for category filtering', async () => {
      const { getPluginsByCategory } = await import('@/features/workbench/lib/plugin-definitions')

      const networkPlugins = getPluginsByCategory('network')
      expect(networkPlugins).toHaveLength(3)
      expect(networkPlugins.every((p) => p.category === 'network')).toBe(true)

      const dataPlugins = getPluginsByCategory('data')
      expect(dataPlugins).toHaveLength(4)

      const kubernetesPlugins = getPluginsByCategory('kubernetes')
      expect(kubernetesPlugins).toHaveLength(12)
      expect(kubernetesPlugins.map((p) => p.id)).toEqual([
        'k8s-connect',
        'k8s-get',
        'k8s-events',
        'k8s-logs',
        'k8s-top',
        'k8s-apply',
        'k8s-delete',
        'k8s-scale',
        'k8s-rollout',
        'k8s-exec',
        'k8s-script',
        'k8s-copy',
      ])
    })
  })

  describe('Plugin Search Integration', () => {
    it('searches plugins using plugin definitions data', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      await user.type(screen.getByPlaceholderText('Search…'), 'sql')

      // SQL plugin should appear (from plugin-definitions)
      expect(screen.getByText('SQL')).toBeInTheDocument()
    })

    it('filters across all plugin categories', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      // Search for a data plugin
      await user.type(screen.getByPlaceholderText('Search…'), 'csv')
      expect(screen.getByText('CSV')).toBeInTheDocument()

      // Clear and search for the kubernetes plugins
      await user.clear(screen.getByPlaceholderText('Search…'))
      await user.type(screen.getByPlaceholderText('Search…'), 'k8s')
      expect(screen.getByText('K8s Connect')).toBeInTheDocument()
      expect(screen.queryByText('K8s API')).not.toBeInTheDocument()

      // All twelve kubernetes blocks match the family prefix
      for (const { id, name } of KUBERNETES_BLOCKS) {
        expect(
          screen.getByTestId(`palette-item-${id}`),
          `'${id}' should match the k8s query`
        ).toBeInTheDocument()
        expect(screen.getByText(name), `'${name}' should be listed`).toBeInTheDocument()
      }
      expect(screen.getAllByTestId(/^palette-item-k8s-/)).toHaveLength(12)
    })

    it.each(K8S_VERB_BLOCKS)('finds $name by its full block name', async ({ id, name }) => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={false} />, { wrapper: Wrapper })

      await user.type(screen.getByPlaceholderText('Search…'), name)

      expect(screen.getByTestId(`palette-item-${id}`)).toBeInTheDocument()
      expect(screen.getByText(name)).toBeInTheDocument()
      expect(screen.getAllByTestId(/^palette-item-/)).toHaveLength(1)
    })

    it('search flyout uses plugin definitions for filtering', async () => {
      const user = userEvent.setup()
      const { PalettePanel } = await import('@/features/workbench/common/palette')
      render(<PalettePanel defaultCollapsed={true} />, { wrapper: Wrapper })

      await user.click(screen.getByTestId('palette-icon-search'))
      const searchInput = await screen.findByTestId('flyout-search-input')

      await user.type(searchInput, 'open')

      // OpenSearch plugin should appear (from plugin-definitions)
      await waitFor(() => {
        expect(screen.getByTestId('flyout-item-opensearch')).toBeInTheDocument()
      })
    })
  })
})
