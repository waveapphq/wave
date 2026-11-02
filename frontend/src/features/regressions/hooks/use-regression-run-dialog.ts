/**
 * useRegressionRunDialog - shared state for the regression Run dialog.
 *
 * Selection is keyed per-(suiteId, testId) pair so a test that appears in
 * multiple suites of the same regression can be independently selected in
 * each suite context. Also exposes a duplicateTests map the dialog uses to
 * render the duplicate-test badge.
 */

import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchRegressionSuitesWithTests } from '@/features/regressions/api/crud'
import type { SuiteWithTests } from '@/features/regressions/api/types'
import { startExecution } from '@/features/executions/api/executions'
import { useEnvironmentSelect } from '@/hooks/use-environment-select'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'

interface RegressionTestRow {
  id: string
  name: string
  selected: boolean
}

interface RegressionSuiteGroup {
  id: string
  name: string
  expanded: boolean
  tests: RegressionTestRow[]
}

interface UseRegressionRunDialogDeps {
  setError: (message: string) => void
  /** The surface's gated environments list; the dialog runs no environments read of its own. */
  environments: Array<{ id: string; name: string }>
}

/** The (suiteId, testId) pairs a Re-run starts selected, or null to select all. */
type SeedPairs = Array<{ suiteId: string; testId: string }> | null | undefined

function toSeedKeys(seedSelectedPairs: SeedPairs): Set<string> | null {
  if (!seedSelectedPairs) return null
  return new Set(seedSelectedPairs.map((p) => `${p.suiteId}|${p.testId}`))
}

function toSuiteGroups(
  suites: SuiteWithTests[],
  seedKeys: Set<string> | null,
): RegressionSuiteGroup[] {
  return suites.map((s) => ({
    id: s.id,
    name: s.name,
    expanded: true,
    tests: s.tests.map((t) => ({
      id: t.id,
      name: t.name,
      selected: seedKeys ? seedKeys.has(`${s.id}|${t.id}`) : true,
    })),
  }))
}

function updateTestInSuite(
  suite: RegressionSuiteGroup,
  suiteId: string,
  testId: string,
  selected: boolean,
): RegressionSuiteGroup {
  if (suite.id === suiteId) {
    return {
      ...suite,
      tests: suite.tests.map((t) => (t.id === testId ? { ...t, selected } : t)),
    }
  }
  return suite
}

function setAllSelected(
  suites: RegressionSuiteGroup[],
  selected: boolean,
): RegressionSuiteGroup[] {
  return suites.map((s) => ({ ...s, tests: s.tests.map((t) => ({ ...t, selected })) }))
}

function updateAllTestsInSuite(
  suite: RegressionSuiteGroup,
  suiteId: string,
  selected: boolean,
): RegressionSuiteGroup {
  if (suite.id === suiteId) {
    return { ...suite, tests: suite.tests.map((t) => ({ ...t, selected })) }
  }
  return suite
}

