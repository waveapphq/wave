/**
 * Tests for the element-config parameter value inputs: MapInput / ArrayInput / StringInput open the shared
 * "Edit value" sheet (ValueEditorSheet). There is ONE StringInput: it always
 * uses the shared ValueField preview + sheet, so a single-line string param does
 * not edit in a bare inline text box.
 *
 * A list or map row shows its value as one line in the one value field, and the
 * field's expand opens the sheet (FIELD-1, FIELD-10). Behavior preserved on
 * migration: param maps stay string->string (stringValuesOnly), the
 * param's allowedFormats restricts the sheet's Format dropdown, and the
 * templateFields opt-in maps to the sheet's Kind=Template (onSave(value,
 * isTemplate), allowTemplate=true).
 *
 * The sheet is mocked to a stand-in exposing its props + save/save-template/close
 * so this file covers the INPUTS' wiring (which type opens, the threaded
 * restrictions, save routing); the sheet's own behavior lives in its own file.
 *
 * EnumInput carries two opt-in descriptor capabilities: enumGroups partitions
 * the flat enumValues into headed sections, and enumSearchable routes to the picker.
 * A descriptor with neither key renders the plain ungrouped select.
 *
 * A body locked to python, sql, dql or query-dsl is a script body: it alone
 * receives the script editor props (Run, Stop, for SQL the Database type, the
 * Parameters names and the catalog request, for OpenSearch the fields request and
 * the index pattern), and a sql body keeps Template kind although its row takes no
 * expression. A script row in expression mode shows the expression editor in place
 * of the script editor (the SQL row and the OpenSearch Query row).
 *
 * REQ-3.1.3.11: Variable Manager UI panel (one editor behind every value surface)
 * REQ-3.6.2.x: multi-format string editing lives in the sheet
 * REQ-3.4.1.6: SQL database operations (SQL-8, SQL-10, SQL-12, SQL-13)
 * REQ-3.3.2.6: OpenSearch field-based filtering and queries (OS-5, OS-12)
 */

import { useState, type ComponentProps } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  BooleanInput,
  EnumInput,
  MapInput,
  StringInput,
  enumValueOf,
} from '@/features/workbench/common/element-config/parameters/parameter-value-inputs'
import { isSealedMapCredential } from '@/lib/secret-envelope'
import { HELD_DEFAULT_LOOK_CLASS } from '@/lib/variable-format'
import { FreezableFieldset } from '@/components/shared/sheet-layer'
import {
  clampSibling,
  type Parameter,
} from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'
import { SAMPLE_CATALOG_REQUEST, SAMPLE_SCRIPT } from '../../../sql-fixtures'
import { SAMPLE_DQL, SAMPLE_FIELDS_REQUEST } from '../../../opensearch-fixtures'

vi.mock('@/features/workbench/api/opensearch-tools', () => ({
  checkOpenSearch: vi.fn(() => Promise.resolve({ issues: [] })),
  suggestOpenSearch: vi.fn(() => Promise.resolve({ from: 0, to: 0, items: [] })),
  startFields: vi.fn(() => new Promise(() => {})),
  getFields: vi.fn(() => new Promise(() => {})),
  cancelFields: vi.fn(() => Promise.resolve({ status: 'canceled' })),
}))

// The shared "Edit value" sheet stand-in (portaled so it is queryable). Exposes
// its threaded props + a literal-save / template-save / close.
vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', async () => {
  const { createPortal } = await import('react-dom')
  const { use } = await import('react')
  const { SheetFrozenContext } = await import('@/components/shared/sheet-layer')
  return {
    ValueEditorSheet: ({
      type,
      value,
      isTemplate,
      allowTemplate,
      allowedFormats,
      stringValuesOnly,
      mapEntryOptions,
      inputVariables,
      inputVariableTypes,
      exportNames,
      interpreter,
      onRun,
      runBusy,
      runAllowed,
      onRenameSymbol,
      nodeId,
      onStop,
      databaseType,
      parameterNames,
      sqlCatalogRequest,
      openSearchFieldsRequest,
      openSearchIndex,
      elementTypes,
      onSave,
      onClose,
    }: any) =>
      createPortal(
        <div
          data-testid="value-editor-sheet"
          data-sheet-frozen={String(use(SheetFrozenContext))}
          data-type={type}
          data-value={JSON.stringify(value)}
          data-is-template={String(isTemplate)}
          data-allow-template={String(allowTemplate)}
          data-allowed-formats={(allowedFormats ?? []).join(',')}
          data-string-values-only={String(!!stringValuesOnly)}
          data-element-types={JSON.stringify(elementTypes ?? null)}
          data-quick-insert-keys={(mapEntryOptions?.quickInserts ?? [])
            .flatMap((menu: any) => menu.items.map((item: any) => item.key))
            .join(',')}
          data-has-input-variables={String(inputVariables !== undefined)}
          data-input-variables={(inputVariables ?? [])
            .map((variable: any) => `${variable.name}:${variable.type}`)
            .join(',')}
          data-input-variable-types={JSON.stringify(inputVariableTypes ?? null)}
          data-has-export-names={String(exportNames !== undefined)}
          data-export-names={(exportNames ?? []).join(',')}
          data-has-interpreter={String(interpreter !== undefined)}
          data-interpreter={interpreter ?? ''}
          data-has-on-run={String(!!onRun)}
          data-run-busy={String(runBusy)}
          data-run-allowed={String(runAllowed)}
          data-has-on-rename-symbol={String(!!onRenameSymbol)}
          data-node-id={String(nodeId)}
          data-has-on-stop={String(!!onStop)}
          data-database-type={String(databaseType)}
          data-parameter-names={
            parameterNames === undefined ? 'undefined' : JSON.stringify(parameterNames)
          }
          data-sql-catalog-request={
            sqlCatalogRequest === undefined ? 'undefined' : JSON.stringify(sqlCatalogRequest)
          }
          data-open-search-fields-request={
            openSearchFieldsRequest === undefined ? 'undefined' : JSON.stringify(openSearchFieldsRequest)
          }
          data-open-search-index={String(openSearchIndex)}
        >
          <button data-testid="sheet-save" onClick={() => onSave('SAVED', false)}>Save</button>
          <button data-testid="sheet-save-template" onClick={() => onSave('SAVED', true)}>SaveTemplate</button>
          <button
            data-testid="sheet-save-typed"
            onClick={() => onSave({ n: '16', app: 'x' }, false, ['app'], { n: 'integer' })}
          >
            SaveTyped
          </button>
          <button data-testid="sheet-save-list" onClick={() => onSave([502, true, '503', null], false)}>
            SaveList
          </button>
          <button data-testid="sheet-close" onClick={onClose}>Close</button>
          <button data-testid="sheet-run" onClick={() => onRun?.('DRAFT')}>Run</button>
          <button data-testid="sheet-stop" onClick={() => onStop?.()}>Stop</button>
          <button
            data-testid="sheet-rename-symbol"
            onClick={() => onRenameSymbol?.('limit', 'ceiling')}
          >
            Rename
          </button>
        </div>,
        document.body,
      ),
  }
})

/** The two opt-in enum keys on the shared enum control. */
type PickerParameter = Parameter & {
  enumGroups?: { heading: string; values: string[] }[]
  enumSearchable?: boolean
}

