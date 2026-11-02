/**
 * Plugin Definitions Tests - REQ-3.4.4.1, REQ-3.4.4.2, REQ-3.4.1.17, REQ-3.4.1.3
 *
 * Tests for hardcoded definitions of the 40 built-in plugins in WAVE
 * (39 executors + the Remote Execution container filed in the Remote section).
 * Following the same architectural pattern as control-definitions.ts.
 */

import { describe, it, expect } from 'vitest'

describe('Plugin Definitions - REQ-3.4.4.1', () => {
  describe('PLUGIN_DEFINITIONS', () => {
    it('contains exactly 40 built-in plugins', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')
      expect(PLUGIN_DEFINITIONS).toHaveLength(40)
    })

    it('each plugin has id, name, category, iconName, and colorClass', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      for (const plugin of PLUGIN_DEFINITIONS) {
        expect(plugin.id).toBeTruthy()
        expect(plugin.name).toBeTruthy()
        expect(plugin.category).toBeTruthy()
        expect(plugin.iconName).toBeTruthy()
        expect(plugin.colorClass).toBeTruthy()
      }
    })

    it('all plugin ids are unique', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')
      const ids = PLUGIN_DEFINITIONS.map((p) => p.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  describe('Plugin Inventory', () => {
    it('includes the 3 network plugins, HTTP, Ping and Netcat, and not SFTP (SFTP-10)', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      const network = PLUGIN_DEFINITIONS.filter((p) => p.category === 'network')
      expect(network).toHaveLength(3)

      const ids = network.map((p) => p.id)
      expect(ids).toEqual(['http-client', 'ping', 'netcat'])
      expect(ids).not.toContain('sftp')
    })

    it('includes all 8 remote plugins (6 SSH, SFTP, Remote Execution)', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      const remote = PLUGIN_DEFINITIONS.filter((p) => p.category === 'remote')
      expect(remote).toHaveLength(8)

      const ids = remote.map((p) => p.id)
      expect(ids).toContain('ssh-session-open')
      expect(ids).toContain('ssh-session-exec')
      expect(ids).toContain('ssh-session-script')
      expect(ids).toContain('ssh-session-close')
      expect(ids).toContain('ssh-tunnel-open')
      expect(ids).toContain('ssh-tunnel-close')
      expect(ids).toContain('sftp')
      expect(ids).toContain('remote-execution')
    })

    it('holds exactly SQL and OpenSearch in the Database group', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      const database = PLUGIN_DEFINITIONS.filter((p) => p.category === 'database')
      expect(database.map((p) => p.id)).toEqual(['sql-client', 'opensearch'])
      expect(database.map((p) => p.name)).toEqual(['SQL', 'OpenSearch'])
    })

    it('defines no LDAP block', async () => {
      const { PLUGIN_DEFINITIONS, getPluginById } = await import(
        '@/features/workbench/lib/plugin-definitions'
      )

      expect(getPluginById('ldap-client')).toBeUndefined()
      expect(PLUGIN_DEFINITIONS.map((p) => p.id)).not.toContain('ldap-client')
      expect(PLUGIN_DEFINITIONS.map((p) => p.name)).not.toContain('LDAP')
    })

    it('includes all 5 system plugins', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      const system = PLUGIN_DEFINITIONS.filter((p) => p.category === 'system')
      expect(system).toHaveLength(5)

      const ids = system.map((p) => p.id)
      expect(ids).toContain('shell-script')
      expect(ids).toContain('shell-exec')
      expect(ids).toContain('python')
      expect(ids).toContain('file-io')
      expect(ids).toContain('log')
    })

    // SHRUN-19 pins the System palette order.
    it('orders the System section Shell Script, Shell Exec, Python, File I/O, Log', async () => {
      const { getPluginsByCategory } = await import('@/features/workbench/lib/plugin-definitions')
      const ids = getPluginsByCategory('system').map((p) => p.id)
      expect(ids).toEqual(['shell-script', 'shell-exec', 'python', 'file-io', 'log'])
    })

    it('includes all 12 kubernetes plugins', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      const kubernetes = PLUGIN_DEFINITIONS.filter((p) => (p.category as string) === 'kubernetes')
      expect(kubernetes).toHaveLength(12)

      const ids = kubernetes.map((p) => p.id)
      expect(ids).toContain('k8s-connect')
      expect(ids).toContain('k8s-get')
      expect(ids).toContain('k8s-events')
      expect(ids).toContain('k8s-logs')
      expect(ids).toContain('k8s-top')
      expect(ids).toContain('k8s-apply')
      expect(ids).toContain('k8s-delete')
      expect(ids).toContain('k8s-scale')
      expect(ids).toContain('k8s-rollout')
      expect(ids).toContain('k8s-exec')
      expect(ids).toContain('k8s-script')
      expect(ids).toContain('k8s-copy')
    })

    it('orders the Kubernetes section Connect first, then the read verbs, then the write verbs', async () => {
      const { getPluginsByCategory } = await import('@/features/workbench/lib/plugin-definitions')
      const ids = getPluginsByCategory('kubernetes').map((p) => p.id)
      expect(ids).toEqual([
        'k8s-connect',
        'k8s-get',
        'k8s-events',
        'k8s-logs',
        'k8s-top',
        'k8s-apply',
        'k8s-delete',
        'k8s-scale',
        'k8s-rollout',
        'k8s-exec',
        'k8s-script',
        'k8s-copy',
      ])
    })

    it('gives every Kubernetes plugin a distinct icon', async () => {
      const { getPluginsByCategory } = await import('@/features/workbench/lib/plugin-definitions')
      const icons = getPluginsByCategory('kubernetes').map((p) => p.iconName)
      expect(new Set(icons).size).toBe(icons.length)
    })

    it('no longer defines the retired k8s-api stub', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      expect(getPluginById('k8s-api')).toBeUndefined()
    })

    it('includes all 6 helm plugins', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      const helm = PLUGIN_DEFINITIONS.filter((p) => (p.category as string) === 'helm')
      expect(helm).toHaveLength(6)

      const ids = helm.map((p) => p.id)
      expect(ids).toEqual([
        'helm-install',
        'helm-upgrade',
        'helm-rollback',
        'helm-uninstall',
        'helm-test',
        'helm-status',
      ])
    })

    it('paints every helm plugin indigo and marks it remotable', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      const helm = PLUGIN_DEFINITIONS.filter((p) => (p.category as string) === 'helm')
      for (const plugin of helm) {
        expect(plugin.colorClass, plugin.id).toBe('text-indigo-500')
        expect(plugin.remotable, plugin.id).toBe(true)
      }
    })

    it('gives every helm plugin its own lucide icon', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      const helm = PLUGIN_DEFINITIONS.filter((p) => (p.category as string) === 'helm')
      expect(helm.map((p) => p.iconName)).toEqual([
        'PackagePlus',
        'CircleArrowUp',
        'Undo2',
        'PackageMinus',
        'FlaskConical',
        'Activity',
      ])
    })

    it('lists the Helm blocks straight after the Kubernetes ones', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      const ids = PLUGIN_DEFINITIONS.map((p) => p.id)
      expect(ids.indexOf('helm-install')).toBe(ids.indexOf('k8s-copy') + 1)
      expect(ids.indexOf('csv-parser')).toBe(ids.indexOf('helm-status') + 1)
    })

    it('includes all 4 data plugins', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      const data = PLUGIN_DEFINITIONS.filter((p) => p.category === 'data')
      expect(data).toHaveLength(4)

      const ids = data.map((p) => p.id)
      expect(ids).toContain('csv-parser')
      expect(ids).toContain('excel-parser')
      expect(ids).toContain('xml-parser')
      expect(ids).toContain('json-parser')
    })
  })

  describe('Plugin Display Names', () => {
    it('HTTP plugin has display name HTTP', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const http = getPluginById('http-client')
      expect(http?.name).toBe('HTTP')
    })

    it('SSH Session Script plugin has display name SSH Session Script', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const ssh = getPluginById('ssh-session-script')
      expect(ssh?.name).toBe('SSH Session Script')
    })

    // The display name changed; the plugin id did not.
    it('SSH Session Exec plugin has display name SSH Session Exec under its own id', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const exec = getPluginById('ssh-session-exec')
      expect(exec?.id).toBe('ssh-session-exec')
      expect(exec?.name).toBe('SSH Session Exec')
    })

    it.each([
      ['shell-script', 'Shell Script'],
      ['shell-exec', 'Shell Exec'],
    ])('%s plugin has display name %s', async (id, name) => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      expect(getPluginById(id)?.name).toBe(name)
    })

    it('SFTP plugin has display name SFTP', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const sftp = getPluginById('sftp')
      expect(sftp?.name).toBe('SFTP')
    })

    it('K8s Connect plugin has display name K8s Connect', async () => {
      // Byte-identical to the backend metadata name.
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const k8s = getPluginById('k8s-connect')
      expect(k8s?.name).toBe('K8s Connect')
    })

    // Byte-identical to the backend metadata name, one exact string per block.
    it.each([
      ['k8s-get', 'K8s Get'],
      ['k8s-events', 'K8s Events'],
      ['k8s-logs', 'K8s Logs'],
      ['k8s-top', 'K8s Top'],
      ['k8s-apply', 'K8s Apply'],
      ['k8s-delete', 'K8s Delete'],
      ['k8s-scale', 'K8s Scale'],
      ['k8s-rollout', 'K8s Rollout'],
      ['k8s-exec', 'K8s Exec'],
      ['k8s-script', 'K8s Script'],
      ['k8s-copy', 'K8s Copy'],
    ])('%s plugin has display name %s', async (id, name) => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      expect(getPluginById(id)?.name).toBe(name)
    })

    it('lists the Kubernetes display names in section order', async () => {
      const { getPluginsByCategory } = await import('@/features/workbench/lib/plugin-definitions')
      const names = getPluginsByCategory('kubernetes').map((p) => p.name)
      expect(names).toEqual([
        'K8s Connect',
        'K8s Get',
        'K8s Events',
        'K8s Logs',
        'K8s Top',
        'K8s Apply',
        'K8s Delete',
        'K8s Scale',
        'K8s Rollout',
        'K8s Exec',
        'K8s Script',
        'K8s Copy',
      ])
    })
  })

  describe('Category Colors', () => {
    it('network plugins have blue color', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      const network = PLUGIN_DEFINITIONS.filter((p) => p.category === 'network')
      for (const plugin of network) {
        expect(plugin.colorClass).toContain('blue')
      }
    })

    it('remote plugins have cyan color', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      const remote = PLUGIN_DEFINITIONS.filter((p) => p.category === 'remote')
      for (const plugin of remote) {
        expect(plugin.colorClass).toContain('cyan')
      }
    })

    it('database plugins have purple color', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      const database = PLUGIN_DEFINITIONS.filter((p) => p.category === 'database')
      for (const plugin of database) {
        expect(plugin.colorClass).toContain('purple')
      }
    })

    it('system plugins have red color', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      const system = PLUGIN_DEFINITIONS.filter((p) => p.category === 'system')
      for (const plugin of system) {
        expect(plugin.colorClass).toContain('red')
      }
    })

    it('kubernetes plugins have sky color', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      const kubernetes = PLUGIN_DEFINITIONS.filter((p) => (p.category as string) === 'kubernetes')
      expect(kubernetes.length).toBeGreaterThan(0)
      for (const plugin of kubernetes) {
        expect(plugin.colorClass).toContain('sky')
      }
    })

    // The verb blocks take the exact sky class the K8s Connect row carries.
    it.each([
      'k8s-connect',
      'k8s-get',
      'k8s-events',
      'k8s-logs',
      'k8s-top',
      'k8s-apply',
      'k8s-delete',
      'k8s-scale',
      'k8s-rollout',
      'k8s-exec',
      'k8s-script',
      'k8s-copy',
    ])(
      '%s carries the exact sky color class and the kubernetes category',
      async (id) => {
        const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
        const plugin = getPluginById(id)
        expect(plugin?.category).toBe('kubernetes')
        expect(plugin?.colorClass).toBe('text-sky-500')
      }
    )

    it('data plugins have emerald color', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')

      const data = PLUGIN_DEFINITIONS.filter((p) => p.category === 'data')
      for (const plugin of data) {
        expect(plugin.colorClass).toContain('emerald')
      }
    })
  })

  describe('Icon Names - REQ-3.4.4.2', () => {
    it('all iconNames are valid in the icon registry', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')
      const { isValidIconName } = await import('@/features/workbench/lib/icon-registry')

      for (const plugin of PLUGIN_DEFINITIONS) {
        expect(
          isValidIconName(plugin.iconName),
          `Icon '${plugin.iconName}' for plugin '${plugin.id}' should be registered`
        ).toBe(true)
      }
    })

    it('HTTP plugin uses Globe icon', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      expect(getPluginById('http-client')?.iconName).toBe('Globe')
    })

    it('SSH Session Script plugin uses a registered icon', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const { isValidIconName } = await import('@/features/workbench/lib/icon-registry')
      const script = getPluginById('ssh-session-script')
      expect(script).toBeDefined()
      expect(isValidIconName(script!.iconName)).toBe(true)
    })

    it('SQL plugin uses Database icon', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      expect(getPluginById('sql-client')?.iconName).toBe('Database')
    })

    // SHRUN-19: the glyph follows the role - every Script block carries
    // FileTerminal and every Exec block carries Terminal.
    it.each([
      ['shell-script', 'FileTerminal'],
      ['k8s-script', 'FileTerminal'],
      ['shell-exec', 'Terminal'],
      ['ssh-session-exec', 'Terminal'],
    ])('%s draws the %s glyph for its role', async (id, icon) => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      expect(getPluginById(id)?.iconName).toBe(icon)
    })

    it('K8s Connect plugin uses Cable icon', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      expect(getPluginById('k8s-connect')?.iconName).toBe('Cable')
    })

    // The eleven verb glyphs.
    it.each([
      ['k8s-get', 'PackageSearch'],
      ['k8s-events', 'History'],
      ['k8s-logs', 'Logs'],
      ['k8s-top', 'Gauge'],
      ['k8s-apply', 'CloudUpload'],
      ['k8s-delete', 'Trash2'],
      ['k8s-scale', 'Scaling'],
      ['k8s-rollout', 'RefreshCw'],
      ['k8s-exec', 'Terminal'],
      ['k8s-script', 'FileTerminal'],
      ['k8s-copy', 'ArrowRightLeft'],
    ])('%s plugin uses the %s icon', async (id, icon) => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      expect(getPluginById(id)?.iconName).toBe(icon)
    })

    it('JSON plugin uses FileJson icon', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      expect(getPluginById('json-parser')?.iconName).toBe('FileJson')
    })

  })

  describe('Remote-section Set A icons and order - REMICON-1, REMEX-2', () => {
    const SET_A_ICONS: Record<string, string> = {
      'ssh-session-open': 'LogIn',
      'ssh-session-exec': 'Terminal',
      'ssh-session-script': 'FileTerminal',
      'ssh-session-close': 'LogOut',
      'ssh-tunnel-open': 'Cable',
      'ssh-tunnel-close': 'Unplug',
      'remote-execution': 'ServerCog',
    }

    it('maps each Remote-section plugin to its Set A glyph', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      for (const [id, icon] of Object.entries(SET_A_ICONS)) {
        expect(getPluginById(id)?.iconName, `${id} should use ${icon}`).toBe(icon)
      }
    })

    it('gives every Remote-section plugin a distinct icon', async () => {
      const { getPluginsByCategory } = await import('@/features/workbench/lib/plugin-definitions')
      const icons = getPluginsByCategory('remote').map((p) => p.iconName)
      expect(new Set(icons).size).toBe(icons.length)
    })

    // SHRUN-19 gives the Exec role the Terminal glyph, so SSH Session Exec is
    // the one Remote-section block that carries it.
    it('carries Terminal on SSH Session Exec alone in the Remote section', async () => {
      const { getPluginsByCategory } = await import('@/features/workbench/lib/plugin-definitions')
      const terminalIds = getPluginsByCategory('remote')
        .filter((p) => p.iconName === 'Terminal')
        .map((p) => p.id)
      expect(terminalIds).toEqual(['ssh-session-exec'])
    })

    it('orders the Remote section, SFTP after SSH Tunnel Close and Remote Execution last (REMEX-2)', async () => {
      const { getPluginsByCategory } = await import('@/features/workbench/lib/plugin-definitions')
      const ids = getPluginsByCategory('remote').map((p) => p.id)
      expect(ids).toEqual([
        'ssh-session-open',
        'ssh-session-exec',
        'ssh-session-script',
        'ssh-session-close',
        'ssh-tunnel-open',
        'ssh-tunnel-close',
        'sftp',
        'remote-execution',
      ])
    })

    it('files SFTP in the remote category with its own FolderSync glyph and the cyan color (SFTP-10)', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      expect(getPluginById('sftp')).toEqual({
        id: 'sftp',
        name: 'SFTP',
        category: 'remote',
        iconName: 'FolderSync',
        colorClass: 'text-cyan-500',
        remotable: false,
      })
    })

    it('keeps the FolderSync glyph on SFTP alone in the Remote section', async () => {
      const { getPluginsByCategory } = await import('@/features/workbench/lib/plugin-definitions')
      const folderSyncIds = getPluginsByCategory('remote')
        .filter((p) => p.iconName === 'FolderSync')
        .map((p) => p.id)
      expect(folderSyncIds).toEqual(['sftp'])
    })

    it('files Remote Execution in the remote category with the cyan color', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const rex = getPluginById('remote-execution')
      expect(rex?.category).toBe('remote')
      expect(rex?.iconName).toBe('ServerCog')
      expect(rex?.name).toBe('Remote Execution')
      expect(rex?.colorClass).toContain('cyan')
    })
  })

  describe('Remotable flag - REQ-3.4.1.3', () => {
    it('marks HTTP remotable (runs on the host inside a Remote Execution body)', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      expect(getPluginById('http-client')?.remotable).toBe(true)
    })

    it('marks Ping remotable (it runs on the remote host inside a Remote Execution body) - PING-1', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const ping = getPluginById('ping')
      expect(ping?.remotable).toBe(true)
      expect(ping?.name).toBe('Ping')
      expect(ping?.category).toBe('network')
      expect(ping?.iconName).toBe('Radio')
    })

    it('marks Netcat remotable (it runs on the remote host inside a Remote Execution body) - NETCAT-1', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const netcat = getPluginById('netcat')
      expect(netcat?.remotable).toBe(true)
      expect(netcat?.name).toBe('Netcat')
      expect(netcat?.category).toBe('network')
      expect(netcat?.iconName).toBe('Cable')
    })

    it('marks SQL remotable (it runs on the remote host inside a Remote Execution body) - SQL-15', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const sql = getPluginById('sql-client')
      expect(sql?.remotable).toBe(true)
      expect(sql?.name).toBe('SQL')
      expect(sql?.category).toBe('database')
      expect(sql?.iconName).toBe('Database')
    })

    it('marks OpenSearch remotable (it runs on the remote host inside a Remote Execution body) - REQ-3.4.1.15', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const openSearch = getPluginById('opensearch')
      expect(openSearch?.remotable).toBe(true)
      expect(openSearch?.name).toBe('OpenSearch')
      expect(openSearch?.category).toBe('database')
      expect(openSearch?.iconName).toBe('SearchCode')
    })

    it('leaves no database plugin on WAVE', async () => {
      const { getPluginsByCategory } = await import('@/features/workbench/lib/plugin-definitions')
      const onWave = getPluginsByCategory('database').filter((p) => !p.remotable)
      expect(onWave.map((p) => p.id)).toEqual([])
    })

    it('marks File I/O remotable (the pure-Python bundle reads host paths) - FIO-10', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const fileIo = getPluginById('file-io')
      expect(fileIo?.remotable).toBe(true)
      expect(fileIo?.name).toBe('File I/O')
      expect(fileIo?.category).toBe('system')
      expect(fileIo?.iconName).toBe('FileInput')
    })

    it('marks Python remotable (the vendored local-process runtime runs on the host) - PYRUN-1', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      const python = getPluginById('python')
      expect(python?.remotable).toBe(true)
      expect(python?.name).toBe('Python')
      expect(python?.category).toBe('system')
      expect(python?.iconName).toBe('FileCode2')
    })

    it('leaves the other system plugins on WAVE', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
      expect(getPluginById('shell-script')?.remotable).toBe(false)
      expect(getPluginById('shell-exec')?.remotable).toBe(false)
      expect(getPluginById('log')?.remotable).toBe(false)
    })

    it.each([
      'k8s-connect',
      'k8s-get',
      'k8s-events',
      'k8s-logs',
      'k8s-top',
      'k8s-apply',
      'k8s-delete',
      'k8s-scale',
      'k8s-rollout',
      'k8s-exec',
      'k8s-script',
      'k8s-copy',
    ])(
      'marks %s remotable (it runs on the host inside a Remote Execution body)',
      async (id) => {
        const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')
        expect(getPluginById(id)?.remotable).toBe(true)
      }
    )

    it('leaves the other plugins non-remotable (they run on WAVE)', async () => {
      const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')
      const remotable = PLUGIN_DEFINITIONS.filter((p) => p.remotable).map((p) => p.id)
      expect(remotable).toEqual([
        'http-client',
        'ping',
        'netcat',
        'sql-client',
        'opensearch',
        'python',
        'file-io',
        'k8s-connect',
        'k8s-get',
        'k8s-events',
        'k8s-logs',
        'k8s-top',
        'k8s-apply',
        'k8s-delete',
        'k8s-scale',
        'k8s-rollout',
        'k8s-exec',
        'k8s-script',
        'k8s-copy',
        'helm-install',
        'helm-upgrade',
        'helm-rollback',
        'helm-uninstall',
        'helm-test',
        'helm-status',
      ])
    })
  })

  describe('Log Plugin Definition - REQ-3.4.1.17', () => {
    it('Log plugin exists with correct properties', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')

      const log = getPluginById('log')
      expect(log).toBeDefined()
      expect(log?.id).toBe('log')
      expect(log?.name).toBe('Log')
      expect(log?.category).toBe('system')
      expect(log?.iconName).toBe('ScrollText')
      expect(log?.colorClass).toContain('red')
    })
  })

  describe('getPluginById', () => {
    it('returns plugin for valid id', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')

      const shellScript = getPluginById('shell-script')
      expect(shellScript).toBeDefined()
      expect(shellScript?.name).toBe('Shell Script')
      expect(shellScript?.category).toBe('system')
    })

    it('returns undefined for invalid id', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')

      expect(getPluginById('not-a-plugin')).toBeUndefined()
    })

    it('returns undefined for empty string', async () => {
      const { getPluginById } = await import('@/features/workbench/lib/plugin-definitions')

      expect(getPluginById('')).toBeUndefined()
    })
  })

  describe('getPluginsByCategory', () => {
    it('returns plugins for valid category', async () => {
      const { getPluginsByCategory } = await import('@/features/workbench/lib/plugin-definitions')

      const network = getPluginsByCategory('network')
      expect(network).toHaveLength(3)
      expect(network.every((p) => p.category === 'network')).toBe(true)
    })

    it('returns empty array for invalid category', async () => {
      const { getPluginsByCategory } = await import('@/features/workbench/lib/plugin-definitions')

      const result = getPluginsByCategory('invalid' as never)
      expect(result).toEqual([])
    })

  })

  describe('PLUGIN_CATEGORIES', () => {
    it('contains 7 categories with names and colors', async () => {
      const { PLUGIN_CATEGORIES } = await import('@/features/workbench/lib/plugin-definitions')

      expect(PLUGIN_CATEGORIES).toHaveLength(7)

      const ids = PLUGIN_CATEGORIES.map((c) => c.id)
      expect(ids).toEqual([
        'network',
        'remote',
        'database',
        'system',
        'kubernetes',
        'helm',
        'data',
      ])

      for (const category of PLUGIN_CATEGORIES) {
        expect(category.name).toBeTruthy()
        expect(category.colorClass).toBeTruthy()
      }
    })

  })

  describe('Category display names', () => {
    it('network category has display name Network', async () => {
      const { PLUGIN_CATEGORIES } = await import('@/features/workbench/lib/plugin-definitions')
      const network = PLUGIN_CATEGORIES.find((c) => c.id === 'network')
      expect(network?.name).toBe('Network')
    })

    it('remote category has display name Remote', async () => {
      const { PLUGIN_CATEGORIES } = await import('@/features/workbench/lib/plugin-definitions')
      const remote = PLUGIN_CATEGORIES.find((c) => c.id === 'remote')
      expect(remote?.name).toBe('Remote')
    })

    it('database category has display name Database', async () => {
      const { PLUGIN_CATEGORIES } = await import('@/features/workbench/lib/plugin-definitions')
      const database = PLUGIN_CATEGORIES.find((c) => c.id === 'database')
      expect(database?.name).toBe('Database')
    })

    it('system category has display name System', async () => {
      const { PLUGIN_CATEGORIES } = await import('@/features/workbench/lib/plugin-definitions')
      const system = PLUGIN_CATEGORIES.find((c) => c.id === 'system')
      expect(system?.name).toBe('System')
    })

    it('kubernetes category has display name Kubernetes', async () => {
      const { PLUGIN_CATEGORIES } = await import('@/features/workbench/lib/plugin-definitions')
      const kubernetes = PLUGIN_CATEGORIES.find((c) => (c.id as string) === 'kubernetes')
      expect(kubernetes?.name).toBe('Kubernetes')
    })

    it('helm category has display name Helm', async () => {
      const { PLUGIN_CATEGORIES } = await import('@/features/workbench/lib/plugin-definitions')
      const helm = PLUGIN_CATEGORIES.find((c) => (c.id as string) === 'helm')
      expect(helm?.name).toBe('Helm')
      expect(helm?.colorClass).toBe('text-indigo-500')
    })

    it('data category has display name Data', async () => {
      const { PLUGIN_CATEGORIES } = await import('@/features/workbench/lib/plugin-definitions')
      const data = PLUGIN_CATEGORIES.find((c) => c.id === 'data')
      expect(data?.name).toBe('Data')
    })

    it('no longer declares an empty custom category', async () => {
      // The backend keeps `custom` as a valid plugin-authoring value; the
      // frontend category list only carries categories that have plugins.
      const { PLUGIN_CATEGORIES } = await import('@/features/workbench/lib/plugin-definitions')
      expect(PLUGIN_CATEGORIES.find((c) => (c.id as string) === 'custom')).toBeUndefined()
    })

    it('declares every category with at least one plugin', async () => {
      const { PLUGIN_CATEGORIES, getPluginsByCategory } = await import(
        '@/features/workbench/lib/plugin-definitions'
      )
      for (const category of PLUGIN_CATEGORIES) {
        expect(getPluginsByCategory(category.id).length).toBeGreaterThan(0)
      }
    })
  })
})

describe('Plugin Type Exports', () => {
  it('exports PluginCategory type', async () => {
    const module = await import('@/features/workbench/lib/plugin-definitions')
    // Type check: this should compile if the type is exported
    const category: (typeof module)['PLUGIN_CATEGORIES'][number]['id'] = 'network'
    expect(category).toBe('network')
  })

  it('exports PluginDefinition interface', async () => {
    const { PLUGIN_DEFINITIONS } = await import('@/features/workbench/lib/plugin-definitions')
    // Type check: accessing properties should work
    const first = PLUGIN_DEFINITIONS[0]
    expect(typeof first.id).toBe('string')
    expect(typeof first.name).toBe('string')
    expect(typeof first.category).toBe('string')
    expect(typeof first.iconName).toBe('string')
    expect(typeof first.colorClass).toBe('string')
  })

  it('exports CategoryDefinition interface', async () => {
    const { PLUGIN_CATEGORIES } = await import('@/features/workbench/lib/plugin-definitions')
    // Type check: accessing properties should work
    const first = PLUGIN_CATEGORIES[0]
    expect(typeof first.id).toBe('string')
    expect(typeof first.name).toBe('string')
    expect(typeof first.colorClass).toBe('string')
  })
})
