/**
 * What an entity list shows while it loads (LIST-6).
 *
 * One rule for every list: skeletons until the first read has finished, then
 * either the rows or the empty state, never both and never one before the
 * other. Read on its own, "not loading and no rows" is also true in the moment
 * before the first read has even started, which is how an empty state comes to
 * flash in front of a list that turns out to be full.
 *
 * A list that already has rows keeps them while a later read is out. Rows that
 * go back to skeletons take with them whatever the reader had open on one.
 */

export interface ListVisibility {
  /** Skeletons: the first read is still out, or a later one is and there is nothing to hold. */
  busy: boolean
  /** The list is genuinely empty and the reader knows it. */
  showEmpty: boolean
  /** The table itself, holding either skeletons or rows. */
  showTable: boolean
}

export function listVisibility(
  settled: boolean,
  loading: boolean,
  error: unknown,
  count: number
): ListVisibility {
  const busy = !settled || (loading && count === 0)
  return {
    busy,
    showEmpty: !busy && !error && count === 0,
    showTable: !error && (busy || count > 0),
  }
}
