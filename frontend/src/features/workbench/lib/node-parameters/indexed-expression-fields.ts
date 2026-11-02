/**
 * Indexed Expression Fields
 *
 * An ordered list keeps each row's expression flag under the dotted key
 * `<param>.<i>.value` in the node's expressionFields.
 */

/** Row indices whose "<param>.<i>.value" entry appears in expressionFields. */
export function partsExprIndicesFor(paramName: string, expressionFields: string[]): Set<number> {
  const pattern = new RegExp(String.raw`^${paramName}\.(\d+)\.value$`)
  const indices = new Set<number>()
  for (const field of expressionFields) {
    const match = pattern.exec(field)
    if (match) indices.add(Number(match[1]))
  }
  return indices
}

/** Rewrite expressionFields so this param's dotted row entries equal the
 *  given row indices (other params' entries are preserved). */
export function withPartsExprIndices(
  paramName: string,
  expressionFields: string[],
  indices: number[],
): string[] {
  const prefix = `${paramName}.`
  const kept = expressionFields.filter((f) => !f.startsWith(prefix))
  return [...kept, ...indices.map((index) => `${paramName}.${index}.value`)]
}
