/**
 * Debounced live checks of a Python, SQL or OpenSearch query body (PYRUN-13, SQL-10, OS-12).
 *
 * REQ-3.4.1.2: Python script execution
 * REQ-3.4.1.6: SQL database operations
 * REQ-3.3.2.6: OpenSearch query editor
 */

import { useEffect, useState } from 'react'
import type Parser from 'web-tree-sitter'

import {
  checkOpenSearch,
  type OpenSearchCheckIssue,
  type OpenSearchCheckRequest,
} from '@/features/workbench/api/opensearch-tools'
import { checkSql, type SqlTable } from '@/features/workbench/api/sql-tools'
import { codeUnitLength } from '@/features/workbench/lib/codemirror/opensearch-completion'
import type { AvailableVariable } from '@/features/workbench/lib/codemirror/type-inference'
import {
  checkPythonScript,
  type ScriptInputs,
} from '@/features/workbench/lib/python-script-validation/check-script'
import {
  mergeScriptIssues,
  OPENSEARCH_LANGUAGES,
  type ScriptIssue,
  type ScriptMode,
  type ScriptSyntaxError,
  type ScriptWarning,
} from '@/features/workbench/lib/python-script-validation/script-issues'
import {
  checkSqlScript,
  sqlServerIssueWarnings,
  type SqlCheckInput,
} from '@/features/workbench/lib/sql-script-validation/check-sql'
import { initializeTreeSitter } from '@/features/workbench/lib/tree-sitter-init'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import type { SqlDatabaseType } from '@/lib/codemirror/format-editor'

export interface ScriptSyntaxOptions {
  /** Python: the Input Variables and their known types. */
  inputs?: ScriptInputs
  /** SQL: the Database type, 'postgresql' by default. */
  databaseType?: SqlDatabaseType
  /** SQL: the Parameters entry names; null while Parameters is an expression (the default). */
  parameterNames?: readonly string[] | null
  /** SQL: the loaded tables; null while nothing is loaded (the default). */
  tables?: readonly SqlTable[] | null
  /** SQL: the WAVE variables a `{{ }}` expression may read. */
  variables?: readonly AvailableVariable[]
  /** SQL and OpenSearch: the body is Template kind. */
  template?: boolean
  /** OpenSearch: the Index pattern the findings name, and the job of the loaded fields (null while none is). */
  openSearch?: { index: string; fieldsJobId: string | null }
}

const DEBOUNCE_MS: Readonly<Record<ScriptMode, number>> = {
  python: 150,
  sql: 300,
  dql: 300,
  'query-dsl': 300,
  'aggregation-json': 300,
}
const NO_ISSUES: ScriptIssue[] = []
const NO_INPUTS: ScriptInputs = { names: [], types: {} }
const NO_VARIABLES: readonly AvailableVariable[] = []
const NO_OPTIONS: ScriptSyntaxOptions = {}

/** tree-sitter reports a missing token as a node named after the token itself. */
function issueMessage(node: Parser.SyntaxNode): string {
  return node.isMissing ? `Missing '${node.type}'` : 'Syntax error'
}

function collectIssues(node: Parser.SyntaxNode, issues: ScriptSyntaxError[]): void {
  if (node.isError || node.isMissing) {
    issues.push({ line: node.startPosition.row + 1, message: issueMessage(node) })
    return
  }
  for (const child of node.children) {
    collectIssues(child, issues)
  }
}

/** The syntax errors of one parse, or when there are none its check warnings. */
async function pythonIssues(doc: string, inputs: ScriptInputs): Promise<ScriptIssue[]> {
  const root = (await initializeTreeSitter()).parse(doc).rootNode
  const issues: ScriptSyntaxError[] = []
  collectIssues(root, issues)
  return issues.length > 0 ? issues : checkPythonScript(root, inputs)
}

/** A server finding over its span: line, column and length count characters, the editor counts UTF-16 units. */
function openSearchWarning(doc: string, issue: OpenSearchCheckIssue): ScriptWarning {
  let lineStart = 0
  for (let line = 1; line < issue.line; line += 1) lineStart = doc.indexOf('\n', lineStart) + 1
  const from = lineStart + codeUnitLength(doc, lineStart, issue.col - 1)
  return {
    line: issue.line,
    message: issue.message,
    severity: 'warning',
    from,
    to: from + codeUnitLength(doc, from, issue.length),
  }
}

/** Every finding of the server check is a warning; a failed request answers none. */
async function openSearchIssues(
  doc: string,
  request: Omit<OpenSearchCheckRequest, 'text'>,
  signal: AbortSignal,
): Promise<ScriptIssue[]> {
  const { issues } = await checkOpenSearch({ ...request, text: doc }, signal)
  return mergeScriptIssues([], issues.map((issue) => openSearchWarning(doc, issue)))
}

/** The local findings and, for a body with no `{{ }}`, the server parser's, all as warnings. */
async function sqlIssues(doc: string, input: SqlCheckInput, signal: AbortSignal): Promise<ScriptIssue[]> {
  const hasTemplate = doc.includes('{{')
  // The {{ }} checks read expressions with the tree-sitter parser; without it they report nothing.
  if (input.template && hasTemplate) await initializeTreeSitter().catch(() => undefined)
  const local = checkSqlScript(doc, input)
  const server = hasTemplate
    ? []
    : sqlServerIssueWarnings(
        doc,
        (await checkSql({ database_type: input.databaseType, script: doc }, signal)).issues,
      )
  return mergeScriptIssues([], [...local, ...server])
}

/** The live findings of a script body in line order, also written to the node's store entry. A null mode checks nothing. */
export function useScriptSyntaxIssues(
  nodeId: string,
  doc: string,
  scriptMode: ScriptMode | null,
  options: ScriptSyntaxOptions = NO_OPTIONS,
): ScriptIssue[] {
  const [issues, setIssues] = useState<ScriptIssue[]>(NO_ISSUES)
  const setNodeSyntaxIssues = useWorkflowStore((state) => state.setNodeSyntaxIssues)
  const {
    inputs = NO_INPUTS,
    databaseType = 'postgresql',
    parameterNames = null,
    tables = null,
    variables = NO_VARIABLES,
    template = false,
  } = options
  const index = options.openSearch?.index ?? ''
  const fieldsJobId = options.openSearch?.fieldsJobId ?? null

  useEffect(() => {
    if (scriptMode === null) return
    let current = true
    const controller = new AbortController()
    const publish = (found: ScriptIssue[]): void => {
      if (!current) return
      setIssues(found)
      setNodeSyntaxIssues(nodeId, found)
    }
    const check = (): Promise<ScriptIssue[]> => {
      if (scriptMode === 'python') return pythonIssues(doc, inputs)
      if (scriptMode === 'sql') {
        return sqlIssues(doc, { databaseType, parameterNames, tables, variables, template }, controller.signal)
      }
      const language = OPENSEARCH_LANGUAGES[scriptMode]
      return openSearchIssues(doc, { language, template, fields_job_id: fieldsJobId, index }, controller.signal)
    }
    const timer = setTimeout(() => {
      // A parser that cannot load, or a check that fails, reports nothing.
      check().then(publish, () => {
        publish(NO_ISSUES)
      })
    }, DEBOUNCE_MS[scriptMode])
    return () => {
      current = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [
    nodeId,
    doc,
    scriptMode,
    inputs,
    databaseType,
    parameterNames,
    tables,
    variables,
    template,
    index,
    fieldsJobId,
    setNodeSyntaxIssues,
  ])

  return scriptMode === null ? NO_ISSUES : issues
}
