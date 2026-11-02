/**
 * Format Picker Component
 *
 * Reusable YAML/JSON format radio group for export dialogs.
 */

import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

export type ExportFormat = 'yaml' | 'json'

export interface FormatPickerProps {
  value: ExportFormat
  onChange: (format: ExportFormat) => void
}

export function FormatPicker({ value, onChange }: Readonly<FormatPickerProps>) {
  return (
    <div className="grid gap-2">
      <Label>Format</Label>
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as ExportFormat)}
        data-testid="format-picker"
      >
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="yaml" id="format-yaml" data-testid="format-yaml" />
          <Label htmlFor="format-yaml">YAML</Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="json" id="format-json" data-testid="format-json" />
          <Label htmlFor="format-json">JSON</Label>
        </div>
      </RadioGroup>
    </div>
  )
}
