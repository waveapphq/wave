/**
 * Tests for CreateParamFields - the Function input/output parameter
 * declaration cluster of the one variable window (VMGR-98, VMGR-112).
 * The assertions pin the checkbox order, the locks and their hints, the copy,
 * Create enum on String / Integer / Float inputs only and the exact enum messages.
 *
 * Contract under test:
 *   - Required shows for input only; output has no Required control
 *   - Description shows for both param modes and threads onDescriptionChange
 *   - input checkboxes in order Required, Mark as secret, Set to null, Create enum
 *   - Create enum shows only for a String / Integer / Float input; no Value Type select
 *   - a locked box is aria-disabled, keeps its hint linked by aria-describedby and ignores clicks
 *   - validateEnumValues returns the exact messages, typed by the input's type
 *
 * REQ-3.1.2.1: Create custom Functions with input parameters
 * REQ-3.1.2.10: Inputs with no default
 * REQ-3.1.2.11: Enum inputs
 * REQ-3.1.3.24: Set to null by hand
 */

import type { ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  CreateParamFields,
  NULL_FORCED_REASON,
  validateEnumValues,
  type SetToNullState,
} from '@/features/workbench/common/variables/variable-inspect-modal/create-param-fields'

type ParamType = 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'

const ENUMERABLE_TYPES: ReadonlySet<ParamType> = new Set<ParamType>(['string', 'integer', 'float'])

interface RenderOverrides {
  mode?: 'input' | 'output'
  type?: ParamType
  required?: boolean
  createEnum?: boolean
  description?: string
  secret?: boolean
  enumLocksSecret?: boolean
  secretLocksEnum?: boolean
  setToNull?: SetToNullState
  typeField?: ReactNode
  valueBody?: ReactNode
}

function renderFields(overrides: RenderOverrides = {}) {
  const type = overrides.type ?? 'string'
  const onRequiredChange = vi.fn()
  const onCreateEnumChange = vi.fn()
  const onDescriptionChange = vi.fn()
  const onSecretChange = vi.fn()
  // The secret, exclusion and Set to null props are passed only when a test sets them.
  const exclusion = {
    ...(overrides.secret === undefined ? {} : { secret: overrides.secret, onSecretChange }),
    ...(overrides.enumLocksSecret === undefined ? {} : { enumLocksSecret: overrides.enumLocksSecret }),
    ...(overrides.secretLocksEnum === undefined ? {} : { secretLocksEnum: overrides.secretLocksEnum }),
    ...(overrides.setToNull === undefined ? {} : { setToNull: overrides.setToNull }),
  }
  render(
    <CreateParamFields
      mode={overrides.mode ?? 'input'}
      type={type}
      typeIsEnumerable={ENUMERABLE_TYPES.has(type)}
      required={overrides.required ?? false}
      createEnum={overrides.createEnum ?? false}
      description={overrides.description ?? ''}
      onRequiredChange={onRequiredChange}
      onCreateEnumChange={onCreateEnumChange}
      onDescriptionChange={onDescriptionChange}
      typeField={overrides.typeField}
      valueBody={overrides.valueBody}
      {...exclusion}
    />,
  )
  return {
    onRequiredChange,
    onCreateEnumChange,
    onDescriptionChange,
    onSecretChange,
  }
}

function nullState(overrides: Partial<SetToNullState> = {}): SetToNullState {
  return { ticked: false, forcedBy: null, disabledByEnum: false, onChange: vi.fn(), ...overrides }
}

// The window's own props once Create enum is on: Required ticked, Mark as secret and Set to null locked off.
function renderEnumOn(overrides: RenderOverrides = {}) {
  return renderFields({
    mode: 'input',
    type: 'string',
    createEnum: true,
    required: true,
    enumLocksSecret: true,
    setToNull: nullState({ disabledByEnum: true }),
    ...overrides,
  })
}

