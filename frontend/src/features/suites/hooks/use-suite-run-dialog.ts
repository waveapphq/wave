/**
 * useSuiteRunDialog - shared state for the suite Run dialog.
 *
 * Used by the suite list container AND the suite detail page so both
 * surfaces open the same modal, own the same state, and follow the same
 * submit -> startExecution -> navigate flow.
 */

import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchSuiteTests } from '@/features/suites/api/crud'
import { startExecution } from '@/features/executions/api/executions'
import { useEnvironmentSelect } from '@/hooks/use-environment-select'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'

interface RunTestRow {
  id: string
  name: string
  selected: boolean
}

interface UseSuiteRunDialogDeps {
  setError: (message: string) => void
  /** The surface's gated environments list; the dialog runs no environments read of its own. */
  environments: Array<{ id: string; name: string }>
}

export function useSuiteRunDialog({ setError, environments }: Readonly<UseSuiteRunDialogDeps>) {
  const navigate = useNavigate()
  const { error: toastError } = useToast()

  const [isOpen, setIsOpen] = useState(false)
  const [suiteToRun, setSuiteToRun] = useState<{ id: string; name: string } | null>(null)
  const [suiteTests, setSuiteTests] = useState<RunTestRow[]>([])
  const envSelect = useEnvironmentSelect(environments)

  // The row actions that open this dialog cannot await, so the read carries its
  // own reporting catch and there is no outcome for a caller to wait on.
  const openForSuite = useCallback(
    (
      suiteId: string,
      suiteName: string,
      seedSelectedTestIds?: string[] | null,
    ): void => {
      envSelect.selectEnvironment(null)
      fetchSuiteTests(suiteId)
        .then((data) => {
          const seedSet = seedSelectedTestIds ? new Set(seedSelectedTestIds) : null
          const rows: RunTestRow[] = data.map((t) => ({
            id: t.id,
            name: t.name,
            selected: seedSet ? seedSet.has(t.id) : true,
          }))
          setSuiteToRun({ id: suiteId, name: suiteName })
          setSuiteTests(rows)
          setIsOpen(true)
        })
        .catch((err: unknown) => {
          // A dialog listing nothing reads as "this suite has no tests".
          toastError(toFailureDetail(err).message, 'Could Not Load Suite Tests')
        })
    },
    [envSelect, toastError],
  )

  const close = useCallback(() => {
    setIsOpen(false)
    setSuiteToRun(null)
    envSelect.selectEnvironment(null)
    setSuiteTests([])
  }, [envSelect])

  const toggleTest = useCallback((testId: string, selected: boolean) => {
    setSuiteTests((prev) => prev.map((t) => (t.id === testId ? { ...t, selected } : t)))
  }, [])

  const toggleAllTests = useCallback((selected: boolean) => {
    setSuiteTests((prev) => prev.map((t) => ({ ...t, selected })))
  }, [])

  const submit = useCallback(async () => {
    if (!suiteToRun || !envSelect.selectedEnvironmentId) return
    try {
      const selectedIds = suiteTests.filter((t) => t.selected).map((t) => t.id)
      const execution = await startExecution({
        type: 'suite',
        id: suiteToRun.id,
        environmentId: envSelect.selectedEnvironmentId,
        selectedTests: selectedIds,
      })
      setIsOpen(false)
      setSuiteToRun(null)
      envSelect.selectEnvironment(null)
      setSuiteTests([])
      navigate(`/executions/${execution.id}`)
    } catch (err) {
      /* v8 ignore next - COV-BRANCH-029: defensive non-Error fallback */
      setError(err instanceof Error ? err.message : 'Failed to start execution')
    }
  }, [suiteToRun, envSelect, suiteTests, navigate, setError])

  const selectAllValue = useMemo(() => suiteTests.every((t) => t.selected), [suiteTests])

  return {
    isOpen,
    setIsOpen,
    suiteToRun,
    suiteTests,
    environments: envSelect.environments,
    recentEnvironments: envSelect.recentEnvironments,
    selectedEnvironmentId: envSelect.selectedEnvironmentId,
    selectAllValue,
    openForSuite,
    close,
    toggleTest,
    toggleAllTests,
    selectEnvironment: envSelect.selectEnvironment,
    submit,
  }
}
