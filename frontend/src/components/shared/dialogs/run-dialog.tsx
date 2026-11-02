/**
 * RunDialog Component
 *
 * Shared dialog for running Tests, Suites, and Regressions.
 *
 * REQ-5.2.1.37: Regression management screen (list, create, edit, version control)
 * REQ-5.2.1.36: Suite management screen (list, create, edit, organize tests)
 * REQ-5.2.1.35: Test management screen (list, create, edit, organize in suites)
 *
 * Layout:
 * - Tests: Single column (environment selector only) - 400px
 * - Suites/Regressions: Two columns (env selector | test list) - 800px, resizable
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Check, ChevronDown, ChevronRight, GripVertical, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DuplicateTestBadge } from '@/components/shared/duplicate-test-badge'

// ============================================================================
// Types
// ============================================================================

export interface Environment {
  id: string
  name: string
}

export interface SuiteTest {
  id: string
  name: string
  selected: boolean
}

export interface SuiteTests {
  tests: SuiteTest[]
}

export interface RegressionSuite {
  id: string
  name: string
  expanded: boolean
  tests: SuiteTest[]
}

export interface RegressionSuites {
  suites: RegressionSuite[]
}

export interface RunDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityType: 'test' | 'suite' | 'regression'
  entityName: string
  entityId: string
  // For suite: flat test list
  suiteTests?: SuiteTests
  // For regression: grouped by suite
  regressionSuites?: RegressionSuites
  // Selection handlers
  onTestSelectionChange?: (testId: string, selected: boolean) => void
  /**
   * Regression-only selection handler. Receives the suite-id alongside the
   * test-id so the same test in different suites can be selected
   * independently per context (per-(suite, test) selection model).
   */
  onRegressionTestSelectionChange?: (
    suiteId: string,
    testId: string,
    selected: boolean
  ) => void
  onSuiteSelectionChange?: (suiteId: string, selected: boolean) => void
  onSelectAll?: (selected: boolean) => void
  onSuiteExpandToggle?: (suiteId: string) => void
  /**
   * Regression-only. Map of test_id to the suite_ids in which it appears
   * (in regression order). A test with 2+ entries renders a duplicate
   * badge next to it so the user knows it will run multiple times.
   */
  duplicateTests?: Record<string, string[]>
  // Environment selection
  environments: Environment[]
  recentEnvironments: Environment[]
  selectedEnvironmentId: string | null
  onEnvironmentSelect: (envId: string) => void
  // Actions
  onRun: () => void
  onCancel: () => void
  isRunning?: boolean
}

// ============================================================================
// Environment Selector Component
// ============================================================================

