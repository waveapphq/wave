/**
 * FunctionDetailSections - collapsible metadata sections for a version.
 *
 * Changelog (expanded) + Details render Markdown; Details scrolls within a
 * max height. Inputs/Outputs render read-only tables that include a
 * Description column. Usage lists the consuming Tests/Functions inline.
 */

import { type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { MarkdownContent } from '@/components/shared/markdown-content'
import { cn } from '@/lib/utils'
import type {
  FunctionInput,
  FunctionOutput,
  FunctionDependentsResponse,
} from '@/features/functions/api/types'

interface CollapsibleSectionProps {
  id: string
  title: string
  defaultOpen?: boolean
  children: ReactNode
}

function CollapsibleSection({ id, title, defaultOpen = false, children }: Readonly<CollapsibleSectionProps>) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <button
        type="button"
        data-testid={`section-toggle-${id}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 p-3 text-sm font-medium transition-colors hover:bg-muted/50"
      >
        <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} />
        {title}
      </button>
      {open && (
        <div data-testid={`section-${id}`} className="border-t border-border p-3">
          {children}
        </div>
      )}
    </div>
  )
}

function EmptyHint({ text }: Readonly<{ text: string }>) {
  return <p className="text-sm text-muted-foreground">{text}</p>
}

function InputsTable({ inputs }: Readonly<{ inputs: FunctionInput[] }>) {
  if (inputs.length === 0) return <EmptyHint text="No inputs declared." />
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-muted-foreground">
          <th className="py-1.5 pr-3 font-medium">Name</th>
          <th className="py-1.5 pr-3 font-medium">Type</th>
          <th className="py-1.5 pr-3 font-medium">Required</th>
          <th className="py-1.5 font-medium">Description</th>
        </tr>
      </thead>
      <tbody>
        {inputs.map((param) => (
          <tr key={param.name} className="border-b border-border last:border-0">
            <td className="py-1.5 pr-3 font-medium">{param.name}</td>
            <td className="py-1.5 pr-3 capitalize text-muted-foreground">{param.type}</td>
            <td className="py-1.5 pr-3 text-muted-foreground">{param.required ? 'Yes' : 'No'}</td>
            <td className="py-1.5 text-muted-foreground">{param.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function OutputsTable({ outputs }: Readonly<{ outputs: FunctionOutput[] }>) {
  if (outputs.length === 0) return <EmptyHint text="No outputs declared." />
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs text-muted-foreground">
          <th className="py-1.5 pr-3 font-medium">Name</th>
          <th className="py-1.5 pr-3 font-medium">Type</th>
          <th className="py-1.5 font-medium">Description</th>
        </tr>
      </thead>
      <tbody>
        {outputs.map((param) => (
          <tr key={param.name} className="border-b border-border last:border-0">
            <td className="py-1.5 pr-3 font-medium">{param.name}</td>
            <td className="py-1.5 pr-3 capitalize text-muted-foreground">{param.type}</td>
            <td className="py-1.5 text-muted-foreground">{param.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function UsageList({ usage }: Readonly<{ usage: FunctionDependentsResponse }>) {
  const rows = [
    // A Test opens in the workbench (there is no /tests/:id route); a Function
    // opens its detail page. Client-side links so navigation never reloads.
    ...usage.tests.map((entry) => ({
      ...entry,
      kind: 'test' as const,
      href: `/workbench?editTest=${entry.id}`,
    })),
    ...usage.functions.map((entry) => ({
      ...entry,
      kind: 'function' as const,
      href: `/functions/${entry.id}`,
    })),
  ]
  if (rows.length === 0) return <EmptyHint text="Not used by any Test or Function." />
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row) => (
        <li key={`${row.kind}-${row.id}`}>
          <Link to={row.href} className="text-sm text-primary hover:underline">
            {row.name}
            <span className="ml-2 text-xs uppercase text-muted-foreground">{row.kind}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export interface FunctionDetailSectionsProps {
  changelog: string
  details: string
  inputs: FunctionInput[]
  outputs: FunctionOutput[]
  usage: FunctionDependentsResponse
}

export function FunctionDetailSections({
  changelog,
  details,
  inputs,
  outputs,
  usage,
}: Readonly<FunctionDetailSectionsProps>) {
  return (
    <div className="flex flex-col gap-3">
      <CollapsibleSection id="changelog" title="Changelog" defaultOpen>
        <MarkdownContent text={changelog || '_No changelog._'} />
      </CollapsibleSection>
      <CollapsibleSection id="details" title="Details">
        <div className="overflow-y-auto overflow-x-hidden max-h-64">
          <MarkdownContent text={details || '_No details._'} />
        </div>
      </CollapsibleSection>
      <CollapsibleSection id="inputs" title="Inputs">
        <InputsTable inputs={inputs} />
      </CollapsibleSection>
      <CollapsibleSection id="outputs" title="Outputs">
        <OutputsTable outputs={outputs} />
      </CollapsibleSection>
      <CollapsibleSection id="usage" title="Usage">
        <UsageList usage={usage} />
      </CollapsibleSection>
    </div>
  )
}
