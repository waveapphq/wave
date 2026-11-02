/**
 * ModeRadioSection - a titled radio group with an optional trailing checkbox.
 */

import { useId } from 'react'

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

export interface ModeRadioOption {
  value: string
  label: string
  description: string
}

export interface ModeRadioCheckbox {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}

interface ModeRadioSectionProps {
  title: string
  value: string
  options: ModeRadioOption[]
  onValueChange: (value: string) => void
  /** Stable radio id stem; falls back to a per-instance generated id. */
  idPrefix?: string
  checkbox?: ModeRadioCheckbox
}

export function ModeRadioSection({
  title,
  value,
  options,
  onValueChange,
  idPrefix,
  checkbox,
}: Readonly<ModeRadioSectionProps>) {
  const generatedId = useId()
  const stem = idPrefix ?? generatedId
  const headingId = `${stem}-heading`

  return (
    <div className="space-y-3 mt-6">
      <h3
        id={headingId}
        className="text-sm font-medium text-muted-foreground uppercase tracking-wide"
      >
        {title}
      </h3>
      <RadioGroup
        value={value}
        onValueChange={onValueChange}
        aria-labelledby={headingId}
        className="space-y-2"
      >
        {options.map((option) => (
          <div key={option.value} className="flex items-start gap-2">
            <RadioGroupItem
              value={option.value}
              id={`${stem}-${option.value}`}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor={`${stem}-${option.value}`} className="cursor-pointer font-medium">
                {option.label}
              </Label>
              <p className="text-xs text-muted-foreground">{option.description}</p>
            </div>
          </div>
        ))}
      </RadioGroup>
      {checkbox && (
        <div className="flex items-start gap-2 pt-3 border-t border-border mt-3">
          <Checkbox
            id={checkbox.id}
            checked={checkbox.checked}
            onCheckedChange={(checked) => checkbox.onChange(checked === true)}
            className="mt-0.5"
          />
          <div>
            <Label htmlFor={checkbox.id} className="cursor-pointer font-medium">
              {checkbox.label}
            </Label>
            <p className="text-xs text-muted-foreground">{checkbox.description}</p>
          </div>
        </div>
      )}
    </div>
  )
}
