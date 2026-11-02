/**
 * XML Query Editor - REQ-3.4.1.11
 *
 * Thin wrapper around QueryEditorBase for XPath queries.
 */

import { useMemo } from 'react'
import { QueryEditorBase, type QueryEditorBaseProps } from '@/features/workbench/common/canvas/query-editor-base'
import { evaluateXPath, validateXPathSyntax } from '@/features/workbench/lib/xpath-evaluator'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'

export interface XmlQueryEditorProps {
  queries: Record<string, string>
  expressionFields: string[]
  queryOutputTypes: Record<string, string>
  outputMode: string
  xmlContent: string
  xmlContentIsExpression: boolean
  availableVariables: AvailableVariable[]
  onQueriesChange: (queries: Record<string, string>) => void
  onExpressionFieldsChange: (fields: string[]) => void
  onQueryOutputTypesChange: (types: Record<string, string>) => void
  onValidChange?: (valid: boolean) => void
}

export function XmlQueryEditor({
  xmlContent,
  xmlContentIsExpression,
  ...rest
}: Readonly<XmlQueryEditorProps>) {
  const lang = useMemo((): QueryEditorBaseProps['lang'] => ({
    testIdPrefix: 'xml-query',
    pathPlaceholder: 'XPath expression (e.g. //book/title)',
    pathLabel: 'XPath',
    keyPrefix: 'xq',
    exprFieldPrefix: 'xpath',
    evaluate: evaluateXPath,
    validateSyntax: validateXPathSyntax,
  }), [])

  return (
    <QueryEditorBase
      {...rest}
      content={xmlContent}
      contentIsExpression={xmlContentIsExpression}
      lang={lang}
    />
  )
}
