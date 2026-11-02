/**
 * JSON Query Editor - REQ-3.4.1.16
 *
 * Thin wrapper around QueryEditorBase for JSONPath queries.
 */

import { useMemo } from 'react'
import { QueryEditorBase, type QueryEditorBaseProps } from '@/features/workbench/common/canvas/query-editor-base'
import { evaluateJsonPath, validateJsonPathSyntax } from '@/features/workbench/lib/jsonpath-evaluator'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'

export interface JsonQueryEditorProps {
  queries: Record<string, string>
  expressionFields: string[]
  queryOutputTypes: Record<string, string>
  outputMode: string
  jsonContent: string
  jsonContentIsExpression: boolean
  availableVariables: AvailableVariable[]
  onQueriesChange: (queries: Record<string, string>) => void
  onExpressionFieldsChange: (fields: string[]) => void
  onQueryOutputTypesChange: (types: Record<string, string>) => void
  onValidChange?: (valid: boolean) => void
}

export function JsonQueryEditor({
  jsonContent,
  jsonContentIsExpression,
  ...rest
}: Readonly<JsonQueryEditorProps>) {
  const lang = useMemo((): QueryEditorBaseProps['lang'] => ({
    testIdPrefix: 'json-query',
    pathPlaceholder: 'JSONPath expression (e.g. $.store.books[*].title)',
    pathLabel: 'JSONPath',
    keyPrefix: 'jq',
    exprFieldPrefix: 'jsonpath',
    evaluate: evaluateJsonPath,
    validateSyntax: validateJsonPathSyntax,
  }), [])

  return (
    <QueryEditorBase
      {...rest}
      content={jsonContent}
      contentIsExpression={jsonContentIsExpression}
      lang={lang}
    />
  )
}
