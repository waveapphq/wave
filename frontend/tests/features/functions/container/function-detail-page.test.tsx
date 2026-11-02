/**
 * FunctionDetailPage.
 *
 * Read-only versioned metadata page. Contract:
 *   - Loads versions for the routed :functionId; latest is preselected.
 *   - Selecting a version in the nav drives the meta header + sections.
 *   - Per-version delete (nav) AND whole-Function delete (header) both exist
 *     and are NEVER gated by usage - they open ConfirmationDialog and
 *     proceed even when dependents are present.
 *   - Sections are collapsible (Changelog expanded; Inputs/Outputs collapsed),
 *     and the Inputs/Outputs tables carry a Description column.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

vi.mock('@/features/functions/api/functions-api', () => ({
  listFunctionVersions: vi.fn(),
  getDependentsByVersion: vi.fn(),
  deleteFunction: vi.fn(),
  deleteFunctionVersion: vi.fn(),
  FunctionsApiError: class extends Error {},
}))

import {
  listFunctionVersions,
  getDependentsByVersion,
  deleteFunction,
  deleteFunctionVersion,
} from '@/features/functions/api/functions-api'
import { FunctionDetailPage } from '@/features/functions/container/function-detail-page'
import { usePageBlockStore } from '@/stores/page-block-store'

const mockListVersions = vi.mocked(listFunctionVersions)
const mockGetDependentsByVersion = vi.mocked(getDependentsByVersion)
const mockDeleteFunction = vi.mocked(deleteFunction)
const mockDeleteFunctionVersion = vi.mocked(deleteFunctionVersion)

const VERSIONS = {
  latest: '2.0.0',
  versions: [
    {
      version: '2.0.0',
      published_at: '2026-05-01T00:00:00Z',
      changelog: 'Second major',
      details: 'Detailed **markdown** notes for 2.0.0',
      description: 'Sends an email (v2)',
      tags: ['mail'],
      inputs: [
        { name: 'to', type: 'string', required: true, default: '', description: 'Recipient address' },
      ],
      outputs: [{ name: 'sent', type: 'boolean', description: 'Whether it was sent' }],
    },
    {
      version: '1.0.0',
      published_at: '2026-01-01T00:00:00Z',
      changelog: 'First release',
      details: 'Notes for 1.0.0',
      description: 'Sends an email (v1)',
      tags: ['mail'],
      inputs: [
        { name: 'to', type: 'string', required: true, default: '', description: 'Recipient' },
      ],
      outputs: [{ name: 'sent', type: 'boolean', description: 'Sent flag' }],
    },
  ],
}

function WorkbenchRouteProbe() {
  const location = useLocation()
  return <div data-testid="workbench-route">{location.search}</div>
}

function renderDetail(functionId = 'fn-1') {
  return render(
    <MemoryRouter initialEntries={[`/functions/${functionId}`]}>
      <Routes>
        <Route path="/functions/:functionId" element={<FunctionDetailPage />} />
        <Route path="/functions" element={<div data-testid="functions-list">Functions List</div>} />
        <Route path="/workbench" element={<WorkbenchRouteProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  usePageBlockStore.setState({ block: null, retrying: false })
  mockListVersions.mockResolvedValue(
    VERSIONS as unknown as Awaited<ReturnType<typeof listFunctionVersions>>,
  )
  // Usage present on the selected version - delete must still be allowed.
  mockGetDependentsByVersion.mockResolvedValue({
    '2.0.0': { tests: [{ id: 't1', name: 'Uses v2' }], functions: [] },
  })
  mockDeleteFunction.mockResolvedValue(undefined)
  mockDeleteFunctionVersion.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FunctionDetailPage - load + version selection', () => {
  it('renders the page and preselects the latest version', async () => {
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-page')).toBeInTheDocument())
    // Latest (2.0.0) drives the meta header by default.
    expect(screen.getByTestId('function-detail-header')).toHaveTextContent('2.0.0')
    expect(screen.getByText('Sends an email (v2)')).toBeInTheDocument()
  })

  it('selecting an older version drives the meta header + sections', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-page')).toBeInTheDocument())

    // Older majors collapse by default; expand 1.x to reach 1.0.0.
    await user.click(screen.getByTestId('version-major-1'))
    await user.click(screen.getByTestId('version-nav-item-1.0.0'))
    await waitFor(() => {
      expect(screen.getByText('Sends an email (v1)')).toBeInTheDocument()
    })
  })

  it('shows a loading state before versions resolve', () => {
    mockListVersions.mockReturnValue(new Promise(() => {}))
    // Keep the usage fetch pending too, so no async setState escapes act().
    mockGetDependentsByVersion.mockReturnValue(new Promise(() => {}))
    renderDetail()
    expect(screen.getByTestId('function-detail-loading')).toBeInTheDocument()
  })

  it('blocks the page when the per-version usage fetch fails', async () => {
    mockGetDependentsByVersion.mockRejectedValue(new Error('usage boom'))
    renderDetail()
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())
    expect(usePageBlockStore.getState().block?.title).toBe('Could not load where this version is used')
    expect(screen.getByTestId('function-detail-header')).toHaveTextContent('2.0.0')
  })

  it('raises no block when the version list read failed too', async () => {
    mockListVersions.mockRejectedValue(new Error('versions boom'))
    mockGetDependentsByVersion.mockRejectedValue(new Error('usage boom'))
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-error')).toBeInTheDocument())
    await waitFor(() => expect(mockGetDependentsByVersion).toHaveBeenCalled())
    expect(usePageBlockStore.getState().block).toBeNull()
  })
})

describe('FunctionDetailPage - a failed usage read closes the delete path', () => {
  it('issues no per-version delete request', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    mockGetDependentsByVersion.mockRejectedValue(new Error('usage boom'))
    renderDetail()
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    await user.click(screen.getByTestId('version-delete-2.0.0'))
    await user.click(screen.getByRole('button', { name: /^Delete$/i }))

    expect(mockDeleteFunctionVersion).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        screen.getByText(
          'Could not load where this version is used. Try Again to load it, then delete.',
        ),
      ).toBeInTheDocument(),
    )
  })

  it('issues no whole-Function delete request', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    mockGetDependentsByVersion.mockRejectedValue(new Error('usage boom'))
    renderDetail()
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    await user.click(screen.getByTestId('delete-function'))
    await user.click(screen.getByRole('button', { name: /^Delete$/i }))

    expect(mockDeleteFunction).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        screen.getByText(
          'Could not load where this Function is used. Try Again to load it, then delete.',
        ),
      ).toBeInTheDocument(),
    )
  })

  it('reopens the delete path once the usage read recovers', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    mockGetDependentsByVersion.mockRejectedValueOnce(new Error('usage boom'))
    renderDetail()
    await waitFor(() => expect(usePageBlockStore.getState().block).not.toBeNull())

    mockGetDependentsByVersion.mockResolvedValue({
      '2.0.0': { tests: [], functions: [] },
    })
    await act(async () => {
      await usePageBlockStore.getState().block!.retry()
    })
    expect(usePageBlockStore.getState().block).toBeNull()

    await user.click(screen.getByTestId('version-delete-2.0.0'))
    await user.click(screen.getByRole('button', { name: /^Delete$/i }))
    expect(mockDeleteFunctionVersion).toHaveBeenCalledWith('fn-1', '2.0.0')
  })
})

describe('FunctionDetailPage - sections', () => {
  it('renders Changelog expanded and Inputs/Outputs collapsible with a Description column', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-page')).toBeInTheDocument())

    // Changelog content is visible by default (section expanded).
    expect(screen.getByText('Second major')).toBeInTheDocument()

    // Expand the Inputs section, then assert the Description column + value.
    await user.click(screen.getByTestId('section-toggle-inputs'))
    const inputs = screen.getByTestId('section-inputs')
    expect(within(inputs).getByRole('columnheader', { name: /Description/i })).toBeInTheDocument()
    expect(within(inputs).getByText('Recipient address')).toBeInTheDocument()
  })
})

describe('FunctionDetailPage - delete is never gated by usage', () => {
  it('per-version delete proceeds even with dependents present', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-page')).toBeInTheDocument())

    await user.click(screen.getByTestId('version-delete-2.0.0'))
    // ConfirmationDialog opens; confirm.
    await user.click(screen.getByRole('button', { name: /^Delete$/i }))
    expect(mockDeleteFunctionVersion).toHaveBeenCalledWith('fn-1', '2.0.0')
  })

  it('whole-Function delete proceeds even with dependents present', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-page')).toBeInTheDocument())

    await user.click(screen.getByTestId('delete-function'))
    await user.click(screen.getByRole('button', { name: /^Delete$/i }))
    expect(mockDeleteFunction).toHaveBeenCalledWith('fn-1', expect.anything())
  })
})

describe('FunctionDetailPage - View workflow', () => {
  it('navigates to the read-only library View for the selected version', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-page')).toBeInTheDocument())

    await user.click(screen.getByTestId('view-workflow'))
    // Lands on /workbench?viewFunction={id}&version={selectedVersion} (latest preselected).
    await waitFor(() => expect(screen.getByTestId('workbench-route')).toBeInTheDocument())
    const search = screen.getByTestId('workbench-route').textContent ?? ''
    expect(search).toContain('viewFunction=fn-1')
    expect(search).toContain('version=2.0.0')
  })
})

// Container branches the contract tests above do
// not exercise (load error, delete failures, last-version navigate, and the
// no-description / no-tags / published_by meta-header branches).
describe('FunctionDetailPage - load error', () => {
  it('shows the error state and navigates back to the list', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    mockListVersions.mockReset()
    mockListVersions.mockRejectedValue(new Error('load failed'))
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-error')).toBeInTheDocument())
    expect(screen.getByText('load failed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Back to Functions/i }))
    await waitFor(() => expect(screen.getByTestId('functions-list')).toBeInTheDocument())
  })

  it('shows "Function not found" when the version list is empty', async () => {
    mockListVersions.mockReset()
    mockListVersions.mockResolvedValue({
      latest: '',
      name: '',
      versions: [],
    } as unknown as Awaited<ReturnType<typeof listFunctionVersions>>)
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-error')).toBeInTheDocument())
    expect(screen.getByText('Function not found')).toBeInTheDocument()
  })
})

describe('FunctionDetailPage - meta header optional fields', () => {
  it('renders without a description or tags and shows the author', async () => {
    mockListVersions.mockReset()
    mockListVersions.mockResolvedValue({
      latest: '1.0.0',
      name: 'lonely',
      versions: [
        {
          version: '1.0.0',
          published_at: '2026-01-01T00:00:00Z',
          published_by: 'alice',
          changelog: 'c',
          details: 'd',
          description: '',
          tags: [],
          inputs: [],
          outputs: [],
        },
      ],
    } as unknown as Awaited<ReturnType<typeof listFunctionVersions>>)
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-page')).toBeInTheDocument())
    expect(screen.getByTestId('function-detail-header')).toHaveTextContent('1.0.0')
    expect(screen.getByText('alice')).toBeInTheDocument()
  })

  it('renders a formatted date and a tests/functions usage summary', async () => {
    mockGetDependentsByVersion.mockReset()
    mockGetDependentsByVersion.mockResolvedValue({
      '2.0.0': {
        tests: [
          { id: 't1', name: 'a' },
          { id: 't2', name: 'b' },
        ],
        functions: [{ id: 'f1', name: 'c' }],
      },
    })
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-page')).toBeInTheDocument())
    // Matches the wireframe: formatted date + "Used in X tests · Y functions".
    expect(screen.getByText('May 1, 2026')).toBeInTheDocument()
    expect(screen.getByText('Used in 2 tests · 1 function')).toBeInTheDocument()
  })
})

describe('FunctionDetailPage - delete failures surface a banner', () => {
  it('shows a banner when per-version delete fails', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    mockDeleteFunctionVersion.mockReset()
    mockDeleteFunctionVersion.mockRejectedValue(new Error('version in use by storage'))
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-page')).toBeInTheDocument())
    await user.click(screen.getByTestId('version-delete-2.0.0'))
    await user.click(screen.getByRole('button', { name: /^Delete$/i }))
    await waitFor(() => expect(screen.getByText('version in use by storage')).toBeInTheDocument())
  })

  it('shows a banner when whole-Function delete fails', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    mockDeleteFunction.mockReset()
    mockDeleteFunction.mockRejectedValue(new Error('function delete failed'))
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-page')).toBeInTheDocument())
    await user.click(screen.getByTestId('delete-function'))
    await user.click(screen.getByRole('button', { name: /^Delete$/i }))
    await waitFor(() => expect(screen.getByText('function delete failed')).toBeInTheDocument())
  })
})

describe('FunctionDetailPage - edge / error branches', () => {
  it('falls back to a generic message when the load error is not an Error', async () => {
    mockListVersions.mockReset()
    mockListVersions.mockRejectedValue('weird')
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-error')).toBeInTheDocument())
    expect(screen.getByText('Failed to load function')).toBeInTheDocument()
  })

  it('renders a version that declares no inputs or outputs', async () => {
    mockListVersions.mockReset()
    mockListVersions.mockResolvedValue({
      latest: '1.0.0',
      name: 'no_io',
      versions: [
        {
          version: '1.0.0',
          published_at: '2026-01-01T00:00:00Z',
          changelog: 'c',
          details: 'd',
          description: 'no io',
          tags: [],
        },
      ],
    } as unknown as Awaited<ReturnType<typeof listFunctionVersions>>)
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-page')).toBeInTheDocument())
  })

  it('sits in the loading shell when there is no function id (guards)', () => {
    render(
      <MemoryRouter initialEntries={['/detail']}>
        <Routes>
          <Route path="/detail" element={<FunctionDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('function-detail-loading')).toBeInTheDocument()
  })

  it('falls back to a generic message when a per-version delete error is not an Error', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    mockDeleteFunctionVersion.mockReset()
    mockDeleteFunctionVersion.mockRejectedValue('weird')
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-page')).toBeInTheDocument())
    await user.click(screen.getByTestId('version-delete-2.0.0'))
    await user.click(screen.getByRole('button', { name: /^Delete$/i }))
    await waitFor(() => expect(screen.getByText('Failed to delete version')).toBeInTheDocument())
  })

  it('falls back to a generic message when a whole-Function delete error is not an Error', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    mockDeleteFunction.mockReset()
    mockDeleteFunction.mockRejectedValue('weird')
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-page')).toBeInTheDocument())
    await user.click(screen.getByTestId('delete-function'))
    await user.click(screen.getByRole('button', { name: /^Delete$/i }))
    await waitFor(() => expect(screen.getByText('Failed to delete function')).toBeInTheDocument())
  })
})

describe('FunctionDetailPage - deleting the last version', () => {
  it('navigates to the list when the Function is gone after delete', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    mockListVersions.mockReset()
    mockListVersions
      .mockResolvedValueOnce(VERSIONS as unknown as Awaited<ReturnType<typeof listFunctionVersions>>)
      .mockRejectedValueOnce(new Error("Function 'fn-1' not found"))
    mockDeleteFunctionVersion.mockReset()
    mockDeleteFunctionVersion.mockResolvedValue(undefined)
    renderDetail()
    await waitFor(() => expect(screen.getByTestId('function-detail-page')).toBeInTheDocument())
    await user.click(screen.getByTestId('version-delete-2.0.0'))
    await user.click(screen.getByRole('button', { name: /^Delete$/i }))
    await waitFor(() => expect(screen.getByTestId('functions-list')).toBeInTheDocument())
  })
})
