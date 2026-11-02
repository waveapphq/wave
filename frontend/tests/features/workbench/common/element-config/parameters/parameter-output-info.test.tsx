/**
 * ParameterTable / ParameterRow - OUTPUT-mode info column.
 *
 * INPUT and OUTPUT tables share ONE column template - both reserve the
 * leading info column so their columns line up in the config modal.
 * The (i) info affordance (with the parameter's Description tooltip) is
 * shown for OUTPUT parameters too, not only inputs.
 *
 * Design decisions: FNCFG-1, FNCFG-2.
 */

import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

interface Parameter {
  name: string
  label?: string
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
  required: boolean
  description?: string
}

const outputWithDescription: Parameter[] = [
  { name: 'statusCode', type: 'integer', required: false, description: 'HTTP status code' },
]

const inputWithDescription: Parameter[] = [
  { name: 'url', type: 'string', required: true, description: 'The URL to request' },
]


describe('(i) info on OUTPUT parameters', () => {
  it('renders the output parameter Description in the info affordance', async () => {
    const { ParameterTable } = await import(
      '@/features/workbench/common/element-config/parameters/parameter-table'
    )
    render(
      <ParameterTable
        mode="output"
        parameters={outputWithDescription}
        values={{}}
        onChange={() => {}}
        availableVariables={[]}
      />,
    )
    // SHELL-7a: the description is revealed by the shared tooltip.
    fireEvent.focus(screen.getByTestId('output-row-statusCode').querySelector('.cursor-help') as HTMLElement)
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
      'HTTP status code',
    )
  })

  it('does not crash when an output parameter has no description', async () => {
    const { ParameterTable } = await import(
      '@/features/workbench/common/element-config/parameters/parameter-table'
    )
    render(
      <ParameterTable
        mode="output"
        parameters={[{ name: 'body', type: 'string', required: false }]}
        values={{}}
        onChange={() => {}}
        availableVariables={[]}
      />,
    )
    expect(screen.getByTestId('output-row-body')).toBeInTheDocument()
  })
})


describe('shared INPUT/OUTPUT column template', () => {
  // SECUI-3/4: OUTPUT gains a Secret column between Type and Assign-to, so it is
  // one column WIDER than INPUT (which has no secret concept). Both still
  // reserve the leading empty info spacer so the shared columns line up.
  it('OUTPUT thead reserves the leading info column (info + Secret = 5 columns)', async () => {
    const { ParameterTable } = await import(
      '@/features/workbench/common/element-config/parameters/parameter-table'
    )
    const { container } = render(
      <ParameterTable
        mode="output"
        parameters={outputWithDescription}
        values={{}}
        onChange={() => {}}
        availableVariables={[]}
      />,
    )
    const headerCells = container.querySelectorAll('thead th')
    expect(headerCells).toHaveLength(5)
    // The first column is the info column: no visible label, named for screen readers.
    expect(headerCells[0].textContent).toBe('')
    expect(headerCells[0]).toHaveAccessibleName('Description')
    // The Secret column header sits between Type and Assign-to.
    expect(Array.from(headerCells).map((c) => c.textContent)).toEqual([
      '',
      'Parameter',
      'Type',
      'Secret',
      'Assign to',
    ])
  })

  it('OUTPUT renders exactly one more header column (Secret) than INPUT', async () => {
    const { ParameterTable } = await import(
      '@/features/workbench/common/element-config/parameters/parameter-table'
    )
    const input = render(
      <ParameterTable
        mode="input"
        parameters={inputWithDescription}
        values={{}}
        onChange={() => {}}
        availableVariables={[]}
      />,
    )
    const inputCols = input.container.querySelectorAll('thead th').length
    input.unmount()

    const output = render(
      <ParameterTable
        mode="output"
        parameters={outputWithDescription}
        values={{}}
        onChange={() => {}}
        availableVariables={[]}
      />,
    )
    const outputCols = output.container.querySelectorAll('thead th').length
    expect(outputCols).toBe(inputCols + 1)
  })

  it('OUTPUT rows render an info cell aligned with the header (shared row template)', async () => {
    const { ParameterTable } = await import(
      '@/features/workbench/common/element-config/parameters/parameter-table'
    )
    render(
      <ParameterTable
        mode="output"
        parameters={outputWithDescription}
        values={{}}
        onChange={() => {}}
        availableVariables={[]}
      />,
    )
    const row = screen.getByTestId('output-row-statusCode')
    // 5 cells: info, parameter, type, secret, assign-to (SECUI-3/4).
    expect(within(row).getAllByRole('cell')).toHaveLength(5)
  })
})
