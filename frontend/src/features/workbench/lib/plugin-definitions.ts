/**
 * Plugin Definitions - REQ-3.4.4.1, REQ-3.4.4.2, REQ-3.4.1.17
 *
 * Hardcoded definitions for the 40 built-in plugins in WAVE (39 executors plus
 * the Remote Execution container, filed in the Remote section).
 * Provides typed definitions with iconName references (not direct component imports).
 */

/**
 * Plugin category type.
 */
export type PluginCategory =
  | 'network'
  | 'remote'
  | 'database'
  | 'system'
  | 'kubernetes'
  | 'helm'
  | 'data'

/**
 * Plugin definition interface.
 */
export interface PluginDefinition {
  /** Unique identifier (e.g., 'http-client', 'shell-script') */
  id: string
  /** Display name (e.g., 'HTTP', 'Shell Script') */
  name: string
  /** Category for grouping */
  category: PluginCategory
  /** Icon name from icon-registry */
  iconName: string
  /** Tailwind color class for the icon */
  colorClass: string
  /** Bundle-safe: runs on the remote host inside a Remote Execution container
   *  (mirrors the backend PluginMetadata.remotable flag). Others run on WAVE. */
  remotable: boolean
}

/**
 * Category definition interface.
 */
export interface CategoryDefinition {
  /** Unique identifier (e.g., 'network', 'database') */
  id: PluginCategory
  /** Display name (e.g., 'Network', 'Database') */
  name: string
  /** Tailwind color class for the category */
  colorClass: string
}

/**
 * Category color classes.
 */
const CATEGORY_COLORS: Record<PluginCategory, string> = {
  network: 'text-blue-500',
  remote: 'text-cyan-500',
  database: 'text-purple-500',
  system: 'text-red-500',
  kubernetes: 'text-sky-500',
  helm: 'text-indigo-500',
  data: 'text-emerald-500',
}

/** Build a plugin definition with automatic color class from category. */
function def(
  id: string,
  name: string,
  category: PluginCategory,
  iconName: string,
  remotable = false,
): PluginDefinition {
  return { id, name, category, iconName, colorClass: CATEGORY_COLORS[category], remotable }
}

/**
 * All 40 plugin definitions.
 *
 * Inventory:
 * - Network (3): HTTP, Ping, Netcat
 * - Remote (8): SSH Session Open, SSH Session Exec, SSH Session Script, SSH Session Close, SSH Tunnel Open, SSH Tunnel Close, SFTP, Remote Execution
 * - Database (2): SQL, OpenSearch
 * - System (5): Shell Script, Shell Exec, Python, File I/O, Log
 * - Kubernetes (12): K8s Connect, K8s Get, K8s Events, K8s Logs, K8s Top, K8s Apply, K8s Delete, K8s Scale, K8s Rollout, K8s Exec, K8s Script, K8s Copy
 * - Helm (6): Helm Install, Helm Upgrade, Helm Rollback, Helm Uninstall, Helm Test, Helm Status
 * - Data (4): CSV, Excel, XML, JSON
 */
