/**
 * Tests for Resizable components.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'

describe('Resizable Components', () => {
  describe('ResizablePanelGroup', () => {
    it('renders with default classes', () => {
      render(
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel>Panel 1</ResizablePanel>
          <ResizableHandle />
          <ResizablePanel>Panel 2</ResizablePanel>
        </ResizablePanelGroup>
      )

      // Find by the data-group attribute that the library sets
      const group = document.querySelector('[data-group="true"]')
      expect(group).toBeInTheDocument()
      expect(group).toHaveClass('flex', 'h-full', 'w-full')
    })

    it('applies custom className', () => {
      render(
        <ResizablePanelGroup orientation="horizontal" className="custom-class">
          <ResizablePanel>Panel 1</ResizablePanel>
        </ResizablePanelGroup>
      )

      const group = document.querySelector('[data-group="true"]')
      expect(group).toHaveClass('custom-class')
    })
  })

  describe('ResizablePanel', () => {
    it('renders children', () => {
      render(
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel>Panel Content</ResizablePanel>
        </ResizablePanelGroup>
      )

      expect(screen.getByText('Panel Content')).toBeInTheDocument()
    })
  })

  describe('ResizableHandle', () => {
    it('renders without handle by default', () => {
      render(
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel>Panel 1</ResizablePanel>
          <ResizableHandle />
          <ResizablePanel>Panel 2</ResizablePanel>
        </ResizablePanelGroup>
      )

      // Find by role separator
      const handle = screen.getByRole('separator')
      expect(handle).toBeInTheDocument()
      // No grip icon when withHandle is false
      expect(handle.querySelector('svg')).not.toBeInTheDocument()
    })

    it('renders with grip handle when withHandle is true', () => {
      render(
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel>Panel 1</ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel>Panel 2</ResizablePanel>
        </ResizablePanelGroup>
      )

      const handle = screen.getByRole('separator')
      // Grip icon present when withHandle is true
      expect(handle.querySelector('svg')).toBeInTheDocument()
    })

    it('applies horizontal classes by default', () => {
      render(
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel>Panel 1</ResizablePanel>
          <ResizableHandle />
          <ResizablePanel>Panel 2</ResizablePanel>
        </ResizablePanelGroup>
      )

      const handle = screen.getByRole('separator')
      expect(handle).toHaveClass('cursor-col-resize')
    })

    it('applies vertical classes when orientation is vertical', () => {
      render(
        <ResizablePanelGroup orientation="vertical">
          <ResizablePanel>Panel 1</ResizablePanel>
          <ResizableHandle orientation="vertical" />
          <ResizablePanel>Panel 2</ResizablePanel>
        </ResizablePanelGroup>
      )

      const handle = screen.getByRole('separator')
      expect(handle).toHaveClass('cursor-row-resize', 'h-px', 'w-full')
    })

    it('renders grip handle rotated for vertical orientation', () => {
      render(
        <ResizablePanelGroup orientation="vertical">
          <ResizablePanel>Panel 1</ResizablePanel>
          <ResizableHandle orientation="vertical" withHandle />
          <ResizablePanel>Panel 2</ResizablePanel>
        </ResizablePanelGroup>
      )

      const handle = screen.getByRole('separator')
      const gripContainer = handle.querySelector('div')
      expect(gripContainer).toHaveClass('rotate-90')
    })

    it('applies custom className', () => {
      render(
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel>Panel 1</ResizablePanel>
          <ResizableHandle className="custom-handle" />
          <ResizablePanel>Panel 2</ResizablePanel>
        </ResizablePanelGroup>
      )

      const handle = screen.getByRole('separator')
      expect(handle).toHaveClass('custom-handle')
    })
  })
})
