/**
 * Log Plugin Parameters
 */

import { LOG_LEVELS } from '@/lib/log-levels'
import { param, type InputParam, type OutputParam } from '../types'

export const inputs: InputParam[] = [
  param('message', 'Message', 'string', true, 'Text to write to the log (use expression mode for dynamic values)'),
  param('level', 'Level', 'string', false, `Log severity level - controls filtering and visual emphasis (${LOG_LEVELS.join(', ')})`, {
    enumValues: [...LOG_LEVELS], defaultValue: 'INFO',
  }),
]

export const outputs: OutputParam[] = []
