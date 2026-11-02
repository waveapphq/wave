/**
 * NetworkSshHostsTab Component Tests
 *
 * REQ-4.5.14: the SSH Hosts page driven
 * through a UseSshHostsResult prop - pending, failed with Try Again, clean,
 * dirty, saving, policy changes, staged removals and the Add Hosts dialog.
 *
 * Component under test: frontend/src/features/settings/page/network-ssh-hosts-tab.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'

import { NetworkSshHostsTab } from '@/features/settings/page/network-ssh-hosts-tab'
import { detectHostKeys, parseHostLines } from '@/features/settings/api/ssh-hosts'

vi.mock('@/features/settings/api/ssh-hosts')

type SshHosts = ComponentProps<typeof NetworkSshHostsTab>['sshHosts']
type HostRow = SshHosts['hosts'][number]

const BASTION: HostRow = {
  id: 'h-bastion',
  host: 'bastion.corp.example',
  port: 22,
  key_type: 'ED25519',
  fingerprint: 'SHA256:J3hCIABLpkChd3aSNPXPdIBMt3NwSpjQ0mVvGk1cE7w',
  added: '2026-02-11T09:30:00Z',
}

const DB_JUMP: HostRow = {
  id: 'h-db-jump',
  host: 'db-jump.corp.example',
  port: 2222,
  key_type: 'ECDSA',
  fingerprint: 'SHA256:l2sQeqUZ4G1rLEsJSjPFe+cSWn1bBkF9xYp0aQ3rT8M',
  added: '2026-04-27T14:05:00Z',
}

const DETECTED_KEY = {
  host: 'db-09.lab.example',
  port: 22,
  key_type: 'ED25519' as const,
  key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGv7Qm0kP2nR5sT8uW1xY4zA7bC0dE3fG6hJ9kL2mN5p',
  fingerprint: 'SHA256:jLYQkA+eNH+uiG3GUHeV7HRcTD/LLrL0aB4cD8eF1gH',
}

const STAGED_DB_09: HostRow = {
  id: 'staged-1',
  host: DETECTED_KEY.host,
  port: DETECTED_KEY.port,
  key_type: DETECTED_KEY.key_type,
  fingerprint: DETECTED_KEY.fingerprint,
  key: DETECTED_KEY.key,
  added: null,
  staged: true,
}

const LOAD_ERROR =
  "WAVE's trusted SSH hosts list /srv/wave/data/network/ssh_hosts.yaml cannot be read: Permission denied"

function makeSshHosts(overrides: Partial<SshHosts> = {}): SshHosts {
  return {
    status: 'loaded',
    policy: { lock_trusted_hosts: false, default_block_action: 'accept-new' },
    hosts: [BASTION, DB_JUMP],
    dirty: false,
    saving: false,
    setPolicy: vi.fn(),
    addHosts: vi.fn(),
    removeHosts: vi.fn(),
    cancel: vi.fn(),
    save: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  }
}

function renderTab(overrides: Partial<SshHosts> = {}) {
  const sshHosts = makeSshHosts(overrides)
  render(<NetworkSshHostsTab sshHosts={sshHosts} />)
  return sshHosts
}

// The smallest ancestor of the "Host Key Policy" heading that holds Save; nesting depth is not pinned.
function policyHeader(): HTMLElement {
  let node = screen.getByRole('heading', { name: 'Host Key Policy' }).parentElement
  while (node && !within(node).queryByRole('button', { name: 'Save' })) {
    node = node.parentElement
  }
  if (!node) throw new Error('No Save button around the "Host Key Policy" heading')
  return node
}

function saveButton(): HTMLElement {
  return within(policyHeader()).getByRole('button', { name: 'Save' })
}

function cancelButton(): HTMLElement {
  return within(policyHeader()).getByRole('button', { name: 'Cancel' })
}

function lockSwitch(): HTMLElement {
  return screen.getByRole('switch', { name: 'Lock trusted hosts' })
}

function actionSelect(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Default block action' })
}

function follows(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

// Skeleton blocks per row of a placeholder group; a row is a child of the group.
function placeholderRows(group: HTMLElement): number[] {
  return Array.from(group.children, (row) => row.querySelectorAll('.skeleton').length)
}

async function openAddHostsDialog(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'Add hosts' }))
  return screen.findByRole('dialog', { name: 'Add Hosts' })
}

describe('NetworkSshHostsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(detectHostKeys).mockResolvedValue([DETECTED_KEY])
    vi.mocked(parseHostLines).mockResolvedValue({ entries: [], errors: [] })
  })

  describe('First read pending', () => {
    it('shows the "Host Key Policy" header with its title only, with no Cancel or Save', () => {
      renderTab({ status: 'pending', hosts: [] })

      const heading = screen.getByRole('heading', { name: 'Host Key Policy' })
      expect(heading.parentElement).not.toBeNull()
      expect(within(heading.parentElement as HTMLElement).queryAllByRole('button')).toHaveLength(0)
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })

    it('has no "SSH Hosts" heading', () => {
      renderTab({ status: 'pending', hosts: [] })

      expect(screen.queryByRole('heading', { name: 'SSH Hosts' })).not.toBeInTheDocument()
    })

    it('shows row skeletons in place of the policy controls', () => {
      renderTab({ status: 'pending', hosts: [] })

      expect(screen.getByTestId('host-key-policy-skeleton')).toBeInTheDocument()
      expect(screen.queryByRole('switch', { name: 'Lock trusted hosts' })).not.toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: 'Default block action' })).not.toBeInTheDocument()
    })

    it('draws one busy placeholder row per policy row: a label, a help line and a control', () => {
      renderTab({ status: 'pending', hosts: [] })

      const skeleton = screen.getByTestId('host-key-policy-skeleton')
      expect(skeleton).toHaveAttribute('aria-busy', 'true')
      expect(placeholderRows(skeleton)).toEqual([3, 3])
    })

    it('shows the table skeleton and no empty state', () => {
      renderTab({ status: 'pending', hosts: [] })

      expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0)
      expect(screen.queryByText('No trusted SSH hosts')).not.toBeInTheDocument()
    })
  })

  describe('First read failed', () => {
    it('shows the API reason with Try Again in place of the page body', () => {
      renderTab({ status: 'failed', error: LOAD_ERROR, hosts: [] })

      expect(screen.getByText(LOAD_ERROR)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument()
      expect(screen.queryByRole('switch', { name: 'Lock trusted hosts' })).not.toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    it('keeps the "Host Key Policy" heading alone, with no Cancel or Save', () => {
      renderTab({ status: 'failed', error: LOAD_ERROR, hosts: [] })

      const headings = screen.queryAllByRole('heading').map((heading) => heading.textContent?.trim())
      expect(headings).toEqual(['Host Key Policy'])
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    })

    it('puts the read failure under the "Host Key Policy" heading, with the API reason and Try Again', async () => {
      const user = userEvent.setup()
      const sshHosts = renderTab({ status: 'failed', error: LOAD_ERROR, hosts: [] })

      const alert = screen.getByRole('alert')
      expect(follows(screen.getByRole('heading', { name: 'Host Key Policy' }), alert)).toBe(true)
      expect(within(alert).getByText(LOAD_ERROR)).toBeInTheDocument()
      await user.click(within(alert).getByRole('button', { name: 'Try Again' }))

      expect(sshHosts.retry).toHaveBeenCalledTimes(1)
    })

    it('Try Again calls retry', async () => {
      const user = userEvent.setup()
      const sshHosts = renderTab({ status: 'failed', error: LOAD_ERROR, hosts: [] })

      await user.click(screen.getByRole('button', { name: 'Try Again' }))

      expect(sshHosts.retry).toHaveBeenCalledTimes(1)
    })

    it('still offers Try Again when the failure carries no reason', async () => {
      const user = userEvent.setup()
      const sshHosts = renderTab({ status: 'failed', error: undefined, hosts: [] })

      expect(screen.getByRole('alert')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Try Again' }))

      expect(sshHosts.retry).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })
  })

  describe('Loaded, clean', () => {
    it('shows exactly the two section headers in order, with no "SSH Hosts" title', () => {
      renderTab()

      const headings = screen.getAllByRole('heading').map((heading) => heading.textContent?.trim())
      expect(headings).toEqual(['Host Key Policy', 'Trusted SSH Hosts'])
      expect(screen.queryByRole('heading', { name: 'SSH Hosts' })).not.toBeInTheDocument()
    })

    it('puts Cancel and Save in the "Host Key Policy" header, apart from the policy rows and the table', () => {
      renderTab()

      const header = policyHeader()
      expect(within(header).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(within(header).getByRole('button', { name: 'Save' })).toBeInTheDocument()
      expect(within(header).queryByRole('switch', { name: 'Lock trusted hosts' })).not.toBeInTheDocument()
      expect(within(header).queryByRole('heading', { name: 'Trusted SSH Hosts' })).not.toBeInTheDocument()
      expect(within(header).queryByRole('table')).not.toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1)
      expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1)
    })

    it('disables Cancel and Save', () => {
      renderTab()

      expect(cancelButton()).toBeDisabled()
      expect(saveButton()).toBeDisabled()
    })

    it('shows the saved policy', () => {
      renderTab()

      expect(lockSwitch()).toHaveAttribute('aria-checked', 'false')
      expect(actionSelect()).toHaveTextContent('Accept New')
    })

    it('shows a saved locked policy', () => {
      renderTab({ policy: { lock_trusted_hosts: true, default_block_action: 'strict' } })

      expect(lockSwitch()).toHaveAttribute('aria-checked', 'true')
      expect(actionSelect()).toHaveTextContent('Strict')
    })

    it('lists the trusted hosts with the hosts count', () => {
      renderTab()

      expect(screen.getByText('bastion.corp.example')).toBeInTheDocument()
      expect(screen.getByText('db-jump.corp.example')).toBeInTheDocument()
      expect(screen.getByTestId('pagination-item-count')).toHaveTextContent('Showing 1-2 of 2 hosts')
    })

    it('enables the policy controls, Add hosts, Mass Action and trash', () => {
      renderTab()

      expect(lockSwitch()).toBeEnabled()
      expect(actionSelect()).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Add hosts' })).toBeEnabled()
      expect(screen.getByRole('button', { name: /Mass Action/ })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Remove bastion.corp.example' })).toBeEnabled()
    })
  })

  describe('Dirty', () => {
    it('enables Save and Cancel', () => {
      renderTab({ dirty: true })

      expect(saveButton()).toBeEnabled()
      expect(cancelButton()).toBeEnabled()
    })

    it('Save calls save', async () => {
      const user = userEvent.setup()
      const sshHosts = renderTab({ dirty: true })

      await user.click(saveButton())

      expect(sshHosts.save).toHaveBeenCalledTimes(1)
      expect(sshHosts.cancel).not.toHaveBeenCalled()
    })

    it('Cancel calls cancel', async () => {
      const user = userEvent.setup()
      const sshHosts = renderTab({ dirty: true })

      await user.click(cancelButton())

      expect(sshHosts.cancel).toHaveBeenCalledTimes(1)
      expect(sshHosts.save).not.toHaveBeenCalled()
    })

    it('keeps host names and fingerprints out of page translation', () => {
      renderTab({ hosts: [BASTION] })

      expect(screen.getByText(BASTION.host)).toHaveAttribute('translate', 'no')
      expect(screen.getByText(BASTION.fingerprint)).toHaveAttribute('translate', 'no')
    })

    it('shows staged rows from the hook with "Unsaved" in Added', () => {
      renderTab({ dirty: true, hosts: [BASTION, STAGED_DB_09, DB_JUMP] })

      const row = screen.getByText('db-09.lab.example').closest('tr') as HTMLElement
      expect(within(row).getByText('Unsaved')).toBeInTheDocument()
    })
  })

  describe('Saving', () => {
    it('shows Save busy and disables Cancel and Save', () => {
      renderTab({ dirty: true, saving: true })

      expect(saveButton()).toHaveAttribute('aria-busy', 'true')
      expect(saveButton()).toBeDisabled()
      expect(cancelButton()).toBeDisabled()
    })

    it('disables the policy controls', () => {
      renderTab({ dirty: true, saving: true })

      expect(lockSwitch()).toBeDisabled()
      expect(actionSelect()).toBeDisabled()
    })

    it('disables Add hosts, every trash button and Mass Action', () => {
      renderTab({ dirty: true, saving: true })

      expect(screen.getByRole('button', { name: 'Add hosts' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Remove bastion.corp.example' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Remove db-jump.corp.example' })).toBeDisabled()
      expect(screen.getByRole('button', { name: /Mass Action/ })).toBeDisabled()
    })

    it('does not call save again when the busy Save is clicked', async () => {
      const user = userEvent.setup()
      const sshHosts = renderTab({ dirty: true, saving: true })

      await user.click(saveButton())

      expect(sshHosts.save).not.toHaveBeenCalled()
    })
  })

  describe('Policy changes', () => {
    it('turning Lock on while Accept New stages Strict through setPolicy', async () => {
      const user = userEvent.setup()
      const sshHosts = renderTab()

      await user.click(lockSwitch())

      expect(sshHosts.setPolicy).toHaveBeenCalledWith({ lock_trusted_hosts: true, default_block_action: 'strict' })
    })

    it('choosing a default block action stages it through setPolicy', async () => {
      const user = userEvent.setup()
      const sshHosts = renderTab()

      await user.click(actionSelect())
      await user.click(screen.getByRole('option', { name: 'Disabled' }))

      expect(sshHosts.setPolicy).toHaveBeenCalledWith({ lock_trusted_hosts: false, default_block_action: 'disabled' })
    })
  })

  describe('Staged removals', () => {
    it('the trash icon stages the removal through removeHosts with no confirmation', async () => {
      const user = userEvent.setup()
      const sshHosts = renderTab()

      await user.click(screen.getByRole('button', { name: 'Remove db-jump.corp.example' }))

      expect(sshHosts.removeHosts).toHaveBeenCalledWith(['h-db-jump'])
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('Mass Action Delete stages the selected removals through removeHosts', async () => {
      const user = userEvent.setup()
      const sshHosts = renderTab()

      await user.click(screen.getByRole('button', { name: /Mass Action/ }))
      const row = screen.getByText('bastion.corp.example').closest('tr') as HTMLElement
      await user.click(within(row).getByRole('checkbox'))
      await user.click(screen.getByRole('button', { name: '1 selected' }))
      await user.click(await screen.findByRole('menuitem', { name: /Delete/ }))

      expect(sshHosts.removeHosts).toHaveBeenCalledWith(['h-bastion'])
    })
  })

  describe('Viewport-filling layout (DASH-4, DASH-5, DASH-8)', () => {
    it.each([
      ['loaded', {}],
      ['pending', { status: 'pending' as const }],
      ['failed', { status: 'failed' as const, error: LOAD_ERROR }],
      ['empty', { hosts: [] }],
    ])('%s page fills the content column with h-full overflow-hidden', (_state, overrides) => {
      renderTab(overrides)

      const page = screen.getByTestId('network-ssh-hosts-tab')
      expect(page).toHaveClass('flex', 'flex-col', 'h-full', 'overflow-hidden')
    })

    it('the Trusted SSH Hosts section and its table take the remaining height', () => {
      renderTab()

      const table = screen.getByTestId('trusted-hosts-table')
      expect(table).toHaveClass('flex-1', 'min-h-0')
      expect(table.closest('section')).toHaveClass('flex', 'flex-col', 'flex-1', 'min-h-0')
    })

    it('pagination is anchored at the bottom with flex-shrink-0', () => {
      renderTab()

      expect(screen.getByTestId('pagination')).toHaveClass('flex-shrink-0')
    })
  })

  describe('No hosts', () => {
    it('shows "No trusted SSH hosts" with its Add hosts button', () => {
      renderTab({ hosts: [] })

      const cell = screen.getByText('No trusted SSH hosts').closest('td') as HTMLElement
      expect(within(cell).getByRole('button', { name: 'Add hosts' })).toBeInTheDocument()
    })

    it('the empty state Add hosts button opens the Add Hosts dialog', async () => {
      const user = userEvent.setup()
      renderTab({ hosts: [] })

      const cell = screen.getByText('No trusted SSH hosts').closest('td') as HTMLElement
      await user.click(within(cell).getByRole('button', { name: 'Add hosts' }))

      expect(await screen.findByRole('dialog', { name: 'Add Hosts' })).toBeInTheDocument()
    })
  })

  describe('Add Hosts dialog', () => {
    it('is closed until Add hosts is clicked', () => {
      renderTab()

      expect(screen.queryByRole('dialog', { name: 'Add Hosts' })).not.toBeInTheDocument()
    })

    it('opens from the toolbar Add hosts button', async () => {
      const user = userEvent.setup()
      renderTab()

      const dialog = await openAddHostsDialog(user)

      expect(dialog).toBeInTheDocument()
    })

    it('hands the detected entries to addHosts and closes', async () => {
      const user = userEvent.setup()
      const sshHosts = renderTab()

      const dialog = await openAddHostsDialog(user)
      await user.type(within(dialog).getByRole('textbox', { name: 'Host' }), DETECTED_KEY.host)
      await user.click(within(dialog).getByRole('button', { name: 'Detect' }))
      expect(await within(dialog).findByText(DETECTED_KEY.fingerprint)).toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: 'Add' }))

      await waitFor(() => {
        expect(sshHosts.addHosts).toHaveBeenCalledWith([
          {
            host: DETECTED_KEY.host,
            port: DETECTED_KEY.port,
            key_type: DETECTED_KEY.key_type,
            key: DETECTED_KEY.key,
            fingerprint: DETECTED_KEY.fingerprint,
          },
        ])
      })
      expect(detectHostKeys).toHaveBeenCalledWith(DETECTED_KEY.host, 22)
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Add Hosts' })).not.toBeInTheDocument()
      })
    })

    it('checks detected keys against the staged hosts', async () => {
      const user = userEvent.setup()
      const sshHosts = renderTab({ dirty: true, hosts: [BASTION, STAGED_DB_09] })

      const dialog = await openAddHostsDialog(user)
      await user.type(within(dialog).getByRole('textbox', { name: 'Host' }), DETECTED_KEY.host)
      await user.click(within(dialog).getByRole('button', { name: 'Detect' }))

      expect(await within(dialog).findByText('Already trusted')).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Add' })).toBeDisabled()
      expect(sshHosts.addHosts).not.toHaveBeenCalled()
    })

    it('Cancel closes the dialog and stages nothing', async () => {
      const user = userEvent.setup()
      const sshHosts = renderTab()

      const dialog = await openAddHostsDialog(user)
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Add Hosts' })).not.toBeInTheDocument()
      })
      expect(sshHosts.addHosts).not.toHaveBeenCalled()
    })
  })
})
