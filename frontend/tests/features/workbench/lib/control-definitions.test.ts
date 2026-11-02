/**
 * Control Definitions Tests - REQ-5.2.1.48
 *
 * Tests for hardcoded control definitions for the 15 flow controls in WAVE.
 */

import { describe, it, expect } from 'vitest'

describe('Control Definitions - REQ-5.2.1.48', () => {
  describe('CONTROL_DEFINITIONS', () => {
    it('contains exactly 15 controls', async () => {
      const { CONTROL_DEFINITIONS } = await import('@/features/workbench/lib/control-definitions')
      expect(CONTROL_DEFINITIONS).toHaveLength(15)
    })

    it('each control has id, name, category, iconName, and colorClass', async () => {
      const { CONTROL_DEFINITIONS } = await import('@/features/workbench/lib/control-definitions')

      for (const control of CONTROL_DEFINITIONS) {
        expect(control.id).toBeTruthy()
        expect(control.name).toBeTruthy()
        expect(control.category).toBeTruthy()
        expect(control.iconName).toBeTruthy()
        expect(control.colorClass).toBeTruthy()
      }
    })

    it('all control ids are unique', async () => {
      const { CONTROL_DEFINITIONS } = await import('@/features/workbench/lib/control-definitions')
      const ids = CONTROL_DEFINITIONS.map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  describe('Control Inventory', () => {
    it('includes all 3 conditional controls', async () => {
      const { CONTROL_DEFINITIONS } = await import('@/features/workbench/lib/control-definitions')

      const conditionals = CONTROL_DEFINITIONS.filter((c) => c.category === 'conditional')
      expect(conditionals).toHaveLength(3)

      const ids = conditionals.map((c) => c.id)
      expect(ids).toContain('if-else')
      expect(ids).toContain('switch-case')
      expect(ids).toContain('assert')
    })

    it('includes all 5 loop controls (including Break and Continue)', async () => {
      const { CONTROL_DEFINITIONS } = await import('@/features/workbench/lib/control-definitions')

      const loops = CONTROL_DEFINITIONS.filter((c) => c.category === 'loop')
      expect(loops).toHaveLength(5)

      const ids = loops.map((c) => c.id)
      expect(ids).toContain('for')
      expect(ids).toContain('for-each')
      expect(ids).toContain('while')
      expect(ids).toContain('break')
      expect(ids).toContain('continue')
    })

    it('includes all 4 flow controls', async () => {
      const { CONTROL_DEFINITIONS } = await import('@/features/workbench/lib/control-definitions')

      const flow = CONTROL_DEFINITIONS.filter((c) => c.category === 'flow')
      expect(flow).toHaveLength(4)

      const ids = flow.map((c) => c.id)
      expect(ids).toContain('parallel')
      expect(ids).toContain('try-catch-finally')
      expect(ids).toContain('halt')
      expect(ids).toContain('variable-setter')
    })

    it('includes all 2 timing controls', async () => {
      const { CONTROL_DEFINITIONS } = await import('@/features/workbench/lib/control-definitions')

      const timing = CONTROL_DEFINITIONS.filter((c) => c.category === 'timing')
      expect(timing).toHaveLength(2)

      const ids = timing.map((c) => c.id)
      expect(ids).toContain('delay')
      expect(ids).toContain('wait-until')
    })

    it('includes the misc Note control', async () => {
      const { CONTROL_DEFINITIONS } = await import('@/features/workbench/lib/control-definitions')

      const misc = CONTROL_DEFINITIONS.filter((c) => c.category === 'misc')
      expect(misc).toHaveLength(1)

      const ids = misc.map((c) => c.id)
      expect(ids).toContain('note')
    })
  })

  describe('Category Colors', () => {
    it('conditional controls have orange color', async () => {
      const { CONTROL_DEFINITIONS } = await import('@/features/workbench/lib/control-definitions')

      const conditionals = CONTROL_DEFINITIONS.filter((c) => c.category === 'conditional')
      for (const control of conditionals) {
        expect(control.colorClass).toContain('orange')
      }
    })

    it('loop controls have cyan color', async () => {
      const { CONTROL_DEFINITIONS } = await import('@/features/workbench/lib/control-definitions')

      const loops = CONTROL_DEFINITIONS.filter((c) => c.category === 'loop')
      for (const control of loops) {
        expect(control.colorClass).toContain('cyan')
      }
    })

    it('flow controls have green color', async () => {
      const { CONTROL_DEFINITIONS } = await import('@/features/workbench/lib/control-definitions')

      const flow = CONTROL_DEFINITIONS.filter((c) => c.category === 'flow')
      for (const control of flow) {
        expect(control.colorClass).toContain('green')
      }
    })

    it('timing controls have yellow color', async () => {
      const { CONTROL_DEFINITIONS } = await import('@/features/workbench/lib/control-definitions')

      const timing = CONTROL_DEFINITIONS.filter((c) => c.category === 'timing')
      for (const control of timing) {
        expect(control.colorClass).toContain('yellow')
      }
    })

    it('misc controls have slate color', async () => {
      const { CONTROL_DEFINITIONS } = await import('@/features/workbench/lib/control-definitions')

      const misc = CONTROL_DEFINITIONS.filter((c) => c.category === 'misc')
      for (const control of misc) {
        expect(control.colorClass).toContain('slate')
      }
    })
  })

  describe('Control Display Names', () => {
    it('Var Setter control has display name Var Setter', async () => {
      const { getControlById } = await import('@/features/workbench/lib/control-definitions')
      const varSetter = getControlById('variable-setter')
      expect(varSetter?.name).toBe('Var Setter')
    })
  })

  describe('Icon Names', () => {
    it('Var Setter control uses Variable icon', async () => {
      const { getControlById } = await import('@/features/workbench/lib/control-definitions')
      expect(getControlById('variable-setter')?.iconName).toBe('Variable')
    })

    it('all iconNames are valid in the icon registry', async () => {
      const { CONTROL_DEFINITIONS } = await import('@/features/workbench/lib/control-definitions')
      const { isValidIconName } = await import('@/features/workbench/lib/icon-registry')

      for (const control of CONTROL_DEFINITIONS) {
        expect(isValidIconName(control.iconName)).toBe(true)
      }
    })
  })

  describe('getControlById', () => {
    it('returns control for valid id', async () => {
      const { getControlById } = await import('@/features/workbench/lib/control-definitions')

      const delay = getControlById('delay')
      expect(delay).toBeDefined()
      expect(delay?.name).toBe('Delay')
    })

    it('returns undefined for invalid id', async () => {
      const { getControlById } = await import('@/features/workbench/lib/control-definitions')

      expect(getControlById('not-a-control')).toBeUndefined()
    })
  })

  describe('getControlsByCategory', () => {
    it('returns controls for valid category', async () => {
      const { getControlsByCategory } = await import('@/features/workbench/lib/control-definitions')

      const conditionals = getControlsByCategory('conditional')
      expect(conditionals).toHaveLength(3)
      expect(conditionals.every((c) => c.category === 'conditional')).toBe(true)
    })

    it('returns empty array for invalid category', async () => {
      const { getControlsByCategory } = await import('@/features/workbench/lib/control-definitions')

      const result = getControlsByCategory('invalid' as never)
      expect(result).toEqual([])
    })
  })

  describe('CONTROL_CATEGORIES', () => {
    it('contains 5 categories with names and colors', async () => {
      const { CONTROL_CATEGORIES } = await import('@/features/workbench/lib/control-definitions')

      expect(CONTROL_CATEGORIES).toHaveLength(5)

      const ids = CONTROL_CATEGORIES.map((c) => c.id)
      expect(ids).toContain('conditional')
      expect(ids).toContain('loop')
      expect(ids).toContain('flow')
      expect(ids).toContain('timing')
      expect(ids).toContain('misc')

      for (const category of CONTROL_CATEGORIES) {
        expect(category.name).toBeTruthy()
        expect(category.colorClass).toBeTruthy()
      }
    })
  })

  describe('getControlCategoryColor', () => {
    it.each([
      { category: 'conditional' as const, colorClass: 'text-orange-500' },
      { category: 'loop' as const, colorClass: 'text-cyan-500' },
      { category: 'flow' as const, colorClass: 'text-green-500' },
      { category: 'timing' as const, colorClass: 'text-yellow-500' },
      { category: 'misc' as const, colorClass: 'text-slate-400' },
    ])(
      'gives $category the color of its category entry and of each of its controls',
      async ({ category, colorClass }) => {
        const { getControlCategoryColor, CONTROL_CATEGORIES, getControlsByCategory } =
          await import('@/features/workbench/lib/control-definitions')

        const color = getControlCategoryColor(category)
        expect(color).toBe(colorClass)
        expect(CONTROL_CATEGORIES.find((c) => c.id === category)?.colorClass).toBe(color)

        const controls = getControlsByCategory(category)
        expect(controls.length).toBeGreaterThan(0)
        for (const control of controls) {
          expect(control.colorClass, `'${control.id}' color`).toBe(color)
        }
      }
    )
  })
})

describe('Control Metadata - REQ-5.2.1.48', () => {
  describe('getControlDetails', () => {
    it('returns details for valid control and version', async () => {
      const { getControlDetails } = await import('@/features/workbench/docs/_loader')

      const details = getControlDetails('delay', '1.0.0')
      expect(details).toBeDefined()
      expect(details).toContain('Delay control')
    })

    it('returns undefined for invalid control id', async () => {
      const { getControlDetails } = await import('@/features/workbench/docs/_loader')

      const details = getControlDetails('not-a-control', '1.0.0')
      expect(details).toBeUndefined()
    })

    it('returns undefined for invalid version', async () => {
      const { getControlDetails } = await import('@/features/workbench/docs/_loader')

      const details = getControlDetails('delay', '99.99.99')
      expect(details).toBeUndefined()
    })
  })

  describe('getControlVersionEntry', () => {
    it('returns version entry for valid control and version', async () => {
      const { getControlVersionEntry } = await import('@/features/workbench/docs/_loader')

      const entry = getControlVersionEntry('delay', '1.0.0')
      expect(entry).toBeDefined()
      expect(entry?.version).toBe('1.0.0')
      expect(entry?.changelog).toBeDefined()
      expect(entry?.releaseDate).toBeDefined()
    })

    it('returns undefined for invalid control id', async () => {
      const { getControlVersionEntry } = await import('@/features/workbench/docs/_loader')

      const entry = getControlVersionEntry('not-a-control', '1.0.0')
      expect(entry).toBeUndefined()
    })

    it('returns undefined for invalid version', async () => {
      const { getControlVersionEntry } = await import('@/features/workbench/docs/_loader')

      const entry = getControlVersionEntry('delay', '99.99.99')
      expect(entry).toBeUndefined()
    })
  })

  describe('getControlLatestVersion', () => {
    it('returns latest version for valid control', async () => {
      const { getControlLatestVersion } = await import('@/features/workbench/docs/_loader')

      const version = getControlLatestVersion('delay')
      expect(version).toBe('1.0.0')
    })

    it('returns default 1.0.0 for invalid control id', async () => {
      const { getControlLatestVersion } = await import('@/features/workbench/docs/_loader')

      const version = getControlLatestVersion('not-a-control')
      expect(version).toBe('1.0.0')
    })

    it('returns first version in the list (newest)', async () => {
      const { getControlLatestVersion } = await import('@/features/workbench/docs/_loader')

      // wait-until ships a single 1.0.0 entry
      const version = getControlLatestVersion('wait-until')
      expect(version).toBe('1.0.0')
    })
  })

  describe('getControlChangelog', () => {
    it('returns changelog for valid control and version', async () => {
      const { getControlChangelog } = await import('@/features/workbench/docs/_loader')

      const changelog = getControlChangelog('delay', '1.0.0')
      expect(changelog).toBeDefined()
      expect(Array.isArray(changelog)).toBe(true)
      expect(changelog.length).toBeGreaterThan(0)
      expect(changelog).toContain('Full implementation released')
    })

    it('returns empty array for invalid control id', async () => {
      const { getControlChangelog } = await import('@/features/workbench/docs/_loader')

      const changelog = getControlChangelog('not-a-control', '1.0.0')
      expect(changelog).toEqual([])
    })

    it('returns empty array for invalid version', async () => {
      const { getControlChangelog } = await import('@/features/workbench/docs/_loader')

      const changelog = getControlChangelog('delay', '99.99.99')
      expect(changelog).toEqual([])
    })

  })
})