function makeParameter(overrides: Partial<PickerParameter> = {}): PickerParameter {
  return {
    name: 'body',
    type: 'string',
    required: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

type RowProps = ComponentProps<typeof ParameterRow>

/** One literal input row of the Block window; `extra` overrides any prop. */
function renderLiteralRow(parameter: Parameter, value: unknown, extra: Partial<RowProps> = {}) {
  const props: RowProps = {
    mode: 'input',
    parameter,
    value,
    onChange: vi.fn(),
    availableVariables: [],
    expressionFields: [],
    onExpressionFieldsChange: vi.fn(),
    templateFields: [],
    onTemplateFieldsChange: vi.fn(),
    onElementTypesChange: vi.fn(),
    ...extra,
  }
  const table = (rowProps: RowProps) => (
    <table>
      <tbody>
        <ParameterRow {...rowProps} />
      </tbody>
    </table>
  )
  const view = render(table(props))
  return {
    ...props,
    row: () => screen.getByTestId(`param-row-${parameter.name}`),
    rerenderRow: (next: Partial<RowProps>) => view.rerender(table({ ...props, ...next })),
  }
}

/** The deepest elements in `container` that show exactly `text`, as text or as a field's value. */
function elementsShowing(container: HTMLElement, text: string): HTMLElement[] {
  const byText = within(container).queryAllByText(
    (_content, element) =>
      element !== null &&
      element.textContent === text &&
      !Array.from(element.children).some((child) => child.textContent === text),
  )
  return [...byText, ...within(container).queryAllByDisplayValue(text)]
}

/** True when the element, or an ancestor up to `boundary`, carries the Text Muted gray. */
function grayUpTo(element: HTMLElement, boundary: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    if (node.classList.contains(HELD_DEFAULT_LOOK_CLASS)) return true
    if (node === boundary) return false
  }
  return false
}

const ENUM_PICKER_MODULE =
  '@/features/workbench/common/element-config/parameters/enum-picker-input'

/** The muted second line on an enum option (K8SREAD-4), same markup on both enum paths. */
const SUBLABEL_SELECTOR = '.text-\\[10px\\].text-muted-foreground'

/** Radix puts the items in a viewport inside the listbox; a <style> tag is its sibling. */
function selectViewport(): HTMLElement {
  return screen.getByRole('listbox').querySelector<HTMLElement>('[data-radix-select-viewport]')!
}

/** Each section's heading, read through aria-labelledby - the treatment Radix's
 *  SelectGroup/SelectLabel and cmdk's CommandGroup both produce. */
function groupHeadings(container: HTMLElement): string[] {
  return within(container)
    .getAllByRole('group')
    .map((group) => document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent ?? '')
}

// ============================================================================
// EnumInput - always offers every option
// ============================================================================

describe('EnumInput - always offers every option', () => {
  const VERSIONS = ['1.0', '1.1', '1.2', '1.3']

  it('renders every enum option (cross-field ordering is handled on change)', async () => {
    const user = userEvent.setup()
    render(
      <EnumInput
        parameter={makeParameter({ name: 'tls_min_version', enumValues: VERSIONS })}
        effectiveValue={undefined}
        onChange={vi.fn()}
        showRequiredError={false}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    expect(screen.getAllByRole('option').map((option) => option.textContent ?? '')).toEqual(VERSIONS)
  })

  it('offers no empty choice and one choice per repeated value', async () => {
    const user = userEvent.setup()
    render(
      <EnumInput
        parameter={makeParameter({ name: 'level', enumValues: ['', 'low', 'high', 'low'] })}
        effectiveValue={undefined}
        onChange={vi.fn()}
        showRequiredError={false}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    expect(screen.getAllByRole('option').map((option) => option.textContent ?? '')).toEqual(['low', 'high'])
  })

  it('names the trigger with the parameter label', () => {
    render(
      <EnumInput
        parameter={makeParameter({ name: 'tls_min_version', label: 'Min TLS Version', enumValues: VERSIONS })}
        effectiveValue="1.2"
        onChange={vi.fn()}
        showRequiredError={false}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'Min TLS Version' })).toBeInTheDocument()
  })

  it('falls back to the parameter name when the schema gives no label', () => {
    render(
      <EnumInput
        parameter={makeParameter({ name: 'tls_min_version', enumValues: VERSIONS })}
        effectiveValue="1.2"
        onChange={vi.fn()}
        showRequiredError={false}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'tls_min_version' })).toBeInTheDocument()
  })
})

// ============================================================================
// EnumInput - grouped plain path (K8SREAD-5)
// ============================================================================

describe('EnumInput - grouped plain path (K8SREAD-5)', () => {
  const KIND_GROUPS = [
    { heading: 'Workloads', values: ['CronJob', 'DaemonSet', 'Deployment', 'Job', 'Pod', 'ReplicaSet', 'StatefulSet'] },
    { heading: 'Networking', values: ['Endpoints', 'Ingress', 'NetworkPolicy', 'Service'] },
    { heading: 'Config', values: ['ConfigMap', 'Secret', 'ServiceAccount'] },
    { heading: 'Storage', values: ['PersistentVolume', 'PersistentVolumeClaim', 'StorageClass'] },
    { heading: 'Cluster', values: ['ClusterRole', 'ClusterRoleBinding', 'Namespace', 'Node', 'Role', 'RoleBinding'] },
  ]
  const KIND_VALUES = KIND_GROUPS.flatMap((group) => group.values)
  const KIND_HEADINGS = KIND_GROUPS.map((group) => group.heading)
  const KIND_SHORT_NAMES: Record<string, string> = {
    CronJob: 'cj', DaemonSet: 'ds', Deployment: 'deploy', Pod: 'po', ReplicaSet: 'rs', StatefulSet: 'sts',
    Endpoints: 'ep', Ingress: 'ing', NetworkPolicy: 'netpol', Service: 'svc',
    ConfigMap: 'cm', ServiceAccount: 'sa',
    PersistentVolume: 'pv', PersistentVolumeClaim: 'pvc', StorageClass: 'sc',
    Namespace: 'ns', Node: 'no',
  }

  function kindParameter(overrides: Partial<PickerParameter> = {}): PickerParameter {
    return makeParameter({
      name: 'kind',
      label: 'Kind',
      enumValues: KIND_VALUES,
      enumGroups: KIND_GROUPS,
      ...overrides,
    })
  }

  async function openKind(parameter: PickerParameter, effectiveValue: unknown = undefined) {
    const user = userEvent.setup()
    const result = render(
      <EnumInput
        parameter={parameter}
        effectiveValue={effectiveValue}
        onChange={vi.fn()}
        showRequiredError={false}
      />,
    )
    await user.click(screen.getByRole('combobox', { name: 'Kind' }))
    return { ...result, listbox: screen.getByRole('listbox') }
  }

  it('renders one headed section per enumGroups entry, headings in declared order', async () => {
    const { listbox } = await openKind(kindParameter())
    expect(within(listbox).getAllByRole('group')).toHaveLength(KIND_GROUPS.length)
    expect(groupHeadings(listbox)).toEqual(KIND_HEADINGS)
  })

  it('puts every value under its own heading, in enumGroups order', async () => {
    const { listbox } = await openKind(kindParameter())
    const perGroup = within(listbox)
      .getAllByRole('group')
      .map((group) => within(group).getAllByRole('option').map((option) => option.textContent ?? ''))
    expect(perGroup).toEqual(KIND_GROUPS.map((group) => group.values))
  })

  it('preserves the flat enumValues order across the whole menu', async () => {
    const { listbox } = await openKind(kindParameter())
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent ?? '')).toEqual(
      KIND_VALUES,
    )
  })

  it('leaves no option outside a section', async () => {
    await openKind(kindParameter())
    expect(Array.from(selectViewport().children).map((child) => child.getAttribute('role'))).toEqual(
      KIND_GROUPS.map(() => 'group'),
    )
  })

  it('keeps the sublabel treatment inside a section (K8SREAD-4)', async () => {
    const { listbox } = await openKind(kindParameter({ enumSublabels: KIND_SHORT_NAMES }))
    const workloads = within(listbox).getAllByRole('group')[0]
    const options = within(workloads).getAllByRole('option')

    const statefulSet = options[KIND_GROUPS[0].values.indexOf('StatefulSet')]
    expect(statefulSet.textContent).toBe('StatefulSetsts')
    expect(statefulSet.querySelector(SUBLABEL_SELECTOR)?.textContent).toBe('sts')

    // Job has no short name: plain label, no empty sublabel node.
    const job = options[KIND_GROUPS[0].values.indexOf('Job')]
    expect(job.textContent).toBe('Job')
    expect(job.querySelector(SUBLABEL_SELECTOR)).toBeNull()
  })

  it('applies enumLabels to options inside a section', async () => {
    const { listbox } = await openKind(kindParameter({ enumLabels: { Pod: 'Pod (po)' } }))
    const workloads = within(listbox).getAllByRole('group')[0]
    expect(within(workloads).getAllByRole('option').map((option) => option.textContent ?? '')).toEqual([
      'CronJob',
      'DaemonSet',
      'Deployment',
      'Job',
      'Pod (po)',
      'ReplicaSet',
      'StatefulSet',
    ])
  })

  it('keeps the trigger contract while grouped', async () => {
    render(
      <EnumInput
        parameter={kindParameter({ enumLabels: { Pod: 'Pod (po)' } })}
        effectiveValue="Pod"
        onChange={vi.fn()}
        showRequiredError={false}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'Kind' })).toHaveTextContent('Pod (po)')
  })

  it('reads as one control with the searchable picker: same heading treatment', async () => {
    const user = userEvent.setup()
    // Variable specifier: an unresolved module fails this test alone, not the whole file.
    const { EnumPickerInput } = (await import(/* @vite-ignore */ ENUM_PICKER_MODULE)) as {
      EnumPickerInput: typeof EnumInput
    }
    const parameter = kindParameter()

    const plain = render(
      <EnumInput
        parameter={parameter}
        effectiveValue={undefined}
        onChange={vi.fn()}
        showRequiredError={false}
      />,
    )
    await user.click(screen.getByRole('combobox', { name: 'Kind' }))
    const plainHeadings = groupHeadings(screen.getByRole('listbox'))
    plain.unmount()

    render(
      <EnumPickerInput
        parameter={parameter}
        effectiveValue={undefined}
        onChange={vi.fn()}
        showRequiredError={false}
      />,
    )
    await user.click(screen.getByTestId('enum-picker-trigger-kind'))
    const pickerHeadings = groupHeadings(screen.getByTestId('enum-picker-list-kind'))

    expect(plainHeadings).toEqual(KIND_HEADINGS)
    expect(pickerHeadings).toEqual(KIND_HEADINGS)
    expect(pickerHeadings).toEqual(plainHeadings)
  })
})

// ============================================================================
// EnumInput - ungrouped output (guard: both descriptor keys are opt-in)
// ============================================================================

