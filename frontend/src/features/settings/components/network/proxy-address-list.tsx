/**
 * The proxy address list (REQ-4.7.14, NET-10): rows of an Exact / Regex choice, an address
 * and a remove control, with "Add" under the last row. Every change reports the whole list.
 */

import { useId } from 'react'
import { Input } from '@/components/ui/input'
import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/components/shared/segmented-control'
import { useStableKeys } from '@/components/shared/variable-bodies/use-stable-keys'
import type { ProxyEntry } from '@/features/settings/api/proxy'
import { NetworkAddButton } from '@/features/settings/components/network/network-add-button'
import { NetworkRemoveButton } from '@/features/settings/components/network/network-remove-button'
import { SettingsRowGroup } from '@/features/settings/components/settings-row-group'

export interface ProxyAddressListProps {
  entries: ProxyEntry[]
  onChange: (entries: ProxyEntry[]) => void
  disabled?: boolean
  /** A message per entry number, counted from 1, shown under that entry's address. */
  problems?: Record<number, string>
}

const MAX_ENTRIES = 100

const KIND_OPTIONS: ReadonlyArray<SegmentedControlOption<ProxyEntry['kind']>> = [
  { value: 'exact', label: 'Exact' },
  { value: 'regex', label: 'Regex' },
]

interface AddressRowProps {
  /** The entry number, counted from 1. */
  row: number
  entry: ProxyEntry
  message?: string
  disabled: boolean
  onChange: (entry: ProxyEntry) => void
  onRemove: () => void
}

function AddressRow({
  row,
  entry,
  message,
  disabled,
  onChange,
  onRemove,
}: Readonly<AddressRowProps>) {
  const messageId = useId()
  return (
    // One grid for every row, so a message coming or going never moves the address or its focus.
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2">
      <SegmentedControl
        aria-label={`Entry ${row} type`}
        options={KIND_OPTIONS}
        value={entry.kind}
        disabled={disabled}
        onChange={(kind) => onChange({ ...entry, kind })}
      />
      <Input
        aria-label={`Entry ${row} address`}
        aria-invalid={message ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        name={`proxy-entry-${row}`}
        autoComplete="off"
        spellCheck={false}
        className="font-mono aria-invalid:border-error"
        value={entry.address}
        disabled={disabled}
        onChange={(event) => onChange({ ...entry, address: event.target.value })}
      />
      <NetworkRemoveButton
        aria-label={`Remove entry ${row}`}
        disabled={disabled}
        onClick={onRemove}
      />
      <SettingsRowGroup.Message id={messageId} message={message} className="col-start-2" />
    </div>
  )
}

export function ProxyAddressList({
  entries,
  onChange,
  disabled = false,
  problems,
}: Readonly<ProxyAddressListProps>) {
  const keys = useStableKeys(entries.length)
  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry, index) => (
        <AddressRow
          key={keys[index]}
          row={index + 1}
          entry={entry}
          message={problems?.[index + 1]}
          disabled={disabled}
          onChange={(next) => onChange(entries.map((item, at) => (at === index ? next : item)))}
          onRemove={() => onChange(entries.filter((_, at) => at !== index))}
        />
      ))}
      <div className="flex">
        <NetworkAddButton
          label="Add"
          aria-label="Add entry"
          disabled={disabled || entries.length >= MAX_ENTRIES}
          onClick={() => onChange([...entries, { kind: 'exact', address: '' }])}
        />
      </div>
    </div>
  )
}
