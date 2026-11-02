/**
 * StoredPasswordField tests
 *
 * A Settings password that may already be stored. Untouched (value undefined)
 * with a stored password, it shows the masked stored-secret control; a click
 * asks "Edit Protected Value?" and "Delete & Edit" empties the field for typing.
 * A password being typed starts hidden and has an eye button that shows and
 * hides it. The row's id and description follow whichever control is showing.
 *
 * MCP-7, NET-10: a saved password shows in the masked field every protected value uses
 * REQ-3.1.3.5: Secret variable masking
 */

import { useState, type ComponentProps } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { StoredPasswordField } from '@/features/settings/components/stored-password-field'

type StoredPasswordFieldProps = ComponentProps<typeof StoredPasswordField>

const ROW_ID = 'settings-password'
const HELP_ID = 'settings-password-help'
const HELP_TEXT = 'Row help line'
const CONFIRM_TITLE = 'Edit Protected Value?'

interface PasswordRowProps extends Omit<StoredPasswordFieldProps, 'id' | 'value'> {
  initialValue?: string
}

// Stands in for the page: a labeled row that stages the value and can discard it.
function PasswordRow({ initialValue, onChange, ...field }: Readonly<PasswordRowProps>) {
  const [value, setValue] = useState<string | undefined>(initialValue)
  return (
    <>
      <label htmlFor={ROW_ID}>Password</label>
      <StoredPasswordField
        {...field}
        id={ROW_ID}
        value={value}
        onChange={(next) => {
          onChange(next)
          setValue(next)
        }}
      />
      <p id={HELP_ID}>{HELP_TEXT}</p>
      <button type="button" onClick={() => setValue(undefined)}>
        Discard page changes
      </button>
    </>
  )
}

function renderRow(props: Partial<PasswordRowProps> & Pick<PasswordRowProps, 'stored'>) {
  const onChange = vi.fn<(value: string) => void>()
  const result = render(<PasswordRow onChange={onChange} {...props} />)
  return { ...result, onChange }
}

// The control the row's label points at, whichever one is showing.
function rowControl(): HTMLElement {
  return screen.getByLabelText('Password')
}

function maskedControl(): HTMLElement {
  return screen.getByRole('button', { name: 'Edit protected value' })
}

function queryMaskedControl(): HTMLElement | null {
  return screen.queryByRole('button', { name: 'Edit protected value' })
}

function passwordInput(): HTMLInputElement {
  const control = rowControl()
  if (!(control instanceof HTMLInputElement)) {
    throw new TypeError(`The row's control is a <${control.tagName.toLowerCase()}>, not an input`)
  }
  return control
}

function confirmDialog(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: CONFIRM_TITLE })
}

function eyeButton(name: 'Show password' | 'Hide password'): HTMLElement | null {
  return screen.queryByRole('button', { name })
}

