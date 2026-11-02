/**
 * TLS cipher picker sheet - two-table model (HTTP-16).
 *
 * The cipher_suites row (cipherPicker opt) opens a bespoke sheet fed by
 * GET /system/tls-capabilities (fixed host-independent catalog), split into two
 * tables by protocol family: TLS 1.0-1.2 (per-suite compat tag) and TLS 1.3
 * (no tag), both selectable and drag-reorderable within their own family.
 * The node's tls_min/max draft range hides out-of-range rows and empty tables.
 * Three value states: default (undefined = every suite of the TLS versions,
 * every visible row enabled), an explicit ordered subset (stored table-1 order ++ table-2 order),
 * and explicit zero. Unchecking the last row lands in ZERO, never back to
 * defaults; a Reset control returns to defaults.
 *
 * On the Block window the Cipher Suites row is a one-line list field (FIELD-10): not set, it shows in gray the
 * default list the run uses for the Block and its TLS versions (the payload's defaults), following those versions;
 * in {x} mode the default stays the gray hint; expand opens the picker; a name outside the TLS versions is named
 * under the row.
 *
 * REQ-3.1.1.5: Block parameter configuration forms
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  CipherPickerSheet,
  moveCipher,
  moveCipherInFamily,
  heldName,
} from '@/features/workbench/common/element-config/cipher-picker/cipher-picker-sheet'
import { ParameterTable } from '@/features/workbench/common/element-config/parameters/parameter-table'
import { fetchTlsCapabilities } from '@/services/tls-capabilities'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import { getInputParams } from '@/features/workbench/lib/node-parameters'
import { HELD_DEFAULT_LOOK_CLASS } from '@/lib/variable-format'
import {
  ChildEditorParent,
  applyParentChildren,
  parentChildren,
} from '../../../../utils/child-editor-parent'

vi.mock('@/services/tls-capabilities', () => ({
  fetchTlsCapabilities: vi.fn(),
}))

// What the run uses for an unset Cipher Suites, per Block and TLS range "<min>-<max>".
const HTTP_DEFAULTS_12_13 = ['ECDHE-RSA-AES256-GCM-SHA384', 'TLS_AES_128_GCM_SHA256']
const HTTP_DEFAULTS_10_12 = ['ECDHE-RSA-AES256-SHA', 'ECDHE-RSA-AES128-SHA']
const K8S_DEFAULTS_12_13 = ['ECDHE-RSA-AES128-GCM-SHA256', 'TLS_CHACHA20_POLY1305_SHA256']

// Representative catalog subset: two "1.2" rows, two "1.0-1.2" rows, all 3 1.3 rows.
const CAPABILITIES = {
  defaults: {
    'http-client': { '1.2-1.3': HTTP_DEFAULTS_12_13, '1.0-1.2': HTTP_DEFAULTS_10_12 },
    'k8s-connect': { '1.2-1.3': K8S_DEFAULTS_12_13 },
  },
  ciphers: [
    {
      openssl: 'ECDHE-RSA-AES256-GCM-SHA384',
      iana: 'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
      min_version: '1.2',
      max_version: '1.2',
    },
    {
      openssl: 'ECDHE-RSA-AES128-GCM-SHA256',
      iana: 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
      min_version: '1.2',
      max_version: '1.2',
    },
    {
      openssl: 'ECDHE-RSA-AES256-SHA',
      iana: 'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA',
      min_version: '1.0',
      max_version: '1.2',
    },
    {
      openssl: 'ECDHE-RSA-AES128-SHA',
      iana: 'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA',
      min_version: '1.0',
      max_version: '1.2',
    },
    { openssl: 'TLS_AES_128_GCM_SHA256', iana: 'TLS_AES_128_GCM_SHA256', min_version: '1.3', max_version: '1.3' },
    { openssl: 'TLS_AES_256_GCM_SHA384', iana: 'TLS_AES_256_GCM_SHA384', min_version: '1.3', max_version: '1.3' },
    {
      openssl: 'TLS_CHACHA20_POLY1305_SHA256',
      iana: 'TLS_CHACHA20_POLY1305_SHA256',
      min_version: '1.3',
      max_version: '1.3',
    },
  ],
}

const FAMILY12 = [
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES256-SHA',
  'ECDHE-RSA-AES128-SHA',
]
const FAMILY13 = ['TLS_AES_128_GCM_SHA256', 'TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256']

const mockedFetch = vi.mocked(fetchTlsCapabilities)

// undefined value = default (all enabled); [] = zero ciphers; [...] = explicit.
function renderSheet(value?: string[], minVersion = '1.0', maxVersion = '1.3') {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(
    <CipherPickerSheet
      label="Cipher Suites"
      value={value}
      minVersion={minVersion}
      maxVersion={maxVersion}
      onSave={onSave}
      onClose={onClose}
    />,
  )
  return { onSave, onClose }
}

async function ready() {
  await waitFor(() =>
    expect(screen.queryByTestId('cipher-picker-loading')).not.toBeInTheDocument(),
  )
}

function rowNames(table: HTMLElement): string[] {
  return within(table)
    .getAllByTestId(/^cipher-row-/)
    .map((row) => row.getAttribute('data-testid')!.replace('cipher-row-', ''))
}

describe('moveCipher - reorder helper', () => {
  it('moves an entry to the target slot', () => {
    expect(moveCipher(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a'])
    expect(moveCipher(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  })

  it('is a no-op when the source and target are the same', () => {
    const list = ['a', 'b', 'c']
    expect(moveCipher(list, 'b', 'b')).toBe(list)
  })

  it('is a no-op when either id is not in the list', () => {
    const list = ['a', 'b', 'c']
    expect(moveCipher(list, 'x', 'a')).toBe(list)
    expect(moveCipher(list, 'a', 'x')).toBe(list)
  })
})

describe('heldName - the name a dragged row is held under', () => {
  const row = { openssl: 'ECDHE-RSA-AES128-SHA' } as never
  it('reads the name the list holds for the row, IANA included', () => {
    expect(heldName([{ row, name: 'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA' }], 'ECDHE-RSA-AES128-SHA')).toBe(
      'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA',
    )
  })

  it('falls back to the row id when no pick holds it', () => {
    expect(heldName([], 'ECDHE-RSA-AES128-SHA')).toBe('ECDHE-RSA-AES128-SHA')
  })
})

describe('moveCipherInFamily - per-family reorder isolation', () => {
  it('reorders within the family and keeps outside entries', () => {
    const family = new Set(['a', 'b', 'c'])
    expect(moveCipherInFamily(['a', 'x', 'b', 'c', 'y'], family, 'a', 'c')).toEqual([
      'b', 'c', 'a', 'x', 'y',
    ])
  })

  it('never crosses families: a target outside the family is a no-op', () => {
    const list = ['a', 'b', 'x']
    expect(moveCipherInFamily(list, new Set(['a', 'b']), 'a', 'x')).toBe(list)
    expect(moveCipherInFamily(list, new Set(['a', 'b']), 'x', 'a')).toBe(list)
  })

  it('is a no-op when source and target coincide', () => {
    const list = ['a', 'b', 'c']
    expect(moveCipherInFamily(list, new Set(['a', 'b', 'c']), 'b', 'b')).toBe(list)
  })
})

describe('CipherPickerSheet - two-table family split', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue(CAPABILITIES)
  })

  it('fetches the inventory once and splits rows into the two family tables', async () => {
    renderSheet()
    await ready()
    expect(mockedFetch).toHaveBeenCalledTimes(1)
    const table12 = screen.getByTestId('cipher-table-tls12')
    const table13 = screen.getByTestId('cipher-table-tls13')
    expect(rowNames(table12)).toEqual(FAMILY12)
    expect(rowNames(table13)).toEqual(FAMILY13)
  })

  it('labels the tables with per-family preference-order headers', async () => {
    renderSheet()
    await ready()
    expect(screen.getByText('TLS 1.0-1.2 - preference order')).toBeInTheDocument()
    expect(screen.getByText('TLS 1.3 - preference order')).toBeInTheDocument()
  })

  it('tags table-1 rows with their compat span and leaves 1.3 rows untagged', async () => {
    renderSheet()
    await ready()
    expect(screen.getByTestId('cipher-tag-ECDHE-RSA-AES256-GCM-SHA384')).toHaveTextContent(/^1\.2$/)
    expect(screen.getByTestId('cipher-tag-ECDHE-RSA-AES128-GCM-SHA256')).toHaveTextContent(/^1\.2$/)
    expect(screen.getByTestId('cipher-tag-ECDHE-RSA-AES256-SHA')).toHaveTextContent(/^1\.0-1\.2$/)
    expect(screen.getByTestId('cipher-tag-ECDHE-RSA-AES128-SHA')).toHaveTextContent(/^1\.0-1\.2$/)
    for (const name of FAMILY13) {
      expect(screen.queryByTestId(`cipher-tag-${name}`)).not.toBeInTheDocument()
    }
  })

  it('renders TLS 1.3 rows selectable and draggable (the read-only block is gone)', async () => {
    renderSheet()
    await ready()
    const table13 = screen.getByTestId('cipher-table-tls13')
    const checkboxes = within(table13).getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(3)
    expect(within(table13).getByTestId('cipher-drag-TLS_AES_128_GCM_SHA256')).toBeInTheDocument()
    expect(screen.queryByText(/enforced by the TLS stack/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('cipher-tls13-block')).not.toBeInTheDocument()
  })

  it('shows the OpenSSL name (mono) and the IANA name (muted) on table-1 rows', async () => {
    renderSheet()
    await ready()
    const row = screen.getByTestId('cipher-row-ECDHE-RSA-AES128-SHA')
    expect(within(row).getByText('ECDHE-RSA-AES128-SHA').className).toContain('font-mono')
    expect(within(row).getByText('TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA').className).toContain(
      'text-muted-foreground',
    )
  })

  it('shows a 1.3 name only once (OpenSSL and IANA forms coincide)', async () => {
    renderSheet()
    await ready()
    const row = screen.getByTestId('cipher-row-TLS_AES_256_GCM_SHA384')
    expect(within(row).getAllByText('TLS_AES_256_GCM_SHA384')).toHaveLength(1)
  })

  it('shows a loading state and disables Save until the inventory arrives', async () => {
    let resolve!: (value: typeof CAPABILITIES) => void
    mockedFetch.mockImplementation(() => new Promise((res) => { resolve = res }))
    renderSheet()
    expect(screen.getByTestId('cipher-picker-loading')).toBeInTheDocument()
    expect(screen.getByTestId('cipher-picker-save-button')).toBeDisabled()
    resolve(CAPABILITIES)
    await ready()
    expect(screen.getByTestId('cipher-picker-save-button')).toBeEnabled()
  })

  it('surfaces a fetch failure and keeps Save disabled', async () => {
    mockedFetch.mockRejectedValue(new Error('boom'))
    renderSheet()
    await waitFor(() => expect(screen.getByTestId('cipher-picker-error')).toBeInTheDocument())
    expect(screen.getByTestId('cipher-picker-error')).toHaveTextContent('boom')
    expect(screen.getByTestId('cipher-picker-save-button')).toBeDisabled()
  })

  it('renders a non-Error rejection as text', async () => {
    mockedFetch.mockRejectedValue('socket hangup')
    renderSheet()
    await waitFor(() => expect(screen.getByTestId('cipher-picker-error')).toBeInTheDocument())
    expect(screen.getByTestId('cipher-picker-error')).toHaveTextContent('socket hangup')
  })

  it('ignores a fetch resolving after unmount', async () => {
    let resolve!: (value: typeof CAPABILITIES) => void
    mockedFetch.mockImplementation(() => new Promise((res) => { resolve = res }))
    const onSave = vi.fn()
    const { unmount } = render(
      <CipherPickerSheet
        label="Cipher Suites"
        value={undefined}
        minVersion="1.0"
        maxVersion="1.3"
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )
    unmount()
    resolve(CAPABILITIES)
    await Promise.resolve()
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('CipherPickerSheet - range filtering hides rows and tables', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue(CAPABILITIES)
  })

  it('keeps 1.0-1.2 span rows visible under the default 1.2/1.3 range', async () => {
    renderSheet(undefined, '1.2', '1.3')
    await ready()
    expect(rowNames(screen.getByTestId('cipher-table-tls12'))).toEqual(FAMILY12)
    expect(rowNames(screen.getByTestId('cipher-table-tls13'))).toEqual(FAMILY13)
  })

  it('hides 1.2-only rows and the whole 1.3 table under a 1.0/1.1 range', async () => {
    renderSheet(undefined, '1.0', '1.1')
    await ready()
    expect(rowNames(screen.getByTestId('cipher-table-tls12'))).toEqual([
      'ECDHE-RSA-AES256-SHA',
      'ECDHE-RSA-AES128-SHA',
    ])
    expect(screen.queryByTestId('cipher-table-tls13')).not.toBeInTheDocument()
    expect(screen.queryByText('TLS 1.3 - preference order')).not.toBeInTheDocument()
  })

  it('hides the whole 1.3 table when max stops at 1.2', async () => {
    renderSheet(undefined, '1.0', '1.2')
    await ready()
    expect(screen.getByTestId('cipher-table-tls12')).toBeInTheDocument()
    expect(screen.queryByTestId('cipher-table-tls13')).not.toBeInTheDocument()
  })

  it('hides the whole 1.0-1.2 table when min starts at 1.3', async () => {
    renderSheet(undefined, '1.3', '1.3')
    await ready()
    expect(screen.queryByTestId('cipher-table-tls12')).not.toBeInTheDocument()
    expect(screen.queryByText('TLS 1.0-1.2 - preference order')).not.toBeInTheDocument()
    expect(rowNames(screen.getByTestId('cipher-table-tls13'))).toEqual(FAMILY13)
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent('All 3 enabled')
  })

  it('treats off-scale range values as the 1.2/1.3 defaults (defensive)', async () => {
    renderSheet(undefined, 'bogus', 'bogus')
    await ready()
    expect(rowNames(screen.getByTestId('cipher-table-tls12'))).toEqual(FAMILY12)
    expect(rowNames(screen.getByTestId('cipher-table-tls13'))).toEqual(FAMILY13)
  })
})

describe('CipherPickerSheet - default (all enabled) state', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue(CAPABILITIES)
  })

  it('renders every visible row in both tables checked and reorderable', async () => {
    renderSheet()
    await ready()
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(7)
    for (const checkbox of checkboxes) {
      expect(checkbox).toHaveAttribute('data-state', 'checked')
    }
    expect(screen.getByTestId('cipher-drag-ECDHE-RSA-AES128-SHA')).toBeInTheDocument()
    expect(screen.getByTestId('cipher-drag-TLS_CHACHA20_POLY1305_SHA256')).toBeInTheDocument()
  })

  it('counts every visible row across both tables, with the exact defaults note and no Reset', async () => {
    renderSheet()
    await ready()
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent('All 7 enabled')
    expect(screen.getByTestId('cipher-picker-defaults-note')).toHaveTextContent(
      /^Default$/,
    )
    expect(screen.queryByTestId('cipher-picker-reset-button')).not.toBeInTheDocument()
  })

  it('counts only in-range rows when the range narrows', async () => {
    renderSheet(undefined, '1.0', '1.1')
    await ready()
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent('All 2 enabled')
  })

  it('saves the default state as undefined (the default list)', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet()
    await ready()
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith(undefined)
  })

  it('closes once Save has written the selection', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderSheet()
    await ready()
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('swallows the drag gesture when pointer-down starts on the close button', async () => {
    const { onClose } = renderSheet()
    await ready()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Close cipher picker' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('cipher-picker-sheet')).toBeInTheDocument()
  })

  it('unchecking a table-1 row materializes the explicit set across BOTH families', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet()
    await ready()
    await user.click(screen.getByTestId('cipher-toggle-ECDHE-RSA-AES128-GCM-SHA256'))
    expect(screen.queryByTestId('cipher-picker-defaults-note')).not.toBeInTheDocument()
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent('6 selected')
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith([
      'ECDHE-RSA-AES256-GCM-SHA384',
      'ECDHE-RSA-AES256-SHA',
      'ECDHE-RSA-AES128-SHA',
      ...FAMILY13,
    ])
  })

  it('unchecking a table-2 row materializes the explicit set across BOTH families', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet()
    await ready()
    await user.click(screen.getByTestId('cipher-toggle-TLS_AES_256_GCM_SHA384'))
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent('6 selected')
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith([
      ...FAMILY12,
      'TLS_AES_128_GCM_SHA256',
      'TLS_CHACHA20_POLY1305_SHA256',
    ])
  })
})

describe('CipherPickerSheet - explicit zero (no ciphers)', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue(CAPABILITIES)
  })

  it('renders both tables fully unchecked with no drag handles', async () => {
    renderSheet([])
    await ready()
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(7)
    for (const checkbox of checkboxes) {
      expect(checkbox).toHaveAttribute('data-state', 'unchecked')
    }
    expect(screen.queryAllByTestId(/^cipher-drag-/)).toHaveLength(0)
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent('0 selected')
    expect(screen.queryByTestId('cipher-picker-defaults-note')).not.toBeInTheDocument()
  })

  it('saves an empty selection as [] (explicit zero, not defaults)', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet([])
    await ready()
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith([])
  })

  it('unchecking the last cipher lands in zero, never back to defaults', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet(['ECDHE-RSA-AES128-SHA'])
    await ready()
    await user.click(screen.getByTestId('cipher-toggle-ECDHE-RSA-AES128-SHA'))
    expect(screen.queryByTestId('cipher-picker-defaults-note')).not.toBeInTheDocument()
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent('0 selected')
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith([])
  })
})

describe('CipherPickerSheet - reset to defaults', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue(CAPABILITIES)
  })

  it('resets an explicit subset back to the all-enabled default', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet(['ECDHE-RSA-AES128-SHA'])
    await ready()
    await user.click(screen.getByTestId('cipher-picker-reset-button'))
    expect(screen.getByTestId('cipher-picker-defaults-note')).toHaveTextContent(
      /^Default$/,
    )
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent('All 7 enabled')
    expect(screen.queryByTestId('cipher-picker-reset-button')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith(undefined)
  })

  it('resets the zero state back to defaults', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet([])
    await ready()
    await user.click(screen.getByTestId('cipher-picker-reset-button'))
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent('All 7 enabled')
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith(undefined)
  })
})

describe('CipherPickerSheet - explicit selection', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue(CAPABILITIES)
  })

  it('orders each table selected-first (value order) then unselected in catalog order', async () => {
    renderSheet([
      'ECDHE-RSA-AES128-SHA',
      'ECDHE-RSA-AES256-GCM-SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
    ])
    await ready()
    expect(rowNames(screen.getByTestId('cipher-table-tls12'))).toEqual([
      'ECDHE-RSA-AES128-SHA',
      'ECDHE-RSA-AES256-GCM-SHA384',
      'ECDHE-RSA-AES128-GCM-SHA256',
      'ECDHE-RSA-AES256-SHA',
    ])
    expect(rowNames(screen.getByTestId('cipher-table-tls13'))).toEqual([
      'TLS_CHACHA20_POLY1305_SHA256',
      'TLS_AES_128_GCM_SHA256',
      'TLS_AES_256_GCM_SHA384',
    ])
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent('3 selected')
  })

  it('exposes drag handles on selected rows only', async () => {
    renderSheet(['ECDHE-RSA-AES128-SHA', 'TLS_AES_128_GCM_SHA256'])
    await ready()
    expect(screen.getByTestId('cipher-drag-ECDHE-RSA-AES128-SHA')).toBeInTheDocument()
    expect(screen.getByTestId('cipher-drag-TLS_AES_128_GCM_SHA256')).toBeInTheDocument()
    expect(screen.queryByTestId('cipher-drag-ECDHE-RSA-AES256-SHA')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cipher-drag-TLS_AES_256_GCM_SHA384')).not.toBeInTheDocument()
  })

  it('checking an unselected row appends it to its family selection (pick order)', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet(['ECDHE-RSA-AES128-SHA'])
    await ready()
    await user.click(screen.getByTestId('cipher-toggle-ECDHE-RSA-AES256-SHA'))
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith(['ECDHE-RSA-AES128-SHA', 'ECDHE-RSA-AES256-SHA'])
  })

  it('checking a 1.3 row keeps it in the table-2 slice of the stored value', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet(['ECDHE-RSA-AES128-SHA'])
    await ready()
    await user.click(screen.getByTestId('cipher-toggle-TLS_AES_256_GCM_SHA384'))
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith(['ECDHE-RSA-AES128-SHA', 'TLS_AES_256_GCM_SHA384'])
  })

  it('saves as table-1 selection ++ table-2 selection regardless of value order', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet(['TLS_AES_256_GCM_SHA384', 'ECDHE-RSA-AES128-SHA'])
    await ready()
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith(['ECDHE-RSA-AES128-SHA', 'TLS_AES_256_GCM_SHA384'])
  })

  it('unchecking a selected cipher removes it (staying explicit)', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet(['ECDHE-RSA-AES128-SHA', 'ECDHE-RSA-AES256-SHA'])
    await ready()
    await user.click(screen.getByTestId('cipher-toggle-ECDHE-RSA-AES128-SHA'))
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith(['ECDHE-RSA-AES256-SHA'])
  })

  it('checking every remaining row stays explicit (no auto-normalize)', async () => {
    const user = userEvent.setup()
    renderSheet(FAMILY12.slice(0, 3))
    await ready()
    await user.click(screen.getByTestId('cipher-toggle-ECDHE-RSA-AES128-SHA'))
    for (const name of FAMILY13) {
      await user.click(screen.getByTestId(`cipher-toggle-${name}`))
    }
    expect(screen.queryByTestId('cipher-picker-defaults-note')).not.toBeInTheDocument()
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent('7 selected')
  })

  it('hides out-of-range selected names and drops them on save', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet(
      ['ECDHE-RSA-AES256-GCM-SHA384', 'ECDHE-RSA-AES256-SHA', 'TLS_AES_128_GCM_SHA256'],
      '1.0',
      '1.1',
    )
    await ready()
    expect(screen.queryByTestId('cipher-row-ECDHE-RSA-AES256-GCM-SHA384')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cipher-row-TLS_AES_128_GCM_SHA256')).not.toBeInTheDocument()
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent('1 selected')
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith(['ECDHE-RSA-AES256-SHA'])
  })

  it('hides a stale name absent from the catalog and drops it on save', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet(['LEGACY-GONE-CIPHER', 'ECDHE-RSA-AES128-SHA'])
    await ready()
    expect(screen.queryByTestId('cipher-row-LEGACY-GONE-CIPHER')).not.toBeInTheDocument()
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent('1 selected')
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith(['ECDHE-RSA-AES128-SHA'])
  })

  it('cancel closes without saving', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderSheet(['ECDHE-RSA-AES128-SHA'])
    await ready()
    await user.click(screen.getByTestId('cipher-picker-cancel-button'))
    expect(onClose).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('CipherPickerSheet - suites named by their IANA names (HTTP-13, HTTP-16)', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue(CAPABILITIES)
  })

  const checkbox = (openssl: string) => screen.getByTestId(`cipher-toggle-${openssl}`)

  it('opens a suite named by its IANA name checked, in the order it was written', async () => {
    renderSheet(['TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA', 'ECDHE-RSA-AES256-GCM-SHA384'])
    await ready()
    expect(checkbox('ECDHE-RSA-AES128-SHA')).toHaveAttribute('data-state', 'checked')
    expect(checkbox('ECDHE-RSA-AES256-GCM-SHA384')).toHaveAttribute('data-state', 'checked')
    expect(rowNames(screen.getByTestId('cipher-table-tls12')).slice(0, 2)).toEqual([
      'ECDHE-RSA-AES128-SHA',
      'ECDHE-RSA-AES256-GCM-SHA384',
    ])
    expect(screen.getByTestId('cipher-drag-ECDHE-RSA-AES128-SHA')).toBeInTheDocument()
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent(/^2 selected$/)
  })

  it('keeps every suite of a mixed OpenSSL and IANA list through a Save with no change, names as written', async () => {
    const user = userEvent.setup()
    const written = ['TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA', 'ECDHE-RSA-AES256-SHA', 'TLS_AES_128_GCM_SHA256']
    const { onSave } = renderSheet(written)
    await ready()
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent(/^3 selected$/)
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith(written)
  })

  it('unchecks a suite named by its IANA name', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet(['TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA', 'ECDHE-RSA-AES256-SHA'])
    await ready()
    await user.click(checkbox('ECDHE-RSA-AES128-SHA'))
    expect(checkbox('ECDHE-RSA-AES128-SHA')).toHaveAttribute('data-state', 'unchecked')
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith(['ECDHE-RSA-AES256-SHA'])
  })

  it('checks it again under its OpenSSL name and keeps the other names as written', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet(['TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA', 'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA'])
    await ready()
    await user.click(checkbox('ECDHE-RSA-AES128-SHA'))
    await user.click(checkbox('ECDHE-RSA-AES128-SHA'))
    await user.click(checkbox('TLS_AES_256_GCM_SHA384'))
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith([
      'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA',
      'ECDHE-RSA-AES128-SHA',
      'TLS_AES_256_GCM_SHA384',
    ])
  })

  it('shows a suite named by both its names once and saves it once, as first written', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet(['TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA', 'ECDHE-RSA-AES128-SHA'])
    await ready()
    expect(screen.getAllByTestId('cipher-row-ECDHE-RSA-AES128-SHA')).toHaveLength(1)
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent(/^1 selected$/)
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith(['TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA'])
  })

  it('unchecks a suite named by both its names under either name', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet(['ECDHE-RSA-AES128-SHA', 'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA', 'ECDHE-RSA-AES256-SHA'])
    await ready()
    await user.click(checkbox('ECDHE-RSA-AES128-SHA'))
    expect(checkbox('ECDHE-RSA-AES128-SHA')).toHaveAttribute('data-state', 'unchecked')
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith(['ECDHE-RSA-AES256-SHA'])
  })

  it('hides an out-of-range suite named by its IANA name and drops it on save', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet(['TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384', 'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA'], '1.0', '1.1')
    await ready()
    expect(screen.queryByTestId('cipher-row-ECDHE-RSA-AES256-GCM-SHA384')).not.toBeInTheDocument()
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent(/^1 selected$/)
    await user.click(screen.getByTestId('cipher-picker-save-button'))
    expect(onSave).toHaveBeenCalledWith(['TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA'])
  })
})

describe('CipherPickerSheet - collapsible tables', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue(CAPABILITIES)
  })

  it('collapses and re-expands the 1.0-1.2 table', async () => {
    const user = userEvent.setup()
    renderSheet()
    await ready()
    const table12 = screen.getByTestId('cipher-table-tls12')
    expect(within(table12).getByTestId('cipher-row-ECDHE-RSA-AES128-SHA')).toBeInTheDocument()
    await user.click(screen.getByTestId('cipher-section-toggle-tls12'))
    expect(within(table12).queryByTestId('cipher-row-ECDHE-RSA-AES128-SHA')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('cipher-section-toggle-tls12'))
    expect(within(table12).getByTestId('cipher-row-ECDHE-RSA-AES128-SHA')).toBeInTheDocument()
  })

  it('collapses the 1.3 table independently', async () => {
    const user = userEvent.setup()
    renderSheet()
    await ready()
    const table13 = screen.getByTestId('cipher-table-tls13')
    await user.click(screen.getByTestId('cipher-section-toggle-tls13'))
    expect(within(table13).queryByTestId('cipher-row-TLS_AES_128_GCM_SHA256')).not.toBeInTheDocument()
    expect(
      within(screen.getByTestId('cipher-table-tls12')).getByTestId('cipher-row-ECDHE-RSA-AES128-SHA'),
    ).toBeInTheDocument()
  })
})

const TLS_FIELDS = new Set(['tls_min_version', 'tls_max_version', 'cipher_suites'])

type TlsBlock = 'http-client' | 'k8s-connect'

/** The Block's own TLS rows as its field list declares them, ungrouped so they render at once. */
function tlsRows(block: TlsBlock): Parameter[] {
  const inputs = (getInputParams(block) ?? []) as unknown as Parameter[]
  return inputs.filter((p) => TLS_FIELDS.has(p.name)).map((p) => ({ ...p, group: undefined }))
}

