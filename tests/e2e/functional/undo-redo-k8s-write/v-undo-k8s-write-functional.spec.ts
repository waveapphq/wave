/**
 * V-UNDO-K8S-WRITE (functional): the change history over the four K8s write Blocks.
 *
 * Phase: functional-workflow - one Test is imported and driven on the canvas.
 * Nothing runs, so no cluster and no service stack is involved.
 * REQ: REQ-5.2.1.24, REQ-5.1.1, REQ-3.4.1.5
 * Design Decisions: K8SWRITE-1, K8SWRITE-3, K8SWRITE-5, K8SWRITE-7, K8SWRITE-8, HTTP-8
 *
 * Criterion ids use the KUR- prefix; every one is listed in this suite's README.
 *
 * Pass Criteria:
 *   KUR-a  each of the four write Blocks survives a palette drop, an undo and a
 *          redo with its identity intact: the Block leaves the canvas last-first
 *          and comes back in drop order carrying its own icon and name, and the
 *          stack floors exactly at the empty canvas
 *   KUR-b  undoing an Apply Define with switch restores Manifest mode AND the
 *          manifest it showed, with the form rows gone; redo returns Form with
 *          the typed Name
 *   KUR-c  undoing an Apply Kind switch restores ConfigMap with its own Data map
 *          intact, and redo restores Secret with its own; neither Data field
 *          ever reads the other's keys
 *   KUR-d  undoing a Job from switch brings Image and Command back with the
 *          values the switch hid, and redo returns CronJob Name
 *   KUR-e  undoing a Delete by switch restores Name and the Ignore not found
 *          tick the switch cleared, and redo returns the Label Selector
 *   KUR-f  undoing a Rollout Operation switch restores the operation and the
 *          rows and outputs that operation offers, one entry per save
 *   KUR-g  deleting a configured Scale Block and undoing brings back the Block,
 *          its chain edges and the configuration, not just the Block
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import {
  clickNodeKebabItem,
  dragPaletteItemToCanvas,
  expandPalette,
  waitForCanvasLoad,
} from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import {
  chainEdges,
  k8sApplyNode,
  k8sConnectNode,
  k8sDeleteNode,
  k8sRolloutNode,
  k8sScaleNode,
  stackNodes,
  type K8sApplyValues,
} from '../../helpers/k8s-nodes'
import { expectStringParamPreview, setStringParam } from '../../helpers/param-config'
import {
  clearPointerLock,
  clickRedo,
  clickUndo,
  configSheet,
  openBlockSheet,
  redoBtn,
  undoBtn,
} from '../../helpers/workbench'

const CONNECT_NODE = 'connect-1'
const APPLY_NODE = 'apply-1'
const DELETE_NODE = 'delete-1'
const SCALE_NODE = 'scale-1'
const ROLLOUT_NODE = 'rollout-1'

const SESSION_VAR = 'k8s_session'
/** start -> Connect -> Apply -> Delete -> Scale -> Rollout. */
const CHAIN_EDGES = 5

const MANIFEST_TEXT = 'kind: ConfigMap'
const FORM_NAME = 'wave-undo-cm'
const CM_KEY = 'cm-key'
const CM_VALUE = 'cm-value'
const SECRET_KEY = 'secret-key'
const SECRET_VALUE = 'secret-value'
const JOB_NAME = 'wave-undo-job'
const JOB_IMAGE = 'busybox:1.28'
const JOB_COMMAND = 'sleep 5'
const CRONJOB_NAME = 'nightly-cleanup'
const DELETE_NAME = 'wave-undo-target'
const LABEL_SELECTOR = 'app=web'
const SCALE_TARGET = 'payments-api'
const SEEDED_REPLICAS = '2'
const SCALED_REPLICAS = '5'
const TO_REVISION = '3'

const WRITE_BLOCKS = [
  { testId: 'palette-item-k8s-apply', icon: 'cloud-upload', label: 'K8s Apply' },
  { testId: 'palette-item-k8s-delete', icon: 'trash-2', label: 'K8s Delete' },
  { testId: 'palette-item-k8s-scale', icon: 'scaling', label: 'K8s Scale' },
  { testId: 'palette-item-k8s-rollout', icon: 'refresh-cw', label: 'K8s Rollout' },
] as const

