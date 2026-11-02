/**
 * Assertion row variable picker.
 *
 * Pins the contract: the literal assertion row picks its
 * variable through the shared variable combobox instead of the hand-rolled
 * selector (VARPICK-1).
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { getTypeBadgeClass } from '@/lib/variable-format'

// Mock useViewport for Tooltip component
vi.mock('@/hooks/use-viewport', () => ({
  useViewport: () => ({
    width: 1280,
    height: 800,
    breakpoint: 'xl',
    isAtLeast: () => true,
    isBelow: () => false,
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    sidebarShouldBeVisible: true,
    canvasInteractionEnabled: true,
    isTouchDevice: false,
  }),
}))

// Mock ExpressionField - CodeMirror doesn't work in jsdom.
vi.mock('@/features/workbench/common/element-config/expressions/expression-field', () => ({
  ExpressionField: ({ name, value, onChange, placeholder }: {
    name: string; value: string; onChange: (v: string) => void; placeholder?: string
  }) => (
    <input
      data-testid={`mock-expression-field-${name}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}))

// Import after mocks
import {
  AssertionBuilder,
  type AssertionBuilderProps,
  type LiteralAssertion,
} from '@/features/workbench/common/config/assertion-builder'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 63 characters - overflows the 160px picker slot. */
const LONG_NAME = 'assertion_variable_with_a_deliberately_long_name_for_truncation'

const pickerVariables = [
  { name: 'x', type: 'integer' },
  { name: 'y', type: 'string' },
  { name: 'flag', type: 'boolean' },
  { name: 'RATE', type: 'float' },
]

function makeLiteral(overrides: Partial<LiteralAssertion> = {}): LiteralAssertion {
  return {
    id: 'lit-1',
    type: 'literal',
    variable: 'x',
    value_type: 'integer',
    operator: 'equals',
    reference_value: 10,
    reference_is_expression: false,
    ...overrides,
  }
}

