import type { ReactNode } from 'react'
import { PanelRightClose } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export function CollapsedSidebarStrip({
  icon: IconComponent,
  label,
  onExpand,
}: Readonly<{
  icon: LucideIcon
  label: string
  onExpand: () => void
}>): ReactNode {
  return (
    <>
      <div className="flex flex-col items-center gap-1 py-3 flex-1">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted/50 mb-1">
          <IconComponent className="h-6 w-6 text-muted-foreground" />
        </div>

        <div className="w-10 h-px bg-border my-2" />

        <div className="flex flex-col items-center gap-0.5">
          {label.split('').map((char, index) => (
            <span
              key={`col-${index}-${char}`}
              className="text-xs font-medium text-muted-foreground leading-none"
            >
              {char}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center justify-center h-[49px]">
        <div className="h-px w-full bg-border shrink-0" />
        <div className="flex flex-1 items-center justify-center">
          <button
            type="button"
            data-testid="sidebar-toggle-btn"
            onClick={onExpand}
            className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
            aria-label="Expand sidebar"
            aria-expanded={false}
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  )
}