/** One Connect plus the four write Blocks, every required parameter filled so
 *  the import passes validation and each sheet opens save-able. */
function buildFixture(apply: K8sApplyValues): Record<string, unknown> {
  return {
    name: 'V-UNDO-K8S-WRITE history over the write Blocks',
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: stackNodes([
        k8sConnectNode({
          id: CONNECT_NODE,
          values: { api_url: 'https://10.0.0.1:6443' },
          outputBindings: { session: SESSION_VAR },
        }),
        k8sApplyNode({
          id: APPLY_NODE,
          expressionFields: ['session'],
          values: {
            session: SESSION_VAR,
            if_exists: 'update',
            output_format: 'map',
            on_error: 'fail',
            ...apply,
          },
        }),
        k8sDeleteNode({
          id: DELETE_NODE,
          expressionFields: ['session'],
          values: {
            session: SESSION_VAR,
            resource_type: 'default',
            kind: 'ConfigMap',
            delete_by: 'name',
            name: DELETE_NAME,
            ignore_not_found: true,
            cascade: 'background',
            wait_until_gone: true,
            on_error: 'fail',
          },
        }),
        k8sScaleNode({
          id: SCALE_NODE,
          expressionFields: ['session'],
          values: {
            session: SESSION_VAR,
            resource_type: 'default',
            kind: 'Deployment',
            name: SCALE_TARGET,
            replicas: Number(SEEDED_REPLICAS),
            on_error: 'fail',
          },
        }),
        k8sRolloutNode({
          id: ROLLOUT_NODE,
          expressionFields: ['session'],
          values: {
            session: SESSION_VAR,
            operation: 'restart',
            kind: 'Deployment',
            name: SCALE_TARGET,
            on_error: 'fail',
          },
        }),
      ]),
      edges: chainEdges([CONNECT_NODE, APPLY_NODE, DELETE_NODE, SCALE_NODE, ROLLOUT_NODE]),
    },
    variables: {
      [SESSION_VAR]: { value: '', type: 'string', scope: 'test', secret: true },
    },
    metadata: {},
  }
}

const paramRow = (modal: Locator, name: string) =>
  modal.locator(`[data-testid="param-row-${name}"]`)

const outputRow = (modal: Locator, name: string) =>
  modal.locator(`[data-testid="output-row-${name}"]`)

const enumTrigger = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('button[role="combobox"]')

const checkbox = (modal: Locator, name: string) =>
  paramRow(modal, name).locator('button[role="checkbox"]')

const mapExpand = (modal: Locator, name: string) => modal.locator(`[data-testid="param-expand-${name}"]`)

/** A map row's one value field: the map drawn as one line (FIELD-10). */
const mapLine = (modal: Locator, name: string) => paramRow(modal, name).locator('[data-slot="input-group"] input')

/** The one line holds exactly this entry. */
const oneEntry = (key: string, value: string): RegExp => new RegExp(`^\\{\\s*"${key}": "${value}"\\s*\\}$`)

/** The one line holds no entry. */
const ANY_ENTRY = /"[^"]+":/

const numberInput = (modal: Locator, name: string) =>
  modal.locator(`[data-testid="param-input-${name}"]`)

const workflowNodes = (page: Page) =>
  page.locator('[data-testid^="workflow-node-"][data-nodetype]')

const canvasNode = (page: Page, nodeId: string) =>
  page.locator(`[data-testid="workflow-node-${nodeId}"]`)

/** The Block carrying one palette icon, whichever id the drop generated. */
const blockByIcon = (page: Page, icon: string) =>
  workflowNodes(page).filter({ has: page.locator(`[data-icon="${icon}"]`) })

/** The ghost Start-to-onboarding hint is a UI cue, not a user edge. */
const canvasEdges = (page: Page) =>
  page.locator('.react-flow__edge:not([data-id="ghost-edge"])')

async function gotoDraftWorkbench(page: Page): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto('/workbench?newTest=true')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench?newTest=true')
  await waitForCanvasLoad(page)
}

