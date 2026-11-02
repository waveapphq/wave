/**
 * TrustedHostsTable Component Tests
 *
 * REQ-4.5.14, NET-3, BULK-1..BULK-4:
 * Host / Port / Key type / Fingerprint / Added columns, staged rows read
 * "Unsaved", a trash icon per row that stages a removal with no
 * confirmation, Mass Action with Delete as its only item, the empty state
 * and the Add hosts button.
 *
 * Component under test: frontend/src/features/settings/components/network/trusted-hosts-table.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'

import { AdditionalCertificatesTable } from '@/features/settings/components/network/additional-certificates-table'
import { TrustedHostsTable } from '@/features/settings/components/network/trusted-hosts-table'
import { useTimezoneStore } from '@/stores/timezone-store'

type TableProps = ComponentProps<typeof TrustedHostsTable>
type HostRow = TableProps['hosts'][number]

const BASTION: HostRow = {
  id: 'h-bastion',
  host: 'bastion.corp.example',
  port: 22,
  key_type: 'ED25519',
  fingerprint: 'SHA256:J3hCIABLpkChd3aSNPXPdIBMt3NwSpjQ0mVvGk1cE7w',
  added: '2026-02-11T09:30:00Z',
}

const DB_JUMP: HostRow = {
  id: 'h-db-jump',
  host: 'db-jump.corp.example',
  port: 2222,
  key_type: 'ECDSA',
  fingerprint: 'SHA256:l2sQeqUZ4G1rLEsJSjPFe+cSWn1bBkF9xYp0aQ3rT8M',
  added: '2026-04-27T14:05:00Z',
}

const ETL_RUNNER: HostRow = {
  id: 'h-etl',
  host: 'etl-runner.corp.example',
  port: 22,
  key_type: 'RSA',
  fingerprint: 'SHA256:lMx0EdcX8UV5sqoQD7uzT6WT/q7Scki2hN4bV9eR1aQ',
  added: '2026-07-14T08:00:00Z',
}

const STAGED_BUILD: HostRow = {
  id: 'staged-1',
  host: 'build-03.lab.example',
  port: 22,
  key_type: 'ED25519',
  fingerprint: 'SHA256:XNuuv9O0CSMeaQ7R4CkW73ofWd1v/dS2pLq8nRt6YhE',
  added: null,
  staged: true,
  key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ8mXq2v6c7W0pF1Rr0yQx3s4Kt5Lm6Nn7Bb8Cc9Dd0E',
}

// Deliberately not in Host order so the default sort is observable.
const UNSORTED_HOSTS: HostRow[] = [ETL_RUNNER, BASTION, DB_JUMP]

const TWELVE_HOSTS: HostRow[] = Array.from({ length: 12 }, (_, index): HostRow => {
  const number = String(index + 1).padStart(2, '0')
  return {
    id: `h-${number}`,
    host: `node-${number}.lab.example`,
    port: 22,
    key_type: 'ED25519',
    fingerprint: `SHA256:node${number}FingerprintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
    added: '2026-03-18T10:00:00Z',
  }
})

function renderTable(props: Partial<TableProps> = {}) {
  const onAdd = vi.fn()
  const onRemove = vi.fn()
  const allProps: TableProps = { hosts: UNSORTED_HOSTS, loading: false, onAdd, onRemove, ...props }
  const view = render(<TrustedHostsTable {...allProps} />)
  return { ...view, onAdd: allProps.onAdd, onRemove: allProps.onRemove, allProps }
}

function bodyRows(): HTMLElement[] {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1)
}

function rowOf(host: string): HTMLElement {
  return screen.getByText(host).closest('tr') as HTMLElement
}

function massActionButton(): HTMLElement {
  return screen.getByRole('button', { name: /Mass Action/ })
}

describe('TrustedHostsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTimezoneStore.setState({ mode: 'utc' })
  })

  afterEach(() => {
    act(() => {
      useTimezoneStore.setState({ mode: 'local' })
    })
  })

  describe('Columns', () => {
    it('renders Host, Port, Key type, Fingerprint and Added headers in that order', () => {
      renderTable()

      const headers = screen.getAllByRole('columnheader').map((header) => header.textContent?.trim())
      expect(headers.slice(0, 5)).toEqual(['Host', 'Port', 'Key type', 'Fingerprint', 'Added'])
    })

    it('renders host, port and key type values', () => {
      renderTable()

      const row = rowOf('db-jump.corp.example')
      expect(within(row).getByText('2222')).toBeInTheDocument()
      expect(within(row).getByText('ECDSA')).toBeInTheDocument()
    })

    it('keeps the key type out of page translation', () => {
      renderTable()

      expect(within(rowOf('db-jump.corp.example')).getByText('ECDSA')).toHaveAttribute('translate', 'no')
    })

    it('renders the full fingerprint and keeps it in the title', () => {
      renderTable()

      const fingerprint = screen.getByTitle(BASTION.fingerprint)
      expect(fingerprint).toHaveTextContent(BASTION.fingerprint)
      expect(rowOf('bastion.corp.example')).toContainElement(fingerprint)
    })

    it('renders the Added date through the Time Zone setting', () => {
      renderTable()

      const cells = within(rowOf('bastion.corp.example')).getAllByRole('cell')
      const addedCell = cells[4]
      expect(addedCell).toHaveTextContent('2026')
      expect(addedCell).toHaveTextContent('UTC')
      expect(addedCell).not.toHaveTextContent('Unsaved')
    })

    it('shows "Unsaved" in the Added column of a staged row', () => {
      renderTable({ hosts: [BASTION, STAGED_BUILD] })

      const cells = within(rowOf('build-03.lab.example')).getAllByRole('cell')
      expect(cells[4]).toHaveTextContent(/^Unsaved$/)
    })

    it('keeps every header on one line and gives the fingerprint the room the other columns leave', () => {
      renderTable()

      for (const label of ['Host', 'Port', 'Key type', 'Fingerprint', 'Added']) {
        const header = screen.getByRole('columnheader', { name: label })
        expect(within(header).getByText(label)).toHaveClass('whitespace-nowrap')
      }
      expect(screen.getByRole('columnheader', { name: 'Fingerprint' })).toHaveClass('w-full')
      expect(screen.getByTitle(BASTION.fingerprint)).toHaveClass('w-0', 'min-w-full', 'truncate')
    })
  })

  describe('Sorting and pagination', () => {
    it('sorts by Host ascending by default', () => {
      renderTable()

      expect(screen.getByRole('columnheader', { name: 'Host' })).toHaveAttribute('aria-sort', 'ascending')
      const hosts = bodyRows().map((row) => within(row).getAllByRole('cell')[0].textContent)
      expect(hosts).toEqual(['bastion.corp.example', 'db-jump.corp.example', 'etl-runner.corp.example'])
    })

    it('places a staged row in Host order', () => {
      renderTable({ hosts: [...UNSORTED_HOSTS, STAGED_BUILD] })

      const hosts = bodyRows().map((row) => within(row).getAllByRole('cell')[0].textContent)
      expect(hosts).toEqual([
        'bastion.corp.example',
        'build-03.lab.example',
        'db-jump.corp.example',
        'etl-runner.corp.example',
      ])
    })

    it('sorts Host in plain character order, then by port, then by key type, like the server', () => {
      const ip16 = { ...BASTION, id: 'h-ip16', host: '10.20.4.16' }
      const ip15Rsa = { ...ETL_RUNNER, id: 'h-ip15-rsa', host: '10.20.4.15' }
      const ip15Ed = { ...BASTION, id: 'h-ip15-ed', host: '10.20.4.15' }
      const ip15Alt = { ...DB_JUMP, id: 'h-ip15-alt', host: '10.20.4.15' }
      const artifacts = { ...BASTION, id: 'h-artifacts', host: 'artifacts.corp.example' }
      renderTable({ hosts: [artifacts, ip15Alt, ip16, ip15Rsa, ip15Ed] })

      const keys = bodyRows().map((row) =>
        within(row)
          .getAllByRole('cell')
          .slice(0, 3)
          .map((cell) => cell.textContent)
          .join(' '),
      )
      expect(keys).toEqual([
        '10.20.4.15 22 ED25519',
        '10.20.4.15 22 RSA',
        '10.20.4.15 2222 ECDSA',
        '10.20.4.16 22 ED25519',
        'artifacts.corp.example 22 ED25519',
      ])
    })

    it('sorts by Port when its header is clicked', async () => {
      const user = userEvent.setup()
      renderTable()

      await user.click(screen.getByRole('columnheader', { name: 'Port' }))

      expect(screen.getByRole('columnheader', { name: 'Port' })).toHaveAttribute('aria-sort', 'ascending')
      const lastRow = bodyRows()[2]
      expect(within(lastRow).getAllByRole('cell')[0]).toHaveTextContent('db-jump.corp.example')
    })

    it('shows 10 hosts per page with the hosts count', () => {
      renderTable({ hosts: TWELVE_HOSTS })

      expect(bodyRows()).toHaveLength(10)
      expect(screen.getByTestId('pagination-item-count')).toHaveTextContent('Showing 1-10 of 12 hosts')
    })
  })

  describe('Search', () => {
    it('uses the "Search hosts…" placeholder', () => {
      renderTable()

      expect(screen.getByPlaceholderText('Search hosts…')).toBeInTheDocument()
    })

    it('filters rows by host name, ignoring letter case', async () => {
      const user = userEvent.setup()
      renderTable()

      await user.type(screen.getByPlaceholderText('Search hosts…'), 'BASTION')

      await waitFor(() => {
        expect(bodyRows()).toHaveLength(1)
      })
      expect(rowOf('bastion.corp.example')).toBeInTheDocument()
    })
  })

  describe('Trash icon', () => {
    it('names each trash button after its host', () => {
      renderTable()

      for (const host of ['bastion.corp.example', 'db-jump.corp.example', 'etl-runner.corp.example']) {
        expect(screen.getByRole('button', { name: `Remove ${host}` })).toBeInTheDocument()
      }
    })

    it('stages the removal of one saved row with no confirmation dialog', async () => {
      const user = userEvent.setup()
      const { onRemove } = renderTable()

      await user.click(screen.getByRole('button', { name: 'Remove db-jump.corp.example' }))

      expect(onRemove).toHaveBeenCalledTimes(1)
      expect(onRemove).toHaveBeenCalledWith(['h-db-jump'])
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('removes a staged row by its staged id', async () => {
      const user = userEvent.setup()
      const { onRemove } = renderTable({ hosts: [BASTION, STAGED_BUILD] })

      await user.click(screen.getByRole('button', { name: 'Remove build-03.lab.example' }))

      expect(onRemove).toHaveBeenCalledWith(['staged-1'])
    })
  })

  describe('Add hosts', () => {
    it('calls onAdd from the toolbar Add hosts button', async () => {
      const user = userEvent.setup()
      const { onAdd } = renderTable()

      await user.click(screen.getByRole('button', { name: 'Add hosts' }))

      expect(onAdd).toHaveBeenCalledTimes(1)
    })

    it('places Mass Action and Add hosts after the search input', () => {
      renderTable()

      const search = screen.getByPlaceholderText('Search hosts…')
      const massAction = massActionButton()
      const addHosts = screen.getByRole('button', { name: 'Add hosts' })
      expect(search.compareDocumentPosition(massAction) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(massAction.compareDocumentPosition(addHosts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
  })

  describe('Empty and loading', () => {
    it('shows "No trusted SSH hosts" with an Add hosts button that calls onAdd', async () => {
      const user = userEvent.setup()
      const { onAdd } = renderTable({ hosts: [] })

      const cell = screen.getByText('No trusted SSH hosts').closest('td') as HTMLElement
      await user.click(within(cell).getByRole('button', { name: 'Add hosts' }))

      expect(onAdd).toHaveBeenCalledTimes(1)
    })

    it('draws the Add hosts button of the empty table like the toolbar one', () => {
      renderTable({ hosts: [] })

      const cell = screen.getByText('No trusted SSH hosts').closest('td') as HTMLElement
      const emptyAdd = within(cell).getByRole('button', { name: 'Add hosts' })
      const toolbarAdd = screen
        .getAllByRole('button', { name: 'Add hosts' })
        .filter((button) => !cell.contains(button))
      expect(toolbarAdd).toHaveLength(1)
      expect(emptyAdd.className).toBe(toolbarAdd[0].className)
      expect(emptyAdd.innerHTML).toBe(toolbarAdd[0].innerHTML)
    })

    it('draws the Add button of the empty table like the empty Additional Certificates table does', () => {
      const { unmount } = render(
        <AdditionalCertificatesTable
          certificates={[]}
          loading={false}
          onAdd={vi.fn()}
          onView={vi.fn()}
          onRemove={vi.fn()}
        />,
      )
      const certificatesCell = screen.getByText('No additional certificates').closest('td') as HTMLElement
      const certificatesAdd = within(certificatesCell).getByRole('button', { name: 'Add certificate' })
      const certificatesClass = certificatesAdd.className
      unmount()

      renderTable({ hosts: [] })

      const cell = screen.getByText('No trusted SSH hosts').closest('td') as HTMLElement
      expect(within(cell).getByRole('button', { name: 'Add hosts' }).className).toBe(certificatesClass)
    })

    it('shows skeleton rows and no empty state while loading', () => {
      renderTable({ hosts: [], loading: true })

      expect(screen.getAllByTestId('skeleton-row').length).toBeGreaterThan(0)
      expect(screen.queryByText('No trusted SSH hosts')).not.toBeInTheDocument()
    })
  })

  describe('Mass Action (BULK-1..BULK-4)', () => {
    it('shows no checkboxes until Mass Action is clicked', async () => {
      const user = userEvent.setup()
      renderTable()

      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
      await user.click(massActionButton())

      expect(within(rowOf('bastion.corp.example')).getByRole('checkbox')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '0 selected' })).toBeInTheDocument()
    })

    it('holds only a Delete item and no separator', async () => {
      const user = userEvent.setup()
      renderTable()

      await user.click(massActionButton())
      await user.click(screen.getByRole('button', { name: '0 selected' }))

      const items = await screen.findAllByRole('menuitem')
      expect(items.map((item) => item.textContent?.trim())).toEqual(['Delete'])
      expect(screen.queryByTestId('bulk-actions-separator')).not.toBeInTheDocument()
    })

    it('disables Delete while nothing is selected', async () => {
      const user = userEvent.setup()
      const { onRemove } = renderTable()

      await user.click(massActionButton())
      await user.click(screen.getByRole('button', { name: '0 selected' }))
      const deleteItem = await screen.findByRole('menuitem', { name: /Delete/ })
      expect(deleteItem).toHaveAttribute('aria-disabled', 'true')

      await user.click(deleteItem)
      expect(onRemove).not.toHaveBeenCalled()
    })

    it('counts the checked rows', async () => {
      const user = userEvent.setup()
      renderTable()

      await user.click(massActionButton())
      await user.click(within(rowOf('bastion.corp.example')).getByRole('checkbox'))
      await user.click(within(rowOf('etl-runner.corp.example')).getByRole('checkbox'))

      expect(screen.getByRole('button', { name: '2 selected' })).toBeInTheDocument()
    })

    it('Delete stages the selected removals, then clears the selection and leaves selection mode', async () => {
      const user = userEvent.setup()
      const { onRemove } = renderTable()

      await user.click(massActionButton())
      await user.click(within(rowOf('bastion.corp.example')).getByRole('checkbox'))
      await user.click(within(rowOf('etl-runner.corp.example')).getByRole('checkbox'))
      await user.click(screen.getByRole('button', { name: '2 selected' }))
      await user.click(await screen.findByRole('menuitem', { name: /Delete/ }))

      expect(onRemove).toHaveBeenCalledTimes(1)
      const removed = [...(vi.mocked(onRemove).mock.calls[0][0] as string[])].sort()
      expect(removed).toEqual(['h-bastion', 'h-etl'])
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(massActionButton()).toBeInTheDocument()
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    })

    it('starts from an empty selection after a Mass Action Delete', async () => {
      const user = userEvent.setup()
      renderTable()

      await user.click(massActionButton())
      await user.click(within(rowOf('bastion.corp.example')).getByRole('checkbox'))
      await user.click(screen.getByRole('button', { name: '1 selected' }))
      await user.click(await screen.findByRole('menuitem', { name: /Delete/ }))
      await user.click(massActionButton())

      expect(screen.getByRole('button', { name: '0 selected' })).toBeInTheDocument()
    })

    it('the X leaves selection mode and clears the selection', async () => {
      const user = userEvent.setup()
      const { onRemove } = renderTable()

      await user.click(massActionButton())
      await user.click(within(rowOf('bastion.corp.example')).getByRole('checkbox'))
      await user.click(screen.getByRole('button', { name: 'Exit selection mode' }))

      expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
      await user.click(massActionButton())
      expect(screen.getByRole('button', { name: '0 selected' })).toBeInTheDocument()
      expect(onRemove).not.toHaveBeenCalled()
    })

    it('drops a selected row from the count once it leaves the table', async () => {
      const user = userEvent.setup()
      const { rerender, allProps } = renderTable()

      await user.click(massActionButton())
      await user.click(within(rowOf('bastion.corp.example')).getByRole('checkbox'))
      expect(screen.getByRole('button', { name: '1 selected' })).toBeInTheDocument()

      await act(async () => {
        rerender(<TrustedHostsTable {...allProps} hosts={[DB_JUMP, ETL_RUNNER]} />)
      })

      expect(screen.getByRole('button', { name: '0 selected' })).toBeInTheDocument()
    })
  })

  describe('Disabled while saving', () => {
    it('disables Add hosts, Mass Action and every trash button', () => {
      renderTable({ disabled: true })

      expect(screen.getByRole('button', { name: 'Add hosts' })).toBeDisabled()
      expect(massActionButton()).toBeDisabled()
      for (const host of ['bastion.corp.example', 'db-jump.corp.example', 'etl-runner.corp.example']) {
        expect(screen.getByRole('button', { name: `Remove ${host}` })).toBeDisabled()
      }
    })

    it('reports nothing when a disabled trash button is clicked', async () => {
      const user = userEvent.setup()
      const { onRemove } = renderTable({ disabled: true })

      await user.click(screen.getByRole('button', { name: 'Remove bastion.corp.example' }))

      expect(onRemove).not.toHaveBeenCalled()
    })

    it('enables Add hosts, Mass Action and trash by default', () => {
      renderTable()

      expect(screen.getByRole('button', { name: 'Add hosts' })).toBeEnabled()
      expect(massActionButton()).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Remove bastion.corp.example' })).toBeEnabled()
    })
  })

  describe('Remove and add buttons', () => {
    it('holds one "Remove <host>" button in each row', () => {
      renderTable()

      for (const host of UNSORTED_HOSTS) {
        const buttons = within(rowOf(host.host)).getAllByRole('button', { name: /^Remove / })
        expect(buttons).toHaveLength(1)
        expect(buttons[0]).toHaveAccessibleName(`Remove ${host.host}`)
      }
    })

    it('reports each row through its own "Remove <host>" button', async () => {
      const user = userEvent.setup()
      const { onRemove } = renderTable()

      for (const host of [BASTION, DB_JUMP, ETL_RUNNER]) {
        await user.click(screen.getByRole('button', { name: `Remove ${host.host}` }))
      }

      expect(onRemove).toHaveBeenCalledTimes(3)
      expect(onRemove).toHaveBeenNthCalledWith(1, ['h-bastion'])
      expect(onRemove).toHaveBeenNthCalledWith(2, ['h-db-jump'])
      expect(onRemove).toHaveBeenNthCalledWith(3, ['h-etl'])
    })

    it('reports nothing through onAdd when a trash button is clicked', async () => {
      const user = userEvent.setup()
      const { onAdd } = renderTable()

      await user.click(screen.getByRole('button', { name: 'Remove bastion.corp.example' }))

      expect(onAdd).not.toHaveBeenCalled()
    })

    it('reports onAdd from every Add hosts button of an empty table', async () => {
      const user = userEvent.setup()
      const { onAdd, onRemove } = renderTable({ hosts: [] })

      const buttons = screen.getAllByRole('button', { name: 'Add hosts' })
      expect(buttons).toHaveLength(2)
      for (const button of buttons) {
        await user.click(button)
      }

      expect(onAdd).toHaveBeenCalledTimes(2)
      expect(onRemove).not.toHaveBeenCalled()
    })

    it('disables every Add hosts button of an empty table while saving', async () => {
      const user = userEvent.setup()
      const { onAdd } = renderTable({ hosts: [], disabled: true })

      const buttons = screen.getAllByRole('button', { name: 'Add hosts' })
      expect(buttons).toHaveLength(2)
      for (const button of buttons) {
        expect(button).toBeDisabled()
        await user.click(button)
      }

      expect(onAdd).not.toHaveBeenCalled()
    })

    it('reports nothing when the disabled toolbar Add hosts button is clicked', async () => {
      const user = userEvent.setup()
      const { onAdd } = renderTable({ disabled: true })

      await user.click(screen.getByRole('button', { name: 'Add hosts' }))

      expect(onAdd).not.toHaveBeenCalled()
    })

    it('renders the trash and Add hosts buttons as plain buttons, never submits', () => {
      renderTable()

      expect(screen.getByRole('button', { name: 'Add hosts' })).toHaveAttribute('type', 'button')
      for (const button of screen.getAllByRole('button', { name: /^Remove / })) {
        expect(button).toHaveAttribute('type', 'button')
      }
    })
  })
})
