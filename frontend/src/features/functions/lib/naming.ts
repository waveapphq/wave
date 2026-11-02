/**
 * Auto-naming for canvas blocks.
 *
 * Rule across plugins / controls / Functions: the FIRST instance of a
 * given base name (e.g. "Log", "fetch_user", "Function") lands on the
 * canvas with the base name itself - no `_N` suffix. Every subsequent
 * instance picks the lowest unused integer suffix so the user sees
 * "Log", "Log_1", "Log_2", ... rather than "Log_1", "Log_2", "Log_3".
 *
 * Collision is name-scoped across ALL sibling nodes - a plugin "Log"
 * and a function "Log" would step on each other (and on variable refs),
 * so the next drop of either type bumps to "Log_1".
 *
 * A user-renamed node whose label drifts off-pattern is ignored by the
 * counter.
 */

interface NamingNode {
  data: {
    label: string
    nodeType?: string
  }
}


const ESCAPE_REGEX_CHARS = /[.*+?^${}()|[\]\\]/g

function escapeForRegex(input: string): string {
  return input.replaceAll(ESCAPE_REGEX_CHARS, String.raw`\$&`)
}


/**
 * Return the next available label for a block based on ``base``:
 *   - if no sibling already uses ``base``, return ``base`` unchanged
 *   - otherwise return ``<base>_<N>`` where N is the lowest unused integer
 *
 * ``predicate`` (optional) narrows the considered sibling set. By default
 * every node in ``nodes`` participates in the collision check, which is
 * the intended behavior - canvas-wide name uniqueness keeps variable
 * references and the user's mental model consistent regardless of which
 * block type owns a given name.
 */
export function getNextSequencedName(
  nodes: ReadonlyArray<NamingNode>,
  base: string,
  predicate?: (node: NamingNode) => boolean,
): string {
  const suffixPattern = new RegExp(String.raw`^${escapeForRegex(base)}_(\d+)$`)
  const taken = new Set<number>()
  let bareTaken = false
  for (const node of nodes) {
    if (predicate && !predicate(node)) continue
    const label = node.data.label
    if (label === base) {
      bareTaken = true
      continue
    }
    const match = suffixPattern.exec(label)
    if (match) {
      taken.add(Number.parseInt(match[1], 10))
    }
  }
  if (!bareTaken) return base
  let n = 1
  while (taken.has(n)) n += 1
  return `${base}_${n}`
}


/** Convenience: Local Function instances auto-name from the "Function" base. */
export function getNextFunctionInstanceName(
  nodes: ReadonlyArray<NamingNode>,
): string {
  return getNextSequencedName(nodes, 'Function')
}
