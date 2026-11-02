/**
 * SettingsNav Component Tests
 *
 * REQ-5.2.1.42: Settings and preferences screen - Section navigation
 *
 * Tests for SettingsNav component per design decisions:
 * - SETTINGS-2: Sections: General, Environments, Variables, Network, MCP Server, WAVE Server, Backup, About
 * - SETTINGS-3: Selected: $blue10 bg, white text
 * - NET-1: Network is a collapsible parent with the SSH Hosts, Certificates and Proxy pages
 * - NET-10: Proxy is a parent under Network with the Setup and Blocks pages and no page of its own
 *
 * Component: frontend/src/features/settings/components/settings-nav.tsx
 */

import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  SettingsNav,
  isNetworkSection,
  type SettingsNavProps,
  type SettingsSection,
} from '@/features/settings/components/settings-nav'
import { useSettingsNavStore } from '@/features/settings/stores/settings-nav-store'

// ============================================================================
// Test Utilities
// ============================================================================

function renderSettingsNav(props: Partial<SettingsNavProps> = {}) {
  const defaultProps: SettingsNavProps = {
    activeSection: 'environments',
    onSectionChange: vi.fn(),
    ...props,
  }
  return render(<SettingsNav {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('SettingsNav', () => {
  // The groups' open state outlives a mount; each test starts as after a page load.
  beforeEach(() => {
    useSettingsNavStore.setState(useSettingsNavStore.getInitialState(), true)
  })

  describe('Structure', () => {
    it('renders nav container with correct testid', () => {
      renderSettingsNav()
      expect(screen.getByTestId('settings-sections')).toBeInTheDocument()
    })
  })

  describe('Section Items (SETTINGS-2)', () => {
    it('renders General section item', () => {
      renderSettingsNav()
      expect(screen.getByRole('button', { name: /General/i })).toBeInTheDocument()
    })

    it('renders Environments section item', () => {
      renderSettingsNav()
      expect(screen.getByRole('button', { name: /Environments/i })).toBeInTheDocument()
    })

    it('does not render an Integrations section item', () => {
      renderSettingsNav()
      expect(screen.queryByRole('button', { name: /Integrations/i })).not.toBeInTheDocument()
    })

    it('renders About section item', () => {
      renderSettingsNav()
      expect(screen.getByRole('button', { name: /About/i })).toBeInTheDocument()
    })

    it('renders Backup section item', () => {
      renderSettingsNav()
      expect(screen.getByRole('button', { name: /Backup/i })).toBeInTheDocument()
    })

    it('renders Variables section item', () => {
      renderSettingsNav()
      expect(screen.getByRole('button', { name: /Variables/i })).toBeInTheDocument()
    })

    it('renders MCP Server section item', () => {
      renderSettingsNav()
      expect(screen.getByRole('button', { name: /MCP Server/i })).toBeInTheDocument()
    })

    it('renders sections in correct order', () => {
      renderSettingsNav()
      const buttons = screen.getAllByRole('button')
      expect(buttons[0]).toHaveTextContent(/General/i)
      expect(buttons[1]).toHaveTextContent(/Environments/i)
      expect(buttons[2]).toHaveTextContent(/Variables/i)
      expect(buttons[3]).toHaveTextContent(/Network/i)
      expect(buttons[4]).toHaveTextContent(/MCP Server/i)
      expect(buttons[5]).toHaveTextContent(/WAVE Server/i)
      expect(buttons[6]).toHaveTextContent(/Backup/i)
      expect(buttons[7]).toHaveTextContent(/About/i)
      expect(buttons).toHaveLength(8)
    })
  })

  describe('Active State (SETTINGS-3)', () => {
    it('General is highlighted when active', () => {
      renderSettingsNav({ activeSection: 'general' })
      const generalButton = screen.getByRole('button', { name: /General/i })
      // Uses inline style for $blue10 per SETTINGS-3
      expect(generalButton).toHaveStyle({ backgroundColor: 'rgb(37, 99, 235)' })
      expect(generalButton).toHaveStyle({ color: 'rgb(255, 255, 255)' })
    })

    it('Environments is highlighted when active', () => {
      renderSettingsNav({ activeSection: 'environments' })
      const environmentsButton = screen.getByRole('button', { name: /Environments/i })
      expect(environmentsButton).toHaveStyle({ backgroundColor: 'rgb(37, 99, 235)' })
      expect(environmentsButton).toHaveStyle({ color: 'rgb(255, 255, 255)' })
    })

    it('Variables is highlighted when active', () => {
      renderSettingsNav({ activeSection: 'variables' })
      const variablesButton = screen.getByRole('button', { name: /Variables/i })
      expect(variablesButton).toHaveStyle({ backgroundColor: 'rgb(37, 99, 235)' })
      expect(variablesButton).toHaveStyle({ color: 'rgb(255, 255, 255)' })
    })

    it('Backup is highlighted when active', () => {
      renderSettingsNav({ activeSection: 'backup' })
      const backupButton = screen.getByRole('button', { name: /Backup/i })
      expect(backupButton).toHaveStyle({ backgroundColor: 'rgb(37, 99, 235)' })
      expect(backupButton).toHaveStyle({ color: 'rgb(255, 255, 255)' })
    })

    it('About is highlighted when active', () => {
      renderSettingsNav({ activeSection: 'about' })
      const aboutButton = screen.getByRole('button', { name: /About/i })
      expect(aboutButton).toHaveStyle({ backgroundColor: 'rgb(37, 99, 235)' })
      expect(aboutButton).toHaveStyle({ color: 'rgb(255, 255, 255)' })
    })

    it('MCP Server is highlighted when active', () => {
      renderSettingsNav({ activeSection: 'mcp' })
      const mcpButton = screen.getByRole('button', { name: /MCP Server/i })
      expect(mcpButton).toHaveStyle({ backgroundColor: 'rgb(37, 99, 235)' })
      expect(mcpButton).toHaveStyle({ color: 'rgb(255, 255, 255)' })
    })

    it('inactive sections have default background', () => {
      renderSettingsNav({ activeSection: 'environments' })
      const generalButton = screen.getByRole('button', { name: /General/i })
      expect(generalButton).not.toHaveStyle({ backgroundColor: 'rgb(37, 99, 235)' })
    })

    it('only one section is active at a time', () => {
      renderSettingsNav({ activeSection: 'about' })
      const buttons = screen.getAllByRole('button')
      const activeButtons = buttons.filter(
        (btn) => btn.style.backgroundColor === 'rgb(37, 99, 235)'
      )
      expect(activeButtons).toHaveLength(1)
    })
  })

  describe('Click Handlers', () => {
    it('calls onSectionChange with "general" when General is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()

      renderSettingsNav({ onSectionChange: handleSectionChange })
      await user.click(screen.getByRole('button', { name: /General/i }))

      expect(handleSectionChange).toHaveBeenCalledWith('general')
    })

    it('calls onSectionChange with "environments" when Environments is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()

      renderSettingsNav({ onSectionChange: handleSectionChange })
      await user.click(screen.getByRole('button', { name: /Environments/i }))

      expect(handleSectionChange).toHaveBeenCalledWith('environments')
    })

    it('calls onSectionChange with "variables" when Variables is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()

      renderSettingsNav({ onSectionChange: handleSectionChange })
      await user.click(screen.getByRole('button', { name: /Variables/i }))

      expect(handleSectionChange).toHaveBeenCalledWith('variables')
    })

    it('calls onSectionChange with "backup" when Backup is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()

      renderSettingsNav({ onSectionChange: handleSectionChange })
      await user.click(screen.getByRole('button', { name: /Backup/i }))

      expect(handleSectionChange).toHaveBeenCalledWith('backup')
    })

    it('calls onSectionChange with "about" when About is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()

      renderSettingsNav({ onSectionChange: handleSectionChange })
      await user.click(screen.getByRole('button', { name: /About/i }))

      expect(handleSectionChange).toHaveBeenCalledWith('about')
    })

    it('calls onSectionChange with "mcp" when MCP Server is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()

      renderSettingsNav({ onSectionChange: handleSectionChange })
      await user.click(screen.getByRole('button', { name: /MCP Server/i }))

      expect(handleSectionChange).toHaveBeenCalledWith('mcp')
    })

    it('calls onSectionChange even when clicking active section', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()

      renderSettingsNav({ activeSection: 'environments', onSectionChange: handleSectionChange })
      await user.click(screen.getByRole('button', { name: /Environments/i }))

      expect(handleSectionChange).toHaveBeenCalledWith('environments')
    })
  })

  describe('Keyboard Navigation', () => {
    it('buttons are focusable', () => {
      renderSettingsNav()
      const generalButton = screen.getByRole('button', { name: /General/i })
      generalButton.focus()
      expect(generalButton).toHaveFocus()
    })

    it('Enter key activates button', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()

      renderSettingsNav({ onSectionChange: handleSectionChange })
      const generalButton = screen.getByRole('button', { name: /General/i })
      generalButton.focus()
      await user.keyboard('{Enter}')

      expect(handleSectionChange).toHaveBeenCalledWith('general')
    })

    it('Space key activates button', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()

      renderSettingsNav({ onSectionChange: handleSectionChange })
      const generalButton = screen.getByRole('button', { name: /General/i })
      generalButton.focus()
      await user.keyboard(' ')

      expect(handleSectionChange).toHaveBeenCalledWith('general')
    })

    it('Tab navigates between buttons', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderSettingsNav()
      const generalButton = screen.getByRole('button', { name: /General/i })
      generalButton.focus()
      await user.tab()

      expect(screen.getByRole('button', { name: /Environments/i })).toHaveFocus()
    })
  })

  describe('Accessibility', () => {
    it('active section has aria-current="page"', () => {
      renderSettingsNav({ activeSection: 'environments' })
      const environmentsButton = screen.getByRole('button', { name: /Environments/i })
      expect(environmentsButton).toHaveAttribute('aria-current', 'page')
    })

    it('inactive sections do not have aria-current', () => {
      renderSettingsNav({ activeSection: 'environments' })
      const generalButton = screen.getByRole('button', { name: /General/i })
      expect(generalButton).not.toHaveAttribute('aria-current')
    })

    it('buttons have type="button" to prevent form submission', () => {
      renderSettingsNav()
      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toHaveAttribute('type', 'button')
      })
    })
  })

  describe('Icons', () => {
    it('General section has settings icon', () => {
      renderSettingsNav()
      const generalButton = screen.getByRole('button', { name: /General/i })
      expect(generalButton.querySelector('[data-testid="icon-settings"]')).toBeInTheDocument()
    })

    it('Environments section has globe icon', () => {
      renderSettingsNav()
      const environmentsButton = screen.getByRole('button', { name: /Environments/i })
      expect(environmentsButton.querySelector('[data-testid="icon-globe"]')).toBeInTheDocument()
    })

    it('Variables section has braces icon', () => {
      renderSettingsNav()
      const variablesButton = screen.getByRole('button', { name: /Variables/i })
      expect(variablesButton.querySelector('[data-testid="icon-braces"]')).toBeInTheDocument()
    })

    it('Backup section has archive icon', () => {
      renderSettingsNav()
      const backupButton = screen.getByRole('button', { name: /Backup/i })
      expect(backupButton.querySelector('[data-testid="icon-archive"]')).toBeInTheDocument()
    })

    it('About section has info icon', () => {
      renderSettingsNav()
      const aboutButton = screen.getByRole('button', { name: /About/i })
      expect(aboutButton.querySelector('[data-testid="icon-info"]')).toBeInTheDocument()
    })

    it('MCP Server section has bot icon', () => {
      renderSettingsNav()
      const mcpButton = screen.getByRole('button', { name: /MCP Server/i })
      expect(mcpButton.querySelector('[data-testid="icon-bot"]')).toBeInTheDocument()
    })
  })

  describe('Layout', () => {
    it('nav items are arranged vertically', () => {
      renderSettingsNav()
      const nav = screen.getByTestId('settings-sections')
      expect(nav).toHaveClass('flex-col')
    })

    it('nav items have consistent spacing', () => {
      renderSettingsNav()
      const nav = screen.getByTestId('settings-sections')
      expect(nav).toHaveClass('gap-1')
    })

    it('nav items fill width', () => {
      renderSettingsNav()
      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toHaveClass('w-full')
      })
    })
  })

  describe('Network group (NET-1)', () => {
    const BLUE = 'rgb(37, 99, 235)'

    function networkButton() {
      return screen.getByRole('button', { name: 'Network' })
    }

    it('renders the Network parent between Variables and MCP Server', () => {
      renderSettingsNav()
      const labels = screen.getAllByRole('button').map((b) => b.textContent)
      expect(labels.indexOf('Network')).toBe(labels.indexOf('Variables') + 1)
      expect(labels.indexOf('MCP Server')).toBe(labels.indexOf('Network') + 1)
    })

    it('shows the network icon on the Network parent', () => {
      renderSettingsNav()
      expect(networkButton().querySelector('svg.lucide-network')).toBeInTheDocument()
    })

    it('is collapsed when the active section is outside Network', () => {
      renderSettingsNav({ activeSection: 'environments' })
      expect(networkButton()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('group', { name: 'Network' })).not.toBeInTheDocument()
    })

    it('hides SSH Hosts and Certificates while collapsed', () => {
      renderSettingsNav({ activeSection: 'environments' })
      expect(screen.queryByRole('button', { name: 'SSH Hosts' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Certificates' })).not.toBeInTheDocument()
    })

    it('expands on click and shows the children in a group labeled "Network"', async () => {
      const user = userEvent.setup()
      renderSettingsNav({ activeSection: 'environments' })

      await user.click(networkButton())

      expect(networkButton()).toHaveAttribute('aria-expanded', 'true')
      const group = screen.getByRole('group', { name: 'Network' })
      const children = within(group).getAllByRole('button')
      expect(children.map((b) => b.textContent)).toEqual(['SSH Hosts', 'Certificates', 'Proxy'])
      children.forEach((child) => {
        expect(child).toHaveAttribute('type', 'button')
      })
    })

    it('points aria-controls at the child group', async () => {
      const user = userEvent.setup()
      renderSettingsNav({ activeSection: 'environments' })

      await user.click(networkButton())

      const group = screen.getByRole('group', { name: 'Network' })
      expect(group.id).not.toBe('')
      expect(networkButton()).toHaveAttribute('aria-controls', group.id)
    })

    it('collapses again on a second click', async () => {
      const user = userEvent.setup()
      renderSettingsNav({ activeSection: 'environments' })

      await user.click(networkButton())
      await user.click(networkButton())

      expect(networkButton()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('button', { name: 'SSH Hosts' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Certificates' })).not.toBeInTheDocument()
    })

    it('toggles only and never calls onSectionChange', async () => {
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()
      renderSettingsNav({ activeSection: 'environments', onSectionChange: handleSectionChange })

      await user.click(networkButton())
      await user.click(networkButton())

      expect(handleSectionChange).not.toHaveBeenCalled()
    })

    it('toggles with Enter and Space without navigating', async () => {
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()
      renderSettingsNav({ activeSection: 'environments', onSectionChange: handleSectionChange })

      networkButton().focus()
      await user.keyboard('{Enter}')
      expect(networkButton()).toHaveAttribute('aria-expanded', 'true')

      await user.keyboard(' ')
      expect(networkButton()).toHaveAttribute('aria-expanded', 'false')
      expect(handleSectionChange).not.toHaveBeenCalled()
    })

    it('puts the expanded children in Tab order between Network and MCP Server', async () => {
      const user = userEvent.setup()
      renderSettingsNav({ activeSection: 'environments' })

      await user.click(networkButton())
      networkButton().focus()

      await user.tab()
      expect(screen.getByRole('button', { name: 'SSH Hosts' })).toHaveFocus()
      await user.tab()
      expect(screen.getByRole('button', { name: 'Certificates' })).toHaveFocus()
      await user.tab()
      expect(screen.getByRole('button', { name: 'Proxy' })).toHaveFocus()
      await user.tab()
      expect(screen.getByRole('button', { name: /MCP Server/i })).toHaveFocus()
    })

    it('calls onSectionChange with "network-ssh-hosts" when SSH Hosts is clicked', async () => {
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()
      renderSettingsNav({ activeSection: 'environments', onSectionChange: handleSectionChange })

      await user.click(networkButton())
      await user.click(screen.getByRole('button', { name: 'SSH Hosts' }))

      expect(handleSectionChange).toHaveBeenCalledTimes(1)
      expect(handleSectionChange).toHaveBeenCalledWith('network-ssh-hosts')
    })

    it('calls onSectionChange with "network-certificates" when Certificates is clicked', async () => {
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()
      renderSettingsNav({ activeSection: 'environments', onSectionChange: handleSectionChange })

      await user.click(networkButton())
      await user.click(screen.getByRole('button', { name: 'Certificates' }))

      expect(handleSectionChange).toHaveBeenCalledTimes(1)
      expect(handleSectionChange).toHaveBeenCalledWith('network-certificates')
    })

    it('is expanded with SSH Hosts current when SSH Hosts is the active section', () => {
      renderSettingsNav({ activeSection: 'network-ssh-hosts' })

      expect(networkButton()).toHaveAttribute('aria-expanded', 'true')
      const sshHosts = screen.getByRole('button', { name: 'SSH Hosts' })
      expect(sshHosts).toHaveAttribute('aria-current', 'page')
      expect(sshHosts).toHaveStyle({ backgroundColor: BLUE })
      expect(sshHosts).toHaveStyle({ color: 'rgb(255, 255, 255)' })
      expect(screen.getByRole('button', { name: 'Certificates' })).not.toHaveAttribute(
        'aria-current',
      )
    })

    it('is expanded with Certificates current when Certificates is the active section', () => {
      renderSettingsNav({ activeSection: 'network-certificates' })

      expect(networkButton()).toHaveAttribute('aria-expanded', 'true')
      const certificates = screen.getByRole('button', { name: 'Certificates' })
      expect(certificates).toHaveAttribute('aria-current', 'page')
      expect(certificates).toHaveStyle({ backgroundColor: BLUE })
      expect(screen.getByRole('button', { name: 'SSH Hosts' })).not.toHaveAttribute(
        'aria-current',
      )
    })

    it('does not highlight the Network parent while a child is active (SETTINGS-3)', () => {
      renderSettingsNav({ activeSection: 'network-ssh-hosts' })

      expect(networkButton()).not.toHaveAttribute('aria-current')
      expect(networkButton()).not.toHaveStyle({ backgroundColor: BLUE })
    })

    it('marks exactly one item active while a child is active', () => {
      renderSettingsNav({ activeSection: 'network-certificates' })

      const active = screen.getAllByRole('button').filter((b) => b.style.backgroundColor === BLUE)
      expect(active).toHaveLength(1)
      expect(active[0]).toHaveTextContent('Certificates')
      expect(screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-current'))).toEqual(
        active,
      )
    })

    it('expands when the active section moves to a Network page', () => {
      const { rerender } = renderSettingsNav({ activeSection: 'general' })
      expect(networkButton()).toHaveAttribute('aria-expanded', 'false')

      rerender(<SettingsNav activeSection="network-certificates" onSectionChange={vi.fn()} />)

      expect(networkButton()).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('button', { name: 'Certificates' })).toHaveAttribute(
        'aria-current',
        'page',
      )
    })

    it('stays expanded after moving from a Network page to another section', () => {
      const { rerender } = renderSettingsNav({ activeSection: 'network-ssh-hosts' })

      rerender(<SettingsNav activeSection="mcp" onSectionChange={vi.fn()} />)

      expect(networkButton()).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('button', { name: 'SSH Hosts' })).toBeInTheDocument()
    })

    it('stays expanded after the user expands it and moves to another section', async () => {
      const user = userEvent.setup()
      const { rerender } = renderSettingsNav({ activeSection: 'general' })

      await user.click(networkButton())
      rerender(<SettingsNav activeSection="mcp" onSectionChange={vi.fn()} />)

      expect(networkButton()).toHaveAttribute('aria-expanded', 'true')
    })

    it('keeps the user expanding it when Settings is left and opened again', async () => {
      const user = userEvent.setup()
      const { unmount } = renderSettingsNav({ activeSection: 'general' })

      await user.click(networkButton())
      unmount()
      renderSettingsNav({ activeSection: 'about' })

      expect(networkButton()).toHaveAttribute('aria-expanded', 'true')
    })

    it('keeps the user collapsing it when Settings is left and opened again on a Network page', async () => {
      const user = userEvent.setup()
      const { unmount } = renderSettingsNav({ activeSection: 'network-ssh-hosts' })

      await user.click(networkButton())
      unmount()
      renderSettingsNav({ activeSection: 'network-ssh-hosts' })

      expect(networkButton()).toHaveAttribute('aria-expanded', 'false')
    })

    it('keeps an auto-opened group open when Settings is left from a Network page and opened again elsewhere', () => {
      const { unmount } = renderSettingsNav({ activeSection: 'network-certificates' })

      unmount()
      renderSettingsNav({ activeSection: 'general' })

      expect(networkButton()).toHaveAttribute('aria-expanded', 'true')
    })

    it('collapses on click while a child is active, without navigating', async () => {
      const user = userEvent.setup()
      const handleSectionChange = vi.fn()
      renderSettingsNav({ activeSection: 'network-ssh-hosts', onSectionChange: handleSectionChange })

      await user.click(networkButton())

      expect(networkButton()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('button', { name: 'SSH Hosts' })).not.toBeInTheDocument()
      expect(handleSectionChange).not.toHaveBeenCalled()
    })
  })

  describe('Proxy group under Network (NET-10)', () => {
    const BLUE = 'rgb(37, 99, 235)'

    function networkButton() {
      return screen.getByRole('button', { name: 'Network' })
    }

    function proxyButton() {
      return screen.getByRole('button', { name: 'Proxy' })
    }

    function proxyGroup() {
      return screen.getByRole('group', { name: 'Proxy' })
    }

    describe('Structure', () => {
      it('lists Proxy with Setup and Blocks after Certificates and before MCP Server', () => {
        renderSettingsNav({ activeSection: 'network-proxy-setup' })

        expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
          'General',
          'Environments',
          'Variables',
          'Network',
          'SSH Hosts',
          'Certificates',
          'Proxy',
          'Setup',
          'Blocks',
          'MCP Server',
          'WAVE Server',
          'Backup',
          'About',
        ])
      })

      it('puts the Proxy parent and its child group inside the Network group', () => {
        renderSettingsNav({ activeSection: 'network-proxy-setup' })

        const network = screen.getByRole('group', { name: 'Network' })
        expect(within(network).getByRole('button', { name: 'Proxy' })).toBe(proxyButton())
        expect(within(network).getByRole('group', { name: 'Proxy' })).toBe(proxyGroup())
      })

      it('stays hidden with its children while the Network group is closed, whatever its own choice', async () => {
        const user = userEvent.setup()
        useSettingsNavStore.setState({ proxyExpanded: true })
        renderSettingsNav({ activeSection: 'environments' })

        expect(screen.queryByRole('button', { name: 'Proxy' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Setup' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Blocks' })).not.toBeInTheDocument()

        await user.click(networkButton())

        expect(proxyButton()).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('button', { name: 'Setup' })).toBeInTheDocument()
      })

      it('is closed while the active section is outside Proxy', () => {
        renderSettingsNav({ activeSection: 'network-ssh-hosts' })

        expect(proxyButton()).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByRole('group', { name: 'Proxy' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Setup' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Blocks' })).not.toBeInTheDocument()
      })

      it('carries a chevron that points right while closed and down while open', async () => {
        const user = userEvent.setup()
        renderSettingsNav({ activeSection: 'network-ssh-hosts' })

        expect(proxyButton().querySelector('svg.lucide-chevron-right')).toBeInTheDocument()
        expect(proxyButton().querySelector('svg.lucide-chevron-down')).not.toBeInTheDocument()

        await user.click(proxyButton())

        expect(proxyButton().querySelector('svg.lucide-chevron-down')).toBeInTheDocument()
        expect(proxyButton().querySelector('svg.lucide-chevron-right')).not.toBeInTheDocument()
      })
    })

    describe('Opening and closing', () => {
      it('opens on click and shows Setup and Blocks in a group labeled "Proxy"', async () => {
        const user = userEvent.setup()
        renderSettingsNav({ activeSection: 'network-ssh-hosts' })

        await user.click(proxyButton())

        expect(proxyButton()).toHaveAttribute('aria-expanded', 'true')
        const children = within(proxyGroup()).getAllByRole('button')
        expect(children.map((b) => b.textContent)).toEqual(['Setup', 'Blocks'])
        children.forEach((child) => {
          expect(child).toHaveAttribute('type', 'button')
        })
      })

      it('points aria-controls at the child group', async () => {
        const user = userEvent.setup()
        renderSettingsNav({ activeSection: 'network-ssh-hosts' })

        await user.click(proxyButton())

        expect(proxyGroup().id).not.toBe('')
        expect(proxyButton()).toHaveAttribute('aria-controls', proxyGroup().id)
      })

      it('closes again on a second click', async () => {
        const user = userEvent.setup()
        renderSettingsNav({ activeSection: 'network-ssh-hosts' })

        await user.click(proxyButton())
        await user.click(proxyButton())

        expect(proxyButton()).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByRole('button', { name: 'Setup' })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Blocks' })).not.toBeInTheDocument()
      })

      it('has no page of its own: a click toggles only and never calls onSectionChange', async () => {
        const user = userEvent.setup()
        const handleSectionChange = vi.fn()
        renderSettingsNav({
          activeSection: 'network-ssh-hosts',
          onSectionChange: handleSectionChange,
        })

        await user.click(proxyButton())
        await user.click(proxyButton())

        expect(handleSectionChange).not.toHaveBeenCalled()
      })

      it('toggles with Enter and Space without navigating', async () => {
        const user = userEvent.setup()
        const handleSectionChange = vi.fn()
        renderSettingsNav({
          activeSection: 'network-ssh-hosts',
          onSectionChange: handleSectionChange,
        })

        proxyButton().focus()
        await user.keyboard('{Enter}')
        expect(proxyButton()).toHaveAttribute('aria-expanded', 'true')

        await user.keyboard(' ')
        expect(proxyButton()).toHaveAttribute('aria-expanded', 'false')
        expect(handleSectionChange).not.toHaveBeenCalled()
      })

      it('puts the open children in Tab order between Proxy and MCP Server', async () => {
        const user = userEvent.setup()
        renderSettingsNav({ activeSection: 'network-ssh-hosts' })

        await user.click(proxyButton())
        proxyButton().focus()

        await user.tab()
        expect(screen.getByRole('button', { name: 'Setup' })).toHaveFocus()
        await user.tab()
        expect(screen.getByRole('button', { name: 'Blocks' })).toHaveFocus()
        await user.tab()
        expect(screen.getByRole('button', { name: /MCP Server/i })).toHaveFocus()
      })

      it('closes on click while a child is active, without navigating', async () => {
        const user = userEvent.setup()
        const handleSectionChange = vi.fn()
        renderSettingsNav({
          activeSection: 'network-proxy-setup',
          onSectionChange: handleSectionChange,
        })

        await user.click(proxyButton())

        expect(proxyButton()).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByRole('button', { name: 'Setup' })).not.toBeInTheDocument()
        expect(handleSectionChange).not.toHaveBeenCalled()
      })
    })

    describe('Choosing a child', () => {
      it('calls onSectionChange with "network-proxy-setup" when Setup is clicked', async () => {
        const user = userEvent.setup()
        const handleSectionChange = vi.fn()
        renderSettingsNav({
          activeSection: 'network-ssh-hosts',
          onSectionChange: handleSectionChange,
        })

        await user.click(proxyButton())
        await user.click(screen.getByRole('button', { name: 'Setup' }))

        expect(handleSectionChange).toHaveBeenCalledTimes(1)
        expect(handleSectionChange).toHaveBeenCalledWith('network-proxy-setup')
      })

      it('calls onSectionChange with "network-proxy-blocks" when Blocks is clicked', async () => {
        const user = userEvent.setup()
        const handleSectionChange = vi.fn()
        renderSettingsNav({
          activeSection: 'network-ssh-hosts',
          onSectionChange: handleSectionChange,
        })

        await user.click(proxyButton())
        await user.click(screen.getByRole('button', { name: 'Blocks' }))

        expect(handleSectionChange).toHaveBeenCalledTimes(1)
        expect(handleSectionChange).toHaveBeenCalledWith('network-proxy-blocks')
      })
    })

    describe('Active child', () => {
      it('is open, inside an open Network group, with Setup current when Proxy Setup is active', () => {
        renderSettingsNav({ activeSection: 'network-proxy-setup' })

        expect(networkButton()).toHaveAttribute('aria-expanded', 'true')
        expect(proxyButton()).toHaveAttribute('aria-expanded', 'true')
        const setup = screen.getByRole('button', { name: 'Setup' })
        expect(setup).toHaveAttribute('aria-current', 'page')
        expect(setup).toHaveStyle({ backgroundColor: BLUE })
        expect(setup).toHaveStyle({ color: 'rgb(255, 255, 255)' })
        expect(screen.getByRole('button', { name: 'Blocks' })).not.toHaveAttribute('aria-current')
      })

      it('is open, inside an open Network group, with Blocks current when Proxy Blocks is active', () => {
        renderSettingsNav({ activeSection: 'network-proxy-blocks' })

        expect(networkButton()).toHaveAttribute('aria-expanded', 'true')
        expect(proxyButton()).toHaveAttribute('aria-expanded', 'true')
        const blocks = screen.getByRole('button', { name: 'Blocks' })
        expect(blocks).toHaveAttribute('aria-current', 'page')
        expect(blocks).toHaveStyle({ backgroundColor: BLUE })
        expect(blocks).toHaveStyle({ color: 'rgb(255, 255, 255)' })
        expect(screen.getByRole('button', { name: 'Setup' })).not.toHaveAttribute('aria-current')
      })

      it('does not highlight the Proxy or the Network parent while a child is active (SETTINGS-3)', () => {
        renderSettingsNav({ activeSection: 'network-proxy-setup' })

        expect(proxyButton()).not.toHaveAttribute('aria-current')
        expect(proxyButton()).not.toHaveStyle({ backgroundColor: BLUE })
        expect(networkButton()).not.toHaveAttribute('aria-current')
        expect(networkButton()).not.toHaveStyle({ backgroundColor: BLUE })
      })

      it('marks exactly one item active while a child is active', () => {
        renderSettingsNav({ activeSection: 'network-proxy-blocks' })

        const active = screen.getAllByRole('button').filter((b) => b.style.backgroundColor === BLUE)
        expect(active).toHaveLength(1)
        expect(active[0]).toHaveTextContent('Blocks')
        expect(screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-current'))).toEqual(
          active,
        )
      })

      it('opens when the active section moves to a Proxy page', () => {
        const { rerender } = renderSettingsNav({ activeSection: 'network-ssh-hosts' })
        expect(proxyButton()).toHaveAttribute('aria-expanded', 'false')

        rerender(<SettingsNav activeSection="network-proxy-blocks" onSectionChange={vi.fn()} />)

        expect(proxyButton()).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('button', { name: 'Blocks' })).toHaveAttribute(
          'aria-current',
          'page',
        )
      })

      it('opens Network and Proxy when the active section moves to a Proxy page from outside Network', () => {
        const { rerender } = renderSettingsNav({ activeSection: 'general' })
        expect(networkButton()).toHaveAttribute('aria-expanded', 'false')

        rerender(<SettingsNav activeSection="network-proxy-setup" onSectionChange={vi.fn()} />)

        expect(networkButton()).toHaveAttribute('aria-expanded', 'true')
        expect(proxyButton()).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('button', { name: 'Setup' })).toHaveAttribute(
          'aria-current',
          'page',
        )
      })
    })

    describe('Remembered choice', () => {
      it('stays open after moving from a Proxy page to another Network page', () => {
        const { rerender } = renderSettingsNav({ activeSection: 'network-proxy-setup' })

        rerender(<SettingsNav activeSection="network-ssh-hosts" onSectionChange={vi.fn()} />)

        expect(proxyButton()).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('button', { name: 'Setup' })).not.toHaveAttribute('aria-current')
        expect(screen.getByRole('button', { name: 'Blocks' })).toBeInTheDocument()
      })

      it('stays open after moving from a Proxy page to a section outside Network', () => {
        const { rerender } = renderSettingsNav({ activeSection: 'network-proxy-blocks' })

        rerender(<SettingsNav activeSection="mcp" onSectionChange={vi.fn()} />)

        expect(networkButton()).toHaveAttribute('aria-expanded', 'true')
        expect(proxyButton()).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('button', { name: 'Setup' })).toBeInTheDocument()
      })

      it('stays open after the user opens it and moves to another section', async () => {
        const user = userEvent.setup()
        const { rerender } = renderSettingsNav({ activeSection: 'network-ssh-hosts' })

        await user.click(proxyButton())
        rerender(<SettingsNav activeSection="network-certificates" onSectionChange={vi.fn()} />)

        expect(proxyButton()).toHaveAttribute('aria-expanded', 'true')
      })

      it('keeps the user opening it when Settings is left and opened again', async () => {
        const user = userEvent.setup()
        const { unmount } = renderSettingsNav({ activeSection: 'network-ssh-hosts' })

        await user.click(proxyButton())
        unmount()
        renderSettingsNav({ activeSection: 'network-certificates' })

        expect(proxyButton()).toHaveAttribute('aria-expanded', 'true')
      })

      it('keeps the user closing it when Settings is left and opened again on a Proxy page', async () => {
        const user = userEvent.setup()
        const { unmount } = renderSettingsNav({ activeSection: 'network-proxy-setup' })

        await user.click(proxyButton())
        unmount()
        renderSettingsNav({ activeSection: 'network-proxy-setup' })

        expect(proxyButton()).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByRole('button', { name: 'Setup' })).not.toBeInTheDocument()
      })

      it('keeps an auto-opened group open when Settings is left from a Proxy page and opened again elsewhere', () => {
        const { unmount } = renderSettingsNav({ activeSection: 'network-proxy-blocks' })

        unmount()
        renderSettingsNav({ activeSection: 'general' })

        expect(networkButton()).toHaveAttribute('aria-expanded', 'true')
        expect(proxyButton()).toHaveAttribute('aria-expanded', 'true')
      })

      it('shows Proxy as it was left after the Network group is closed and opened again', async () => {
        const user = userEvent.setup()
        renderSettingsNav({ activeSection: 'network-proxy-blocks' })

        await user.click(networkButton())
        expect(screen.queryByRole('button', { name: 'Proxy' })).not.toBeInTheDocument()

        await user.click(networkButton())

        expect(proxyButton()).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('button', { name: 'Blocks' })).toHaveAttribute(
          'aria-current',
          'page',
        )
      })
    })

    describe('Nav store', () => {
      it('holds no choice in the store while the group was neither shown open nor toggled', () => {
        renderSettingsNav({ activeSection: 'network-ssh-hosts' })

        expect(proxyButton()).toHaveAttribute('aria-expanded', 'false')
        expect(useSettingsNavStore.getState().proxyExpanded).toBeNull()
      })

      it('records the group open in the store when a Proxy page is shown', () => {
        renderSettingsNav({ activeSection: 'network-proxy-setup' })

        expect(useSettingsNavStore.getState().proxyExpanded).toBe(true)
      })

      it('records the user opening and closing it in the store', async () => {
        const user = userEvent.setup()
        renderSettingsNav({ activeSection: 'network-ssh-hosts' })

        await user.click(proxyButton())
        expect(useSettingsNavStore.getState().proxyExpanded).toBe(true)

        await user.click(proxyButton())
        expect(useSettingsNavStore.getState().proxyExpanded).toBe(false)
      })

      it('leaves the Network choice in the store alone when Proxy is toggled', async () => {
        const user = userEvent.setup()
        renderSettingsNav({ activeSection: 'network-ssh-hosts' })

        await user.click(proxyButton())
        await user.click(proxyButton())

        expect(useSettingsNavStore.getState().networkExpanded).toBe(true)
        expect(networkButton()).toHaveAttribute('aria-expanded', 'true')
      })

      it('follows a closed choice already in the store, even on a Proxy page', () => {
        useSettingsNavStore.setState({ proxyExpanded: false })

        renderSettingsNav({ activeSection: 'network-proxy-setup' })

        expect(proxyButton()).toHaveAttribute('aria-expanded', 'false')
        expect(useSettingsNavStore.getState().proxyExpanded).toBe(false)
      })

      it('follows an open choice already in the store on a page outside Proxy', () => {
        useSettingsNavStore.setState({ proxyExpanded: true })

        renderSettingsNav({ activeSection: 'network-certificates' })

        expect(proxyButton()).toHaveAttribute('aria-expanded', 'true')
        expect(within(proxyGroup()).getAllByRole('button')).toHaveLength(2)
      })
    })
  })

  describe('isNetworkSection', () => {
    const PROXY_SECTIONS: SettingsSection[] = ['network-proxy-setup', 'network-proxy-blocks']
    const OTHER_NETWORK_SECTIONS: SettingsSection[] = ['network-ssh-hosts', 'network-certificates']
    const SECTIONS_OUTSIDE_NETWORK: SettingsSection[] = [
      'general',
      'environments',
      'variables',
      'mcp',
      'server',
      'backup',
      'about',
    ]

    it.each(PROXY_SECTIONS)('is true for %s', (section) => {
      expect(isNetworkSection(section)).toBe(true)
    })

    it.each(OTHER_NETWORK_SECTIONS)('stays true for %s', (section) => {
      expect(isNetworkSection(section)).toBe(true)
    })

    it.each(SECTIONS_OUTSIDE_NETWORK)('stays false for %s', (section) => {
      expect(isNetworkSection(section)).toBe(false)
    })
  })

  describe('Custom ClassName', () => {
    it('accepts additional className', () => {
      const { container } = renderSettingsNav({ className: 'custom-nav' })
      expect(container.querySelector('.custom-nav')).toBeInTheDocument()
    })
  })
})
