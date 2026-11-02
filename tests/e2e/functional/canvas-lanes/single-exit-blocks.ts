/** The palette blocks with one exit, and the lane controls with their default lanes, as the palette offers them. */

import type { PaletteBlock } from './lanes-helpers'

function plugin(id: string, name: string): PaletteBlock {
  return { name, spec: { term: name, testId: `palette-item-${id}` }, lanes: [null], disable: true }
}

/** Network, Remote (all but the Remote Execution container), Database and System plugins. */
export const PLUGINS_A: readonly PaletteBlock[] = [
  plugin('http-client', 'HTTP'),
  plugin('ping', 'Ping'),
  plugin('netcat', 'Netcat'),
  plugin('ssh-session-open', 'SSH Session Open'),
  plugin('ssh-session-exec', 'SSH Session Exec'),
  plugin('ssh-session-script', 'SSH Session Script'),
  plugin('ssh-session-close', 'SSH Session Close'),
  plugin('ssh-tunnel-open', 'SSH Tunnel Open'),
  plugin('ssh-tunnel-close', 'SSH Tunnel Close'),
  plugin('sftp', 'SFTP'),
  plugin('sql-client', 'SQL'),
  plugin('opensearch', 'OpenSearch'),
  plugin('shell-script', 'Shell Script'),
  plugin('shell-exec', 'Shell Exec'),
  plugin('python', 'Python'),
  plugin('file-io', 'File I/O'),
  plugin('log', 'Log'),
]

/** Kubernetes, Helm and Data plugins. */
export const PLUGINS_B: readonly PaletteBlock[] = [
  plugin('k8s-connect', 'K8s Connect'),
  plugin('k8s-get', 'K8s Get'),
  plugin('k8s-events', 'K8s Events'),
  plugin('k8s-logs', 'K8s Logs'),
  plugin('k8s-top', 'K8s Top'),
  plugin('k8s-apply', 'K8s Apply'),
  plugin('k8s-delete', 'K8s Delete'),
  plugin('k8s-scale', 'K8s Scale'),
  plugin('k8s-rollout', 'K8s Rollout'),
  plugin('k8s-exec', 'K8s Exec'),
  plugin('k8s-script', 'K8s Script'),
  plugin('k8s-copy', 'K8s Copy'),
  plugin('helm-install', 'Helm Install'),
  plugin('helm-upgrade', 'Helm Upgrade'),
  plugin('helm-rollback', 'Helm Rollback'),
  plugin('helm-uninstall', 'Helm Uninstall'),
  plugin('helm-test', 'Helm Test'),
  plugin('helm-status', 'Helm Status'),
  plugin('csv-parser', 'CSV'),
  plugin('excel-parser', 'Excel'),
  plugin('xml-parser', 'XML'),
  plugin('json-parser', 'JSON'),
]

/** Single-exit controls and a new local Function. */
export const CONTROLS_AND_FUNCTION: readonly PaletteBlock[] = [
  plugin('break', 'Break'),
  plugin('continue', 'Continue'),
  plugin('variable-setter', 'Var Setter'),
  plugin('delay', 'Delay'),
  { name: 'Function', spec: 'new-function', lanes: [null], disable: false },
]

function laneControl(id: string, name: string, lanes: string[]): PaletteBlock {
  return { name, spec: { term: name, testId: `palette-item-${id}` }, lanes, disable: true }
}

/** Every lane control as dropped from the palette, with the lanes its default settings draw. */
export const LANE_CONTROL_DEFAULTS: readonly PaletteBlock[] = [
  laneControl('if-else', 'If / Else', ['branch_0', 'branch_1']),
  laneControl('switch-case', 'Switch', ['branch_0', 'then']),
  laneControl('assert', 'Assert', ['pass', 'fail']),
  laneControl('for', 'For Loop', ['body', 'then']),
  laneControl('for-each', 'For Each', ['body', 'then']),
  laneControl('while', 'While Loop', ['body', 'then']),
  laneControl('parallel', 'Parallel', ['branch_1', 'branch_2', 'then']),
  laneControl('try-catch-finally', 'Try / Catch', ['try', 'catch', 'then']),
  laneControl('wait-until', 'Wait Until', ['retry', 'then']),
  laneControl('remote-execution', 'Remote Execution', ['body', 'then']),
  laneControl('halt', 'Halt', []),
]
