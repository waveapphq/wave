/**
 * ArtifactDrillSection (coverage for detail/artifact-drill-section.tsx).
 *
 * Failure/Reports render a flat row list (no toggle); Logs/Files render the
 * tree with a Tree | Flat SegmentedControl that owns its own mode state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const fileRowSpy = vi.hoisted(() => vi.fn())

vi.mock('@/components/shared/file-row', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shared/file-row')>()
  const { createElement } = await import('react')
  const Actual = actual.FileRow
  return {
    ...actual,
    FileRow: (props: Parameters<typeof Actual>[0]) => {
      fileRowSpy(props)
      return createElement(Actual, props)
    },
  }
})

import { ArtifactDrillSection } from '@/features/artifacts/detail/artifact-drill-section'
import type { ArtifactMeta } from '@/features/artifacts/api/types'

function artifact(path: string, extra: Partial<ArtifactMeta> = {}): ArtifactMeta {
  return {
    id: `dir-1/${path}`,
    execution_id: 'exec-1',
    name: path.split('/').pop() ?? path,
    path,
    size_bytes: 12,
    content_type: 'text/plain',
    compression: null,
    created_at: '2026-06-09T12:00:00Z',
    ...extra,
  }
}

const HANDLERS = () => ({ onDownload: vi.fn(), onDelete: vi.fn() })

describe('ArtifactDrillSection - flat list (no tree)', () => {
  it('renders the title and a row per artifact, with no Tree/Flat toggle', () => {
    render(
      <ArtifactDrillSection
        title="Reports"
        artifacts={[artifact('report.json')]}
        withTree={false}
        showRemoved={false}
        {...HANDLERS()}
      />,
    )

    expect(screen.getByText('Reports')).toBeInTheDocument()
    expect(screen.getByText('report.json')).toBeInTheDocument()
    expect(screen.queryByText('Tree')).not.toBeInTheDocument()
    expect(screen.queryByText('Flat')).not.toBeInTheDocument()
  })

  it('forwards a row action to the supplied handler', async () => {
    const user = userEvent.setup()
    const handlers = HANDLERS()
    render(
      <ArtifactDrillSection
        title="Reports"
        artifacts={[artifact('report.json')]}
        withTree={false}
        showRemoved={false}
        {...handlers}
      />,
    )

    await user.click(screen.getByRole('button', { name: /download/i }))

    expect(handlers.onDownload).toHaveBeenCalled()
  })

  it('renders a removed artifact as a muted audit row', () => {
    render(
      <ArtifactDrillSection
        title="Reports"
        artifacts={[artifact('report.json', { removed_at: '2026-06-09T13:00:00Z', removed_by: 'wparker' })]}
        withTree={false}
        showRemoved
        {...HANDLERS()}
      />,
    )

    expect(screen.getByText(/removed/i)).toBeInTheDocument()
  })
})

describe('ArtifactDrillSection - count badge', () => {
  it('shows a file count badge on a default section', () => {
    render(
      <ArtifactDrillSection
        title="Reports"
        artifacts={[artifact('report.json'), artifact('report.html')]}
        withTree={false}
        showRemoved={false}
        {...HANDLERS()}
      />,
    )

    expect(screen.getByText('2 files')).toBeInTheDocument()
  })

  it('shows a failures badge on the failure variant', () => {
    render(
      <ArtifactDrillSection
        title="Failure summary"
        artifacts={[artifact('error.json')]}
        withTree={false}
        showRemoved={false}
        variant="failure"
        failureCount={3}
        {...HANDLERS()}
      />,
    )

    expect(screen.getByText('3 failures')).toBeInTheDocument()
  })
})

describe('ArtifactDrillSection - row descriptions', () => {
  it('renders the known-file description as a subtitle', () => {
    render(
      <ArtifactDrillSection
        title="Reports"
        artifacts={[artifact('report.json')]}
        withTree={false}
        showRemoved={false}
        {...HANDLERS()}
      />,
    )

    expect(screen.getByText('Canonical report model')).toBeInTheDocument()
  })
})

describe('ArtifactDrillSection - entity (Logs) tree', () => {
  it('unwraps the logs/ prefix into a suite > test entity tree', () => {
    render(
      <ArtifactDrillSection
        title="Logs"
        artifacts={[artifact('logs/smoke/login.log')]}
        withTree
        entityTree
        showRemoved={false}
        {...HANDLERS()}
      />,
    )

    expect(screen.getByText('smoke')).toBeInTheDocument()
    expect(screen.getByText('login.log')).toBeInTheDocument()
  })
})

describe('ArtifactDrillSection - tree with view toggle', () => {
  function renderTree() {
    const handlers = HANDLERS()
    render(
      <ArtifactDrillSection
        title="Logs"
        artifacts={[artifact('smoke/login.log')]}
        withTree
        showRemoved={false}
        {...handlers}
      />,
    )
    return handlers
  }

  it('shows a Tree | Flat toggle and renders the tree by default', () => {
    renderTree()

    expect(screen.getByText('Tree')).toBeInTheDocument()
    expect(screen.getByText('Flat')).toBeInTheDocument()
    // the 'smoke' directory disclosure is expanded by default
    expect(screen.getByRole('button', { name: /collapse smoke/i })).toBeInTheDocument()
    expect(screen.getByText('login.log')).toBeInTheDocument()
  })

  it('switches to flat mode (no disclosures) and back to tree', async () => {
    const user = userEvent.setup()
    renderTree()

    await user.click(screen.getByText('Flat'))
    expect(screen.queryByRole('button', { name: /collapse smoke/i })).not.toBeInTheDocument()
    expect(screen.getByText('login.log')).toBeInTheDocument()

    await user.click(screen.getByText('Tree'))
    expect(screen.getByRole('button', { name: /collapse smoke/i })).toBeInTheDocument()
  })

  it('collapses and expands the whole section via the title disclosure', async () => {
    const user = userEvent.setup()
    renderTree()

    expect(screen.getByText('login.log')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /logs/i }))
    expect(screen.queryByText('login.log')).not.toBeInTheDocument()
    expect(screen.queryByText('Tree')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /logs/i }))
    expect(screen.getByText('login.log')).toBeInTheDocument()
  })
})

describe('ArtifactDrillSection - Tree | Flat segmented control', () => {
  function renderTree() {
    render(
      <ArtifactDrillSection
        title="Logs"
        artifacts={[artifact('smoke/login.log')]}
        withTree
        showRemoved={false}
        {...HANDLERS()}
      />,
    )
  }

  it('renders the toggle as a labeled group of aria-pressed buttons', () => {
    renderTree()

    const group = screen.getByRole('group')
    expect(group.getAttribute('aria-label')).toBeTruthy()
    expect(within(group).getByRole('button', { name: 'Tree' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(group).getByRole('button', { name: 'Flat' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('drops the private toolbar toggle', () => {
    renderTree()

    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('moves the pressed state to the option that was clicked', async () => {
    const user = userEvent.setup()
    renderTree()

    await user.click(screen.getByRole('button', { name: 'Flat' }))

    const group = screen.getByRole('group')
    expect(within(group).getByRole('button', { name: 'Flat' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(group).getByRole('button', { name: 'Tree' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.queryByRole('button', { name: /collapse smoke/i })).not.toBeInTheDocument()
  })
})

describe('ArtifactDrillSection - copy path on the flat rows', () => {
  beforeEach(() => {
    fileRowSpy.mockClear()
  })

  it('gives each row the artifact reference of its path', () => {
    render(
      <ArtifactDrillSection
        title="Reports"
        artifacts={[artifact('report.json')]}
        withTree={false}
        showRemoved={false}
        {...HANDLERS()}
      />,
    )

    expect(fileRowSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'report.json', copyPath: 'artifact://report.json' }),
    )
  })

  it('renders Copy path before Download on the row', () => {
    render(
      <ArtifactDrillSection
        title="Reports"
        artifacts={[artifact('report.json')]}
        withTree={false}
        showRemoved={false}
        {...HANDLERS()}
      />,
    )

    const copy = screen.getByRole('button', { name: 'Copy path of report.json' })
    const download = screen.getByRole('button', { name: 'Download report.json' })

    expect(copy).toHaveAttribute('data-testid', 'copy-path-button')
    expect(
      Boolean(copy.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
  })
})