function describedByIds(element: HTMLElement): string[] {
  return (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
}

describe('StoredPasswordField', () => {
  describe('a stored password, untouched', () => {
    it('shows the masked control and no password input', () => {
      const { container } = renderRow({ stored: true })

      expect(maskedControl()).toBeInTheDocument()
      expect(container.querySelector('input')).toBeNull()
    })

    it('opens "Edit Protected Value?" on a click', async () => {
      const user = userEvent.setup()
      const { onChange } = renderRow({ stored: true })

      await user.click(maskedControl())

      expect(confirmDialog()).toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('puts the keyboard focus in the new empty password input after "Delete & Edit"', async () => {
      const user = userEvent.setup()
      renderRow({ stored: true })
      await user.tab()
      expect(maskedControl()).toHaveFocus()
      await user.keyboard('{Enter}')

      await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))

      await waitFor(() => expect(passwordInput()).toHaveFocus())
      expect(passwordInput()).toHaveValue('')
      await user.keyboard('hunter2')
      expect(passwordInput()).toHaveValue('hunter2')
    })

    it('puts the focus in the password input, not in the control focused before a click that moved none', async () => {
      const user = userEvent.setup()
      renderRow({ stored: true })
      const discard = screen.getByRole('button', { name: 'Discard page changes' })
      discard.focus()
      expect(discard).toHaveFocus()
      // A click that moves no focus, as in a browser that does not focus a clicked button.
      fireEvent.click(maskedControl())

      await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))

      await waitFor(() => expect(passwordInput()).toHaveFocus())
    })

    it.each([
      ['Cancel', async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Cancel' }))],
      ['Escape', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
    ] as const)('puts the keyboard focus back on the masked control after %s', async (_label, dismiss) => {
      const user = userEvent.setup()
      renderRow({ stored: true })
      await user.click(maskedControl())

      await dismiss(user)

      expect(confirmDialog()).not.toBeInTheDocument()
      await waitFor(() => expect(maskedControl()).toHaveFocus())
    })

    it('stays masked after Cancel, and onChange is not called', async () => {
      const user = userEvent.setup()
      const { container, onChange } = renderRow({ stored: true })
      await user.click(maskedControl())

      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(confirmDialog()).not.toBeInTheDocument()
      expect(maskedControl()).toBeInTheDocument()
      expect(container.querySelector('input')).toBeNull()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('shows an empty password input after "Delete & Edit" and reports the change as \'\'', async () => {
      const user = userEvent.setup()
      const { onChange } = renderRow({ stored: true })
      await user.click(maskedControl())

      await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))

      expect(onChange.mock.calls).toEqual([['']])
      expect(confirmDialog()).not.toBeInTheDocument()
      expect(queryMaskedControl()).not.toBeInTheDocument()
      expect(passwordInput()).toHaveValue('')
      expect(passwordInput()).toHaveAttribute('type', 'password')
    })

    it('reports each typed value after "Delete & Edit"', async () => {
      const user = userEvent.setup()
      const { onChange } = renderRow({ stored: true })
      await user.click(maskedControl())
      await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))

      await user.type(passwordInput(), 'new')

      expect(onChange.mock.calls).toEqual([[''], ['n'], ['ne'], ['new']])
      expect(passwordInput()).toHaveValue('new')
    })
  })

  describe('value and stored decide which control shows', () => {
    it('shows the password input from the start when nothing is stored', () => {
      renderRow({ stored: false })

      expect(passwordInput()).toHaveValue('')
      expect(passwordInput()).toHaveAttribute('type', 'password')
      expect(queryMaskedControl()).not.toBeInTheDocument()
    })

    it("shows the empty input, not the mask, for a stored password whose value is ''", () => {
      renderRow({ stored: true, initialValue: '' })

      expect(passwordInput()).toHaveValue('')
      expect(queryMaskedControl()).not.toBeInTheDocument()
    })

    it('shows the typed value in the input for a stored password being replaced', () => {
      renderRow({ stored: true, initialValue: 'hunter2' })

      expect(passwordInput()).toHaveValue('hunter2')
      expect(queryMaskedControl()).not.toBeInTheDocument()
    })

    it('returns to the masked control when the value goes back to undefined', async () => {
      const user = userEvent.setup()
      const { container } = renderRow({ stored: true })
      await user.click(maskedControl())
      await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))
      await user.type(passwordInput(), 'new')

      await user.click(screen.getByRole('button', { name: 'Discard page changes' }))

      expect(maskedControl()).toBeInTheDocument()
      expect(container.querySelector('input')).toBeNull()
    })

    it('asks the confirm again once the masked control is back', async () => {
      const user = userEvent.setup()
      const { onChange } = renderRow({ stored: true })
      await user.click(maskedControl())
      await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))
      await user.click(screen.getByRole('button', { name: 'Discard page changes' }))

      await user.click(maskedControl())

      expect(confirmDialog()).toBeInTheDocument()
      expect(onChange.mock.calls).toEqual([['']])
    })
  })

  describe('typing a password', () => {
    it('reports each typed value', async () => {
      const user = userEvent.setup()
      const { onChange } = renderRow({ stored: false })

      await user.type(passwordInput(), 'abc')

      expect(onChange.mock.calls).toEqual([['a'], ['ab'], ['abc']])
      expect(passwordInput()).toHaveValue('abc')
    })

    it('hides the typed value at first', async () => {
      const user = userEvent.setup()
      renderRow({ stored: false })

      await user.type(passwordInput(), 'hunter2')

      expect(passwordInput()).toHaveAttribute('type', 'password')
      expect(eyeButton('Show password')).toBeInTheDocument()
      expect(eyeButton('Hide password')).not.toBeInTheDocument()
    })

    it('shows and hides the typed value with the eye button, whose label follows', async () => {
      const user = userEvent.setup()
      renderRow({ stored: false, initialValue: 'hunter2' })

      await user.click(screen.getByRole('button', { name: 'Show password' }))

      expect(passwordInput()).toHaveAttribute('type', 'text')
      expect(passwordInput()).toHaveValue('hunter2')
      expect(eyeButton('Hide password')).toBeInTheDocument()
      expect(eyeButton('Show password')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Hide password' }))

      expect(passwordInput()).toHaveAttribute('type', 'password')
      expect(eyeButton('Show password')).toBeInTheDocument()
      expect(eyeButton('Hide password')).not.toBeInTheDocument()
    })

    it('does not report a change when the eye button is used', async () => {
      const user = userEvent.setup()
      const { onChange } = renderRow({ stored: false, initialValue: 'hunter2' })

      await user.click(screen.getByRole('button', { name: 'Show password' }))
      await user.click(screen.getByRole('button', { name: 'Hide password' }))

      expect(onChange).not.toHaveBeenCalled()
    })

    it('starts a password typed over a stored one hidden, with the eye button', async () => {
      const user = userEvent.setup()
      renderRow({ stored: true })
      await user.click(maskedControl())
      await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))

      await user.type(passwordInput(), 'new')

      expect(passwordInput()).toHaveAttribute('type', 'password')
      await user.click(screen.getByRole('button', { name: 'Show password' }))
      expect(passwordInput()).toHaveAttribute('type', 'text')
    })

    it('starts the next password hidden once the page emptied a shown one', async () => {
      const user = userEvent.setup()
      renderRow({ stored: false, initialValue: 'hunter2' })
      await user.click(screen.getByRole('button', { name: 'Show password' }))
      expect(passwordInput()).toHaveAttribute('type', 'text')

      await user.click(screen.getByRole('button', { name: 'Discard page changes' }))
      await user.type(passwordInput(), 'n')

      expect(passwordInput()).toHaveAttribute('type', 'password')
      expect(eyeButton('Show password')).toBeInTheDocument()
    })

    it('hides a shown password the moment its last character is deleted', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn<(value: string) => void>()
      render(
        <>
          <label htmlFor={ROW_ID}>Password</label>
          <StoredPasswordField id={ROW_ID} stored={false} value="h" onChange={onChange} />
        </>,
      )
      await user.click(screen.getByRole('button', { name: 'Show password' }))
      expect(passwordInput()).toHaveAttribute('type', 'text')

      await user.type(passwordInput(), '{backspace}')

      expect(onChange.mock.calls).toEqual([['']])
      expect(passwordInput()).toHaveAttribute('type', 'password')
    })
  })

  describe('disabled', () => {
    it('has no eye button while a typed value shows', () => {
      renderRow({ stored: false, initialValue: 'hunter2', disabled: true })

      expect(passwordInput()).toBeDisabled()
      expect(eyeButton('Show password')).not.toBeInTheDocument()
      expect(eyeButton('Hide password')).not.toBeInTheDocument()
    })

    it('disables the masked control, and a click opens no confirm', async () => {
      const user = userEvent.setup()
      const { onChange } = renderRow({ stored: true, disabled: true })

      expect(maskedControl()).toBeDisabled()
      await user.click(maskedControl())

      expect(confirmDialog()).not.toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('the row id and description follow the control that is showing', () => {
    function expectDescribedByHelp(control: HTMLElement) {
      expect(describedByIds(control)).toContain(screen.getByText(HELP_TEXT).id)
    }

    it('labels and describes the masked control', () => {
      renderRow({ stored: true, 'aria-describedby': HELP_ID })

      expect(rowControl()).toBe(maskedControl())
      expectDescribedByHelp(maskedControl())
    })

    it('labels and describes the password input', () => {
      renderRow({ stored: false, 'aria-describedby': HELP_ID })

      expect(rowControl()).toBe(passwordInput())
      expectDescribedByHelp(passwordInput())
    })

    it('moves both to the password input after "Delete & Edit"', async () => {
      const user = userEvent.setup()
      renderRow({ stored: true, 'aria-describedby': HELP_ID })
      await user.click(maskedControl())

      await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))

      expect(rowControl()).toBe(passwordInput())
      expectDescribedByHelp(passwordInput())
    })

    it('moves both back to the masked control when the value goes back to undefined', async () => {
      const user = userEvent.setup()
      renderRow({ stored: true, 'aria-describedby': HELP_ID })
      await user.click(maskedControl())
      await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))

      await user.click(screen.getByRole('button', { name: 'Discard page changes' }))

      expect(rowControl()).toBe(maskedControl())
      expectDescribedByHelp(maskedControl())
    })
  })

  describe('a problem the row reports for the password', () => {
    it('marks the password input invalid and draws its error border', () => {
      renderRow({ stored: false, initialValue: 'hunter2', 'aria-invalid': true })

      expect(passwordInput()).toHaveAttribute('aria-invalid', 'true')
      expect(passwordInput()).toHaveClass('border-error')
    })

    it('leaves the password input unmarked while the row reports none', () => {
      renderRow({ stored: false, initialValue: 'hunter2' })

      expect(passwordInput()).not.toHaveAttribute('aria-invalid')
      expect(passwordInput()).not.toHaveClass('border-error')
    })
  })

  describe('fieldName', () => {
    it("leads the masked control's name with the row's label", () => {
      renderRow({ stored: true, fieldName: 'Password' })

      expect(
        screen.getByRole('button', { name: 'Password: Edit protected value' }),
      ).toBeInTheDocument()
    })

    it('leaves the name of the password input alone', () => {
      renderRow({ stored: false, fieldName: 'Password', 'aria-label': 'Proxy password' })

      expect(passwordInput()).toHaveAccessibleName('Proxy password')
    })
  })

  describe('aria-label', () => {
    it('names the password input', () => {
      renderRow({ stored: false, 'aria-label': 'Proxy password' })

      expect(passwordInput()).toHaveAccessibleName('Proxy password')
    })

    it('leaves the masked control under its own name', () => {
      renderRow({ stored: true, 'aria-label': 'Proxy password' })

      expect(maskedControl()).toBeInTheDocument()
    })
  })
})
