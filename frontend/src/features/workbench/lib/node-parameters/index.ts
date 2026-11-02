/**
 * Node Parameters - Public API
 *
 * Merges per-file control and plugin registries into lookup maps.
 * Provides getter functions and output binding validation.
 */

import {
  functionBlockDefinition,
  functionBlockInputs,
  functionBlockOutputs,
} from '@/features/functions/lib/function-block-fields'
import type { GroupMeta, InputParam, OutputParam, OutputBindingError, SecretMaskField } from './types'
import { OUTPUT_TYPE_COMPAT } from './types'
import { resolveOutputTypes } from './output-type'

// Controls
import * as ifElse from './controls/if-else'
import * as switchCase from './controls/switch-case'
import * as assert from './controls/assert'
import * as forControl from './controls/for'
import * as forEach from './controls/for-each'
import * as whileControl from './controls/while'
import * as breakControl from './controls/break'
import * as continueControl from './controls/continue'
import * as parallel from './controls/parallel'
import * as tryCatchFinally from './controls/try-catch-finally'
import * as halt from './controls/halt'
import * as delay from './controls/delay'
import * as waitUntil from './controls/wait-until'
import * as note from './controls/note'
import * as variableSetter from './controls/variable-setter'

// Plugins
import * as shellScript from './plugins/shell-script'
import * as shellExec from './plugins/shell-exec'
import * as python from './plugins/python'
import * as fileIo from './plugins/file-io'
import * as httpClient from './plugins/http-client'
import * as ping from './plugins/ping'
import * as netcat from './plugins/netcat'
import * as sqlClient from './plugins/sql-client'
import * as openSearch from './plugins/opensearch'
import * as log from './plugins/log'
import * as jsonParser from './plugins/json-parser'
import * as csvParser from './plugins/csv-parser'
import * as excelParser from './plugins/excel-parser'
import * as xmlParser from './plugins/xml-parser'
import * as sshSessionOpen from './plugins/ssh-session-open'
import * as sshSessionExec from './plugins/ssh-session-exec'
import * as sshSessionScript from './plugins/ssh-session-script'
import * as sshSessionClose from './plugins/ssh-session-close'
import * as sshTunnelOpen from './plugins/ssh-tunnel-open'
import * as sshTunnelClose from './plugins/ssh-tunnel-close'
import * as sftp from './plugins/sftp'
import * as remoteExecution from './plugins/remote-execution'
import * as k8sConnect from './plugins/k8s-connect'
import * as k8sGet from './plugins/k8s-get'
import * as k8sEvents from './plugins/k8s-events'
import * as k8sLogs from './plugins/k8s-logs'
import * as k8sTop from './plugins/k8s-top'
import * as k8sApply from './plugins/k8s-apply'
import * as k8sDelete from './plugins/k8s-delete'
import * as k8sScale from './plugins/k8s-scale'
import * as k8sRollout from './plugins/k8s-rollout'
import * as k8sExec from './plugins/k8s-exec'
import * as k8sScript from './plugins/k8s-script'
import * as k8sCopy from './plugins/k8s-copy'
import * as helmInstall from './plugins/helm-install'
import * as helmUpgrade from './plugins/helm-upgrade'
import * as helmRollback from './plugins/helm-rollback'
import * as helmUninstall from './plugins/helm-uninstall'
import * as helmTest from './plugins/helm-test'
import * as helmStatus from './plugins/helm-status'

// ============================================================================
// Registries
// ============================================================================

export const CONTROL_INPUTS: Record<string, InputParam[]> = {
  'if-else': ifElse.inputs,
  'switch-case': switchCase.inputs,
  'assert': assert.inputs,
  'for': forControl.inputs,
  'for-each': forEach.inputs,
  'while': whileControl.inputs,
  'break': breakControl.inputs,
  'continue': continueControl.inputs,
  'parallel': parallel.inputs,
  'try-catch-finally': tryCatchFinally.inputs,
  'halt': halt.inputs,
  'delay': delay.inputs,
  'wait-until': waitUntil.inputs,
  'note': note.inputs,
  'variable-setter': variableSetter.inputs,
}

export const CONTROL_OUTPUTS: Record<string, OutputParam[]> = {
  'if-else': ifElse.outputs,
  'switch-case': switchCase.outputs,
  'assert': assert.outputs,
  'for': forControl.outputs,
  'for-each': forEach.outputs,
  'while': whileControl.outputs,
  'break': breakControl.outputs,
  'continue': continueControl.outputs,
  'parallel': parallel.outputs,
  'try-catch-finally': tryCatchFinally.outputs,
  'halt': halt.outputs,
  'delay': delay.outputs,
  'wait-until': waitUntil.outputs,
  'note': note.outputs,
  'variable-setter': variableSetter.outputs,
}