const requiredBox = () => screen.getByTestId('param-required-checkbox')
const secretBox = () => screen.getByTestId('create-secret-checkbox')
const nullBox = () => screen.getByTestId('create-set-to-null-checkbox')
const enumBox = () => screen.getByTestId('param-create-enum-checkbox')

/** The texts a control's aria-describedby points at. */
function describedTexts(control: HTMLElement): string[] {
  return (control.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
}

// A locked row is aria-disabled and keeps its italic hint, linked to the box.
function expectLockedWithHint(control: HTMLElement, hint: string) {
  expect(control).toHaveAttribute('aria-disabled', 'true')
  expect(describedTexts(control)).toContain(hint)
}

function expectFree(control: HTMLElement) {
  expect(control).toBeEnabled()
  expect(control).not.toHaveAttribute('aria-disabled', 'true')
}

function expectInDomOrder(nodes: HTMLElement[]) {
  const follows = nodes
    .slice(1)
    .map((node, i) => Boolean(nodes[i].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING))
  expect(follows).toEqual(nodes.slice(1).map(() => true))
}

const HINTS = [
  'locked on while enum is set',
  'off while secret is set',
  'off while enum is set',
  'off while Required is set',
]

const SECRET_INPUT_REASON = 'A secret input has no default: the Function Block gives the value.'

describe('CreateParamFields - Required (input only)', () => {
  it('renders the Required checkbox in input mode', () => {
    renderFields({ mode: 'input' })
    expect(screen.getByTestId('param-required-checkbox')).toBeInTheDocument()
  })

  it('does NOT render the Required checkbox in output mode', () => {
    renderFields({ mode: 'output' })
    expect(screen.queryByTestId('param-required-checkbox')).not.toBeInTheDocument()
  })

  it('threads onRequiredChange when toggled', async () => {
    const user = userEvent.setup()
    const { onRequiredChange } = renderFields({ mode: 'input' })
    await user.click(screen.getByTestId('param-required-checkbox'))
    expect(onRequiredChange).toHaveBeenCalledWith(true)
  })
})

describe('CreateParamFields - Description', () => {
  it('renders the shared Description field in input mode', () => {
    renderFields({ mode: 'input' })
    expect(screen.getByTestId('param-description')).toBeInTheDocument()
  })

  it('renders the Description field in output mode', () => {
    renderFields({ mode: 'output' })
    expect(screen.getByTestId('param-description')).toBeInTheDocument()
  })

  it('threads onDescriptionChange as the user types', async () => {
    const user = userEvent.setup()
    const { onDescriptionChange } = renderFields({ mode: 'input' })
    await user.type(screen.getByTestId('param-description'), 'x')
    expect(onDescriptionChange).toHaveBeenCalledWith('x')
  })
})

describe('CreateParamFields - Create enum on a String / Integer / Float input (VMGR-112)', () => {
  it.each(['string', 'integer', 'float'] as const)('renders Create enum for a %s input', (type) => {
    renderFields({ mode: 'input', type })
    expect(enumBox()).toBeInTheDocument()
  })

  it.each(['boolean', 'array', 'map', 'table'] as const)('does NOT render Create enum for a %s input', (type) => {
    renderFields({ mode: 'input', type })
    expect(screen.queryByTestId('param-create-enum-checkbox')).not.toBeInTheDocument()
  })

  it('does NOT render Create enum for an output', () => {
    renderFields({ mode: 'output', type: 'string' })
    expect(screen.queryByTestId('param-create-enum-checkbox')).not.toBeInTheDocument()
  })

  it('threads onCreateEnumChange when toggled', async () => {
    const user = userEvent.setup()
    const { onCreateEnumChange } = renderFields({ mode: 'input', type: 'string' })
    await user.click(enumBox())
    expect(onCreateEnumChange).toHaveBeenCalledWith(true)
  })

  it.each(['string', 'integer', 'float', 'array'] as const)(
    'never renders a Value Type select on a %s input with Create enum on',
    (type) => {
      renderEnumOn({ type })
      expect(screen.queryByTestId('param-enum-value-type-select')).not.toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: 'Value Type' })).not.toBeInTheDocument()
    },
  )
})

