import type { ReactNode } from 'react'
import { RunDialog, type Environment } from '@/components/shared/dialogs/run-dialog'

interface SuiteRunDialogHook {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  suiteToRun: { id: string; name: string } | null
  suiteTests: Array<{ id: string; name: string; selected: boolean }>
  environments: Environment[]
  recentEnvironments: Environment[]
  selectedEnvironmentId: string | null
  toggleTest: (testId: string, selected: boolean) => void
  toggleAllTests: (selected: boolean) => void
  selectEnvironment: (envId: string | null) => void
  submit: () => void
  close: () => void
}

export function SuiteRunDialogView({
  hook,
}: Readonly<{
  hook: SuiteRunDialogHook
}>): ReactNode {
  return (
    <RunDialog
      open={hook.isOpen}
      onOpenChange={hook.setIsOpen}
      entityType="suite"
      entityName={hook.suiteToRun?.name ?? ''}
      entityId={hook.suiteToRun?.id ?? ''}
      suiteTests={{ tests: hook.suiteTests }}
      onTestSelectionChange={hook.toggleTest}
      onSelectAll={hook.toggleAllTests}
      environments={hook.environments}
      recentEnvironments={hook.recentEnvironments}
      selectedEnvironmentId={hook.selectedEnvironmentId}
      onEnvironmentSelect={hook.selectEnvironment}
      onRun={hook.submit}
      onCancel={hook.close}
    />
  )
}
