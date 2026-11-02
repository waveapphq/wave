/**
 * How an open sheet's draft follows its Block changed elsewhere: a field left alone takes the change, an edited field keeps the edit.
 */

export function sameStored(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/** `next` while the draft still holds `base`, else the draft. */
export function followValue<T>(base: T, draft: T, next: T): T {
  return sameStored(draft, base) ? next : draft
}

/** The draft with each key the store changed from `base` to `next`, unless the draft changed that key itself. */
export function followRecord<T>(
  base: Readonly<Record<string, T>>,
  draft: Record<string, T>,
  next: Readonly<Record<string, T>>,
): Record<string, T> {
  let result = draft
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (sameStored(base[key], next[key]) || !sameStored(draft[key], base[key])) continue
    if (result === draft) result = { ...draft }
    if (Object.hasOwn(next, key)) result[key] = next[key]
    else delete result[key]
  }
  return result
}
