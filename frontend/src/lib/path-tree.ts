/**
 * Flat relative paths to a nested tree, plus the subtree byte rollup.
 */

export interface PathTreeNode<T> {
  name: string
  path: string
  children: PathTreeNode<T>[]
  /** The entry at this path; null for a folder implied by its children. */
  item: T | null
}

export interface PathTreeOptions {
  /** 'folders-first' sorts every sibling list folders first, then by name ignoring case; the default keeps the input order. */
  order?: 'input' | 'folders-first'
}

function isFolder<T>(node: PathTreeNode<T>): boolean {
  return node.children.length > 0
}

function compareFoldersFirst<T>(a: PathTreeNode<T>, b: PathTreeNode<T>): number {
  const folderDelta = Number(isFolder(b)) - Number(isFolder(a))
  if (folderDelta !== 0) {
    return folderDelta
  }
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
}

function sortFoldersFirst<T>(nodes: PathTreeNode<T>[]): void {
  nodes.sort(compareFoldersFirst)
  for (const node of nodes) {
    sortFoldersFirst(node.children)
  }
}

export function buildPathTree<T>(
  items: readonly T[],
  getPath: (item: T) => string,
  options: PathTreeOptions = {}
): PathTreeNode<T>[] {
  const roots: PathTreeNode<T>[] = []
  const byPath = new Map<string, PathTreeNode<T>>()
  for (const item of items) {
    const segments = getPath(item).split('/')
    let siblings = roots
    let accumulated = ''
    for (const [index, segment] of segments.entries()) {
      accumulated = accumulated ? `${accumulated}/${segment}` : segment
      let node = byPath.get(accumulated)
      if (!node) {
        node = { name: segment, path: accumulated, children: [], item: null }
        byPath.set(accumulated, node)
        siblings.push(node)
      }
      if (index === segments.length - 1) {
        node.item = item
      }
      siblings = node.children
    }
  }
  if (options.order === 'folders-first') {
    sortFoldersFirst(roots)
  }
  return roots
}

/** Total bytes of every item under a node, the node's own included. */
export function subtreeSize<T extends { size_bytes: number }>(node: PathTreeNode<T>): number {
  let total = node.item === null ? 0 : node.item.size_bytes
  for (const child of node.children) {
    total += subtreeSize(child)
  }
  return total
}
