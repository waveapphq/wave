/**
 * FunctionDetailPage.
 *
 * Read-only versioned-metadata page. The version nav drives the meta header +
 * collapsible sections. Per-version delete (nav) and whole-Function delete
 * (header) both proceed regardless of usage. "View workflow" is a no-op
 * placeholder; the read-only canvas is wired separately.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, Eye, Trash2, FunctionSquare, User, Calendar, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DetailHeader } from '@/components/shared/detail-header'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { VersionNav } from '@/features/functions/components/version-nav'
import { FunctionDetailSections } from '@/features/functions/components/function-detail-sections'
import {
  listFunctionVersions,
  getDependentsByVersion,
  deleteFunction,
  deleteFunctionVersion,
} from '@/features/functions/api/functions-api'
import type { VersionDescriptor, FunctionDependentsResponse } from '@/features/functions/api/types'
import { formatPublishedDate } from '@/lib/timestamp-format'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { useBlockingReads, type BlockingRead, type PrimaryState } from '@/hooks/use-blocking-reads'

const EMPTY_USAGE: FunctionDependentsResponse = { tests: [], functions: [] }

const VERSION_USAGE_UNKNOWN =
  'Could not load where this version is used. Try Again to load it, then delete.'
const FUNCTION_USAGE_UNKNOWN =
  'Could not load where this Function is used. Try Again to load it, then delete.'

function usageSummary(usage: FunctionDependentsResponse): string {
  const tests = usage.tests.length
  const functions = usage.functions.length
  return `Used in ${tests} ${tests === 1 ? 'test' : 'tests'} · ${functions} ${functions === 1 ? 'function' : 'functions'}`
}

export function FunctionDetailPage(): ReactNode {
  const { functionId } = useParams<{ functionId: string }>()
  const navigate = useNavigate()

  const [versions, setVersions] = useState<VersionDescriptor[]>([])
  const [latest, setLatest] = useState('')
  const [functionName, setFunctionName] = useState('')
  const [selectedVersion, setSelectedVersion] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usageByVersion, setUsageByVersion] = useState<Record<string, FunctionDependentsResponse>>({})
  const [usageFailed, setUsageFailed] = useState(false)
  const [primary, setPrimary] = useState<PrimaryState>('pending')
  const [versionToDelete, setVersionToDelete] = useState<string | null>(null)
  const [deleteFunctionOpen, setDeleteFunctionOpen] = useState(false)
  const blocking = useBlockingReads(primary)

  const applyVersions = useCallback(
    (result: { versions: VersionDescriptor[]; latest: string; name?: string }) => {
      setVersions(result.versions)
      setLatest(result.latest)
      // applyVersions only runs after a functionId guard (loadVersions / delete reload).
      setFunctionName(result.name ?? functionId!)
      setSelectedVersion((prev) =>
        result.versions.some((entry) => entry.version === prev) ? prev : result.latest,
      )
    },
    [functionId],
  )

  /** Anything that failed without reporting itself lands on the page's error line. */
  const reportFailure = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : 'Failed to load function')
  }, [])

  const loadVersions = useCallback(async () => {
    if (!functionId) return
    setLoading(true)
    setError(null)
    setPrimary('pending')
    try {
      applyVersions(await listFunctionVersions(functionId))
      setPrimary('loaded')
    } catch (err) {
      reportFailure(err)
      setPrimary('failed')
    } finally {
      setLoading(false)
    }
  }, [functionId, applyVersions, reportFailure])

  useEffect(() => {
    loadVersions().catch(reportFailure)
  }, [loadVersions, reportFailure])

  // Per-version usage: ONE batched request returns every version's dependents
  // in a single storage pass (count for the nav + list for the Usage section).
  const usageReads = useMemo<BlockingRead[]>(
    () => [
      {
        label: 'where this version is used',
        run: async () => {
          if (!functionId) return
          try {
            setUsageByVersion(await getDependentsByVersion(functionId))
            setUsageFailed(false)
          } catch (err) {
            // The failed flag, not an empty map, is what closes the delete path.
            setUsageFailed(true)
            throw err
          }
        },
      },
    ],
    [functionId],
  )

  // Each read reports itself on the page block; the page only hears about a
  // failure of the run itself.
  useEffect(() => {
    blocking.load(usageReads).catch(reportFailure)
  }, [blocking, usageReads, reportFailure])

  const selected = useMemo(
    () => versions.find((entry) => entry.version === selectedVersion),
    [versions, selectedVersion],
  )

  const usageCount = useCallback(
    (version: string) => {
      const deps = usageByVersion[version]
      return deps ? deps.tests.length + deps.functions.length : 0
    },
    [usageByVersion],
  )

  const confirmDeleteVersion = useCallback(async () => {
    // Only reachable from the confirm dialog, which opens with both set.
    const version = versionToDelete!
    setVersionToDelete(null)
    if (usageFailed) {
      setError(VERSION_USAGE_UNKNOWN)
      return
    }
    try {
      await deleteFunctionVersion(functionId!, version)
      try {
        applyVersions(await listFunctionVersions(functionId!))
      } catch {
        navigate('/functions')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete version')
    }
  }, [functionId, versionToDelete, applyVersions, navigate, usageFailed])

  const confirmDeleteFunction = useCallback(async () => {
    // Only reachable from the confirm dialog, which opens with functionId set.
    setDeleteFunctionOpen(false)
    if (usageFailed) {
      setError(FUNCTION_USAGE_UNKNOWN)
      return
    }
    try {
      await deleteFunction(functionId!, { cascade: true })
      navigate('/functions')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete function')
    }
  }, [functionId, navigate, usageFailed])

  if (loading) {
    return (
      <div
        data-testid="function-detail-loading"
        className="flex h-full items-center justify-center"
      >
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading function…</p>
        </div>
      </div>
    )
  }

  if (!selected) {
    return (
      <div
        data-testid="function-detail-error"
        className="flex h-full flex-col items-center justify-center gap-4"
      >
        <FunctionSquare className="h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">{error ?? 'Function not found'}</p>
        <Button variant="outline" size="sm" onClick={() => { navigate('/functions') }}>
          Back to Functions
        </Button>
      </div>
    )
  }

  const selectedUsage = usageByVersion[selectedVersion] ?? EMPTY_USAGE

  return (
    <div data-testid="function-detail-page" className="flex h-full flex-col">
      <DetailHeader
        name={functionName}
        entityType="function"
        onBack={() => { navigate('/functions') }}
        actions={
          <>
            <ConditionalTooltip content="Open the read-only workflow view for this version" wide>
              <Button
                variant="outline"
                size="sm"
                data-testid="view-workflow"
                onClick={() => {
                  navigate(`/workbench?viewFunction=${functionId!}&version=${selectedVersion}`)
                }}
              >
                <Eye className="mr-1.5 h-4 w-4" />
                View workflow
              </Button>
            </ConditionalTooltip>
            <Button
              variant="outline"
              size="sm"
              data-testid="delete-function"
              onClick={() => setDeleteFunctionOpen(true)}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Delete
            </Button>
          </>
        }
      />

      {error && (
        <div className="mx-6 mt-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[240px] shrink-0 overflow-y-auto border-r bg-muted/30 p-3">
          <VersionNav
            versions={versions}
            latest={latest}
            selected={selectedVersion}
            usageCount={usageCount}
            onSelect={setSelectedVersion}
            onDeleteVersion={setVersionToDelete}
          />
        </aside>

        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          <div className="flex flex-col gap-4">
            <div data-testid="function-detail-header" className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold tabular-nums">{selected.version}</h2>
                {selected.version === latest && (
                  <Badge variant="info" className="h-5">
                    Latest
                  </Badge>
                )}
              </div>
              {selected.description && (
                <p className="text-sm text-muted-foreground break-words">{selected.description}</p>
              )}
              {selected.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selected.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {selected.published_by && (
                  <span className="inline-flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 shrink-0" />
                    {selected.published_by}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 shrink-0" />
                  {formatPublishedDate(selected.published_at)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  {usageSummary(selectedUsage)}
                </span>
              </div>
            </div>

            <FunctionDetailSections
              changelog={selected.changelog}
              details={selected.details}
              inputs={selected.inputs ?? []}
              outputs={selected.outputs ?? []}
              usage={selectedUsage}
            />
          </div>
        </div>
      </div>

      <ConfirmationDialog
        isOpen={versionToDelete !== null}
        onClose={() => setVersionToDelete(null)}
        onConfirm={() => { confirmDeleteVersion().catch(reportFailure) }}
        variant="delete"
        itemName={versionToDelete ? `version ${versionToDelete}` : undefined}
        description="This version is removed from the library. A Test pinned to it surfaces a missing-version alert on load - per-version delete never cascades to consuming Tests."
      />

      <ConfirmationDialog
        isOpen={deleteFunctionOpen}
        onClose={() => setDeleteFunctionOpen(false)}
        onConfirm={() => { confirmDeleteFunction().catch(reportFailure) }}
        variant="delete"
        itemName={functionName}
        description="This removes the Function and every published version. Tests that reference it surface a missing-version alert on load."
      />
    </div>
  )
}
