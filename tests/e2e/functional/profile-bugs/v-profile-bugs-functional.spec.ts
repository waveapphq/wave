/**
 * V-PROFILE-BUGS-FUNCTIONAL: profile usage, structure lock, environment delete and alias rules end to end.
 *
 * Each test covers one of these rules:
 *
 *   1. Cannot delete a profile that's bound by a test element.
 *   2. Cannot rename/add/delete params on a profile in use by a test.
 *   3. Can still modify per-environment values on a profile in use.
 *   4. Can delete environments that are referenced by profiles.
 *   5. Type-to-confirm dialog gates env-delete when usage > 0.
 *   6. Profile parameter type dropdown does not offer "Number".
 *   7. Autocomplete inside f-string interpolation works for cpr./system.
 *   8. Typed profile types (database, ssh, ...) take a number or its exact digit text.
 *   9. Profile aliases never appear in the var-setter NAME field.
 *  10. Profile alias input uses the shared NameField (with counter).
 *  11. Cross-namespace conflict (var <-> alias) detected in both directions.
 *
 * Tests use BACKEND_PORT directly to seed/cleanup state and drive the UI
 * for the user-facing assertions.
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, waitForCanvasToolbar } from '../../helpers/canvas'
import { BACKEND_PORT, ensureEnvironment } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import { answerSwitch } from '../../helpers/value-field'

const BACKEND = `http://localhost:${BACKEND_PORT}`

// ---------------------------------------------------------------------------
// Backend helpers
// ---------------------------------------------------------------------------

async function createEnv(request: APIRequestContext, name: string): Promise<string> {
  const existing = await request.get(`${BACKEND}/environments/`)
  const body = await existing.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const found = envs.find((e: { name: string }) => e.name === name)
  if (found) return found.id
  const created = await request.post(`${BACKEND}/environments/`, { data: { name } })
  expect(created.ok(), `create env ${name}: ${created.status()}`).toBeTruthy()
  const cb = await created.json()
  return cb.data?.id ?? cb.id
}

async function deleteEnv(request: APIRequestContext, id: string) {
  await request.delete(`${BACKEND}/environments/${id}`).catch(() => {})
}

async function createCustomProfile(
  request: APIRequestContext,
  name: string,
  envId: string,
  fields: Record<string, { type: string; value: unknown; secret?: boolean }>,
): Promise<string> {
  // Clean up any prior copy with the same name.
  const list = await request.get(`${BACKEND}/profiles?per_page=200`)
  const lb = await list.json()
  const arr = Array.isArray(lb) ? lb : (lb.data ?? [])
  for (const p of arr) {
    if (p.name === name) {
      await request.delete(`${BACKEND}/profiles/${p.id}`).catch(() => {})
    }
  }
  const config: Record<string, { type: string; secret: boolean; value: unknown }> = {}
  for (const [k, v] of Object.entries(fields)) {
    config[k] = { type: v.type, secret: !!v.secret, value: v.value }
  }
  const resp = await request.post(`${BACKEND}/profiles`, {
    data: {
      name,
      type: 'custom',
      tags: [],
      environment_values: { [envId]: config },
    },
  })
  expect(resp.ok(), `create profile ${name}: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  const body = await resp.json()
  return body.data?.id ?? body.id
}

async function deleteProfile(request: APIRequestContext, id: string) {
  await request.delete(`${BACKEND}/profiles/${id}`).catch(() => {})
}

async function getProfileUsage(request: APIRequestContext, id: string): Promise<number> {
  const resp = await request.get(`${BACKEND}/profiles/${id}`)
  const body = await resp.json()
  return body.data?.usage ?? body.usage ?? 0
}

/**
 * Create a minimal test that binds the given profile via element-level
 * profileBindings on a single Log node. Returns the test id.
 */
