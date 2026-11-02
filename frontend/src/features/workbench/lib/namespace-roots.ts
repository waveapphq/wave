/**
 * The reserved namespace roots. A root is a container, never a variable:
 * it cannot receive an output, cannot be set, and never appears as a
 * selectable entry in a variable picker - only its dotted members do.
 */

export const NAMESPACE_ROOTS: ReadonlySet<string> = new Set([
  'system',
  'suite',
  'regression',
])
