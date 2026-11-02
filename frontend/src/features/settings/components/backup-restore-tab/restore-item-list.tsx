/** The named entries of a backup part, one line each: status icon, name and reason (BACKUP-3). */

import type { BackupItem } from '@/features/settings/api/backup'
import { cn } from '@/lib/utils'
import { STATUS_ICONS, STATUS_OUTCOMES, type RestoreStage } from './status-icons'

interface RestoreItemListProps {
  items: readonly BackupItem[]
  /** Where the list is drawn: it picks the outcome words. */
  stage: RestoreStage
  /** The id of the element that names the list. */
  labelId?: string
}

const BOX_CLASS =
  'box-content grid max-h-[168px] grid-cols-[max-content_fit-content(50%)_minmax(0,1fr)] gap-x-2 overflow-y-auto rounded-md border border-border bg-muted/30 pl-2.5 pr-[18px] text-xs font-normal'

// Lets the keyboard reach the scroll box; set from code, like the app's other focusable regions.
function makeFocusable(box: HTMLUListElement | null) {
  if (box) box.tabIndex = 0
}

export function RestoreItemList({ items, stage, labelId }: Readonly<RestoreItemListProps>) {
  const outcomes = STATUS_OUTCOMES[stage]
  return (
    <ul
      ref={makeFocusable}
      aria-labelledby={labelId}
      data-testid="restore-item-list"
      className={BOX_CLASS}
    >
      {items.map((item, index) => {
        const { Icon, className } = STATUS_ICONS[item.status]
        const outcome = outcomes[item.status]
        return (
          <li
            key={`${index}-${item.name}`}
            data-testid="restore-item"
            data-status={item.status}
            className="col-span-full grid grid-cols-subgrid items-center py-1.5"
          >
            <Icon data-status={item.status} className={cn('h-3.5 w-3.5', className)} />
            <span translate="no" className="font-medium text-foreground [overflow-wrap:anywhere]">
              {item.name}
            </span>
            <span className="min-w-0 text-muted-foreground">
              {outcome ? `${outcome}. ${item.reason}` : item.reason}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
