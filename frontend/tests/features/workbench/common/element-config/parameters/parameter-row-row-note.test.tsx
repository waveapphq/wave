/**
 * ParameterRow row notes: a descriptor's `rowNote` text shows in the amber `param-warning-<name>` line under the
 * field, an expression finding outranks it, and it never blocks Save.
 *
 * Design Reference: OS-2, OS-4; FIELDERR-3
 * REQ-3.3.2.3: Filter logs by time range
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { ValidationIssue } from '@/features/workbench/lib/expression-validation/types'

const { validator } = vi.hoisted(() => ({
  validator: { issues: [] as ValidationIssue[] },
}))

vi.mock('@/features/workbench/lib/expression-validation/validation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/workbench/lib/expression-validation/validation')>()),
  validateExpressions: () => validator.issues,
}))
vi.mock('@/features/workbench/lib/tree-sitter-init', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/workbench/lib/tree-sitter-init')>()),
  initializeTreeSitter: () => Promise.resolve(),
  isInitialized: () => true,
}))

vi.mock('@/features/workbench/api/opensearch-tools', () => ({
  checkOpenSearch: vi.fn(() => Promise.resolve({ issues: [] })),
  suggestOpenSearch: vi.fn(() => Promise.resolve({ from: 0, to: 0, items: [] })),
  startFields: vi.fn(() => new Promise(() => {})),
  getFields: vi.fn(() => new Promise(() => {})),
  cancelFields: vi.fn(() => Promise.resolve({ status: 'canceled' })),
}))

vi.mock('@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet', () => ({
  ValueEditorSheet: () => null,
}))

import { ParameterRow } from '@/features/workbench/common/element-config/parameters/parameter-row'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

/** What a `rowNote` function receives. */
interface RowNoteContext {
  value: unknown
  isExpression: boolean
  allValues: Record<string, unknown>
  now: Date
}

type NotedParameter = Parameter & {
  rowNote?: (ctx: RowNoteContext) => string | null
  timeValue?: true
}

const OS_NODE = 'os-1'
const NOTE = 'Remove "Bearer " at the start: WAVE adds it'

const UNKNOWN_TOKEN: ValidationIssue = {
  type: 'unknown_variable',
  from: 0,
  to: 5,
  message: "Variable 'token' is not defined",
  identifier: 'token',
}

function notedRow(rowNote: NotedParameter['rowNote']): NotedParameter {
  return { name: 'notes', label: 'Notes', type: 'string', required: false, rowNote }
}

const PLAIN_ROW: NotedParameter = { name: 'username', label: 'Username', type: 'string', required: false }

type RowProps = React.ComponentProps<typeof ParameterRow>

function renderRow(props: Partial<RowProps> & { parameter: NotedParameter }) {
  const onValidationChange = vi.fn()
  const view = render(
    <table>
      <tbody>
        <ParameterRow
          mode="input"
          value="plain text"
          onChange={vi.fn()}
          availableVariables={[]}
          expressionFields={[]}
          onExpressionFieldsChange={vi.fn()}
          templateFields={[]}
          onTemplateFieldsChange={vi.fn()}
          onValidationChange={onValidationChange}
          scriptEditor={{ nodeId: OS_NODE }}
          {...props}
        />
      </tbody>
    </table>,
  )
  return { onValidationChange, ...view }
}

beforeEach(() => {
  vi.clearAllMocks()
  validator.issues = []
})

afterEach(() => {
  act(() => {
    useWorkflowStore.getState().reset()
  })
})

