/** A variable keyed by its scope: the bare name at the root canvas, else its Function path then the name (REQ-3.1.3.1). */

export interface ScopedVariable {
  name: string
  /** Node ids from the root canvas inward; empty at the root canvas. */
  functionPath: string[]
}

export function scopedVariableKey(name: string, functionPath?: readonly string[] | null): string {
  if (!functionPath || functionPath.length === 0) return name
  return `${JSON.stringify(functionPath)}${name}`
}

/** Reads a key back; a name never holds `]`, so the last one closes the path. */
export function parseScopedVariableKey(key: string): ScopedVariable {
  if (!key.startsWith('[')) return { name: key, functionPath: [] }
  const end = key.lastIndexOf(']')
  return { name: key.slice(end + 1), functionPath: JSON.parse(key.slice(0, end + 1)) as string[] }
}

/** The node-id path of a drill path; the library View's synthetic root is no Function instance of its run. */
export function drillNodePath(path: ReadonlyArray<{ nodeId: string }>, inFunctionView: boolean): string[] {
  const ids = path.map((entry) => entry.nodeId)
  return inFunctionView ? ids.slice(1) : ids
}
