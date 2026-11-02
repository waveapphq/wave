/** Row operations shared by the branch-row editors. */

export interface BranchRow {
  id: string
}

/** The list without the row carrying `id`. */
export function withoutBranch<T extends BranchRow>(branches: T[], id: string): T[] {
  return branches.filter((branch) => branch.id !== id)
}

/** The list with the row carrying `id` swapped one place in `direction`. */
export function withBranchMoved<T extends BranchRow>(
  branches: T[],
  id: string,
  direction: 'up' | 'down',
): T[] {
  const idx = branches.findIndex((branch) => branch.id === id)
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  const updated = [...branches]
  updated[idx] = branches[swapIdx]
  updated[swapIdx] = branches[idx]
  return updated
}

/** Next free `branch_<n>` id, continuing the sequence from `first`. */
export function nextBranchId(branches: BranchRow[], first: number): string {
  let max = first - 1
  for (const branch of branches) {
    const match = /^branch_(\d+)$/.exec(branch.id)
    if (match) max = Math.max(max, Number.parseInt(match[1], 10))
  }
  return `branch_${max + 1}`
}
