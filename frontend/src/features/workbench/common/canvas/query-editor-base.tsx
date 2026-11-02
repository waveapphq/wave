/**
 * QueryEditorBase - Shared base for JSON and XML query editors.
 *
 * Parameterized by query language (JSONPath/XPath), evaluator, and validator.
 * Each query row has two lines:
 * - Line 1: Path expression (full width) + expression toggle
 * - Line 2: alias/var_name + [type dropdown (individual)] + test button + delete button
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { Plus, Trash2, Play } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { plainJsonText } from '@/lib/variable-format'
import { ExpressionField, type AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'
import { RequiredMark } from '@/components/shared/fields/required-mark'
import { ExpressionToggle } from '@/components/shared/fields/expression-toggle'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COERCION_TYPES = [
  { value: 'string', label: 'String' },
  { value: 'integer', label: 'Integer' },
  { value: 'float', label: 'Float' },
  { value: 'boolean', label: 'Boolean' },
] as const

const ALIAS_PATTERN = /^[a-zA-Z_]\w*$/

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shared result type for query evaluations (JSONPath and XPath have identical shapes). */
export interface QueryTestResult {
  success: boolean
  type?: string
  value?: unknown
  error?: string
  detail?: string
}

interface QueryRow {
  key: string
  alias: string
  path: string
  isExpression: boolean
  type: string
}

