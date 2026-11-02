/**
 * V-FN-PUBLISH-VERSION-GATE (functional): the edit-mode publish dialog gates
 * the bump target to the lowest ALLOWED level, surfaces blocked levels with a
 * fast, hoverable info icon, words a rename as "renamed", and rejects an
 * illegal semver - all driven by a draft that renames an input.
 *
 * REQ: REQ-3.1.2.2 (Version control for Functions with metadata).
 *
 * A renamed input is a breaking change, so PATCH + MINOR are blocked and only
 * MAJOR is allowed; the dialog re-syncs the target to v2.0.0 and disables the
 * blocked options.
 *
 * Phase: functional-workflow. Self-seeds via POST /functions + POST /tests.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-version-gate-1'
// Optional inputs: a renamed OPTIONAL input surfaces as the MINOR "removed"
// blocker (re-worded "renamed"), and an unbound optional input does not
// trip the instance's save validation. A required rename would instead surface
// the "cannot add a REQUIRED input" blocker and need a binding.
const SRC_INPUT = { name: 'msg', type: 'string', required: false, default: '', description: '' }
const RENAMED_INPUT = { name: 'message', type: 'string', required: false, default: '', description: '' }

interface SeededFn {
  functionId: string
  name: string
}

async function seedLibrary(request: APIRequestContext): Promise<SeededFn> {
  const name = `vergate_${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FN-PUBLISH-VERSION-GATE seed (source input "msg")',
      tags: [],
      inputs: [SRC_INPUT],
      outputs: [],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial',
      details: 'seed details',
    },
  })
  expect(resp.ok(), `POST /functions: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  return { functionId: (await resp.json()).data.id, name }
}

/** A Test holding the Shared instance ALREADY in edit mode, whose draft RENAMES
 *  the source input ("msg" -> "message") so PATCH/MINOR are blocked. */
