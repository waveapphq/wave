/**
 * TestDataNameDialog - the one Name prompt behind New folder and Rename.
 *
 * Module: frontend/src/features/workbench/common/testdata/testdata-name-dialog.tsx
 *
 * One field, two modes. A name that would not survive a round trip through
 * the server is refused here, and so is one a sibling already carries, so the
 * user is not sent to the backend to be told no.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { TestDataNameDialog } from '@/features/workbench/common/testdata/testdata-name-dialog'

const SIBLINGS = ['users.csv', 'orders.json', 'payloads']
const DUPLICATE_MESSAGE = 'A file or folder with this name already exists'

type DialogProps = ComponentProps<typeof TestDataNameDialog>

function renderDialog(props: Partial<DialogProps> = {}) {
  const handlers = { onSave: vi.fn(), onClose: vi.fn() }
  render(
    <TestDataNameDialog
      open
      mode="folder"
      folder=""
      siblings={SIBLINGS}
      {...handlers}
      {...props}
    />
  )
  return handlers
}

function nameInput(): HTMLElement {
  return screen.getByTestId('testdata-name-input')
}

function saveButton(): HTMLElement {
  return screen.getByTestId('edit-dialog-save')
}

async function typeName(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.clear(nameInput())
  await user.type(nameInput(), value)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TestDataNameDialog - shell', () => {
  it('renders nothing when closed', () => {
    renderDialog({ open: false })

    expect(screen.queryByTestId('testdata-name-dialog')).not.toBeInTheDocument()
  })

  it('offers exactly one field', () => {
    renderDialog()

    expect(screen.getByTestId('testdata-name-dialog')).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })
})

describe('TestDataNameDialog - folder mode', () => {
  it('says the folder lands in the root, and starts empty', () => {
    renderDialog()

    expect(screen.getByText('New folder in the root')).toBeInTheDocument()
    expect(nameInput()).toHaveValue('')
  })

  it('names the destination folder when one is selected', () => {
    renderDialog({ folder: 'fixtures/payloads' })

    expect(screen.getByText('New folder in fixtures/payloads')).toBeInTheDocument()
  })

  it('reports the typed folder name', async () => {
    const user = userEvent.setup()
    const handlers = renderDialog()

    await typeName(user, 'fixtures')
    await user.click(saveButton())

    expect(handlers.onSave).toHaveBeenCalledWith('fixtures')
  })
})

describe('TestDataNameDialog - rename mode', () => {
  it('is titled after the entry being renamed', () => {
    renderDialog({ mode: 'rename', initialName: 'users.csv' })

    expect(screen.getByText('Rename users.csv')).toBeInTheDocument()
  })

  it('prefills the current name', () => {
    renderDialog({ mode: 'rename', initialName: 'users.csv' })

    expect(nameInput()).toHaveValue('users.csv')
  })

  it('reports the new name', async () => {
    const user = userEvent.setup()
    const handlers = renderDialog({
      mode: 'rename',
      initialName: 'users.csv',
      siblings: ['orders.json'],
    })

    await typeName(user, 'people.csv')
    await user.click(saveButton())

    expect(handlers.onSave).toHaveBeenCalledWith('people.csv')
  })
})

describe('TestDataNameDialog - validation', () => {
  it('refuses an empty name', () => {
    renderDialog()

    expect(saveButton()).toBeDisabled()
  })

  it('refuses a name holding a forward slash', async () => {
    const user = userEvent.setup()
    renderDialog()

    await typeName(user, 'nested/deep')

    expect(saveButton()).toBeDisabled()
  })

  it('refuses a name holding a backslash', async () => {
    const user = userEvent.setup()
    renderDialog()

    await typeName(user, 'nested\\deep')

    expect(saveButton()).toBeDisabled()
  })

  it('refuses a single dot', async () => {
    const user = userEvent.setup()
    renderDialog()

    await typeName(user, '.')

    expect(saveButton()).toBeDisabled()
  })

  it('refuses two dots', async () => {
    const user = userEvent.setup()
    renderDialog()

    await typeName(user, '..')

    expect(saveButton()).toBeDisabled()
  })

  it('refuses a name a sibling already carries', async () => {
    const user = userEvent.setup()
    renderDialog()

    await typeName(user, 'users.csv')

    expect(screen.getByText(DUPLICATE_MESSAGE)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it('accepts a name no sibling carries', async () => {
    const user = userEvent.setup()
    renderDialog()

    await typeName(user, 'fresh.csv')

    expect(screen.queryByText(DUPLICATE_MESSAGE)).not.toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
  })

  it('reports nothing when a refused name is never saved', async () => {
    const user = userEvent.setup()
    const handlers = renderDialog()

    await typeName(user, 'users.csv')
    await user.click(saveButton())

    expect(handlers.onSave).not.toHaveBeenCalled()
  })
})

describe('TestDataNameDialog - canceling', () => {
  it('closes on cancel', async () => {
    const user = userEvent.setup()
    const handlers = renderDialog()

    await user.click(screen.getByTestId('edit-dialog-cancel'))

    expect(handlers.onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on cancel after typing, with no unsaved-changes prompt', async () => {
    const user = userEvent.setup()
    const handlers = renderDialog()

    await typeName(user, 'fixtures')
    await user.click(screen.getByTestId('edit-dialog-cancel'))

    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
    expect(handlers.onSave).not.toHaveBeenCalled()
  })
})
