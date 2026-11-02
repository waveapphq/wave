/**
 * Hook for suite picker confirmation dialog state.
 *
 * Manages the add/remove confirmation flow:
 * select suite -> show dialog -> confirm/cancel.
 * Used by both TestsBulkActions and TestsRowActions.
 */

import { useState, useMemo } from 'react'

interface SuiteOption {
  id: string
  name: string
}

export function useSuiteConfirmState(suites: SuiteOption[]) {
  const [addConfirmOpen, setAddConfirmOpen] = useState(false)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)
  const [pendingSuiteId, setPendingSuiteId] = useState<string | null>(null)

  const pendingSuiteName = useMemo(() => {
    if (!pendingSuiteId) return ''
    return suites.find(s => s.id === pendingSuiteId)?.name ?? ''
  }, [pendingSuiteId, suites])

  const handleAddSelect = (suiteId: string) => {
    setPendingSuiteId(suiteId)
    setAddConfirmOpen(true)
  }

  const handleRemoveSelect = (suiteId: string) => {
    setPendingSuiteId(suiteId)
    setRemoveConfirmOpen(true)
  }

  const resetPending = () => {
    setPendingSuiteId(null)
  }

  const handleAddCancel = () => {
    setPendingSuiteId(null)
    setAddConfirmOpen(false)
  }

  const handleRemoveCancel = () => {
    setPendingSuiteId(null)
    setRemoveConfirmOpen(false)
  }

  return {
    addConfirmOpen,
    removeConfirmOpen,
    pendingSuiteId,
    pendingSuiteName,
    handleAddSelect,
    handleRemoveSelect,
    handleAddCancel,
    handleRemoveCancel,
    resetPending,
  }
}
