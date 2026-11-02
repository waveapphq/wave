/**
 * SecretsModePicker Component Tests
 *
 * The shared "Secret values" radio group (Mask / Keep encrypted / Decrypt) on
 * every secret-carrying export surface. Copy is fixed by design: the option descriptions and the
 * amber plaintext warning.
 *
 * Component: frontend/src/components/shared/secrets-mode-picker.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SecretsModePicker } from '@/components/shared/secrets-mode-picker'

const MASK_DESCRIPTION = 'Replace secret values with ******** - safe to share'
const ENCRYPTED_DESCRIPTION = 'Values stay sealed - only this WAVE instance can read them'
const PLAINTEXT_DESCRIPTION = 'Write real values in plain text - for migrating to another instance'
const EXPORT_WARNING = 'Secrets will be written in plain text. Handle the exported file securely.'

function renderPicker(props: Record<string, unknown> = {}) {
  return render(
    <SecretsModePicker value="mask" onChange={vi.fn()} {...props} />,
  )
}

describe('SecretsModePicker', () => {
  describe('Structure', () => {
    it('renders the "Secret values" group label', () => {
      renderPicker()
      expect(screen.getByText('Secret values')).toBeInTheDocument()
    })

    it('names the radio group "Secret values"', () => {
      renderPicker()
      expect(screen.getByRole('radiogroup', { name: 'Secret values' })).toBe(
        screen.getByTestId('secrets-mode-picker'),
      )
    })

    it('names each of two pickers on one page by its own label', () => {
      render(
        <>
          <SecretsModePicker value="mask" onChange={vi.fn()} />
          <SecretsModePicker value="mask" onChange={vi.fn()} />
        </>,
      )
      const [first, second] = screen.getAllByRole('radiogroup', { name: 'Secret values' })
      expect(first.getAttribute('aria-labelledby')).not.toBe(second.getAttribute('aria-labelledby'))
    })

    it('gives the radios of two pickers on one page ids that do not overlap', () => {
      render(
        <>
          <SecretsModePicker value="mask" onChange={vi.fn()} />
          <SecretsModePicker value="mask" onChange={vi.fn()} />
        </>,
      )
      const ids = screen.getAllByRole('radio').map((radio) => radio.id)
      expect(ids).toHaveLength(6)
      expect(new Set(ids).size).toBe(6)
    })

    it('binds each option label to the radio of its own picker', () => {
      render(
        <>
          <SecretsModePicker value="mask" onChange={vi.fn()} />
          <SecretsModePicker value="mask" onChange={vi.fn()} />
        </>,
      )
      for (const group of screen.getAllByRole('radiogroup', { name: 'Secret values' })) {
        expect(within(group).getByRole('radio', { name: 'Mask' })).toBe(
          within(group).getByTestId('secrets-mode-mask'),
        )
        expect(within(group).getByRole('radio', { name: 'Keep encrypted' })).toBe(
          within(group).getByTestId('secrets-mode-encrypted'),
        )
        expect(within(group).getByRole('radio', { name: 'Decrypt' })).toBe(
          within(group).getByTestId('secrets-mode-plaintext'),
        )
      }
    })

    it('renders all three mode radios', () => {
      renderPicker()
      expect(screen.getByTestId('secrets-mode-picker')).toBeInTheDocument()
      expect(screen.getByTestId('secrets-mode-mask')).toBeInTheDocument()
      expect(screen.getByTestId('secrets-mode-encrypted')).toBeInTheDocument()
      expect(screen.getByTestId('secrets-mode-plaintext')).toBeInTheDocument()
    })

    it('renders the three option labels', () => {
      renderPicker()
      expect(screen.getByText('Mask')).toBeInTheDocument()
      expect(screen.getByText('Keep encrypted')).toBeInTheDocument()
      expect(screen.getByText('Decrypt')).toBeInTheDocument()
    })

    it('renders the option descriptions', () => {
      renderPicker()
      expect(screen.getByText(MASK_DESCRIPTION)).toBeInTheDocument()
      expect(screen.getByText(ENCRYPTED_DESCRIPTION)).toBeInTheDocument()
      expect(screen.getByText(PLAINTEXT_DESCRIPTION)).toBeInTheDocument()
    })
  })

  describe('Selection', () => {
    it('checks the radio matching the value prop', () => {
      renderPicker({ value: 'mask' })
      expect(screen.getByTestId('secrets-mode-mask')).toHaveAttribute('data-state', 'checked')
      expect(screen.getByTestId('secrets-mode-encrypted')).toHaveAttribute('data-state', 'unchecked')
      expect(screen.getByTestId('secrets-mode-plaintext')).toHaveAttribute('data-state', 'unchecked')
    })

    it('reflects an encrypted value', () => {
      renderPicker({ value: 'encrypted' })
      expect(screen.getByTestId('secrets-mode-encrypted')).toHaveAttribute('data-state', 'checked')
    })

    it('calls onChange with the chosen mode', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const onChange = vi.fn()

      renderPicker({ value: 'mask', onChange })
      await user.click(screen.getByTestId('secrets-mode-plaintext'))

      expect(onChange).toHaveBeenCalledWith('plaintext')
    })

    it('a click on an option label of the second of two pickers calls only the second onChange', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const onFirstChange = vi.fn()
      const onSecondChange = vi.fn()
      render(
        <>
          <SecretsModePicker value="mask" onChange={onFirstChange} />
          <SecretsModePicker value="mask" onChange={onSecondChange} />
        </>,
      )

      const [, second] = screen.getAllByRole('radiogroup', { name: 'Secret values' })
      await user.click(within(second).getByText('Decrypt'))

      expect(onSecondChange).toHaveBeenCalledTimes(1)
      expect(onSecondChange).toHaveBeenCalledWith('plaintext')
      expect(onFirstChange).not.toHaveBeenCalled()
    })
  })

  describe('Plaintext warning', () => {
    it('shows the amber warning only when Decrypt is selected', () => {
      renderPicker({ value: 'plaintext' })
      expect(screen.getByTestId('secrets-plaintext-warning')).toHaveTextContent(EXPORT_WARNING)
    })

    it('hides the warning for mask', () => {
      renderPicker({ value: 'mask' })
      expect(screen.queryByTestId('secrets-plaintext-warning')).not.toBeInTheDocument()
    })

    it('hides the warning for encrypted', () => {
      renderPicker({ value: 'encrypted' })
      expect(screen.queryByTestId('secrets-plaintext-warning')).not.toBeInTheDocument()
    })

    it('uses a custom warningText when provided', () => {
      const backupWarning = 'Secrets will be written in plain text. Handle the backup file securely.'
      renderPicker({ value: 'plaintext', warningText: backupWarning })
      expect(screen.getByTestId('secrets-plaintext-warning')).toHaveTextContent(backupWarning)
    })
  })

  describe('Description overrides', () => {
    it('overrides a single description line', () => {
      const backupEncrypted = 'Values stay sealed - restorable with working secrets on this WAVE instance'
      renderPicker({ descriptions: { encrypted: backupEncrypted } })
      expect(screen.getByText(backupEncrypted)).toBeInTheDocument()
      expect(screen.queryByText(ENCRYPTED_DESCRIPTION)).not.toBeInTheDocument()
      // Untouched lines keep their defaults.
      expect(screen.getByText(MASK_DESCRIPTION)).toBeInTheDocument()
    })
  })
})
