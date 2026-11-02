/**
 * The parent-scoped registry the floating editors opened beneath a parent report into.
 */

import {
  createContext,
  use,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { flushSync } from 'react-dom'

import { anyChildHasChanges, type ChildEditorStatus } from '@/lib/child-editors'

/** A child editor as it registers: its status and how its draft reaches the parent. */
export interface ChildEditor extends ChildEditorStatus {
  /** Writes the child's current draft through its own save path, without closing it. */
  apply: () => void
}

export interface ChildEditorRegistry {
  report: (id: number, status: ChildEditorStatus, latest: RefObject<ChildEditor | null>) => void
  withdraw: (id: number) => void
  /** Whether an open editor of one of these rows holds unsaved changes. */
  unsavedRows: (labels: readonly string[]) => boolean
  /** The open editors of these rows, as they last reported. */
  rowEditors: (labels: readonly string[]) => ChildEditorStatus[]
  /** Writes every changed editor of these rows through its own save path, without closing it. */
  saveRows: (labels: readonly string[]) => void
}

const ChildEditorsContext = createContext<ChildEditorRegistry | null>(null)

// Ids grow in mount order, so a child opened from inside another sorts after it.
let lastChildId = 0

export interface ApplyAllOptions {
  /** Commit each write before the next child reads its own state; false only replays. */
  flush?: boolean
}

export interface ChildEditorScope {
  registry: ChildEditorRegistry
  /** The open children, in the order they opened. */
  children: ChildEditorStatus[]
  hasChanges: boolean
  /** Writes every changed child's draft into the parent, most recently opened first. */
  applyAll: (options?: ApplyAllOptions) => void
}

export function useChildEditorScope(): ChildEditorScope {
  const [statuses, setStatuses] = useState<ReadonlyMap<number, ChildEditorStatus>>(() => new Map())
  const latestRef = useRef(new Map<number, RefObject<ChildEditor | null>>())

  const registry = useMemo<ChildEditorRegistry>(() => {
    const editorsOf = (labels: readonly string[]): ChildEditor[] =>
      [...latestRef.current.values()].flatMap((child) =>
        child.current !== null && labels.includes(child.current.label) ? [child.current] : [],
      )
    return {
      report: (id, status, latest) => {
        latestRef.current.set(id, latest)
        setStatuses((prev) => new Map(prev).set(id, status))
      },
      unsavedRows: (labels) => editorsOf(labels).some((editor) => editor.hasChanges),
      rowEditors: editorsOf,
      saveRows: (labels) => {
        for (const editor of editorsOf(labels)) {
          if (editor.hasChanges) editor.apply()
        }
      },
      withdraw: (id) => {
        latestRef.current.delete(id)
        setStatuses((prev) => {
          if (!prev.has(id)) return prev
          const next = new Map(prev)
          next.delete(id)
          return next
        })
      },
    }
  }, [])

  const children = useMemo(
    () => [...statuses.entries()].sort(([left], [right]) => left - right).map(([, status]) => status),
    [statuses],
  )

  const applyAll = useCallback(({ flush = true }: ApplyAllOptions = {}) => {
    const newestFirst = [...latestRef.current.keys()].sort((left, right) => right - left)
    for (const id of newestFirst) {
      const child = latestRef.current.get(id)?.current
      if (!child?.hasChanges) continue
      if (flush) {
        flushSync(child.apply)
      } else {
        child.apply()
      }
    }
  }, [])

  return { registry, children, hasChanges: anyChildHasChanges(children), applyAll }
}

export function ChildEditorsProvider({
  scope,
  children,
}: Readonly<{ scope: ChildEditorScope; children: ReactNode }>) {
  return <ChildEditorsContext value={scope.registry}>{children}</ChildEditorsContext>
}

/** The registry of the parent a row belongs to, for asking before the row goes. */
export function useChildEditorRegistry(): ChildEditorRegistry | null {
  return use(ChildEditorsContext)
}

/** Reports this child editor to the parent it was opened from; null while it is closed. */
export function useChildEditor(editor: ChildEditor | null): void {
  const registry = use(ChildEditorsContext)
  const [id] = useState(() => ++lastChildId)
  const latestRef = useRef(editor)
  latestRef.current = editor
  const open = editor !== null
  const label = editor?.label ?? ''
  const hasChanges = editor?.hasChanges ?? false
  const cannotBeSaved = editor?.cannotBeSaved ?? false

  useLayoutEffect(() => {
    if (registry === null) return
    if (!open) {
      registry.withdraw(id)
      return
    }
    registry.report(id, { label, hasChanges, cannotBeSaved }, latestRef)
  }, [registry, id, open, label, hasChanges, cannotBeSaved])

  useLayoutEffect(() => () => registry?.withdraw(id), [registry, id])
}
