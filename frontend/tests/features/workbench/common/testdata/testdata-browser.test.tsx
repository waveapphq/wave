/**
 * TestDataBrowser - the one browser both the Test Data sheet and the file
 * reference picker mount.
 *
 * Module: frontend/src/features/workbench/common/testdata/testdata-browser.tsx
 *
 * Manage mode carries the toolbar, the row actions and the dialogs; pick mode
 * carries the selection rules the picker asks for. Upload conflicts are found
 * against the listing already on screen, before anything is sent, so the user
 * answers once and one request follows. A refusal the server answered with
 * 409 is shown above the tree and the action is dropped, never retried.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'

const dropHook = vi.hoisted(() => ({
  onFiles: undefined as ((files: File[]) => void) | undefined,
  enabled: undefined as boolean | undefined,
}))

vi.mock('@/hooks/use-file-drop', () => ({
  useFileDrop: (options: { onFiles?: (files: File[]) => void; enabled?: boolean }) => {
    dropHook.onFiles = options.onFiles
    dropHook.enabled = options.enabled
    return { isDragging: false, dropZoneRef: { current: null } }
  },
}))

vi.mock('@/features/tests/api/testdata', () => ({
  testdataApi: {
    list: vi.fn(),
    upload: vi.fn(),
    createFolder: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    contentUrl: vi.fn(() => 'http://localhost:8000/content'),
    zipUrl: vi.fn(() => 'http://localhost:8000/zip'),
    download: vi.fn(),
    downloadZip: vi.fn(),
  },
}))

import { testdataApi } from '@/features/tests/api/testdata'
import { TestDataBrowser } from '@/features/workbench/common/testdata/testdata-browser'
import type { TestDataUpload } from '@/features/workbench/common/testdata/use-testdata'
import type { TestDataListing } from '@/features/tests/api/types'

const TEST_ID = 'test-42'
const RUNNING_MESSAGE =
  "Test 'Login' is running; test data cannot be changed until it finishes"

const LISTING: TestDataListing = {
  entries: [
    { path: 'fixtures', kind: 'dir', size_bytes: 0, modified_at: '2026-09-01T10:00:00+00:00' },
    {
      path: 'fixtures/users.csv',
      kind: 'file',
      size_bytes: 18_432,
      modified_at: '2026-09-01T10:00:01+00:00',
    },
    {
      path: 'fixtures/orders.json',
      kind: 'file',
      size_bytes: 4_198,
      modified_at: '2026-09-01T10:00:02+00:00',
    },
    { path: 'payloads', kind: 'dir', size_bytes: 0, modified_at: '2026-09-01T10:00:03+00:00' },
    {
      path: 'payloads/big.bin',
      kind: 'file',
      size_bytes: 98_304,
      modified_at: '2026-09-01T10:00:04+00:00',
    },
    {
      path: 'schema.xsd',
      kind: 'file',
      size_bytes: 2_355,
      modified_at: '2026-09-01T10:00:05+00:00',
    },
  ],
  total_files: 4,
  total_bytes: 123_289,
}

const EMPTY_LISTING: TestDataListing = { entries: [], total_files: 0, total_bytes: 0 }

type BrowserProps = ComponentProps<typeof TestDataBrowser>

function renderBrowser(props: Partial<BrowserProps> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onChoose: vi.fn(),
    onUpload: vi.fn(),
    onCreateFolder: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
  }
  render(
    <TestDataBrowser
      testId={TEST_ID}
      listing={LISTING}
      mode="manage"
      {...handlers}
      {...props}
    />
  )
  return handlers
}

function file(name: string): File {
  return new File(['x'], name, { type: 'text/plain' })
}

function inFlight(name: string, folder = ''): TestDataUpload {
  return {
    id: name,
    name,
    folder,
    path: folder ? `${folder}/${name}` : name,
    loaded: 0,
    total: 1_000,
    eta: null,
    startedAt: Date.now(),
    status: 'uploading',
    failure: null,
    retry: null,
    chooseFile: null,
    cancel: vi.fn(),
    dismiss: vi.fn(),
  }
}

function row(name: string): HTMLElement {
  return screen.getByText(name).closest('[data-testid="testdata-row"]') as HTMLElement
}

async function openKebab(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `More actions for ${name}` }))
}

beforeEach(() => {
  vi.clearAllMocks()
  dropHook.onFiles = undefined
  dropHook.enabled = undefined
})

describe('TestDataBrowser - toolbar', () => {
  it('renders the filter box with its placeholder', () => {
    renderBrowser()

    const filter = screen.getByTestId('testdata-filter')
    expect(within(filter).getByPlaceholderText('Filter files…')).toBeInTheDocument()
  })

  it('renders the Upload and New folder buttons', () => {
    renderBrowser()

    expect(screen.getByTestId('testdata-upload-button')).toBeEnabled()
    expect(screen.getByTestId('testdata-new-folder-button')).toBeEnabled()
  })

  it('keeps a hidden multi-file input the Upload button opens', async () => {
    const user = userEvent.setup()
    renderBrowser()
    const input = screen.getByTestId('testdata-upload-input')
    const click = vi.spyOn(input, 'click')

    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('multiple')

    await user.click(screen.getByTestId('testdata-upload-button'))

    expect(click).toHaveBeenCalledTimes(1)
  })

  it('keeps both actions live while a file is uploading, so more can be queued', () => {
    renderBrowser({ uploads: [inFlight('big.bin')] })

    expect(screen.getByTestId('testdata-upload-button')).toBeEnabled()
    expect(screen.getByTestId('testdata-new-folder-button')).toBeEnabled()
  })

  it('uploads the files chosen through the hidden input', () => {
    const handlers = renderBrowser()
    const input = screen.getByTestId('testdata-upload-input') as HTMLInputElement

    fireEvent.change(input, { target: { files: [file('fresh.txt')] } })

    expect(handlers.onUpload).toHaveBeenCalledWith('', [expect.any(File)], false)
    expect(input.value).toBe('')
  })

  it('shows the file count and total size', () => {
    renderBrowser()

    expect(screen.getByText('4 files - 120.4 KB')).toBeInTheDocument()
  })
})

describe('TestDataBrowser - unsaved test', () => {
  it('asks the user to save first and disables both actions', () => {
    renderBrowser({ testId: null, listing: EMPTY_LISTING })

    expect(screen.getByTestId('testdata-save-first')).toHaveTextContent(
      'Save the test first to add files.'
    )
    expect(screen.getByTestId('testdata-upload-button')).toBeDisabled()
    expect(screen.getByTestId('testdata-new-folder-button')).toBeDisabled()
    expect(screen.queryByTestId('testdata-row')).not.toBeInTheDocument()
  })

  it('shows no empty state beside the save-first line', () => {
    renderBrowser({ testId: null, listing: EMPTY_LISTING })

    expect(screen.queryByTestId('testdata-empty-state')).not.toBeInTheDocument()
  })
})

describe('TestDataBrowser - empty and filtered states', () => {
  it('shows the empty state copy', () => {
    renderBrowser({ listing: EMPTY_LISTING })

    const empty = screen.getByTestId('testdata-empty-state')
    expect(within(empty).getByText('No test data yet')).toBeInTheDocument()
    expect(
      within(empty).getByText(
        'Upload the files this test reads. Reference them as testdata:// paths where a block reads a file.'
      )
    ).toBeInTheDocument()
    expect(within(empty).getByRole('button', { name: 'Upload files' })).toBeInTheDocument()
  })

  it('opens the file input from the empty state button', async () => {
    const user = userEvent.setup()
    renderBrowser({ listing: EMPTY_LISTING })
    const click = vi.spyOn(screen.getByTestId('testdata-upload-input'), 'click')

    await user.click(screen.getByRole('button', { name: 'Upload files' }))

    expect(click).toHaveBeenCalledTimes(1)
  })

  it('shows only matching entries and their ancestors while filtering', async () => {
    const user = userEvent.setup()
    renderBrowser()

    await user.type(screen.getByPlaceholderText('Filter files…'), 'users')

    expect(screen.getByText('users.csv')).toBeInTheDocument()
    expect(screen.getByText('fixtures')).toBeInTheDocument()
    expect(screen.queryByText('schema.xsd')).not.toBeInTheDocument()
  })

  it('says No matches when the filter matches nothing', async () => {
    const user = userEvent.setup()
    renderBrowser()

    await user.type(screen.getByPlaceholderText('Filter files…'), 'nothing-here')

    expect(screen.getByText('No matches')).toBeInTheDocument()
    expect(screen.queryByTestId('testdata-row')).not.toBeInTheDocument()
  })
})

describe('TestDataBrowser - tree layout', () => {
  it('starts the tree directly under the filter row, with no section headers', () => {
    renderBrowser()

    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('renders one row per entry', () => {
    renderBrowser()

    expect(screen.getAllByTestId('testdata-row')).toHaveLength(LISTING.entries.length)
  })
})

describe('TestDataBrowser - selection', () => {
  it('marks the clicked folder as selected', async () => {
    const user = userEvent.setup()
    renderBrowser()

    await user.click(screen.getByText('fixtures'))

    expect(row('fixtures')).toHaveAttribute('data-selected', 'true')
    expect(row('payloads')).not.toHaveAttribute('data-selected', 'true')
  })

  it('uploads into the selected folder', async () => {
    const user = userEvent.setup()
    const handlers = renderBrowser()
    await user.click(screen.getByText('payloads'))

    act(() => dropHook.onFiles?.([file('fresh.txt')]))

    expect(handlers.onUpload).toHaveBeenCalledWith('payloads', [expect.any(File)], false)
  })

  it('uploads into the root when nothing is selected', () => {
    const handlers = renderBrowser()

    act(() => dropHook.onFiles?.([file('fresh.txt')]))

    expect(handlers.onUpload).toHaveBeenCalledWith('', [expect.any(File)], false)
  })

  it('creates a new folder inside the selected folder', async () => {
    const user = userEvent.setup()
    const handlers = renderBrowser()
    await user.click(screen.getByText('fixtures'))

    await user.click(screen.getByTestId('testdata-new-folder-button'))
    await user.type(screen.getByTestId('testdata-name-input'), 'nested')
    await user.click(screen.getByTestId('edit-dialog-save'))

    expect(handlers.onCreateFolder).toHaveBeenCalledWith('fixtures/nested')
  })

  it('creates a new folder at the root when nothing is selected', async () => {
    const user = userEvent.setup()
    const handlers = renderBrowser()

    await user.click(screen.getByTestId('testdata-new-folder-button'))
    await user.type(screen.getByTestId('testdata-name-input'), 'scratch')
    await user.click(screen.getByTestId('edit-dialog-save'))

    expect(handlers.onCreateFolder).toHaveBeenCalledWith('scratch')
  })

  it('marks the clicked file as selected', async () => {
    const user = userEvent.setup()
    renderBrowser()

    await user.click(screen.getByText('users.csv'))

    expect(row('users.csv')).toHaveAttribute('data-selected', 'true')
  })

  it('clears the selection when the selected row is clicked again', async () => {
    const user = userEvent.setup()
    renderBrowser()
    await user.click(screen.getByText('fixtures'))

    await user.click(screen.getByText('fixtures'))

    expect(row('fixtures')).not.toHaveAttribute('data-selected', 'true')
  })

  it('uploads into the folder holding the selected file', async () => {
    const user = userEvent.setup()
    const handlers = renderBrowser()
    await user.click(screen.getByText('users.csv'))

    act(() => dropHook.onFiles?.([file('fresh.txt')]))

    expect(handlers.onUpload).toHaveBeenCalledWith('fixtures', [expect.any(File)], false)
  })

  it('creates a new folder beside the selected file', async () => {
    const user = userEvent.setup()
    const handlers = renderBrowser()
    await user.click(screen.getByText('big.bin'))

    await user.click(screen.getByTestId('testdata-new-folder-button'))
    await user.type(screen.getByTestId('testdata-name-input'), 'nested')
    await user.click(screen.getByTestId('edit-dialog-save'))

    expect(handlers.onCreateFolder).toHaveBeenCalledWith('payloads/nested')
  })

  it('reaches the root again once the selection is cleared', async () => {
    const user = userEvent.setup()
    const handlers = renderBrowser()
    await user.click(screen.getByText('fixtures'))
    await user.click(screen.getByText('fixtures'))

    act(() => dropHook.onFiles?.([file('fresh.txt')]))

    expect(handlers.onUpload).toHaveBeenCalledWith('', [expect.any(File)], false)
  })

  it('falls back to the root when the selected folder is deleted under it', async () => {
    const user = userEvent.setup()
    const onUpload = vi.fn()
    const props = {
      testId: TEST_ID,
      mode: 'manage' as const,
      onUpload,
      onCreateFolder: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
    }
    const { rerender } = render(<TestDataBrowser {...props} listing={LISTING} />)
    await user.click(screen.getByText('payloads'))

    const remaining = {
      ...LISTING,
      entries: LISTING.entries.filter((entry) => !entry.path.startsWith('payloads')),
    }
    rerender(<TestDataBrowser {...props} listing={remaining} />)
    act(() => dropHook.onFiles?.([file('fresh.txt')]))

    expect(onUpload).toHaveBeenCalledWith('', [expect.any(File)], false)
  })

  it('names the destination in the New folder dialog', async () => {
    const user = userEvent.setup()
    renderBrowser()
    await user.click(screen.getByText('payloads'))

    await user.click(screen.getByTestId('testdata-new-folder-button'))

    expect(screen.getByText('New folder in payloads')).toBeInTheDocument()
  })

  it('says the root in the New folder dialog when nothing is selected', async () => {
    const user = userEvent.setup()
    renderBrowser()

    await user.click(screen.getByTestId('testdata-new-folder-button'))

    expect(screen.getByText('New folder in the root')).toBeInTheDocument()
  })
})

describe('TestDataBrowser - uploads in flight', () => {
  it('shows a row for every file being uploaded', () => {
    renderBrowser({ uploads: [inFlight('big.bin'), inFlight('huge.bin')] })

    expect(screen.getByTestId('testdata-upload-big.bin')).toBeInTheDocument()
    expect(screen.getByTestId('testdata-upload-huge.bin')).toBeInTheDocument()
  })

  it('shows no upload rows when nothing is in flight', () => {
    renderBrowser()

    expect(document.querySelector('[data-upload-row]')).toBeNull()
  })

  it('puts the row inside the tree, not above it (TDATA-14)', () => {
    renderBrowser({ uploads: [inFlight('big.bin')] })

    const tree = screen.getByRole('tree')
    expect(tree).toContainElement(screen.getByTestId('testdata-upload-big.bin'))
  })

  it('keeps the tree on screen for the first file a test ever gets', () => {
    renderBrowser({ listing: EMPTY_LISTING, uploads: [inFlight('big.bin')] })

    expect(screen.queryByTestId('testdata-empty-state')).not.toBeInTheDocument()
    expect(screen.getByTestId('testdata-upload-big.bin')).toBeInTheDocument()
  })

  it('keeps the tree on screen when the filter matches nothing but a file is arriving', () => {
    renderBrowser({ uploads: [inFlight('big.bin')] })

    fireEvent.change(screen.getByPlaceholderText('Filter files…'), { target: { value: 'zzz' } })

    expect(screen.queryByText('No matches')).not.toBeInTheDocument()
    expect(screen.getByTestId('testdata-upload-big.bin')).toBeInTheDocument()
  })
})

describe('TestDataBrowser - drag and drop', () => {
  it('renders the drop zone', () => {
    renderBrowser()

    expect(screen.getByTestId('testdata-dropzone')).toBeInTheDocument()
  })

  it('drops every file of the gesture in one upload', () => {
    const handlers = renderBrowser()

    act(() => dropHook.onFiles?.([file('a.txt'), file('b.txt')]))

    expect(handlers.onUpload).toHaveBeenCalledTimes(1)
    expect(handlers.onUpload.mock.calls[0][1]).toHaveLength(2)
  })

  it('targets the folder row the pointer is over', () => {
    const handlers = renderBrowser()

    fireEvent.dragOver(row('payloads'))
    act(() => dropHook.onFiles?.([file('a.txt')]))

    expect(handlers.onUpload).toHaveBeenCalledWith('payloads', [expect.any(File)], false)
  })

  it('stops accepting drops for an unsaved test', () => {
    renderBrowser({ testId: null, listing: EMPTY_LISTING })

    expect(dropHook.enabled).toBe(false)
  })
})

describe('TestDataBrowser - upload conflicts', () => {
  it('sends the upload straight through when no name collides', () => {
    const handlers = renderBrowser()

    act(() => dropHook.onFiles?.([file('fresh.txt')]))

    expect(handlers.onUpload).toHaveBeenCalledWith('', [expect.any(File)], false)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('asks once before any request when the listing already holds a name', async () => {
    const user = userEvent.setup()
    const handlers = renderBrowser()
    await user.click(screen.getByText('fixtures'))

    act(() => dropHook.onFiles?.([file('users.csv'), file('orders.json'), file('fresh.txt')]))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/users\.csv/)).toBeInTheDocument()
    expect(within(dialog).getByText(/orders\.json/)).toBeInTheDocument()
    expect(handlers.onUpload).not.toHaveBeenCalled()
  })

  it('sends one request with replace when the user replaces all', async () => {
    const user = userEvent.setup()
    const handlers = renderBrowser()
    await user.click(screen.getByText('fixtures'))
    act(() => dropHook.onFiles?.([file('users.csv'), file('fresh.txt')]))
    await screen.findByRole('alertdialog')

    await user.click(screen.getByRole('button', { name: 'Replace all' }))

    expect(handlers.onUpload).toHaveBeenCalledTimes(1)
    expect(handlers.onUpload).toHaveBeenCalledWith(
      'fixtures',
      [expect.any(File), expect.any(File)],
      true
    )
  })

  it('sends nothing when the user cancels', async () => {
    const user = userEvent.setup()
    const handlers = renderBrowser()
    await user.click(screen.getByText('fixtures'))
    act(() => dropHook.onFiles?.([file('users.csv')]))
    await screen.findByRole('alertdialog')

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(handlers.onUpload).not.toHaveBeenCalled()
  })

  it('only counts collisions inside the target folder', () => {
    const handlers = renderBrowser()

    act(() => dropHook.onFiles?.([file('users.csv')]))

    expect(handlers.onUpload).toHaveBeenCalledWith('', [expect.any(File)], false)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('TestDataBrowser - row actions', () => {
  it('offers Rename and Delete on a file, and nothing else', async () => {
    const user = userEvent.setup()
    renderBrowser()

    await openKebab(user, 'users.csv')

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Rename',
      'Delete',
    ])
  })

  it('offers Rename and Delete on a folder, and nothing else', async () => {
    const user = userEvent.setup()
    renderBrowser()

    await openKebab(user, 'payloads')

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Rename',
      'Delete',
    ])
  })

  it('confirms a delete before reporting it', async () => {
    const user = userEvent.setup()
    const handlers = renderBrowser()
    await openKebab(user, 'users.csv')

    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(handlers.onDelete).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(handlers.onDelete).toHaveBeenCalledWith('fixtures/users.csv')
  })

  it('renames through the name dialog, prefilled with the current name', async () => {
    const user = userEvent.setup()
    const handlers = renderBrowser()
    await openKebab(user, 'users.csv')

    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByTestId('testdata-name-input')
    expect(input).toHaveValue('users.csv')

    await user.clear(input)
    await user.type(input, 'people.csv')
    await user.click(screen.getByTestId('edit-dialog-save'))

    expect(handlers.onRename).toHaveBeenCalledWith('fixtures/users.csv', 'people.csv')
  })

  it('downloads a file through the client', async () => {
    const user = userEvent.setup()
    renderBrowser()

    await user.click(screen.getByRole('button', { name: 'Download users.csv' }))

    expect(testdataApi.download).toHaveBeenCalledWith(TEST_ID, 'fixtures/users.csv')
  })

  it('downloads a folder as an archive', async () => {
    const user = userEvent.setup()
    renderBrowser()

    await user.click(screen.getByRole('button', { name: 'Download payloads' }))

    expect(testdataApi.downloadZip).toHaveBeenCalledWith(TEST_ID, 'payloads')
  })
})

describe('TestDataBrowser - refused actions', () => {
  it('shows the server message above the tree', () => {
    renderBrowser({ blockedReason: RUNNING_MESSAGE })

    expect(screen.getByTestId('testdata-blocked')).toHaveTextContent(RUNNING_MESSAGE)
  })

  it('does not retry the action the server refused', () => {
    const handlers = renderBrowser({ blockedReason: RUNNING_MESSAGE })

    expect(handlers.onUpload).not.toHaveBeenCalled()
    expect(handlers.onCreateFolder).not.toHaveBeenCalled()
  })

  it('shows a failure the action owner did not report', async () => {
    const user = userEvent.setup()
    vi.mocked(testdataApi.download).mockRejectedValue(new Error('Network unreachable'))
    renderBrowser()

    await user.click(screen.getByRole('button', { name: 'Download users.csv' }))

    expect(await screen.findByTestId('testdata-action-failed')).toHaveTextContent(
      'Network unreachable'
    )
  })

  it('shows nothing when no action was refused', () => {
    renderBrowser()

    expect(screen.queryByTestId('testdata-blocked')).not.toBeInTheDocument()
  })
})

describe('TestDataBrowser - read only', () => {
  it('says why the files cannot be changed', () => {
    renderBrowser({ readOnly: true })

    expect(screen.getByTestId('testdata-read-only')).toHaveTextContent(
      'Only the session holding this test can change its files.'
    )
    expect(screen.getByTestId('testdata-browser')).toHaveAttribute('data-read-only', 'true')
  })

  it('says nothing of the kind for the session holding the test', () => {
    renderBrowser()

    expect(screen.queryByTestId('testdata-read-only')).not.toBeInTheDocument()
    expect(screen.getByTestId('testdata-browser')).not.toHaveAttribute('data-read-only')
  })

  it('carries no toolbar and no file input', () => {
    renderBrowser({ readOnly: true })

    expect(screen.queryByTestId('testdata-upload-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('testdata-new-folder-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('testdata-upload-input')).not.toBeInTheDocument()
  })

  it('accepts no dropped files', () => {
    renderBrowser({ readOnly: true })

    expect(dropHook.enabled).toBe(false)
  })

  it('carries no row kebab, and keeps Copy path and Download', () => {
    renderBrowser({ readOnly: true })

    expect(screen.queryByRole('button', { name: /^More actions for/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy path of users.csv' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download users.csv' })).toBeInTheDocument()
  })

  it('still lists the files and their total', () => {
    renderBrowser({ readOnly: true })

    expect(screen.getAllByTestId('testdata-row')).toHaveLength(LISTING.entries.length)
    expect(screen.getByText('4 files - 120.4 KB')).toBeInTheDocument()
  })

  it('drops the Upload files button from the empty state', () => {
    renderBrowser({ readOnly: true, listing: EMPTY_LISTING })

    const empty = screen.getByTestId('testdata-empty-state')
    expect(within(empty).getByText('No test data yet')).toBeInTheDocument()
    expect(
      within(empty).getByText("Blocks read this test's files as testdata:// paths.")
    ).toBeInTheDocument()
    expect(within(empty).queryByRole('button', { name: 'Upload files' })).not.toBeInTheDocument()
  })
})

describe('TestDataBrowser - pick mode', () => {
  it('selects a file the user clicks', async () => {
    const user = userEvent.setup()
    const handlers = renderBrowser({ mode: 'pick', selectable: 'file' })

    await user.click(screen.getByText('users.csv'))

    expect(handlers.onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'fixtures/users.csv' })
    )
  })

  it('marks the selected path', () => {
    renderBrowser({ mode: 'pick', selectable: 'file', selectedPath: 'fixtures/users.csv' })

    expect(row('users.csv')).toHaveAttribute('data-selected', 'true')
    expect(screen.getAllByTestId('testdata-row').filter(
      (element) => element.getAttribute('data-selected') === 'true'
    )).toHaveLength(1)
  })

  it('mutes files in folder mode and refuses to select them', async () => {
    const user = userEvent.setup()
    const handlers = renderBrowser({ mode: 'pick', selectable: 'folder' })

    const muted = row('users.csv').querySelector('[data-testid="file-row"]')
    expect(muted).toHaveAttribute('data-muted', 'true')
    expect(muted).toHaveAttribute('aria-disabled', 'true')

    await user.click(screen.getByText('users.csv'))

    expect(handlers.onSelect).not.toHaveBeenCalled()
  })

  it('selects folders in folder mode', async () => {
    const user = userEvent.setup()
    const handlers = renderBrowser({ mode: 'pick', selectable: 'folder' })

    await user.click(screen.getByText('payloads'))

    expect(handlers.onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'payloads' })
    )
  })

  it('selects files and folders in file-or-folder mode', async () => {
    const user = userEvent.setup()
    const handlers = renderBrowser({ mode: 'pick', selectable: 'file-or-folder' })

    await user.click(screen.getByText('users.csv'))
    await user.click(screen.getByText('payloads'))

    expect(handlers.onSelect).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[data-muted="true"]')).toBeNull()
  })

  it('chooses the row the user double clicks', async () => {
    const user = userEvent.setup()
    const handlers = renderBrowser({ mode: 'pick', selectable: 'file' })

    await user.dblClick(screen.getByText('users.csv'))

    expect(handlers.onChoose).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'fixtures/users.csv' })
    )
  })

  it('carries no row kebab', () => {
    renderBrowser({ mode: 'pick', selectable: 'file' })

    expect(screen.queryByRole('button', { name: /^More actions for/ })).not.toBeInTheDocument()
  })

  it('mutes nothing in manage mode', () => {
    renderBrowser()

    expect(document.querySelector('[data-muted="true"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'More actions for users.csv' })).toBeInTheDocument()
  })
})
