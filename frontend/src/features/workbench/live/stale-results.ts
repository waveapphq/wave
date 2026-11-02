/**
 * Evaluated results the next ad-hoc run evaluates again (REQ-3.2.1.5).
 *
 * An expression or template a run evaluated keeps its result until its source,
 * or a variable it reads, is edited. The Variable Manager drops such a result at
 * the edit, so a row never shows a value the next block run will replace.
 */

import { canonicalEqual } from '@/features/workbench/lib/canonical-workflow'
import { blockWrites, type NamedBlock } from '@/features/workbench/lib/saved-block-fields'
import { overrideSource, type StagedOverride } from '@/features/workbench/live/staged-overrides'

export interface DefinedVariable {
  id: string
  name: string
  value?: unknown
  type?: string
  isExpression?: boolean
  isTemplate?: boolean
}

export interface ResultsContext {
  /** The Test's variables as they stand. */
  variables: readonly DefinedVariable[]
  /** Live values by name. */
  live: ReadonlyMap<string, unknown>
  /** Current-mode edits in force, by name. */
  overrides: ReadonlyMap<string, StagedOverride>
  /** Names a block may write: their live value is the block's and is never dropped. */
  blockWritten: ReadonlySet<string>
  /** The names a source reads. */
  namesRead: (source: string, isTemplate: boolean) => Iterable<string>
}

interface Source {
  text: string
  isTemplate: boolean
}

function isComputed(variable: DefinedVariable | undefined): boolean {
  return !!variable && (!!variable.isExpression || !!variable.isTemplate)
}

/** The source the engine follows: a Current-mode source, else a computed definition. */
function sourceInForce(
  variable: DefinedVariable,
  override: StagedOverride | undefined,
): Source | undefined {
  if (override !== undefined && 'template' in override) return { text: override.template, isTemplate: true }
  if (override !== undefined && 'expression' in override) return { text: override.expression, isTemplate: false }
  if (!isComputed(variable) || typeof variable.value !== 'string') return undefined
  return { text: variable.value, isTemplate: !!variable.isTemplate }
}

/** Each evaluated result with the names its source reads. */
function evaluatedReads(context: ResultsContext): Map<string, Set<string>> {
  const reads = new Map<string, Set<string>>()
  for (const variable of context.variables) {
    const source = sourceInForce(variable, context.overrides.get(variable.name))
    if (!source || !context.live.has(variable.name) || context.blockWritten.has(variable.name)) {
      continue
    }
    reads.set(variable.name, new Set(context.namesRead(source.text, source.isTemplate)))
  }
  return reads
}

/** The evaluated results among `edited` and those that read one, directly or through another. */
export function resultsReading(edited: Iterable<string>, context: ResultsContext): string[] {
  const reads = evaluatedReads(context)
  const changed = new Set(edited)
  let grew = true
  while (grew) {
    grew = false
    for (const [name, read] of reads) {
      if (changed.has(name) || ![...read].some((readName) => changed.has(readName))) continue
      changed.add(name)
      grew = true
    }
  }
  return [...reads.keys()].filter((name) => changed.has(name))
}

function sameDefinition(a: DefinedVariable | undefined, b: DefinedVariable | undefined): boolean {
  if (!a || !b) return false
  return (
    a.name === b.name &&
    a.type === b.type &&
    !!a.isExpression === !!b.isExpression &&
    !!a.isTemplate === !!b.isTemplate &&
    canonicalEqual(a.value, b.value)
  )
}

/** False when the session follows a Current-mode source or a value it gave the name. */
function definitionInForce(name: string, computed: boolean, context: ResultsContext): boolean {
  if (overrideSource(context.overrides.get(name)) !== undefined) return false
  if (!context.live.has(name)) return true
  return computed && !context.blockWritten.has(name)
}

/** The names whose definition changed since `previous` and reaches the next ad-hoc run. */
export function editedDefinitions(
  previous: readonly DefinedVariable[],
  context: ResultsContext,
): Set<string> {
  const before = new Map(previous.map((variable) => [variable.id, variable]))
  const after = new Map(context.variables.map((variable) => [variable.id, variable]))
  const edited = new Set<string>()
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(id)
    const now = after.get(id)
    if (sameDefinition(was, now)) continue
    const computed = isComputed(was) || isComputed(now)
    for (const variable of [was, now]) {
      if (variable && definitionInForce(variable.name, computed, context)) edited.add(variable.name)
    }
  }
  return edited
}

/** The names the blocks of a canvas may write: output binding targets and Variable Setter rows. */
export function namesBlocksWrite(nodes: ReadonlyArray<NamedBlock>): Set<string> {
  const names = new Set<string>()
  for (const node of nodes) {
    for (const name of blockWrites(node)) names.add(name)
  }
  return names
}
