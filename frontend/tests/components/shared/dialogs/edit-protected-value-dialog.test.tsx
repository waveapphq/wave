/**
 * Tests for EditProtectedValueDialog - the canonical "editing drops the stored
 * secret" confirmation shared by profile parameters, entity variables, and the
 * workbench variable watchers.
 *
 * REQ-3.1.3.5: Secret variable masking
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { EditProtectedValueDialog } from '@/components/shared/dialogs/edit-protected-value-dialog'

function renderDialog(overrides: { open?: boolean } = {}) {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  render(
    <EditProtectedValueDialog
      open={overrides.open ?? true}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  )
  return { onCancel, onConfirm }
}

describe('EditProtectedValueDialog', () => {
  it('renders the canonical title and irreversibility copy', () => {
    renderDialog()
    expect(screen.getByText('Edit Protected Value?')).toBeInTheDocument()
    expect(
      screen.getByText(/permanently delete the existing protected value/),
    ).toBeInTheDocument()
  })

  it('renders nothing while closed', () => {
    renderDialog({ open: false })
    expect(screen.queryByText('Edit Protected Value?')).not.toBeInTheDocument()
  })

  it('fires onConfirm from the destructive Delete & Edit action', async () => {
    const user = userEvent.setup()
    const { onCancel, onConfirm } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Delete & Edit' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('fires onCancel from the Cancel button', async () => {
    const user = userEvent.setup()
    const { onCancel, onConfirm } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('treats a dismissal (ESC) as Cancel - the drop never happens implicitly', async () => {
    const user = userEvent.setup()
    const { onCancel, onConfirm } = renderDialog()

    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

type Replacement = 'input' | 'wrapped' | 'text' | 'nothing' | 'kept'

const NEW_VALUE = 'New value'
const STORED_VALUE = 'Stored value'

function replacementOf(kind: Exclude<Replacement, 'kept'>): ReactNode {
  if (kind === 'input') return <input aria-label={NEW_VALUE} />
  if (kind === 'wrapped') {
    return (
      <div>
        <span>Value</span>
        <input aria-label={NEW_VALUE} />
        <button type="button">Show</button>
      </div>
    )
  }
  if (kind === 'text') return <span>No value</span>
  return null
}

// An editor that takes focus once it is on screen, as a code editor does.
function OwnEditor() {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return <input ref={ref} aria-label="Editor of its own" />
}

interface FieldProps {
  /** What stands in the stored control's place after "Delete & Edit". */
  replacement: Replacement
  /** The host opens an editor of its own that takes focus, like a sheet with a focused field. */
  ownEditor?: boolean
}

// Stands in for a field that holds a stored secret and asks the question from its own control.
function Field({ replacement, ownEditor = false }: Readonly<FieldProps>) {
  const [cleared, setCleared] = useState(false)
  const [asked, setAsked] = useState(false)
  const swapped = cleared && replacement !== 'kept'
  return (
    <>
      <input aria-label="Username" />
      <div data-testid="field">
        <span>Password</span>
        {swapped ? (
          replacementOf(replacement)
        ) : (
          <button type="button" onClick={() => setAsked(true)}>
            {STORED_VALUE}
          </button>
        )}
      </div>
      <button type="button" onClick={() => setAsked(true)}>
        Ask from elsewhere
      </button>
      {cleared && ownEditor ? <OwnEditor /> : null}
      <EditProtectedValueDialog
        open={asked}
        onCancel={() => setAsked(false)}
        onConfirm={() => {
          setAsked(false)
          setCleared(true)
        }}
      />
    </>
  )
}

// A list row that holds focus itself and asks the question on Enter, with a button of its own inside.
function Row() {
  const [asked, setAsked] = useState(false)
  return (
    <>
      <div
        role="row"
        aria-label="token"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Enter') setAsked(true)
        }}
      >
        <button type="button">Delete token</button>
      </div>
      <EditProtectedValueDialog
        open={asked}
        onCancel={() => setAsked(false)}
        onConfirm={() => setAsked(false)}
      />
    </>
  )
}

function storedControl(): HTMLElement {
  return screen.getByRole('button', { name: STORED_VALUE })
}

function question(): HTMLElement | null {
  return screen.queryByRole('dialog', { name: 'Edit Protected Value?' })
}

async function answer(user: ReturnType<typeof userEvent.setup>, name: 'Cancel' | 'Delete & Edit') {
  await user.click(screen.getByRole('button', { name }))
  expect(question()).not.toBeInTheDocument()
}

// The question hands focus on a moment after it has gone.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