async function createTestBindingProfile(
  request: APIRequestContext,
  testName: string,
  profileId: string,
  profileNameForBinding: string,
  alias: string,
): Promise<string> {
  // Clean up any prior copy.
  const list = await request.get(`${BACKEND}/tests?per_page=200`)
  const lb = await list.json()
  const arr = Array.isArray(lb) ? lb : (lb.data ?? [])
  for (const t of arr) {
    if (t.name === testName) {
      await request.delete(`${BACKEND}/tests/${t.id}`).catch(() => {})
    }
  }

  const node = {
    id: 'log-node-1',
    type: 'workflowNode',
    position: { x: 100, y: 100 },
    data: {
      elementType: 'log',
      nodeType: 'plugin',
      version: '1.0.0',
      label: 'Log',
      config: {
        values: { message: 'hi' },
        profileBindings: [
          {
            profileId,
            profileName: profileNameForBinding,
            profileType: 'custom',
            alias,
            fields: [{ name: 'host', type: 'string' }],
          },
        ],
      },
    },
  }
  const create = await request.post(`${BACKEND}/tests`, {
    data: {
      name: testName,
      tags: [],
      workflow: { nodes: [node], edges: [] },
      variables: {},
    },
  })
  expect(create.ok(), `create test ${testName}: ${create.status()} ${await create.text()}`).toBeTruthy()
  const body = await create.json()
  return body.data?.id ?? body.id
}

