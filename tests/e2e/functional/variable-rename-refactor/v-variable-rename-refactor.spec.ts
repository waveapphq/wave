/**
 * V-VAR-RENAME-REFACTOR-FUNCTIONAL: renaming a variable in its window refactors every reference
 * across the saved Test, and the rename is never silent.
 * Design Decisions: VMGR-106, VMGR-108
 * REQ: REQ-3.4.1.14, REQ-3.1.3.15
 *
 * Renames `widget_id` -> `gadget_key` and proves, anchored on the persisted Test and the run:
 *   - a Variable Setter TARGET key (+ its variableTypes)
 *   - a Variable Setter per-key EXPRESSION value (`widget_id * 2`)
 *   - a Variable Setter per-key TEMPLATE value (`id is {{ widget_id }}`)
 *   - a node TEMPLATE field (`Total {{ widget_id }}`)
 *   - a node EXPRESSION field (`str(widget_id)`)
 *   - the variable definition
 *
 * Phase: functional-workflow (imports its own fixture, validated with zero errors).
 *
 * Pass Criteria:
 * 1. A name another variable of the Test uses shows `A variable with this name already exists` and
 *    Save stays disabled; typing the own name back is accepted with no notice.
 * 2. A new name shows `Renaming updates all references to widget_id across the test.`
 * 3. Save renames the row; the saved Test holds `widget_id` nowhere and every reference reads
 *    `gadget_key`.
 * 4. The run reads the renamed variable everywhere (`Total 7`, `7`).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import {
  expandVariableManager,
  openEditWindow,
  renameInWindow,
  renameNotice,
  saveWindow,
  variableRow,
  windowSaveButton,
} from '../../helpers/variable-create'
import { runToEnd, saveTest, selectEnvironment } from '../../helpers/workbench'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

interface FetchedNode {
  id: string
  data: {
    config?: { values?: Record<string, unknown> }
    variableTypes?: Record<string, unknown>
  }
}

function nodeById(data: Record<string, any>, id: string): FetchedNode {
  const workflow = data.workflow as { nodes: FetchedNode[] }
  const node = workflow.nodes.find((n) => n.id === id)
  expect(node, `node ${id} missing from saved test`).toBeTruthy()
  return node as FetchedNode
}

function setterVariables(node: FetchedNode): Record<string, unknown> {
  return (node.data.config?.values?.variables ?? {}) as Record<string, unknown>
}

test.describe('Variable rename refactors all references (V-VAR-RENAME-REFACTOR-FUNCTIONAL)', () => {
  test('rename widget_id -> gadget_key rewrites every reference and the old name survives nowhere', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const testId = await importValidateAndNavigate(page, loadFixture())
    await expandVariableManager(page)

    const win = await openEditWindow(page, 'widget_id')

    await test.step('a taken name holds Save; the own name is accepted', async () => {
      await renameInWindow(win, 'doubled')
      await expect(win.getByTestId('create-name-error')).toHaveText('A variable with this name already exists')
      await expect(windowSaveButton(win)).toBeDisabled()
      await expect(renameNotice(win)).toHaveCount(0)
      await renameInWindow(win, 'widget_id')
      await expect(win.getByTestId('create-name-error')).toHaveCount(0)
      await expect(renameNotice(win)).toHaveCount(0)
      await expect(windowSaveButton(win)).toBeEnabled()
    })

    await test.step('a new name shows the refactor notice before Save', async () => {
      await renameInWindow(win, 'gadget_key')
      await expect(renameNotice(win)).toHaveText('Renaming updates all references to widget_id across the test.')
      await saveWindow(page, win)
      await expect(variableRow(page, 'gadget_key')).toBeVisible()
      await expect(variableRow(page, 'widget_id')).toHaveCount(0)
    })

    await test.step('the saved Test holds the new name in every reference and the old name nowhere', async () => {
      await saveTest(page)
      const fetched = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
      expect(fetched.ok()).toBeTruthy()
      const data = ((await fetched.json()).data) as Record<string, any>

      // The Test description narrates the original name, so only the refactorable surfaces are checked.
      const serialized = JSON.stringify({ workflow: data.workflow, variables: data.variables })
      expect(serialized, 'old name "widget_id" must not appear anywhere').not.toContain('widget_id')
      expect(serialized, 'new name "gadget_key" must appear').toContain('gadget_key')

      expect(data.variables).toHaveProperty('gadget_key')
      expect(data.variables).not.toHaveProperty('widget_id')

      const target = nodeById(data, 'varset-target')
      expect(Object.keys(setterVariables(target))).toEqual(['gadget_key'])
      expect(target.data.variableTypes).toEqual({ gadget_key: 'integer' })

      const refsVars = setterVariables(nodeById(data, 'varset-refs'))
      expect(refsVars.doubled).toBe('gadget_key * 2')
      expect(refsVars.caption).toBe('id is {{ gadget_key }}')

      expect(nodeById(data, 'log-tmpl').data.config?.values?.message).toBe('Total {{ gadget_key }}')
      expect(nodeById(data, 'log-expr').data.config?.values?.message).toBe('str(gadget_key)')
    })

    await test.step('the run reads the renamed variable in every reference', async () => {
      await selectEnvironment(page)
      const { verdict, entries } = await runToEnd(page)
      const messages = entries.filter((entry) => entry.source === 'Log').map((entry) => entry.message)
      expect(verdict, messages.join('\n')).toBe('passed')
      expect(messages).toEqual(['Total 7', '7'])
    })
  })
})
