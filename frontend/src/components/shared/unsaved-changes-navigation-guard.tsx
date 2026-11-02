/**
 * Asks Cancel, Discard or Save before an in-app navigation leaves a page with unsaved changes (NET-1).
 */

import { useEffect, useState } from 'react'
import { useBlocker, type Blocker } from 'react-router-dom'

import { UnsavedChangesDialog } from '@/components/shared/child-editors/unsaved-changes-dialog'

export interface UnsavedChangesNavigationGuardProps {
  dirty: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  /** The page is asking its own confirmation for a save; the prompt waits behind it. */
  confirming?: boolean
}

type BlockedNavigation = Extract<Blocker, { state: 'blocked' }>

const TEST_IDS = {
  dialog: 'leave-unsaved-dialog',
  keepEditing: 'leave-unsaved-cancel',
  close: 'leave-unsaved-discard',
  save: 'leave-unsaved-save',
}

export function UnsavedChangesNavigationGuard(props: Readonly<UnsavedChangesNavigationGuardProps>) {
  const { dirty } = props
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  )
  if (blocker.state !== 'blocked') return null
  return <LeavePrompt {...props} navigation={blocker} />
}

interface LeavePromptProps extends UnsavedChangesNavigationGuardProps {
  navigation: BlockedNavigation
}

function LeavePrompt({
  dirty,
  saving,
  onSave,
  onDiscard,
  confirming = false,
  navigation,
}: Readonly<LeavePromptProps>) {
  const [answer, setAnswer] = useState<'save' | 'discard' | undefined>()

  // Once nothing is pending, a clean page leaves and a dirty one stays if Save was asked here; Discard has already left.
  useEffect(() => {
    if (answer === 'discard' || saving || confirming) return
    if (!dirty) navigation.proceed()
    else if (answer === 'save') navigation.reset()
  }, [answer, saving, confirming, dirty, navigation])

  if (confirming) return null

  return (
    <UnsavedChangesDialog
      open
      onKeepEditing={() => navigation.reset()}
      onClose={() => {
        setAnswer('discard')
        onDiscard()
        navigation.proceed()
      }}
      onSave={() => {
        setAnswer('save')
        onSave()
      }}
      busy={saving}
      testIds={TEST_IDS}
      keepEditingLabel="Cancel"
      closeLabel="Discard"
    />
  )
}
