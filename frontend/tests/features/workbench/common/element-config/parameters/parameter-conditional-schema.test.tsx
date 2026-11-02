/**
 * Conjunctive visibility (showWhenAll), locked controls (lockedWhen and the
 * remote-host lock of the HTTP Proxy row, HTTP-13), conditional required
 * markers (requiredWhen / requiredWhenAll), grouped note containers, and the
 * expected-headers in-field advisory.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ParameterTable } from '@/features/workbench/common/element-config/parameters/parameter-table'
import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'
import { getInputParams } from '@/features/workbench/lib/node-parameters'
import {
  isParameterVisible,
  type Parameter,
} from '@/features/workbench/common/element-config/parameters/parameter-table-types'

const NO_VARS: { name: string; type: string }[] = []

function renderTable(
  parameters: Parameter[],
  values: Record<string, unknown>,
  extraProps: Record<string, unknown> = {},
) {
  const onChange = vi.fn()
  render(
    <ParameterTable
      mode="input"
      parameters={parameters}
      values={values}
      onChange={onChange}
      availableVariables={NO_VARS}
      groupMeta={{
        Auth: { name: 'Auth', description: 'auth section', defaultExpanded: true },
        Body: { name: 'Body', description: 'body section', defaultExpanded: true },
      }}
      {...extraProps}
    />,
  )
  return { onChange }
}

function renderTableForRerender(parameters: Parameter[], values: Record<string, unknown>) {
  return render(
    <ParameterTable
      mode="input"
      parameters={parameters}
      values={values}
      onChange={vi.fn()}
      availableVariables={NO_VARS}
    />,
  )
}

const AUTH_BASIC = [
  { field: 'auth_enabled', values: ['true'] },
  { field: 'auth_mode', values: ['basic'] },
]

const AUTH_PARAMS: Parameter[] = [
  { name: 'auth_enabled', type: 'boolean', required: false, defaultValue: false, group: 'Auth' },
  {
    name: 'auth_mode',
    type: 'string',
    required: false,
    defaultValue: 'basic',
    enumValues: ['basic', 'bearer', 'api_key'],
    group: 'Auth',
    showWhen: { field: 'auth_enabled', values: ['true'] },
  },
  {
    name: 'auth_username',
    label: 'Username',
    type: 'string',
    required: false,
    group: 'Auth',
    showWhenAll: AUTH_BASIC,
    requiredWhenAll: AUTH_BASIC,
  },
]

describe('isParameterVisible - showWhenAll (conjunctive)', () => {
  const param = AUTH_PARAMS[2]

  it('hides while any condition misses (auth off)', () => {
    expect(isParameterVisible(param, {}, AUTH_PARAMS)).toBe(false)
  })

  it('shows when every condition matches, resolving defaults (mode defaults to basic)', () => {
    expect(isParameterVisible(param, { auth_enabled: true }, AUTH_PARAMS)).toBe(true)
  })

  it('hides when a later condition misses (bearer mode)', () => {
    expect(
      isParameterVisible(param, { auth_enabled: true, auth_mode: 'bearer' }, AUTH_PARAMS),
    ).toBe(false)
  })
})

describe('ParameterTable - showWhenAll rendering', () => {
  it('renders no mode-gated auth rows while auth is off', () => {
    renderTable(AUTH_PARAMS, {})
    expect(screen.queryByTestId('param-row-auth_username')).not.toBeInTheDocument()
    expect(screen.queryByTestId('param-row-auth_mode')).not.toBeInTheDocument()
  })

  it('renders the basic-mode rows once auth is on', () => {
    renderTable(AUTH_PARAMS, { auth_enabled: true })
    expect(screen.getByTestId('param-row-auth_mode')).toBeInTheDocument()
    expect(screen.getByTestId('param-row-auth_username')).toBeInTheDocument()
  })

  it('hides the basic-mode rows in bearer mode', () => {
    renderTable(AUTH_PARAMS, { auth_enabled: true, auth_mode: 'bearer' })
    expect(screen.queryByTestId('param-row-auth_username')).not.toBeInTheDocument()
  })
})

const CLEANUP_ANY = [
  { field: 'atomic', values: ['true'] },
  { field: 'cleanup_on_fail', values: ['true'] },
]

const CLEANUP_PARAMS: Parameter[] = [
  { name: 'atomic', type: 'boolean', required: false, defaultValue: false },
  { name: 'cleanup_on_fail', type: 'boolean', required: false, defaultValue: false },
  {
    name: 'cleanup_timeout',
    label: 'Cleanup Timeout',
    type: 'integer',
    required: false,
    defaultValue: 300,
    showWhenAny: CLEANUP_ANY,
  },
]

describe('isParameterVisible - showWhenAny (disjunctive)', () => {
  const param = CLEANUP_PARAMS[2]

  it('hides while every condition misses', () => {
    expect(isParameterVisible(param, {}, CLEANUP_PARAMS)).toBe(false)
  })

  it('shows on the first condition alone', () => {
    expect(isParameterVisible(param, { atomic: true }, CLEANUP_PARAMS)).toBe(true)
  })

  it('shows on the second condition alone', () => {
    expect(isParameterVisible(param, { cleanup_on_fail: true }, CLEANUP_PARAMS)).toBe(true)
  })

  it('shows once with both conditions met', () => {
    expect(
      isParameterVisible(param, { atomic: true, cleanup_on_fail: true }, CLEANUP_PARAMS),
    ).toBe(true)
  })

  it('hides again when the last one is unticked', () => {
    expect(
      isParameterVisible(param, { atomic: false, cleanup_on_fail: false }, CLEANUP_PARAMS),
    ).toBe(false)
  })
})

describe('ParameterTable - showWhenAny rendering', () => {
  it('renders no cleanup-room row while neither flag is ticked', () => {
    renderTable(CLEANUP_PARAMS, {})
    expect(screen.queryByTestId('param-row-cleanup_timeout')).not.toBeInTheDocument()
  })

  it('renders the row on either flag', () => {
    renderTable(CLEANUP_PARAMS, { cleanup_on_fail: true })
    expect(screen.getByTestId('param-row-cleanup_timeout')).toBeInTheDocument()
  })

  it('clears the value when the last flag goes off', async () => {
    const { rerender } = renderTableForRerender(CLEANUP_PARAMS, { atomic: true, cleanup_timeout: 45 })
    const onChange = vi.fn()
    rerender(
      <ParameterTable
        mode="input"
        parameters={CLEANUP_PARAMS}
        values={{ atomic: false, cleanup_timeout: 45 }}
        onChange={onChange}
        availableVariables={NO_VARS}
      />,
    )
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('cleanup_timeout', undefined))
  })
})

describe('ParameterRow - requiredWhenAll and requiredWhen markers', () => {
  it('marks the field required (asterisk + eager message) only while every condition holds', () => {
    renderTable(AUTH_PARAMS, { auth_enabled: true })
    const row = screen.getByTestId('param-row-auth_username')
    expect(within(row).getByText('*')).toBeInTheDocument()
    expect(within(row).getByRole('alert').textContent).toBe('Username is required')
  })

  it('marks a requiredWhen row required while its one condition holds (file_source)', () => {
    const params: Parameter[] = [
      {
        name: 'body_mode',
        type: 'string',
        required: false,
        defaultValue: 'text',
        enumValues: ['text', 'form', 'multipart', 'file'],
      },
      {
        name: 'file_source',
        label: 'File Source',
        type: 'string',
        required: false,
        showWhen: { field: 'body_mode', values: ['file'] },
        requiredWhen: { field: 'body_mode', values: ['file'] },
      },
    ]
    renderTable(params, { body_mode: 'file' })
    const row = screen.getByTestId('param-row-file_source')
    expect(within(row).getByText('*')).toBeInTheDocument()
    expect(within(row).getByRole('alert').textContent).toBe('File Source is required')
  })

  it('shows no required marker while the condition misses', () => {
    const params: Parameter[] = [
      {
        name: 'body_mode',
        type: 'string',
        required: false,
        defaultValue: 'text',
        enumValues: ['text', 'form', 'multipart', 'file'],
      },
      {
        name: 'file_source',
        label: 'File Source',
        type: 'string',
        required: false,
        requiredWhen: { field: 'body_mode', values: ['file'] },
      },
    ]
    renderTable(params, {})
    const row = screen.getByTestId('param-row-file_source')
    expect(within(row).queryByText('*')).not.toBeInTheDocument()
    expect(within(row).queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ParameterRow - lockedWhen (body_auto_headers under multipart)', () => {
  const params: Parameter[] = [
    {
      name: 'body_mode',
      type: 'string',
      required: false,
      defaultValue: 'text',
      enumValues: ['text', 'form', 'multipart', 'file'],
      group: 'Body',
    },
    {
      name: 'body_auto_headers',
      label: 'Auto Headers',
      type: 'boolean',
      required: false,
      defaultValue: true,
      group: 'Body',
      lockedWhen: { field: 'body_mode', values: ['multipart'], value: true },
    },
  ]

  it('renders checked + disabled while body_mode is multipart, even with a stale false draft', () => {
    renderTable(params, { body_mode: 'multipart', body_auto_headers: false })
    const row = screen.getByTestId('param-row-body_auto_headers')
    const checkbox = within(row).getByRole('checkbox')
    expect(checkbox).toBeDisabled()
    expect(checkbox).toHaveAttribute('data-state', 'checked')
  })

  it('stays interactive in other modes', () => {
    renderTable(params, { body_mode: 'form', body_auto_headers: false })
    const row = screen.getByTestId('param-row-body_auto_headers')
    const checkbox = within(row).getByRole('checkbox')
    expect(checkbox).toBeEnabled()
    expect(checkbox).toHaveAttribute('data-state', 'unchecked')
  })

  it('stays unlocked when the row renders without ambient values (defensive)', () => {
    render(
      <table>
        <tbody>
          <ParameterRow
            mode="input"
            parameter={params[1]}
            value={false}
            onChange={vi.fn()}
            availableVariables={[]}
            expressionFields={[]}
            onExpressionFieldsChange={vi.fn()}
            templateFields={[]}
            onTemplateFieldsChange={vi.fn()}
          />
        </tbody>
      </table>,
    )
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeEnabled()
    expect(checkbox).toHaveAttribute('data-state', 'unchecked')
  })

  it('keeps the lock and the pinned value when the block runs on a remote host', () => {
    renderTable(
      params,
      { body_mode: 'multipart', body_auto_headers: false },
      { runsOnRemoteHost: true },
    )
    const row = screen.getByTestId('param-row-body_auto_headers')
    const checkbox = within(row).getByRole('checkbox')
    expect(checkbox).toBeDisabled()
    expect(checkbox).toHaveAttribute('data-state', 'checked')
  })

  it('stays interactive on a remote host while its own condition misses', () => {
    renderTable(
      params,
      { body_mode: 'form', body_auto_headers: false },
      { runsOnRemoteHost: true },
    )
    const row = screen.getByTestId('param-row-body_auto_headers')
    const checkbox = within(row).getByRole('checkbox')
    expect(checkbox).toBeEnabled()
    expect(checkbox).toHaveAttribute('data-state', 'unchecked')
  })
})

const REMOTE_HOST_TEXT = "Remote host's settings"

const PROXY_CHOICES = [
  { stored: 'wave-setting', label: 'WAVE setting' },
  { stored: 'off', label: 'Off' },
]

const PROXY_PARAMS: Parameter[] = [
  {
    name: 'proxy_mode',
    label: 'Proxy',
    type: 'string',
    required: false,
    defaultValue: 'wave-setting',
    enumValues: ['wave-setting', 'off'],
    enumLabels: { 'wave-setting': 'WAVE setting', off: 'Off' },
    noExpression: true,
    lockedOnRemoteHost: { displayText: REMOTE_HOST_TEXT },
  },
]

function proxyRow(): HTMLElement {
  return screen.getByTestId('param-row-proxy_mode')
}

function proxyControl(): HTMLElement {
  return within(proxyRow()).getByRole('combobox', { name: 'Proxy' })
}

function optionLabels(): string[] {
  return screen.getAllByRole('option').map((option) => option.textContent ?? '')
}

describe('ParameterRow - lockedOnRemoteHost (the HTTP Proxy row, HTTP-13)', () => {
  it.each(PROXY_CHOICES)(
    'disables the control and reads the remote text while $stored is stored',
    ({ stored }) => {
      renderTable(PROXY_PARAMS, { proxy_mode: stored }, { runsOnRemoteHost: true })
      expect(proxyControl()).toBeDisabled()
      expect(proxyControl().textContent).toBe(REMOTE_HOST_TEXT)
    },
  )

  it('reads the remote text on a block that stores no choice yet', () => {
    renderTable(PROXY_PARAMS, {}, { runsOnRemoteHost: true })
    expect(proxyControl()).toBeDisabled()
    expect(proxyControl().textContent).toBe(REMOTE_HOST_TEXT)
  })

  it('grays the row out under the not-allowed cursor', () => {
    renderTable(PROXY_PARAMS, { proxy_mode: 'off' }, { runsOnRemoteHost: true })
    expect(proxyRow()).toHaveClass('opacity-50', 'cursor-not-allowed')
  })

  it.each(PROXY_CHOICES)(
    'reports no change and opens no menu while $stored is stored',
    async ({ stored }) => {
      const user = userEvent.setup()
      const { onChange } = renderTable(
        PROXY_PARAMS,
        { proxy_mode: stored },
        { runsOnRemoteHost: true },
      )
      await user.click(proxyControl())
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
    },
  )

  it.each(PROXY_CHOICES)(
    'shows the stored $label again, enabled, back on the WAVE host',
    ({ stored, label }) => {
      const onChange = vi.fn()
      const tableOn = (runsOnRemoteHost: boolean) => (
        <ParameterTable
          mode="input"
          parameters={PROXY_PARAMS}
          values={{ proxy_mode: stored }}
          onChange={onChange}
          availableVariables={NO_VARS}
          runsOnRemoteHost={runsOnRemoteHost}
        />
      )
      const { rerender } = render(tableOn(true))
      expect(proxyControl().textContent).toBe(REMOTE_HOST_TEXT)

      rerender(tableOn(false))
      expect(proxyControl()).toBeEnabled()
      expect(proxyControl().textContent).toBe(label)
      expect(proxyRow()).not.toHaveClass('opacity-50')
      expect(proxyRow()).not.toHaveClass('cursor-not-allowed')
      expect(onChange).not.toHaveBeenCalled()
    },
  )

  it('locks the row on a remote host only: the WAVE host still takes a new choice', async () => {
    const user = userEvent.setup()
    const { onChange } = renderTable(PROXY_PARAMS, { proxy_mode: 'wave-setting' })
    expect(proxyControl()).toBeEnabled()
    await user.click(proxyControl())
    await user.click(screen.getByRole('option', { name: 'Off' }))
    expect(onChange).toHaveBeenCalledWith('proxy_mode', 'off')
  })

  describe('with the shipped HTTP Connection rows', () => {
    const CONNECTION_OPEN = {
      groupMeta: { Connection: { name: 'Connection', defaultExpanded: true } },
    }

    function connectionParams(): Parameter[] {
      const params = (getInputParams('http-client') ?? []) as unknown as Parameter[]
      return params.filter((param) => param.group === 'Connection')
    }

    function shownRows(): (string | null)[] {
      return screen.getAllByTestId(/^param-row-/).map((row) => row.getAttribute('data-testid'))
    }

    it('selects WAVE setting on a new block and offers WAVE setting and Off', async () => {
      const user = userEvent.setup()
      renderTable(connectionParams(), {}, CONNECTION_OPEN)
      expect(proxyControl()).toBeEnabled()
      expect(proxyControl().textContent).toBe('WAVE setting')

      await user.click(proxyControl())
      expect(optionLabels()).toEqual(['WAVE setting', 'Off'])
    })

    it('shows Off and no other row once Off is stored', () => {
      renderTable(connectionParams(), { proxy_mode: 'off' }, CONNECTION_OPEN)
      expect(proxyControl().textContent).toBe('Off')
      expect(shownRows()).toEqual([
        'param-row-allow_redirects',
        'param-row-max_redirects',
        'param-row-proxy_mode',
      ])
    })

    it.each(PROXY_CHOICES)(
      'disables the Proxy row alone on a remote host while $stored is stored',
      ({ stored }) => {
        renderTable(
          connectionParams(),
          { proxy_mode: stored },
          { ...CONNECTION_OPEN, runsOnRemoteHost: true },
        )
        expect(proxyControl()).toBeDisabled()
        expect(proxyControl().textContent).toBe(REMOTE_HOST_TEXT)
        expect(proxyRow()).toHaveClass('opacity-50', 'cursor-not-allowed')

        const redirects = screen.getByTestId('param-row-allow_redirects')
        expect(within(redirects).getByRole('checkbox')).toBeEnabled()
        expect(redirects).not.toHaveClass('opacity-50')
      },
    )
  })
})

describe('ParameterTable - grouped note container', () => {
  const params: Parameter[] = [
    {
      name: 'form_fields',
      type: 'map',
      required: false,
      group: 'Body',
      note: 'Content-Type: application/x-www-form-urlencoded - set automatically; with body headers off, the transport default applies',
    },
    { name: 'timeout', type: 'integer', required: false, group: 'Body' },
  ]

  it('renders one note container per section carrying the per-param note lines', () => {
    renderTable(params, {})
    const container = screen.getByTestId('param-notes-Body')
    expect(within(container).getByTestId('param-note-form_fields')).toHaveTextContent(
      'Content-Type: application/x-www-form-urlencoded - set automatically',
    )
  })

  it('renders no container for a section without notes', () => {
    renderTable([{ name: 'timeout', type: 'integer', required: false, group: 'Body' }], {})
    expect(screen.queryByTestId('param-notes-Body')).not.toBeInTheDocument()
  })

  it('renders a note without the media-type shape verbatim, with no code segment', () => {
    renderTable(
      [
        {
          name: 'cipher_suites',
          type: 'array',
          required: false,
          group: 'Body',
          note: 'empty selection = the default list',
        },
      ],
      {},
    )
    const note = screen.getByTestId('param-note-cipher_suites')
    expect(note).toHaveTextContent('empty selection = the default list')
    expect(note.querySelector('code')).toBeNull()
  })

  it('keeps a note plain when the colon only appears after the dash', () => {
    renderTable(
      [
        {
          name: 'client_cert',
          type: 'string',
          required: false,
          group: 'Body',
          note: 'mTLS is presence-based - configuring Client Certificate presents identity: on request',
        },
      ],
      {},
    )
    const note = screen.getByTestId('param-note-client_cert')
    expect(note.querySelector('code')).toBeNull()
  })
})

describe('ParameterRow - expected-headers in-field advisory', () => {
  const params: Parameter[] = [
    { name: 'headers', label: 'Headers', type: 'map', required: false },
  ]
  const advisory = {
    headers: {
      generatedRows: [],
      missingHeaderAdvisories: [
        {
          key: 'Content-Type',
          message: 'Content-Type is not set - the transport will send its own default',
        },
      ],
    },
  }

  it('shows the amber icon on the Headers value slot while the header is missing', () => {
    renderTable(params, {}, { mapExtras: advisory })
    const icon = screen.getByLabelText('Expected headers missing')
    expect(icon).toBeInTheDocument()
  })

  it('hides the icon once a manual equivalent row exists (case-insensitive)', () => {
    renderTable(params, { headers: { 'content-type': 'text/csv' } }, { mapExtras: advisory })
    expect(screen.queryByLabelText('Expected headers missing')).not.toBeInTheDocument()
  })

  it('renders no icon without advisory data', () => {
    renderTable(params, {})
    expect(screen.queryByLabelText('Expected headers missing')).not.toBeInTheDocument()
  })
})

describe('ParameterTable - TLS version bounds clamp each other on change', () => {
  const TLS_PARAMS: Parameter[] = [
    {
      name: 'tls_min_version',
      type: 'string',
      required: false,
      defaultValue: '1.2',
      enumValues: ['1.0', '1.1', '1.2', '1.3'],
      clampsSibling: { field: 'tls_max_version', keep: 'atLeast' },
    },
    {
      name: 'tls_max_version',
      type: 'string',
      required: false,
      defaultValue: '1.3',
      enumValues: ['1.0', '1.1', '1.2', '1.3'],
      clampsSibling: { field: 'tls_min_version', keep: 'atMost' },
    },
  ]

  async function pick(rowName: string, option: string) {
    const user = userEvent.setup()
    await user.click(within(screen.getByTestId(`param-row-${rowName}`)).getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: option }))
  }

  it('raises the max when a new min exceeds it', async () => {
    const { onChange } = renderTable(TLS_PARAMS, { tls_min_version: '1.2', tls_max_version: '1.2' })
    await pick('tls_min_version', '1.3')
    expect(onChange).toHaveBeenCalledWith('tls_min_version', '1.3')
    expect(onChange).toHaveBeenCalledWith('tls_max_version', '1.3')
  })

  it('lowers the min when a new max falls below it', async () => {
    const { onChange } = renderTable(TLS_PARAMS, { tls_min_version: '1.2', tls_max_version: '1.3' })
    await pick('tls_max_version', '1.0')
    expect(onChange).toHaveBeenCalledWith('tls_max_version', '1.0')
    expect(onChange).toHaveBeenCalledWith('tls_min_version', '1.0')
  })

  it('leaves the sibling untouched for an in-order change', async () => {
    const { onChange } = renderTable(TLS_PARAMS, { tls_min_version: '1.0', tls_max_version: '1.3' })
    await pick('tls_min_version', '1.1')
    expect(onChange).toHaveBeenCalledWith('tls_min_version', '1.1')
    expect(onChange).not.toHaveBeenCalledWith('tls_max_version', expect.anything())
  })
})

describe('ParameterTable - a name whose SQL rows are all hidden clears like any hidden row (SQL-8)', () => {
  function sqlParams(): Parameter[] {
    const params = (getInputParams('sql-client') ?? []) as unknown as Parameter[]
    expect(params, 'sql-client descriptors').toHaveLength(38)
    return params
  }

  async function switchValues(before: Record<string, unknown>, after: Record<string, unknown>) {
    const params = sqlParams()
    const { rerender } = renderTableForRerender(params, before)
    const onChange = vi.fn()
    rerender(
      <ParameterTable
        mode="input"
        parameters={params}
        values={after}
        onChange={onChange}
        availableVariables={NO_VARS}
      />,
    )
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    return onChange
  }

  it('clears Stop on error when Call procedure hides both of its rows, as it clears Script Type', async () => {
    const before = { operation: 'run_sql', script_type: 'source', stop_on_error: false }
    const onChange = await switchValues(before, { ...before, operation: 'call_procedure' })

    expect(onChange).toHaveBeenCalledWith('script_type', undefined)
    expect(onChange).toHaveBeenCalledWith('stop_on_error', undefined)
  })

  it('clears TLS when SQLite hides both TLS rows, as it clears Verify Server Certificate', async () => {
    const before = { database_type: 'postgresql', tls: true, verify_ssl: false }
    const onChange = await switchValues(before, { ...before, database_type: 'sqlite' })

    expect(onChange).toHaveBeenCalledWith('verify_ssl', undefined)
    expect(onChange).toHaveBeenCalledWith('tls', undefined)
  })

  it('clears Port when SQLite hides every Port row', async () => {
    const before = { database_type: 'mysql', port: 3307, tls: true }
    const onChange = await switchValues(before, { ...before, database_type: 'sqlite' })

    expect(onChange).toHaveBeenCalledWith('port', undefined)
  })

  it('keeps Call procedure in Operation on SQLite, where an Operation row still shows', async () => {
    const before = { database_type: 'postgresql', operation: 'call_procedure', tls: true }
    const onChange = await switchValues(before, { ...before, database_type: 'sqlite' })

    expect(onChange).toHaveBeenCalledWith('tls', undefined)
    expect(onChange).not.toHaveBeenCalledWith('operation', undefined)
  })
})
