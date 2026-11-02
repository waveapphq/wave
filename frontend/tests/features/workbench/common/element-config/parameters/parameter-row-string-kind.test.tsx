/**
 * ParameterRow - string value kind routing.
 *
 * Every string param routes through StringInput, which draws the one value field
 * (a text box named by the row label) with its expand to the "Edit value" sheet; the
 * expression box (`param-input-<name>`) shows only in {x} mode. The Literal / Template / Expression kinds stay mutually
 * exclusive: turning the `{}` expression toggle ON removes the param from
 * templateFields, and a param in expression mode renders the ExpressionField, so
 * the Template sheet can never coexist with an expression.
 *
 * The enum branch of the same dispatch picks between the two enum controls: the
 * plain select, or the searchable picker when the descriptor sets enumSearchable.
 * Both call sites take the same four props and neither takes `locked`.
 * Design Reference: REQ-3.1.1.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The shared "Edit value" sheet is heavy (CodeMirror); the routing tests only
// need the row's preview affordance, so stub it out.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: () => null,
}))

// Both enum controls stand in as prop recorders: the row's choice and the props it hands over.
const enumCallsites = vi.hoisted(() => ({
  plain: [] as Record<string, unknown>[],
  searchable: [] as Record<string, unknown>[],
}))

vi.mock('@/features/workbench/common/element-config/parameters/parameter-value-inputs', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/features/workbench/common/element-config/parameters/parameter-value-inputs')
    >()
  return {
    ...actual,
    EnumInput: (props: Parameters<typeof actual.EnumInput>[0]) => {
      enumCallsites.plain.push(props as unknown as Record<string, unknown>)
      return <div data-testid="stub-enum-input" />
    },
  }
})

vi.mock('@/features/workbench/common/element-config/parameters/enum-picker-input', () => ({
  EnumPickerInput: (props: Record<string, unknown>) => {
    enumCallsites.searchable.push(props)
    return <div data-testid="stub-enum-picker-input" />
  },
}))

import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'

const bodyStringParam = {
  name: 'body',
  label: 'Body',
  type: 'string' as const,
  required: false,
}

const hostStringParam = {
  name: 'host',
  label: 'Host',
  type: 'string' as const,
  required: false,
}

const booleanParam = {
  name: 'flag',
  label: 'Flag',
  type: 'boolean' as const,
  required: false,
}

const urlParam = {
  name: 'url',
  label: 'URL',
  type: 'string' as const,
  required: true,
}

const defaultRowProps = {
  mode: 'input' as const,
  onChange: vi.fn(),
  availableVariables: [{ name: 'base_url', type: 'string' }],
  expressionFields: [] as string[],
  onExpressionFieldsChange: vi.fn(),
  templateFields: [] as string[],
  onTemplateFieldsChange: vi.fn(),
}

/** Wrap ParameterRow in a table (it renders <tr>) */
function renderRow(props: React.ComponentProps<typeof ParameterRow>) {
  return render(
    <table>
      <tbody>
        <ParameterRow {...props} />
      </tbody>
    </table>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ParameterRow string value kind routing', () => {
  describe('unified string input affordance', () => {
    it('routes a many-line string value to the one value field and its expand (not the expression box)', () => {
      renderRow({ ...defaultRowProps, parameter: bodyStringParam, value: 'line1\nline2' })
      expect(screen.getByRole('textbox', { name: 'Body' })).toBeInTheDocument()
      expect(screen.getByTestId('param-expand-body')).toBeInTheDocument()
      expect(screen.queryByTestId('param-input-body')).not.toBeInTheDocument()
    })

    it('routes a one-line string value to the one value field and its expand (not the expression box)', () => {
      renderRow({ ...defaultRowProps, parameter: hostStringParam, value: 'example.com' })
      expect(screen.getByRole('textbox', { name: 'Host' })).toBeInTheDocument()
      expect(screen.getByTestId('param-expand-host')).toBeInTheDocument()
      expect(screen.queryByTestId('param-input-host')).not.toBeInTheDocument()
    })
  })

  describe('kind mutual exclusivity', () => {
    it('toggling the {} expression ON removes the param from templateFields', async () => {
      const user = userEvent.setup()
      const onExpressionFieldsChange = vi.fn()
      const onTemplateFieldsChange = vi.fn()
      renderRow({
        ...defaultRowProps,
        parameter: bodyStringParam,
        value: 'hello',
        templateFields: ['body'],
        onExpressionFieldsChange,
        onTemplateFieldsChange,
      })

      await user.click(screen.getByTestId('expression-toggle'))
      // The field holds a value, so the switch warning asks first (FIELD-7).
      expect(onExpressionFieldsChange).not.toHaveBeenCalled()
      await user.click(screen.getByTestId('switch-mode-clear-default'))

      // The param becomes an expression...
      expect(onExpressionFieldsChange).toHaveBeenCalledWith(['body'])
      // ...and is cleared from templateFields so the kinds stay exclusive.
      expect(onTemplateFieldsChange).toHaveBeenCalledWith([])
    })

    it('renders the expression field (not the value preview) when the param is an expression', () => {
      renderRow({
        ...defaultRowProps,
        parameter: hostStringParam,
        value: 'base_url',
        expressionFields: ['host'],
      })
      // The Template/literal value preview cannot coexist with an expression...
      expect(screen.queryByRole('textbox', { name: 'Host' })).not.toBeInTheDocument()
      // ...the inline expression editor is shown instead.
      expect(screen.getByTestId('param-input-host')).toBeInTheDocument()
    })
  })

  describe('unchanged behaviors', () => {
    it('leaves a non-string widget (boolean) untouched', () => {
      renderRow({ ...defaultRowProps, parameter: booleanParam, value: true })
      expect(screen.getByRole('checkbox')).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('still surfaces the URL format error in the row after the affordance swap', () => {
      renderRow({ ...defaultRowProps, parameter: urlParam, value: 'not-a-url' })
      expect(screen.getByRole('alert')).toHaveTextContent(
        'URL must start with http:// or https://',
      )
    })
  })
})

// ============================================================================
// Enum control routing
// ============================================================================

describe('ParameterRow enum control routing', () => {
  const KIND_VALUES = ['Deployment', 'Pod', 'Service']
  const FOUR_PROPS = ['parameter', 'effectiveValue', 'onChange', 'showRequiredError']

  const plainEnumParam = {
    name: 'kind',
    label: 'Kind',
    type: 'string' as const,
    required: false,
    enumValues: KIND_VALUES,
  }
  const searchableEnumParam = { ...plainEnumParam, enumSearchable: true }

  beforeEach(() => {
    enumCallsites.plain.length = 0
    enumCallsites.searchable.length = 0
  })

  it('routes an enum param to the plain select when the descriptor does not opt into search', () => {
    renderRow({ ...defaultRowProps, parameter: plainEnumParam, value: 'Pod' })
    expect(screen.getByTestId('stub-enum-input')).toBeInTheDocument()
    expect(screen.queryByTestId('stub-enum-picker-input')).not.toBeInTheDocument()
    expect(enumCallsites.searchable).toHaveLength(0)
  })

  it('routes an enum param to the searchable picker when enumSearchable is set', () => {
    renderRow({ ...defaultRowProps, parameter: searchableEnumParam, value: 'Pod' })
    expect(screen.getByTestId('stub-enum-picker-input')).toBeInTheDocument()
    expect(screen.queryByTestId('stub-enum-input')).not.toBeInTheDocument()
    expect(enumCallsites.plain).toHaveLength(0)
  })

  it('passes exactly the same four props, in the same order, at both call sites', () => {
    const onChange = vi.fn()
    const plain = renderRow({ ...defaultRowProps, parameter: plainEnumParam, value: 'Pod', onChange })
    plain.unmount()
    renderRow({ ...defaultRowProps, parameter: searchableEnumParam, value: 'Pod', onChange })

    const plainProps = enumCallsites.plain.at(-1)!
    const pickerProps = enumCallsites.searchable.at(-1)!

    // Same four names, same order, and no `locked` on either.
    expect(Object.keys(plainProps)).toEqual(FOUR_PROPS)
    expect(Object.keys(pickerProps)).toEqual(FOUR_PROPS)

    expect(plainProps.parameter).toBe(plainEnumParam)
    expect(pickerProps.parameter).toBe(searchableEnumParam)
    expect(plainProps.effectiveValue).toBe('Pod')
    expect(pickerProps.effectiveValue).toBe(plainProps.effectiveValue)
    expect(plainProps.onChange).toBe(onChange)
    expect(pickerProps.onChange).toBe(onChange)
    expect(plainProps.showRequiredError).toBe(false)
    expect(pickerProps.showRequiredError).toBe(false)
  })

  it('leaves the required-error flag off at both call sites while the enum holds a value', () => {
    const plain = renderRow({ ...defaultRowProps, parameter: plainEnumParam, value: 'Pod' })
    plain.unmount()
    renderRow({ ...defaultRowProps, parameter: searchableEnumParam, value: 'Pod' })

    expect(enumCallsites.plain.at(-1)!.showRequiredError).toBe(false)
    expect(enumCallsites.searchable.at(-1)!.showRequiredError).toBe(false)
  })

  it('raises the required-error flag at both call sites when a required enum is empty', () => {
    const required = { ...defaultRowProps, value: undefined }
    const plain = renderRow({ ...required, parameter: { ...plainEnumParam, required: true } })
    plain.unmount()
    renderRow({ ...required, parameter: { ...searchableEnumParam, required: true } })

    expect(enumCallsites.plain.at(-1)!.showRequiredError).toBe(true)
    expect(enumCallsites.searchable.at(-1)!.showRequiredError).toBe(true)
  })
})

// ============================================================================
// Typed choice values (REQ-3.1.2.11)
// ============================================================================

describe('ParameterRow typed choice values (REQ-3.1.2.11)', () => {
  const DATABASE = {
    name: 'database',
    label: 'Database',
    type: 'string' as const,
    required: false,
    enumValues: ['sqlite', 'postgres'],
    enumLabels: { sqlite: 'SQLite', postgres: 'PostgreSQL' },
  }
  const LEVEL = {
    name: 'level',
    label: 'Level',
    type: 'integer' as const,
    required: false,
    enumValues: [1, 2, 3],
    showWhen: { field: 'database', values: ['sqlite', 'postgres'] },
  }
  const RATIO = {
    name: 'ratio',
    label: 'Ratio',
    type: 'float' as const,
    required: false,
    enumValues: [0.5, 1.5],
    showWhen: { field: 'database', values: ['sqlite', 'postgres'] },
  }

  function renderTyped(parameter: typeof LEVEL | typeof RATIO, value: number) {
    renderRow({
      ...defaultRowProps,
      parameter,
      value,
      allValues: { database: 'sqlite', [parameter.name]: value },
      allParameters: [DATABASE, parameter],
    })
  }

  beforeEach(() => {
    enumCallsites.plain.length = 0
  })

  it('hands the stored number to the select as it is stored', () => {
    renderTyped(LEVEL, 2)
    expect(enumCallsites.plain.at(-1)!.effectiveValue).toBe(2)
  })

  it('shows no unoffered-option message for an offered integer', () => {
    renderTyped(LEVEL, 2)
    expect(screen.queryByTestId('param-error-level')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows no unoffered-option message for an offered float', () => {
    renderTyped(RATIO, 1.5)
    expect(screen.queryByTestId('param-error-ratio')).not.toBeInTheDocument()
  })

  it('names an integer the row does not offer, with the value its gate reads', () => {
    renderTyped(LEVEL, 4)
    expect(screen.getByTestId('param-error-level')).toHaveTextContent(/^Level '4' is not available on SQLite$/)
  })
})