export const PLUGIN_DEFINITIONS: readonly PluginDefinition[] = [
  // Network (blue) - 3 plugins
  def('http-client', 'HTTP', 'network', 'Globe', true), // remotable (pure-Python httpx)
  def('ping', 'Ping', 'network', 'Radio', true), // remotable (pure-Python stdlib core)
  def('netcat', 'Netcat', 'network', 'Cable', true), // remotable (pure-Python stdlib core)

  // Remote (cyan) - 8: 6 SSH session/tunnel plugins (Set A icons), SFTP, Remote Execution
  def('ssh-session-open', 'SSH Session Open', 'remote', 'LogIn'),
  def('ssh-session-exec', 'SSH Session Exec', 'remote', 'Terminal'),
  def('ssh-session-script', 'SSH Session Script', 'remote', 'FileTerminal'),
  def('ssh-session-close', 'SSH Session Close', 'remote', 'LogOut'),
  def('ssh-tunnel-open', 'SSH Tunnel Open', 'remote', 'Cable'),
  def('ssh-tunnel-close', 'SSH Tunnel Close', 'remote', 'Unplug'),
  def('sftp', 'SFTP', 'remote', 'FolderSync'),
  def('remote-execution', 'Remote Execution', 'remote', 'ServerCog'),

  // Database (purple) - 2 plugins
  def('sql-client', 'SQL', 'database', 'Database', true), // remotable (drivers carried to the host, SQL-15)
  def('opensearch', 'OpenSearch', 'database', 'SearchCode', true), // remotable (vendored stdlib REST client)

  // System (red) - 5 plugins
  def('shell-script', 'Shell Script', 'system', 'FileTerminal'),
  def('shell-exec', 'Shell Exec', 'system', 'Terminal'),
  def('python', 'Python', 'system', 'FileCode2', true), // remotable (vendored local-process runtime)
  def('file-io', 'File I/O', 'system', 'FileInput', true), // remotable (pure-Python stdlib core)
  def('log', 'Log', 'system', 'ScrollText'),

  // Kubernetes (sky) - 12 plugins; all in the remote bundle
  def('k8s-connect', 'K8s Connect', 'kubernetes', 'Cable', true),
  def('k8s-get', 'K8s Get', 'kubernetes', 'PackageSearch', true),
  def('k8s-events', 'K8s Events', 'kubernetes', 'History', true),
  def('k8s-logs', 'K8s Logs', 'kubernetes', 'Logs', true),
  def('k8s-top', 'K8s Top', 'kubernetes', 'Gauge', true),
  def('k8s-apply', 'K8s Apply', 'kubernetes', 'CloudUpload', true),
  def('k8s-delete', 'K8s Delete', 'kubernetes', 'Trash2', true),
  def('k8s-scale', 'K8s Scale', 'kubernetes', 'Scaling', true),
  def('k8s-rollout', 'K8s Rollout', 'kubernetes', 'RefreshCw', true),
  def('k8s-exec', 'K8s Exec', 'kubernetes', 'Terminal', true),
  def('k8s-script', 'K8s Script', 'kubernetes', 'FileTerminal', true),
  def('k8s-copy', 'K8s Copy', 'kubernetes', 'ArrowRightLeft', true),

  // Helm (indigo) - 6 plugins; all in the remote bundle
  def('helm-install', 'Helm Install', 'helm', 'PackagePlus', true),
  def('helm-upgrade', 'Helm Upgrade', 'helm', 'CircleArrowUp', true),
  def('helm-rollback', 'Helm Rollback', 'helm', 'Undo2', true),
  def('helm-uninstall', 'Helm Uninstall', 'helm', 'PackageMinus', true),
  def('helm-test', 'Helm Test', 'helm', 'FlaskConical', true),
  def('helm-status', 'Helm Status', 'helm', 'Activity', true),

  // Data (emerald) - 4 plugins
  def('csv-parser', 'CSV', 'data', 'FileSpreadsheet'),
  def('excel-parser', 'Excel', 'data', 'Sheet'),
  def('xml-parser', 'XML', 'data', 'FileType'),
  def('json-parser', 'JSON', 'data', 'FileJson'),
]

/**
 * The plugin categories with display info; every entry has at least one plugin.
 */
export const PLUGIN_CATEGORIES: readonly CategoryDefinition[] = [
  { id: 'network', name: 'Network', colorClass: CATEGORY_COLORS.network },
  { id: 'remote', name: 'Remote', colorClass: CATEGORY_COLORS.remote },
  { id: 'database', name: 'Database', colorClass: CATEGORY_COLORS.database },
  { id: 'system', name: 'System', colorClass: CATEGORY_COLORS.system },
  { id: 'kubernetes', name: 'Kubernetes', colorClass: CATEGORY_COLORS.kubernetes },
  { id: 'helm', name: 'Helm', colorClass: CATEGORY_COLORS.helm },
  { id: 'data', name: 'Data', colorClass: CATEGORY_COLORS.data },
]

/**
 * Get a plugin definition by its ID.
 *
 * @param id - The plugin ID to look up
 * @returns The plugin definition or undefined if not found
 */
export function getPluginById(id: string): PluginDefinition | undefined {
  return PLUGIN_DEFINITIONS.find((p) => p.id === id)
}

/**
 * Get all plugins in a given category.
 *
 * @param category - The category to filter by
 * @returns Array of plugins in the category (empty if invalid category)
 */
export function getPluginsByCategory(category: PluginCategory): PluginDefinition[] {
  return PLUGIN_DEFINITIONS.filter((p) => p.category === category)
}
