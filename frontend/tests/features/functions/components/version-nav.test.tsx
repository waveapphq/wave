/**
 * VersionNav component tests: grouped collapsible majors, latest
 * badge, pre-release muting, per-version usage count, select, and delete.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VersionNav } from '@/features/functions/components/version-nav'
import type { VersionDescriptor } from '@/features/functions/api/types'

function descriptor(version: string): VersionDescriptor {
  return {
    version,
    published_at: '2026-01-01T00:00:00Z',
    changelog: '',
    details: '',
    description: '',
    tags: [],
  }
}

const VERSIONS = [descriptor('2.0.0'), descriptor('1.1.0-beta.1'), descriptor('1.0.0')]

function renderNav(overrides: Partial<Parameters<typeof VersionNav>[0]> = {}) {
  const props = {
    versions: VERSIONS,
    latest: '2.0.0',
    selected: '2.0.0',
    usageCount: (version: string) => (version === '2.0.0' ? 3 : 0),
    onSelect: vi.fn(),
    onDeleteVersion: vi.fn(),
    ...overrides,
  }
  render(<VersionNav {...props} />)
  return props
}

describe('VersionNav', () => {
  it('labels the count column with a Usage header', () => {
    renderNav()
    expect(screen.getByText('Usage')).toBeInTheDocument()
  })

  it('opens the latest major and collapses older majors by default', () => {
    renderNav()
    expect(screen.getByTestId('version-major-2')).toBeInTheDocument()
    expect(screen.getByTestId('version-major-1')).toBeInTheDocument()
    // Latest major (2.x) is open; older major (1.x) is collapsed.
    expect(screen.getByTestId('version-nav-item-2.0.0')).toBeInTheDocument()
    expect(screen.queryByTestId('version-nav-item-1.0.0')).not.toBeInTheDocument()
    expect(screen.getByText('Latest')).toBeInTheDocument()
    expect(screen.getByTestId('version-nav-item-2.0.0')).toHaveTextContent('3')
  })

  it('mutes pre-release versions (after expanding their major)', async () => {
    const user = userEvent.setup()
    renderNav()
    await user.click(screen.getByTestId('version-major-1'))
    const pre = screen.getByTestId('version-nav-item-1.1.0-beta.1')
    expect(pre.querySelector('.text-muted-foreground')).not.toBeNull()
  })

  it('expands then collapses an older major group', async () => {
    const user = userEvent.setup()
    renderNav()
    expect(screen.queryByTestId('version-nav-item-1.0.0')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('version-major-1'))
    expect(screen.getByTestId('version-nav-item-1.0.0')).toBeInTheDocument()
    await user.click(screen.getByTestId('version-major-1'))
    expect(screen.queryByTestId('version-nav-item-1.0.0')).not.toBeInTheDocument()
  })

  it('collapses every major when there is no latest yet', () => {
    renderNav({ latest: '' })
    expect(screen.queryByTestId('version-nav-item-2.0.0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('version-nav-item-1.0.0')).not.toBeInTheDocument()
  })

  it('calls onSelect and onDeleteVersion', async () => {
    const user = userEvent.setup()
    const props = renderNav()
    await user.click(screen.getByTestId('version-major-1'))
    await user.click(screen.getByTestId('version-nav-item-1.0.0'))
    expect(props.onSelect).toHaveBeenCalledWith('1.0.0')
    await user.click(screen.getByTestId('version-delete-1.0.0'))
    expect(props.onDeleteVersion).toHaveBeenCalledWith('1.0.0')
  })
})
