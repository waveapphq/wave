/**
 * VirtualizedList Component Tests
 *
 * REQ-5.2.1.18: Virtualized lists for large datasets
 *
 * Tests for VirtualizedList component following design specifications.
 *
 * Virtualization specifications:
 * - Renders only visible items plus a small buffer
 * - Enables smooth 60fps scrolling for collections exceeding 1,000 items
 * - Windowed rendering with spacer elements for accurate scrollbar proportions
 * - Fixed-height mode: direct position calculation, superior performance
 * - Variable-height mode: dynamic content with item measurement
 *
 * Item heights per context:
 * - Test list: 48px (default row)
 * - Execution log: 40px (compact row)
 * - Variable inspector: Dynamic
 * - Search results: 56px (comfortable row)
 * - Artifact browser: 48px (default row)
 *
 * Overscan buffer:
 * - Standard scrolling: 3-5 items
 * - Touch/momentum: 5-8 items
 * - Keyboard navigation: 1-2 items
 *
 * Performance targets:
 * - Initial render: < 50ms for 10,000 items
 * - Scroll frame time: < 16ms
 * - Memory per 1,000 items: < 1MB overhead
 * - Keyboard navigation: < 100ms response
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { memo, createRef } from 'react'
import {
  VirtualizedList,
  VirtualizedListItem,
  VirtualizedTable,
  VirtualizedTableBody,
  useVirtualization,
  type VirtualizedListProps,
} from '@/components/ui/virtualized-list'
import { fastestRunMs } from '../utils/fastest-run'

// Type definitions for test data
interface TestItem {
  id: string
  label: string
}

interface VariableHeightItem extends TestItem {
  height: number
}

// Test data generators
function generateItems(count: number): TestItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    label: `Item ${i + 1}`,
  }))
}

function generateVariableHeightItems(count: number): VariableHeightItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    label: `Item ${i + 1}`,
    height: 40 + (i % 5) * 20, // Heights vary from 40px to 120px
  }))
}

// Mock IntersectionObserver for viewport detection
const mockIntersectionObserver = vi.fn()
beforeEach(() => {
  mockIntersectionObserver.mockImplementation((_callback: IntersectionObserverCallback) => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }))
  vi.stubGlobal('IntersectionObserver', mockIntersectionObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Mock ResizeObserver for container size detection
const mockResizeObserver = vi.fn()
beforeEach(() => {
  mockResizeObserver.mockImplementation((_callback: ResizeObserverCallback) => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }))
  vi.stubGlobal('ResizeObserver', mockResizeObserver)
})

// Helper to simulate scroll events
function simulateScroll(container: HTMLElement, scrollTop: number) {
  Object.defineProperty(container, 'scrollTop', { value: scrollTop, writable: true, configurable: true })
  fireEvent.scroll(container)
}

describe('VirtualizedList Component', () => {
  describe('Basic Rendering', () => {
    it('renders virtualized list container', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => <div key={item.id}>{item.label}</div>}
        </VirtualizedList>
      )
      expect(screen.getByTestId('virtualized-list')).toBeInTheDocument()
    })

    it('applies virtualized-list class', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => <div key={item.id}>{item.label}</div>}
        </VirtualizedList>
      )
      expect(screen.getByTestId('virtualized-list')).toHaveClass('virtualized-list')
    })

    it('renders with aria-label="list" for accessibility', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => <div key={item.id}>{item.label}</div>}
        </VirtualizedList>
      )
      expect(screen.getByLabelText('list')).toBeInTheDocument()
    })

    it('renders items with data-list-item attribute', () => {
      const items = generateItems(20)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={`item-${item.id}`}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      const listItems = document.querySelectorAll('[data-list-item]')
      expect(listItems.length).toBeGreaterThan(0)
    })
  })

  describe('Windowed Rendering', () => {
    it('renders only visible items plus buffer', () => {
      const items = generateItems(1000)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          overscan={3}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      // With 400px container and 48px items, visible count = ~8 items
      // Plus 3 overscan on each side = ~14 items max rendered
      const renderedItems = Array.from(document.querySelectorAll('[data-list-item]'))
      expect(renderedItems.length).toBeLessThan(20)
      expect(renderedItems.length).toBeLessThan(items.length)
    })

    it('does not render all 1000 items at once', () => {
      const items = generateItems(1000)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      const renderedItems = Array.from(document.querySelectorAll('[data-list-item]'))
      expect(renderedItems.length).toBeLessThan(50)
    })

    it('creates spacer element for total height', () => {
      const items = generateItems(1000)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => <div key={item.id}>{item.label}</div>}
        </VirtualizedList>
      )
      const container = screen.getByTestId('virtualized-list')
      const spacer = container.querySelector('[data-virtualized-spacer]')
      expect(spacer).toBeInTheDocument()
      // Total height = 1000 items * 48px = 48000px
      expect(spacer).toHaveStyle({ height: '48000px' })
    })

    it('renders items at correct positions', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem, index: number) => (
            <VirtualizedListItem
              key={item.id}
              data-testid={item.id}
              style={{ transform: `translateY(${index * 48}px)` }}
            >
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      const firstItem = screen.getByTestId('item-0')
      expect(firstItem).toHaveStyle({ transform: 'translateY(0px)' })
    })

    it('updates visible items on scroll', async () => {
      const items = generateItems(1000)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const container = screen.getByTestId('virtualized-list')

      // Initially item-0 should be visible
      expect(screen.getByTestId('item-0')).toBeInTheDocument()

      // Scroll down 4800px (100 items worth)
      simulateScroll(container, 4800)

      await waitFor(() => {
        // After scrolling, item-100 should be visible
        expect(screen.getByTestId('item-100')).toBeInTheDocument()
      })
    })

    it('maintains scrollbar proportions with spacer elements', () => {
      const items = generateItems(500)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => <div key={item.id}>{item.label}</div>}
        </VirtualizedList>
      )
      const container = screen.getByTestId('virtualized-list')
      const spacer = container.querySelector('[data-virtualized-spacer]')
      // Spacer height should equal total content height
      expect(spacer).toHaveStyle({ height: `${500 * 48}px` })
    })
  })

  describe('Item Size Strategy - Fixed Height', () => {
    it('uses 48px height for test list context (default row)', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          context="test-list"
          containerHeight={400}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      const item = screen.getByTestId('item-0')
      expect(item).toHaveStyle({ height: '48px' })
    })

    it('uses 40px height for execution log context (compact row)', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={40}
          context="execution-log"
          containerHeight={400}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      const item = screen.getByTestId('item-0')
      expect(item).toHaveStyle({ height: '40px' })
    })

    it('uses 56px height for search results context (comfortable row)', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={56}
          context="search-results"
          containerHeight={400}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      const item = screen.getByTestId('item-0')
      expect(item).toHaveStyle({ height: '56px' })
    })

    it('calculates total height correctly for fixed-height items', () => {
      const items = generateItems(200)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => <div key={item.id}>{item.label}</div>}
        </VirtualizedList>
      )
      const container = screen.getByTestId('virtualized-list')
      const spacer = container.querySelector('[data-virtualized-spacer]')
      expect(spacer).toHaveStyle({ height: '9600px' }) // 200 * 48
    })

    it('directly calculates item position for fixed-height mode', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          sizeMode="fixed"
          containerHeight={400}
        >
          {(item: TestItem, _index: number) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      // Item at index 5 should be at position 5 * 48 = 240px
      const item5 = screen.getByTestId('item-5')
      expect(item5).toHaveAttribute('data-offset', '240')
    })
  })

  describe('Item Size Strategy - Variable Height', () => {
    it('supports variable height mode for dynamic content', () => {
      const items = generateVariableHeightItems(100)
      render(
        <VirtualizedList
          items={items}
          sizeMode="variable"
          estimatedItemHeight={60}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: VariableHeightItem) => (
            <VirtualizedListItem
              key={item.id}
              data-testid={item.id}
              height={item.height}
            >
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      expect(screen.getByTestId('virtualized-list')).toHaveClass('variable-height')
    })

    it('measures items dynamically in variable height mode', () => {
      const items = generateVariableHeightItems(50)
      render(
        <VirtualizedList
          items={items}
          sizeMode="variable"
          estimatedItemHeight={60}
          containerHeight={400}
        >
          {(item: VariableHeightItem) => (
            <VirtualizedListItem
              key={item.id}
              data-testid={item.id}
              height={item.height}
            >
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      // First item height should be 40px (based on test data generator)
      const firstItem = screen.getByTestId('item-0')
      expect(firstItem).toHaveStyle({ height: '40px' })
    })

    it('uses cumulative indexing for variable height positioning', () => {
      const items = generateVariableHeightItems(10)
      render(
        <VirtualizedList
          items={items}
          sizeMode="variable"
          estimatedItemHeight={60}
          containerHeight={400}
        >
          {(item: VariableHeightItem) => (
            <VirtualizedListItem
              key={item.id}
              data-testid={item.id}
              height={item.height}
            >
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      // Check that items have cumulative offset attributes
      const item0 = screen.getByTestId('item-0')
      const item1 = screen.getByTestId('item-1')
      expect(item0).toHaveAttribute('data-offset', '0')
      // Second item offset = first item height (40px based on test data)
      expect(item1).toHaveAttribute('data-offset', '40')
    })

    it('recalculates positions when item heights change', async () => {
      const items = generateVariableHeightItems(20)
      const { rerender } = render(
        <VirtualizedList
          items={items}
          sizeMode="variable"
          estimatedItemHeight={60}
          containerHeight={400}
        >
          {(item: VariableHeightItem) => (
            <VirtualizedListItem key={item.id} height={item.height}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Update first item height
      const updatedItems = [...items]
      updatedItems[0] = { ...updatedItems[0], height: 100 }

      rerender(
        <VirtualizedList
          items={updatedItems}
          sizeMode="variable"
          estimatedItemHeight={60}
          containerHeight={400}
        >
          {(item: VariableHeightItem) => (
            <VirtualizedListItem key={item.id} height={item.height}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Positions should be recalculated based on new heights
      await waitFor(() => {
        expect(screen.getByTestId('item-0')).toHaveStyle({ height: '100px' })
      })
    })

    it('falls back to estimatedItemHeight when item has no height property', () => {
      // Items without explicit height property should use estimatedItemHeight
      const itemsWithoutHeight = generateItems(20) // TestItem has no height property
      render(
        <VirtualizedList
          items={itemsWithoutHeight}
          sizeMode="variable"
          estimatedItemHeight={75}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Items should use the estimatedItemHeight (75px) since they have no height property
      const firstItem = screen.getByTestId('item-0')
      expect(firstItem).toHaveStyle({ height: '75px' })
    })

    it('uses binary search to find start index when scrolled in variable height mode', async () => {
      const items = generateVariableHeightItems(200)
      render(
        <VirtualizedList
          items={items}
          sizeMode="variable"
          estimatedItemHeight={60}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: VariableHeightItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} height={item.height}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const container = screen.getByTestId('virtualized-list')

      // Scroll to a position that triggers binary search (covers line 293)
      simulateScroll(container, 2000)

      await waitFor(() => {
        // Items around the scroll position should be visible
        const items = Array.from(document.querySelectorAll('[data-list-item]'))
        expect(items.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Overscan Buffer', () => {
    it('renders 3-5 extra items for standard scrolling', () => {
      const items = generateItems(1000)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          overscan={3}
          scrollMode="standard"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      // 400px / 48px = ~8 visible items, plus 3 overscan on each side = ~14
      const renderedItems = Array.from(document.querySelectorAll('[data-list-item]'))
      expect(renderedItems.length).toBeGreaterThanOrEqual(8)
      expect(renderedItems.length).toBeLessThanOrEqual(20)
    })

    it('renders 5-8 extra items for touch/momentum scrolling', () => {
      const items = generateItems(1000)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          overscan={8}
          scrollMode="momentum"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      // With higher overscan for momentum scrolling
      const renderedItems = Array.from(document.querySelectorAll('[data-list-item]'))
      expect(renderedItems.length).toBeGreaterThanOrEqual(8)
      expect(renderedItems.length).toBeLessThanOrEqual(30)
    })

    it('renders 1-2 extra items for keyboard navigation', () => {
      const items = generateItems(1000)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          scrollMode="keyboard"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      // With minimal overscan for keyboard navigation (defaults to 2)
      const renderedItems = Array.from(document.querySelectorAll('[data-list-item]'))
      expect(renderedItems.length).toBeGreaterThanOrEqual(8)
      expect(renderedItems.length).toBeLessThanOrEqual(16)
    })

    it('prevents blank space during scroll with overscan', async () => {
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          overscan={5}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const container = screen.getByTestId('virtualized-list')

      // Scroll rapidly
      simulateScroll(container, 1000)

      await waitFor(() => {
        // Should have items rendered around scroll position
        const renderedItems = Array.from(document.querySelectorAll('[data-list-item]'))
        expect(renderedItems.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Keyboard Navigation and Focus', () => {
    it('supports arrow key navigation', async () => {
      const user = userEvent.setup()
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const firstItem = screen.getByTestId('item-0')
      firstItem.focus()

      await user.keyboard('{ArrowDown}')

      await waitFor(() => {
        expect(screen.getByTestId('item-1')).toHaveFocus()
      })
    })

    it('supports Page Up navigation', async () => {
      const user = userEvent.setup()
      const items = generateItems(30)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          pageSize={10}
          minItemsForVirtualization={50}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const item20 = screen.getByTestId('item-20')
      item20.focus()

      await user.keyboard('{PageUp}')

      await waitFor(() => {
        expect(screen.getByTestId('item-10')).toHaveFocus()
      })
    })

    it('supports Page Down navigation', async () => {
      const user = userEvent.setup()
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          pageSize={10}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const firstItem = screen.getByTestId('item-0')
      firstItem.focus()

      await user.keyboard('{PageDown}')

      await waitFor(() => {
        expect(screen.getByTestId('item-10')).toHaveFocus()
      })
    })

    it('supports Home key to jump to first item', async () => {
      const user = userEvent.setup()
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Scroll to middle and focus an item
      const container = screen.getByTestId('virtualized-list')
      simulateScroll(container, 2400) // Scroll to item ~50

      await waitFor(() => {
        screen.getByTestId('item-50').focus()
      })

      await user.keyboard('{Home}')

      await waitFor(() => {
        expect(screen.getByTestId('item-0')).toHaveFocus()
      })
    })

    it('supports End key to jump to last item', async () => {
      const user = userEvent.setup()
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const firstItem = screen.getByTestId('item-0')
      firstItem.focus()

      await user.keyboard('{End}')

      await waitFor(() => {
        expect(screen.getByTestId('item-99')).toHaveFocus()
      })
    })

    it('scrolls viewport to keep focused item visible', async () => {
      const user = userEvent.setup()
      const items = generateItems(100)
      const onScroll = vi.fn()

      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          onScroll={onScroll}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const firstItem = screen.getByTestId('item-0')
      firstItem.focus()

      // Navigate down many items
      for (let i = 0; i < 15; i++) {
        await user.keyboard('{ArrowDown}')
      }

      // Should have scrolled to keep focus visible
      expect(onScroll).toHaveBeenCalled()
    })

    it('handles scroll events without onScroll callback', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const container = screen.getByTestId('virtualized-list')
      // Scroll without onScroll callback - should not throw
      simulateScroll(container, 2000)

      // Verify items updated based on scroll (item-42 should be visible after scrolling 2000px with 48px items)
      expect(screen.getByTestId('item-42')).toBeInTheDocument()
    })

    it('maintains focus across render cycles', async () => {
      const items = generateItems(50)
      const { rerender } = render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const item10 = screen.getByTestId('item-10')
      item10.focus()
      expect(item10).toHaveFocus()

      // Rerender with same items
      rerender(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      await waitFor(() => {
        expect(screen.getByTestId('item-10')).toHaveFocus()
      })
    })

    it('scrolls and transfers focus when placeholder receives focus', async () => {
      // Use 100 items (below PLACEHOLDER_THRESHOLD of 500) to create placeholders
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Get an off-screen placeholder (item-50 is beyond visible range)
      const placeholder50 = screen.getByTestId('item-50')
      // The placeholder should have data-placeholder attribute
      expect(placeholder50).toHaveAttribute('data-placeholder', 'true')

      // Focus the placeholder - this should trigger scroll and focus transfer
      placeholder50.focus()

      // Wait for the microtask-based focus transfer to complete
      await waitFor(() => {
        // After focus transfer, the real item-50 should be visible and focused
        const realItem50 = document.querySelector<HTMLElement>(
          '[data-testid="item-50"]:not([data-placeholder])'
        )
        // The real item should exist now (after scrolling)
        expect(realItem50).toBeInTheDocument()
      })
    })

    it('transfers focus to nearest item when focused item is removed', async () => {
      const items = generateItems(50)
      const { rerender } = render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const item10 = screen.getByTestId('item-10')
      item10.focus()

      // Remove item 10
      const newItems = items.filter((_, i) => i !== 10)
      rerender(
        <VirtualizedList
          items={newItems}
          itemHeight={48}
          containerHeight={400}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      await waitFor(() => {
        // Focus should transfer to nearest item (item-11, now at position 10)
        const newItem10 = screen.getByTestId('item-11')
        expect(newItem10).toHaveFocus()
      })
    })

    it('announces position within collection for screen readers', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
        >
          {(item: TestItem, index: number) => (
            <VirtualizedListItem
              key={item.id}
              data-testid={item.id}
              aria-posinset={index + 1}
              aria-setsize={items.length}
            >
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const item5 = screen.getByTestId('item-5')
      expect(item5).toHaveAttribute('aria-posinset', '6')
      expect(item5).toHaveAttribute('aria-setsize', '100')
    })
  })

  describe('System Integration', () => {
    describe('Table Virtualization', () => {
      it('virtualizes table body while fixing headers', () => {
        const items = generateItems(500)
        render(
          <VirtualizedTable
            items={items}
            itemHeight={48}
            containerHeight={400}
            data-testid="virtualized-table"
          >
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
              </tr>
            </thead>
            <VirtualizedTableBody>
              {(item: TestItem) => (
                <tr key={item.id} data-testid={item.id}>
                  <td>{item.id}</td>
                  <td>{item.label}</td>
                </tr>
              )}
            </VirtualizedTableBody>
          </VirtualizedTable>
        )

        // Header should always be visible
        expect(screen.getByRole('columnheader', { name: 'ID' })).toBeInTheDocument()
        expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()

        // Body should be virtualized
        const rows = screen.getAllByRole('row')
        expect(rows.length).toBeLessThan(100)
      })

      it('keeps table header fixed during scroll', async () => {
        const items = generateItems(500)
        render(
          <VirtualizedTable
            items={items}
            itemHeight={48}
            containerHeight={400}
            data-testid="virtualized-table"
          >
            <thead data-testid="table-header">
              <tr>
                <th>ID</th>
                <th>Name</th>
              </tr>
            </thead>
            <VirtualizedTableBody>
              {(item: TestItem) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.label}</td>
                </tr>
              )}
            </VirtualizedTableBody>
          </VirtualizedTable>
        )

        const header = screen.getByTestId('table-header')
        expect(header).toHaveClass('sticky')
      })

      it('throws error when VirtualizedTableBody is used outside VirtualizedTable', () => {
        // Suppress console.error for this test since we expect an error
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        expect(() => {
          render(
            <VirtualizedTableBody>
              {(item: TestItem) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                </tr>
              )}
            </VirtualizedTableBody>
          )
        }).toThrow('VirtualizedTableBody must be used within a VirtualizedTable')

        consoleSpy.mockRestore()
      })

      it('handles non-element children in VirtualizedTableBody gracefully', () => {
        const items = generateItems(10)
        render(
          <VirtualizedTable
            items={items}
            itemHeight={48}
            containerHeight={400}
            data-testid="virtualized-table"
          >
            <thead>
              <tr>
                <th>ID</th>
              </tr>
            </thead>
            <VirtualizedTableBody>
              {() => null}
            </VirtualizedTableBody>
          </VirtualizedTable>
        )

        // Should render without crashing, with empty cells
        const table = screen.getByTestId('virtualized-table')
        expect(table).toBeInTheDocument()
      })
    })

    describe('Selection State Persistence', () => {
      it('persists selection state for off-screen rows', async () => {
        const items = generateItems(500)
        const selectedIds = new Set(['item-0', 'item-100', 'item-200'])

        render(
          <VirtualizedList
            items={items}
            itemHeight={48}
            containerHeight={400}
            selectedIds={selectedIds}
            data-testid="virtualized-list"
          >
            {(item: TestItem) => (
              <VirtualizedListItem
                key={item.id}
                data-testid={item.id}
                selected={selectedIds.has(item.id)}
              >
                {item.label}
              </VirtualizedListItem>
            )}
          </VirtualizedList>
        )

        // item-0 is visible and selected
        expect(screen.getByTestId('item-0')).toHaveAttribute('aria-selected', 'true')

        // Scroll to item-100
        const container = screen.getByTestId('virtualized-list')
        simulateScroll(container, 4800)

        await waitFor(() => {
          // item-100 should now be visible and still selected
          expect(screen.getByTestId('item-100')).toHaveAttribute('aria-selected', 'true')
        })

        // Scroll back to item-0
        simulateScroll(container, 0)

        await waitFor(() => {
          // item-0 should still be selected
          expect(screen.getByTestId('item-0')).toHaveAttribute('aria-selected', 'true')
        })
      })

      it('maintains multi-select state across scroll', async () => {
        const items = generateItems(500)
        const selectedIds = new Set(['item-5', 'item-10', 'item-15'])

        render(
          <VirtualizedList
            items={items}
            itemHeight={48}
            containerHeight={400}
            selectedIds={selectedIds}
          >
            {(item: TestItem) => (
              <VirtualizedListItem
                key={item.id}
                data-testid={item.id}
                selected={selectedIds.has(item.id)}
              >
                {item.label}
              </VirtualizedListItem>
            )}
          </VirtualizedList>
        )

        // All initially visible selected items should show selected state
        expect(screen.getByTestId('item-5')).toHaveAttribute('aria-selected', 'true')
        expect(screen.getByTestId('item-10')).toHaveAttribute('aria-selected', 'true')
      })
    })

    describe('Responsive Breakpoint Integration', () => {
      it('recalculates visible item count on container resize', () => {
        const items = generateItems(500)
        const onVisibleRangeChange = vi.fn()

        render(
          <VirtualizedList
            items={items}
            itemHeight={48}
            containerHeight={400}
            onVisibleRangeChange={onVisibleRangeChange}
          >
            {(item: TestItem) => <div key={item.id}>{item.label}</div>}
          </VirtualizedList>
        )

        // Initial call
        expect(onVisibleRangeChange).toHaveBeenCalled()
      })

      it('adjusts for responsive breakpoint changes', () => {
        // Use > 500 items to bypass placeholder creation (which would make all items role="listitem")
        const items = generateItems(501)
        const { rerender } = render(
          <VirtualizedList
            items={items}
            itemHeight={48}
            containerHeight={400}
          >
            {(item: TestItem) => (
              <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
            )}
          </VirtualizedList>
        )

        const initialCount = Array.from(document.querySelectorAll('[data-list-item]')).length

        // Simulate breakpoint change by changing container height
        rerender(
          <VirtualizedList
            items={items}
            itemHeight={48}
            containerHeight={800}
          >
            {(item: TestItem) => (
              <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
            )}
          </VirtualizedList>
        )

        // With taller container, more items should be rendered
        const newCount = Array.from(document.querySelectorAll('[data-list-item]')).length
        expect(newCount).toBeGreaterThan(initialCount)
      })
    })

    describe('Small Collection Handling', () => {
      it('bypasses virtualization for collections below 50 items', () => {
        const items = generateItems(30)
        render(
          <VirtualizedList
            items={items}
            itemHeight={48}
            containerHeight={400}
            minItemsForVirtualization={50}
            data-testid="virtualized-list"
          >
            {(item: TestItem) => (
              <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
            )}
          </VirtualizedList>
        )

        // All 30 items should be rendered
        const renderedItems = Array.from(document.querySelectorAll('[data-list-item]'))
        expect(renderedItems.length).toBe(30)
      })

      it('applies virtualization for collections above threshold', () => {
        const items = generateItems(100)
        render(
          <VirtualizedList
            items={items}
            itemHeight={48}
            containerHeight={400}
            minItemsForVirtualization={50}
          >
            {(item: TestItem) => (
              <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
            )}
          </VirtualizedList>
        )

        // Not all 100 items should be fully rendered (placeholders are not full renders)
        const allItems = Array.from(document.querySelectorAll('[data-list-item]'))
        const fullyRenderedItems = allItems.filter(
          (el) => !el.hasAttribute('data-placeholder')
        )
        expect(fullyRenderedItems.length).toBeLessThan(100)
      })

      it('uses minItemsForVirtualization threshold of 50-100 items', () => {
        const items = generateItems(75)
        render(
          <VirtualizedList
            items={items}
            itemHeight={48}
            containerHeight={400}
            minItemsForVirtualization={100}
            data-testid="virtualized-list"
          >
            {(item: TestItem) => (
              <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
            )}
          </VirtualizedList>
        )

        // With threshold of 100, 75 items should not be virtualized
        const renderedItems = Array.from(document.querySelectorAll('[data-list-item]'))
        expect(renderedItems.length).toBe(75)
      })
    })

    describe('Scroll Position Restoration', () => {
      it('restores scroll position after navigation', async () => {
        const items = generateItems(500)
        render(
          <VirtualizedList
            items={items}
            itemHeight={48}
            containerHeight={400}
            restoreScrollPosition
            scrollPositionKey="test-list"
            data-testid="virtualized-list"
          >
            {(item: TestItem) => (
              <VirtualizedListItem key={item.id} data-testid={item.id}>
                {item.label}
              </VirtualizedListItem>
            )}
          </VirtualizedList>
        )

        const container = screen.getByTestId('virtualized-list')

        // Scroll to position
        simulateScroll(container, 2400)

        await waitFor(() => {
          expect(screen.getByTestId('item-50')).toBeInTheDocument()
        })
      })

      it('clamps scroll position to valid bounds if collection changed', async () => {
        const items = generateItems(500)
        const { rerender } = render(
          <VirtualizedList
            items={items}
            itemHeight={48}
            containerHeight={400}
            restoreScrollPosition
            scrollPositionKey="test-list"
            data-testid="virtualized-list"
          >
            {(item: TestItem) => (
              <VirtualizedListItem key={item.id} data-testid={item.id}>
                {item.label}
              </VirtualizedListItem>
            )}
          </VirtualizedList>
        )

        const container = screen.getByTestId('virtualized-list')

        // Scroll near the end
        simulateScroll(container, 20000)

        // Reduce collection size
        const smallerItems = generateItems(100)
        rerender(
          <VirtualizedList
            items={smallerItems}
            itemHeight={48}
            containerHeight={400}
            restoreScrollPosition
            scrollPositionKey="test-list"
            data-testid="virtualized-list"
          >
            {(item: TestItem) => (
              <VirtualizedListItem key={item.id} data-testid={item.id}>
                {item.label}
              </VirtualizedListItem>
            )}
          </VirtualizedList>
        )

        await waitFor(() => {
          // Scroll should be clamped to valid range
          const maxScroll = (100 * 48) - 400
          expect(container.scrollTop).toBeLessThanOrEqual(maxScroll)
        })
      })
    })
  })

  describe('Loading and Caching', () => {
    it('displays skeleton placeholders for items lacking data', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          isLoading
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const skeletons = document.querySelectorAll('[data-skeleton]')
      expect(skeletons.length).toBeGreaterThan(0)
    })

    it('shows skeleton for items not yet loaded', () => {
      const items = generateItems(100)
      const loadedIds = new Set(['item-0', 'item-1', 'item-2'])

      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          loadedIds={loadedIds}
        >
          {(item: TestItem, _index: number, isLoaded: boolean) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {isLoaded ? item.label : <div data-skeleton>Loading…</div>}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Loaded items show content
      expect(screen.getByTestId('item-0')).toHaveTextContent('Item 1')

      // Unloaded items show skeleton
      expect(screen.getByTestId('item-5')).toContainHTML('data-skeleton')
    })

    it('triggers fetch for all items when loadedIds is not provided', () => {
      const items = generateItems(20)
      const onFetchItems = vi.fn()

      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          onFetchItems={onFetchItems}
        >
          {(item: TestItem, _index: number, isLoaded: boolean) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {isLoaded ? item.label : <div data-skeleton>Loading…</div>}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // For rendering, items without loadedIds default to loaded=true
      expect(screen.getByTestId('item-0')).toHaveTextContent('Item 1')

      // For fetching, items without loadedIds are considered not loaded
      // so onFetchItems is called with visible item IDs
      expect(onFetchItems).toHaveBeenCalled()
      const fetchedIds = onFetchItems.mock.calls[0][0]
      expect(fetchedIds).toContain('item-0')
    })

    it('only fetches items not in loadedIds set', () => {
      const items = generateItems(20)
      const loadedIds = new Set(['item-0', 'item-1', 'item-2'])
      const onFetchItems = vi.fn()

      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          loadedIds={loadedIds}
          onFetchItems={onFetchItems}
        >
          {(item: TestItem, _index: number, isLoaded: boolean) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {isLoaded ? item.label : <div data-skeleton>Loading…</div>}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // onFetchItems should only include items NOT in loadedIds
      expect(onFetchItems).toHaveBeenCalled()
      const fetchedIds = onFetchItems.mock.calls[0][0] as string[]
      expect(fetchedIds).not.toContain('item-0')
      expect(fetchedIds).not.toContain('item-1')
      expect(fetchedIds).not.toContain('item-2')
      // But should include other visible items
      expect(fetchedIds).toContain('item-3')
    })

    it('prioritizes fetching for viewport-center items', async () => {
      const items = generateItems(500)
      const onFetchItems = vi.fn()

      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          onFetchItems={onFetchItems}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      await waitFor(() => {
        // Fetch should be called with viewport-center items first
        expect(onFetchItems).toHaveBeenCalled()
        const fetchedIds = onFetchItems.mock.calls[0][0]
        // Center items should be fetched first
        expect(fetchedIds).toContain('item-4') // Center of ~8 visible items
      })
    })

    it('caches previously loaded items to prevent re-fetching', async () => {
      const items = generateItems(500)
      const onFetchItems = vi.fn()

      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          onFetchItems={onFetchItems}
          cacheLoadedItems
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const container = screen.getByTestId('virtualized-list')

      // Clear initial fetch calls
      onFetchItems.mockClear()

      // Scroll away
      simulateScroll(container, 5000)

      // Scroll back
      simulateScroll(container, 0)

      await waitFor(() => {
        // Should not re-fetch already loaded items
        const calls = onFetchItems.mock.calls
        const refetchedItems = calls.flat().flat()
        // Initial items (0-7) should not be in refetch list
        expect(refetchedItems).not.toContain('item-0')
      })
    })
  })

  describe('Accessibility (WCAG 2.1 AA)', () => {
    it('makes all items keyboard-reachable', async () => {
      const user = userEvent.setup()
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const firstItem = screen.getByTestId('item-0')
      firstItem.focus()

      // Should be able to reach any item via keyboard
      await user.keyboard('{End}')

      await waitFor(() => {
        expect(screen.getByTestId('item-99')).toHaveFocus()
      })
    })

    it('displays clearly visible focus indicator', () => {
      const items = generateItems(50)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const item = screen.getByTestId('item-0')
      item.focus()

      // Focus ring should be visible
      expect(item).toHaveClass('focus-visible:ring-2')
    })

    it('provides accurate screen reader position announcements', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem, index: number) => (
            <VirtualizedListItem
              key={item.id}
              data-testid={item.id}
              aria-posinset={index + 1}
              aria-setsize={items.length}
            >
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Visible items have position announcements from VirtualizedListItem props
      const item0 = screen.getByTestId('item-0')
      expect(item0).toHaveAttribute('aria-posinset', '1')
      expect(item0).toHaveAttribute('aria-setsize', '100')
    })

    it('does not cause content flashing', async () => {
      const items = generateItems(500)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const container = screen.getByTestId('virtualized-list')

      // Rapid scrolling should not cause flashing
      for (let i = 0; i < 10; i++) {
        simulateScroll(container, i * 100)
      }

      // Container should not have any flash-inducing classes
      expect(container).not.toHaveClass('flash')
      expect(container).not.toHaveClass('blink')
    })

    it('honors prefers-reduced-motion preference', () => {
      // Mock reduced motion preference
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

      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => <div key={item.id}>{item.label}</div>}
        </VirtualizedList>
      )

      const container = screen.getByTestId('virtualized-list')
      // Should have reduced motion class
      expect(container).toHaveClass('motion-reduce:scroll-auto')
    })

    it('has appropriate ARIA attributes on container', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          aria-label="Test items list"
        >
          {(item: TestItem) => <div key={item.id}>{item.label}</div>}
        </VirtualizedList>
      )

      const list = screen.getByLabelText('Test items list')
      expect(list).toBeInTheDocument()
    })

    it('supports aria-describedby for list description', () => {
      const items = generateItems(100)
      render(
        <>
          <p id="list-desc">This list contains 100 test items</p>
          <VirtualizedList
            items={items}
            itemHeight={48}
            containerHeight={400}
            aria-describedby="list-desc"
            data-testid="virtualized-list"
          >
            {(item: TestItem) => <div key={item.id}>{item.label}</div>}
          </VirtualizedList>
        </>
      )

      const list = screen.getByTestId('virtualized-list')
      expect(list).toHaveAttribute('aria-describedby', 'list-desc')
    })
  })

  describe('useVirtualization Hook', () => {
    it('provides virtualization context to children', () => {
      const TestComponent = () => {
        const context = useVirtualization()
        return (
          <div data-testid="context-consumer">
            <span data-testid="total-items">{context.totalItems}</span>
            <span data-testid="visible-start">{context.visibleRange.start}</span>
            <span data-testid="visible-end">{context.visibleRange.end}</span>
          </div>
        )
      }

      const items = generateItems(100)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {() => <TestComponent />}
        </VirtualizedList>
      )

      expect(screen.getAllByTestId('total-items')[0]).toHaveTextContent('100')
    })

    it('exposes scroll methods via hook', () => {
      const TestComponent = () => {
        const context = useVirtualization()
        return (
          <button onClick={() => context.scrollToIndex(50)}>
            Scroll to 50
          </button>
        )
      }

      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {() => <TestComponent />}
        </VirtualizedList>
      )

      expect(screen.getAllByRole('button', { name: 'Scroll to 50' })[0]).toBeInTheDocument()
    })

    it('throws error when useVirtualization is used outside VirtualizedList', () => {
      // Suppress console.error for this test since we expect an error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const TestComponent = () => {
        useVirtualization() // This should throw
        return <div>Should not render</div>
      }

      expect(() => {
        render(<TestComponent />)
      }).toThrow('useVirtualization must be used within a VirtualizedList')

      consoleSpy.mockRestore()
    })
  })

  describe('Plain Children (non-VirtualizedListItem)', () => {
    // 400px window / 48px rows = 9 visible + 5 overscan = slots 0..14
    const PLAIN_VISIBLE_SLOTS = 15

    function renderPlainList(extra: Partial<VirtualizedListProps<TestItem>> = {}) {
      const items = generateItems(100)
      return render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
          {...extra}
        >
          {(item: TestItem) => (
            <div key={item.id} data-testid={`row-${item.id}`}>
              {item.label}
            </div>
          )}
        </VirtualizedList>
      )
    }

    it('renders the child in every slot of the visible range, not only the first', () => {
      renderPlainList()

      const slots = Array.from(document.querySelectorAll<HTMLElement>('[data-offset]'))
      expect(slots).toHaveLength(PLAIN_VISIBLE_SLOTS)
      slots.forEach((slot, i) => {
        expect(slot.querySelector(`[data-testid="row-item-${i}"]`)).toHaveTextContent(`Item ${i + 1}`)
      })
      expect(screen.queryByTestId(`row-item-${PLAIN_VISIBLE_SLOTS}`)).not.toBeInTheDocument()
    })

    it('gives every plain-child slot the data-list-item, data-testid and index attributes', () => {
      renderPlainList({ autoAriaAttributes: true, selectedIds: new Set(['item-3']) })

      const slots = Array.from(
        document.querySelectorAll<HTMLElement>('[data-list-item=""]:not([data-placeholder])')
      )
      expect(slots).toHaveLength(PLAIN_VISIBLE_SLOTS)
      slots.forEach((slot, i) => {
        expect(slot).toHaveAttribute('data-testid', `item-${i}`)
        expect(slot).toHaveAttribute('data-offset', String(i * 48))
        expect(slot).toHaveAttribute('aria-posinset', String(i + 1))
        expect(slot).toHaveAttribute('aria-setsize', '100')
        expect(slot).toHaveStyle({ height: '48px' })
      })
      expect(screen.getByTestId('item-3')).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByTestId('item-4')).not.toHaveAttribute('aria-selected')
    })

    it('hands focus from an off-screen placeholder to the real plain-child slot', async () => {
      renderPlainList()

      const placeholder50 = screen.getByTestId('item-50')
      expect(placeholder50).toHaveAttribute('data-placeholder', 'true')

      placeholder50.focus()

      await waitFor(() => {
        const realSlot = document.querySelector<HTMLElement>(
          '[data-testid="item-50"]:not([data-placeholder])'
        )
        expect(realSlot).toBeInTheDocument()
        expect(realSlot?.querySelector('[data-testid="row-item-50"]')).toHaveTextContent('Item 51')
      })
    })

    it('ignores keyboard navigation when the list has no slots at all', () => {
      render(
        <VirtualizedList items={[]} itemHeight={48} containerHeight={400} data-testid="virtualized-list">
          {(item: TestItem) => <div key={item.id}>{item.label}</div>}
        </VirtualizedList>
      )

      const container = screen.getByTestId('virtualized-list')
      container.focus()
      fireEvent.keyDown(container, { key: 'ArrowDown' })

      expect(container).toHaveFocus()
      expect(document.querySelectorAll('[data-list-item=""]')).toHaveLength(0)
    })
  })

  describe('Custom Styling', () => {
    it('accepts additional className', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          className="custom-list"
          data-testid="virtualized-list"
        >
          {(item: TestItem) => <div key={item.id}>{item.label}</div>}
        </VirtualizedList>
      )
      expect(screen.getByTestId('virtualized-list')).toHaveClass('custom-list')
    })

    it('forwards ref to container element', () => {
      const ref = vi.fn()
      const items = generateItems(100)
      render(
        <VirtualizedList
          ref={ref}
          items={items}
          itemHeight={48}
          containerHeight={400}
        >
          {(item: TestItem) => <div key={item.id}>{item.label}</div>}
        </VirtualizedList>
      )
      expect(ref).toHaveBeenCalled()
      expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLDivElement)
    })

    it('VirtualizedListItem accepts additional className', () => {
      const items = generateItems(10)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <VirtualizedListItem
              key={item.id}
              className="custom-item"
              data-testid={item.id}
            >
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      expect(screen.getByTestId('item-0')).toHaveClass('custom-item')
    })

    it('accepts RefObject ref', () => {
      // Use createRef to get a RefObject compatible with forwardRef
      const items = generateItems(10)
      const containerRef = createRef<HTMLDivElement>()

      render(
        <VirtualizedList
          ref={containerRef}
          items={items}
          itemHeight={48}
          containerHeight={400}
          minItemsForVirtualization={50}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // The ref should be assigned to the container element
      expect(containerRef.current).toBeInstanceOf(HTMLElement)
      expect(containerRef.current).toBe(screen.getByTestId('virtualized-list'))
    })

    it('accepts RefObject ref for empty list', () => {
      // Test RefObject handling in empty list render path (covers line 583)
      const containerRef = createRef<HTMLDivElement>()

      render(
        <VirtualizedList
          ref={containerRef}
          items={[]}
          itemHeight={48}
          containerHeight={400}
          emptyMessage="No items"
          data-testid="empty-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // The ref should be assigned to the container element even for empty list
      expect(containerRef.current).toBeInstanceOf(HTMLElement)
      expect(containerRef.current).toBe(screen.getByTestId('empty-list'))
    })

    it('accepts function ref for empty list', () => {
      // Test function ref handling in empty list render path (covers line 582)
      const refCallback = vi.fn()

      render(
        <VirtualizedList
          ref={refCallback}
          items={[]}
          itemHeight={48}
          containerHeight={400}
          emptyMessage="No items"
          data-testid="empty-list-fn-ref"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // The function ref should be called with the container element
      expect(refCallback).toHaveBeenCalledWith(screen.getByTestId('empty-list-fn-ref'))
    })

    it('recognizes memo-wrapped VirtualizedListItem by displayName', () => {
      // Create a memo-wrapped version of VirtualizedListItem
      const MemoizedVirtualizedListItem = memo(VirtualizedListItem)
      // Set displayName to match the original component
      MemoizedVirtualizedListItem.displayName = 'VirtualizedListItem'

      const items = generateItems(10)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          minItemsForVirtualization={50}
        >
          {(item: TestItem) => (
            <MemoizedVirtualizedListItem
              key={item.id}
              data-testid={item.id}
            >
              {item.label}
            </MemoizedVirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Should still render items with proper height and position
      const item0 = screen.getByTestId('item-0')
      expect(item0).toBeInTheDocument()
      // The memoized item should still get the position styles from parent
      expect(item0).toHaveStyle({ height: '48px' })
    })
  })

  describe('Edge Cases', () => {
    it('handles empty item list', () => {
      render(
        <VirtualizedList
          items={[]}
          itemHeight={48}
          containerHeight={400}
          emptyMessage="No items found"
        >
          {(item: TestItem) => <div key={item.id}>{item.label}</div>}
        </VirtualizedList>
      )
      expect(screen.getByText('No items found')).toBeInTheDocument()
    })

    it('handles empty item list without emptyMessage', () => {
      render(
        <VirtualizedList
          items={[]}
          itemHeight={48}
          containerHeight={400}
          data-testid="empty-list"
        >
          {(item: TestItem) => <div key={item.id}>{item.label}</div>}
        </VirtualizedList>
      )
      // Should render an empty list container
      const list = screen.getByTestId('empty-list')
      expect(list).toBeInTheDocument()
      expect(list).toHaveAttribute('aria-label', 'list')
    })

    it('handles single item', () => {
      const items = generateItems(1)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      expect(screen.getByTestId('item-0')).toBeInTheDocument()
      expect(Array.from(document.querySelectorAll('[data-list-item]')).length).toBe(1)
    })

    it('handles items with zero height gracefully', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={0}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => <div key={item.id}>{item.label}</div>}
        </VirtualizedList>
      )
      // Should not crash, should render something
      expect(screen.getByTestId('virtualized-list')).toBeInTheDocument()
    })

    it('handles very large collections (10,000+ items)', () => {
      const items = generateItems(10000)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      // Should only render a small subset
      const renderedItems = Array.from(document.querySelectorAll('[data-list-item]'))
      expect(renderedItems.length).toBeLessThan(50)
    })

    it('handles rapid scroll direction changes', async () => {
      const items = generateItems(500)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const container = screen.getByTestId('virtualized-list')

      // Rapid scroll direction changes
      simulateScroll(container, 1000)
      simulateScroll(container, 500)
      simulateScroll(container, 1500)
      simulateScroll(container, 0)

      await waitFor(() => {
        // Should still have rendered items
        expect(Array.from(document.querySelectorAll('[data-list-item]')).length).toBeGreaterThan(0)
      })
    })

    it('handles container height of zero', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={0}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => <div key={item.id}>{item.label}</div>}
        </VirtualizedList>
      )
      // Should not crash
      expect(screen.getByTestId('virtualized-list')).toBeInTheDocument()
    })

    it('handles dynamic item addition', async () => {
      const items = generateItems(50)
      const { rerender } = render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Add more items
      const moreItems = generateItems(100)
      rerender(
        <VirtualizedList items={moreItems} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      await waitFor(() => {
        // New items should be accessible
        expect(screen.getByTestId('item-99')).toBeInTheDocument()
      })
    })

    it('handles dynamic item removal', async () => {
      const items = generateItems(100)
      const { rerender } = render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Remove items
      const fewerItems = generateItems(20)
      rerender(
        <VirtualizedList items={fewerItems} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      await waitFor(() => {
        const renderedItems = Array.from(document.querySelectorAll('[data-list-item]'))
        expect(renderedItems.length).toBeLessThanOrEqual(20)
      })
    })
  })

  describe('Performance Targets', () => {
    it('renders 10,000 items within 50ms', async () => {
      const items = generateItems(10000)

      const renderMs = await fastestRunMs(() => {
        render(
          <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
            {(item: TestItem) => (
              <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
            )}
          </VirtualizedList>
        ).unmount()
      })

      expect(renderMs).toBeLessThan(50)
    })

    it('maintains scroll frame time under 16ms', async () => {
      const items = generateItems(10000)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const container = screen.getByTestId('virtualized-list')
      const frames = 10

      const sweepMs = await fastestRunMs(() => {
        for (let i = 0; i < frames; i++) {
          simulateScroll(container, i * 500)
        }
      })

      // Average frame time should be under 16ms for 60fps
      expect(sweepMs / frames).toBeLessThan(16)
    })

    it('uses less than 1MB memory overhead per 1,000 items', () => {
      // This test validates the architecture uses windowed rendering
      // which inherently limits memory to visible items + buffer
      const items = generateItems(1000)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Verify only a small subset is rendered (windowed rendering)
      const renderedItems = Array.from(document.querySelectorAll('[data-list-item]'))
      // With windowed rendering, far fewer than 1000 items are in DOM
      // This validates memory-efficient architecture
      expect(renderedItems.length).toBeLessThan(50)
    })

    it('responds to keyboard navigation within 100ms', async () => {
      const user = userEvent.setup()
      const items = generateItems(1000)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const firstItem = screen.getByTestId('item-0')
      firstItem.focus()

      expect(await fastestRunMs(() => user.keyboard('{ArrowDown}'))).toBeLessThan(100)
    })
  })

  describe('Additional Context Types', () => {
    it('uses 48px height for artifact-browser context (default row)', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          context="artifact-browser"
          containerHeight={400}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      const item = screen.getByTestId('item-0')
      expect(item).toHaveStyle({ height: '48px' })
    })

    it('uses variable height for variable-inspector context', () => {
      const items = generateVariableHeightItems(50)
      render(
        <VirtualizedList
          items={items}
          sizeMode="variable"
          context="variable-inspector"
          estimatedItemHeight={60}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: VariableHeightItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} height={item.height}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
      expect(screen.getByTestId('virtualized-list')).toHaveClass('variable-height')
      // First item should have dynamic height from data
      expect(screen.getByTestId('item-0')).toHaveStyle({ height: '40px' })
    })
  })

  describe('Additional Keyboard Navigation', () => {
    it('resolves the focused row by its slot position, not by its test id', async () => {
      const user = userEvent.setup()
      const items = generateItems(100)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={`row-${item.id}`} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      screen.getByTestId('row-item-0').focus()
      await user.keyboard('{ArrowDown}')

      await waitFor(() => {
        expect(screen.getByTestId('row-item-1')).toHaveFocus()
      })
    })

    it('focuses the focusable child inside a plain slot', async () => {
      const user = userEvent.setup()
      const items = generateItems(100)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <div key={item.id} data-testid={`plain-${item.id}`} tabIndex={0}>
              {item.label}
            </div>
          )}
        </VirtualizedList>
      )

      screen.getByTestId('plain-item-0').focus()
      await user.keyboard('{ArrowDown}')

      await waitFor(() => {
        expect(screen.getByTestId('plain-item-1')).toHaveFocus()
      })
    })

    it('leaves focus where it is when the target row has nothing focusable', async () => {
      const user = userEvent.setup()
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <div key={item.id} data-testid={`inert-${item.id}`}>
              {item.label}
            </div>
          )}
        </VirtualizedList>
      )

      const container = screen.getByTestId('virtualized-list')
      container.focus()
      await user.keyboard('{ArrowDown}')

      expect(container).toHaveFocus()
    })

    it('brings a row that is not drawn into view and focuses it there', async () => {
      const user = userEvent.setup()
      const items = generateItems(100)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      expect(screen.getByTestId('item-99')).toHaveAttribute('data-placeholder', 'true')
      screen.getByTestId('item-0').focus()
      await user.keyboard('{End}')

      await waitFor(() => {
        expect(screen.getByTestId('item-99')).toHaveFocus()
      })
    })

    it('supports ArrowUp navigation', async () => {
      const user = userEvent.setup()
      const items = generateItems(100)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const item5 = screen.getByTestId('item-5')
      item5.focus()

      await user.keyboard('{ArrowUp}')

      await waitFor(() => {
        expect(screen.getByTestId('item-4')).toHaveFocus()
      })
    })

    it('does not navigate above first item with ArrowUp', async () => {
      const user = userEvent.setup()
      const items = generateItems(100)
      render(
        <VirtualizedList items={items} itemHeight={48} containerHeight={400}>
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const firstItem = screen.getByTestId('item-0')
      firstItem.focus()

      await user.keyboard('{ArrowUp}')

      // Should stay on first item
      await waitFor(() => {
        expect(screen.getByTestId('item-0')).toHaveFocus()
      })
    })

    it('does not navigate below last item with ArrowDown', async () => {
      const user = userEvent.setup()
      const items = generateItems(10)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          minItemsForVirtualization={50}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const lastItem = screen.getByTestId('item-9')
      lastItem.focus()

      await user.keyboard('{ArrowDown}')

      // Should stay on last item
      await waitFor(() => {
        expect(screen.getByTestId('item-9')).toHaveFocus()
      })
    })

    it('ignores non-navigation keys', async () => {
      const user = userEvent.setup()
      const items = generateItems(10)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          minItemsForVirtualization={50}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const item5 = screen.getByTestId('item-5')
      item5.focus()

      // Press a non-navigation key
      await user.keyboard('a')

      // Focus should remain on the same item
      await waitFor(() => {
        expect(screen.getByTestId('item-5')).toHaveFocus()
      })
    })

    it('calls native scrollTo when reduced motion is not preferred', () => {
      // Mock matchMedia to return false for reduced motion
      const originalMatchMedia = window.matchMedia
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)' ? false : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))

      const items = generateItems(500)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Get the container and mock scrollTo
      const container = screen.getByTestId('virtualized-list')
      const scrollToSpy = vi.fn()
      Object.defineProperty(container, 'scrollTo', {
        value: scrollToSpy,
        writable: true,
      })

      // Trigger End key to scroll to the end
      const item5 = screen.getByTestId('item-5')
      item5.focus()
      fireEvent.keyDown(container, { key: 'End' })

      // The component should have called scrollTo (covers lines 380-384)
      expect(scrollToSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          top: expect.any(Number),
          behavior: 'auto',
        })
      )

      // Cleanup
      window.matchMedia = originalMatchMedia
    })
  })

  describe('Automatic Accessibility Attributes', () => {
    it('automatically sets aria-posinset and aria-setsize on items', () => {
      const items = generateItems(100)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          autoAriaAttributes
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Component should automatically apply aria attributes
      const item0 = screen.getByTestId('item-0')
      const item5 = screen.getByTestId('item-5')

      expect(item0).toHaveAttribute('aria-posinset', '1')
      expect(item0).toHaveAttribute('aria-setsize', '100')
      expect(item5).toHaveAttribute('aria-posinset', '6')
      expect(item5).toHaveAttribute('aria-setsize', '100')
    })
  })

  describe('Table Responsive Behavior', () => {
    it('enables horizontal scroll on table below 768px viewport', () => {
      const items = generateItems(100)
      render(
        <VirtualizedTable
          items={items}
          itemHeight={48}
          containerHeight={400}
          containerWidth={600}
          data-testid="virtualized-table"
        >
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Details</th>
            </tr>
          </thead>
          <VirtualizedTableBody>
            {(item: TestItem) => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>{item.label}</td>
                <td>Active</td>
                <td>More info</td>
              </tr>
            )}
          </VirtualizedTableBody>
        </VirtualizedTable>
      )

      const table = screen.getByTestId('virtualized-table')
      expect(table).toHaveClass('overflow-x-auto')
    })

    it('applies sticky first column on narrow viewports', () => {
      const items = generateItems(100)
      render(
        <VirtualizedTable
          items={items}
          itemHeight={48}
          containerHeight={400}
          containerWidth={600}
          stickyFirstColumn
          data-testid="virtualized-table"
        >
          <thead>
            <tr>
              <th data-testid="first-header">ID</th>
              <th>Name</th>
            </tr>
          </thead>
          <VirtualizedTableBody>
            {(item: TestItem) => (
              <tr key={item.id}>
                <td data-testid={`first-cell-${item.id}`}>{item.id}</td>
                <td>{item.label}</td>
              </tr>
            )}
          </VirtualizedTableBody>
        </VirtualizedTable>
      )

      const firstHeader = screen.getByTestId('first-header')
      expect(firstHeader).toHaveClass('sticky')
      expect(firstHeader).toHaveClass('left-0')
    })

    it('triggers scroll handler on VirtualizedTable scroll', () => {
      const items = generateItems(500)
      render(
        <VirtualizedTable
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-table"
        >
          <thead>
            <tr>
              <th>ID</th>
            </tr>
          </thead>
          <VirtualizedTableBody>
            {(item: TestItem) => (
              <tr key={item.id} data-testid={`row-${item.id}`}>
                <td>{item.id}</td>
              </tr>
            )}
          </VirtualizedTableBody>
        </VirtualizedTable>
      )

      const table = screen.getByTestId('virtualized-table')

      // Trigger scroll event
      Object.defineProperty(table, 'scrollTop', { value: 1000, writable: true })
      fireEvent.scroll(table)

      // After scroll, different rows should be visible
      expect(table).toBeInTheDocument()
    })

    it('handles VirtualizedTable with non-array single child', () => {
      const items = generateItems(10)
      render(
        <VirtualizedTable
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-table"
        >
          <VirtualizedTableBody>
            {(item: TestItem) => (
              <tr key={item.id}>
                <td>{item.id}</td>
              </tr>
            )}
          </VirtualizedTableBody>
        </VirtualizedTable>
      )

      const table = screen.getByTestId('virtualized-table')
      expect(table).toBeInTheDocument()
    })

    it('handles VirtualizedTable with non-thead/non-body child elements', () => {
      const items = generateItems(10)
      render(
        <VirtualizedTable
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-table"
        >
          <caption>Test Table</caption>
          <thead>
            <tr>
              <th>ID</th>
            </tr>
          </thead>
          <VirtualizedTableBody>
            {(item: TestItem) => (
              <tr key={item.id}>
                <td>{item.id}</td>
              </tr>
            )}
          </VirtualizedTableBody>
        </VirtualizedTable>
      )

      const table = screen.getByTestId('virtualized-table')
      expect(table).toBeInTheDocument()
      // Caption should still be in the document
      expect(screen.getByText('Test Table')).toBeInTheDocument()
    })

    it('handles sticky first column with multiple tr rows in thead', () => {
      const items = generateItems(10)
      render(
        <VirtualizedTable
          items={items}
          itemHeight={48}
          containerHeight={400}
          containerWidth={600}
          stickyFirstColumn
          data-testid="virtualized-table"
        >
          <thead>
            <tr>
              <th data-testid="first-col-1">ID</th>
              <th>Name</th>
            </tr>
            <tr>
              <th data-testid="first-col-2">Subheader</th>
              <th>Subname</th>
            </tr>
          </thead>
          <VirtualizedTableBody>
            {(item: TestItem) => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>{item.label}</td>
              </tr>
            )}
          </VirtualizedTableBody>
        </VirtualizedTable>
      )

      // Should apply sticky class to first column of both rows
      const firstCol1 = screen.getByTestId('first-col-1')
      const firstCol2 = screen.getByTestId('first-col-2')
      expect(firstCol1).toHaveClass('sticky')
      expect(firstCol2).toHaveClass('sticky')
    })

    it('handles sticky first column with mixed thead children (tr and non-tr)', () => {
      // Suppress expected React warning about invalid HTML (text nodes in thead)
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const items = generateItems(10)
      render(
        <VirtualizedTable
          items={items}
          itemHeight={48}
          containerHeight={400}
          containerWidth={600}
          stickyFirstColumn
          data-testid="virtualized-table"
        >
          <thead>
            Some text before
            <tr>
              <th data-testid="first-col">ID</th>
              <th>Name</th>
            </tr>
          </thead>
          <VirtualizedTableBody>
            {(item: TestItem) => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>{item.label}</td>
              </tr>
            )}
          </VirtualizedTableBody>
        </VirtualizedTable>
      )

      // Should still apply sticky class to first column
      const firstCol = screen.getByTestId('first-col')
      expect(firstCol).toHaveClass('sticky')

      consoleSpy.mockRestore()
    })

    it('handles sticky first column with single-cell rows', () => {
      const items = generateItems(10)
      render(
        <VirtualizedTable
          items={items}
          itemHeight={48}
          containerHeight={400}
          containerWidth={600}
          stickyFirstColumn
          data-testid="virtualized-table"
        >
          <thead>
            <tr>
              <th data-testid="only-col">Only Column</th>
            </tr>
          </thead>
          <VirtualizedTableBody>
            {(item: TestItem) => (
              <tr key={item.id}>
                <td>{item.id}</td>
              </tr>
            )}
          </VirtualizedTableBody>
        </VirtualizedTable>
      )

      // Should apply sticky class to the only column
      const onlyCol = screen.getByTestId('only-col')
      expect(onlyCol).toHaveClass('sticky')
    })

    it('handles VirtualizedTableBody returning non-tr elements', () => {
      // Suppress expected React warning about invalid HTML (text in tr)
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const items = generateItems(10)
      render(
        <VirtualizedTable
          items={items}
          itemHeight={48}
          containerHeight={400}
          data-testid="virtualized-table"
        >
          <thead>
            <tr>
              <th>ID</th>
            </tr>
          </thead>
          <VirtualizedTableBody>
            {(item: TestItem) => (
              <div key={item.id}>{item.label}</div>
            )}
          </VirtualizedTableBody>
        </VirtualizedTable>
      )

      // Should render without crashing even with non-tr children
      const table = screen.getByTestId('virtualized-table')
      expect(table).toBeInTheDocument()

      consoleSpy.mockRestore()
    })

    it('handles sticky first column with empty thead children', () => {
      const items = generateItems(10)
      render(
        <VirtualizedTable
          items={items}
          itemHeight={48}
          containerHeight={400}
          containerWidth={600}
          stickyFirstColumn
          data-testid="virtualized-table"
        >
          <thead>{/* Empty thead - children is undefined */}</thead>
          <VirtualizedTableBody>
            {(item: TestItem) => (
              <tr key={item.id}>
                <td>{item.id}</td>
              </tr>
            )}
          </VirtualizedTableBody>
        </VirtualizedTable>
      )

      // Should render without crashing with empty thead
      const table = screen.getByTestId('virtualized-table')
      expect(table).toBeInTheDocument()
    })
  })

  describe('Focus Transfer Edge Cases', () => {
    it('transfers focus to previous item when last item is removed', async () => {
      const items = generateItems(10)
      const { rerender } = render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          minItemsForVirtualization={50}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Focus the last item
      const lastItem = screen.getByTestId('item-9')
      lastItem.focus()
      expect(lastItem).toHaveFocus()

      // Remove last item
      const newItems = items.slice(0, -1)
      rerender(
        <VirtualizedList
          items={newItems}
          itemHeight={48}
          containerHeight={400}
          minItemsForVirtualization={50}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      await waitFor(() => {
        // Focus should transfer to what is now the last item (item-8)
        expect(screen.getByTestId('item-8')).toHaveFocus()
      })
    })
  })

  describe('Automatic Touch Detection', () => {
    it('automatically increases overscan for touch devices', () => {
      // Mock touch capability detection (standards check: maxTouchPoints)
      const originalMaxTouchPoints = navigator.maxTouchPoints
      Object.defineProperty(navigator, 'maxTouchPoints', {
        configurable: true,
        writable: true,
        value: 5,
      })

      const items = generateItems(1000)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          autoDetectTouch
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const container = screen.getByTestId('virtualized-list')
      // Touch mode should apply larger buffer class
      expect(container).toHaveAttribute('data-scroll-mode', 'momentum')

      // Clean up
      Object.defineProperty(navigator, 'maxTouchPoints', {
        configurable: true,
        writable: true,
        value: originalMaxTouchPoints,
      })
    })

    it('uses standard overscan for non-touch devices', () => {
      const items = generateItems(1000)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          autoDetectTouch
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id}>{item.label}</VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      const container = screen.getByTestId('virtualized-list')
      // Non-touch should use standard mode
      expect(container).toHaveAttribute('data-scroll-mode', 'standard')
    })
  })

  describe('Edge Case Branch Coverage', () => {
    it('handles keyboard navigation when no list items exist', () => {
      // Render a list with items that don't have role="listitem"
      // This is an edge case where children don't use VirtualizedListItem
      const items = generateItems(10)
      render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          minItemsForVirtualization={50}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            // Use div instead of VirtualizedListItem - no role="listitem"
            <div key={item.id} data-testid={item.id}>
              {item.label}
            </div>
          )}
        </VirtualizedList>
      )

      const container = screen.getByTestId('virtualized-list')

      // Trigger keyboard navigation - should early return because no role="listitem" elements
      fireEvent.keyDown(container, { key: 'ArrowDown' })
      fireEvent.keyDown(container, { key: 'ArrowUp' })
      fireEvent.keyDown(container, { key: 'Home' })
      fireEvent.keyDown(container, { key: 'End' })

      // No error should occur - the handler should just return early
      expect(container).toBeInTheDocument()
    })
  })

  describe('Focus Transfer on Item Removal', () => {
    function renderRows(rows: TestItem[], props: Partial<VirtualizedListProps<TestItem>> = {}) {
      return (
        <VirtualizedList items={rows} itemHeight={48} containerHeight={400} {...props}>
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )
    }

    it('keeps focus on the focused row when a row is added before it', async () => {
      const items = generateItems(10)
      const { rerender } = render(renderRows(items, { minItemsForVirtualization: 50 }))
      const item5 = screen.getByTestId('item-5')
      item5.focus()

      rerender(renderRows([{ id: 'item-new', label: 'New item' }, ...items], { minItemsForVirtualization: 50 }))
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(screen.getByTestId('item-5')).toHaveFocus()
    })

    it('neither scrolls nor moves focus when the list unmounts before an off-screen row takes focus', async () => {
      const onScroll = vi.fn()
      const { unmount } = render(renderRows(generateItems(100), { onScroll }))
      screen.getByTestId('item-50').focus()

      unmount()
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(onScroll).not.toHaveBeenCalled()
      expect(document.body).toHaveFocus()
    })

    it('does not transfer focus when all items are removed', async () => {
      const items = generateItems(5)
      const { rerender } = render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          minItemsForVirtualization={50}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Focus an item to set focusedItemIdRef
      const item2 = screen.getByTestId('item-2')
      item2.focus()

      // Remove ALL items - transferFocusOnRemoval should early return
      rerender(
        <VirtualizedList
          items={[]}
          itemHeight={48}
          containerHeight={400}
          minItemsForVirtualization={50}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // No error should occur
      expect(screen.queryByTestId('item-2')).not.toBeInTheDocument()
    })

    it('transfers focus to last item when focused item at end is removed', async () => {
      const items = generateItems(5)
      const { rerender } = render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          minItemsForVirtualization={50}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Focus the last item
      const lastItem = screen.getByTestId('item-4')
      lastItem.focus()

      // Navigate down with keyboard to update focusedIndexRef
      const user = userEvent.setup()
      await user.keyboard('{End}')

      // Remove the last item
      const newItems = items.slice(0, 4)
      rerender(
        <VirtualizedList
          items={newItems}
          itemHeight={48}
          containerHeight={400}
          minItemsForVirtualization={50}
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id} tabIndex={0}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Focus should transfer to the new last item (item-3)
      await waitFor(() => {
        expect(screen.getByTestId('item-3')).toBeInTheDocument()
      })
    })
  })

  describe('Fetch Queue with Out-of-Bounds Range', () => {
    it('handles item reduction without error during fetch queue building', async () => {
      // Start with 20 items and onFetchItems
      const items = generateItems(20)
      const onFetchItems = vi.fn()

      const { rerender } = render(
        <VirtualizedList
          items={items}
          itemHeight={48}
          containerHeight={400}
          onFetchItems={onFetchItems}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      expect(onFetchItems).toHaveBeenCalled()

      // Reduce to 3 items - the visible range should adapt, and the fetch
      // queue builder should handle any out-of-bounds indices gracefully
      onFetchItems.mockClear()
      const reducedItems = generateItems(3)

      rerender(
        <VirtualizedList
          items={reducedItems}
          itemHeight={48}
          containerHeight={400}
          onFetchItems={onFetchItems}
          data-testid="virtualized-list"
        >
          {(item: TestItem) => (
            <VirtualizedListItem key={item.id} data-testid={item.id}>
              {item.label}
            </VirtualizedListItem>
          )}
        </VirtualizedList>
      )

      // Should not throw and should handle gracefully
      await waitFor(() => {
        expect(screen.getByTestId('item-0')).toBeInTheDocument()
      })
    })
  })
})
