import type { ReactNode } from 'react'
import { EntityCreateModal } from '@/components/shared/dialogs/entity-create-modal'

export interface SuiteCreateModalProps {
  open: boolean
  allTags: string[]
  loading?: boolean
  error?: string | null
  onClose: () => void
  onSubmit: (data: { name: string; description: string; tags: string[] }) => void
}

export function SuiteCreateModal({
  open,
  allTags,
  loading = false,
  error,
  onClose,
  onSubmit,
}: Readonly<SuiteCreateModalProps>): ReactNode {
  return (
    <EntityCreateModal
      open={open}
      allTags={allTags}
      loading={loading}
      error={error ?? null}
      onClose={onClose}
      onSubmit={onSubmit}
      title="Create Suite"
      description="Create a new test suite to organize and run tests together."
      testIdPrefix="suite"
      namePlaceholder="Enter suite name"
      descriptionPlaceholder="Optional description"
    />
  )
}
