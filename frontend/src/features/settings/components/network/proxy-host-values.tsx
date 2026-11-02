/**
 * The WAVE host's own proxy variables (REQ-4.7.14, NET-10): three lock-marked read-only
 * facts, one per line, with labels, locks and values in aligned columns.
 */

import type { ProxySettings } from '@/features/settings/api/proxy'
import { ReadOnlyFact } from '@/features/settings/components/read-only-fact'

type HostValues = ProxySettings['host_values']

export interface ProxyHostValuesProps {
  values: HostValues
}

const FACTS: ReadonlyArray<{ key: keyof HostValues; label: string }> = [
  { key: 'https_proxy', label: 'HTTPS_PROXY' },
  { key: 'http_proxy', label: 'HTTP_PROXY' },
  { key: 'no_proxy', label: 'NO_PROXY' },
]

const NOT_SET = 'Not set'

export function ProxyHostValues({ values }: Readonly<ProxyHostValuesProps>) {
  return (
    <div
      translate="no"
      className="grid grid-cols-[max-content_0.75rem_minmax(0,1fr)] items-center gap-x-1.5 gap-y-2 text-xs text-muted-foreground"
    >
      {FACTS.map(({ key, label }) => (
        <ReadOnlyFact key={key} layout="columns" label={label} value={values[key] ?? NOT_SET} />
      ))}
    </div>
  )
}
