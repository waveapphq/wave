/**
 * Tests for ValueEditorSheet - the shared "Edit value" floating sheet the
 * Variable Setter opens for a string or complex (array/map/table) row value.
 * It is a pure value editor: a DraggableSheet with a static "Edit value" + type-badge
 * header (NO name input, NO Mode pill), the shared value bodies, and a footer
 * carrying the Kind (string) or View (complex) dropdown plus Close/Save.
 *
 * The per-type value bodies + CodeBody are mocked to stand-ins exposing
 * onChange / onValidChange so this file covers the SHEET's orchestration (which
 * body renders, the footer dropdowns, Save gating, the onSave(value,isTemplate)
 * contract); each body's own behavior lives in its own test file (as the
 * create / inspect modal tests do).
 *
 * A body locked to python or sql is a script editor; its checks and its Get
 * Tables pull come from mocked hooks, and a run in flight turns Run into Stop.
 * A body locked to dql, query-dsl or aggregation-json is an OpenSearch editor;
 * only the Query row runs.
 *
 * REQ-3.1.3.11: Variable Manager UI panel
 * REQ-3.4.1.14: Variable setter control
 * REQ-3.1.3.15: Template variables
 * REQ-3.4.1.6: SQL database operations (SQL-10, SQL-11, SQL-12, SQL-13)
 * REQ-3.4.1.2: Python script execution (PYRUN-13, PYRUN-21)
 * REQ-3.3.2.6: OpenSearch field-based filtering and queries (OS-12)
 * REQ-3.3.3.2: OpenSearch statistics validation (OS-7, OS-12)
 *
 * Design decisions: VMGR-84/85
 */

import * as React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Per-type value bodies: stand-ins exposing onChange / onValidChange so the
// sheet's gating + save wiring can be driven without each body's internals.
function makeEditBodyStub(testid: string, changeValue: unknown) {
  return ({
    onChange,
    onValidChange,
    itemType,
  }: {
    onChange: (v: unknown) => void
    onValidChange: (valid: boolean) => void
    itemType?: string
  }) => (
    <div data-testid={testid} data-item-type={itemType ?? ''}>
      <button data-testid={`${testid}-change`} onClick={() => onChange(changeValue)}>
        change
      </button>
      <button data-testid={`${testid}-invalid`} onClick={() => onValidChange(false)}>
        invalid
      </button>
      <button data-testid={`${testid}-valid`} onClick={() => onValidChange(true)}>
        valid
      </button>
    </div>
  )
}

// The scalar body is CodeMirror, whose editable surface sits inside a scroller
// that is itself tabbable; the stand-in carries the same two elements so the
// sheet's focus target is the one the app has.
function ScalarEditBodyStub({
  onChange,
  onValidChange,
}: {
  onChange: (v: unknown) => void
  onValidChange: (valid: boolean) => void
}) {
  return (
    <div data-testid="scalar-edit-body">
      <div className="cm-scroller" tabIndex={-1} data-testid="scalar-edit-scroller">
        <div className="cm-content" contentEditable data-testid="scalar-edit-surface" />
      </div>
      <button data-testid="scalar-edit-body-change" onClick={() => onChange('typed')}>
        change
      </button>
      <button data-testid="scalar-edit-body-invalid" onClick={() => onValidChange(false)}>
        invalid
      </button>
      <button data-testid="scalar-edit-body-valid" onClick={() => onValidChange(true)}>
        valid
      </button>
    </div>
  )
}

vi.mock('@/components/shared/variable-bodies/scalar-edit-body', () => ({
  ScalarEditBody: ScalarEditBodyStub,
}))
// The real typedListItem stays: a typed list's Code parse reads numbers through it.
vi.mock('@/components/shared/variable-bodies/array-edit-body', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/shared/variable-bodies/array-edit-body')>()),
  ArrayEditBody: makeEditBodyStub('array-edit-body', ['x']),
}))
// MapEditBody stand-in also surfaces the threaded stringValuesOnly so the sheet
// -> useComplexValueEditor -> ComplexValueBody -> MapEditBody wiring is assertable.
vi.mock('@/components/shared/variable-bodies/map-edit-body', () => ({
  MapEditBody: ({
    onChange,
    onValidChange,
    stringValuesOnly,
  }: {
    onChange: (value: Record<string, unknown>, types: Record<string, unknown>) => void
    onValidChange: (valid: boolean) => void
    stringValuesOnly?: boolean
  }) => (
    <div data-testid="map-edit-body" data-string-values-only={String(!!stringValuesOnly)}>
      <button data-testid="map-edit-body-change" onClick={() => onChange({ x: 1 }, { x: 'string' })}>
        change
      </button>
      <button data-testid="map-edit-body-invalid" onClick={() => onValidChange(false)}>
        invalid
      </button>
      <button data-testid="map-edit-body-valid" onClick={() => onValidChange(true)}>
        valid
      </button>
    </div>
  ),
}))
const TYPED_TABLE_SCHEMA = [
  { name: 'zip', type: 'string' },
  { name: 'n', type: 'integer' },
]

// The table stand-in also sets the column schema the way the Visual grid does.
function TableEditBodyStub({
  onChange,
  onValidChange,
  onSchemaChange,
}: {
  onChange: (v: unknown) => void
  onValidChange: (valid: boolean) => void
  onSchemaChange: (schema: unknown) => void
}) {
  return (
    <div data-testid="table-edit-body">
      <button data-testid="table-edit-body-change" onClick={() => onChange([{ a: 1 }])}>
        change
      </button>
      <button data-testid="table-edit-body-invalid" onClick={() => onValidChange(false)}>
        invalid
      </button>
      <button data-testid="table-edit-body-valid" onClick={() => onValidChange(true)}>
        valid
      </button>
      <button
        data-testid="table-edit-body-typed"
        onClick={() => {
          onSchemaChange(TYPED_TABLE_SCHEMA)
          onChange([{ zip: '02134', n: '7' }])
        }}
      >
        typed
      </button>
      <button data-testid="table-edit-body-edit-cell" onClick={() => onChange([{ zip: '02135' }])}>
        edit cell
      </button>
    </div>
  )
}

vi.mock('@/components/shared/variable-bodies/table-edit-body', () => ({
  TableEditBody: TableEditBodyStub,
}))

// CodeBody is the raw-JSON editor behind the complex Visual/Code toggle.
vi.mock('@/components/shared/variable-bodies/code-body', () => ({
  CodeBody: ({
    onChange,
    onValidChange,
  }: {
    onChange?: (value: string) => void
    onValidChange?: (valid: boolean) => void
  }) => (
    <div data-testid="code-body">
      <button
        data-testid="code-bad"
        onClick={() => {
          onChange?.('[bad')
          onValidChange?.(false)
        }}
      >
        bad
      </button>
      <button data-testid="code-ok" onClick={() => onChange?.('["ok"]')}>
        ok
      </button>
      <button data-testid="code-int-list" onClick={() => onChange?.('[1, 2]')}>
        int list
      </button>
      <button data-testid="code-table-rows" onClick={() => onChange?.('[{"name": "a", "n": 7}]')}>
        table rows
      </button>
      <button
        data-testid="code-table-extra"
        onClick={() => onChange?.('[{"zip": "02134", "extra": 1}]')}
      >
        table extra column
      </button>
      <button data-testid="code-table-zip" onClick={() => onChange?.('[{"zip": "02135"}]')}>
        table zip row
      </button>
    </div>
  ),
}))

// The sheet renders what useScriptSyntaxIssues returns; the hook has its own test file.
const scriptSyntax = vi.hoisted(() => ({
  issues: [] as Array<{ line: number; message: string; severity?: 'warning'; from?: number; to?: number; type?: string }>,
  calls: [] as unknown[][],
}))

vi.mock('@/features/workbench/hooks/use-script-syntax-issues', () => ({
  useScriptSyntaxIssues: (...args: unknown[]) => {
    scriptSyntax.calls.push(args)
    return scriptSyntax.issues
  },
}))

// The Get Tables pull belongs to useSqlCatalog; the sheet renders its state and wires its actions.
const sqlCatalog = vi.hoisted(() => ({
  result: null as unknown as UseSqlCatalogResult,
  calls: [] as unknown[],
}))

vi.mock('@/features/workbench/hooks/use-sql-catalog', () => ({
  useSqlCatalog: (request: unknown) => {
    sqlCatalog.calls.push(request)
    return sqlCatalog.result
  },
}))

vi.mock('@/features/workbench/api/sql-tools', () => ({
  checkSql: vi.fn(async () => ({ issues: [] })),
  startCatalog: vi.fn(async () => ({ job_id: 'job-1', cached: false })),
  getCatalog: vi.fn(async () => ({ status: 'connecting' })),
  cancelCatalog: vi.fn(async () => ({ status: 'canceled' })),
}))

// No editor view is mounted behind the body stub, so the insert and the bundle are observed here.
const sqlMode = vi.hoisted(() => ({ build: vi.fn() }))

vi.mock('@/features/workbench/lib/codemirror/sql-mode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/workbench/lib/codemirror/sql-mode')>()
  sqlMode.build.mockImplementation(actual.buildSqlModeExtensions)
  return { ...actual, buildSqlModeExtensions: sqlMode.build }
})

const scriptBody = vi.hoisted(() => ({ insertAtCursor: vi.fn() }))

vi.mock('@/features/workbench/lib/codemirror/script-body', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/workbench/lib/codemirror/script-body')>()
  return { ...actual, insertAtCursor: scriptBody.insertAtCursor }
})

// The OpenSearch bundles run as they are; the spies observe what the sheet composes.
const openSearchModes = vi.hoisted(() => ({ dql: vi.fn(), queryDsl: vi.fn() }))

vi.mock('@/features/workbench/lib/codemirror/dql-mode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/workbench/lib/codemirror/dql-mode')>()
  openSearchModes.dql.mockImplementation(actual.buildDqlModeExtensions)
  return { ...actual, buildDqlModeExtensions: openSearchModes.dql }
})

vi.mock('@/features/workbench/lib/codemirror/query-dsl-mode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/workbench/lib/codemirror/query-dsl-mode')>()
  openSearchModes.queryDsl.mockImplementation(actual.buildQueryDslModeExtensions)
  return { ...actual, buildQueryDslModeExtensions: openSearchModes.queryDsl }
})

const openSearchCompletion = vi.hoisted(() => ({ create: vi.fn((_options: unknown) => () => null) }))

vi.mock('@/features/workbench/lib/codemirror/opensearch-completion', () => ({
  createOpenSearchCompletionSource: openSearchCompletion.create,
}))

// The Get fields pull belongs to useOpenSearchFields; the sheet renders its state and wires its actions.
const openSearchFields = vi.hoisted(() => ({
  result: null as unknown as FieldsPull,
  calls: [] as unknown[],
}))

vi.mock('@/features/workbench/hooks/use-opensearch-fields', () => ({
  useOpenSearchFields: (request: unknown) => {
    openSearchFields.calls.push(request)
    return openSearchFields.result
  },
}))

vi.mock('@/features/workbench/api/opensearch-tools', () => ({
  checkOpenSearch: vi.fn(async () => ({ issues: [] })),
  suggestOpenSearch: vi.fn(async () => ({ from: 0, to: 0, items: [] })),
  startFields: vi.fn(async () => ({ job_id: 'fields-job-1', cached: false })),
  getFields: vi.fn(async () => ({ status: 'connecting' })),
  cancelFields: vi.fn(async () => ({ status: 'canceled' })),
}))

const sqlCompletion = vi.hoisted(() => ({ create: vi.fn((_options: unknown) => () => null) }))

vi.mock('@/features/workbench/lib/codemirror/sql-completion', () => ({
  createSqlCompletionSource: sqlCompletion.create,
}))

// The interpreter's own syntax check (and the two tools the editor extensions
// reach for) never leave the test process.
const pythonTools = vi.hoisted(() => ({
  checkPython: vi.fn(async () => ({
    issues: [] as { line: number; column: number; message: string }[],
  })),
}))

vi.mock('@/features/workbench/api/python-tools', () => ({
  checkPython: pythonTools.checkPython,
  completePython: vi.fn(async () => ({ items: [] })),
  renamePython: vi.fn(async () => ({ edits: [] })),
}))

import {
  ChildEditorParent,
  applyParentChildren,
  parentChildren,
} from '../../../../../utils/child-editor-parent'
import { DraggableSheet } from '@/components/shared/draggable-sheet'
import { ValueEditorSheet } from '@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet'
import type { UseSqlCatalogResult } from '@/features/workbench/hooks/use-sql-catalog'
import type { OpenSearchField, OpenSearchIndex } from '@/features/workbench/api/opensearch-tools'
import { SAMPLE_CATALOG_REQUEST, SAMPLE_SCRIPT, SAMPLE_TABLES } from '../../../sql-fixtures'
import {
  SAMPLE_AGGREGATION_JSON,
  SAMPLE_DQL,
  SAMPLE_FIELDS,
  SAMPLE_FIELDS_REQUEST,
  SAMPLE_INDEXES,
  SAMPLE_QUERY_DSL,
} from '../../../opensearch-fixtures'

/** What useOpenSearchFields answers. */
interface FieldsPull {
  state: 'idle' | 'connecting' | 'reading' | 'done' | 'settled' | 'failed'
  fields: readonly OpenSearchField[] | null
  indexes: readonly OpenSearchIndex[] | null
  jobId: string | null
  count: number
  error: string | null
  start: () => void
  stop: () => void
  refresh: () => void
  settle: () => void
}

function fieldsResult(overrides: Partial<FieldsPull> = {}): FieldsPull {
  return {
    state: 'idle',
    fields: null,
    indexes: null,
    jobId: null,
    count: 0,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    refresh: vi.fn(),
    settle: vi.fn(),
    ...overrides,
  }
}

function loadedFields(state: 'done' | 'settled'): FieldsPull {
  return fieldsResult({
    state,
    fields: SAMPLE_FIELDS,
    indexes: SAMPLE_INDEXES,
    jobId: 'fields-job-1',
    count: SAMPLE_FIELDS.length,
  })
}

function catalogResult(overrides: Partial<UseSqlCatalogResult> = {}): UseSqlCatalogResult {
  return {
    state: 'idle',
    tables: null,
    count: 0,
    error: null,
    start: vi.fn(),
    stop: vi.fn(),
    refresh: vi.fn(),
    settle: vi.fn(),
    ...overrides,
  }
}

type ScriptCall = [string, string, string | null, Record<string, unknown>]

function lastScriptCall(): ScriptCall {
  return scriptSyntax.calls.at(-1) as ScriptCall
}

interface RenderOverrides {
  name?: string
  type?: string
  value?: unknown
  isTemplate?: boolean
  allowTemplate?: boolean
  allowedFormats?: string[]
  stringValuesOnly?: boolean
  captureEsc?: boolean
  itemType?: string
  onSave?: (value: unknown, isTemplate: boolean) => void
  onClose?: () => void
}

function renderSheet(overrides: RenderOverrides = {}) {
  const onSave = vi.fn(overrides.onSave)
  const onClose = vi.fn(overrides.onClose)
  render(
    <ValueEditorSheet
      label="Value"
      name={overrides.name ?? 'greeting'}
      type={(overrides.type ?? 'string') as never}
      value={overrides.value ?? ''}
      isTemplate={overrides.isTemplate ?? false}
      allowTemplate={overrides.allowTemplate}
      allowedFormats={overrides.allowedFormats as never}
      stringValuesOnly={overrides.stringValuesOnly}
      captureEsc={overrides.captureEsc}
      itemType={overrides.itemType as never}
      availableVariables={[]}
      onSave={onSave}
      onClose={onClose}
    />,
  )
  return { onSave, onClose }
}

async function pickFromSelect(
  user: ReturnType<typeof userEvent.setup>,
  triggerTestId: string,
  optionLabel: string,
) {
  await user.click(screen.getByTestId(triggerTestId))
  const options = await screen.findAllByRole('option')
  const option = options.find((o) => (o.textContent ?? '').includes(optionLabel))
  if (!option) throw new Error(`Select option "${optionLabel}" not found`)
  await user.click(option)
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  scriptSyntax.issues = []
  scriptSyntax.calls = []
  sqlCatalog.result = catalogResult()
  sqlCatalog.calls = []
  openSearchFields.result = fieldsResult()
  openSearchFields.calls = []
})

describe('ValueEditorSheet - shell', () => {
  it('renders the floating value-editor sheet', () => {
    renderSheet()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
  })

  it('shows the static "Edit value" header', () => {
    renderSheet()
    expect(screen.getByText('Edit value')).toBeInTheDocument()
  })

  it('makes "Edit value" the heading of the sheet', () => {
    renderSheet()
    expect(
      within(screen.getByTestId('value-editor-sheet')).getByRole('heading', { level: 2, name: 'Edit value' }),
    ).toBeInTheDocument()
  })

  it('shows a type badge for the edited value', () => {
    renderSheet({ type: 'string' })
    expect(screen.getByTestId('value-editor-type-badge')).toHaveTextContent(/string/i)
  })

  it('does NOT show the variable name in the header (no name input / rename)', () => {
    renderSheet({ name: 'greeting' })
    // The name + rename are row concerns; the sheet edits the value only.
    expect(screen.queryByText('greeting')).not.toBeInTheDocument()
    expect(screen.queryByText('Name')).not.toBeInTheDocument()
  })

  it('does NOT show a Mode pill (the setter has no Initial/Current modes)', () => {
    renderSheet()
    expect(screen.queryByTestId('mode-dropdown')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mode-pill')).not.toBeInTheDocument()
  })

  it('renders Cancel and Save in the footer', () => {
    renderSheet()
    expect(screen.getByTestId('value-editor-cancel-button')).toBeInTheDocument()
    expect(screen.getByTestId('value-editor-save-button')).toBeInTheDocument()
  })
})

describe('ValueEditorSheet - string literal', () => {
  it('renders the string scalar body', () => {
    renderSheet({ type: 'string' })
    expect(screen.getByTestId('scalar-edit-body')).toBeInTheDocument()
  })

  it('shows the Kind dropdown and (for Literal) the Format dropdown', () => {
    renderSheet({ type: 'string', isTemplate: false })
    expect(screen.getByTestId('kind-dropdown')).toBeInTheDocument()
    expect(screen.getByTestId('format-dropdown')).toBeInTheDocument()
  })

  it('changing the Format dropdown updates the selected format', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'string', value: 'hi', isTemplate: false })
    await pickFromSelect(user, 'format-dropdown', 'JSON')
    expect(screen.getByTestId('format-dropdown')).toHaveTextContent('JSON')
  })

  it('does NOT show the View dropdown for a string value', () => {
    renderSheet({ type: 'string' })
    expect(screen.queryByTestId('view-dropdown')).not.toBeInTheDocument()
  })

  it('saves (value, isTemplate=false) for a literal string', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ type: 'string', value: 'hi', isTemplate: false })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onSave).toHaveBeenCalledWith('typed', false, [], undefined)
  })
})

