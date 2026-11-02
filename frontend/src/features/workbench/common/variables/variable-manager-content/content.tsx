/**
 * Variable Manager Content
 *
 * Main content of the redesigned Variable Manager panel: header (uppercase
 * title + "+ Add" button), toolbar (filter + sort dropdown), and a flat
 * row list. The previous Watch List, scope groups, and count badge are gone;
 * the entire list is the monitoring surface and runtime values stream into
 * every row.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.1.3.12: Auto-refresh watched variables on change
 * REQ-3.2.2.18: Live variable values display
 */

import { useState, useMemo, useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  ArrowRight,
  ArrowLeft,
  Variable as VariableIcon,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import { PlusIcon } from '@/components/ui/icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { VirtualizedList } from '@/components/ui/virtualized-list'
import type {
  CreateWindowEntry,
  Variable,
  VariableManagerContentProps,
  VariableManagerAddMode,
} from './types'
import type { AvailableVariable } from '@/features/workbench/common/element-config/expressions/expression-field'
import {
  INLINE_VARIABLE_ROW_HEIGHT,
  VARIABLE_LIST_FALLBACK_HEIGHT,
  VIRTUALIZATION_THRESHOLD,
} from './types'
import { InlineVariableRow } from './variable-row-inline'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'
import { useRevealedVariableValues, applyRevealedValues } from '../use-revealed-variable-values'
import { SortDropdown } from './sort-dropdown'
import { sortVariables, type SortKey } from './sort-variables'
import { useRowViewMode } from './use-row-view-mode'
import { useVariableEditors } from './use-variable-editors'
import { useVariableInspectors } from '../variable-inspect-modal/use-variable-inspectors'
import { VariableInspectModal } from '../variable-inspect-modal/variable-inspect-modal'
import { VariableCreateModal } from '../variable-inspect-modal/variable-create-modal'
import type { WindowCurrentSeed, WindowEditTarget } from '../variable-inspect-modal/use-inspect-create'
import { refocusSheet } from '@/components/shared/draggable-sheet'
import { filterVariablesForScope } from '@/features/functions/canvas/function-scope-vars'
import type { DrillEntry } from '@/features/functions/canvas/inner-workflow'
import {
  overrideSource,
  resolveCurrentDisplay,
  resolveCurrentExpressionSource,
  withOverrideSource,
  type StagedOverride,
} from '@/features/workbench/live/staged-overrides'
import { drillNodePath, scopedVariableKey } from '@/features/workbench/lib/variable-scope-key'
import { buildScopeAutocomplete } from '@/features/workbench/live/use-variable-management'
import { tracksSecretsAt } from '@/features/workbench/lib/function-scope-rows'
import type { ElementTypes } from '@/lib/variable-validation'
import { hidesSecretValue, isStoredSecretValue } from '@/lib/secret-envelope'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

const EMPTY_APPLIED_OVERRIDES: Map<string, StagedOverride> = new Map()
const EMPTY_RUN_START_SNAPSHOT: Map<string, unknown> = new Map()
const EMPTY_RUN_START_ELEMENT_TYPES: Map<string, ElementTypes> = new Map()
const NO_CYCLE = (): string | null => null
const ROOT_PATH: string[] = []
const NO_RECENT_CHANGES: Set<string> = new Set()
const NO_AVAILABLE_VARIABLES: AvailableVariable[] = []

const SORT_STORAGE_KEY = 'var-mgr.sort'

/** The row an Edit window opened on and the scope (node ids) it lives in (VMGR-106). */
interface EditWindowRow extends WindowEditTarget {
  scope: string[]
}

/** One open variable window: Add, or Edit when it carries the row the pencil opened. */
interface VariableWindowEntry extends CreateWindowEntry {
  edit?: EditWindowRow
}

function drillKeyOf(path: readonly DrillEntry[]): string {
  return path.map((entry) => entry.nodeId).join('/')
}

function windowModeOf(kind: 'input' | 'output' | 'local'): VariableManagerAddMode {
  return kind === 'local' ? 'variable' : kind
}

/** A row reads as revealed only when the reveal put a real value in it, never the masked placeholder. */
function revealsValue(v: Variable, revealOn: boolean): boolean {
  return revealOn && !isStoredSecretValue(v.value)
}

/** A saved secret's watcher has nothing it may show: unless unsaved, only a revealed real value shows. */
function locksWatcher(v: Variable, unsaved: boolean, revealOn: boolean): boolean {
  return hidesSecretValue(v) && !unsaved && !revealsValue(v, revealOn)
}

/** The lowest slot no open window holds, so a reopened slot gets back the geometry the author gave it. */
function lowestFreeSlot(open: readonly CreateWindowEntry[]): number {
  const taken = new Set(open.map((entry) => entry.slot))
  let slot = 0
  while (taken.has(slot)) slot += 1
  return slot
}

/** Where a window creates: its own Function, else the Test root once the author has drilled in (VMGR-102). */
function windowCreatePath(entry: CreateWindowEntry): CreateWindowEntry['functionPath'] {
  if (entry.functionPath !== undefined) return entry.functionPath
  return useWorkflowStore.getState().drillPath.length > 0 ? [] : undefined
}

function readPersistedSort(): SortKey {
  /* v8 ignore next 3 - COV-SSR-011 */
  if (typeof globalThis === 'undefined' || !globalThis.localStorage) {
    return 'name-asc'
  }
  const stored = globalThis.localStorage.getItem(SORT_STORAGE_KEY)
  if (stored === 'name-asc' || stored === 'name-desc' || stored === 'type') {
    return stored
  }
  return 'name-asc'
}

// ===========================================================================
// Helpers (module scope to avoid re-creation on each parent render)
// ===========================================================================

interface ScopedGroupProps {
  title: string
  testIdSlug: string
  defaultOpen?: boolean
  children: React.ReactNode
}

/**
 * Collapsible PARAMETERS / VARIABLES group used by the in-Function layout.
 * Uses the project's shadcn Collapsible; header is a button so screen
 * readers and keyboard users can toggle.
 */
function ScopedGroup({ title, testIdSlug, defaultOpen = true, children }: Readonly<ScopedGroupProps>) {
  const [open, setOpen] = useState<boolean>(defaultOpen)
  return (
    <div data-testid={`var-group-${testIdSlug}`}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          className="flex w-full items-center gap-1.5 px-3 py-1.5 border-b border-default/40 bg-subtle/40 hover:bg-subtle text-xs font-bold uppercase tracking-wider text-foreground/80"
          data-testid={`var-group-${testIdSlug}-trigger`}
        >
          <ChevronRightIcon
            className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
          <span>{title}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </div>
  )
}

interface SubSeparatorProps {
  label: string
}

/**
 * INPUTS / OUTPUTS sub-divider rendered inside the PARAMETERS group. Plain
 * uppercase label + thin hairline filling the remaining width.
 */
function SubSeparator({ label }: Readonly<SubSeparatorProps>) {
  return (
    <div
      className="flex items-center gap-2 px-3 pt-2 pb-1"
      data-testid={`var-group-sub-${label.toLowerCase()}`}
    >
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="flex-1 h-px bg-border" aria-hidden="true" />
    </div>
  )
}

// ===========================================================================
// Component
// ===========================================================================

export function VariableManagerContent({
  variables,
  runtimeValues,
  isExecuting = false,
  runStatus,
  isLoading = false,
  onVariableEdit,
  onVariableCurrentEdit,
  appliedOverrides = EMPTY_APPLIED_OVERRIDES,
  runStartSnapshot = EMPTY_RUN_START_SNAPSHOT,
  runStartElementTypes = EMPTY_RUN_START_ELEMENT_TYPES,
  onCreateVariable,
  onVariableDelete,
  validateExpressionCycle = NO_CYCLE,
  outputBoundVarNames,
  workflowReferencedVarNames,
  recentlyChanged = NO_RECENT_CHANGES,
  isMirroring = false,
  availableVariables = NO_AVAILABLE_VARIABLES,
  readOnly = false,
  scope,
  persistenceKey,
  sessionId,
  unsavedSecretIds,
  changedSecretIds,
}: Readonly<VariableManagerContentProps>) {
  const insideFunction = !!scope?.insideFunction
  const [filterText, setFilterText] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>(readPersistedSort)
  // Every Add opens one more window, with no cap (VMGR-101); the pencil opens one Edit window per variable.
  const [createWindows, setCreateWindows] = useState<VariableWindowEntry[]>([])

  // Every live map is keyed by scope: the shown rows read it with the node path of the scope they live in.
  const drillPath = useWorkflowStore((s) => s.drillPath)
  const inFunctionView = useWorkflowStore((s) => s.functionViewMode !== null)
  const viewRootId = useWorkflowStore((s) => s.functionViewBaseline?.nodeId ?? null)
  // A library View's secrets are sealed by the Function save; everything else by the Test save.
  const secretSaveTarget = inFunctionView ? 'Function' : 'test'
  const shownPath = useMemo(
    () => (insideFunction ? drillNodePath(drillPath, inFunctionView) : ROOT_PATH),
    [insideFunction, drillPath, inFunctionView],
  )
  const drillKey = drillKeyOf(drillPath)

  // An Edit window left open when the canvas drills to another scope closes, writing nothing (VMGR-106).
  const [windowsDrillKey, setWindowsDrillKey] = useState(drillKey)
  if (windowsDrillKey !== drillKey) {
    setWindowsDrillKey(drillKey)
    setCreateWindows((open) => open.filter((entry) => entry.edit === undefined))
  }

  const handleSortChange = useCallback((value: SortKey) => {
    setSortKey(value)
    /* v8 ignore next 3 - COV-SSR-011 */
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      globalThis.localStorage.setItem(SORT_STORAGE_KEY, value)
    }
  }, [])

  const editors = useVariableEditors({
    variables,
    onVariableDelete,
  })

  const rowViewMode = useRowViewMode(runtimeValues, sessionId)

  // The test-variables reveal governs this whole surface: the panel value column
  // and the watchers reveal a test's secret variable values together.
  const revealTestVariables = useMaskingSettingsStore((s) => s.testVariables)
  const maskingLoaded = useMaskingSettingsStore((s) => s.hydrated)

  // Overlay revealed plaintext onto the shown scope's secret rows (a Function's too) while the reveal is on.
  const { values: revealedValues, settled: revealSettled } = useRevealedVariableValues()
  // A saved secret's watcher waits until the flags have loaded and, with the reveal on, its read has answered.
  const revealKnown = maskingLoaded && revealSettled
  const shownRevealed = (v: Variable) => revealsValue(v, revealTestVariables)
  const displayVariables = useMemo(
    () => applyRevealedValues(variables, revealedValues, shownPath),
    [variables, revealedValues, shownPath],
  )

  const inspectors = useVariableInspectors(persistenceKey)
  const { openIds: openInspectorKeys, close: closeInspector } = inspectors

  // Watchers are keyed by scope and name (stable across reloads, unlike ids), like every other live map.
  const variablesByKey = useMemo(
    () => new Map(displayVariables.map((v) => [scopedVariableKey(v.name, shownPath), v])),
    [displayVariables, shownPath],
  )

  // A watched variable outside the shown scope renders from its last-seen snapshot.
  const watcherSnapshotsRef = useRef(new Map<string, { variable: Variable; functionPath: string[] }>())

  useEffect(() => {
    const shownKey = JSON.stringify(shownPath)
    for (const key of openInspectorKeys) {
      const current = variablesByKey.get(key)
      if (current) {
        // A LOCKED secret's watcher closes once the reveal is known not to show its value.
        if (locksWatcher(current, !!unsavedSecretIds?.has(key), revealTestVariables)) {
          if (revealKnown) closeInspector(key)
          continue
        }
        watcherSnapshotsRef.current.set(key, { variable: current, functionPath: shownPath })
        continue
      }
      // A restored key not yet seen stays open: its scope's list may still be loading.
      const seen = watcherSnapshotsRef.current.get(key)
      if (seen && JSON.stringify(seen.functionPath) === shownKey) {
        watcherSnapshotsRef.current.delete(key)
        closeInspector(key)
      }
    }
  }, [openInspectorKeys, variablesByKey, shownPath, closeInspector, unsavedSecretIds, revealTestVariables, revealKnown])

  // Scope filtering happens BEFORE text filtering so the search box only
  // searches what's visible to the user in the current Function scope.
  const scopedVariables = useMemo(() => {
    if (!scope) return displayVariables
    return filterVariablesForScope(displayVariables, scope)
  }, [displayVariables, scope])

  const filteredVariables = useMemo(() => {
    if (!filterText) return scopedVariables
    const needle = filterText.toLowerCase()
    return scopedVariables.filter((v) => v.name.toLowerCase().includes(needle))
  }, [scopedVariables, filterText])

  const sortedVariables = useMemo(
    () => sortVariables(filteredVariables, sortKey),
    [filteredVariables, sortKey],
  )

  const handleRowKeyDown = useCallback(
    (e: ReactKeyboardEvent, currentId: string, list: Variable[]) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const idx = list.findIndex((v) => v.id === currentId)
        const next = e.key === 'ArrowDown'
          ? Math.min(idx + 1, list.length - 1)
          : Math.max(idx - 1, 0)
        const el = document.querySelector<HTMLElement>(
          `[data-testid="variable-row-${list[next].id}"]`,
        )
        el?.focus()
      }
    },
    [],
  )

  // Partition the sorted, filtered, scoped variable list into inputs /
  // outputs / locals for the in-Function layout. Outside a Function this is
  // unused and we render the flat list as today. Hooks declared BEFORE the
  // isLoading early-return so the call order stays stable.
  const declaredInputSet = useMemo(
    () => new Set(scope?.declaredInputNames ?? []),
    [scope?.declaredInputNames],
  )
  const declaredOutputSet = useMemo(
    () => new Set(scope?.declaredOutputNames ?? []),
    [scope?.declaredOutputNames],
  )
  const classifyKind = useCallback(
    (v: Variable): 'input' | 'output' | 'local' => {
      if (declaredInputSet.has(v.name)) return 'input'
      if (declaredOutputSet.has(v.name)) return 'output'
      return 'local'
    },
    [declaredInputSet, declaredOutputSet],
  )
  const { inputs, outputs, locals } = useMemo(() => {
    const result: { inputs: Variable[]; outputs: Variable[]; locals: Variable[] } = {
      inputs: [],
      outputs: [],
      locals: [],
    }
    if (!insideFunction) return result
    for (const v of sortedVariables) {
      const kind = classifyKind(v)
      if (kind === 'input') result.inputs.push(v)
      else if (kind === 'output') result.outputs.push(v)
      else result.locals.push(v)
    }
    return result
  }, [insideFunction, sortedVariables, classifyKind])

  // A window opened inside a Function records that Function's path and keeps creating there (VMGR-102).
  const openCreate = useCallback(
    (mode: VariableManagerAddMode) => {
      const functionPath = insideFunction ? useWorkflowStore.getState().drillPath : undefined
      setCreateWindows((open) => [...open, { slot: lowestFreeSlot(open), mode, functionPath }])
    },
    [insideFunction],
  )

  // One Edit window per variable: the pencil on a variable whose window is open raises it (VMGR-106).
  const openEdit = (v: Variable) => {
    const open = createWindows.find((entry) => entry.edit?.row.id === v.id)
    if (open) {
      refocusSheet(`variable-create-${open.slot}`)
      return
    }
    // The stored definition, never a revealed secret value laid over it for display.
    const row = variables.find((candidate) => candidate.id === v.id)!
    const edit: EditWindowRow = {
      row,
      scope: shownPath,
      inFunction: insideFunction,
      secretUnlocked: !!unsavedSecretIds?.has(scopedVariableKey(v.name, shownPath)),
      definitionReadOnly: readOnly,
    }
    const mode = windowModeOf(insideFunction ? classifyKind(v) : 'local')
    const functionPath = insideFunction ? drillPath : undefined
    setCreateWindows((windows) => [...windows, { slot: lowestFreeSlot(windows), mode, functionPath, edit }])
  }

  const closeCreate = useCallback(
    (slot: number) => setCreateWindows((open) => open.filter((entry) => entry.slot !== slot)),
    [],
  )

  const menuOpenedWindowRef = useRef(false)
  const newestNameRef = useRef<HTMLTextAreaElement>(null)
  const openCreateFromMenu = useCallback(
    (mode: VariableManagerAddMode) => {
      menuOpenedWindowRef.current = true
      openCreate(mode)
    },
    [openCreate],
  )
  const addMenuTriggerRef = useRef<HTMLButtonElement>(null)
  // The window took focus on Name as it opened, so closing the menu leaves it there; a window already gone hands it to Add.
  const keepMenuWindowFocus = useCallback((event: Event) => {
    const opened = menuOpenedWindowRef.current
    menuOpenedWindowRef.current = false
    if (!opened) return
    event.preventDefault()
    if (!newestNameRef.current) addMenuTriggerRef.current?.focus()
  }, [])

  const listBodyRef = useRef<HTMLDivElement>(null)
  const [listBodyHeight, setListBodyHeight] = useState(0)
  const useVirtualization = sortedVariables.length > VIRTUALIZATION_THRESHOLD

  useEffect(() => {
    const element = listBodyRef.current
    if (!useVirtualization || !element) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setListBodyHeight(entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [useVirtualization])

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="flex flex-col h-full" data-testid="variable-manager-skeleton">
        <div className="p-2 border-b">
          <div className="h-8 bg-muted animate-pulse rounded" />
        </div>
        <div className="flex-1 p-2 space-y-2">
          <div className="h-4 w-20 bg-muted animate-pulse rounded" />
          <div className="h-8 bg-muted animate-pulse rounded" />
          <div className="h-8 bg-muted animate-pulse rounded" />
        </div>
      </div>
    )
  }

  const showAddButton = !readOnly && !!onCreateVariable
  const showNoMatch = filterText.length > 0 && sortedVariables.length === 0
  const showEmptyState = scopedVariables.length === 0
  const listWindowHeight = listBodyHeight > 0 ? listBodyHeight : VARIABLE_LIST_FALLBACK_HEIGHT

  const runtimeAvailable = isExecuting || runtimeValues.size > 0 || readOnly
  const runLive = runStatus === undefined || runStatus === 'running' || runStatus === 'paused'
  // The pencil, the row delete and the window's Save lock only while the run is actively running (VMGR-107).
  const runLocked = runStatus === 'running'
  // A read-only definition still takes a Current value (REQ-3.1.2.10); history and mirroring take none.
  const canOpenWindow = readOnly ? !!onVariableCurrentEdit : !!onVariableEdit

  // What Current shows for a variable of a scope: live > override > run-start baseline > definition.
  const currentDisplayOf = (variable: Variable, key: string) => {
    const override = appliedOverrides.get(key)
    // A live run that started the variable with no value holds null (VMGR-19).
    const baseline = runLive && runStartSnapshot.has(key) ? (runStartSnapshot.get(key) ?? null) : undefined
    const display = resolveCurrentDisplay({
      hasLiveValue: runtimeValues.has(key),
      liveValue: runtimeValues.get(key),
      override,
      sessionBaseline: baseline,
      definitionValue: variable.value,
      baselineElementTypes: runLive ? runStartElementTypes.get(key) : undefined,
      definitionElementTypes: variable.elementTypes,
    })
    // The active Current source: the override, else the definition; the run-start snapshot holds literals only.
    const source = resolveCurrentExpressionSource(overrideSource(override), variable.value)
    return { display, source }
  }

  const windowCurrentOf = (row: Variable, scope: string[]): WindowCurrentSeed => {
    const { display, source } = currentDisplayOf(row, scopedVariableKey(row.name, scope))
    const sourced = row.isExpression || row.isTemplate
    return {
      value: display.value,
      hasValue: display.hasValue,
      elementTypes: display.elementTypes,
      source: sourced ? source : undefined,
    }
  }

  // A window whose own scope is shown offers the panel list; elsewhere the same list built for its scope.
  const windowAutocomplete = (entry: VariableWindowEntry): AvailableVariable[] => {
    const ownPath = windowCreatePath(entry) ?? drillPath
    return drillKeyOf(ownPath) === drillKey
      ? availableVariables
      : buildScopeAutocomplete(useWorkflowStore.getState(), ownPath)
  }

  // A window's whole node path; a library View scope leaves the View root out of its own.
  const windowNodePath = (entry: VariableWindowEntry): string[] => {
    if (!entry.edit) return (windowCreatePath(entry) ?? []).map((step) => step.nodeId)
    const viewNode = inFunctionView ? drillPath[0]?.nodeId : undefined
    return viewNode === undefined ? entry.edit.scope : [viewNode, ...entry.edit.scope]
  }

  // A plain row owns its arrow keys; inside the virtualized list the list owns them,
  // so the two never disagree about which row the user is on.
  const buildRowProps = (v: Variable, ownArrowKeys = true) => {
    const viewMode = rowViewMode.getMode(v.id)
    const key = scopedVariableKey(v.name, shownPath)
    const override = appliedOverrides.get(key)
    const hasLiveValue = runtimeValues.has(key)
    // The row shows what the next block run uses: live > Current-mode edit > definition (REQ-3.2.1.6).
    const shown = resolveCurrentDisplay({
      hasLiveValue,
      liveValue: runtimeValues.get(key),
      override,
      sessionBaseline: undefined,
      definitionValue: v.value,
    })
    // A live run holds the value it started with for a variable it gave none (VMGR-19).
    const heldByRun = runLive && !hasLiveValue && override === undefined && runStartSnapshot.has(key)
    const asRunReads = heldByRun
      ? { ...v, value: runStartSnapshot.get(key) }
      : withOverrideSource(v, override)
    return {
      variable: viewMode === 'runtime' ? asRunReads : v,
      runtimeValue: shown.value,
      hasRuntimeValue: shown.hasValue,
      viewMode,
      onToggleViewMode: () => rowViewMode.toggleMode(v.id),
      isExpressionExecutionLocked: runLocked,
      readOnly,
      currentOnly: readOnly && canOpenWindow,
      runtimeAvailable: runtimeAvailable || shown.hasValue || heldByRun,
      /* v8 ignore next 2 - COV-BRANCH-131 */
      isOutputBound: outputBoundVarNames?.has(v.name),
      isWorkflowReferenced: workflowReferencedVarNames?.has(v.name),
      recentlyChanged: recentlyChanged.has(key),
      isMirroring,
      kind: insideFunction ? classifyKind(v) : undefined,
      secretUnlocked: !!unsavedSecretIds?.has(key),
      revealSecret: shownRevealed(v),
      revealInspection: shownRevealed(v),
      isInspected: inspectors.isOpen(key),
      onExpand: () => inspectors.open(key),
      // A saved secret's value is cleared only from the window's own masked field (its pencil asks first).
      onEdit: canOpenWindow ? () => openEdit(v) : undefined,
      onDelete:
        !readOnly && onVariableDelete ? () => editors.handleDelete(v.id) : undefined,
      onKeyDown: ownArrowKeys
        ? (e: ReactKeyboardEvent) => handleRowKeyDown(e, v.id, sortedVariables)
        : undefined,
    }
  }

  return (
    <div
      className="flex flex-col h-full overflow-auto"
      data-testid="variable-manager-content"
    >
      {/* Header: VARIABLE MANAGER + + Add */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
          VARIABLE MANAGER
        </span>
        {showAddButton && !insideFunction && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => openCreate('variable')}
            data-testid="add-variable-button"
          >
            <PlusIcon size={12} className="mr-1" />
            Add
          </Button>
        )}
        {showAddButton && insideFunction && (
          // Non-modal: a modal menu's focus trap would pull the new window's focus back while it closes.
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                ref={addMenuTriggerRef}
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                data-testid="add-variable-dropdown-trigger"
              >
                <PlusIcon size={12} className="mr-1" />
                Add
                <ChevronDown className="ml-1 h-3 w-3" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={keepMenuWindowFocus}>
              <DropdownMenuItem onSelect={() => openCreateFromMenu('input')}>
                <ArrowRight className="mr-2 h-4 w-4 text-emerald-400" aria-hidden="true" />
                Input parameter
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openCreateFromMenu('output')}>
                <ArrowLeft className="mr-2 h-4 w-4 text-amber-400" aria-hidden="true" />
                Output parameter
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => openCreateFromMenu('variable')}>
                <VariableIcon className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Variable
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Toolbar: Filter + Sort */}
      <div className="flex items-center gap-2 p-2 border-b flex-shrink-0">
        <SearchInput
          size="xs"
          className="flex-1"
          placeholder="Filter variables…"
          name="variable-filter"
          autoComplete="off"
          spellCheck={false}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          aria-label="Filter variables"
          clearLabel="Clear filter"
        />
        <div className="w-32 flex-shrink-0">
          <SortDropdown value={sortKey} onValueChange={handleSortChange} />
        </div>
      </div>

      {/* Body */}
      {/* Empty-state message only outside a Function. Inside a Function the
          PARAMETERS / VARIABLES sections render even when empty so the user
          sees the scoped namespace and can use +Add to populate it. */}
      {showEmptyState && !insideFunction && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          {readOnly
            ? 'No variables in this snapshot.'
            : 'No variables yet. Click + Add to create one.'}
        </div>
      )}

      {!showEmptyState && showNoMatch && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No variables match filter
        </div>
      )}

      {!showEmptyState && !showNoMatch && !insideFunction && (
        <div ref={listBodyRef} className={useVirtualization ? 'flex-1 min-h-0' : undefined}>
          {useVirtualization ? (
            <VirtualizedList
              items={sortedVariables}
              itemHeight={INLINE_VARIABLE_ROW_HEIGHT}
              containerHeight={listWindowHeight}
              context="variable-inspector"
              data-testid="virtualized-list"
            >
              {(v) => <InlineVariableRow key={v.id} {...buildRowProps(v, false)} />}
            </VirtualizedList>
          ) : (
            sortedVariables.map((v) => (
              <InlineVariableRow key={v.id} {...buildRowProps(v)} />
            ))
          )}
        </div>
      )}

      {!showNoMatch && insideFunction && (
        <div>
          <ScopedGroup title="PARAMETERS" defaultOpen testIdSlug="parameters">
            <SubSeparator label="INPUTS" />
            {inputs.map((v) => (
              <InlineVariableRow key={v.id} {...buildRowProps(v)} />
            ))}
            <SubSeparator label="OUTPUTS" />
            {outputs.map((v) => (
              <InlineVariableRow key={v.id} {...buildRowProps(v)} />
            ))}
          </ScopedGroup>
          <ScopedGroup title="VARIABLES" defaultOpen testIdSlug="variables">
            {locals.map((v) => (
              <InlineVariableRow key={v.id} {...buildRowProps(v)} />
            ))}
          </ScopedGroup>
        </div>
      )}

      {openInspectorKeys.map((key, index) => {
        const inScope = variablesByKey.get(key)
        if (inScope && locksWatcher(inScope, !!unsavedSecretIds?.has(key), revealTestVariables)) return null
        // A watcher reads the scope it was opened in, also once the canvas drills elsewhere.
        const watched = inScope
          ? { variable: inScope, functionPath: shownPath }
          : watcherSnapshotsRef.current.get(key)
        if (!watched) return null
        const { variable: inspected, functionPath: watcherPath } = watched
        // Without a live run, a variable no run gave a value reads its definition (REQ-3.2.1.5).
        const { display, source } = currentDisplayOf(inspected, key)
        return (
          <VariableInspectModal
            key={key}
            variable={inspected}
            secretUnlocked={!!unsavedSecretIds?.has(key)}
            secretChanged={!!changedSecretIds?.has(key)}
            secretSaveTarget={secretSaveTarget}
            runtimeValue={display.value}
            hasRuntimeValue={display.hasValue}
            runtimeElementTypes={display.elementTypes}
            currentSource={inspected.isExpression ? source : undefined}
            runtimeAvailable={runtimeAvailable}
            cascadeIndex={index}
            sessionId={sessionId}
            functionPath={watcherPath}
            onClose={() => closeInspector(key)}
            availableVariables={availableVariables}
            readOnly={readOnly}
          />
        )
      })}

      {createWindows.map((entry, index) => {
        const { edit } = entry
        return (
          <VariableCreateModal
            key={entry.slot}
            windowId={String(entry.slot)}
            cascadeIndex={entry.slot}
            nameRef={index === createWindows.length - 1 ? newestNameRef : undefined}
            mode={entry.mode}
            availableVariables={windowAutocomplete(entry)}
            onCreate={(spec) => {
              const functionPath = windowCreatePath(entry)
              return functionPath === undefined
                ? onCreateVariable!(entry.mode, spec)
                : onCreateVariable!(entry.mode, spec, functionPath)
            }}
            onClose={() => closeCreate(entry.slot)}
            checkNameExists={(name, excludeId) => editors.checkNameExists(name, excludeId, windowCreatePath(entry))}
            validateExpressionCycle={(params) => {
              const functionPath = windowCreatePath(entry)
              return validateExpressionCycle(functionPath === undefined ? params : { ...params, functionPath })
            }}
            editTarget={
              edit && {
                ...edit,
                current: windowCurrentOf(edit.row, edit.scope),
                // Live, so a Test save clears the strip of a window left open.
                secretChanged: !!changedSecretIds?.has(scopedVariableKey(edit.row.name, edit.scope)),
              }
            }
            tracksUnsavedSecret={tracksSecretsAt(useWorkflowStore.getState().nodes, windowNodePath(entry), viewRootId)}
            secretSaveTarget={secretSaveTarget}
            runLocked={runLocked}
            sessionId={sessionId}
            onSaveDefinition={(spec) => onVariableEdit!(edit!.row, spec, windowCreatePath(entry))}
            onSaveCurrent={(name, body) => onVariableCurrentEdit!(name, body, windowCreatePath(entry))}
          />
        )
      })}

    </div>
  )
}
