/**
 * Generated header rows + missing-header advisories in the headers editor.
 *
 * auth_enabled composes an auth header; body_auto_headers composes the mode's
 * Content-Type. Both render as READ-ONLY rows in the headers map editor:
 * masked value for auth, real value for Content-Type, no key/value editing,
 * delete syncs the owning checkbox off (locked for multipart). They join the
 * case-insensitive duplicate rule. With body headers OFF, an amber advisory
 * stripe (non-blocking) lists the missing header; the config sheet shows an
 * amber in-field icon on the Headers value slot.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { MapEditBody, type GeneratedMapRow } from '@/components/shared/variable-bodies/map-edit-body'
import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'
import {
  deriveHeaderMapExtras,
  MULTIPART_CT_LOCKED_TOOLTIP,
} from '@/features/workbench/common/element-config/parameters/generated-header-rows'
import type {
  MapParamExtras,
  Parameter,
} from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import type { ValueType } from '@/lib/variable-validation'

const HTTP_PARAMS: Parameter[] = [
  { name: 'headers', label: 'Headers', type: 'map', required: false },
  { name: 'auth_enabled', type: 'boolean', required: false, defaultValue: false },
  { name: 'auth_mode', type: 'string', required: false, defaultValue: 'basic' },
  { name: 'auth_header_name', type: 'string', required: false, defaultValue: 'X-API-Key' },
  { name: 'body_mode', type: 'string', required: false, defaultValue: 'text' },
  { name: 'body_auto_headers', type: 'boolean', required: false, defaultValue: true },
  { name: 'file_content_type', type: 'string', required: false, defaultValue: 'auto' },
]

/** The Headers row of a Block window; its expand opens the map editor with the rows and advisories the config derives. */
function renderHeadersRow(parameter: Parameter, value: Record<string, unknown>, mapExtras: MapParamExtras) {
  render(
    <table>
      <tbody>
        <ParameterRow
          mode="input"
          parameter={parameter}
          value={value}
          onChange={vi.fn()}
          availableVariables={[]}
          expressionFields={[]}
          onExpressionFieldsChange={vi.fn()}
          templateFields={[]}
          onTemplateFieldsChange={vi.fn()}
          allValues={{}}
          mapExtras={mapExtras}
        />
      </tbody>
    </table>,
  )
}

const stringTypes = (value: Record<string, unknown>): Record<string, ValueType> =>
  Object.fromEntries(Object.keys(value).map((k) => [k, 'string' as ValueType]))

