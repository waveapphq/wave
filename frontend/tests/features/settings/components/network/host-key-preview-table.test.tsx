/**
 * HostKeyPreviewTable - the one preview table of both Add Hosts modes (NET-4).
 *
 * REQ-4.5.14
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { RowSelectionState } from '@tanstack/react-table'

import {
  HostKeyPreviewTable,
  type HostKeyPreviewRow,
} from '@/features/settings/components/network/host-key-preview-table'

const FP_ED = 'SHA256:VHBwr4mXARtZpMsuC2M4HpEQxIv8wbSWaGQ0X2eEI1I'
const FP_EC = 'SHA256:BDLrgS1R03zoG0EBYmXFdRkwDoIfvamOIBvHM1cuRe8'
const FP_RSA = 'SHA256:l92zIj80bEPole9Po9burZ5B+oPFVD8NhHHQ1oqnHKo'

const ED_ROW: HostKeyPreviewRow = {
  id: 'r1',
  hostNames: ['jump-02', '10.20.4.40'],
  port: 22,
  keyType: 'ED25519',
  key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBcGwPpN+g0nuNnXXsAYsqGn9EMGEp11+JX4KtqKXY7x',
  fingerprint: FP_ED,
  marker: 'none',
}

const EC_ROW: HostKeyPreviewRow = {
  id: 'r2',
  hostNames: ['etl-02.corp.example'],
  port: 22,
  keyType: 'ECDSA',
  key: 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEFSq9N',
  fingerprint: FP_EC,
  marker: 'already-trusted',
}

const RSA_ROW: HostKeyPreviewRow = {
  id: 'r3',
  hostNames: ['files.corp.example'],
  port: 2222,
  keyType: 'RSA',
  key: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDo88LBhZ370V1FpgnNWl77hoXdAPnF',
  fingerprint: FP_RSA,
  marker: 'key-changed',
}

interface RenderOptions {
  rows?: HostKeyPreviewRow[]
  showHost?: boolean
  selected?: RowSelectionState
}

function renderTable({ rows = [ED_ROW, EC_ROW, RSA_ROW], showHost = true, selected = {} }: RenderOptions = {}) {
  const onSelectedChange = vi.fn()
  const utils = render(
    <HostKeyPreviewTable
      rows={rows}
      showHost={showHost}
      selected={selected}
      onSelectedChange={onSelectedChange}
    />,
  )
  return { ...utils, onSelectedChange }
}

/** Owns the selection like the dialog does, so a click shows its result. */
function StatefulTable({ rows, initial }: Readonly<{ rows: HostKeyPreviewRow[]; initial: RowSelectionState }>) {
  const [selected, setSelected] = useState<RowSelectionState>(initial)
  return (
    <HostKeyPreviewTable rows={rows} showHost selected={selected} onSelectedChange={setSelected} />
  )
}

function bodyRows(): HTMLElement[] {
  return screen.getAllByRole('row').filter((row) => row.closest('tbody') !== null)
}

function headerLabels(): string[] {
  return screen
    .getAllByRole('columnheader')
    .map((header) => header.textContent?.trim() ?? '')
    .filter((label) => label !== '')
}

function rowCheckbox(row: HTMLElement): HTMLElement {
  return within(row).getByRole('checkbox')
}

function rowFor(text: RegExp): HTMLElement {
  return screen.getByRole('row', { name: text })
}

