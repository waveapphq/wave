/**
 * StartNodeFlow Tests - React Flow Start Node Component
 *
 * Tests the StartNodeFlow component which is the React Flow version
 * of the start node, including pulsing animation state.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StartNodeFlow } from '@/features/workbench/common/canvas/empty-state/start-node-flow'

// Mock @xyflow/react
vi.mock('@xyflow/react', () => ({
  Handle: ({ type, position, className }: { type: string; position: string; className?: string }) => (
    <div data-testid={`handle-${type}`} data-position={position} className={className} />
  ),
  Position: {
    Top: 'top',
    Bottom: 'bottom',
    Left: 'left',
    Right: 'right',
  },
}))

describe('StartNodeFlow', () => {
  describe('Rendering', () => {
    it('renders start node with label', () => {
      render(<StartNodeFlow data={{ hasConnection: false }} />)

      expect(screen.getByTestId('start-node')).toBeInTheDocument()
      expect(screen.getByTestId('start-node-label')).toHaveTextContent('Start')
    })

    it('renders play icon', () => {
      render(<StartNodeFlow data={{ hasConnection: false }} />)

      expect(screen.getByTestId('start-node-icon')).toBeInTheDocument()
    })

    it('renders output handle at bottom', () => {
      render(<StartNodeFlow data={{ hasConnection: false }} />)

      const handle = screen.getByTestId('handle-source')
      expect(handle).toBeInTheDocument()
      expect(handle).toHaveAttribute('data-position', 'bottom')
    })
  })

  describe('Pulse Animation State', () => {
    it('shows pulse animation when hasConnection is false', () => {
      render(<StartNodeFlow data={{ hasConnection: false }} />)

      const node = screen.getByTestId('start-node')
      expect(node).toHaveAttribute('data-animate', 'pulse')
      expect(node).toHaveClass('animate-pulse')
    })

    it('does not show pulse animation when hasConnection is true', () => {
      render(<StartNodeFlow data={{ hasConnection: true }} />)

      const node = screen.getByTestId('start-node')
      expect(node).not.toHaveAttribute('data-animate')
      expect(node).not.toHaveClass('animate-pulse')
    })

    it('shows pulse animation when hasConnection is undefined', () => {
      render(<StartNodeFlow data={{}} />)

      const node = screen.getByTestId('start-node')
      expect(node).toHaveAttribute('data-animate', 'pulse')
      expect(node).toHaveClass('animate-pulse')
    })
  })

  describe('Styling', () => {
    it('has success variant styling', () => {
      render(<StartNodeFlow data={{ hasConnection: false }} />)

      const node = screen.getByTestId('start-node')
      expect(node).toHaveAttribute('data-variant', 'success')
    })
  })

  describe('Proximity Glow', () => {
    it('applies proximity glow on output handle when proximitySource is true', () => {
      render(<StartNodeFlow data={{ hasConnection: false, proximitySource: true }} />)

      const handle = screen.getByTestId('handle-source')
      expect(handle.className).toContain('ring-green-400')
      expect(handle.className).toContain('animate-pulse')
    })

    it('does not apply proximity glow when proximitySource is false', () => {
      render(<StartNodeFlow data={{ hasConnection: false }} />)

      const handle = screen.getByTestId('handle-source')
      // animate-pulse on the handle is unique to proximity glow (not in base handle styles)
      expect(handle.className).not.toContain('animate-pulse')
    })
  })
})
