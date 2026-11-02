/**
 * useBreadcrumbContext - workbench breadcrumb computation.
 *
 * Reads the workbench's nav-origin params (suiteId / regressionId), the
 * tracked-execution state from useWorkbenchRun, and the editing test name
 * from the workflow store, then returns the breadcrumb segments + back href
 * for the canvas bar.
 *
 * Naming policy:
 *   - Tracked execution mode overrides nav-origin params per the design.
 *   - Suite / regression / parent-execution names are fetched lazily and
 *     cached per id for the lifetime of the hook instance.
 *   - Segments grow as fetches resolve; isLoading reports whether any
 *     name-resolving fetch is still pending.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useWorkbenchRun } from '@/features/workbench/hooks/use-workbench-run'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { fetchSuiteDetail } from '@/features/suites/api/crud'
import { fetchRegressionDetail } from '@/features/regressions/api/crud'
import { fetchExecution } from '@/features/executions/api/executions'
import type { ExecutionApiResponse } from '@/features/executions/api/types'
import { usePageBlock } from '@/hooks/use-page-block'
import { startBlockingRead } from '@/hooks/use-blocking-reads'
import type {
  BreadcrumbContext,
  BreadcrumbSegment,
  BreadcrumbSegmentType,
  ParentExecutionInfo,
} from './types'
import { useHistoricalBreadcrumb } from './history-override'

const DRAFT_LABEL = 'Draft Workflow'
const SUITE_NAME_LABEL = 'suite name'
const REGRESSION_NAME_LABEL = 'regression name'
const PARENT_EXECUTION_LABEL = 'parent execution'
const GRANDPARENT_EXECUTION_LABEL = 'parent regression execution'
const ROOT_SEGMENT: BreadcrumbSegment = {
  type: 'execution-root',
  label: 'Executions',
  href: '/executions',
}

function toParentInfo(data: ExecutionApiResponse): ParentExecutionInfo {
  const parentField = (data as { parent_execution_id?: string | null })
    .parent_execution_id
  return {
    id: data.id,
    name: data.name,
    /* v8 ignore next - COV-V8-003: nullish-fallback chain on backend response shape */
    entityType: data.entity_type ?? data.type ?? '',
    parentExecutionId: parentField ?? null,
  }
}

interface HistoryOverrideInputs {
  override: { executionId: string | null; runId: string | null; testName: string | null }
  isLoading: boolean
}

function buildHistoryBreadcrumb({ override, isLoading }: HistoryOverrideInputs): BreadcrumbContext {
  const leaf: BreadcrumbSegment = {
    type: 'test',
    label: override.testName ?? 'Test Execution',
  }
  const segments = [ROOT_SEGMENT, leaf]
  const isTopLevel = !override.executionId || override.executionId === override.runId
  const backHref = isTopLevel ? '/executions' : `/executions/${override.executionId}`
  return { segments, backHref, isLoading, pendingParents: [] }
}

interface ExecutionInputs {
  parentExecutionId: string | null
  parentExec: ParentExecutionInfo | null
  grandparentExec: ParentExecutionInfo | null
  grandparentId: string | null
  sessionTestName: string | null
  isLoading: boolean
}

function buildExecutionBreadcrumb(inputs: ExecutionInputs): BreadcrumbContext {
  const { parentExecutionId, parentExec, grandparentExec, grandparentId, sessionTestName, isLoading } = inputs
  const leaf: BreadcrumbSegment = {
    type: 'test',
    /* v8 ignore next - COV-V8-003: sessionTestName nullish fallback - always set in practice by useWorkbenchRun.applyRunResponse / session-recovery */
    label: sessionTestName ?? '',
  }
  if (!parentExecutionId) {
    return { segments: [ROOT_SEGMENT, leaf], backHref: '/executions', isLoading, pendingParents: [] }
  }
  if (!parentExec) {
    return {
      segments: [ROOT_SEGMENT, leaf],
      backHref: `/executions/${parentExecutionId}`,
      isLoading,
      pendingParents: [{ type: 'suite' }],
    }
  }
  /* v8 ignore start - COV-V8-003: parent.entity_type='regression' (test launched directly from a regression with no suite layer) - rare in practice */
  if (parentExec.entityType === 'regression') {
    const regressionSeg: BreadcrumbSegment = {
      type: 'regression',
      label: parentExec.name,
      href: `/executions/${parentExec.id}`,
      id: parentExec.id,
    }
    return {
      segments: [ROOT_SEGMENT, regressionSeg, leaf],
      backHref: `/executions/${parentExec.id}`,
      isLoading,
      pendingParents: [],
    }
  }
  /* v8 ignore stop */
  const suiteSeg: BreadcrumbSegment = {
    type: 'suite',
    label: parentExec.name,
    href: `/executions/${parentExec.id}`,
    id: parentExec.id,
  }
  if (!grandparentExec) {
    const pending: Array<{ type: BreadcrumbSegmentType }> = grandparentId ? [{ type: 'regression' }] : []
    return {
      segments: [ROOT_SEGMENT, suiteSeg, leaf],
      backHref: `/executions/${parentExec.id}`,
      isLoading,
      pendingParents: pending,
    }
  }
  const regressionSeg: BreadcrumbSegment = {
    type: 'regression',
    label: grandparentExec.name,
    href: `/executions/${grandparentExec.id}`,
    id: grandparentExec.id,
  }
  return {
    segments: [ROOT_SEGMENT, regressionSeg, suiteSeg, leaf],
    backHref: `/executions/${parentExec.id}`,
    isLoading,
    pendingParents: [],
  }
}

