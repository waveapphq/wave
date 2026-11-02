/** ListPageHeader - the title row shared by every entity list page. */

import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Icon, PlusIcon } from '@/components/ui/icon'

export interface ListPageCreateAction {
  /** Button text, e.g. "New Test". */
  label: string
  onClick: () => void
  testId?: string
}

export interface ListPageHeaderProps {
  title: string
  /** Wired only on pages that accept an import archive. */
  onImport?: () => void
  /** Primary create action; omitted on read-only lists. */
  create?: ListPageCreateAction
}

export function ListPageHeader({
  title,
  onImport,
  create,
}: Readonly<ListPageHeaderProps>) {
  return (
    <div className="flex min-h-10 items-center justify-between">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {(onImport || create) && (
        <div className="flex items-center gap-2">
          {onImport && (
            <Button variant="outline" onClick={onImport} data-testid="import-button">
              <Icon icon={Upload} size="sm" className="mr-2" />
              Import
            </Button>
          )}
          {create && (
            <Button onClick={create.onClick} data-testid={create.testId}>
              <Icon icon={PlusIcon} size="sm" className="mr-2" />
              {create.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
