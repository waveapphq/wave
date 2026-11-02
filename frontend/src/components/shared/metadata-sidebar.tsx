import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Separator } from '@/components/ui/separator'
import { Activity, Calendar, Clock, Tag, AlignLeft, Pencil, ChevronsUpDown, PanelLeftClose } from 'lucide-react'
import { VariableReadonlyTable } from '@/components/shared/variable-editor/variable-readonly-table'
import { Timestamp } from '@/components/shared/timestamp/timestamp'
import type { VariableType } from '@/lib/variable-types'

type StatusVariant = 'success' | 'error' | 'default'

const STATUS_VARIANT: Record<string, StatusVariant> = {
  passed: 'success',
  failed: 'error',
}

const STATUS_LABEL: Record<string, string> = {
  passed: 'Passed',
  failed: 'Failed',
  never_run: 'Never Run',
}

export function MetadataRow({ icon, label, children }: Readonly<{ icon: ReactNode; label: string; children: ReactNode }>) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-base text-muted-foreground">{label}</p>
        <div className="text-sm break-words [overflow-wrap:anywhere] mt-1">{children}</div>
      </div>
    </div>
  )
}

function CollapsibleSection({
  title,
  editTestId,
  onEdit,
  children,
}: Readonly<{
  title: string
  editTestId: string
  onEdit: () => void
  children: ReactNode
}>) {
  return (
    <Collapsible defaultOpen>
      <div className="border-b border-border">
        <div className="flex items-center justify-between px-4 py-3">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-1">
              <ChevronsUpDown className="h-3.5 w-3.5" />
              <span className="text-sm font-semibold uppercase tracking-wider">
                {title}
              </span>
            </Button>
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="icon"
            data-testid={editTestId}
            onClick={onEdit}
            className="h-7 w-7"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </div>
        <CollapsibleContent>
          {children}
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

function DetailsContent({
  description,
  status,
  tags,
  createdAt,
  updatedAt,
}: Readonly<{
  description: string | null
  status: string
  tags: string[]
  createdAt: string
  updatedAt: string
}>) {
  const statusVariant = STATUS_VARIANT[status] ?? 'default'
  const statusLabel = STATUS_LABEL[status] ?? status.charAt(0).toUpperCase() + status.slice(1)

  return (
    <div className="px-4 pb-3">
      <div className="rounded-md border overflow-hidden">
        <div className="px-3 py-2 space-y-1">
          <MetadataRow icon={<AlignLeft className="h-3.5 w-3.5" />} label="Description">
            <p data-testid="sidebar-description-display" className={description ? '' : 'text-muted-foreground italic'}>
              {description || 'No description'}
            </p>
          </MetadataRow>

          <MetadataRow icon={<Activity className="h-3.5 w-3.5" />} label="Status">
            <div className="-ml-2.5">
              <Badge variant={statusVariant}>
                {statusLabel}
              </Badge>
            </div>
          </MetadataRow>

          <MetadataRow icon={<Tag className="h-3.5 w-3.5" />} label="Tags">
            {tags.length > 0 ? (
              <div data-testid="sidebar-tags-display" className="flex flex-wrap gap-1 -ml-2.5">
                {tags.map((tag) => (
                  <Badge key={tag} variant="default">{tag}</Badge>
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground italic">No tags</span>
            )}
          </MetadataRow>
        </div>

        <div className="border-t border-border/50 px-3 py-2 space-y-1">
          <MetadataRow icon={<Calendar className="h-3.5 w-3.5" />} label="Created">
            <Timestamp value={createdAt} style="date" data-testid="sidebar-created-date" />
          </MetadataRow>

          <MetadataRow icon={<Clock className="h-3.5 w-3.5" />} label="Updated">
            <Timestamp value={updatedAt} style="date" data-testid="sidebar-updated-date" />
          </MetadataRow>
        </div>
      </div>
    </div>
  )
}

export interface MetadataSidebarProps {
  testId: string
  description: string | null
  status: string
  tags: string[]
  createdAt: string
  updatedAt: string
  variables: Record<string, { type: VariableType; value: string; secret: boolean }>
  onEditDetails: () => void
  onEditVariables: () => void
  onCollapse?: () => void
}

export function MetadataSidebar({
  testId,
  description,
  status,
  tags,
  createdAt,
  updatedAt,
  variables,
  onEditDetails,
  onEditVariables,
  onCollapse,
}: Readonly<MetadataSidebarProps>): ReactNode {
  return (
    <div data-testid={testId} className="flex h-full flex-col min-w-0">
      {/* Native overflow-y-auto instead of Radix ScrollArea: ScrollArea's
          viewport wraps children in `display: table; min-width: 100%` to enable
          horizontal scroll, which lets long descriptions grow to their natural
          single-line width and defeats `break-words` on the row content. The
          sidebar is vertical-scroll-only, so a plain overflow-y-auto preserves
          the wrap contract without that side effect. */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
        <div className="space-y-0 min-w-0">
          <CollapsibleSection title="Details" editTestId="edit-details-btn" onEdit={onEditDetails}>
            <DetailsContent
              description={description}
              status={status}
              tags={tags}
              createdAt={createdAt}
              updatedAt={updatedAt}
            />
          </CollapsibleSection>

          <CollapsibleSection title="Variables" editTestId="edit-variables-btn" onEdit={onEditVariables}>
            <div className="px-4 pb-3">
              <VariableReadonlyTable variables={variables} />
            </div>
          </CollapsibleSection>
        </div>
      </div>

      {onCollapse && (
        <div className="mt-auto shrink-0">
          <Separator />
          <div className="flex items-center justify-end px-4 h-[48px]">
            <button
              type="button"
              data-testid="sidebar-collapse-btn"
              onClick={onCollapse}
              className="flex items-center justify-center w-7 h-7 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
