/**
 * ChangelogDialog - renders the per-version changelog as real Markdown, wraps
 * long tokens, and shows a human-formatted release date.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ChangelogDialog } from '@/features/workbench/common/element-config/dialogs/changelog-dialog'
import type { ControlVersion } from '@/features/workbench/docs/_types'

const VERSIONS: ControlVersion[] = [
  {
    version: '2.0.0',
    releaseDate: '2026-06-03T18:10:17Z',
    // Markdown-source lines: headings, a list, and a long unbroken token
    // (blank line separates the list from the trailing paragraph).
    changelog: [
      '# Release notes',
      '## Section one',
      '- Added a thing',
      '- Fixed another thing',
      '',
      'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
    ],
    details: '',
  },
]

function renderDialog(versions = VERSIONS) {
  return render(
    <ChangelogDialog
      isOpen
      onClose={vi.fn()}
      elementName="F1-Func"
      versions={versions}
      initialVersion="2.0.0"
    />,
  )
}

describe('ChangelogDialog', () => {
  it('renders the changelog as Markdown (headings + list), not literal text', () => {
    renderDialog()
    expect(screen.getByRole('heading', { level: 1, name: 'Release notes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Section one' })).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    const labels = items.map((li) => li.textContent)
    expect(labels).toContain('Added a thing')
    expect(labels).toContain('Fixed another thing')
    // The raw markdown tokens must NOT appear as literal text.
    expect(screen.queryByText('# Release notes')).toBeNull()
    expect(screen.queryByText('- Added a thing')).toBeNull()
  })

  it('wraps long content with break-words so it cannot overflow horizontally', () => {
    const { container } = renderDialog()
    expect(container.ownerDocument.querySelector('.break-words')).not.toBeNull()
  })

  it('formats the release date as a human date, not a raw ISO string', () => {
    renderDialog()
    const released = screen.getByText(/Released:/i)
    expect(released.textContent).toContain('Jun 3, 2026')
    expect(released.textContent).not.toContain('2026-06-03T18:10:17Z')
    expect(released.textContent).not.toContain('18:10:17')
  })

  it('shows a placeholder when the selected version has no changelog', () => {
    renderDialog([
      { version: '1.0.0', releaseDate: '2026-01-01', changelog: [], details: '' },
    ])
    expect(screen.getByText('No changelog.')).toBeInTheDocument()
  })

  it('renders just the header when there are no versions', () => {
    renderDialog([])
    expect(screen.getByText('F1-Func - Changelog')).toBeInTheDocument()
    expect(screen.queryByText(/Released:/i)).toBeNull()
  })

  it('still surfaces a deprecation warning with its message', () => {
    renderDialog([
      {
        version: '2.0.0',
        releaseDate: '2026-06-03T18:10:17Z',
        changelog: ['- Note'],
        details: '',
        deprecated: true,
        deprecationMessage: 'Use 3.0.0 instead',
      },
    ])
    expect(screen.getByText('Deprecated')).toBeInTheDocument()
    expect(screen.getByText('Use 3.0.0 instead')).toBeInTheDocument()
  })

  it('renders the deprecation badge even without a message', () => {
    renderDialog([
      {
        version: '2.0.0',
        releaseDate: '2026-06-03T18:10:17Z',
        changelog: ['- Note'],
        details: '',
        deprecated: true,
      },
    ])
    expect(screen.getByText('Deprecated')).toBeInTheDocument()
  })
})
