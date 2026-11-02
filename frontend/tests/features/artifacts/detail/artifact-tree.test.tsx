/**
 * ArtifactTree - collapsible Regression>Suite>Test / dir tree
 *
 * Module: frontend/src/features/artifacts/detail/artifact-tree.tsx
 *
 * Renders a forest of ArtifactTreeNode in tree or flat mode. Directory nodes
 * are collapsible (aria-expanded) and carry subtree download + delete; leaf
 * nodes render a full shared FileRow (copy path + download + delete). The container is an
 * ARIA tree (role tree/treeitem/group).
 *
 * The prop is named `nodes` (the top-level forest).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const rowSpies = vi.hoisted(() => ({ folderRow: vi.fn(), fileRow: vi.fn() }))

vi.mock('@/components/shared/folder-row', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shared/folder-row')>()
  const { createElement } = await import('react')
  const Actual = actual.FolderRow
  return {
    ...actual,
    FolderRow: (props: Parameters<typeof Actual>[0]) => {
      rowSpies.folderRow(props)
      return createElement(Actual, props)
    },
  }
})

vi.mock('@/components/shared/file-row', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shared/file-row')>()
  const { createElement } = await import('react')
  const Actual = actual.FileRow
  return {
    ...actual,
    FileRow: (props: Parameters<typeof Actual>[0]) => {
      rowSpies.fileRow(props)
      return createElement(Actual, props)
    },
  }
})

import { ArtifactTree } from '@/features/artifacts/detail/artifact-tree'
import { buildLogTree, type ArtifactTreeNode } from '@/features/artifacts/lib/artifact-sections'
import type { ArtifactMeta } from '@/features/artifacts/api/types'

function makeArtifact(path: string): ArtifactMeta {
  return {
    id: `20260609-120000-exec-1/${path}`,
    execution_id: 'exec-1',
    name: path.split('/').pop() ?? path,
    path,
    size_bytes: 64,
    content_type: 'text/plain',
    compression: null,
    created_at: '2026-06-09T12:00:00Z',
  }
}

function suiteWithLeaf(): ArtifactTreeNode[] {
  const leaf: ArtifactTreeNode = {
    name: 'login.log',
    path: 'logs/smoke/login.log',
    children: [],
    artifact: makeArtifact('logs/smoke/login.log'),
  }
  const suite: ArtifactTreeNode = {
    name: 'smoke',
    path: 'logs/smoke',
    children: [leaf],
    artifact: null,
  }
  return [suite]
}

function renderTree(
  props: Partial<React.ComponentProps<typeof ArtifactTree>> = {},
) {
  const handlers = { onDownload: vi.fn(), onDelete: vi.fn() }
  render(
    <ArtifactTree
      nodes={suiteWithLeaf()}
      mode="tree"
      showRemoved={false}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

describe('ArtifactTree - structure', () => {
  it('renders a nested list of nodes', () => {
    renderTree()
    expect(screen.getAllByRole('list').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('smoke')).toBeInTheDocument()
  })

  it('shows the directory node and (expanded) its leaf', () => {
    renderTree()
    expect(screen.getByText('smoke')).toBeInTheDocument()
    expect(screen.getByText('login.log')).toBeInTheDocument()
  })

  it('exposes no preview affordance on leaves or nodes', () => {
    renderTree()
    expect(screen.queryAllByRole('button', { name: /preview/i })).toHaveLength(0)
  })
})

describe('ArtifactTree - expand / collapse', () => {
  it('a directory node is an expandable control', () => {
    renderTree()
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument()
  })

  it('collapsing the node hides its leaf', async () => {
    const user = userEvent.setup()
    renderTree()

    await user.click(screen.getByRole('button', { expanded: true }))

    expect(screen.queryByText('login.log')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()
  })

  it('toggles via the keyboard (Enter on the focused disclosure)', async () => {
    const user = userEvent.setup()
    renderTree()

    const toggle = screen.getByRole('button', { expanded: true })
    toggle.focus()
    await user.keyboard('{Enter}')

    expect(screen.queryByText('login.log')).not.toBeInTheDocument()
  })
})

describe('ArtifactTree - node subtree actions', () => {
  it('a directory node offers download + delete for its subtree', async () => {
    const user = userEvent.setup()
    const handlers = renderTree()

    await user.click(screen.getByRole('button', { name: /download smoke/i }))
    await user.click(screen.getByRole('button', { name: /delete smoke/i }))

    expect(handlers.onDownload).toHaveBeenCalled()
    expect(handlers.onDelete).toHaveBeenCalled()
  })
})

describe('ArtifactTree - entity variant (Logs)', () => {
  const handlers = () => ({ onDownload: vi.fn(), onDelete: vi.fn() })
  // jsdom serializes the fail-tint hex (#EF4444) to this rgb form.
  const FAIL_RGB = 'rgb(239, 68, 68)'

  it('renders entity icons and the subtree size, untinted when scopes are clean', () => {
    const { container } = render(
      <ArtifactTree nodes={suiteWithLeaf()} mode="tree" showRemoved={false} entityIcons {...handlers()} />,
    )

    expect(screen.getByText('smoke')).toBeInTheDocument()
    expect(screen.getByText('login.log')).toBeInTheDocument()
    // suite node aggregate size + leaf size (one 64-byte leaf)
    expect(screen.getAllByText('64 B').length).toBeGreaterThanOrEqual(1)
    expect(container.innerHTML).not.toContain(FAIL_RGB)
  })

  it('tints a failed test leaf red when its scope is in the failure set', () => {
    const { container } = render(
      <ArtifactTree
        nodes={suiteWithLeaf()}
        mode="tree"
        showRemoved={false}
        entityIcons
        failedScopes={new Set(['smoke/login'])}
        {...handlers()}
      />,
    )

    expect(container.innerHTML).toContain(FAIL_RGB)
  })

  it('leaves a passing test leaf untinted when its scope is not in the failure set', () => {
    const { container } = render(
      <ArtifactTree
        nodes={suiteWithLeaf()}
        mode="tree"
        showRemoved={false}
        entityIcons
        failedScopes={new Set(['other/test'])}
        {...handlers()}
      />,
    )

    expect(container.innerHTML).not.toContain(FAIL_RGB)
  })
})

describe('ArtifactTree - entity node meta counts', () => {
  const handlers = () => ({ onDownload: vi.fn(), onDelete: vi.fn() })

  function suiteForest(): ArtifactTreeNode[] {
    return buildLogTree([
      makeArtifact('logs/smoke/login.log'),
      makeArtifact('logs/smoke/logout.log'),
    ])
  }

  it('shows the failed count and total tests on a suite node', () => {
    render(
      <ArtifactTree
        nodes={suiteForest()}
        mode="tree"
        showRemoved={false}
        entityIcons
        failedScopes={new Set(['smoke/login'])}
        {...handlers()}
      />,
    )

    expect(screen.getByText('1 failed')).toBeInTheDocument()
    expect(screen.getByText(/2 tests/)).toBeInTheDocument()
  })

  it('shows "passed" on a clean suite node', () => {
    render(
      <ArtifactTree
        nodes={suiteForest()}
        mode="tree"
        showRemoved={false}
        entityIcons
        failedScopes={new Set()}
        {...handlers()}
      />,
    )

    expect(screen.getByText('passed')).toBeInTheDocument()
    expect(screen.getByText(/2 tests/)).toBeInTheDocument()
  })

  it('totals suites (not tests) on a regression node', () => {
    render(
      <ArtifactTree
        nodes={buildLogTree([
          makeArtifact('logs/nightly/smoke/a.log'),
          makeArtifact('logs/nightly/login/b.log'),
        ])}
        mode="tree"
        showRemoved={false}
        entityIcons
        failedScopes={new Set(['nightly/smoke/a'])}
        {...handlers()}
      />,
    )

    // The regression node (· 2 suites) plus its failed child suite both read "1 failed".
    expect(screen.getAllByText('1 failed').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/2 suites/)).toBeInTheDocument()
  })

  it('omits meta counts on a plain (non-entity) directory node', () => {
    render(<ArtifactTree nodes={suiteForest()} mode="tree" showRemoved={false} {...handlers()} />)

    expect(screen.queryByText(/tests/)).not.toBeInTheDocument()
  })
})

describe('ArtifactTree - flat mode subtitles', () => {
  const handlers = () => ({ onDownload: vi.fn(), onDelete: vi.fn() })

  it('renders the file path as a mono subtitle in flat mode', () => {
    render(<ArtifactTree nodes={suiteWithLeaf()} mode="flat" showRemoved={false} {...handlers()} />)

    const subtitle = screen.getByTestId('artifact-file-subtitle')
    expect(subtitle).toHaveTextContent('logs/smoke/login.log')
    expect(subtitle.className).toContain('font-mono')
  })
})

describe('ArtifactTree - flat mode', () => {
  it('renders leaves without any expand/collapse controls', () => {
    renderTree({ mode: 'flat' })

    expect(screen.getByText('login.log')).toBeInTheDocument()
    expect(screen.queryByRole('button', { expanded: true })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { expanded: false })).not.toBeInTheDocument()
  })
})

describe('ArtifactTree - shared rows and copy path', () => {
  beforeEach(() => {
    rowSpies.folderRow.mockClear()
    rowSpies.fileRow.mockClear()
  })

  it('renders directory nodes through the shared FolderRow', () => {
    renderTree()

    expect(rowSpies.folderRow).toHaveBeenCalled()
  })

  it('renders leaves through the shared FileRow', () => {
    renderTree()

    expect(rowSpies.fileRow).toHaveBeenCalled()
    expect(screen.getByTestId('file-row')).toBeInTheDocument()
  })

  it('gives the folder row the artifact reference of its own path', () => {
    renderTree()

    expect(rowSpies.folderRow).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'smoke', copyPath: 'artifact://logs/smoke' }),
    )
  })

  it('gives the file row the artifact reference of its own path', () => {
    renderTree()

    expect(rowSpies.fileRow).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'login.log',
        copyPath: 'artifact://logs/smoke/login.log',
      }),
    )
  })

  it('shows Copy path before Download on a folder row', () => {
    renderTree()

    const copy = screen.getByRole('button', { name: 'Copy path of smoke' })
    const download = screen.getByRole('button', { name: 'Download smoke' })

    expect(copy).toHaveAttribute('data-testid', 'copy-path-button')
    expect(
      Boolean(copy.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
  })

  it('shows Copy path before Download on a file row', () => {
    renderTree()

    const copy = screen.getByRole('button', { name: 'Copy path of login.log' })
    const download = screen.getByRole('button', { name: 'Download login.log' })

    expect(
      Boolean(copy.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true)
  })

  it('gives flat-mode rows the artifact reference too', () => {
    renderTree({ mode: 'flat' })

    expect(rowSpies.fileRow).toHaveBeenCalledWith(
      expect.objectContaining({ copyPath: 'artifact://logs/smoke/login.log' }),
    )
  })
})
