/**
 * Icon Registry - REQ-5.2.1.46, REQ-3.4.4.2, REQ-3.4.1.17
 *
 * Centralized registry mapping iconName strings to Lucide React components.
 * Enables controls and plugins to reference icons by name rather than direct imports.
 */

import {
  // Control icons (14)
  GitFork,
  ListTree,
  CheckCircle,
  Repeat,
  IterationCw,
  RefreshCw,
  LogOut,
  SkipForward,
  Split,
  ShieldCheck,
  OctagonX,
  Timer,
  Hourglass,
  StickyNote,
  // Plugin icons - Network (3)
  Globe,
  Radio,
  Cable,
  // Plugin icons - Remote Set A (4 new; LogOut + Cable reused from control/network, Terminal from Kubernetes) and SFTP
  LogIn,
  FileTerminal,
  Unplug,
  ServerCog,
  FolderSync,
  // Plugin icons - Database (2)
  Database,
  SearchCode,
  // Plugin icons - System (3 new; Shell Script reuses FileTerminal, Shell Exec reuses Terminal)
  FileCode2,
  FileInput,
  ScrollText,
  // Plugin icons - Kubernetes (9; K8s Connect reuses Cable, K8s Rollout reuses RefreshCw, K8s Script reuses FileTerminal)
  PackageSearch,
  History,
  Logs,
  Gauge,
  CloudUpload,
  Trash2,
  Scaling,
  Terminal,
  ArrowRightLeft,
  // Plugin icons - Helm (6)
  PackagePlus,
  CircleArrowUp,
  Undo2,
  PackageMinus,
  FlaskConical,
  Activity,
  // Plugin icons - Data (5)
  FileSpreadsheet,
  FileType,
  Sheet,
  FileJson,
  Variable,
  // Function rows (REQ-4.2.5 quick-add)
  FunctionSquare,
  Plus,
  // Fallback
  HelpCircle,
  type LucideIcon,
} from 'lucide-react'

/**
 * Registry mapping icon names to Lucide components.
 * This is the single source of truth for icon availability.
 *
 * Contains:
 * - 14 control icons (REQ-5.2.1.46)
 * - 33 plugin icons (REQ-3.4.4.2, REQ-3.4.1.17)
 * - 2 Function-row icons (REQ-4.2.5)
 */
const ICON_REGISTRY: Record<string, LucideIcon> = {
  // Conditional controls
  GitFork,
  ListTree,
  CheckCircle,
  // Loop controls
  Repeat,
  IterationCw,
  RefreshCw,
  LogOut,      // Break
  SkipForward, // Continue
  // Flow controls
  Split,
  ShieldCheck,
  OctagonX,
  // Timing controls
  Timer,
  Hourglass,
  // Misc controls
  StickyNote,
  // Plugin icons - Network (3)
  Globe,        // HTTP
  Radio,        // Ping
  Cable,        // Netcat (also SSH Tunnel Open, Set A, and K8s Connect)
  // Plugin icons - Remote Set A (SSH sessions/tunnels + Remote Execution; SSH Session Exec reuses Terminal) and SFTP
  LogIn,        // SSH Session Open
  FileTerminal, // SSH Session Script (also Shell Script and K8s Script)
  Unplug,       // SSH Tunnel Close
  ServerCog,    // Remote Execution
  FolderSync,   // SFTP
  // Plugin icons - Database (2)
  Database,     // SQL
  SearchCode,   // OpenSearch
  // Plugin icons - System (3 new; Shell Script reuses FileTerminal, Shell Exec reuses Terminal)
  FileCode2,    // Python
  FileInput,    // File I/O
  ScrollText,   // Log
  // Plugin icons - Kubernetes (9; K8s Connect reuses Cable, K8s Rollout reuses RefreshCw, K8s Script reuses FileTerminal)
  PackageSearch, // K8s Get
  History,      // K8s Events
  Logs,         // K8s Logs
  Gauge,        // K8s Top
  CloudUpload,  // K8s Apply
  Trash2,       // K8s Delete
  Scaling,      // K8s Scale
  Terminal,     // K8s Exec (also Shell Exec and SSH Session Exec)
  ArrowRightLeft, // K8s Copy
  // Plugin icons - Helm (6)
  PackagePlus,  // Helm Install
  CircleArrowUp, // Helm Upgrade
  Undo2,        // Helm Rollback
  PackageMinus, // Helm Uninstall
  FlaskConical, // Helm Test
  Activity,     // Helm Status
  // Plugin icons - Data (5)
  FileSpreadsheet, // CSV
  Sheet,        // Excel
  FileType,     // XML
  FileJson,     // JSON
  Variable,     // Variable
  // Function rows (REQ-4.2.5 quick-add)
  FunctionSquare,
  Plus,
}

/**
 * All registered icon names.
 * Contains:
 * - 14 control icons (REQ-5.2.1.46)
 * - 33 plugin icons (REQ-3.4.4.2, REQ-3.4.1.17)
 * - 2 Function-row icons (REQ-4.2.5)
 * Total: 49 icons
 */
export const ICON_NAMES = Object.keys(ICON_REGISTRY) as readonly string[]

/**
 * Get the icon component for a given icon name.
 * Returns a fallback icon (HelpCircle) for unknown or empty names.
 *
 * @param iconName - The name of the icon to look up
 * @returns The Lucide icon component
 */
export function getIconComponent(iconName: string): LucideIcon {
  if (!iconName || !(iconName in ICON_REGISTRY)) {
    return HelpCircle
  }
  return ICON_REGISTRY[iconName]
}

/**
 * Check if an icon name is registered in the registry.
 *
 * @param name - The icon name to validate
 * @returns True if the icon is registered, false otherwise
 */
export function isValidIconName(name: string): boolean {
  return Boolean(name) && name in ICON_REGISTRY
}
