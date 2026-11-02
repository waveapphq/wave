/**
 * The issue list of a script editor: syntax errors and check warnings (PYRUN-13, SQL-10, OS-12).
 *
 * REQ-3.4.1.2: Python script execution
 * REQ-3.4.1.6: SQL database operations
 * REQ-3.3.2.6: OpenSearch query editor
 */

import type { OpenSearchLanguage } from '@/features/workbench/api/opensearch-tools'

/** One blocking syntax error of a script body. The line is 1-based. */
export interface ScriptSyntaxError {
  line: number
  message: string
}

/** A finding that never blocks Save or Run. Line 1-based, or 0 when it belongs to no line. */
export interface ScriptWarning {
  line: number
  message: string
  severity: 'warning'
  from: number
  to: number
}

export type ScriptIssue = ScriptSyntaxError | ScriptWarning

/** An OpenSearch query body: the Query row in DQL or Query DSL, or a Custom (JSON) aggregation. */
export type OpenSearchMode = 'dql' | 'query-dsl' | 'aggregation-json'

export type ScriptMode = 'python' | 'sql' | OpenSearchMode

/** The language the check and the suggestions read an OpenSearch body in. */
export const OPENSEARCH_LANGUAGES: Readonly<Record<OpenSearchMode, OpenSearchLanguage>> = {
  dql: 'dql',
  'query-dsl': 'query_dsl',
  'aggregation-json': 'aggregation',
}

/** The row that holds each script block's body: its editor's findings name it, and a Run substitutes it. */
export const SCRIPT_PARAMS: Readonly<Partial<Record<string, string>>> = {
  python: 'script',
  'sql-client': 'sql',
  opensearch: 'query',
}

export function isScriptWarning(issue: ScriptIssue): issue is ScriptWarning {
  return 'severity' in issue && issue.severity === 'warning'
}

/** "Line {n}: {message}", or just the message when the line is 0. */
export function scriptIssueText(issue: ScriptIssue): string {
  return issue.line === 0 ? issue.message : `Line ${issue.line}: ${issue.message}`
}

/** In line order (0 first); on a shared line the syntax error reads first. */
export function mergeScriptIssues(
  syntax: readonly ScriptSyntaxError[],
  warnings: readonly ScriptWarning[],
): ScriptIssue[] {
  return [...syntax, ...warnings].sort((left, right) => left.line - right.line)
}