describe('deriveHeaderMapExtras (generated rows and advisories)', () => {
  it('returns undefined for schemas without generated-header params', () => {
    const params: Parameter[] = [{ name: 'headers', type: 'map', required: false }]
    expect(deriveHeaderMapExtras(params, {}, vi.fn())).toBeUndefined()
  })

  it('derives no rows and no advisories at defaults (text mode, auth off)', () => {
    const extras = deriveHeaderMapExtras(HTTP_PARAMS, {}, vi.fn())
    expect(extras?.headers.generatedRows).toEqual([])
    expect(extras?.headers.missingHeaderAdvisories).toEqual([])
  })

  it('derives the masked Authorization row for basic/bearer auth', () => {
    const onChange = vi.fn()
    const extras = deriveHeaderMapExtras(HTTP_PARAMS, { auth_enabled: true }, onChange)
    const row = extras!.headers.generatedRows[0]
    expect(row.key).toBe('Authorization')
    expect(row.value).toBe('********')
    expect(row.masked).toBe(true)
    row.onDelete!()
    expect(onChange).toHaveBeenCalledWith('auth_enabled', false)
  })

  it('derives the api_key header name from auth_header_name', () => {
    const extras = deriveHeaderMapExtras(
      HTTP_PARAMS,
      { auth_enabled: true, auth_mode: 'api_key', auth_header_name: 'X-Gateway-Key' },
      vi.fn(),
    )
    expect(extras!.headers.generatedRows[0].key).toBe('X-Gateway-Key')
  })

  it('derives the form-mode Content-Type row with delete syncing body_auto_headers off', () => {
    const onChange = vi.fn()
    const extras = deriveHeaderMapExtras(HTTP_PARAMS, { body_mode: 'form' }, onChange)
    const row = extras!.headers.generatedRows[0]
    expect(row.key).toBe('Content-Type')
    expect(row.value).toBe('application/x-www-form-urlencoded')
    expect(row.masked).toBeUndefined()
    row.onDelete!()
    expect(onChange).toHaveBeenCalledWith('body_auto_headers', false)
  })

  it('derives the multipart Content-Type row locked, even with a stale auto=false draft', () => {
    const extras = deriveHeaderMapExtras(
      HTTP_PARAMS,
      { body_mode: 'multipart', body_auto_headers: false },
      vi.fn(),
    )
    const row = extras!.headers.generatedRows[0]
    expect(row.value).toBe('multipart/form-data; boundary=(generated)')
    expect(row.deleteLocked).toBe(true)
    expect(row.deleteLockedTooltip).toBe(MULTIPART_CT_LOCKED_TOOLTIP)
    expect(row.onDelete).toBeUndefined()
  })

  it('derives the file-mode Content-Type from file_content_type', () => {
    const extras = deriveHeaderMapExtras(
      HTTP_PARAMS,
      { body_mode: 'file', file_content_type: 'application/json' },
      vi.fn(),
    )
    expect(extras!.headers.generatedRows[0].value).toBe('application/json')
  })

  it('renders "(auto from file extension)" for file mode on auto', () => {
    const extras = deriveHeaderMapExtras(HTTP_PARAMS, { body_mode: 'file' }, vi.fn())
    expect(extras!.headers.generatedRows[0].value).toBe('(auto from file extension)')
  })

  it('orders the auth row before the Content-Type row', () => {
    const extras = deriveHeaderMapExtras(
      HTTP_PARAMS,
      { auth_enabled: true, body_mode: 'form' },
      vi.fn(),
    )
    expect(extras!.headers.generatedRows.map((r: GeneratedMapRow) => r.key)).toEqual([
      'Authorization',
      'Content-Type',
    ])
  })

  it('derives the form-mode missing-header advisory when body headers are off', () => {
    const extras = deriveHeaderMapExtras(
      HTTP_PARAMS,
      { body_mode: 'form', body_auto_headers: false },
      vi.fn(),
    )
    expect(extras!.headers.generatedRows).toEqual([])
    expect(extras!.headers.missingHeaderAdvisories).toEqual([
      { key: 'Content-Type', message: 'Content-Type is not set - the transport will send its own default' },
    ])
  })

  it('derives the file-mode missing-header advisory when body headers are off', () => {
    const extras = deriveHeaderMapExtras(
      HTTP_PARAMS,
      { body_mode: 'file', body_auto_headers: false },
      vi.fn(),
    )
    expect(extras!.headers.missingHeaderAdvisories).toEqual([
      { key: 'Content-Type', message: 'Content-Type is not set - add a header row to send one' },
    ])
  })

  it('derives no advisory for text mode with body headers off (nothing would be generated)', () => {
    const extras = deriveHeaderMapExtras(
      HTTP_PARAMS,
      { body_mode: 'text', body_auto_headers: false },
      vi.fn(),
    )
    expect(extras!.headers.missingHeaderAdvisories).toEqual([])
  })
})