export const PLUGIN_INPUTS: Record<string, InputParam[]> = {
  'shell-script': shellScript.inputs,
  'shell-exec': shellExec.inputs,
  'python': python.inputs,
  'file-io': fileIo.inputs,
  'http-client': httpClient.inputs,
  'ping': ping.inputs,
  'netcat': netcat.inputs,
  'sql-client': sqlClient.inputs,
  'opensearch': openSearch.inputs,
  'log': log.inputs,
  'json-parser': jsonParser.inputs,
  'csv-parser': csvParser.inputs,
  'excel-parser': excelParser.inputs,
  'xml-parser': xmlParser.inputs,
  'ssh-session-open': sshSessionOpen.inputs,
  'ssh-session-exec': sshSessionExec.inputs,
  'ssh-session-script': sshSessionScript.inputs,
  'ssh-session-close': sshSessionClose.inputs,
  'ssh-tunnel-open': sshTunnelOpen.inputs,
  'ssh-tunnel-close': sshTunnelClose.inputs,
  'sftp': sftp.inputs,
  'remote-execution': remoteExecution.inputs,
  'k8s-connect': k8sConnect.inputs,
  'k8s-get': k8sGet.inputs,
  'k8s-events': k8sEvents.inputs,
  'k8s-logs': k8sLogs.inputs,
  'k8s-top': k8sTop.inputs,
  'k8s-apply': k8sApply.inputs,
  'k8s-delete': k8sDelete.inputs,
  'k8s-scale': k8sScale.inputs,
  'k8s-rollout': k8sRollout.inputs,
  'k8s-exec': k8sExec.inputs,
  'k8s-script': k8sScript.inputs,
  'k8s-copy': k8sCopy.inputs,
  'helm-install': helmInstall.inputs,
  'helm-upgrade': helmUpgrade.inputs,
  'helm-rollback': helmRollback.inputs,
  'helm-uninstall': helmUninstall.inputs,
  'helm-test': helmTest.inputs,
  'helm-status': helmStatus.inputs,
}

export const PLUGIN_OUTPUTS: Record<string, OutputParam[]> = {
  'shell-script': shellScript.outputs,
  'shell-exec': shellExec.outputs,
  'python': python.outputs,
  'file-io': fileIo.outputs,
  'http-client': httpClient.outputs,
  'ping': ping.outputs,
  'netcat': netcat.outputs,
  'sql-client': sqlClient.outputs,
  'opensearch': openSearch.outputs,
  'log': log.outputs,
  'json-parser': jsonParser.outputs,
  'csv-parser': csvParser.outputs,
  'excel-parser': excelParser.outputs,
  'xml-parser': xmlParser.outputs,
  'ssh-session-open': sshSessionOpen.outputs,
  'ssh-session-exec': sshSessionExec.outputs,
  'ssh-session-script': sshSessionScript.outputs,
  'ssh-session-close': sshSessionClose.outputs,
  'ssh-tunnel-open': sshTunnelOpen.outputs,
  'ssh-tunnel-close': sshTunnelClose.outputs,
  'sftp': sftp.outputs,
  'remote-execution': remoteExecution.outputs,
  'k8s-connect': k8sConnect.outputs,
  'k8s-get': k8sGet.outputs,
  'k8s-events': k8sEvents.outputs,
  'k8s-logs': k8sLogs.outputs,
  'k8s-top': k8sTop.outputs,
  'k8s-apply': k8sApply.outputs,
  'k8s-delete': k8sDelete.outputs,
  'k8s-scale': k8sScale.outputs,
  'k8s-rollout': k8sRollout.outputs,
  'k8s-exec': k8sExec.outputs,
  'k8s-script': k8sScript.outputs,
  'k8s-copy': k8sCopy.outputs,
  'helm-install': helmInstall.outputs,
  'helm-upgrade': helmUpgrade.outputs,
  'helm-rollback': helmRollback.outputs,
  'helm-uninstall': helmUninstall.outputs,
  'helm-test': helmTest.outputs,
  'helm-status': helmStatus.outputs,
}

/** Group metadata per plugin: header description + default expansion per group. */
export const PLUGIN_GROUPS: Record<string, Record<string, GroupMeta>> = {
  'shell-script': shellScript.groups,
  'shell-exec': shellExec.groups,
  'python': python.groups,
  'http-client': httpClient.groups,
  'ping': ping.groups,
  'netcat': netcat.groups,
  'sql-client': sqlClient.groups,
  'opensearch': openSearch.groups,
  'ssh-session-open': sshSessionOpen.groups,
  'ssh-tunnel-open': sshTunnelOpen.groups,
  'sftp': sftp.groups,
  'k8s-connect': k8sConnect.groups,
  'k8s-get': k8sGet.groups,
  'k8s-events': k8sEvents.groups,
  'k8s-logs': k8sLogs.groups,
  'k8s-top': k8sTop.groups,
  'k8s-apply': k8sApply.groups,
  'k8s-delete': k8sDelete.groups,
  'k8s-scale': k8sScale.groups,
  'k8s-rollout': k8sRollout.groups,
  'k8s-exec': k8sExec.groups,
  'k8s-script': k8sScript.groups,
  'k8s-copy': k8sCopy.groups,
  'helm-install': helmInstall.groups,
  'helm-upgrade': helmUpgrade.groups,
  'helm-rollback': helmRollback.groups,
  'helm-uninstall': helmUninstall.groups,
  'helm-test': helmTest.groups,
  'helm-status': helmStatus.groups,
}

