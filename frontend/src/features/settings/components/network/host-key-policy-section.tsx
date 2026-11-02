/**
 * Host Key Policy rows of the SSH Hosts page (NET-2): the Lock switch and the default block action.
 */

import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingsRowGroup } from '@/features/settings/components/settings-row-group'
import type { HostKeyAction, HostKeyPolicy } from '@/features/settings/api/ssh-hosts'

const LOCK_LABEL = 'Lock trusted hosts'
const LOCK_HELP = 'No block can add hosts. New and existing SSH blocks using "Accept New" act as "Strict".'
const ACTION_LABEL = 'Default block action'
const ACTION_HELP =
  'New blocks are configured in this mode by default. Existing blocks keep their current setting.'

const ACTION_OPTIONS: ReadonlyArray<{ value: HostKeyAction; label: string }> = [
  { value: 'strict', label: 'Strict' },
  { value: 'accept-new', label: 'Accept New' },
  { value: 'disabled', label: 'Disabled' },
]

export interface HostKeyPolicySectionProps {
  policy: HostKeyPolicy
  onChange: (next: HostKeyPolicy) => void
  disabled?: boolean
}

interface DefaultActionSelectProps {
  value: HostKeyAction
  locked: boolean
  disabled: boolean
  onChange: (value: HostKeyAction) => void
  id?: string
  'aria-describedby'?: string
}

/** The row group hands its label and help ids to the control; a Select root has no element, so the trigger takes them. */
function DefaultActionSelect({
  value,
  locked,
  disabled,
  onChange,
  id,
  'aria-describedby': describedBy,
}: Readonly<DefaultActionSelectProps>) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as HostKeyAction)} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ACTION_LABEL} aria-describedby={describedBy} className="w-52">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ACTION_OPTIONS.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={locked && option.value === 'accept-new'}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function HostKeyPolicySection({
  policy,
  onChange,
  disabled = false,
}: Readonly<HostKeyPolicySectionProps>) {
  const handleLockChange = (locked: boolean) => {
    // Lock never keeps Accept New as the default (NET-2).
    const action =
      locked && policy.default_block_action === 'accept-new' ? 'strict' : policy.default_block_action
    onChange({ lock_trusted_hosts: locked, default_block_action: action })
  }

  const handleActionChange = (action: HostKeyAction) => {
    onChange({ lock_trusted_hosts: policy.lock_trusted_hosts, default_block_action: action })
  }

  return (
    <SettingsRowGroup>
      <SettingsRowGroup.Row
        label={LOCK_LABEL}
        help={LOCK_HELP}
        control={
          <Switch
            aria-label={LOCK_LABEL}
            checked={policy.lock_trusted_hosts}
            disabled={disabled}
            onCheckedChange={handleLockChange}
          />
        }
      />
      <SettingsRowGroup.Row
        label={ACTION_LABEL}
        help={ACTION_HELP}
        control={
          <DefaultActionSelect
            value={policy.default_block_action}
            locked={policy.lock_trusted_hosts}
            disabled={disabled}
            onChange={handleActionChange}
          />
        }
      />
    </SettingsRowGroup>
  )
}
