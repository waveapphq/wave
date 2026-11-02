/**
 * AdHocActionsContext
 *
 * Provides a per-canvas dispatcher for the four ad-hoc execution actions
 * surfaced on a node's right-click / kebab menu (Run Current, Run from
 * Here, Debug Current, Debug from Here). The Live Workbench container
 * supplies a handler bound to ``useWorkbenchRun.startDebugRun``; the
 * Historical canvas leaves the context unset so the dispatcher is a
 * no-op (read-only history canvas suppresses these menu items anyway).
 *
 * Exposing the dispatcher via context keeps ``WorkflowNode`` (rendered
 * once per canvas node) free of its own ``useWorkbenchRun()`` call,
 * which would otherwise re-subscribe WebSocket and refetch session
 * state per node.
 */
import { createContext, use, type ReactNode } from 'react'
import type { SavedBlockFields } from '@/features/workbench/lib/saved-block-fields'

export type AdHocAction =
  | 'run-current'
  | 'run-from-here'
  | 'debug-current'
  | 'debug-from-here'

/** What a caller other than the canvas menu adds to an ad-hoc run. */
export interface AdHocRunOptions {
  /** Used instead of the action bar's Environment selection. */
  environmentId?: string
  /** The target block's config as its unsaved Save would write it, for this run alone (PYRUN-21). */
  blockDraft?: SavedBlockFields
}

// Return type is intentionally ``unknown`` so callers can pass either a
// fire-and-forget sync handler OR an ``async`` handler whose Promise is
// implicitly discarded by the menu-button click. Avoids the wrapping
// ``void runHook.handleAdHocRun(...)`` callback at every Provider site.
export type AdHocActionDispatcher = (
  action: AdHocAction,
  nodeId: string,
  options?: AdHocRunOptions,
) => unknown

const NOOP_DISPATCHER: AdHocActionDispatcher = () => {}

const AdHocActionsContext = createContext<AdHocActionDispatcher>(NOOP_DISPATCHER)

/** Repeats the block a paused run sits at with one parameter's draft value (PYRUN-21). */
export type AdHocRepeatDraft = (nodeId: string, parameter: string, value: unknown) => unknown

const AdHocRepeatDraftContext = createContext<AdHocRepeatDraft | null>(null)

/** The action bar's Environment selection, which a run without its own Environment uses. */
export interface AdHocEnvironment {
  selected: string | null
  /** Makes an Environment picked for a run the action bar's selection. */
  select: (environmentId: string) => void
}

const NO_ENVIRONMENT: AdHocEnvironment = { selected: null, select: () => {} }

const AdHocEnvironmentContext = createContext<AdHocEnvironment>(NO_ENVIRONMENT)

/** ``offered`` is false on a canvas that cannot start runs (mirroring another holder). */
export function AdHocActionsProvider({
  dispatch,
  offered = true,
  environment = NO_ENVIRONMENT,
  repeatBlockDraft = null,
  children,
}: Readonly<{
  dispatch: AdHocActionDispatcher
  offered?: boolean
  environment?: AdHocEnvironment
  /** The canvas's own paused repeat, guarded like its other run actions (VMGR-64). */
  repeatBlockDraft?: AdHocRepeatDraft | null
  children: ReactNode
}>) {
  return (
    <AdHocActionsContext.Provider value={offered ? dispatch : NOOP_DISPATCHER}>
      <AdHocEnvironmentContext value={environment}>
        <AdHocRepeatDraftContext value={repeatBlockDraft}>{children}</AdHocRepeatDraftContext>
      </AdHocEnvironmentContext>
    </AdHocActionsContext.Provider>
  )
}

export function useAdHocActions(): AdHocActionDispatcher {
  return use(AdHocActionsContext)
}

export function useAdHocEnvironment(): AdHocEnvironment {
  return use(AdHocEnvironmentContext)
}

/** Null where the canvas supplies no repeat of its own. */
export function useAdHocRepeatDraft(): AdHocRepeatDraft | null {
  return use(AdHocRepeatDraftContext)
}

/** True when this canvas can start ad-hoc runs, so a read-only scope still offers them. */
export function useAdHocActionsOffered(): boolean {
  return use(AdHocActionsContext) !== NOOP_DISPATCHER
}
