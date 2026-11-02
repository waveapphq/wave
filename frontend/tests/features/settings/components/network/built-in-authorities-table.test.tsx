// REQ-4.5.16 Built-in Authorities table (NET-5)
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { CertificateRow } from '@/features/settings/api/certificates'
import { BuiltInAuthoritiesTable } from '@/features/settings/components/network/built-in-authorities-table'

let nextId = 0
function authority(name: string, organization: string, expires: string): CertificateRow {
  nextId += 1
  return { id: `${'ab'.repeat(31)}${String(nextId).padStart(2, '0')}`, name, organization, type: 'Root', expires }
}

const ISRG = authority('ISRG Root X1', 'Internet Security Research Group', '2035-06-04')
const AMAZON = authority('Amazon Root CA 1', 'Amazon', '2038-01-17')

// Deliberately unsorted; 12 rows so a second page exists.
const AUTHORITIES: CertificateRow[] = [
  authority('USERTrust RSA Certification Authority', 'The USERTRUST Network', '2038-01-18'),
  ISRG,
  authority('Certum Trusted Network CA', 'Unizeto Technologies S.A.', '2029-12-31'),
  AMAZON,
  authority('GTS Root R1', 'Google Trust Services LLC', '2036-06-22'),
  authority('DigiCert Global Root G2', 'DigiCert Inc', '2038-01-15'),
  authority('QuoVadis Root CA 2 G3', 'QuoVadis Limited', '2042-01-12'),
  authority('GlobalSign Root CA - R3', 'GlobalSign', '2029-03-18'),
  authority('SSL.com Root Certification Authority RSA', 'SSL Corporation', '2041-02-12'),
  authority('Microsoft RSA Root Certificate Authority 2017', 'Microsoft Corporation', '2042-07-18'),
  authority('Baltimore CyberTrust Root', 'Baltimore', '2025-05-12'),
  authority('Entrust Root Certification Authority - G2', 'Entrust, Inc.', '2030-12-07'),
]

function renderTable(props: { certificates?: CertificateRow[]; loading?: boolean } = {}) {
  const onView = vi.fn()
  render(
    <BuiltInAuthoritiesTable
      certificates={props.certificates ?? AUTHORITIES}
      loading={props.loading ?? false}
      onView={onView}
    />,
  )
  return { onView }
}

function firstCellTexts() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent)
}

describe('BuiltInAuthoritiesTable', () => {
  describe('Columns', () => {
    it('shows the Name, Organization and Expires columns', () => {
      renderTable()
      expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'Organization' })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'Expires' })).toBeInTheDocument()
      expect(screen.queryByRole('columnheader', { name: 'Type' })).not.toBeInTheDocument()
    })

    it('shows each row name, organization and expiry date', () => {
      renderTable({ certificates: [ISRG] })
      const row = screen.getByText('ISRG Root X1').closest('tr') as HTMLElement
      expect(within(row).getByText('Internet Security Research Group')).toBeInTheDocument()
      expect(within(row).getByText('2035-06-04')).toBeInTheDocument()
    })

    it('keeps the name and the organization out of page translation', () => {
      renderTable({ certificates: [ISRG] })
      expect(screen.getByText('ISRG Root X1')).toHaveAttribute('translate', 'no')
      expect(screen.getByText('Internet Security Research Group')).toHaveAttribute('translate', 'no')
    })

    it('sorts by Name ascending by default', () => {
      renderTable({ certificates: [ISRG, AMAZON] })
      expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'ascending')
      expect(firstCellTexts()).toEqual(['Amazon Root CA 1', 'ISRG Root X1'])
    })
  })

  describe('Read-only', () => {
    it('has no selection checkboxes', () => {
      renderTable()
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    })

    it('has no trash buttons', () => {
      renderTable()
      expect(screen.queryAllByRole('button', { name: /^Remove / })).toHaveLength(0)
    })

    it('has no Mass Action and no Add button', () => {
      renderTable()
      expect(screen.queryByRole('button', { name: /Mass Action/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Add/ })).not.toBeInTheDocument()
    })
  })

  describe('View', () => {
    it('labels the eye button "View {name}" and calls onView with the row id', async () => {
      const user = userEvent.setup()
      const { onView } = renderTable()
      await user.click(screen.getByRole('button', { name: 'View Amazon Root CA 1' }))
      expect(onView).toHaveBeenCalledTimes(1)
      expect(onView).toHaveBeenCalledWith(AMAZON.id)
    })
  })

  describe('Search and pagination', () => {
    it('shows the "Search authorities…" search box', () => {
      renderTable()
      expect(screen.getByPlaceholderText('Search authorities…')).toBeInTheDocument()
    })

    it('filters rows by name', async () => {
      const user = userEvent.setup()
      renderTable({ certificates: [ISRG, AMAZON] })
      await user.type(screen.getByPlaceholderText('Search authorities…'), 'ISRG')
      await waitFor(() => {
        expect(screen.queryByText('Amazon Root CA 1')).not.toBeInTheDocument()
      })
      expect(screen.getByText('ISRG Root X1')).toBeInTheDocument()
    })

    it('shows 10 rows per page', () => {
      renderTable()
      expect(screen.getAllByRole('button', { name: /^View / })).toHaveLength(10)
      expect(screen.getByText('Showing 1-10 of 12 authorities')).toBeInTheDocument()
    })
  })

  describe('Loading', () => {
    it('shows skeleton rows and no data rows', () => {
      renderTable({ loading: true })
      expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0)
      expect(screen.queryByText('Amazon Root CA 1')).not.toBeInTheDocument()
    })
  })
})
