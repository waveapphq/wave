/**
 * Python tools API client - PYRUN-19 / REQ-3.4.1.2.
 *
 * Completion and the syntax check degrade silently: a failed request answers an
 * empty result so the editor never shows an error for a background call. A
 * rejected rename is the one the author asked for, so its message is thrown.
 */

import { apiClient } from '@/lib/api'

// ===========================================================================
// Types
// ===========================================================================

export type PythonCompletionKind =
  | 'variable'
  | 'function'
  | 'class'
  | 'module'
  | 'member'
  | 'keyword'

export interface PythonCompletionItem {
  label: string
  kind: PythonCompletionKind
  signature: string | null
  doc: string | null
}

export interface PythonCompletionResult {
  items: PythonCompletionItem[]
}

/** Line is 1-based, column is 0-based, in both directions. */
export interface PythonCompletionRequest {
  script: string
  line: number
  column: number
  interpreter: string
}

export interface PythonRenameRequest extends PythonCompletionRequest {
  new_name: string
}

export interface PythonRenameEdit {
  from_line: number
  from_column: number
  to_line: number
  to_column: number
  text: string
}

export interface PythonRenameResult {
  edits: PythonRenameEdit[]
}

export interface PythonCheckRequest {
  script: string
}

export interface PythonCheckIssue {
  line: number
  column: number
  message: string
}

export interface PythonCheckResult {
  issues: PythonCheckIssue[]
}

// ===========================================================================
// Methods
// ===========================================================================

const NO_COMPLETIONS: PythonCompletionResult = { items: [] }
const NO_ISSUES: PythonCheckResult = { issues: [] }

/** Completion items at the cursor. A failed request answers no items. */
export async function completePython(
  body: PythonCompletionRequest,
  signal?: AbortSignal
): Promise<PythonCompletionResult> {
  try {
    const response = await apiClient.post<PythonCompletionResult>(
      '/python-tools/complete',
      body,
      { signal }
    )
    return response.data
  } catch {
    return NO_COMPLETIONS
  }
}

/** The edits that rename the symbol at the cursor. A 400 reaches the rename box. */
export async function renamePython(body: PythonRenameRequest): Promise<PythonRenameResult> {
  const response = await apiClient.post<PythonRenameResult>('/python-tools/rename', body)
  return response.data
}

/** The syntax errors of a script, parsed and never run. A failed request answers none. */
export async function checkPython(body: PythonCheckRequest): Promise<PythonCheckResult> {
  try {
    const response = await apiClient.post<PythonCheckResult>('/python-tools/check', body)
    return response.data
  } catch {
    return NO_ISSUES
  }
}
