/**
 * VariableComboboxBase Component Tests
 *
 * Tests for the shared variable combobox base used by OutputBindingCombobox
 * and VariableRefCombobox. Covers: rendering, keyboard interaction, text
 * filtering, variable selection, OUT badge, header/footer slots, and the length
 * cap a caller may lift for names that are not variable names (field names).
 */

import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  VariableComboboxBase,
  type ComboboxVariable,
} from '@/features/workbench/common/element-config/shared/variable-combobox-base'
import { MAX_VARIABLE_NAME_LENGTH } from '@/lib/field-constraints'

const testVariables: ComboboxVariable[] = [
  { name: 'alpha', type: 'string' },
  { name: 'bravo', type: 'integer' },
  { name: 'charlie', type: 'array', source: 'http-1', isOutputBinding: true },
]

describe('VariableComboboxBase', () => {
  let onChange: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onChange = vi.fn()
  })

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  describe('rendering', () => {
    it('renders an input element with default placeholder', () => {
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
        />
      )

      const input = screen.getByRole('combobox')
      expect(input).toBeInTheDocument()
      expect(input).toHaveAttribute('placeholder', 'variable_name')
    })

    it('renders with a custom placeholder', () => {
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
          placeholder="choose_var"
        />
      )

      const input = screen.getByRole('combobox')
      expect(input).toHaveAttribute('placeholder', 'choose_var')
    })

    it('displays the provided value in the input', () => {
      render(
        <VariableComboboxBase
          value="alpha"
          onChange={onChange}
          variables={testVariables}
        />
      )

      expect(screen.getByRole('combobox')).toHaveValue('alpha')
    })

    it('renders with monospace font styling', () => {
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
        />
      )

      expect(screen.getByRole('combobox').className).toContain('font-mono')
    })
  })

  // ---------------------------------------------------------------------------
  // Keyboard interaction
  // ---------------------------------------------------------------------------

  describe('keyboard interaction', () => {
    it('opens popover on Ctrl+Space', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('alpha')).toBeInTheDocument()
      })
    })

    it('closes popover on Escape', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('alpha')).toBeInTheDocument()
      })

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByText('alpha')).not.toBeInTheDocument()
      })
    })

    it('does not close popover on Escape when already closed', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      // Popover is not open, so Escape should not call preventDefault
      await user.keyboard('{Escape}')

      // Popover should still be closed - no variables visible
      expect(screen.queryByText('alpha')).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Text input and filtering
  // ---------------------------------------------------------------------------

  describe('text filtering', () => {
    it('calls onChange on text input without re-opening when already open', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
        />
      )

      const input = screen.getByRole('combobox')
      // Open via click (sets open=true).
      await user.click(input)
      // Now type - this fires onChange with open already true.
      await user.type(input, 'a')
      expect(onChange).toHaveBeenLastCalledWith('a')
    })

    it('respects allVariableNames as a known-name set', async () => {
      const user = userEvent.setup()
      // value points to a known incompatible variable; the visible list is
      // empty (filtered to compatible types only), so without
      // allVariableNames we'd substring-filter to nothing. With it, the
      // dropdown still shows the empty "compatible" list (which is fine -
      // the assertion is that the substring path is bypassed).
      render(
        <VariableComboboxBase
          value="wrong_type_var"
          onChange={vi.fn()}
          variables={testVariables}
          allVariableNames={new Set(['wrong_type_var'])}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      // All compatible variables stay visible because allVariableNames matches.
      expect(screen.getByText('alpha')).toBeInTheDocument()
      expect(screen.getByText('bravo')).toBeInTheDocument()
      expect(screen.getByText('charlie')).toBeInTheDocument()
    })

    it('calls onChange on text input and opens popover', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
        />
      )

      const input = screen.getByRole('combobox')
      await user.type(input, 'a')

      expect(onChange).toHaveBeenCalled()
    })

    it('filters variables by typed text', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value="al"
          onChange={onChange}
          variables={testVariables}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('alpha')).toBeInTheDocument()
      })

      // "bravo" and "charlie" should not match "al"
      expect(screen.queryByText('bravo')).not.toBeInTheDocument()
      expect(screen.queryByText('charlie')).not.toBeInTheDocument()
    })

    it('shows all variables when value is empty', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('alpha')).toBeInTheDocument()
      })
      expect(screen.getByText('bravo')).toBeInTheDocument()
      expect(screen.getByText('charlie')).toBeInTheDocument()
    })

    it('shows empty state when no variables match filter', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value="zzz"
          onChange={onChange}
          variables={testVariables}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('No matching variables')).toBeInTheDocument()
      })
    })

    it('shows empty state when variables list is empty', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={[]}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('No matching variables')).toBeInTheDocument()
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Variable selection
  // ---------------------------------------------------------------------------

  describe('selection', () => {
    it('calls onChange with variable name on selection', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('alpha')).toBeInTheDocument()
      })

      await user.click(screen.getByText('alpha'))
      expect(onChange).toHaveBeenCalledWith('alpha')
    })

    it('closes popover after selection', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('bravo')).toBeInTheDocument()
      })

      await user.click(screen.getByText('bravo'))

      await waitFor(() => {
        expect(screen.queryByText('bravo')).not.toBeInTheDocument()
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Type label and OUT badge
  // ---------------------------------------------------------------------------

  describe('type and source display', () => {
    it('shows type label for each variable', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('alpha')).toBeInTheDocument()
      })

      expect(screen.getByText('string')).toBeInTheDocument()
      expect(screen.getByText('integer')).toBeInTheDocument()
      expect(screen.getByText('array')).toBeInTheDocument()
    })

    it('keeps each listed name out of page translation', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
        />
      )

      await user.click(screen.getByRole('combobox'))
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('alpha')).toBeInTheDocument()
      })
      expect(screen.getByText('alpha')).toHaveAttribute('translate', 'no')
    })

    it('shows OUT badge for variables a node output writes', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('charlie')).toBeInTheDocument()
      })

      expect(screen.getByText('OUT')).toBeInTheDocument()
    })

    it('does not show OUT badge for variables without source', async () => {
      const user = userEvent.setup()
      const noSourceVars: ComboboxVariable[] = [
        { name: 'local_var', type: 'string' },
      ]

      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={noSourceVars}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('local_var')).toBeInTheDocument()
      })

      expect(screen.queryByText('OUT')).not.toBeInTheDocument()
    })

    it('does not show OUT badge for a variable that only carries an origin label', async () => {
      // OUT means "a node writes this". A system / suite / profile variable has
      // an origin to show the user but nothing writes it.
      const user = userEvent.setup()
      const labeledVars: ComboboxVariable[] = [
        { name: 'system.timeout', type: 'integer', source: 'System Variables' },
      ]

      render(
        <VariableComboboxBase value="" onChange={onChange} variables={labeledVars} />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('system.timeout')).toBeInTheDocument()
      })

      expect(screen.queryByText('OUT')).not.toBeInTheDocument()
    })

    it('shows OUT badge for a variable a node output writes', async () => {
      const user = userEvent.setup()
      const boundVars: ComboboxVariable[] = [
        { name: 'payload', type: 'map', source: 'HTTP Call', isOutputBinding: true },
      ]

      render(
        <VariableComboboxBase value="" onChange={onChange} variables={boundVars} />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('payload')).toBeInTheDocument()
      })

      expect(screen.getByText('OUT')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Slots: header and footer
  // ---------------------------------------------------------------------------

  describe('header and footer slots', () => {
    it('renders header slot when provided', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
          header={<div data-testid="custom-header">Header content</div>}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByTestId('custom-header')).toBeInTheDocument()
      })
      expect(screen.getByText('Header content')).toBeInTheDocument()
    })

    it('renders footer slot when provided', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
          footer={<div data-testid="custom-footer">Footer content</div>}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByTestId('custom-footer')).toBeInTheDocument()
      })
      expect(screen.getByText('Footer content')).toBeInTheDocument()
    })

    it('does not render header or footer when not provided', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('alpha')).toBeInTheDocument()
      })

      expect(screen.queryByTestId('custom-header')).not.toBeInTheDocument()
      expect(screen.queryByTestId('custom-footer')).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // existingOnly mode (reject free text; only a picked option becomes the value)
  // ---------------------------------------------------------------------------

  describe('existingOnly mode', () => {
    it('filters via an internal search without emitting free text through onChange', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
          existingOnly
        />
      )

      const input = screen.getByRole('combobox')
      await user.type(input, 'al')

      // Typing only drives the transient filter; the bound value never changes.
      expect(onChange).not.toHaveBeenCalled()
      expect(input).toHaveValue('al')
    })

    it('still emits the picked variable on selection', async () => {
      const user = userEvent.setup()
      render(
        <VariableComboboxBase
          value=""
          onChange={onChange}
          variables={testVariables}
          existingOnly
        />
      )

      const input = screen.getByRole('combobox')
      await user.type(input, 'br')
      await user.click(await screen.findByText('bravo'))

      expect(onChange).toHaveBeenCalledWith('bravo')
    })
  })
  // ---------------------------------------------------------------------------
  // Suppressed dropdown (the caller rejects the typed name)
  // ---------------------------------------------------------------------------

  describe('suppressed dropdown', () => {
    // The caller rejects 'alpha-' and accepts 'alpha'; the button is the fix.
    function SuppressionHarness() {
      const [name, setName] = useState('alpha-')
      const rejected = name.endsWith('-')
      return (
        <>
          <VariableComboboxBase
            value={name}
            onChange={onChange}
            variables={testVariables}
            suppressPopover={rejected}
            invalid={rejected}
            aria-describedby={rejected ? 'binding-error' : undefined}
          />
          <button type="button" onClick={() => setName('alpha')}>fix the name</button>
          <div id="binding-error">not a valid variable name</div>
        </>
      )
    }

    it('never opens the list while the caller rejects the typed name', async () => {
      const user = userEvent.setup()
      render(<SuppressionHarness />)

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      expect(screen.queryByRole('option', { name: /alpha/ })).not.toBeInTheDocument()
      expect(input).toHaveAttribute('aria-expanded', 'false')
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input).toHaveAttribute('aria-describedby', 'binding-error')
    })

    it('opens the armed list as soon as the name stops being rejected', async () => {
      const user = userEvent.setup()
      render(<SuppressionHarness />)

      await user.click(screen.getByRole('combobox'))
      expect(screen.queryByRole('option', { name: /alpha/ })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'fix the name' }))

      expect(await screen.findByRole('option', { name: /alpha/ })).toBeInTheDocument()
      expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-describedby')
    })

    it('ignores Escape while suppressed, so the fix still reopens the list', async () => {
      const user = userEvent.setup()
      render(<SuppressionHarness />)

      await user.click(screen.getByRole('combobox'))
      await user.keyboard('{Escape}')

      await user.click(screen.getByRole('button', { name: 'fix the name' }))

      expect(await screen.findByRole('option', { name: /alpha/ })).toBeInTheDocument()
    })
  })
})

