/**
 * Shared block-name search for every surface that filters the block catalog.
 * Plain substring on the name, so two search boxes can never disagree.
 */

export function matchesBlockQuery(name: string, query: string): boolean {
  const trimmed = query.trim().toLowerCase()
  if (trimmed === '') return true
  return name.toLowerCase().includes(trimmed)
}

export function filterByBlockQuery<T extends { name: string }>(
  items: ReadonlyArray<T>,
  query: string,
): T[] {
  return items.filter((item) => matchesBlockQuery(item.name, query))
}
