/**
 * Drill data + actions for one execution's artifacts.
 *
 * Always fetches with tombstones included so the removed count is known even
 * while hidden; the Show removed toggle filters them out of the rendered
 * sections. Exposes download / delete handlers (leaf artifact or
 * directory subtree) that reload after a soft-delete.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBlockingReads, type PrimaryState } from '@/hooks/use-blocking-reads'
import { useToast } from '@/components/ui/toast'
import { toFailureDetail } from '@/lib/failure-detail'
import { bulkFailureMessage } from '@/lib/bulk-failure'
import {
  deleteArtifact,
  fetchArtifactJson,
  fetchDrillExecution,
  fetchExecutionArtifacts,
} from '@/features/artifacts/api/artifacts'
import { downloadArtifactFile, downloadExecutionZip } from '@/features/artifacts/api/download'
import {
  groupArtifactSections,
  type ArtifactSections,
  type ArtifactTreeNode,
} from '@/features/artifacts/lib/artifact-sections'
import type { ArtifactSubtreeTarget } from '@/features/artifacts/detail/artifact-tree'
import type { ArtifactMeta } from '@/features/artifacts/api/types'

export interface DrillExecution {
  name: string
  entityType?: string
  status: string
  finishedAt?: string | null
}

export interface UseArtifactDrillResult {
  sections: ArtifactSections
  execution: DrillExecution | null
  failedScopes: Set<string>
  artifactCount: number
  totalSizeBytes: number
  removedCount: number
  showRemoved: boolean
  setShowRemoved: (value: boolean) => void
  isLoading: boolean
  error?: string
  refetch: () => void
  onDownload: (target: ArtifactSubtreeTarget) => void
  onDelete: (target: ArtifactSubtreeTarget) => void
}

const FAILURE_NAME = 'error.json'
const DOWNLOAD_FAILED = 'Download Failed'
const DELETE_FAILED = 'Delete Failed'

interface FailureSummary {
  failures?: Array<{ scope_path?: string }>
}

function subtreeArtifacts(node: ArtifactTreeNode): ArtifactMeta[] {
  const leaves: ArtifactMeta[] = node.artifact ? [node.artifact] : []
  for (const child of node.children) {
    leaves.push(...subtreeArtifacts(child))
  }
  return leaves
}

/** Failing `<suite>/<test>` scope paths, empty when the run produced no error.json. */
async function readFailedScopes(artifacts: ArtifactMeta[]): Promise<Set<string>> {
  const errorArtifact = artifacts.find(
    (artifact) => artifact.path === FAILURE_NAME && !artifact.removed_at,
  )
  if (!errorArtifact) {
    return new Set()
  }
  const summary = await fetchArtifactJson<FailureSummary>(errorArtifact.id)
  return new Set((summary.failures ?? []).map((entry) => entry.scope_path ?? '').filter(Boolean))
}

export function useArtifactDrill(executionId: string | undefined): UseArtifactDrillResult {
  const [artifacts, setArtifacts] = useState<ArtifactMeta[]>([])
  const [execution, setExecution] = useState<DrillExecution | null>(null)
  const [failedScopes, setFailedScopes] = useState<Set<string>>(() => new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [showRemoved, setShowRemoved] = useState(false)
  const [primary, setPrimary] = useState<PrimaryState>('pending')
  const blocking = useBlockingReads(primary)
  const { error: toastError } = useToast()

  const read = useCallback(async () => {
    if (!executionId) {
      setPrimary('loaded')
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setError(undefined)
    setPrimary('pending')
    try {
      const fetched = await fetchExecutionArtifacts(executionId, true)
      setArtifacts(fetched)
      setPrimary('loaded')
      await blocking.load([
        {
          label: 'execution details',
          run: async () => setExecution(await fetchDrillExecution(executionId)),
        },
        {
          label: 'failure summary',
          run: async () => setFailedScopes(await readFailedScopes(fetched)),
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }, [executionId, blocking])

  // The page's own error state is where a failed artifact read is reported.
  const load = useCallback((): void => {
    read().catch((error_: unknown) => {
      setError((error_ as Error).message)
      setPrimary('failed')
    })
  }, [read])

  useEffect(() => {
    load()
  }, [load])

  const liveArtifacts = useMemo(
    () => artifacts.filter((artifact) => !artifact.removed_at),
    [artifacts],
  )
  const removedCount = artifacts.length - liveArtifacts.length
  const totalSizeBytes = useMemo(
    () => liveArtifacts.reduce((sum, artifact) => sum + artifact.size_bytes, 0),
    [liveArtifacts],
  )

  const sections = useMemo(() => {
    const visible = showRemoved
      ? artifacts
      : artifacts.filter((artifact) => !artifact.removed_at)
    return groupArtifactSections(visible)
  }, [artifacts, showRemoved])

  const onDownload = useCallback(
    (target: ArtifactSubtreeTarget) => {
      const started =
        'children' in target
          ? downloadExecutionZip(executionId ?? '', target.path)
          : downloadArtifactFile(target.id, target.name)
      started.catch((error_: unknown) => {
        toastError(toFailureDetail(error_).message, DOWNLOAD_FAILED)
      })
    },
    [executionId, toastError],
  )

  const onDelete = useCallback(
    (target: ArtifactSubtreeTarget): void => {
      const targets = 'children' in target ? subtreeArtifacts(target) : [target]
      Promise.allSettled(targets.map((artifact) => deleteArtifact(artifact.id)))
        .then((results) => {
          const message = bulkFailureMessage(
            results,
            (removed, total) => `${removed} of ${total} artifacts were removed.`,
          )
          if (message !== null) throw new Error(message)
        })
        .finally(load)
        .catch((error_: unknown) => {
          toastError((error_ as Error).message, DELETE_FAILED)
        })
    },
    [load, toastError],
  )

  return {
    sections,
    execution,
    failedScopes,
    artifactCount: liveArtifacts.length,
    totalSizeBytes,
    removedCount,
    showRemoved,
    setShowRemoved,
    isLoading,
    error,
    refetch: load,
    onDownload,
    onDelete,
  }
}
