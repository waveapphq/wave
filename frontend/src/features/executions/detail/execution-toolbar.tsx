/**
 * ExecutionToolbar
 *
 * State-switched action bar for the Execution Detail view.
 *
 * Running state:
 *   - Stop (split: Immediate | With Finalization) + confirmation dialog
 *   - View Running -> navigates to /workbench
 *   - Export       -> opens the shared export dialog (mounted by the page)
 *
 * Terminal state:
 *   - Re-run -> opens RunDialog prepopulated with original env + subset.
 *               For suites/regressions the RunDialog loads the same tests/
 *               suites structure the entity currently has, and pre-checks
 *               exactly the tests from the original execution's
 *               `selected_tests`. User can customize before confirming.
 *   - Export
 *   - Delete -> confirmation dialog; on confirm calls deleteExecution
 */

import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Eye, FileBarChart, Square, RotateCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { SplitButton } from '@/components/shared/split-button'
import { RunDialog } from '@/components/shared/dialogs/run-dialog'
import { useEnvironments } from '@/hooks/use-environments'
import { useFailureToast } from '@/hooks/use-failure-toast'
import {
  startExecution,
  stopExecution,
  deleteExecution,
} from '@/features/executions/api/executions'
import { StopConfirmationDialog, type StopMode } from '@/components/shared/dialogs/stop-confirmation-dialog'
import { isTerminalStatus } from '@/components/shared/tables/table-utils'
import { DeleteConfirmationDialog } from './delete-confirmation-dialog'
import { useSuiteRunDialog } from '@/features/suites/hooks/use-suite-run-dialog'
import { SuiteRunDialogView } from '@/features/suites/components/suite-run-dialog-view'
import { useRegressionRunDialog } from '@/features/regressions/hooks/use-regression-run-dialog'
import { RegressionRunDialogView } from '@/features/regressions/components/regression-run-dialog-view'
import { ConditionalTooltip } from '@/components/ui/tooltip'

export interface ExecutionToolbarExecution {
  id: string
  name: string
  entity_type: string
  entity_id: string
  environment_id: string
  status: string
  /**
   * For suite/regression executions, the subset the original run used.
   * Undefined when the original run used the full entity. Drives Re-run
   * dialog pre-population so the user starts from the same selection.
   */
  selected_tests?: string[] | Array<{ suite_id: string; test_id: string }>
  /** Regression duplicate-test map, used for the RunDialog's duplicate badge. */
  duplicate_tests?: Record<string, string[]>
}

export interface ExecutionToolbarProps {
  execution: ExecutionToolbarExecution
  onStopped?: () => void
  onDeleted?: () => void
  onExport?: () => void
}