async function openSheet(page: Page, nodeId: string): Promise<Locator> {
  const node = canvasNode(page, nodeId)
  await expect(node).toBeVisible({ timeout: 20_000 })
  await node.hover()
  await openBlockSheet(page, nodeId)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

async function saveSheet(modal: Locator): Promise<void> {
  const save = modal.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeEnabled()
  await save.click()
  await expect(modal).toBeHidden({ timeout: 10_000 })
}

/** Close a sheet that was only read. A dirty sheet would ask first. */
async function closeSheet(modal: Locator): Promise<void> {
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(modal).toBeHidden({ timeout: 10_000 })
}

async function pickEnum(
  page: Page,
  modal: Locator,
  name: string,
  optionLabel: string,
): Promise<void> {
  const trigger = enumTrigger(modal, name)
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  const listbox = page.locator('[role="listbox"]')
  await expect(listbox).toBeVisible()
  await listbox.getByRole('option', { name: optionLabel, exact: true }).click()
  await expect(listbox).toHaveCount(0)
  await expect(trigger).toHaveText(optionLabel)
}

/** Open a map row's editor, a page-level overlay beside the config sheet. */
async function openMapEditor(page: Page, modal: Locator, name: string): Promise<Locator> {
  await paramRow(modal, name).scrollIntoViewIfNeeded()
  await mapExpand(modal, name).click()
  const editor = page.locator('[data-testid="value-editor-sheet"]')
  await expect(editor).toBeVisible()
  return editor
}

async function addMapEntry(
  page: Page,
  modal: Locator,
  name: string,
  key: string,
  value: string,
): Promise<void> {
  const editor = await openMapEditor(page, modal, name)
  await editor.locator('[data-testid="map-add-entry"]').click()
  await editor.locator('[data-testid="map-edit-key-0"]').fill(key)
  await editor.locator('[data-testid="map-edit-value-0"]').fill(value)
  await editor.locator('[data-testid="value-editor-save-button"]').click()
  await editor.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(editor).toBeHidden()
}

/** Read a map row's single entry back, then leave it exactly as it was. */
async function expectMapEntry(
  page: Page,
  modal: Locator,
  name: string,
  key: string,
  value: string,
): Promise<void> {
  const editor = await openMapEditor(page, modal, name)
  await expect(editor.locator('[data-testid="map-edit-key-0"]'), name).toHaveValue(key)
  await expect(editor.locator('[data-testid="map-edit-value-0"]'), name).toHaveValue(value)
  await editor.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(editor).toBeHidden()
}

test.describe('V-UNDO-K8S-WRITE (functional): change history over the K8s write Blocks', () => {
  test('KUR-a: every write Block leaves the canvas on undo and comes back on redo with its identity', async ({
    page,
  }) => {
    await gotoDraftWorkbench(page)
    await expandPalette(page)

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const box = await canvas.boundingBox()
    expect(box, 'canvas must have a box before the first drop').not.toBeNull()

    for (const [index, block] of WRITE_BLOCKS.entries()) {
      await dragPaletteItemToCanvas(
        page,
        { term: 'k8s', testId: block.testId },
        { x: box!.width * (0.18 + index * 0.22), y: box!.height * 0.72 },
      )
      await expect(workflowNodes(page), block.label).toHaveCount(index + 1)
      // Each drop is one history entry only while it lands out of auto-connect reach.
      await expect(canvasEdges(page), `${block.label} must not auto-connect`).toHaveCount(0)
    }

    for (const block of WRITE_BLOCKS) {
      await expect(blockByIcon(page, block.icon), block.label).toHaveCount(1)
      await expect(blockByIcon(page, block.icon), block.label).toContainText(block.label)
    }

    for (const block of [...WRITE_BLOCKS].reverse()) {
      await clickUndo(page)
      await expect(blockByIcon(page, block.icon), block.label).toHaveCount(0)
    }
    await expect(workflowNodes(page)).toHaveCount(0)
    await expect(undoBtn(page)).toBeDisabled()

    for (const block of WRITE_BLOCKS) {
      await clickRedo(page)
      await expect(blockByIcon(page, block.icon), block.label).toHaveCount(1)
      await expect(blockByIcon(page, block.icon), block.label).toContainText(block.label)
    }
    await expect(workflowNodes(page)).toHaveCount(WRITE_BLOCKS.length)
    await expect(canvasEdges(page)).toHaveCount(0)
    await expect(redoBtn(page)).toBeDisabled()
  })

  test('KUR-b: undoing an Apply Define with switch restores Manifest and the manifest it showed', async ({
    page,
  }) => {
    await importValidateAndNavigate(
      page,
      buildFixture({ define_with: 'manifest', manifest: MANIFEST_TEXT }),
    )
    await expect(undoBtn(page)).toBeDisabled()

    let modal = await openSheet(page, APPLY_NODE)
    await expect(modal).toContainText('K8s Apply - Edit Config')
    await expect(enumTrigger(modal, 'define_with')).toHaveText('Manifest')
    await expectStringParamPreview(modal, 'manifest', MANIFEST_TEXT)

    // K8SWRITE-1: the two ways to author an Apply are one enum apart.
    await pickEnum(page, modal, 'define_with', 'Form')
    await expect(paramRow(modal, 'manifest')).toHaveCount(0)
    await setStringParam(modal, page, 'name', FORM_NAME)
    await saveSheet(modal)

    await clickUndo(page)
    modal = await openSheet(page, APPLY_NODE)
    await expect(enumTrigger(modal, 'define_with')).toHaveText('Manifest')
    await expectStringParamPreview(modal, 'manifest', MANIFEST_TEXT)
    await expect(paramRow(modal, 'kind')).toHaveCount(0)
    await expect(paramRow(modal, 'name')).toHaveCount(0)
    await closeSheet(modal)
    // One save is one entry, so the undo landed on the imported baseline.
    await expect(undoBtn(page)).toBeDisabled()

    await clickRedo(page)
    modal = await openSheet(page, APPLY_NODE)
    await expect(enumTrigger(modal, 'define_with')).toHaveText('Form')
    await expect(enumTrigger(modal, 'kind')).toHaveText('ConfigMap')
    await expectStringParamPreview(modal, 'name', FORM_NAME)
    await expect(paramRow(modal, 'manifest')).toHaveCount(0)
    await closeSheet(modal)
    await expect(redoBtn(page)).toBeDisabled()
  })

  test('KUR-c: undoing an Apply Kind switch keeps the ConfigMap and Secret Data fields apart', async ({
    page,
  }) => {
    await importValidateAndNavigate(
      page,
      buildFixture({
        define_with: 'form',
        kind: 'ConfigMap',
        name: FORM_NAME,
        data: { [CM_KEY]: CM_VALUE },
      }),
    )

    let modal = await openSheet(page, APPLY_NODE)
    await expect(enumTrigger(modal, 'kind')).toHaveText('ConfigMap')
    await expect(mapLine(modal, 'data')).toHaveValue(oneEntry(CM_KEY, CM_VALUE))
    await expect(paramRow(modal, 'secret_data')).toHaveCount(0)

    // K8SWRITE-3: the Secret form writes its own field, never the ConfigMap's.
    await pickEnum(page, modal, 'kind', 'Secret')
    await expect(paramRow(modal, 'data')).toHaveCount(0)
    await expect(mapLine(modal, 'secret_data')).not.toHaveValue(ANY_ENTRY)
    await addMapEntry(page, modal, 'secret_data', SECRET_KEY, SECRET_VALUE)
    await saveSheet(modal)

    await clickUndo(page)
    modal = await openSheet(page, APPLY_NODE)
    await expect(enumTrigger(modal, 'kind')).toHaveText('ConfigMap')
    await expect(paramRow(modal, 'secret_data')).toHaveCount(0)
    await expect(paramRow(modal, 'secret_type')).toHaveCount(0)
    await expect(mapLine(modal, 'data')).toHaveValue(oneEntry(CM_KEY, CM_VALUE))
    await expectMapEntry(page, modal, 'data', CM_KEY, CM_VALUE)
    await closeSheet(modal)
    await expect(undoBtn(page)).toBeDisabled()

    await clickRedo(page)
    modal = await openSheet(page, APPLY_NODE)
    await expect(enumTrigger(modal, 'kind')).toHaveText('Secret')
    await expect(enumTrigger(modal, 'secret_type')).toHaveText('Opaque')
    await expect(paramRow(modal, 'data')).toHaveCount(0)
    await expect(mapLine(modal, 'secret_data')).toHaveValue(oneEntry(SECRET_KEY, SECRET_VALUE))
    await expectMapEntry(page, modal, 'secret_data', SECRET_KEY, SECRET_VALUE)
    await closeSheet(modal)
  })

  test('KUR-d: undoing a Job from switch brings Image and Command back with their values', async ({
    page,
  }) => {
    await importValidateAndNavigate(
      page,
      buildFixture({
        define_with: 'form',
        kind: 'Job',
        name: JOB_NAME,
        job_from: 'image',
        image: JOB_IMAGE,
        command: JOB_COMMAND,
      }),
    )

    let modal = await openSheet(page, APPLY_NODE)
    await expect(enumTrigger(modal, 'job_from')).toHaveText('Image')
    await expectStringParamPreview(modal, 'image', JOB_IMAGE)
    await expectStringParamPreview(modal, 'command', JOB_COMMAND)
    await expect(paramRow(modal, 'cronjob_name')).toHaveCount(0)

    // HTTP-8: the hidden rows keep their draft, and only the live mode is saved.
    await pickEnum(page, modal, 'job_from', 'CronJob')
    await expect(paramRow(modal, 'image')).toHaveCount(0)
    await expect(paramRow(modal, 'command')).toHaveCount(0)
    await setStringParam(modal, page, 'cronjob_name', CRONJOB_NAME)
    await saveSheet(modal)

    modal = await openSheet(page, APPLY_NODE)
    await expect(enumTrigger(modal, 'job_from')).toHaveText('CronJob')
    await expectStringParamPreview(modal, 'cronjob_name', CRONJOB_NAME)
    await expect(paramRow(modal, 'image')).toHaveCount(0)
    await expect(paramRow(modal, 'command')).toHaveCount(0)
    await closeSheet(modal)

    await clickUndo(page)
    modal = await openSheet(page, APPLY_NODE)
    await expect(enumTrigger(modal, 'job_from')).toHaveText('Image')
    await expectStringParamPreview(modal, 'image', JOB_IMAGE)
    await expectStringParamPreview(modal, 'command', JOB_COMMAND)
    await expect(paramRow(modal, 'cronjob_name')).toHaveCount(0)
    await closeSheet(modal)
    await expect(undoBtn(page)).toBeDisabled()

    await clickRedo(page)
    modal = await openSheet(page, APPLY_NODE)
    await expect(enumTrigger(modal, 'job_from')).toHaveText('CronJob')
    await expectStringParamPreview(modal, 'cronjob_name', CRONJOB_NAME)
    await expect(paramRow(modal, 'image')).toHaveCount(0)
    await expect(paramRow(modal, 'command')).toHaveCount(0)
    await closeSheet(modal)
  })

  test('KUR-e: undoing a Delete by switch restores Name and the tick the switch cleared', async ({
    page,
  }) => {
    await importValidateAndNavigate(
      page,
      buildFixture({ define_with: 'manifest', manifest: MANIFEST_TEXT }),
    )

    let modal = await openSheet(page, DELETE_NODE)
    await expect(modal).toContainText('K8s Delete - Edit Config')
    await expect(enumTrigger(modal, 'delete_by')).toHaveText('Name')
    await expectStringParamPreview(modal, 'name', DELETE_NAME)
    await expect(checkbox(modal, 'ignore_not_found')).toHaveAttribute('data-state', 'checked')

    // K8SWRITE-5: Ignore not found belongs to Name mode, and a stale tick would
    // turn a failed delete into a pass, so the switch clears it.
    await pickEnum(page, modal, 'delete_by', 'Selector')
    await expect(paramRow(modal, 'name')).toHaveCount(0)
    await expect(paramRow(modal, 'ignore_not_found')).toHaveCount(0)
    await setStringParam(modal, page, 'label_selector', LABEL_SELECTOR)
    await saveSheet(modal)

    await clickUndo(page)
    modal = await openSheet(page, DELETE_NODE)
    await expect(enumTrigger(modal, 'delete_by')).toHaveText('Name')
    await expectStringParamPreview(modal, 'name', DELETE_NAME)
    await expect(checkbox(modal, 'ignore_not_found')).toHaveAttribute('data-state', 'checked')
    await expect(paramRow(modal, 'label_selector')).toHaveCount(0)
    await closeSheet(modal)
    await expect(undoBtn(page)).toBeDisabled()

    await clickRedo(page)
    modal = await openSheet(page, DELETE_NODE)
    await expect(enumTrigger(modal, 'delete_by')).toHaveText('Selector')
    await expectStringParamPreview(modal, 'label_selector', LABEL_SELECTOR)
    await expect(paramRow(modal, 'name')).toHaveCount(0)
    await expect(paramRow(modal, 'ignore_not_found')).toHaveCount(0)
    await closeSheet(modal)
  })

  test('KUR-f: undoing a Rollout Operation switch restores the operation and its outputs', async ({
    page,
  }) => {
    await importValidateAndNavigate(
      page,
      buildFixture({ define_with: 'manifest', manifest: MANIFEST_TEXT }),
    )

    let modal = await openSheet(page, ROLLOUT_NODE)
    await expect(modal).toContainText('K8s Rollout - Edit Config')
    await expect(enumTrigger(modal, 'operation')).toHaveText('Restart')
    await expect(paramRow(modal, 'to_revision')).toHaveCount(0)
    await expect(outputRow(modal, 'status')).toHaveCount(0)

    // K8SWRITE-8: Status is the only operation that can fill the Status output.
    await pickEnum(page, modal, 'operation', 'Status')
    await expect(outputRow(modal, 'status')).toHaveCount(1)
    await saveSheet(modal)

    // K8SWRITE-7: Undo is the operation that takes an optional revision.
    modal = await openSheet(page, ROLLOUT_NODE)
    await pickEnum(page, modal, 'operation', 'Undo')
    await numberInput(modal, 'to_revision').fill(TO_REVISION)
    await saveSheet(modal)

    await clickUndo(page)
    modal = await openSheet(page, ROLLOUT_NODE)
    await expect(enumTrigger(modal, 'operation')).toHaveText('Status')
    await expect(paramRow(modal, 'to_revision')).toHaveCount(0)
    await expect(outputRow(modal, 'status')).toHaveCount(1)
    await closeSheet(modal)

    await clickUndo(page)
    modal = await openSheet(page, ROLLOUT_NODE)
    await expect(enumTrigger(modal, 'operation')).toHaveText('Restart')
    await expect(outputRow(modal, 'status')).toHaveCount(0)
    await closeSheet(modal)
    await expect(undoBtn(page)).toBeDisabled()

    await clickRedo(page)
    await clickRedo(page)
    modal = await openSheet(page, ROLLOUT_NODE)
    await expect(enumTrigger(modal, 'operation')).toHaveText('Undo')
    await expect(numberInput(modal, 'to_revision')).toHaveValue(TO_REVISION)
    await expect(outputRow(modal, 'status')).toHaveCount(0)
    await closeSheet(modal)
    await expect(redoBtn(page)).toBeDisabled()
  })

  test('KUR-g: undoing the delete of a configured Scale Block restores its configuration', async ({
    page,
  }) => {
    await importValidateAndNavigate(
      page,
      buildFixture({ define_with: 'manifest', manifest: MANIFEST_TEXT }),
    )
    await expect(canvasEdges(page)).toHaveCount(CHAIN_EDGES)

    let modal = await openSheet(page, SCALE_NODE)
    await expect(modal).toContainText('K8s Scale - Edit Config')
    await expect(numberInput(modal, 'replicas')).toHaveValue(SEEDED_REPLICAS)
    await numberInput(modal, 'replicas').fill(SCALED_REPLICAS)
    await saveSheet(modal)

    await clickNodeKebabItem(page, SCALE_NODE, 'Delete')
    await expect(canvasNode(page, SCALE_NODE)).toHaveCount(0)
    await expect(canvasEdges(page)).toHaveCount(CHAIN_EDGES - 2)
    await clearPointerLock(page)

    await clickUndo(page)
    await expect(canvasNode(page, SCALE_NODE)).toHaveCount(1)
    await expect(canvasEdges(page)).toHaveCount(CHAIN_EDGES)
    modal = await openSheet(page, SCALE_NODE)
    await expect(numberInput(modal, 'replicas')).toHaveValue(SCALED_REPLICAS)
    await expectStringParamPreview(modal, 'name', SCALE_TARGET)
    await closeSheet(modal)

    // The delete and the config save are separate entries, so one more undo
    // walks back to the imported replica count.
    await clickUndo(page)
    modal = await openSheet(page, SCALE_NODE)
    await expect(numberInput(modal, 'replicas')).toHaveValue(SEEDED_REPLICAS)
    await closeSheet(modal)
    await expect(undoBtn(page)).toBeDisabled()
  })
})
