/**
 * ParameterRow - the Browse affordance on file-reference rows (TDATA-8, REQ-3.4.1.6)
 * and the row a descriptor locks while its block runs on a remote host (HTTP-13).
 *
 * Design Reference: REQ-3.4.2.2
 */

import { useImperativeHandle, type Ref } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const pickerHandle = vi.hoisted(() => ({ refocus: vi.fn() }))

interface PickerMockProps {
  ref?: Ref<SheetHandle>
  label: string
  mode: string
  artifactsOnly?: boolean
  initialValue: string
  presetName?: string
  testId: string | null
  onChoose: (value: string) => void
  onClose: () => void
}

vi.mock('@/features/workbench/common/element-config/parameters/file-reference-picker-sheet', () => ({
  FileReferencePickerSheet: function PickerMock({
    ref,
    label,
    mode,
    artifactsOnly,
    initialValue,
    presetName,
    testId,
    onChoose,
    onClose,
  }: PickerMockProps) {
    useImperativeHandle(ref, () => ({ refocus: pickerHandle.refocus }))
    return (
      <span
        data-testid="picker-mock"
        data-label={label}
        data-mode={mode}
        data-artifacts-only={String(!!artifactsOnly)}
        data-initial-value={initialValue}
        data-preset-name={presetName ?? ''}
        data-test-id-prop={testId ?? ''}
      >
        <button
          type="button"
          data-testid="picker-mock-choose"
          onClick={() => {
            onChoose('testdata://fixtures/users.csv')
            onClose()
          }}
        >
          choose
        </button>
        <button type="button" data-testid="picker-mock-close" onClick={onClose}>
          close
        </button>
      </span>
    )
  },
}))

// The "Edit value" sheet is heavy (CodeMirror) and irrelevant here.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: () => null,
}))

import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import type { SheetHandle } from '@/components/shared/draggable-sheet'

const READ_PATH = {
  name: 'path',
  label: 'Path',
  type: 'string' as const,
  required: true,
  fileReference: 'file' as const,
}

const WRITE_PATH = {
  name: 'path',
  label: 'Path',
  type: 'string' as const,
  required: true,
  fileReference: 'save-as' as const,
}

const MOVE_SOURCE = {
  name: 'source',
  label: 'Source',
  type: 'string' as const,
  required: true,
  fileReference: 'file-or-folder' as const,
  fileReferenceArtifactsOnly: true,
}

const DESTINATION = {
  name: 'destination',
  label: 'Destination',
  type: 'string' as const,
  required: true,
  fileReference: 'save-as' as const,
}

// SFTP Download's Destination: the WAVE-side row, save-as, optional.
const SFTP_DOWNLOAD_DESTINATION = {
  name: 'destination',
  label: 'Destination',
  type: 'string' as const,
  required: false,
  showWhen: { field: 'operation', values: ['download'] },
  allowedFormats: ['plain'],
  fileReference: 'save-as' as const,
}

const PLAIN_PATH = {
  name: 'working_dir',
  label: 'Working Directory',
  type: 'string' as const,
  required: false,
}

// Load table's Table row: a file path with Browse in literal mode, a table variable as an expression.
const LOAD_TABLE = {
  name: 'table',
  label: 'Table',
  type: 'table' as const,
  required: false,
  requiredWhen: { field: 'operation', values: ['load_table'] },
  showWhen: { field: 'operation', values: ['load_table'] },
  fileReference: 'file' as const,
  retainOnHide: true,
}

const REMOTE_HOST_TEXT = "Remote host's settings"

// The HTTP Proxy row: its descriptor locks it while the block runs on a remote host.
const PROXY_MODE: Parameter = {
  name: 'proxy_mode',
  label: 'Proxy',
  type: 'string',
  required: false,
  defaultValue: 'wave-setting',
  enumValues: ['wave-setting', 'off'],
  enumLabels: { 'wave-setting': 'WAVE setting', off: 'Off' },
  noExpression: true,
  lockedOnRemoteHost: { displayText: REMOTE_HOST_TEXT },
}

// An enum row whose descriptor carries no lock.
const METHOD: Parameter = {
  name: 'method',
  label: 'Method',
  type: 'string',
  required: true,
  defaultValue: 'GET',
  enumValues: ['GET', 'POST'],
}

const PROXY_CHOICES = [
  { stored: 'wave-setting', label: 'WAVE setting' },
  { stored: 'off', label: 'Off' },
]

