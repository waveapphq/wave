/**
 * V-FN-IMPORT-SAFETY-01 (functional): Function import is safe against manual
 * file edits.
 *
 * REQ: REQ-3.1.2.5
 * Covers: round-trip identical; a UUID-colliding file -> rename -> new
 * Function with the original untouched; history-preserving overwrite.
 *
 * Phase: functional-workflow (self-seeds via POST /functions; per-run unique
 * names + the backend-assigned ids keep it isolated, like functions-import-export).
 *
 * Import is hardened against a file whose `id` already belongs to a
 * DIFFERENT library entry (a hand edit or a cross-library copy). Such a file
 * is a resolvable conflict on the id axis:
 *   - validate annotates the row with conflict_reason "id"
 *   - rename mints a FRESH uuid, leaving the colliding entry untouched
 *   - overwrite targets the colliding id (no duplicate entry)
 *   - skip / no-resolution reports `UUID '<id>' already exists in the library`
 * Overwrite upserts version(s) onto the existing entry instead of wiping
 * it, so available versions become existing UNION imported.
 *
 * The intra-batch dependency remap (a renamed dependency rewired in its
 * dependents) is a ZIP-batch behavior with no E2E ZIP-writer available; it is
 * covered at the service layer by
 * backend/tests/api/services/functions/test_import_collision.py
 * (TestIntraBatchDependencyRemap).
 *
 * Pass Criteria:
 * 1. A clean re-import restores the SAME id (idempotent round-trip).
 * 2. An id-colliding file validates as conflict_reason "id"; rename mints a new
 *    id and the original entry keeps its name + versions.
 * 3. skip leaves the library unchanged and reports the UUID reason.
 * 4. overwrite targets the colliding id without creating a second entry.
 * 5. overwrite preserves prior history (a single-version file does not truncate;
 *    available = existing UNION imported).
 * 6. A full-history export re-imported under overwrite is lossless.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { publishLibraryFunction, addLibraryVersion } from '../../helpers/fn-seed'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const RUN = randomUUID().slice(0, 8)

type MultipartField = string | { name: string; mimeType: string; buffer: Buffer }

/** A structurally-valid single-Function import document. */
function importDoc(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: randomUUID(),
    name: `Doc-${RUN}`,
    description: '',
    tags: [],
    inputs: [],
    outputs: [],
    dependencies: { functions: [], plugins: [] },
    workflow: { nodes: [], edges: [] },
    version: '1.0.0',
    ...overrides,
  }
}

/** Multipart body for a JSON import doc (+ optional name-keyed resolutions).
 *  JSON is also valid YAML, so the document parses regardless of how the
 *  backend keys off the `.json` extension. */