describe('CreateParamFields - the checkbox order (VMGR-112)', () => {
  it('orders an input as Description, Type, Required, Mark as secret, Set to null, Create enum, then the value', () => {
    renderFields({
      mode: 'input',
      type: 'string',
      typeField: <div data-testid="type-slot" />,
      valueBody: <div data-testid="value-slot" />,
    })
    expectInDomOrder(
      [
        'param-description',
        'type-slot',
        'param-required-checkbox',
        'create-secret-checkbox',
        'create-set-to-null-checkbox',
        'param-create-enum-checkbox',
        'value-slot',
      ].map((id) => screen.getByTestId(id)),
    )
  })

  it('keeps Create enum the last checkbox while it is on', () => {
    renderEnumOn({ valueBody: <div data-testid="value-slot" /> })
    expectInDomOrder([secretBox(), nullBox(), enumBox(), screen.getByTestId('value-slot')])
  })

  it('orders an output as Description, Type, Mark as secret, Set to null, then the value', () => {
    renderFields({
      mode: 'output',
      type: 'string',
      typeField: <div data-testid="type-slot" />,
      valueBody: <div data-testid="value-slot" />,
    })
    expectInDomOrder(
      ['param-description', 'type-slot', 'create-secret-checkbox', 'create-set-to-null-checkbox', 'value-slot'].map(
        (id) => screen.getByTestId(id),
      ),
    )
    expect(screen.queryByTestId('param-required-checkbox')).not.toBeInTheDocument()
  })

  it('names Mark as secret and Set to null by their labels', () => {
    renderFields({ mode: 'input' })
    expect(screen.getByRole('checkbox', { name: 'Set to null' })).toBe(
      screen.getByTestId('create-set-to-null-checkbox'),
    )
    expect(screen.getByRole('checkbox', { name: 'Mark as secret (value will be masked)' })).toBe(
      screen.getByTestId('create-secret-checkbox'),
    )
  })
})

describe('CreateParamFields - the copy names the Function Block (VMGR-114)', () => {
  it('labels Required "Required (the Function Block must set a value)"', () => {
    renderFields({ mode: 'input' })
    expect(screen.getByRole('checkbox', { name: 'Required (the Function Block must set a value)' })).toBe(
      requiredBox(),
    )
  })

  it('labels Create enum "Create enum (limit the Function Block to a fixed set of values)"', () => {
    renderFields({ mode: 'input', type: 'integer' })
    expect(
      screen.getByRole('checkbox', { name: 'Create enum (limit the Function Block to a fixed set of values)' }),
    ).toBe(enumBox())
  })

  it('keeps the Description placeholder "What this parameter is for"', () => {
    renderFields({ mode: 'output' })
    expect(screen.getByTestId('param-description')).toHaveAttribute('placeholder', 'What this parameter is for')
  })

  it('keeps only the secret reason for a Set to null box held on, naming the Function Block', () => {
    expect(NULL_FORCED_REASON).toEqual({ secret: SECRET_INPUT_REASON })
  })

  it('shows the secret reason as the tooltip of a secret input Set to null box', async () => {
    renderFields({
      mode: 'input',
      secret: true,
      secretLocksEnum: true,
      setToNull: nullState({ ticked: true, forcedBy: 'secret' }),
    })
    act(() => nullBox().focus())
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      /^A secret input has no default: the Function Block gives the value\.$/,
    )
  })
})

describe('CreateParamFields - a plain input (VMGR-112)', () => {
  it('leaves Required, Mark as secret, Set to null and Create enum free with no hint', () => {
    renderFields({ mode: 'input', type: 'string', secret: false, setToNull: nullState() })
    for (const box of [requiredBox(), secretBox(), nullBox(), enumBox()]) expectFree(box)
    for (const hint of HINTS) expect(screen.queryByText(hint)).not.toBeInTheDocument()
  })
})

