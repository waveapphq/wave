/**
 * VersionSelector Component Tests - V-CANVAS-12 Config Modal Header
 *
 * Tests WAVE-specific behavior for version dropdown in config modal.
 * Does NOT test: CSS styling, dropdown library behavior (escape, outside click, arrow navigation).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

describe('VersionSelector Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const availableVersions = ['2.18', '2.17', '2.16', '2.15', '2.14']

  describe('Version Display', () => {
    it('displays current version', async () => {
      const { VersionSelector } = await import(
        '@/features/workbench/common/element-config/dialogs/version-selector'
      )
      render(
        <VersionSelector
          currentVersion="2.18"
          availableVersions={availableVersions}
          onVersionChange={vi.fn()}
        />
      )

      expect(screen.getByTestId('version-selector')).toHaveTextContent('2.18')
    })

    it('displays dropdown indicator when multiple versions available', async () => {
      const { VersionSelector } = await import(
        '@/features/workbench/common/element-config/dialogs/version-selector'
      )
      render(
        <VersionSelector
          currentVersion="2.18"
          availableVersions={availableVersions}
          onVersionChange={vi.fn()}
        />
      )

      expect(screen.getByTestId('version-dropdown-icon')).toBeInTheDocument()
    })
  })

  describe('Version Selection', () => {
    it('opens dropdown on click', async () => {
      const user = userEvent.setup()

      const { VersionSelector } = await import(
        '@/features/workbench/common/element-config/dialogs/version-selector'
      )
      render(
        <VersionSelector
          currentVersion="2.18"
          availableVersions={availableVersions}
          onVersionChange={vi.fn()}
        />
      )

      await user.click(screen.getByTestId('version-selector'))

      await waitFor(() => {
        expect(screen.getByRole('list')).toBeInTheDocument()
      })
    })

    it('displays all available versions in dropdown', async () => {
      const user = userEvent.setup()

      const { VersionSelector } = await import(
        '@/features/workbench/common/element-config/dialogs/version-selector'
      )
      render(
        <VersionSelector
          currentVersion="2.18"
          availableVersions={availableVersions}
          onVersionChange={vi.fn()}
        />
      )

      await user.click(screen.getByTestId('version-selector'))

      await waitFor(() => {
        const list = screen.getByRole('list')
        availableVersions.forEach((version) => {
          expect(within(list).getByRole('button', { name: version })).toBeInTheDocument()
        })
      })
    })

    it('calls onVersionChange when version selected', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      const { VersionSelector } = await import(
        '@/features/workbench/common/element-config/dialogs/version-selector'
      )
      render(
        <VersionSelector
          currentVersion="2.18"
          availableVersions={availableVersions}
          onVersionChange={handleChange}
        />
      )

      await user.click(screen.getByTestId('version-selector'))

      await waitFor(() => {
        expect(screen.getByRole('list')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: '2.16' }))

      expect(handleChange).toHaveBeenCalledWith('2.16')
    })

    it('updates display after selection', async () => {
      const user = userEvent.setup()

      const { VersionSelector } = await import(
        '@/features/workbench/common/element-config/dialogs/version-selector'
      )

      let currentVersion = '2.18'
      const handleChange = (version: string) => {
        currentVersion = version
      }

      const { rerender } = render(
        <VersionSelector
          currentVersion={currentVersion}
          availableVersions={availableVersions}
          onVersionChange={handleChange}
        />
      )

      await user.click(screen.getByTestId('version-selector'))

      await waitFor(() => {
        expect(screen.getByRole('list')).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: '2.16' }))

      rerender(
        <VersionSelector
          currentVersion="2.16"
          availableVersions={availableVersions}
          onVersionChange={handleChange}
        />
      )

      expect(screen.getByTestId('version-selector')).toHaveTextContent('2.16')
    })
  })

  describe('Version Labels', () => {
    it('shows only "Current" badge (no "Latest" label) per wireframe', async () => {
      const user = userEvent.setup()

      const { VersionSelector } = await import(
        '@/features/workbench/common/element-config/dialogs/version-selector'
      )
      render(
        <VersionSelector
          currentVersion="2.17"
          availableVersions={availableVersions}
          onVersionChange={vi.fn()}
        />
      )

      await user.click(screen.getByTestId('version-selector'))

      await waitFor(() => {
        const list = screen.getByRole('list')
        // Verify newest version is shown but without "Latest" label
        const newestOption = within(list).getByRole('button', { name: /2\.18/ })
        expect(newestOption).not.toHaveTextContent('Latest')
        // Only current version should have a badge
        const currentOption = within(list).getByRole('button', { name: /2\.17/ })
        expect(currentOption).toHaveTextContent('Current')
      })
    })

    it('shows "Current" badge for selected version', async () => {
      const user = userEvent.setup()

      const { VersionSelector } = await import(
        '@/features/workbench/common/element-config/dialogs/version-selector'
      )
      render(
        <VersionSelector
          currentVersion="2.16"
          availableVersions={availableVersions}
          onVersionChange={vi.fn()}
        />
      )

      await user.click(screen.getByTestId('version-selector'))

      await waitFor(() => {
        const list = screen.getByRole('list')
        const currentOption = within(list).getByRole('button', { name: /2\.16/ })
        expect(currentOption).toHaveTextContent('Current')
      })
    })
  })

  describe('Update Indicator', () => {
    it('shows green arrow when not on latest version', async () => {
      const { VersionSelector } = await import(
        '@/features/workbench/common/element-config/dialogs/version-selector'
      )
      render(
        <VersionSelector
          currentVersion="2.16"
          availableVersions={availableVersions}
          onVersionChange={vi.fn()}
        />
      )

      expect(screen.getByTestId('version-update-available')).toBeInTheDocument()
    })

    it('hides green arrow when on latest version', async () => {
      const { VersionSelector } = await import(
        '@/features/workbench/common/element-config/dialogs/version-selector'
      )
      render(
        <VersionSelector
          currentVersion="2.18"
          availableVersions={availableVersions}
          onVersionChange={vi.fn()}
        />
      )

      expect(screen.queryByTestId('version-update-available')).not.toBeInTheDocument()
    })
  })

  describe('Single Version', () => {
    it('allows opening selector even with single version', async () => {
      const user = userEvent.setup()
      const { VersionSelector } = await import(
        '@/features/workbench/common/element-config/dialogs/version-selector'
      )
      render(
        <VersionSelector
          currentVersion="1.0"
          availableVersions={['1.0']}
          onVersionChange={vi.fn()}
        />
      )

      // Selector should be clickable
      const selector = screen.getByTestId('version-selector')
      await user.click(selector)

      // Dropdown should open showing the single version
      expect(screen.getByRole('list')).toBeInTheDocument()
      // Trigger button and dropdown option button both present
      const versionButtons = screen.getAllByRole('button', { name: '1.0' })
      expect(versionButtons.length).toBeGreaterThanOrEqual(2)
    })

    it('shows dropdown arrow even with single version', async () => {
      const { VersionSelector } = await import(
        '@/features/workbench/common/element-config/dialogs/version-selector'
      )
      render(
        <VersionSelector
          currentVersion="1.0"
          availableVersions={['1.0']}
          onVersionChange={vi.fn()}
        />
      )

      expect(screen.getByTestId('version-dropdown-icon')).toBeInTheDocument()
    })
  })

  describe('Click Outside Behavior', () => {
    it('closes dropdown when clicking outside', async () => {
      const user = userEvent.setup()

      const { VersionSelector } = await import(
        '@/features/workbench/common/element-config/dialogs/version-selector'
      )
      render(
        <div>
          <VersionSelector
            currentVersion="2.18"
            availableVersions={availableVersions}
            onVersionChange={vi.fn()}
          />
          <button data-testid="outside-element">Outside</button>
        </div>
      )

      // Open dropdown
      await user.click(screen.getByTestId('version-selector'))

      // Dropdown should be open
      await waitFor(() => {
        expect(screen.getByRole('list')).toBeInTheDocument()
      })

      // Click outside
      await user.click(screen.getByTestId('outside-element'))

      // Dropdown should close
      await waitFor(() => {
        expect(screen.queryByRole('list')).not.toBeInTheDocument()
      })
    })
  })

  describe('Disabled state', () => {
    it('applies the disabled classname when disabled=true', async () => {
      const { VersionSelector } = await import(
        '@/features/workbench/common/element-config/dialogs/version-selector'
      )
      render(
        <VersionSelector
          currentVersion="2.18"
          availableVersions={availableVersions}
          onVersionChange={vi.fn()}
          disabled
        />
      )

      const trigger = screen.getByTestId('version-selector') as HTMLButtonElement
      expect(trigger.disabled).toBe(true)
      // The cn() branch for disabled adds the cursor-not-allowed utility.
      expect(trigger.className).toMatch(/cursor-not-allowed/)
    })
  })
})
