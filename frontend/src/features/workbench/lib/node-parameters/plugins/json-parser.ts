/**
 * JSON Parser Plugin Parameters
 */

import { param, type InputParam, type OutputParam } from '../types'
import { PARSER_OUTPUTS, parserOutputModeParam, parserQueryOutputTypesParam } from './_parser-shared'

export const inputs: InputParam[] = [
  param('json_content', 'JSON Content', 'string', true, 'JSON document to parse and query. Must be valid JSON.', {
    allowedFormats: ['json'],
  }),
  parserOutputModeParam,
  param('queries', 'Queries', 'map', true, 'Map of alias/variable names to JSONPath expressions. At least one query required.'),
  parserQueryOutputTypesParam,
]

export const outputs: OutputParam[] = PARSER_OUTPUTS
