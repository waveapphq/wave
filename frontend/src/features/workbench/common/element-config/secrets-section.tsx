/** The block "Secrets" collapsible: tri-state run-output control plus a "Mask specific fields" list (disabled when revealing). */

import { useState } from 'react'
import { AlertTriangle, ChevronRight, Info } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { type SecretMaskField } from '@/features/workbench/lib/node-parameters/types'
import { type SecretMaskingSetting } from '@/features/workbench/lib/node-parameters/secret-reveal'

interface SecretsSectionProps {
  secretMasking: SecretMaskingSetting
  onSecretMaskingChange: (setting: SecretMaskingSetting) => void
  /** Effective run-output reveal = resolve(secretMasking, system run_output). */
  effectiveRevealing: boolean
  fields: SecretMaskField[]
  /** Field keys the user REVEALED for this block; all others stay masked. */
  unmaskedFields: string[]
  onUnmaskedFieldsChange: (fields: string[]) => void
}

const REVEAL_OPTIONS: ReadonlyArray<{
  value: SecretMaskingSetting
  label: string
  description: string
}> = [
  {
    value: 'system',
    label: 'Use system setting',
    description: 'Follow the system run-output masking',
  },
  {
    value: 'reveal',
    label: 'Always reveal',
    description: "Show this block's secrets in logs & reports, regardless of system",
  },
  {
    value: 'mask',
    label: 'Always mask',
    description: 'Keep this block masked, regardless of system',
  },
]

const OPTION_LABEL = Object.fromEntries(
  REVEAL_OPTIONS.map((option) => [option.value, option.label]),
) as Record<SecretMaskingSetting, string>

const SYSTEM_MASKED_HELPER = 'Follows the system setting. Currently: masked.'
const SYSTEM_REVEALING_HELPER = 'Follows the system setting. Currently: revealing.'
const ALWAYS_MASK_HELPER = 'Kept masked regardless of the system setting.'
const DISABLED_FIELDS_HINT = 'Run output is revealed - per-field masking has no effect.'

function RevealHelper({
  secretMasking,
  effectiveRevealing,
}: Readonly<{ secretMasking: SecretMaskingSetting; effectiveRevealing: boolean }>) {
  if (secretMasking === 'reveal') {
    return (
      <div
        data-testid="secret-reveal-warning"
        className={cn(
          'flex items-start gap-2 rounded-md border p-2.5 text-xs',
          'border-amber-300 bg-amber-50 text-amber-700',
          'dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300',
        )}
      >
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Secrets always appear in cleartext in this block&apos;s run logs and reports, even if the
          system masks.
        </span>
      </div>
    )
  }
  if (secretMasking === 'mask') {
    return <p className="text-xs text-muted-foreground">{ALWAYS_MASK_HELPER}</p>
  }
  const text = effectiveRevealing ? SYSTEM_REVEALING_HELPER : SYSTEM_MASKED_HELPER
  return <p className="text-xs text-muted-foreground">{text}</p>
}

export function SecretsSection({
  secretMasking,
  onSecretMaskingChange,
  effectiveRevealing,
  fields,
  unmaskedFields,
  onUnmaskedFieldsChange,
}: Readonly<SecretsSectionProps>) {
  const [open, setOpen] = useState(false)

  const toggleField = (key: string, checked: boolean | 'indeterminate') => {
    if (checked === true) {
      // Re-mask: drop the key from the revealed set.
      onUnmaskedFieldsChange(unmaskedFields.filter((k) => k !== key))
    } else {
      // Reveal: add the key to the revealed set.
      onUnmaskedFieldsChange([...unmaskedFields, key])
    }
  }

  const selectedLabel = OPTION_LABEL[secretMasking]

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-[10px] border border-border bg-card"
    >
      <CollapsibleTrigger
        data-testid="secrets-section-trigger"
        className={cn(
          'flex w-full items-center gap-1.5 bg-muted/30 p-2 text-xs font-medium text-muted-foreground cursor-pointer select-none',
          open && 'border-b border-border',
        )}
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')}
        />
        <span className="truncate">Secrets</span>
        {effectiveRevealing && (
          <span
            data-testid="secret-reveal-pill"
            className="ml-auto inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
            <span>Revealing</span>
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Masking in run logs &amp; reports</p>
            <p className="text-xs text-muted-foreground">How this block&apos;s secrets appear at run time</p>
          </div>
          <Select
            value={secretMasking}
            onValueChange={(value) => onSecretMaskingChange(value as SecretMaskingSetting)}
          >
            <SelectTrigger
              data-testid="secret-reveal-select"
              aria-label="Secret masking in run output"
              className={cn(
                'w-48 shrink-0',
                secretMasking === 'reveal' &&
                  'border-amber-500/60 text-amber-700 dark:text-amber-300',
              )}
            >
              <SelectValue>{selectedLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {REVEAL_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <div className="flex flex-col">
                    <span>{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <RevealHelper secretMasking={secretMasking} effectiveRevealing={effectiveRevealing} />

        {fields.length > 0 && (
          <div className="space-y-2 border-t border-dashed border-border pt-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Mask specific fields
              </p>
              <p className="text-xs text-muted-foreground">
                Credential fields, masked by default. Uncheck to reveal one in this block&apos;s
                logs &amp; reports.
              </p>
            </div>
            <div className="space-y-1.5">
              {fields.map((field) => {
                const masked = !unmaskedFields.includes(field.key)
                const id = `secret-mask-${field.key}`
                return (
                  <div
                    key={field.key}
                    className={cn(
                      'flex items-center gap-2',
                      effectiveRevealing && 'opacity-50',
                    )}
                  >
                    <Checkbox
                      id={id}
                      data-testid={`secret-mask-field-${field.key}`}
                      checked={masked}
                      disabled={effectiveRevealing}
                      onCheckedChange={(checked) => toggleField(field.key, checked)}
                    />
                    <Label
                      htmlFor={id}
                      className={cn(
                        'text-sm font-normal',
                        effectiveRevealing ? 'cursor-not-allowed' : 'cursor-pointer',
                      )}
                    >
                      {field.label}
                    </Label>
                  </div>
                )
              })}
            </div>
            {effectiveRevealing && (
              <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{DISABLED_FIELDS_HINT}</span>
              </p>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