function renderRow(overrides: Partial<AssertionBuilderProps> = {}) {
  const props: AssertionBuilderProps = {
    assertions: [makeLiteral()],
    availableVariables: pickerVariables,
    onAssertionsChange: vi.fn(),
    onValidChange: vi.fn(),
    ...overrides,
  }
  render(<AssertionBuilder {...props} />)
  return props
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('assertion row variable picker', () => {
  // =========================================================================
  // Anchor: a combobox, not the deleted trigger Button
  // =========================================================================
  describe('anchor', () => {
    it('renders a combobox anchor carrying the row testid', () => {
      renderRow()

      const anchor = screen.getByTestId('assert-variable-0')
      // The operator Select is also a combobox, so match by membership.
      expect(screen.getAllByRole('combobox')).toContain(anchor)
      expect(anchor).toHaveAttribute('role', 'combobox')
      expect(anchor).toHaveAttribute('aria-autocomplete', 'list')
      expect(anchor).toHaveAttribute('aria-expanded', 'false')
    })

    it('displays the bound variable as the anchor value', () => {
      renderRow()
      expect(screen.getByTestId('assert-variable-0')).toHaveValue('x')
    })

    it('renders the variable placeholder when nothing is bound', () => {
      renderRow({ assertions: [makeLiteral({ variable: '' })] })
      expect(screen.getByTestId('assert-variable-0')).toHaveAttribute('placeholder', 'variable')
    })

    it('flips aria-expanded once the list opens', async () => {
      const user = userEvent.setup()
      renderRow()

      const anchor = screen.getByTestId('assert-variable-0')
      await user.click(anchor)

      await waitFor(() => {
        expect(anchor).toHaveAttribute('aria-expanded', 'true')
      })
    })
  })

  // =========================================================================
  // Options: cmdk items, not assert-var-option-* buttons
  // =========================================================================
  describe('options', () => {
    it('renders options as command items instead of assert-var-option buttons', async () => {
      const user = userEvent.setup()
      renderRow()

      await user.click(screen.getByTestId('assert-variable-0'))

      const flagName = await screen.findByText('flag')
      expect(flagName.closest('[role="option"]')).not.toBeNull()
      expect(screen.queryByTestId('assert-var-option-flag')).not.toBeInTheDocument()
      expect(screen.queryByTestId('assert-var-option-y')).not.toBeInTheDocument()
      expect(screen.queryByTestId('assert-var-option-x')).not.toBeInTheDocument()
      expect(screen.queryByTestId('assert-var-option-RATE')).not.toBeInTheDocument()
    })

    it('offers every available variable with its type', async () => {
      const user = userEvent.setup()
      renderRow()

      await user.click(screen.getByTestId('assert-variable-0'))

      const options = await screen.findAllByRole('option')
      expect(options).toHaveLength(4)
      expect(within(options[0]).getByText('x')).toBeInTheDocument()
      expect(within(options[1]).getByText('y')).toBeInTheDocument()
      expect(within(options[2]).getByText('flag')).toBeInTheDocument()
      expect(within(options[2]).getByText('boolean')).toBeInTheDocument()
      expect(within(options[3]).getByText('RATE')).toBeInTheDocument()
      expect(within(options[3]).getByText('float')).toBeInTheDocument()
    })
  })

  // =========================================================================
  // Search
  // =========================================================================
  describe('search', () => {
    it('narrows the list to substring matches while typing', async () => {
      const user = userEvent.setup()
      renderRow({ assertions: [makeLiteral({ variable: '' })] })

      await user.type(screen.getByTestId('assert-variable-0'), 'lag')

      expect(await screen.findByText('flag')).toBeInTheDocument()
      expect(screen.queryByText('y')).not.toBeInTheDocument()
      expect(screen.queryByText('RATE')).not.toBeInTheDocument()
    })

    it('matches variable names case-insensitively', async () => {
      const user = userEvent.setup()
      renderRow({ assertions: [makeLiteral({ variable: '' })] })

      await user.type(screen.getByTestId('assert-variable-0'), 'rat')

      expect(await screen.findByText('RATE')).toBeInTheDocument()
      expect(screen.queryByText('flag')).not.toBeInTheDocument()
    })

    it('shows the empty state when the query matches nothing', async () => {
      const user = userEvent.setup()
      renderRow({ assertions: [makeLiteral({ variable: '' })] })

      await user.type(screen.getByTestId('assert-variable-0'), 'zzz')

      expect(await screen.findByText('No matching variables')).toBeInTheDocument()
      expect(screen.queryByRole('option')).not.toBeInTheDocument()
    })
  })

  // =========================================================================
  // existingOnly: typing filters, only a pick rebinds the assertion
  // =========================================================================
  describe('existingOnly binding', () => {
    it('leaves the assertion untouched while the user types', async () => {
      const user = userEvent.setup()
      const props = renderRow({ assertions: [makeLiteral({ variable: '' })] })

      const anchor = screen.getByTestId('assert-variable-0')
      await user.type(anchor, 'fla')

      expect(props.onAssertionsChange).not.toHaveBeenCalled()
      expect(anchor).toHaveValue('fla')
    })

    it('emits the picked variable with its re-derived type', async () => {
      const user = userEvent.setup()
      const props = renderRow()

      await user.click(screen.getByTestId('assert-variable-0'))
      await user.click(await screen.findByText('y'))

      expect(props.onAssertionsChange).toHaveBeenCalledWith([
        expect.objectContaining({ variable: 'y', value_type: 'string' }),
      ])
    })

    it('keeps the operator when it stays valid for the new type', async () => {
      const user = userEvent.setup()
      const props = renderRow({
        assertions: [makeLiteral({ variable: 'x', value_type: 'integer', operator: 'equals' })],
      })

      await user.click(screen.getByTestId('assert-variable-0'))
      await user.click(await screen.findByText('y'))

      expect(props.onAssertionsChange).toHaveBeenCalledWith([
        expect.objectContaining({ variable: 'y', value_type: 'string', operator: 'equals' }),
      ])
    })

    it('resets the operator when it is incompatible with the new type', async () => {
      const user = userEvent.setup()
      const props = renderRow({
        assertions: [
          makeLiteral({
            variable: 'y',
            value_type: 'string',
            operator: 'contains',
            reference_value: 'test',
          }),
        ],
      })

      await user.click(screen.getByTestId('assert-variable-0'))
      await user.click(await screen.findByText('flag'))

      expect(props.onAssertionsChange).toHaveBeenCalledWith([
        expect.objectContaining({ variable: 'flag', value_type: 'boolean', operator: 'is_true' }),
      ])
    })
  })

  // =========================================================================
  // Long names stay readable
  // =========================================================================
  describe('long variable names', () => {
    it('truncates a long option name and exposes the full name on hover', async () => {
      const user = userEvent.setup()
      renderRow({
        assertions: [makeLiteral({ variable: '' })],
        availableVariables: [{ name: LONG_NAME, type: 'string' }],
      })

      await user.click(screen.getByTestId('assert-variable-0'))

      const nameEl = await screen.findByText(LONG_NAME)
      expect(nameEl.className).toContain('min-w-0')
      expect(nameEl.className).toContain('truncate')
      // SHELL-7a: the full name comes from the shared tooltip.
      expect(nameEl).not.toHaveAttribute('title')
      fireEvent.focus(nameEl)
      expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(LONG_NAME)
    })

    it('keeps the type label pinned beside a long name', async () => {
      const user = userEvent.setup()
      renderRow({
        assertions: [makeLiteral({ variable: '' })],
        availableVariables: [{ name: LONG_NAME, type: 'string' }],
      })

      await user.click(screen.getByTestId('assert-variable-0'))

      const nameEl = await screen.findByText(LONG_NAME)
      const option = nameEl.closest('[role="option"]') as HTMLElement | null
      expect(option).not.toBeNull()

      const typeEl = within(option!).getByText('string')
      expect(typeEl).toBeInTheDocument()
      expect(typeEl.className).toContain('shrink-0')
    })

    it('colors the type pill the same way the Variable Manager does', async () => {
      const user = userEvent.setup()
      renderRow({
        assertions: [makeLiteral({ variable: '' })],
        availableVariables: [
          { name: 'a_string', type: 'string' },
          { name: 'a_map', type: 'map' },
        ],
      })

      await user.click(screen.getByTestId('assert-variable-0'))

      const pillFor = async (name: string, type: string) => {
        const option = (await screen.findByText(name)).closest('[role="option"]') as HTMLElement
        return within(option).getByText(type)
      }

      const stringPill = await pillFor('a_string', 'string')
      expect(stringPill.className).toContain(getTypeBadgeClass('string'))
      expect(stringPill.className).toContain('uppercase')

      const mapPill = await pillFor('a_map', 'map')
      expect(mapPill.className).toContain(getTypeBadgeClass('map'))
    })

    it('leaves an unknown type on the neutral pill instead of an empty class', async () => {
      const user = userEvent.setup()
      renderRow({
        assertions: [makeLiteral({ variable: '' })],
        availableVariables: [{ name: 'odd_one', type: 'object' }],
      })

      await user.click(screen.getByTestId('assert-variable-0'))

      const option = (await screen.findByText('odd_one')).closest('[role="option"]') as HTMLElement
      const pill = within(option).getByText('object')
      expect(pill.className).toContain('text-muted-foreground')
      expect(pill.className).not.toContain('undefined')
    })

    it('keeps the 320px floor on the option list', async () => {
      const user = userEvent.setup()
      renderRow({
        assertions: [makeLiteral({ variable: '' })],
        availableVariables: [{ name: LONG_NAME, type: 'string' }],
      })

      await user.click(screen.getByTestId('assert-variable-0'))

      const nameEl = await screen.findByText(LONG_NAME)
      let el: HTMLElement | null = nameEl
      while (el && !el.style.minWidth) el = el.parentElement
      expect(el).not.toBeNull()

      const style = el!.getAttribute('style') ?? ''
      expect(style).toContain('--radix-popover-trigger-width')
      expect(style).toMatch(/min-width:\s*320px/i)
    })
  })

  // =========================================================================
  // A14 - existingOnly typing is a filter, so no name-length counter
  // =========================================================================
  describe('character counter', () => {
    // Guard: the picker rendered a character counter inside a condition row.
    it('renders no counter for a bound name past the counter threshold', () => {
      renderRow({
        assertions: [
          makeLiteral({
            variable: LONG_NAME,
            value_type: 'string',
            reference_value: 'test',
          }),
        ],
        availableVariables: [{ name: LONG_NAME, type: 'string' }],
      })

      expect(screen.getByTestId('assert-variable-0')).toHaveValue(LONG_NAME)
      expect(screen.queryByTestId('assert-variable-0-counter')).not.toBeInTheDocument()
      // 63 of 64 sits past the 80% threshold that would otherwise show a counter.
      expect(screen.queryByText('63/64')).not.toBeInTheDocument()
    })

    // Guard: keeping the name cap would truncate a long filter query.
    it('applies no name-length cap to the anchor in existingOnly mode', () => {
      renderRow({ assertions: [makeLiteral({ variable: '' })] })

      const anchor = screen.getByTestId('assert-variable-0')
      expect(anchor).toHaveAttribute('role', 'combobox')
      expect(anchor).not.toHaveAttribute('maxlength')
    })

    it('keeps the full bound name reachable through the option title', async () => {
      const user = userEvent.setup()
      renderRow({
        assertions: [
          makeLiteral({
            variable: LONG_NAME,
            value_type: 'string',
            reference_value: 'test',
          }),
        ],
        availableVariables: [{ name: LONG_NAME, type: 'string' }],
      })

      await user.click(screen.getByTestId('assert-variable-0'))

      const option = await screen.findByRole('option')
      const nameEl = within(option).getByText(LONG_NAME)
      expect(nameEl).not.toHaveAttribute('title')
      fireEvent.focus(nameEl)
      expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(LONG_NAME)
    })
  })

  // =========================================================================
  // Row neighbors are unchanged
  // =========================================================================
  describe('row neighbors', () => {
    it('keeps the type badge and the operator select after the picker', () => {
      renderRow()

      const row = screen.getByTestId('assert-row-0')
      const anchor = screen.getByTestId('assert-variable-0')
      const badge = screen.getByTestId('assert-type-badge-0')
      const operator = screen.getByTestId('assert-operator-0')

      expect(row).toContainElement(anchor)
      expect(row).toContainElement(badge)
      expect(row).toContainElement(operator)
      expect(badge).toHaveTextContent('integer')
      expect(anchor.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(badge.compareDocumentPosition(operator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('paints the row type badge with the type color, not one fixed hue', () => {
      renderRow()
      expect(screen.getByTestId('assert-type-badge-0').className).toContain(
        getTypeBadgeClass('integer'),
      )
    })

    it('repaints the row type badge when the assertion changes type', () => {
      renderRow({
        assertions: [makeLiteral({ value_type: 'boolean', reference_value: true })],
      })
      expect(screen.getByTestId('assert-type-badge-0').className).toContain(
        getTypeBadgeClass('boolean'),
      )
    })
  })
})