describe('CreateParamFields - Required on (VMGR-111, VMGR-113)', () => {
  it('turns Set to null off and locks it with "off while Required is set"', () => {
    renderFields({ mode: 'input', type: 'string', required: true, setToNull: nullState() })
    expect(nullBox()).not.toBeChecked()
    expectLockedWithHint(nullBox(), 'off while Required is set')
    expect(screen.getByText('off while Required is set')).toBeInTheDocument()
  })

  it('leaves Required, Mark as secret and Create enum free', () => {
    renderFields({ mode: 'input', type: 'string', required: true, secret: false, setToNull: nullState() })
    expect(requiredBox()).toBeChecked()
    for (const box of [requiredBox(), secretBox(), enumBox()]) expectFree(box)
  })

  it('drops a click, a label click and Space on the locked Set to null box', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderFields({ mode: 'input', type: 'string', required: true, setToNull: nullState({ onChange }) })

    await user.click(nullBox())
    await user.click(screen.getByText('Set to null'))
    act(() => nullBox().focus())
    await user.keyboard(' ')

    expect(onChange).not.toHaveBeenCalled()
    expect(nullBox()).toHaveFocus()
    expect(nullBox()).not.toBeChecked()
  })

  it('gives the secret lock precedence over the Required one on a secret input', () => {
    renderFields({
      mode: 'input',
      type: 'string',
      required: true,
      secret: true,
      secretLocksEnum: true,
      setToNull: nullState({ ticked: true, forcedBy: 'secret' }),
    })
    expect(nullBox()).toBeChecked()
    expect(nullBox()).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByText('off while Required is set')).not.toBeInTheDocument()
  })
})

describe('CreateParamFields - Mark as secret on (VMGR-104, VMGR-111)', () => {
  function renderSecretOn() {
    return renderFields({
      mode: 'input',
      type: 'string',
      secret: true,
      secretLocksEnum: true,
      setToNull: nullState({ ticked: true, forcedBy: 'secret' }),
    })
  }

  it('ticks and locks Set to null', () => {
    renderSecretOn()
    expect(nullBox()).toBeChecked()
    expect(nullBox()).toHaveAttribute('aria-disabled', 'true')
  })

  it('turns Create enum off and locks it with "off while secret is set"', () => {
    renderSecretOn()
    expect(enumBox()).not.toBeChecked()
    expectLockedWithHint(enumBox(), 'off while secret is set')
  })

  it('leaves Required and Mark as secret free', () => {
    renderSecretOn()
    expect(secretBox()).toBeChecked()
    expectFree(requiredBox())
    expectFree(secretBox())
  })

  it('drops a click on the locked Create enum box', async () => {
    const user = userEvent.setup()
    const { onCreateEnumChange } = renderSecretOn()
    await user.click(enumBox())
    expect(onCreateEnumChange).not.toHaveBeenCalled()
    expect(enumBox()).not.toBeChecked()
  })
})

describe('CreateParamFields - Create enum on (VMGR-112)', () => {
  it('ticks and locks Required with "locked on while enum is set"', () => {
    renderEnumOn()
    expect(requiredBox()).toBeChecked()
    expectLockedWithHint(requiredBox(), 'locked on while enum is set')
  })

  it('locks Mark as secret off with "off while enum is set"', () => {
    renderEnumOn()
    expect(secretBox()).not.toBeChecked()
    expectLockedWithHint(secretBox(), 'off while enum is set')
  })

  it('locks Set to null off with "off while enum is set", never the Required hint', () => {
    renderEnumOn()
    expect(nullBox()).not.toBeChecked()
    expectLockedWithHint(nullBox(), 'off while enum is set')
    expect(describedTexts(nullBox())).not.toContain('off while Required is set')
    expect(screen.queryByText('off while Required is set')).not.toBeInTheDocument()
  })

  it('leaves Create enum itself ticked and free', () => {
    renderEnumOn()
    expect(enumBox()).toBeChecked()
    expectFree(enumBox())
  })

  it('drops a click on the locked Required and Mark as secret boxes', async () => {
    const user = userEvent.setup()
    const { onRequiredChange, onSecretChange } = renderEnumOn({ secret: false })
    await user.click(requiredBox())
    await user.click(secretBox())
    expect(onRequiredChange).not.toHaveBeenCalled()
    expect(onSecretChange).not.toHaveBeenCalled()
    expect(requiredBox()).toBeChecked()
    expect(secretBox()).not.toBeChecked()
  })

  it('puts the Required hint between Required and Mark as secret', () => {
    renderEnumOn()
    expectInDomOrder([requiredBox(), screen.getByText('locked on while enum is set'), secretBox()])
  })
})

