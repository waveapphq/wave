/**
 * V-FN-VAL-VER-01: top-level Shared version-availability gate.
 * REQ: REQ-3.1.2.2 / REQ-3.1.2.4.
 *
 * A Test whose top-level workflow holds a Shared Function instance pinned to a
 * version the library no longer has is BLOCKED by the canonical pipeline at
 * Validate (load), Run, Import, and Save. A disabled instance is exempt; a pin
 * to an available version is clean.
 *
 * Drives the validate contract at the API level (the UI cannot reach the
 * deleted-version state - POST /tests rejects it, so the broken state is
 * raw-persisted via the admin bulk endpoint).
 *
 * Pass Criteria:
 *   1. validate?context=run    -> 422 + MISSING_FUNCTION_VERSION, exact message.
 *   2. validate?context=load   -> 422 + MISSING_FUNCTION_VERSION (Validate blocked).
 *   3. validate?context=import -> 422 + MISSING_FUNCTION_VERSION.
 *   4. POST /tests (Save path)  -> 422 (Save blocked).
 *   5. A disabled instance pinned to the missing version is exempt (clean).
 *   6. A pin to the available version (1.0.0) is clean.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  publishLibraryFunction,
  rawPersistTest,
  sharedNode,
  startEdge,
  validateTest,
  codesOf,
  postTestStatus,
} from '../../helpers/fn-seed'

const MISSING_VERSION = '2.0.0'
const VER_MESSAGE = 'Pinned version 2.0.0 is no longer available in the library'

test.describe('V-FN-VAL-VER-01: top-level Shared missing-version gate', () => {
  test('missing version blocks Validate / Run / Import / Save; disabled + available are clean', async ({
    request,
  }) => {
    // Library has ONLY 1.0.0; instances will pin the absent 2.0.0.
    const fn = await publishLibraryFunction(request, { name: `VerGate ${Date.now()}` })

    const missingId = await rawPersistTest(request, {
      name: 'V-FN-VAL-VER-01 missing-version',
      nodes: [
        sharedNode('shared-1', {
          functionId: fn.functionId,
          functionVersion: MISSING_VERSION,
          label: 'Greet',
          originalLibraryName: fn.name,
        }),
      ],
      edges: [startEdge('shared-1')],
    })

    // 1. Run blocked.
    const run = await validateTest(request, missingId, 'run')
    expect(run.status, 'Run validation must be blocked (422)').toBe(422)
    expect(run.errorCode).toBe('VALIDATION_ERRORS')
    const runVer = run.errors.filter((e) => e.code === 'MISSING_FUNCTION_VERSION')
    expect(runVer, codesOf(run.errors).join(',')).toHaveLength(1)
    expect(String(runVer[0].message)).toMatch(
      /^Pinned version 2\.0\.0 is no longer available in the library$/,
    )
    expect(String(runVer[0].message)).toBe(VER_MESSAGE)
    // The raw Function UUID must never leak into the no-code author's view.
    expect(String(runVer[0].message)).not.toContain(fn.functionId)
    expect(runVer[0].node_label).toBe('Greet')

    // 2. Validate (load context) blocked.
    const load = await validateTest(request, missingId, 'load')
    expect(load.status, 'Validate (load) must be blocked (422)').toBe(422)
    expect(codesOf(load.errors)).toContain('MISSING_FUNCTION_VERSION')

    // 3. Import blocked.
    const imp = await validateTest(request, missingId, 'import')
    expect(imp.status).toBe(422)
    expect(codesOf(imp.errors)).toContain('MISSING_FUNCTION_VERSION')

    // 4. Save (create write-path) blocked.
    const saveStatus = await postTestStatus(request, {
      name: 'V-FN-VAL-VER-01 save-blocked',
      nodes: [
        sharedNode('shared-save', {
          functionId: fn.functionId,
          functionVersion: MISSING_VERSION,
          label: 'Greet',
          originalLibraryName: fn.name,
        }),
      ],
      edges: [startEdge('shared-save')],
    })
    expect(saveStatus, 'Save must reject the missing-version Test (422)').toBe(422)

    // 5. Disabled instance is exempt (no validation, no block).
    const disabledId = await rawPersistTest(request, {
      name: 'V-FN-VAL-VER-01 disabled-exempt',
      nodes: [
        sharedNode('shared-disabled', {
          functionId: fn.functionId,
          functionVersion: MISSING_VERSION,
          label: 'Greet',
          originalLibraryName: fn.name,
          disabled: true,
        }),
      ],
      edges: [startEdge('shared-disabled')],
    })
    const disabled = await validateTest(request, disabledId, 'run')
    expect(disabled.status, 'disabled node is exempt -> clean (200)').toBe(200)
    expect(codesOf(disabled.errors)).not.toContain('MISSING_FUNCTION_VERSION')

    // 6. Pin to the available version is clean.
    const cleanId = await rawPersistTest(request, {
      name: 'V-FN-VAL-VER-01 available-clean',
      nodes: [
        sharedNode('shared-ok', {
          functionId: fn.functionId,
          functionVersion: '1.0.0',
          label: 'Greet',
          originalLibraryName: fn.name,
        }),
      ],
      edges: [startEdge('shared-ok')],
    })
    const clean = await validateTest(request, cleanId, 'run')
    expect(clean.status, 'pinned to available version -> clean (200)').toBe(200)
    expect(codesOf(clean.errors)).not.toContain('MISSING_FUNCTION_VERSION')
  })
})
