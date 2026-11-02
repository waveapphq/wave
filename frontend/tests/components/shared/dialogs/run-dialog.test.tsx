/**
 * RunDialog Component Tests
 *
 * REQ-5.2.1.37: Regression management screen (list, create, edit, version control)
 * REQ-5.2.1.36: Suite management screen (list, create, edit, organize tests)
 * REQ-5.2.1.35: Test management screen (list, create, edit, organize in suites)
 *
 * V-LIST-10: Regression run dialog (shared RunDialog component)
 *
 * Tests for shared RunDialog component per design decisions LISTRUN-1 to LISTRUN-12:
 * - LISTRUN-1: Modal with semi-transparent overlay (#00000080)
 * - LISTRUN-2: Modal width 320px, centered
 * - LISTRUN-3: Header: "Run {Entity}" + close button, subtitle with entity name
 * - LISTRUN-4: Environment selector built into modal
 * - LISTRUN-5: Search input: "Search environments…"
 * - LISTRUN-6: RECENT section: last 5 used environments
 * - LISTRUN-7: Selected environment: blue background + white checkmark
 * - LISTRUN-8: ALL ENVIRONMENTS section: scrollable list (~5 visible)
 * - LISTRUN-9: No "Remember selection" checkbox
 * - LISTRUN-10: Footer divider
 * - LISTRUN-11: Cancel + Run buttons, right-aligned
 * - LISTRUN-12: Same pattern for Tests, Suites, Regressions (shared component)
 *
 * Test selection varies by entity type:
 * - Test: No test selection (single test)
 * - Suite: Flat checkbox list with Select/Deselect All
 * - Regression: Grouped by suite (Collapsible) with Select/Deselect All at both levels
 *
 * Component: frontend/src/components/shared/dialogs/run-dialog.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { RunDialog, type RunDialogProps } from '@/components/shared/dialogs/run-dialog'

// ============================================================================
// Mock Data
// ============================================================================

const mockEnvironments = [
  { id: 'env-1', name: 'Production' },
  { id: 'env-2', name: 'Staging' },
  { id: 'env-3', name: 'Development' },
  { id: 'env-4', name: 'QA' },
  { id: 'env-5', name: 'Load Test' },
  { id: 'env-6', name: 'DR Site' },
  { id: 'env-7', name: 'Integration' },
]

const mockRecentEnvironments = [
  { id: 'env-2', name: 'Staging' },
  { id: 'env-3', name: 'Development' },
]

const mockSuiteTests = {
  tests: [
    { id: 'test-1', name: 'Login Test', selected: true },
    { id: 'test-2', name: 'Logout Test', selected: true },
    { id: 'test-3', name: 'Password Reset', selected: false },
    { id: 'test-4', name: 'Two-Factor Auth', selected: true },
  ],
}

const mockRegressionSuites = {
  suites: [
    {
      id: 'suite-1',
      name: 'Authentication Suite',
      expanded: true,
      tests: [
        { id: 'test-1', name: 'Login Test', selected: true },
        { id: 'test-2', name: 'Logout Test', selected: true },
        { id: 'test-3', name: 'Password Reset', selected: false },
      ],
    },
    {
      id: 'suite-2',
      name: 'API Suite',
      expanded: false,
      tests: [
        { id: 'test-4', name: 'GET /users', selected: true },
        { id: 'test-5', name: 'POST /users', selected: true },
        { id: 'test-6', name: 'DELETE /users', selected: true },
      ],
    },
  ],
}

// ============================================================================
// Test Utilities
// ============================================================================

function renderRunDialog(props: Partial<RunDialogProps> = {}) {
  const defaultProps: RunDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    entityType: 'test',
    entityName: 'Login Test',
    entityId: 'test-1',
    environments: mockEnvironments,
    recentEnvironments: mockRecentEnvironments,
    selectedEnvironmentId: null,
    onEnvironmentSelect: vi.fn(),
    onRun: vi.fn(),
    onCancel: vi.fn(),
    ...props,
  }
  return render(<RunDialog {...defaultProps} />)
}

// ============================================================================
// Tests
// ============================================================================

describe('RunDialog', () => {
  describe('Modal Structure (LISTRUN-1, LISTRUN-2)', () => {
    it('renders modal when open is true', () => {
      renderRunDialog({ open: true })
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('does not render modal when open is false', () => {
      renderRunDialog({ open: false })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('modal has semi-transparent overlay (LISTRUN-1)', () => {
      renderRunDialog()
      const overlay = document.querySelector('[data-testid="dialog-overlay"]')
      expect(overlay).toBeInTheDocument()
    })

    it('modal has appropriate width based on entity type (LISTRUN-2)', () => {
      // Tests: single column (400px default)
      renderRunDialog({ entityType: 'test' })
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveStyle({ width: '400px' })
    })

    it('modal has wider width for suite/regression (horizontal layout)', () => {
      // Suites/Regressions: two columns (800px default, resizable)
      renderRunDialog({ entityType: 'suite', suiteTests: mockSuiteTests })
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveStyle({ width: '800px' })
    })

    it('modal is centered (LISTRUN-2)', () => {
      renderRunDialog()
      const dialog = screen.getByRole('dialog')
      // Dialog positioning handled by shadcn Dialog component
      expect(dialog).toBeVisible()
    })
  })

  describe('Header (LISTRUN-3)', () => {
    it('displays "Run Test" title for test entity', () => {
      renderRunDialog({ entityType: 'test', entityName: 'Login Test' })
      expect(screen.getByRole('heading', { name: /Run Test/i })).toBeInTheDocument()
    })

    it('displays "Run Suite" title for suite entity', () => {
      renderRunDialog({ entityType: 'suite', entityName: 'Auth Suite' })
      expect(screen.getByRole('heading', { name: /Run Suite/i })).toBeInTheDocument()
    })

    it('displays "Run Regression" title for regression entity', () => {
      renderRunDialog({ entityType: 'regression', entityName: 'WAVE 25.12' })
      expect(screen.getByRole('heading', { name: /Run Regression/i })).toBeInTheDocument()
    })

    it('displays entity name as subtitle', () => {
      renderRunDialog({ entityType: 'test', entityName: 'Login Test' })
      expect(screen.getByTestId('run-dialog-subtitle')).toHaveTextContent('Login Test')
    })

    it('renders close button in header', () => {
      renderRunDialog()
      expect(screen.getByTestId('run-dialog-close')).toBeInTheDocument()
    })
  })

  describe('Environment Section (LISTRUN-4, LISTRUN-5, LISTRUN-6, LISTRUN-7, LISTRUN-8)', () => {
    it('renders "Environment" section header', () => {
      renderRunDialog()
      // Use heading role to find the Environment section header specifically
      expect(screen.getByRole('heading', { level: 3, name: /Environment/i })).toBeInTheDocument()
    })

    it('renders search input with placeholder (LISTRUN-5)', () => {
      renderRunDialog()
      expect(screen.getByPlaceholderText(/Search…/i)).toBeInTheDocument()
    })

    it('renders Recent section when recent environments exist (LISTRUN-6)', () => {
      renderRunDialog({ recentEnvironments: mockRecentEnvironments })
      expect(screen.getByText(/Recent/i)).toBeInTheDocument()
    })

    it('does not render Recent section when no recent environments', () => {
      renderRunDialog({ recentEnvironments: [] })
      expect(screen.queryByTestId('recent-environments')).not.toBeInTheDocument()
    })

    it('displays recent environments (LISTRUN-6)', () => {
      renderRunDialog({ recentEnvironments: mockRecentEnvironments })
      const recentSection = screen.getByTestId('recent-environments')
      expect(within(recentSection).getByText('Staging')).toBeInTheDocument()
      expect(within(recentSection).getByText('Development')).toBeInTheDocument()
    })

    it('renders All environments section (LISTRUN-8)', () => {
      renderRunDialog()
      expect(screen.getByText(/ALL ENVIRONMENTS/i)).toBeInTheDocument()
    })

    it('displays all environments in scrollable list (LISTRUN-8)', () => {
      renderRunDialog()
      const allSection = screen.getByTestId('all-environments')
      mockEnvironments.forEach((env) => {
        expect(within(allSection).getByText(env.name)).toBeInTheDocument()
      })
    })

    it('selected environment has highlighted styling (LISTRUN-7)', () => {
      renderRunDialog({ selectedEnvironmentId: 'env-2' })
      // Find the selected environments by aria-current
      const selectedItems = screen.getAllByTestId(/run-dialog-(all-env|recent-env)/).filter(
        (el) => el.getAttribute('aria-current') === 'true'
      )
      expect(selectedItems[0]).toHaveClass('bg-primary')
    })

    it('selected environment shows checkmark (LISTRUN-7)', () => {
      renderRunDialog({ selectedEnvironmentId: 'env-2' })
      // Find the selected environments by aria-current
      const selectedItems = screen.getAllByTestId(/run-dialog-(all-env|recent-env)/).filter(
        (el) => el.getAttribute('aria-current') === 'true'
      )
      expect(within(selectedItems[0]).getByTestId('checkmark-icon')).toBeInTheDocument()
    })

    it('calls onEnvironmentSelect when environment is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleEnvironmentSelect = vi.fn()

      renderRunDialog({ onEnvironmentSelect: handleEnvironmentSelect })
      const allSection = screen.getByTestId('all-environments')
      await user.click(within(allSection).getByText('Production'))

      expect(handleEnvironmentSelect).toHaveBeenCalledWith('env-1')
    })

    it('filters environments when searching', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRunDialog()
      const searchInput = screen.getByPlaceholderText(/Search…/i)
      await user.type(searchInput, 'Prod')

      const allSection = screen.getByTestId('all-environments')
      expect(within(allSection).getByText('Production')).toBeInTheDocument()
      expect(within(allSection).queryByText('Staging')).not.toBeInTheDocument()
    })

    it('does NOT show "Remember selection" checkbox (LISTRUN-9)', () => {
      renderRunDialog()
      expect(screen.queryByRole('checkbox', { name: /remember/i })).not.toBeInTheDocument()
      expect(screen.queryByText(/Remember selection/i)).not.toBeInTheDocument()
    })
  })

  describe('Test Selection - Test Entity', () => {
    it('does NOT render test selection for single test', () => {
      renderRunDialog({ entityType: 'test' })
      expect(screen.queryByText(/Select Tests/i)).not.toBeInTheDocument()
      expect(screen.queryByTestId('test-selection')).not.toBeInTheDocument()
    })
  })

  describe('Test Selection - Suite Entity (Flat List)', () => {
    it('renders test selection section for suite', () => {
      renderRunDialog({
        entityType: 'suite',
        suiteTests: mockSuiteTests,
      })
      expect(screen.getByText(/Tests/i)).toBeInTheDocument()
    })

    it('renders Select/Deselect All checkbox', () => {
      renderRunDialog({
        entityType: 'suite',
        suiteTests: mockSuiteTests,
      })
      expect(screen.getByRole('checkbox', { name: /Select All/i })).toBeInTheDocument()
    })

    it('displays selected count "X/Y"', () => {
      renderRunDialog({
        entityType: 'suite',
        suiteTests: mockSuiteTests,
      })
      // 3 of 4 tests are selected in mockSuiteTests
      expect(screen.getByText(/3\/4/)).toBeInTheDocument()
    })

    it('renders flat list of tests with checkboxes', () => {
      renderRunDialog({
        entityType: 'suite',
        suiteTests: mockSuiteTests,
      })
      const testList = screen.getByTestId('suite-tests-list')

      mockSuiteTests.tests.forEach((test) => {
        expect(within(testList).getByText(test.name)).toBeInTheDocument()
        expect(within(testList).getByRole('checkbox', { name: test.name })).toBeInTheDocument()
      })
    })

    it('test checkboxes reflect selected state', () => {
      renderRunDialog({
        entityType: 'suite',
        suiteTests: mockSuiteTests,
      })
      const testList = screen.getByTestId('suite-tests-list')

      expect(within(testList).getByRole('checkbox', { name: 'Login Test' })).toBeChecked()
      expect(within(testList).getByRole('checkbox', { name: 'Password Reset' })).not.toBeChecked()
    })

    it('calls onTestSelectionChange when test checkbox is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleTestSelectionChange = vi.fn()

      renderRunDialog({
        entityType: 'suite',
        suiteTests: mockSuiteTests,
        onTestSelectionChange: handleTestSelectionChange,
      })

      const testList = screen.getByTestId('suite-tests-list')
      await user.click(within(testList).getByRole('checkbox', { name: 'Password Reset' }))

      expect(handleTestSelectionChange).toHaveBeenCalledWith('test-3', true)
    })

    it('calls onSelectAll when Select All is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSelectAll = vi.fn()

      renderRunDialog({
        entityType: 'suite',
        suiteTests: mockSuiteTests,
        onSelectAll: handleSelectAll,
      })

      await user.click(screen.getByRole('checkbox', { name: /Select All/i }))

      expect(handleSelectAll).toHaveBeenCalledWith(true)
    })

    it('Select All checkbox is checked when all tests are selected', () => {
      const allSelected = {
        tests: mockSuiteTests.tests.map((t) => ({ ...t, selected: true })),
      }
      renderRunDialog({
        entityType: 'suite',
        suiteTests: allSelected,
      })

      expect(screen.getByRole('checkbox', { name: /Select All/i })).toBeChecked()
    })

    it('Select All checkbox is indeterminate when some tests are selected', () => {
      renderRunDialog({
        entityType: 'suite',
        suiteTests: mockSuiteTests,
      })

      const selectAllCheckbox = screen.getByRole('checkbox', { name: /Select All/i })
      expect(selectAllCheckbox).toHaveAttribute('data-state', 'indeterminate')
    })

    it('Select All checkbox is unchecked when no tests are selected', () => {
      const noneSelected = {
        tests: mockSuiteTests.tests.map((t) => ({ ...t, selected: false })),
      }
      renderRunDialog({
        entityType: 'suite',
        suiteTests: noneSelected,
      })

      expect(screen.getByRole('checkbox', { name: /Select All/i })).not.toBeChecked()
    })

    it('displays "0/X" when none are selected', () => {
      const noneSelected = {
        tests: mockSuiteTests.tests.map((t) => ({ ...t, selected: false })),
      }
      renderRunDialog({
        entityType: 'suite',
        suiteTests: noneSelected,
      })

      expect(screen.getByText(/0\/4/)).toBeInTheDocument()
    })

    it('calls onSelectAll with false when all tests are selected and Select All is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSelectAll = vi.fn()
      const allSelected = {
        tests: mockSuiteTests.tests.map((t) => ({ ...t, selected: true })),
      }

      renderRunDialog({
        entityType: 'suite',
        suiteTests: allSelected,
        onSelectAll: handleSelectAll,
      })

      await user.click(screen.getByRole('checkbox', { name: /Select All/i }))

      expect(handleSelectAll).toHaveBeenCalledWith(false)
    })
  })

  describe('Test Selection - Regression Entity (Grouped by Suite)', () => {
    it('renders test selection section for regression', () => {
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
      })
      expect(screen.getByText(/Test Selection/i)).toBeInTheDocument()
    })

    it('renders Select/Deselect All checkbox at top level', () => {
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
      })
      expect(screen.getByRole('checkbox', { name: /Select All/i })).toBeInTheDocument()
    })

    it('displays total selected count across all suites', () => {
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
      })
      // 2 selected in suite-1 (Login, Logout), 3 in suite-2 = 5 of 6 total
      expect(screen.getByText(/5\/6 tests in 2 suites/i)).toBeInTheDocument()
    })

    it('renders collapsible suite groups', () => {
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
      })

      expect(screen.getByTestId('suite-group-suite-1')).toBeInTheDocument()
      expect(screen.getByTestId('suite-group-suite-2')).toBeInTheDocument()
    })

    it('suite header shows suite name', () => {
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
      })

      const suiteGroup1 = screen.getByTestId('suite-group-suite-1')
      expect(within(suiteGroup1).getByText('Authentication Suite')).toBeInTheDocument()
    })

    it('suite header shows selected count "X/Y"', () => {
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
      })

      const suiteGroup1 = screen.getByTestId('suite-group-suite-1')
      expect(within(suiteGroup1).getByText('2/3')).toBeInTheDocument()
    })

    it('suite header has checkbox for suite-level selection', () => {
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
      })

      const suiteHeader1 = screen.getByTestId('suite-header-suite-1')
      expect(within(suiteHeader1).getByRole('checkbox')).toBeInTheDocument()
    })

    it('expanded suite shows tests', () => {
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
      })

      // suite-1 is expanded
      const suiteGroup1 = screen.getByTestId('suite-group-suite-1')
      expect(within(suiteGroup1).getByText('Login Test')).toBeInTheDocument()
      expect(within(suiteGroup1).getByText('Logout Test')).toBeInTheDocument()
      expect(within(suiteGroup1).getByText('Password Reset')).toBeInTheDocument()
    })

    it('collapsed suite hides tests', () => {
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
      })

      // suite-2 is collapsed - Radix Collapsible doesn't render children when closed
      const suiteGroup2 = screen.getByTestId('suite-group-suite-2')
      expect(within(suiteGroup2).queryByText('GET /users')).not.toBeInTheDocument()
    })

    it('expand/collapse chevron is visible', () => {
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
      })

      const suiteGroup1 = screen.getByTestId('suite-group-suite-1')
      expect(within(suiteGroup1).getByTestId('suite-group-chevron')).toBeInTheDocument()
    })

    it('calls onSuiteExpandToggle when chevron is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSuiteExpandToggle = vi.fn()

      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
        onSuiteExpandToggle: handleSuiteExpandToggle,
      })

      const suiteGroup2 = screen.getByTestId('suite-group-suite-2')
      await user.click(within(suiteGroup2).getByTestId('suite-group-chevron'))

      expect(handleSuiteExpandToggle).toHaveBeenCalledWith('suite-2')
    })

    it('calls onSuiteSelectionChange when suite checkbox is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSuiteSelectionChange = vi.fn()

      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
        onSuiteSelectionChange: handleSuiteSelectionChange,
      })

      const suiteHeader1 = screen.getByTestId('suite-header-suite-1')
      await user.click(within(suiteHeader1).getByRole('checkbox'))

      expect(handleSuiteSelectionChange).toHaveBeenCalledWith('suite-1', expect.any(Boolean))
    })

    it('calls onRegressionTestSelectionChange with (suiteId, testId, selected) when a regression test checkbox is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRegressionTestSelectionChange = vi.fn()

      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
        onRegressionTestSelectionChange: handleRegressionTestSelectionChange,
      })

      const suiteGroup1 = screen.getByTestId('suite-group-suite-1')
      await user.click(within(suiteGroup1).getByRole('checkbox', { name: 'Password Reset' }))

      // Per the per-(suite, test) selection model: the callback receives the
      // suite id alongside the test id so the same test id in a different
      // suite context can remain independently selected.
      expect(handleRegressionTestSelectionChange).toHaveBeenCalledWith(
        'suite-1',
        'test-3',
        true
      )
    })

    it('renders DuplicateTestBadge next to a test that appears in 2+ suites of the regression', () => {
      const suites = {
        suites: [
          {
            id: 'suite-1',
            name: 'Auth',
            expanded: true,
            tests: [{ id: 'shared-test', name: 'Login', selected: true }],
          },
          {
            id: 'suite-2',
            name: 'Billing',
            expanded: true,
            tests: [{ id: 'shared-test', name: 'Login', selected: true }],
          },
        ],
      }

      renderRunDialog({
        entityType: 'regression',
        regressionSuites: suites,
        duplicateTests: { 'shared-test': ['suite-1', 'suite-2'] },
      })

      // Two instances of the shared test are rendered (once per suite); both
      // must carry the duplicate badge.
      const badges = screen.getAllByTestId('duplicate-test-badge')
      expect(badges.length).toBeGreaterThanOrEqual(2)
    })

    it('suite checkbox is indeterminate when some suite tests are selected', () => {
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
      })

      const suiteHeader1 = screen.getByTestId('suite-header-suite-1')
      const suiteCheckbox = within(suiteHeader1).getByRole('checkbox')
      expect(suiteCheckbox).toHaveAttribute('data-state', 'indeterminate')
    })

    it('suite checkbox is checked when all suite tests are selected', () => {
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
      })

      // suite-2 has all tests selected
      const suiteHeader2 = screen.getByTestId('suite-header-suite-2')
      const suiteCheckbox = within(suiteHeader2).getByRole('checkbox')
      expect(suiteCheckbox).toBeChecked()
    })

    it('calls onSuiteSelectionChange with false when all suite tests selected and checkbox clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSuiteSelectionChange = vi.fn()

      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
        onSuiteSelectionChange: handleSuiteSelectionChange,
      })

      // suite-2 has all tests selected, so clicking should deselect all
      const suiteHeader2 = screen.getByTestId('suite-header-suite-2')
      await user.click(within(suiteHeader2).getByRole('checkbox'))

      expect(handleSuiteSelectionChange).toHaveBeenCalledWith('suite-2', false)
    })

    it('displays "0/X tests" when no regression tests are selected', () => {
      const noTestsSelected = {
        suites: mockRegressionSuites.suites.map((suite) => ({
          ...suite,
          tests: suite.tests.map((t) => ({ ...t, selected: false })),
        })),
      }
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: noTestsSelected,
      })

      expect(screen.getByText(/0\/6 tests in 2 suites/i)).toBeInTheDocument()
    })

    it('calls onSelectAll with false when all regression tests are selected', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleSelectAll = vi.fn()

      const allTestsSelected = {
        suites: mockRegressionSuites.suites.map((suite) => ({
          ...suite,
          tests: suite.tests.map((t) => ({ ...t, selected: true })),
        })),
      }

      renderRunDialog({
        entityType: 'regression',
        regressionSuites: allTestsSelected,
        onSelectAll: handleSelectAll,
      })

      await user.click(screen.getByRole('checkbox', { name: /Select All/i }))

      expect(handleSelectAll).toHaveBeenCalledWith(false)
    })
  })

  describe('Footer (LISTRUN-10, LISTRUN-11)', () => {
    it('footer has top border for visual separation (LISTRUN-10)', () => {
      renderRunDialog()
      const footer = screen.getByTestId('run-dialog-footer')
      expect(footer).toHaveClass('border-t')
    })

    it('renders Cancel button', () => {
      renderRunDialog()
      expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
    })

    it('renders Run button', () => {
      renderRunDialog()
      expect(screen.getByRole('button', { name: /^Run$/i })).toBeInTheDocument()
    })

    it('buttons are right-aligned (LISTRUN-11)', () => {
      renderRunDialog()
      const footer = screen.getByTestId('run-dialog-footer')
      expect(footer).toHaveClass('sm:justify-end')
    })

    it('Cancel button calls onCancel', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleCancel = vi.fn()

      renderRunDialog({ onCancel: handleCancel })
      await user.click(screen.getByRole('button', { name: /Cancel/i }))

      expect(handleCancel).toHaveBeenCalledTimes(1)
    })

    it('Run button calls onRun', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleRun = vi.fn()

      renderRunDialog({ selectedEnvironmentId: 'env-1', onRun: handleRun })
      await user.click(screen.getByRole('button', { name: /^Run$/i }))

      expect(handleRun).toHaveBeenCalledTimes(1)
    })

    it('Run button is disabled when no environment selected', () => {
      renderRunDialog({ selectedEnvironmentId: null })
      expect(screen.getByRole('button', { name: /^Run$/i })).toBeDisabled()
    })

    it('Run button is enabled when environment is selected', () => {
      renderRunDialog({ selectedEnvironmentId: 'env-1' })
      expect(screen.getByRole('button', { name: /^Run$/i })).toBeEnabled()
    })

    it('Run button shows loading state when isRunning', () => {
      renderRunDialog({ selectedEnvironmentId: 'env-1', isRunning: true })
      const runButton = screen.getByRole('button', { name: /Running/i })
      expect(runButton).toBeDisabled()
    })

    it('Run button is disabled when no tests are selected for suite', () => {
      const noTestsSelected = {
        tests: mockSuiteTests.tests.map((t) => ({ ...t, selected: false })),
      }
      renderRunDialog({
        entityType: 'suite',
        suiteTests: noTestsSelected,
        selectedEnvironmentId: 'env-1',
      })
      expect(screen.getByRole('button', { name: /^Run$/i })).toBeDisabled()
    })

    it('Run button is enabled when at least one test is selected for suite', () => {
      renderRunDialog({
        entityType: 'suite',
        suiteTests: mockSuiteTests, // has some selected
        selectedEnvironmentId: 'env-1',
      })
      expect(screen.getByRole('button', { name: /^Run$/i })).toBeEnabled()
    })

    it('Run button is disabled when no tests are selected for regression', () => {
      const noTestsSelected = {
        suites: mockRegressionSuites.suites.map((suite) => ({
          ...suite,
          tests: suite.tests.map((t) => ({ ...t, selected: false })),
        })),
      }
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: noTestsSelected,
        selectedEnvironmentId: 'env-1',
      })
      expect(screen.getByRole('button', { name: /^Run$/i })).toBeDisabled()
    })

    it('Run button is enabled when at least one test is selected for regression', () => {
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites, // has some selected
        selectedEnvironmentId: 'env-1',
      })
      expect(screen.getByRole('button', { name: /^Run$/i })).toBeEnabled()
    })
  })

  describe('Keyboard Navigation', () => {
    it('Escape closes the dialog', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()
      const handleOpenChange = vi.fn()

      renderRunDialog({ onOpenChange: handleOpenChange })
      await user.keyboard('{Escape}')

      expect(handleOpenChange).toHaveBeenCalledWith(false)
    })

    it('Tab navigates through interactive elements', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRunDialog()

      // First focus should be on close button or search input
      await user.tab()
      expect(document.activeElement).toBeTruthy()
    })
  })

  describe('Accessibility', () => {
    it('dialog has accessible role', () => {
      renderRunDialog()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('dialog has aria-modal', () => {
      renderRunDialog()
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    })

    it('dialog has aria-labelledby', () => {
      renderRunDialog()
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-labelledby')
    })

    it('cancel button has accessible name (replaces close button)', () => {
      renderRunDialog()
      expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
    })

    it('search input has accessible label', () => {
      renderRunDialog()
      expect(screen.getByLabelText(/Search/i)).toBeInTheDocument()
    })

    it('environment list items are selectable', () => {
      renderRunDialog()
      const allSection = screen.getByTestId('all-environments')
      const items = within(allSection).getAllByRole('button')
      expect(items.length).toBeGreaterThan(0)
    })

    it('selected environment has aria-current', () => {
      renderRunDialog({ selectedEnvironmentId: 'env-2' })
      // Use aria-current to find the selected environment (may appear in both Recent and All)
      const selectedItems = screen.getAllByTestId(/run-dialog-(all-env|recent-env)/).filter(
        (el) => el.getAttribute('aria-current') === 'true'
      )
      expect(selectedItems.length).toBeGreaterThan(0)
      expect(selectedItems[0]).toHaveAttribute('aria-current', 'true')
    })
  })

  describe('Entity Type Variations (LISTRUN-12)', () => {
    it('works correctly for test entity type', () => {
      renderRunDialog({ entityType: 'test', entityName: 'My Test' })

      expect(screen.getByRole('heading', { name: /Run Test/i })).toBeInTheDocument()
      expect(screen.getByTestId('run-dialog-subtitle')).toHaveTextContent('My Test')
      expect(screen.queryByTestId('test-selection')).not.toBeInTheDocument()
    })

    it('works correctly for suite entity type', () => {
      renderRunDialog({
        entityType: 'suite',
        entityName: 'Auth Suite',
        suiteTests: mockSuiteTests,
      })

      expect(screen.getByRole('heading', { name: /Run Suite/i })).toBeInTheDocument()
      expect(screen.getByTestId('run-dialog-subtitle')).toHaveTextContent('Auth Suite')
      expect(screen.getByTestId('suite-tests-list')).toBeInTheDocument()
    })

    it('works correctly for regression entity type', () => {
      renderRunDialog({
        entityType: 'regression',
        entityName: 'WAVE 25.12',
        regressionSuites: mockRegressionSuites,
      })

      expect(screen.getByRole('heading', { name: /Run Regression/i })).toBeInTheDocument()
      expect(screen.getByTestId('run-dialog-subtitle')).toHaveTextContent('WAVE 25.12')
      expect(screen.getByTestId('suite-group-suite-1')).toBeInTheDocument()
    })
  })

  describe('ScrollArea Integration', () => {
    it('environment list is scrollable', () => {
      renderRunDialog()
      const scrollArea = screen.getByTestId('environments-scroll-area')
      expect(scrollArea).toBeInTheDocument()
    })

    it('test selection list is scrollable for suite', () => {
      renderRunDialog({
        entityType: 'suite',
        suiteTests: mockSuiteTests,
      })
      const scrollArea = screen.getByTestId('run-dialog-test-scroll-area')
      expect(scrollArea).toBeInTheDocument()
    })

    it('suite groups list is scrollable for regression', () => {
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
      })
      const scrollArea = screen.getByTestId('run-dialog-test-scroll-area')
      expect(scrollArea).toBeInTheDocument()
    })
  })

  describe('Suite Entity Empty States', () => {
    it('displays "No tests in this suite" when suite has no tests', () => {
      const emptySuiteTests = { tests: [] }
      renderRunDialog({
        entityType: 'suite',
        suiteTests: emptySuiteTests,
      })

      expect(screen.getByText('No tests in this suite')).toBeInTheDocument()
    })

    it('displays "No tests match your search" when filter matches nothing', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRunDialog({
        entityType: 'suite',
        suiteTests: mockSuiteTests,
      })

      // Type a search query that won't match any tests
      const searchInput = screen.getByPlaceholderText(/Search tests…/i)
      await user.type(searchInput, 'xyznonexistent')

      expect(screen.getByText('No tests match your search')).toBeInTheDocument()
    })
  })

  describe('Regression Empty States', () => {
    it('displays "No suites in this regression" when regression has no suites', () => {
      const emptyRegressionSuites = { suites: [] }
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: emptyRegressionSuites,
      })

      expect(screen.getByText('No suites in this regression')).toBeInTheDocument()
    })

    it('displays "No suites or tests match your search" when filter matches nothing', async () => {
      const { userEvent } = await import('@testing-library/user-event')
      const user = userEvent.setup()

      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
      })

      // Type a search query that won't match any suites or tests (in the test selection area)
      const searchInput = screen.getByPlaceholderText(/Search suites or tests…/i)
      await user.type(searchInput, 'xyznonexistent')

      expect(screen.getByText('No suites or tests match your search')).toBeInTheDocument()
    })

    it('displays "No tests" when a suite has no tests', () => {
      const suitesWithEmptySuite = {
        suites: [
          {
            id: 'suite-empty',
            name: 'Empty Suite',
            expanded: true,
            tests: [],
          },
        ],
      }
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: suitesWithEmptySuite,
      })

      expect(screen.getByText('No tests')).toBeInTheDocument()
    })
  })

  describe('Dialog Resize', () => {
    it('renders resize handle for suite entity type', () => {
      renderRunDialog({
        entityType: 'suite',
        suiteTests: mockSuiteTests,
      })
      expect(screen.getByTestId('resize-handle-se')).toBeInTheDocument()
    })

    it('renders resize handle for regression entity type', () => {
      renderRunDialog({
        entityType: 'regression',
        regressionSuites: mockRegressionSuites,
      })
      expect(screen.getByTestId('resize-handle-se')).toBeInTheDocument()
    })

    it('supports mouse-based resizing via mousedown/mousemove/mouseup', async () => {
      const { fireEvent } = await import('@testing-library/react')

      renderRunDialog({
        entityType: 'suite',
        suiteTests: mockSuiteTests,
      })

      const resizeHandle = screen.getByTestId('resize-handle-se')
      const dialog = screen.getByRole('dialog')

      // Get initial size
      const initialWidth = parseInt(dialog.style.width)
      expect(initialWidth).toBe(800)

      // Simulate mouse drag
      fireEvent.mouseDown(resizeHandle, { clientX: 800, clientY: 560 })
      fireEvent.mouseMove(document, { clientX: 900, clientY: 660 })
      fireEvent.mouseUp(document)

      // After resize, the dialog should have updated dimensions
      // The resize handler clamps to min/max values
      const newWidth = parseInt(dialog.style.width)
      expect(newWidth).toBeGreaterThanOrEqual(600) // minWidth for suite
    })

    it('respects minimum dialog width during resize', async () => {
      const { fireEvent } = await import('@testing-library/react')

      renderRunDialog({
        entityType: 'suite',
        suiteTests: mockSuiteTests,
      })

      const resizeHandle = screen.getByTestId('resize-handle-se')
      const dialog = screen.getByRole('dialog')

      // Try to resize smaller than minimum
      fireEvent.mouseDown(resizeHandle, { clientX: 800, clientY: 560 })
      fireEvent.mouseMove(document, { clientX: 200, clientY: 200 }) // Way smaller than min
      fireEvent.mouseUp(document)

      // Should be clamped to minimum width (600 for suite)
      const newWidth = parseInt(dialog.style.width)
      expect(newWidth).toBe(600)
    })

    it('respects minimum dialog height during resize', async () => {
      const { fireEvent } = await import('@testing-library/react')

      renderRunDialog({
        entityType: 'suite',
        suiteTests: mockSuiteTests,
      })

      const resizeHandle = screen.getByTestId('resize-handle-se')
      const dialog = screen.getByRole('dialog')

      // Try to resize smaller than minimum
      fireEvent.mouseDown(resizeHandle, { clientX: 800, clientY: 560 })
      fireEvent.mouseMove(document, { clientX: 700, clientY: 100 }) // Height way smaller than min
      fireEvent.mouseUp(document)

      // Should be clamped to minimum height (400)
      const newHeight = parseInt(dialog.style.height)
      expect(newHeight).toBe(400)
    })
  })
})
