/**
 * V-SECRET-ENTITY-GRID-FUNCTIONAL: suite + regression secret grid alignment
 *
 * REQ: REQ-3.1.3.5 (a masked re-save keeps the sealed value; the grid's un-secure
 *      confirm-and-clear)
 *
 * Runs the same two proofs for BOTH entity scopes (per-scope round-trip):
 *  1. Round-trip guard: create a suite/regression with a secret variable
 *     (sealed on disk), then re-save the whole variables map with the secret
 *     echoed as the mask placeholder (as the grid does) plus an unrelated edit.
 *     The stored sealed envelope set is UNCHANGED (the guard preserved it, no
 *     placeholder re-seal), the unrelated edit persisted, and the canary never
 *     appears in cleartext anywhere in the store.
 *  2. Grid un-secure confirm-and-clear: the secret cell is masked write-only;
 *     unchecking Secret opens the "Remove Secret Protection?" confirm; Cancel
 *     keeps the value secret; confirming clears the value and drops protection,
 *     which persists as a readable plaintext variable after save + reload.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, STORAGE_BASE_PATH } from '../../helpers/config'
import {
  createEntity,
  entityVariableRow,
  openEntityValue,
  openEntityVariables,
  saveVariablesDialog,
  variablesDialog,
  type EntityScope,
} from '../../helpers/entity-variables'
import fs from 'fs'
import path from 'path'

const MASK = '********'
const ENVELOPE = 'wave:enc:v1:'

interface Scenario {
  kind: string
  scope: EntityScope
  base: 'suites' | 'regressions'
  detailTestId: string
  canary: string
}

const SCENARIOS: Scenario[] = [
  { kind: 'Suite', scope: 'suite', base: 'suites', detailTestId: 'suite-detail-page', canary: 'SUvar-9d1-uniform-real-bytes' },
  {
    kind: 'Regression',
    scope: 'regression',
    base: 'regressions',
    detailTestId: 'regression-detail-page',
    canary: 'RGvar-2e6-golf-real-bytes',
  },
]

// --- raw store inspection -------------------------------------------------

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
}

/** The unique set of sealed envelopes stored under any file for this entity.
 *  The guard preserves the exact stored envelope (idempotent), so a masked
 *  re-save must not grow this set; a regression seals the placeholder anew. */
function entityEnvelopes(entityId: string): string[] {
  const bytes = listFiles(STORAGE_BASE_PATH)
    .filter((file) => file.includes(entityId))
    .map((file) => fs.readFileSync(file))
  const text = Buffer.concat(bytes).toString('utf-8')
  const matches = text.match(/wave:enc:v1:[A-Za-z0-9+/=_-]+/g) ?? []
  return [...new Set(matches)].sort()
}

function sweepStore(needle: string): string[] {
  return listFiles(STORAGE_BASE_PATH).filter((file) => fs.readFileSync(file).includes(needle))
}

// --- API helpers ----------------------------------------------------------

function createScenarioEntity(request: APIRequestContext, sc: Scenario, name: string): Promise<string> {
  return createEntity(request, `/${sc.base}`, {
    name,
    variables: {
      entity_secret: { type: 'string', value: sc.canary, secret: true },
      plain_note: { type: 'string', value: 'note-v1', secret: false },
    },
  })
}

async function getVars(
  request: APIRequestContext,
  sc: Scenario,
  id: string,
): Promise<Record<string, { value: unknown; secret?: boolean }>> {
  const resp = await request.get(`${BACKEND_URL}/${sc.base}/${id}`)
  expect(resp.ok()).toBeTruthy()
  return (await resp.json()).data.variables
}