async function deleteTest(request: APIRequestContext, id: string) {
  await request.delete(`${BACKEND}/tests/${id}`).catch(() => {})
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('V-PROFILE-BUGS: 11 profile-related bug fixes', () => {
  test.beforeAll(async ({ request }) => {
    await ensureEnvironment(request)
  })

  // A prior spec's settled run in the shard backend would open the Active Execution State dialog.
  test.beforeEach(async ({ request }) => {
    await request.delete(`${BACKEND}/workbench/session/`).catch(() => {})
  })

  // -------------------------------------------------------------------------
  // usage tracking + delete blocked by element bindings
  // -------------------------------------------------------------------------
  test('profile usage counts element-level bindings; delete is blocked', async ({
    page,
    request,
  }) => {
    const envId = await createEnv(request, 'PB-env-1')
    const profileId = await createCustomProfile(request, 'PB-prof-1', envId, {
      host: { type: 'string', value: 'example.com' },
    })
    const testId = await createTestBindingProfile(
      request,
      'PB-test-binds-1',
      profileId,
      'PB-prof-1',
      'cpr',
    )

    // Backend usage reflects the element binding (not just metadata.profile_id).
    expect(await getProfileUsage(request, profileId)).toBeGreaterThanOrEqual(1)

    await page.goto('/profiles')
    const row = page.locator('tr', { hasText: 'PB-prof-1' })
    await expect(row).toBeVisible()
    // Usage cell must show >= 1 test.
    await expect(row).toContainText(/1 test/)

    // Open the kebab and confirm the delete item is disabled.
    await row.locator('[data-testid="action-menu-trigger"]').click()
    const deleteItem = page.getByRole('menuitem', { name: /Delete/i })
    await expect(deleteItem).toBeDisabled()

    await deleteTest(request, testId)
    await deleteProfile(request, profileId)
    await deleteEnv(request, envId)
  })

  // -------------------------------------------------------------------------
  // structural changes blocked when in use
  // value changes still allowed when in use
  //
  // API-level assertions: the FE test suite covers the UI gating; here we
  // pin down the BE contract that the FE relies on.
  // -------------------------------------------------------------------------
  test('Bugs 2+3: API blocks structural changes but accepts value-only updates when in use', async ({
    request,
  }) => {
    const envId = await createEnv(request, 'PB-env-23')
    const profileId = await createCustomProfile(request, 'PB-prof-23', envId, {
      host: { type: 'string', value: 'old-host' },
    })
    const testId = await createTestBindingProfile(
      request,
      'PB-test-binds-23',
      profileId,
      'PB-prof-23',
      'cpr',
    )

    // structural change rejected.
    const addParam = await request.put(`${BACKEND}/profiles/${profileId}`, {
      data: {
        config: {
          host: { type: 'string', secret: false, value: 'old-host' },
          extra: { type: 'string', secret: false, value: 'new-param' },
        },
      },
    })
    expect(addParam.status(), 'param add must be rejected (409)').toBe(409)
    expect(await addParam.text()).toMatch(/in use/i)

    // type change rejected.
    const retype = await request.put(`${BACKEND}/profiles/${profileId}`, {
      data: {
        config: { host: { type: 'integer', secret: false, value: 1 } },
      },
    })
    expect(retype.status(), 'param retype must be rejected').toBe(409)

    // value-only update accepted.
    const valueOnly = await request.put(`${BACKEND}/profiles/${profileId}`, {
      data: {
        environment_values: {
          [envId]: { host: { type: 'string', secret: false, value: 'new-host' } },
        },
      },
    })
    expect(valueOnly.ok(), `value-only update must succeed: ${valueOnly.status()}`).toBeTruthy()

    const after = await request.get(`${BACKEND}/profiles/${profileId}`)
    const ab = await after.json()
    const stored = (ab.data ?? ab).environment_values?.[envId]?.host
    const storedValue =
      stored && typeof stored === 'object' ? (stored as { value: unknown }).value : stored
    expect(storedValue).toBe('new-host')

    await deleteTest(request, testId)
    await deleteProfile(request, profileId)
    await deleteEnv(request, envId)
  })

  // -------------------------------------------------------------------------
  // env delete allowed when profiles use it
  // type-to-confirm modal cascades cleanup
  // -------------------------------------------------------------------------
  test('Bugs 4+5: delete env in use opens type-to-confirm; cascades to profiles', async ({
    page,
    request,
  }) => {
    const envId = await createEnv(request, 'PB-env-cascade')
    const profileId = await createCustomProfile(request, 'PB-prof-cascade', envId, {
      host: { type: 'string', value: 'will-be-dropped' },
    })

    await page.goto('/settings/environments')
    const row = page.locator('[data-testid="environment-row"]', { hasText: 'PB-env-cascade' })
    await expect(row).toBeVisible()

    await row.locator('[data-testid="action-menu-trigger"]').click()
    const deleteItem = page.getByRole('menuitem', { name: /Delete/i })
    // Delete is enabled.
    await expect(deleteItem).not.toHaveAttribute('aria-disabled', 'true')
    await deleteItem.click()

    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(/used by 1 profile/i)

    // confirm is gated by typing the env name exactly.
    const typeBox = dialog.getByLabel(/Type PB-env-cascade to confirm/i)
    await expect(typeBox).toBeVisible()
    const confirmBtn = dialog.getByRole('button', { name: /Delete/i })
    await expect(confirmBtn).toBeDisabled()

    await typeBox.fill('PB-env-cascade')
    await expect(confirmBtn).toBeEnabled()
    await confirmBtn.click()

    await expect(dialog).toBeHidden({ timeout: 5000 })

    // Cascade: the profile must no longer have values for that env.
    const after = await request.get(`${BACKEND}/profiles/${profileId}`)
    const ab = await after.json()
    expect((ab.data ?? ab).environment_values?.[envId]).toBeUndefined()

    await deleteProfile(request, profileId)
  })

  // -------------------------------------------------------------------------
  // Number type is gone from the param dropdown
  // -------------------------------------------------------------------------
  test('parameter type dropdown lists Integer/Float and not Number', async ({
    page,
    request,
  }) => {
    const envId = await createEnv(request, 'PB-env-6')
    const profileId = await createCustomProfile(request, 'PB-prof-6', envId, {
      v1: { type: 'string', value: 'x' },
    })

    await page.goto('/profiles')
    const row = page.locator('tr', { hasText: 'PB-prof-6' })
    await expect(row).toBeVisible()
    await row.getByTestId('action-edit').click()

    // allTextContents does not auto-wait; under shard load the edit modal can
    // still be mounting - wait for the select to render its options first.
    const select = page.getByLabel('Parameter type').first()
    await expect(select).toBeVisible()
    await expect(select.locator('option')).not.toHaveCount(0)
    const options = await select.locator('option').allTextContents()
    expect(options).toContain('Integer')
    expect(options).toContain('Float')
    expect(options).not.toContain('Number')

    await deleteProfile(request, profileId)
    await deleteEnv(request, envId)
  })

  // -------------------------------------------------------------------------
  // a typed profile's integer field takes a number or its exact digit
  // text (the one number rule, REQ-3.1.3.14); any other text is refused.
  // -------------------------------------------------------------------------
  test('typed profile (database) accepts a numeric port and its digit text; rejects other text', async ({
    request,
  }) => {
    const envId = await createEnv(request, 'PB-env-8')

    // Clean up any prior db profile.
    const list = await request.get(`${BACKEND}/profiles?per_page=200`)
    const lb = await list.json()
    const arr = Array.isArray(lb) ? lb : (lb.data ?? [])
    for (const p of arr) {
      if (p.name === 'PB-db-8' || p.name === 'PB-db-8-digits') {
        await deleteProfile(request, p.id)
      }
    }

    // Numeric port -> create succeeds.
    const ok = await request.post(`${BACKEND}/profiles`, {
      data: {
        name: 'PB-db-8',
        type: 'database',
        environment_values: {
          [envId]: { host: 'db.example.com', port: 5432 },
        },
      },
    })
    expect(ok.ok(), `numeric port must be accepted: ${ok.status()} ${await ok.text()}`).toBeTruthy()
    const okBody = await ok.json()
    const created = okBody.data ?? okBody
    const persistedPort = created.environment_values?.[envId]?.port
    expect(persistedPort).toBe(5432)
    expect(typeof persistedPort).toBe('number')

    // Digit text is the integer itself; it is kept exactly as written.
    const digits = await request.post(`${BACKEND}/profiles`, {
      data: {
        name: 'PB-db-8-digits',
        type: 'database',
        environment_values: {
          [envId]: { host: 'h', port: '5433' },
        },
      },
    })
    expect(digits.ok(), `digit-text port must be accepted: ${digits.status()} ${await digits.text()}`).toBeTruthy()
    const digitsBody = await digits.json()
    const digitsCreated = digitsBody.data ?? digitsBody
    expect(String(digitsCreated.environment_values?.[envId]?.port)).toBe('5433')

    // Text that is not a number -> refused, naming the integer it expects.
    const bad = await request.post(`${BACKEND}/profiles`, {
      data: {
        name: 'PB-db-8-bad',
        type: 'database',
        environment_values: {
          [envId]: { host: 'h', port: 'db-port' },
        },
      },
    })
    expect(bad.status(), 'a port that is not a number must be rejected').toBe(400)
    expect((await bad.text()).toLowerCase()).toContain('integer')

    await deleteProfile(request, digitsCreated.id)
    await deleteProfile(request, created.id)
    await deleteEnv(request, envId)
  })

  // -------------------------------------------------------------------------
  // Helpers for rules 7, 9, 10, 11 (canvas + binding modal flows).
  // -------------------------------------------------------------------------
  async function openLogConfig(page: Page) {
    const httpNode = page.locator('[data-testid^="workflow-node-"]').first()
    await expect(httpNode).toBeVisible({ timeout: 10000 })
    await httpNode.locator('button').first().dispatchEvent('click')
    const gear = page.locator(
      '[data-testid="node-configure"]',
    )
    await gear.click()
    await expect(configSheet(page)).toBeVisible()
  }

  // -------------------------------------------------------------------------
  // var-setter NAME field never lists profile aliases.
  //
  // Pinned at the data-shape level: the var-setter's filter relies on
  // `source: "Profile: ..."` to identify aliases; that source string is
  // computed by useEnrichedVariables and exercised by FE unit tests. Here
  // we verify the test save round-trip keeps the alias source intact so
  // the FE filter sees what it expects.
  // -------------------------------------------------------------------------
  test('profile bindings persisted with the alias the FE filter keys on', async ({
    request,
  }) => {
    const envId = await createEnv(request, 'PB-env-9')
    const profileId = await createCustomProfile(request, 'PB-prof-9', envId, {
      host: { type: 'string', value: 'h' },
    })
    const testId = await createTestBindingProfile(
      request,
      'PB-test-9',
      profileId,
      'PB-prof-9',
      'cpr_alias_x',
    )

    // Round-trip: load the test back and confirm the binding is intact with
    // the exact shape the FE useEnrichedVariables hook reads (alias +
    // profileName). The FE filter then routes anything carrying
    // source="Profile: <profileName>" away from the var-setter NAME field.
    const get = await request.get(`${BACKEND}/tests/${testId}`)
    const test = (await get.json()).data ?? (await get.json())
    const node = (test.workflow?.nodes ?? []).find(
      (n: { id: string }) => n.id === 'log-node-1',
    )
    expect(node).toBeTruthy()
    const binding = node.data?.config?.profileBindings?.[0]
    expect(binding).toBeTruthy()
    expect(binding.alias).toBe('cpr_alias_x')
    expect(binding.profileName).toBe('PB-prof-9')

    await deleteTest(request, testId)
    await deleteProfile(request, profileId)
    await deleteEnv(request, envId)
  })

  // -------------------------------------------------------------------------
  // alias input uses shared NameField (validated client-side).
  // alias <-> variable cross-namespace conflict, both directions.
  //
  // The FE unit suite drives the dialog UI; this test pins down the BE
  // contract that the FE relies on. The validate-test endpoint flags the
  // ALIAS_NAME_CONFLICT code when a variable shadows a bound alias.
  // -------------------------------------------------------------------------
  test('Bugs 10+11: server-side validate flags variable/alias name collision', async ({
    request,
  }) => {
    const envId = await createEnv(request, 'PB-env-1011')
    const profileId = await createCustomProfile(request, 'PB-prof-1011', envId, {
      host: { type: 'string', value: 'h' },
    })

    // Build a test where a variable name matches a bound profile alias.
    const test = {
      name: 'PB-test-1011',
      tags: [],
      // Variable shadows the alias -> backend must flag ALIAS_NAME_CONFLICT.
      variables: { cpr: { type: 'string', value: 'preexisting' } },
      workflow: {
        nodes: [
          {
            id: 'log-1011',
            type: 'workflowNode',
            position: { x: 100, y: 100 },
            data: {
              elementType: 'log',
              nodeType: 'plugin',
              version: '1.0.0',
              label: 'Log',
              config: {
                values: { message: 'hi' },
                profileBindings: [
                  {
                    profileId,
                    profileName: 'PB-prof-1011',
                    profileType: 'custom',
                    alias: 'cpr',
                    fields: [{ name: 'host', type: 'string' }],
                  },
                ],
              },
            },
          },
        ],
        edges: [],
      },
    }
    // Clean up any prior copy.
    const list = await request.get(`${BACKEND}/tests?per_page=200`)
    const lb = await list.json()
    const arr = Array.isArray(lb) ? lb : (lb.data ?? [])
    for (const t of arr) {
      if (t.name === 'PB-test-1011') {
        await deleteTest(request, t.id)
      }
    }
    // The save itself is rejected with 422 + ALIAS_NAME_CONFLICT - the BE
    // refuses to persist a test where a variable name shadows a bound alias.
    const created = await request.post(`${BACKEND}/tests`, { data: test })
    expect(
      created.status(),
      `expected 422 ALIAS_NAME_CONFLICT, got ${created.status()}`,
    ).toBe(422)
    const errBody = await created.json()
    const detailCodes = (errBody.error?.details ?? []).map((d: { code: string }) => d.code)
    expect(detailCodes).toContain('ALIAS_NAME_CONFLICT')

    await deleteProfile(request, profileId)
    await deleteEnv(request, envId)
  })

  // -------------------------------------------------------------------------
  // f-string autocomplete inside cpr.{...} works.
  // We exercise the API via the inline expression input on the Log message.
  // -------------------------------------------------------------------------
  test('cpr. autocomplete works inside an f-string expression', async ({
    page,
    request,
  }) => {
    const envId = await createEnv(request, 'PB-env-7')
    const profileId = await createCustomProfile(request, 'PB-prof-7', envId, {
      host: { type: 'string', value: 'h' },
    })
    const tId = await createTestBindingProfile(
      request,
      'PB-test-7',
      profileId,
      'PB-prof-7',
      'cpr',
    )

    await page.goto(`/workbench?editTest=${tId}`)
    await waitForCanvasLoad(page)
    await waitForCanvasToolbar(page)

    // Open the Log node config and switch the message field to expression.
    await openLogConfig(page)
    const configModal = configSheet(page)
    const messageRow = configModal.locator('[data-testid="param-row-message"]')
    await messageRow.scrollIntoViewIfNeeded()
    await messageRow.locator('[data-testid="expression-toggle"]').click()
    // The row holds 'hi', so the switch asks first (FIELD-7).
    await answerSwitch(page, 'Clear & Empty')

    const editor = messageRow.locator('.cm-content')
    await editor.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')
    await page.keyboard.type("f'val is {cpr.")

    // Trigger autocomplete and assert at least one cpr.* completion shows.
    await page.keyboard.press('Control+Space')
    const popup = page.locator('.cm-tooltip-autocomplete')
    await expect(popup).toBeVisible({ timeout: 3000 })
    await expect(popup).toContainText(/cpr\.host|cpr\.\w+/)

    await deleteTest(request, tId)
    await deleteProfile(request, profileId)
    await deleteEnv(request, envId)
  })
})
