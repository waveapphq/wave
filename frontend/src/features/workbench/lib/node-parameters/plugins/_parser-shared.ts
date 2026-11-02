/**
 * Shared Parser Constants
 *
 * Input parameters and output definitions shared by json-parser and xml-parser.
 */

import { output, param, type OutputParam } from '../types'

export const parserOutputModeParam = param(
  'output_mode', 'Output Mode', 'string', false,
  'Combined: results in a single map. Individual: each query result as a separate output variable with type coercion.',
  { enumValues: ['combined', 'individual'], defaultValue: 'combined', noExpression: true },
)

export const parserQueryOutputTypesParam = param(
  'query_output_types', 'Query Output Types', 'map', false,
  'Map of query names to expected types for coercion in individual mode (string, integer, float, boolean).',
)

export const PARSER_OUTPUTS: OutputParam[] = [
  output('success', 'Success', 'boolean', 'Whether all queries executed without errors'),
  output('errors', 'Errors', 'array', 'Per-query errors: [{query, error}]'),
  output('results', 'Results', 'map', 'Query results map (combined mode only)'),
]
