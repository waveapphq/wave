/**
 * ExpressionField - template mode reaches the inline field and its full editor (VMGR-74, REQ-3.1.3.15).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

const seen = vi.hoisted(() => ({
  input: [] as Array<Record<string, unknown>>,
  modal: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/features/workbench/common/element-config/expressions/expression-input', () => ({
  ExpressionInput: (props: Record<string, unknown>) => {
    seen.input.push(props)
    return null
  },
}))
vi.mock('@/features/workbench/common/element-config/expressions/expression-editor-modal', () => ({
  ExpressionEditorModal: (props: Record<string, unknown>) => {
    seen.modal.push(props)
    return null
  },
}))

import { ExpressionField } from '@/features/workbench/common/element-config/expressions/expression-field'

function renderField(template?: boolean, name = 'greeting') {
  render(
    <ExpressionField
      name={name}
      value="Hello {{ user }}"
      onChange={() => undefined}
      availableVariables={[]}
      template={template}
    />,
  )
  return { input: seen.input.at(-1), modal: seen.modal.at(-1) }
}

beforeEach(() => {
  seen.input = []
  seen.modal = []
})

describe('ExpressionField - template mode (REQ-3.1.3.15)', () => {
  it('edits a template inline and in a full editor that takes line breaks', () => {
    const { input, modal } = renderField(true)
    expect(input).toMatchObject({ template: true })
    expect(modal).toMatchObject({ template: true, singleLine: false })
  })

  it('keeps an expression on one line in both', () => {
    const { input, modal } = renderField()
    expect(input).toMatchObject({ template: false })
    expect(modal).toMatchObject({ template: false, singleLine: true })
  })
})

describe('ExpressionField - the full editor title', () => {
  it('titles the full editor after the variable name', () => {
    expect(renderField(true).modal).toMatchObject({ title: 'Edit greeting' })
  })

  it.each(['', '   '])('leaves the title to the editor\'s own fallback while the name is %j', (name) => {
    const { modal } = renderField(false, name)
    expect(modal).toHaveProperty('title', undefined)
  })
})
