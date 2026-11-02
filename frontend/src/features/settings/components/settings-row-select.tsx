/**
 * Select of a settings row: the row group hands its label and help ids to the control,
 * and a Select root has no element, so the trigger takes them.
 */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface SettingsRowSelectOption<T extends string> {
  value: T
  label: string
}

export interface SettingsRowSelectProps<T extends string> {
  value: T
  options: ReadonlyArray<SettingsRowSelectOption<T>>
  disabled: boolean
  onChange: (value: T) => void
  className: string
  'data-testid': string
  id?: string
  'aria-describedby'?: string
  translate?: 'no'
}

export function SettingsRowSelect<T extends string>({
  value,
  options,
  disabled,
  onChange,
  className,
  'data-testid': testId,
  id,
  'aria-describedby': describedBy,
  translate,
}: Readonly<SettingsRowSelectProps<T>>) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
      <SelectTrigger
        id={id}
        data-testid={testId}
        aria-describedby={describedBy}
        translate={translate}
        className={className}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent translate={translate}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
