/**
 * Pure grouping + tree building for the artifact drill (no React, no API).
 *
 * Routes a flat ArtifactMeta list into the four drill sections (failure /
 * reports / logs / files) and builds a nested path tree for the Logs/Files
 * Tree view. Removed (tombstoned) artifacts group by path exactly like live
 * ones.
 */

import { buildPathTree, type PathTreeNode } from '@/lib/path-tree'
import type { ArtifactMeta } from '@/features/artifacts/api/types'

export interface ArtifactSections {
  failure: ArtifactMeta[]
  reports: ArtifactMeta[]
  logs: ArtifactMeta[]
  files: ArtifactMeta[]
}

export interface ArtifactTreeNode {
  name: string
  path: string
  children: ArtifactTreeNode[]
  artifact: ArtifactMeta | null
}

const FAILURE_NAME = 'error.json'
const REPORT_NAMES = new Set(['report.json', 'report.html'])
const LOGS_PREFIX = 'logs/'

export function groupArtifactSections(artifacts: ArtifactMeta[]): ArtifactSections {
  const sections: ArtifactSections = { failure: [], reports: [], logs: [], files: [] }
  for (const artifact of artifacts) {
    const path = artifact.path
    if (path === FAILURE_NAME) {
      sections.failure.push(artifact)
    } else if (REPORT_NAMES.has(path)) {
      sections.reports.push(artifact)
    } else if (path.startsWith(LOGS_PREFIX)) {
      sections.logs.push(artifact)
    } else {
      sections.files.push(artifact)
    }
  }
  return sections
}

function toArtifactNode(node: PathTreeNode<ArtifactMeta>): ArtifactTreeNode {
  return {
    name: node.name,
    path: node.path,
    children: node.children.map(toArtifactNode),
    artifact: node.item,
  }
}

/** Keeps the server's order: no folders-first sorting on the artifact tree. */
export function buildArtifactTree(artifacts: ArtifactMeta[]): ArtifactTreeNode[] {
  return buildPathTree(artifacts, (artifact) => artifact.path).map(toArtifactNode)
}

export type LogEntityKind = 'regression' | 'suite' | 'test'

const LOGS_PREFIX_RE = /^logs\//
const LOG_SUFFIX_RE = /\.log$/

/**
 * Logs tree rooted at the entity level: the shared `logs/` prefix is unwrapped
 * so the forest reads Suite > Test (Regression > Suite > Test when logs nest
 * deeper), matching the execution's entity hierarchy.
 */
export function buildLogTree(artifacts: ArtifactMeta[]): ArtifactTreeNode[] {
  return buildArtifactTree(artifacts).flatMap((root) =>
    root.name === 'logs' ? root.children : [root],
  )
}

/**
 * Entity kind of a Logs-tree node from its structure: a leaf is a test, a
 * directory of directories is a regression, a directory of leaves is a suite.
 */
export function logEntityKind(node: ArtifactTreeNode): LogEntityKind {
  if (node.artifact) {
    return 'test'
  }
  return node.children.some((child) => !child.artifact) ? 'regression' : 'suite'
}

/**
 * Failure-correlation key for a test log node: `<suite>/<test>` (the node path
 * minus the `logs/` prefix and `.log` suffix), matching error.json scope_path.
 */
export function logScopeKey(node: ArtifactTreeNode): string {
  return node.path.replace(LOGS_PREFIX_RE, '').replace(LOG_SUFFIX_RE, '')
}

/** Total bytes of every leaf artifact under a node (its subtree rollup). */
export function subtreeSize(node: ArtifactTreeNode): number {
  let total = node.artifact ? node.artifact.size_bytes : 0
  for (const child of node.children) {
    total += subtreeSize(child)
  }
  return total
}

const FILE_DESCRIPTIONS: Record<string, string> = {
  'error.json': 'Causal error / fatal logs across all failures',
  'report.html': 'Self-contained execution report',
  'report.json': 'Canonical report model',
}

/** Human description for the well-known artifact files (else undefined). */
export function knownFileDescription(name: string): string | undefined {
  return FILE_DESCRIPTIONS[name.toLowerCase()]
}

export interface NodeCounts {
  failed: number
  total: number
  unit: 'suites' | 'tests'
}

function countFailedLeaves(node: ArtifactTreeNode, failedScopes: Set<string>): number {
  if (node.artifact) {
    return failedScopes.has(logScopeKey(node)) ? 1 : 0
  }
  let failed = 0
  for (const child of node.children) {
    failed += countFailedLeaves(child, failedScopes)
  }
  return failed
}

/**
 * Roll up a Logs-tree directory node's meta counts: failed test leaves in the
 * subtree, and the direct-child total (suites for a regression, tests for a
 * suite).
 */
export function nodeCounts(node: ArtifactTreeNode, failedScopes: Set<string>): NodeCounts {
  return {
    failed: countFailedLeaves(node, failedScopes),
    total: node.children.length,
    unit: logEntityKind(node) === 'regression' ? 'suites' : 'tests',
  }
}
