/**
 * Icon registries for workflow node element types.
 * Maps elementType to Lucide icon components and icon names; colors come from the block definitions.
 */

import {
  Globe,
  Database,
  GitFork,
  Repeat,
  Box,
  // Controls
  ListTree,
  CheckCircle,
  IterationCw,
  RefreshCw,
  LogOut,
  SkipForward,
  Split,
  ShieldCheck,
  OctagonX,
  Timer,
  Hourglass,
  // Plugins - Network
  Radio,
  Cable,
  // Plugins - Remote (Set A, then SFTP)
  LogIn,
  FileTerminal,
  Unplug,
  ServerCog,
  FolderSync,
  // Plugins - Database
  SearchCode,
  // Plugins - System
  FileCode2,
  FileInput,
  ScrollText,
  // Plugins - Kubernetes (K8s Connect reuses Cable, K8s Rollout reuses RefreshCw)
  PackageSearch,
  History,
  Logs,
  Gauge,
  CloudUpload,
  Trash2,
  Scaling,
  Terminal,
  ArrowRightLeft,
  // Plugins - Helm
  PackagePlus,
  CircleArrowUp,
  Undo2,
  PackageMinus,
  FlaskConical,
  Activity,
  // Plugins - Data
  FileSpreadsheet,
  FileType,
  Sheet,
  FileJson,
  Variable,
  // Functions
  FunctionSquare,
} from 'lucide-react'
import { getControlById } from '@/features/workbench/lib/control-definitions'
import { FUNCTION_COLOR_CLASS } from '@/features/workbench/lib/function-definition'
import { getPluginById } from '@/features/workbench/lib/plugin-definitions'

// Icon registry mapping elementType to Lucide icon (matches lib/plugin-definitions.ts)
const ICON_REGISTRY: Record<string, typeof Box> = {
  // Controls - Conditional
  'if-else': GitFork,
  'switch-case': ListTree,
  'assert': CheckCircle,
  // Controls - Loop
  'for': Repeat,
  'loop': Repeat, // alias for 'for'
  'for-each': IterationCw,
  'while': RefreshCw,
  'break': LogOut,
  'continue': SkipForward,
  // Controls - Flow
  'parallel': Split,
  'try-catch-finally': ShieldCheck,
  'halt': OctagonX,
  'variable-setter': Variable,
  // Controls - Timing
  'delay': Timer,
  'wait-until': Hourglass,
  // Plugins - Network
  'http-client': Globe,
  'http': Globe, // alias
  'ping': Radio,
  'netcat': Cable,
  // Plugins - Remote (Set A)
  'ssh-session-open': LogIn,
  'ssh-session-exec': Terminal,
  'ssh-session-script': FileTerminal,
  'ssh-session-close': LogOut,
  'ssh-tunnel-open': Cable,
  'ssh-tunnel-close': Unplug,
  'sftp': FolderSync,
  'remote-execution': ServerCog,
  // Plugins - Database
  'sql-client': Database,
  'sql': Database, // alias
  'opensearch': SearchCode,
  // Plugins - System
  'shell-script': FileTerminal,
  'shell-exec': Terminal,
  'python': FileCode2,
  'file-io': FileInput,
  'log': ScrollText,
  // Plugins - Kubernetes
  'k8s-connect': Cable,
  'k8s-get': PackageSearch,
  'k8s-events': History,
  'k8s-logs': Logs,
  'k8s-top': Gauge,
  'k8s-apply': CloudUpload,
  'k8s-delete': Trash2,
  'k8s-scale': Scaling,
  'k8s-rollout': RefreshCw,
  'k8s-exec': Terminal,
  'k8s-script': FileTerminal,
  'k8s-copy': ArrowRightLeft,
  // Plugins - Helm
  'helm-install': PackagePlus,
  'helm-upgrade': CircleArrowUp,
  'helm-rollback': Undo2,
  'helm-uninstall': PackageMinus,
  'helm-test': FlaskConical,
  'helm-status': Activity,
  // Plugins - Data
  'csv-parser': FileSpreadsheet,
  'excel-parser': Sheet,
  'xml-parser': FileType,
  'json-parser': FileJson,
  // Functions
  'function': FunctionSquare,
}

// Icon name registry for data-icon attribute
const ICON_NAME_REGISTRY: Record<string, string> = {
  // Controls
  'if-else': 'git-fork',
  'switch-case': 'list-tree',
  'assert': 'check-circle',
  'for': 'repeat',
  'loop': 'repeat', // alias
  'for-each': 'iteration-cw',
  'while': 'refresh-cw',
  'break': 'log-out',
  'continue': 'skip-forward',
  'parallel': 'split',
  'try-catch-finally': 'shield-check',
  'halt': 'octagon-x',
  'variable-setter': 'variable',
  'delay': 'timer',
  'wait-until': 'hourglass',
  // Plugins - Network
  'http-client': 'globe',
  'http': 'globe', // alias
  'ping': 'radio',
  'netcat': 'cable',
  // Plugins - Remote (Set A)
  'ssh-session-open': 'log-in',
  'ssh-session-exec': 'terminal',
  'ssh-session-script': 'file-terminal',
  'ssh-session-close': 'log-out',
  'ssh-tunnel-open': 'cable',
  'ssh-tunnel-close': 'unplug',
  'sftp': 'folder-sync',
  'remote-execution': 'server-cog',
  // Plugins - Database
  'sql-client': 'database',
  'sql': 'database', // alias
  'opensearch': 'search-code',
  // Plugins - System
  'shell-script': 'file-terminal',
  'shell-exec': 'terminal',
  'python': 'file-code-2',
  'file-io': 'file-input',
  'log': 'scroll-text',
  // Plugins - Kubernetes
  'k8s-connect': 'cable',
  'k8s-get': 'package-search',
  'k8s-events': 'history',
  'k8s-logs': 'logs',
  'k8s-top': 'gauge',
  'k8s-apply': 'cloud-upload',
  'k8s-delete': 'trash-2',
  'k8s-scale': 'scaling',
  'k8s-rollout': 'refresh-cw',
  'k8s-exec': 'terminal',
  'k8s-script': 'file-terminal',
  'k8s-copy': 'arrow-right-left',
  // Plugins - Helm
  'helm-install': 'package-plus',
  'helm-upgrade': 'circle-arrow-up',
  'helm-rollback': 'undo-2',
  'helm-uninstall': 'package-minus',
  'helm-test': 'flask-conical',
  'helm-status': 'activity',
  // Plugins - Data
  'csv-parser': 'file-spreadsheet',
  'excel-parser': 'sheet',
  'xml-parser': 'file-type',
  'json-parser': 'file-json',
  // Functions
  'function': 'function-square',
}

/**
 * Get the color class for a block type
 */
export function getColorClass(elementType: string): string {
  return (
    getPluginById(elementType)?.colorClass ??
    getControlById(elementType)?.colorClass ??
    (elementType === 'function' ? FUNCTION_COLOR_CLASS : 'text-muted-foreground')
  )
}

/**
 * Get the icon component for a block type
 */
export function getIcon(elementType: string): typeof Box {
  return ICON_REGISTRY[elementType] ?? Box
}

/**
 * Get the icon name for data-icon attribute
 */
export function getIconName(elementType: string): string {
  return ICON_NAME_REGISTRY[elementType] ?? 'box'
}
