/**
 * Which names a scope's Blocks and variables use, as the Variable Manager shows it:
 * the Unused and OUT badges and the delete prompts (REQ-3.1.3.6, VMGR-105). The live
 * and the run page Variable Manager read this one scan.
 */

import { walkActiveSubtree, type DrillEntry } from '@/features/functions/canvas/inner-workflow'
import { EXPRESSION_SAFE_NAMES } from '@/features/workbench/lib/expression-sandbox'
import { PYTHON_KEYWORD_SET } from '@/features/workbench/lib/python-builtins'
import { blockReads, blockWrites, namesInText, type NamedBlock } from '@/features/workbench/lib/saved-block-fields'

/** A Block as its output bindings are read. */
export interface OutputBindingNode {
  data: { config?: Record<string, unknown>; label?: string }
}

/** Add each name a Block's output bindings write, with the Block's label as one of its sources. */
export function collectOutputBindings(
  node: OutputBindingNode,
  names: Set<string>,
  sources: Map<string, string[]>,
): void {
  const bindings = node.data.config?.outputBindings as Record<string, string> | undefined
  if (!bindings) return
  const nodeName = node.data.label || ''
  for (const varName of Object.values(bindings)) {
    if (!varName) continue
    names.add(varName)
    const existing = sources.get(varName) || []
    existing.push(nodeName)
    sources.set(varName, existing)
  }
}

/** The names a computed variable's source reads, scanned as the engine scans them. */
export function namesReadBySource(source: string, isTemplate: boolean): string[] {
  return namesInText(source, isTemplate ? 'template' : 'expression')
}

/** What the Blocks of one scope do with each name. */
export interface ScopeBlockUsage {
  /** Names an output binding writes. */
  outputBoundVarNames: Set<string>
  /** Per output-bound name, the labels of the Blocks that bind it. */
  outputBoundVarSources: Map<string, string[]>
  /** Per name, how many Blocks of the scope read it. */
  inputRefCounts: Map<string, number>
  /** Names a Block writes: output binding and Variable Setter targets. */
  blockWrittenNames: Set<string>
}

/** The usage of the Blocks of the scope `drillPath` shows: the root canvas, or the drilled Function's body. */
export function scopeBlockUsage(nodes: NamedBlock[], drillPath: DrillEntry[]): ScopeBlockUsage {
  const usage: ScopeBlockUsage = {
    outputBoundVarNames: new Set(),
    outputBoundVarSources: new Map(),
    inputRefCounts: new Map(),
    blockWrittenNames: new Set(),
  }
  const scopedNodes = drillPath.length > 0 ? walkActiveSubtree(nodes, [], [], drillPath).nodes : nodes
  for (const node of scopedNodes) {
    collectOutputBindings(node as OutputBindingNode, usage.outputBoundVarNames, usage.outputBoundVarSources)
    for (const name of blockReads(node)) usage.inputRefCounts.set(name, (usage.inputRefCounts.get(name) ?? 0) + 1)
    for (const name of blockWrites(node)) usage.blockWrittenNames.add(name)
  }
  return usage
}

/** A variable row as the usage scan reads it. */
export interface UsageRow {
  name: string
  value?: unknown
  isExpression?: boolean
  isTemplate?: boolean
}

/** Filter out the variable's own name plus the sandbox's names and keywords. */
function isCrossVariableRef(ident: string, ownName: string): boolean {
  return ident !== ownName && !EXPRESSION_SAFE_NAMES.has(ident) && !PYTHON_KEYWORD_SET.has(ident)
}

/** The other variables one computed variable (or Expression / Template output) reads. */
function crossRefsOf(row: UsageRow): string[] {
  if ((!row.isExpression && !row.isTemplate) || typeof row.value !== 'string') return []
  return namesReadBySource(row.value, !row.isExpression).filter((ident) => isCrossVariableRef(ident, row.name))
}

/** Every name a Block of the scope reads or writes, or another variable of the scope reads; any other row is Unused. */
export function scopeReferencedNames(usage: ScopeBlockUsage, rows: ReadonlyArray<UsageRow>): Set<string> {
  const names = new Set([...usage.outputBoundVarNames, ...usage.inputRefCounts.keys(), ...usage.blockWrittenNames])
  for (const row of rows) {
    for (const ident of crossRefsOf(row)) names.add(ident)
  }
  return names
}