describe('HostKeyPreviewTable - columns', () => {
  it('shows Host, Key type and Fingerprint when showHost is set', () => {
    renderTable({ showHost: true })

    expect(headerLabels()).toEqual(['Host', 'Key type', 'Fingerprint'])
  })

  it('leaves the Host column out when showHost is not set', () => {
    renderTable({ showHost: false })

    expect(headerLabels()).toEqual(['Key type', 'Fingerprint'])
    expect(screen.queryByRole('columnheader', { name: 'Host' })).not.toBeInTheDocument()
    expect(screen.queryByText('jump-02, 10.20.4.40')).not.toBeInTheDocument()
  })

  it('lists every name of a row joined by a comma and a space', () => {
    renderTable()

    expect(screen.getByText('jump-02, 10.20.4.40')).toBeInTheDocument()
    expect(screen.getByText('etl-02.corp.example')).toBeInTheDocument()
  })

  it('shows the key type label of each row', () => {
    renderTable()

    expect(within(rowFor(/jump-02/)).getByText('ED25519')).toBeInTheDocument()
    expect(within(rowFor(/etl-02/)).getByText('ECDSA')).toBeInTheDocument()
    expect(within(rowFor(/files\.corp/)).getByText('RSA')).toBeInTheDocument()
  })

  it('shows the fingerprint in mono text with the full value in its title', () => {
    renderTable()

    const fingerprint = screen.getByText(FP_ED)
    expect(fingerprint).toHaveAttribute('title', FP_ED)
    expect(fingerprint).toHaveClass('font-mono')
  })

  it('keeps host names and fingerprints out of page translation', () => {
    renderTable()

    expect(screen.getByText('jump-02, 10.20.4.40')).toHaveAttribute('translate', 'no')
    expect(screen.getByText(FP_ED)).toHaveAttribute('translate', 'no')
  })

  it('keeps the key type out of page translation', () => {
    renderTable()

    expect(within(rowFor(/jump-02/)).getByText('ED25519')).toHaveAttribute('translate', 'no')
  })

  it('keeps the full fingerprint in the title without the Host column too', () => {
    renderTable({ showHost: false })

    expect(screen.getByText(FP_RSA)).toHaveAttribute('title', FP_RSA)
  })

  it('sizes the Paste columns: Host 192px up to 160px of names, Key type 104px, the fingerprint the rest', () => {
    renderTable({ showHost: true })

    expect(screen.getByRole('columnheader', { name: 'Host' })).toHaveClass('w-48')
    expect(screen.getByRole('columnheader', { name: 'Key type' })).toHaveClass('w-26')
    expect(screen.getByRole('columnheader', { name: 'Fingerprint' }).className).not.toMatch(/\bw-/)
    expect(screen.getByText('jump-02, 10.20.4.40')).toHaveClass('max-w-40', 'truncate')
    const fingerprint = screen.getByText(FP_ED)
    expect(fingerprint).toHaveClass('min-w-0', 'truncate')
    expect(fingerprint.parentElement).toHaveClass('w-0', 'min-w-full')
  })

  it('leaves the Detect columns at their content width and the fingerprint whole', () => {
    renderTable({ showHost: false })

    expect(screen.getByRole('columnheader', { name: 'Key type' }).className).not.toMatch(/\bw-/)
    const fingerprint = screen.getByText(FP_ED)
    expect(fingerprint).toHaveClass('whitespace-nowrap')
    expect(fingerprint).not.toHaveClass('truncate')
    expect(fingerprint.parentElement).not.toHaveClass('min-w-full')
  })
})

describe('HostKeyPreviewTable - markers', () => {
  it('puts "Already trusted" at the end of the Fingerprint cell', () => {
    renderTable()

    const cell = screen.getByText(FP_EC).closest('td') as HTMLElement
    expect(within(cell).getByText('Already trusted')).toBeInTheDocument()
    expect(cell.textContent?.trim().endsWith('Already trusted')).toBe(true)
  })

  it('puts "Key changed" at the end of the Fingerprint cell', () => {
    renderTable()

    const cell = screen.getByText(FP_RSA).closest('td') as HTMLElement
    expect(within(cell).getByText('Key changed')).toBeInTheDocument()
    expect(cell.textContent?.trim().endsWith('Key changed')).toBe(true)
  })

  it('shows no marker on an unmarked row', () => {
    renderTable()

    const row = rowFor(/jump-02/)
    expect(within(row).queryByText('Already trusted')).not.toBeInTheDocument()
    expect(within(row).queryByText('Key changed')).not.toBeInTheDocument()
  })

  it('makes the marker text part of the marked row accessible name', () => {
    renderTable()

    expect(screen.getByRole('row', { name: /Already trusted/ })).toHaveTextContent(FP_EC)
    expect(screen.getByRole('row', { name: /Key changed/ })).toHaveTextContent(FP_RSA)
  })

  it('disables the checkbox of every marked row with aria-disabled', () => {
    renderTable()

    expect(rowCheckbox(rowFor(/Already trusted/))).toHaveAttribute('aria-disabled', 'true')
    expect(rowCheckbox(rowFor(/Key changed/))).toHaveAttribute('aria-disabled', 'true')
  })

  it('ends the checkbox name of a marked row with its marker', () => {
    renderTable()

    expect(screen.getByRole('checkbox', { name: 'Select etl-02.corp.example ECDSA Already trusted' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Select files.corp.example RSA Key changed' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Select jump-02, 10.20.4.40 ED25519' })).toBeEnabled()
  })

  it('leaves the checkbox of an unmarked row enabled', () => {
    renderTable()

    const checkbox = rowCheckbox(rowFor(/jump-02/))
    expect(checkbox).not.toHaveAttribute('aria-disabled', 'true')
    expect(checkbox).toBeEnabled()
  })
})

