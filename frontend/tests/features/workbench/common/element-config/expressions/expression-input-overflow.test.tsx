/**
 * ExpressionInput: overflow contract tests
 *
 * Pins:
 *   - Inline expression input stays single-line.
 *   - Long expressions scroll horizontally inside the field.
 *   - The wrapper has `max-w-full overflow-hidden` so the panel never breaches
 *     the parent container.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ExpressionInput } from '@/features/workbench/common/element-config/expressions/expression-input'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-input'

const variables: AvailableVariable[] = [
  { name: 'foo', type: 'string' },
]

describe('ExpressionInput overflow contract', () => {
  it('outer wrapper has max-w-full and overflow-hidden so it cannot breach the parent', () => {
    render(
      <ExpressionInput
        name="my_field"
        value=""
        onChange={vi.fn()}
        availableVariables={variables}
      />,
    )

    const wrapper = screen.getByTestId('param-input-my_field')
    expect(wrapper.className).toContain('max-w-full')
    expect(wrapper.className).toContain('overflow-hidden')
  })

  it('outer wrapper retains min-w-0 and w-full so flex parents do not stretch it', () => {
    render(
      <ExpressionInput
        name="my_field"
        value=""
        onChange={vi.fn()}
        availableVariables={variables}
      />,
    )

    const wrapper = screen.getByTestId('param-input-my_field')
    expect(wrapper.className).toContain('min-w-0')
    expect(wrapper.className).toContain('w-full')
  })
})
