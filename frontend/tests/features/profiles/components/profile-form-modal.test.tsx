/**
 * ProfileFormModal Component Tests
 *
 * REQ-4.7.4: Profile management UI - Create/Edit modal
 * REQ-4.7.10: Environment-specific configurations
 *
 * V-PROF-02: Create/edit modal with user-defined parameters
 *
 * Tests for ProfileFormModal component per wireframe design decisions:
 * - PROFILE-28: Compact metadata: Name + Description side-by-side, Tags inline
 * - PROFILE-29: Width ~460px (expanded for table)
 * - PROFILE-30: Title "Create/Edit Profile" + ×
 * - PROFILE-31: "Environment:" + scrollable dropdown
 * - PROFILE-32: "Copy Values" button
 * - PROFILE-33: "PARAMETERS" label
 * - PROFILE-34: "+ Add" blue, right-aligned
 * - PROFILE-35: Columns: Name | Type | 🔒 | Value | Actions
 * - PROFILE-36 to PROFILE-42: Parameter table behavior
 * - PROFILE-51: Create: Cancel + Create
 * - PROFILE-52: Edit: "Delete Profile" (red, left) + Cancel + Save Changes
 * - PROFILE-53: Delete blocked when Usage > 0
 * - FIELDERR-1, FIELDERR-3: a wrong value and a left-blank Name carry their message on the field
 *
 * Component: frontend/src/components/profiles/profile-form-modal.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ProfileFormModal,
  type ProfileFormModalProps,
  type Profile,
  type Parameter,
  type Environment,
  type ProfileTypeSchemaField,
} from '@/features/profiles/components/profile-form-modal'
import { ToastProvider, ToastContainer } from '@/components/ui/toast'
import { expectNoRequiredMark, expectRequiredMark } from '../../../utils/required-mark'

// ============================================================================
// Mock Data
// ============================================================================

const mockEnvironments: Environment[] = [
  { id: 'env-1', name: 'Production', tags: ['production', 'critical'] },
  { id: 'env-2', name: 'Staging', tags: ['staging', 'test'] },
  { id: 'env-3', name: 'Development', tags: ['development'] },
]

const mockParameters: Parameter[] = [
  { id: 'param-1', name: 'host', type: 'string', secret: false, values: { 'env-1': 'prod-db.example.com', 'env-2': 'staging-db.example.com', 'env-3': 'localhost' } },
  { id: 'param-2', name: 'port', type: 'integer', secret: false, values: { 'env-1': '5432', 'env-2': '5432', 'env-3': '5432' } },
  { id: 'param-3', name: 'password', type: 'string', secret: true, values: { 'env-1': '********', 'env-2': '********', 'env-3': '********' } },
]

const mockProfile: Profile = {
  id: 'profile-1',
  name: 'Production Database',
  type: 'database',
  description: 'Production PostgreSQL connection',
  tags: ['production', 'backend'],
  usage: 5,
  parameters: mockParameters,
  createdAt: '2025-01-10T10:00:00Z',
  updatedAt: '2025-01-15T14:30:00Z',
}

const mockProfileNoUsage: Profile = {
  ...mockProfile,
  id: 'profile-2',
  name: 'Development HTTP',
  usage: 0,
}

const mockAllTags = ['production', 'staging', 'database', 'http', 'ssh']
const mockProfileTypes = ['database', 'ssh', 'http', 'kubernetes', 'opensearch', 'custom']

// Served type schemas: `default` carries a field's declared starting value, absent when it declares none.
const kubernetesSchemaFields: ProfileTypeSchemaField[] = [
  { name: 'api_url', type: 'string', required: false, secret: false },
  { name: 'token', type: 'string', required: false, secret: true },
  { name: 'client_cert', type: 'string', required: false, secret: false },
  { name: 'client_key', type: 'string', required: false, secret: true },
  { name: 'ca_cert', type: 'string', required: false, secret: false },
  { name: 'verify_ssl', type: 'boolean', required: false, secret: false, default: true },
  { name: 'tls_server_name', type: 'string', required: false, secret: false },
  { name: 'namespace', type: 'string', required: false, secret: false, default: 'default' },
]

const sshSchemaFields: ProfileTypeSchemaField[] = [
  { name: 'host', type: 'string', required: true, secret: false },
  { name: 'port', type: 'integer', required: false, secret: false, default: 22 },
  { name: 'username', type: 'string', required: true, secret: false },
  { name: 'password', type: 'string', required: false, secret: true },
  { name: 'private_key', type: 'string', required: false, secret: true },
  { name: 'passphrase', type: 'string', required: false, secret: true },
  { name: 'connect_timeout', type: 'integer', required: false, secret: false, default: 30 },
]

const httpSchemaFields: ProfileTypeSchemaField[] = [
  { name: 'base_url', type: 'string', required: true, secret: false },
  { name: 'headers', type: 'map', required: false, secret: false },
  { name: 'auth_username', type: 'string', required: false, secret: false },
  { name: 'auth_password', type: 'string', required: false, secret: true },
  { name: 'auth_token', type: 'string', required: false, secret: true },
  { name: 'auth_key', type: 'string', required: false, secret: true },
  { name: 'auth_header_name', type: 'string', required: false, secret: false, default: 'X-API-Key' },
  { name: 'verify_ssl', type: 'boolean', required: false, secret: false, default: true },
  { name: 'ca_cert', type: 'string', required: false, secret: false },
  { name: 'client_cert', type: 'string', required: false, secret: false },
  { name: 'client_key', type: 'string', required: false, secret: true },
  { name: 'timeout', type: 'integer', required: false, secret: false, default: 30 },
]

// The database profile schema: the port declares the bounds the block's Port row has.
const databaseSchemaFields: ProfileTypeSchemaField[] = [
  { name: 'host', type: 'string', required: false, secret: false },
  { name: 'port', type: 'integer', required: false, secret: false, minimum: 1, maximum: 65535 },
  { name: 'database', type: 'string', required: false, secret: false },
  { name: 'username', type: 'string', required: false, secret: false },
  { name: 'password', type: 'string', required: false, secret: true },
  { name: 'verify_ssl', type: 'boolean', required: false, secret: false, default: true },
  { name: 'ca_cert', type: 'string', required: false, secret: false },
  { name: 'client_cert', type: 'string', required: false, secret: false },
  { name: 'client_key', type: 'string', required: false, secret: true },
  { name: 'driver_options', type: 'map', required: false, secret: false },
]

// ============================================================================
// Test Utilities
// ============================================================================

function parameterRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('tr[data-parameter-id]'))
}

function rowName(row: HTMLElement): string {
  return (within(row).getByRole('textbox', { name: 'Parameter name' }) as HTMLTextAreaElement).value
}

function parameterNames(): string[] {
  return parameterRows().map(rowName)
}

function rowFor(name: string): HTMLElement {
  const row = parameterRows().find((candidate) => rowName(candidate) === name)
  if (!row) {
    throw new Error(`No parameter row named "${name}" (found: ${parameterNames().join(', ')})`)
  }
  return row
}

/** Label on a row's Edit-preview button (string / map / array / table values). */
function previewText(name: string): string {
  const row = rowFor(name)
  const preview = row.querySelector('[data-testid^="param-edit-value-"]')
  if (!preview) {
    throw new Error(`Parameter row "${name}" renders no Edit-preview button`)
  }
  return preview.textContent ?? ''
}

