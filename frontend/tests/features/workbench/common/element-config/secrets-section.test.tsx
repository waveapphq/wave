/**
 * SecretsSection (REQ-3.1.3.5 / REQ-3.1.3.16)
 *
 * The block "Secrets" collapsible: a tri-state run-output control (Select:
 * Use system setting / Always reveal / Always mask) with a contextual helper
 * and an amber warning for "Always reveal", above the "Mask specific
 * fields" list. When the block's effective run output is revealed, the field
 * list is disabled (per-field masking has no effect) and a "Revealing" pill
 * shows on the collapsed trigger.
 *
 * REQ: REQ-3.1.3.5, REQ-3.1.3.16
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SecretsSection } from '@/features/workbench/common/element-config/secrets-section'

interface SecretMaskField {
  key: string
  label: string
}

const HTTP_FIELDS: SecretMaskField[] = [
  { key: 'authorization', label: 'Authorization' },
  { key: 'set-cookie', label: 'Set-Cookie' },
  { key: 'cookie', label: 'Cookie' },
]

const SYSTEM_MASKED_HELPER = 'Follows the system setting. Currently: masked.'
const SYSTEM_REVEALING_HELPER = 'Follows the system setting. Currently: revealing.'
const ALWAYS_MASK_HELPER = 'Kept masked regardless of the system setting.'
const DISABLED_FIELDS_HINT = 'Run output is revealed - per-field masking has no effect.'

function renderSection(props: Record<string, unknown> = {}) {
  const merged = {
    secretMasking: 'system' as 'system' | 'reveal' | 'mask',
    onSecretMaskingChange: vi.fn(),
    effectiveRevealing: false,
    fields: HTTP_FIELDS,
    unmaskedFields: [] as string[],
    onUnmaskedFieldsChange: vi.fn(),
    ...props,
  }
  return {
    ...render(<SecretsSection {...merged} />),
    props: merged,
  }
}

function expand() {
  fireEvent.click(screen.getByTestId('secrets-section-trigger'))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SecretsSection', () => {
  describe('card chrome', () => {
    it('wraps the section in the shared rounded card container', () => {
      renderSection()
      const card = screen.getByTestId('secrets-section-trigger').parentElement
      expect(card).toHaveClass('overflow-hidden', 'rounded-[10px]', 'border-border', 'bg-card')
    })

    it('tints the header band and draws the bottom hairline only when expanded', () => {
      renderSection()
      const trigger = screen.getByTestId('secrets-section-trigger')
      expect(trigger).toHaveClass('bg-muted/30')
      expect(trigger).not.toHaveClass('border-b')
      expand()
      expect(trigger).toHaveClass('border-b', 'border-border')
    })
  })

  describe('trigger & collapsed pill', () => {
    it('shows a "Secrets" trigger, collapsed by default', () => {
      renderSection()
      expect(screen.getByTestId('secrets-section-trigger')).toHaveTextContent('Secrets')
      expect(screen.queryByTestId('secret-reveal-select')).not.toBeInTheDocument()
    })

    it('shows a "Revealing" pill on the collapsed trigger when effective-revealing', () => {
      renderSection({ effectiveRevealing: true })
      expect(screen.getByTestId('secret-reveal-pill')).toHaveTextContent('Revealing')
    })

    it('shows no pill when the block is effectively masked', () => {
      renderSection({ effectiveRevealing: false })
      expect(screen.queryByTestId('secret-reveal-pill')).not.toBeInTheDocument()
    })
  })

  describe('tri-state run-output control', () => {
    it('renders the run-output Select reflecting "Use system setting"', () => {
      renderSection({ secretMasking: 'system' })
      expand()
      expect(screen.getByTestId('secret-reveal-select')).toHaveTextContent('Use system setting')
    })

    it('reflects the "Always reveal" choice', () => {
      renderSection({ secretMasking: 'reveal' })
      expand()
      expect(screen.getByTestId('secret-reveal-select')).toHaveTextContent('Always reveal')
    })

    it('calls onSecretMaskingChange with the chosen option', async () => {
      const user = userEvent.setup()
      const onSecretMaskingChange = vi.fn()
      renderSection({ secretMasking: 'system', onSecretMaskingChange })
      expand()
      await user.click(screen.getByTestId('secret-reveal-select'))
      await user.click(await screen.findByRole('option', { name: /always mask/i }))
      expect(onSecretMaskingChange).toHaveBeenCalledWith('mask')
    })
  })

  describe('contextual helper / warning', () => {
    it('shows the "currently masked" helper for system + masked, no amber warning', () => {
      renderSection({ secretMasking: 'system', effectiveRevealing: false })
      expand()
      expect(screen.getByText(SYSTEM_MASKED_HELPER)).toBeInTheDocument()
      expect(screen.queryByTestId('secret-reveal-warning')).not.toBeInTheDocument()
    })

    it('shows the "currently revealing" helper for system + revealed, no amber warning', () => {
      renderSection({ secretMasking: 'system', effectiveRevealing: true })
      expand()
      expect(screen.getByText(SYSTEM_REVEALING_HELPER)).toBeInTheDocument()
      expect(screen.queryByTestId('secret-reveal-warning')).not.toBeInTheDocument()
    })

    it('shows the amber warning box for "Always reveal"', () => {
      renderSection({ secretMasking: 'reveal', effectiveRevealing: true })
      expand()
      expect(screen.getByTestId('secret-reveal-warning')).toBeInTheDocument()
    })

    it('shows the "kept masked" helper for "Always mask", no amber warning', () => {
      renderSection({ secretMasking: 'mask', effectiveRevealing: false })
      expand()
      expect(screen.getByText(ALWAYS_MASK_HELPER)).toBeInTheDocument()
      expect(screen.queryByTestId('secret-reveal-warning')).not.toBeInTheDocument()
    })
  })

  describe('"Mask specific fields" list', () => {
    it('renders the renamed header and one checkbox per field, masked by default', async () => {
      renderSection()
      expand()
      expect(await screen.findByText('Mask specific fields')).toBeInTheDocument()
      for (const field of HTTP_FIELDS) {
        expect(await screen.findByTestId(`secret-mask-field-${field.key}`)).toBeChecked()
      }
    })

    it('renders a revealed field unchecked while masked fields stay checked', async () => {
      renderSection({ unmaskedFields: ['authorization'] })
      expand()
      expect(await screen.findByTestId('secret-mask-field-authorization')).not.toBeChecked()
      expect(screen.getByTestId('secret-mask-field-cookie')).toBeChecked()
    })

    it('reveals a field (adds its key) when a checked box is unchecked', async () => {
      const onUnmaskedFieldsChange = vi.fn()
      renderSection({ unmaskedFields: [], onUnmaskedFieldsChange })
      expand()
      fireEvent.click(await screen.findByTestId('secret-mask-field-authorization'))
      expect(onUnmaskedFieldsChange).toHaveBeenCalledWith(['authorization'])
    })

    it('re-masks a field (removes its key) when a revealed box is re-checked', async () => {
      const onUnmaskedFieldsChange = vi.fn()
      renderSection({ unmaskedFields: ['authorization'], onUnmaskedFieldsChange })
      expand()
      fireEvent.click(await screen.findByTestId('secret-mask-field-authorization'))
      expect(onUnmaskedFieldsChange).toHaveBeenCalledWith([])
    })
  })

  describe('field list disabled when revealing', () => {
    it('disables the field checkboxes and shows the hint when effective-revealing', async () => {
      renderSection({ secretMasking: 'reveal', effectiveRevealing: true })
      expand()
      expect(await screen.findByTestId('secret-mask-field-authorization')).toBeDisabled()
      expect(screen.getByText(DISABLED_FIELDS_HINT)).toBeInTheDocument()
    })

    it('leaves the field checkboxes enabled when the block is masked', async () => {
      renderSection({ secretMasking: 'system', effectiveRevealing: false })
      expand()
      expect(await screen.findByTestId('secret-mask-field-authorization')).toBeEnabled()
      expect(screen.queryByText(DISABLED_FIELDS_HINT)).not.toBeInTheDocument()
    })
  })

  describe('plugins with no declared credential fields', () => {
    it('still renders the tri-state control but no "Mask specific fields" list', () => {
      renderSection({ fields: [] })
      expand()
      expect(screen.getByTestId('secret-reveal-select')).toBeInTheDocument()
      expect(screen.queryByText('Mask specific fields')).not.toBeInTheDocument()
    })
  })
})
