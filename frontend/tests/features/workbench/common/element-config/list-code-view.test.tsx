/**
 * The Code view of a plain Block list field's Edit value sheet: an {x} item is a bare {{ expr }}, read back as {x}
 * with its index, so Visual and Code stay in step (Map / Array Parameter Input, FIELD-6, REQ-3.1.3.19).
 */
import type { ComponentProps } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'

vi.mock('@/components/shared/variable-bodies/code-body', () => ({
  CodeBody: ({
    onChange,
    onValidChange,
    serialize,
    value,
    jsonMask,
  }: {
    onChange?: (text: string) => void
    onValidChange?: (valid: boolean) => void
    serialize?: (value: unknown) => string
    value: unknown
    jsonMask?: (text: string) => string
  }) => (
    <textarea
      data-testid="code-body"
      defaultValue={serialize?.(value)}
      onChange={(event) => {
        const text = event.target.value
        try {
          // Mirror the real CodeBody: validity runs through the grammar mask.
          JSON.parse(jsonMask ? jsonMask(text) : text)
          onValidChange?.(true)
        } catch {
          onValidChange?.(false)
        }
        onChange?.(text)
      }}
    />
  ),
}))

import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'

type RowProps = ComponentProps<typeof ParameterRow>
type User = ReturnType<typeof userEvent.setup>

const TARGETS: Parameter = { name: 'targets', label: 'Targets', type: 'array', required: false }
const PARAMS: Parameter = { name: 'params', label: 'Params', type: 'array', required: false, typedValues: true }

function renderRow(parameter: Parameter, value: unknown[], extraProps: Partial<RowProps> = {}) {
  const spies = { onChange: vi.fn(), onExpressionFieldsChange: vi.fn(), onElementTypesChange: vi.fn() }
  render(
    <table>
      <tbody>
        <ParameterRow
          mode="input"
          parameter={parameter}
          value={value}
          onChange={spies.onChange}
          availableVariables={[]}
          expressionFields={[]}
          onExpressionFieldsChange={spies.onExpressionFieldsChange}
          onElementTypesChange={spies.onElementTypesChange}
          templateFields={[]}
          onTemplateFieldsChange={vi.fn()}
          allValues={{}}
          {...extraProps}
        />
      </tbody>
    </table>,
  )
  return { user: userEvent.setup(), ...spies }
}

async function pickView(user: User, view: 'Visual' | 'Code') {
  await user.click(screen.getByTestId('view-dropdown'))
  await user.click(await screen.findByRole('option', { name: view }))
}

async function openCode(user: User, parameter: Parameter) {
  await user.click(screen.getByTestId(`param-expand-${parameter.name}`))
  await pickView(user, 'Code')
  return screen.findByTestId('code-body') as Promise<HTMLTextAreaElement>
}

const listBody = () => screen.getByTestId('array-edit-body')
const toggle = (index: number) => within(listBody()).getByTestId(`array-expr-toggle-${index}`)
const save = (user: User) => user.click(screen.getByTestId('value-editor-save-button'))

describe('A plain list field: the {x} items in Code', () => {
  it('shows an {x} item as a bare {{ expr }}', async () => {
    const { user } = renderRow(TARGETS, ['a', 'x'], { expressionFields: ['targets.1'] })
    const code = await openCode(user, TARGETS)
    expect(code.value).toBe('[\n  "a",\n  {{ x }}\n]')
    expect(screen.queryByTestId('value-editor-validation')).not.toBeInTheDocument()
  })

  it('keeps item 1 as {x} when the Code edit goes back to Visual', async () => {
    const { user } = renderRow(TARGETS, ['a', 'x'], { expressionFields: ['targets.1'] })
    const code = await openCode(user, TARGETS)
    fireEvent.change(code, { target: { value: '["b", {{ y }}]' } })
    await pickView(user, 'Visual')
    expect(within(listBody()).getByTestId('array-edit-input-0')).toHaveValue('b')
    expect(toggle(0)).toHaveAttribute('aria-pressed', 'false')
    expect(toggle(1)).toHaveAttribute('aria-pressed', 'true')
    expect(within(listBody()).getByTestId('array-expr-value-1')).toHaveTextContent(/^y$/)
  })

  it('reports the {x} indices the Code text leaves on Save', async () => {
    const { user, onChange, onExpressionFieldsChange } = renderRow(TARGETS, ['a', 'x'], {
      expressionFields: ['url', 'targets.1'],
    })
    const code = await openCode(user, TARGETS)
    fireEvent.change(code, { target: { value: '[{{ host }}, "b", {{ z }}]' } })
    await save(user)
    expect(onChange).toHaveBeenCalledWith(['host', 'b', 'z'])
    expect(onExpressionFieldsChange).toHaveBeenCalledWith(['url', 'targets.0', 'targets.2'])
  })

  it('takes an {x} item out of {x} when Code writes it quoted', async () => {
    const { user, onChange, onExpressionFieldsChange } = renderRow(TARGETS, ['a', 'x'], {
      expressionFields: ['targets.1'],
    })
    const code = await openCode(user, TARGETS)
    fireEvent.change(code, { target: { value: '["a", "x"]' } })
    await save(user)
    expect(onChange).toHaveBeenCalledWith(['a', 'x'])
    expect(onExpressionFieldsChange).toHaveBeenCalledWith([])
  })
})

describe('A typed list field: the {x} items in Code and their element types', () => {
  it('reads a bare {{ expr }} item of a typed list as {x}, with Save open', async () => {
    const { user, onChange, onExpressionFieldsChange, onElementTypesChange } = renderRow(PARAMS, ['16'], {
      elementTypes: ['integer'],
    })
    const code = await openCode(user, PARAMS)
    expect(code.value).toBe('[\n  16\n]')
    fireEvent.change(code, { target: { value: '[16, {{ n + 1 }}]' } })
    expect(screen.queryByTestId('value-editor-validation')).not.toBeInTheDocument()
    await save(user)
    expect(onChange).toHaveBeenCalledWith(['16', 'n + 1'])
    expect(onExpressionFieldsChange).toHaveBeenCalledWith(['params.1'])
    expect(onElementTypesChange).toHaveBeenCalledWith(['integer', 'string'])
  })

  it('shows a typed {x} item in Code with no type error from the type it had', async () => {
    const { user } = renderRow(PARAMS, ['7', 'n + 1'], {
      elementTypes: ['integer', 'integer'],
      expressionFields: ['params.1'],
    })
    const code = await openCode(user, PARAMS)
    expect(code.value).toBe('[\n  7,\n  {{ n + 1 }}\n]')
    expect(screen.queryByTestId('value-editor-validation')).not.toBeInTheDocument()
  })

  it('stores no List or Map type for an item switched into {x}', async () => {
    const { user, onExpressionFieldsChange, onElementTypesChange } = renderRow(PARAMS, ['{"a": 1}', '7'], {
      elementTypes: ['map', 'integer'],
    })
    await user.click(screen.getByTestId('param-expand-params'))
    await user.click(toggle(0))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await save(user)
    expect(onExpressionFieldsChange).toHaveBeenCalledWith(['params.0'])
    expect(onElementTypesChange).toHaveBeenCalledWith(['string', 'integer'])
  })
})
