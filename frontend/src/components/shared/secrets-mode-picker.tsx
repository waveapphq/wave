/**
 * Secrets Mode Picker Component
 *
 * Shared "Secret values" radio group (Mask / Keep encrypted / Decrypt) for
 * secret-carrying export surfaces, with an amber warning when Decrypt is chosen.
 */

import { useId } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { ExportSecretsMode } from '@/types/import-export'

const DEFAULT_DESCRIPTIONS: Record<ExportSecretsMode, string> = {
  mask: 'Replace secret values with ******** - safe to share',
  encrypted: 'Values stay sealed - only this WAVE instance can read them',
  plaintext: 'Write real values in plain text - for migrating to another instance',
}

const DEFAULT_WARNING =
  'Secrets will be written in plain text. Handle the exported file securely.'

const OPTIONS: Array<{ mode: ExportSecretsMode; label: string }> = [
  { mode: 'mask', label: 'Mask' },
  { mode: 'encrypted', label: 'Keep encrypted' },
  { mode: 'plaintext', label: 'Decrypt' },
]

export interface SecretsModePickerProps {
  value: ExportSecretsMode
  onChange: (mode: ExportSecretsMode) => void
  warningText?: string
  descriptions?: Partial<Record<ExportSecretsMode, string>>
  disabled?: boolean
}

export function SecretsModePicker({
  value,
  onChange,
  warningText = DEFAULT_WARNING,
  descriptions,
  disabled = false,
}: Readonly<SecretsModePickerProps>) {
  const pickerId = useId()
  const groupLabelId = `${pickerId}-label`
  return (
    <div className="grid gap-2">
      <Label id={groupLabelId}>Secret values</Label>
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as ExportSecretsMode)}
        disabled={disabled}
        aria-labelledby={groupLabelId}
        data-testid="secrets-mode-picker"
      >
        {OPTIONS.map(({ mode, label }) => {
          const radioId = `${pickerId}-${mode}`
          return (
            <div key={mode} className="flex items-start space-x-2">
              <RadioGroupItem
                value={mode}
                id={radioId}
                data-testid={`secrets-mode-${mode}`}
                className="mt-0.5"
              />
              <div>
                <Label htmlFor={radioId} className="cursor-pointer font-medium">
                  {label}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {descriptions?.[mode] ?? DEFAULT_DESCRIPTIONS[mode]}
                </p>
              </div>
            </div>
          )
        })}
      </RadioGroup>
      {value === 'plaintext' && (
        <div
          aria-live="polite"
          className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-left text-sm"
          data-testid="secrets-plaintext-warning"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>{warningText}</p>
        </div>
      )}
    </div>
  )
}
