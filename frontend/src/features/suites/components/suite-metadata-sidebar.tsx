/**
 * Suite Metadata Sidebar
 *
 * Read-only left panel showing suite metadata and variables.
 * Uses shadcn Collapsible for expandable sections and Card for variable entries.
 * Each section has an edit button that opens a dialog.
 * Bottom toggle button to collapse the sidebar (matches workbench panel pattern).
 */

import type { ReactNode } from 'react'
import { MetadataSidebar } from '@/components/shared/metadata-sidebar'
import type { SuiteDetail } from '@/features/suites/api/types'

export interface SuiteMetadataSidebarProps {
  suite: SuiteDetail
  onEditDetails: () => void
  onEditVariables: () => void
  onCollapse?: () => void
}

export function SuiteMetadataSidebar({
  suite,
  onEditDetails,
  onEditVariables,
  onCollapse,
}: Readonly<SuiteMetadataSidebarProps>): ReactNode {
  return (
    <MetadataSidebar
      testId="suite-metadata-sidebar"
      description={suite.description}
      status={suite.status}
      tags={suite.tags}
      createdAt={suite.createdAt}
      updatedAt={suite.updatedAt}
      variables={suite.variables}
      onEditDetails={onEditDetails}
      onEditVariables={onEditVariables}
      onCollapse={onCollapse}
    />
  )
}
