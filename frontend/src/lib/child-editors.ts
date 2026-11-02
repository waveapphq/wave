/**
 * What a parent surface derives from the floating editors open beneath it.
 */

/** One open child editor as its parent sees it. */
export interface ChildEditorStatus {
  /** The label of the row the child was opened from, as the row shows it. */
  label: string
  /** The child's draft differs from the value it last saved or opened with. */
  hasChanges: boolean
  /** The child's own Save is disabled for a reason other than nothing changed. */
  cannotBeSaved: boolean
}

export function childEditorNote(label: string, action = 'Save'): string {
  return `${action} is disabled: the ${label} editor has errors`
}

export function formErrorsNote(noun: string, action = 'Save'): string {
  return `${action} is disabled: the ${noun} have errors`
}

export function anyChildHasChanges(children: readonly ChildEditorStatus[]): boolean {
  return children.some((child) => child.hasChanges)
}

/** What blocks the parent's Save: its own form first, then a changed child that cannot be saved. */
export function saveBlockedNote(
  formNote: string | null,
  children: readonly ChildEditorStatus[],
  action = 'Save',
): string | null {
  if (formNote !== null) return formNote
  const blocker = children.find((child) => child.hasChanges && child.cannotBeSaved)
  return blocker ? childEditorNote(blocker.label, action) : null
}

/** Where the open editor of an indexed row sits once the row at `removed` is taken away. */
export function openEditorAfterRemoval(open: number | null, removed: number): number | null {
  if (open === null || open === removed) return null
  return open > removed ? open - 1 : open
}

/** A whole-record write replayed onto a draft as its difference from the base. */
export function replayRecordWrite<T>(
  base: Readonly<Record<string, T>>,
  draft: Readonly<Record<string, T>>,
  next: Readonly<Record<string, T>>,
): Record<string, T> {
  const result = { ...draft }
  for (const [key, value] of Object.entries(next)) {
    if (!Object.hasOwn(base, key) || base[key] !== value) result[key] = value
  }
  for (const key of Object.keys(base)) {
    if (!Object.hasOwn(next, key)) delete result[key]
  }
  return result
}

/** A whole-list write replayed onto a draft as its difference from the base. */
export function replayListWrite(
  base: readonly string[],
  draft: readonly string[],
  next: readonly string[],
): string[] {
  const removed = new Set(base.filter((entry) => !next.includes(entry)))
  const kept = draft.filter((entry) => !removed.has(entry))
  const added = next.filter((entry) => !base.includes(entry) && !kept.includes(entry))
  return [...kept, ...added]
}