export function useRegressionRunDialog({
  setError,
  environments,
}: Readonly<UseRegressionRunDialogDeps>) {
  const navigate = useNavigate()
  const { error: toastError } = useToast()

  const [isOpen, setIsOpen] = useState(false)
  const [regressionToRun, setRegressionToRun] = useState<{ id: string; name: string } | null>(null)
  const [regressionSuites, setRegressionSuites] = useState<RegressionSuiteGroup[]>([])
  const envSelect = useEnvironmentSelect(environments)

  /**
   * Open the dialog for a regression. When `seedSelectedPairs` is supplied
   * (e.g. Re-run from an execution record's persisted subset), only those
   * (suiteId, testId) pairs start selected; every other pair starts
   * unselected so the user sees the exact prior selection and can adjust.
   * Omit the seed to select everything by default.
   */
  // The row actions that open this dialog cannot await, so the read carries its
  // own reporting catch and there is no outcome for a caller to wait on.
  const openForRegression = useCallback(
    (
      regressionId: string,
      regressionName: string,
      seedSelectedPairs?: SeedPairs,
    ): void => {
      envSelect.selectEnvironment(null)
      fetchRegressionSuitesWithTests(regressionId)
        .then((data) => {
          setRegressionToRun({ id: regressionId, name: regressionName })
          setRegressionSuites(toSuiteGroups(data, toSeedKeys(seedSelectedPairs)))
          setIsOpen(true)
        })
        .catch((err: unknown) => {
          // A dialog listing nothing reads as "this regression has no suites".
          toastError(toFailureDetail(err).message, 'Could Not Load Regression Suites')
        })
    },
    [envSelect, toastError]
  )

  const close = useCallback(() => {
    setIsOpen(false)
    setRegressionToRun(null)
    envSelect.selectEnvironment(null)
    setRegressionSuites([])
  }, [envSelect])

  const togglePair = useCallback((suiteId: string, testId: string, selected: boolean) => {
    setRegressionSuites((prev) => prev.map((s) => updateTestInSuite(s, suiteId, testId, selected)))
  }, [])

  const toggleSuite = useCallback((suiteId: string, selected: boolean) => {
    setRegressionSuites((prev) => prev.map((s) => updateAllTestsInSuite(s, suiteId, selected)))
  }, [])

  const toggleAll = useCallback((selected: boolean) => {
    setRegressionSuites((prev) => setAllSelected(prev, selected))
  }, [])

  const toggleSuiteExpand = useCallback((suiteId: string) => {
    setRegressionSuites((prev) =>
      prev.map((s) => (s.id === suiteId ? { ...s, expanded: !s.expanded } : s))
    )
  }, [])

  const submit = useCallback(async () => {
    if (!regressionToRun || !envSelect.selectedEnvironmentId) return
    try {
      const pairs = regressionSuites.flatMap((s) =>
        s.tests.filter((t) => t.selected).map((t) => ({ suiteId: s.id, testId: t.id }))
      )
      const execution = await startExecution({
        type: 'regression',
        id: regressionToRun.id,
        environmentId: envSelect.selectedEnvironmentId,
        selectedTests: pairs,
      })
      setIsOpen(false)
      setRegressionToRun(null)
      envSelect.selectEnvironment(null)
      setRegressionSuites([])
      navigate(`/executions/${execution.id}`)
    } catch (err) {
      /* v8 ignore next - COV-BRANCH-029: defensive non-Error fallback */
      setError(err instanceof Error ? err.message : 'Failed to start execution')
    }
  }, [regressionToRun, envSelect, regressionSuites, navigate, setError])

  const duplicateTests = useMemo(() => {
    // The badge reflects what will actually run. A test is "duplicated"
    // only when the user currently has it SELECTED in 2+ suites of the
    // regression. Unchecking instances until only 0 or 1 remain must make
    // the badge disappear - single-run tests are not duplicates at run time.
    const occurrences = new Map<string, string[]>()
    for (const suite of regressionSuites) {
      for (const test of suite.tests) {
        if (!test.selected) continue
        const existing = occurrences.get(test.id) ?? []
        existing.push(suite.id)
        occurrences.set(test.id, existing)
      }
    }
    const result: Record<string, string[]> = {}
    for (const [testId, suiteIds] of occurrences) {
      if (suiteIds.length >= 2) result[testId] = suiteIds
    }
    return result
  }, [regressionSuites])

  return {
    isOpen,
    setIsOpen,
    regressionToRun,
    regressionSuites,
    environments: envSelect.environments,
    recentEnvironments: envSelect.recentEnvironments,
    selectedEnvironmentId: envSelect.selectedEnvironmentId,
    duplicateTests,
    openForRegression,
    close,
    togglePair,
    toggleSuite,
    toggleAll,
    toggleSuiteExpand,
    selectEnvironment: envSelect.selectEnvironment,
    submit,
  }
}