const HTTP_CIPHER_ROW = tlsRows('http-client').find((p) => p.name === 'cipher_suites') as Parameter

/** A cipher list as the one-line field writes it: JSON text on one line. */
function jsonLine(names: string[]): string {
  return `[${names.map((name) => `"${name}"`).join(', ')}]`
}

/** A cipher list as a Python literal, the form of the {x} hint. */
function pythonList(names: string[]): string {
  return `[${names.map((name) => `'${name}'`).join(', ')}]`
}

function cipherRow(): HTMLElement {
  return screen.getByTestId('param-row-cipher_suites')
}

/** Every text the row shows: its text nodes and the values of its text boxes. */
function shownTexts(container: HTMLElement): string[] {
  const boxes = Array.from(container.querySelectorAll<HTMLInputElement>('input, textarea')).map((box) => box.value)
  return [container.textContent ?? '', ...boxes]
}

function showsText(container: HTMLElement, text: string): boolean {
  return shownTexts(container).some((shown) => shown.includes(text))
}

/** The text box holding exactly this text, else the deepest element whose text it is. */
function elementShowing(container: HTMLElement, text: string): HTMLElement | undefined {
  const box = Array.from(container.querySelectorAll<HTMLInputElement>('input, textarea')).find(
    (candidate) => candidate.value === text,
  )
  if (box) return box
  return Array.from(container.querySelectorAll<HTMLElement>('*'))
    .filter((element) => element.textContent === text)
    .at(-1)
}