describe('EnumInput - ungrouped output unchanged', () => {
  const VERSIONS = ['1.0', '1.1', '1.2', '1.3']

  function renderVersions(
    overrides: Partial<PickerParameter> = {},
    effectiveValue: unknown = undefined,
    showRequiredError = false,
  ) {
    return render(
      <EnumInput
        parameter={makeParameter({
          name: 'tls_min_version',
          label: 'Min TLS Version',
          enumValues: VERSIONS,
          ...overrides,
        })}
        effectiveValue={effectiveValue}
        onChange={vi.fn()}
        showRequiredError={showRequiredError}
      />,
    )
  }

  it('renders no section and no heading anywhere in the menu', async () => {
    const user = userEvent.setup()
    renderVersions()
    await user.click(screen.getByRole('combobox'))

    expect(screen.queryAllByRole('group')).toHaveLength(0)
    // SelectLabel's shipped class: a heading anywhere in the menu trips this.
    expect(screen.getByRole('listbox').querySelectorAll('[role="group"], .font-semibold')).toHaveLength(0)
    expect(Array.from(selectViewport().children).map((child) => child.getAttribute('role'))).toEqual([
      'option',
      'option',
      'option',
      'option',
    ])
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent ?? '')).toEqual(
      VERSIONS,
    )
  })

  it('keeps the exact option markup: role, selection state, focus and collection markers, no testid', async () => {
    const user = userEvent.setup()
    renderVersions({}, '1.2')
    await user.click(screen.getByRole('combobox'))
    const options = within(screen.getByRole('listbox')).getAllByRole('option')

    expect(options.map((option) => option.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '-1'])
    expect(options.map((option) => option.hasAttribute('data-radix-collection-item'))).toEqual([
      true,
      true,
      true,
      true,
    ])
    expect(options.map((option) => option.getAttribute('data-testid'))).toEqual([null, null, null, null])
    expect(options.map((option) => option.getAttribute('data-state'))).toEqual([
      'unchecked',
      'unchecked',
      'checked',
      'unchecked',
    ])
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual([
      'false',
      'false',
      'true',
      'false',
    ])
  })

  it('keeps enumLabels renaming the options', async () => {
    const user = userEvent.setup()
    renderVersions({ enumLabels: { '1.0': 'TLS 1.0 (legacy)' } })
    await user.click(screen.getByRole('combobox'))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent ?? '')).toEqual([
      'TLS 1.0 (legacy)',
      '1.1',
      '1.2',
      '1.3',
    ])
  })

  it('keeps the ungrouped sublabel markup (K8SREAD-4)', async () => {
    const user = userEvent.setup()
    renderVersions({ enumSublabels: { '1.0': 'legacy' } })
    await user.click(screen.getByRole('combobox'))
    const options = within(screen.getByRole('listbox')).getAllByRole('option')

    expect(options[0].textContent).toBe('1.0legacy')
    expect(options[0].querySelector(SUBLABEL_SELECTOR)?.textContent).toBe('legacy')
    expect(options[1].textContent).toBe('1.1')
    expect(options[1].querySelector(SUBLABEL_SELECTOR)).toBeNull()
  })

  it('keeps the trigger placeholder and no outline while the value is unset', () => {
    renderVersions()
    const trigger = screen.getByRole('combobox', { name: 'Min TLS Version' })
    expect(trigger).toHaveTextContent('Select…')
    expect(trigger).not.toHaveClass('border-destructive')
  })

  it('keeps the selected label on the trigger and the required outline', () => {
    renderVersions({ enumLabels: { '1.2': 'TLS 1.2' } }, '1.2', true)
    const outlined = screen.getByRole('combobox', { name: 'Min TLS Version' })
    expect(outlined).toHaveTextContent('TLS 1.2')
    expect(outlined).toHaveClass('border-destructive')
  })
})

// ============================================================================
// BooleanInput - the checkbox carries the row's visible name
// ============================================================================

describe('BooleanInput', () => {
  it('names the checkbox with the label threaded by the row', () => {
    render(<BooleanInput ariaLabel="Get SA Token" effectiveValue onChange={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: 'Get SA Token' })).toBeChecked()
  })

  it('disables the checkbox when locked', () => {
    render(
      <BooleanInput ariaLabel="Get SA Token" effectiveValue={false} onChange={vi.fn()} locked />,
    )
    expect(screen.getByRole('checkbox', { name: 'Get SA Token' })).toBeDisabled()
  })
})

// ============================================================================
// clampSibling - TLS version bounds clamp each other on change
// ============================================================================

describe('clampSibling', () => {
  const VERSIONS = ['1.0', '1.1', '1.2', '1.3']
  const minParam = makeParameter({
    name: 'tls_min_version',
    enumValues: VERSIONS,
    defaultValue: '1.2',
    clampsSibling: { field: 'tls_max_version', keep: 'atLeast' },
  })
  const maxParam = makeParameter({
    name: 'tls_max_version',
    enumValues: VERSIONS,
    defaultValue: '1.3',
    clampsSibling: { field: 'tls_min_version', keep: 'atMost' },
  })
  const allParameters = [minParam, maxParam]

  it('raises the max when a new min exceeds it', () => {
    expect(clampSibling(minParam, '1.3', { tls_max_version: '1.2' }, allParameters)).toEqual({
      field: 'tls_max_version',
      value: '1.3',
    })
  })

  it('lowers the min when a new max falls below it', () => {
    expect(clampSibling(maxParam, '1.0', { tls_min_version: '1.2' }, allParameters)).toEqual({
      field: 'tls_min_version',
      value: '1.0',
    })
  })

  it('does nothing when the sibling is already in order', () => {
    expect(clampSibling(minParam, '1.2', { tls_max_version: '1.3' }, allParameters)).toBeNull()
    expect(clampSibling(maxParam, '1.3', { tls_min_version: '1.2' }, allParameters)).toBeNull()
  })

  it('resolves an unset sibling from its schema default', () => {
    // max unset -> default 1.3; a new min of 1.2 is still <= 1.3, so no clamp.
    expect(clampSibling(minParam, '1.2', {}, allParameters)).toBeNull()
  })

  it('returns null without a rule, without a scale, or for off-scale values', () => {
    const plain = makeParameter({ name: 'method', enumValues: ['GET', 'POST'] })
    expect(clampSibling(plain, 'GET', {}, allParameters)).toBeNull()
    const noScale = makeParameter({ name: 'x', clampsSibling: { field: 'y', keep: 'atLeast' } })
    expect(clampSibling(noScale, '1.0', {}, allParameters)).toBeNull()
    expect(clampSibling(minParam, 'bogus', { tls_max_version: '1.2' }, allParameters)).toBeNull()
    expect(clampSibling(minParam, '1.3', { tls_max_version: 'bogus' }, allParameters)).toBeNull()
  })
})

// ============================================================================
// MapInput
// ============================================================================

describe('MapInput', () => {
  const headersParam: Parameter = { name: 'headers', label: 'Headers', type: 'map', required: false }

  it('shows the map as one JSON line in place of the entry count (FIELD-10)', () => {
    const { row, rerenderRow } = renderLiteralRow(headersParam, { a: '1', b: '2' })
    expect(elementsShowing(row(), '{"a": "1", "b": "2"}')).not.toHaveLength(0)
    expect(within(row()).queryByText(/^\d+ entr(y|ies)$/)).not.toBeInTheDocument()

    rerenderRow({ value: {} })
    expect(elementsShowing(row(), '{}')).not.toHaveLength(0)
    expect(within(row()).queryByText('Edit…')).not.toBeInTheDocument()
  })

  it('opens the shared sheet as a map from the field expand', () => {
    renderLiteralRow(headersParam, { a: '1' })
    fireEvent.click(screen.getByTestId('param-expand-headers'))
    expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-type', 'map')
  })

  it('opens the map sheet with stringValuesOnly so headers stay string->string', () => {
    renderLiteralRow(headersParam, { a: '1' })
    fireEvent.click(screen.getByTestId('param-expand-headers'))
    expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-string-values-only', 'true')
  })

  it('routes a sheet save to onChange', () => {
    const { onChange } = renderLiteralRow(headersParam, { a: '1' })
    fireEvent.click(screen.getByTestId('param-expand-headers'))
    fireEvent.click(screen.getByTestId('sheet-save'))
    expect(onChange).toHaveBeenCalledWith('SAVED')
  })

  it('keeps the map sheet open after a save until Close (PYRUN-20)', () => {
    renderLiteralRow(headersParam, { a: '1' })
    fireEvent.click(screen.getByTestId('param-expand-headers'))
    fireEvent.click(screen.getByTestId('sheet-save'))
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('sheet-close'))
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
  })
})

// ============================================================================
// MapInput - stored map credential (write-only clear-and-retype)
// ============================================================================

// A saved map credential comes back keys-readable, every value a sealed envelope.
const SEALED_A = 'wave:enc:v1:c2VhbGVkLWE='
const SEALED_B = 'wave:enc:v1:c2VhbGVkLWI='
const STORED_SECRET_MAP = { 'tls.crt': SEALED_A, 'tls.key': SEALED_B }

