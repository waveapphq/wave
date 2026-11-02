/**
 * TestDataSheet - the floating workbench sheet holding a test's own files.
 *
 * Module: frontend/src/features/workbench/live/testdata-sheet.tsx
 *
 * Mirrors the Session Artifacts sheet: the shared DraggableSheet shell, ESC
 * closes, the listing loads through the blocking-read model. The header holds
 * the two write actions as text buttons and Refresh and Close as icon buttons;
 * the footer pins the reference note. A test that was never saved has no
 * folder yet, so the sheet says so and both write actions are dead.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import type { TestDataListing } from '@/features/tests/api/types'

const EMPTY_LISTING: TestDataListing = { entries: [], total_files: 0, total_bytes: 0 }

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

const testData = vi.hoisted(() => ({
  useTestData: vi.fn(),
  state: {
    listing: { entries: [], total_files: 0, total_bytes: 0 },
    loading: false,
    error: null,
    blockedReason: null,
    uploads: [],
    refresh: vi.fn(),
    upload: vi.fn(),
    createFolder: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  } as Record<string, unknown>,
}))

vi.mock('@/features/workbench/common/testdata/use-testdata', () => ({
  useTestData: testData.useTestData,
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

import { TestDataSheet } from '@/features/workbench/live/testdata-sheet'

const FOOTER_NOTE =
  'Reference a file as testdata://folder/name. Blocks read test data; they never change it.'

type SheetProps = ComponentProps<typeof TestDataSheet>

function renderSheet(props: Partial<SheetProps> = {}) {
  const onClose = vi.fn()
  render(<TestDataSheet open onClose={onClose} testId="test-42" {...props} />)
  return { onClose }
}

function header(): HTMLElement {
  return screen.getByTestId('testdata-sheet-drag-handle')
}

beforeEach(() => {
  vi.clearAllMocks()
  testData.state = {
    listing: LISTING,
    loading: false,
    error: null,
    blockedReason: null,
    uploads: [],
    refresh: vi.fn(),
    upload: vi.fn(),
    createFolder: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
  }
  testData.useTestData.mockImplementation(() => testData.state)
})

describe('TestDataSheet - shell', () => {
  it('renders nothing when closed', () => {
    renderSheet({ open: false })

    expect(screen.queryByTestId('testdata-sheet')).not.toBeInTheDocument()
  })

  it('renders the floating sheet with its accessible name and title', () => {
    renderSheet()

    const sheet = screen.getByTestId('testdata-sheet')
    expect(sheet).toHaveAttribute('aria-label', 'Test Data')
    expect(within(header()).getByText('Test Data')).toBeInTheDocument()
  })

  it('reads the listing for the session test', () => {
    renderSheet({ testId: 'test-99' })

    expect(testData.useTestData).toHaveBeenCalledWith('test-99', true)
  })

  it('reads but never writes for a session that does not hold the test (TDATA-13)', () => {
    renderSheet({ testId: 'test-99', readOnly: true })

    expect(testData.useTestData).toHaveBeenCalledWith('test-99', false)
    expect(screen.getByTestId('testdata-browser')).toHaveAttribute('data-read-only', 'true')
  })

  it('closes on Escape', () => {
    const { onClose } = renderSheet()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes from the header close button', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet()

    await user.click(within(header()).getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('re-reads from the header refresh button', async () => {
    const user = userEvent.setup()
    renderSheet()

    await user.click(within(header()).getByRole('button', { name: /refresh/i }))

    expect(testData.state.refresh).toHaveBeenCalledTimes(1)
  })

  it('puts Refresh before Close in the header', () => {
    renderSheet()

    const refresh = within(header()).getByRole('button', { name: /refresh/i })
    const close = within(header()).getByRole('button', { name: 'Close' })

    expect(refresh.compareDocumentPosition(close)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
})

describe('TestDataSheet - write actions', () => {
  it('offers Upload and New folder as text buttons with a leading icon', () => {
    renderSheet()

    const upload = screen.getByTestId('testdata-upload-button')
    const newFolder = screen.getByTestId('testdata-new-folder-button')

    expect(upload).toHaveTextContent('Upload')
    expect(newFolder).toHaveTextContent('New folder')
    expect(upload.querySelector('svg')).not.toBeNull()
    expect(newFolder.querySelector('svg')).not.toBeNull()
  })

  it('both are live for a saved test', () => {
    renderSheet()

    expect(screen.getByTestId('testdata-upload-button')).toBeEnabled()
    expect(screen.getByTestId('testdata-new-folder-button')).toBeEnabled()
  })
})

describe('TestDataSheet - populated state', () => {
  it('shows the filter row with the file count and total size', () => {
    renderSheet()

    expect(screen.getByPlaceholderText('Filter files…')).toBeInTheDocument()
    expect(screen.getByText('4 files - 120.4 KB')).toBeInTheDocument()
  })

  it('lists the test data rows', () => {
    renderSheet()

    expect(screen.getByText('fixtures')).toBeInTheDocument()
    expect(screen.getByText('users.csv')).toBeInTheDocument()
    expect(screen.getByText('schema.xsd')).toBeInTheDocument()
  })

  it('pins the reference note in the footer', () => {
    renderSheet()

    expect(screen.getByText(FOOTER_NOTE)).toBeInTheDocument()
  })
})

describe('TestDataSheet - empty state', () => {
  it('explains what test data is for and offers the upload', () => {
    testData.state.listing = EMPTY_LISTING
    renderSheet()

    const empty = screen.getByTestId('testdata-empty-state')
    expect(within(empty).getByText('No test data yet')).toBeInTheDocument()
    expect(
      within(empty).getByText(
        'Upload the files this test reads. Reference them as testdata:// paths where a block reads a file.'
      )
    ).toBeInTheDocument()
    expect(within(empty).getByRole('button', { name: 'Upload files' })).toBeInTheDocument()
  })
})

describe('TestDataSheet - unsaved test', () => {
  it('asks the user to save the test first', () => {
    testData.state.listing = EMPTY_LISTING
    renderSheet({ testId: null })

    expect(screen.getByTestId('testdata-save-first')).toHaveTextContent(
      'Save the test first to add files.'
    )
  })

  it('disables both write actions and shows no tree', () => {
    testData.state.listing = EMPTY_LISTING
    renderSheet({ testId: null })

    expect(screen.getByTestId('testdata-upload-button')).toBeDisabled()
    expect(screen.getByTestId('testdata-new-folder-button')).toBeDisabled()
    expect(screen.queryByTestId('testdata-row')).not.toBeInTheDocument()
    expect(screen.queryByText(FOOTER_NOTE)).not.toBeInTheDocument()
  })
})

describe('TestDataSheet - loading and failed reads', () => {
  it('shows neither rows nor the empty state while the listing loads', () => {
    testData.state.listing = EMPTY_LISTING
    testData.state.loading = true
    renderSheet()

    expect(screen.queryByTestId('testdata-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('testdata-empty-state')).not.toBeInTheDocument()
  })

  it('shows the reason the listing failed instead of a tree', () => {
    testData.state.listing = EMPTY_LISTING
    testData.state.error = { message: 'Test not found: test-42', status: 404 }
    renderSheet()

    expect(screen.getByText('Test not found: test-42')).toBeInTheDocument()
    expect(screen.queryByTestId('testdata-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('testdata-empty-state')).not.toBeInTheDocument()
  })

  it('shows a refused write inline above the tree', () => {
    testData.state.blockedReason =
      "Test 'Login' is running; test data cannot be changed until it finishes"
    renderSheet()

    expect(screen.getByTestId('testdata-blocked')).toHaveTextContent(
      "Test 'Login' is running; test data cannot be changed until it finishes"
    )
  })
})
