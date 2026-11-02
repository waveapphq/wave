// REQ-4.5.16 Additional Certificates table (NET-7)
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'

import type { CertificateDetail } from '@/features/settings/api/certificates'
import { AdditionalCertificatesTable } from '@/features/settings/components/network/additional-certificates-table'

type TableProps = ComponentProps<typeof AdditionalCertificatesTable>
type Row = TableProps['certificates'][number]

const LAB_PEM = '-----BEGIN CERTIFICATE-----\nMIIBLabTestCA\n-----END CERTIFICATE-----\n'

const ROOT: Row = {
  id: `${'c1'.repeat(32)}`,
  name: 'Corp Root CA 2031',
  organization: 'Corp',
  type: 'Root',
  expires: '2031-03-01',
}
const ISSUING: Row = {
  id: `${'c2'.repeat(32)}`,
  name: 'Corp Issuing CA 2',
  organization: 'Corp',
  type: 'Intermediate',
  expires: '2028-06-30',
}
const LAB_DETAIL: CertificateDetail = {
  id: `${'c3'.repeat(32)}`,
  name: 'Lab Test CA',
  subject: 'CN=Lab Test CA, O=Lab',
  issuer: 'CN=Lab Test CA, O=Lab',
  type: 'Root',
  path_length: null,
  valid_from: '2025-01-15 00:00:00 UTC',
  valid_to: '2027-01-15 00:00:00 UTC',
  status: 'valid',
  days_to_expiry: 470,
  sha256_fingerprint: 'AA:BB:CC:DD',
  serial_number: '01:02:03',
  key: 'EC P-256',
  signature_algorithm: 'ECDSA with SHA-256',
  key_usage: ['Certificate sign', 'CRL sign'],
  subject_key_id: null,
  authority_key_id: null,
  pem: LAB_PEM,
}
const STAGED_LAB: Row = {
  id: LAB_DETAIL.id,
  name: 'Lab Test CA',
  organization: 'Lab',
  type: 'Root',
  expires: '2027-01-15',
  staged: true,
  pem: LAB_PEM,
  detail: LAB_DETAIL,
}

const ROWS: Row[] = [STAGED_LAB, ROOT, ISSUING]

function renderTable(props: Partial<TableProps> = {}) {
  const handlers = { onAdd: vi.fn(), onView: vi.fn(), onRemove: vi.fn() }
  render(
    <AdditionalCertificatesTable
      certificates={ROWS}
      loading={false}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest('tr') as HTMLElement
}

function firstCellTexts() {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent)
}

