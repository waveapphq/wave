/**
 * AboutTab Component Tests
 *
 * REQ-5.2.1.42: Settings and preferences screen - About section
 *
 * Tests for AboutTab component per design decisions:
 * - SETTINGS-16: About: version, build, support links
 *
 * Component: frontend/src/components/settings/about-tab.tsx
 */

import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AboutTab, type AboutTabProps } from '@/features/settings/components/about-tab'
import type { SystemInfo } from '@/features/settings/api/system-info'
import { formatTimestamp } from '@/lib/timestamp-format'
import { useTimezoneStore } from '@/stores/timezone-store'

// ============================================================================
// Mock Data
// ============================================================================

const mockSystemInfo: SystemInfo = {
  version: '1.2.3',
  build: 'a1b2c3d4',
  buildDate: '2025-01-15T10:00:00Z',
  support: {
    documentationUrl: 'https://docs.example.com',
    issuesUrl: 'https://github.com/example/wave/issues',
    contactEmail: 'support@example.com',
  },
  runtime: {
    pythonVersion: '3.12.1',
    os: 'Linux',
    osVersion: '5.15.0-160-generic',
  },
}

/** Carries a key the type does not declare, to prove the field is never rendered from it. */
const withStrayEnvironment = { ...mockSystemInfo, environment: 'production' } as SystemInfo

// ============================================================================
// Test Utilities
// ============================================================================

