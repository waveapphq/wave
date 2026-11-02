/**
 * SuiteDetailPage Navigation Tests
 *
 * Verifies that opening a test from the suite-detail page propagates
 * origin context into the workbench URL so the breadcrumb can
 * reconstruct the suite-origin path (and forward regressionId when
 * the user arrived from a regression).
 *
 * Contract:
 *   - From /suites/<suiteId> (no regressionId): navigate to
 *     /workbench?editTest=<testId>&suiteId=<suiteId>
 *   - From /suites/<suiteId>?regressionId=<regId>: navigate to
 *     /workbench?editTest=<testId>&suiteId=<suiteId>&regressionId=<regId>
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/toast'
import type { SuiteDetail, SuiteTestEntry } from '@/features/suites/api/types'

vi.mock('@/features/suites/api/crud', () => ({
  fetchSuiteDetail: vi.fn(),
  fetchSuitesTags: vi.fn(),
  fetchSuiteTests: vi.fn().mockResolvedValue([]),
  updateSuite: vi.fn(),
  deleteSuite: vi.fn(),
}))

vi.mock('@/features/tests/api/crud', () => ({
  fetchTests: vi.fn(),
  fetchTestsTags: vi.fn(),
  transformApiTest: vi.fn(),
}))

vi.mock('@/hooks/use-environments', () => ({
  useEnvironments: () => ({
    environments: [{ id: 'env-1', name: 'Development' }],
    loading: false,
    error: null,
  }),
}))

vi.mock('@/features/executions/api/executions', () => ({
  startExecution: vi.fn(),
}))

vi.mock('@/features/regressions/api/crud', () => ({
  fetchRegressionDetail: vi
    .fn()
    .mockResolvedValue({ regression: { id: 'reg-9', name: 'Nightly' } }),
}))

import { SuiteDetailPage } from '@/features/suites/container/suite-detail-page'
import { fetchSuiteDetail, fetchSuitesTags } from '@/features/suites/api/crud'

const mockFetchSuiteDetail = vi.mocked(fetchSuiteDetail)
const mockFetchSuitesTags = vi.mocked(fetchSuitesTags)

const mockSuite: SuiteDetail = {
  id: 'suite-1',
  name: 'Test Suite',
  description: 'A description',
  version: '1.0.0',
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-02T00:00:00Z',
  testIds: ['t1'],
  testsCount: 1,
  status: 'passed',
  lastRun: '2026-03-02T12:00:00Z',
  tags: ['smoke'],
  variables: {},
}

const mockTests: SuiteTestEntry[] = [
  {
    id: 't1',
    name: 'Login Test',
    status: 'passed',
    lastRun: '2026-03-02T12:00:00Z',
    tags: ['smoke'],
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-02T00:00:00Z',
  },
]

function LocationProbe() {
  const location = useLocation()
  return (
    <div
      data-testid="workbench-location"
      data-pathname={location.pathname}
      data-search={location.search}
    />
  )
}

function renderWithRoute(initialEntry: string) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/suites/:suiteId" element={<SuiteDetailPage />} />
          <Route path="/workbench" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}

async function clickEditOnTest(name: string) {
  const user = userEvent.setup()
  const row = await screen.findByText(name)
  await user.click(row)
}

describe('SuiteDetailPage navigation - handleEditTest', () => {
  beforeEach(() => {
    mockFetchSuiteDetail.mockResolvedValue({ suite: mockSuite, tests: mockTests })
    mockFetchSuitesTags.mockResolvedValue(['smoke'])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('appends suiteId when opening a test from /suites/<id> (no regressionId in URL)', async () => {
    renderWithRoute('/suites/suite-1')
    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    await clickEditOnTest('Login Test')
    const probe = await screen.findByTestId('workbench-location')
    expect(probe.getAttribute('data-pathname')).toBe('/workbench')
    const search = probe.getAttribute('data-search') ?? ''
    expect(search).toContain('editTest=t1')
    expect(search).toContain('suiteId=suite-1')
    expect(search).not.toContain('regressionId=')
  })

  it('forwards regressionId from the URL when present', async () => {
    renderWithRoute('/suites/suite-1?regressionId=reg-9')
    await waitFor(() => {
      expect(screen.getByText('Login Test')).toBeInTheDocument()
    })
    await clickEditOnTest('Login Test')
    const probe = await screen.findByTestId('workbench-location')
    expect(probe.getAttribute('data-pathname')).toBe('/workbench')
    const search = probe.getAttribute('data-search') ?? ''
    expect(search).toContain('editTest=t1')
    expect(search).toContain('suiteId=suite-1')
    expect(search).toContain('regressionId=reg-9')
  })
})
