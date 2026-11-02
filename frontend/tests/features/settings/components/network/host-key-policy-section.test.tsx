/**
 * HostKeyPolicySection Component Tests
 *
 * REQ-4.5.14, NET-2: the "Lock trusted hosts" switch and
 * the "Default block action" select with the lock rule (Accept New becomes
 * Strict when Lock goes on; Accept New stays visible but disabled while
 * locked; turning Lock off keeps the value).
 *
 * Component under test: frontend/src/features/settings/components/network/host-key-policy-section.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'

import { HostKeyPolicySection } from '@/features/settings/components/network/host-key-policy-section'

type Policy = ComponentProps<typeof HostKeyPolicySection>['policy']

const LOCK_HELP = 'No block can add hosts. New and existing SSH blocks using "Accept New" act as "Strict".'
const DEFAULT_HELP = 'New blocks are configured in this mode by default. Existing blocks keep their current setting.'

const UNLOCKED_ACCEPT_NEW: Policy = { lock_trusted_hosts: false, default_block_action: 'accept-new' }
const UNLOCKED_STRICT: Policy = { lock_trusted_hosts: false, default_block_action: 'strict' }
const UNLOCKED_DISABLED: Policy = { lock_trusted_hosts: false, default_block_action: 'disabled' }
const LOCKED_STRICT: Policy = { lock_trusted_hosts: true, default_block_action: 'strict' }
const LOCKED_DISABLED: Policy = { lock_trusted_hosts: true, default_block_action: 'disabled' }

function renderSection(props: Partial<Omit<ComponentProps<typeof HostKeyPolicySection>, 'onChange'>> = {}) {
  const onChange = vi.fn()
  render(<HostKeyPolicySection policy={UNLOCKED_ACCEPT_NEW} onChange={onChange} {...props} />)
  return { onChange }
}

function lockSwitch(): HTMLElement {
  return screen.getByRole('switch', { name: 'Lock trusted hosts' })
}

function actionSelect(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Default block action' })
}

describe('HostKeyPolicySection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rows and copy', () => {
    it('renders the two row labels', () => {
      renderSection()

      expect(screen.getByText('Lock trusted hosts')).toBeInTheDocument()
      expect(screen.getByText('Default block action')).toBeInTheDocument()
    })

    it('renders the exact help copy of both rows', () => {
      renderSection()

      expect(screen.getByText(LOCK_HELP)).toBeInTheDocument()
      expect(screen.getByText(DEFAULT_HELP)).toBeInTheDocument()
    })

    it('names the switch and the select by their row labels and describes them by their help lines', () => {
      renderSection()

      expect(lockSwitch()).toHaveAccessibleDescription(LOCK_HELP)
      expect(actionSelect()).toHaveAccessibleDescription(DEFAULT_HELP)
    })

    it('points each row label at its control', () => {
      renderSection()

      expect(screen.getByText('Lock trusted hosts')).toHaveAttribute('for', lockSwitch().id)
      expect(screen.getByText('Default block action')).toHaveAttribute('for', actionSelect().id)
      expect(lockSwitch().id).not.toBe(actionSelect().id)
    })

    it('turns Lock on from its row label', async () => {
      const user = userEvent.setup()
      const { onChange } = renderSection()

      await user.click(screen.getByText('Lock trusted hosts'))

      expect(onChange).toHaveBeenCalledWith({ lock_trusted_hosts: true, default_block_action: 'strict' })
    })

    it('offers Strict, Accept New and Disabled in that order', async () => {
      const user = userEvent.setup()
      renderSection()

      await user.click(actionSelect())

      const names = screen.getAllByRole('option').map((option) => option.textContent)
      expect(names).toEqual(['Strict', 'Accept New', 'Disabled'])
    })
  })

  describe('Saved values', () => {
    it('shows Lock off and Accept New', () => {
      renderSection({ policy: UNLOCKED_ACCEPT_NEW })

      expect(lockSwitch()).toHaveAttribute('aria-checked', 'false')
      expect(actionSelect()).toHaveTextContent('Accept New')
    })

    it('shows Lock on and Strict', () => {
      renderSection({ policy: LOCKED_STRICT })

      expect(lockSwitch()).toHaveAttribute('aria-checked', 'true')
      expect(actionSelect()).toHaveTextContent('Strict')
    })

    it('shows Disabled', () => {
      renderSection({ policy: UNLOCKED_DISABLED })

      expect(actionSelect()).toHaveTextContent('Disabled')
    })
  })

  describe('Lock rule', () => {
    it('turning Lock on while the value is Accept New stores Strict', async () => {
      const user = userEvent.setup()
      const { onChange } = renderSection({ policy: UNLOCKED_ACCEPT_NEW })

      await user.click(lockSwitch())

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith({ lock_trusted_hosts: true, default_block_action: 'strict' })
    })

    it('turning Lock on while the value is Strict keeps Strict', async () => {
      const user = userEvent.setup()
      const { onChange } = renderSection({ policy: UNLOCKED_STRICT })

      await user.click(lockSwitch())

      expect(onChange).toHaveBeenCalledWith({ lock_trusted_hosts: true, default_block_action: 'strict' })
    })

    it('turning Lock on while the value is Disabled keeps Disabled', async () => {
      const user = userEvent.setup()
      const { onChange } = renderSection({ policy: UNLOCKED_DISABLED })

      await user.click(lockSwitch())

      expect(onChange).toHaveBeenCalledWith({ lock_trusted_hosts: true, default_block_action: 'disabled' })
    })

    it('turning Lock off keeps Strict (no automatic revert to Accept New)', async () => {
      const user = userEvent.setup()
      const { onChange } = renderSection({ policy: LOCKED_STRICT })

      await user.click(lockSwitch())

      expect(onChange).toHaveBeenCalledWith({ lock_trusted_hosts: false, default_block_action: 'strict' })
    })

    it('turning Lock off keeps Disabled', async () => {
      const user = userEvent.setup()
      const { onChange } = renderSection({ policy: LOCKED_DISABLED })

      await user.click(lockSwitch())

      expect(onChange).toHaveBeenCalledWith({ lock_trusted_hosts: false, default_block_action: 'disabled' })
    })

    it('keeps Accept New visible but disabled while locked', async () => {
      const user = userEvent.setup()
      renderSection({ policy: LOCKED_STRICT })

      await user.click(actionSelect())

      const acceptNew = screen.getByRole('option', { name: 'Accept New' })
      expect(acceptNew).toBeInTheDocument()
      expect(acceptNew).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByRole('option', { name: 'Strict' })).not.toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByRole('option', { name: 'Disabled' })).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('ignores a click on the disabled Accept New option while locked', async () => {
      const user = userEvent.setup()
      const { onChange } = renderSection({ policy: LOCKED_STRICT })

      await user.click(actionSelect())
      await user.click(screen.getByRole('option', { name: 'Accept New' }))

      expect(onChange).not.toHaveBeenCalled()
    })

    it('enables every option while unlocked', async () => {
      const user = userEvent.setup()
      renderSection({ policy: UNLOCKED_STRICT })

      await user.click(actionSelect())

      for (const name of ['Strict', 'Accept New', 'Disabled']) {
        expect(screen.getByRole('option', { name })).not.toHaveAttribute('aria-disabled', 'true')
      }
    })
  })

  describe('Default block action changes', () => {
    it('reports a new value with Lock unchanged', async () => {
      const user = userEvent.setup()
      const { onChange } = renderSection({ policy: UNLOCKED_ACCEPT_NEW })

      await user.click(actionSelect())
      await user.click(screen.getByRole('option', { name: 'Disabled' }))

      expect(onChange).toHaveBeenCalledWith({ lock_trusted_hosts: false, default_block_action: 'disabled' })
    })

    it('reports Accept New while unlocked', async () => {
      const user = userEvent.setup()
      const { onChange } = renderSection({ policy: UNLOCKED_STRICT })

      await user.click(actionSelect())
      await user.click(screen.getByRole('option', { name: 'Accept New' }))

      expect(onChange).toHaveBeenCalledWith({ lock_trusted_hosts: false, default_block_action: 'accept-new' })
    })

    it('reports Disabled while locked with Lock still on', async () => {
      const user = userEvent.setup()
      const { onChange } = renderSection({ policy: LOCKED_STRICT })

      await user.click(actionSelect())
      await user.click(screen.getByRole('option', { name: 'Disabled' }))

      expect(onChange).toHaveBeenCalledWith({ lock_trusted_hosts: true, default_block_action: 'disabled' })
    })
  })

  describe('Disabled', () => {
    it('disables both controls', () => {
      renderSection({ disabled: true })

      expect(lockSwitch()).toBeDisabled()
      expect(actionSelect()).toBeDisabled()
    })

    it('reports nothing when the disabled switch is clicked', async () => {
      const user = userEvent.setup()
      const { onChange } = renderSection({ disabled: true })

      await user.click(lockSwitch())

      expect(onChange).not.toHaveBeenCalled()
    })

    it('enables both controls by default', () => {
      renderSection()

      expect(lockSwitch()).toBeEnabled()
      expect(actionSelect()).toBeEnabled()
    })
  })
})
