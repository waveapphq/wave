/**
 * Canvas Action Bar - Run/Debug Scope labels (REQ-3.2.1.5).
 *
 * The Run and Debug dropdowns offer "Run Scope" /
 * "Run All" and "Debug Scope" / "Debug All". The Scope option calls
 * onRun('current') / onDebug('current').
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CanvasActionBar } from '@/features/workbench/common/canvas/canvas-action-bar/index'

describe('Canvas Action Bar - Run/Debug Scope labels', () => {
  // -------------------------------------------------------------------------
  // Run dropdown
  // -------------------------------------------------------------------------

  describe('Run split button', () => {
    it('dropdown shows the "Run Scope" option', async () => {
      const user = userEvent.setup()
      render(<CanvasActionBar status="idle" selectedEnvironment="env-1" onRun={vi.fn()} />)

      await user.click(screen.getByTestId('run-button-dropdown'))

      await waitFor(() => {
        expect(screen.getByTestId('run-current-option')).toBeInTheDocument()
      })

      const option = screen.getByTestId('run-current-option')
      expect(option.textContent).toMatch(/run scope/i)
    })

    it('dropdown does NOT show a "Run Current" label', async () => {
      const user = userEvent.setup()
      render(<CanvasActionBar status="idle" selectedEnvironment="env-1" onRun={vi.fn()} />)

      await user.click(screen.getByTestId('run-button-dropdown'))

      await waitFor(() => {
        expect(screen.getByTestId('run-current-option')).toBeInTheDocument()
      })

      const option = screen.getByTestId('run-current-option')
      expect(option.textContent).not.toMatch(/run current/i)
    })

    it('dropdown shows the "Run All" option', async () => {
      const user = userEvent.setup()
      render(<CanvasActionBar status="idle" selectedEnvironment="env-1" onRun={vi.fn()} />)

      await user.click(screen.getByTestId('run-button-dropdown'))

      await waitFor(() => {
        expect(screen.getByTestId('run-all-option')).toBeInTheDocument()
      })

      const option = screen.getByTestId('run-all-option')
      expect(option.textContent).toMatch(/run all/i)
    })

    it('clicking the Scope option calls onRun("current")', async () => {
      const user = userEvent.setup()
      const onRun = vi.fn()
      render(<CanvasActionBar status="idle" selectedEnvironment="env-1" onRun={onRun} />)

      await user.click(screen.getByTestId('run-button-dropdown'))
      await waitFor(() => {
        expect(screen.getByTestId('run-current-option')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('run-current-option'))

      expect(onRun).toHaveBeenCalledWith('current')
    })
  })

  // -------------------------------------------------------------------------
  // Debug dropdown
  // -------------------------------------------------------------------------

  describe('Debug split button', () => {
    it('dropdown shows the "Debug Scope" option', async () => {
      const user = userEvent.setup()
      render(<CanvasActionBar status="idle" selectedEnvironment="env-1" onDebug={vi.fn()} />)

      await user.click(screen.getByTestId('debug-button-dropdown'))

      await waitFor(() => {
        expect(screen.getByTestId('debug-current-option')).toBeInTheDocument()
      })

      const option = screen.getByTestId('debug-current-option')
      expect(option.textContent).toMatch(/debug scope/i)
    })

    it('dropdown does NOT show a "Debug Current" label', async () => {
      const user = userEvent.setup()
      render(<CanvasActionBar status="idle" selectedEnvironment="env-1" onDebug={vi.fn()} />)

      await user.click(screen.getByTestId('debug-button-dropdown'))

      await waitFor(() => {
        expect(screen.getByTestId('debug-current-option')).toBeInTheDocument()
      })

      const option = screen.getByTestId('debug-current-option')
      expect(option.textContent).not.toMatch(/debug current/i)
    })

    it('dropdown shows the "Debug All" option', async () => {
      const user = userEvent.setup()
      render(<CanvasActionBar status="idle" selectedEnvironment="env-1" onDebug={vi.fn()} />)

      await user.click(screen.getByTestId('debug-button-dropdown'))

      await waitFor(() => {
        expect(screen.getByTestId('debug-all-option')).toBeInTheDocument()
      })

      const option = screen.getByTestId('debug-all-option')
      expect(option.textContent).toMatch(/debug all/i)
    })

    it('clicking the Scope option calls onDebug("current")', async () => {
      const user = userEvent.setup()
      const onDebug = vi.fn()
      render(<CanvasActionBar status="idle" selectedEnvironment="env-1" onDebug={onDebug} />)

      await user.click(screen.getByTestId('debug-button-dropdown'))
      await waitFor(() => {
        expect(screen.getByTestId('debug-current-option')).toBeInTheDocument()
      })

      await user.click(screen.getByTestId('debug-current-option'))

      expect(onDebug).toHaveBeenCalledWith('current')
    })
  })
})
