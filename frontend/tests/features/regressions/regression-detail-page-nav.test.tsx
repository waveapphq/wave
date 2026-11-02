/**
 * RegressionDetailPage Navigation Tests
 *
 * Verifies that opening a suite from the regression-detail page propagates
 * the regression context as a query param so the downstream
 * suite-detail-page can forward it to /workbench, which lets the canvas
 * breadcrumb reconstruct the full Regression > Suite > Test path.
 *
 * Contract:
 *   - From /regressions/<regressionId>: navigate to
 *     /suites/<suiteId>?regressionId=<regressionId>
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { ToastProvider } from '@/components/ui/toast'
import type { RegressionDetail, RegressionSuiteEntry } from '@/features/regressions/api/types'

vi.mock('@/features/regressions/api/crud', () => ({
  fetchRegressionDetail: vi.fn(),
  fetchRegressionsTags: vi.fn(),
  updateRegression: vi.fn(),
  deleteRegression: vi.fn(),
}))

vi.mock('@/features/suites/api/crud', () => ({
  fetchSuites: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, perPage: 25 }),
  fetchSuitesTags: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/features/regressions/api/export-import', () => ({
  exportRegression: vi.fn(),
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

vi.mock('@/features/regressions/api/regressions', () => ({
  fetchRegressionSuitesWithTests: vi.fn().mockResolvedValue([]),
}))

import { RegressionDetailPage } from '@/features/regressions/container/regression-detail-page'
import { fetchRegressionDetail, fetchRegressionsTags } from '@/features/regressions/api/crud'

const mockFetchRegressionDetail = vi.mocked(fetchRegressionDetail)
const mockFetchRegressionsTags = vi.mocked(fetchRegressionsTags)

const mockRegression: RegressionDetail = {
  id: 'reg-1',
  name: 'Smoke - Prod',
  description: 'Smoke tests',
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-15T12:00:00Z',
  suiteIds: ['suite-1'],
  suitesCount: 1,
  testsCount: 1,
  status: 'passed',
  lastRun: '2026-03-15T12:00:00Z',
  tags: ['smoke'],
  variables: {},
}

const mockSuites: RegressionSuiteEntry[] = [
  {
    id: 'suite-1',
    name: 'Auth Suite',
    description: 'Authentication tests',
    status: 'passed',
    lastRun: '2026-03-15T12:00:00Z',
    tags: ['auth'],
    testsCount: 5,
    avgDuration: 1,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-15T12:00:00Z',
  },
]

function LocationProbe() {
  const location = useLocation()
  const params = useParams()
  return (
    <div
      data-testid="suite-detail-location"
      data-pathname={location.pathname}
      data-search={location.search}
      data-suite-id={params.suiteId ?? ''}
    />
  )
}

function renderWithRoute() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/regressions/reg-1']}>
        <Routes>
          <Route path="/regressions/:regressionId" element={<RegressionDetailPage />} />
          <Route path="/suites/:suiteId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}

describe('RegressionDetailPage navigation - handleEditSuite', () => {
  beforeEach(() => {
    mockFetchRegressionDetail.mockResolvedValue({ regression: mockRegression, suites: mockSuites })
    mockFetchRegressionsTags.mockResolvedValue(['smoke'])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('appends regressionId as a query param when navigating to a suite', async () => {
    const user = userEvent.setup()
    renderWithRoute()
    await waitFor(() => {
      expect(screen.getByText('Auth Suite')).toBeInTheDocument()
    })
    await user.click(screen.getByText('Auth Suite'))
    const probe = await screen.findByTestId('suite-detail-location')
    expect(probe.getAttribute('data-pathname')).toBe('/suites/suite-1')
    expect(probe.getAttribute('data-suite-id')).toBe('suite-1')
    const search = probe.getAttribute('data-search') ?? ''
    expect(search).toContain('regressionId=reg-1')
  })
})