describe('MapEditBody - read-only generated rows', () => {
  function renderWithGenerated(
    value: Record<string, unknown>,
    generatedRows: GeneratedMapRow[],
  ) {
    const onValidChange = vi.fn()
    const onValidation = vi.fn()
    render(
      <MapEditBody
        value={value}
        types={stringTypes(value)}
        onChange={vi.fn()}
        onValidChange={onValidChange}
        onValidation={onValidation}
        stringValuesOnly
        keyPolicy={{ keyNoun: 'header', caseInsensitive: true }}
        generatedRows={generatedRows}
      />,
    )
    return { onValidChange, onValidation }
  }

  it('renders a masked auth row read-only with muted styling', () => {
    renderWithGenerated({}, [
      { key: 'Authorization', value: '********', masked: true, onDelete: vi.fn() },
    ])
    const key = screen.getByTestId('map-generated-key-0')
    const value = screen.getByTestId('map-generated-value-0')
    expect(key).toHaveValue('Authorization')
    expect(key).toHaveAttribute('aria-readonly', 'true')
    expect(key).toHaveAttribute('readonly')
    expect(value).toHaveValue('********')
    expect(value).toHaveAttribute('aria-readonly', 'true')
    expect(value).toHaveAttribute('readonly')
  })

  it('renders the Content-Type row with its real generated value', () => {
    renderWithGenerated({}, [
      { key: 'Content-Type', value: 'application/x-www-form-urlencoded', onDelete: vi.fn() },
    ])
    expect(screen.getByTestId('map-generated-value-0')).toHaveValue(
      'application/x-www-form-urlencoded',
    )
  })

  it('delete on a generated row fires its onDelete (config sync)', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderWithGenerated({}, [{ key: 'Authorization', value: '********', masked: true, onDelete }])
    await user.click(screen.getByTestId('map-generated-remove-0'))
    expect(onDelete).toHaveBeenCalled()
  })

  it('the multipart Content-Type delete is disabled with the transport-owns-it tooltip', () => {
    renderWithGenerated({}, [
      {
        key: 'Content-Type',
        value: 'multipart/form-data; boundary=(generated)',
        deleteLocked: true,
        deleteLockedTooltip: MULTIPART_CT_LOCKED_TOOLTIP,
      },
    ])
    const remove = screen.getByTestId('map-generated-remove-0')
    expect(remove).toBeDisabled()
    expect(remove.className).toContain('cursor-not-allowed')
    expect(remove.className).toContain('opacity-50')
  })

  it('a manual same-key row gets the standard case-insensitive duplicate error', () => {
    const { onValidChange, onValidation } = renderWithGenerated({ Accept: 'text/html' }, [
      { key: 'Authorization', value: '********', masked: true, onDelete: vi.fn() },
    ])
    fireEvent.change(screen.getByTestId('map-edit-key-0'), {
      target: { value: 'authorization' },
    })
    expect(screen.getByTestId('map-edit-key-0')).toHaveAttribute('aria-invalid', 'true')
    expect(onValidChange).toHaveBeenLastCalledWith(false)
    expect(onValidation.mock.calls.at(-1)?.[0]).toEqual([
      'Duplicate header "authorization" (header names are case-insensitive)',
    ])
  })

  it('a manual row with a different key stays clean beside generated rows', () => {
    const { onValidChange } = renderWithGenerated({ Accept: 'text/html' }, [
      { key: 'Authorization', value: '********', masked: true, onDelete: vi.fn() },
    ])
    fireEvent.change(screen.getByTestId('map-edit-value-0'), {
      target: { value: 'application/json' },
    })
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })
})

describe('The Headers row - generated rows + amber stripe threading', () => {
  const headersParam: Parameter = {
    name: 'headers',
    label: 'Headers',
    type: 'map',
    required: false,
    keyPolicy: { keyNoun: 'header', caseInsensitive: true },
  }

  it('threads generated rows into the sheet and delete syncs the config draft', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    renderHeadersRow(headersParam, {}, {
      generatedRows: [
        { key: 'Authorization', value: '********', masked: true, onDelete },
      ],
      missingHeaderAdvisories: [],
    })
    await user.click(screen.getByTestId('param-expand-headers'))
    expect(screen.getByTestId('map-generated-key-0')).toHaveValue('Authorization')
    await user.click(screen.getByTestId('map-generated-remove-0'))
    expect(onDelete).toHaveBeenCalled()
  })

  it('renders the amber advisory stripe for a missing expected header, non-blocking', async () => {
    const user = userEvent.setup()
    renderHeadersRow(headersParam, {}, {
      generatedRows: [],
      missingHeaderAdvisories: [
        {
          key: 'Content-Type',
          message: 'Content-Type is not set - the transport will send its own default',
        },
      ],
    })
    await user.click(screen.getByTestId('param-expand-headers'))
    const stripe = screen.getByTestId('value-editor-advisory')
    expect(stripe).toHaveTextContent(
      'Content-Type is not set - the transport will send its own default',
    )
    // The advisory is not a blocker: a moved draft still saves (PYRUN-20).
    await user.click(screen.getByTestId('map-add-entry'))
    fireEvent.change(screen.getByTestId('map-edit-key-0'), { target: { value: 'Accept' } })
    expect(screen.getByTestId('value-editor-save-button')).toBeEnabled()
  })

  it('clears the amber stripe once a manual equivalent row exists in the draft', async () => {
    const user = userEvent.setup()
    renderHeadersRow(headersParam, {}, {
      generatedRows: [],
      missingHeaderAdvisories: [
        {
          key: 'Content-Type',
          message: 'Content-Type is not set - the transport will send its own default',
        },
      ],
    })
    await user.click(screen.getByTestId('param-expand-headers'))
    await user.click(screen.getByTestId('map-add-entry'))
    fireEvent.change(screen.getByTestId('map-edit-key-0'), {
      target: { value: 'content-type' },
    })
    fireEvent.change(screen.getByTestId('map-edit-value-0'), {
      target: { value: 'text/csv' },
    })
    expect(screen.queryByTestId('value-editor-advisory')).not.toBeInTheDocument()
  })

  it('renders the red error strip above the amber stripe when both fire', async () => {
    const user = userEvent.setup()
    renderHeadersRow(headersParam, { Accept: 'text/html' }, {
      generatedRows: [],
      missingHeaderAdvisories: [
        {
          key: 'Content-Type',
          message: 'Content-Type is not set - the transport will send its own default',
        },
      ],
    })
    await user.click(screen.getByTestId('param-expand-headers'))
    await user.click(screen.getByTestId('map-add-entry'))
    fireEvent.change(screen.getByTestId('map-edit-key-1'), {
      target: { value: 'accept' },
    })
    const error = screen.getByTestId('value-editor-validation')
    const amber = screen.getByTestId('value-editor-advisory')
    expect(error.compareDocumentPosition(amber) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('value-editor-save-button')).toBeDisabled()
  })
})