const secretMapParam: Parameter = {
  name: 'secret_data',
  label: 'Data',
  type: 'map',
  required: false,
  secret: true,
}

const plainMapParam: Parameter = {
  name: 'data',
  label: 'Data',
  type: 'map',
  required: false,
}

describe('isSealedMapCredential', () => {
  it('is true only for a map whose values carry a sealed envelope', () => {
    expect(isSealedMapCredential(STORED_SECRET_MAP)).toBe(true)
    expect(isSealedMapCredential({ 'tls.crt': 'PEM', 'tls.key': SEALED_B })).toBe(true)
  })

  it('is false for a map typed this session, an empty map, and a non-map value', () => {
    expect(isSealedMapCredential({ 'tls.crt': 'PEM' })).toBe(false)
    expect(isSealedMapCredential({})).toBe(false)
    expect(isSealedMapCredential(undefined)).toBe(false)
    expect(isSealedMapCredential(null)).toBe(false)
    expect(isSealedMapCredential(SEALED_A)).toBe(false)
    expect(isSealedMapCredential([SEALED_A])).toBe(false)
  })
})

// A block dialog row that drops the stored map when asked.
function StoredMapRow() {
  const [value, setValue] = useState<unknown>(STORED_SECRET_MAP)
  return (
    <>
      <input aria-label="Name" />
      <div data-testid="stored-map-field">
        <MapInput parameter={secretMapParam} effectiveValue={value} onChange={setValue} />
      </div>
    </>
  )
}

describe('MapInput - stored map credential', () => {
  it('masks a stored map: no entry count, no keys, no values', () => {
    render(
      <MapInput
        parameter={secretMapParam}
        effectiveValue={STORED_SECRET_MAP}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Edit protected value' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Map' })).not.toBeInTheDocument()
    expect(screen.queryByText(/entries/)).not.toBeInTheDocument()
    expect(screen.queryByText(/tls\./)).not.toBeInTheDocument()
    expect(screen.queryByText(/wave:enc:v1:/)).not.toBeInTheDocument()
  })

  it('keeps a map typed this session on the one-line field, keys and values shown', () => {
    const { row } = renderLiteralRow(secretMapParam, { 'tls.crt': 'PEM', 'tls.key': 'KEY' })

    expect(elementsShowing(row(), '{"tls.crt": "PEM", "tls.key": "KEY"}')).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Edit protected value' })).not.toBeInTheDocument()
  })

  it('leaves a stored EMPTY secret map on the one-line field (nothing to protect)', () => {
    const { row } = renderLiteralRow(secretMapParam, {})

    expect(elementsShowing(row(), '{}')).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Edit protected value' })).not.toBeInTheDocument()
  })

  it('never masks a map on a parameter that is not a credential', () => {
    const { row } = renderLiteralRow(plainMapParam, STORED_SECRET_MAP)

    expect(
      elementsShowing(row(), `{"tls.crt": "${SEALED_A}", "tls.key": "${SEALED_B}"}`),
    ).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Edit protected value' })).not.toBeInTheDocument()
  })

  it('opens the shared "Edit Protected Value?" dialog on the masked affordance', () => {
    render(
      <MapInput
        parameter={secretMapParam}
        effectiveValue={STORED_SECRET_MAP}
        onChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit protected value' }))

    expect(screen.getByText('Edit Protected Value?')).toBeInTheDocument()
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
  })

  it('clears the stored map and opens an empty editor on confirm', () => {
    const onChange = vi.fn()
    render(
      <MapInput
        parameter={secretMapParam}
        effectiveValue={STORED_SECRET_MAP}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit protected value' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete & Edit' }))

    expect(onChange).toHaveBeenCalledWith({})
    const sheet = screen.getByTestId('value-editor-sheet')
    expect(sheet).toHaveAttribute('data-type', 'map')
    expect(sheet).toHaveAttribute('data-value', '{}')
  })

  it('drops the cleared map\'s per-key expression entries, keeping other params', () => {
    const onExpressionFieldsChange = vi.fn()
    render(
      <MapInput
        parameter={secretMapParam}
        effectiveValue={STORED_SECRET_MAP}
        onChange={vi.fn()}
        expressionFields={['secret_data.tls.crt', 'headers.X-Trace']}
        onExpressionFieldsChange={onExpressionFieldsChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit protected value' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete & Edit' }))

    expect(onExpressionFieldsChange).toHaveBeenCalledWith(['headers.X-Trace'])
  })

  it('keeps the schema key menus on the editor a clear-and-retype opens', () => {
    render(
      <MapInput
        parameter={{
          ...secretMapParam,
          quickInserts: [
            {
              label: '+ Key',
              items: [
                { label: 'tls.crt', key: 'tls.crt', value: '' },
                { label: 'tls.key', key: 'tls.key', value: '' },
              ],
            },
          ],
        }}
        effectiveValue={STORED_SECRET_MAP}
        onChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit protected value' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete & Edit' }))

    expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute(
      'data-quick-insert-keys',
      'tls.crt,tls.key',
    )
  })

  it('leaves the stored map untouched on cancel', () => {
    const onChange = vi.fn()
    render(
      <MapInput
        parameter={secretMapParam}
        effectiveValue={STORED_SECRET_MAP}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit protected value' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit protected value' })).toBeInTheDocument()
  })

  it.each([
    ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['Escape', () => fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })],
  ])('puts the keyboard focus back on the masked control after %s', async (_label, dismiss) => {
    render(<StoredMapRow />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit protected value' }))

    dismiss()

    expect(screen.queryByText('Edit Protected Value?')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit protected value' })).toHaveFocus(),
    )
  })

  it('puts the keyboard focus on the map control that took the masked one\'s place after "Delete & Edit"', async () => {
    render(<StoredMapRow />)
    screen.getByRole('textbox', { name: 'Name' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Edit protected value' }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete & Edit' }))

    expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-value', '{}')
    await waitFor(() =>
      expect(screen.getByTestId('stored-map-field').contains(document.activeElement)).toBe(true),
    )
    expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveFocus()
  })
})

// ============================================================================
// ArrayInput
// ============================================================================

describe('ArrayInput', () => {
  const itemsParam: Parameter = { name: 'items', label: 'Items', type: 'array', required: false }
  const typedItemsParam: Parameter = { ...itemsParam, typedValues: true }

  function openItemsSheet() {
    fireEvent.click(screen.getByTestId('param-expand-items'))
  }

  it('shows the list as one JSON line in place of the item count (FIELD-10)', () => {
    const { row, rerenderRow } = renderLiteralRow(itemsParam, ['a', 'b'])
    expect(elementsShowing(row(), '["a", "b"]')).not.toHaveLength(0)
    expect(within(row()).queryByText(/^\d+ items?$/)).not.toBeInTheDocument()

    rerenderRow({ value: ['only'] })
    expect(elementsShowing(row(), '["only"]')).not.toHaveLength(0)

    rerenderRow({ value: [] })
    expect(elementsShowing(row(), '[]')).not.toHaveLength(0)
    expect(within(row()).queryByText('Edit…')).not.toBeInTheDocument()
  })

  it('opens the shared sheet as an array from the field expand', () => {
    renderLiteralRow(itemsParam, ['a'])
    openItemsSheet()
    expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-type', 'array')
  })

  it('routes a sheet save to onChange', () => {
    const { onChange } = renderLiteralRow(itemsParam, ['a'])
    openItemsSheet()
    fireEvent.click(screen.getByTestId('sheet-save'))
    expect(onChange).toHaveBeenCalledWith('SAVED')
  })

  it('opens a text-only list unless the setting declares typed values', () => {
    const { rerenderRow } = renderLiteralRow(itemsParam, ['a'])
    openItemsSheet()
    expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-string-values-only', 'true')
    rerenderRow({ parameter: typedItemsParam })
    expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-string-values-only', 'false')
  })

  it('saves every item of a text-only list as text', () => {
    const { onChange } = renderLiteralRow(itemsParam, ['a'])
    openItemsSheet()
    fireEvent.click(screen.getByTestId('sheet-save-list'))
    expect(onChange).toHaveBeenCalledWith(['502', 'true', '503', ''])
  })

  it('keeps the items of a typed list as the sheet saved them', () => {
    const { onChange } = renderLiteralRow(typedItemsParam, ['a'])
    openItemsSheet()
    fireEvent.click(screen.getByTestId('sheet-save-list'))
    expect(onChange).toHaveBeenCalledWith([502, true, '503', null])
  })

  it('keeps the array sheet open after a save until Close (PYRUN-20)', () => {
    renderLiteralRow(itemsParam, ['a'])
    openItemsSheet()
    fireEvent.click(screen.getByTestId('sheet-save'))
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('sheet-close'))
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
  })
})

// ============================================================================
// StringInput (one editor for every string; adopts the shared sheet)
// ============================================================================