function EnvironmentSelector({
  environments,
  recentEnvironments,
  selectedEnvironmentId,
  onEnvironmentSelect,
  searchQuery,
  onSearchChange,
}: Readonly<{
  environments: Environment[]
  recentEnvironments: Environment[]
  selectedEnvironmentId: string | null
  onEnvironmentSelect: (envId: string) => void
  searchQuery: string
  onSearchChange: (query: string) => void
}>) {
  // Filter environments by search
  const filteredEnvironments = useMemo(() => {
    if (!searchQuery) return environments
    const query = searchQuery.toLowerCase()
    return environments.filter((env) => env.name.toLowerCase().includes(query))
  }, [environments, searchQuery])

  const filteredRecentEnvironments = useMemo(() => {
    if (!searchQuery) return recentEnvironments
    const query = searchQuery.toLowerCase()
    return recentEnvironments.filter((env) => env.name.toLowerCase().includes(query))
  }, [recentEnvironments, searchQuery])

  const renderEnvironmentItem = (env: Environment, prefix: string = 'environment-item') => {
    const isSelected = selectedEnvironmentId === env.id
    return (
      <button
        type="button"
        key={env.id}
        data-testid={prefix}
        data-env-id={env.id}
        aria-current={isSelected ? 'true' : undefined}
        onClick={() => onEnvironmentSelect(env.id)}
        className={cn(
          'flex w-full cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm transition-colors text-left bg-transparent border-0',
          isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
        )}
      >
        <span className="truncate">{env.name}</span>
        {isSelected && <Check data-testid="checkmark-icon" className="ml-2 h-4 w-4 flex-shrink-0" />}
      </button>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Environment
      </h3>

      <Input
        type="search"
        data-testid="run-dialog-env-search"
        placeholder="Search…"
        aria-label="Search environments"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="mb-2 h-8 text-sm"
      />

      <ScrollArea data-testid="environments-scroll-area" className="flex-1 -mr-2 pr-2">
        {filteredRecentEnvironments.length > 0 && (
          <div data-testid="recent-environments" className="mb-3">
            <div data-testid="run-dialog-recent-header" className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Recent
            </div>
            <div className="space-y-0.5">
              {filteredRecentEnvironments.map((env) =>
                renderEnvironmentItem(env, 'run-dialog-recent-env')
              )}
            </div>
          </div>
        )}

        <div data-testid="all-environments">
          <div data-testid="run-dialog-all-envs-header" className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            ALL ENVIRONMENTS
          </div>
          <div className="space-y-0.5">
            {filteredEnvironments.map((env) =>
              renderEnvironmentItem(env, 'run-dialog-all-env')
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

// ============================================================================
// Test Selector for Suites (Variant A - flat test list)
// ============================================================================

function SuiteTestSelector({
  suiteTests,
  searchQuery,
  onSearchChange,
  onTestSelectionChange,
  onSelectAll,
}: Readonly<{
  suiteTests: SuiteTests
  searchQuery: string
  onSearchChange: (query: string) => void
  onTestSelectionChange?: (testId: string, selected: boolean) => void
  onSelectAll?: (selected: boolean) => void
}>) {
  const filteredTests = useMemo(() => {
    if (!searchQuery) return suiteTests.tests
    const query = searchQuery.toLowerCase()
    return suiteTests.tests.filter((t) => t.name.toLowerCase().includes(query))
  }, [suiteTests.tests, searchQuery])

  const { selectedCount, totalCount } = useMemo(() => {
    const selectedCount = suiteTests.tests.filter((t) => t.selected).length
    return { selectedCount, totalCount: suiteTests.tests.length }
  }, [suiteTests])

  const selectAllState = useMemo(() => {
    if (selectedCount === 0) return 'unchecked'
    if (selectedCount === totalCount) return 'checked'
    return 'indeterminate'
  }, [selectedCount, totalCount])

  const handleSelectAll = () => {
    onSelectAll?.(selectAllState !== 'checked')
  }

  return (
    <div className="flex h-full flex-col">
      <div data-testid="run-dialog-test-selection-header" className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tests
        </h3>
        <span data-testid="run-dialog-selected-count" className="text-xs text-muted-foreground">
          {selectedCount}/{totalCount}
        </span>
      </div>

      <Input
        type="search"
        placeholder="Search tests…"
        aria-label="Search tests"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="mb-2 h-8 text-sm"
      />

      <div data-testid="run-dialog-select-all" className="mb-2 flex items-center gap-2 border-b pb-2">
        <Checkbox
          id="select-all-suite"
          aria-label="Select All"
          checked={selectAllState === 'checked'}
          data-state={selectAllState}
          onCheckedChange={handleSelectAll}
          className="h-4 w-4"
        />
        <label htmlFor="select-all-suite" className="text-sm font-medium">
          Select All
        </label>
      </div>

      <ScrollArea data-testid="run-dialog-test-scroll-area" className="flex-1 -mr-2 pr-2">
        <div data-testid="suite-tests-list" className="space-y-0.5">
          {filteredTests.map((test) => (
            <div
              key={test.id}
              data-testid="run-dialog-test-item"
              className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/50"
            >
              <Checkbox
                id={`test-${test.id}`}
                aria-label={test.name}
                checked={test.selected}
                onCheckedChange={(checked) =>
                  onTestSelectionChange?.(test.id, !!checked)
                }
                className="h-4 w-4"
              />
              <label
                htmlFor={`test-${test.id}`}
                className="flex-1 cursor-pointer truncate text-sm"
              >
                {test.name}
              </label>
            </div>
          ))}
          {filteredTests.length === 0 && suiteTests.tests.length > 0 && (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No tests match your search
            </div>
          )}
          {suiteTests.tests.length === 0 && (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No tests in this suite
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ============================================================================
// Test Selector for Regressions (Variant B - suites with nested tests)
// ============================================================================

function RegressionTestSelector({
  regressionSuites,
  searchQuery,
  onSearchChange,
  onRegressionTestSelectionChange,
  onSuiteSelectionChange,
  onSelectAll,
  onSuiteExpandToggle,
  duplicateTests,
}: Readonly<{
  regressionSuites: RegressionSuites
  searchQuery: string
  onSearchChange: (query: string) => void
  onRegressionTestSelectionChange?: (
    suiteId: string,
    testId: string,
    selected: boolean
  ) => void
  onSuiteSelectionChange?: (suiteId: string, selected: boolean) => void
  onSelectAll?: (selected: boolean) => void
  onSuiteExpandToggle?: (suiteId: string) => void
  duplicateTests?: Record<string, string[]>
}>) {
  const suiteNameById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const s of regressionSuites.suites) map[s.id] = s.name
    return map
  }, [regressionSuites.suites])
  // Filter suites and tests by search
  const filteredSuites = useMemo(() => {
    if (!searchQuery) return regressionSuites.suites
    const query = searchQuery.toLowerCase()
    return regressionSuites.suites
      .map((suite) => ({
        ...suite,
        tests: suite.tests.filter((t) => t.name.toLowerCase().includes(query)),
      }))
      .filter(
        (suite) =>
          suite.name.toLowerCase().includes(query) || suite.tests.length > 0
      )
  }, [regressionSuites.suites, searchQuery])

  const { selectedCount, totalCount, suiteCount } = useMemo(() => {
    let selectedCount = 0
    let totalCount = 0
    regressionSuites.suites.forEach((suite) => {
      suite.tests.forEach((test) => {
        totalCount++
        if (test.selected) selectedCount++
      })
    })
    return { selectedCount, totalCount, suiteCount: regressionSuites.suites.length }
  }, [regressionSuites])

  const selectAllState = useMemo(() => {
    if (selectedCount === 0) return 'unchecked'
    if (selectedCount === totalCount) return 'checked'
    return 'indeterminate'
  }, [selectedCount, totalCount])

  const handleSelectAll = () => {
    onSelectAll?.(selectAllState !== 'checked')
  }

  const getSuiteCheckboxState = (suite: RegressionSuite) => {
    const selectedInSuite = suite.tests.filter((t) => t.selected).length
    if (selectedInSuite === 0) return 'unchecked'
    if (selectedInSuite === suite.tests.length) return 'checked'
    return 'indeterminate'
  }

  const handleSuiteCheckboxClick = (suiteId: string) => {
    const suite = regressionSuites.suites.find((s) => s.id === suiteId)
    if (suite) {
      const currentState = getSuiteCheckboxState(suite)
      onSuiteSelectionChange?.(suiteId, currentState !== 'checked')
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div data-testid="run-dialog-test-selection-header" className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Test Selection
        </h3>
        <span data-testid="run-dialog-selected-count" className="text-xs text-muted-foreground">
          {selectedCount}/{totalCount} tests in {suiteCount} suites
        </span>
      </div>

      <Input
        type="search"
        placeholder="Search suites or tests…"
        aria-label="Search suites and tests"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="mb-2 h-8 text-sm"
      />

      <div data-testid="run-dialog-select-all" className="mb-2 flex items-center gap-2 border-b pb-2">
        <Checkbox
          id="select-all-regression"
          aria-label="Select All"
          checked={selectAllState === 'checked'}
          data-state={selectAllState}
          onCheckedChange={handleSelectAll}
          className="h-4 w-4"
        />
        <label htmlFor="select-all-regression" className="text-sm font-medium">
          Select All
        </label>
      </div>

      <ScrollArea data-testid="run-dialog-test-scroll-area" className="flex-1 -mr-2 pr-2">
        <div className="space-y-1">
          {filteredSuites.map((suite) => {
            const originalSuite = regressionSuites.suites.find(s => s.id === suite.id)
            /* v8 ignore start - COV-BRANCH-030 */
            const suiteState = originalSuite ? getSuiteCheckboxState(originalSuite) : 'unchecked'
            const selectedInSuite = originalSuite?.tests.filter((t) => t.selected).length ?? 0
            const totalInSuite = originalSuite?.tests.length ?? 0
            /* v8 ignore stop */
            return (
              <Collapsible
                key={suite.id}
                data-testid={`suite-group-${suite.id}`}
                data-suite-group
                open={suite.expanded}
                onOpenChange={() => onSuiteExpandToggle?.(suite.id)}
              >
                <div
                  data-testid={`suite-header-${suite.id}`}
                  className="flex items-center gap-1 rounded bg-muted/40 px-1.5 py-1"
                >
                  <CollapsibleTrigger asChild>
                    <button
                      data-testid="suite-group-chevron"
                      className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted"
                    >
                      {suite.expanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </CollapsibleTrigger>
                  <Checkbox
                    data-testid="suite-group-checkbox"
                    checked={suiteState === 'checked'}
                    data-state={suiteState}
                    onCheckedChange={() => handleSuiteCheckboxClick(suite.id)}
                    disabled={totalInSuite === 0}
                    className="h-4 w-4"
                  />
                  <span data-testid="suite-group-name" className="flex-1 truncate text-sm font-medium">{suite.name}</span>
                  <span data-testid="suite-group-counter" className="text-xs text-muted-foreground tabular-nums">
                    {selectedInSuite}/{totalInSuite}
                  </span>
                </div>
                <CollapsibleContent>
                  <div className="ml-6 border-l border-muted pl-2 py-0.5">
                    {suite.tests.map((test) => {
                      const originalTest = originalSuite?.tests.find(t => t.id === test.id)
                      const dupSuiteIds = duplicateTests?.[test.id] ?? []
                      const dupSuites = dupSuiteIds.map((id) => ({
                        id,
                        /* v8 ignore next - COV-BRANCH-029: defensive ?? fallback */
                        name: suiteNameById[id] ?? id,
                      }))
                      return (
                        <div
                          key={`${suite.id}-${test.id}`}
                          data-testid="run-dialog-test-item"
                          className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/30"
                        >
                          <Checkbox
                            id={`test-${suite.id}-${test.id}`}
                            aria-label={test.name}
                            /* v8 ignore next - COV-BRANCH-029 */
                            checked={originalTest?.selected ?? false}
                            onCheckedChange={(checked) =>
                              onRegressionTestSelectionChange?.(suite.id, test.id, !!checked)
                            }
                            className="h-3.5 w-3.5"
                          />
                          <label
                            htmlFor={`test-${suite.id}-${test.id}`}
                            className="flex-1 cursor-pointer truncate text-sm"
                          >
                            {test.name}
                          </label>
                          <DuplicateTestBadge suites={dupSuites} />
                        </div>
                      )
                    })}
                    {suite.tests.length === 0 && (
                      <div className="py-1 text-xs text-muted-foreground">
                        No tests
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
          {filteredSuites.length === 0 && regressionSuites.suites.length > 0 && (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No suites or tests match your search
            </div>
          )}
          {regressionSuites.suites.length === 0 && (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No suites in this regression
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ============================================================================
// Resize Handle Component
// ============================================================================

function ResizeHandle({
  onResizeStart,
  onResizeMove,
  onResizeEnd,
}: Readonly<{
  onResizeStart: () => { width: number; height: number }
  onResizeMove: (width: number, height: number) => void
  onResizeEnd: () => void
}>) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startY = e.clientY
      const startSize = onResizeStart()

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX
        const deltaY = moveEvent.clientY - startY
        onResizeMove(startSize.width + deltaX, startSize.height + deltaY)
      }

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        onResizeEnd()
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [onResizeStart, onResizeMove, onResizeEnd]
  )

  return (
    <button
      type="button"
      data-testid="resize-handle-se"
      aria-label="Resize dialog"
      onMouseDown={handleMouseDown}
      className="absolute bottom-0 right-0 z-10 flex h-4 w-4 cursor-se-resize items-center justify-center opacity-30 transition-opacity hover:opacity-70"
      style={{ all: 'unset', position: 'absolute', bottom: 0, right: 0, zIndex: 10, display: 'flex', width: '1rem', height: '1rem', cursor: 'se-resize', alignItems: 'center', justifyContent: 'center', opacity: 0.3 }}
    >
      <GripVertical className="h-3 w-3 rotate-45 text-muted-foreground" />
    </button>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function RunDialog({
  open,
  onOpenChange,
  entityType,
  entityName,
  entityId: _entityId,
  suiteTests,
  regressionSuites,
  onTestSelectionChange,
  onRegressionTestSelectionChange,
  onSuiteSelectionChange,
  onSelectAll,
  onSuiteExpandToggle,
  duplicateTests,
  environments,
  recentEnvironments,
  selectedEnvironmentId,
  onEnvironmentSelect,
  onRun,
  onCancel,
  isRunning = false,
}: Readonly<RunDialogProps>) {
  const [envSearchQuery, setEnvSearchQuery] = useState('')
  const [testSearchQuery, setTestSearchQuery] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)

  // Determine if we show test selection (horizontal layout)
  const showTestSelection = entityType === 'suite' || entityType === 'regression'

  // Dialog dimensions - resizable
  const minWidth = showTestSelection ? 600 : 360
  const minHeight = 400
  const defaultWidth = showTestSelection ? 800 : 400
  const defaultHeight = showTestSelection ? 560 : 480

  const [size, setSize] = useState({ width: defaultWidth, height: defaultHeight })

  // Reset size when dialog opens or entity type changes
  useEffect(() => {
    if (open) {
      setSize({ width: defaultWidth, height: defaultHeight })
      setEnvSearchQuery('')
      setTestSearchQuery('')
    }
  }, [open, defaultWidth, defaultHeight])

  // Max size is 90% of viewport
  /* v8 ignore start - COV-SSR-010 */
  const maxWidth = globalThis.window === undefined ? 1200 : globalThis.window.innerWidth * 0.9
  const maxHeight = globalThis.window === undefined ? 800 : globalThis.window.innerHeight * 0.9
  /* v8 ignore stop */

  const handleResizeStart = useCallback(() => {
    return { width: size.width, height: size.height }
  }, [size.width, size.height])

  const handleResizeMove = useCallback(
    (newWidth: number, newHeight: number) => {
      setSize({
        width: Math.min(maxWidth, Math.max(minWidth, newWidth)),
        height: Math.min(maxHeight, Math.max(minHeight, newHeight)),
      })
    },
    [minWidth, minHeight, maxWidth, maxHeight]
  )

  const handleResizeEnd = useCallback(() => {
    // Could save preference here if needed
  }, [])

  // Get entity title based on type. Default keeps a non-empty title so
  // Radix's Dialog accessibility check never sees an empty Title even if
  // a caller passes an unexpected entityType (e.g. during the transient
  // moment an execution record's entity_type is still loading).
  const entityTitle = useMemo(() => {
    switch (entityType) {
      case 'test':
        return 'Run Test'
      case 'suite':
        return 'Run Suite'
      case 'regression':
        return 'Run Regression'
      /* v8 ignore next 2 - COV-BRANCH-029 */
      default:
        return 'Run'
    }
  }, [entityType])

  // Check if any tests are selected (for suite/regression)
  const hasSelectedTests = useMemo(() => {
    if (entityType === 'test') return true // Single test always runs
    if (entityType === 'suite' && suiteTests) {
      return suiteTests.tests.some((t) => t.selected)
    }
    if (entityType === 'regression' && regressionSuites) {
      return regressionSuites.suites.some((s) => s.tests.some((t) => t.selected))
    }
    return true
  }, [entityType, suiteTests, regressionSuites])

  if (!open) return null

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-testid="dialog-overlay" className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          ref={contentRef}
          data-testid="run-dialog-content"
          aria-modal="true"
          style={{ width: size.width, height: size.height }}
          className="fixed left-[50%] top-[50%] z-50 flex translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden border bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg"
        >
          {/* Title first so it registers with Radix's Dialog context before
              any sibling paints - prevents the accessibility warning when
              this dialog is mounted conditionally (e.g. Re-run from the
              Execution Detail toolbar). Visually it still appears in the
              header row below thanks to flex ordering. */}
          <DialogPrimitive.Title data-testid="run-dialog-title" className="sr-only">
            {entityTitle}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description data-testid="run-dialog-subtitle-sr" className="sr-only">
            {entityName}
          </DialogPrimitive.Description>

          {/* Resize handle */}
          <ResizeHandle
            onResizeStart={handleResizeStart}
            onResizeMove={handleResizeMove}
            onResizeEnd={handleResizeEnd}
          />

          {/* Visible header row. Title/Description above already satisfy the
              Radix Dialog accessibility contract; these are the visible
              mirrors for sighted users. */}
          <div className="relative flex flex-col space-y-1.5 text-left flex-shrink-0 border-b px-4 py-3">
            <h2 aria-hidden="true" data-testid="run-dialog-title-visible" className="text-base font-semibold leading-none tracking-tight">{entityTitle}</h2>
            <p aria-hidden="true" data-testid="run-dialog-subtitle" className="text-sm text-muted-foreground">
              {entityName}
            </p>
            <button
              data-testid="run-dialog-close"
              type="button"
              onClick={onCancel}
              className="absolute right-3 top-3 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Main content area */}
          <div className="flex min-h-0 flex-1">
            {showTestSelection ? (
              <>
                {/* Left side: Environment selector */}
                <div className="flex w-[220px] flex-shrink-0 flex-col border-r p-3">
                  <EnvironmentSelector
                    environments={environments}
                    recentEnvironments={recentEnvironments}
                    selectedEnvironmentId={selectedEnvironmentId}
                    onEnvironmentSelect={onEnvironmentSelect}
                    searchQuery={envSearchQuery}
                    onSearchChange={setEnvSearchQuery}
                  />
                </div>

                {/* Right side: Test selector */}
                <div className="flex min-w-0 flex-1 flex-col p-3">
                  {entityType === 'suite' && suiteTests && (
                    <SuiteTestSelector
                      suiteTests={suiteTests}
                      searchQuery={testSearchQuery}
                      onSearchChange={setTestSearchQuery}
                      onTestSelectionChange={onTestSelectionChange}
                      onSelectAll={onSelectAll}
                    />
                  )}
                  {entityType === 'regression' && regressionSuites && (
                    <RegressionTestSelector
                      regressionSuites={regressionSuites}
                      searchQuery={testSearchQuery}
                      onSearchChange={setTestSearchQuery}
                      onRegressionTestSelectionChange={onRegressionTestSelectionChange}
                      onSuiteSelectionChange={onSuiteSelectionChange}
                      onSelectAll={onSelectAll}
                      onSuiteExpandToggle={onSuiteExpandToggle}
                      duplicateTests={duplicateTests}
                    />
                  )}
                </div>
              </>
            ) : (
              /* Tests: Single column - environment selector only */
              <div className="flex w-full flex-col p-4">
                <EnvironmentSelector
                  environments={environments}
                  recentEnvironments={recentEnvironments}
                  selectedEnvironmentId={selectedEnvironmentId}
                  onEnvironmentSelect={onEnvironmentSelect}
                  searchQuery={envSearchQuery}
                  onSearchChange={setEnvSearchQuery}
                />
              </div>
            )}
          </div>

          {/* Footer - compact */}
          <div
            data-testid="run-dialog-footer"
            className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 flex-shrink-0 border-t px-4 py-3"
          >
            <Button data-testid="run-dialog-cancel" variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              data-testid="run-dialog-run"
              size="sm"
              onClick={onRun}
              disabled={!selectedEnvironmentId || !hasSelectedTests || isRunning}
            >
              {isRunning ? 'Running…' : 'Run'}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
