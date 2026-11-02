/**
 * Rejection handler for a promise whose failure the user has already been told
 * about by the call itself: a toast it raised, the block card it put up, or the
 * console entry it wrote. The caller starts the work from somewhere it cannot
 * await, and has nothing to add - which is stated here rather than left in an
 * anonymous empty catch.
 */
export function alreadyReported(): void {
  // Nothing to add: the call reported its own failure.
}