function renderAboutTab(props: Partial<AboutTabProps> = {}) {
  const defaultProps: AboutTabProps = {
    systemInfo: mockSystemInfo,
    loading: false,
    error: undefined,
    onRetry: vi.fn(),
    ...props,
  }
  return render(<AboutTab {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('AboutTab', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  describe('Structure', () => {
    it('renders tab container with correct testid', () => {
      renderAboutTab()
      expect(screen.getByTestId('about-tab')).toBeInTheDocument()
    })

    it('renders section title', () => {
      renderAboutTab()
      expect(screen.getByRole('heading', { name: /About WAVE/i })).toBeInTheDocument()
    })
  })

  describe('Version Information (SETTINGS-16)', () => {
    it('displays version label', () => {
      renderAboutTab()
      expect(screen.getByText(/Version/i)).toBeInTheDocument()
    })

    it('displays version number', () => {
      renderAboutTab()
      expect(screen.getByText('1.2.3')).toBeInTheDocument()
    })

    it('displays build label', () => {
      renderAboutTab()
      expect(screen.getByText(/Build/i)).toBeInTheDocument()
    })

    it('displays build identifier', () => {
      renderAboutTab()
      expect(screen.getByText('a1b2c3d4')).toBeInTheDocument()
    })

    it('displays build date', () => {
      renderAboutTab()
      expect(screen.getByTestId('build-date')).toBeInTheDocument()
    })

    it('formats build date in readable format', () => {
      renderAboutTab()
      const buildDate = screen.getByTestId('build-date')
      // Should be formatted date, not raw ISO string
      expect(buildDate.textContent).not.toBe('2025-01-15T10:00:00Z')
      expect(buildDate.textContent).toMatch(/Jan|January/i)
    })
  })

  describe('No Environment field (REQ-5.2.1.42)', () => {
    it('shows Version, Build and Released and no Environment label', () => {
      renderAboutTab()

      const versionSection = screen.getByTestId('version-section')
      expect(within(versionSection).getByText('Version')).toBeInTheDocument()
      expect(within(versionSection).getByText('Build')).toBeInTheDocument()
      expect(within(versionSection).getByText('Released')).toBeInTheDocument()
      expect(screen.queryByText(/Environment/i)).not.toBeInTheDocument()
    })

    it('renders no environment value element and declares none on the system info type', () => {
      renderAboutTab()

      expectTypeOf<SystemInfo>().not.toHaveProperty('environment')
      expect(screen.queryByTestId('environment-value')).not.toBeInTheDocument()
    })

    it('shows no Environment field even when the system info carries a stray one', () => {
      renderAboutTab({ systemInfo: withStrayEnvironment })

      expect(screen.queryByText(/Environment/i)).not.toBeInTheDocument()
      expect(screen.queryByText('production')).not.toBeInTheDocument()
    })
  })

  describe('Runtime Information', () => {
    it('displays Python version', () => {
      renderAboutTab()
      expect(screen.getByText(/Python/i)).toBeInTheDocument()
      expect(screen.getByText('3.12.1')).toBeInTheDocument()
    })

    it('displays OS information', () => {
      renderAboutTab()
      expect(screen.getByText(/Operating System/i)).toBeInTheDocument()
      expect(screen.getByText(/Linux/i)).toBeInTheDocument()
    })

    it('displays OS version', () => {
      renderAboutTab()
      expect(screen.getByText('5.15.0-160-generic')).toBeInTheDocument()
    })
  })

  describe('Support Links (SETTINGS-16)', () => {
    it('displays support section', () => {
      renderAboutTab()
      expect(screen.getByText(/Support/i)).toBeInTheDocument()
    })

    it('renders Documentation link', () => {
      renderAboutTab()
      const docLink = screen.getByRole('link', { name: /Documentation/i })
      expect(docLink).toBeInTheDocument()
      expect(docLink).toHaveAttribute('href', 'https://docs.example.com')
    })

    it('renders Report an Issue link', () => {
      renderAboutTab()
      const issuesLink = screen.getByRole('link', { name: /Report an Issue/i })
      expect(issuesLink).toBeInTheDocument()
      expect(issuesLink).toHaveAttribute('href', 'https://github.com/example/wave/issues')
    })

    it('renders Contact Support link', () => {
      renderAboutTab()
      const contactLink = screen.getByRole('link', { name: /Contact Support/i })
      expect(contactLink).toBeInTheDocument()
      expect(contactLink).toHaveAttribute('href', 'mailto:support@example.com')
    })

    it('support links open in new tab', () => {
      renderAboutTab()
      const docLink = screen.getByRole('link', { name: /Documentation/i })
      expect(docLink).toHaveAttribute('target', '_blank')
      expect(docLink).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('email link does not open in new tab', () => {
      renderAboutTab()
      const contactLink = screen.getByRole('link', { name: /Contact Support/i })
      expect(contactLink).not.toHaveAttribute('target')
    })
  })

  describe('Missing Support Links', () => {
    it('hides Documentation link when URL is null', () => {
      const infoWithoutDocs = {
        ...mockSystemInfo,
        support: { ...mockSystemInfo.support, documentationUrl: null },
      }
      renderAboutTab({ systemInfo: infoWithoutDocs })
      expect(screen.queryByRole('link', { name: /Documentation/i })).not.toBeInTheDocument()
    })

    it('hides Report Issue link when URL is null', () => {
      const infoWithoutIssues = {
        ...mockSystemInfo,
        support: { ...mockSystemInfo.support, issuesUrl: null },
      }
      renderAboutTab({ systemInfo: infoWithoutIssues })
      expect(screen.queryByRole('link', { name: /Report an Issue/i })).not.toBeInTheDocument()
    })

    it('hides Contact Support link when email is null', () => {
      const infoWithoutEmail = {
        ...mockSystemInfo,
        support: { ...mockSystemInfo.support, contactEmail: null },
      }
      renderAboutTab({ systemInfo: infoWithoutEmail })
      expect(screen.queryByRole('link', { name: /Contact Support/i })).not.toBeInTheDocument()
    })

    it('hides entire support section when all links are null', () => {
      const infoNoSupport = {
        ...mockSystemInfo,
        support: {
          documentationUrl: null,
          issuesUrl: null,
          contactEmail: null,
        },
      }
      renderAboutTab({ systemInfo: infoNoSupport })
      expect(screen.queryByText(/Support/i)).not.toBeInTheDocument()
    })
  })

  describe('Missing Runtime Information', () => {
    it('handles null Python version', () => {
      const infoNoPython = {
        ...mockSystemInfo,
        runtime: { ...mockSystemInfo.runtime, pythonVersion: null },
      }
      renderAboutTab({ systemInfo: infoNoPython })
      expect(screen.getByTestId('python-version')).toHaveTextContent('-')
    })

    it('handles null OS information', () => {
      const infoNoOS = {
        ...mockSystemInfo,
        runtime: { ...mockSystemInfo.runtime, os: null, osVersion: null },
      }
      renderAboutTab({ systemInfo: infoNoOS })
      expect(screen.getByTestId('os-info')).toHaveTextContent('-')
    })
  })

  describe('Loading State', () => {
    it('displays loading state', () => {
      renderAboutTab({ loading: true, systemInfo: undefined })
      expect(screen.getByTestId('about-loading')).toBeInTheDocument()
    })

    it('displays skeleton loaders for each field', () => {
      renderAboutTab({ loading: true, systemInfo: undefined })
      expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0)
    })

    it('hides content when loading', () => {
      renderAboutTab({ loading: true, systemInfo: undefined })
      expect(screen.queryByText('1.2.3')).not.toBeInTheDocument()
    })
  })

  describe('Error State', () => {
    it('displays error message', () => {
      renderAboutTab({ error: 'Failed to load system info', systemInfo: undefined })
      expect(screen.getByText(/Failed to load system info/i)).toBeInTheDocument()
    })

    it('displays error state container', () => {
      renderAboutTab({ error: 'Failed to load system info', systemInfo: undefined })
      expect(screen.getByTestId('about-error')).toBeInTheDocument()
    })

    it('displays retry button', () => {
      renderAboutTab({ error: 'Error', systemInfo: undefined })
      expect(screen.getByRole('button', { name: /Try Again/i })).toBeInTheDocument()
    })

    it('calls onRetry when retry button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRetry = vi.fn()

      renderAboutTab({ error: 'Error', systemInfo: undefined, onRetry: handleRetry })
      await user.click(screen.getByRole('button', { name: /Try Again/i }))

      expect(handleRetry).toHaveBeenCalledTimes(1)
    })

    it('displays error icon', () => {
      renderAboutTab({ error: 'Error', systemInfo: undefined })
      expect(screen.getByTestId('error-icon')).toBeInTheDocument()
    })

    it('hides content when error', () => {
      renderAboutTab({ error: 'Error', systemInfo: undefined })
      expect(screen.queryByText('1.2.3')).not.toBeInTheDocument()
    })
  })

  describe('Layout', () => {
    it('information is organized in sections', () => {
      renderAboutTab()
      expect(screen.getByTestId('version-section')).toBeInTheDocument()
      expect(screen.getByTestId('runtime-section')).toBeInTheDocument()
      expect(screen.getByTestId('support-section')).toBeInTheDocument()
    })

    it('sections have consistent spacing', () => {
      renderAboutTab()
      const tab = screen.getByTestId('about-tab')
      expect(tab).toHaveClass('space-y-6')
    })

    it('labels and values are properly aligned', () => {
      renderAboutTab()
      const versionSection = screen.getByTestId('version-section')
      expect(versionSection).toHaveClass('grid')
    })
  })

  describe('Copy Version Information', () => {
    it('displays copy button for version', () => {
      renderAboutTab()
      expect(screen.getByTestId('copy-version-button')).toBeInTheDocument()
    })

    it('copies version info to clipboard when clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      // Mock clipboard API - use spyOn since Object.assign doesn't work with jsdom's non-configurable clipboard
      const writeTextMock = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

      renderAboutTab()
      await user.click(screen.getByTestId('copy-version-button'))

      expect(writeTextMock).toHaveBeenCalledWith(
        expect.stringContaining('Version: 1.2.3')
      )
    })

    it('copies version info without build date when buildDate is null', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      const writeTextMock = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

      const infoWithoutDate = { ...mockSystemInfo, buildDate: null }
      renderAboutTab({ systemInfo: infoWithoutDate })
      await user.click(screen.getByTestId('copy-version-button'))

      expect(writeTextMock).toHaveBeenCalled()
      // Verify the copied text does NOT contain "Build Date"
      const copiedText = writeTextMock.mock.calls[0][0]
      expect(copiedText).toContain('Version: 1.2.3')
      expect(copiedText).not.toContain('Build Date')
    })

    it('shows success feedback after copy', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      // Mock clipboard API - use spyOn since Object.assign doesn't work with jsdom's non-configurable clipboard
      vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

      renderAboutTab()
      await user.click(screen.getByTestId('copy-version-button'))

      const { waitFor } = await import('@testing-library/react')
      await waitFor(() => {
        expect(screen.getByTestId('copy-success')).toBeInTheDocument()
      })
    })

    it('silently fails when clipboard copy fails', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      // Mock clipboard API to reject
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard failed'))

      renderAboutTab()

      // Click copy button - should not throw
      await user.click(screen.getByTestId('copy-version-button'))

      // Should NOT show success indicator
      expect(screen.queryByTestId('copy-success')).not.toBeInTheDocument()
    })

    it('copies exactly the Version, Build and Build Date lines', async () => {
      const user = userEvent.setup()
      const writeTextMock = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

      renderAboutTab()
      await user.click(screen.getByTestId('copy-version-button'))

      const builtOn = formatTimestamp(
        '2025-01-15T10:00:00Z',
        'date',
        useTimezoneStore.getState().mode,
      )
      expect(writeTextMock).toHaveBeenCalledTimes(1)
      expect(writeTextMock).toHaveBeenCalledWith(
        ['Version: 1.2.3', 'Build: a1b2c3d4', `Build Date: ${builtOn}`].join('\n'),
      )
    })

    it('copies exactly the Version and Build lines when there is no build date', async () => {
      const user = userEvent.setup()
      const writeTextMock = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

      renderAboutTab({ systemInfo: { ...mockSystemInfo, buildDate: null } })
      await user.click(screen.getByTestId('copy-version-button'))

      expect(writeTextMock).toHaveBeenCalledTimes(1)
      expect(writeTextMock).toHaveBeenCalledWith('Version: 1.2.3\nBuild: a1b2c3d4')
    })

    it('copies no Environment line, even when the system info carries a stray one', async () => {
      const user = userEvent.setup()
      const writeTextMock = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

      renderAboutTab({ systemInfo: withStrayEnvironment })
      await user.click(screen.getByTestId('copy-version-button'))

      expect(writeTextMock).toHaveBeenCalledTimes(1)
      const copiedText = writeTextMock.mock.calls[0][0]
      expect(copiedText).not.toContain('Environment')
      expect(copiedText).not.toContain('production')
    })
  })

  describe('Accessibility', () => {
    it('tab section has appropriate heading level', () => {
      renderAboutTab()
      expect(screen.getByRole('heading', { level: 2, name: /About WAVE/i })).toBeInTheDocument()
    })

    it('labels are properly associated with values', () => {
      renderAboutTab()
      const versionValue = screen.getByText('1.2.3')
      const versionLabel = versionValue.closest('[data-testid="version-field"]')
      expect(versionLabel).toContainElement(screen.getByText(/Version/i))
    })

    it('links have accessible names', () => {
      renderAboutTab()
      const docLink = screen.getByRole('link', { name: /Documentation/i })
      expect(docLink).toHaveAccessibleName()
    })

    it('external links indicate they open in new tab', () => {
      renderAboutTab()
      const docLink = screen.getByRole('link', { name: /Documentation/i })
      expect(docLink).toHaveAttribute('aria-label', expect.stringMatching(/new tab|external/i))
    })

    it('copy button has accessible label', () => {
      renderAboutTab()
      const copyButton = screen.getByTestId('copy-version-button')
      expect(copyButton).toHaveAttribute('aria-label', expect.stringMatching(/copy/i))
    })

    it('keeps the version, build and runtime values out of page translation', () => {
      renderAboutTab()
      expect(screen.getByText('1.2.3')).toHaveAttribute('translate', 'no')
      expect(screen.getByText('a1b2c3d4')).toHaveAttribute('translate', 'no')
      expect(screen.getByTestId('python-version').parentElement).toHaveAttribute('translate', 'no')
      expect(screen.getByTestId('os-info').parentElement).toHaveAttribute('translate', 'no')
      expect(screen.getByTestId('build-date').closest('[translate]')).toBeNull()
    })

    it('loading state is announced', () => {
      renderAboutTab({ loading: true, systemInfo: undefined })
      expect(screen.getByTestId('about-loading')).toHaveAttribute('aria-busy', 'true')
    })

    it('error alert has appropriate role', () => {
      renderAboutTab({ error: 'Error', systemInfo: undefined })
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
  })

  describe('Version Display Formats', () => {
    it('handles semantic version', () => {
      renderAboutTab()
      expect(screen.getByText('1.2.3')).toBeInTheDocument()
    })

    it('handles prerelease version', () => {
      const prereleaseInfo = { ...mockSystemInfo, version: '2.0.0-beta.1' }
      renderAboutTab({ systemInfo: prereleaseInfo })
      expect(screen.getByText('2.0.0-beta.1')).toBeInTheDocument()
    })

    it('handles dev version', () => {
      const devInfo = { ...mockSystemInfo, version: '0.0.0-dev' }
      renderAboutTab({ systemInfo: devInfo })
      expect(screen.getByText('0.0.0-dev')).toBeInTheDocument()
    })

    it('handles short git hash build', () => {
      const shortHashInfo = { ...mockSystemInfo, build: 'abc1234' }
      renderAboutTab({ systemInfo: shortHashInfo })
      expect(screen.getByText('abc1234')).toBeInTheDocument()
    })

    it('handles "local" build identifier', () => {
      const localInfo = { ...mockSystemInfo, build: 'local' }
      renderAboutTab({ systemInfo: localInfo })
      expect(screen.getByText('local')).toBeInTheDocument()
    })
  })

  describe('Custom ClassName', () => {
    it('accepts additional className', () => {
      const { container } = renderAboutTab({ className: 'custom-about' })
      expect(container.querySelector('.custom-about')).toBeInTheDocument()
    })
  })
})
