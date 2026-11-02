/**
 * VariableRefCombobox Component Tests
 *
 * TDD tests for the variable-reference combobox that filters available
 * variables by allowed types. Used by ForEach collection parameter and
 * future variable-reference parameters.
 *
 * Pattern: mirrors OutputBindingCombobox but filters by allowedTypes
 * instead of OUTPUT_TYPE_COMPAT.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Function scope hook gets a default no-Function mock that tests can
// override per-case via `useFunctionScopeMock.mockReturnValue(...)`.
const useFunctionScopeMock = vi.hoisted(() =>
  vi.fn(() => ({
    insideFunction: false,
    declaredInputNames: [] as string[],
    declaredOutputNames: [] as string[],
    allowedVarNames: new Set<string>(),
  })),
)
vi.mock('@/features/functions/canvas/use-function-scope', () => ({
  useFunctionScope: useFunctionScopeMock,
}))

// VariableRefCombobox will be at this path once implemented
import { VariableRefCombobox } from '@/features/workbench/common/element-config/parameters/variable-ref-combobox'

// Mock AvailableVariable type - same shape as used by OutputBindingCombobox
interface TestVariable {
  name: string
  type: string
  source?: string
  isOutputBinding?: boolean
}

// Test fixture: a representative set of variables with various types
const allVariables: TestVariable[] = [
  { name: 'users_list', type: 'array' },
  { name: 'config_map', type: 'map' },
  { name: 'results_table', type: 'table' },
  { name: 'api_url', type: 'string' },
  { name: 'retry_count', type: 'integer' },
  { name: 'timeout_sec', type: 'float' },
  { name: 'is_enabled', type: 'boolean' },
  { name: 'items_array', type: 'array', source: 'http-1' },
  { name: 'response_map', type: 'map', source: 'http-2' },
]

describe('VariableRefCombobox', () => {
  let onChange: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onChange = vi.fn()
  })

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  describe('rendering', () => {
    it('renders an input element', () => {
      render(
        <VariableRefCombobox
          value=""
          onChange={onChange}
          allowedTypes={['array', 'map', 'table']}
          availableVariables={allVariables}
        />
      )

      const input = screen.getByRole('combobox')
      expect(input).toBeInTheDocument()
    })

    it('displays the provided value in the input', () => {
      render(
        <VariableRefCombobox
          value="users_list"
          onChange={onChange}
          allowedTypes={['array', 'map', 'table']}
          availableVariables={allVariables}
        />
      )

      const input = screen.getByRole('combobox')
      expect(input).toHaveValue('users_list')
    })

    it('renders with monospace font styling', () => {
      render(
        <VariableRefCombobox
          value=""
          onChange={onChange}
          allowedTypes={['array']}
          availableVariables={allVariables}
        />
      )

      const input = screen.getByRole('combobox')
      expect(input.className).toContain('font-mono')
    })
  })

  // ---------------------------------------------------------------------------
  // Filtering by allowed types
  // ---------------------------------------------------------------------------

  describe('type filtering', () => {
    it('shows only variables matching allowedTypes when opened', async () => {
      const user = userEvent.setup()
      render(
        <VariableRefCombobox
          value=""
          onChange={onChange}
          allowedTypes={['array', 'map', 'table']}
          availableVariables={allVariables}
        />
      )

      // Open combobox via Ctrl+Space
      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      // Should show array, map, table variables
      await waitFor(() => {
        expect(screen.getByText('users_list')).toBeInTheDocument()
      })
      expect(screen.getByText('config_map')).toBeInTheDocument()
      expect(screen.getByText('results_table')).toBeInTheDocument()
      expect(screen.getByText('items_array')).toBeInTheDocument()
      expect(screen.getByText('response_map')).toBeInTheDocument()

      // Should NOT show string, integer, float, boolean variables
      expect(screen.queryByText('api_url')).not.toBeInTheDocument()
      expect(screen.queryByText('retry_count')).not.toBeInTheDocument()
      expect(screen.queryByText('timeout_sec')).not.toBeInTheDocument()
      expect(screen.queryByText('is_enabled')).not.toBeInTheDocument()
    })

    it('shows only array variables when allowedTypes is ["array"]', async () => {
      const user = userEvent.setup()
      render(
        <VariableRefCombobox
          value=""
          onChange={onChange}
          allowedTypes={['array']}
          availableVariables={allVariables}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('users_list')).toBeInTheDocument()
      })
      expect(screen.getByText('items_array')).toBeInTheDocument()

      // Map and table should not appear
      expect(screen.queryByText('config_map')).not.toBeInTheDocument()
      expect(screen.queryByText('results_table')).not.toBeInTheDocument()
    })

    it('shows no variables when none match allowed types', async () => {
      const user = userEvent.setup()
      const stringOnlyVars: TestVariable[] = [
        { name: 'url', type: 'string' },
        { name: 'name', type: 'string' },
      ]

      render(
        <VariableRefCombobox
          value=""
          onChange={onChange}
          allowedTypes={['array', 'map', 'table']}
          availableVariables={stringOnlyVars}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      // Should show empty state
      await waitFor(() => {
        expect(screen.getByText('No matching variables')).toBeInTheDocument()
      })
    })

    it('shows all variables when all match allowed types', async () => {
      const user = userEvent.setup()
      const arrayVars: TestVariable[] = [
        { name: 'list_a', type: 'array' },
        { name: 'list_b', type: 'array' },
        { name: 'list_c', type: 'array' },
      ]

      render(
        <VariableRefCombobox
          value=""
          onChange={onChange}
          allowedTypes={['array']}
          availableVariables={arrayVars}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('list_a')).toBeInTheDocument()
      })
      expect(screen.getByText('list_b')).toBeInTheDocument()
      expect(screen.getByText('list_c')).toBeInTheDocument()
    })

    it('handles empty available variables list', async () => {
      const user = userEvent.setup()

      render(
        <VariableRefCombobox
          value=""
          onChange={onChange}
          allowedTypes={['array', 'map', 'table']}
          availableVariables={[]}
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
  // Selection behavior
  // ---------------------------------------------------------------------------

  describe('selection', () => {
    it('calls onChange when a variable is selected', async () => {
      const user = userEvent.setup()
      render(
        <VariableRefCombobox
          value=""
          onChange={onChange}
          allowedTypes={['array', 'map', 'table']}
          availableVariables={allVariables}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('users_list')).toBeInTheDocument()
      })

      await user.click(screen.getByText('users_list'))
      expect(onChange).toHaveBeenCalledWith('users_list')
    })

    it('calls onChange on text input', async () => {
      const user = userEvent.setup()
      render(
        <VariableRefCombobox
          value=""
          onChange={onChange}
          allowedTypes={['array', 'map', 'table']}
          availableVariables={allVariables}
        />
      )

      const input = screen.getByRole('combobox')
      await user.type(input, 'u')

      // onChange should be called for each character typed
      expect(onChange).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // Type badge display
  // ---------------------------------------------------------------------------

  describe('type badges', () => {
    it('shows type label for each variable in the dropdown', async () => {
      const user = userEvent.setup()
      const testVars: TestVariable[] = [
        { name: 'my_array', type: 'array' },
        { name: 'my_map', type: 'map' },
      ]

      render(
        <VariableRefCombobox
          value=""
          onChange={onChange}
          allowedTypes={['array', 'map']}
          availableVariables={testVars}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('my_array')).toBeInTheDocument()
      })

      // Type labels should be visible
      expect(screen.getByText('array')).toBeInTheDocument()
      expect(screen.getByText('map')).toBeInTheDocument()
    })

    it('shows OUT badge for output-sourced variables', async () => {
      const user = userEvent.setup()
      const testVars: TestVariable[] = [
        { name: 'output_items', type: 'array', source: 'http-1', isOutputBinding: true },
      ]

      render(
        <VariableRefCombobox
          value=""
          onChange={onChange}
          allowedTypes={['array']}
          availableVariables={testVars}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('output_items')).toBeInTheDocument()
      })

      expect(screen.getByText('OUT')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Keyboard interaction
  // ---------------------------------------------------------------------------

  describe('keyboard interaction', () => {
    it('opens popover on Ctrl+Space', async () => {
      const user = userEvent.setup()
      render(
        <VariableRefCombobox
          value=""
          onChange={onChange}
          allowedTypes={['array']}
          availableVariables={[{ name: 'items', type: 'array' }]}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('items')).toBeInTheDocument()
      })
    })

    it('closes popover on Escape', async () => {
      const user = userEvent.setup()
      render(
        <VariableRefCombobox
          value=""
          onChange={onChange}
          allowedTypes={['array']}
          availableVariables={[{ name: 'items', type: 'array' }]}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('items')).toBeInTheDocument()
      })

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(screen.queryByText('items')).not.toBeInTheDocument()
      })
    })
  })

  // ---------------------------------------------------------------------------
  // Text filtering
  // ---------------------------------------------------------------------------

  describe('text filtering', () => {
    it('filters dropdown items by typed text', async () => {
      const user = userEvent.setup()
      const testVars: TestVariable[] = [
        { name: 'users_list', type: 'array' },
        { name: 'config_map', type: 'map' },
        { name: 'user_prefs', type: 'map' },
      ]

      render(
        <VariableRefCombobox
          value="user"
          onChange={onChange}
          allowedTypes={['array', 'map']}
          availableVariables={testVars}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      // "user" should match "users_list" and "user_prefs"
      await waitFor(() => {
        expect(screen.getByText('users_list')).toBeInTheDocument()
      })
      expect(screen.getByText('user_prefs')).toBeInTheDocument()

      // "config_map" should be filtered out
      expect(screen.queryByText('config_map')).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // No "new variable" hint (unlike OutputBindingCombobox)
  // ---------------------------------------------------------------------------

  describe('no new variable hint', () => {
    it('does not show "new variable" hint for unmatched text', async () => {
      const user = userEvent.setup()
      render(
        <VariableRefCombobox
          value="nonexistent_var"
          onChange={onChange}
          allowedTypes={['array']}
          availableVariables={allVariables}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      // Wait for popover to open
      await waitFor(() => {
        expect(screen.getByText('No matching variables')).toBeInTheDocument()
      })

      // Should NOT show the "will be created as a new variable" hint
      expect(screen.queryByTestId('output-new-var-hint')).not.toBeInTheDocument()
      expect(screen.queryByText(/will be created/)).not.toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------------------
  // Alphabetical sorting
  // ---------------------------------------------------------------------------

  describe('sorting', () => {
    it('sorts compatible variables alphabetically', async () => {
      const user = userEvent.setup()
      const testVars: TestVariable[] = [
        { name: 'zebra_list', type: 'array' },
        { name: 'alpha_list', type: 'array' },
        { name: 'middle_list', type: 'array' },
      ]

      render(
        <VariableRefCombobox
          value=""
          onChange={onChange}
          allowedTypes={['array']}
          availableVariables={testVars}
        />
      )

      const input = screen.getByRole('combobox')
      await user.click(input)
      await user.keyboard('{Control>} {/Control}')

      await waitFor(() => {
        expect(screen.getByText('alpha_list')).toBeInTheDocument()
      })

      // Check order via getAllByRole or DOM order
      const items = screen.getAllByText(/(alpha_list|middle_list|zebra_list)/)
      expect(items[0]).toHaveTextContent('alpha_list')
      expect(items[1]).toHaveTextContent('middle_list')
      expect(items[2]).toHaveTextContent('zebra_list')
    })
  })

  describe('Function scope filtering', () => {
    it('keeps only variables whose name is in scope.allowedVarNames when inside a Function', async () => {
      useFunctionScopeMock.mockReturnValue({
        insideFunction: true,
        declaredInputNames: ['user_id'],
        declaredOutputNames: [],
        allowedVarNames: new Set<string>(['user_id']),
      })
      try {
        const onChange = vi.fn()
        const user = userEvent.setup()
        const testVars: TestVariable[] = [
          { name: 'user_id', type: 'string' },
          { name: 'system_user', type: 'string', source: 'System' },
        ]
        render(
          <VariableRefCombobox
            value=""
            onChange={onChange}
            allowedTypes={['string']}
            availableVariables={testVars}
          />,
        )
        const input = screen.getByRole('combobox')
        await user.click(input)
        await waitFor(() => {
          expect(screen.getByText('user_id')).toBeInTheDocument()
        })
        // system_user is filtered out by scope (not in allowedVarNames).
        expect(screen.queryByText('system_user')).not.toBeInTheDocument()
      } finally {
        useFunctionScopeMock.mockReturnValue({
          insideFunction: false,
          declaredInputNames: [],
          declaredOutputNames: [],
          allowedVarNames: new Set<string>(),
        })
      }
    })
  })
})
