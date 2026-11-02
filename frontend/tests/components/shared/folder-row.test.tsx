/**
 * Shared folder row: the artifact tree's directory row promoted for reuse by
 * the test data tree and the file reference picker.
 *
 * Module: frontend/src/components/shared/folder-row.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { FolderRow } from '@/components/shared/folder-row'
import { clipboardMock } from '../../setup'

type FolderRowProps = ComponentProps<typeof FolderRow>

function renderRow(props: Partial<FolderRowProps> = {}) {
  const onToggle = vi.fn()
  render(
    <FolderRow name="fixtures" expanded indent={0} sizeBytes={2048} onToggle={onToggle} {...props} />
  )
  return { onToggle, row: screen.getByTestId('folder-row') }
}

function buttonLabels(row: HTMLElement): string[] {
  return within(row)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '')
}

describe('FolderRow - name and size', () => {
  it('shows the folder name', () => {
    renderRow()

    expect(screen.getByText('fixtures')).toBeInTheDocument()
  })

  it('shows the aggregate size formatted', () => {
    renderRow({ sizeBytes: 2048 })

    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
  })

  it('shows a zero size for an empty folder', () => {
    renderRow({ sizeBytes: 0 })

    expect(screen.getByText('0 B')).toBeInTheDocument()
  })
})

describe('FolderRow - disclosure', () => {
  it('reports an expanded folder as expanded', () => {
    renderRow({ expanded: true })

    expect(screen.getByRole('button', { name: 'Collapse fixtures' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('reports a collapsed folder as collapsed', () => {
    renderRow({ expanded: false })

    expect(screen.getByRole('button', { name: 'Expand fixtures' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('calls onToggle when the chevron is clicked', async () => {
    const user = userEvent.setup()
    const { onToggle } = renderRow({ expanded: true })

    await user.click(screen.getByRole('button', { name: 'Collapse fixtures' }))

    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

describe('FolderRow - slots', () => {
  it('renders an optional leading tile', () => {
    renderRow({ icon: <span data-testid="folder-tile" /> })

    expect(screen.getByTestId('folder-tile')).toBeInTheDocument()
  })

  it('renders no leading tile when none is given', () => {
    renderRow()

    expect(screen.queryByTestId('folder-tile')).not.toBeInTheDocument()
  })

  it('renders the meta slot', () => {
    renderRow({ meta: <span data-testid="folder-meta">2 failed</span> })

    expect(screen.getByTestId('folder-meta')).toHaveTextContent('2 failed')
  })

  it('renders the actions slot', () => {
    renderRow({
      actions: (
        <button type="button" aria-label="Download fixtures">
          Download
        </button>
      ),
    })

    expect(screen.getByRole('button', { name: 'Download fixtures' })).toBeInTheDocument()
  })
})

describe('FolderRow - copy path', () => {
  it('renders no copy button when no path is given', () => {
    renderRow()

    expect(screen.queryByRole('button', { name: 'Copy path of fixtures' })).not.toBeInTheDocument()
  })

  it('renders the copy button when a path is given', () => {
    renderRow({ copyPath: 'testdata://fixtures' })

    expect(screen.getByRole('button', { name: 'Copy path of fixtures' })).toBeInTheDocument()
  })

  it('copies the given path', async () => {
    renderRow({ copyPath: 'testdata://fixtures' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy path of fixtures' }))
    })

    expect(clipboardMock.writeText).toHaveBeenCalledWith('testdata://fixtures')
  })

  it('puts the copy button before the other actions', () => {
    const { row } = renderRow({
      copyPath: 'testdata://fixtures',
      actions: (
        <button type="button" aria-label="Download fixtures">
          Download
        </button>
      ),
    })

    const labels = buttonLabels(row)
    expect(labels.indexOf('Copy path of fixtures')).toBeLessThan(
      labels.indexOf('Download fixtures')
    )
  })
})

describe('FolderRow - selection', () => {
  it('is not marked selected by default', () => {
    const { row } = renderRow()

    expect(row).not.toHaveAttribute('data-selected', 'true')
  })

  it('is marked selected when selected', () => {
    const { row } = renderRow({ selected: true })

    expect(row).toHaveAttribute('data-selected', 'true')
  })

  it('calls onSelect when the row is clicked', () => {
    const onSelect = vi.fn()
    const { row } = renderRow({ onSelect })

    fireEvent.click(row)

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('calls onDoubleClick when the row is double clicked', () => {
    const onDoubleClick = vi.fn()
    const { row } = renderRow({ onDoubleClick })

    fireEvent.doubleClick(row)

    expect(onDoubleClick).toHaveBeenCalledTimes(1)
  })
})

describe('FolderRow - drop target', () => {
  it('is not marked a drop target by default', () => {
    const { row } = renderRow()

    expect(row).not.toHaveAttribute('data-drop-target', 'true')
  })

  it('is marked a drop target while a drag hovers it', () => {
    const { row } = renderRow({ dropTarget: true })

    expect(row).toHaveAttribute('data-drop-target', 'true')
  })
})

describe('FolderRow - indent', () => {
  it('sits at the base indent at depth zero', () => {
    const { row } = renderRow({ indent: 0 })

    expect(row).toHaveStyle({ paddingLeft: '1rem' })
  })

  it('steps in once per depth level', () => {
    const { row } = renderRow({ indent: 2 })

    expect(row).toHaveStyle({ paddingLeft: '3.5rem' })
  })
})