function importBody(
  doc: Record<string, unknown>,
  resolutions?: Record<string, string>,
): Record<string, MultipartField> {
  const multipart: Record<string, MultipartField> = {
    file: { name: 'import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) },
  }
  if (resolutions) multipart.conflict_resolutions = JSON.stringify(resolutions)
  return multipart
}

async function validate(request: APIRequestContext, doc: Record<string, unknown>): Promise<Record<string, any>> {
  const resp = await request.post(`${BACKEND_URL}/functions/import/validate`, { multipart: importBody(doc) })
  expect(resp.ok(), `validate: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  return (await resp.json()).data
}

async function commit(
  request: APIRequestContext,
  doc: Record<string, unknown>,
  resolutions?: Record<string, string>,
): Promise<Record<string, any>> {
  const resp = await request.post(`${BACKEND_URL}/functions/import`, { multipart: importBody(doc, resolutions) })
  expect(resp.ok(), `import: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  return (await resp.json()).data
}

/** The library entry's name + currently-available versions (proves untouched). */
async function loadFn(
  request: APIRequestContext,
  id: string,
): Promise<{ name: string; available_versions: string[] }> {
  const resp = await request.get(`${BACKEND_URL}/functions/${id}`)
  expect(resp.ok(), `GET /functions/${id}: ${resp.status()}`).toBeTruthy()
  return (await resp.json()).data
}

test.describe('V-FN-IMPORT-SAFETY-01: Function import safety', () => {
  test('a clean re-import restores the same id (idempotent round-trip)', async ({ request }) => {
    const fn = await publishLibraryFunction(request, { name: `RtId-${RUN}-${randomUUID().slice(0, 4)}` })
    const exported = await (await request.get(`${BACKEND_URL}/functions/${fn.functionId}/export`)).text()
    await request.delete(`${BACKEND_URL}/functions/${fn.functionId}`)

    const resp = await request.post(`${BACKEND_URL}/functions/import`, {
      multipart: { file: { name: `${fn.name}.yaml`, mimeType: 'application/x-yaml', buffer: Buffer.from(exported) } },
    })
    expect(resp.ok(), `import: ${resp.status()} ${await resp.text()}`).toBeTruthy()
    const result = (await resp.json()).data
    expect(result.imported[0].action).toBe('created')
    // Idempotent: a clean re-import keeps the original id, never mints a fresh one.
    expect(result.imported[0].id).toBe(fn.functionId)
    expect((await loadFn(request, fn.functionId)).name).toBe(fn.name)
  })

  test('id-colliding file validates reason "id"; rename mints a fresh id, original untouched', async ({
    request,
  }) => {
    const existing = await publishLibraryFunction(request, { name: `OrigG-${RUN}-${randomUUID().slice(0, 4)}` })
    const importName = `NewG-${RUN}-${randomUUID().slice(0, 4)}`
    // Fresh name, but the file's id is the existing entry's id -> id-only collision.
    const doc = importDoc({ id: existing.functionId, name: importName, version: '2.0.0' })

    const val = await validate(request, doc)
    const item = (val.items as Array<{ name: string; status: string; conflict_reason?: string }>).find(
      (i) => i.name === importName,
    )
    expect(item?.status).toBe('conflict')
    expect(item?.conflict_reason).toBe('id')

    const result = await commit(request, doc, { [importName]: 'rename' })
    const entry = result.imported[0]
    expect(entry.action).toBe('renamed')
    expect(entry.id).not.toBe(existing.functionId)
    // An id-only collision keeps the file's name (only the id had to change).
    expect(entry.name).toBe(importName)

    // The pre-existing entry is untouched: same name, the incoming 2.0.0 was NOT injected.
    const original = await loadFn(request, existing.functionId)
    expect(original.name).toBe(existing.name)
    expect(new Set(original.available_versions)).toEqual(new Set(['1.0.0']))
    // The renamed copy is a separate entry carrying its own 2.0.0.
    expect(new Set((await loadFn(request, entry.id)).available_versions)).toEqual(new Set(['2.0.0']))
  })

  test('id-collision skip leaves the library unchanged and reports the UUID reason', async ({ request }) => {
    const existing = await publishLibraryFunction(request, { name: `SkipG-${RUN}-${randomUUID().slice(0, 4)}` })
    const importName = `SkipNew-${RUN}-${randomUUID().slice(0, 4)}`
    const doc = importDoc({ id: existing.functionId, name: importName, version: '2.0.0' })

    const result = await commit(request, doc, { [importName]: 'skip' })
    expect(result.total_imported).toBe(0)
    expect(result.total_skipped).toBe(1)
    expect(result.skipped[0].reason).toBe(`UUID '${existing.functionId}' already exists in the library`)

    const original = await loadFn(request, existing.functionId)
    expect(original.name).toBe(existing.name)
    expect(new Set(original.available_versions)).toEqual(new Set(['1.0.0']))
  })

  test('id-collision overwrite targets the colliding id without creating a second entry', async ({ request }) => {
    const existing = await publishLibraryFunction(request, { name: `OvwG-${RUN}-${randomUUID().slice(0, 4)}` })
    const importName = `OvwNew-${RUN}-${randomUUID().slice(0, 4)}`
    const doc = importDoc({ id: existing.functionId, name: importName, version: '2.0.0' })

    const result = await commit(request, doc, { [importName]: 'overwrite' })
    const entry = result.imported[0]
    expect(entry.action).toBe('overwritten')
    // Overwrite re-uses the colliding id; no fresh entry is minted.
    expect(entry.id).toBe(existing.functionId)
    // The file's 2.0.0 is upserted onto the existing entry (1.0.0 survives).
    expect(new Set((await loadFn(request, existing.functionId)).available_versions)).toEqual(
      new Set(['1.0.0', '2.0.0']),
    )
  })

  test('overwrite preserves prior history (a single-version file does not truncate)', async ({ request }) => {
    const fn = await publishLibraryFunction(request, { name: `HistG-${RUN}-${randomUUID().slice(0, 4)}` })
    await addLibraryVersion(request, fn, { sourceVersion: '1.0.0', targetVersion: '2.0.0' })

    // A hand-authored file carrying ONLY 3.0.0 must not wipe 1.0.0 / 2.0.0.
    const doc = importDoc({ id: fn.functionId, name: fn.name, version: '3.0.0' })
    const result = await commit(request, doc, { [fn.name]: 'overwrite' })
    expect(result.imported[0].action).toBe('overwritten')

    const after = await loadFn(request, fn.functionId)
    expect(new Set(after.available_versions)).toEqual(new Set(['1.0.0', '2.0.0', '3.0.0']))
  })

  test('a full-history export re-imported under overwrite is lossless', async ({ request }) => {
    const fn = await publishLibraryFunction(request, { name: `LossG-${RUN}-${randomUUID().slice(0, 4)}` })
    await addLibraryVersion(request, fn, { sourceVersion: '1.0.0', targetVersion: '2.0.0' })
    const exported = await (await request.get(`${BACKEND_URL}/functions/${fn.functionId}/export`)).text()

    const resp = await request.post(`${BACKEND_URL}/functions/import`, {
      multipart: {
        file: { name: `${fn.name}.yaml`, mimeType: 'application/x-yaml', buffer: Buffer.from(exported) },
        conflict_resolutions: JSON.stringify({ [fn.name]: 'overwrite' }),
      },
    })
    expect(resp.ok(), `import: ${resp.status()} ${await resp.text()}`).toBeTruthy()
    const result = (await resp.json()).data
    expect(result.imported[0].action).toBe('overwritten')
    expect(new Set((await loadFn(request, fn.functionId)).available_versions)).toEqual(new Set(['1.0.0', '2.0.0']))
  })
})
