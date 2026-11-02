/**
 * Icon Registry Tests - REQ-5.2.1.46, REQ-3.4.4.2, REQ-3.4.1.17, REQ-3.4.1.3
 *
 * Tests for the centralized icon registry that maps iconName strings to
 * Lucide React components. Covers control icons (14), plugin icons (33), and
 * Function-row icons (2).
 *
 * REMICON-1: the six SSH plugins and Remote Execution each get a distinct cyan
 * lucide glyph (Set A): Session Open=LogIn, Exec=Terminal, Script=FileTerminal,
 * Close=LogOut, Tunnel Open=Cable, Tunnel Close=Unplug, Remote
 * Execution=ServerCog. No Remote-section block shares a glyph.
 *
 * SHRUN-19: a glyph follows the role, not the family - every Script block draws
 * FileTerminal and every Exec block draws Terminal, in the palette registry and
 * in all three canvas-node maps.
 *
 * The eleven K8s verb blocks carry sky glyphs - k8s-get=PackageSearch,
 * k8s-events=History, k8s-logs=Logs, k8s-top=Gauge, k8s-apply=CloudUpload,
 * k8s-delete=Trash2, k8s-scale=Scaling, k8s-rollout=RefreshCw,
 * k8s-exec=Terminal, k8s-script=FileTerminal, k8s-copy=ArrowRightLeft - in the
 * palette registry and in all three canvas-node maps. ScrollText stays Log's,
 * Radio stays Ping's, and RefreshCw is shared with the While control.
 *
 * One block color source (REQ-3.4.4.1, SFTP-10): the canvas color of a block is
 * its plugin or control definition's color, or the function block color.
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import {
  ArrowRightLeft,
  Activity,
  CircleArrowUp,
  CloudUpload,
  FileTerminal,
  FlaskConical,
  Gauge,
  History,
  Logs,
  PackageMinus,
  PackagePlus,
  PackageSearch,
  Radio,
  RefreshCw,
  Scaling,
  ScrollText,
  Terminal,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react'

const CONTROL_ICON_NAMES = [
  'GitFork', // If/Else
  'ListTree', // Switch/Case
  'CheckCircle', // Assert
  'Repeat', // For
  'IterationCw', // ForEach
  'RefreshCw', // While
  'LogOut', // Break (also SSH Session Close under Set A)
  'SkipForward', // Continue
  'Split', // Parallel
  'ShieldCheck', // Try/Catch
  'OctagonX', // Halt
  'Timer', // Delay
  'Hourglass', // Wait Until
  'StickyNote', // Note
]

// Plugin-section registry entries (Remote glyphs are Set A, REMICON-1).
const PLUGIN_ICON_NAMES = [
  // Network (3)
  'Globe', // HTTP
  'Radio', // Ping
  'Cable', // Netcat (also SSH Tunnel Open under Set A, and K8s Connect)
  // Remote Set A - own glyphs (4); LogOut, Cable and Terminal are reused from elsewhere
  'LogIn', // SSH Session Open
  'FileTerminal', // SSH Session Script (also Shell Script and K8s Script)
  'Unplug', // SSH Tunnel Close
  'FolderSync', // SFTP
  'ServerCog', // Remote Execution
  // Database (2)
  'Database', // SQL
  'SearchCode', // OpenSearch
  // System (5): Shell Script reuses FileTerminal and Shell Exec reuses Terminal;
  // the other three own their names
  'FileCode2', // Python
  'FileInput', // File I/O
  'ScrollText', // Log - REQ-3.4.1.17
  // Kubernetes (12): K8s Connect reuses Cable, K8s Rollout reuses the While
  // control's RefreshCw and K8s Script reuses FileTerminal; the other nine own
  // their names
  'PackageSearch', // K8s Get
  'History', // K8s Events
  'Logs', // K8s Logs
  'Gauge', // K8s Top
  'CloudUpload', // K8s Apply
  'Trash2', // K8s Delete
  'Scaling', // K8s Scale
  'Terminal', // K8s Exec (also Shell Exec and SSH Session Exec)
  'ArrowRightLeft', // K8s Copy
  // Helm (6): each block owns its glyph
  'PackagePlus', // Helm Install
  'CircleArrowUp', // Helm Upgrade
  'Undo2', // Helm Rollback
  'PackageMinus', // Helm Uninstall
  'FlaskConical', // Helm Test
  'Activity', // Helm Status
  // Data (5)
  'FileSpreadsheet', // CSV
  'Sheet', // Excel
  'FileType', // XML
  'FileJson', // JSON
  'Variable', // Variable
]

// The 7 Remote-section glyphs (Set A) - drawn from control + plugin sections.
const REMOTE_SECTION_ICON_NAMES = [
  'LogIn', // SSH Session Open
  'Terminal', // SSH Session Exec
  'FileTerminal', // SSH Session Script
  'LogOut', // SSH Session Close
  'Cable', // SSH Tunnel Open
  'Unplug', // SSH Tunnel Close
  'ServerCog', // Remote Execution
]

interface K8sGlyphRow {
  id: string
  display: string
  iconName: string
  iconKebab: string
  glyph: LucideIcon
}

// One row per K8s verb block, pinning both registries and the canvas kebab name.
const K8S_VERB_GLYPHS: K8sGlyphRow[] = [
  {
    id: 'k8s-get',
    display: 'K8s Get',
    iconName: 'PackageSearch',
    iconKebab: 'package-search',
    glyph: PackageSearch,
  },
  {
    id: 'k8s-events',
    display: 'K8s Events',
    iconName: 'History',
    iconKebab: 'history',
    glyph: History,
  },
  {
    id: 'k8s-logs',
    display: 'K8s Logs',
    iconName: 'Logs',
    iconKebab: 'logs',
    glyph: Logs,
  },
  {
    id: 'k8s-top',
    display: 'K8s Top',
    iconName: 'Gauge',
    iconKebab: 'gauge',
    glyph: Gauge,
  },
  {
    id: 'k8s-apply',
    display: 'K8s Apply',
    iconName: 'CloudUpload',
    iconKebab: 'cloud-upload',
    glyph: CloudUpload,
  },
  {
    id: 'k8s-delete',
    display: 'K8s Delete',
    iconName: 'Trash2',
    iconKebab: 'trash-2',
    glyph: Trash2,
  },
  {
    id: 'k8s-scale',
    display: 'K8s Scale',
    iconName: 'Scaling',
    iconKebab: 'scaling',
    glyph: Scaling,
  },
  {
    id: 'k8s-rollout',
    display: 'K8s Rollout',
    iconName: 'RefreshCw',
    iconKebab: 'refresh-cw',
    glyph: RefreshCw,
  },
  {
    id: 'k8s-exec',
    display: 'K8s Exec',
    iconName: 'Terminal',
    iconKebab: 'terminal',
    glyph: Terminal,
  },
  {
    id: 'k8s-script',
    display: 'K8s Script',
    iconName: 'FileTerminal',
    iconKebab: 'file-terminal',
    glyph: FileTerminal,
  },
  {
    id: 'k8s-copy',
    display: 'K8s Copy',
    iconName: 'ArrowRightLeft',
    iconKebab: 'arrow-right-left',
    glyph: ArrowRightLeft,
  },
]

const KUBERNETES_PLUGIN_IDS = ['k8s-connect', ...K8S_VERB_GLYPHS.map((row) => row.id)]


const HELM_GLYPHS: K8sGlyphRow[] = [
  {
    id: 'helm-install',
    display: 'Helm Install',
    iconName: 'PackagePlus',
    iconKebab: 'package-plus',
    glyph: PackagePlus,
  },
  {
    id: 'helm-upgrade',
    display: 'Helm Upgrade',
    iconName: 'CircleArrowUp',
    iconKebab: 'circle-arrow-up',
    glyph: CircleArrowUp,
  },
  {
    id: 'helm-rollback',
    display: 'Helm Rollback',
    iconName: 'Undo2',
    iconKebab: 'undo-2',
    glyph: Undo2,
  },
  {
    id: 'helm-uninstall',
    display: 'Helm Uninstall',
    iconName: 'PackageMinus',
    iconKebab: 'package-minus',
    glyph: PackageMinus,
  },
  {
    id: 'helm-test',
    display: 'Helm Test',
    iconName: 'FlaskConical',
    iconKebab: 'flask-conical',
    glyph: FlaskConical,
  },
  {
    id: 'helm-status',
    display: 'Helm Status',
    iconName: 'Activity',
    iconKebab: 'activity',
    glyph: Activity,
  },
]

describe('Icon Registry - REQ-5.2.1.46', () => {
  describe('getIconComponent', () => {
    it('resolves all 14 control icon names to renderable components', async () => {
      const { getIconComponent } = await import('@/features/workbench/lib/icon-registry')

      for (const iconName of CONTROL_ICON_NAMES) {
        const Icon = getIconComponent(iconName)
        expect(Icon).toBeDefined()
        const { container } = render(createElement(Icon))
        expect(container.querySelector('svg')).toBeInTheDocument()
      }
    })

    it('resolves all 33 plugin icon names to renderable components - REQ-3.4.4.2, REQ-3.4.1.17', async () => {
      const { getIconComponent } = await import('@/features/workbench/lib/icon-registry')

      for (const iconName of PLUGIN_ICON_NAMES) {
        const Icon = getIconComponent(iconName)
        expect(Icon, `Icon '${iconName}' should be defined`).toBeDefined()
        const { container } = render(createElement(Icon))
        expect(
          container.querySelector('svg'),
          `Icon '${iconName}' should render an SVG`
        ).toBeInTheDocument()
      }
    })

    it('returns a fallback icon for unknown names', async () => {
      const { getIconComponent } = await import('@/features/workbench/lib/icon-registry')

      const Icon = getIconComponent('NonExistentIconName')
      expect(Icon).toBeDefined()
      const { container } = render(createElement(Icon))
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('returns fallback for empty string', async () => {
      const { getIconComponent } = await import('@/features/workbench/lib/icon-registry')

      const Icon = getIconComponent('')
      expect(Icon).toBeDefined()
      const { container } = render(createElement(Icon))
      expect(container.querySelector('svg')).toBeInTheDocument()
    })
  })

  describe('isValidIconName', () => {
    it('returns true for registered control icon names', async () => {
      const { isValidIconName } = await import('@/features/workbench/lib/icon-registry')

      expect(isValidIconName('GitFork')).toBe(true)
      expect(isValidIconName('Timer')).toBe(true)
      expect(isValidIconName('LogOut')).toBe(true)
      expect(isValidIconName('SkipForward')).toBe(true)
    })

    it('returns true for registered plugin icon names - REQ-3.4.4.2, REQ-3.4.1.17', async () => {
      const { isValidIconName } = await import('@/features/workbench/lib/icon-registry')

      for (const iconName of PLUGIN_ICON_NAMES) {
        expect(isValidIconName(iconName), `'${iconName}' should be registered`).toBe(true)
      }
    })

    it('returns false for unregistered names', async () => {
      const { isValidIconName } = await import('@/features/workbench/lib/icon-registry')

      expect(isValidIconName('NotAnIcon')).toBe(false)
      expect(isValidIconName('')).toBe(false)
    })
  })

  describe('ICON_NAMES', () => {
    it('contains all 14 control icons', async () => {
      const { ICON_NAMES } = await import('@/features/workbench/lib/icon-registry')

      for (const icon of CONTROL_ICON_NAMES) {
        expect(ICON_NAMES).toContain(icon)
      }
    })

    it('contains all 33 plugin icons - REQ-3.4.4.2, REQ-3.4.1.17', async () => {
      const { ICON_NAMES } = await import('@/features/workbench/lib/icon-registry')

      for (const icon of PLUGIN_ICON_NAMES) {
        expect(ICON_NAMES, `ICON_NAMES should contain '${icon}'`).toContain(icon)
      }
    })

    it('contains exactly 49 icons (14 control + 33 plugin + 2 function-row)', async () => {
      const { ICON_NAMES } = await import('@/features/workbench/lib/icon-registry')
      expect(ICON_NAMES).toHaveLength(49)
    })

    it('drops the Users glyph, which no block draws', async () => {
      const { isValidIconName, ICON_NAMES } = await import(
        '@/features/workbench/lib/icon-registry'
      )
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      expect(PLUGIN_DEFINITIONS.map((p) => p.iconName)).not.toContain('Users')
      expect(isValidIconName('Users')).toBe(false)
      expect(ICON_NAMES).not.toContain('Users')
    })

    it('removes the retired Container glyph with the k8s-api stub', async () => {
      const { isValidIconName, ICON_NAMES } = await import(
        '@/features/workbench/lib/icon-registry'
      )
      expect(isValidIconName('Container')).toBe(false)
      expect(ICON_NAMES).not.toContain('Container')
    })

    // SHRUN-19 leaves these three glyphs without a block.
    it.each(['SquareTerminal', 'SquareCode', 'SquareChevronRight'])(
      'drops %s once the role rule leaves it without a user',
      async (name) => {
        const { isValidIconName, ICON_NAMES } = await import(
          '@/features/workbench/lib/icon-registry'
        )
        expect(isValidIconName(name), `'${name}' should be unregistered`).toBe(false)
        expect(ICON_NAMES, `ICON_NAMES should not contain '${name}'`).not.toContain(name)
      }
    )
  })

  describe('Remote-section icons (Set A) - REMICON-1', () => {
    it('resolves each of the 7 distinct Remote-section glyphs to a renderable component', async () => {
      const { getIconComponent, isValidIconName } = await import(
        '@/features/workbench/lib/icon-registry'
      )

      for (const iconName of REMOTE_SECTION_ICON_NAMES) {
        expect(isValidIconName(iconName), `'${iconName}' should be registered`).toBe(true)
        const { container } = render(createElement(getIconComponent(iconName)))
        expect(
          container.querySelector('svg'),
          `Remote icon '${iconName}' should render an SVG`
        ).toBeInTheDocument()
      }
    })

    it('resolves the 7 Remote-section glyphs to 7 different components', async () => {
      const { getIconComponent } = await import('@/features/workbench/lib/icon-registry')
      const components = REMOTE_SECTION_ICON_NAMES.map((n) => getIconComponent(n))
      expect(new Set(components).size).toBe(7)
    })

    it('maps Remote Execution to the ServerCog glyph', async () => {
      const { isValidIconName } = await import('@/features/workbench/lib/icon-registry')
      expect(isValidIconName('ServerCog')).toBe(true)
    })

    // SHRUN-19 gives the Exec role the Terminal glyph, so SSH Session Exec is
    // the one Remote-section block that draws it.
    it('draws the Terminal glyph on SSH Session Exec alone', async () => {
      const { getPluginsByCategory } = await import('@/features/workbench/lib/plugin-definitions')
      const { getIcon } = await import(
        '@/features/workbench/common/canvas/workflow-node/icon-registry'
      )

      for (const plugin of getPluginsByCategory('remote')) {
        const isExec = plugin.id === 'ssh-session-exec'
        expect(plugin.iconName === 'Terminal', `${plugin.id} iconName`).toBe(isExec)
        expect(getIcon(plugin.id) === Terminal, `${plugin.id} canvas glyph`).toBe(isExec)
      }
    })
  })

  describe('Kubernetes verb-block glyphs', () => {
    it.each(K8S_VERB_GLYPHS)(
      'registers $iconName in the palette icon registry for $id',
      async ({ id, iconName, glyph }) => {
        const { ICON_NAMES, isValidIconName, getIconComponent } = await import(
          '@/features/workbench/lib/icon-registry'
        )
        const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')

        expect(isValidIconName(iconName), `'${iconName}' should be registered`).toBe(true)
        expect(ICON_NAMES, `ICON_NAMES should contain '${iconName}'`).toContain(iconName)
        expect(getIconComponent(iconName), `'${iconName}' should resolve to its glyph`).toBe(glyph)
        expect(getPluginById(id)?.iconName, `'${id}' should name '${iconName}'`).toBe(iconName)

        const { container } = render(createElement(getIconComponent(iconName)))
        expect(
          container.querySelector('svg'),
          `Icon '${iconName}' should render an SVG`
        ).toBeInTheDocument()
      }
    )

    it.each(K8S_VERB_GLYPHS)(
      'registers all three canvas-node maps for $id',
      async ({ id, iconKebab, glyph }) => {
        const { getIcon, getIconName, getColorClass } = await import(
          '@/features/workbench/common/canvas/workflow-node/icon-registry'
        )

        expect(getIcon(id), `'${id}' should map to its glyph`).toBe(glyph)
        expect(getIconName(id), `'${id}' should map to '${iconKebab}'`).toBe(iconKebab)
        expect(getColorClass(id), `'${id}' should be sky`).toBe('text-sky-500')
      }
    )

    it.each(K8S_VERB_GLYPHS)(
      'colors $id text-sky-500 in the kubernetes category',
      async ({ id }) => {
        const { getPluginById, PLUGIN_CATEGORIES } = await import(
          '@/features/workbench/lib/plugin-definitions'
        )
        const { getColorClass } = await import(
          '@/features/workbench/common/canvas/workflow-node/icon-registry'
        )

        const kubernetes = PLUGIN_CATEGORIES.find((c) => c.id === 'kubernetes')
        expect(kubernetes?.colorClass).toBe('text-sky-500')
        expect(getPluginById(id)?.category, `'${id}' category`).toBe('kubernetes')
        expect(getPluginById(id)?.colorClass, `'${id}' palette color`).toBe('text-sky-500')
        expect(getColorClass(id), `'${id}' canvas color`).toBe('text-sky-500')
      }
    )

    it.each(K8S_VERB_GLYPHS)(
      'keeps the palette and canvas registries in agreement for $id',
      async ({ id }) => {
        const { getIconComponent } = await import('@/features/workbench/lib/icon-registry')
        const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
        const { getIcon, getColorClass } = await import(
          '@/features/workbench/common/canvas/workflow-node/icon-registry'
        )

        const def = getPluginById(id)
        expect(def, `'${id}' should have a palette row`).toBeDefined()
        expect(getIconComponent(def!.iconName), `'${id}' glyph drift`).toBe(getIcon(id))
        expect(def!.colorClass, `'${id}' color drift`).toBe(getColorClass(id))
      }
    )

    it('gives the twelve kubernetes blocks twelve different glyphs', async () => {
      const { getIcon } = await import(
        '@/features/workbench/common/canvas/workflow-node/icon-registry'
      )
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')

      const glyphs = KUBERNETES_PLUGIN_IDS.map((id) => getIcon(id))
      expect(new Set(glyphs).size).toBe(12)

      const iconNames = KUBERNETES_PLUGIN_IDS.map((id) => getPluginById(id)?.iconName)
      expect(new Set(iconNames).size).toBe(12)
    })

    it('keeps ScrollText on the Log plugin and off k8s-logs', async () => {
      const { getIconComponent } = await import('@/features/workbench/lib/icon-registry')
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const { getIcon, getIconName } = await import(
        '@/features/workbench/common/canvas/workflow-node/icon-registry'
      )

      expect(getPluginById('log')?.iconName).toBe('ScrollText')
      expect(getIcon('log')).toBe(ScrollText)
      expect(getIconName('log')).toBe('scroll-text')

      expect(getPluginById('k8s-logs')?.iconName).toBe('Logs')
      expect(getIcon('k8s-logs')).not.toBe(ScrollText)
      expect(getIconName('k8s-logs')).not.toBe('scroll-text')
      expect(getIconComponent('Logs')).not.toBe(getIconComponent('ScrollText'))
    })

    it('keeps Radio on the Ping plugin and off k8s-events', async () => {
      const { getIconComponent } = await import('@/features/workbench/lib/icon-registry')
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const { getIcon, getIconName } = await import(
        '@/features/workbench/common/canvas/workflow-node/icon-registry'
      )

      expect(getPluginById('ping')?.iconName).toBe('Radio')
      expect(getIcon('ping')).toBe(Radio)
      expect(getIconName('ping')).toBe('radio')

      expect(getPluginById('k8s-events')?.iconName).toBe('History')
      expect(getIcon('k8s-events')).not.toBe(Radio)
      expect(getIconName('k8s-events')).not.toBe('radio')
      expect(getIconComponent('History')).not.toBe(getIconComponent('Radio'))
    })

    it('shares RefreshCw between the While control and k8s-rollout', async () => {
      const { getIcon, getIconName, getColorClass } = await import(
        '@/features/workbench/common/canvas/workflow-node/icon-registry'
      )
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')

      expect(getIcon('while')).toBe(RefreshCw)
      expect(getIcon('k8s-rollout')).toBe(RefreshCw)
      expect(getIconName('while')).toBe('refresh-cw')
      expect(getIconName('k8s-rollout')).toBe('refresh-cw')

      expect(getColorClass('while')).toBe('text-cyan-500')
      expect(getColorClass('k8s-rollout')).toBe('text-sky-500')
      expect(getPluginById('k8s-rollout')?.iconName).toBe('RefreshCw')
    })

    it.each(K8S_VERB_GLYPHS)('names $id $display in the palette (K8s verb)', async ({ id, display }) => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      expect(getPluginById(id)?.name).toBe(display)
    })
  })
})

// SHRUN-19: one glyph per role, across the System, Kubernetes and Remote families.
describe('Role glyphs - SHRUN-19', () => {
  const ROLE_GLYPHS: (K8sGlyphRow & { colorClass: string })[] = [
    {
      id: 'shell-script',
      display: 'Shell Script',
      iconName: 'FileTerminal',
      iconKebab: 'file-terminal',
      glyph: FileTerminal,
      colorClass: 'text-red-500',
    },
    {
      id: 'k8s-script',
      display: 'K8s Script',
      iconName: 'FileTerminal',
      iconKebab: 'file-terminal',
      glyph: FileTerminal,
      colorClass: 'text-sky-500',
    },
    {
      id: 'shell-exec',
      display: 'Shell Exec',
      iconName: 'Terminal',
      iconKebab: 'terminal',
      glyph: Terminal,
      colorClass: 'text-red-500',
    },
    {
      id: 'ssh-session-exec',
      display: 'SSH Session Exec',
      iconName: 'Terminal',
      iconKebab: 'terminal',
      glyph: Terminal,
      colorClass: 'text-cyan-500',
    },
  ]

  it.each(ROLE_GLYPHS)(
    'names $iconName in the palette registry for $id',
    async ({ id, display, iconName, glyph }) => {
      const { isValidIconName, getIconComponent } = await import(
        '@/features/workbench/lib/icon-registry'
      )
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')

      expect(isValidIconName(iconName), `'${iconName}' should be registered`).toBe(true)
      expect(getIconComponent(iconName), `'${iconName}' should resolve to its glyph`).toBe(glyph)
      expect(getPluginById(id)?.name, `'${id}' display name`).toBe(display)
      expect(getPluginById(id)?.iconName, `'${id}' should name '${iconName}'`).toBe(iconName)
    }
  )

  it.each(ROLE_GLYPHS)(
    'registers all three canvas-node maps for $id',
    async ({ id, iconKebab, glyph, colorClass }) => {
      const { getIcon, getIconName, getColorClass } = await import(
        '@/features/workbench/common/canvas/workflow-node/icon-registry'
      )

      expect(getIcon(id), `'${id}' should map to its glyph`).toBe(glyph)
      expect(getIconName(id), `'${id}' should map to '${iconKebab}'`).toBe(iconKebab)
      expect(getColorClass(id), `'${id}' color`).toBe(colorClass)
    }
  )
})

describe('Helm block glyphs (HELM-11)', () => {
  it.each(HELM_GLYPHS)(
    'registers $iconName in the palette icon registry for $id',
    async ({ id, iconName, glyph }) => {
      const { ICON_NAMES, isValidIconName, getIconComponent } = await import(
        '@/features/workbench/lib/icon-registry'
      )
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')

      expect(isValidIconName(iconName), `'${iconName}' should be registered`).toBe(true)
      expect(ICON_NAMES, `ICON_NAMES should contain '${iconName}'`).toContain(iconName)
      expect(getIconComponent(iconName), `'${iconName}' should resolve to its glyph`).toBe(glyph)
      expect(getPluginById(id)?.iconName, `'${id}' should name '${iconName}'`).toBe(iconName)

      const { container } = render(createElement(getIconComponent(iconName)))
      expect(container.querySelector('svg'), `Icon '${iconName}' should render an SVG`)
        .toBeInTheDocument()
    }
  )

  it.each(HELM_GLYPHS)(
    'registers all three canvas-node maps for $id',
    async ({ id, iconKebab, glyph }) => {
      const { getIcon, getIconName, getColorClass } = await import(
        '@/features/workbench/common/canvas/workflow-node/icon-registry'
      )

      expect(getIcon(id), `'${id}' should map to its glyph`).toBe(glyph)
      expect(getIconName(id), `'${id}' should map to '${iconKebab}'`).toBe(iconKebab)
      expect(getColorClass(id), `'${id}' should be indigo`).toBe('text-indigo-500')
    }
  )

  it.each(HELM_GLYPHS)('names $id $display in the palette', async ({ id, display }) => {
    const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
    expect(getPluginById(id)?.name).toBe(display)
  })

  it('gives every Helm block a glyph of its own', () => {
    const names = HELM_GLYPHS.map((row) => row.iconName)
    expect(new Set(names).size).toBe(names.length)
  })

  it('shares no glyph with the Kubernetes section', () => {
    const helm = new Set(HELM_GLYPHS.map((row) => row.iconName))
    const kubernetes = K8S_VERB_GLYPHS.map((row) => row.iconName)
    expect(kubernetes.filter((name) => helm.has(name))).toEqual([])
  })
})

describe('Block color source - REQ-3.4.4.1', () => {
  it('colors every plugin block with its plugin definition color', async () => {
    const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')
    const { getColorClass } = await import(
      '@/features/workbench/common/canvas/workflow-node/icon-registry'
    )

    expect(PLUGIN_DEFINITIONS.length).toBeGreaterThan(0)
    for (const plugin of PLUGIN_DEFINITIONS) {
      expect(getColorClass(plugin.id), `'${plugin.id}' color`).toBe(plugin.colorClass)
    }
  })

  it('colors every control block with its control definition color', async () => {
    const { CONTROL_DEFINITIONS } = await import('@/features/workbench/lib/control-definitions')
    const { getColorClass } = await import(
      '@/features/workbench/common/canvas/workflow-node/icon-registry'
    )

    expect(CONTROL_DEFINITIONS.length).toBeGreaterThan(0)
    for (const control of CONTROL_DEFINITIONS) {
      expect(getColorClass(control.id), `'${control.id}' color`).toBe(control.colorClass)
    }
  })

  it('colors SFTP cyan, the Remote section color (SFTP-10)', async () => {
    const { getColorClass } = await import(
      '@/features/workbench/common/canvas/workflow-node/icon-registry'
    )

    expect(getColorClass('sftp')).toBe('text-cyan-500')
  })

  it('colors the function block with the one function color', async () => {
    const { FUNCTION_COLOR_CLASS } = await import('@/features/workbench/lib/function-definition')
    const { getColorClass } = await import(
      '@/features/workbench/common/canvas/workflow-node/icon-registry'
    )

    expect(FUNCTION_COLOR_CLASS).toBe('text-emerald-500')
    expect(getColorClass('function')).toBe(FUNCTION_COLOR_CLASS)
  })

  it('colors the Note control slate, its misc category color', async () => {
    const { getControlById } = await import('@/features/workbench/lib/control-definitions')
    const { getColorClass } = await import(
      '@/features/workbench/common/canvas/workflow-node/icon-registry'
    )

    expect(getControlById('note')?.category).toBe('misc')
    expect(getColorClass('note')).toBe('text-slate-400')
  })

  it.each(['loop', 'http', 'sql'])(
    "gives the '%s' alias, which no definition carries, the muted fallback",
    async (alias) => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const { getControlById } = await import('@/features/workbench/lib/control-definitions')
      const { getColorClass } = await import(
        '@/features/workbench/common/canvas/workflow-node/icon-registry'
      )

      expect(getPluginById(alias)).toBeUndefined()
      expect(getControlById(alias)).toBeUndefined()
      expect(getColorClass(alias)).toBe('text-muted-foreground')
    }
  )

  it('gives an unknown block type the muted fallback', async () => {
    const { getColorClass } = await import(
      '@/features/workbench/common/canvas/workflow-node/icon-registry'
    )

    expect(getColorClass('not-a-block')).toBe('text-muted-foreground')
    expect(getColorClass('')).toBe('text-muted-foreground')
  })
})

describe('Canvas block maps without the LDAP block', () => {
  it('holds no ldap-client entry in the canvas glyph map', async () => {
    const { getIcon } = await import(
      '@/features/workbench/common/canvas/workflow-node/icon-registry'
    )

    expect(getIcon('ldap-client')).toBe(getIcon('not-a-block'))
  })

  it('holds no ldap-client entry in the canvas icon-name map', async () => {
    const { getIconName } = await import(
      '@/features/workbench/common/canvas/workflow-node/icon-registry'
    )

    expect(getIconName('ldap-client')).toBe(getIconName('not-a-block'))
  })

  it('gives ldap-client the muted fallback color of a block no definition carries', async () => {
    const { getColorClass } = await import(
      '@/features/workbench/common/canvas/workflow-node/icon-registry'
    )

    expect(getColorClass('ldap-client')).toBe('text-muted-foreground')
  })
})