const baseRowProps = {
  mode: 'input' as const,
  availableVariables: [] as { name: string; type: string }[],
  expressionFields: [] as string[],
  onExpressionFieldsChange: vi.fn(),
  templateFields: [] as string[],
  onTemplateFieldsChange: vi.fn(),
  runsOnRemoteHost: false,
  readOnly: false,
  testId: 'test-1',
}

type RowProps = React.ComponentProps<typeof ParameterRow>

function renderRow(props: Partial<RowProps> & Pick<RowProps, 'parameter'>) {
  const onChange = vi.fn()
  render(
    <table>
      <tbody>
        <ParameterRow {...baseRowProps} value="" onChange={onChange} {...props} />
      </tbody>
    </table>,
  )
  return { onChange }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Browse button gating', () => {
  it('renders on a literal file-reference row of an editable local block', () => {
    renderRow({ parameter: READ_PATH })
    expect(screen.getByTestId('param-browse-path')).toBeInTheDocument()
  })

  it('is as tall as the 32px value field, not the 36px icon size', () => {
    renderRow({ parameter: READ_PATH })
    expect(screen.getByTestId('param-browse-path')).toHaveClass('h-8', 'w-8')
    expect(screen.getByTestId('param-browse-path')).not.toHaveClass('h-9')
  })

  it('is absent on a row with no fileReference', () => {
    renderRow({ parameter: PLAIN_PATH })
    expect(screen.queryByTestId('param-browse-working_dir')).not.toBeInTheDocument()
  })

  it('is absent while the row is in expression mode', () => {
    renderRow({ parameter: READ_PATH, expressionFields: ['path'] })
    expect(screen.queryByTestId('param-browse-path')).not.toBeInTheDocument()
  })

  it('is absent on a read-only canvas', () => {
    renderRow({ parameter: READ_PATH, readOnly: true })
    expect(screen.queryByTestId('param-browse-path')).not.toBeInTheDocument()
  })

  it('is absent when the block runs on the execution host', () => {
    renderRow({ parameter: READ_PATH, runsOnRemoteHost: true })
    expect(screen.queryByTestId('param-browse-path')).not.toBeInTheDocument()
  })
})