export function ExecutionToolbar({
  execution,
  onStopped,
  onDeleted,
  onExport,
}: Readonly<ExecutionToolbarProps>) {
  const navigate = useNavigate()
  const [stopDialogOpen, setStopDialogOpen] = useState(false)
  const [stopMode, setStopMode] = useState<StopMode>('immediate')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  // Test re-run stays as a simple env-only flow. Suite/regression re-run
  // uses the shared hooks so it loads the subset panel, renders duplicate
  // badges, and pre-populates from the original execution.
  const [testRerunOpen, setTestRerunOpen] = useState(false)
  // Renders only under a loaded execution, so the surface's primary is settled.
  const { environments: fetchedEnvironments } = useEnvironments()
  const [selectedEnvId, setSelectedEnvId] = useState<string>(execution.environment_id)
  const environments = useMemo(
    () => fetchedEnvironments.length > 0
      ? fetchedEnvironments.map((e) => ({ id: e.id, name: e.name }))
      : [{ id: execution.environment_id, name: execution.environment_id }],
    [fetchedEnvironments, execution.environment_id]
  )

  // This toolbar has no page-level error region, so the Re-run dialog's
  // failures are reported where the user is looking.
  const { error: toastError } = useToast()
  const suiteRunDialog = useSuiteRunDialog({ setError: toastError, environments })
  const regressionRunDialog = useRegressionRunDialog({ setError: toastError, environments })

  const handleOpenStop = (mode: StopMode) => {
    setStopMode(mode)
    setStopDialogOpen(true)
  }

  // Every confirmation dialog closes before its write lands, so a rejection
  // has nowhere to show but a toast.
  const stopFailure = useFailureToast('Stop Failed')
  const deleteFailure = useFailureToast('Delete Failed')
  const rerunFailure = useFailureToast('Re-run Failed')

  const handleConfirmStop = (mode: StopMode) => {
    setStopDialogOpen(false)
    stopExecution(execution.id, { mode })
      .then(() => {
        onStopped?.()
      })
      .catch(stopFailure.report)
  }

  const handleExport = () => {
    onExport?.()
  }

  const handleDelete = () => {
    setDeleteDialogOpen(false)
    deleteExecution(execution.id)
      .then(() => {
        onDeleted?.()
      })
      .catch(deleteFailure.report)
  }

  const handleOpenRerun = async () => {
    /* v8 ignore start - COV-V8-003: V8 loses coverage inside async event handler branches */
    if (execution.entity_type === 'suite') {
      const seedIds = Array.isArray(execution.selected_tests)
        ? (execution.selected_tests as string[])
        : null
      suiteRunDialog.openForSuite(execution.entity_id, execution.name, seedIds)
      suiteRunDialog.selectEnvironment(execution.environment_id)
    } else if (execution.entity_type === 'regression') {
      const seedPairs = Array.isArray(execution.selected_tests)
        ? (execution.selected_tests as Array<{ suite_id: string; test_id: string }>).map((p) => ({
            suiteId: p.suite_id,
            testId: p.test_id,
          }))
        : null
      regressionRunDialog.openForRegression(
        execution.entity_id,
        execution.name,
        seedPairs,
      )
      regressionRunDialog.selectEnvironment(execution.environment_id)
    } else {
      setSelectedEnvId(execution.environment_id)
      setTestRerunOpen(true)
    }
    /* v8 ignore stop */
  }

  const handleTestRerun = () => {
    setTestRerunOpen(false)
    startExecution({
      type: execution.entity_type,
      id: execution.entity_id,
      environmentId: selectedEnvId,
    })
      .then(() => {
        // Test runs stream live on the Workbench canvas.
        navigate('/workbench')
      })
      .catch(rerunFailure.report)
  }

  const terminal = isTerminalStatus(execution.status)

  return (
    <div className="flex items-center gap-2">
      {!terminal && (
        <>
          <SplitButton
            label="Stop"
            icon={<Square className="h-4 w-4" />}
            variant="destructive"
            onPrimaryClick={() => handleOpenStop('immediate')}
            options={[
              {
                id: 'immediate',
                label: 'Immediate Stop',
                onClick: () => handleOpenStop('immediate'),
              },
              {
                id: 'finalize',
                label: 'Stop with Finalization',
                onClick: () => handleOpenStop('finalize'),
              },
            ]}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => { navigate('/workbench') }}
          >
            <Eye className="mr-1.5 h-4 w-4" />
            View Running
          </Button>
          <ConditionalTooltip content="Available when the execution finishes" disabled>
            <span className="inline-flex">
              <Button variant="outline" size="sm" data-testid="report-button" disabled>
                <FileBarChart className="mr-1.5 h-4 w-4" />
                Report
              </Button>
            </span>
          </ConditionalTooltip>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-1.5 h-4 w-4" />
            Export
          </Button>
        </>
      )}

      {terminal && (
        <>
          <Button
            variant="default"
            size="sm"
            onClick={() => { handleOpenRerun().catch(rerunFailure.report) }}
          >
            <RotateCw className="mr-1.5 h-4 w-4" />
            Re-run
          </Button>
          <Button
            variant="outline"
            size="sm"
            data-testid="report-button"
            onClick={() => { navigate(`/reports/${execution.id}`) }}
          >
            <FileBarChart className="mr-1.5 h-4 w-4" />
            Report
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-1.5 h-4 w-4" />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Delete
          </Button>
        </>
      )}

      <StopConfirmationDialog
        open={stopDialogOpen}
        mode={stopMode}
        onCancel={() => setStopDialogOpen(false)}
        onConfirm={handleConfirmStop}
      />

      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        executionName={execution.name}
        onCancel={() => setDeleteDialogOpen(false)}
        onConfirm={handleDelete}
      />

      {testRerunOpen && execution.entity_type === 'test' && (
        <RunDialog
          open={testRerunOpen}
          onOpenChange={setTestRerunOpen}
          entityType="test"
          entityName={execution.name}
          entityId={execution.entity_id}
          environments={environments}
          recentEnvironments={[]}
          selectedEnvironmentId={selectedEnvId}
          onEnvironmentSelect={(id) => setSelectedEnvId(id)}
          onRun={handleTestRerun}
          onCancel={() => setTestRerunOpen(false)}
        />
      )}

      {execution.entity_type === 'suite' && (
        <SuiteRunDialogView hook={suiteRunDialog} />
      )}

      {execution.entity_type === 'regression' && (
        <RegressionRunDialogView hook={regressionRunDialog} />
      )}
    </div>
  )
}
