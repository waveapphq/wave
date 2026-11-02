/**
 * Public Certificate Authorities choice: two option cards over one radio group (NET-5, NET-6).
 */

import { useId, type ReactNode } from 'react'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import type { PublicSource } from '@/features/settings/api/certificates'
import { cn } from '@/lib/utils'

const GROUP_LABEL = 'Public Certificate Authorities'
const HOST_STORE_NOT_FOUND = 'No certificate store found on this WAVE host'

export interface PublicAuthoritiesChoiceProps {
  value: PublicSource
  /** The bundled list's date label and authority count, as the API reports them. */
  builtin: { label: string; count: number }
  hostStoreFound: boolean
  onChange: (value: PublicSource) => void
  disabled?: boolean
}

interface OptionCardProps {
  value: PublicSource
  title: string
  selected: boolean
  unavailable: boolean
  children: ReactNode
}

function OptionCard({ value, title, selected, unavailable, children }: Readonly<OptionCardProps>) {
  const id = useId()
  const titleId = `${id}-title`
  const linesId = `${id}-lines`
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border border-border p-5 transition-colors has-[:disabled]:cursor-not-allowed',
        selected && 'border-primary bg-primary/5 ring-1 ring-primary',
        unavailable && 'opacity-50',
      )}
    >
      <RadioGroupItem
        value={value}
        disabled={unavailable}
        aria-disabled={unavailable || undefined}
        aria-labelledby={titleId}
        aria-describedby={linesId}
        className="mt-1 shrink-0"
      />
      <span className="flex min-w-0 flex-col gap-1">
        <span id={titleId} className="text-base font-semibold text-foreground">
          {title}
        </span>
        <span id={linesId} className="flex flex-col gap-1 text-sm text-muted-foreground">
          {children}
        </span>
      </span>
    </label>
  )
}

export function PublicAuthoritiesChoice({
  value,
  builtin,
  hostStoreFound,
  onChange,
  disabled = false,
}: Readonly<PublicAuthoritiesChoiceProps>) {
  return (
    <RadioGroup
      aria-label={GROUP_LABEL}
      value={value}
      onValueChange={(next) => onChange(next as PublicSource)}
      disabled={disabled}
      className="grid-cols-2 gap-4"
    >
      <OptionCard value="builtin" title="WAVE's built-in list" selected={value === 'builtin'} unavailable={false}>
        <span>{`Mozilla's public list, ${builtin.label}, ${builtin.count} authorities.`}</span>
        <span>Same on every WAVE host.</span>
      </OptionCard>
      <OptionCard value="host" title="This WAVE host's store" selected={value === 'host'} unavailable={!hostStoreFound}>
        <span>Follows this machine&apos;s system updates.</span>
        {!hostStoreFound && <span>{HOST_STORE_NOT_FOUND}</span>}
      </OptionCard>
    </RadioGroup>
  )
}

/** Card placeholders while the page's first read is pending. */
export function PublicAuthoritiesSkeleton() {
  return (
    <div data-testid="public-authorities-skeleton" className="grid grid-cols-2 gap-4" aria-hidden="true">
      <Skeleton variant="card" className="h-[114px]" />
      <Skeleton variant="card" className="h-[114px]" />
    </div>
  )
}