const LONG_NAME = `service.${'nested.'.repeat(15)}latency_ms`

/** Holds the typed name the way a caller does, with the cap lifted. */
function UncappedHarness({ onChange }: Readonly<{ onChange: (value: string) => void }>) {
  const [value, setValue] = useState('')
  return (
    <VariableComboboxBase
      value={value}
      onChange={(next) => {
        onChange(next)
        setValue(next)
      }}
      variables={testVariables}
      maxLength={null}
    />
  )
}

describe('VariableComboboxBase maxLength', () => {
  it('caps a free-text name at the variable name length by default', () => {
    render(<VariableComboboxBase value="" onChange={vi.fn()} variables={testVariables} />)
    expect(screen.getByRole('combobox')).toHaveAttribute('maxlength', String(MAX_VARIABLE_NAME_LENGTH))
  })

  it('puts no cap on the filter text of an existing-only combobox by default', () => {
    render(<VariableComboboxBase value="" onChange={vi.fn()} variables={testVariables} existingOnly />)
    expect(screen.getByRole('combobox')).not.toHaveAttribute('maxlength')
  })

  it('lifts the cap when maxLength is null', () => {
    render(<VariableComboboxBase value="" onChange={vi.fn()} variables={testVariables} maxLength={null} />)
    expect(screen.getByRole('combobox')).not.toHaveAttribute('maxlength')
  })

  it('shows a name longer than the variable cap in full, with no counter, when maxLength is null', () => {
    expect(LONG_NAME.length).toBeGreaterThan(MAX_VARIABLE_NAME_LENGTH)
    render(<VariableComboboxBase value={LONG_NAME} onChange={vi.fn()} variables={testVariables} maxLength={null} />)

    expect(screen.getByRole('combobox')).toHaveValue(LONG_NAME)
    expect(screen.queryByText(`${LONG_NAME.length}/${MAX_VARIABLE_NAME_LENGTH}`)).not.toBeInTheDocument()
  })

  it('writes a long typed name whole when maxLength is null', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<UncappedHarness onChange={onChange} />)

    await user.click(screen.getByRole('combobox'))
    await user.paste(LONG_NAME)

    expect(onChange).toHaveBeenLastCalledWith(LONG_NAME)
  })

  it('caps at the number given', () => {
    render(<VariableComboboxBase value="" onChange={vi.fn()} variables={testVariables} maxLength={200} />)
    expect(screen.getByRole('combobox')).toHaveAttribute('maxlength', '200')
  })
})

// A caller whose rows are not variables names its own empty line, or none (OS-13).
describe('VariableComboboxBase - the empty line', () => {
  it('shows the empty text the caller gives when no row matches', async () => {
    const user = userEvent.setup()
    render(
      <VariableComboboxBase
        value="zzz"
        onChange={vi.fn()}
        variables={testVariables}
        emptyText="No matching fields"
      />,
    )

    await user.click(screen.getByRole('combobox'))

    await waitFor(() => {
      expect(screen.getByText('No matching fields')).toBeInTheDocument()
    })
    expect(screen.queryByText('No matching variables')).not.toBeInTheDocument()
  })

  it('shows no empty line when the caller gives none', async () => {
    const user = userEvent.setup()
    render(
      <VariableComboboxBase
        value=""
        onChange={vi.fn()}
        variables={[]}
        emptyText={null}
        footer={<p>Footer line</p>}
      />,
    )

    await user.click(screen.getByRole('combobox'))

    await waitFor(() => {
      expect(screen.getByText('Footer line')).toBeInTheDocument()
    })
    expect(screen.queryByText('No matching variables')).not.toBeInTheDocument()
  })
})