describe('ValueEditorSheet - allowTemplate (literal-only consumers)', () => {
  it('shows the Kind dropdown by default (allowTemplate defaults to true)', () => {
    renderSheet({ type: 'string' })
    expect(screen.getByTestId('kind-dropdown')).toBeInTheDocument()
  })

  it('suppresses the Kind dropdown when allowTemplate is false', () => {
    renderSheet({ type: 'string', allowTemplate: false })
    expect(screen.queryByTestId('kind-dropdown')).not.toBeInTheDocument()
  })

  it('keeps the Format dropdown when allowTemplate is false (forced literal, not template)', () => {
    renderSheet({ type: 'string', allowTemplate: false })
    expect(screen.queryByTestId('kind-dropdown')).not.toBeInTheDocument()
    expect(screen.getByTestId('format-dropdown')).toBeInTheDocument()
  })

  it('forces literal kind even when isTemplate is seeded true and allowTemplate is false', () => {
    // A template would hide the Format dropdown; forced-literal keeps it visible.
    renderSheet({ type: 'string', isTemplate: true, allowTemplate: false })
    expect(screen.queryByTestId('kind-dropdown')).not.toBeInTheDocument()
    expect(screen.getByTestId('format-dropdown')).toBeInTheDocument()
  })

  it('saves a literal when allowTemplate is false, even for a seeded template value', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({
      type: 'string',
      value: 'Hi {{ name }}',
      isTemplate: true,
      allowTemplate: false,
    })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onSave).toHaveBeenCalledWith('typed', false, [], undefined)
  })
})

describe('ValueEditorSheet - string Format button (live format)', () => {
  it('shows the Format button for a data-format (JSON) string', () => {
    renderSheet({ type: 'string', value: '{"a":1}' })
    expect(screen.getByTestId('value-editor-string-format-button')).toBeInTheDocument()
  })

  it('hides the Format button for a plain string', () => {
    renderSheet({ type: 'string', value: 'hello' })
    expect(screen.queryByTestId('value-editor-string-format-button')).not.toBeInTheDocument()
  })

  it('shows the Format button for a JSON string even when allowTemplate=false (profiles)', () => {
    renderSheet({ type: 'string', value: '{"a":1}', allowTemplate: false })
    expect(screen.getByTestId('value-editor-string-format-button')).toBeInTheDocument()
  })

  it('pretty-prints the draft and saves the formatted (multi-line) value', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ type: 'string', value: '{"a":1}' })
    await user.click(screen.getByTestId('value-editor-string-format-button'))
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onSave).toHaveBeenCalledWith(expect.stringContaining('\n'), false, [], undefined)
  })

  it('hides the Format button for a complex value', () => {
    renderSheet({ type: 'array', value: [] })
    expect(screen.queryByTestId('value-editor-string-format-button')).not.toBeInTheDocument()
  })
})

describe('ValueEditorSheet - string template', () => {
  it('seeds Kind=Template when isTemplate is true', () => {
    renderSheet({ type: 'string', isTemplate: true })
    expect(screen.getByTestId('kind-dropdown')).toHaveTextContent('Template')
  })

  it('hides the Format dropdown while Kind is Template', () => {
    renderSheet({ type: 'string', isTemplate: true })
    expect(screen.queryByTestId('format-dropdown')).not.toBeInTheDocument()
  })

  it('saves (value, isTemplate=true) for a template string', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ type: 'string', value: 'Hi {{ name }}', isTemplate: true })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onSave).toHaveBeenCalledWith('typed', true, [], undefined)
  })

  it('switching Kind Literal -> Template hides Format and saves as a template', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ type: 'string', value: 'plain', isTemplate: false })
    expect(screen.getByTestId('format-dropdown')).toBeInTheDocument()
    await pickFromSelect(user, 'kind-dropdown', 'Template')
    expect(screen.queryByTestId('format-dropdown')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onSave).toHaveBeenCalledWith('plain', true, [], undefined)
  })
})

describe('ValueEditorSheet - complex value', () => {
  it('renders the array body and the View dropdown, but no Kind/Format dropdown', () => {
    renderSheet({ type: 'array', value: [] })
    expect(screen.getByTestId('array-edit-body')).toBeInTheDocument()
    expect(screen.getByTestId('view-dropdown')).toBeInTheDocument()
    expect(screen.queryByTestId('kind-dropdown')).not.toBeInTheDocument()
    expect(screen.queryByTestId('format-dropdown')).not.toBeInTheDocument()
  })

  it('renders the map body for a map value', () => {
    renderSheet({ type: 'map', value: {} })
    expect(screen.getByTestId('map-edit-body')).toBeInTheDocument()
  })

  it('renders the table body for a table value', () => {
    renderSheet({ type: 'table', value: [] })
    expect(screen.getByTestId('table-edit-body')).toBeInTheDocument()
  })

  it('saves (value, isTemplate=false) for a complex value', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ type: 'array', value: [] })
    await user.click(screen.getByTestId('array-edit-body-change'))
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onSave).toHaveBeenCalledWith(['x'], false, [], ['string'])
  })

  it('switches the array body to the Code editor with a Format button', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'array', value: [] })
    await pickFromSelect(user, 'view-dropdown', 'Code')
    expect(await screen.findByTestId('code-body')).toBeInTheDocument()
    expect(screen.getByTestId('value-editor-format-button')).toBeInTheDocument()
  })

  it('clicking Format in Code view re-validates without crashing (Save stays enabled)', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'array', value: [] })
    await pickFromSelect(user, 'view-dropdown', 'Code')
    await user.click(await screen.findByTestId('code-ok'))
    await user.click(await screen.findByTestId('value-editor-format-button'))
    expect(screen.getByTestId('value-editor-save-button')).not.toBeDisabled()
  })

  it('switches an array value from Code back to Visual', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'array', value: [] })
    await pickFromSelect(user, 'view-dropdown', 'Code')
    expect(await screen.findByTestId('code-body')).toBeInTheDocument()
    await pickFromSelect(user, 'view-dropdown', 'Visual')
    expect(await screen.findByTestId('array-edit-body')).toBeInTheDocument()
  })

  it('re-seeds the table schema when a table switches back to Visual', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'table', value: [] })
    await pickFromSelect(user, 'view-dropdown', 'Code')
    expect(await screen.findByTestId('code-body')).toBeInTheDocument()
    await pickFromSelect(user, 'view-dropdown', 'Visual')
    expect(await screen.findByTestId('table-edit-body')).toBeInTheDocument()
  })

  it('disables Save when the complex Code JSON is invalid', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'array', value: [] })
    await pickFromSelect(user, 'view-dropdown', 'Code')
    await user.click(await screen.findByTestId('code-bad'))
    expect(screen.getByTestId('value-editor-save-button')).toBeDisabled()
  })

  // The sheet seeds a valid empty shape for a type/value mismatch, such as a
  // complex row whose value is '' (an existing-var selection).
  it('coerces a non-array value to an empty array for an array type', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ type: 'array', value: 'oops' })
    expect(screen.getByTestId('array-edit-body')).toBeInTheDocument()
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onSave).toHaveBeenCalledWith([], false, [], [])
  })

  it('coerces a non-object value to an empty map for a map type', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ type: 'map', value: 'oops' })
    expect(screen.getByTestId('map-edit-body')).toBeInTheDocument()
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onSave).toHaveBeenCalledWith({}, false, [], {})
  })

  it('coerces a value that is no table to an empty table for a table type', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ type: 'table', value: 'oops' })
    expect(screen.getByTestId('table-edit-body')).toBeInTheDocument()
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onSave).toHaveBeenCalledWith([], false, [], undefined)
  })
})

describe('ValueEditorSheet - tables saved with their column types (REQ-3.5.5.1)', () => {
  const ZIP_TABLE = { columns: [{ name: 'zip', type: 'string' }], rows: [['02134']] }
  const CALLERS = [
    ['a value cell or the Variable Setter', {}],
    ['a literal-only caller', { allowTemplate: false }],
    ['a caller inside a dialog', { captureEsc: true }],
  ] as const

  it.each(CALLERS)(
    'saves a table edited in the Visual view as {columns, rows} with its column types (%s)',
    async (_caller, props) => {
      const user = userEvent.setup()
      const { onSave } = renderSheet({ type: 'table', value: [], ...props })
      await user.click(screen.getByTestId('table-edit-body-typed'))
      await user.click(screen.getByTestId('value-editor-save-button'))
      expect(onSave).toHaveBeenCalledWith(
        { columns: TYPED_TABLE_SCHEMA, rows: [['02134', '7']] },
        false,
        [],
        undefined,
      )
    },
  )

  it('keeps the column types of a table that opens in its stored typed form', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ type: 'table', value: ZIP_TABLE })
    await user.click(screen.getByTestId('table-edit-body-edit-cell'))
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onSave).toHaveBeenCalledWith(
      { columns: [{ name: 'zip', type: 'string' }], rows: [['02135']] },
      false,
      [],
      undefined,
    )
  })

  it('a table with no columns takes them from the first rows typed in the Code view', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ type: 'table', value: [] })
    await pickFromSelect(user, 'view-dropdown', 'Code')
    await user.click(await screen.findByTestId('code-table-rows'))
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onSave).toHaveBeenCalledWith(
      {
        columns: [
          { name: 'name', type: 'string' },
          { name: 'n', type: 'integer' },
        ],
        rows: [['a', '7']],
      },
      false,
      [],
      undefined,
    )
  })

  it('keeps the column types of rows edited in the Code view', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ type: 'table', value: ZIP_TABLE })
    await pickFromSelect(user, 'view-dropdown', 'Code')
    await user.click(await screen.findByTestId('code-table-zip'))
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onSave).toHaveBeenCalledWith(
      { columns: [{ name: 'zip', type: 'string' }], rows: [['02135']] },
      false,
      [],
      undefined,
    )
  })

  it('refuses a column the table does not have in the Code view (VMGR-71)', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'table', value: ZIP_TABLE })
    await pickFromSelect(user, 'view-dropdown', 'Code')
    await user.click(await screen.findByTestId('code-table-extra'))
    expect(screen.getByTestId('value-editor-validation')).toHaveTextContent(
      /^Unexpected column "extra" - change columns in the Visual view$/,
    )
    expect(screen.getByTestId('value-editor-save-button')).toBeDisabled()
  })
})

describe('ValueEditorSheet - a list typed by its item type (VMGR-100)', () => {
  it('hands the item type to the list body', () => {
    renderSheet({ type: 'array', value: [1], itemType: 'integer' })
    expect(screen.getByTestId('array-edit-body')).toHaveAttribute('data-item-type', 'integer')
  })

  it('reads numbers typed in the Code view as the item type and stores no element types', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ type: 'array', value: [], itemType: 'integer' })
    await pickFromSelect(user, 'view-dropdown', 'Code')
    await user.click(await screen.findByTestId('code-int-list'))
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onSave).toHaveBeenCalledWith([1, 2], false, [], undefined)
  })

  it('a list with no item type keeps the element type of each typed number', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ type: 'array', value: [] })
    await pickFromSelect(user, 'view-dropdown', 'Code')
    await user.click(await screen.findByTestId('code-int-list'))
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onSave).toHaveBeenCalledWith(['1', '2'], false, [], ['integer', 'integer'])
  })
})

// ============================================================================
// Element-config consumers thread two restrictions through the sheet:
//   - allowedFormats restricts the literal-string Format dropdown options
//   - stringValuesOnly keeps a param map string->string
// ============================================================================

describe('ValueEditorSheet - allowedFormats', () => {
  // A multi-format allowedFormats restricts but stays ENABLED (Auto + the set). A
  // SINGLE allowedFormats LOCKS the picker - see the locked-format block.
  it('restricts the Format dropdown to the permitted data formats (Auto always offered)', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'string', value: 'hi', allowedFormats: ['json', 'yaml'] })
    await user.click(screen.getByTestId('format-dropdown'))
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent?.trim())).toEqual(['Auto', 'JSON', 'YAML'])
  })

  it('keeps the full Format menu when allowedFormats is omitted', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'string', value: 'hi' })
    await user.click(screen.getByTestId('format-dropdown'))
    const options = await screen.findAllByRole('option')
    expect(options.length).toBeGreaterThan(1)
    expect(screen.getByRole('option', { name: 'XML' })).toBeInTheDocument()
  })
})

describe('ValueEditorSheet - stringValuesOnly', () => {
  it('threads stringValuesOnly down to the map body', () => {
    renderSheet({ type: 'map', value: {}, stringValuesOnly: true })
    expect(screen.getByTestId('map-edit-body')).toHaveAttribute('data-string-values-only', 'true')
  })

  it('leaves the map body unrestricted by default (setter / manager)', () => {
    renderSheet({ type: 'map', value: {} })
    expect(screen.getByTestId('map-edit-body')).toHaveAttribute('data-string-values-only', 'false')
  })
})

// ============================================================================
// A single allowedFormats LOCKS the string Format picker (disabled,
// pinned, no Auto). For a locked DATA format (json/xml), a LITERAL body is
// validated eagerly - an invalid literal shows the blocking ValidationStrip and
// disables Save; Template/Expression bodies bypass it. A locked plain field is
// always valid (Save normal).
// ============================================================================

describe('ValueEditorSheet - locked format', () => {
  it('disables the Format picker and pins it to JSON for a locked-json field', () => {
    renderSheet({ type: 'string', value: '{"a":1}', allowedFormats: ['json'] })
    const picker = screen.getByTestId('format-dropdown')
    expect(picker).toBeDisabled()
    expect(picker).not.toHaveTextContent('Auto')
  })

  it('shows no Format picker for a field that only takes plain text', () => {
    renderSheet({ type: 'string', value: 'https://x', allowedFormats: ['plain'] })
    expect(screen.queryByTestId('format-dropdown')).not.toBeInTheDocument()
    expect(screen.getByTestId('kind-dropdown')).toBeInTheDocument()
  })

  it('shows the blocking strip and disables Save for an invalid locked-json literal', () => {
    renderSheet({ type: 'string', value: '{bad', allowedFormats: ['json'] })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByTestId('value-editor-save-button')).toBeDisabled()
  })

  it('shows no strip and keeps Save enabled for a valid locked-json literal', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'string', value: '{"a":1}', allowedFormats: ['json'] })
    // Save is dead until the draft moves (PYRUN-20); pretty-print moves it and
    // leaves the literal valid.
    await user.click(screen.getByTestId('value-editor-string-format-button'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('value-editor-save-button')).not.toBeDisabled()
  })

  it('bypasses literal validation for a Template body (resolved at runtime)', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'string', value: '{bad', allowedFormats: ['json'], isTemplate: true })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('value-editor-save-button')).not.toBeDisabled()
  })

  it('keeps Save enabled for a locked-plain literal (plain is always valid)', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'string', value: 'anything goes here', allowedFormats: ['plain'] })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('value-editor-save-button')).not.toBeDisabled()
  })
})