describe('Browse button placement and labeling', () => {
  it('sits between the value wrapper and the expression toggle', () => {
    renderRow({ parameter: READ_PATH })
    const row = screen.getByTestId('param-row-path')
    const value = within(row).getByRole('textbox', { name: 'Path' })
    const browse = within(row).getByTestId('param-browse-path')
    const toggle = within(row).getByTestId('expression-toggle')
    expect(value.compareDocumentPosition(browse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(browse.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('names the button after the row label', () => {
    renderRow({ parameter: READ_PATH })
    expect(screen.getByTestId('param-browse-path')).toHaveAttribute(
      'aria-label',
      'Browse files for Path',
    )
  })

  it('names the button after the wire name when the row has no label', () => {
    renderRow({ parameter: { ...READ_PATH, label: undefined } })
    expect(screen.getByTestId('param-browse-path')).toHaveAttribute(
      'aria-label',
      'Browse files for path',
    )
  })

  it('hints at both sources on a read row', async () => {
    const user = userEvent.setup()
    renderRow({ parameter: READ_PATH })
    await user.hover(screen.getByTestId('param-browse-path'))
    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveTextContent('Browse Test Data and Artifacts')
    })
  })

  it('hints at artifacts only on a save-as row', async () => {
    const user = userEvent.setup()
    renderRow({ parameter: WRITE_PATH })
    await user.hover(screen.getByTestId('param-browse-path'))
    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveTextContent('Browse Artifacts')
    })
  })
})

describe('Browse opens the picker', () => {
  it('opens nothing until Browse is pressed', () => {
    renderRow({ parameter: READ_PATH })
    expect(screen.queryByTestId('picker-mock')).not.toBeInTheDocument()
  })

  it('opens the picker in the descriptor mode with the row value and the open test', async () => {
    const user = userEvent.setup()
    renderRow({
      parameter: READ_PATH,
      value: 'testdata://fixtures/orders.json',
      testId: 'test-42',
    })
    await user.click(screen.getByTestId('param-browse-path'))
    const picker = screen.getByTestId('picker-mock')
    expect(picker).toHaveAttribute('data-mode', 'file')
    expect(picker).toHaveAttribute('data-initial-value', 'testdata://fixtures/orders.json')
    expect(picker).toHaveAttribute('data-test-id-prop', 'test-42')
  })

  it('raises the open picker on a second press instead of opening another', async () => {
    const user = userEvent.setup()
    renderRow({ parameter: SFTP_DOWNLOAD_DESTINATION, allValues: { operation: 'download' } })
    await user.click(screen.getByTestId('param-browse-destination'))
    expect(pickerHandle.refocus).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('param-browse-destination'))

    expect(screen.getAllByTestId('picker-mock')).toHaveLength(1)
    expect(pickerHandle.refocus).toHaveBeenCalledOnce()
  })

  it('opens the picker in save-as mode for a write row', async () => {
    const user = userEvent.setup()
    renderRow({ parameter: WRITE_PATH })
    await user.click(screen.getByTestId('param-browse-path'))
    expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-mode', 'save-as')
  })

  it('passes artifactsOnly from the descriptor', async () => {
    const user = userEvent.setup()
    renderRow({ parameter: MOVE_SOURCE })
    await user.click(screen.getByTestId('param-browse-source'))
    const picker = screen.getByTestId('picker-mock')
    expect(picker).toHaveAttribute('data-mode', 'file-or-folder')
    expect(picker).toHaveAttribute('data-artifacts-only', 'true')
  })

  it('leaves artifactsOnly off when the descriptor does not set it', async () => {
    const user = userEvent.setup()
    renderRow({ parameter: READ_PATH })
    await user.click(screen.getByTestId('param-browse-path'))
    expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-artifacts-only', 'false')
  })

  it('presets the Name from the sibling source file name on a destination row', async () => {
    const user = userEvent.setup()
    renderRow({
      parameter: DESTINATION,
      allValues: { source: 'testdata://fixtures/users.csv', destination: '' },
    })
    await user.click(screen.getByTestId('param-browse-destination'))
    expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-preset-name', 'users.csv')
  })

  it('presets the Name from a sibling source folder name', async () => {
    const user = userEvent.setup()
    renderRow({
      parameter: DESTINATION,
      allValues: { source: 'testdata://fixtures', destination: '' },
    })
    await user.click(screen.getByTestId('param-browse-destination'))
    expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-preset-name', 'fixtures')
  })

  it('presets no Name when the sibling source is unset', async () => {
    const user = userEvent.setup()
    renderRow({ parameter: DESTINATION })
    await user.click(screen.getByTestId('param-browse-destination'))
    expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-preset-name', '')
  })

  it('presets no Name while the sibling source is an expression', async () => {
    const user = userEvent.setup()
    renderRow({
      parameter: DESTINATION,
      allValues: { source: 'testdata://fixtures/users.csv', destination: '' },
      expressionFields: ['source'],
    })
    await user.click(screen.getByTestId('param-browse-destination'))
    expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-preset-name', '')
  })

  it('presets no Name on a row that is not the destination', async () => {
    const user = userEvent.setup()
    renderRow({
      parameter: WRITE_PATH,
      allValues: { source: 'testdata://fixtures/users.csv' },
    })
    await user.click(screen.getByTestId('param-browse-path'))
    expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-preset-name', '')
  })

  it('presets the Name from a plain server-side source file name', async () => {
    const user = userEvent.setup()
    renderRow({
      parameter: SFTP_DOWNLOAD_DESTINATION,
      allValues: { operation: 'download', source: '/outbound/orders.out', destination: '' },
    })
    await user.click(screen.getByTestId('param-browse-destination'))
    expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-preset-name', 'orders.out')
  })

  // SFTP-3: a wildcard source names several files, so no single Name fits.
  it.each(['/outbound/*.csv', '/outbound/report-?.txt', '/outbound/[ab].log'])(
    'presets no Name while the sibling source %s is a wildcard',
    async (source) => {
      const user = userEvent.setup()
      renderRow({
        parameter: SFTP_DOWNLOAD_DESTINATION,
        allValues: { operation: 'download', source, destination: '' },
      })
      await user.click(screen.getByTestId('param-browse-destination'))
      expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-mode', 'save-as')
      expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-preset-name', '')
    },
  )

  it('writes the chosen reference into the row', async () => {
    const user = userEvent.setup()
    const { onChange } = renderRow({ parameter: READ_PATH })
    await user.click(screen.getByTestId('param-browse-path'))
    await user.click(screen.getByTestId('picker-mock-choose'))
    expect(onChange).toHaveBeenCalledWith('testdata://fixtures/users.csv')
  })

  it('names the row the picker was opened from', async () => {
    const user = userEvent.setup()
    renderRow({ parameter: READ_PATH })
    await user.click(screen.getByTestId('param-browse-path'))
    expect(screen.getByTestId('picker-mock')).toHaveAttribute('data-label', 'Path')
  })

  it('closes the picker once a reference is chosen', async () => {
    const user = userEvent.setup()
    renderRow({ parameter: READ_PATH })
    await user.click(screen.getByTestId('param-browse-path'))
    await user.click(screen.getByTestId('picker-mock-choose'))
    expect(screen.queryByTestId('picker-mock')).not.toBeInTheDocument()
  })

  it('closes the picker on cancel without touching the row', async () => {
    const user = userEvent.setup()
    const { onChange } = renderRow({ parameter: READ_PATH })
    await user.click(screen.getByTestId('param-browse-path'))
    await user.click(screen.getByTestId('picker-mock-close'))
    expect(screen.queryByTestId('picker-mock')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('file-reference row preview', () => {
  const LONG_VALUE = 'testdata://fixtures/regression/january/customers/users.csv'

  it('carries the whole reference in the hover title', () => {
    renderRow({ parameter: READ_PATH, value: LONG_VALUE })
    const row = screen.getByTestId('param-row-path')
    expect(within(row).getByTitle(LONG_VALUE)).toBeInTheDocument()
  })

  it('keeps the whole reference in the preview text so the truncation stays visual', () => {
    renderRow({ parameter: READ_PATH, value: LONG_VALUE })
    const row = screen.getByTestId('param-row-path')
    expect(within(within(row).getByTitle(LONG_VALUE)).getByRole('textbox', { name: 'Path' })).toHaveValue(LONG_VALUE)
  })

  it('adds no title to a row that is not a file reference', () => {
    renderRow({ parameter: PLAIN_PATH, value: LONG_VALUE })
    const row = screen.getByTestId('param-row-working_dir')
    expect(within(row).queryByTitle(LONG_VALUE)).not.toBeInTheDocument()
  })

  it('shows the end of a long reference, the file name, cut with no ellipsis', async () => {
    renderRow({ parameter: READ_PATH, value: LONG_VALUE })
    const box = within(screen.getByTestId('param-row-path')).getByRole('textbox', { name: 'Path' })
    const scrolledTo = vi.fn()
    Object.defineProperty(box, 'scrollWidth', { configurable: true, get: () => 500 })
    Object.defineProperty(box, 'scrollLeft', { configurable: true, get: () => 0, set: scrolledTo })
    await vi.waitFor(() => expect(scrolledTo).toHaveBeenCalledWith(500))
    expect(box).toHaveClass('text-clip')
  })
})

describe('a table-typed file-reference row (SQL Load table)', () => {
  const CSV = 'testdata://fixtures/users.csv'
  const LOAD_VALUES = { operation: 'load_table', table: CSV }

  it('shows Browse beside a literal path', () => {
    renderRow({ parameter: LOAD_TABLE, value: CSV, allValues: LOAD_VALUES })
    expect(screen.getByTestId('param-browse-table')).toBeInTheDocument()
  })

  it('never flags the literal path as a type mismatch', () => {
    const onValidationChange = vi.fn()
    renderRow({
      parameter: LOAD_TABLE,
      value: CSV,
      allValues: LOAD_VALUES,
      availableVariables: [{ name: 'users', type: 'table' }],
      onValidationChange,
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onValidationChange).toHaveBeenCalledWith('table', null)
  })

  it('opens the picker in file mode on the literal path', async () => {
    const user = userEvent.setup()
    renderRow({ parameter: LOAD_TABLE, value: CSV, allValues: LOAD_VALUES })
    await user.click(screen.getByTestId('param-browse-table'))
    const picker = screen.getByTestId('picker-mock')
    expect(picker).toHaveAttribute('data-mode', 'file')
    expect(picker).toHaveAttribute('data-initial-value', CSV)
  })

  it('writes the chosen reference into the row', async () => {
    const user = userEvent.setup()
    const { onChange } = renderRow({ parameter: LOAD_TABLE, allValues: { operation: 'load_table' } })
    await user.click(screen.getByTestId('param-browse-table'))
    await user.click(screen.getByTestId('picker-mock-choose'))
    expect(onChange).toHaveBeenCalledWith('testdata://fixtures/users.csv')
  })

  it('offers no Browse while the row names a table variable in expression mode', () => {
    renderRow({
      parameter: LOAD_TABLE,
      value: 'users',
      allValues: { operation: 'load_table', table: 'users' },
      expressionFields: ['table'],
      availableVariables: [{ name: 'users', type: 'table' }],
    })
    expect(screen.queryByTestId('param-browse-table')).not.toBeInTheDocument()
    expect(screen.getByTestId('param-input-table')).toBeInTheDocument()
  })
})

describe('a row its descriptor locks on a remote host (HTTP-13)', () => {
  function proxyRow(): HTMLElement {
    return screen.getByTestId('param-row-proxy_mode')
  }

  function proxyControl(): HTMLElement {
    return within(proxyRow()).getByRole('combobox', { name: 'Proxy' })
  }

  function proxyRowOn(
    runsOnRemoteHost: boolean,
    stored: string,
    onChange: (value: unknown) => void,
  ) {
    return (
      <table>
        <tbody>
          <ParameterRow
            {...baseRowProps}
            parameter={PROXY_MODE}
            value={stored}
            onChange={onChange}
            runsOnRemoteHost={runsOnRemoteHost}
          />
        </tbody>
      </table>
    )
  }

  it.each(PROXY_CHOICES)(
    'is disabled and reads the remote text while $stored is stored',
    ({ stored }) => {
      renderRow({ parameter: PROXY_MODE, value: stored, runsOnRemoteHost: true })
      expect(proxyControl()).toBeDisabled()
      expect(proxyControl().textContent).toBe(REMOTE_HOST_TEXT)
    },
  )

  it('reads the remote text while no choice is stored', () => {
    renderRow({ parameter: PROXY_MODE, value: undefined, runsOnRemoteHost: true })
    expect(proxyControl()).toBeDisabled()
    expect(proxyControl().textContent).toBe(REMOTE_HOST_TEXT)
  })

  it('reads the remote text on a locked row that has no default and stores nothing', () => {
    renderRow({
      parameter: { ...PROXY_MODE, defaultValue: undefined },
      value: undefined,
      runsOnRemoteHost: true,
    })
    expect(proxyControl()).toBeDisabled()
    expect(proxyControl().textContent).toBe(REMOTE_HOST_TEXT)
  })

  it('carries the grayed-out look and the not-allowed cursor on the row', () => {
    renderRow({ parameter: PROXY_MODE, value: 'off', runsOnRemoteHost: true })
    expect(proxyRow()).toHaveClass('opacity-50', 'cursor-not-allowed')
  })

  it.each(PROXY_CHOICES)(
    'reports no change and opens no menu while $stored is stored',
    async ({ stored }) => {
      const user = userEvent.setup()
      const { onChange } = renderRow({
        parameter: PROXY_MODE,
        value: stored,
        runsOnRemoteHost: true,
      })
      await user.click(proxyControl())
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
    },
  )

  it('raises no validation error while locked', () => {
    const onValidationChange = vi.fn()
    renderRow({
      parameter: PROXY_MODE,
      value: 'off',
      runsOnRemoteHost: true,
      onValidationChange,
    })
    expect(proxyControl()).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onValidationChange).toHaveBeenCalledWith('proxy_mode', null)
    expect(onValidationChange).not.toHaveBeenCalledWith('proxy_mode', expect.any(String))
  })

  it.each(PROXY_CHOICES)(
    'shows the stored $label again, enabled, once the block is back on the WAVE host',
    ({ stored, label }) => {
      const onChange = vi.fn()
      const { rerender } = render(proxyRowOn(true, stored, onChange))
      expect(proxyControl()).toBeDisabled()
      expect(proxyControl().textContent).toBe(REMOTE_HOST_TEXT)

      rerender(proxyRowOn(false, stored, onChange))
      expect(proxyControl()).toBeEnabled()
      expect(proxyControl().textContent).toBe(label)
      expect(proxyRow()).not.toHaveClass('opacity-50')
      expect(proxyRow()).not.toHaveClass('cursor-not-allowed')
      expect(onChange).not.toHaveBeenCalled()
    },
  )

  it.each(PROXY_CHOICES)('shows $label, enabled, on the WAVE host', ({ stored, label }) => {
    renderRow({ parameter: PROXY_MODE, value: stored })
    expect(proxyControl()).toBeEnabled()
    expect(proxyControl().textContent).toBe(label)
    expect(proxyRow()).not.toHaveClass('opacity-50')
  })

  it('leaves a row without the lock editable on a remote host', () => {
    renderRow({ parameter: METHOD, value: 'POST', runsOnRemoteHost: true })
    const row = screen.getByTestId('param-row-method')
    const control = within(row).getByRole('combobox', { name: 'Method' })
    expect(control).toBeEnabled()
    expect(control.textContent).toBe('POST')
    expect(row).not.toHaveClass('opacity-50')
    expect(row).not.toHaveClass('cursor-not-allowed')
  })
})
