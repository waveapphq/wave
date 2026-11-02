/**
 * ParameterRow: overflow + name-prop wiring tests
 *
 *   - Row's value column propagates the `min-w-0` cascade so child inputs
 *     can ellipsize / scroll instead of stretching the row.
 *   - Expression mode passes a user-meaningful `name` (parameter.label ?? name)
 *     to ExpressionField so the modal title becomes "Edit {paramLabel}"
 *     instead of "Edit assert-expr-expr-2".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock the ExpressionField - we just want to assert the props it receives.
vi.mock('@/features/workbench/common/element-config/expressions/expression-field', () => ({
  ExpressionField: (props: { name: string; displayName?: string; value: string }) => (
    <div
      data-testid="mock-expression-field"
      data-name={props.name}
      data-display-name={props.displayName ?? ''}
      data-value={props.value}
    />
  ),
}))

// Avoid the heavy widgets we don't need for these assertions.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: () => null,
}))

import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'

const stringParam = {
  name: 'url',
  label: 'Request URL',
  type: 'string' as const,
  required: true,
}

const baseProps = {
  mode: 'input' as const,
  onChange: vi.fn(),
  availableVariables: [],
  templateFields: [] as string[],
  onTemplateFieldsChange: vi.fn(),
}

function renderRow(node: React.ReactNode) {
  return render(
    <table>
      <tbody>{node}</tbody>
    </table>,
  )
}

describe('ParameterRow overflow + name-prop wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('min-w-0 cascade', () => {
    it('value column wraps the input in a min-w-0 container so long values scroll/ellipsize', () => {
      renderRow(
        <ParameterRow
          {...baseProps}
          parameter={stringParam}
          value=""
          expressionFields={[]}
          onExpressionFieldsChange={vi.fn()}
        />,
      )

      // The shared input wrapper inside the value column must carry min-w-0;
      // without it text-overflow: ellipsis silently no-ops (auto min-width).
      const input = screen.getByRole('textbox', { name: 'Request URL' })
      const valueWrapper = input.closest('.min-w-0')
      expect(valueWrapper).not.toBeNull()
      expect(input.closest('td')).toContainElement(valueWrapper as HTMLElement)
    })
  })

  describe('expression-field display-name wiring', () => {
    it('passes the parameter label as displayName so the modal title uses the user-facing name', () => {
      renderRow(
        <ParameterRow
          {...baseProps}
          parameter={stringParam}
          value="endpoint + path"
          expressionFields={['url']}
          onExpressionFieldsChange={vi.fn()}
        />,
      )

      const field = screen.getByTestId('mock-expression-field')
      // The modal title becomes "Edit {parameter.label}". The technical
      // `name` stays parameter.name so test selectors (and autocomplete state)
      // remain stable across re-labels.
      expect(field).toHaveAttribute('data-name', 'url')
      expect(field).toHaveAttribute('data-display-name', 'Request URL')
    })

    it('omits / falls back when the parameter has no label', () => {
      const noLabelParam = { ...stringParam, label: undefined }
      renderRow(
        <ParameterRow
          {...baseProps}
          parameter={noLabelParam}
          value=""
          expressionFields={['url']}
          onExpressionFieldsChange={vi.fn()}
        />,
      )

      const field = screen.getByTestId('mock-expression-field')
      expect(field).toHaveAttribute('data-name', 'url')
      // displayName falls back to parameter.name when no label is provided.
      expect(field).toHaveAttribute('data-display-name', 'url')
    })
  })
})

describe('ParameterRow name cell wraps instead of cutting (REQ-3.1.1.5)', () => {
  const VERIFY = {
    name: 'verify_server_certificate',
    label: 'Verify Server Certificate',
    type: 'boolean' as const,
    required: false,
    description: 'Check the certificate the server sends.',
  }

  function renderVerify() {
    renderRow(
      <ParameterRow
        {...baseProps}
        parameter={VERIFY}
        value={true}
        expressionFields={[]}
        onExpressionFieldsChange={vi.fn()}
      />,
    )
    return screen.getByTestId('param-row-verify_server_certificate').querySelectorAll('td')[1]
  }

  /** Hovers an element and waits out the tooltip delay. */
  async function hoverPastTheDelay(element: Element) {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.hover(element)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the whole name in the cell, with nothing in it that cuts the text', () => {
    const nameCell = renderVerify()
    expect(nameCell).toHaveTextContent(/^Verify Server Certificate$/)
    const cutting = [nameCell, ...Array.from(nameCell.querySelectorAll<HTMLElement>('*'))].filter((element) =>
      Array.from(element.classList).some(
        (name) =>
          name === 'truncate' || name === 'text-ellipsis' || name === 'whitespace-nowrap' || name.startsWith('line-clamp'),
      ),
    )
    expect(cutting).toEqual([])
  })

  it('adds no hover tooltip that repeats the name', async () => {
    const nameCell = renderVerify()
    await hoverPastTheDelay(screen.getByText('Verify Server Certificate'))
    const tooltips = screen.queryAllByRole('tooltip').map((tooltip) => tooltip.textContent)
    expect(tooltips).not.toContain('Verify Server Certificate')
    expect(nameCell.querySelector('[data-state]')).toBeNull()
  })

  it('still shows the description tooltip on the info icon', async () => {
    renderVerify()
    const row = screen.getByTestId('param-row-verify_server_certificate')
    await hoverPastTheDelay(row.querySelectorAll('td')[0].querySelector('span') as Element)
    const tooltips = screen.queryAllByRole('tooltip').map((tooltip) => tooltip.textContent)
    expect(tooltips).toContain('Check the certificate the server sends.')
  })
})

describe('ParameterRow names the value text box by the row label alone (REQ-3.1.1.5)', () => {
  it('gives a required row\'s text box the exact label, without the required word of its star', () => {
    renderRow(
      <ParameterRow
        {...baseProps}
        parameter={stringParam}
        value="https://api.test"
        expressionFields={[]}
        onExpressionFieldsChange={vi.fn()}
      />,
    )

    const row = screen.getByTestId('param-row-url')
    expect(row.querySelectorAll('td')[1]).toHaveTextContent(/^Request URL\* required$/)
    expect(screen.getByRole('textbox', { name: 'Request URL' })).toHaveAccessibleName('Request URL')
    expect(screen.queryByRole('textbox', { name: /required/ })).not.toBeInTheDocument()
  })

  it('names the text box of a row with no label by its wire name', () => {
    renderRow(
      <ParameterRow
        {...baseProps}
        parameter={{ ...stringParam, label: undefined }}
        value="https://api.test"
        expressionFields={[]}
        onExpressionFieldsChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('textbox', { name: 'url' })).toHaveAccessibleName('url')
  })
})
