import type { ReactNode } from 'react'
import { RunDialog, type Environment } from '@/components/shared/dialogs/run-dialog'

interface RegressionRunDialogHook {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  regressionToRun: { id: string; name: string } | null
  regressionSuites: Array<{ id: string; name: string; expanded: boolean; tests: Array<{ id: string; name: string; selected: boolean }> }>
  environments: Environment[]
  recentEnvironments: Environment[]
  selectedEnvironmentId: string | null
  duplicateTests: Record<string, string[]>
  togglePair: (suiteId: string, testId: string, selected: boolean) => void
  toggleSuite: (suiteId: string, selected: boolean) => void
  toggleAll: (selected: boolean) => void
  toggleSuiteExpand: (suiteId: string) => void
  selectEnvironment: (envId: string | null) => void
  submit: () => void
  close: () => void
}

export function RegressionRunDialogView({
  hook,
}: Readonly<{
  hook: RegressionRunDialogHook
}>): ReactNode {
  return (
    <RunDialog
      open={hook.isOpen}
      onOpenChange={hook.setIsOpen}
      entityType="regression"
      entityName={hook.regressionToRun?.name ?? ''}
      entityId={hook.regressionToRun?.id ?? ''}
      regressionSuites={{ suites: hook.regressionSuites }}
      onRegressionTestSelectionChange={hook.togglePair}
      onSuiteSelectionChange={hook.toggleSuite}
      onSelectAll={hook.toggleAll}
      onSuiteExpandToggle={hook.toggleSuiteExpand}
      duplicateTests={hook.duplicateTests}
      environments={hook.environments}
      recentEnvironments={hook.recentEnvironments}
      selectedEnvironmentId={hook.selectedEnvironmentId}
      onEnvironmentSelect={hook.selectEnvironment}
      onRun={hook.submit}
      onCancel={hook.close}
    />
  )
}