/** The gray of a not-set default (Text Muted) sits on the element or on a wrapper inside the row. */
function looksGray(element: HTMLElement, container: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    if (node.classList.contains(HELD_DEFAULT_LOOK_CLASS)) return true
    if (node === container) return false
  }
  return false
}

interface TlsTableProps {
  block?: TlsBlock
  parameters?: Parameter[]
  values?: Record<string, unknown>
  expressionFields?: string[]
  onChange?: (name: string, value: unknown) => void
}

function TlsTable({
  block = 'http-client',
  parameters,
  values = {},
  expressionFields,
  onChange = vi.fn(),
}: Readonly<TlsTableProps>) {
  return (
    <ParameterTable
      mode="input"
      parameters={parameters ?? tlsRows(block)}
      values={values}
      onChange={onChange}
      availableVariables={[]}
      expressionFields={expressionFields}
    />
  )
}

/** The writes the table made to the Cipher Suites row. */
function cipherWrites(onChange: ReturnType<typeof vi.fn>): unknown[][] {
  return onChange.mock.calls.filter(([name]) => name === 'cipher_suites')
}

async function openPickerFromExpand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('param-expand-cipher_suites'))
  await ready()
  expect(screen.getByTestId('cipher-picker-sheet')).toBeInTheDocument()
}

