/**
 * Tests for MismatchBody - the shared type-mismatch guard body rendered by
 * the inspect modal host when a displayed RUNTIME value does not match the
 * declared type.
 *
 * Contract under test:
 *   - amber italic notice line: `received <actual> - declared <declared>`
 *     (lowercase type names, regular hyphen)
 *   - raw value below the notice, formatted by formatCellText and tinted by
 *     the value's ACTUAL render type (getCellColorClass(inferRenderType))
 *   - data-testid="mismatch-body"
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { MismatchBody } from '@/components/shared/variable-bodies/mismatch-body'
import type { VariableType } from '@/lib/variable-types'

function renderBody(value: unknown, declaredType: VariableType) {
  return render(<MismatchBody value={value} declaredType={declaredType} />)
}

function getBody(): HTMLElement {
  return screen.getByTestId('mismatch-body')
}

describe('MismatchBody - notice line', () => {
  it('renders the exact copy for a map received on a declared integer', () => {
    renderBody({}, 'integer')
    expect(
      within(getBody()).getByText('received map - declared integer'),
    ).toBeInTheDocument()
  })

  it('styles the notice amber and italic', () => {
    renderBody({}, 'integer')
    const notice = within(getBody()).getByText('received map - declared integer')
    expect(notice.className).toMatch(/amber/)
    expect(notice.className).toMatch(/italic/)
  })

  it.each([
    ['oops', 'integer', 'received string - declared integer'],
    [42, 'string', 'received integer - declared string'],
    [3.5, 'integer', 'received float - declared integer'],
    [true, 'string', 'received boolean - declared string'],
    [[1, 2], 'map', 'received array - declared map'],
    [{ a: 1 }, 'array', 'received map - declared array'],
  ] as const)(
    'derives the actual type from the value: %s on declared %s',
    (value, declaredType, expected) => {
      renderBody(value, declaredType)
      expect(within(getBody()).getByText(expected)).toBeInTheDocument()
    },
  )
})

describe('MismatchBody - raw value rendering', () => {
  it('renders a map value as compact one-line JSON tinted emerald', () => {
    renderBody({ host: 'x' }, 'integer')
    const raw = within(getBody()).getByText('{"host":"x"}')
    expect(raw.className).toMatch(/text-emerald/)
  })

  it('renders a string value quoted and tinted sky', () => {
    renderBody('oops', 'integer')
    const raw = within(getBody()).getByText('"oops"')
    expect(raw.className).toMatch(/text-sky/)
  })

  it('renders an integer value tinted violet', () => {
    renderBody(42, 'string')
    const raw = within(getBody()).getByText('42')
    expect(raw.className).toMatch(/text-violet/)
  })

  it('renders a float value tinted pink', () => {
    renderBody(3.5, 'integer')
    const raw = within(getBody()).getByText('3.5')
    expect(raw.className).toMatch(/text-pink/)
  })

  it('renders a boolean value tinted orange', () => {
    renderBody(true, 'string')
    const raw = within(getBody()).getByText('true')
    expect(raw.className).toMatch(/text-orange/)
  })

  it('renders an array value as compact one-line JSON tinted amber', () => {
    renderBody([1, 2], 'map')
    const raw = within(getBody()).getByText('[1,2]')
    expect(raw.className).toMatch(/text-amber-300/)
  })
})
