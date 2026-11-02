/**
 * One collapsible drill section, rendered as a bordered card.
 *
 * The header carries a disclosure caret + title, a count badge (a red "N
 * failures" pill on the failure variant, else a muted "N files"), and - on the
 * tree sections - a Tree | Flat SegmentedControl. Failure / Reports render a
 * flat FileRow list (with the known-file description as each row's subtitle);
 * Logs / Files render the collapsible ArtifactTree (the entity tree for Logs).
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buildArtifactReference } from '@/lib/file-references'
import { FileRow } from '@/components/shared/file-row'
import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/components/shared/segmented-control'
import {
  ArtifactTree,
  type ArtifactSubtreeTarget,
  type ArtifactTreeMode,
} from '@/features/artifacts/detail/artifact-tree'
import {
  buildArtifactTree,
  buildLogTree,
  knownFileDescription,
} from '@/features/artifacts/lib/artifact-sections'
import type { ArtifactMeta } from '@/features/artifacts/api/types'

export interface ArtifactDrillSectionProps {
  title: string
  artifacts: ArtifactMeta[]
  withTree: boolean
  entityTree?: boolean
  failedScopes?: Set<string>
  showRemoved: boolean
  /** The failure variant gets a red-tinted card border and a "N failures" pill. */
  variant?: 'failure' | 'default'
  failureCount?: number
  onDownload: (target: ArtifactSubtreeTarget) => void
  onDelete: (target: ArtifactSubtreeTarget) => void
}

const VIEW_OPTIONS: readonly SegmentedControlOption<ArtifactTreeMode>[] = [
  { value: 'tree', label: 'Tree' },
  { value: 'flat', label: 'Flat' },
]

export function ArtifactDrillSection({
  title,
  artifacts,
  withTree,
  entityTree = false,
  failedScopes,
  showRemoved,
  variant = 'default',
  failureCount = 0,
  onDownload,
  onDelete,
}: Readonly<ArtifactDrillSectionProps>) {
  const [open, setOpen] = useState(true)
  const [mode, setMode] = useState<ArtifactTreeMode>('tree')

  const nodes = entityTree ? buildLogTree(artifacts) : buildArtifactTree(artifacts)
  const isFailure = variant === 'failure'

  return (
    <section
      className={cn('overflow-hidden rounded-xl border bg-card', isFailure && 'border-error/30')}
    >
      <div className="flex items-center gap-2.5 px-4 py-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
          )}
          <span className="text-sm font-bold">{title}</span>
        </button>
        {isFailure ? (
          <span className="rounded border border-error/30 bg-error/10 px-1.5 py-0.5 text-[11px] font-bold text-error">
            {failureCount} failures
          </span>
        ) : (
          <span className="text-xs text-muted">{artifacts.length} files</span>
        )}
        <span className="flex-1" />
        {open && withTree && (
          <SegmentedControl
            options={VIEW_OPTIONS}
            value={mode}
            onChange={setMode}
            aria-label={`${title} view`}
          />
        )}
      </div>
      {open && (
        <div className="border-t">
          {withTree ? (
            <ArtifactTree
              nodes={nodes}
              mode={mode}
              entityIcons={entityTree}
              failedScopes={failedScopes}
              showRemoved={showRemoved}
              onDownload={onDownload}
              onDelete={onDelete}
            />
          ) : (
            artifacts.map((artifact) => (
              <FileRow
                key={artifact.id}
                name={artifact.name}
                sizeBytes={artifact.size_bytes}
                removed={!!artifact.removed_at}
                removedAt={artifact.removed_at ?? undefined}
                removedBy={artifact.removed_by ?? undefined}
                subtitle={knownFileDescription(artifact.name)}
                copyPath={buildArtifactReference(artifact.path)}
                onDownload={() => onDownload(artifact)}
                onDelete={() => onDelete(artifact)}
              />
            ))
          )}
        </div>
      )}
    </section>
  )
}
