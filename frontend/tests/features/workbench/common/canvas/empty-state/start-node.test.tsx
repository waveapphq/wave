/**
 * StartNode Tests
 *
 * Tests for the start node component shown in empty canvas state.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StartNode } from '@/features/workbench/common/canvas/empty-state/start-node'

describe('StartNode', () => {
  describe('Basic rendering', () => {
    it('renders with correct testid', () => {
      render(<StartNode />)
      expect(screen.getByTestId('start-node')).toBeInTheDocument()
    })

    it('renders play icon', () => {
      render(<StartNode />)
      expect(screen.getByTestId('start-node-icon')).toBeInTheDocument()
    })

    it('renders Start label', () => {
      render(<StartNode />)
      expect(screen.getByTestId('start-node-label')).toHaveTextContent('Start')
    })

    it('has success variant styling', () => {
      render(<StartNode />)
      expect(screen.getByTestId('start-node')).toHaveAttribute('data-variant', 'success')
    })
  })

  describe('Animation state', () => {
    it('shows pulse animation when no connection (default)', () => {
      render(<StartNode />)

      const node = screen.getByTestId('start-node')
      expect(node).toHaveAttribute('data-animate', 'pulse')
      expect(node).toHaveClass('animate-pulse')
    })

    it('shows pulse animation when hasConnection is false', () => {
      render(<StartNode hasConnection={false} />)

      const node = screen.getByTestId('start-node')
      expect(node).toHaveAttribute('data-animate', 'pulse')
      expect(node).toHaveClass('animate-pulse')
    })

    it('does not pulse when has connection (line 35 - false branch)', () => {
      render(<StartNode hasConnection={true} />)

      const node = screen.getByTestId('start-node')
      // data-animate should not be present or should be undefined
      expect(node).not.toHaveAttribute('data-animate', 'pulse')
      expect(node).not.toHaveClass('animate-pulse')
    })
  })

  describe('Styling', () => {
    it('applies custom className', () => {
      render(<StartNode className="custom-class" />)

      expect(screen.getByTestId('start-node')).toHaveClass('custom-class')
    })

    it('has green border styling', () => {
      render(<StartNode />)

      expect(screen.getByTestId('start-node')).toHaveClass('border-green-500')
    })

    it('has green background tint', () => {
      render(<StartNode />)

      expect(screen.getByTestId('start-node')).toHaveClass('bg-green-500/10')
    })
  })
})
