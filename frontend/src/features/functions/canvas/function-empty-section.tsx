/**
 * FunctionEmptySection - italic muted placeholder shown when the Function
 * declares zero inputs or zero outputs. Always rendered between the section
 * dividers so the Inputs / Outputs headers always show.
 */

const COPY: Record<'inputs' | 'outputs', string> = {
  inputs: 'This Function declares no inputs.',
  outputs: 'This Function declares no outputs.',
}

export function FunctionEmptySection({
  kind,
}: Readonly<{ kind: 'inputs' | 'outputs' }>) {
  return (
    <div
      role="note"
      data-testid={`function-empty-section-${kind}`}
      className="italic text-muted-foreground text-sm py-2"
    >
      {COPY[kind]}
    </div>
  )
}