async function seedEditModeRenameTest(request: APIRequestContext, shared: SeededFn): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-PUBLISH-VERSION-GATE ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Edit-mode draft renames the input',
      workflow: {
        nodes: [
          {
            id: FN_NODE_ID,
            type: 'workflowNode',
            position: { x: 320, y: 180 },
            data: {
              label: shared.name,
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'shared',
              functionId: shared.functionId,
              functionVersion: '1.0.0',
              originalLibraryName: shared.name,
              category: 'function',
              version: '1.0.0',
              hasNewerVersion: false,
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: {}, outputBindings: {}, profileBindings: [] },
              editMode: true,
              upstreamLink: { functionId: shared.functionId, sourceVersion: '1.0.0' },
              draft: {
                name: shared.name,
                description: '',
                tags: [],
                inputs: [RENAMED_INPUT],
                outputs: [],
                dependencies: { functions: [], plugins: [] },
                workflow: { nodes: [], edges: [] },
              },
            },
            measured: { width: 120, height: 62 },
          },
        ],
        edges: [],
      },
      variables: {},
      metadata: {},
    },
  })
  const body = await resp.json().catch(() => null)
  expect(body?.success, `POST /tests: ${resp.status()}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function openPublishDialog(page: Page) {
  await clickNodeKebabItem(page, FN_NODE_ID, 'Publish')
  const dialog = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

test.describe('V-FN-PUBLISH-VERSION-GATE (functional): bump gating + blocked affordances', () => {
  test('A renamed input syncs the target to the only allowed bump and disables the rest', async ({
    page,
    request,
  }) => {
    // The dialog must reflect the lowest ALLOWED
    // bump once allowed-bumps resolves - a draft that needs MAJOR must not show
    // a misleading PATCH chip. The blocked (i) is hoverable (cursor-help)
    // and carries no native title. The Custom field rejects 1.0.0-01.
    const shared = await seedLibrary(request)
    const testId = await seedEditModeRenameTest(request, shared)
    await openTest(page, testId)
    const dialog = await openPublishDialog(page)

    // Target re-syncs to MAJOR (2.0.0) - the only allowed level. The bump
    // dropdown renders no "v" prefix on the trigger or options.
    const trigger = dialog.locator('[data-testid="version-dropdown-trigger"]')
    await expect(trigger).toContainText('2.0.0', { timeout: 10_000 })
    await expect(trigger.locator('[data-testid="bump-chip-major"]')).toBeVisible()

    // Open the dropdown: PATCH + MINOR are disabled, MAJOR is enabled.
    await trigger.click()
    const menu = dialog.locator('[data-testid="version-dropdown-menu"]')
    await expect(menu).toBeVisible()
    const patch = menu.getByRole('menuitemradio').filter({ hasText: '-> 1.0.1' })
    const minor = menu.getByRole('menuitemradio').filter({ hasText: '-> 1.1.0' })
    const major = menu.getByRole('menuitemradio').filter({ hasText: '-> 2.0.0' })
    await expect(patch).toHaveAttribute('aria-disabled', 'true')
    await expect(minor).toHaveAttribute('aria-disabled', 'true')
    await expect(major).not.toHaveAttribute('aria-disabled', 'true')

    // The blocked (i) icon is hoverable (cursor-help) with NO native title.
    const blockedInfo = menu.locator('[data-testid="blocked-info-icon"]').first()
    await expect(blockedInfo).toBeVisible()
    await expect(blockedInfo).toHaveClass(/cursor-help/)
    await expect(blockedInfo).not.toHaveAttribute('title')

    // The Custom field rejects a leading-zero pre-release.
    await menu.locator('[data-testid="version-dropdown-custom-input"]').fill('1.0.0-01')
    await expect(menu.locator('[data-testid="version-dropdown-custom-error"]')).toBeVisible()
  })

  test('The blocked-bump reason words a renamed input as "renamed", not "removed"', async ({
    request,
  }) => {
    // validate-bumps must word a removed+re-added (same shape) input
    // pair as "renamed".
    const shared = await seedLibrary(request)
    const resp = await request.post(`${BACKEND_URL}/functions/${shared.functionId}/validate-bumps`, {
      data: {
        source_version: '1.0.0',
        draft_definition: {
          name: shared.name,
          description: '',
          tags: [],
          inputs: [RENAMED_INPUT],
          outputs: [],
          dependencies: { functions: [], plugins: [] },
          workflow: { nodes: [], edges: [] },
        },
      },
    })
    expect(resp.ok(), `validate-bumps: ${resp.status()} ${await resp.text()}`).toBeTruthy()
    const body = await resp.json()
    // A rename is breaking: PATCH/MINOR blocked, MAJOR allowed.
    expect(body.data.allowed).not.toContain('patch')
    expect(body.data.allowed).not.toContain('minor')
    const reason = String(body.data.blocked.minor ?? body.data.blocked.patch ?? '')
    expect(reason, `blocked reason: ${reason}`).toMatch(/renamed/i)
  })

  test('The from-Local publish dialog rejects a leading-zero pre-release', async ({
    page,
    request,
  }) => {
    // The publish dialog uses the single strict
    // isValidSemver helper, so 1.0.0-01 is invalid (Publish stays disabled).
    const seed = await request.post(`${BACKEND_URL}/tests`, {
      data: {
        name: `V-FN-PUBLISH-VERSION-GATE local ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        version: '1.0.0',
        description: 'A local Function to open the from-Local publish dialog',
        workflow: {
          nodes: [
            {
              id: 'local-fn',
              type: 'workflowNode',
              position: { x: 300, y: 180 },
              data: {
                label: 'LocalFn',
                elementType: 'function',
                nodeType: 'function',
                functionLifecycle: 'local',
                category: 'function',
                version: '1.0.0',
                hasNewerVersion: false,
                expressionFields: [],
                templateFields: [],
                variableExpressionKeys: [],
                config: { values: {}, outputBindings: {}, profileBindings: [] },
                localDefinition: {
                  name: 'LocalFn',
                  description: '',
                  tags: [],
                  inputs: [],
                  outputs: [],
                  variables: [],
                  workflow: {
                    nodes: [
                      {
                        id: 'lf-log',
                        type: 'workflowNode',
                        position: { x: 200, y: 200 },
                        data: {
                          label: 'Log',
                          elementType: 'log',
                          nodeType: 'plugin',
                          category: 'system',
                          version: '1.0.0',
                          expressionFields: ['message'],
                          templateFields: [],
                          variableExpressionKeys: [],
                          config: { values: { message: "'x'", level: 'INFO' }, outputBindings: {}, profileBindings: [] },
                        },
                      },
                    ],
                    edges: [{ id: 'e-start-lf', source: 'start-node', target: 'lf-log' }],
                  },
                },
              },
              measured: { width: 120, height: 62 },
            },
          ],
          edges: [],
        },
        variables: {},
        metadata: {},
      },
    })
    const seedBody = await seed.json().catch(() => null)
    expect(seedBody?.success, `POST /tests: ${seed.status()}`).toBeTruthy()
    await openTest(page, seedBody.data.id)

    await clickNodeKebabItem(page, 'local-fn', /Publish/i)
    const dialog = page.locator('[role="dialog"]', { hasText: 'Publish Function' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Give it a valid name so only the version gates submission.
    await dialog.locator('[data-testid="publish-name-input"]').fill(`pub_${randomUUID().slice(0, 4)}`)

    const versionField = dialog.getByLabel('Version')
    await versionField.fill('1.0.0-01')
    // The "semver v2" hint + popover trigger only render while the version is
    // invalid, and Publish stays disabled.
    await expect(dialog.getByRole('button', { name: /semver v2/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Publish' })).toBeDisabled()

    // A valid version clears the hint and (with the name filled) enables Publish.
    await versionField.fill('2.0.0')
    await expect(dialog.getByRole('button', { name: /semver v2/i })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Publish' })).toBeEnabled()
  })
})
