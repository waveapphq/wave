/**
 * ExpressionField: outer-wrapper overflow contract
 *
 * ExpressionField's own outer wrapper carries `w-full min-w-0`, mirroring TextField's
 * pattern, so any caller cell sees a barrier regardless of its own min-width. Var
 * Setter's value cell uses `flex-1 min-w-[140px]`; without the barrier CodeMirror's
 * intrinsic size pushes the row past the dialog body.
 */

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('@/features/workbench/common/element-config/expressions/expression-input', () => ({
  ExpressionInput: () => <div data-testid="expression-input-stub" />,
}))

vi.mock('@/features/workbench/common/element-config/expressions/expression-editor-modal', () => ({
  ExpressionEditorModal: () => null,
}))

import { ExpressionField } from '@/features/workbench/common/element-config/expressions/expression-field'

describe('ExpressionField outer wrapper', () => {
  it('carries w-full min-w-0 so callers whose cell has min-w-[N] are still protected', () => {
    const { getByTestId } = render(
      <ExpressionField
        name="param"
        value=""
        onChange={vi.fn()}
        availableVariables={[]}
      />,
    )

    const stub = getByTestId('expression-input-stub')
    const wrapper = stub.parentElement
    expect(wrapper?.className ?? '').toContain('min-w-0')
    expect(wrapper?.className ?? '').toContain('w-full')
  })
})