describe('ParameterRow row note (OS-2, OS-4)', () => {
  describe('the amber line', () => {
    it('shows the rowNote text under the field', () => {
      renderRow({ parameter: notedRow(() => NOTE) })
      expect(screen.getByTestId('param-warning-notes').textContent).toBe(NOTE)
    })

    it('shows nothing when the rowNote answers null', () => {
      renderRow({ parameter: notedRow(() => null) })
      expect(screen.queryByTestId('param-warning-notes')).not.toBeInTheDocument()
    })

    it('shows nothing for a row with no rowNote', () => {
      renderRow({ parameter: PLAIN_ROW })
      expect(screen.queryByTestId('param-warning-username')).not.toBeInTheDocument()
    })

    it('is plain text, not an alert', () => {
      renderRow({ parameter: notedRow(() => NOTE) })
      expect(screen.getByTestId('param-warning-notes')).not.toHaveAttribute('role', 'alert')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('never blocks Save', () => {
      const { onValidationChange } = renderRow({ parameter: notedRow(() => NOTE) })
      expect(onValidationChange).toHaveBeenLastCalledWith('notes', null)
      expect(onValidationChange).not.toHaveBeenCalledWith('notes', expect.any(String))
    })

    it('is referenced by the field it sits under', () => {
      renderRow({ parameter: notedRow(() => NOTE) })
      const warning = screen.getByTestId('param-warning-notes')
      expect(warning.id).not.toBe('')
      const describedBy = screen.getByRole('textbox', { name: 'Notes' }).getAttribute('aria-describedby') ?? ''
      expect(describedBy.split(/\s+/)).toContain(warning.id)
    })

    it('shows the note on an expression row that has no finding of its own', () => {
      renderRow({ parameter: notedRow(() => NOTE), value: 'token', expressionFields: ['notes'] })
      expect(screen.getByTestId('param-warning-notes').textContent).toBe(NOTE)
    })

    it('shows the note first and the unsaved-secret line under it on a typed credential (OS-2, SECFLD-1)', () => {
      const SECRET_LINE = 'Secret value stays visible until you save the test.'
      renderRow({ parameter: { ...notedRow(() => NOTE), secret: true }, value: 'Bearer x' })
      const warning = screen.getByTestId('param-warning-notes')
      expect(Array.from(warning.querySelectorAll('p'), (line) => line.textContent)).toEqual([NOTE, SECRET_LINE])
      const describedBy = screen.getByRole('textbox', { name: 'Notes' }).getAttribute('aria-describedby') ?? ''
      expect(describedBy.split(/\s+/)).toContain(warning.id)
      expect(warning.closest('td')).toHaveClass('pb-11')
    })

    it('keeps one line, and the one-line room, for a note alone', () => {
      renderRow({ parameter: notedRow(() => NOTE) })
      const warning = screen.getByTestId('param-warning-notes')
      expect(warning.querySelectorAll('p')).toHaveLength(1)
      expect(warning.closest('td')).toHaveClass('pb-7')
    })

    it('lets an expression finding outrank the note', () => {
      validator.issues = [UNKNOWN_TOKEN]
      renderRow({ parameter: notedRow(() => NOTE), value: 'token', expressionFields: ['notes'] })
      expect(screen.getByTestId('param-warning-notes').textContent).toBe("Variable 'token' is not defined")
      expect(screen.queryByText(NOTE)).not.toBeInTheDocument()
    })
  })

  describe('what the rowNote reads', () => {
    it('receives the literal value, the other rows and the time', () => {
      const rowNote = vi.fn(() => null)
      renderRow({
        parameter: notedRow(rowNote),
        value: 'Bearer abc',
        allValues: { notes: 'Bearer abc', url: 'https://opensearch.example:9200' },
      })
      expect(rowNote).toHaveBeenCalledWith(
        expect.objectContaining({
          value: 'Bearer abc',
          isExpression: false,
          allValues: { notes: 'Bearer abc', url: 'https://opensearch.example:9200' },
          now: expect.any(Date),
        }),
      )
    })

    it('tells the rowNote the row holds an expression', () => {
      const rowNote = vi.fn(() => null)
      renderRow({ parameter: notedRow(rowNote), value: 'token', expressionFields: ['notes'] })
      expect(rowNote).toHaveBeenLastCalledWith(expect.objectContaining({ isExpression: true }))
    })
  })
})