interface NavOriginInputs {
  leaf: BreadcrumbSegment
  isInEditMode: boolean
  suiteId: string | null
  regressionId: string | null
  suiteName: string | null
  regressionName: string | null
  isLoading: boolean
}

function appendSegmentOrPending(
  segments: BreadcrumbSegment[],
  pendingParents: Array<{ type: BreadcrumbSegmentType }>,
  segment: BreadcrumbSegment | null,
  pendingType: BreadcrumbSegmentType,
): void {
  if (segment) segments.push(segment)
  else pendingParents.push({ type: pendingType })
}

/** One segment per drill entry; parents carry `#drill-<depth>` so a click pops back to them. */
function buildFunctionSegments(drillPath: ReadonlyArray<{ label: string }>): BreadcrumbSegment[] {
  const lastIndex = drillPath.length - 1
  return drillPath.map((entry, index) => {
    const depth = index + 1
    const segment: BreadcrumbSegment = { type: 'function', label: entry.label, id: String(depth) }
    return index === lastIndex ? segment : { ...segment, href: `#drill-${depth}` }
  })
}

function buildNavOriginBreadcrumb(inputs: NavOriginInputs): BreadcrumbContext {
  const { leaf, isInEditMode, suiteId, regressionId, suiteName, regressionName, isLoading } = inputs
  if (!isInEditMode) {
    return { segments: [leaf], backHref: null, isLoading, pendingParents: [] }
  }
  if (!suiteId && !regressionId) {
    return { segments: [leaf], backHref: '/tests', isLoading, pendingParents: [] }
  }
  const suiteHref = regressionId
    ? `/suites/${suiteId}?regressionId=${regressionId}`
    : `/suites/${suiteId}`
  const suiteSeg: BreadcrumbSegment | null =
    suiteId && suiteName
      ? { type: 'suite', label: suiteName, href: suiteHref, id: suiteId }
      : null
  const segments: BreadcrumbSegment[] = []
  const pendingParents: Array<{ type: BreadcrumbSegmentType }> = []
  if (regressionId) {
    const regressionSeg: BreadcrumbSegment | null = regressionName
      ? { type: 'regression', label: regressionName, href: `/regressions/${regressionId}`, id: regressionId }
      : null
    appendSegmentOrPending(segments, pendingParents, regressionSeg, 'regression')
  }
  appendSegmentOrPending(segments, pendingParents, suiteSeg, 'suite')
  segments.push(leaf)
  const backHref = regressionId ? suiteHref : `/suites/${suiteId}`
  return { segments, backHref, isLoading, pendingParents }
}

