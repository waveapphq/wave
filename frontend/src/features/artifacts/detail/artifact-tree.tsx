/**
 * Collapsible artifact tree (directory > file) with a flat fallback.
 *
 * Directory nodes render the shared FolderRow (aggregate size, Copy path,
 * subtree download + delete); leaf nodes render the shared FileRow. In the
 * entity variant (Logs) each node carries an entity-icon tile and failed/total
 * meta counts, and test leaves are tinted red from the execution's failure
 * scopes. Flat mode lists every leaf with its path.
 */

import { useState, type ReactNode } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BreadcrumbSegmentIcon } from '@/components/shared/breadcrumb-segment-icon'
import { FileRow } from '@/components/shared/file-row'
import { FolderRow } from '@/components/shared/folder-row'
import { buildArtifactReference } from '@/lib/file-references'
import {
  logEntityKind,
  logScopeKey,
  nodeCounts,
  subtreeSize,
  type ArtifactTreeNode,
} from '@/features/artifacts/lib/artifact-sections'
import type { ArtifactMeta } from '@/features/artifacts/api/types'

export type ArtifactTreeMode = 'tree' | 'flat'
export type ArtifactSubtreeTarget = ArtifactMeta | ArtifactTreeNode

export interface ArtifactTreeProps {
  nodes: ArtifactTreeNode[]
  mode: ArtifactTreeMode
  showRemoved: boolean
  entityIcons?: boolean
  failedScopes?: Set<string>
  onDownload: (target: ArtifactSubtreeTarget) => void
  onDelete: (target: ArtifactSubtreeTarget) => void
}

interface NodeRowProps {
  node: ArtifactTreeNode
  depth: number
  entityIcons: boolean
  failedScopes?: Set<string>
  onDownload: (target: ArtifactSubtreeTarget) => void
  onDelete: (target: ArtifactSubtreeTarget) => void
}

const FAIL_TINT = '#EF4444'
const EMPTY_SCOPES = new Set<string>()
const ENTITY_TILE_CLASS = 'h-6 w-6'
const ENTITY_ICON_CLASS = 'h-3.5 w-3.5'

function collectLeaves(nodes: ArtifactTreeNode[]): ArtifactMeta[] {
  const leaves: ArtifactMeta[] = []
  for (const node of nodes) {
    if (node.artifact) {
      leaves.push(node.artifact)
    }
    if (node.children.length > 0) {
      leaves.push(...collectLeaves(node.children))
    }
  }
  return leaves
}

function NodeMeta({ node, failedScopes }: Readonly<{ node: ArtifactTreeNode; failedScopes: Set<string> }>) {
  const counts = nodeCounts(node, failedScopes)
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs">
      {counts.failed > 0 ? (
        <span className="font-semibold text-error">{counts.failed} failed</span>
      ) : (
        <span className="font-semibold text-success">passed</span>
      )}
      <span className="text-muted">
        {' '}
        · {counts.total} {counts.unit}
      </span>
    </span>
  )
}

interface SubtreeActionsProps {
  node: ArtifactTreeNode
  onDownload: (target: ArtifactSubtreeTarget) => void
  onDelete: (target: ArtifactSubtreeTarget) => void
}

function SubtreeActions({ node, onDownload, onDelete }: Readonly<SubtreeActionsProps>) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Download ${node.name}`}
        onClick={() => onDownload(node)}
      >
        <Download className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete ${node.name}`}
        onClick={() => onDelete(node)}
        className="text-error hover:bg-error/10 hover:text-error"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </>
  )
}

function ArtifactTreeNodeRow({
  node,
  depth,
  entityIcons,
  failedScopes,
  onDownload,
  onDelete,
}: Readonly<NodeRowProps>) {
  const [expanded, setExpanded] = useState(true)

  if (node.artifact) {
    let leafIcon: ReactNode
    if (entityIcons) {
      leafIcon = (
        <BreadcrumbSegmentIcon
          type="test"
          tile
          tileClassName={ENTITY_TILE_CLASS}
          iconClassName={ENTITY_ICON_CLASS}
          statusColor={failedScopes?.has(logScopeKey(node)) ? FAIL_TINT : undefined}
        />
      )
    }
    const artifact = node.artifact
    return (
      <li>
        <FileRow
          name={artifact.name}
          sizeBytes={artifact.size_bytes}
          indent={depth}
          removed={!!artifact.removed_at}
          removedAt={artifact.removed_at ?? undefined}
          removedBy={artifact.removed_by ?? undefined}
          icon={leafIcon}
          copyPath={buildArtifactReference(artifact.path)}
          onDownload={() => onDownload(artifact)}
          onDelete={() => onDelete(artifact)}
        />
      </li>
    )
  }

  return (
    <li>
      <FolderRow
        name={node.name}
        expanded={expanded}
        onToggle={() => setExpanded((prev) => !prev)}
        indent={depth}
        sizeBytes={subtreeSize(node)}
        icon={
          entityIcons ? (
            <BreadcrumbSegmentIcon
              type={logEntityKind(node)}
              tile
              tileClassName={ENTITY_TILE_CLASS}
              iconClassName={ENTITY_ICON_CLASS}
            />
          ) : undefined
        }
        meta={
          entityIcons ? <NodeMeta node={node} failedScopes={failedScopes ?? EMPTY_SCOPES} /> : undefined
        }
        copyPath={buildArtifactReference(node.path)}
        actions={<SubtreeActions node={node} onDownload={onDownload} onDelete={onDelete} />}
      />
      {expanded && (
        <ul className="list-none">
          {node.children.map((child) => (
            <ArtifactTreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              entityIcons={entityIcons}
              failedScopes={failedScopes}
              onDownload={onDownload}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function ArtifactTree({
  nodes,
  mode,
  entityIcons = false,
  failedScopes,
  onDownload,
  onDelete,
}: Readonly<ArtifactTreeProps>) {
  if (mode === 'flat') {
    return (
      <ul className="list-none">
        {collectLeaves(nodes).map((artifact) => (
          <li key={artifact.id}>
            <FileRow
              name={artifact.name}
              sizeBytes={artifact.size_bytes}
              removed={!!artifact.removed_at}
              removedAt={artifact.removed_at ?? undefined}
              removedBy={artifact.removed_by ?? undefined}
              subtitle={artifact.path}
              subtitleMono
              copyPath={buildArtifactReference(artifact.path)}
              onDownload={() => onDownload(artifact)}
              onDelete={() => onDelete(artifact)}
            />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <ul className="list-none">
      {nodes.map((node) => (
        <ArtifactTreeNodeRow
          key={node.path}
          node={node}
          depth={0}
          entityIcons={entityIcons}
          failedScopes={failedScopes}
          onDownload={onDownload}
          onDelete={onDelete}
        />
      ))}
    </ul>
  )
}