describe('AdditionalCertificatesTable', () => {
  describe('Columns', () => {
    it('shows the Name, Type and Expires columns', () => {
      renderTable()
      expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument()
      expect(screen.getByRole('columnheader', { name: 'Expires' })).toBeInTheDocument()
      expect(screen.queryByRole('columnheader', { name: 'Organization' })).not.toBeInTheDocument()
    })

    it('shows each row name, type and expiry date', () => {
      renderTable()
      const row = rowOf('Corp Issuing CA 2')
      expect(within(row).getByText('Intermediate')).toBeInTheDocument()
      expect(within(row).getByText('2028-06-30')).toBeInTheDocument()
    })

    it('keeps the certificate name out of page translation', () => {
      renderTable()
      expect(screen.getByText('Corp Issuing CA 2')).toHaveAttribute('translate', 'no')
    })

    it('sorts by Name ascending by default', () => {
      renderTable()
      expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'ascending')
      expect(firstCellTexts()).toEqual(['Corp Issuing CA 2', 'Corp Root CA 2031', 'Lab Test CA'])
    })

    it('shows no selection checkboxes outside selection mode', () => {
      renderTable()
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    })
  })

  describe('Staged rows', () => {
    it('shows a staged row like a saved row, with eye and trash', () => {
      renderTable()
      const row = rowOf('Lab Test CA')
      expect(within(row).getByText('Root')).toBeInTheDocument()
      expect(within(row).getByText('2027-01-15')).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: 'View Lab Test CA' })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: 'Remove Lab Test CA' })).toBeInTheDocument()
    })

    it('adds no Unsaved marker to a staged row', () => {
      renderTable()
      expect(screen.queryByText('Unsaved')).not.toBeInTheDocument()
    })
  })

  describe('Row actions', () => {
    it('calls onView with the saved row object', async () => {
      const user = userEvent.setup()
      const { onView } = renderTable()
      await user.click(screen.getByRole('button', { name: 'View Corp Root CA 2031' }))
      expect(onView).toHaveBeenCalledTimes(1)
      expect(onView).toHaveBeenCalledWith(ROOT)
    })

    it('calls onView with the staged row object, carrying its detail', async () => {
      const user = userEvent.setup()
      const { onView } = renderTable()
      await user.click(screen.getByRole('button', { name: 'View Lab Test CA' }))
      expect(onView).toHaveBeenCalledWith(STAGED_LAB)
      expect(onView.mock.calls[0][0].detail).toEqual(LAB_DETAIL)
    })

    it('calls onRemove with the row id when the trash icon is clicked', async () => {
      const user = userEvent.setup()
      const { onRemove } = renderTable()
      await user.click(screen.getByRole('button', { name: 'Remove Corp Root CA 2031' }))
      expect(onRemove).toHaveBeenCalledTimes(1)
      expect(onRemove).toHaveBeenCalledWith([ROOT.id])
    })

    it('removes without a confirmation dialog', async () => {
      const user = userEvent.setup()
      renderTable()
      await user.click(screen.getByRole('button', { name: 'Remove Corp Issuing CA 2' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })

  describe('Mass Action', () => {
    it('enters selection mode with one checkbox per row', async () => {
      const user = userEvent.setup()
      renderTable()
      await user.click(screen.getByRole('button', { name: /Mass Action/ }))
      expect(screen.getByRole('checkbox', { name: 'Select Corp Root CA 2031' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Select Corp Issuing CA 2' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Select Lab Test CA' })).toBeInTheDocument()
    })

    it('offers Delete as the only menu item', async () => {
      const user = userEvent.setup()
      renderTable()
      await user.click(screen.getByRole('button', { name: /Mass Action/ }))
      await user.click(screen.getByRole('checkbox', { name: 'Select Corp Root CA 2031' }))
      await user.click(screen.getByRole('button', { name: '1 selected' }))
      const menu = await screen.findByRole('menu')
      expect(within(menu).getAllByRole('menuitem')).toHaveLength(1)
      expect(within(menu).getByRole('menuitem', { name: /Delete/ })).toBeInTheDocument()
      expect(within(menu).queryByRole('menuitem', { name: /Export/ })).not.toBeInTheDocument()
      expect(within(menu).queryByRole('menuitem', { name: /Duplicate/ })).not.toBeInTheDocument()
    })

    it('Delete calls onRemove with the selected ids and exits selection mode', async () => {
      const user = userEvent.setup()
      const { onRemove } = renderTable()
      await user.click(screen.getByRole('button', { name: /Mass Action/ }))
      await user.click(screen.getByRole('checkbox', { name: 'Select Corp Root CA 2031' }))
      await user.click(screen.getByRole('checkbox', { name: 'Select Lab Test CA' }))
      await user.click(screen.getByRole('button', { name: '2 selected' }))
      await user.click(await screen.findByRole('menuitem', { name: /Delete/ }))

      expect(onRemove).toHaveBeenCalledTimes(1)
      expect([...onRemove.mock.calls[0][0]].sort()).toEqual([ROOT.id, STAGED_LAB.id].sort())
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Mass Action/ })).toBeInTheDocument()
      })
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('starts with nothing selected after a Mass Action Delete', async () => {
      const user = userEvent.setup()
      renderTable()
      await user.click(screen.getByRole('button', { name: /Mass Action/ }))
      await user.click(screen.getByRole('checkbox', { name: 'Select Corp Root CA 2031' }))
      await user.click(screen.getByRole('button', { name: '1 selected' }))
      await user.click(await screen.findByRole('menuitem', { name: /Delete/ }))
      await user.click(await screen.findByRole('button', { name: /Mass Action/ }))
      expect(screen.getByRole('button', { name: '0 selected' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Select Corp Root CA 2031' })).not.toBeChecked()
    })

    it('exits selection mode with the X button', async () => {
      const user = userEvent.setup()
      const { onRemove } = renderTable()
      await user.click(screen.getByRole('button', { name: /Mass Action/ }))
      await user.click(screen.getByRole('button', { name: 'Exit selection mode' }))
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
      expect(onRemove).not.toHaveBeenCalled()
    })
  })

  describe('Add', () => {
    it('calls onAdd from the Add certificate button', async () => {
      const user = userEvent.setup()
      const { onAdd } = renderTable()
      await user.click(screen.getByRole('button', { name: 'Add certificate' }))
      expect(onAdd).toHaveBeenCalledTimes(1)
    })
  })

  describe('Empty', () => {
    it('reads "No additional certificates"', () => {
      renderTable({ certificates: [] })
      expect(screen.getByText('No additional certificates')).toBeInTheDocument()
    })

    it('offers Add certificate, and every Add certificate button calls onAdd', async () => {
      const user = userEvent.setup()
      const { onAdd } = renderTable({ certificates: [] })
      const buttons = screen.getAllByRole('button', { name: 'Add certificate' })
      expect(buttons.length).toBeGreaterThan(0)
      for (const button of buttons) {
        await user.click(button)
      }
      expect(onAdd).toHaveBeenCalledTimes(buttons.length)
    })
  })

  describe('Search and pagination', () => {
    it('shows the "Search certificates…" search box', () => {
      renderTable()
      expect(screen.getByPlaceholderText('Search certificates…')).toBeInTheDocument()
    })

    it('filters rows by name', async () => {
      const user = userEvent.setup()
      renderTable()
      await user.type(screen.getByPlaceholderText('Search certificates…'), 'Lab')
      await waitFor(() => {
        expect(screen.queryByText('Corp Root CA 2031')).not.toBeInTheDocument()
      })
      expect(screen.queryByText('Corp Issuing CA 2')).not.toBeInTheDocument()
      expect(screen.getByText('Lab Test CA')).toBeInTheDocument()
    })

    it('counts the rows as certificates', () => {
      renderTable()
      expect(screen.getByText('Showing 1-3 of 3 certificates')).toBeInTheDocument()
    })
  })

  describe('Loading', () => {
    it('shows skeleton rows and no data rows', () => {
      renderTable({ loading: true })
      expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0)
      expect(screen.queryByText('Corp Root CA 2031')).not.toBeInTheDocument()
    })
  })

  describe('Disabled while saving', () => {
    it('disables Add certificate, Mass Action and every trash button', () => {
      renderTable({ disabled: true })
      expect(screen.getByRole('button', { name: 'Add certificate' })).toBeDisabled()
      expect(screen.getByRole('button', { name: /Mass Action/ })).toBeDisabled()
      for (const button of screen.getAllByRole('button', { name: /^Remove / })) {
        expect(button).toBeDisabled()
      }
    })

    it('keeps the eye buttons enabled', () => {
      renderTable({ disabled: true })
      for (const button of screen.getAllByRole('button', { name: /^View / })) {
        expect(button).toBeEnabled()
      }
    })
  })

  describe('Remove and add buttons', () => {
    it('holds one "Remove <name>" button in each row', () => {
      renderTable()
      for (const certificate of ROWS) {
        const buttons = within(rowOf(certificate.name)).getAllByRole('button', { name: /^Remove / })
        expect(buttons).toHaveLength(1)
        expect(buttons[0]).toHaveAccessibleName(`Remove ${certificate.name}`)
      }
    })

    it('reports each row through its own "Remove <name>" button', async () => {
      const user = userEvent.setup()
      const { onRemove, onView } = renderTable()
      for (const certificate of [ROOT, ISSUING, STAGED_LAB]) {
        await user.click(screen.getByRole('button', { name: `Remove ${certificate.name}` }))
      }
      expect(onRemove).toHaveBeenCalledTimes(3)
      expect(onRemove).toHaveBeenNthCalledWith(1, [ROOT.id])
      expect(onRemove).toHaveBeenNthCalledWith(2, [ISSUING.id])
      expect(onRemove).toHaveBeenNthCalledWith(3, [STAGED_LAB.id])
      expect(onView).not.toHaveBeenCalled()
    })

    it('reports nothing when a disabled trash button is clicked', async () => {
      const user = userEvent.setup()
      const { onRemove } = renderTable({ disabled: true })
      await user.click(screen.getByRole('button', { name: 'Remove Corp Root CA 2031' }))
      expect(onRemove).not.toHaveBeenCalled()
    })

    it('reports nothing when the disabled Add certificate button is clicked', async () => {
      const user = userEvent.setup()
      const { onAdd } = renderTable({ disabled: true })
      await user.click(screen.getByRole('button', { name: 'Add certificate' }))
      expect(onAdd).not.toHaveBeenCalled()
    })

    it('disables every Add certificate button of an empty table while saving', async () => {
      const user = userEvent.setup()
      const { onAdd } = renderTable({ certificates: [], disabled: true })
      const buttons = screen.getAllByRole('button', { name: 'Add certificate' })
      expect(buttons).toHaveLength(2)
      for (const button of buttons) {
        expect(button).toBeDisabled()
        await user.click(button)
      }
      expect(onAdd).not.toHaveBeenCalled()
    })

    it('enables Add certificate and every trash button by default', () => {
      renderTable()
      expect(screen.getByRole('button', { name: 'Add certificate' })).toBeEnabled()
      const trashButtons = screen.getAllByRole('button', { name: /^Remove / })
      expect(trashButtons).toHaveLength(3)
      for (const button of trashButtons) {
        expect(button).toBeEnabled()
      }
    })

    it('renders the trash and Add certificate buttons as plain buttons, never submits', () => {
      renderTable()
      expect(screen.getByRole('button', { name: 'Add certificate' })).toHaveAttribute('type', 'button')
      for (const button of screen.getAllByRole('button', { name: /^Remove / })) {
        expect(button).toHaveAttribute('type', 'button')
      }
    })
  })
})