describe("CreateParamFields - a true / false input's Default value (REQ-3.1.3.24, REQ-3.1.2.10)", () => {
  it('locks Set to null off like an enum input, with a hint that names no enum, and drops a click and Space', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderFields({ mode: 'input', type: 'boolean', setToNull: nullState({ disabledByEnum: true, onChange }) })

    expect(nullBox()).not.toBeChecked()
    expect(nullBox()).toHaveAttribute('aria-disabled', 'true')
    expect(describedTexts(nullBox())).toHaveLength(1)
    expect(describedTexts(nullBox())).not.toContain('off while enum is set')
    expect(screen.queryByText('off while enum is set')).not.toBeInTheDocument()

    await user.click(nullBox())
    act(() => nullBox().focus())
    await user.keyboard(' ')
    expect(onChange).not.toHaveBeenCalled()
    expect(nullBox()).not.toBeChecked()
  })
})

describe('validateEnumValues - allowed values typed by the input type (VMGR-112)', () => {
  it('returns null for a list of strings on a String input', () => {
    expect(validateEnumValues(['a', 'b'], 'string')).toBeNull()
  })

  it('rejects an empty list with the exact message', () => {
    expect(validateEnumValues([], 'string')).toBe('Enum allowed values cannot be empty')
  })

  it('names the first value that is not a valid integer', () => {
    expect(validateEnumValues([1, 'abc'], 'integer')).toBe('Allowed value at index 1 (abc) is not a valid integer')
  })

  it('names a number in a String list', () => {
    expect(validateEnumValues(['a', 1], 'string')).toBe('Allowed value at index 1 (1) is not a valid string')
  })

  it('names an empty text in a String list', () => {
    expect(validateEnumValues(['', 'high'], 'string')).toBe('Allowed value at index 0 is empty')
  })

  it.each([
    [['low', 'high', 'low'], 'string', 'Allowed value at index 2 (low) is already listed'],
    [[1, 2, 1], 'integer', 'Allowed value at index 2 (1) is already listed'],
    [[1.5, 1.5], 'float', 'Allowed value at index 1 (1.5) is already listed'],
  ] as const)('names the first repeat in %j', (values, type, message) => {
    expect(validateEnumValues([...values], type)).toBe(message)
  })

  it('refuses a decimal in an Integer list', () => {
    expect(validateEnumValues([1, 2.5], 'integer')).toBe('Allowed value at index 1 (2.5) is not a valid integer')
  })

  it('names text at the first index of an Integer list', () => {
    expect(validateEnumValues(['a'], 'integer')).toBe('Allowed value at index 0 (a) is not a valid integer')
  })

  it('accepts integers for the float value type', () => {
    expect(validateEnumValues([1, 2.5], 'float')).toBeNull()
  })

  it('names text in a Float list', () => {
    expect(validateEnumValues([1.5, 'x'], 'float')).toBe('Allowed value at index 1 (x) is not a valid float')
  })

  it.each([
    ['integer', [1, 2]],
    ['float', [1.5, 2]],
    ['string', ['low', 'high']],
  ] as const)('accepts a list of %s values', (type, values) => {
    expect(validateEnumValues([...values], type)).toBeNull()
  })
})

