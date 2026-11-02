/**
 * V-SECREV-BADGE: canvas reveal badge (amber "unsecured" triangle)
 *
 * Phase: no-data (parallel) - self-seeds one test via POST /tests, no DB reset.
 * Design Decisions: SECREV-4
 * REQ: REQ-3.1.3.5 (per-block run-output masking control)
 *
 * A valid plugin whose effective run output is revealing shows the amber
 * node-reveal-alert badge in the status-bar slot; a masked plugin shows none.
 * The red-wins-over-amber priority (when a node ALSO has validation issues) is
 * unit-covered by node-validation-alert.test.tsx.
 *
 * Pass Criteria:
 * 1. The Always-reveal block shows the amber node-reveal-alert badge with its
 *    aria-label, and no red node-validation-alert.
 * 2. The Always-mask block shows neither badge.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { BACKEND_URL } from '../../helpers/config'

const REVEAL_LABEL = 'Secrets revealed - shown in cleartext in run logs and reports'

function logNode(id: string, masking: string, y: number) {
  return {
    id,
    type: 'workflowNode',
    position: { x: 320, y },
    measured: { width: 120, height: 62 },
    data: {
      label: 'Log',
      elementType: 'log',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      description: id,
      hasNewerVersion: false,
      expressionFields: ['message'],
      templateFields: [],
      config: {
        values: { message: "'hello'", level: 'INFO' },
        secret_masking: masking,
        outputBindings: {},
        profileBindings: [],
      },
    },
  }
}

function buildBadgeFixture(): Record<string, unknown> {
  return {
    name: `V-SECREV-BADGE ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'One Always-reveal Log (amber badge) and one Always-mask Log (no badge).',
    workflow: {
      nodes: [logNode('log-reveal', 'reveal', 120), logNode('log-mask', 'mask', 240)],
      edges: [
        { id: 'e0', source: 'start-node', target: 'log-reveal', type: 'default' },
        { id: 'e1', source: 'log-reveal', target: 'log-mask', type: 'default' },
      ],
    },
    variables: {},
    metadata: {},
  }
}

test.describe('V-SECREV-BADGE: canvas reveal badge', () => {
  test.beforeEach(async ({ page }) => {
    // System run_output off so the badge is driven only by the block settings.
    await page.request.put(`${BACKEND_URL}/admin/secret-masking`, {
      data: { run_output: false, test_variables: false, shared_variables: false, credential_inputs: false },
    })
  })

  test('an Always-reveal block shows the amber reveal badge; an Always-mask block shows none', async ({
    page,
  }) => {
    await importValidateAndNavigate(page, buildBadgeFixture())

    const revealNode = page.locator('[data-testid="workflow-node-log-reveal"]')
    const maskNode = page.locator('[data-testid="workflow-node-log-mask"]')
    await expect(revealNode).toBeVisible()
    await expect(maskNode).toBeVisible()

    // Amber reveal badge on the revealing block; no red misconfiguration badge.
    const amber = revealNode.locator('[data-testid="node-reveal-alert"]')
    await expect(amber).toBeVisible()
    await expect(amber).toHaveAttribute('aria-label', REVEAL_LABEL)
    await expect(revealNode.locator('[data-testid="node-validation-alert"]')).toHaveCount(0)

    // The masked block carries neither badge.
    await expect(maskNode.locator('[data-testid="node-reveal-alert"]')).toHaveCount(0)
    await expect(maskNode.locator('[data-testid="node-validation-alert"]')).toHaveCount(0)
  })

  test('a system-wide run-output reveal silences per-block badges entirely', async ({ page }) => {
    // Under a deployment-wide reveal every block reveals,
    // so no per-block badge should light - not even the Always-reveal block.
    await page.request.put(`${BACKEND_URL}/admin/secret-masking`, {
      data: { run_output: true },
    })
    try {
      await importValidateAndNavigate(page, buildBadgeFixture())

      const revealNode = page.locator('[data-testid="workflow-node-log-reveal"]')
      const maskNode = page.locator('[data-testid="workflow-node-log-mask"]')
      await expect(revealNode).toBeVisible()
      await expect(maskNode).toBeVisible()

      await expect(revealNode.locator('[data-testid="node-reveal-alert"]')).toHaveCount(0)
      await expect(maskNode.locator('[data-testid="node-reveal-alert"]')).toHaveCount(0)
    } finally {
      // Never leak a revealed flag to another spec sharing this backend process.
      await page.request.put(`${BACKEND_URL}/admin/secret-masking`, {
        data: { run_output: false },
      })
    }
  })
})
