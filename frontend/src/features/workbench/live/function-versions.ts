/**
 * Library Function version reads, and the contract a Shared instance takes from them wherever it
 * lands after its Test has loaded: dropped, inserted, pasted, or inside a body that opens (REQ-3.1.2.4).
 */

import { useCallback, useEffect, useRef } from 'react'
import { walkActiveSubtree } from '@/features/functions/canvas/inner-workflow'
import { isFunctionAbsent, listFunctionVersions } from '@/features/functions/api/functions-api'
import type { VersionDescriptor } from '@/features/functions/api/types'
import {
  unresolvedSharedPins,
  type PinnedShared,
} from '@/features/workbench/lib/shared-function-contracts'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { startBlockingRead } from '@/hooks/use-blocking-reads'
import { usePageBlock } from '@/hooks/use-page-block'
import { formatFailureDetail, toFailureDetail, type FailureDetail } from '@/lib/failure-detail'

/** The read a failed contract read blocks the page with, as the Test load names it. */
export const FUNCTION_VERSIONS_LABEL = 'Function versions'

/** A Function whose library versions could not be read. */
export interface VersionReadFailure {
  functionId: string
  reason: unknown
}

export interface FunctionVersionReads {
  versions: Map<string, Map<string, VersionDescriptor>>
  failures: VersionReadFailure[]
}

/** One line per Function whose versions could not be read. */
export function versionsDetail(failures: VersionReadFailure[]): FailureDetail {
  if (failures.length === 1) return toFailureDetail(failures[0].reason)
  return {
    message: failures
      .map(({ functionId, reason }) => `${functionId}\n${formatFailureDetail(toFailureDetail(reason))}`)
      .join('\n\n'),
  }
}

/** Read each library Function's versions; a Function the library no longer holds is an answer, not a failure. */
export async function readFunctionVersions(functionIds: readonly string[]): Promise<FunctionVersionReads> {
  const ids = [...new Set(functionIds)]
  const versions = new Map<string, Map<string, VersionDescriptor>>()
  const failures: VersionReadFailure[] = []
  const reads = await Promise.allSettled(ids.map((functionId) => listFunctionVersions(functionId)))
  reads.forEach((read, index) => {
    if (read.status === 'rejected') {
      if (!isFunctionAbsent(read.reason)) failures.push({ functionId: ids[index], reason: read.reason })
      return
    }
    versions.set(ids[index], new Map(read.value.versions.map((v) => [v.version, v])))
  })
  return { versions, failures }
}

/**
 * A Shared instance that reaches the open canvas with no contract gets one: a Function already read
 * stamps it at once, any other is read when it appears, and a failed read blocks the page until
 * Try Again reads it (no-optional-success).
 */
export function useFunctionContracts(): void {
  const activeNodes = useWorkflowStore(
    (state) => walkActiveSubtree(state.nodes, state.edges, state.variables, state.drillPath).nodes,
  )
  const ready = useWorkflowStore((state) => state.isCanvasReady)
  const { blockPage, clearPageBlock } = usePageBlock()
  const known = useRef(new Map<string, Map<string, VersionDescriptor>>())
  const reading = useRef(new Set<string>())

  const readContracts = useCallback(
    async (functionIds: readonly string[]) => {
      try {
        const { versions, failures } = await readFunctionVersions(functionIds)
        for (const [functionId, versionMap] of versions) known.current.set(functionId, versionMap)
        useWorkflowStore.getState().applyFunctionContracts(versions)
        if (failures.length > 0) {
          throw failures.length === 1 ? failures[0].reason : new Error(versionsDetail(failures).message)
        }
        clearPageBlock(FUNCTION_VERSIONS_LABEL)
      } finally {
        for (const functionId of functionIds) reading.current.delete(functionId)
      }
    },
    [clearPageBlock],
  )

  useEffect(() => {
    if (!ready) return
    const pins = unresolvedSharedPins(activeNodes)
    const isKnown = (pin: PinnedShared) => known.current.get(pin.functionId)?.has(pin.functionVersion) === true
    // A pin read before has its versions here; one with no inputs or outputs stays as it is.
    const knownIds = new Set(pins.filter(isKnown).map((pin) => pin.functionId))
    if (knownIds.size > 0) {
      const cached = new Map([...knownIds].map((id) => [id, known.current.get(id) as Map<string, VersionDescriptor>]))
      useWorkflowStore.getState().applyFunctionContracts(cached)
    }
    const toRead = [
      ...new Set(
        pins
          .filter((pin) => !isKnown(pin) && !reading.current.has(pin.functionId))
          .map((pin) => pin.functionId),
      ),
    ]
    if (toRead.length === 0) return
    for (const functionId of toRead) reading.current.add(functionId)
    startBlockingRead({ label: FUNCTION_VERSIONS_LABEL, run: () => readContracts(toRead) }, blockPage)
  }, [ready, activeNodes, readContracts, blockPage])
}