describe('deriveHeaderMapExtras - api_key header name fallback', () => {
  it('falls back to X-API-Key when auth_header_name is blank', () => {
    const extras = deriveHeaderMapExtras(
      HTTP_PARAMS,
      { auth_enabled: true, auth_mode: 'api_key', auth_header_name: '' },
      vi.fn(),
    )
    expect(extras!.headers.generatedRows[0].key).toBe('X-API-Key')
  })
})

describe('deriveHeaderMapExtras - mode fallbacks without schema defaults (defensive)', () => {
  const BARE_PARAMS: Parameter[] = [
    { name: 'headers', type: 'map', required: false },
    { name: 'auth_enabled', type: 'boolean', required: false },
    { name: 'auth_mode', type: 'string', required: false },
    { name: 'auth_header_name', type: 'string', required: false },
    { name: 'body_mode', type: 'string', required: false },
    { name: 'body_auto_headers', type: 'boolean', required: false },
    { name: 'file_content_type', type: 'string', required: false },
  ]

  it('falls back to basic auth when auth_mode has no value and no default', () => {
    const extras = deriveHeaderMapExtras(BARE_PARAMS, { auth_enabled: true }, vi.fn())
    expect(extras!.headers.generatedRows[0].key).toBe('Authorization')
  })

  it('falls back to text mode (no generated row) when body_mode has no value and no default', () => {
    const extras = deriveHeaderMapExtras(BARE_PARAMS, {}, vi.fn())
    expect(extras!.headers.generatedRows).toEqual([])
    expect(extras!.headers.missingHeaderAdvisories).toEqual([])
  })

  it('falls back to auto for the file Content-Type when it has no value and no default', () => {
    const extras = deriveHeaderMapExtras(BARE_PARAMS, { body_mode: 'file' }, vi.fn())
    expect(extras!.headers.generatedRows[0].value).toBe('(auto from file extension)')
  })

  it('file-mode row delete syncs body headers off', () => {
    const onChange = vi.fn()
    const extras = deriveHeaderMapExtras(HTTP_PARAMS, { body_mode: 'file' }, onChange)
    extras!.headers.generatedRows[0].onDelete!()
    expect(onChange).toHaveBeenCalledWith('body_auto_headers', false)
  })
})

describe('amber stripe - multi-advisory expander', () => {
  const headersParam: Parameter = {
    name: 'headers',
    label: 'Headers',
    type: 'map',
    required: false,
  }

  it('renders the first message plus the (+N more) expander', async () => {
    const user = userEvent.setup()
    renderHeadersRow(headersParam, {}, {
      generatedRows: [],
      missingHeaderAdvisories: [
        { key: 'Content-Type', message: 'Content-Type is not set - the transport will send its own default' },
        { key: 'X-Expected', message: 'X-Expected is not set' },
      ],
    })
    await user.click(screen.getByTestId('param-expand-headers'))
    const stripe = screen.getByTestId('value-editor-advisory')
    expect(stripe).toHaveTextContent(
      'Content-Type is not set - the transport will send its own default',
    )
    expect(screen.getByTestId('value-editor-advisory-more')).toHaveTextContent('(+1 more)')
  })
})
