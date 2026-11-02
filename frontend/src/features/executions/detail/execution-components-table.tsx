/**
 * ExecutionComponentsTable
 *
 * Dispatcher for the "Components" table shown on the Execution Detail
 * page. Routes the execution's entity_type to the appropriate per-entity
 * table:
 *
 *   suite       - flat list of the suite's tests with Search + Status
 *                 filter and pagination; Actions = View only.
 *   regression  - expandable suites-with-tests tree (REG-EX-2). Suites are
 *                 top-level rows; expanding a suite reveals its tests. The
 *                 DuplicateTestBadge appears on test rows that belong to
 *                 2+ suites of the regression.
 *
 * Test-type executions do not use this table; the list routes them
 * directly to the Historical Test Canvas.
 */

import type { ExecutionTestRow, ExecutionSuiteRow } from './_shared'
import { RegressionExecutionTable } from './regression-execution-table'
import { SuiteExecutionTable } from './suite-execution-table'

export interface ExecutionComponentsTableProps {
  executionId: string
  entityType: string
  tests?: ExecutionTestRow[]
  suites?: ExecutionSuiteRow[]
  /**
   * For regression executions: map of test_id to [suite_id, ...] for tests
   * that appear in 2+ suites of the regression. Used by the embedded
   * DuplicateTestBadge on the test rows inside an expanded suite.
   */
  duplicateTests?: Record<string, string[]>
}

export function ExecutionComponentsTable({
  executionId,
  entityType,
  tests,
  suites,
  duplicateTests,
}: Readonly<ExecutionComponentsTableProps>) {
  if (entityType === 'regression' && suites && suites.length > 0) {
    return (
      <RegressionExecutionTable
        executionId={executionId}
        suites={suites}
        duplicateTests={duplicateTests}
      />
    )
  }

  // suite execution, OR regression fallback when the record has no suites.
  return (
    <SuiteExecutionTable
      executionId={executionId}
      tests={tests ?? []}
    />
  )
}
