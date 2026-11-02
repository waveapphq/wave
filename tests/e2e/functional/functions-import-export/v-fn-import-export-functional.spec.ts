/**
 * V-LIB-EXPORT-01 / V-LIB-IMPORT-01 (functional): Function import/export against
 * the real backend, rebuilt to the Tests/Suites per-feature pattern.
 *
 * REQ: REQ-3.1.2.5
 * Covers: export single + ZIP round-trip; import dry-run preview + commit
 * with rename/overwrite/skip; dependency-ordered batch.
 *
 * Phase: functional-destructive (creates + deletes library Functions).
 *
 * Covers:
 *   - GET /functions/{id}/export single YAML + JSON
 *   - POST /functions/export ZIP for 2+ ids
 *   - POST /functions/import/validate is a dry-run that persists nothing
 *   - POST /functions/import commits; conflict resolutions rename / overwrite / skip
 *   - a dependent pair round-trips (dependency-ordered import)
 *   - the /functions page Import dialog imports a real file end-to-end
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { sharedNode, startEdge, type SeededLibraryFunction } from '../../helpers/fn-seed'
import { BACKEND_URL } from '../../helpers/config'
import { readZipEntry, zipEntryNames } from '../../helpers/zip-reader'
import { buildZip } from '../../helpers/zip-writer'
import { randomUUID } from 'node:crypto'

type MultipartField = string | { name: string; mimeType: string; buffer: Buffer }

const RUN = randomUUID().slice(0, 8)

async function listByName(request: APIRequestContext, name: string): Promise<string[]> {
  const resp = await request.get(`${BACKEND_URL}/functions?search=${encodeURIComponent(name)}&per_page=100`)
  const body = await resp.json()
  return (body.data as Array<{ name: string }>).map((f) => f.name)
}

async function postFunction(
  request: APIRequestContext,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<SeededLibraryFunction> {
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'import/export seed',
      tags: [],
      inputs: [],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial',
      details: '',
      ...extra,
    },
  })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /functions ${name}: ${resp.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return { functionId: body.data.id, name, version: '1.0.0' }
}

function importMultipart(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  resolutions?: Record<string, string>,
): Record<string, MultipartField> {
  const multipart: Record<string, MultipartField> = { file: { name: filename, mimeType, buffer } }
  if (resolutions) multipart.conflict_resolutions = JSON.stringify(resolutions)
  return multipart
}

test.describe('V-LIB-EXPORT-01 / V-LIB-IMPORT-01: Function import/export', () => {
  // Nothing resets the Function library between phases. `cascade=true` is
  // load-bearing: the listing is in uuid order, and a plain delete of a Function
  // that still has a dependent is refused.
  test.afterAll(async ({ request }) => {
    const listed = await request.get(`${BACKEND_URL}/functions?search=${RUN}&per_page=100`)
    expect(listed.ok(), `cleanup list failed: ${listed.status()}`).toBeTruthy()
    const left = (await listed.json()).data as Array<{ id: string; name: string }>
    for (const fn of left) {
      const deleted = await request.delete(`${BACKEND_URL}/functions/${fn.id}?cascade=true`)
      expect(deleted.ok(), `cleanup delete of ${fn.name} failed: ${deleted.status()}`).toBeTruthy()
    }
    const after = await request.get(`${BACKEND_URL}/functions?search=${RUN}&per_page=100`)
    expect((await after.json()).pagination.total, 'Functions left behind').toBe(0)
  })

  test('export single Function as YAML and JSON', async ({ request }) => {
    const fn = await postFunction(request, `ExpFn-${RUN}-${randomUUID().slice(0, 6)}`)

    const yamlResp = await request.get(`${BACKEND_URL}/functions/${fn.functionId}/export?format=yaml`)
    expect(yamlResp.ok()).toBeTruthy()
    expect(yamlResp.headers()['content-type']).toContain('yaml')
    expect(await yamlResp.text()).toContain(fn.name)

    const jsonResp = await request.get(`${BACKEND_URL}/functions/${fn.functionId}/export?format=json`)
    expect(jsonResp.ok()).toBeTruthy()
    expect(JSON.stringify(await jsonResp.json())).toContain(fn.name)
  })

  test('export 2 Functions returns a ZIP that round-trips on import', async ({ request }) => {
    const a = await postFunction(request, `ZipA-${RUN}-${randomUUID().slice(0, 6)}`)
    const b = await postFunction(request, `ZipB-${RUN}-${randomUUID().slice(0, 6)}`)

    const zipResp = await request.post(`${BACKEND_URL}/functions/export`, {
      data: { ids: [a.functionId, b.functionId], format: 'yaml' },
    })
    expect(zipResp.ok()).toBeTruthy()
    expect(zipResp.headers()['content-type']).toContain('zip')
    const zipBytes = Buffer.from(await zipResp.body())

    // Remove both, then re-import the ZIP -> both Functions come back.
    await request.delete(`${BACKEND_URL}/functions/${a.functionId}`)
    await request.delete(`${BACKEND_URL}/functions/${b.functionId}`)
    const importResp = await request.post(`${BACKEND_URL}/functions/import`, {
      multipart: importMultipart(zipBytes, 'functions-export.zip', 'application/zip'),
    })
    expect(importResp.ok()).toBeTruthy()
    const result = (await importResp.json()).data
    expect(result.total_imported).toBeGreaterThanOrEqual(2)
    const names = await listByName(request, `Zip`)
    expect(names).toContain(a.name)
    expect(names).toContain(b.name)
  })

  test('validate is a dry-run; import commits', async ({ request }) => {
    const fn = await postFunction(request, `DryFn-${RUN}-${randomUUID().slice(0, 6)}`)
    const yaml = Buffer.from(await (await request.get(`${BACKEND_URL}/functions/${fn.functionId}/export`)).text())
    await request.delete(`${BACKEND_URL}/functions/${fn.functionId}`)

    // Dry-run validate: reports the item, persists nothing.
    const valResp = await request.post(`${BACKEND_URL}/functions/import/validate`, {
      multipart: importMultipart(yaml, `${fn.name}.yaml`, 'application/x-yaml'),
    })
    expect(valResp.ok()).toBeTruthy()
    const val = (await valResp.json()).data
    expect(val.items.map((i: { name: string }) => i.name)).toContain(fn.name)
    expect(val.importable).toBeGreaterThanOrEqual(1)
    expect(await listByName(request, fn.name), 'validate must persist nothing').not.toContain(fn.name)

    // Commit: the Function is recreated.
    const impResp = await request.post(`${BACKEND_URL}/functions/import`, {
      multipart: importMultipart(yaml, `${fn.name}.yaml`, 'application/x-yaml'),
    })
    expect(impResp.ok()).toBeTruthy()
    expect((await impResp.json()).data.imported[0].action).toBe('created')
    expect(await listByName(request, fn.name)).toContain(fn.name)
  })

  test('conflict resolutions: skip and overwrite', async ({ request }) => {
    const fn = await postFunction(request, `ConFn-${RUN}-${randomUUID().slice(0, 6)}`)
    const yaml = Buffer.from(await (await request.get(`${BACKEND_URL}/functions/${fn.functionId}/export`)).text())

    // The Function still exists -> validate flags a conflict with an existing id.
    const valResp = await request.post(`${BACKEND_URL}/functions/import/validate`, {
      multipart: importMultipart(yaml, `${fn.name}.yaml`, 'application/x-yaml'),
    })
    const item = (await valResp.json()).data.items[0]
    expect(item.status).toBe('conflict')
    expect(item.existing_id).toBeTruthy()

    // skip -> nothing imported.
    const skipResp = await request.post(`${BACKEND_URL}/functions/import`, {
      multipart: importMultipart(yaml, `${fn.name}.yaml`, 'application/x-yaml', { [fn.name]: 'skip' }),
    })
    expect((await skipResp.json()).data.total_skipped).toBeGreaterThanOrEqual(1)

    // overwrite -> action overwritten.
    const overResp = await request.post(`${BACKEND_URL}/functions/import`, {
      multipart: importMultipart(yaml, `${fn.name}.yaml`, 'application/x-yaml', { [fn.name]: 'overwrite' }),
    })
    expect((await overResp.json()).data.imported[0].action).toBe('overwritten')
  })

  test('conflict resolution: rename keeps both Functions', async ({ request }) => {
    // A real rename conflict: the imported file's NAME collides with a DIFFERENT
    // existing Function, so rename imports it under a unique name.
    const original = await postFunction(request, `RenFn-${RUN}-${randomUUID().slice(0, 6)}`)
    const yaml = Buffer.from(await (await request.get(`${BACKEND_URL}/functions/${original.functionId}/export`)).text())
    await request.delete(`${BACKEND_URL}/functions/${original.functionId}`)
    // Re-create a DIFFERENT Function that occupies the same name.
    await postFunction(request, original.name)

    const renResp = await request.post(`${BACKEND_URL}/functions/import`, {
      multipart: importMultipart(yaml, `${original.name}.yaml`, 'application/x-yaml', { [original.name]: 'rename' }),
    })
    const renamed = (await renResp.json()).data.imported[0]
    expect(renamed.action).toBe('renamed')
    expect(renamed.name).not.toBe(original.name)
  })

  test('a dependent pair round-trips dependency-ordered', async ({ request }) => {
    const dep = await postFunction(request, `DepBase-${RUN}-${randomUUID().slice(0, 6)}`)
    // The consumer depends on it through its body: one block that calls it.
    const consumer = await postFunction(request, `DepUser-${RUN}-${randomUUID().slice(0, 6)}`, {
      workflow: {
        nodes: [
          sharedNode('call-dep', {
            functionId: dep.functionId,
            functionVersion: dep.version,
            label: dep.name,
          }),
        ],
        edges: [startEdge('call-dep')],
      },
    })

    const exportResp = await request.post(`${BACKEND_URL}/functions/export`, {
      data: { ids: [consumer.functionId, dep.functionId], format: 'yaml' },
    })
    expect(exportResp.ok(), `export: ${exportResp.status()}`).toBeTruthy()
    const exported = Buffer.from(await exportResp.body())
    // The uploaded file holds the dependent first, so the order asserted below is the import's own.
    const members = zipEntryNames(exported).map((name) => ({ name, data: readZipEntry(exported, name) }))
    const ofConsumer = members.filter((member) => member.data.includes(consumer.functionId))
    const ofDependency = members.filter((member) => !member.data.includes(consumer.functionId))
    expect([ofConsumer.length, ofDependency.length], 'one member per Function').toEqual([1, 1])
    const zipBytes = buildZip([...ofConsumer, ...ofDependency])

    // The consumer goes first: a Function that still has a caller is not deleted.
    for (const fn of [consumer, dep]) {
      const deleted = await request.delete(`${BACKEND_URL}/functions/${fn.functionId}`)
      expect(deleted.ok(), `delete of ${fn.name}: ${deleted.status()}`).toBeTruthy()
    }

    const impResp = await request.post(`${BACKEND_URL}/functions/import`, {
      multipart: importMultipart(zipBytes, 'functions-export.zip', 'application/zip'),
    })
    expect(impResp.ok(), `import: ${impResp.status()}`).toBeTruthy()
    const imported = (await impResp.json()).data.imported as Array<{ name: string; id: string }>
    const names = imported.map((i) => i.name)
    // The dependency commits before its dependent.
    expect(names.indexOf(dep.name)).toBeGreaterThanOrEqual(0)
    expect(names.indexOf(dep.name)).toBeLessThan(names.indexOf(consumer.name))

    // The stored dependency list names the dependency, read from the body.
    const depId = imported[names.indexOf(dep.name)].id
    const consumerId = imported[names.indexOf(consumer.name)].id
    const stored = await request.get(`${BACKEND_URL}/functions/${consumerId}`)
    expect(stored.ok(), `GET imported ${consumer.name}: ${stored.status()}`).toBeTruthy()
    expect((await stored.json()).data.dependencies.functions).toEqual([depId])
  })

  test('the /functions Import dialog imports a real file end-to-end', async ({ page, request }) => {
    const fn = await postFunction(request, `UiImp-${RUN}-${randomUUID().slice(0, 6)}`)
    const yaml = await (await request.get(`${BACKEND_URL}/functions/${fn.functionId}/export`)).text()
    await request.delete(`${BACKEND_URL}/functions/${fn.functionId}`)

    await page.goto('/functions')
    await expect(page.locator('[data-testid="functions-page"]')).toBeVisible()
    await page.locator('[data-testid="import-button"]').click()

    const dialog = page.locator('[data-testid="import-dialog"]')
    await expect(dialog).toBeVisible()
    await dialog.locator('[data-testid="file-input"]').setInputFiles({
      name: `${fn.name}.yaml`,
      mimeType: 'application/x-yaml',
      buffer: Buffer.from(yaml),
    })
    await dialog.locator('[data-testid="validate-button"]').click()
    await expect(dialog.locator('[data-testid="review-step"]')).toBeVisible()
    await dialog.locator('[data-testid="import-button"]').click()

    // The imported Function shows up in the list.
    await page.locator('[data-testid="search-input"] input').fill(fn.name)
    await expect(page.locator('[data-testid="function-name"]').filter({ hasText: fn.name })).toBeVisible()
  })
})
