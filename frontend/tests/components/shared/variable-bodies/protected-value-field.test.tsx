/**
 * ProtectedValueField and useProtectedValueConfirm tests
 *
 * ProtectedValueField is the masked stored-secret control with its own
 * "Edit Protected Value?" confirm: "Delete & Edit" tells the host the stored
 * value is given up (onCleared); Cancel and Escape change nothing.
 * useProtectedValueConfirm hands the same confirm to a host that opens it from
 * a control of its own and says, per open, what runs after "Delete & Edit".
 *
 * REQ-3.1.3.5: Secret variable masking
 */

import type { ComponentProps } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  ProtectedValueField,
  useProtectedValueConfirm,
} from '@/components/shared/variable-bodies/protected-value-field'

type ProtectedValueFieldProps = ComponentProps<typeof ProtectedValueField>

const FORMS = ['pill', 'field'] as const
const CONFIRM_TITLE = 'Edit Protected Value?'
const CONFIRM_BODY =
  'Editing will permanently delete the existing protected value. You will need to enter a new value. This action cannot be undone.'

function maskedControl(): HTMLElement {
  return screen.getByRole('button', { name: 'Edit protected value' })
}

function confirmDialog(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: CONFIRM_TITLE })
}

function describedByIds(element: HTMLElement): string[] {
  return (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
}

function renderField(props: Partial<ProtectedValueFieldProps> = {}) {
  const onCleared = vi.fn<() => void>()
  const result = render(<ProtectedValueField onCleared={onCleared} {...props} />)
  return { ...result, onCleared }
}

describe('ProtectedValueField', () => {
  describe('masked control', () => {
    it('renders the masked control and no confirm', () => {
      renderField()

      expect(maskedControl()).toBeEnabled()
      expect(confirmDialog()).not.toBeInTheDocument()
    })

    it("leads the control's name with the field's label when the host gives one", () => {
      renderField({ fieldName: 'Password' })

      expect(
        screen.getByRole('button', { name: 'Password: Edit protected value' }),
      ).toBeInTheDocument()
    })

    it.each([
      ['by default', {}],
      ['when asked for the pill form', { secretAffordance: 'pill' }],
    ] as const)('keeps the lock inside the control %s', (_label, props) => {
      renderField(props)

      expect(maskedControl().querySelector('svg.lucide-lock')).not.toBeNull()
    })

    it('leaves the lock to the host in the field form (SECFLD-2)', () => {
      renderField({ secretAffordance: 'field' })

      expect(maskedControl().querySelector('svg.lucide-lock')).toBeNull()
    })

    it('puts the given id on the control', () => {
      renderField({ id: 'proxy-password' })

      expect(maskedControl()).toHaveAttribute('id', 'proxy-password')
    })

    it('points the control at the given description', () => {
      renderField({ 'aria-describedby': 'proxy-password-help' })

      expect(describedByIds(maskedControl())).toContain('proxy-password-help')
    })

    it('puts the given test id on the control', () => {
      renderField({ 'data-testid': 'proxy-password-masked' })

      expect(screen.getByTestId('proxy-password-masked')).toBe(maskedControl())
    })

    it('adds the given class to the control', () => {
      renderField({ className: 'settings-control-slot' })

      expect(maskedControl()).toHaveClass('settings-control-slot')
    })
  })

  describe('opening the confirm', () => {
    it('opens "Edit Protected Value?" with the confirm\'s texts on a click', async () => {
      const user = userEvent.setup()
      const { onCleared } = renderField()

      await user.click(maskedControl())

      const dialog = screen.getByRole('dialog', { name: CONFIRM_TITLE })
      expect(within(dialog).getByText(CONFIRM_BODY)).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Delete & Edit' })).toBeInTheDocument()
      expect(onCleared).not.toHaveBeenCalled()
    })

    it.each(FORMS)('opens the confirm from the %s form', async (secretAffordance) => {
      const user = userEvent.setup()
      renderField({ secretAffordance })

      await user.click(maskedControl())

      expect(confirmDialog()).toBeInTheDocument()
    })

    it.each([
      ['Enter', '{Enter}'],
      ['Space', ' '],
    ])('opens the confirm with %s on the focused control', async (_key, keys) => {
      const user = userEvent.setup()
      const { onCleared } = renderField()

      await user.tab()
      expect(maskedControl()).toHaveFocus()
      await user.keyboard(keys)

      expect(confirmDialog()).toBeInTheDocument()
      expect(onCleared).not.toHaveBeenCalled()
    })
  })

  describe('Cancel', () => {
    it('closes the confirm, keeps the masked control and calls nothing', async () => {
      const user = userEvent.setup()
      const { onCleared } = renderField()
      await user.click(maskedControl())

      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(confirmDialog()).not.toBeInTheDocument()
      expect(maskedControl()).toBeInTheDocument()
      expect(onCleared).not.toHaveBeenCalled()
    })

    it('treats Escape as Cancel', async () => {
      const user = userEvent.setup()
      const { onCleared } = renderField()
      await user.click(maskedControl())

      await user.keyboard('{Escape}')

      expect(confirmDialog()).not.toBeInTheDocument()
      expect(maskedControl()).toBeInTheDocument()
      expect(onCleared).not.toHaveBeenCalled()
    })

    it('asks again on the next click', async () => {
      const user = userEvent.setup()
      const { onCleared } = renderField()
      await user.click(maskedControl())
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      await user.click(maskedControl())
      await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))

      expect(onCleared.mock.calls).toEqual([[]])
    })
  })

  describe('Delete & Edit', () => {
    it('calls onCleared exactly once, with nothing, and closes the confirm', async () => {
      const user = userEvent.setup()
      const { onCleared } = renderField()
      await user.click(maskedControl())

      await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))

      expect(onCleared.mock.calls).toEqual([[]])
      expect(confirmDialog()).not.toBeInTheDocument()
    })

    it.each(FORMS)('calls onCleared once from the %s form', async (secretAffordance) => {
      const user = userEvent.setup()
      const { onCleared } = renderField({ secretAffordance })
      await user.click(maskedControl())

      await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))

      expect(onCleared).toHaveBeenCalledTimes(1)
    })
  })

  describe('keyboard focus', () => {
    it.each([
      ['Cancel', async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Cancel' }))],
      ['Escape', async (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
    ] as const)('puts focus back on the masked control after %s', async (_label, dismiss) => {
      const user = userEvent.setup()
      renderField()
      await user.tab()
      await user.keyboard('{Enter}')
      expect(confirmDialog()).toBeInTheDocument()

      await dismiss(user)

      expect(confirmDialog()).not.toBeInTheDocument()
      await waitFor(() => expect(maskedControl()).toHaveFocus())
    })

    it.each(FORMS)(
      'takes focus on a click of the %s form that moves none, so Cancel can hand it back',
      async (secretAffordance) => {
        const user = userEvent.setup()
        render(
          <>
            <input aria-label="Username" />
            <ProtectedValueField onCleared={vi.fn()} secretAffordance={secretAffordance} />
          </>,
        )
        await user.click(screen.getByRole('textbox', { name: 'Username' }))
        // A click that moves no focus, as in a browser that does not focus a clicked button.
        fireEvent.click(maskedControl())
        expect(confirmDialog()).toBeInTheDocument()

        await user.click(screen.getByRole('button', { name: 'Cancel' }))

        await waitFor(() => expect(maskedControl()).toHaveFocus())
        expect(screen.getByRole('textbox', { name: 'Username' })).not.toHaveFocus()
      },
    )
  })

  describe('disabled', () => {
    it.each(FORMS)('disables the %s control, and a click opens no confirm', async (secretAffordance) => {
      const user = userEvent.setup()
      const { onCleared } = renderField({ secretAffordance, disabled: true })

      expect(maskedControl()).toBeDisabled()
      await user.click(maskedControl())

      expect(confirmDialog()).not.toBeInTheDocument()
      expect(onCleared).not.toHaveBeenCalled()
    })
  })
})

const ROWS = ['alpha', 'beta'] as const
type Row = (typeof ROWS)[number]

// A host with a pencil per row, like a list whose confirm opens from the row.
function RowPencils({ onCleared }: Readonly<{ onCleared: (row: Row) => void }>) {
  const confirm = useProtectedValueConfirm()
  return (
    <>
      {ROWS.map((row) => (
        <button key={row} type="button" onClick={() => confirm.open(() => onCleared(row))}>
          Edit {row}
        </button>
      ))}
      {confirm.dialog}
    </>
  )
}

function renderRows() {
  const onCleared = vi.fn<(row: Row) => void>()
  render(<RowPencils onCleared={onCleared} />)
  return { onCleared }
}

function pencil(row: Row): HTMLElement {
  return screen.getByRole('button', { name: `Edit ${row}` })
}

describe('useProtectedValueConfirm', () => {
  it('shows no confirm until its open function is called', () => {
    renderRows()

    expect(confirmDialog()).not.toBeInTheDocument()
  })

  it('opens the same confirm, with the same texts', async () => {
    const user = userEvent.setup()
    const { onCleared } = renderRows()

    await user.click(pencil('alpha'))

    const dialog = screen.getByRole('dialog', { name: CONFIRM_TITLE })
    expect(within(dialog).getByText(CONFIRM_BODY)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete & Edit' })).toBeInTheDocument()
    expect(onCleared).not.toHaveBeenCalled()
  })

  it('renders one confirm for every row', async () => {
    const user = userEvent.setup()
    renderRows()

    await user.click(pencil('beta'))

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('closes on Cancel and reports nothing', async () => {
    const user = userEvent.setup()
    const { onCleared } = renderRows()
    await user.click(pencil('alpha'))

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(confirmDialog()).not.toBeInTheDocument()
    expect(onCleared).not.toHaveBeenCalled()
  })

  it('closes on Escape and reports nothing', async () => {
    const user = userEvent.setup()
    const { onCleared } = renderRows()
    await user.click(pencil('alpha'))

    await user.keyboard('{Escape}')

    expect(confirmDialog()).not.toBeInTheDocument()
    expect(onCleared).not.toHaveBeenCalled()
  })

  it.each(ROWS)('reports "Delete & Edit" once, to the %s row that opened it', async (row) => {
    const user = userEvent.setup()
    const { onCleared } = renderRows()
    await user.click(pencil(row))

    await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))

    expect(onCleared.mock.calls).toEqual([[row]])
    expect(confirmDialog()).not.toBeInTheDocument()
  })

  it('never reports a row whose confirm was canceled', async () => {
    const user = userEvent.setup()
    const { onCleared } = renderRows()
    await user.click(pencil('alpha'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(pencil('beta'))
    await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))

    expect(onCleared.mock.calls).toEqual([['beta']])
  })

  it.each(ROWS)('puts focus back on the %s pencil after Cancel', async (row) => {
    const user = userEvent.setup()
    renderRows()
    await user.click(pencil(row))

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(pencil(row)).toHaveFocus())
  })

  it('puts focus back on the pencil after Escape', async () => {
    const user = userEvent.setup()
    renderRows()
    await user.click(pencil('beta'))

    await user.keyboard('{Escape}')

    await waitFor(() => expect(pencil('beta')).toHaveFocus())
  })

  it('puts focus back on the pencil after "Delete & Edit" when the host shows no editor in its place', async () => {
    const user = userEvent.setup()
    renderRows()
    await user.click(pencil('alpha'))

    await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))

    await waitFor(() => expect(pencil('alpha')).toHaveFocus())
  })

  it('reports each confirmed row in turn', async () => {
    const user = userEvent.setup()
    const { onCleared } = renderRows()

    await user.click(pencil('alpha'))
    await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))
    await user.click(pencil('beta'))
    await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))

    expect(onCleared.mock.calls).toEqual([['alpha'], ['beta']])
  })
})