describe('Cipher Suites field - the one-line list and its gray default (FIELD-10)', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue(CAPABILITIES)
  })

  it('shows in gray the HTTP default list for the current TLS versions while not set', async () => {
    render(<TlsTable />)

    await waitFor(() => expect(elementShowing(cipherRow(), jsonLine(HTTP_DEFAULTS_12_13))).toBeDefined())
    expect(looksGray(elementShowing(cipherRow(), jsonLine(HTTP_DEFAULTS_12_13)) as HTMLElement, cipherRow())).toBe(
      true,
    )
  })

  it('follows the TLS versions while not set', async () => {
    const { rerender } = render(<TlsTable />)
    await waitFor(() => expect(showsText(cipherRow(), jsonLine(HTTP_DEFAULTS_12_13))).toBe(true))

    rerender(<TlsTable values={{ tls_min_version: '1.0', tls_max_version: '1.2' }} />)

    await waitFor(() => expect(showsText(cipherRow(), jsonLine(HTTP_DEFAULTS_10_12))).toBe(true))
    expect(showsText(cipherRow(), jsonLine(HTTP_DEFAULTS_12_13))).toBe(false)
  })

  it('reads the K8s Connect defaults on a K8s Connect Block', async () => {
    render(<TlsTable block="k8s-connect" />)

    await waitFor(() => expect(showsText(cipherRow(), jsonLine(K8S_DEFAULTS_12_13))).toBe(true))
    expect(showsText(cipherRow(), jsonLine(HTTP_DEFAULTS_12_13))).toBe(false)
  })

  it('shows a set list as its names and an empty list as [], never the default', async () => {
    const { rerender } = render(<TlsTable values={{ cipher_suites: ['ECDHE-RSA-AES128-SHA'] }} />)
    await waitFor(() => expect(elementShowing(cipherRow(), jsonLine(['ECDHE-RSA-AES128-SHA']))).toBeDefined())
    expect(showsText(cipherRow(), jsonLine(HTTP_DEFAULTS_12_13))).toBe(false)

    rerender(<TlsTable values={{ cipher_suites: [] }} />)

    expect(elementShowing(cipherRow(), '[]')).toBeDefined()
    expect(showsText(cipherRow(), jsonLine(HTTP_DEFAULTS_12_13))).toBe(false)
  })

  it('shows no default list before the payload arrives, then the gray default', async () => {
    let resolve!: (value: typeof CAPABILITIES) => void
    mockedFetch.mockImplementation(() => new Promise((res) => { resolve = res }))
    render(<TlsTable />)

    for (const name of HTTP_DEFAULTS_12_13) expect(showsText(cipherRow(), name)).toBe(false)

    resolve(CAPABILITIES)
    await waitFor(() => expect(elementShowing(cipherRow(), jsonLine(HTTP_DEFAULTS_12_13))).toBeDefined())
  })

  it('keeps the default list as the gray hint, a Python literal, in {x} mode', async () => {
    render(<TlsTable expressionFields={['cipher_suites']} />)

    await waitFor(() =>
      expect(cipherRow().querySelector('.cm-placeholder')?.textContent).toBe(pythonList(HTTP_DEFAULTS_12_13)),
    )
  })

  it('names a cipher outside the TLS versions under the row', async () => {
    render(
      <TlsTable
        values={{
          tls_min_version: '1.0',
          tls_max_version: '1.2',
          cipher_suites: ['ECDHE-RSA-AES256-SHA', 'TLS_AES_128_GCM_SHA256'],
        }}
      />,
    )

    expect(
      await within(cipherRow()).findByText(/^Cipher suite "TLS_AES_128_GCM_SHA256" is not available in TLS 1\.0 to 1\.2$/),
    ).toBeInTheDocument()
    expect(within(cipherRow()).queryByText(/^Cipher suite "ECDHE-RSA-AES256-SHA"/)).not.toBeInTheDocument()
  })
})

