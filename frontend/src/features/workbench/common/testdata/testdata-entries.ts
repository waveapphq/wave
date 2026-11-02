/**
 * Pure helpers over a test's flat data listing (REQ-3.4.3.2): the
 * filter, the tree, the reference a block carries and the parent path.
 */

import { buildPathTree, subtreeSize, type PathTreeNode } from '@/lib/path-tree'
import { buildTestDataReference } from '@/lib/file-references'
import type { TestDataEntry } from '@/features/tests/api/types'

export interface TestDataNode {
  name: string
  path: string
  /** Explicit, because an empty folder has no children to tell it from a file. */
  kind: 'file' | 'dir'
  children: TestDataNode[]
  /** The listed entry; null for a folder implied by its descendants only. */
  entry: TestDataEntry | null
  /** A file's own size; a folder's subtree total (the listing reports folders as 0). */
  sizeBytes: number
}

/** Ancestor folder paths of a relative path, nearest last. */
function ancestorsOf(path: string): string[] {
  const ancestors: string[] = []
  let cut = path.indexOf('/')
  while (cut !== -1) {
    ancestors.push(path.slice(0, cut))
    cut = path.indexOf('/', cut + 1)
  }
  return ancestors
}

/** Entries whose path holds the query (ignoring case) plus every ancestor folder of a match. */
export function filterEntries(entries: TestDataEntry[], query: string): TestDataEntry[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return entries
  }
  const kept = new Set<string>()
  for (const entry of entries) {
    if (entry.path.toLowerCase().includes(needle)) {
      kept.add(entry.path)
      for (const ancestor of ancestorsOf(entry.path)) {
        kept.add(ancestor)
      }
    }
  }
  return entries.filter((entry) => kept.has(entry.path))
}

function isFolderNode(node: PathTreeNode<TestDataEntry>): boolean {
  return node.item === null || node.item.kind === 'dir'
}

function toNode(node: PathTreeNode<TestDataEntry>): TestDataNode {
  const folder = isFolderNode(node)
  return {
    name: node.name,
    path: node.path,
    kind: folder ? 'dir' : 'file',
    children: orderNodes(node.children.map(toNode)),
    entry: node.item,
    sizeBytes: subtreeSize(node),
  }
}

// The shared builder cannot tell an explicit empty folder from a file; a stable
// partition moves such folders up without disturbing the name order.
function orderNodes(nodes: TestDataNode[]): TestDataNode[] {
  return nodes.toSorted((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir'))
}

/** Nested tree of the flat listing: folders first, siblings ordered ignoring case. */
export function buildTree(entries: TestDataEntry[]): TestDataNode[] {
  const roots = buildPathTree(entries, (entry) => entry.path, { order: 'folders-first' })
  return orderNodes(roots.map(toNode))
}

/** The testdata:// reference of a relative path. */
export function entryReference(path: string): string {
  return buildTestDataReference(path)
}

/** The containing folder of a relative path; "" for a root-level path and for the root. */
export function parentOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut)
}