describe('StringInput (unified)', () => {
  function renderInput(overrides: {
    parameter?: Parameter
    effectiveValue?: unknown
    templateFields?: string[]
    onChange?: ReturnType<typeof vi.fn>
    onTemplateFieldsChange?: ReturnType<typeof vi.fn>
  } = {}) {
    const onChange = overrides.onChange ?? vi.fn()
    const onTemplateFieldsChange = overrides.onTemplateFieldsChange ?? vi.fn()
    render(
      <StringInput
        parameter={overrides.parameter ?? makeParameter()}
        effectiveValue={overrides.effectiveValue ?? 'line1\nline2'}
        onChange={onChange}
        availableVariables={[]}
        templateFields={overrides.templateFields ?? []}
        onTemplateFieldsChange={onTemplateFieldsChange}
      />,
    )
    return { onChange, onTemplateFieldsChange }
  }

  it('draws the one value field with its expand in place of the old Edit preview', () => {
    renderInput()
    expect(screen.getByTestId('param-expand-body')).toHaveAccessibleName('Open editor for body')
    expect(screen.queryByTestId('param-edit-body')).not.toBeInTheDocument()
  })

  it('names the text field with the parameter label', () => {
    renderInput({ parameter: makeParameter({ label: 'Body' }), effectiveValue: 'hello' })
    expect(screen.getByRole('textbox', { name: 'Body' })).toBeInTheDocument()
  })

  it('names the text field with the parameter name when the schema gives no label', () => {
    renderInput({ effectiveValue: 'hello' })
    expect(screen.getByRole('textbox', { name: 'body' })).toBeInTheDocument()
  })

  it('keeps a single-line string param on the one value field, its sheet behind the expand', () => {
    renderInput({ parameter: makeParameter({ name: 'url' }) })
    expect(screen.getByTestId('param-expand-url')).toBeInTheDocument()
    expect(screen.queryByTestId('param-edit-url')).not.toBeInTheDocument()
  })

  it('opens the shared sheet as a string with templating allowed', () => {
    renderInput()
    fireEvent.click(screen.getByTestId('param-expand-body'))
    const sheet = screen.getByTestId('value-editor-sheet')
    expect(sheet).toHaveAttribute('data-type', 'string')
    expect(sheet).toHaveAttribute('data-allow-template', 'true')
  })

  it('seeds the sheet as a template when the param is in templateFields', () => {
    renderInput({ templateFields: ['body'] })
    fireEvent.click(screen.getByTestId('param-expand-body'))
    expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-is-template', 'true')
  })

  it('seeds the sheet as a literal when the param is not in templateFields', () => {
    renderInput({ templateFields: [] })
    fireEvent.click(screen.getByTestId('param-expand-body'))
    expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-is-template', 'false')
  })

  it('threads the param allowedFormats to the sheet', () => {
    renderInput({ parameter: makeParameter({ allowedFormats: ['json'] }) })
    fireEvent.click(screen.getByTestId('param-expand-body'))
    expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-allowed-formats', 'json')
  })

  it('routes a literal save to onChange and removes the param from templateFields', () => {
    const { onChange, onTemplateFieldsChange } = renderInput({ templateFields: ['body'] })
    fireEvent.click(screen.getByTestId('param-expand-body'))
    fireEvent.click(screen.getByTestId('sheet-save'))
    expect(onChange).toHaveBeenCalledWith('SAVED')
    expect(onTemplateFieldsChange).toHaveBeenCalledWith([])
  })

  it('routes a template save to onChange and adds the param to templateFields', () => {
    const { onChange, onTemplateFieldsChange } = renderInput({ templateFields: [] })
    fireEvent.click(screen.getByTestId('param-expand-body'))
    fireEvent.click(screen.getByTestId('sheet-save-template'))
    expect(onChange).toHaveBeenCalledWith('SAVED')
    expect(onTemplateFieldsChange).toHaveBeenCalledWith(['body'])
  })

  it('keeps the string sheet open after a save until Close (PYRUN-20)', () => {
    renderInput()
    fireEvent.click(screen.getByTestId('param-expand-body'))
    fireEvent.click(screen.getByTestId('sheet-save'))
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('sheet-close'))
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
  })
})

// ============================================================================
// StringInput - the Kind dropdown gate (PYRUN-16) and the Python-mode props
// the python body carries into the shared sheet (PYRUN-13, PYRUN-19, PYRUN-21)
// ============================================================================

/** A python body's Input Variables: the name is the input_vars key, the type is
 *  the bound WAVE variable's type (a bare {{name}} value) or string. */
const PY_INPUT_VARIABLES = [
  { name: 'limit', type: 'float' },
  { name: 'readings', type: 'table' },
]

const PY_EXPORT_NAMES = ['SUMMARY', 'TOTAL']

describe('StringInput Kind dropdown gate (PYRUN-16)', () => {
  function openSheet(parameter: Parameter) {
    render(
      <StringInput
        parameter={parameter}
        effectiveValue="print(1)"
        onChange={vi.fn()}
        availableVariables={[]}
        templateFields={[]}
        onTemplateFieldsChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId(`param-expand-${parameter.name}`))
    return screen.getByTestId('value-editor-sheet')
  }

  it('suppresses the Kind dropdown for a parameter declared noExpression', () => {
    const sheet = openSheet(makeParameter({ name: 'script_type', noExpression: true }))
    expect(sheet).toHaveAttribute('data-allow-template', 'false')
  })

  it('keeps the Kind dropdown for a parameter that is not declared noExpression', () => {
    const sheet = openSheet(makeParameter({ name: 'url' }))
    expect(sheet).toHaveAttribute('data-allow-template', 'true')
  })
})