export function useBreadcrumbContext(): BreadcrumbContext {
  const [searchParams] = useSearchParams()
  const suiteId = searchParams.get('suiteId')
  const regressionId = searchParams.get('regressionId')

  const historyOverride = useHistoricalBreadcrumb()
  const run = useWorkbenchRun()
  const executionId = run.executionId
  const sessionTestName = run.sessionTestName
  const parentExecutionId = run.parentExecutionId

  const editingTestId = useWorkflowStore((s) => s.editingTestId)
  const editingTestName = useWorkflowStore((s) => s.editingTestName)
  const drillPath = useWorkflowStore((s) => s.drillPath)
  const functionViewMode = useWorkflowStore((s) => s.functionViewMode)

  // Per-id caches survive re-renders so repeated renders with the same input
  // do not trigger redundant fetches.
  const suiteCacheRef = useRef(new Map<string, string>())
  const regressionCacheRef = useRef(new Map<string, string>())
  const executionCacheRef = useRef(new Map<string, ParentExecutionInfo>())

  const [suiteName, setSuiteName] = useState<string | null>(null)
  const [regressionName, setRegressionName] = useState<string | null>(null)
  const [parentExec, setParentExec] = useState<ParentExecutionInfo | null>(null)
  const [grandparentExec, setGrandparentExec] =
    useState<ParentExecutionInfo | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const { blockPage, clearPageBlock } = usePageBlock()

  // Nav-origin: fetch suite name when suiteId is set and no tracked execution.
  useEffect(() => {
    // A re-run supersedes the previous read; the new read re-raises if it fails.
    clearPageBlock(SUITE_NAME_LABEL)
    if (executionId || !suiteId) {
      setSuiteName(null)
      return
    }
    const cached = suiteCacheRef.current.get(suiteId)
    if (cached) {
      setSuiteName(cached)
      return
    }
    setSuiteName(null)
    let canceled = false
    startBlockingRead(
      {
        label: SUITE_NAME_LABEL,
        canceled: () => canceled,
        run: async () => {
          setPendingCount((c) => c + 1)
          try {
            const { suite } = await fetchSuiteDetail(suiteId)
            /* v8 ignore next - COV-V8-003: canceled guard fires only when the effect unmounts mid-fetch */
            if (canceled) return
            suiteCacheRef.current.set(suite.id, suite.name)
            setSuiteName(suite.name)
            clearPageBlock(SUITE_NAME_LABEL)
          } finally {
            // The decrement is unconditional; a canceled read still ends its pending turn.
            setPendingCount((c) => c - 1)
          }
        },
      },
      blockPage,
    )
    return () => {
      canceled = true
    }
  }, [executionId, suiteId, blockPage, clearPageBlock])

  // Nav-origin: fetch regression name when regressionId is set and no tracked execution.
  useEffect(() => {
    clearPageBlock(REGRESSION_NAME_LABEL)
    if (executionId || !regressionId) {
      setRegressionName(null)
      return
    }
    const cached = regressionCacheRef.current.get(regressionId)
    if (cached) {
      setRegressionName(cached)
      return
    }
    setRegressionName(null)
    let canceled = false
    startBlockingRead(
      {
        label: REGRESSION_NAME_LABEL,
        canceled: () => canceled,
        run: async () => {
          setPendingCount((c) => c + 1)
          try {
            const { regression } = await fetchRegressionDetail(regressionId)
            /* v8 ignore next - COV-V8-003: canceled guard fires only when the effect unmounts mid-fetch */
            if (canceled) return
            regressionCacheRef.current.set(regression.id, regression.name)
            setRegressionName(regression.name)
            clearPageBlock(REGRESSION_NAME_LABEL)
          } finally {
            // The decrement is unconditional; a canceled read still ends its pending turn.
            setPendingCount((c) => c - 1)
          }
        },
      },
      blockPage,
    )
    return () => {
      canceled = true
    }
  }, [executionId, regressionId, blockPage, clearPageBlock])

  // Tracked execution: fetch parent execution info.
  useEffect(() => {
    clearPageBlock(PARENT_EXECUTION_LABEL)
    if (!executionId || !parentExecutionId) {
      setParentExec(null)
      return
    }
    const cached = executionCacheRef.current.get(parentExecutionId)
    if (cached) {
      setParentExec(cached)
      return
    }
    setParentExec(null)
    let canceled = false
    startBlockingRead(
      {
        label: PARENT_EXECUTION_LABEL,
        canceled: () => canceled,
        run: async () => {
          setPendingCount((c) => c + 1)
          try {
            const resp = await fetchExecution(parentExecutionId)
            /* v8 ignore next - COV-V8-003: canceled/!success guard fires on race conditions not scripted by unit tests */
            if (canceled || !resp.success) return
            const info = toParentInfo(resp.data)
            executionCacheRef.current.set(parentExecutionId, info)
            setParentExec(info)
            clearPageBlock(PARENT_EXECUTION_LABEL)
          } finally {
            // The decrement is unconditional; a canceled read still ends its pending turn.
            setPendingCount((c) => c - 1)
          }
        },
      },
      blockPage,
    )
    return () => {
      canceled = true
    }
  }, [executionId, parentExecutionId, blockPage, clearPageBlock])

  // Regression child: when the parent is a suite execution whose own parent
  // is set, fetch the grandparent (regression execution) for the 4-level path.
  const grandparentId =
    parentExec?.entityType === 'suite' ? parentExec.parentExecutionId ?? null : null

  useEffect(() => {
    clearPageBlock(GRANDPARENT_EXECUTION_LABEL)
    if (!grandparentId) {
      setGrandparentExec(null)
      return
    }
    const cached = executionCacheRef.current.get(grandparentId)
    /* v8 ignore next 4 - COV-V8-003: grandparent cache hit only fires when a regression child's grandparent id was previously fetched and is re-encountered; the lookup chain (parent.parentExecutionId) makes targeted re-entry impractical to script */
    if (cached) {
      setGrandparentExec(cached)
      return
    }
    setGrandparentExec(null)
    let canceled = false
    startBlockingRead(
      {
        label: GRANDPARENT_EXECUTION_LABEL,
        canceled: () => canceled,
        run: async () => {
          setPendingCount((c) => c + 1)
          try {
            const resp = await fetchExecution(grandparentId)
            /* v8 ignore next - COV-V8-003: canceled/!success guard fires on race conditions not scripted by unit tests */
            if (canceled || !resp.success) return
            const info = toParentInfo(resp.data)
            executionCacheRef.current.set(grandparentId, info)
            setGrandparentExec(info)
            clearPageBlock(GRANDPARENT_EXECUTION_LABEL)
          } finally {
            // The decrement is unconditional; a canceled read still ends its pending turn.
            setPendingCount((c) => c - 1)
          }
        },
      },
      blockPage,
    )
    return () => {
      canceled = true
    }
  }, [grandparentId, blockPage, clearPageBlock])

  return useMemo<BreadcrumbContext>(() => {
    // Library View: Function segments only, no Test leaf (VIEW-2).
    if (functionViewMode) {
      return {
        segments: buildFunctionSegments(drillPath),
        backHref: `/functions/${functionViewMode.functionId}`,
        isLoading: false,
        pendingParents: [],
      }
    }
    const isLoading = pendingCount > 0
    let base: BreadcrumbContext
    if (historyOverride) {
      base = buildHistoryBreadcrumb({ override: historyOverride, isLoading })
    } else if (executionId) {
      base = buildExecutionBreadcrumb({
        parentExecutionId,
        parentExec,
        grandparentExec,
        grandparentId,
        sessionTestName,
        isLoading,
      })
    } else {
      // Nav-origin path: editingTestId drives the leaf label. The URL `editTest`
      // param keeps the breadcrumb in edit-mode hierarchy with a skeleton leaf
      // while the workflow store hydrates, so the bar doesn't flash Draft.
      const editTestUrl = searchParams.get('editTest')
      const hasEditIntent = editTestUrl !== null
      const isLoadingTest = hasEditIntent && editingTestId !== editTestUrl
      const isInEditMode = hasEditIntent || editingTestId !== null
      const loadedTestLabel = editingTestId && editingTestName ? editingTestName : DRAFT_LABEL
      const testLabel = isLoadingTest ? '' : loadedTestLabel
      const leaf: BreadcrumbSegment = {
        type: 'test',
        label: testLabel,
        ...(isLoadingTest ? { isPending: true } : {}),
      }
      base = buildNavOriginBreadcrumb({
        leaf,
        isInEditMode,
        suiteId,
        regressionId,
        suiteName,
        regressionName,
        isLoading,
      })
    }

    if (drillPath.length === 0) return base

    // When drilled in, the previously-leaf segment (Test / History) becomes
    // intermediate and must pop ALL drill levels when clicked. Give it the
    // synthetic href `#drill-0` so the breadcrumb-bar click handler
    // dispatches popDrillTo(0). The build* helpers always produce at least
    // one segment (the leaf), so `previousLeaf` is non-null here.
    const baseSegments = base.segments.slice(0, -1)
    /* v8 ignore next - COV-V8-003: build helpers always emit a leaf, so at(-1) is never undefined here */
    const previousLeaf = base.segments.at(-1)!
    const adjustedBase: BreadcrumbSegment[] = [
      ...baseSegments,
      { ...previousLeaf, href: previousLeaf.href ?? '#drill-0' },
    ]

    return {
      ...base,
      segments: [...adjustedBase, ...buildFunctionSegments(drillPath)],
    }
  }, [
    historyOverride,
    executionId,
    parentExecutionId,
    parentExec,
    grandparentExec,
    grandparentId,
    sessionTestName,
    suiteId,
    regressionId,
    searchParams,
    editingTestId,
    editingTestName,
    suiteName,
    regressionName,
    pendingCount,
    drillPath,
    functionViewMode,
  ])
}
