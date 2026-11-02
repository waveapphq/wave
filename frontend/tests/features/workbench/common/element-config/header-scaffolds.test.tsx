/**
 * Headers editor scaffolds, guard rails, and advisories
 * (REQ-3.4.1.4).
 *
 * The map editor stays HTTP-ignorant: the "+ Content-Type" menu renders from a
 * data-driven quickInserts opt, the info note from an editorNote opt,
 * and key-policy errors style the offending KEY inputs (messages live only in
 * the host strip). Menus do not hide by body mode - the generated-row model
 * expresses mode ownership.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { MapEditBody, type MapEditBodyProps } from '@/components/shared/variable-bodies/map-edit-body'
import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import type { QuickInsertMenu } from '@/lib/quick-inserts'
import type { ResolvedMapKeyPolicy, ValueType } from '@/lib/variable-validation'

const EDITOR_NOTE =
  'Standard headers (Host, User-Agent, Accept, ...) are sent automatically - add a row to override.'

const CT_MENU: QuickInsertMenu = {
  label: '+ Content-Type',
  items: [
    { label: 'application/json', key: 'Content-Type', value: 'application/json' },
    { label: 'Custom…', sublabel: 'empty row, key prefilled', key: 'Content-Type', value: '' },
  ],
}

const CL_BLOCKED =
  'Header "Content-Length" cannot be set manually - the HTTP stack blocks length overrides'

const HEADER_POLICY: ResolvedMapKeyPolicy = {
  keyNoun: 'header',
  caseInsensitive: true,
  blockedKeys: { 'content-length': CL_BLOCKED },
}

function stringTypes(value: Record<string, unknown>): Record<string, ValueType> {
  return Object.fromEntries(Object.keys(value).map((k) => [k, 'string' as ValueType]))
}

function renderBody(
  value: Record<string, unknown>,
  overrides: Partial<MapEditBodyProps> = {},
) {
  const onChange = vi.fn()
  const onValidChange = vi.fn()
  const onValidation = vi.fn()
  render(
    <MapEditBody
      value={value}
      types={stringTypes(value)}
      onChange={onChange}
      onValidChange={onValidChange}
      onValidation={onValidation}
      stringValuesOnly
      {...overrides}
    />,
  )
  return { onChange, onValidChange, onValidation }
}

const lastCall = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)

describe('scaffold buttons (only data-driven menus remain)', () => {
  it('renders no scaffold buttons without quickInserts', () => {
    renderBody({ Accept: 'text/html' })
    expect(screen.queryByRole('button', { name: '+ Content-Type' })).not.toBeInTheDocument()
  })

  it('renders one ghost button per configured menu beside + Add entry', () => {
    renderBody({}, { quickInserts: [CT_MENU] })
    expect(screen.getByTestId('map-add-entry')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Content-Type' })).toBeInTheDocument()
  })

  it('inserts a literal media-type row from the Content-Type menu', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({}, { quickInserts: [CT_MENU] })
    await user.click(screen.getByRole('button', { name: '+ Content-Type' }))
    await user.click(await screen.findByRole('menuitem', { name: /application\/json/ }))

    expect(lastCall(onChange)?.[0]).toEqual({ 'Content-Type': 'application/json' })
  })

  it('inserts an empty row with the key prefilled from Custom…', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody({}, { quickInserts: [CT_MENU] })
    await user.click(screen.getByRole('button', { name: '+ Content-Type' }))
    await user.click(await screen.findByRole('menuitem', { name: /Custom/ }))

    expect(screen.getByTestId('map-edit-key-0')).toHaveValue('Content-Type')
    expect(lastCall(onChange)?.[0]).toEqual({ 'Content-Type': '' })
  })

  it('inserts a plain duplicate row instead of focusing an existing same-key row', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBody(
      { 'Content-Type': 'application/xml' },
      { quickInserts: [CT_MENU] },
    )
    await user.click(screen.getByRole('button', { name: '+ Content-Type' }))
    await user.click(await screen.findByRole('menuitem', { name: /application\/json/ }))

    expect(screen.getByTestId('map-edit-key-1')).toHaveValue('Content-Type')
    expect(onChange).toHaveBeenCalled()
  })
})

describe('editor info note', () => {
  it('renders the note line above the grid when configured', () => {
    renderBody({}, { note: EDITOR_NOTE })
    expect(screen.getByText(EDITOR_NOTE)).toBeInTheDocument()
  })

  it('renders no note without the opt', () => {
    renderBody({})
    expect(screen.queryByText(EDITOR_NOTE)).not.toBeInTheDocument()
  })
})

describe('key-policy guard rails in the editor', () => {
  it('error-styles a blocked key at render, with no inline row message', () => {
    renderBody({ 'Content-Length': '10' }, { keyPolicy: HEADER_POLICY })
    expect(screen.getByTestId('map-edit-key-0')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText(CL_BLOCKED)).not.toBeInTheDocument()
  })

  it('reports the blocked-key message through onValidation and blocks validity', () => {
    const { onValidChange, onValidation } = renderBody(
      { Accept: 'text/html' },
      { keyPolicy: HEADER_POLICY },
    )
    fireEvent.change(screen.getByTestId('map-edit-key-0'), {
      target: { value: 'Content-Length' },
    })
    expect(onValidChange).toHaveBeenLastCalledWith(false)
    expect(lastCall(onValidation)?.[0]).toEqual([CL_BLOCKED])
  })

  it('does not flag a manual Transfer-Encoding row (left the blocklist)', () => {
    const { onValidChange } = renderBody(
      { Accept: 'text/html' },
      { keyPolicy: HEADER_POLICY },
    )
    fireEvent.change(screen.getByTestId('map-edit-key-0'), {
      target: { value: 'Transfer-Encoding' },
    })
    expect(screen.getByTestId('map-edit-key-0')).not.toHaveAttribute('aria-invalid')
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('error-styles both keys of a case-insensitive duplicate', async () => {
    const user = userEvent.setup()
    const { onValidation } = renderBody(
      { Authorization: 'Bearer {{ api_token }}' },
      { keyPolicy: HEADER_POLICY },
    )
    await user.click(screen.getByTestId('map-add-entry'))
    fireEvent.change(screen.getByTestId('map-edit-key-1'), {
      target: { value: 'authorization' },
    })
    expect(screen.getByTestId('map-edit-key-0')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('map-edit-key-1')).toHaveAttribute('aria-invalid', 'true')
    // The message names the LATER duplicate row as typed.
    expect(lastCall(onValidation)?.[0]).toEqual([
      'Duplicate header "authorization" (header names are case-insensitive)',
    ])
  })

  it('does not flag a manual Content-Type row (mode-conflict rule retired)', () => {
    const { onValidChange } = renderBody(
      { Accept: 'text/html' },
      { keyPolicy: HEADER_POLICY },
    )
    fireEvent.change(screen.getByTestId('map-edit-key-0'), {
      target: { value: 'Content-Type' },
    })
    expect(screen.getByTestId('map-edit-key-0')).not.toHaveAttribute('aria-invalid')
    expect(onValidChange).toHaveBeenLastCalledWith(true)
  })

  it('recovers validity once the offending key is fixed', () => {
    const { onValidChange } = renderBody({ Accept: 'text/html' }, { keyPolicy: HEADER_POLICY })
    const key = screen.getByTestId('map-edit-key-0')
    fireEvent.change(key, { target: { value: 'Content-Length' } })
    expect(onValidChange).toHaveBeenLastCalledWith(false)
    fireEvent.change(key, { target: { value: 'X-Trace-Id' } })
    expect(onValidChange).toHaveBeenLastCalledWith(true)
    expect(key).not.toHaveAttribute('aria-invalid')
  })
})

describe('A map row - scaffold menus pass through unfiltered (no mode hiding)', () => {
  const headersParam: Parameter = {
    name: 'headers',
    label: 'Headers',
    type: 'map',
    required: false,
    quickInserts: [CT_MENU],
  }

  function openSheet(allValues: Record<string, unknown>) {
    render(
      <table>
        <tbody>
          <ParameterRow
            mode="input"
            parameter={headersParam}
            value={{}}
            onChange={vi.fn()}
            availableVariables={[]}
            expressionFields={[]}
            onExpressionFieldsChange={vi.fn()}
            templateFields={[]}
            onTemplateFieldsChange={vi.fn()}
            allValues={allValues}
          />
        </tbody>
      </table>,
    )
    return userEvent.setup().click(screen.getByTestId('param-expand-headers'))
  }

  it('shows + Content-Type while body_mode is form', async () => {
    await openSheet({ body_mode: 'form' })
    expect(screen.getByRole('button', { name: '+ Content-Type' })).toBeInTheDocument()
  })

  it('shows + Content-Type while body_mode is multipart', async () => {
    await openSheet({ body_mode: 'multipart' })
    expect(screen.getByRole('button', { name: '+ Content-Type' })).toBeInTheDocument()
  })
})