describe('ValueEditorSheet - cancel', () => {
  it('closes without saving when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderSheet()
    await user.click(screen.getByTestId('value-editor-cancel-button'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Unsaved-draft guard: every dismissal path except the editor's own Save
// raises the same "Unsaved changes" confirm the element-config sheet uses
// (Keep Editing / Close / Save); a clean draft closes silently as before.
// ============================================================================

describe('ValueEditorSheet - unsaved-draft guard', () => {
  const closeButton = () => screen.getByRole('button', { name: 'Close value editor' })

  async function renderDirty(user: ReturnType<typeof userEvent.setup>, overrides: RenderOverrides = {}) {
    const handlers = renderSheet({ type: 'string', value: 'hi', ...overrides })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    return handlers
  }

  it('raises the Unsaved changes dialog instead of closing on X with a dirty draft', async () => {
    const user = userEvent.setup()
    const { onClose } = await renderDirty(user)
    await user.click(closeButton())
    expect(screen.getByTestId('value-editor-unsaved-dialog')).toBeInTheDocument()
    expect(screen.getByText('You have unsaved changes. What would you like to do?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
  })

  it('raises the dialog instead of closing on Cancel with a dirty draft', async () => {
    const user = userEvent.setup()
    const { onClose } = await renderDirty(user)
    await user.click(screen.getByTestId('value-editor-cancel-button'))
    expect(screen.getByTestId('value-editor-unsaved-dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('raises the dialog instead of closing on Escape with a dirty draft', async () => {
    const user = userEvent.setup()
    const { onClose } = await renderDirty(user)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('value-editor-unsaved-dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
  })

  it('Keep Editing dismisses the dialog and keeps the draft intact', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = await renderDirty(user)
    await user.click(closeButton())
    await user.click(screen.getByTestId('value-editor-unsaved-keep-button'))
    expect(screen.queryByTestId('value-editor-unsaved-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    // The kept draft still saves through the editor's own Save.
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(onSave).toHaveBeenCalledWith('typed', false, [], undefined)
  })

  it('Close closes the editor without committing the draft', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = await renderDirty(user)
    await user.click(closeButton())
    await user.click(screen.getByTestId('value-editor-unsaved-discard-button'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('dialog Save commits exactly like the editor Save, then closes the sheet', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = await renderDirty(user)
    await user.click(closeButton())
    await user.click(screen.getByTestId('value-editor-unsaved-save-button'))
    expect(onSave).toHaveBeenCalledExactlyOnceWith('typed', false, [], undefined)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('disables the dialog Save while the draft is invalid', async () => {
    const user = userEvent.setup()
    await renderDirty(user)
    await user.click(screen.getByTestId('scalar-edit-body-invalid'))
    await user.click(closeButton())
    expect(screen.getByTestId('value-editor-unsaved-save-button')).toBeDisabled()
  })

  it('a Kind switch alone counts as a dirty draft', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ type: 'string', value: 'plain', isTemplate: false })
    await pickFromSelect(user, 'kind-dropdown', 'Template')
    await user.click(closeButton())
    expect(screen.getByTestId('value-editor-unsaved-dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes silently on Escape when the draft is clean', () => {
    const { onClose } = renderSheet({ type: 'string', value: 'hi' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('value-editor-unsaved-dialog')).not.toBeInTheDocument()
  })

  it('closes silently on X when the draft is clean', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ type: 'string', value: 'hi' })
    await user.click(closeButton())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('value-editor-unsaved-dialog')).not.toBeInTheDocument()
  })

  it('closes a clean complex draft silently on X', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ type: 'map', value: { k: 'v' } })
    await user.click(closeButton())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('value-editor-unsaved-dialog')).not.toBeInTheDocument()
  })

  // Credential-shaped field (locked plain format, literal-only): the guard
  // compares against the actual committed value, not any masked rendering.
  it('guards a retyped credential-shaped field against Escape', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({
      type: 'string',
      value: 'stored-secret',
      allowTemplate: false,
      allowedFormats: ['plain'],
    })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('value-editor-unsaved-dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes an untouched credential-shaped field silently on Escape', () => {
    const { onClose } = renderSheet({
      type: 'string',
      value: 'stored-secret',
      allowTemplate: false,
      allowedFormats: ['plain'],
    })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('value-editor-unsaved-dialog')).not.toBeInTheDocument()
  })
})

// ============================================================================
// Unsaved-draft guard - template kind and expression keys: the guard's initial
// snapshot mirrors a template-seeded kind and a mapEntryOptions expression-key
// seed, so an untouched draft still closes silently on those editors.
// ============================================================================

describe('ValueEditorSheet - unsaved-draft guard (template kind / expression keys)', () => {
  const closeButton = () => screen.getByRole('button', { name: 'Close value editor' })

  function renderMapEntrySheet(expressionKeys: string[]) {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(
      <ValueEditorSheet
        label="Value"
        name="headers"
        type={'map' as never}
        value={{ Authorization: 'x' }}
        isTemplate={false}
        mapEntryOptions={{ expressionKeys }}
        availableVariables={[]}
        onSave={onSave}
        onClose={onClose}
      />,
    )
    return { onSave, onClose }
  }

  it('closes an untouched template draft silently on X', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ type: 'string', value: 'Hi {{ name }}', isTemplate: true })
    await user.click(closeButton())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('value-editor-unsaved-dialog')).not.toBeInTheDocument()
  })

  it('guards an edited template draft on X', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ type: 'string', value: 'Hi {{ name }}', isTemplate: true })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(closeButton())
    expect(screen.getByTestId('value-editor-unsaved-dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes an untouched map draft with seeded expression keys silently on X', async () => {
    const user = userEvent.setup()
    const { onClose } = renderMapEntrySheet(['Authorization'])
    await user.click(closeButton())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('value-editor-unsaved-dialog')).not.toBeInTheDocument()
  })

  it('guards an edited map draft with seeded expression keys on X', async () => {
    const user = userEvent.setup()
    const { onClose } = renderMapEntrySheet(['Authorization'])
    await user.click(screen.getByTestId('map-edit-body-change'))
    await user.click(closeButton())
    expect(screen.getByTestId('value-editor-unsaved-dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

// ============================================================================
// captureEsc: hosts inside a dialog that owns ESC (VariableValueCell) delegate
// their capture-phase ESC interception to the sheet, so ESC still routes
// through the unsaved-draft guard.
// ============================================================================

describe('ValueEditorSheet - captureEsc', () => {
  it('closes a clean draft on capture-phase Escape', () => {
    const { onClose } = renderSheet({ type: 'string', value: 'hi', captureEsc: true })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores a non-Escape key', () => {
    const { onClose } = renderSheet({ type: 'string', value: 'hi', captureEsc: true })
    fireEvent.keyDown(document, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
  })

  it('keeps the guard on Escape after a click inside an editor nested in a host sheet', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onHostClose = vi.fn()
    render(
      <DraggableSheet
        open
        onClose={onHostClose}
        ariaLabel="Host Sheet"
        header={<span>Host</span>}
        data-testid="host-sheet"
      >
        <ValueEditorSheet
          label="Value"
          name=""
          type={'string' as never}
          value="hi"
          isTemplate={false}
          availableVariables={[]}
          captureEsc
          onSave={vi.fn()}
          onClose={onClose}
        />
      </DraggableSheet>,
    )
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('value-editor-unsaved-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(onHostClose).not.toHaveBeenCalled()
  })

  it('lets an open Kind dropdown consume the Escape instead of closing the sheet', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ type: 'string', value: 'hi', captureEsc: true })
    await user.click(screen.getByTestId('kind-dropdown'))
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByTestId('value-editor-unsaved-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
  })

  it('raises the guard on Escape with a dirty draft, and a second Escape keeps editing', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ type: 'string', value: 'hi', captureEsc: true })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('value-editor-unsaved-dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('value-editor-unsaved-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

// ============================================================================
// PYRUN-13 / PYRUN-21: Python mode. A locked `python` format turns the shared
// sheet into the script editor - no Kind, Format or pretty-print control, one
// F1 Help chip on the footer left, a syntax-issue strip that never blocks
// Save, and a Close / Save / Run footer whose Run never writes the value.
// ============================================================================

const PYTHON_SCRIPT = 'import statistics\n\nmean_temp = statistics.mean(values)\n'

const TIP_SECTIONS = ['Inputs', 'Outputs', 'Logging and failure', 'Files and modules']

interface PythonOverrides {
  value?: string
  runBusy?: boolean
  runAllowed?: boolean
  runBlockedNote?: string | null
  interpreter?: string
}

const PYTHON_INPUT_VARIABLES = [
  { name: 'values', type: 'array' },
  { name: 'label', type: 'string' },
]
const PYTHON_INPUT_TYPES = { values: 'array' }

function renderPythonSheet(overrides: PythonOverrides = {}) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  const onRun = vi.fn()
  const onStop = vi.fn()
  const onRenameSymbol = vi.fn()
  const { container } = render(
    <ValueEditorSheet
      label="Value"
      name="script"
      type="string"
      value={overrides.value ?? PYTHON_SCRIPT}
      isTemplate={false}
      allowedFormats={['python']}
      availableVariables={[]}
      inputVariables={PYTHON_INPUT_VARIABLES}
      inputVariableTypes={PYTHON_INPUT_TYPES}
      exportNames={['mean_temp']}
      interpreter={overrides.interpreter ?? '{{py}}'}
      runBusy={overrides.runBusy ?? false}
      runAllowed={overrides.runAllowed ?? true}
      runBlockedNote={overrides.runBlockedNote}
      onRun={onRun}
      onStop={onStop}
      onRenameSymbol={onRenameSymbol}
      onSave={onSave}
      onClose={onClose}
    />,
  )
  return { container, onSave, onClose, onRun, onStop, onRenameSymbol }
}

const sheetRoot = () => screen.getByTestId('value-editor-sheet')
const helpChip = () => screen.getByTestId('value-editor-help-chip')
const runButton = () => screen.getByRole('button', { name: 'Run' })
const saveButton = () => screen.getByTestId('value-editor-save-button')

// `.btn:disabled` (app/index.css) is what paints opacity .5 + not-allowed.
function expectRealDisabled(button: HTMLElement) {
  expect(button).toBeDisabled()
  expect(button.className).toMatch(/\bbtn\b/)
}

async function openHelp(user: ReturnType<typeof userEvent.setup>) {
  await user.click(helpChip())
  return screen.findByRole('dialog', { name: 'Keyboard' })
}

describe('ValueEditorSheet - Python mode footer (PYRUN-13)', () => {
  it('renders the script body without the Kind or Format dropdown', () => {
    renderPythonSheet()
    expect(screen.getByTestId('scalar-edit-body')).toBeInTheDocument()
    expect(screen.queryByTestId('kind-dropdown')).not.toBeInTheDocument()
    expect(screen.queryByTestId('format-dropdown')).not.toBeInTheDocument()
  })

  it('offers no pretty-print button in Python mode', () => {
    renderPythonSheet()
    expect(screen.queryByTestId('value-editor-string-format-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('value-editor-format-button')).not.toBeInTheDocument()
  })

  it('carries the F1 Help chip', () => {
    renderPythonSheet()
    expect(helpChip()).toHaveTextContent('F1')
    expect(helpChip()).toHaveTextContent('Help')
  })

  it('carries no other chip beside F1 Help', () => {
    renderPythonSheet()
    expect(screen.queryByTestId('view-dropdown')).not.toBeInTheDocument()
    expect(screen.queryByTestId('value-editor-metric')).not.toBeInTheDocument()
  })

  it('renders Close, Save and Run on the footer right', () => {
    renderPythonSheet()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(saveButton()).toBeInTheDocument()
    expect(runButton()).toBeInTheDocument()
  })
})

describe('ValueEditorSheet - Python help popover (PYRUN-13)', () => {
  it('opens the help popover on F1', async () => {
    renderPythonSheet()
    fireEvent.keyDown(sheetRoot(), { key: 'F1' })
    expect(await screen.findByRole('dialog', { name: 'Keyboard' })).toBeInTheDocument()
    expect(screen.getByTestId('python-help-popover')).toBeInTheDocument()
  })

  it('opens the help popover when the chip is clicked', async () => {
    const user = userEvent.setup()
    renderPythonSheet()
    const popover = await openHelp(user)
    expect(within(popover).getByText('Keyboard')).toBeInTheDocument()
  })

  it('keeps the tips collapsed behind a Show tips toggle', async () => {
    const user = userEvent.setup()
    renderPythonSheet()
    const popover = await openHelp(user)
    expect(within(popover).getByRole('button', { name: 'Show tips' })).toBeInTheDocument()
    expect(within(popover).queryByText('Inputs')).not.toBeInTheDocument()
  })

  it('expands the tips and flips the toggle to Hide tips', async () => {
    const user = userEvent.setup()
    renderPythonSheet()
    const popover = await openHelp(user)
    await user.click(within(popover).getByRole('button', { name: 'Show tips' }))
    expect(within(popover).getByRole('button', { name: 'Hide tips' })).toBeInTheDocument()
  })

  it('shows the four tip subsections while the tips are open', async () => {
    const user = userEvent.setup()
    renderPythonSheet()
    const popover = await openHelp(user)
    await user.click(within(popover).getByRole('button', { name: 'Show tips' }))
    for (const section of TIP_SECTIONS) {
      expect(within(popover).getByText(section)).toBeInTheDocument()
    }
  })

  it('collapses the tips again on a second toggle', async () => {
    const user = userEvent.setup()
    renderPythonSheet()
    const popover = await openHelp(user)
    await user.click(within(popover).getByRole('button', { name: 'Show tips' }))
    await user.click(within(popover).getByRole('button', { name: 'Hide tips' }))
    expect(within(popover).getByRole('button', { name: 'Show tips' })).toBeInTheDocument()
    expect(within(popover).queryByText('Inputs')).not.toBeInTheDocument()
  })

  it('closes the popover with its X control', async () => {
    const user = userEvent.setup()
    renderPythonSheet()
    const popover = await openHelp(user)
    await user.click(within(popover).getByRole('button', { name: 'Close help' }))
    expect(screen.queryByTestId('python-help-popover')).not.toBeInTheDocument()
    expect(sheetRoot()).toBeInTheDocument()
  })

  it('closes the popover on Escape and leaves the sheet open', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPythonSheet()
    await openHelp(user)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('python-help-popover')).not.toBeInTheDocument()
    expect(sheetRoot()).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('returns focus to the editor when Escape closes the popover', async () => {
    const user = userEvent.setup()
    renderPythonSheet()
    await openHelp(user)
    fireEvent.keyDown(document, { key: 'Escape' })
    const editor = screen.getByTestId('scalar-edit-body')
    const active = document.activeElement as HTMLElement
    expect(sheetRoot().contains(active)).toBe(true)
    expect(editor.contains(active) || active.contains(editor)).toBe(true)
  })

  it('closes the popover on a click outside', async () => {
    const user = userEvent.setup()
    const { container } = renderPythonSheet()
    await openHelp(user)
    await user.click(container)
    expect(screen.queryByTestId('python-help-popover')).not.toBeInTheDocument()
    expect(sheetRoot()).toBeInTheDocument()
  })

  it('puts focus on the editable surface, not the scroller, after Escape', async () => {
    const user = userEvent.setup()
    renderPythonSheet()
    await openHelp(user)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('scalar-edit-surface')).toHaveFocus()
  })

  it('puts focus on the editable surface after the X closes the popover', async () => {
    const user = userEvent.setup()
    renderPythonSheet()
    const popover = await openHelp(user)
    await user.click(within(popover).getByRole('button', { name: 'Close help' }))
    await waitFor(() => {
      expect(screen.getByTestId('scalar-edit-surface')).toHaveFocus()
    })
  })

  it('puts focus on the editable surface after a click outside closes the popover', async () => {
    const user = userEvent.setup()
    const { container } = renderPythonSheet()
    await openHelp(user)
    await user.click(container)
    await waitFor(() => {
      expect(screen.getByTestId('scalar-edit-surface')).toHaveFocus()
    })
  })
})

describe('ValueEditorSheet - Python syntax issues (PYRUN-13)', () => {
  it('shows no validation strip while the script parses', () => {
    renderPythonSheet()
    expect(screen.queryByTestId('value-editor-validation')).not.toBeInTheDocument()
  })

  it('shows a single issue as "Line {n}: {message}"', () => {
    scriptSyntax.issues = [{ line: 4, message: "'(' was never closed" }]
    renderPythonSheet()
    expect(screen.getByTestId('value-editor-validation')).toHaveTextContent(
      "Line 4: '(' was never closed",
    )
    expect(screen.queryByTestId('value-editor-validation-more')).not.toBeInTheDocument()
  })

  it('paints a syntax error as a blocking strip', () => {
    scriptSyntax.issues = [{ line: 4, message: "'(' was never closed" }]
    renderPythonSheet()
    expect(screen.getByTestId('value-editor-validation')).toHaveAttribute('role', 'alert')
  })

  it('paints a warning-only list as advisory, not as an error', () => {
    scriptSyntax.issues = [
      { line: 11, message: "Function 'puts' is not recognized", severity: 'warning' },
    ]
    renderPythonSheet()
    const strip = screen.getByTestId('value-editor-validation')
    expect(strip).toHaveTextContent("Line 11: Function 'puts' is not recognized")
    expect(strip).not.toHaveAttribute('role')
    expect(strip).toHaveClass('text-amber-600')
  })

  it('paints a syntax error mixed with warnings as a blocking strip', () => {
    scriptSyntax.issues = [
      { line: 4, message: "'(' was never closed" },
      { line: 11, message: "Function 'puts' is not recognized", severity: 'warning' },
    ]
    renderPythonSheet()
    expect(screen.getByTestId('value-editor-validation')).toHaveAttribute('role', 'alert')
  })

  it('reads "(+1 more)" for two issues - N counts the messages after the first', () => {
    scriptSyntax.issues = [
      { line: 4, message: "'(' was never closed" },
      { line: 9, message: "'{' was never closed" },
    ]
    renderPythonSheet()
    expect(screen.getByTestId('value-editor-validation')).toHaveTextContent(
      "Line 4: '(' was never closed",
    )
    expect(screen.getByTestId('value-editor-validation-more')).toHaveTextContent('(+1 more)')
  })

  it('reads "(+2 more)" for three issues', () => {
    scriptSyntax.issues = [
      { line: 4, message: "'(' was never closed" },
      { line: 9, message: "'{' was never closed" },
      { line: 12, message: 'invalid syntax' },
    ]
    renderPythonSheet()
    expect(screen.getByTestId('value-editor-validation-more')).toHaveTextContent('(+2 more)')
  })

  it('lists every message when the expander is opened', async () => {
    const user = userEvent.setup()
    scriptSyntax.issues = [
      { line: 4, message: "'(' was never closed" },
      { line: 9, message: "'{' was never closed" },
    ]
    renderPythonSheet()
    await user.click(screen.getByTestId('value-editor-validation-more'))
    const list = await screen.findByTestId('value-editor-validation-more-list')
    expect(within(list).getByText("Line 4: '(' was never closed")).toBeInTheDocument()
    expect(within(list).getByText("Line 9: '{' was never closed")).toBeInTheDocument()
  })

  it('keeps Save enabled while the script has a syntax error', async () => {
    const user = userEvent.setup()
    scriptSyntax.issues = [{ line: 4, message: "'(' was never closed" }]
    renderPythonSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    expect(saveButton()).not.toBeDisabled()
  })

  it('saves a script that has a syntax error', async () => {
    const user = userEvent.setup()
    scriptSyntax.issues = [{ line: 4, message: "'(' was never closed" }]
    const { onSave } = renderPythonSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(saveButton())
    expect(onSave).toHaveBeenCalledWith('typed', false, [], undefined)
  })
})

const PUTS_WARNING = {
  line: 6,
  message: "Function 'puts' is not recognized",
  severity: 'warning' as const,
  from: 80,
  to: 84,
  type: 'invalid_function',
}

describe('ValueEditorSheet - Python check warnings (PYRUN-13)', () => {
  it('checks the script with the Input Variables and the types that are known', () => {
    renderPythonSheet()
    const [nodeId, script, mode, options] = lastScriptCall()
    expect(nodeId).toBe('')
    expect(script).toBe(PYTHON_SCRIPT)
    expect(mode).toBe('python')
    expect(options.inputs).toEqual({ names: ['values', 'label'], types: { values: 'array' } })
  })

  it('checks no text and no script mode outside a script body', () => {
    renderSheet({ type: 'string', value: 'hi' })
    const [, script, mode, options] = lastScriptCall()
    expect(script).toBe('')
    expect(mode).toBeNull()
    expect(options.inputs).toEqual({ names: [], types: {} })
  })

  it('lists a warning in the strip as "Line {n}: {message}"', () => {
    scriptSyntax.issues = [PUTS_WARNING]
    renderPythonSheet()
    expect(screen.getByTestId('value-editor-validation')).toHaveTextContent(
      "Line 6: Function 'puts' is not recognized",
    )
  })

  it('keeps Run enabled while the script has only warnings', () => {
    scriptSyntax.issues = [PUTS_WARNING, { ...PUTS_WARNING, line: 8 }]
    renderPythonSheet()
    expect(runButton()).not.toBeDisabled()
  })

  it('runs on Shift+Enter while the script has only warnings', () => {
    scriptSyntax.issues = [PUTS_WARNING]
    const { onRun } = renderPythonSheet()
    fireEvent.keyDown(sheetRoot(), { key: 'Enter', shiftKey: true })
    expect(onRun).toHaveBeenCalledWith(PYTHON_SCRIPT)
  })

  it('saves a script that has warnings', async () => {
    const user = userEvent.setup()
    scriptSyntax.issues = [PUTS_WARNING]
    const { onSave } = renderPythonSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(saveButton())
    expect(onSave).toHaveBeenCalledWith('typed', false, [], undefined)
  })

  it("keeps the live warnings beside the interpreter's verdict, in line order", async () => {
    const user = userEvent.setup()
    scriptSyntax.issues = [PUTS_WARNING]
    pythonTools.checkPython.mockResolvedValueOnce({
      issues: [{ line: 3, column: 1, message: 'invalid syntax' }],
    })
    renderPythonSheet()
    await user.click(runButton())
    await waitFor(() => {
      expect(screen.getByTestId('value-editor-validation')).toHaveTextContent('Line 3: invalid syntax')
    })
    expect(screen.getByTestId('value-editor-validation-more')).toHaveTextContent('(+1 more)')
    await user.click(screen.getByTestId('value-editor-validation-more'))
    const list = await screen.findByTestId('value-editor-validation-more-list')
    expect(within(list).getByText("Line 6: Function 'puts' is not recognized")).toBeInTheDocument()
    expectRealDisabled(runButton())
  })

  it("hands the interpreter's verdict to the host together with the live warnings", async () => {
    const user = userEvent.setup()
    const onSyntaxIssues = vi.fn()
    scriptSyntax.issues = [PUTS_WARNING]
    pythonTools.checkPython.mockResolvedValueOnce({
      issues: [{ line: 9, column: 1, message: 'invalid syntax' }],
    })
    render(
      <ValueEditorSheet
        label="Value"
        name="script"
        type={'string' as never}
        value={PYTHON_SCRIPT}
        isTemplate={false}
        allowedFormats={['python'] as never}
        availableVariables={[]}
        onSyntaxIssues={onSyntaxIssues}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(screen.getByTestId('value-editor-save-button'))
    await waitFor(() => {
      expect(onSyntaxIssues).toHaveBeenCalledWith([
        PUTS_WARNING,
        { line: 9, message: 'invalid syntax' },
      ])
    })
  })

  it('shows no strip when the interpreter finds nothing and there are no warnings', async () => {
    const user = userEvent.setup()
    renderPythonSheet()
    await user.click(runButton())
    await waitFor(() => {
      expect(pythonTools.checkPython).toHaveBeenCalled()
    })
    expect(screen.queryByTestId('value-editor-validation')).not.toBeInTheDocument()
  })
})

describe('ValueEditorSheet - Python Run (PYRUN-21)', () => {
  it('runs the draft and never saves it', async () => {
    const user = userEvent.setup()
    const { onRun, onSave } = renderPythonSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(runButton())
    expect(onRun).toHaveBeenCalledWith('typed')
    expect(onSave).not.toHaveBeenCalled()
    expect(sheetRoot()).toBeInTheDocument()
  })

  it('runs the saved script when nothing was typed yet', async () => {
    const user = userEvent.setup()
    const { onRun, onSave } = renderPythonSheet()
    await user.click(runButton())
    expect(onRun).toHaveBeenCalledWith(PYTHON_SCRIPT)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('runs the draft on Shift+Enter without saving', async () => {
    const user = userEvent.setup()
    const { onRun, onSave } = renderPythonSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    fireEvent.keyDown(sheetRoot(), { key: 'Enter', shiftKey: true })
    expect(onRun).toHaveBeenCalledWith('typed')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('enables Run for a parsing script that the run state allows', () => {
    renderPythonSheet()
    expect(runButton()).not.toBeDisabled()
  })

  it('disables Run while the script has a syntax error', () => {
    scriptSyntax.issues = [{ line: 4, message: "'(' was never closed" }]
    renderPythonSheet()
    expectRealDisabled(runButton())
  })

  it('ignores Shift+Enter while a syntax error blocks Run', () => {
    scriptSyntax.issues = [{ line: 4, message: "'(' was never closed" }]
    const { onRun } = renderPythonSheet()
    fireEvent.keyDown(sheetRoot(), { key: 'Enter', shiftKey: true })
    expect(onRun).not.toHaveBeenCalled()
  })

  it('disables Run when the block cannot run from here', () => {
    renderPythonSheet({ runAllowed: false })
    expectRealDisabled(runButton())
  })

  it('shows Stop in place of Run while a run is already in flight', () => {
    renderPythonSheet({ runBusy: true })
    expect(screen.queryByTestId('value-editor-run-button')).not.toBeInTheDocument()
    expect(screen.getByTestId('value-editor-stop-button')).toBeEnabled()
  })

  it("disables Run while something other than this script blocks the parent's Save", () => {
    const { onRun } = renderPythonSheet({
      runBlockedNote: 'Save is disabled: the Input Variables editor has errors',
    })
    expectRealDisabled(runButton())
    fireEvent.keyDown(sheetRoot(), { key: 'Enter', shiftKey: true })
    expect(onRun).not.toHaveBeenCalled()
  })

  it("says why Run is disabled with the parent's note", async () => {
    const user = userEvent.setup()
    renderPythonSheet({ runBlockedNote: 'Save is disabled: the settings have errors' })
    await user.hover(runButton().parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      /^Save is disabled: the settings have errors$/,
    )
  })


  it('keeps Close usable and disables Save while a run is in flight', async () => {
    const user = userEvent.setup()
    renderPythonSheet({ runBusy: true })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    expectRealDisabled(saveButton())
    expect(screen.getByRole('button', { name: 'Close' })).not.toBeDisabled()
  })
})

// Keyboard contract: Ctrl+Enter applies the draft the way Save does
// (the sheet stays open), and Escape walks the precedence chain -
// popover, rename box, completion list, then the sheet itself.

describe('ValueEditorSheet - Ctrl+Enter (PYRUN-13)', () => {
  it('applies the Python draft on Ctrl+Enter', async () => {
    const user = userEvent.setup()
    const { onSave } = renderPythonSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    fireEvent.keyDown(sheetRoot(), { key: 'Enter', ctrlKey: true })
    expect(onSave).toHaveBeenCalledWith('typed', false, [], undefined)
    expect(screen.queryByTestId('value-editor-unsaved-dialog')).not.toBeInTheDocument()
  })

  it('applies the draft of any other parameter on Ctrl+Enter', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ type: 'string', value: 'hi' })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    fireEvent.keyDown(screen.getByTestId('value-editor-sheet'), { key: 'Enter', ctrlKey: true })
    expect(onSave).toHaveBeenCalledWith('typed', false, [], undefined)
  })

  it('takes Ctrl+Enter before the editor inside, so the editor never adds a line to the draft', async () => {
    const user = userEvent.setup()
    const { onSave } = renderPythonSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    const editor = screen.getByTestId('scalar-edit-body-change')
    const editorKeys = vi.fn()
    editor.addEventListener('keydown', editorKeys)
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    expect(editorKeys).not.toHaveBeenCalled()
    expect(onSave).toHaveBeenCalledWith('typed', false, [], undefined)
  })

  it('takes Shift+Enter and F1 before the editor inside a script sheet', () => {
    const { onRun } = renderPythonSheet()
    const editor = screen.getByTestId('scalar-edit-body-change')
    const editorKeys = vi.fn()
    editor.addEventListener('keydown', editorKeys)
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(editor, { key: 'F1' })
    expect(editorKeys).not.toHaveBeenCalled()
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('python-help-popover')).toBeInTheDocument()
  })

  it('leaves every other key to the editor inside', () => {
    renderSheet({ type: 'string', value: 'hi' })
    const editor = screen.getByTestId('scalar-edit-body-change')
    const editorKeys = vi.fn()
    editor.addEventListener('keydown', editorKeys)
    fireEvent.keyDown(editor, { key: 'Enter' })
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })
    expect(editorKeys).toHaveBeenCalledTimes(2)
  })

  it('does nothing on Ctrl+Enter while Save is dead', () => {
    const { onSave } = renderSheet({ type: 'string', value: 'hi' })
    fireEvent.keyDown(screen.getByTestId('value-editor-sheet'), { key: 'Enter', ctrlKey: true })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('leaves a plain Enter alone', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSheet({ type: 'string', value: 'hi' })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    fireEvent.keyDown(screen.getByTestId('value-editor-sheet'), { key: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('ValueEditorSheet - Escape precedence (PYRUN-13)', () => {
  it('closes the help popover first and leaves the sheet open', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPythonSheet()
    await openHelp(user)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('python-help-popover')).not.toBeInTheDocument()
    expect(sheetRoot()).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves the sheet open when the editor already took Escape', () => {
    const { onClose } = renderPythonSheet()
    // The completion list (and the rename box) take Escape inside the editor;
    // CodeMirror marks the event handled before it reaches the sheet.
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    event.preventDefault()
    globalThis.dispatchEvent(event)
    expect(onClose).not.toHaveBeenCalled()
    expect(sheetRoot()).toBeInTheDocument()
  })

  it('closes the sheet when nothing inside took Escape', () => {
    const { onClose } = renderPythonSheet()
    fireEvent.keyDown(sheetRoot(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('asks Keep Editing / Discard / Save on Escape with a dirty draft', async () => {
    const user = userEvent.setup()
    const { onClose } = renderPythonSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    fireEvent.keyDown(sheetRoot(), { key: 'Escape' })
    expect(screen.getByTestId('value-editor-unsaved-dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('ValueEditorSheet - Python sheet geometry (PYRUN-13)', () => {
  beforeEach(() => {
    window.innerWidth = 1200
    window.innerHeight = 800
  })

  afterEach(() => {
    window.innerWidth = 1024
    window.innerHeight = 768
  })

  it('opens at 720x460 in Python mode', () => {
    renderPythonSheet()
    expect(sheetRoot().style.width).toBe('720px')
    expect(sheetRoot().style.height).toBe('460px')
  })

  it('fills the viewport on maximize and restores the previous box', async () => {
    const user = userEvent.setup()
    renderPythonSheet()
    const maximize = screen.getByRole('button', { name: 'Maximize' })
    expect(maximize).toHaveAttribute('aria-pressed', 'false')

    await user.click(maximize)
    expect(maximize).toHaveAttribute('aria-pressed', 'true')
    expect(sheetRoot().style.width).toBe(`${window.innerWidth}px`)
    expect(sheetRoot().style.height).toBe(`${window.innerHeight}px`)

    await user.click(maximize)
    expect(maximize).toHaveAttribute('aria-pressed', 'false')
    expect(sheetRoot().style.width).toBe('720px')
    expect(sheetRoot().style.height).toBe('460px')
  })

  it('leaves the caret on the editable surface after maximize', async () => {
    const user = userEvent.setup()
    renderPythonSheet()

    await user.click(screen.getByRole('button', { name: 'Maximize' }))

    expect(screen.getByTestId('scalar-edit-surface')).toHaveFocus()
  })
})

// ============================================================================
// PYRUN-16 / PYRUN-20: the same footer contract for every parameter of every
// block - Close instead of Cancel, Save dead while the draft still equals the
// saved value, and no Kind dropdown where an expression is not allowed.
// ============================================================================

describe('ValueEditorSheet - footer for every parameter (PYRUN-20)', () => {
  it('labels the dismiss button Close, never Cancel', () => {
    renderSheet({ type: 'string', value: 'hi' })
    expect(screen.getByTestId('value-editor-cancel-button')).toHaveTextContent('Close')
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('labels the dismiss button Close for a complex value too', () => {
    renderSheet({ type: 'array', value: [] })
    expect(screen.getByTestId('value-editor-cancel-button')).toHaveTextContent('Close')
  })

  it('disables Save while a plain string draft equals the saved value', () => {
    renderSheet({ type: 'string', value: 'hi' })
    expectRealDisabled(saveButton())
  })

  it('enables Save once a plain string draft changes', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'string', value: 'hi' })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    expect(saveButton()).not.toBeDisabled()
  })

  it('disables Save while a complex draft is unchanged', () => {
    renderSheet({ type: 'map', value: { k: 'v' } })
    expectRealDisabled(saveButton())
  })

  it('disables Save again when a Kind switch is taken back', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'string', value: 'plain', isTemplate: false })
    await pickFromSelect(user, 'kind-dropdown', 'Template')
    expect(saveButton()).not.toBeDisabled()
    await pickFromSelect(user, 'kind-dropdown', 'Literal')
    expect(saveButton()).toBeDisabled()
  })

  it('hides the Kind dropdown for a noExpression parameter (PYRUN-16)', () => {
    renderSheet({ type: 'string', value: 'hi', allowTemplate: false })
    expect(screen.queryByTestId('kind-dropdown')).not.toBeInTheDocument()
  })

  it('asks Keep Editing / Close / Save when Close is pressed with a dirty draft', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'string', value: 'hi' })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(screen.getByTestId('value-editor-cancel-button'))
    expect(screen.getByTestId('value-editor-unsaved-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('value-editor-unsaved-keep-button')).toHaveTextContent('Keep Editing')
    expect(screen.getByTestId('value-editor-unsaved-discard-button')).toHaveTextContent('Close')
    expect(screen.getByTestId('value-editor-unsaved-save-button')).toHaveTextContent('Save')
  })

  it('closes straight away when Close is pressed with an unchanged draft', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ type: 'string', value: 'hi' })
    await user.click(screen.getByTestId('value-editor-cancel-button'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('value-editor-unsaved-dialog')).not.toBeInTheDocument()
  })

  it('applies the value on Save and keeps the sheet open', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderSheet({ type: 'string', value: 'hi' })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(saveButton())
    expect(onSave).toHaveBeenCalledExactlyOnceWith('typed', false, [], undefined)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
  })

  it('disables Save again right after a Save', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'string', value: 'hi' })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(saveButton())
    expectRealDisabled(saveButton())
  })

  it('applies the value on Ctrl+Enter, keeps the sheet open and disables Save again', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderSheet({ type: 'string', value: 'hi' })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    fireEvent.keyDown(screen.getByTestId('value-editor-sheet'), { key: 'Enter', ctrlKey: true })
    expect(onSave).toHaveBeenCalledExactlyOnceWith('typed', false, [], undefined)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
    expectRealDisabled(saveButton())
  })

  it('keeps a complex value open after Save with Save disabled again', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderSheet({ type: 'array', value: [] })
    await user.click(screen.getByTestId('array-edit-body-change'))
    await user.click(saveButton())
    expect(onSave).toHaveBeenCalledExactlyOnceWith(['x'], false, [], ['string'])
    expect(onClose).not.toHaveBeenCalled()
    expectRealDisabled(saveButton())
  })

  it('enables Save again when the draft changes after a Save', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'string', value: 'hi', isTemplate: false })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(saveButton())
    await pickFromSelect(user, 'kind-dropdown', 'Template')
    expect(saveButton()).not.toBeDisabled()
  })

  it('closes without asking when Close follows a Save', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ type: 'string', value: 'hi' })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(saveButton())
    await user.click(screen.getByTestId('value-editor-cancel-button'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('value-editor-unsaved-dialog')).not.toBeInTheDocument()
  })

  it('asks again when Close follows a Save and a further change', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ type: 'string', value: 'hi', isTemplate: false })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(saveButton())
    await pickFromSelect(user, 'kind-dropdown', 'Template')
    await user.click(screen.getByTestId('value-editor-cancel-button'))
    expect(screen.getByTestId('value-editor-unsaved-dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

// ============================================================================
// The interpreter's own syntax check runs on Save and on Run, never while the
// author types. Its verdict replaces the live one, and the save never waits on
// it (PYRUN-13).
// ============================================================================

describe('ValueEditorSheet - interpreter syntax check (PYRUN-13)', () => {
  it('asks the interpreter for the exact draft on Save', async () => {
    const user = userEvent.setup()
    renderPythonSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(saveButton())
    expect(pythonTools.checkPython).toHaveBeenCalledWith({ script: 'typed' })
  })

  it('asks the interpreter for the exact draft on Run', async () => {
    const user = userEvent.setup()
    renderPythonSheet()
    await user.click(runButton())
    expect(pythonTools.checkPython).toHaveBeenCalledWith({ script: PYTHON_SCRIPT })
  })

  it('never asks for a parameter that is not a script', async () => {
    const user = userEvent.setup()
    renderSheet({ type: 'string', value: 'hi' })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(pythonTools.checkPython).not.toHaveBeenCalled()
  })

  it('saves without waiting for the answer', async () => {
    const user = userEvent.setup()
    let answer = (): void => {}
    pythonTools.checkPython.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = () => resolve({ issues: [] })
      }),
    )
    const { onSave } = renderPythonSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(saveButton())
    expect(onSave).toHaveBeenCalledWith('typed', false, [], undefined)
    await act(async () => {
      answer()
    })
  })

  it("replaces the live message with the interpreter's wording", async () => {
    const user = userEvent.setup()
    scriptSyntax.issues = [{ line: 3, message: 'Syntax error' }]
    pythonTools.checkPython.mockResolvedValueOnce({
      issues: [{ line: 3, column: 8, message: "'(' was never closed" }],
    })
    renderPythonSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(saveButton())
    await waitFor(() => {
      expect(screen.getByTestId('value-editor-validation')).toHaveTextContent(
        "Line 3: '(' was never closed",
      )
    })
  })

  it("hands the interpreter's verdict to the host", async () => {
    const user = userEvent.setup()
    const onSyntaxIssues = vi.fn()
    pythonTools.checkPython.mockResolvedValueOnce({
      issues: [{ line: 3, column: 8, message: "'(' was never closed" }],
    })
    render(
      <ValueEditorSheet
        label="Value"
        name="script"
        type={'string' as never}
        value={PYTHON_SCRIPT}
        isTemplate={false}
        allowedFormats={['python'] as never}
        availableVariables={[]}
        onSyntaxIssues={onSyntaxIssues}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(screen.getByTestId('value-editor-save-button'))
    await waitFor(() => {
      expect(onSyntaxIssues).toHaveBeenCalledWith([
        { line: 3, message: "'(' was never closed" },
      ])
    })
  })

  it('drops the verdict again once the script changes', async () => {
    const user = userEvent.setup()
    pythonTools.checkPython.mockResolvedValueOnce({
      issues: [{ line: 3, column: 8, message: "'(' was never closed" }],
    })
    renderPythonSheet()
    await user.click(runButton())
    await waitFor(() => {
      expect(screen.getByTestId('value-editor-validation')).toHaveTextContent(
        "Line 3: '(' was never closed",
      )
    })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    expect(screen.queryByTestId('value-editor-validation')).not.toBeInTheDocument()
  })

  it('does nothing on Run when the host offers no run', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <ValueEditorSheet
        label="Value"
        name="script"
        type={'string' as never}
        value={PYTHON_SCRIPT}
        isTemplate={false}
        allowedFormats={['python'] as never}
        availableVariables={[]}
        runAllowed
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
  })

  it('leaves the help popover open on a key that is not Escape', async () => {
    const user = userEvent.setup()
    renderPythonSheet()
    await openHelp(user)
    fireEvent.keyDown(document, { key: 'a' })
    expect(screen.getByTestId('python-help-popover')).toBeInTheDocument()
  })
})

// ============================================================================
// The parent this editor was opened from: the sheet reports its row label,
// whether its draft differs from what it last saved and whether its own Save is
// blocked for a reason other than nothing changed, and the parent can write the
// draft through the sheet's own save path without closing it.
// ============================================================================

function renderInParent(overrides: { type?: string; value?: unknown; allowedFormats?: string[] } = {}) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(
    <ChildEditorParent>
      <ValueEditorSheet
        label="Input Variables"
        name=""
        type={(overrides.type ?? 'string') as never}
        value={overrides.value ?? 'hi'}
        isTemplate={false}
        allowedFormats={overrides.allowedFormats as never}
        availableVariables={[]}
        onSave={onSave}
        onClose={onClose}
      />
    </ChildEditorParent>,
  )
  return { onSave, onClose }
}

describe('ValueEditorSheet - the parent it was opened from', () => {
  it('reports its row label with no changes while the draft is clean', () => {
    renderInParent()
    expect(parentChildren()).toEqual([
      { label: 'Input Variables', hasChanges: false, cannotBeSaved: false },
    ])
  })

  it('reports changes once the draft differs from the value it opened with', async () => {
    const user = userEvent.setup()
    renderInParent()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    expect(parentChildren()).toEqual([
      { label: 'Input Variables', hasChanges: true, cannotBeSaved: false },
    ])
  })

  it('reports no changes again once Save applied the draft', async () => {
    const user = userEvent.setup()
    renderInParent()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(screen.getByTestId('value-editor-save-button'))
    expect(parentChildren()).toEqual([
      { label: 'Input Variables', hasChanges: false, cannotBeSaved: false },
    ])
  })

  it('reports that it cannot be saved while its body is invalid', async () => {
    const user = userEvent.setup()
    renderInParent()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(screen.getByTestId('scalar-edit-body-invalid'))
    expect(parentChildren()).toEqual([
      { label: 'Input Variables', hasChanges: true, cannotBeSaved: true },
    ])
  })

  it('reports that it cannot be saved while a locked JSON literal is malformed', async () => {
    const user = userEvent.setup()
    renderInParent({ value: '{}', allowedFormats: ['json'] })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    expect(parentChildren()).toEqual([
      { label: 'Input Variables', hasChanges: true, cannotBeSaved: true },
    ])
  })

  it('never counts a check warning as a reason it cannot be saved', async () => {
    scriptSyntax.issues = [
      { line: 3, message: "Unknown name 'valuez'", severity: 'warning', from: 0, to: 6 },
    ]
    const user = userEvent.setup()
    renderInParent({ value: PYTHON_SCRIPT, allowedFormats: ['python'] })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    expect(parentChildren()).toEqual([
      { label: 'Input Variables', hasChanges: true, cannotBeSaved: false },
    ])
  })

  it('never counts a syntax error as a reason it cannot be saved', async () => {
    scriptSyntax.issues = [{ line: 4, message: "'(' was never closed" }]
    const user = userEvent.setup()
    renderInParent({ value: PYTHON_SCRIPT, allowedFormats: ['python'] })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    expect(parentChildren()).toEqual([
      { label: 'Input Variables', hasChanges: true, cannotBeSaved: false },
    ])
  })

  it('lets the parent write the draft through its own save path without closing', async () => {
    const user = userEvent.setup()
    const { onSave, onClose } = renderInParent()
    await user.click(screen.getByTestId('scalar-edit-body-change'))

    act(() => applyParentChildren())

    expect(onSave).toHaveBeenCalledExactlyOnceWith('typed', false, [], undefined)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('value-editor-sheet')).toBeInTheDocument()
  })

  it('drops out of the parent once it closes', async () => {
    function Toggle() {
      const [open, setOpen] = React.useState(true)
      return (
        <ChildEditorParent>
          {open && (
            <ValueEditorSheet
              label="Body"
              name=""
              type={'string' as never}
              value="hi"
              isTemplate={false}
              availableVariables={[]}
              onSave={vi.fn()}
              onClose={() => setOpen(false)}
            />
          )}
        </ChildEditorParent>
      )
    }
    const user = userEvent.setup()
    render(<Toggle />)
    await user.click(screen.getByTestId('value-editor-cancel-button'))
    expect(parentChildren()).toEqual([])
  })
})

const SQL_VARIABLES = [{ name: 'region', type: 'string' }]

const UNUSED_LIMIT = {
  line: 0,
  message: "Parameter 'limit' is defined but not used in the SQL",
  severity: 'warning' as const,
  from: 0,
  to: 0,
}

const UNDEFINED_REGION = {
  line: 3,
  message: "Parameter 'region' is used in the SQL but not defined",
  severity: 'warning' as const,
  from: 57,
  to: 64,
}

// The Python editor's keyboard list without F2 Rename.
const SQL_HELP_KEYS = [
  'Autocomplete',
  'Run',
  'Save',
  'Close',
  'Toggle comment',
  'Find and replace',
  'Go to line',
  'Indent / outdent',
  'Undo / redo',
]

const ALL_TABLE_ITEMS = [
  'tables-popover-item-orders',
  'tables-popover-item-order_items',
  'tables-popover-item-customers',
  'tables-popover-item-active_customers',
]

interface SqlOverrides {
  value?: string
  isTemplate?: boolean
  allowTemplate?: boolean
  databaseType?: 'postgresql' | 'mysql' | 'oracle' | 'mssql' | 'sqlite'
  parameterNames?: readonly string[] | null
  availableVariables?: Array<{ name: string; type: string }>
  runBusy?: boolean
  runAllowed?: boolean
  runBlockedNote?: string | null
}

function renderSqlSheet(overrides: SqlOverrides = {}) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  const onRun = vi.fn()
  const onStop = vi.fn()
  const sheet = (props: SqlOverrides) => (
    <ValueEditorSheet
      label="SQL"
      name="sql"
      type="string"
      value={props.value ?? SAMPLE_SCRIPT}
      isTemplate={props.isTemplate ?? false}
      allowTemplate={props.allowTemplate ?? true}
      allowedFormats={['sql']}
      availableVariables={props.availableVariables ?? []}
      nodeId="node-sql"
      databaseType={props.databaseType ?? 'mysql'}
      parameterNames={props.parameterNames === undefined ? ['customer', 'status'] : props.parameterNames}
      sqlCatalogRequest={SAMPLE_CATALOG_REQUEST}
      runBusy={props.runBusy ?? false}
      runAllowed={props.runAllowed ?? true}
      runBlockedNote={props.runBlockedNote}
      onRun={onRun}
      onStop={onStop}
      onSave={onSave}
      onClose={onClose}
    />
  )
  const view = render(sheet(overrides))
  return {
    onSave,
    onClose,
    onRun,
    onStop,
    rerender: (next: SqlOverrides = {}) => view.rerender(sheet({ ...overrides, ...next })),
  }
}

const editorSurface = () => screen.getByTestId('scalar-edit-surface')
const stopButton = () => screen.getByTestId('value-editor-stop-button')

async function openSqlHelp(user: ReturnType<typeof userEvent.setup>) {
  await user.click(helpChip())
  return screen.findByTestId('sql-help-popover')
}

function expectInDocumentOrder(elements: HTMLElement[]) {
  for (let index = 1; index < elements.length; index += 1) {
    const position = elements[index - 1].compareDocumentPosition(elements[index])
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }
}

describe('ValueEditorSheet - SQL mode footer (SQL-10, SQL-12)', () => {
  it('opens a body locked to sql in Literal kind with the Format locked to SQL', () => {
    renderSqlSheet()
    expect(screen.getByTestId('scalar-edit-body')).toBeInTheDocument()
    expect(screen.getByTestId('kind-dropdown')).toHaveTextContent(/^Literal$/)
    expect(screen.getByTestId('format-dropdown')).toHaveTextContent(/^SQL$/)
    expect(screen.getByTestId('format-dropdown')).toBeDisabled()
  })

  it('opens a template body in Template kind, without the Format dropdown', () => {
    renderSqlSheet({ isTemplate: true })
    expect(screen.getByTestId('kind-dropdown')).toHaveTextContent(/^Template$/)
    expect(screen.queryByTestId('format-dropdown')).not.toBeInTheDocument()
  })

  it('offers no Kind dropdown where the host allows no template', () => {
    renderSqlSheet({ allowTemplate: false })
    expect(screen.queryByTestId('kind-dropdown')).not.toBeInTheDocument()
    expect(screen.getByTestId('format-dropdown')).toHaveTextContent(/^SQL$/)
  })

  it('carries the F1 Help chip and the Get Tables chip', () => {
    renderSqlSheet()
    expect(helpChip()).toHaveTextContent('F1')
    expect(helpChip()).toHaveTextContent('Help')
    expect(screen.getByTestId('get-tables-chip')).toHaveAttribute('data-state', 'idle')
    expect(screen.getByRole('button', { name: 'Get Tables' })).toBeInTheDocument()
  })

  it('renders Close, Save and Run', () => {
    renderSqlSheet()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(saveButton()).toBeInTheDocument()
    expect(runButton()).toBeInTheDocument()
  })

  it('lays the footer out Kind, Format, Help, Get Tables, Close, Save, Run', () => {
    renderSqlSheet()
    expectInDocumentOrder([
      screen.getByTestId('kind-dropdown'),
      screen.getByTestId('format-dropdown'),
      helpChip(),
      screen.getByTestId('get-tables-chip'),
      screen.getByTestId('value-editor-cancel-button'),
      saveButton(),
      screen.getByTestId('value-editor-run-button'),
    ])
  })

  it('offers no pretty-print button', () => {
    renderSqlSheet()
    expect(screen.queryByTestId('value-editor-string-format-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('value-editor-format-button')).not.toBeInTheDocument()
  })

  it('shows no Get Tables chip in Python mode', () => {
    renderPythonSheet()
    expect(screen.queryByTestId('get-tables-chip')).not.toBeInTheDocument()
  })

  it('shows no Get Tables chip for a plain body', () => {
    renderSheet({ type: 'string', value: 'hi' })
    expect(screen.queryByTestId('get-tables-chip')).not.toBeInTheDocument()
  })
})

describe('ValueEditorSheet - SQL sheet geometry (SQL-10)', () => {
  beforeEach(() => {
    window.innerWidth = 1200
    window.innerHeight = 800
  })

  afterEach(() => {
    window.innerWidth = 1024
    window.innerHeight = 768
  })

  it('opens at 720x460 in SQL mode', () => {
    renderSqlSheet()
    expect(sheetRoot().style.width).toBe('720px')
    expect(sheetRoot().style.height).toBe('460px')
  })
})

describe('ValueEditorSheet - SQL checks (SQL-10, SQL-11)', () => {
  it('checks the draft in SQL mode with the Database type, the Parameters names, the tables, the variables and the kind', () => {
    sqlCatalog.result = catalogResult({ state: 'settled', tables: SAMPLE_TABLES, count: 4 })
    renderSqlSheet({ availableVariables: SQL_VARIABLES })
    const [nodeId, doc, mode, options] = lastScriptCall()
    expect(nodeId).toBe('node-sql')
    expect(doc).toBe(SAMPLE_SCRIPT)
    expect(mode).toBe('sql')
    expect(options).toMatchObject({
      databaseType: 'mysql',
      parameterNames: ['customer', 'status'],
      variables: SQL_VARIABLES,
      template: false,
    })
    expect(options.tables).toBe(SAMPLE_TABLES)
  })

  it('checks with no tables while none are loaded', () => {
    renderSqlSheet()
    expect(lastScriptCall()[3].tables).toBeNull()
  })

  it('checks with null Parameters names while Parameters is an expression', () => {
    renderSqlSheet({ parameterNames: null })
    expect(lastScriptCall()[3].parameterNames).toBeNull()
  })

  it('checks as postgresql with no Parameters names and pulls nothing when the host gives none of them', () => {
    render(
      <ValueEditorSheet
        label="SQL"
        name="sql"
        type="string"
        value={SAMPLE_SCRIPT}
        isTemplate={false}
        allowedFormats={['sql']}
        availableVariables={[]}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const [, , mode, options] = lastScriptCall()
    expect(mode).toBe('sql')
    expect(options).toMatchObject({ databaseType: 'postgresql', parameterNames: null })
    expect(sqlCatalog.calls.at(-1)).toBeNull()
  })

  it('checks the edited draft', async () => {
    const user = userEvent.setup()
    renderSqlSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    const [, doc, mode] = lastScriptCall()
    expect(doc).toBe('typed')
    expect(mode).toBe('sql')
  })

  it('checks a template body as a template', () => {
    renderSqlSheet({ isTemplate: true })
    expect(lastScriptCall()[3].template).toBe(true)
  })

  it('checks as a template once the Kind switches to Template', async () => {
    const user = userEvent.setup()
    renderSqlSheet()
    await pickFromSelect(user, 'kind-dropdown', 'Template')
    expect(lastScriptCall()[3].template).toBe(true)
    expect(screen.queryByTestId('format-dropdown')).not.toBeInTheDocument()
  })

  it('saves a Template-kind body as a template', async () => {
    const user = userEvent.setup()
    const { onSave } = renderSqlSheet()
    await pickFromSelect(user, 'kind-dropdown', 'Template')
    await user.click(saveButton())
    expect(onSave).toHaveBeenCalledWith(SAMPLE_SCRIPT, true, [], undefined)
  })

  it('shows no strip while the SQL has no findings', () => {
    renderSqlSheet()
    expect(screen.queryByTestId('value-editor-validation')).not.toBeInTheDocument()
  })

  it('lists a finding that belongs to no line as its bare message', () => {
    scriptSyntax.issues = [UNUSED_LIMIT]
    renderSqlSheet()
    expect(screen.getByTestId('value-editor-validation')).toHaveTextContent(
      /^Parameter 'limit' is defined but not used in the SQL$/,
    )
  })

  it('lists a finding on a line as "Line {n}: {message}"', () => {
    scriptSyntax.issues = [UNDEFINED_REGION]
    renderSqlSheet()
    expect(screen.getByTestId('value-editor-validation')).toHaveTextContent(
      /^Line 3: Parameter 'region' is used in the SQL but not defined$/,
    )
  })

  it('lists every finding in the order the check gives them', async () => {
    const user = userEvent.setup()
    scriptSyntax.issues = [UNUSED_LIMIT, UNDEFINED_REGION]
    renderSqlSheet()
    expect(screen.getByTestId('value-editor-validation')).toHaveTextContent(
      "Parameter 'limit' is defined but not used in the SQL",
    )
    expect(screen.getByTestId('value-editor-validation-more')).toHaveTextContent('(+1 more)')
    await user.click(screen.getByTestId('value-editor-validation-more'))
    const list = await screen.findByTestId('value-editor-validation-more-list')
    expect(
      within(list).getByText("Parameter 'limit' is defined but not used in the SQL"),
    ).toBeInTheDocument()
    expect(
      within(list).getByText("Line 3: Parameter 'region' is used in the SQL but not defined"),
    ).toBeInTheDocument()
  })

  it('paints the findings as advisory, never as an error', () => {
    scriptSyntax.issues = [UNUSED_LIMIT, UNDEFINED_REGION]
    renderSqlSheet()
    const strip = screen.getByTestId('value-editor-validation')
    expect(strip).not.toHaveAttribute('role')
    expect(strip).toHaveClass('text-amber-600')
  })

  it('keeps Run and Save enabled while the SQL has findings', async () => {
    const user = userEvent.setup()
    scriptSyntax.issues = [UNUSED_LIMIT, UNDEFINED_REGION]
    renderSqlSheet()
    expect(runButton()).toBeEnabled()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    expect(saveButton()).toBeEnabled()
  })

  it('saves a body that has findings', async () => {
    const user = userEvent.setup()
    scriptSyntax.issues = [UNDEFINED_REGION]
    const { onSave } = renderSqlSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(saveButton())
    expect(onSave).toHaveBeenCalledWith('typed', false, [], undefined)
  })

  it('never counts a finding as a reason it cannot be saved', async () => {
    scriptSyntax.issues = [UNUSED_LIMIT, UNDEFINED_REGION]
    const user = userEvent.setup()
    renderInParent({ value: SAMPLE_SCRIPT, allowedFormats: ['sql'] })
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    expect(parentChildren()).toEqual([
      { label: 'Input Variables', hasChanges: true, cannotBeSaved: false },
    ])
  })

  it('never asks the Python interpreter about SQL', async () => {
    const user = userEvent.setup()
    renderSqlSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(saveButton())
    await user.click(runButton())
    expect(pythonTools.checkPython).not.toHaveBeenCalled()
  })
})

describe('ValueEditorSheet - SQL Run (SQL-13)', () => {
  it('runs the draft and never saves it', async () => {
    const user = userEvent.setup()
    const { onRun, onSave } = renderSqlSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(runButton())
    expect(onRun).toHaveBeenCalledExactlyOnceWith('typed')
    expect(onSave).not.toHaveBeenCalled()
    expect(sheetRoot()).toBeInTheDocument()
  })

  it('runs the saved SQL when nothing was typed yet', async () => {
    const user = userEvent.setup()
    const { onRun } = renderSqlSheet()
    await user.click(runButton())
    expect(onRun).toHaveBeenCalledExactlyOnceWith(SAMPLE_SCRIPT)
  })

  it('runs the draft on Shift+Enter without saving', async () => {
    const user = userEvent.setup()
    const { onRun, onSave } = renderSqlSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    fireEvent.keyDown(sheetRoot(), { key: 'Enter', shiftKey: true })
    expect(onRun).toHaveBeenCalledExactlyOnceWith('typed')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('applies the draft on Ctrl+Enter and keeps the sheet open', async () => {
    const user = userEvent.setup()
    const { onSave, onRun } = renderSqlSheet()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    fireEvent.keyDown(sheetRoot(), { key: 'Enter', ctrlKey: true })
    expect(onSave).toHaveBeenCalledWith('typed', false, [], undefined)
    expect(onRun).not.toHaveBeenCalled()
    expect(sheetRoot()).toBeInTheDocument()
  })

  it('disables Run when the block cannot run from here', () => {
    renderSqlSheet({ runAllowed: false })
    expectRealDisabled(runButton())
  })

  it("disables Run while something other than the SQL blocks the parent's Save", () => {
    const { onRun } = renderSqlSheet({ runBlockedNote: 'Save is disabled: the settings have errors' })
    expectRealDisabled(runButton())
    fireEvent.keyDown(sheetRoot(), { key: 'Enter', shiftKey: true })
    expect(onRun).not.toHaveBeenCalled()
  })
})

describe('ValueEditorSheet - SQL help (SQL-10)', () => {
  it('opens the SQL help on F1', async () => {
    renderSqlSheet()
    fireEvent.keyDown(sheetRoot(), { key: 'F1' })
    const popover = await screen.findByTestId('sql-help-popover')
    expect(popover).toHaveAttribute('role', 'dialog')
    expect(screen.queryByTestId('python-help-popover')).not.toBeInTheDocument()
  })

  it('opens the SQL help when the chip is clicked', async () => {
    const user = userEvent.setup()
    renderSqlSheet()
    expect(await openSqlHelp(user)).toBeInTheDocument()
  })

  it("lists the Python editor's keyboard entries without Rename, and no tips", async () => {
    const user = userEvent.setup()
    renderSqlSheet()
    const popover = await openSqlHelp(user)
    for (const label of SQL_HELP_KEYS) {
      expect(within(popover).getByText(label)).toBeInTheDocument()
    }
    expect(within(popover).queryByText('Rename symbol')).not.toBeInTheDocument()
    expect(within(popover).queryByText('F2')).not.toBeInTheDocument()
    expect(within(popover).queryByRole('button', { name: 'Show tips' })).not.toBeInTheDocument()
  })

  it('closes the help first on Escape and leaves the sheet open', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSqlSheet()
    await openSqlHelp(user)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('sql-help-popover')).not.toBeInTheDocument()
    expect(sheetRoot()).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('puts focus on the editable surface after Escape closes the help', async () => {
    const user = userEvent.setup()
    renderSqlSheet()
    await openSqlHelp(user)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(editorSurface()).toHaveFocus()
    })
  })
})

describe('ValueEditorSheet - Get Tables in the SQL editor (SQL-12)', () => {
  it("pulls the catalog with the host's request", () => {
    renderSqlSheet()
    expect(sqlCatalog.calls.at(-1)).toEqual(SAMPLE_CATALOG_REQUEST)
  })

  it('asks for no catalog in Python mode', () => {
    renderPythonSheet()
    expect(sqlCatalog.calls.length).toBeGreaterThan(0)
    expect(sqlCatalog.calls.every((request) => request === null)).toBe(true)
  })

  it('asks for no catalog for a plain body', () => {
    renderSheet({ type: 'string', value: 'hi' })
    expect(sqlCatalog.calls.length).toBeGreaterThan(0)
    expect(sqlCatalog.calls.every((request) => request === null)).toBe(true)
  })

  it('starts the pull from the idle chip', async () => {
    const user = userEvent.setup()
    renderSqlSheet()
    await user.click(screen.getByRole('button', { name: 'Get Tables' }))
    expect(sqlCatalog.result.start).toHaveBeenCalledTimes(1)
  })

  it('tries again from the failed chip', async () => {
    const user = userEvent.setup()
    sqlCatalog.result = catalogResult({ state: 'failed', error: 'Connection refused' })
    renderSqlSheet()
    await user.click(screen.getByRole('button', { name: 'Could not get tables' }))
    expect(sqlCatalog.result.start).toHaveBeenCalledTimes(1)
  })

  it('shows the reason of a failed pull on the failed chip', () => {
    const reason = "Cannot resolve Host: Variable 'db_host' is not defined"
    sqlCatalog.result = catalogResult({ state: 'failed', error: reason })
    renderSqlSheet()
    const failed = screen.getByRole('button', { name: 'Could not get tables' })

    act(() => {
      failed.focus()
    })

    expect(screen.getByRole('tooltip').textContent).toBe(reason)
    expect(failed).toHaveAccessibleDescription(reason)
  })

  it('shows no reason on a failed chip whose pull carries no error text', () => {
    sqlCatalog.result = catalogResult({ state: 'failed', error: null })
    renderSqlSheet()
    const failed = screen.getByRole('button', { name: 'Could not get tables' })

    act(() => {
      failed.focus()
    })

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(failed).not.toHaveAccessibleDescription()
  })

  it('stops a busy pull from the chip and starts nothing', async () => {
    const user = userEvent.setup()
    sqlCatalog.result = catalogResult({ state: 'connecting' })
    const { onStop } = renderSqlSheet()
    await user.click(screen.getByRole('button', { name: 'Stop getting tables' }))
    expect(sqlCatalog.result.stop).toHaveBeenCalledTimes(1)
    expect(sqlCatalog.result.start).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
  })

  it('refreshes the loaded tables', async () => {
    const user = userEvent.setup()
    sqlCatalog.result = catalogResult({ state: 'settled', tables: SAMPLE_TABLES, count: 4 })
    renderSqlSheet()
    await user.click(screen.getByRole('button', { name: 'Refresh tables' }))
    expect(sqlCatalog.result.refresh).toHaveBeenCalledTimes(1)
  })

  it('opens the Tables popover with the loaded tables from the settled chip', async () => {
    const user = userEvent.setup()
    sqlCatalog.result = catalogResult({ state: 'settled', tables: SAMPLE_TABLES, count: 4 })
    renderSqlSheet()
    await user.click(screen.getByRole('button', { name: 'Tables · 4' }))
    const popover = await screen.findByTestId('tables-popover')
    expect(
      within(popover)
        .getAllByTestId(/^tables-popover-item-/)
        .map((item) => item.dataset.testid),
    ).toEqual(ALL_TABLE_ITEMS)
  })

  it('opens the Tables popover from the done chip', async () => {
    const user = userEvent.setup()
    sqlCatalog.result = catalogResult({ state: 'done', tables: SAMPLE_TABLES, count: 4 })
    renderSqlSheet()
    await user.click(screen.getByRole('button', { name: 'Got 4 tables' }))
    expect(await screen.findByTestId('tables-popover')).toBeInTheDocument()
  })

  it('closes only the Tables popover on Escape and hands focus back to the editor', async () => {
    const user = userEvent.setup()
    sqlCatalog.result = catalogResult({ state: 'settled', tables: SAMPLE_TABLES, count: 4 })
    const { onClose } = renderSqlSheet()
    await user.click(screen.getByRole('button', { name: 'Tables · 4' }))
    await screen.findByTestId('tables-popover')

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByTestId('tables-popover')).not.toBeInTheDocument()
    })
    expect(sheetRoot()).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByTestId('value-editor-unsaved-dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(editorSurface()).toHaveFocus()
    })
  })

  it('inserts the picked table at the cursor and hands focus back to the editor', async () => {
    const user = userEvent.setup()
    sqlCatalog.result = catalogResult({ state: 'settled', tables: SAMPLE_TABLES, count: 4 })
    renderSqlSheet()
    await user.click(screen.getByRole('button', { name: 'Tables · 4' }))
    await user.click(await screen.findByTestId('tables-popover-item-orders'))

    expect(scriptBody.insertAtCursor).toHaveBeenCalledTimes(1)
    expect(scriptBody.insertAtCursor.mock.calls[0][1]).toBe('orders')
    await waitFor(() => {
      expect(screen.queryByTestId('tables-popover')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(editorSurface()).toHaveFocus()
    })
  })

  it('keeps Got N tables until the draft changes, then settles it', async () => {
    const user = userEvent.setup()
    sqlCatalog.result = catalogResult({ state: 'reading' })
    const { rerender } = renderSqlSheet()
    sqlCatalog.result = catalogResult({ state: 'done', tables: SAMPLE_TABLES, count: 4 })
    rerender()
    expect(screen.getByRole('button', { name: 'Got 4 tables' })).toBeInTheDocument()
    expect(sqlCatalog.result.settle).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('scalar-edit-body-change'))

    expect(sqlCatalog.result.settle).toHaveBeenCalledTimes(1)
  })

  it.each([['idle' as const], ['settled' as const]])(
    'never pulls the catalog on an edit while %s',
    async (state) => {
      const user = userEvent.setup()
      sqlCatalog.result =
        state === 'settled'
          ? catalogResult({ state, tables: SAMPLE_TABLES, count: 4 })
          : catalogResult({ state })
      renderSqlSheet()
      await user.click(screen.getByTestId('scalar-edit-body-change'))
      expect(sqlCatalog.result.start).not.toHaveBeenCalled()
      expect(sqlCatalog.result.refresh).not.toHaveBeenCalled()
    },
  )
})