describe('EditProtectedValueDialog - keyboard focus', () => {
  describe('Cancel', () => {
    it('puts focus back on the control that opened the question', async () => {
      const user = userEvent.setup()
      render(<Field replacement="input" />)
      await user.tab()
      await user.tab()
      expect(storedControl()).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(question()).toBeInTheDocument()

      await answer(user, 'Cancel')

      await waitFor(() => expect(storedControl()).toHaveFocus())
    })

    it('puts focus back on that control after Escape', async () => {
      const user = userEvent.setup()
      render(<Field replacement="input" />)
      await user.click(storedControl())

      await user.keyboard('{Escape}')

      expect(question()).not.toBeInTheDocument()
      await waitFor(() => expect(storedControl()).toHaveFocus())
    })

    it('puts focus back on the control of the latest question, not of an earlier one', async () => {
      const user = userEvent.setup()
      render(<Field replacement="input" />)
      await user.click(storedControl())
      await answer(user, 'Cancel')
      await waitFor(() => expect(storedControl()).toHaveFocus())

      await user.click(screen.getByRole('button', { name: 'Ask from elsewhere' }))
      await answer(user, 'Cancel')

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Ask from elsewhere' })).toHaveFocus(),
      )
    })

    it.each(['Cancel', 'Delete & Edit'] as const)(
      'puts focus back on a row that asked the question itself after %s, not on a button inside it',
      async (name) => {
        const user = userEvent.setup()
        render(<Row />)
        const row = screen.getByRole('row', { name: 'token' })
        row.focus()
        // One key event: a full key press would carry on to the button the question focuses.
        fireEvent.keyDown(row, { key: 'Enter' })
        expect(question()).toBeInTheDocument()

        await answer(user, name)

        await waitFor(() => expect(row).toHaveFocus())
      },
    )

    it('leaves focus where it is when the question opened with no control focused', async () => {
      const user = userEvent.setup()
      render(<Field replacement="input" />)
      expect(document.body).toHaveFocus()
      // A click that moves no focus, as in a browser that does not focus a clicked button.
      fireEvent.click(storedControl())
      expect(question()).toBeInTheDocument()

      await answer(user, 'Cancel')
      await settle()

      expect(document.body).toHaveFocus()
    })
  })

  describe('Delete & Edit', () => {
    it('puts focus in the new empty input that took the stored control\'s place', async () => {
      const user = userEvent.setup()
      render(<Field replacement="input" />)
      await user.click(storedControl())

      await answer(user, 'Delete & Edit')

      await waitFor(() => expect(screen.getByRole('textbox', { name: NEW_VALUE })).toHaveFocus())
    })

    it('puts focus in the input inside whatever took the stored control\'s place', async () => {
      const user = userEvent.setup()
      render(<Field replacement="wrapped" />)
      await user.click(storedControl())

      await answer(user, 'Delete & Edit')

      await waitFor(() => expect(screen.getByRole('textbox', { name: NEW_VALUE })).toHaveFocus())
    })

    it('never puts focus in another field of the page', async () => {
      const user = userEvent.setup()
      render(<Field replacement="input" />)
      await user.click(screen.getByRole('textbox', { name: 'Username' }))
      await user.click(storedControl())

      await answer(user, 'Delete & Edit')

      await waitFor(() => expect(screen.getByRole('textbox', { name: NEW_VALUE })).toHaveFocus())
      expect(screen.getByRole('textbox', { name: 'Username' })).not.toHaveFocus()
    })

    it('puts focus back on the control that opened the question when that control stays', async () => {
      const user = userEvent.setup()
      render(<Field replacement="kept" />)
      await user.click(storedControl())

      await answer(user, 'Delete & Edit')

      await waitFor(() => expect(storedControl()).toHaveFocus())
    })

    it('leaves focus in an editor that took it on its own', async () => {
      const user = userEvent.setup()
      render(<Field replacement="kept" ownEditor />)
      await user.click(storedControl())

      await answer(user, 'Delete & Edit')
      await settle()

      expect(screen.getByRole('textbox', { name: 'Editor of its own' })).toHaveFocus()
    })

    it.each(['text', 'nothing'] as const)(
      'moves no focus when %s that can take it stands in the stored control\'s place',
      async (replacement) => {
        const user = userEvent.setup()
        render(<Field replacement={replacement} />)
        await user.click(storedControl())

        await answer(user, 'Delete & Edit')
        await settle()

        expect(document.body).toHaveFocus()
      },
    )

    it('puts focus in the new input when the field sits inside another dialog', async () => {
      const user = userEvent.setup()
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Profile</DialogTitle>
            <DialogDescription>Connection settings</DialogDescription>
            <Field replacement="input" />
          </DialogContent>
        </Dialog>,
      )
      await user.click(storedControl())

      await answer(user, 'Delete & Edit')

      await waitFor(() => expect(screen.getByRole('textbox', { name: NEW_VALUE })).toHaveFocus())
    })

    it('puts focus back on the stored control after Cancel inside another dialog', async () => {
      const user = userEvent.setup()
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Profile</DialogTitle>
            <DialogDescription>Connection settings</DialogDescription>
            <Field replacement="input" />
          </DialogContent>
        </Dialog>,
      )
      await user.click(storedControl())

      await answer(user, 'Cancel')

      await waitFor(() => expect(storedControl()).toHaveFocus())
    })
  })
})