describe('StringInput Python-mode props (PYRUN-13, PYRUN-19, PYRUN-21)', () => {
  function renderInput(
    parameter: Parameter,
    overrides: { runBusy?: boolean; runAllowed?: boolean } = {},
  ) {
    const onChange = vi.fn()
    const onRun = vi.fn()
    const onRenameSymbol = vi.fn()
    render(
      <StringInput
        parameter={parameter}
        effectiveValue="print(1)"
        onChange={onChange}
        availableVariables={[]}
        templateFields={[]}
        onTemplateFieldsChange={vi.fn()}
        inputVariables={PY_INPUT_VARIABLES}
        inputVariableTypes={{ limit: 'float' }}
        exportNames={PY_EXPORT_NAMES}
        interpreter="{{py}} -X utf8"
        onRun={onRun}
        runBusy={overrides.runBusy ?? false}
        runAllowed={overrides.runAllowed ?? true}
        onRenameSymbol={onRenameSymbol}
      />,
    )
    fireEvent.click(screen.getByTestId(`param-expand-${parameter.name}`))
    return { sheet: screen.getByTestId('value-editor-sheet'), onChange, onRun, onRenameSymbol }
  }

  /** The Python block's script body: the only parameter locked to python. */
  const pythonBody = () => makeParameter({ name: 'script', allowedFormats: ['python'] })

  it('threads the Input Variables, the export names and the interpreter row text', () => {
    const { sheet } = renderInput(pythonBody())
    expect(sheet).toHaveAttribute('data-input-variables', 'limit:float,readings:table')
    expect(sheet).toHaveAttribute('data-input-variable-types', '{"limit":"float"}')
    expect(sheet).toHaveAttribute('data-export-names', 'SUMMARY,TOTAL')
    expect(sheet).toHaveAttribute('data-interpreter', '{{py}} -X utf8')
  })

  it('threads the Run state and the rename callback', () => {
    const { sheet } = renderInput(pythonBody())
    expect(sheet).toHaveAttribute('data-has-on-run', 'true')
    expect(sheet).toHaveAttribute('data-run-allowed', 'true')
    expect(sheet).toHaveAttribute('data-run-busy', 'false')
    expect(sheet).toHaveAttribute('data-has-on-rename-symbol', 'true')
  })

  it('threads a busy run and a disallowed run through to the sheet', () => {
    const { sheet } = renderInput(pythonBody(), { runBusy: true, runAllowed: false })
    expect(sheet).toHaveAttribute('data-run-busy', 'true')
    expect(sheet).toHaveAttribute('data-run-allowed', 'false')
  })

  it('runs the sheet draft and leaves the saved parameter value alone', () => {
    const { onRun, onChange } = renderInput(pythonBody())
    fireEvent.click(screen.getByTestId('sheet-run'))
    expect(onRun).toHaveBeenCalledWith('DRAFT')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('forwards a symbol rename from the sheet', () => {
    const { onRenameSymbol } = renderInput(pythonBody())
    fireEvent.click(screen.getByTestId('sheet-rename-symbol'))
    expect(onRenameSymbol).toHaveBeenCalledWith('limit', 'ceiling')
  })

  it('threads none of the Python-mode props to a body that is not python', () => {
    const { sheet } = renderInput(makeParameter({ name: 'script', allowedFormats: ['plain'] }))
    expect(sheet).toHaveAttribute('data-has-input-variables', 'false')
    expect(sheet).toHaveAttribute('data-input-variable-types', 'null')
    expect(sheet).toHaveAttribute('data-has-export-names', 'false')
    expect(sheet).toHaveAttribute('data-has-interpreter', 'false')
    expect(sheet).toHaveAttribute('data-has-on-run', 'false')
    expect(sheet).toHaveAttribute('data-has-on-rename-symbol', 'false')
    expect(sheet).toHaveAttribute('data-run-busy', 'undefined')
    expect(sheet).toHaveAttribute('data-run-allowed', 'undefined')
  })
})

// ============================================================================
// PYRUN-21: while a debug run is paused at this very block, that block's open
// script editor stays live inside the read-only configuration sheet, so the
// author edits the script and presses Run, which repeats the block. Nothing
// else thaws: not another row's editor, and not the same one while the run is
// merely in flight.
// ============================================================================

describe('StringInput while the session is paused at this block (PYRUN-21)', () => {
  /** The Python block's script body: the only parameter locked to python. */
  const pythonBody = () => makeParameter({ name: 'script', allowedFormats: ['python'] })

  /** Open the row's editor while the sheet is live, then freeze the sheet around it. */
  function openThenFreeze(parameter: Parameter, runPausedHere: boolean) {
    const row = (frozen: boolean) => (
      <FreezableFieldset disabled={frozen}>
        <StringInput
          parameter={parameter}
          effectiveValue="print(1)"
          onChange={vi.fn()}
          availableVariables={[]}
          templateFields={[]}
          onTemplateFieldsChange={vi.fn()}
          onRun={vi.fn()}
          runAllowed
          runPausedHere={runPausedHere}
        />
      </FreezableFieldset>
    )
    const { rerender } = render(row(false))
    fireEvent.click(screen.getByTestId(`param-expand-${parameter.name}`))
    rerender(row(true))
    return screen.getByTestId('value-editor-sheet')
  }

  it('leaves the open script editor live while the run is paused at this block', () => {
    expect(openThenFreeze(pythonBody(), true)).toHaveAttribute('data-sheet-frozen', 'false')
  })

  it('freezes the open script editor while the run is not paused at this block', () => {
    expect(openThenFreeze(pythonBody(), false)).toHaveAttribute('data-sheet-frozen', 'true')
  })

  it('freezes the open editor of every other row of the same block', () => {
    const other = makeParameter({ name: 'interpreter' })
    expect(openThenFreeze(other, true)).toHaveAttribute('data-sheet-frozen', 'true')
  })

  it('leaves the open SQL editor live while the run is paused at this block', () => {
    const sqlBody = makeParameter({ name: 'sql', allowedFormats: ['sql'], noExpression: true })
    expect(openThenFreeze(sqlBody, true)).toHaveAttribute('data-sheet-frozen', 'false')
  })

  it('freezes the open SQL editor while the run is not paused at this block', () => {
    const sqlBody = makeParameter({ name: 'sql', allowedFormats: ['sql'], noExpression: true })
    expect(openThenFreeze(sqlBody, false)).toHaveAttribute('data-sheet-frozen', 'true')
  })

  it('keeps the script row expand in a frozen sheet and opens the editor frozen', () => {
    render(
      <FreezableFieldset disabled>
        <StringInput
          parameter={pythonBody()}
          effectiveValue="print(1)"
          onChange={vi.fn()}
          availableVariables={[]}
          templateFields={[]}
          onTemplateFieldsChange={vi.fn()}
          onRun={vi.fn()}
          runAllowed
          runPausedHere={false}
        />
      </FreezableFieldset>,
    )
    const expand = screen.getByTestId('param-expand-script')
    expect(expand).toBeEnabled()
    fireEvent.click(expand)
    expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-sheet-frozen', 'true')
  })
})

describe('StringInput while a run started from its editor is in flight (SQL-13, PYRUN-21)', () => {
  /** Open the row's editor while the sheet is live, then freeze the sheet with the run state given. */
  function openThenFreeze(parameter: Parameter, runBusy: boolean) {
    const row = (frozen: boolean) => (
      <FreezableFieldset disabled={frozen}>
        <StringInput
          parameter={parameter}
          effectiveValue="SELECT 1"
          onChange={vi.fn()}
          availableVariables={[]}
          templateFields={[]}
          onTemplateFieldsChange={vi.fn()}
          onRun={vi.fn()}
          onStop={vi.fn()}
          runAllowed
          runBusy={frozen && runBusy}
        />
      </FreezableFieldset>
    )
    const { rerender } = render(row(false))
    fireEvent.click(screen.getByTestId(`param-expand-${parameter.name}`))
    rerender(row(true))
    return screen.getByTestId('value-editor-sheet')
  }

  const sqlBody = () =>
    makeParameter({ name: 'sql', allowedFormats: ['sql'], noExpression: true })

  it('leaves the open SQL editor live while its own run is in flight', () => {
    expect(openThenFreeze(sqlBody(), true)).toHaveAttribute('data-sheet-frozen', 'false')
  })

  it('leaves the open Python editor live while its own run is in flight', () => {
    const pythonBody = makeParameter({ name: 'script', allowedFormats: ['python'] })
    expect(openThenFreeze(pythonBody, true)).toHaveAttribute('data-sheet-frozen', 'false')
  })

  it('freezes the open SQL editor while a run it did not start is in flight', () => {
    expect(openThenFreeze(sqlBody(), false)).toHaveAttribute('data-sheet-frozen', 'true')
  })

  it('freezes the open editor of a row that is no script while a run is in flight', () => {
    const other = makeParameter({ name: 'host' })
    expect(openThenFreeze(other, true)).toHaveAttribute('data-sheet-frozen', 'true')
  })
})

describe('StringInput SQL-mode props (SQL-10, SQL-12, SQL-13)', () => {
  function renderInput(
    parameter: Parameter,
    overrides: { parameterNames?: readonly string[] | null } = {},
  ) {
    const onChange = vi.fn()
    const onRun = vi.fn()
    const onStop = vi.fn()
    render(
      <StringInput
        parameter={parameter}
        effectiveValue={SAMPLE_SCRIPT}
        onChange={onChange}
        availableVariables={[]}
        templateFields={[]}
        onTemplateFieldsChange={vi.fn()}
        nodeId="node-sql"
        onRun={onRun}
        onStop={onStop}
        runBusy
        runAllowed
        databaseType="mysql"
        parameterNames={
          overrides.parameterNames === undefined ? ['customer', 'status'] : overrides.parameterNames
        }
        sqlCatalogRequest={SAMPLE_CATALOG_REQUEST}
      />,
    )
    fireEvent.click(screen.getByTestId(`param-expand-${parameter.name}`))
    return { sheet: screen.getByTestId('value-editor-sheet'), onChange, onRun, onStop }
  }

  /** The SQL block's body: locked to sql, and its row takes no expression. */
  const sqlBody = () =>
    makeParameter({ name: 'sql', label: 'SQL', allowedFormats: ['sql'], noExpression: true })

  it('threads the block and the Run and Stop state to a body locked to sql', () => {
    const { sheet } = renderInput(sqlBody())
    expect(sheet).toHaveAttribute('data-node-id', 'node-sql')
    expect(sheet).toHaveAttribute('data-has-on-run', 'true')
    expect(sheet).toHaveAttribute('data-has-on-stop', 'true')
    expect(sheet).toHaveAttribute('data-run-busy', 'true')
    expect(sheet).toHaveAttribute('data-run-allowed', 'true')
  })

  it('threads the Database type, the Parameters names and the catalog request', () => {
    const { sheet } = renderInput(sqlBody())
    expect(sheet).toHaveAttribute('data-database-type', 'mysql')
    expect(sheet).toHaveAttribute('data-parameter-names', '["customer","status"]')
    expect(sheet).toHaveAttribute('data-sql-catalog-request', JSON.stringify(SAMPLE_CATALOG_REQUEST))
  })

  it('threads null Parameters names while Parameters is an expression', () => {
    const { sheet } = renderInput(sqlBody(), { parameterNames: null })
    expect(sheet).toHaveAttribute('data-parameter-names', 'null')
  })

  it('allows Template kind on the sql body although its row takes no expression', () => {
    const { sheet } = renderInput(sqlBody())
    expect(sheet).toHaveAttribute('data-allow-template', 'true')
    expect(sheet).toHaveAttribute('data-allowed-formats', 'sql')
  })

  it('stops the run from the sql body', () => {
    const { onStop, onRun } = renderInput(sqlBody())
    fireEvent.click(screen.getByTestId('sheet-stop'))
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onRun).not.toHaveBeenCalled()
  })

  it('runs the sheet draft from the sql body and leaves the saved value alone', () => {
    const { onRun, onChange } = renderInput(sqlBody())
    fireEvent.click(screen.getByTestId('sheet-run'))
    expect(onRun).toHaveBeenCalledWith('DRAFT')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('threads Stop to the python body too', () => {
    const { sheet } = renderInput(makeParameter({ name: 'script', allowedFormats: ['python'] }))
    expect(sheet).toHaveAttribute('data-has-on-stop', 'true')
    expect(sheet).toHaveAttribute('data-has-on-run', 'true')
  })

  it('threads none of the script-editor props to a plain body', () => {
    const { sheet } = renderInput(makeParameter({ name: 'notes', allowedFormats: ['plain'] }))
    expect(sheet).toHaveAttribute('data-node-id', 'undefined')
    expect(sheet).toHaveAttribute('data-has-on-run', 'false')
    expect(sheet).toHaveAttribute('data-has-on-stop', 'false')
    expect(sheet).toHaveAttribute('data-run-busy', 'undefined')
    expect(sheet).toHaveAttribute('data-run-allowed', 'undefined')
    expect(sheet).toHaveAttribute('data-database-type', 'undefined')
    expect(sheet).toHaveAttribute('data-parameter-names', 'undefined')
    expect(sheet).toHaveAttribute('data-sql-catalog-request', 'undefined')
    expect(sheet).toHaveAttribute('data-open-search-fields-request', 'undefined')
    expect(sheet).toHaveAttribute('data-open-search-index', 'undefined')
  })

  it('threads none of the script-editor props to a body with no format', () => {
    const { sheet } = renderInput(makeParameter({ name: 'notes' }))
    expect(sheet).toHaveAttribute('data-has-on-stop', 'false')
    expect(sheet).toHaveAttribute('data-database-type', 'undefined')
    expect(sheet).toHaveAttribute('data-sql-catalog-request', 'undefined')
  })

  it('keeps Template kind off a noExpression body that is not a script', () => {
    const { sheet } = renderInput(
      makeParameter({ name: 'notes', allowedFormats: ['plain'], noExpression: true }),
    )
    expect(sheet).toHaveAttribute('data-allow-template', 'false')
  })
})

// ============================================================================
// StringInput - the OpenSearch Query body in its DQL and Query DSL modes
// ============================================================================

describe('StringInput OpenSearch Query props (OS-12)', () => {
  function renderInput(parameter: Parameter, overrides: { templateFields?: string[] } = {}) {
    const onChange = vi.fn()
    const onRun = vi.fn()
    const onStop = vi.fn()
    render(
      <StringInput
        parameter={parameter}
        effectiveValue={SAMPLE_DQL}
        onChange={onChange}
        availableVariables={[]}
        templateFields={overrides.templateFields ?? []}
        onTemplateFieldsChange={vi.fn()}
        nodeId="node-os"
        onRun={onRun}
        onStop={onStop}
        runBusy={false}
        runAllowed
        openSearchFieldsRequest={SAMPLE_FIELDS_REQUEST}
        openSearchIndex="filebeat-*"
      />,
    )
    fireEvent.click(screen.getByTestId(`param-expand-${parameter.name}`))
    return { sheet: screen.getByTestId('value-editor-sheet'), onChange, onRun, onStop }
  }

  /** The Query twin for each Query language: one wire name, one locked format each. */
  const dqlQuery = () => makeParameter({ name: 'query', label: 'Query', allowedFormats: ['dql'] })
  const dslQuery = () => makeParameter({ name: 'query', label: 'Query', allowedFormats: ['query-dsl'] })

  it.each([
    ['dql', dqlQuery],
    ['query-dsl', dslQuery],
  ])('threads the block, Run and Stop to a body locked to %s', (_format, parameter) => {
    const { sheet } = renderInput(parameter())
    expect(sheet).toHaveAttribute('data-node-id', 'node-os')
    expect(sheet).toHaveAttribute('data-has-on-run', 'true')
    expect(sheet).toHaveAttribute('data-has-on-stop', 'true')
    expect(sheet).toHaveAttribute('data-run-busy', 'false')
    expect(sheet).toHaveAttribute('data-run-allowed', 'true')
  })

  it.each([
    ['dql', dqlQuery],
    ['query-dsl', dslQuery],
  ])('threads the fields request and the index pattern to a body locked to %s', (_format, parameter) => {
    const { sheet } = renderInput(parameter())
    expect(sheet).toHaveAttribute('data-open-search-fields-request', JSON.stringify(SAMPLE_FIELDS_REQUEST))
    expect(sheet).toHaveAttribute('data-open-search-index', 'filebeat-*')
  })

  it.each([
    ['dql', dqlQuery],
    ['query-dsl', dslQuery],
  ])('locks the %s format and offers Template kind', (format, parameter) => {
    const { sheet } = renderInput(parameter())
    expect(sheet).toHaveAttribute('data-allowed-formats', format)
    expect(sheet).toHaveAttribute('data-allow-template', 'true')
  })

  it('opens the Query in Template kind while its row is a template', () => {
    const { sheet } = renderInput(dqlQuery(), { templateFields: ['query'] })
    expect(sheet).toHaveAttribute('data-is-template', 'true')
  })

  it('runs the sheet draft from the Query body and leaves the saved value alone', () => {
    const { onRun, onChange } = renderInput(dqlQuery())
    fireEvent.click(screen.getByTestId('sheet-run'))
    expect(onRun).toHaveBeenCalledWith('DRAFT')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('threads none of the OpenSearch props to a plain body', () => {
    const { sheet } = renderInput(makeParameter({ name: 'notes', allowedFormats: ['plain'] }))
    expect(sheet).toHaveAttribute('data-open-search-fields-request', 'undefined')
    expect(sheet).toHaveAttribute('data-open-search-index', 'undefined')
    expect(sheet).toHaveAttribute('data-has-on-run', 'false')
  })

  it('leaves the open Query editor live while the run is paused at this block', () => {
    const row = (frozen: boolean) => (
      <FreezableFieldset disabled={frozen}>
        <StringInput
          parameter={dqlQuery()}
          effectiveValue={SAMPLE_DQL}
          onChange={vi.fn()}
          availableVariables={[]}
          templateFields={[]}
          onTemplateFieldsChange={vi.fn()}
          onRun={vi.fn()}
          runAllowed
          runPausedHere
        />
      </FreezableFieldset>
    )
    const { rerender } = render(row(false))
    fireEvent.click(screen.getByTestId('param-expand-query'))
    rerender(row(true))
    expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-sheet-frozen', 'false')
  })
})

// ============================================================================
// A script row in expression mode: the expression editor replaces the script
// editor (SQL-10 amendment; the OpenSearch Query row, OS-5)
// ============================================================================

describe('A script row in expression mode (SQL-10, OS-5)', () => {
  /** The SQL body after the SQL-10 amendment: locked to sql, and its row takes the expression toggle. */
  const sqlRow = () => makeParameter({ name: 'sql', label: 'SQL', allowedFormats: ['sql'] })
  const queryRow = () =>
    makeParameter({ name: 'query', label: 'Query', allowedFormats: ['dql'] })

  function renderRow(parameter: Parameter, value: unknown, expressionFields: string[]) {
    const onChange = vi.fn()
    const onExpressionFieldsChange = vi.fn()
    render(
      <table>
        <tbody>
          <ParameterRow
            mode="input"
            parameter={parameter}
            value={value}
            onChange={onChange}
            availableVariables={[{ name: 'sql_text', type: 'string' }]}
            expressionFields={expressionFields}
            onExpressionFieldsChange={onExpressionFieldsChange}
            templateFields={[]}
            onTemplateFieldsChange={vi.fn()}
            scriptEditor={{ nodeId: 'node-1', onRun: vi.fn(), runAllowed: true }}
          />
        </tbody>
      </table>,
    )
    return { onChange, onExpressionFieldsChange }
  }

  it.each([
    ['the SQL row', sqlRow, 'sql'],
    ['the OpenSearch Query row', queryRow, 'query'],
  ])('shows the expression editor for %s in expression mode', (_row, parameter, name) => {
    renderRow(parameter(), 'sql_text', [name])
    expect(screen.getByTestId(`param-input-${name}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`param-edit-${name}`)).not.toBeInTheDocument()
  })

  it.each([
    ['the SQL row', sqlRow, 'sql'],
    ['the OpenSearch Query row', queryRow, 'query'],
  ])('opens the script editor from the field expand for %s in literal mode', (_row, parameter, name) => {
    renderRow(parameter(), SAMPLE_SCRIPT, [])
    fireEvent.click(screen.getByTestId(`param-expand-${name}`))
    expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-type', 'string')
  })

  it('offers the expression toggle on the SQL row', () => {
    renderRow(sqlRow(), SAMPLE_SCRIPT, [])
    expect(screen.getByTestId('expression-toggle')).toHaveAttribute('aria-pressed', 'false')
  })

  it('asks before the switch and carries none of the SQL text into the expression (FIELD-7)', () => {
    const { onChange, onExpressionFieldsChange } = renderRow(sqlRow(), SAMPLE_SCRIPT, [])

    fireEvent.click(screen.getByTestId('expression-toggle'))

    expect(screen.getByTestId('switch-mode-dialog')).toBeInTheDocument()
    expect(screen.getByText('Switch the field to an expression?')).toBeInTheDocument()
    expect(onExpressionFieldsChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('switch-mode-clear-empty'))

    expect(onExpressionFieldsChange).toHaveBeenCalledWith(['sql'])
    expect(onChange).toHaveBeenLastCalledWith("''")
    expect(onChange).not.toHaveBeenCalledWith(SAMPLE_SCRIPT)
  })

  it('opens no script editor sheet from the expand of a row in expression mode', () => {
    renderRow(sqlRow(), 'sql_text', ['sql'])
    fireEvent.click(screen.getByTestId('param-expand-sql'))
    expect(screen.queryByTestId('value-editor-sheet')).not.toBeInTheDocument()
  })
})

describe('A number row shows its default as real gray text, not a placeholder (REQ-3.1.1.5)', () => {
  /** The row's number box: the shared exact-number body's input. */
  function numberBox(parameter: Parameter, value: unknown = undefined) {
    const rendered = renderLiteralRow(parameter, value)
    const body = within(rendered.row()).getByTestId('scalar-edit-body')
    return { ...rendered, box: within(body).getByTestId(`param-input-${parameter.name}`) }
  }

  it('shows the default of an unset integer row as gray text', () => {
    const { row, box } = numberBox(makeParameter({ name: 'timeout', type: 'integer', defaultValue: 300 }))
    expect(box).toHaveValue('300')
    expect(box).not.toHaveAttribute('placeholder')
    expect(grayUpTo(box, row())).toBe(true)
  })

  it('shows the default of an unset float row as gray text', () => {
    const { row, box } = numberBox(makeParameter({ name: 'ratio', type: 'float', defaultValue: 1.5 }))
    expect(box).toHaveValue('1.5')
    expect(box).not.toHaveAttribute('placeholder')
    expect(grayUpTo(box, row())).toBe(true)
  })

  it.each([
    ['integer', 3306, '3306', '5432'],
    ['float', 1.5, '1.5', '0.5'],
  ] as const)('shows the default, not the descriptor hint, on an unset %s row that declares both', (type, defaultValue, shown, hint) => {
    const { row, box } = numberBox(
      makeParameter({ name: 'amount', type, placeholder: hint, defaultValue }),
    )
    expect(box).toHaveValue(shown)
    expect(grayUpTo(box, row())).toBe(true)
  })

  it('keeps the descriptor hint on an unset integer row that declares no default (SQL-8)', () => {
    const { box } = numberBox(makeParameter({ name: 'port', type: 'integer', placeholder: '5432' }))
    expect(box).toHaveValue('')
    expect(box).toHaveAttribute('placeholder', '5432')
  })

  it('shows an empty box with no hint on an integer row that declares neither', () => {
    const { box } = numberBox(makeParameter({ name: 'port', type: 'integer' }))
    expect(box).toHaveValue('')
    expect(box).not.toHaveAttribute('placeholder')
  })

  it.each(['integer', 'float'] as const)('shows an empty box with no hint on a %s row whose default is null', (type) => {
    const { box } = numberBox(makeParameter({ name: 'amount', type, defaultValue: null }))
    expect(box).toHaveValue('')
    expect(box).not.toHaveAttribute('placeholder')
  })

  it('shows a number the row holds in its type color, not the gray', () => {
    const { row, box } = numberBox(
      makeParameter({ name: 'timeout', type: 'integer', defaultValue: 300 }),
      '42',
    )
    expect(box).toHaveValue('42')
    expect(grayUpTo(box, row())).toBe(false)
  })

  it('replaces the whole gray default with the first key typed', async () => {
    const user = userEvent.setup()
    const { box, onChange } = numberBox(
      makeParameter({ name: 'timeout', type: 'integer', defaultValue: 300 }),
    )
    await user.type(box, '5')
    expect(onChange).toHaveBeenLastCalledWith('5')
  })
})

describe('Number rows use the shared exact-number body (REQ-3.1.3.14)', () => {
  it.each([
    ['an integer', 'integer', 'numeric'],
    ['a float', 'float', 'decimal'],
  ] as const)('renders %s row with ScalarEditBody', (_kind, type, inputMode) => {
    const { row } = renderLiteralRow(makeParameter({ name: 'amount', type }), undefined)
    const body = within(row()).getByTestId('scalar-edit-body')
    expect(within(body).getByTestId('param-input-amount')).toHaveAttribute('inputmode', inputMode)
  })

  it.each([
    ['integer', '12345678901234567890'],
    ['float', '0.1000000000000000055511151231257827'],
  ] as const)('shows a stored %s value digit for digit', (type, stored) => {
    const { row, onChange } = renderLiteralRow(makeParameter({ name: 'amount', type }), stored)
    expect(within(row()).getByTestId('param-input-amount')).toHaveValue(stored)
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each([
    ['an integer past 2^53', 'integer', '9007199254740993'],
    ['a float past double precision', 'float', '0.1000000000000000055511151231'],
  ] as const)('sends %s typed into the row as its exact digits', async (_kind, type, typed) => {
    const user = userEvent.setup()
    const { row, onChange } = renderLiteralRow(makeParameter({ name: 'amount', type }), undefined)
    await user.type(within(row()).getByTestId('param-input-amount'), typed)
    expect(onChange).toHaveBeenLastCalledWith(typed)
  })
})

describe('A literal row whose default is null shows an empty field (REQ-3.1.1.5)', () => {
  /** Every text, value and placeholder the row shows. */
  function shownTexts(row: HTMLElement): string {
    const fields = Array.from(row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
    return [
      row.textContent ?? '',
      ...fields.map((field) => field.value),
      ...fields.map((field) => field.getAttribute('placeholder') ?? ''),
    ].join('\n')
  }

  it.each([
    ['a string', 'string'],
    ['a boolean', 'boolean'],
    ['an array', 'array'],
    ['a map', 'map'],
    ['a table', 'table'],
  ] as const)('never shows the word null on %s row whose default is null', (_kind, type) => {
    render(
      <table>
        <tbody>
          <ParameterRow
            mode="input"
            parameter={makeParameter({ name: 'setting', type, defaultValue: null })}
            value={undefined}
            onChange={vi.fn()}
            availableVariables={[]}
            expressionFields={[]}
            onExpressionFieldsChange={vi.fn()}
            templateFields={[]}
            onTemplateFieldsChange={vi.fn()}
          />
        </tbody>
      </table>,
    )
    expect(shownTexts(screen.getByTestId('param-row-setting'))).not.toMatch(/null/i)
  })
})

describe('MapInput - typed values (REQ-3.1.3.19)', () => {
  const typedParam: Parameter = {
    name: 'driver_options',
    label: 'Driver options',
    type: 'map',
    required: false,
    typedValues: true,
  }

  it('opens a typed map with a type per row, seeded from the setting\'s element types', () => {
    renderLiteralRow(typedParam, { n: '16' }, { elementTypes: { n: 'integer' } })
    fireEvent.click(screen.getByTestId('param-expand-driver_options'))
    const sheet = screen.getByTestId('value-editor-sheet')
    expect(sheet).toHaveAttribute('data-string-values-only', 'false')
    expect(sheet).toHaveAttribute('data-element-types', JSON.stringify({ n: 'integer' }))
  })

  it('saves the rows with their element types and their expression entries', () => {
    const { onChange, onExpressionFieldsChange, onElementTypesChange } = renderLiteralRow(
      typedParam,
      {},
      { expressionFields: ['host'] },
    )
    fireEvent.click(screen.getByTestId('param-expand-driver_options'))
    fireEvent.click(screen.getByTestId('sheet-save-typed'))
    expect(onChange).toHaveBeenCalledWith({ n: '16', app: 'x' })
    expect(onExpressionFieldsChange).toHaveBeenCalledWith(['host', 'driver_options.app'])
    expect(onElementTypesChange).toHaveBeenCalledWith({ n: 'integer' })
  })

  it('keeps a text-only map text-only: no types in, none out', () => {
    const { onElementTypesChange } = renderLiteralRow(plainMapParam, {}, { elementTypes: { n: 'integer' } })
    fireEvent.click(screen.getByTestId('param-expand-data'))
    expect(screen.getByTestId('value-editor-sheet')).toHaveAttribute('data-element-types', 'null')
    fireEvent.click(screen.getByTestId('sheet-save-typed'))
    expect(onElementTypesChange).not.toHaveBeenCalled()
  })

  it('keeps a typed map typed into the field typed, with its element types', () => {
    const { onChange, onElementTypesChange } = renderLiteralRow(typedParam, undefined)
    fireEvent.change(within(screen.getByTestId('param-row-driver_options')).getByRole('textbox'), {
      target: { value: '{"n": 16}' },
    })
    // The number travels as its exact digit text (REQ-3.1.3.14).
    expect(onChange).toHaveBeenLastCalledWith({ n: '16' })
    expect(onElementTypesChange).toHaveBeenLastCalledWith({ n: 'integer' })
  })

  it('drops the element types with a cleared stored map', () => {
    const onElementTypesChange = vi.fn()
    render(
      <MapInput
        parameter={{ ...secretMapParam, typedValues: true }}
        effectiveValue={STORED_SECRET_MAP}
        onChange={vi.fn()}
        onElementTypesChange={onElementTypesChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit protected value' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete & Edit' }))
    expect(onElementTypesChange).toHaveBeenCalledWith(undefined)
  })
})

describe('EnumInput and enumValueOf - edges', () => {
  it('reads a picked text that is not an allowed value as that text', () => {
    expect(enumValueOf([1, 2], 'x')).toBe('x')
    expect(enumValueOf([1, 2], '2')).toBe(2)
  })

  it('offers no options for a row that lists no allowed values', () => {
    render(
      <EnumInput
        parameter={{ name: 'level', type: 'string', required: false }}
        effectiveValue={undefined}
        onChange={vi.fn()}
        showRequiredError={false}
      />,
    )
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })
})
