/**
 * XML Parser Plugin Parameters
 */

import { param, type InputParam, type OutputParam } from '../types'
import { PARSER_OUTPUTS, parserOutputModeParam, parserQueryOutputTypesParam } from './_parser-shared'

export const inputs: InputParam[] = [
  param('xml_content', 'XML Content', 'string', true, 'XML document to parse and query. Must be well-formed XML.', {
    allowedFormats: ['xml'],
  }),
  parserOutputModeParam,
  param('queries', 'Queries', 'map', true, 'Map of alias/variable names to XPath expressions. At least one query required.'),
  parserQueryOutputTypesParam,
]

export const outputs: OutputParam[] = PARSER_OUTPUTS