export interface QueryEditorBaseProps {
  queries: Record<string, string>
  expressionFields: string[]
  queryOutputTypes: Record<string, string>
  outputMode: string
  content: string
  contentIsExpression: boolean
  availableVariables: AvailableVariable[]
  onQueriesChange: (queries: Record<string, string>) => void
  onExpressionFieldsChange: (fields: string[]) => void
  onQueryOutputTypesChange: (types: Record<string, string>) => void
  onValidChange?: (valid: boolean) => void
  /** Language-specific configuration */
  lang: {
    /** Test ID prefix (e.g. 'json-query' or 'xml-query') */
    testIdPrefix: string
    /** Placeholder for path input (e.g. 'JSONPath expression (e.g. $.store.books[*].title)') */
    pathPlaceholder: string
    /** Label for dialog descriptions (e.g. 'JSONPath' or 'XPath') */
    pathLabel: string
    /** Key prefix for unique row IDs (e.g. 'jq' or 'xq') */
    keyPrefix: string
    /** Expression field name prefix (e.g. 'jsonpath' or 'xpath') */
    exprFieldPrefix: string
    /** Evaluate a query path against content */
    evaluate: (content: string, path: string) => QueryTestResult
    /** Validate query path syntax */
    validateSyntax: (path: string, content: string | undefined) => string | null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let queryIdCounter = 0

function validateAlias(
  alias: string,
  allAliases: string[],
  currentIndex: number
): string | null {
  if (!alias.trim()) {
    return 'Name is required'
  }
  if (!ALIAS_PATTERN.test(alias)) {
    return 'Must start with a letter or underscore, contain only letters, numbers, and underscores'
  }
  const isDuplicate = allAliases.some((a, i) => i !== currentIndex && a === alias)
  if (isDuplicate) {
    return 'Duplicate query name'
  }
  return null
}

// ---------------------------------------------------------------------------
// Test Result Dialog
// ---------------------------------------------------------------------------

function TestResultDialog({
  isOpen,
  onClose,
  alias,
  result,
  pathLabel,
}: Readonly<{
  isOpen: boolean
  onClose: () => void
  alias: string
  result: QueryTestResult | null
  pathLabel: string
}>) {
  if (!result) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{alias || 'Query Result'}</DialogTitle>
          <DialogDescription>
            {result.success ? `${pathLabel} evaluation result` : `${pathLabel} evaluation failed`}
          </DialogDescription>
        </DialogHeader>
        {result.success ? (
          <div className="space-y-2 text-sm">
            <div className="flex gap-2">
              <span className="text-muted-foreground">Type:</span>
              <span className="font-mono">{result.type}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground">Value:</span>
              <span className="font-mono break-all">
                {Array.isArray(result.value)
                  ? result.value.map((v, i) => {
                      const vKey = `val-${i}`
                      return <div key={vKey}>[{i}] {plainJsonText(v)}</div>
                    })
                  : plainJsonText(result.value)}
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex gap-2">
              <span className="text-muted-foreground">Error:</span>
              <span className="text-destructive">{result.error}</span>
            </div>
            {result.detail && (
              <div className="flex gap-2">
                <span className="text-muted-foreground">Detail:</span>
                <span className="text-destructive break-all">{result.detail}</span>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QueryEditorBase({
  queries,
  expressionFields,
  queryOutputTypes,
  outputMode,
  content,
  contentIsExpression,
  availableVariables,
  onQueriesChange,
  onExpressionFieldsChange,
  onQueryOutputTypesChange,
  onValidChange,
  lang,
}: Readonly<QueryEditorBaseProps>) {
  const isIndividual = outputMode === 'individual'

  function nextKey(): string {
    return `${lang.keyPrefix}-${++queryIdCounter}`
  }

  const [rows, setRows] = useState<QueryRow[]>(() => {
    const exprSet = new Set(expressionFields)
    const entries = Object.entries(queries)
    if (entries.length === 0) {
      return [{ key: nextKey(), alias: '', path: '', isExpression: false, type: 'string' }]
    }
    return entries.map(([alias, path]) => ({
      key: nextKey(),
      alias,
      path,
      isExpression: exprSet.has(`queries.${alias}`),
      type: queryOutputTypes[alias] ?? 'string',
    }))
  })

  const [aliasErrors, setAliasErrors] = useState<Record<string, string | null>>({})
  const [pathErrors, setPathErrors] = useState<Record<string, string | null>>({})
  const [testResult, setTestResult] = useState<QueryTestResult | null>(null)
  const [testAlias, setTestAlias] = useState('')
  const [showTestDialog, setShowTestDialog] = useState(false)
  const focusRowIndex = useRef<number | null>(null)

  const propagate = useCallback(
    (updatedRows: QueryRow[]) => {
      const newQueries: Record<string, string> = {}
      const newTypes: Record<string, string> = {}
      const newExprFields: string[] = []
      const nonQueryFields = expressionFields.filter((f) => !f.startsWith('queries.'))

      for (const row of updatedRows) {
        if (row.alias) {
          newQueries[row.alias] = row.path
          newTypes[row.alias] = row.isExpression ? 'string' : row.type
          if (row.isExpression) {
            newExprFields.push(`queries.${row.alias}`)
          }
        }
      }
      onQueriesChange(newQueries)
      onQueryOutputTypesChange(newTypes)
      onExpressionFieldsChange([...nonQueryFields, ...newExprFields])
    },
    [expressionFields, onQueriesChange, onQueryOutputTypesChange, onExpressionFieldsChange]
  )

  const revalidate = useCallback(
    (currentRows: QueryRow[]) => {
      const allAliases = currentRows.map((r) => r.alias)
      const newAliasErrors: Record<string, string | null> = {}
      const newPathErrors: Record<string, string | null> = {}
      let hasError = false

      for (let i = 0; i < currentRows.length; i++) {
        const row = currentRows[i]
        const aliasErr = validateAlias(row.alias, allAliases, i)
        newAliasErrors[row.key] = aliasErr
        if (aliasErr) hasError = true
        if (row.isExpression) {
          newPathErrors[row.key] = null
        } else {
          const pathErr = lang.validateSyntax(row.path, contentIsExpression ? undefined : content)
          newPathErrors[row.key] = pathErr
          if (pathErr) hasError = true
        }
      }

      setAliasErrors(newAliasErrors)
      setPathErrors(newPathErrors)
      onValidChange?.(!hasError)
    },
    [onValidChange, lang, content, contentIsExpression]
  )

  const didInitialValidate = useRef(false)
  useEffect(() => {
    if (!didInitialValidate.current) {
      didInitialValidate.current = true
      revalidate(rows)
    }
  })

  const handleAliasChange = useCallback(
    (index: number, newAlias: string) => {
      const updated = [...rows]
      updated[index] = { ...updated[index], alias: newAlias }
      setRows(updated)
      revalidate(updated)
      propagate(updated)
    },
    [rows, propagate, revalidate]
  )

  const handlePathChange = useCallback(
    (index: number, newPath: string) => {
      const updated = [...rows]
      updated[index] = { ...updated[index], path: newPath }
      setRows(updated)
      revalidate(updated)
      propagate(updated)
    },
    [rows, propagate, revalidate]
  )

  const handleTypeChange = useCallback(
    (index: number, newType: string) => {
      const updated = [...rows]
      updated[index] = { ...updated[index], type: newType }
      setRows(updated)
      propagate(updated)
    },
    [rows, propagate]
  )

  const handleExpressionToggle = useCallback(
    (index: number) => {
      const updated = [...rows]
      updated[index] = { ...updated[index], isExpression: !updated[index].isExpression }
      setRows(updated)
      revalidate(updated)
      propagate(updated)
    },
    [rows, propagate, revalidate]
  )

  const handleDelete = useCallback(
    (index: number) => {
      let updated = rows.filter((_, i) => i !== index)
      if (updated.length === 0) {
        updated = [{ key: nextKey(), alias: '', path: '', isExpression: false, type: 'string' }]
      }
      setRows(updated)
      revalidate(updated)
      propagate(updated)
    },
    [rows, propagate, revalidate]
  )

  const handleAdd = useCallback(() => {
    const updated = [...rows, { key: nextKey(), alias: '', path: '', isExpression: false, type: 'string' }]
    focusRowIndex.current = updated.length - 1
    setRows(updated)
    // Eager: the new empty row's "Name is required" surfaces immediately.
    revalidate(updated)
  }, [rows, revalidate])

  const handleTest = useCallback(
    (index: number) => {
      const row = rows[index]
      const result = lang.evaluate(content, row.path)
      setTestResult(result)
      setTestAlias(row.alias)
      setShowTestDialog(true)
    },
    [rows, content, lang]
  )

  const testDisabledGlobal = contentIsExpression || !content.trim()
  const prefix = lang.testIdPrefix

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Queries<RequiredMark />
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAdd}
          data-testid={`${prefix}-add-button`}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Query
        </Button>
      </div>

      {rows.map((row, index) => {
        // Eager: blocking alias/path errors surface immediately (no touch
        // gate) so a disabled Save always shows its culprit.
        const aliasError = aliasErrors[row.key]
        const showAliasError = aliasError
        const pathError = pathErrors[row.key]
        const showPathError = pathError
        const canTest = !testDisabledGlobal && !row.isExpression && row.path.trim() !== ''
        let testDisabledReason: string | null = null
        if (testDisabledGlobal) {
          testDisabledReason = `Testing requires literal ${lang.pathLabel.startsWith('JSON') ? 'JSON' : 'XML'} content`
        } else if (row.isExpression) {
          testDisabledReason = 'Testing not available for expression queries'
        }

        return (
          <div key={row.key} data-testid={`${prefix}-row-${index}`} className="space-y-1 border rounded-md p-2 bg-muted/20">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                {row.isExpression ? (
                  <ExpressionField
                    name={`${lang.exprFieldPrefix}-${index}`}
                    value={row.path}
                    onChange={(val) => handlePathChange(index, val)}
                    availableVariables={availableVariables}
                    isFieldExpression
                  />
                ) : (
                  <Input
                    data-testid={`${prefix}-${lang.exprFieldPrefix}-${index}`}
                    aria-label={`Query ${index + 1} ${lang.pathLabel}`}
                    value={row.path}
                    onChange={(e) => handlePathChange(index, e.target.value)}
                    placeholder={lang.pathPlaceholder}
                    className={cn(
                      'h-8 text-sm font-mono',
                      showPathError && 'border-destructive'
                    )}
                  />
                )}
              </div>
              <ExpressionToggle
                pressed={row.isExpression}
                onPressedChange={() => handleExpressionToggle(index)}
                data-testid={`${prefix}-expr-toggle-${index}`}
                label={`Query ${index + 1} expression mode`}
              />
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor={`${prefix}-assign-${row.key}`} className="text-xs text-muted-foreground whitespace-nowrap">
                Assign to
              </label>
              <Input
                id={`${prefix}-assign-${row.key}`}
                ref={(el) => {
                  if (el && focusRowIndex.current === index) {
                    el.focus()
                    focusRowIndex.current = null
                  }
                }}
                data-testid={`${prefix}-alias-${index}`}
                value={row.alias}
                onChange={(e) => handleAliasChange(index, e.target.value)}
                placeholder={isIndividual ? 'Variable name' : 'Result alias'}
                className={cn(
                  'h-8 text-sm flex-1 min-w-[100px]',
                  showAliasError && 'border-destructive'
                )}
              />

              {isIndividual && (
                <Select
                  value={row.type}
                  onValueChange={(val) => handleTypeChange(index, val)}
                >
                  <SelectTrigger
                    className="h-8 text-sm w-[100px]"
                    data-testid={`${prefix}-type-${index}`}
                    aria-label={`Query ${index + 1} output type`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COERCION_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {testDisabledReason ? (
                <ConditionalTooltip content={testDisabledReason} disabled>
                  <span className="inline-flex">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled
                      data-testid={`${prefix}-test-${index}`}
                      className="h-8 w-8 p-0 text-muted-foreground pointer-events-none"
                      aria-label="Test query"
                    >
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                </ConditionalTooltip>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleTest(index)}
                  disabled={!canTest}
                  data-testid={`${prefix}-test-${index}`}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-primary"
                  aria-label="Test query"
                >
                  <Play className="h-3.5 w-3.5" />
                </Button>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(index)}
                disabled={rows.length === 1 && !row.alias && !row.path}
                data-testid={`${prefix}-delete-${index}`}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                aria-label="Delete query"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            {showPathError && (
              <p className="text-xs text-destructive pl-1" role="alert">
                {pathError}
              </p>
            )}
            {showAliasError && (
              <p className="text-xs text-destructive pl-1" role="alert">
                {aliasError}
              </p>
            )}
          </div>
        )
      })}

      <TestResultDialog
        isOpen={showTestDialog}
        onClose={() => setShowTestDialog(false)}
        alias={testAlias}
        result={testResult}
        pathLabel={lang.pathLabel}
      />
    </div>
  )
}
