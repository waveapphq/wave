/**
 * EntitySelector Component Tests
 *
 * Tests for the reusable entity type checkbox selector component:
 * - Renders the nine backup parts as checkboxes, in display order (BACKUP-1)
 * - Every part is checkable
 * - Select all / deselect all functionality
 * - Controlled selection state
 * - Two selectors on one page: each name is bound to the checkbox of its own selector (BACKUP-1)
 * - Network entity types: SSH Hosts and Additional Certificates (REQ-5.2.1.42)
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  EntitySelector,
  type EntitySelectorProps,
  BACKUP_ENTITY_TYPES,
  entityTypeLabel,
} from '@/features/settings/components/entity-selector'

// ============================================================================
// Fixtures
// ============================================================================

const DISPLAY_ORDER = [
  'tests',
  'environments',
  'profiles',
  'suites',
  'regressions',
  'functions',
  'system_variables',
  'ssh_hosts',
  'certificates',
]

const REMOVED_PARTS = ['plugins', 'blocks', 'artifacts', 'reports', 'executions', 'users']

// ============================================================================
// Test Utilities
// ============================================================================

function renderEntitySelector(props: Partial<EntitySelectorProps> = {}) {
  const defaultProps: EntitySelectorProps = {
    selected: [],
    onChange: vi.fn(),
    ...props,
  }
  return {
    ...render(<EntitySelector {...defaultProps} />),
    onChange: defaultProps.onChange as ReturnType<typeof vi.fn>,
  }
}

function renderTwoSelectors() {
  const onFirstChange = vi.fn()
  const onSecondChange = vi.fn()
  render(
    <>
      <EntitySelector selected={[]} onChange={onFirstChange} />
      <EntitySelector selected={[]} onChange={onSecondChange} />
    </>,
  )
  const [firstList, secondList] = screen.getAllByTestId('entity-selector')
  return { onFirstChange, onSecondChange, firstList, secondList }
}

// ============================================================================
// Tests
// ============================================================================

describe('EntitySelector', () => {
  describe('Structure', () => {
    it('renders container with testid', () => {
      renderEntitySelector()
      expect(screen.getByTestId('entity-selector')).toBeInTheDocument()
    })

    it('lists the nine parts in display order', () => {
      expect(BACKUP_ENTITY_TYPES).toEqual(DISPLAY_ORDER)
    })

    it('draws nine entries in that order', () => {
      renderEntitySelector()
      const drawn = screen
        .getAllByTestId(/^entity-item-/)
        .map((item) => item.getAttribute('data-testid'))
      expect(drawn).toEqual(DISPLAY_ORDER.map((type) => `entity-item-${type}`))
    })

    it('enables every checkbox', () => {
      renderEntitySelector()
      for (const type of BACKUP_ENTITY_TYPES) {
        // Use testid since some entity types have custom labels (e.g., system_variables -> "System Variables")
        expect(screen.getByTestId(`entity-checkbox-${type}`)).toBeInTheDocument()
        expect(screen.getByTestId(`entity-checkbox-${type}`)).toBeEnabled()
      }
      for (const checkbox of screen.getAllByRole('checkbox')) {
        expect(checkbox).toBeEnabled()
      }
    })

    it('draws no entry beyond the nine', () => {
      renderEntitySelector()
      expect(screen.getAllByTestId(/^entity-item-/)).toHaveLength(9)
      for (const type of REMOVED_PARTS) {
        expect(screen.queryByTestId(`entity-item-${type}`)).not.toBeInTheDocument()
        expect(screen.queryByTestId(`entity-checkbox-${type}`)).not.toBeInTheDocument()
      }
    })

    it('shows no "Not implemented" text', () => {
      renderEntitySelector()
      expect(screen.getByTestId('entity-selector')).not.toHaveTextContent(/not implemented/i)
    })

    it('names the Functions box by its id and capitalizes it by class', () => {
      renderEntitySelector()
      expect(screen.getByRole('checkbox', { name: 'functions' })).toBe(
        screen.getByTestId('entity-checkbox-functions'),
      )
      const item = screen.getByTestId('entity-item-functions')
      expect(within(item).getByText('functions')).toHaveClass('capitalize')
    })

    it('renders custom label for system_variables', () => {
      renderEntitySelector()
      const container = screen.getByTestId('entity-item-system_variables')
      expect(within(container).getByText('System Variables')).toBeInTheDocument()
    })

    it('renders select all button', () => {
      renderEntitySelector()
      expect(screen.getByRole('button', { name: /^select all$/i })).toBeInTheDocument()
    })

    it('renders deselect all button', () => {
      renderEntitySelector()
      expect(screen.getByRole('button', { name: /deselect all/i })).toBeInTheDocument()
    })

    it('hides the slash between the two buttons from screen readers', () => {
      renderEntitySelector()
      expect(screen.getByText('/')).toHaveAttribute('aria-hidden', 'true')
    })
  })

  describe('Selection', () => {
    it('checks selected entity types', () => {
      renderEntitySelector({ selected: ['tests', 'environments'] })
      const testsCheckbox = screen.getByTestId('entity-checkbox-tests')
      expect(testsCheckbox).toBeChecked()
      const envsCheckbox = screen.getByTestId('entity-checkbox-environments')
      expect(envsCheckbox).toBeChecked()
    })

    it('unchecks unselected entity types', () => {
      renderEntitySelector({ selected: ['tests'] })
      const envsCheckbox = screen.getByTestId('entity-checkbox-environments')
      expect(envsCheckbox).not.toBeChecked()
    })

    it('calls onChange when checkbox is toggled on', async () => {
      const user = userEvent.setup()
      const { onChange } = renderEntitySelector({ selected: [] })

      await user.click(screen.getByTestId('entity-checkbox-tests'))
      expect(onChange).toHaveBeenCalledWith(['tests'])
    })

    it('calls onChange when checkbox is toggled off', async () => {
      const user = userEvent.setup()
      const { onChange } = renderEntitySelector({ selected: ['tests', 'environments'] })

      await user.click(screen.getByTestId('entity-checkbox-tests'))
      expect(onChange).toHaveBeenCalledWith(['environments'])
    })

    it('select all selects the nine parts in display order', async () => {
      const user = userEvent.setup()
      const { onChange } = renderEntitySelector({ selected: [] })

      await user.click(screen.getByRole('button', { name: /^select all$/i }))
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(DISPLAY_ORDER)
    })

    it('the disabled prop disables all nine and both links', () => {
      renderEntitySelector({ disabled: true })

      const checkboxes = screen.getAllByRole('checkbox')
      expect(checkboxes).toHaveLength(9)
      for (const checkbox of checkboxes) {
        expect(checkbox).toBeDisabled()
      }
      for (const type of DISPLAY_ORDER) {
        expect(screen.getByTestId(`entity-checkbox-${type}`)).toBeDisabled()
      }
      expect(screen.getByRole('button', { name: /^select all$/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /deselect all/i })).toBeDisabled()
    })

    it('deselect all clears selection', async () => {
      const user = userEvent.setup()
      const { onChange } = renderEntitySelector({
        selected: ['tests', 'environments'],
      })

      await user.click(screen.getByRole('button', { name: /deselect all/i }))
      expect(onChange).toHaveBeenCalledWith([])
    })
  })

  describe('Two selectors on one page', () => {
    it('a click on a name in the second selector calls only the second onChange', async () => {
      const user = userEvent.setup()
      const { onFirstChange, onSecondChange, secondList } = renderTwoSelectors()

      await user.click(within(secondList).getByText('functions'))

      expect(onSecondChange).toHaveBeenCalledTimes(1)
      expect(onSecondChange).toHaveBeenCalledWith(['functions'])
      expect(onFirstChange).not.toHaveBeenCalled()
    })

    it('gives the checkboxes of the two selectors ids that do not overlap', () => {
      const { firstList, secondList } = renderTwoSelectors()
      const firstIds = within(firstList).getAllByRole('checkbox').map((checkbox) => checkbox.id)
      const secondIds = within(secondList).getAllByRole('checkbox').map((checkbox) => checkbox.id)

      expect(firstIds).toHaveLength(9)
      expect(secondIds).toHaveLength(9)
      expect(new Set([...firstIds, ...secondIds]).size).toBe(18)
    })

    it('binds each name to the checkbox of its own selector', () => {
      const { firstList, secondList } = renderTwoSelectors()
      for (const list of [firstList, secondList]) {
        for (const type of BACKUP_ENTITY_TYPES) {
          const item = within(list).getByTestId(`entity-item-${type}`)
          expect(within(item).getByRole('checkbox', { name: entityTypeLabel(type) })).toBe(
            within(item).getByTestId(`entity-checkbox-${type}`),
          )
        }
      }
    })
  })

  describe('Network entity types', () => {
    it('lists ssh_hosts and certificates as enabled entity types', () => {
      expect(BACKUP_ENTITY_TYPES).toContain('ssh_hosts')
      expect(BACKUP_ENTITY_TYPES).toContain('certificates')
    })

    it('labels ssh_hosts "SSH Hosts"', () => {
      renderEntitySelector()
      const item = screen.getByTestId('entity-item-ssh_hosts')
      expect(within(item).getByText('SSH Hosts')).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'SSH Hosts' })).toBe(
        screen.getByTestId('entity-checkbox-ssh_hosts'),
      )
    })

    it('labels certificates "Additional Certificates"', () => {
      renderEntitySelector()
      const item = screen.getByTestId('entity-item-certificates')
      expect(within(item).getByText('Additional Certificates')).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Additional Certificates' })).toBe(
        screen.getByTestId('entity-checkbox-certificates'),
      )
    })

    it('renders both as enabled checkboxes without the "Not implemented" note', () => {
      renderEntitySelector()
      for (const type of ['ssh_hosts', 'certificates']) {
        expect(screen.getByTestId(`entity-checkbox-${type}`)).toBeEnabled()
        const item = screen.getByTestId(`entity-item-${type}`)
        expect(within(item).queryByText(/not implemented/i)).not.toBeInTheDocument()
      }
    })

    it('checks them when selected', () => {
      renderEntitySelector({ selected: ['ssh_hosts', 'certificates'] })
      expect(screen.getByRole('checkbox', { name: 'SSH Hosts' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Additional Certificates' })).toBeChecked()
    })

    it('calls onChange with ssh_hosts when SSH Hosts is toggled on', async () => {
      const user = userEvent.setup()
      const { onChange } = renderEntitySelector({ selected: ['tests'] })

      await user.click(screen.getByRole('checkbox', { name: 'SSH Hosts' }))
      expect(onChange).toHaveBeenCalledWith(['tests', 'ssh_hosts'])
    })

    it('calls onChange without certificates when Additional Certificates is toggled off', async () => {
      const user = userEvent.setup()
      const { onChange } = renderEntitySelector({ selected: ['certificates', 'tests'] })

      await user.click(screen.getByRole('checkbox', { name: 'Additional Certificates' }))
      expect(onChange).toHaveBeenCalledWith(['tests'])
    })

    it('select all includes both', async () => {
      const user = userEvent.setup()
      const { onChange } = renderEntitySelector({ selected: [] })

      await user.click(screen.getByRole('button', { name: /^select all$/i }))
      expect(onChange).toHaveBeenCalledWith(expect.arrayContaining(['ssh_hosts', 'certificates']))
    })
  })
})
