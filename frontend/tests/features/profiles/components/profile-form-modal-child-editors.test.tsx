/**
 * ProfileFormModal and the "Edit value" sheets opened from its parameter rows.
 *
 * The profile form is the parent: nothing changed anywhere keeps Save disabled
 * and closes at once; a change in the form or in an open value editor enables
 * Save, which writes the editor's unsaved value into the form and submits once,
 * and closing from the X or Cancel asks Keep Editing / Close / Save. An open
 * editor with changes that cannot be saved, or invalid settings, disables both
 * Saves with a red note naming what blocks them.
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/components/shared/variable-bodies/scalar-edit-body', () => ({
  ScalarEditBody: ({
    onChange,
    onValidChange,
  }: {
    onChange: (value: unknown) => void
    onValidChange: (valid: boolean) => void
  }) => (
    <div data-testid="scalar-edit-body">
      <button data-testid="scalar-edit-body-change" onClick={() => onChange('typed-host')}>
        change
      </button>
      <button data-testid="scalar-edit-body-invalid" onClick={() => onValidChange(false)}>
        invalid
      </button>
    </div>
  ),
}))

import {
  ProfileFormModal,
  type Profile,
  type ProfileFormModalProps,
} from '@/features/profiles/components/profile-form-modal'
import { ToastProvider } from '@/components/ui/toast'

const PROFILE: Profile = {
  id: 'profile-1',
  name: 'Staging API',
  type: 'custom',
  description: '',
  tags: [],
  usage: 0,
  parameters: [
    { id: 'param-1', name: 'host', type: 'string', secret: false, values: { 'env-1': 'saved-host' } },
  ],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

function renderProfile(overrides: Partial<ProfileFormModalProps> = {}) {
  const props: ProfileFormModalProps = {
    open: true,
    mode: 'edit',
    profile: PROFILE,
    profileTypes: ['custom'],
    environments: [{ id: 'env-1', name: 'Lab', tags: [] }],
    allTags: [],
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(
    <ToastProvider>
      <ProfileFormModal {...props} />
    </ToastProvider>,
  )
  return props
}

const footer = () => screen.getByTestId('modal-footer')
const saveChanges = () => within(footer()).getByRole('button', { name: 'Save Changes' })

async function openHostWithChange(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('param-edit-value-param-1'))
  const editor = screen.getByTestId('value-editor-sheet')
  await user.click(within(editor).getByTestId('scalar-edit-body-change'))
  return editor
}

function dialogAnswers() {
  return within(screen.getByTestId('unsaved-changes-dialog'))
    .getAllByRole('button')
    .filter((button) => button.dataset.testid !== undefined)
    .map((button) => button.textContent)
}

describe('ProfileFormModal - nothing changed anywhere', () => {
  it('keeps Save Changes disabled without a note', () => {
    renderProfile()
    expect(saveChanges()).toBeDisabled()
    expect(screen.queryByTestId('save-blocked-note')).not.toBeInTheDocument()
  })

  it('closes at once from the X with a clean editor open', async () => {
    const user = userEvent.setup()
    const props = renderProfile()
    await user.click(screen.getByTestId('param-edit-value-param-1'))

    await user.click(screen.getByTestId('modal-close'))

    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
  })
})

describe('ProfileFormModal - an open editor has changes', () => {
  it("submits once with the editor's unsaved value written into the form", async () => {
    const user = userEvent.setup()
    const props = renderProfile()
    await openHostWithChange(user)

    await user.click(saveChanges())

    expect(props.onSubmit).toHaveBeenCalledTimes(1)
    expect(vi.mocked(props.onSubmit).mock.calls[0][0].parameters[0].values).toEqual({
      'env-1': 'typed-host',
    })
  })

  it('asks Keep Editing / Close / Save from the X, and Close discards everything', async () => {
    const user = userEvent.setup()
    const props = renderProfile()
    await openHostWithChange(user)

    await user.click(screen.getByTestId('modal-close'))
    expect(dialogAnswers()).toEqual(['Keep Editing', 'Close', 'Save'])

    await user.click(screen.getByTestId('unsaved-close'))
    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it("Save in the question submits exactly as the form's Save", async () => {
    const user = userEvent.setup()
    const props = renderProfile()
    await openHostWithChange(user)
    await user.click(within(footer()).getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByTestId('unsaved-save'))

    expect(props.onSubmit).toHaveBeenCalledTimes(1)
    expect(vi.mocked(props.onSubmit).mock.calls[0][0].parameters[0].values).toEqual({
      'env-1': 'typed-host',
    })
  })

  it('Keep Editing returns to the form', async () => {
    const user = userEvent.setup()
    const props = renderProfile()
    await openHostWithChange(user)
    await user.click(within(footer()).getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByTestId('unsaved-keep-editing'))

    expect(props.onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
  })

  it('asks when only the form itself changed', () => {
    const props = renderProfile()
    fireEvent.change(screen.getByRole('textbox', { name: /^name/i }), { target: { value: 'Renamed' } })

    fireEvent.click(within(footer()).getByRole('button', { name: 'Cancel' }))

    expect(screen.getByTestId('unsaved-changes-dialog')).toBeInTheDocument()
    expect(props.onClose).not.toHaveBeenCalled()
  })
})

describe('ProfileFormModal - something cannot be saved', () => {
  it('disables both Saves and names the row whose editor has errors', async () => {
    const user = userEvent.setup()
    renderProfile()
    const editor = await openHostWithChange(user)
    await user.click(within(editor).getByTestId('scalar-edit-body-invalid'))

    expect(saveChanges()).toBeDisabled()
    expect(within(footer()).getByTestId('save-blocked-note')).toHaveTextContent(
      /^Save is disabled: the host editor has errors$/,
    )

    await user.click(within(footer()).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('unsaved-save')).toBeDisabled()
    expect(
      within(screen.getByTestId('unsaved-changes-dialog')).getByTestId('save-blocked-note'),
    ).toHaveTextContent(/^Save is disabled: the host editor has errors$/)
  })

  it('names the settings while the form itself is invalid', () => {
    renderProfile()
    fireEvent.change(screen.getByRole('textbox', { name: /^name/i }), { target: { value: '' } })

    expect(saveChanges()).toBeDisabled()
    expect(within(footer()).getByTestId('save-blocked-note')).toHaveTextContent(
      /^Save is disabled: the settings have errors$/,
    )
  })

  it('names Create for a new profile', () => {
    renderProfile({ mode: 'create', profile: undefined })
    fireEvent.change(screen.getByRole('textbox', { name: /^description/i }), {
      target: { value: 'no name yet' },
    })

    expect(within(footer()).getByRole('button', { name: 'Create' })).toBeDisabled()
    expect(within(footer()).getByTestId('save-blocked-note')).toHaveTextContent(
      /^Create is disabled: the settings have errors$/,
    )
  })
})

describe('ProfileFormModal - a row the form takes away', () => {
  it('asks before deleting a row whose editor holds unsaved text, and Close deletes it', async () => {
    const user = userEvent.setup()
    const props = renderProfile()
    await openHostWithChange(user)

    await user.click(screen.getByRole('button', { name: 'Delete parameter' }))
    expect(
      within(screen.getByTestId('unsaved-changes-dialog'))
        .getAllByRole('button')
        .filter((button) => button.dataset.testid !== undefined)
        .map((button) => button.textContent),
    ).toEqual(['Keep Editing', 'Close'])

    await user.click(screen.getByTestId('unsaved-close'))
    expect(screen.queryByTestId('param-edit-value-param-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('leaves the row exactly as it was on Keep Editing', async () => {
    const user = userEvent.setup()
    renderProfile()
    await openHostWithChange(user)

    await user.click(screen.getByRole('button', { name: 'Delete parameter' }))
    await user.click(screen.getByTestId('unsaved-keep-editing'))

    expect(screen.getByTestId('param-edit-value-param-1')).toBeInTheDocument()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
  })

  it('deletes at once while the open editor has no unsaved text', async () => {
    const user = userEvent.setup()
    renderProfile()
    await user.click(screen.getByTestId('param-edit-value-param-1'))

    await user.click(screen.getByRole('button', { name: 'Delete parameter' }))

    expect(screen.queryByTestId('unsaved-changes-dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('param-edit-value-param-1')).not.toBeInTheDocument()
  })
})