// Allowed values keep the one number rule: exact text is the number it spells (REQ-3.1.3.14).
describe('validateEnumValues - the number rule', () => {
  it.each([
    ['integer', ['12345678901234567', '9007199254740993']],
    ['float', ['1.50', '0.0000001', 2]],
  ] as const)('accepts exact %s text a JS number cannot hold', (type, values) => {
    expect(validateEnumValues([...values], type)).toBeNull()
  })

  it.each([
    ['integer', ['1e3'], 'Allowed value at index 0 (1e3) is not a valid integer'],
    ['float', [Number.NaN], 'Allowed value at index 0 (NaN) is not a valid float'],
    ['integer', [true], 'Allowed value at index 0 (true) is not a valid integer'],
  ] as const)('refuses %s values the rule refuses', (type, values, message) => {
    expect(validateEnumValues([...values], type)).toBe(message)
  })

  it('names an integer past 19 digits and a float past 28 significant digits', () => {
    expect(validateEnumValues(['12345678901234567890'], 'integer')).toBe(
      'Allowed value at index 0 (12345678901234567890) must have at most 19 digits',
    )
    expect(validateEnumValues([1, `0.${'1'.repeat(29)}`], 'float')).toBe(
      `Allowed value at index 1 (0.${'1'.repeat(29)}) must have at most 28 significant digits`,
    )
  })

  it('names a value in plain digits', () => {
    expect(validateEnumValues([1e21], 'integer')).toBe(
      'Allowed value at index 0 (1000000000000000000000) must have at most 19 digits',
    )
  })

  it('reads the same exact number written two ways as a repeat', () => {
    expect(validateEnumValues([1.5, '1.50'], 'float')).toBe('Allowed value at index 1 (1.50) is already listed')
    expect(validateEnumValues(['7', 7], 'integer')).toBe('Allowed value at index 1 (7) is already listed')
  })

  it('tells numbers apart that one JS double cannot', () => {
    expect(validateEnumValues(['9007199254740992', '9007199254740993'], 'integer')).toBeNull()
  })
})

describe('CreateParamFields - a host that wires no secret or null handler', () => {
  it('lets the secret and Set to null boxes be clicked without a handler', async () => {
    const user = userEvent.setup()
    renderFields({ mode: 'output' })

    await user.click(screen.getByTestId('create-secret-checkbox'))
    await user.click(screen.getByTestId('create-set-to-null-checkbox'))

    expect(screen.getByTestId('create-secret-checkbox')).not.toBeChecked()
    expect(screen.getByTestId('create-set-to-null-checkbox')).not.toBeChecked()
  })
})

describe('CreateParamFields - a forced Set to null box (VMGR-111)', () => {
  it('stays focusable and checked through a click, a label click and Space', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderFields({ setToNull: { ticked: true, forcedBy: 'secret', disabledByEnum: false, onChange } })
    const box = screen.getByTestId('create-set-to-null-checkbox')
    expect(box).toBeEnabled()
    expect(box).toHaveAttribute('aria-disabled', 'true')

    await user.click(box)
    await user.click(screen.getByText('Set to null'))
    act(() => box.focus())
    await user.keyboard(' ')

    expect(onChange).not.toHaveBeenCalled()
    expect(box).toHaveFocus()
    expect(box).toBeChecked()
    expect(box).toHaveAttribute('data-state', 'checked')
  })

  it('keeps room inside its focus ring, the padding taken back by a margin so box and label stay put', () => {
    renderFields({ setToNull: { ticked: true, forcedBy: 'secret', disabledByEnum: false, onChange: vi.fn() } })
    const row = screen.getByTestId('create-set-to-null-checkbox').parentElement as HTMLElement
    expect(row).toHaveClass('has-[:focus-visible]:ring-2', 'p-1', '-m-1')
  })

  it('opens its reason to the right of the label', async () => {
    renderFields({ setToNull: { ticked: true, forcedBy: 'secret', disabledByEnum: false, onChange: vi.fn() } })
    act(() => screen.getByTestId('create-set-to-null-checkbox').focus())
    const tip = await screen.findByRole('tooltip')
    const popup = tip.closest('[data-slot="tooltip-content"]')
    expect(popup).toHaveAttribute('data-side', 'right')
    // 26rem keeps the reason inside the input window's padding at its open width.
    expect(popup).toHaveClass('max-w-[26rem]')
  })
})

