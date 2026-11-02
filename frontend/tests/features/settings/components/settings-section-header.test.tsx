/**
 * SettingsSectionHeader Component Tests
 *
 * REQ-5.2.1.42: settings page header (NET-1): a Title Case `h2`
 * with optional Cancel and Save; Cancel and Save stay disabled until a change
 * and Save is busy while saving. `saveDisabled` disables Save alone.
 *
 * Component: frontend/src/features/settings/components/settings-section-header.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SettingsSectionHeader } from '@/features/settings/components/settings-section-header'

const TITLE = 'Host Key Policy'

describe('SettingsSectionHeader', () => {
  describe('Title', () => {
    it('renders the title as an h2', () => {
      render(<SettingsSectionHeader title={TITLE} />)

      expect(screen.getByRole('heading', { level: 2, name: TITLE })).toBeInTheDocument()
    })

    it('renders only the title when no handlers are given', () => {
      const { container } = render(<SettingsSectionHeader title={TITLE} />)

      expect(screen.queryAllByRole('button')).toHaveLength(0)
      expect(container).toHaveTextContent(new RegExp(`^${TITLE}$`))
    })
  })

  describe('Actions render only with both handlers', () => {
    it('renders no actions with only onSave', () => {
      render(<SettingsSectionHeader title={TITLE} dirty onSave={vi.fn()} />)

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })

    it('renders no actions with only onCancel', () => {
      render(<SettingsSectionHeader title={TITLE} dirty onCancel={vi.fn()} />)

      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })

    it('renders Cancel and Save when both handlers are given', () => {
      render(<SettingsSectionHeader title={TITLE} onCancel={vi.fn()} onSave={vi.fn()} />)

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })

    it('shows the save icon on Save', () => {
      render(<SettingsSectionHeader title={TITLE} onCancel={vi.fn()} onSave={vi.fn()} />)

      const save = screen.getByRole('button', { name: 'Save' })
      expect(save.querySelector('svg.lucide-save')).toBeInTheDocument()
    })
  })

  describe('Clean state', () => {
    it('disables Save and Cancel when dirty is omitted', () => {
      render(<SettingsSectionHeader title={TITLE} onCancel={vi.fn()} onSave={vi.fn()} />)

      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    })

    it('disables Save and Cancel when not dirty', () => {
      render(
        <SettingsSectionHeader title={TITLE} dirty={false} onCancel={vi.fn()} onSave={vi.fn()} />,
      )

      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    })

    it('does not call onSave when the disabled Save is clicked', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(<SettingsSectionHeader title={TITLE} onCancel={vi.fn()} onSave={onSave} />)

      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(onSave).not.toHaveBeenCalled()
    })

    it('does not call onCancel when the disabled Cancel is clicked', async () => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      render(<SettingsSectionHeader title={TITLE} onCancel={onCancel} onSave={vi.fn()} />)

      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(onCancel).not.toHaveBeenCalled()
    })
  })

  describe('Dirty state', () => {
    it('enables Save and Cancel', () => {
      render(<SettingsSectionHeader title={TITLE} dirty onCancel={vi.fn()} onSave={vi.fn()} />)

      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    })

    it('calls onSave when Save is clicked', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<SettingsSectionHeader title={TITLE} dirty onCancel={onCancel} onSave={onSave} />)

      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(onSave).toHaveBeenCalledTimes(1)
      expect(onCancel).not.toHaveBeenCalled()
    })

    it('calls onCancel when Cancel is clicked', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(<SettingsSectionHeader title={TITLE} dirty onCancel={onCancel} onSave={onSave} />)

      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onSave).not.toHaveBeenCalled()
    })

    it('Save is not busy while not saving', () => {
      render(<SettingsSectionHeader title={TITLE} dirty onCancel={vi.fn()} onSave={vi.fn()} />)

      expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-busy')
    })
  })

  describe('Save disabled on its own', () => {
    it('disables Save and keeps Cancel enabled when dirty with saveDisabled', () => {
      render(
        <SettingsSectionHeader title={TITLE} dirty saveDisabled onCancel={vi.fn()} onSave={vi.fn()} />,
      )

      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    })

    it('does not call onSave when Save is clicked while saveDisabled', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(
        <SettingsSectionHeader title={TITLE} dirty saveDisabled onCancel={vi.fn()} onSave={onSave} />,
      )

      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(onSave).not.toHaveBeenCalled()
    })

    it('still calls onCancel when Cancel is clicked while saveDisabled', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(
        <SettingsSectionHeader title={TITLE} dirty saveDisabled onCancel={onCancel} onSave={onSave} />,
      )

      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onSave).not.toHaveBeenCalled()
    })

    it('enables Save again once saveDisabled turns false', () => {
      const props = { title: TITLE, dirty: true, onCancel: vi.fn(), onSave: vi.fn() }
      const { rerender } = render(<SettingsSectionHeader {...props} saveDisabled />)
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

      rerender(<SettingsSectionHeader {...props} saveDisabled={false} />)

      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    })

    it('lets Save follow dirty when saveDisabled is false', () => {
      const props = { title: TITLE, saveDisabled: false, onCancel: vi.fn(), onSave: vi.fn() }
      const { rerender } = render(<SettingsSectionHeader {...props} dirty />)
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()

      rerender(<SettingsSectionHeader {...props} dirty={false} />)

      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    })

    it('calls onSave when Save is clicked with saveDisabled false', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(
        <SettingsSectionHeader
          title={TITLE}
          dirty
          saveDisabled={false}
          onCancel={vi.fn()}
          onSave={onSave}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Save' }))

      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it('lets Save follow dirty when saveDisabled is omitted', () => {
      const props = { title: TITLE, onCancel: vi.fn(), onSave: vi.fn() }
      const { rerender } = render(<SettingsSectionHeader {...props} dirty />)
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

      rerender(<SettingsSectionHeader {...props} dirty={false} />)

      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })

    it('disables Save and Cancel when clean with saveDisabled', () => {
      render(
        <SettingsSectionHeader
          title={TITLE}
          dirty={false}
          saveDisabled
          onCancel={vi.fn()}
          onSave={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    })

    it('renders no actions with saveDisabled and no handlers', () => {
      render(<SettingsSectionHeader title={TITLE} dirty saveDisabled />)

      expect(screen.queryAllByRole('button')).toHaveLength(0)
    })
  })

  describe('Saving state', () => {
    it('marks Save busy and disables Cancel and Save', () => {
      render(
        <SettingsSectionHeader title={TITLE} dirty saving onCancel={vi.fn()} onSave={vi.fn()} />,
      )

      const save = screen.getByRole('button', { name: 'Save' })
      expect(save).toHaveAttribute('aria-busy', 'true')
      expect(save).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    })

    it('ignores clicks on Cancel and Save while saving', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(
        <SettingsSectionHeader title={TITLE} dirty saving onCancel={onCancel} onSave={onSave} />,
      )

      await user.click(screen.getByRole('button', { name: 'Save' }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(onSave).not.toHaveBeenCalled()
      expect(onCancel).not.toHaveBeenCalled()
    })
  })
})
