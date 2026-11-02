import type { ReactNode } from 'react'
import { EntityCreateModal } from '@/components/shared/dialogs/entity-create-modal'

export interface RegressionCreateModalProps {
  open: boolean
  allTags: string[]
  loading?: boolean
  error?: string | null
  onClose: () => void
  onSubmit: (data: {
    name: string
    description: string
    tags: string[]
  }) => void
}

export function RegressionCreateModal({
  open,
  allTags,
  loading = false,
  error,
  onClose,
  onSubmit,
}: Readonly<RegressionCreateModalProps>): ReactNode {
  return (
    <EntityCreateModal
      open={open}
      allTags={allTags}
      loading={loading}
      error={error ?? null}
      onClose={onClose}
      onSubmit={onSubmit}
      title="Create Regression"
      description="Create a new regression to organize and run suites together."
      testIdPrefix="regression"
      namePlaceholder="Enter regression name…"
      descriptionPlaceholder="What does this regression validate?"
    />
  )
}