test.describe('V-SECRET-ENTITY-GRID-FUNCTIONAL', () => {
  for (const sc of SCENARIOS) {
    test(`${sc.kind}: masked re-save preserves the sealed value; un-secure prompts confirm-and-clear`, async ({
      page,
      request,
    }) => {
      test.setTimeout(120_000)
      const id = await createScenarioEntity(request, sc, `Secret Grid ${sc.kind} ${Date.now()}`)

      await test.step('Criterion 1: created sealed - canary absent from the store, secret reads masked', async () => {
        expect(sweepStore(sc.canary), 'the secret leaked into the store on create').toEqual([])
        const envelopes = entityEnvelopes(id)
        expect(envelopes.length, 'the secret must be sealed on disk').toBeGreaterThan(0)
        expect(envelopes.every((e) => e.startsWith(ENVELOPE))).toBeTruthy()

        const vars = await getVars(request, sc, id)
        expect(vars.entity_secret.value).toBe(MASK)
        expect(vars.plain_note.value).toBe('note-v1')
      })

      const before = entityEnvelopes(id)

      await test.step('Criterion 1: a masked re-save with an unrelated edit preserves the exact envelope', async () => {
        const resp = await request.put(`${BACKEND_URL}/${sc.base}/${id}`, {
          data: {
            variables: {
              entity_secret: { type: 'string', value: MASK, secret: true },
              plain_note: { type: 'string', value: 'note-v2', secret: false },
            },
          },
        })
        expect(resp.ok(), `masked re-save: ${resp.status()} ${await resp.text()}`).toBeTruthy()

        expect(sweepStore(sc.canary), 'the secret leaked after the re-save').toEqual([])
        expect(
          entityEnvelopes(id),
          'the sealed envelope set must be unchanged (no placeholder re-seal)',
        ).toEqual(before)

        const vars = await getVars(request, sc, id)
        expect(vars.plain_note.value, 'the unrelated edit must have persisted').toBe('note-v2')
        expect(vars.entity_secret.value, 'the secret still reads masked').toBe(MASK)
      })

      await test.step('Criterion 2: the secret cell is masked write-only; Cancel keeps it secret', async () => {
        const dialog = await openEntityVariables(page, sc.scope, id)
        const row = await entityVariableRow(dialog, 'entity_secret')
        const maskedCell = row.locator('button[aria-label="Edit protected value"]')
        await expect(maskedCell).toBeVisible()

        await row.locator('[data-testid^="variable-secret-"]').click()
        const confirm = page.getByRole('alertdialog').filter({ hasText: 'Remove Secret Protection?' })
        await expect(confirm).toBeVisible()
        await confirm.getByRole('button', { name: 'Cancel' }).click()
        await expect(confirm).toHaveCount(0)
        // The value is still secret (masked write-only cell remains).
        await expect(
          (await entityVariableRow(dialog, 'entity_secret')).locator('button[aria-label="Edit protected value"]'),
        ).toBeVisible()
      })

      await test.step('Criterion 2: confirming un-secure clears + drops protection; a plaintext value persists', async () => {
        const dialog = variablesDialog(page)
        const row = await entityVariableRow(dialog, 'entity_secret')
        await row.locator('[data-testid^="variable-secret-"]').click()
        const confirm = page.getByRole('alertdialog').filter({ hasText: 'Remove Secret Protection?' })
        await expect(confirm).toBeVisible()
        await confirm.getByRole('button', { name: 'Remove & Delete Value' }).click()

        // Protection dropped: the masked cell is gone, replaced by a plaintext cell.
        const cleared = await entityVariableRow(dialog, 'entity_secret')
        await expect(cleared.locator('button[aria-label="Edit protected value"]')).toHaveCount(0)

        // Re-enter a readable plaintext value through the shared value sheet.
        const sheet = await openEntityValue(page, cleared)
        await sheet.locator('.cm-content').first().click()
        await page.keyboard.type('now-plaintext')
        await sheet.locator('[data-testid="value-editor-save-button"]').click()
        await sheet.locator('[data-testid="value-editor-cancel-button"]').click()
        await expect(sheet).toBeHidden()

        await saveVariablesDialog(dialog)

        // Reload: the variable is now a readable plaintext value, not a secret.
        await page.goto(`/${sc.base}/${id}`)
        await expect(page.locator(`[data-testid="${sc.detailTestId}"]`)).toBeVisible({ timeout: 15_000 })
        const vars = await getVars(request, sc, id)
        expect(vars.entity_secret.value, 'un-secured value must read back in plaintext').toBe(
          'now-plaintext',
        )
        expect(vars.entity_secret.secret ?? false, 'protection must be dropped').toBe(false)
      })

      await request.delete(`${BACKEND_URL}/${sc.base}/${id}`).catch(() => {})
    })
  }
})