describe('Cipher Suites field - expand opens the cipher picker', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue(CAPABILITIES)
  })

  it('draws the row as a one-line list field with expand, not a count button', async () => {
    render(<TlsTable values={{ cipher_suites: ['ECDHE-RSA-AES128-SHA'] }} />)

    await waitFor(() => expect(elementShowing(cipherRow(), jsonLine(['ECDHE-RSA-AES128-SHA']))).toBeDefined())
    expect(within(cipherRow()).getByTestId('param-expand-cipher_suites')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Ciphers' })).not.toBeInTheDocument()
  })

  it('opens the picker from expand and routes the saved order to onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <TlsTable values={{ tls_min_version: '1.0', cipher_suites: ['ECDHE-RSA-AES128-SHA'] }} onChange={onChange} />,
    )

    await openPickerFromExpand(user)
    await user.click(screen.getByTestId('cipher-toggle-ECDHE-RSA-AES256-SHA'))
    await user.click(screen.getByTestId('cipher-picker-save-button'))

    expect(onChange).toHaveBeenCalledWith('cipher_suites', ['ECDHE-RSA-AES128-SHA', 'ECDHE-RSA-AES256-SHA'])
  })

  it('opens the picker of a not-set field in its default state: every suite of its TLS range enabled, no Reset', async () => {
    const user = userEvent.setup()
    render(<TlsTable values={{}} />)

    await openPickerFromExpand(user)

    expect(rowNames(screen.getByTestId('cipher-table-tls12'))).toEqual(FAMILY12)
    expect(rowNames(screen.getByTestId('cipher-table-tls13'))).toEqual(FAMILY13)
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toHaveAttribute('data-state', 'checked')
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent(/^All 7 enabled$/)
    expect(screen.getByTestId('cipher-picker-defaults-note')).toHaveTextContent(/^Default$/)
    expect(screen.queryByTestId('cipher-picker-reset-button')).not.toBeInTheDocument()
  })

  it('keeps a not-set field not set after a Save with no change', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TlsTable values={{}} onChange={onChange} />)

    await openPickerFromExpand(user)
    await user.click(screen.getByTestId('cipher-picker-save-button'))

    expect(cipherWrites(onChange).every(([, value]) => value === undefined)).toBe(true)
  })

  it('makes any change in the picker of a not-set field the user value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TlsTable values={{}} onChange={onChange} />)

    await openPickerFromExpand(user)
    await user.click(screen.getByTestId('cipher-toggle-ECDHE-RSA-AES128-GCM-SHA256'))
    await user.click(screen.getByTestId('cipher-picker-save-button'))

    expect(onChange).toHaveBeenCalledWith(
      'cipher_suites',
      [...FAMILY12, ...FAMILY13].filter((name) => name !== 'ECDHE-RSA-AES128-GCM-SHA256'),
    )
  })

  it('keeps suites typed in the field under their IANA names through a picker Save with no change', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const typed = ['TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA', 'TLS_AES_128_GCM_SHA256']
    render(<TlsTable values={{ tls_min_version: '1.0', cipher_suites: typed }} onChange={onChange} />)

    await openPickerFromExpand(user)
    expect(screen.getByTestId('cipher-picker-metric')).toHaveTextContent(/^2 selected$/)
    await user.click(screen.getByTestId('cipher-picker-save-button'))

    expect(cipherWrites(onChange)).toEqual([['cipher_suites', typed]])
  })

  it('routes a reset-to-default save as not set', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TlsTable values={{ cipher_suites: ['ECDHE-RSA-AES128-SHA'] }} onChange={onChange} />)

    await openPickerFromExpand(user)
    await user.click(screen.getByTestId('cipher-picker-reset-button'))
    await user.click(screen.getByTestId('cipher-picker-save-button'))

    expect(onChange).toHaveBeenCalledWith('cipher_suites', undefined)
  })

  it('closes the picker on cancel without routing a change', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TlsTable values={{ cipher_suites: ['ECDHE-RSA-AES128-SHA'] }} onChange={onChange} />)

    await openPickerFromExpand(user)
    await user.click(screen.getByTestId('cipher-picker-cancel-button'))

    expect(screen.queryByTestId('cipher-picker-sheet')).not.toBeInTheDocument()
    expect(cipherWrites(onChange)).toEqual([])
  })

  it('threads the TLS versions into the picker filtering', async () => {
    const user = userEvent.setup()
    render(<TlsTable values={{ tls_min_version: '1.0', tls_max_version: '1.1' }} />)

    await openPickerFromExpand(user)

    expect(screen.getByTestId('cipher-row-ECDHE-RSA-AES128-SHA')).toBeInTheDocument()
    expect(screen.queryByTestId('cipher-row-ECDHE-RSA-AES128-GCM-SHA256')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cipher-table-tls13')).not.toBeInTheDocument()
  })

  it('resolves absent TLS versions from their declared defaults (1.2 / 1.3)', async () => {
    const user = userEvent.setup()
    render(<TlsTable values={{}} />)

    await openPickerFromExpand(user)

    expect(rowNames(screen.getByTestId('cipher-table-tls12'))).toEqual(FAMILY12)
    expect(rowNames(screen.getByTestId('cipher-table-tls13'))).toEqual(FAMILY13)
  })
})

