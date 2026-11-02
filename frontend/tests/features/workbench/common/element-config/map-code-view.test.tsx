/**
 * String-only map Code view through the config-sheet map editor: plain JSON with string values, the exact non-string rejection,
 * source-level duplicate scan, generated-row collisions, and the Visual lock
 * while a member is rejected.
 */
import type { ComponentProps } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

const headersParam: Parameter = {
  name: 'headers',
  label: 'Headers',
  type: 'map',
  required: false,
  keyPolicy: { keyNoun: 'header', caseInsensitive: true },
}

async function openCode(
  user: ReturnType<typeof userEvent.setup>,
  value: Record<string, string>,
  extraProps: Partial<RowProps> = {},
) {
  const onChange = vi.fn()
  const parameter = extraProps.parameter ?? headersParam
  render(
    <table>
      <tbody>
        <ParameterRow
          mode="input"
          parameter={headersParam}
          value={value}
          onChange={onChange}
          availableVariables={[]}
          expressionFields={[]}
          onExpressionFieldsChange={vi.fn()}
          templateFields={[]}
          onTemplateFieldsChange={vi.fn()}
          allValues={{}}
          {...extraProps}
        />
      </tbody>
    </table>,
  )
  await user.click(screen.getByTestId(`param-expand-${parameter.name}`))
  await user.click(screen.getByTestId('view-dropdown'))
  await user.click(await screen.findByRole('option', { name: 'Code' }))
  return { onChange, code: await screen.findByTestId('code-body') }
}

describe('string-map Code view', () => {
  it('serializes the map as plain JSON string members', async () => {
    const user = userEvent.setup()
    const { code } = await openCode(user, { Authorization: 'Bearer {{ api_token }}' })
    expect(JSON.parse((code as HTMLTextAreaElement).value)).toEqual({
      Authorization: 'Bearer {{ api_token }}',
    })
  })

  it('round-trips an edited Code document into the saved map', async () => {
    const user = userEvent.setup()
    const { onChange, code } = await openCode(user, {})
    fireEvent.change(code, {
      target: { value: '{"Accept": "application/json"}' },
    })
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onChange).toHaveBeenCalledWith({ Accept: 'application/json' })
  })

  it('rejects a non-string member with the exact message and locks Visual', async () => {
    const user = userEvent.setup()
    const { code } = await openCode(user, {})
    fireEvent.change(code, { target: { value: '{"Retries": 3}' } })
    expect(screen.getByTestId('value-editor-validation')).toHaveTextContent(
      'Key "Retries": value must be a quoted string or a {{ expression }}',
    )
    expect(screen.getByTestId('value-editor-save-button')).toBeDisabled()
    await user.click(screen.getByTestId('view-dropdown'))
    const visualOption = await screen.findByRole('option', { name: /Visual/ })
    expect(visualOption).toHaveAttribute('data-disabled')
  })

  it('accepts a bare {{ }} expression value with no syntax error and Save enabled', async () => {
    const user = userEvent.setup()
    const { code } = await openCode(user, {}, { onExpressionFieldsChange: vi.fn() })
    fireEvent.change(code, { target: { value: '{"123": "12323", "dsad": {{ abs(-1) }}}' } })
    expect(screen.queryByTestId('value-editor-validation')).not.toBeInTheDocument()
    expect(screen.getByTestId('value-editor-save-button')).not.toBeDisabled()
  })

  it('flags a source-level case-insensitive duplicate member', async () => {
    const user = userEvent.setup()
    const { code } = await openCode(user, {})
    fireEvent.change(code, {
      target: { value: '{"Accept": "a", "accept": "b"}' },
    })
    expect(screen.getByTestId('value-editor-validation')).toHaveTextContent(
      'Duplicate header "Accept" (header names are case-insensitive)',
    )
  })

  it('flags a member colliding with a generated row', async () => {
    const user = userEvent.setup()
    const { code } = await openCode(user, {}, {
      mapExtras: {
        generatedRows: [
          { key: 'Authorization', value: '********', masked: true, onDelete: vi.fn() },
        ],
        missingHeaderAdvisories: [],
      },
    })
    fireEvent.change(code, {
      target: { value: '{"authorization": "Basic abc"}' },
    })
    expect(screen.getByTestId('value-editor-validation')).toHaveTextContent(
      'Duplicate header "authorization" (header names are case-insensitive)',
    )
  })

  it('keeps the amber advisory stripe active in Code view', async () => {
    const user = userEvent.setup()
    await openCode(user, {}, {
      mapExtras: {
        generatedRows: [],
        missingHeaderAdvisories: [
          {
            key: 'Content-Type',
            message: 'Content-Type is not set - the transport will send its own default',
          },
        ],
      },
    })
    expect(screen.getByTestId('value-editor-advisory')).toHaveTextContent(
      'Content-Type is not set - the transport will send its own default',
    )
  })
})

describe('typed map Code view (REQ-3.1.3.19)', () => {
  const driverOptions: Parameter = {
    name: 'driver_options',
    label: 'Driver options',
    type: 'map',
    required: false,
    typedValues: true,
  }

  it('writes each row as its type and reads a bare expression row back', async () => {
    const user = userEvent.setup()
    const onElementTypesChange = vi.fn()
    const onExpressionFieldsChange = vi.fn()
    const { onChange, code } = await openCode(user, { n: '16', zip: '02134' }, {
      parameter: driverOptions,
      elementTypes: { n: 'integer', zip: 'string' },
      expressionFields: [],
      onElementTypesChange,
      onExpressionFieldsChange,
    })
    expect(JSON.parse((code as HTMLTextAreaElement).value)).toEqual({ n: 16, zip: '02134' })

    fireEvent.change(code, { target: { value: '{"n": 17, "app": {{ x + 1 }}}' } })
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onChange).toHaveBeenCalledWith({ n: '17', app: 'x + 1' })
    expect(onElementTypesChange).toHaveBeenCalledWith({ n: 'integer' })
    expect(onExpressionFieldsChange).toHaveBeenCalledWith(['driver_options.app'])
  })
})
