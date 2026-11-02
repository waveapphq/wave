/**
 * What a profile gesture says when it refuses because the environments read failed.
 * Shared by the row, bulk and form handlers so every refusal reads the same.
 */

/** Shown on the form's own error line, where the next step is saving. */
export const ENVIRONMENTS_UNAVAILABLE =
  'Could not load environments. Try Again to load them, then save.'

/** A refused gesture has no surface of its own to report on, so it reports at the gesture. */
export const ENVIRONMENTS_UNAVAILABLE_TOAST =
  'Could not load environments. Try Again to load them.'
