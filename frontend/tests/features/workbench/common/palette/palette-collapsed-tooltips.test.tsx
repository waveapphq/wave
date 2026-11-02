/**
 * Tests for the collapsed-palette bottom icons.
 *
 * The collapsed palette carries two bottom icons:
 *   - Plus icon, tooltip "New Function", a drag handle for a new local Function.
 *   - Library icon, tooltip "Function Lib", which invokes `onOpenFunctionLibrary`.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode } from 'react'

import { PaletteCollapsed } from '@/features/workbench/common/palette/palette-collapsed'

function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
  return <>{children}</>
}

function renderCollapsed(
  overrides: Partial<{
    onOpenFunctionLibrary: () => void
    onExpand: () => void
    disabled: boolean
  }> = {},
) {
  const props = {
    openFlyout: null,
    onFlyoutChange: vi.fn(),
    onOpenFunctionLibrary: vi.fn(),
    onExpand: vi.fn(),
    disabled: false,
    ...overrides,
  }
  render(<PaletteCollapsed {...props} />, { wrapper: Wrapper })
  return props
}

describe('PaletteCollapsed bottom icons', () => {
  it('shows "New Function" tooltip on hover/focus over the Plus icon', async () => {
    const user = userEvent.setup()
    renderCollapsed()
    const addIcon = screen.getByTestId('palette-icon-add')
    await user.hover(addIcon)
    await waitFor(() => {
      // Radix tooltip portals the content with role="tooltip"
      expect(screen.getByRole('tooltip', { name: /new function/i })).toBeInTheDocument()
    })
  })

  it('shows "Function Lib" tooltip on hover/focus over the Library (Blocks) icon', async () => {
    const user = userEvent.setup()
    renderCollapsed()
    const libIcon = screen.getByTestId('palette-icon-library')
    await user.hover(libIcon)
    await waitFor(() => {
      expect(screen.getByRole('tooltip', { name: /function lib/i })).toBeInTheDocument()
    })
  })

  it('does NOT render the legacy "New Block" or "Blocks Library" tooltip strings anywhere', async () => {
    const user = userEvent.setup()
    renderCollapsed()
    await user.hover(screen.getByTestId('palette-icon-add'))
    await user.hover(screen.getByTestId('palette-icon-library'))
    // These strings must not appear even transiently.
    expect(screen.queryByText('New Block')).not.toBeInTheDocument()
    expect(screen.queryByText('Blocks Library')).not.toBeInTheDocument()
  })

  it('clicking the Library icon invokes onOpenFunctionLibrary', async () => {
    const user = userEvent.setup()
    const props = renderCollapsed()
    await user.click(screen.getByTestId('palette-icon-library'))
    expect(props.onOpenFunctionLibrary).toHaveBeenCalledTimes(1)
  })

  it('disabled mode suppresses the Library icon click', async () => {
    const user = userEvent.setup()
    const props = renderCollapsed({ disabled: true })
    // The pointer-events-none class on the root blocks clicks; userEvent will
    // still attempt the interaction so we assert the handler is NOT called.
    await user.click(screen.getByTestId('palette-icon-library'))
    expect(props.onOpenFunctionLibrary).not.toHaveBeenCalled()
  })

  it('leaves the Plus icon click inert - the new-Function gesture is drag only', async () => {
    const user = userEvent.setup()
    const props = renderCollapsed()
    const addIcon = screen.getByTestId('palette-icon-add')
    await user.click(addIcon)
    expect(addIcon).toHaveAttribute('draggable', 'true')
    expect(props.onExpand).not.toHaveBeenCalled()
    expect(props.onOpenFunctionLibrary).not.toHaveBeenCalled()
    expect(props.onFlyoutChange).not.toHaveBeenCalled()
  })

  it('sets the function-new-local drag payload on the Plus icon dragstart', () => {
    renderCollapsed()
    const addIcon = screen.getByTestId('palette-icon-add')
    const setData = vi.fn()
    const dataTransfer = { setData, effectAllowed: '' }
    fireEvent.dragStart(addIcon, { dataTransfer })
    expect(setData).toHaveBeenCalledWith(
      'application/wave-block',
      expect.stringContaining('"type":"function-new-local"'),
    )
    expect(dataTransfer.effectAllowed).toBe('move')
  })
})