describe('the parent the cipher picker was opened from', () => {
  function renderInParent(value?: string[]) {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(
      <ChildEditorParent>
        <CipherPickerSheet
          label="Cipher Suites"
          value={value}
          minVersion="1.0"
          maxVersion="1.3"
          onSave={onSave}
          onClose={onClose}
        />
      </ChildEditorParent>,
    )
    return { onSave, onClose }
  }

  it('reports that it cannot be saved until the inventory has loaded', async () => {
    renderInParent()
    expect(parentChildren()).toEqual([
      { label: 'Cipher Suites', hasChanges: false, cannotBeSaved: true },
    ])
    await ready()
  })

  it('reports its row label with no changes once loaded', async () => {
    renderInParent()
    await ready()
    expect(parentChildren()).toEqual([
      { label: 'Cipher Suites', hasChanges: false, cannotBeSaved: false },
    ])
  })

  it('reports changes once the selection differs from the value it opened with', async () => {
    const user = userEvent.setup()
    renderInParent()
    await ready()
    await user.click(screen.getByTestId('cipher-toggle-TLS_AES_256_GCM_SHA384'))
    expect(parentChildren()).toEqual([
      { label: 'Cipher Suites', hasChanges: true, cannotBeSaved: false },
    ])
  })

  it('lets the parent write the selection without closing', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderInParent(['ECDHE-RSA-AES128-SHA'])
    await ready()
    await user.click(screen.getByTestId('cipher-picker-reset-button'))

    act(() => applyParentChildren())

    expect(onSave).toHaveBeenCalledExactlyOnceWith(undefined)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Cipher Suites field - the row a picker is named after', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue(CAPABILITIES)
  })

  it('names an unlabeled row by its field name', async () => {
    const user = userEvent.setup()
    render(
      <ChildEditorParent>
        <TlsTable parameters={[{ ...HTTP_CIPHER_ROW, label: undefined }]} />
      </ChildEditorParent>,
    )

    await openPickerFromExpand(user)
    await user.click(screen.getByTestId('cipher-toggle-TLS_AES_256_GCM_SHA384'))

    expect(parentChildren()).toEqual([
      { label: 'cipher_suites', hasChanges: true, cannotBeSaved: false },
    ])
  })
})
