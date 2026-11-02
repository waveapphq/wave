/** Local helpers for V-PLUGIN-OPENSEARCH-SEARCH-ERRORS-FUNCTIONAL. */

import { slowQuery } from '../../helpers/opensearch-stack'

/** The slow filter `copies` times with distinct loop counts: about `copies` times as slow. */
export function repeatedSlowQuery(n: number, copies: number): string {
  const filters = Array.from({ length: copies }, (_unused, index) => slowQuery(n + index))
  return JSON.stringify({ bool: { filter: filters } })
}