// Per-plugin credential-field catalogs driving the block Secret Masking control.
// Only plugins that KNOW their credential fields by protocol declare one.
export const SECRET_MASK_FIELDS: Record<string, SecretMaskField[]> = {
  'http-client': httpClient.secretMaskFields,
  'ssh-session-open': sshSessionOpen.secretMaskFields,
  'sql-client': sqlClient.secretMaskFields,
  'opensearch': openSearch.secretMaskFields,
}

export const ALL_INPUTS: Record<string, InputParam[]> = {
  ...CONTROL_INPUTS,
  ...PLUGIN_INPUTS,
}

export const ALL_OUTPUTS: Record<string, OutputParam[]> = {
  ...CONTROL_OUTPUTS,
  ...PLUGIN_OUTPUTS,
}

// ============================================================================
// Lookup functions
// ============================================================================

export function getInputParams(nodeId: string): InputParam[] | undefined {
  return ALL_INPUTS[nodeId]
}

export function getOutputParams(nodeId: string): OutputParam[] | undefined {
  return ALL_OUTPUTS[nodeId]
}

function isFunctionBlock(data: Record<string, unknown>): boolean {
  return data.nodeType === 'function' || data.functionLifecycle !== undefined
}

/** The Block type its data names; anything else names none. */
function blockElementType(data: Record<string, unknown>): string {
  return typeof data.elementType === 'string' ? data.elementType : ''
}

/** One field lookup by Block data for every Block: plugin, control and Function (REQ-3.1.1.5). */
export function blockInputParams(data: Record<string, unknown>): InputParam[] | undefined {
  if (isFunctionBlock(data)) {
    const definition = functionBlockDefinition(data)
    return definition ? functionBlockInputs(definition) : undefined
  }
  return getInputParams(blockElementType(data))
}

/** The outputs of any Block, read the same way as its fields. */
export function blockOutputParams(data: Record<string, unknown>): OutputParam[] | undefined {
  if (isFunctionBlock(data)) {
    const definition = functionBlockDefinition(data)
    return definition ? functionBlockOutputs(definition) : undefined
  }
  return getOutputParams(blockElementType(data))
}

export function hasNodeParams(nodeId: string): boolean {
  return nodeId in ALL_INPUTS || nodeId in ALL_OUTPUTS
}

export function getGroupMeta(nodeId: string): Record<string, GroupMeta> | undefined {
  return PLUGIN_GROUPS[nodeId]
}

export function getSecretMaskFields(nodeId: string): SecretMaskField[] | undefined {
  return SECRET_MASK_FIELDS[nodeId]
}

// ============================================================================
// Output binding validation
// ============================================================================

function validateNodeBindings(
  node: { data: Record<string, unknown> },
  varsByName: Map<string, { name: string; type: string }>,
): OutputBindingError[] {
  const config = node.data.config as Record<string, unknown> | undefined
  const bindings = config?.outputBindings as Record<string, string> | undefined
  if (!bindings) return []

  const elementType = (node.data.elementType as string) || ''
  const nodeLabel = (node.data.label as string) || elementType
  const outputTypes = resolveOutputTypes(
    blockOutputParams(node.data) ?? [],
    (config?.values ?? {}) as Record<string, unknown>,
    blockInputParams(node.data),
  )

  const errors: OutputBindingError[] = []
  for (const [paramName, varName] of Object.entries(bindings)) {
    if (!varName) continue
    const variable = varsByName.get(varName)
    if (!variable) continue

    // An output the schema does not declare carries no type here, so it is left alone.
    const paramType = outputTypes.get(paramName)
    if (paramType === undefined) continue
    const compat = OUTPUT_TYPE_COMPAT[paramType]
    if (!compat || compat.size === 0) continue

    if (!compat.has(variable.type)) {
      errors.push({ nodeLabel, paramName, paramType, varName, varType: variable.type })
    }
  }
  return errors
}

export function validateOutputBindings(
  nodes: Array<{ data: Record<string, unknown> }>,
  variables: Array<{ name: string; type: string }>
): OutputBindingError[] {
  const varsByName = new Map(variables.map((v) => [v.name, v]))
  const errors: OutputBindingError[] = []
  for (const node of nodes) {
    errors.push(...validateNodeBindings(node, varsByName))
  }
  return errors
}