describe('ValueEditorSheet - SQL editor composition (SQL-10, SQL-11, SQL-12)', () => {
  it('suggests with the Database type, the Parameters names, the loaded tables, the variables and the kind', () => {
    sqlCatalog.result = catalogResult({ state: 'settled', tables: SAMPLE_TABLES, count: 4 })
    renderSqlSheet({ availableVariables: SQL_VARIABLES })
    expect(sqlCompletion.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        databaseType: 'mysql',
        parameterNames: ['customer', 'status'],
        tables: SAMPLE_TABLES,
        variables: SQL_VARIABLES,
        template: false,
      }),
    )
  })

  it('starts the catalog pull from the Get tables row of the suggestion list', () => {
    renderSqlSheet()
    const { onGetTables } = sqlCompletion.create.mock.lastCall![0] as { onGetTables: () => void }
    act(() => onGetTables())
    expect(sqlCatalog.result.start).toHaveBeenCalledTimes(1)
  })

  it('underlines the findings in the dialect of the Database type', () => {
    scriptSyntax.issues = [UNDEFINED_REGION]
    renderSqlSheet()
    expect(sqlMode.build).toHaveBeenLastCalledWith(
      expect.objectContaining({ databaseType: 'mysql', issues: [UNDEFINED_REGION] }),
    )
    expect(sqlMode.build.mock.lastCall![0]).toHaveProperty('viewRef')
  })

  it('composes no SQL editor for a Python body', () => {
    renderPythonSheet()
    expect(sqlCompletion.create).not.toHaveBeenCalled()
    expect(sqlMode.build).not.toHaveBeenCalled()
  })
})

