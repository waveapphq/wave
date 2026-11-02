/**
 * Shared file row for the artifact drill sections, the artifact tree, the
 * Session Artifacts sheet, the test data tree and the file reference picker.
 *
 * Module: frontend/src/components/shared/file-row.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ComponentProps } from 'react'
import { FileRow, fileIconKind } from '@/components/shared/file-row'
import { clipboardMock } from '../../setup'

const SRC = resolve(__dirname, '..', '..', '..', 'src')

function renderRow(props: Partial<ComponentProps<typeof FileRow>> = {}) {
  const handlers = {
    onDownload: vi.fn(),
    onDelete: vi.fn(),
  }
  render(<FileRow name="login.log" sizeBytes={1024} {...handlers} {...props} />)
  return handlers
}

function buttonLabels(row: HTMLElement): string[] {
  return within(row)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '')
}

describe('FileRow - the rename leaves nothing behind', () => {
  it('no longer ships an artifact-file-row module', () => {
    expect(existsSync(resolve(SRC, 'components/shared/artifact-file-row.tsx'))).toBe(false)
  })

  it('is referenced by no source file under its old name', () => {
    const offenders = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
      .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.tsx'))
      .filter((entry) => readFileSync(resolve(SRC, entry), 'utf8').includes('artifact-file-row'))

    expect(offenders).toEqual([])
  })

  it('stamps the row with the file-row test id', () => {
    renderRow()

    expect(screen.getByTestId('file-row')).toBeInTheDocument()
  })

  it('no longer stamps the old test id', () => {
    renderRow()

    expect(screen.queryByTestId('artifact-file-row')).not.toBeInTheDocument()
  })

  it('does not stamp the old test id on a removed row', () => {
    renderRow({ removed: true, removedBy: 'wparker' })

    expect(screen.getByTestId('file-row')).toBeInTheDocument()
    expect(screen.queryByTestId('artifact-file-row')).not.toBeInTheDocument()
  })
})

describe('FileRow - live row', () => {
  it('renders the file name and formatted size', () => {
    renderRow()

    expect(screen.getByText('login.log')).toBeInTheDocument()
    expect(screen.getByText('1.0 KB')).toBeInTheDocument()
  })

  it('exposes download and delete but no preview action', () => {
    renderRow()

    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /preview/i })).not.toBeInTheDocument()
  })

  it('labels the actions with the file name', () => {
    renderRow({ name: 'data.json' })

    expect(screen.getByRole('button', { name: 'Download data.json' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete data.json' })).toBeInTheDocument()
  })

  it('calls onDownload when the download action is clicked', async () => {
    const user = userEvent.setup()
    const handlers = renderRow()

    await user.click(screen.getByRole('button', { name: /download/i }))

    expect(handlers.onDownload).toHaveBeenCalledTimes(1)
  })

  it('calls onDelete when the delete action is clicked', async () => {
    const user = userEvent.setup()
    const handlers = renderRow()

    await user.click(screen.getByRole('button', { name: /delete/i }))

    expect(handlers.onDelete).toHaveBeenCalledTimes(1)
  })
})

describe('FileRow - optional delete', () => {
  it('hides the delete button when onDelete is absent, keeping download', () => {
    render(<FileRow name="login.log" sizeBytes={1024} onDownload={vi.fn()} />)

    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })
})

describe('FileRow - removed (tombstone) row', () => {
  it('shows a "Removed" audit tag with the date and user', () => {
    renderRow({
      removed: true,
      removedAt: '2026-06-09T13:30:00Z',
      removedBy: 'wparker',
    })

    const tag = screen.getByText(/removed/i)
    expect(tag).toBeInTheDocument()
    expect(tag.textContent).toContain('wparker')
  })

  it('still shows the file name', () => {
    renderRow({ removed: true, removedBy: 'wparker' })

    expect(screen.getByText('login.log')).toBeInTheDocument()
  })

  it('exposes no action buttons (no restore)', () => {
    renderRow({ removed: true, removedBy: 'wparker' })

    expect(screen.queryByRole('button', { name: /preview/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('shows the size on a removed row', () => {
    renderRow({ removed: true, removedBy: 'wparker', sizeBytes: 2048 })

    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
  })
})

describe('FileRow - leading entity icon', () => {
  it('renders a leading icon before the name on a live row', () => {
    renderRow({ icon: <span data-testid="leaf-icon" /> })

    expect(screen.getByTestId('leaf-icon')).toBeInTheDocument()
    expect(screen.getByText('login.log')).toBeInTheDocument()
  })

  it('renders the leading icon on a removed row with a user-less audit tag', () => {
    renderRow({
      removed: true,
      icon: <span data-testid="leaf-icon" />,
      removedAt: '2026-06-09T13:30:00Z',
    })

    expect(screen.getByTestId('leaf-icon')).toBeInTheDocument()
    expect(screen.getByText(/removed/i)).toBeInTheDocument()
  })
})

describe('FileRow - file-type tile', () => {
  it('derives a file-type icon from the name when no icon is supplied', () => {
    renderRow({ name: 'report.json' })

    expect(screen.getByTestId('artifact-file-icon')).toHaveAttribute('data-file-kind', 'json')
  })

  it('special-cases error.json with the error icon kind', () => {
    renderRow({ name: 'error.json' })

    expect(screen.getByTestId('artifact-file-icon')).toHaveAttribute('data-file-kind', 'error')
  })

  it('prefers an explicit icon override and omits the file-type icon', () => {
    renderRow({ icon: <span data-testid="leaf-icon" /> })

    expect(screen.getByTestId('leaf-icon')).toBeInTheDocument()
    expect(screen.queryByTestId('artifact-file-icon')).not.toBeInTheDocument()
  })

  it.each([
    ['rows.csv', 'spreadsheet'],
    ['book.xlsx', 'spreadsheet'],
    ['macro.xlsm', 'spreadsheet'],
    ['legacy.xls', 'spreadsheet'],
    ['pom.xml', 'code'],
    ['values.yaml', 'code'],
    ['values.yml', 'code'],
    ['seed.py', 'code'],
    ['run.sh', 'code'],
    ['app.js', 'code'],
    ['app.ts', 'code'],
    ['notes.txt', 'text'],
    ['service.log', 'text'],
    ['readme.md', 'text'],
    ['shot.png', 'image'],
    ['shot.jpg', 'image'],
    ['shot.jpeg', 'image'],
    ['anim.gif', 'image'],
    ['logo.svg', 'image'],
    ['bundle.zip', 'archive'],
    ['bundle.tar', 'archive'],
    ['bundle.tar.gz', 'archive'],
    ['bundle.tgz', 'archive'],
  ])('tiles %s as %s', (name, kind) => {
    renderRow({ name })

    expect(screen.getByTestId('artifact-file-icon')).toHaveAttribute('data-file-kind', kind)
  })
})

describe('FileRow - copy path', () => {
  it('renders no copy button when no path is given', () => {
    renderRow()

    expect(screen.queryByRole('button', { name: 'Copy path of login.log' })).not.toBeInTheDocument()
  })

  it('renders the copy button when a path is given', () => {
    renderRow({ copyPath: 'testdata://fixtures/login.log' })

    expect(screen.getByRole('button', { name: 'Copy path of login.log' })).toBeInTheDocument()
  })

  it('copies the given path', async () => {
    renderRow({ copyPath: 'testdata://fixtures/login.log' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy path of login.log' }))
    })

    expect(clipboardMock.writeText).toHaveBeenCalledWith('testdata://fixtures/login.log')
  })

  it('puts the copy button before download', () => {
    renderRow({ copyPath: 'artifact://login.log' })

    const labels = buttonLabels(screen.getByTestId('file-row'))
    expect(labels.indexOf('Copy path of login.log')).toBeLessThan(
      labels.indexOf('Download login.log')
    )
  })

  it('renders no copy button on a removed row', () => {
    renderRow({ removed: true, removedBy: 'wparker', copyPath: 'artifact://login.log' })

    expect(screen.queryByRole('button', { name: 'Copy path of login.log' })).not.toBeInTheDocument()
  })
})

describe('FileRow - trailing actions', () => {
  it('renders the trailing actions slot', () => {
    renderRow({
      trailingActions: (
        <button type="button" aria-label="More actions for login.log">
          More
        </button>
      ),
    })

    expect(screen.getByRole('button', { name: 'More actions for login.log' })).toBeInTheDocument()
  })

  it('puts the trailing actions after download', () => {
    renderRow({
      trailingActions: (
        <button type="button" aria-label="More actions for login.log">
          More
        </button>
      ),
    })

    const labels = buttonLabels(screen.getByTestId('file-row'))
    expect(labels.indexOf('Download login.log')).toBeLessThan(
      labels.indexOf('More actions for login.log')
    )
  })

  it('renders nothing extra when no trailing actions are given', () => {
    renderRow()

    expect(
      screen.queryByRole('button', { name: 'More actions for login.log' })
    ).not.toBeInTheDocument()
  })
})

describe('FileRow - selection', () => {
  it('is not marked selected by default', () => {
    renderRow()

    expect(screen.getByTestId('file-row')).not.toHaveAttribute('data-selected', 'true')
  })

  it('is marked selected when selected', () => {
    renderRow({ selected: true })

    expect(screen.getByTestId('file-row')).toHaveAttribute('data-selected', 'true')
  })

  it('calls onSelect when the row is clicked', () => {
    const onSelect = vi.fn()
    renderRow({ onSelect })

    fireEvent.click(screen.getByTestId('file-row'))

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('calls onDoubleClick when the row is double clicked', () => {
    const onDoubleClick = vi.fn()
    renderRow({ onDoubleClick })

    fireEvent.doubleClick(screen.getByTestId('file-row'))

    expect(onDoubleClick).toHaveBeenCalledTimes(1)
  })

  it('puts a selectable row in the tab order', () => {
    renderRow({ onSelect: vi.fn() })

    expect(screen.getByTestId('file-row')).toHaveAttribute('tabindex', '0')
  })
})

describe('FileRow - muted', () => {
  it('is not disabled by default', () => {
    renderRow()

    expect(screen.getByTestId('file-row')).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('marks a muted row aria-disabled', () => {
    renderRow({ muted: true })

    expect(screen.getByTestId('file-row')).toHaveAttribute('aria-disabled', 'true')
  })

  it('still shows the name of a muted row', () => {
    renderRow({ muted: true, name: 'users.csv' })

    expect(screen.getByText('users.csv')).toBeInTheDocument()
  })

  it('does not select a muted row on click', () => {
    const onSelect = vi.fn()
    renderRow({ muted: true, onSelect })

    fireEvent.click(screen.getByTestId('file-row'))

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps a muted row out of the tab order', () => {
    renderRow({ muted: true, onSelect: vi.fn() })

    expect(screen.getByTestId('file-row')).not.toHaveAttribute('tabindex', '0')
  })
})

describe('FileRow - subtitle', () => {
  it('renders a plain description subtitle', () => {
    renderRow({ subtitle: 'Canonical report model' })

    const subtitle = screen.getByTestId('artifact-file-subtitle')
    expect(subtitle).toHaveTextContent('Canonical report model')
    expect(subtitle.className).not.toContain('font-mono')
  })

  it('renders a mono path subtitle', () => {
    renderRow({ subtitle: 'logs/smoke/login.log', subtitleMono: true })

    const subtitle = screen.getByTestId('artifact-file-subtitle')
    expect(subtitle).toHaveTextContent('logs/smoke/login.log')
    expect(subtitle.className).toContain('font-mono')
  })

  it('omits the subtitle row when none is supplied', () => {
    renderRow()

    expect(screen.queryByTestId('artifact-file-subtitle')).not.toBeInTheDocument()
  })
})

describe('FileRow - size formatting', () => {
  it('formats sub-kilobyte sizes in bytes', () => {
    renderRow({ sizeBytes: 512 })
    expect(screen.getByText('512 B')).toBeInTheDocument()
  })

  it('formats megabyte sizes', () => {
    renderRow({ sizeBytes: 5 * 1024 * 1024 })
    expect(screen.getByText('5.0 MB')).toBeInTheDocument()
  })
})

describe('FileRow - indent', () => {
  it('sits at the base indent at depth zero', () => {
    renderRow({ indent: 0 })

    expect(screen.getByTestId('file-row')).toHaveStyle({ paddingLeft: '1rem' })
  })

  it('steps in once per depth level', () => {
    renderRow({ indent: 2 })

    expect(screen.getByTestId('file-row')).toHaveStyle({ paddingLeft: '3.5rem' })
  })
})

describe('fileIconKind', () => {
  it('special-cases error.json', () => {
    expect(fileIconKind('error.json')).toBe('error')
  })

  it('buckets .json files', () => {
    expect(fileIconKind('report.json')).toBe('json')
  })

  it('is case-insensitive', () => {
    expect(fileIconKind('OUTPUT.JSON')).toBe('json')
    expect(fileIconKind('ROWS.CSV')).toBe('spreadsheet')
  })

  it('buckets .html and .htm files', () => {
    expect(fileIconKind('report.html')).toBe('html')
    expect(fileIconKind('index.htm')).toBe('html')
  })

  it('buckets spreadsheets', () => {
    expect(fileIconKind('rows.csv')).toBe('spreadsheet')
    expect(fileIconKind('book.xlsx')).toBe('spreadsheet')
    expect(fileIconKind('macro.xlsm')).toBe('spreadsheet')
    expect(fileIconKind('legacy.xls')).toBe('spreadsheet')
  })

  it('buckets code files', () => {
    for (const name of ['pom.xml', 'values.yaml', 'values.yml', 'seed.py', 'run.sh', 'app.js', 'app.ts']) {
      expect(fileIconKind(name)).toBe('code')
    }
  })

  it('buckets text files', () => {
    for (const name of ['notes.txt', 'service.log', 'readme.md']) {
      expect(fileIconKind(name)).toBe('text')
    }
  })

  it('buckets images', () => {
    for (const name of ['shot.png', 'shot.jpg', 'shot.jpeg', 'anim.gif', 'logo.svg']) {
      expect(fileIconKind(name)).toBe('image')
    }
  })

  it('buckets archives', () => {
    for (const name of ['bundle.zip', 'bundle.tar', 'bundle.tar.gz', 'bundle.tgz']) {
      expect(fileIconKind(name)).toBe('archive')
    }
  })

  it('falls back to doc for everything else', () => {
    expect(fileIconKind('payload.bin')).toBe('doc')
    expect(fileIconKind('LICENSE')).toBe('doc')
  })
})
