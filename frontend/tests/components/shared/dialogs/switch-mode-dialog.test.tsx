/**
 * SwitchModeDialog - the warning a field asks before it switches into or out of {x} while it holds a value.
 *
 * REQ-3.1.1.5; FIELD-7; a confirmation never dismisses on Esc or backdrop.
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SwitchModeDialog } from '@/components/shared/dialogs/switch-mode-dialog'

type Direction = 'to-expression' | 'to-plain'

interface DialogOptions {
  open?: boolean
  direction?: Direction
  hasDefault?: boolean
  offersEmpty?: boolean
}

function renderDialog({
  open = true,
  direction = 'to-expression',
  hasDefault = true,
  offersEmpty = true,
}: DialogOptions = {}) {
  const onCancel = vi.fn()
  const onClearDefault = vi.fn()
  const onClearEmpty = vi.fn()
  render(
    <SwitchModeDialog
      open={open}
      direction={direction}
      hasDefault={hasDefault}
      offersEmpty={offersEmpty}
      onCancel={onCancel}
      onClearDefault={onClearDefault}
      onClearEmpty={onClearEmpty}
    />,
  )
  return { onCancel, onClearDefault, onClearEmpty, user: userEvent.setup() }
}

const dialog = () => screen.getByTestId('switch-mode-dialog')
const buttonLabels = () => within(dialog()).getAllByRole('button').map((button) => button.textContent)

describe('SwitchModeDialog copy (FIELD-7)', () => {
  it('asks "Switch the field to an expression?" when the field goes into {x}', () => {
    renderDialog({ direction: 'to-expression' })
    expect(screen.getByRole('alertdialog', { name: 'Switch the field to an expression?' })).toBe(dialog())
    expect(within(dialog()).getByRole('heading')).toHaveTextContent(/^Switch the field to an expression\?$/)
  })

  it('asks "Switch the field to a plain value?" when the field leaves {x}', () => {
    renderDialog({ direction: 'to-plain' })
    expect(screen.getByRole('alertdialog', { name: 'Switch the field to a plain value?' })).toBe(dialog())
    expect(within(dialog()).getByRole('heading')).toHaveTextContent(/^Switch the field to a plain value\?$/)
  })

  it.each<Direction>(['to-expression', 'to-plain'])('says the current value is cleared (%s)', (direction) => {
    renderDialog({ direction })
    expect(within(dialog()).getByText('The current value is cleared.')).toBeInTheDocument()
  })

  it('draws the X icon of the discard confirm', () => {
    renderDialog()
    expect(dialog().querySelector('[data-confirmation-icon]')).toHaveAttribute('data-icon', 'x')
  })

  it('draws the title in the normal title color, not the primary accent', () => {
    renderDialog()
    const title = within(dialog()).getByRole('heading')
    expect(title).toHaveClass('text-foreground')
    expect(title).not.toHaveClass('text-primary')
  })

  it('is wide enough for its three actions, each kept on one line', () => {
    renderDialog()
    expect(dialog()).toHaveClass('max-w-[440px]')
    expect(dialog()).not.toHaveClass('max-w-[400px]')
    for (const button of within(dialog()).getAllByRole('button')) expect(button).toHaveClass('whitespace-nowrap')
  })

  it('renders nothing while closed', () => {
    renderDialog({ open: false })
    expect(screen.queryByTestId('switch-mode-dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('SwitchModeDialog buttons (FIELD-7)', () => {
  it.each([
    ['a field with an empty value and a default', true, true, ['Cancel', 'Clear & Default', 'Clear & Empty']],
    ['a field with an empty value and no default', false, true, ['Cancel', 'Clear', 'Clear & Empty']],
    ['a field with no empty value and a default', true, false, ['Cancel', 'Clear & Default']],
    ['a field with no empty value and no default', false, false, ['Cancel', 'Clear']],
  ])('offers %s these buttons in this order', (_case, hasDefault, offersEmpty, labels) => {
    renderDialog({ hasDefault, offersEmpty })
    expect(buttonLabels()).toEqual(labels)
  })

  it.each<Direction>(['to-expression', 'to-plain'])('keeps the same buttons in both directions (%s)', (direction) => {
    renderDialog({ direction })
    expect(buttonLabels()).toEqual(['Cancel', 'Clear & Default', 'Clear & Empty'])
  })

  it('carries a test id on each button', () => {
    renderDialog()
    expect(screen.getByTestId('switch-mode-cancel')).toHaveTextContent(/^Cancel$/)
    expect(screen.getByTestId('switch-mode-clear-default')).toHaveTextContent(/^Clear & Default$/)
    expect(screen.getByTestId('switch-mode-clear-empty')).toHaveTextContent(/^Clear & Empty$/)
  })

  it('names the clear button "Clear" on a field with no default, under the same test id', () => {
    renderDialog({ hasDefault: false })
    expect(screen.getByTestId('switch-mode-clear-default')).toHaveTextContent(/^Clear$/)
  })

  it('has no Clear & Empty on a field with no empty value', () => {
    renderDialog({ offersEmpty: false })
    expect(screen.queryByTestId('switch-mode-clear-empty')).not.toBeInTheDocument()
    expect(within(dialog()).queryByText('Clear & Empty')).not.toBeInTheDocument()
  })
})

describe('SwitchModeDialog actions', () => {
  it('reports Cancel and nothing else', async () => {
    const { onCancel, onClearDefault, onClearEmpty, user } = renderDialog()
    await user.click(screen.getByTestId('switch-mode-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onClearDefault).not.toHaveBeenCalled()
    expect(onClearEmpty).not.toHaveBeenCalled()
  })

  it('reports Clear & Default once and never Clear & Empty', async () => {
    const { onClearDefault, onClearEmpty, user } = renderDialog()
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(onClearDefault).toHaveBeenCalledTimes(1)
    expect(onClearEmpty).not.toHaveBeenCalled()
  })

  it('reports Clear & Empty once and never Clear & Default', async () => {
    const { onClearDefault, onClearEmpty, user } = renderDialog()
    await user.click(screen.getByTestId('switch-mode-clear-empty'))
    expect(onClearEmpty).toHaveBeenCalledTimes(1)
    expect(onClearDefault).not.toHaveBeenCalled()
  })

  it('reports Clear as the clear-default action on a field with no default and no empty value', async () => {
    const { onClearDefault, onClearEmpty, user } = renderDialog({ hasDefault: false, offersEmpty: false })
    await user.click(screen.getByTestId('switch-mode-clear-default'))
    expect(onClearDefault).toHaveBeenCalledTimes(1)
    expect(onClearEmpty).not.toHaveBeenCalled()
  })
})

describe('SwitchModeDialog never dismisses itself', () => {
  it('stays open on Esc and reports nothing', async () => {
    const { onCancel, onClearDefault, onClearEmpty, user } = renderDialog()
    await user.keyboard('{Escape}')
    expect(dialog()).toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()
    expect(onClearDefault).not.toHaveBeenCalled()
    expect(onClearEmpty).not.toHaveBeenCalled()
  })

  it('stays open on a click on the backdrop and reports nothing', () => {
    const { onCancel, onClearDefault, onClearEmpty } = renderDialog()
    const backdrop = dialog().previousElementSibling as HTMLElement
    expect(backdrop).toHaveAttribute('data-state', 'open')
    fireEvent.pointerDown(backdrop)
    fireEvent.mouseDown(backdrop)
    fireEvent.click(backdrop)
    expect(dialog()).toBeInTheDocument()
    expect(onCancel).not.toHaveBeenCalled()
    expect(onClearDefault).not.toHaveBeenCalled()
    expect(onClearEmpty).not.toHaveBeenCalled()
  })
})

describe('SwitchModeDialog keyboard', () => {
  it('starts focus on Cancel', () => {
    renderDialog()
    expect(screen.getByTestId('switch-mode-cancel')).toHaveFocus()
  })

  it('moves Cancel, then Clear & Default, then Clear & Empty on Tab', async () => {
    const { user } = renderDialog()
    await user.tab()
    expect(screen.getByTestId('switch-mode-clear-default')).toHaveFocus()
    await user.tab()
    expect(screen.getByTestId('switch-mode-clear-empty')).toHaveFocus()
  })

  it('moves back from Clear & Empty to Clear & Default on Shift+Tab', async () => {
    const { user } = renderDialog()
    await user.tab()
    await user.tab()
    await user.tab({ shift: true })
    expect(screen.getByTestId('switch-mode-clear-default')).toHaveFocus()
  })

  it('moves from Cancel to Clear on Tab when Clear is the only other button', async () => {
    const { user } = renderDialog({ hasDefault: false, offersEmpty: false })
    await user.tab()
    expect(screen.getByTestId('switch-mode-clear-default')).toHaveFocus()
  })

  it('activates the focused button on Enter', async () => {
    const { onClearDefault, onClearEmpty, user } = renderDialog()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(onClearDefault).toHaveBeenCalledTimes(1)
    expect(onClearEmpty).not.toHaveBeenCalled()
  })

  it('activates the focused button on Space', async () => {
    const { onClearDefault, onClearEmpty, user } = renderDialog()
    await user.tab()
    await user.tab()
    await user.keyboard(' ')
    expect(onClearEmpty).toHaveBeenCalledTimes(1)
    expect(onClearDefault).not.toHaveBeenCalled()
  })
})