function scalarInput(name: string): HTMLElement {
  return within(rowFor(name)).getByTestId('scalar-edit-input')
}

async function selectEnvironment(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByTestId('env-selector'))
  const listbox = await screen.findByRole('listbox')
  await user.click(within(listbox).getByText(name))
}

async function openCreateModalWithType(type: string, fields: ProfileTypeSchemaField[]) {
  const user = userEvent.setup()
  const onFetchTypeSchema = vi.fn().mockResolvedValue(fields)
  renderProfileFormModal({ mode: 'create', onFetchTypeSchema })

  await user.click(screen.getByTestId('type-selector'))
  const listbox = await screen.findByRole('listbox')
  await user.click(within(listbox).getByText(type))

  await vi.waitFor(() => {
    expect(parameterRows()).toHaveLength(fields.length)
  })
  return { user, onFetchTypeSchema }
}

function renderProfileFormModal(props: Partial<ProfileFormModalProps> = {}) {
  const defaultProps: ProfileFormModalProps = {
    open: true,
    mode: 'create',
    profileTypes: mockProfileTypes,
    environments: mockEnvironments,
    allTags: mockAllTags,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    onDelete: vi.fn(),
    ...props,
  }

  return {
    ...render(
      <ToastProvider>
        <ProfileFormModal {...defaultProps} />
        <ToastContainer />
      </ToastProvider>
    ),
    props: defaultProps,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('ProfileFormModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Modal Structure (PROFILE-28 to PROFILE-30)', () => {
    it('renders nothing when closed', () => {
      renderProfileFormModal({ open: false })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('renders dialog when open', () => {
      renderProfileFormModal({ open: true })
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('shows "Create Profile" title in create mode', () => {
      renderProfileFormModal({ mode: 'create' })
      expect(screen.getByText('Create Profile')).toBeInTheDocument()
    })

    it('shows "Edit Profile" title in edit mode', () => {
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })
      expect(screen.getByText('Edit Profile')).toBeInTheDocument()
    })

    it('renders close button', () => {
      renderProfileFormModal()
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
    })

    it('calls onClose when close button clicked', async () => {
      const user = userEvent.setup()
      const { props } = renderProfileFormModal()

      await user.click(screen.getByRole('button', { name: /close/i }))
      expect(props.onClose).toHaveBeenCalled()
    })
  })

  describe('Metadata Section - Name/Description Side-by-Side (PROFILE-28)', () => {
    it('renders Name field with label', () => {
      renderProfileFormModal()
      expect(screen.getByRole('textbox', { name: /^name/i })).toBeInTheDocument()
    })

    it('renders Description field with label', () => {
      renderProfileFormModal()
      expect(screen.getByRole('textbox', { name: /description/i })).toBeInTheDocument()
    })

    it('renders Name and Description in grid layout (side-by-side)', () => {
      renderProfileFormModal()
      const nameField = screen.getByTestId('dialog-overlay').parentElement?.querySelector('[data-field="name"]')
      const descField = screen.getByTestId('dialog-overlay').parentElement?.querySelector('[data-field="description"]')
      expect(nameField).toBeInTheDocument()
      expect(descField).toBeInTheDocument()
      // They should be siblings in a grid
      expect(nameField?.parentElement).toBe(descField?.parentElement)
    })

    it('shows required indicator on Name field', () => {
      renderProfileFormModal()
      const form = screen.getByRole('dialog')
      const nameLabel = within(form).getByText('Name', { exact: false, selector: 'label' })
      expect(nameLabel.textContent).toContain('*')
    })

    it('marks the Type label with the shared RequiredMark in create mode', () => {
      renderProfileFormModal({ mode: 'create' })
      const typeLabel = within(screen.getByRole('dialog')).getByText('Type', { selector: 'label' })
      expectRequiredMark(typeLabel)
    })

    it('leaves the Type label unmarked in edit mode, where the type is locked', () => {
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })
      const typeLabel = within(screen.getByRole('dialog')).getByText('Type', { selector: 'label' })
      expectNoRequiredMark(typeLabel)
    })

    it('pre-fills Name in edit mode', () => {
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })
      expect(screen.getByRole('textbox', { name: /^name/i })).toHaveValue('Production Database')
    })

    it('pre-fills Description in edit mode', () => {
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })
      expect(screen.getByRole('textbox', { name: /description/i })).toHaveValue('Production PostgreSQL connection')
    })
  })

  describe('Tags Input', () => {
    it('renders Tags input section', () => {
      renderProfileFormModal()
      expect(screen.getByText('Tags')).toBeInTheDocument()
    })

    it('shows existing tags in edit mode', () => {
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })
      // Tags should be visible as badges
      expect(screen.getByText('production')).toBeInTheDocument()
      expect(screen.getByText('backend')).toBeInTheDocument()
    })
  })

  describe('Environment Selector (PROFILE-31)', () => {
    it('renders Environment label', () => {
      renderProfileFormModal()
      expect(screen.getByText(/environment:/i)).toBeInTheDocument()
    })

    it('renders environment dropdown with first environment selected', () => {
      renderProfileFormModal()
      const envSelector = screen.getByTestId('env-selector')
      expect(envSelector.textContent).toContain('Production')
    })

    it('opens dropdown on click', () => {
      renderProfileFormModal()

      fireEvent.click(screen.getByTestId('env-selector'))
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    it('shows all environments in dropdown', () => {
      renderProfileFormModal()

      fireEvent.click(screen.getByTestId('env-selector'))
      const listbox = screen.getByRole('listbox')

      expect(within(listbox).getByText('Production')).toBeInTheDocument()
      expect(within(listbox).getByText('Staging')).toBeInTheDocument()
      expect(within(listbox).getByText('Development')).toBeInTheDocument()
    })

    it('selects environment on click', () => {
      renderProfileFormModal()

      fireEvent.click(screen.getByTestId('env-selector'))
      fireEvent.click(within(screen.getByRole('listbox')).getByText('Staging'))

      expect(screen.getByTestId('env-selector').textContent).toContain('Staging')
    })
  })

  describe('Copy Values Button (PROFILE-32)', () => {
    it('renders Copy Values button', () => {
      renderProfileFormModal()
      expect(screen.getByRole('button', { name: /copy values/i })).toBeInTheDocument()
    })

    it('opens Copy Values modal when clicked', async () => {
      const user = userEvent.setup()
      renderProfileFormModal()

      await user.click(screen.getByRole('button', { name: /copy values/i }))
      // Should show the Copy Values modal with title and search
      expect(screen.getByText('Copy Values From')).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/search environments/i)).toBeInTheDocument()
    })

    it('is disabled when only one environment available', () => {
      renderProfileFormModal({ environments: [{ id: 'env-1', name: 'Production', tags: [] }] })
      expect(screen.getByRole('button', { name: /copy values/i })).toBeDisabled()
    })

    it('copies values from selected source environment', async () => {
      const user = userEvent.setup()
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })

      // Wait for form to initialize with profile data (parameters loaded)
      await vi.waitFor(() => {
        expect(screen.getByDisplayValue('host')).toBeInTheDocument()
      })

      // Open copy modal
      await user.click(screen.getByRole('button', { name: /copy values/i }))

      // Wait for modal to open
      expect(await screen.findByText('Copy Values From')).toBeInTheDocument()

      // Should see "Other" section since Production (current) has no tag overlap with Staging/Development
      expect(screen.getByText('Other')).toBeInTheDocument()

      // Find and click Staging in the list
      const stagingButton = screen.getByRole('button', { name: /staging/i })
      await user.click(stagingButton)

      // Click Apply
      await user.click(screen.getByRole('button', { name: /apply/i }))

      // Modal should close
      await vi.waitFor(() => {
        expect(screen.queryByText('Copy Values From')).not.toBeInTheDocument()
      })
    })
  })

  describe('Copy Values - Tag-Based Search (PROFILE-44)', () => {
    async function openCopyValuesWithSearch() {
      const user = userEvent.setup()
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })

      // Wait for form to initialize with profile data
      await vi.waitFor(() => {
        expect(screen.getByDisplayValue('host')).toBeInTheDocument()
      })

      // Open copy values modal
      await user.click(screen.getByRole('button', { name: /copy values/i }))
      expect(await screen.findByText('Copy Values From')).toBeInTheDocument()

      const searchInput = screen.getByPlaceholderText(/search environments/i)
      return { user, searchInput }
    }

    it('filters environments by tag when search matches tag but not name', async () => {
      const { user, searchInput } = await openCopyValuesWithSearch()

      // "test" matches Staging's tag 'test' but does NOT appear in the name "Staging"
      await user.type(searchInput, 'test')

      // Staging should be visible (matched via tag 'test')
      expect(screen.getByRole('button', { name: /staging/i })).toBeInTheDocument()
      // Development should NOT be visible (no name or tag contains "test")
      expect(screen.queryByRole('button', { name: /development/i })).not.toBeInTheDocument()
    })

    it('filters environments by partial tag match', async () => {
      const { user, searchInput } = await openCopyValuesWithSearch()

      // "tes" partially matches Staging's tag 'test' but NOT name "Staging"
      await user.type(searchInput, 'tes')

      expect(screen.getByRole('button', { name: /staging/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /development/i })).not.toBeInTheDocument()
    })

    it('tag search is case-insensitive', async () => {
      const { user, searchInput } = await openCopyValuesWithSearch()

      // "TEST" uppercase should still match Staging's tag 'test'
      await user.type(searchInput, 'TEST')

      expect(screen.getByRole('button', { name: /staging/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /development/i })).not.toBeInTheDocument()
    })

    it('shows empty state when search matches neither name nor tags', async () => {
      const { user, searchInput } = await openCopyValuesWithSearch()

      await user.type(searchInput, 'zzznomatch')

      expect(screen.queryByRole('button', { name: /staging/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /development/i })).not.toBeInTheDocument()
      expect(screen.getByText('No environments match your search')).toBeInTheDocument()
    })

    it('preserves name-based search behavior', async () => {
      const { user, searchInput } = await openCopyValuesWithSearch()

      // "Dev" matches Development by name
      await user.type(searchInput, 'Dev')

      expect(screen.getByRole('button', { name: /development/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /staging/i })).not.toBeInTheDocument()
    })

    it('shows all source environments when search is cleared', async () => {
      const { user, searchInput } = await openCopyValuesWithSearch()

      // Filter to show only tag-matched env
      await user.type(searchInput, 'test')
      expect(screen.queryByRole('button', { name: /development/i })).not.toBeInTheDocument()

      // Clear search
      await user.clear(searchInput)

      // Both source environments should be visible again
      expect(screen.getByRole('button', { name: /staging/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /development/i })).toBeInTheDocument()
    })
  })

  describe('Parameters Section (PROFILE-33 to PROFILE-42)', () => {
    it('renders PARAMETERS header', () => {
      renderProfileFormModal()
      // The section header should be "Parameters" (uppercase), not the table column "Name"
      expect(screen.getByText('Parameters')).toBeInTheDocument()
    })

    it('renders + Add button', () => {
      renderProfileFormModal()
      expect(screen.getByTestId('add-parameter-btn')).toBeInTheDocument()
    })

    it('renders table with column headers', () => {
      renderProfileFormModal()
      const table = screen.getByRole('table')
      expect(table).toBeInTheDocument()

      expect(within(table).getByText('Name')).toBeInTheDocument()
      expect(within(table).getByText('Type')).toBeInTheDocument()
      expect(within(table).getByText('Value')).toBeInTheDocument()
    })

    it('shows lock icon in header for secret column', () => {
      renderProfileFormModal()
      // Lock icon should be in the table header
      const table = screen.getByRole('table')
      const header = table.querySelector('thead')
      expect(header?.querySelector('[data-lucide="lock"]') || header?.querySelector('.lucide-lock')).toBeTruthy()
    })

    it('shows empty state message when no parameters', () => {
      renderProfileFormModal({ mode: 'create' })
      expect(screen.getByText(/no parameters yet/i)).toBeInTheDocument()
    })

    it('adds new parameter when + Add clicked', async () => {
      const user = userEvent.setup()
      renderProfileFormModal({ mode: 'create' })

      await user.click(screen.getByTestId('add-parameter-btn'))

      // Should now have a parameter row with inputs
      expect(screen.queryByText(/no parameters yet/i)).not.toBeInTheDocument()
      expect(screen.getByLabelText(/parameter name/i)).toBeInTheDocument()
    })

    it('shows existing parameters in edit mode', () => {
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })

      expect(screen.getByDisplayValue('host')).toBeInTheDocument()
      expect(screen.getByDisplayValue('5432')).toBeInTheDocument()
    })

    it('shows secret parameter with masked value and edit button', () => {
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })

      // Secret value renders the uniform masked affordance (a button with dots,
      // no password input); clicking it runs the clear-and-edit confirm.
      const masked = screen.getByLabelText(/edit protected value/i)
      expect(masked).toBeInTheDocument()
      expect(masked).toHaveTextContent('•')
      expect(screen.queryByLabelText(/protected string value/i)).not.toBeInTheDocument()
    })

    it('shows edit button for secret parameters', () => {
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })

      // Should have edit button for protected value
      const editButton = screen.getByLabelText(/edit protected value/i)
      expect(editButton).toBeInTheDocument()
    })

    it('shows confirmation when editing secret value', async () => {
      const user = userEvent.setup()
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })

      const editButton = screen.getByLabelText(/edit protected value/i)
      await user.click(editButton)

      // Should show confirmation dialog
      expect(screen.getByText(/edit protected value\?/i)).toBeInTheDocument()
      expect(screen.getByText(/permanently delete/i)).toBeInTheDocument()
    })

    it('deletes parameter when delete button clicked', async () => {
      const user = userEvent.setup()
      // Profile must not be in use - structure is locked when usage > 0.
      const customProfile = { ...mockProfileNoUsage, type: 'custom' }
      renderProfileFormModal({ mode: 'edit', profile: customProfile })

      const deleteButtons = screen.getAllByLabelText(/delete parameter/i)
      expect(deleteButtons.length).toBe(3) // 3 parameters

      await user.click(deleteButtons[0])
      expect(screen.getAllByLabelText(/delete parameter/i).length).toBe(2)
    })

    it('updates parameter name when changed', async () => {
      const user = userEvent.setup()
      const customProfile = { ...mockProfileNoUsage, type: 'custom' }
      renderProfileFormModal({ mode: 'edit', profile: customProfile })

      const nameInput = screen.getByDisplayValue('host')
      await user.clear(nameInput)
      await user.type(nameInput, 'hostname')

      expect(screen.getByDisplayValue('hostname')).toBeInTheDocument()
    })

    it('updates parameter type when changed', async () => {
      const user = userEvent.setup()
      const customProfile = { ...mockProfileNoUsage, type: 'custom' }
      renderProfileFormModal({ mode: 'edit', profile: customProfile })

      const typeSelects = screen.getAllByLabelText(/parameter type/i)
      await user.selectOptions(typeSelects[0], 'integer')

      expect(typeSelects[0]).toHaveValue('integer')
    })

    it('shows convert to custom confirmation when modifying non-custom profile parameters', async () => {
      const user = userEvent.setup()
      // Non-custom AND not in use - the convert-to-custom flow only fires
      // when structure isn't locked.
      renderProfileFormModal({ mode: 'edit', profile: mockProfileNoUsage })

      // Try to delete a parameter - this should trigger the conversion dialog
      const deleteButtons = screen.getAllByLabelText(/delete parameter/i)
      await user.click(deleteButtons[0])

      // Should show confirmation dialog
      expect(screen.getByText(/Convert to Custom Type/i)).toBeInTheDocument()
      expect(screen.getByText(/will no longer match the predefined schema/i)).toBeInTheDocument()

      // Confirm conversion
      await user.click(screen.getByRole('button', { name: /Convert to Custom/i }))

      // Parameter should now be deleted
      expect(screen.getAllByLabelText(/delete parameter/i).length).toBe(2)
    })

    it('locks parameter structure when profile is in use', () => {
      renderProfileFormModal({ mode: 'edit', profile: mockProfile }) // usage: 5

      // Lock notice rendered
      expect(screen.getByTestId('params-locked-notice')).toBeInTheDocument()
      // Plural form when usage > 1
      expect(screen.getByTestId('params-locked-notice')).toHaveTextContent(/5 tests/)

      // Add button visually disabled with aria-disabled
      const addBtn = screen.getByTestId('add-parameter-btn')
      expect(addBtn).toHaveAttribute('aria-disabled')
      expect(addBtn.className).toContain('opacity-50')

      // Delete + name + type controls disabled on each row
      for (const btn of screen.getAllByLabelText(/delete parameter/i)) {
        expect(btn).toBeDisabled()
      }
      for (const sel of screen.getAllByLabelText(/parameter type/i)) {
        expect(sel).toBeDisabled()
      }
      for (const nameInput of screen.getAllByLabelText(/parameter name/i)) {
        expect(nameInput).toBeDisabled()
      }
    })

    it('uses singular "test" in lock notice when usage is 1', () => {
      const profileSingular = { ...mockProfile, usage: 1 }
      renderProfileFormModal({ mode: 'edit', profile: profileSingular })

      expect(screen.getByTestId('params-locked-notice')).toHaveTextContent(/1 test\b/)
      // Tooltip on the disabled add button uses the same singular form
      const addBtn = screen.getByTestId('add-parameter-btn')
      expect(addBtn).toHaveAttribute('aria-disabled')
    })

    it('updates parameter value when changed', async () => {
      const user = userEvent.setup()
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })

      // Integer values edit inline via the shared ScalarEditBody (strings + complex
      // edit via the "Edit value" sheet, covered in the parameter-row tests).
      const valueInput = screen.getByDisplayValue('5432')
      await user.clear(valueInput)
      await user.type(valueInput, '9999')

      expect(screen.getByDisplayValue('9999')).toBeInTheDocument()
    })

    it('toggles secret checkbox', async () => {
      const user = userEvent.setup()
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })

      const secretCheckboxes = screen.getAllByLabelText(/mark as secret/i)
      // First checkbox should be unchecked (host is not secret)
      expect(secretCheckboxes[0]).not.toBeChecked()

      await user.click(secretCheckboxes[0])
      expect(secretCheckboxes[0]).toBeChecked()
    })
  })

  describe('Footer - Create Mode (PROFILE-51)', () => {
    it('shows Cancel and Create buttons in create mode', () => {
      renderProfileFormModal({ mode: 'create' })

      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument()
    })

    it('does not show Delete button in create mode', () => {
      renderProfileFormModal({ mode: 'create' })

      expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
    })

    it('disables Create button when the name is empty', () => {
      renderProfileFormModal({ mode: 'create' })

      expect(screen.getByRole('button', { name: /create/i })).toBeDisabled()
    })

    it('enables Create button once a name is typed, with no type pick', async () => {
      const user = userEvent.setup()
      renderProfileFormModal({ mode: 'create' })

      expect(screen.getByRole('button', { name: /create/i })).toBeDisabled()

      await user.type(screen.getByRole('textbox', { name: /^name/i }), 'My Profile')

      expect(screen.getByRole('button', { name: /create/i })).toBeEnabled()
    })

    it('enables Create button when both name and type are entered', () => {
      renderProfileFormModal({ mode: 'create' })

      // Enter name
      fireEvent.change(screen.getByRole('textbox', { name: /^name/i }), { target: { value: 'My Profile' } })

      // Select type via combobox trigger
      const typeCombobox = screen.getByRole('combobox', { name: /^type/i })
      fireEvent.pointerDown(typeCombobox)
      fireEvent.click(typeCombobox)
      fireEvent.click(within(screen.getByRole('listbox')).getByText('custom'))

      expect(screen.getByRole('button', { name: /create/i })).toBeEnabled()
    })

    it('disables Create when a parameter has an empty name (no silent drop)', () => {
      renderProfileFormModal({ mode: 'create' })

      // Enable Create: profile name + type.
      fireEvent.change(screen.getByRole('textbox', { name: /^name/i }), { target: { value: 'My Profile' } })
      const typeCombobox = screen.getByRole('combobox', { name: /^type/i })
      fireEvent.pointerDown(typeCombobox)
      fireEvent.click(typeCombobox)
      fireEvent.click(within(screen.getByRole('listbox')).getByText('custom'))
      expect(screen.getByRole('button', { name: /create/i })).toBeEnabled()

      // Adding a blank-named parameter must block Save (it would be dropped).
      fireEvent.click(screen.getByTestId('add-parameter-btn'))
      expect(screen.getByRole('button', { name: /create/i })).toBeDisabled()
      expect(screen.getByText('Name is required')).toBeInTheDocument()

      const paramName = screen.getByRole('textbox', { name: 'Parameter name' })
      // A non-empty but invalid name (not a Python identifier) also blocks Save.
      fireEvent.change(paramName, { target: { value: '1bad' } })
      expect(screen.getByRole('button', { name: /create/i })).toBeDisabled()

      // A valid name re-enables Save.
      fireEvent.change(paramName, { target: { value: 'host' } })
      expect(screen.getByRole('button', { name: /create/i })).toBeEnabled()
    })

    it('calls onClose when Cancel clicked', async () => {
      const user = userEvent.setup()
      const { props } = renderProfileFormModal({ mode: 'create' })

      await user.click(screen.getByRole('button', { name: /cancel/i }))
      expect(props.onClose).toHaveBeenCalled()
    })

    it('calls onSubmit with form data when Create clicked', () => {
      const { props } = renderProfileFormModal({ mode: 'create' })

      fireEvent.change(screen.getByRole('textbox', { name: /^name/i }), { target: { value: 'My Profile' } })
      fireEvent.change(screen.getByRole('textbox', { name: /description/i }), { target: { value: 'A test profile' } })

      // Select type (required)
      const typeCombobox = screen.getByRole('combobox', { name: /^type/i })
      fireEvent.pointerDown(typeCombobox)
      fireEvent.click(typeCombobox)
      fireEvent.click(within(screen.getByRole('listbox')).getByText('custom'))

      fireEvent.click(screen.getByRole('button', { name: /create/i }))

      expect(props.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Profile',
          type: 'custom',
          description: 'A test profile',
        })
      )
    })
  })

  describe('Footer - Edit Mode (PROFILE-52, PROFILE-53)', () => {
    it('shows Delete Profile, Cancel, and Save Changes buttons in edit mode', () => {
      renderProfileFormModal({ mode: 'edit', profile: mockProfileNoUsage })

      expect(screen.getByRole('button', { name: /delete profile/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
    })

    it('disables Delete button when usage > 0', () => {
      renderProfileFormModal({ mode: 'edit', profile: mockProfile }) // mockProfile has usage: 5

      const deleteButton = screen.getByRole('button', { name: /delete profile/i })
      expect(deleteButton).toBeDisabled()
    })

    it('enables Delete button when usage = 0', () => {
      renderProfileFormModal({ mode: 'edit', profile: mockProfileNoUsage })

      const deleteButton = screen.getByRole('button', { name: /delete profile/i })
      expect(deleteButton).toBeEnabled()
    })

    it('shows tooltip explaining why Delete is disabled', () => {
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })

      const deleteButton = screen.getByRole('button', { name: /delete profile/i })
      expect(deleteButton).not.toHaveAttribute('title')
      // A disabled button emits no pointer events, so the hint hangs off the
      // wrapper the shared tooltip triggers from.
      fireEvent.focus(deleteButton.parentElement as HTMLElement)
      expect(document.querySelector('[data-slot="tooltip-content"]')?.textContent).toContain(
        'in use',
      )
    })

    it('calls onDelete when Delete button clicked', async () => {
      const user = userEvent.setup()
      const { props } = renderProfileFormModal({ mode: 'edit', profile: mockProfileNoUsage })

      await user.click(screen.getByRole('button', { name: /delete profile/i }))
      expect(props.onDelete).toHaveBeenCalledWith(mockProfileNoUsage.id)
    })

    it('calls onSubmit when Save Changes clicked', async () => {
      const user = userEvent.setup()
      const { props } = renderProfileFormModal({ mode: 'edit', profile: mockProfileNoUsage })
      // Nothing changed anywhere keeps Save disabled.
      fireEvent.change(screen.getByRole('textbox', { name: /description/i }), { target: { value: 'changed' } })

      await user.click(screen.getByRole('button', { name: /save changes/i }))
      expect(props.onSubmit).toHaveBeenCalled()
    })
  })

  describe('Loading State', () => {
    it('disables form inputs when loading', () => {
      renderProfileFormModal({ loading: true })

      expect(screen.getByRole('textbox', { name: /^name/i })).toBeDisabled()
      expect(screen.getByRole('textbox', { name: /description/i })).toBeDisabled()
    })

    it('shows loading spinner on submit button', () => {
      renderProfileFormModal({ loading: true })

      expect(screen.getByTestId('submit-loading')).toBeInTheDocument()
    })

    it('disables + Add button when loading', () => {
      renderProfileFormModal({ loading: true })

      expect(screen.getByTestId('add-parameter-btn')).toBeDisabled()
    })
  })

  describe('Error State', () => {
    it('displays error message when error prop provided', () => {
      renderProfileFormModal({ error: 'Something went wrong' })

      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    })

    it('has data-testid for error container', () => {
      renderProfileFormModal({ error: 'Something went wrong' })

      expect(screen.getByTestId('form-error')).toBeInTheDocument()
    })
  })

  describe('Profile Type Schema Failure', () => {
    async function selectDatabaseType(onFetchTypeSchema: ProfileFormModalProps['onFetchTypeSchema']) {
      const user = userEvent.setup()
      renderProfileFormModal({ mode: 'create', onFetchTypeSchema })
      await user.click(screen.getByTestId('type-selector'))
      await user.click(await screen.findByText('database'))
    }

    it('reports the reason instead of showing the type as having no parameters', async () => {
      await selectDatabaseType(vi.fn().mockRejectedValue(new Error('Service Unavailable')))

      expect(await screen.findByText('Could Not Load Default Parameters')).toBeInTheDocument()
      expect(screen.getByText('Service Unavailable')).toBeInTheDocument()
    })

    it('falls back to a generic reason when the rejection is not an Error', async () => {
      await selectDatabaseType(vi.fn().mockRejectedValue('not an error object'))

      expect(await screen.findByText('Could Not Load Default Parameters')).toBeInTheDocument()
      expect(screen.getByText('Request failed')).toBeInTheDocument()
    })
  })

  describe('Dirty State Detection', () => {
    it('shows unsaved changes indicator when form is dirty in edit mode', async () => {
      const user = userEvent.setup()
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })

      // Initially no indicator
      expect(screen.queryByTestId('unsaved-changes-indicator')).not.toBeInTheDocument()

      // Make a change to the profile name field
      const nameInput = screen.getByRole('textbox', { name: /^name/i })
      await user.clear(nameInput)
      await user.type(nameInput, 'Changed Name')

      expect(screen.getByTestId('unsaved-changes-indicator')).toBeInTheDocument()
    })

    it('does not show unsaved changes indicator in create mode', async () => {
      const user = userEvent.setup()
      renderProfileFormModal({ mode: 'create' })

      const nameInput = screen.getByRole('textbox', { name: /^name/i })
      await user.type(nameInput, 'New Profile')

      expect(screen.queryByTestId('unsaved-changes-indicator')).not.toBeInTheDocument()
    })
  })

  describe('Form Validation', () => {
    it('shows validation error when name is empty on submit', async () => {
      const user = userEvent.setup()
      renderProfileFormModal({ mode: 'edit', profile: mockProfileNoUsage })

      const nameInput = screen.getByRole('textbox', { name: /^name/i })
      await user.clear(nameInput)
      await user.click(screen.getByRole('button', { name: /save changes/i }))

      // The submit should not be called when validation fails
      // and the button should be disabled when name is empty
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
    })
  })

  describe('Declared Starting Values', () => {
    it('seeds a declared starting value in every environment', async () => {
      const { user } = await openCreateModalWithType('kubernetes', kubernetesSchemaFields)

      expect(previewText('namespace')).toContain('"default"')

      await selectEnvironment(user, 'Staging')
      expect(previewText('namespace')).toContain('"default"')

      await selectEnvironment(user, 'Development')
      expect(previewText('namespace')).toContain('"default"')
    })

    it('leaves a field with no declared starting value blank in every environment', async () => {
      const { user } = await openCreateModalWithType('kubernetes', kubernetesSchemaFields)

      expect(previewText('api_url')).toBe('Edit…')

      await selectEnvironment(user, 'Staging')
      expect(previewText('api_url')).toBe('Edit…')
    })

    it('seeds a boolean declared as true onto the true segment', async () => {
      await openCreateModalWithType('kubernetes', kubernetesSchemaFields)

      const row = rowFor('verify_ssl')
      expect(within(row).getByTestId('scalar-edit-bool-true')).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(within(row).getByTestId('scalar-edit-bool-false')).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    })

    it('seeds integer declared values as their digits, in every environment', async () => {
      const { user } = await openCreateModalWithType('ssh', sshSchemaFields)

      expect(scalarInput('port')).toHaveValue('22')
      expect(scalarInput('connect_timeout')).toHaveValue('30')

      await selectEnvironment(user, 'Staging')
      expect(scalarInput('port')).toHaveValue('22')
      expect(scalarInput('connect_timeout')).toHaveValue('30')
    })

    it('seeds the http schema starting values', async () => {
      await openCreateModalWithType('http', httpSchemaFields)

      expect(previewText('auth_header_name')).toContain('"X-API-Key"')
      expect(within(rowFor('verify_ssl')).getByTestId('scalar-edit-bool-true')).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(scalarInput('timeout')).toHaveValue('30')
    })

    it('seeds a map declared as {} as an empty name / value list in every environment', async () => {
      // As the served schema carries it: a map default is a JSON object, not a string.
      const fields = JSON.parse(
        JSON.stringify([
          ...databaseSchemaFields.filter((field) => field.name !== 'driver_options'),
          { name: 'driver_options', type: 'map', required: false, secret: false, default: {} },
        ]),
      ) as ProfileTypeSchemaField[]
      const onSubmit = vi.fn()
      const onFetchTypeSchema = vi.fn().mockResolvedValue(fields)
      const user = userEvent.setup()
      renderProfileFormModal({ mode: 'create', onFetchTypeSchema, onSubmit })
      await user.click(screen.getByTestId('type-selector'))
      await user.click(within(await screen.findByRole('listbox')).getByText('database'))
      await vi.waitFor(() => {
        expect(parameterRows()).toHaveLength(fields.length)
      })
      fireEvent.change(screen.getByRole('textbox', { name: /^name/i }), { target: { value: 'Shop DB' } })

      fireEvent.click(screen.getByRole('button', { name: /create/i }))

      expect(onSubmit).toHaveBeenCalledTimes(1)
      const submitted = (onSubmit.mock.calls[0][0] as { parameters: Parameter[] }).parameters
      const driverOptions = submitted.find((parameter) => parameter.name === 'driver_options')
      expect(driverOptions?.type).toBe('map')
      const seeds = mockEnvironments.map((env) => driverOptions?.values[env.id])
      expect(seeds).toHaveLength(3)
      for (const seed of seeds) {
        expect(seed).not.toBe('[object Object]')
        expect(seed === '' || JSON.stringify(JSON.parse(seed ?? '')) === '{}', `seed ${seed}`).toBe(true)
      }
    })

    it('does not open the Convert to Custom Type dialog while seeding', async () => {
      await openCreateModalWithType('kubernetes', kubernetesSchemaFields)

      expect(screen.queryByText(/convert to custom type/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/will no longer match the predefined schema/i)).not.toBeInTheDocument()
    })
  })

  describe('Kubernetes Profile Form', () => {
    it('renders the eight schema fields as rows in schema order', async () => {
      await openCreateModalWithType('kubernetes', kubernetesSchemaFields)

      expect(parameterNames()).toEqual([
        'api_url',
        'token',
        'client_cert',
        'client_key',
        'ca_cert',
        'verify_ssl',
        'tls_server_name',
        'namespace',
      ])
    })

    it('marks token and client_key secret and nothing else', async () => {
      await openCreateModalWithType('kubernetes', kubernetesSchemaFields)

      const secretByName = Object.fromEntries(
        parameterRows().map((row) => [
          rowName(row),
          (within(row).getByRole('checkbox', { name: 'Mark as secret' }) as HTMLInputElement)
            .checked,
        ]),
      )

      expect(secretByName).toEqual({
        api_url: false,
        token: true,
        client_cert: false,
        client_key: true,
        ca_cert: false,
        verify_ssl: false,
        tls_server_name: false,
        namespace: false,
      })
    })

    it('renders verify_ssl as a Boolean row whose secret checkbox is disabled', async () => {
      await openCreateModalWithType('kubernetes', kubernetesSchemaFields)

      const row = rowFor('verify_ssl')
      expect(within(row).getByRole('combobox', { name: 'Parameter type' })).toHaveValue('boolean')
      expect(within(row).getByRole('checkbox', { name: 'Mark as secret' })).toBeDisabled()
    })

    it('shows default in the namespace row', async () => {
      await openCreateModalWithType('kubernetes', kubernetesSchemaFields)

      expect(previewText('namespace')).toBe('"default"')
    })

    it('keeps + Add as the only control in the PARAMETERS header', async () => {
      await openCreateModalWithType('kubernetes', kubernetesSchemaFields)

      const header = screen.getByText('Parameters').parentElement as HTMLElement
      const controls = within(header).getAllByRole('button')
      expect(controls).toHaveLength(1)
      expect(controls[0]).toHaveAttribute('data-testid', 'add-parameter-btn')
      expect(controls[0]).toHaveTextContent('Add')
    })
  })

  describe('Create Mode Preselects Custom', () => {
    it('opens with type custom and an empty parameter list', () => {
      renderProfileFormModal({ mode: 'create' })

      expect(screen.getByTestId('type-selector')).toHaveTextContent('custom')
      expect(screen.getByText(/no parameters yet/i)).toBeInTheDocument()
      expect(parameterRows()).toHaveLength(0)
    })

    it('submits the preselected type when only a name is typed', () => {
      const { props } = renderProfileFormModal({ mode: 'create' })

      fireEvent.change(screen.getByRole('textbox', { name: /^name/i }), {
        target: { value: 'My Profile' },
      })
      fireEvent.click(screen.getByRole('button', { name: /create/i }))

      expect(props.onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My Profile', type: 'custom' }),
      )
    })

    it('still opens edit mode on the profile own type, locked', () => {
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })

      expect(screen.getByTestId('type-selector')).toHaveTextContent('database')
      expect(screen.getByTestId('type-selector')).toBeDisabled()
    })
  })

  describe('Type Change Data-Loss Warning', () => {
    /** Serves each mocked type its own schema, so a type switch really re-seeds. */
    function openCreateModal() {
      const user = userEvent.setup()
      const onFetchTypeSchema = vi.fn((type: string) => {
        const byType: Record<string, ProfileTypeSchemaField[]> = {
          ssh: sshSchemaFields,
          http: httpSchemaFields,
          kubernetes: kubernetesSchemaFields,
        }
        return Promise.resolve(byType[type] ?? [])
      })
      renderProfileFormModal({ mode: 'create', onFetchTypeSchema })
      return { user, onFetchTypeSchema }
    }

    async function pickType(user: ReturnType<typeof userEvent.setup>, type: string) {
      await user.click(screen.getByTestId('type-selector'))
      const listbox = await screen.findByRole('listbox')
      await user.click(within(listbox).getByText(type))
    }

    async function pickSshAndEditPort(user: ReturnType<typeof userEvent.setup>) {
      await pickType(user, 'ssh')
      await vi.waitFor(() => {
        expect(parameterRows()).toHaveLength(sshSchemaFields.length)
      })
      const port = scalarInput('port')
      await user.clear(port)
      await user.type(port, '2222')
      expect(scalarInput('port')).toHaveValue('2222')
    }

    it('warns before a type change replaces parameters the author filled in', async () => {
      const { user } = openCreateModal()
      await pickSshAndEditPort(user)

      await pickType(user, 'http')

      // The open alert dialog aria-hides the form, so the rows are counted
      // from the DOM here and read back by name in the cancel test below.
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      expect(screen.getByText(/change profile type/i)).toBeInTheDocument()
      expect(screen.getByText(/anything you entered will be lost/i)).toBeInTheDocument()
      expect(screen.getByTestId('type-selector')).toHaveTextContent('ssh')
      expect(parameterRows()).toHaveLength(sshSchemaFields.length)
    })

    it('replaces the parameters when the warning is confirmed', async () => {
      const { user } = openCreateModal()
      await pickSshAndEditPort(user)

      await pickType(user, 'http')
      await user.click(screen.getByRole('button', { name: 'Change type' }))

      await vi.waitFor(() => {
        expect(parameterNames()).toEqual(httpSchemaFields.map((f) => f.name))
      })
      expect(screen.getByTestId('type-selector')).toHaveTextContent('http')
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('keeps the type and the entered values when the warning is canceled', async () => {
      const { user } = openCreateModal()
      await pickSshAndEditPort(user)

      await pickType(user, 'http')
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      await vi.waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      })
      expect(screen.getByTestId('type-selector')).toHaveTextContent('ssh')
      expect(parameterNames()).toEqual(sshSchemaFields.map((f) => f.name))
      expect(scalarInput('port')).toHaveValue('2222')
    })

    it('does not warn when the seeded rows were never touched', async () => {
      const { user } = openCreateModal()
      await pickType(user, 'kubernetes')
      await vi.waitFor(() => {
        expect(parameterRows()).toHaveLength(kubernetesSchemaFields.length)
      })

      await pickType(user, 'http')

      await vi.waitFor(() => {
        expect(parameterNames()).toEqual(httpSchemaFields.map((f) => f.name))
      })
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('does not warn when switching to custom, which keeps the rows', async () => {
      const { user } = openCreateModal()
      await pickSshAndEditPort(user)

      await pickType(user, 'custom')

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(screen.getByTestId('type-selector')).toHaveTextContent('custom')
      expect(parameterNames()).toEqual(sshSchemaFields.map((f) => f.name))
      expect(scalarInput('port')).toHaveValue('2222')
    })

    it('warns when a hand-built row carries a value', async () => {
      const { user } = openCreateModal()
      await user.click(screen.getByTestId('add-parameter-btn'))

      const nameInput = screen.getByRole('textbox', { name: 'Parameter name' })
      await user.type(nameInput, 'my_field')
      await user.selectOptions(screen.getByRole('combobox', { name: 'Parameter type' }), 'integer')
      await user.type(scalarInput('my_field'), '5')

      await pickType(user, 'kubernetes')

      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      expect(parameterRows()).toHaveLength(1)
    })

    it('does not warn when a hand-added row is still empty', async () => {
      const { user } = openCreateModal()
      await user.click(screen.getByTestId('add-parameter-btn'))
      expect(parameterRows()).toHaveLength(1)

      await pickType(user, 'kubernetes')

      await vi.waitFor(() => {
        expect(parameterNames()).toEqual(kubernetesSchemaFields.map((f) => f.name))
      })
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })


  describe('Floating value editor', () => {
    it('opens the Edit value sheet inside the dialog, so the dialog still contains its focus', () => {
      renderProfileFormModal({ mode: 'edit', profile: mockProfile })

      fireEvent.click(within(rowFor('host')).getByTestId('param-edit-value-param-1'))

      const sheet = screen.getByTestId('value-editor-sheet')
      expect(screen.getByRole('dialog')).toContainElement(sheet)
      expect(rowFor('host')).not.toContainElement(sheet)
    })
  })

  describe('Field errors (FIELDERR-1, FIELDERR-3)', () => {
    const PORT_MESSAGE = 'port must be between 1 and 65535'

    function portErrorId(): string {
      return `param-value-error-${rowFor('port').getAttribute('data-parameter-id')}`
    }

    function typePort(value: string) {
      fireEvent.change(scalarInput('port'), { target: { value } })
    }

    function typeName(value: string) {
      fireEvent.change(screen.getByRole('textbox', { name: /^name/i }), { target: { value } })
    }

    it('shows an out-of-range port under the port field and blocks Create', async () => {
      await openCreateModalWithType('database', databaseSchemaFields)
      typeName('Shop DB')

      typePort('70000')

      const message = within(rowFor('port')).getByTestId(portErrorId())
      expect(message.textContent).toBe(PORT_MESSAGE)
      expect(message).toHaveAttribute('role', 'alert')
      expect(scalarInput('port')).toHaveAttribute('aria-invalid', 'true')
      expect(scalarInput('port')).toHaveAccessibleDescription(PORT_MESSAGE)
      expect(screen.getByRole('button', { name: /create/i })).toBeDisabled()
      expect(screen.getByTestId('save-blocked-note').textContent).toBe(
        'Create is disabled: the settings have errors',
      )
    })

    it('lifts the message and the block once the port is back inside the range', async () => {
      await openCreateModalWithType('database', databaseSchemaFields)
      typeName('Shop DB')
      typePort('70000')

      typePort('5432')

      expect(within(rowFor('port')).queryByTestId(portErrorId())).not.toBeInTheDocument()
      expect(screen.queryByTestId('save-blocked-note')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /create/i })).toBeEnabled()
    })

    it('shows a stored out-of-range port on opening an edit and blocks Save', async () => {
      const onFetchTypeSchema = vi.fn().mockResolvedValue(databaseSchemaFields)
      const profile: Profile = {
        ...mockProfileNoUsage,
        type: 'database',
        parameters: [
          { ...mockParameters[0] },
          { ...mockParameters[1], values: { 'env-1': '70000', 'env-2': '5432', 'env-3': '5432' } },
        ],
      }
      renderProfileFormModal({ mode: 'edit', profile, onFetchTypeSchema })

      const message = await within(rowFor('port')).findByTestId('param-value-error-param-2')
      expect(message.textContent).toBe(PORT_MESSAGE)
      expect(onFetchTypeSchema).toHaveBeenCalledWith('database')
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
      expect(screen.getByTestId('save-blocked-note').textContent).toBe(
        'Save is disabled: the settings have errors',
      )
      expect(screen.queryByTestId('unsaved-changes-indicator')).not.toBeInTheDocument()
    })

    it('gives the port value box the height of the Edit boxes beside it', async () => {
      await openCreateModalWithType('database', databaseSchemaFields)

      const port = scalarInput('port')
      const host = within(rowFor('host')).getByTestId(/^param-edit-value-/)
      expect(port).toHaveClass('h-8')
      expect(port).not.toHaveClass('py-2')
      expect(host).toHaveClass('h-8')
    })

    it('shows Name is required once a blank Name is left', async () => {
      const user = userEvent.setup()
      renderProfileFormModal({ mode: 'create' })
      const nameInput = screen.getByRole('textbox', { name: /^name/i })
      expect(screen.queryByText('Name is required')).not.toBeInTheDocument()

      await user.click(nameInput)
      await user.tab()

      expect(screen.getByText('Name is required')).toHaveAttribute('role', 'alert')
      expect(nameInput).toHaveAttribute('aria-invalid', 'true')
      expect(nameInput).toHaveAccessibleDescription('Name is required')
    })

    it('flags no schema field as required: a blank host shows no message', async () => {
      await openCreateModalWithType('ssh', sshSchemaFields)
      typeName('Bastion')

      expect(within(rowFor('host')).queryByRole('alert')).not.toBeInTheDocument()
      expect(document.querySelector('[data-testid^="param-value-error-"]')).toBeNull()
      expect(screen.queryByTestId('save-blocked-note')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /create/i })).toBeEnabled()
    })
  })

  describe('The Name the modal focuses on open (FIELDERR-3)', () => {
    const nameInput = () => screen.getByRole('textbox', { name: /^name/i })

    async function openFocused() {
      const user = userEvent.setup()
      renderProfileFormModal({
        mode: 'create',
        onFetchTypeSchema: vi.fn().mockResolvedValue(databaseSchemaFields),
      })
      await vi.waitFor(() => {
        expect(nameInput()).toHaveFocus()
      })
      return { user }
    }

    async function pickType(user: ReturnType<typeof userEvent.setup>, type: string) {
      await user.click(screen.getByTestId('type-selector'))
      const listbox = await screen.findByRole('listbox')
      await user.click(within(listbox).getByText(type))
    }

    it('shows no Name message when the Type is picked right after the modal opens', async () => {
      const { user } = await openFocused()

      await pickType(user, 'database')

      await vi.waitFor(() => {
        expect(parameterRows()).toHaveLength(databaseSchemaFields.length)
      })
      expect(nameInput()).not.toHaveFocus()
      expect(screen.queryByText('Name is required')).not.toBeInTheDocument()
      expect(nameInput()).not.toHaveAttribute('aria-invalid')
    })

    it('shows no Name message when the focus given on open is tabbed away', async () => {
      const { user } = await openFocused()

      await user.tab()

      expect(screen.queryByText('Name is required')).not.toBeInTheDocument()
    })

    it('shows the message once the author comes back to Name and leaves it blank', async () => {
      const { user } = await openFocused()
      await user.tab()

      await user.tab({ shift: true })
      expect(nameInput()).toHaveFocus()
      await user.tab()

      expect(screen.getByText('Name is required')).toHaveAttribute('role', 'alert')
    })

    it('shows the message once the author clicks the focused Name and leaves it blank', async () => {
      const { user } = await openFocused()

      await user.click(nameInput())
      await pickType(user, 'database')

      expect(await screen.findByText('Name is required')).toHaveAttribute('role', 'alert')
    })

    it('shows the message once the author types in the focused Name, clears it and leaves', async () => {
      const { user } = await openFocused()

      await user.keyboard('S')
      await user.keyboard('{Backspace}')
      await user.tab()

      expect(screen.getByText('Name is required')).toHaveAttribute('role', 'alert')
    })

    it('shows the message on a Create attempt with a Name never visited', async () => {
      await openFocused()

      fireEvent.submit(nameInput().closest('form') as HTMLFormElement)

      expect(screen.getByText('Name is required')).toHaveAttribute('role', 'alert')
    })

    it('counts a Name the author focused before the modal could', async () => {
      const user = userEvent.setup()
      renderProfileFormModal({ mode: 'create' })

      nameInput().focus()
      await vi.waitFor(() => {
        expect(nameInput()).toHaveFocus()
      })
      await user.tab()

      expect(screen.getByText('Name is required')).toHaveAttribute('role', 'alert')
    })
  })

  describe('Accessibility', () => {
    it('has aria-labelledby on dialog', () => {
      renderProfileFormModal()

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-labelledby')
    })

    it('has aria-busy when loading', () => {
      renderProfileFormModal({ loading: true })

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveAttribute('aria-busy', 'true')
    })

    it('has aria-required on name field', () => {
      renderProfileFormModal()

      expect(screen.getByRole('textbox', { name: /^name/i })).toHaveAttribute('aria-required', 'true')
    })
  })
})
