/**
 * Settings section header: a Title Case `h2` with optional Cancel and Save, both disabled until a change (NET-1).
 */

import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface SettingsSectionHeaderProps {
  title: string
  dirty?: boolean
  saving?: boolean
  /** Disables Save alone, for a staged value that cannot be saved. */
  saveDisabled?: boolean
  onCancel?: () => void
  onSave?: () => void
}

export function SettingsSectionHeader({
  title,
  dirty = false,
  saving = false,
  saveDisabled = false,
  onCancel,
  onSave,
}: Readonly<SettingsSectionHeaderProps>) {
  const showActions = onCancel !== undefined && onSave !== undefined
  return (
    <div className="flex items-center justify-between gap-6">
      <h2 className="min-w-0 text-lg font-semibold">{title}</h2>
      {showActions && (
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" disabled={saving || !dirty} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!dirty || saveDisabled}
            loading={saving}
            leftIcon={<Save className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={onSave}
          >
            Save
          </Button>
        </div>
      )}
    </div>
  )
}
