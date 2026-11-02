/**
 * Client-side JSONPath Evaluator
 *
 * Uses jsonpath-plus to evaluate JSONPath expressions against JSON
 * content in the browser. Used by the JSON Parser config modal's
 * test button.
 */

import { JSONPath } from 'jsonpath-plus'
import { PLAIN_INTEGER } from '@/lib/number-rule'
import { JsonNumberText, numberShapeType } from '@/lib/variable-format'
import { parseJsonExact } from '@/lib/variable-validation'

export interface JsonPathTestResult {
  success: boolean
  type?: string
  value?: unknown
  error?: string
  detail?: string
}

/**
 * Evaluate a JSONPath expression against JSON content.
 *
 * @param jsonContent - The JSON document string
 * @param jsonpathExpr - The JSONPath expression to evaluate
 * @returns The evaluation result with type and value, or error details
 */
export function evaluateJsonPath(
  jsonContent: string,
  jsonpathExpr: string
): JsonPathTestResult {
  // Parse JSON: plain values drive the query, exact values (every number as typed) are what it shows.
  let data: object
  let exact: unknown
  try {
    data = JSON.parse(jsonContent) as object
    exact = parseJsonExact(jsonContent)
  } catch (e) {
    return {
      success: false,
      error: 'JSON Parse Error',
      detail: e instanceof Error ? e.message : String(e),
    }
  }

  // Evaluate JSONPath
  try {
    const matches: JsonPathMatch[] = JSONPath({ path: jsonpathExpr, json: data, resultType: 'all' })
    return convertJsonPathResult(matches.map((match) => exactValue(match, exact)))
  } catch (e) {
    return {
      success: false,
      error: 'Invalid JSONPath',
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Validate JSONPath syntax.
 * Returns null if valid, or an error message if invalid.
 */
export function validateJsonPathSyntax(
  jsonpathExpr: string,
  jsonContent?: string
): string | null {
  if (!jsonpathExpr.trim()) return null // empty is handled by required-field validation

  // Parse JSON content if provided, otherwise use an empty object
  let data: object = {}
  if (jsonContent?.trim()) {
    try {
      data = JSON.parse(jsonContent) as object
    } catch {
      // If the JSON itself is malformed, skip validation - the user
      // will see that error from the JSON linter instead.
      return null
    }
  }

  // Try to evaluate the expression to check syntax
  try {
    JSONPath({ path: jsonpathExpr, json: data, resultType: 'value' })
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid JSONPath expression'
  }
}

interface JsonPathMatch {
  value: unknown
  pointer: string
}

/** The node a JSON pointer names in the exact tree; a property-name match (`~`) is its own value. */
function exactValue(match: JsonPathMatch, exact: unknown): unknown {
  const { value } = match
  if (typeof value !== 'number' && (value === null || typeof value !== 'object')) return value
  let node = exact
  for (const part of match.pointer.split('/').slice(1)) {
    node = (node as Record<string, unknown>)[part.replaceAll('~1', '/').replaceAll('~0', '~')]
  }
  return node
}

/** Detect the JSON type string for a single value */
function detectJsonType(val: unknown): string {
  if (val === null) return 'null'
  if (typeof val === 'boolean') return 'boolean'
  if (val instanceof JsonNumberText) return PLAIN_INTEGER.test(val.text) ? 'integer' : 'float'
  if (typeof val === 'number') return numberShapeType(val)
  if (typeof val === 'string') return 'string'
  if (Array.isArray(val)) return 'array'
  if (typeof val === 'object') return 'map'
  return 'string'
}

/**
 * Convert a jsonpath-plus result array to our result format.
 */
function convertJsonPathResult(results: unknown[]): JsonPathTestResult {
  if (results.length === 0) {
    return { success: true, type: 'array', value: [] }
  }

  if (results.length === 1) {
    return { success: true, type: detectJsonType(results[0]), value: results[0] }
  }

  return { success: true, type: 'array', value: results }
}