function renderScriptSheet(format: 'python' | 'sql', runBusy = false) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  const onRun = vi.fn()
  const onStop = vi.fn()
  const sheet = (busy: boolean) => (
    <ValueEditorSheet
      label="Script"
      name="script"
      type="string"
      value={format === 'python' ? PYTHON_SCRIPT : SAMPLE_SCRIPT}
      isTemplate={false}
      allowedFormats={[format]}
      availableVariables={[]}
      runBusy={busy}
      runAllowed
      onRun={onRun}
      onStop={onStop}
      onSave={onSave}
      onClose={onClose}
    />
  )
  const view = render(sheet(runBusy))
  return {
    onSave,
    onClose,
    onRun,
    onStop,
    setRunBusy: (busy: boolean) => view.rerender(sheet(busy)),
  }
}

describe.each([['python' as const], ['sql' as const]])(
  'ValueEditorSheet - Stop while a run is in flight (%s, SQL-13, PYRUN-21)',
  (format) => {
    it('shows Run and no Stop while nothing runs', () => {
      renderScriptSheet(format)
      expect(runButton()).toBeInTheDocument()
      expect(screen.queryByTestId('value-editor-stop-button')).not.toBeInTheDocument()
      expect(screen.queryByTestId('value-editor-run-spinner')).not.toBeInTheDocument()
    })

    it('shows a decorative spinner and Stop in place of Run', () => {
      renderScriptSheet(format, true)
      expect(screen.queryByTestId('value-editor-run-button')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument()
      expect(screen.getByTestId('value-editor-run-spinner')).toHaveAttribute('aria-hidden', 'true')
      expect(stopButton()).toHaveAttribute('aria-label', 'Stop')
      expect(stopButton()).toHaveTextContent(/^Stop$/)
      expect(stopButton()).toBeEnabled()
      const square = stopButton().querySelector('svg.lucide-square')
      expect(square).not.toBeNull()
      expect(square).toHaveAttribute('aria-hidden', 'true')
    })

    it('stops the run on Stop', async () => {
      const user = userEvent.setup()
      const { onStop, onRun } = renderScriptSheet(format, true)
      await user.click(screen.getByRole('button', { name: 'Stop' }))
      expect(onStop).toHaveBeenCalledTimes(1)
      expect(onRun).not.toHaveBeenCalled()
    })

    it('disables Save while a run is in flight', async () => {
      const user = userEvent.setup()
      renderScriptSheet(format, true)
      await user.click(screen.getByTestId('scalar-edit-body-change'))
      expectRealDisabled(saveButton())
    })

    it('ignores Ctrl+Enter while a run is in flight', async () => {
      const user = userEvent.setup()
      const { onSave } = renderScriptSheet(format, true)
      await user.click(screen.getByTestId('scalar-edit-body-change'))
      fireEvent.keyDown(sheetRoot(), { key: 'Enter', ctrlKey: true })
      expect(onSave).not.toHaveBeenCalled()
    })

    it("disables the unsaved-changes question's Save while a run is in flight", async () => {
      const user = userEvent.setup()
      const { onSave } = renderScriptSheet(format, true)
      await user.click(screen.getByTestId('scalar-edit-body-change'))
      await user.click(screen.getByTestId('value-editor-cancel-button'))
      expect(screen.getByTestId('value-editor-unsaved-save-button')).toBeDisabled()
      expect(onSave).not.toHaveBeenCalled()
    })

    it('keeps Close usable while a run is in flight', async () => {
      const user = userEvent.setup()
      const { onClose } = renderScriptSheet(format, true)
      await user.click(screen.getByTestId('value-editor-cancel-button'))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('ignores Shift+Enter while a run is in flight', () => {
      const { onRun } = renderScriptSheet(format, true)
      fireEvent.keyDown(sheetRoot(), { key: 'Enter', shiftKey: true })
      expect(onRun).not.toHaveBeenCalled()
    })

    it('moves focus from Run to Stop when the run starts', () => {
      const { setRunBusy } = renderScriptSheet(format)
      act(() => runButton().focus())
      setRunBusy(true)
      expect(stopButton()).toHaveFocus()
    })

    it('moves focus from Stop back to Run when the run ends', () => {
      const { setRunBusy } = renderScriptSheet(format, true)
      act(() => stopButton().focus())
      setRunBusy(false)
      expect(runButton()).toHaveFocus()
    })

    it('leaves focus in the editor while a run starts and ends', () => {
      const { setRunBusy } = renderScriptSheet(format)
      act(() => editorSurface().focus())
      setRunBusy(true)
      expect(editorSurface()).toHaveFocus()
      setRunBusy(false)
      expect(editorSurface()).toHaveFocus()
    })
  },
)

describe('ValueEditorSheet - Stop with no stop offered (SQL-13)', () => {
  it('does nothing on Stop when the host offers no stop', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <ValueEditorSheet
        label="SQL"
        name="sql"
        type="string"
        value={SAMPLE_SCRIPT}
        isTemplate={false}
        allowedFormats={['sql']}
        availableVariables={[]}
        runBusy
        runAllowed
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(sheetRoot()).toBeInTheDocument()
  })
})

describe('ValueEditorSheet - SQL Template kind highlight (SQL-10)', () => {
  it('builds the SQL body with the {{ }} template highlight in Template kind', () => {
    renderSqlSheet({ isTemplate: true })
    expect(sqlMode.build).toHaveBeenLastCalledWith(expect.objectContaining({ template: true }))
  })

  it('builds the SQL body without the template highlight in Literal kind', () => {
    renderSqlSheet()
    expect(sqlMode.build).toHaveBeenLastCalledWith(expect.objectContaining({ template: false }))
  })

  it('adds the template highlight once the Kind switches to Template', async () => {
    const user = userEvent.setup()
    renderSqlSheet()
    await pickFromSelect(user, 'kind-dropdown', 'Template')
    expect(sqlMode.build).toHaveBeenLastCalledWith(expect.objectContaining({ template: true }))
  })
})

// OS-12: dql and query-dsl open the Query editor; aggregation-json a literal Custom (JSON) editor with no Run.

type OpenSearchFormat = 'dql' | 'query-dsl' | 'aggregation-json'

const OPENSEARCH_SAMPLES: Record<OpenSearchFormat, string> = {
  dql: SAMPLE_DQL,
  'query-dsl': SAMPLE_QUERY_DSL,
  'aggregation-json': SAMPLE_AGGREGATION_JSON,
}

const OPENSEARCH_FORMATS: Array<[OpenSearchFormat]> = [['dql'], ['query-dsl'], ['aggregation-json']]
const QUERY_FORMATS: Array<[OpenSearchFormat, string]> = [
  ['dql', 'DQL'],
  ['query-dsl', 'Query DSL'],
]

const UNKNOWN_FIELD = {
  line: 1,
  message: 'Unknown field log.invalid in filebeat-*',
  severity: 'warning' as const,
  from: 0,
  to: 11,
}

const TRAILING_AND = {
  line: 2,
  message: "Expected a field or a value after 'and'",
  severity: 'warning' as const,
  from: 30,
  to: 33,
}

interface OpenSearchOverrides {
  value?: string
  isTemplate?: boolean
  allowTemplate?: boolean
  runBusy?: boolean
  runAllowed?: boolean
  runBlockedNote?: string | null
}

function renderOpenSearchSheet(format: OpenSearchFormat, overrides: OpenSearchOverrides = {}) {
  const onSave = vi.fn()
  const onClose = vi.fn()
  const onRun = vi.fn()
  const onStop = vi.fn()
  const sheet = (props: OpenSearchOverrides) => (
    <ValueEditorSheet
      label={format === 'aggregation-json' ? 'Custom (JSON)' : 'Query'}
      name="query"
      type="string"
      value={props.value ?? OPENSEARCH_SAMPLES[format]}
      isTemplate={props.isTemplate ?? false}
      allowTemplate={props.allowTemplate ?? true}
      allowedFormats={[format]}
      availableVariables={[]}
      nodeId="node-os"
      openSearchFieldsRequest={SAMPLE_FIELDS_REQUEST}
      openSearchIndex="filebeat-*"
      runBusy={props.runBusy ?? false}
      runAllowed={props.runAllowed ?? true}
      runBlockedNote={props.runBlockedNote}
      onRun={onRun}
      onStop={onStop}
      onSave={onSave}
      onClose={onClose}
    />
  )
  const view = render(sheet(overrides))
  return {
    onSave,
    onClose,
    onRun,
    onStop,
    rerender: (next: OpenSearchOverrides = {}) => view.rerender(sheet({ ...overrides, ...next })),
  }
}

const getFieldsButton = () => screen.getByRole('button', { name: 'Get fields' })

/** The help popover is the dialog its Keyboard heading names. */
async function findKeyboardHelp() {
  const heading = await screen.findByText('Keyboard')
  const popover = heading.closest('[role="dialog"]') as HTMLElement
  expect(popover).toHaveAccessibleName('Keyboard')
  return popover
}

async function openOpenSearchHelp(user: ReturnType<typeof userEvent.setup>) {
  await user.click(helpChip())
  return findKeyboardHelp()
}

async function openFieldsPopover(user: ReturnType<typeof userEvent.setup>, chipName: string) {
  await user.click(screen.getByRole('button', { name: chipName }))
  return screen.findByRole('dialog', { name: 'Fields' })
}

describe('ValueEditorSheet - OpenSearch editor footer (OS-12)', () => {
  it.each(QUERY_FORMATS)(
    'opens a body locked to %s in Literal kind with the Format locked to %s',
    (format, label) => {
      renderOpenSearchSheet(format)
      expect(screen.getByTestId('scalar-edit-body')).toBeInTheDocument()
      expect(screen.getByTestId('kind-dropdown')).toHaveTextContent(/^Literal$/)
      expect(screen.getByTestId('format-dropdown')).toHaveTextContent(new RegExp(`^${label}$`))
      expect(screen.getByTestId('format-dropdown')).toBeDisabled()
    },
  )

  it.each(QUERY_FORMATS)('opens a template %s body in Template kind, without the Format dropdown', (format) => {
    renderOpenSearchSheet(format, { isTemplate: true })
    expect(screen.getByTestId('kind-dropdown')).toHaveTextContent(/^Template$/)
    expect(screen.queryByTestId('format-dropdown')).not.toBeInTheDocument()
  })

  it('offers no Kind dropdown where the host allows no template', () => {
    renderOpenSearchSheet('dql', { allowTemplate: false })
    expect(screen.queryByTestId('kind-dropdown')).not.toBeInTheDocument()
    expect(screen.getByTestId('format-dropdown')).toHaveTextContent(/^DQL$/)
  })

  it('opens a Custom (JSON) body with the Format locked to JSON and no Kind dropdown', () => {
    renderOpenSearchSheet('aggregation-json')
    expect(screen.queryByTestId('kind-dropdown')).not.toBeInTheDocument()
    expect(screen.getByTestId('format-dropdown')).toHaveTextContent(/^JSON$/)
    expect(screen.getByTestId('format-dropdown')).toBeDisabled()
  })

  it('keeps a Custom (JSON) body literal, even for a value flagged template', async () => {
    const user = userEvent.setup()
    const { onSave } = renderOpenSearchSheet('aggregation-json', { isTemplate: true })
    expect(screen.queryByTestId('kind-dropdown')).not.toBeInTheDocument()
    expect(screen.getByTestId('format-dropdown')).toHaveTextContent(/^JSON$/)
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(saveButton())
    expect(onSave).toHaveBeenCalledWith('typed', false, [], undefined)
  })

  it.each(OPENSEARCH_FORMATS)('carries the F1 Help chip and the Get fields chip in %s mode', (format) => {
    renderOpenSearchSheet(format)
    expect(helpChip()).toHaveTextContent('F1')
    expect(helpChip()).toHaveTextContent('Help')
    expect(getFieldsButton()).toBeInTheDocument()
  })

  it.each(OPENSEARCH_FORMATS)('offers no pretty-print button in %s mode', (format) => {
    renderOpenSearchSheet(format)
    expect(screen.queryByTestId('value-editor-string-format-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('value-editor-format-button')).not.toBeInTheDocument()
  })

  it.each(QUERY_FORMATS)('lays the %s footer out Kind, Format, Help, Get fields, Close, Save, Run', (format) => {
    renderOpenSearchSheet(format)
    expectInDocumentOrder([
      screen.getByTestId('kind-dropdown'),
      screen.getByTestId('format-dropdown'),
      helpChip(),
      getFieldsButton(),
      screen.getByTestId('value-editor-cancel-button'),
      saveButton(),
      screen.getByTestId('value-editor-run-button'),
    ])
  })

  it('lays the Custom (JSON) footer out Format, Help, Get fields, Close, Save', () => {
    renderOpenSearchSheet('aggregation-json')
    expectInDocumentOrder([
      screen.getByTestId('format-dropdown'),
      helpChip(),
      getFieldsButton(),
      screen.getByTestId('value-editor-cancel-button'),
      saveButton(),
    ])
  })

  it('offers no Run for a Custom (JSON) body, even when the host passes one', () => {
    renderOpenSearchSheet('aggregation-json')
    expect(screen.queryByTestId('value-editor-run-button')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(saveButton()).toBeInTheDocument()
  })

  it('offers no Stop and no run spinner for a Custom (JSON) body while a run is in flight', () => {
    renderOpenSearchSheet('aggregation-json', { runBusy: true })
    expect(screen.queryByTestId('value-editor-stop-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('value-editor-run-spinner')).not.toBeInTheDocument()
  })

  it('never runs a Custom (JSON) body on Shift+Enter', async () => {
    const user = userEvent.setup()
    const { onRun } = renderOpenSearchSheet('aggregation-json')
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    fireEvent.keyDown(sheetRoot(), { key: 'Enter', shiftKey: true })
    expect(onRun).not.toHaveBeenCalled()
  })

  it('shows no Get fields chip in the SQL editor', () => {
    renderSqlSheet()
    expect(screen.queryByRole('button', { name: 'Get fields' })).not.toBeInTheDocument()
  })

  it('shows no Get fields chip in the Python editor', () => {
    renderPythonSheet()
    expect(screen.queryByRole('button', { name: 'Get fields' })).not.toBeInTheDocument()
  })

  it('shows no Get fields chip for a plain body', () => {
    renderSheet({ type: 'string', value: 'hi' })
    expect(screen.queryByRole('button', { name: 'Get fields' })).not.toBeInTheDocument()
  })

  it('shows no Get Tables chip in an OpenSearch editor', () => {
    renderOpenSearchSheet('dql')
    expect(screen.queryByRole('button', { name: 'Get Tables' })).not.toBeInTheDocument()
  })
})

describe('ValueEditorSheet - OpenSearch sheet geometry (OS-12)', () => {
  beforeEach(() => {
    window.innerWidth = 1200
    window.innerHeight = 800
  })

  afterEach(() => {
    window.innerWidth = 1024
    window.innerHeight = 768
  })

  it.each(OPENSEARCH_FORMATS)('opens at 720x460 in %s mode', (format) => {
    renderOpenSearchSheet(format)
    expect(sheetRoot().style.width).toBe('720px')
    expect(sheetRoot().style.height).toBe('460px')
  })
})

// The footer stays one line at the 720 floor whatever the font: only the catalog chip gives way.
describe('ValueEditorSheet - one footer line in a script editor (OS-12, SQL-10, PYRUN-13)', () => {
  const runControl = () => screen.getByTestId('value-editor-run-button').parentElement as HTMLElement

  function expectWholeControls() {
    expect(helpChip()).toHaveClass('shrink-0')
    expect(screen.getByTestId('value-editor-cancel-button')).toHaveClass('shrink-0')
    expect(saveButton()).toHaveClass('shrink-0')
  }

  it('keeps Kind, Format, Help, Close, Save and Run whole beside a failed Get fields in Query DSL', () => {
    openSearchFields.result = fieldsResult({ state: 'failed', error: 'Connection refused' })
    renderOpenSearchSheet('query-dsl')

    expect(screen.getByTestId('kind-dropdown')).toHaveClass('shrink-0', 'whitespace-nowrap')
    expect(screen.getByTestId('format-dropdown')).toHaveClass('shrink-0', 'whitespace-nowrap')
    expectWholeControls()
    expect(runControl()).toHaveClass('shrink-0')
    expect(screen.getByTestId('get-tables-chip')).toHaveClass('min-w-0')
    expect(screen.getByRole('button', { name: 'Could not get fields' })).toBeInTheDocument()
  })

  it('keeps Stop whole while a run is in flight', () => {
    renderOpenSearchSheet('dql', { runBusy: true })

    expect(screen.getByTestId('value-editor-stop-button').parentElement).toHaveClass('shrink-0')
  })

  it('keeps Kind, Format, Help, Close, Save and Run whole in the SQL editor', () => {
    renderSqlSheet()

    expect(screen.getByTestId('kind-dropdown')).toHaveClass('shrink-0')
    expect(screen.getByTestId('format-dropdown')).toHaveClass('shrink-0')
    expectWholeControls()
    expect(runControl()).toHaveClass('shrink-0')
  })

  it('keeps Help, Close, Save and Run whole in the Python editor', () => {
    renderPythonSheet()

    expectWholeControls()
    expect(runControl()).toHaveClass('shrink-0')
  })
})

describe('ValueEditorSheet - OpenSearch checks (OS-12)', () => {
  it.each(OPENSEARCH_FORMATS)(
    'checks the draft in %s mode with the index and no fields job while none is loaded',
    (format) => {
      renderOpenSearchSheet(format)
      const [nodeId, doc, mode, options] = lastScriptCall()
      expect(nodeId).toBe('node-os')
      expect(doc).toBe(OPENSEARCH_SAMPLES[format])
      expect(mode).toBe(format)
      expect(options).toMatchObject({
        template: false,
        openSearch: { index: 'filebeat-*', fieldsJobId: null },
      })
    },
  )

  it('checks with the job of the loaded fields', () => {
    openSearchFields.result = loadedFields('settled')
    renderOpenSearchSheet('dql')
    expect(lastScriptCall()[3].openSearch).toEqual({ index: 'filebeat-*', fieldsJobId: 'fields-job-1' })
  })

  it('checks a template query as a template', () => {
    renderOpenSearchSheet('query-dsl', { isTemplate: true })
    expect(lastScriptCall()[3].template).toBe(true)
  })

  it('checks as a template once the Kind switches to Template', async () => {
    const user = userEvent.setup()
    renderOpenSearchSheet('dql')
    await pickFromSelect(user, 'kind-dropdown', 'Template')
    expect(lastScriptCall()[3].template).toBe(true)
    expect(screen.queryByTestId('format-dropdown')).not.toBeInTheDocument()
  })

  it('checks a Custom (JSON) body as a literal, even for a value flagged template', () => {
    renderOpenSearchSheet('aggregation-json', { isTemplate: true })
    const [, , mode, options] = lastScriptCall()
    expect(mode).toBe('aggregation-json')
    expect(options.template).toBe(false)
  })

  it('checks the edited draft', async () => {
    const user = userEvent.setup()
    renderOpenSearchSheet('dql')
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    const [, doc, mode] = lastScriptCall()
    expect(doc).toBe('typed')
    expect(mode).toBe('dql')
  })

  it('shows no strip while the query has no findings', () => {
    renderOpenSearchSheet('dql')
    expect(screen.queryByTestId('value-editor-validation')).not.toBeInTheDocument()
  })

  it('lists a warning as "Line {n}: {message}"', () => {
    scriptSyntax.issues = [UNKNOWN_FIELD]
    renderOpenSearchSheet('dql')
    expect(screen.getByTestId('value-editor-validation')).toHaveTextContent(
      /^Line 1: Unknown field log\.invalid in filebeat-\*$/,
    )
  })

  it('lists every warning in the order the check gives them', async () => {
    const user = userEvent.setup()
    scriptSyntax.issues = [UNKNOWN_FIELD, TRAILING_AND]
    renderOpenSearchSheet('dql')
    expect(screen.getByTestId('value-editor-validation-more')).toHaveTextContent('(+1 more)')
    await user.click(screen.getByTestId('value-editor-validation-more'))
    const list = await screen.findByTestId('value-editor-validation-more-list')
    expect(within(list).getByText('Line 1: Unknown field log.invalid in filebeat-*')).toBeInTheDocument()
    expect(within(list).getByText("Line 2: Expected a field or a value after 'and'")).toBeInTheDocument()
  })

  it.each(OPENSEARCH_FORMATS)('paints the %s warnings as advisory, never as an error', (format) => {
    scriptSyntax.issues = [UNKNOWN_FIELD]
    renderOpenSearchSheet(format)
    const strip = screen.getByTestId('value-editor-validation')
    expect(strip).not.toHaveAttribute('role')
    expect(strip).toHaveClass('text-amber-600')
  })

  it.each(QUERY_FORMATS)('keeps Run and Save enabled while the %s query has warnings', async (format) => {
    const user = userEvent.setup()
    scriptSyntax.issues = [UNKNOWN_FIELD, TRAILING_AND]
    renderOpenSearchSheet(format)
    expect(runButton()).toBeEnabled()
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    expect(saveButton()).toBeEnabled()
  })

  it('saves a Custom (JSON) body that has warnings', async () => {
    const user = userEvent.setup()
    scriptSyntax.issues = [UNKNOWN_FIELD]
    const { onSave } = renderOpenSearchSheet('aggregation-json')
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(saveButton())
    expect(onSave).toHaveBeenCalledWith('typed', false, [], undefined)
  })

  it.each([['query-dsl' as const], ['aggregation-json' as const]])(
    'never blocks Save on a %s draft that is not JSON',
    async (format) => {
      const user = userEvent.setup()
      renderOpenSearchSheet(format)
      await user.click(screen.getByTestId('scalar-edit-body-change'))
      expect(saveButton()).toBeEnabled()
      expect(screen.queryByTestId('value-editor-validation')).not.toBeInTheDocument()
    },
  )

  it('never asks the Python interpreter about a query', async () => {
    const user = userEvent.setup()
    renderOpenSearchSheet('dql')
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(saveButton())
    await user.click(runButton())
    expect(pythonTools.checkPython).not.toHaveBeenCalled()
  })
})

describe('ValueEditorSheet - Run in the Query editor (OS-12, SQL-13, PYRUN-21)', () => {
  it.each(QUERY_FORMATS)('runs the %s draft and never saves it', async (format) => {
    const user = userEvent.setup()
    const { onRun, onSave } = renderOpenSearchSheet(format)
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    await user.click(runButton())
    expect(onRun).toHaveBeenCalledExactlyOnceWith('typed')
    expect(onSave).not.toHaveBeenCalled()
    expect(sheetRoot()).toBeInTheDocument()
  })

  it('runs the saved query when nothing was typed yet', async () => {
    const user = userEvent.setup()
    const { onRun } = renderOpenSearchSheet('dql')
    await user.click(runButton())
    expect(onRun).toHaveBeenCalledExactlyOnceWith(SAMPLE_DQL)
  })

  it('runs the draft on Shift+Enter without saving', async () => {
    const user = userEvent.setup()
    const { onRun, onSave } = renderOpenSearchSheet('query-dsl')
    await user.click(screen.getByTestId('scalar-edit-body-change'))
    fireEvent.keyDown(sheetRoot(), { key: 'Enter', shiftKey: true })
    expect(onRun).toHaveBeenCalledExactlyOnceWith('typed')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('disables Run when the block cannot run from here', () => {
    renderOpenSearchSheet('dql', { runAllowed: false })
    expectRealDisabled(runButton())
  })

  it("disables Run while something other than the query blocks the parent's Save", () => {
    const { onRun } = renderOpenSearchSheet('dql', {
      runBlockedNote: 'Save is disabled: the settings have errors',
    })
    expectRealDisabled(runButton())
    fireEvent.keyDown(sheetRoot(), { key: 'Enter', shiftKey: true })
    expect(onRun).not.toHaveBeenCalled()
  })

  it('turns Run into Stop while a run from here is in flight, and Stop ends it', async () => {
    const user = userEvent.setup()
    const { onStop, onRun } = renderOpenSearchSheet('dql', { runBusy: true })
    expect(screen.queryByTestId('value-editor-run-button')).not.toBeInTheDocument()
    await user.click(stopButton())
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onRun).not.toHaveBeenCalled()
  })

  it('saves a Template-kind query as a template', async () => {
    const user = userEvent.setup()
    const { onSave } = renderOpenSearchSheet('dql')
    await pickFromSelect(user, 'kind-dropdown', 'Template')
    await user.click(saveButton())
    expect(onSave).toHaveBeenCalledWith(SAMPLE_DQL, true, [], undefined)
  })
})

// Only keys that work in that editor: DQL and JSON have no comments, a Custom (JSON) stat never runs.
const OPENSEARCH_HELP_KEYS: Record<OpenSearchFormat, string[]> = {
  dql: SQL_HELP_KEYS.filter((label) => label !== 'Toggle comment'),
  'query-dsl': SQL_HELP_KEYS.filter((label) => label !== 'Toggle comment'),
  'aggregation-json': SQL_HELP_KEYS.filter((label) => label !== 'Toggle comment' && label !== 'Run'),
}

describe('ValueEditorSheet - OpenSearch help (OS-12)', () => {
  it.each(OPENSEARCH_FORMATS)('opens the keyboard list on F1 in %s mode, with no tips', async (format) => {
    renderOpenSearchSheet(format)
    expect(helpChip()).toBeInTheDocument()
    fireEvent.keyDown(sheetRoot(), { key: 'F1' })
    const popover = await findKeyboardHelp()
    for (const label of OPENSEARCH_HELP_KEYS[format]) {
      expect(within(popover).getByText(label)).toBeInTheDocument()
    }
    expect(within(popover).queryByText('Toggle comment')).not.toBeInTheDocument()
    expect(within(popover).queryByText('Rename symbol')).not.toBeInTheDocument()
    expect(within(popover).queryByText('F2')).not.toBeInTheDocument()
    expect(within(popover).queryByRole('button', { name: 'Show tips' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('python-help-popover')).not.toBeInTheDocument()
  })

  it('lists Run for a Query body', async () => {
    renderOpenSearchSheet('query-dsl')
    fireEvent.keyDown(sheetRoot(), { key: 'F1' })
    expect(within(await findKeyboardHelp()).getByText('Run')).toBeInTheDocument()
  })

  it('lists no Run for a Custom (JSON) body, which never runs', async () => {
    renderOpenSearchSheet('aggregation-json')
    fireEvent.keyDown(sheetRoot(), { key: 'F1' })
    expect(within(await findKeyboardHelp()).queryByText('Run')).not.toBeInTheDocument()
  })

  it('opens the help when the chip is clicked', async () => {
    const user = userEvent.setup()
    renderOpenSearchSheet('dql')
    expect(await openOpenSearchHelp(user)).toBeInTheDocument()
  })

  it('closes the help first on Escape, leaves the sheet open and puts focus on the editor', async () => {
    const user = userEvent.setup()
    const { onClose } = renderOpenSearchSheet('query-dsl')
    await openOpenSearchHelp(user)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Keyboard')).not.toBeInTheDocument()
    expect(sheetRoot()).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(editorSurface()).toHaveFocus()
    })
  })
})

describe('ValueEditorSheet - Get fields in the OpenSearch editor (OS-12, OS-13)', () => {
  it.each(OPENSEARCH_FORMATS)("pulls the fields with the host's request in %s mode", (format) => {
    renderOpenSearchSheet(format)
    expect(openSearchFields.calls.at(-1)).toEqual(SAMPLE_FIELDS_REQUEST)
  })

  it('asks for no fields in the SQL editor', () => {
    renderSqlSheet()
    expect(openSearchFields.calls.every((request) => request === null)).toBe(true)
  })

  it('asks for no fields in the Python editor', () => {
    renderPythonSheet()
    expect(openSearchFields.calls.every((request) => request === null)).toBe(true)
  })

  it('asks for no fields for a plain body', () => {
    renderSheet({ type: 'string', value: 'hi' })
    expect(openSearchFields.calls.every((request) => request === null)).toBe(true)
  })

  it('asks for no SQL catalog in an OpenSearch editor', () => {
    renderOpenSearchSheet('dql')
    expect(sqlCatalog.calls.every((request) => request === null)).toBe(true)
  })

  it('pulls nothing while the host gives no request', () => {
    render(
      <ValueEditorSheet
        label="Query"
        name="query"
        type="string"
        value={SAMPLE_DQL}
        isTemplate={false}
        allowedFormats={['dql']}
        availableVariables={[]}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(openSearchFields.calls.every((request) => request === null)).toBe(true)
    expect(lastScriptCall()[2]).toBe('dql')
  })

  it('starts the pull from the idle chip', async () => {
    const user = userEvent.setup()
    renderOpenSearchSheet('dql')
    await user.click(getFieldsButton())
    expect(openSearchFields.result.start).toHaveBeenCalledTimes(1)
  })

  it('shows Getting fields... while the pull runs, and its Stop stops only the pull', async () => {
    const user = userEvent.setup()
    openSearchFields.result = fieldsResult({ state: 'reading' })
    const { onStop } = renderOpenSearchSheet('dql')
    expect(screen.getByText('Getting fields...')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop getting fields' }))
    expect(openSearchFields.result.stop).toHaveBeenCalledTimes(1)
    expect(openSearchFields.result.start).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
  })

  it('tries again from the failed chip', async () => {
    const user = userEvent.setup()
    openSearchFields.result = fieldsResult({ state: 'failed', error: 'Authentication failed (401)' })
    renderOpenSearchSheet('dql')
    await user.click(screen.getByRole('button', { name: 'Could not get fields' }))
    expect(openSearchFields.result.start).toHaveBeenCalledTimes(1)
  })

  it('shows the reason of a failed pull on the failed chip', () => {
    const reason = "Cannot resolve Cluster URL: Variable 'os_url' is not defined"
    openSearchFields.result = fieldsResult({ state: 'failed', error: reason })
    renderOpenSearchSheet('dql')
    const failed = screen.getByRole('button', { name: 'Could not get fields' })

    act(() => {
      failed.focus()
    })

    expect(screen.getByRole('tooltip').textContent).toBe(reason)
    expect(failed).toHaveAccessibleDescription(reason)
  })

  it('refreshes the loaded fields', async () => {
    const user = userEvent.setup()
    openSearchFields.result = loadedFields('settled')
    renderOpenSearchSheet('dql')
    await user.click(screen.getByRole('button', { name: 'Refresh fields' }))
    expect(openSearchFields.result.refresh).toHaveBeenCalledTimes(1)
  })

  it('opens the Fields popover with every loaded field from the settled chip', async () => {
    const user = userEvent.setup()
    openSearchFields.result = loadedFields('settled')
    renderOpenSearchSheet('dql')
    const popover = await openFieldsPopover(user, 'Fields · 11')
    expect(within(popover).getByPlaceholderText('Search fields…')).toBeInTheDocument()
    expect(
      within(popover)
        .getAllByTestId(/^tables-popover-item-/)
        .map((item) => item.dataset.testid),
    ).toEqual(SAMPLE_FIELDS.map((field) => `tables-popover-item-${field.name}`))
  })

  it('opens the Fields popover from the done chip', async () => {
    const user = userEvent.setup()
    openSearchFields.result = loadedFields('done')
    renderOpenSearchSheet('aggregation-json')
    expect(await openFieldsPopover(user, 'Got 11 fields')).toBeInTheDocument()
  })

  it('inserts the picked field at the cursor and hands focus back to the editor', async () => {
    const user = userEvent.setup()
    openSearchFields.result = loadedFields('settled')
    renderOpenSearchSheet('dql')
    const popover = await openFieldsPopover(user, 'Fields · 11')
    await user.click(within(popover).getByTestId('tables-popover-item-latency_ms'))

    expect(scriptBody.insertAtCursor).toHaveBeenCalledTimes(1)
    expect(scriptBody.insertAtCursor.mock.calls[0][1]).toBe('latency_ms')
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Fields' })).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(editorSurface()).toHaveFocus()
    })
  })

  it('closes only the Fields popover on Escape', async () => {
    const user = userEvent.setup()
    openSearchFields.result = loadedFields('settled')
    const { onClose } = renderOpenSearchSheet('query-dsl')
    await openFieldsPopover(user, 'Fields · 11')

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Fields' })).not.toBeInTheDocument()
    })
    expect(sheetRoot()).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps Got N fields until the draft changes, then settles it', async () => {
    const user = userEvent.setup()
    openSearchFields.result = fieldsResult({ state: 'reading' })
    const { rerender } = renderOpenSearchSheet('dql')
    openSearchFields.result = loadedFields('done')
    rerender()
    expect(screen.getByRole('button', { name: 'Got 11 fields' })).toBeInTheDocument()
    expect(openSearchFields.result.settle).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('scalar-edit-body-change'))

    expect(openSearchFields.result.settle).toHaveBeenCalledTimes(1)
  })

  it.each([['idle' as const], ['settled' as const]])(
    'never pulls the fields on an edit while %s',
    async (state) => {
      const user = userEvent.setup()
      openSearchFields.result = state === 'settled' ? loadedFields('settled') : fieldsResult({ state })
      renderOpenSearchSheet('dql')
      await user.click(screen.getByTestId('scalar-edit-body-change'))
      expect(openSearchFields.result.start).not.toHaveBeenCalled()
      expect(openSearchFields.result.refresh).not.toHaveBeenCalled()
    },
  )
})

describe('ValueEditorSheet - OpenSearch editor composition (OS-12)', () => {
  const OS_VARIABLES = [{ name: 'service', type: 'string' }]

  function renderComposed(format: OpenSearchFormat, isTemplate = false) {
    render(
      <ValueEditorSheet
        label="Query"
        name="query"
        type="string"
        value={OPENSEARCH_SAMPLES[format]}
        isTemplate={isTemplate}
        allowedFormats={[format]}
        availableVariables={OS_VARIABLES}
        nodeId="node-os"
        openSearchFieldsRequest={SAMPLE_FIELDS_REQUEST}
        openSearchIndex="filebeat-*"
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )
  }

  it('underlines the DQL warnings and keeps the Template highlight off in Literal kind', () => {
    scriptSyntax.issues = [UNKNOWN_FIELD]
    renderComposed('dql')
    expect(openSearchModes.dql).toHaveBeenLastCalledWith(
      expect.objectContaining({ issues: [UNKNOWN_FIELD], template: false }),
    )
    expect(openSearchModes.dql.mock.lastCall![0]).toHaveProperty('viewRef')
    expect(openSearchModes.queryDsl).not.toHaveBeenCalled()
  })

  it('builds the DQL body with the {{ }} highlight in Template kind', () => {
    renderComposed('dql', true)
    expect(openSearchModes.dql).toHaveBeenLastCalledWith(expect.objectContaining({ template: true }))
  })

  it.each([['query-dsl' as const], ['aggregation-json' as const]])(
    'colors a %s body as JSON and underlines its warnings',
    (format) => {
      scriptSyntax.issues = [UNKNOWN_FIELD]
      renderComposed(format)
      expect(openSearchModes.queryDsl).toHaveBeenLastCalledWith(
        expect.objectContaining({ issues: [UNKNOWN_FIELD], template: false }),
      )
      expect(openSearchModes.queryDsl.mock.lastCall![0]).toHaveProperty('viewRef')
      expect(openSearchModes.dql).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['dql' as const, 'dql'],
    ['query-dsl' as const, 'query_dsl'],
    ['aggregation-json' as const, 'aggregation'],
  ])('suggests in the %s editor with the %s language, the variables and the kind', (format, language) => {
    renderComposed(format)
    expect(openSearchCompletion.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ language, fieldsJobId: null, variables: OS_VARIABLES, template: false }),
    )
  })

  it('suggests with the job of the loaded fields', () => {
    openSearchFields.result = loadedFields('settled')
    renderComposed('dql')
    expect(openSearchCompletion.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ fieldsJobId: 'fields-job-1' }),
    )
  })

  it('starts the fields pull from the Get fields row of the suggestion list', () => {
    renderComposed('dql')
    const { onGetFields } = openSearchCompletion.create.mock.lastCall![0] as { onGetFields: () => void }
    act(() => onGetFields())
    expect(openSearchFields.result.start).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['SQL', () => renderSqlSheet()],
    ['Python', () => renderPythonSheet()],
    ['plain', () => renderSheet({ type: 'string', value: 'hi' })],
  ])('composes no OpenSearch editor for a %s body', (_body, renderBody) => {
    renderBody()
    expect(openSearchModes.dql).not.toHaveBeenCalled()
    expect(openSearchModes.queryDsl).not.toHaveBeenCalled()
    expect(openSearchCompletion.create).not.toHaveBeenCalled()
  })

  it('composes no SQL editor for an OpenSearch body', () => {
    renderComposed('dql')
    expect(sqlMode.build).not.toHaveBeenCalled()
    expect(sqlCompletion.create).not.toHaveBeenCalled()
  })
})

// A field list needs an Index pattern: while it is blank the editor offers no pull (OS-12, OS-13).
describe('ValueEditorSheet - a blank Index pattern (OS-13)', () => {
  const FILL_IN = 'Fill in Index pattern to get fields'

  type FieldsRequest = typeof SAMPLE_FIELDS_REQUEST

  function requestWithIndex(index: unknown, flags: { expression?: string[]; template?: string[] } = {}): FieldsRequest {
    return {
      ...SAMPLE_FIELDS_REQUEST,
      connection: { ...SAMPLE_FIELDS_REQUEST.connection, index },
      expression_fields: flags.expression ?? [],
      template_fields: flags.template ?? [],
    }
  }

  function sheetFor(format: OpenSearchFormat, request: FieldsRequest) {
    return (
      <ValueEditorSheet
        label={format === 'aggregation-json' ? 'Custom (JSON)' : 'Query'}
        name="query"
        type="string"
        value={OPENSEARCH_SAMPLES[format]}
        isTemplate={false}
        allowedFormats={[format]}
        availableVariables={[]}
        nodeId="node-os"
        openSearchFieldsRequest={request}
        openSearchIndex=""
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    )
  }

  const BLANK = requestWithIndex('')

  it.each(OPENSEARCH_FORMATS)('shows Get fields disabled with the Fill in tooltip in %s mode', (format) => {
    render(sheetFor(format, BLANK))
    const chipButton = getFieldsButton()

    act(() => {
      chipButton.focus()
    })

    expect(chipButton).toHaveAttribute('aria-disabled', 'true')
    expect(chipButton).toHaveClass('opacity-50', 'cursor-not-allowed')
    expect(screen.getByRole('tooltip').textContent).toBe(FILL_IN)
  })

  it.each([
    ['idle', () => fieldsResult()],
    ['failed', () => fieldsResult({ state: 'failed', error: 'Connection refused' })],
    ['settled', () => loadedFields('settled')],
  ] as const)('starts, refreshes and opens nothing from the chip while the pull is %s', async (_state, pull) => {
    const user = userEvent.setup()
    openSearchFields.result = pull()
    render(sheetFor('dql', requestWithIndex('   ')))

    await user.click(getFieldsButton())

    expect(openSearchFields.result.start).not.toHaveBeenCalled()
    expect(openSearchFields.result.refresh).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Fields' })).not.toBeInTheDocument()
  })

  it('shows the disabled Get fields and no Stop while a pull runs', () => {
    openSearchFields.result = fieldsResult({ state: 'reading' })
    render(sheetFor('dql', BLANK))

    expect(getFieldsButton()).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('button', { name: 'Stop getting fields' })).not.toBeInTheDocument()
    expect(screen.queryByText('Getting fields...')).not.toBeInTheDocument()
  })

  it.each(OPENSEARCH_FORMATS)('offers no Get fields row in the %s suggestion list', (format) => {
    render(sheetFor(format, BLANK))

    expect(openSearchCompletion.create).toHaveBeenLastCalledWith(expect.objectContaining({ onGetFields: null }))
  })

  it('suggests and checks with no fields job, even with a loaded pull', () => {
    openSearchFields.result = loadedFields('settled')
    render(sheetFor('dql', BLANK))

    expect(openSearchCompletion.create).toHaveBeenLastCalledWith(expect.objectContaining({ fieldsJobId: null }))
    expect(lastScriptCall()[3].openSearch).toEqual({ index: '', fieldsJobId: null })
  })

  it("keeps the block's one pull, which the Index pattern row shares", () => {
    render(sheetFor('dql', BLANK))

    expect(openSearchFields.calls.at(-1)).toEqual(BLANK)
  })

  it.each([
    ['an expression', requestWithIndex('', { expression: ['index'] })],
    ['a template', requestWithIndex('{{ prefix }}-*', { template: ['index'] })],
    ['a written pattern', SAMPLE_FIELDS_REQUEST],
  ] as const)('offers Get fields while the Index pattern is %s', async (_label, request) => {
    const user = userEvent.setup()
    render(sheetFor('dql', request))
    const chipButton = getFieldsButton()

    expect(chipButton).not.toHaveAttribute('aria-disabled')
    await user.click(chipButton)

    expect(openSearchFields.result.start).toHaveBeenCalledTimes(1)
    const { onGetFields } = openSearchCompletion.create.mock.lastCall![0] as { onGetFields: unknown }
    expect(onGetFields).toEqual(expect.any(Function))
  })

  it('offers Get fields and the loaded job again once the Index pattern is written', async () => {
    const user = userEvent.setup()
    openSearchFields.result = fieldsResult()
    const view = render(sheetFor('dql', BLANK))

    view.rerender(sheetFor('dql', SAMPLE_FIELDS_REQUEST))
    await user.click(getFieldsButton())

    expect(openSearchFields.result.start).toHaveBeenCalledTimes(1)
    expect(openSearchCompletion.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ onGetFields: expect.any(Function) }),
    )
  })

  it('keeps Get Tables enabled in the SQL editor', () => {
    renderSqlSheet()

    expect(screen.getByRole('button', { name: 'Get Tables' })).not.toHaveAttribute('aria-disabled')
  })
})

// Last in the file: moving a sheet is remembered for the rest of the session.
describe('ValueEditorSheet - geometry memory', () => {
  beforeEach(() => {
    window.innerWidth = 1200
    window.innerHeight = 800
  })

  afterEach(() => {
    window.innerWidth = 1024
    window.innerHeight = 768
  })

  function movePlainSheet() {
    renderSheet({ type: 'string', value: 'hi' })
    const handle = screen.getByTestId('value-editor-sheet-drag-handle')
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 140, clientY: 160 })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 140, clientY: 160 })
    expect(sheetRoot().style.width).toBe('460px')
    cleanup()
  }

  it.each([
    ['DQL', () => renderOpenSearchSheet('dql')],
    ['Query DSL', () => renderOpenSearchSheet('query-dsl')],
    ['SQL', () => renderSqlSheet()],
    ['Python', () => renderPythonSheet()],
  ])('opens the %s editor at its own size after a plain Edit value sheet was moved', (_editor, renderEditor) => {
    movePlainSheet()
    renderEditor()
    expect(sheetRoot().style.width).toBe('720px')
    expect(sheetRoot().style.height).toBe('460px')
  })
})
