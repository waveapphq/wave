/**
 * Per-execution artifact drill: a detail header (entity tile, name, type chip,
 * status, Download-all .zip) over a metadata line (finished / count / size), a
 * Show removed toggle, and the Failure summary / Reports / Logs / Files section
 * cards in fixed order (each shown only when it has content). Data + actions
 * come from useArtifactDrill.
 */

import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Check, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DetailHeader } from '@/components/shared/detail-header'
import { Timestamp } from '@/components/shared/timestamp/timestamp'
import {
  BreadcrumbSegmentIcon,
  type BreadcrumbSegmentType,
} from '@/components/shared/breadcrumb-segment-icon'
import {
  getStatusColor,
  getStatusDotColor,
  getStatusLabel,
} from '@/components/shared/tables/table-utils'
import { formatBytes } from '@/lib/format-bytes'
import { ArtifactDrillSection } from '@/features/artifacts/detail/artifact-drill-section'
import type { ArtifactSubtreeTarget } from '@/features/artifacts/detail/artifact-tree'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { EntityTypeChip } from '@/components/shared/entity-type-chip'
import { useArtifactDrill } from '@/features/artifacts/hooks/use-artifact-drill'
import { downloadExecutionZip } from '@/features/artifacts/api/download'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'

const DOWNLOAD_FAILED = 'Download Failed'

const REMOVAL_NOTE = 'Removed artifacts stay as an audit record and cannot be restored.'

/** A folder target carries its children; a file target is the artifact itself. */
function deleteDescription(target: ArtifactSubtreeTarget): string {
  return 'children' in target
    ? `The folder and every artifact under it are removed. ${REMOVAL_NOTE}`
    : `The artifact is removed. ${REMOVAL_NOTE}`
}

const SECTION_ORDER = [
  { key: 'failure', title: 'Failure summary', withTree: false, entityTree: false },
  { key: 'reports', title: 'Reports', withTree: false, entityTree: false },
  { key: 'logs', title: 'Logs', withTree: true, entityTree: true },
  { key: 'files', title: 'Files', withTree: true, entityTree: false },
] as const

const HEADER_ENTITY_TYPES = new Set(['test', 'suite', 'regression', 'execution'])

function headerEntityType(entityType?: string): BreadcrumbSegmentType | undefined {
  return entityType && HEADER_ENTITY_TYPES.has(entityType)
    ? (entityType as BreadcrumbSegmentType)
    : undefined
}

export function ArtifactDrillPage() {
  const { executionId } = useParams()
  const navigate = useNavigate()
  const drill = useArtifactDrill(executionId)
  const { error: toastError } = useToast()
  const [pendingDelete, setPendingDelete] = useState<ArtifactSubtreeTarget | null>(null)

  const downloadAll = (): void => {
    downloadExecutionZip(executionId ?? '').catch((error_: unknown) => {
      toastError(toFailureDetail(error_).message, DOWNLOAD_FAILED)
    })
  }

  if (drill.isLoading) {
    return (
      <div data-testid="artifact-drill-page" className="flex h-full flex-col">
        <div data-testid="artifact-drill-skeleton" className="flex flex-col gap-4 p-6" aria-busy>
          <div className="h-6 w-48 animate-pulse rounded bg-subtle" />
          <div className="h-32 w-full animate-pulse rounded bg-subtle" />
          <div className="h-32 w-full animate-pulse rounded bg-subtle" />
        </div>
      </div>
    )
  }

  if (drill.error) {
    return (
      <div data-testid="artifact-drill-page" className="flex h-full flex-col">
        <div
          data-testid="artifact-drill-error"
          className="flex flex-1 flex-col items-center justify-center gap-4 p-6"
        >
          <AlertTriangle className="h-12 w-12 text-error" aria-hidden="true" />
          <p className="text-muted">{drill.error}</p>
          <Button variant="primary" onClick={drill.refetch}>
            Try Again
          </Button>
        </div>
      </div>
    )
  }

  const sections = SECTION_ORDER.map((def) => ({
    ...def,
    artifacts: drill.sections[def.key],
  })).filter((def) => def.artifacts.length > 0)
  const headerType = headerEntityType(drill.execution?.entityType)

  return (
    <div data-testid="artifact-drill-page" className="flex h-full flex-col">
      <DetailHeader
        name={drill.execution?.name ?? executionId ?? 'Artifacts'}
        onBack={() => { navigate('/artifacts') }}
        titleIcon={
          headerType ? (
            <BreadcrumbSegmentIcon
              type={headerType}
              tile
              tileClassName="h-9 w-9 rounded-lg"
              iconClassName="h-5 w-5"
            />
          ) : undefined
        }
        statusSlot={
          drill.execution ? (
            <span className="flex shrink-0 items-center gap-3">
              <EntityTypeChip type={drill.execution.entityType ?? null} />
              <span
                className={cn(
                  'flex items-center gap-1.5 text-sm font-semibold',
                  getStatusColor(drill.execution.status),
                )}
              >
                <span
                  className={cn('h-2 w-2 rounded-full', getStatusDotColor(drill.execution.status))}
                  aria-hidden="true"
                />
                {getStatusLabel(drill.execution.status)}
              </span>
            </span>
          ) : undefined
        }
        subtitle={
          <span data-testid="artifact-drill-meta" className="text-[15px] font-light text-muted">
            {drill.execution?.finishedAt && (
              <>
                Finished <Timestamp value={drill.execution.finishedAt} style="datetime" />
                {' · '}
              </>
            )}
            {`${drill.artifactCount} artifacts · ${formatBytes(drill.totalSizeBytes)}`}
          </span>
        }
        actions={
          <Button
            variant="secondary"
            onClick={downloadAll}
            data-testid="artifact-download-all"
          >
            <Download className="mr-1.5 h-4 w-4" />
            Download all (.zip)
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto p-6">
        {drill.removedCount > 0 && (
          <button
            type="button"
            data-testid="artifact-show-removed"
            aria-pressed={drill.showRemoved}
            onClick={() => drill.setShowRemoved(!drill.showRemoved)}
            className="flex w-fit items-center gap-2 text-sm"
          >
            <span
              className={cn(
                'flex h-4 w-4 items-center justify-center rounded border',
                drill.showRemoved ? 'border-primary bg-primary text-white' : 'border-strong',
              )}
            >
              {drill.showRemoved && <Check className="h-3 w-3" />}
            </span>
            <span className="text-secondary">Show removed</span>
            <span className="text-muted">· {drill.removedCount} removed artifacts</span>
          </button>
        )}
        {sections.map((section) => (
          <ArtifactDrillSection
            key={section.key}
            title={section.title}
            artifacts={section.artifacts}
            withTree={section.withTree}
            entityTree={section.entityTree}
            variant={section.key === 'failure' ? 'failure' : 'default'}
            failureCount={drill.failedScopes.size}
            failedScopes={drill.failedScopes}
            showRemoved={drill.showRemoved}
            onDownload={drill.onDownload}
            onDelete={setPendingDelete}
          />
        ))}
      </div>
      {pendingDelete === null ? null : (
        <ConfirmationDialog
          isOpen
          variant="delete"
          itemName={pendingDelete.name}
          description={deleteDescription(pendingDelete)}
          onConfirm={() => {
            drill.onDelete(pendingDelete)
            setPendingDelete(null)
          }}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
