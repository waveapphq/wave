/**
 * System Variables Tab - Data Conversion Helpers
 *
 * Thin wrappers around shared recordToRows/rowsToRecord.
 */

import type { SystemVariablesMap } from '@/features/settings/api/global-variables/types'
import { recordToRows, rowsToRecord, type VariableRow } from '@/lib/variable-types'

/**
 * Convert API response to VariableRow[]. A masked secret keeps its `********`
 * placeholder (parity with the suite / regression editors) so the value cell
 * masks it write-only; the save path restores the stored value via
 * `restore_masked_secrets` when the placeholder is submitted unchanged.
 */
export function mapToRows(variables: SystemVariablesMap): VariableRow[] {
  return recordToRows(variables)
}

/**
 * Convert VariableRow[] back to API format.
 * Delegates to shared rowsToRecord - same format.
 */
export function rowsToMap(rows: VariableRow[]): SystemVariablesMap {
  return rowsToRecord(rows)
}
