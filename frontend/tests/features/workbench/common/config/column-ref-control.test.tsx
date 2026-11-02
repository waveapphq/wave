/**
 * ColumnRefControl tests.
 *
 * A column reference = a Name/Index mode selector + a value affordance:
 *  - free-text value when Column types is auto/string,
 *  - mode forced to Index + selector disabled when Has-header is off,
 *  - a searchable dropdown of schema columns when a schema is supplied.
 * Index is 0-based.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-viewport', () => ({
  useViewport: () => ({
    width: 1280,
    height: 800,
    breakpoint: 'xl',
    isAtLeast: () => true,
    isBelow: () => false,
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    sidebarShouldBeVisible: true,
    canvasInteractionEnabled: true,
    isTouchDevice: false,
  }),
}))

import { ColumnRefControl } from '@/features/workbench/common/config/table-transform/column-ref-control'
import type { ColumnRef } from '@/features/workbench/common/config/table-transform/types'

const SCHEMA_COLUMNS = [
  { name: 'id', type: 'integer' },
  { name: 'score', type: 'float' },
]

function renderControl(overrides: Partial<React.ComponentProps<typeof ColumnRefControl>> = {}) {
  const onChange = (overrides.onChange ?? vi.fn()) as ReturnType<typeof vi.fn>
  const props = {
    mode: 'name' as const,
    value: '',
    hasHeader: true,
    onChange,
    ...overrides,
  }
  render(<ColumnRefControl {...props} />)
  return { onChange }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('free-text state (auto/string typing, header on)', () => {
  it('renders an enabled Name/Index mode selector and a free-text value field', () => {
    renderControl()

    expect(screen.getByTestId('column-ref-mode')).toBeEnabled()
    expect(screen.getByTestId('column-ref-value')).toBeInTheDocument()
    expect(screen.queryByTestId('column-ref-combobox')).not.toBeInTheDocument()
  })

  it('offers Name and Index as the two modes', async () => {
    const user = userEvent.setup()
    renderControl()

    await user.click(screen.getByTestId('column-ref-mode'))
    const labels = (await screen.findAllByRole('option')).map((o) => o.textContent?.trim())
    expect(labels).toEqual(expect.arrayContaining(['Name', 'Index']))
  })

  it('emits the typed value under the current mode', async () => {
    const user = userEvent.setup()
    const { onChange } = renderControl({ mode: 'name', value: '' })

    await user.type(screen.getByTestId('column-ref-value'), 'score')

    const last = onChange.mock.calls.at(-1)![0] as ColumnRef
    expect(last).toEqual({ mode: 'name', value: 'score' })
  })

  it('switches to Index and drops the value (name and index are not interchangeable)', async () => {
    const user = userEvent.setup()
    const { onChange } = renderControl({ mode: 'name', value: 'score' })

    await user.click(screen.getByTestId('column-ref-mode'))
    await user.click(await screen.findByRole('option', { name: /index/i }))

    expect(onChange).toHaveBeenCalledWith({ mode: 'index', value: '' })
  })
})

describe('header-off state', () => {
  it('disables the mode selector (index is forced)', () => {
    renderControl({ hasHeader: false })

    expect(screen.getByTestId('column-ref-mode')).toBeDisabled()
  })
})

describe('schema state (searchable dropdown)', () => {
  it('renders the searchable dropdown instead of the free-text field', () => {
    renderControl({ schemaColumns: SCHEMA_COLUMNS })

    expect(screen.getByTestId('column-ref-combobox')).toBeInTheDocument()
    expect(screen.queryByTestId('column-ref-value')).not.toBeInTheDocument()
  })

  it('keeps the mode selector enabled when the header is on', () => {
    renderControl({ schemaColumns: SCHEMA_COLUMNS, hasHeader: true })

    expect(screen.getByTestId('column-ref-mode')).toBeEnabled()
  })

  it('disables the mode selector when the header is off', () => {
    renderControl({ schemaColumns: SCHEMA_COLUMNS, hasHeader: false })

    expect(screen.getByTestId('column-ref-mode')).toBeDisabled()
  })

  it('emits the chosen schema column name', async () => {
    const user = userEvent.setup()
    const { onChange } = renderControl({ schemaColumns: SCHEMA_COLUMNS, mode: 'name' })

    await user.click(screen.getByTestId('column-ref-combobox'))
    await user.click(await screen.findByRole('option', { name: /score/i }))

    expect(onChange).toHaveBeenCalledWith({ mode: 'name', value: 'score' })
  })
})

describe('index mode (0-based, digits only)', () => {
  it('strips non-digit characters from the typed value', async () => {
    const user = userEvent.setup()
    const { onChange } = renderControl({ mode: 'index', value: '' })

    await user.type(screen.getByTestId('column-ref-value'), '1a2')

    const last = onChange.mock.calls.at(-1)![0] as ColumnRef
    expect(last).toEqual({ mode: 'index', value: '12' })
  })

  it('drops a paste the whole-number rule refuses instead of editing it (REQ-3.1.3.14)', () => {
    const { onChange } = renderControl({ mode: 'index', value: '' })

    fireEvent.change(screen.getByTestId('column-ref-value'), { target: { value: '1a2' } })
    fireEvent.change(screen.getByTestId('column-ref-value'), { target: { value: '-1' } })
    fireEvent.change(screen.getByTestId('column-ref-value'), { target: { value: '12345678901234567890' } })

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('column-ref-value')).toHaveValue('')
  })

  it('brings up the number keyboard for an index', () => {
    renderControl({ mode: 'index', value: '' })

    expect(screen.getByTestId('column-ref-value')).toHaveAttribute('inputmode', 'numeric')
  })

  it('leaves a column name free of the number rule', () => {
    const { onChange } = renderControl({ mode: 'name', value: '' })
    expect(screen.getByTestId('column-ref-value')).not.toHaveAttribute('inputmode')

    fireEvent.change(screen.getByTestId('column-ref-value'), { target: { value: '-1a' } })

    expect(onChange).toHaveBeenCalledWith({ mode: 'name', value: '-1a' })
  })
})
