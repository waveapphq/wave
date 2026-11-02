/**
 * Regression Metadata Sidebar
 *
 * Read-only left panel showing regression metadata and variables.
 * Uses shadcn Collapsible for expandable sections and Card for variable entries.
 * Each section has an edit button that opens a dialog.
 * Bottom toggle button to collapse the sidebar (matches workbench panel pattern).
 */

import type { ReactNode } from 'react'
import { MetadataSidebar } from '@/components/shared/metadata-sidebar'
import type { RegressionDetail } from '@/features/regressions/api/types'

export interface RegressionMetadataSidebarProps {
  regression: RegressionDetail
  onEditDetails: () => void
  onEditVariables: () => void
  onCollapse?: () => void
}

export function RegressionMetadataSidebar({
  regression,
  onEditDetails,
  onEditVariables,
  onCollapse,
}: Readonly<RegressionMetadataSidebarProps>): ReactNode {
  return (
    <MetadataSidebar
      testId="regression-metadata-sidebar"
      description={regression.description}
      status={regression.status}
      tags={regression.tags}
      createdAt={regression.createdAt}
      updatedAt={regression.updatedAt}
      variables={regression.variables}
      onEditDetails={onEditDetails}
      onEditVariables={onEditVariables}
      onCollapse={onCollapse}
    />
  )
}