describe('CreateParamFields - an unforced Set to null box', () => {
  it('has no ring room of its own: its row carries no padding or margin', () => {
    renderFields({ setToNull: { ticked: false, forcedBy: null, disabledByEnum: false, onChange: vi.fn() } })
    const row = screen.getByTestId('create-set-to-null-checkbox').parentElement as HTMLElement
    expect(row).not.toHaveClass('p-1')
    expect(row).not.toHaveClass('-m-1')
  })
})

describe('CreateParamFields - Set to null hidden while Kind is Expression or Template (VMGR-111)', () => {
  it('renders no Set to null row while the host hides it', () => {
    renderFields({ mode: 'output', setToNull: nullState({ hidden: true }) })
    expect(screen.queryByTestId('create-set-to-null-checkbox')).not.toBeInTheDocument()
    expect(screen.getByTestId('create-secret-checkbox')).toBeInTheDocument()
  })
})

describe('CreateParamFields - a Test variable or Function local', () => {
  it('shows Mark as secret and Set to null only, with no Description, Required or Create enum', () => {
    render(
      <CreateParamFields
        mode="variable"
        type="string"
        typeIsEnumerable
        required={false}
        createEnum={false}
        description=""
        onRequiredChange={vi.fn()}
        onCreateEnumChange={vi.fn()}
        onDescriptionChange={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('param-description')).not.toBeInTheDocument()
    expect(screen.queryByTestId('param-required-checkbox')).not.toBeInTheDocument()
    expect(screen.queryByTestId('param-create-enum-checkbox')).not.toBeInTheDocument()
    expectFree(secretBox())
    expectFree(nullBox())
  })

  it('threads onSecretChange when Mark as secret is ticked', async () => {
    const user = userEvent.setup()
    const { onSecretChange } = renderFields({ mode: 'output', secret: false })
    await user.click(secretBox())
    expect(onSecretChange).toHaveBeenCalledWith(true)
  })
})

describe('CreateParamFields - a read-only definition (REQ-3.1.2.10)', () => {
  function renderReadOnly(setToNull: SetToNullState) {
    const handlers = {
      onRequiredChange: vi.fn(),
      onCreateEnumChange: vi.fn(),
      onDescriptionChange: vi.fn(),
      onSecretChange: vi.fn(),
    }
    render(
      <CreateParamFields
        mode="input"
        type="string"
        typeIsEnumerable
        required={false}
        createEnum={false}
        description="Target environment"
        secret={false}
        setToNull={setToNull}
        readOnly
        {...handlers}
      />,
    )
    return handlers
  }

  it('locks Description, Required, Mark as secret and Create enum with no note, and ignores clicks', async () => {
    const user = userEvent.setup()
    const handlers = renderReadOnly(nullState())
    expect(screen.getByTestId('param-description')).toBeDisabled()
    for (const box of [requiredBox(), secretBox(), enumBox()]) {
      expect(box).toHaveAttribute('aria-disabled', 'true')
      expect(box).not.toHaveAttribute('aria-describedby')
      await user.click(box)
    }
    expect(handlers.onRequiredChange).not.toHaveBeenCalled()
    expect(handlers.onSecretChange).not.toHaveBeenCalled()
    expect(handlers.onCreateEnumChange).not.toHaveBeenCalled()
  })

  it('locks Set to null only while the host locks it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderReadOnly(nullState({ locked: true, onChange }))
    expect(nullBox()).toHaveAttribute('aria-disabled', 'true')
    await user.click(nullBox())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('leaves Set to null free when the host does not lock it', () => {
    renderReadOnly(nullState())
    expectFree(nullBox())
  })
})