describe('HostKeyPreviewTable - selection', () => {
  it('shows the rows the selection names as checked', () => {
    renderTable({ rows: [ED_ROW, { ...EC_ROW, marker: 'none' }], selected: { r1: true } })

    expect(rowCheckbox(rowFor(/jump-02/))).toBeChecked()
    expect(rowCheckbox(rowFor(/etl-02/))).not.toBeChecked()
  })

  it('reports the next selection when a row is unchecked', async () => {
    const user = userEvent.setup()
    const { onSelectedChange } = renderTable({
      rows: [ED_ROW, { ...EC_ROW, marker: 'none' }],
      selected: { r1: true, r2: true },
    })

    await user.click(rowCheckbox(rowFor(/jump-02/)))

    expect(onSelectedChange).toHaveBeenLastCalledWith({ r2: true })
  })

  it('reports the next selection when a row is checked', async () => {
    const user = userEvent.setup()
    const { onSelectedChange } = renderTable({
      rows: [ED_ROW, { ...EC_ROW, marker: 'none' }],
      selected: { r2: true },
    })

    await user.click(rowCheckbox(rowFor(/jump-02/)))

    expect(onSelectedChange).toHaveBeenLastCalledWith({ r1: true, r2: true })
  })

  it('does not toggle a marked row from its checkbox', async () => {
    const user = userEvent.setup()
    const { onSelectedChange } = renderTable()

    await user.click(rowCheckbox(rowFor(/Already trusted/)))
    await user.click(rowCheckbox(rowFor(/Key changed/)))

    expect(onSelectedChange).not.toHaveBeenCalled()
  })

  it('ignores a click on a marked row', async () => {
    const user = userEvent.setup()
    const { onSelectedChange } = renderTable()

    await user.click(within(rowFor(/Already trusted/)).getByText('ECDSA'))

    expect(onSelectedChange).not.toHaveBeenCalled()
  })

  it('leaves marked rows out when every row is selected at once', async () => {
    const user = userEvent.setup()
    render(<StatefulTable rows={[ED_ROW, EC_ROW, RSA_ROW, { ...ED_ROW, id: 'r4', hostNames: ['bastion-01'] }]} initial={{}} />)

    await user.click(screen.getByRole('checkbox', { name: 'Select all' }))

    expect(rowCheckbox(rowFor(/jump-02/))).toBeChecked()
    expect(rowCheckbox(rowFor(/bastion-01/))).toBeChecked()
    expect(rowCheckbox(rowFor(/Already trusted/))).not.toBeChecked()
    expect(rowCheckbox(rowFor(/Key changed/))).not.toBeChecked()
  })
})

describe('HostKeyPreviewTable - no sorting, no pagination', () => {
  it('keeps the given row order', () => {
    renderTable({ rows: [RSA_ROW, ED_ROW, EC_ROW] })

    expect(bodyRows().map((row) => within(row).getByText(/^(ED25519|ECDSA|RSA)$/).textContent)).toEqual([
      'RSA',
      'ED25519',
      'ECDSA',
    ])
  })

  it('has no sortable headers and keeps the order when a header is clicked', async () => {
    const user = userEvent.setup()
    renderTable({ rows: [RSA_ROW, ED_ROW, EC_ROW] })

    for (const header of screen.getAllByRole('columnheader')) {
      expect(header).not.toHaveAttribute('aria-sort')
    }
    await user.click(screen.getByRole('columnheader', { name: 'Key type' }))

    expect(within(bodyRows()[0]).getByText('RSA')).toBeInTheDocument()
  })

  it('shows every row with no pagination', () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      ...ED_ROW,
      id: `row-${index + 1}`,
      hostNames: [`host-${index + 1}.lab.internal`],
    }))
    renderTable({ rows })

    expect(bodyRows()).toHaveLength(30)
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('pagination')).not.toBeInTheDocument()
  })
})
