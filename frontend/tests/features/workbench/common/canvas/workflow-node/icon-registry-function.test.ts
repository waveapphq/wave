/**
 * Tests for the workflow-node icon registry's `function` entry:
 * the Function icon is `FunctionSquare` from lucide-react, and the
 * Function color class is the emerald class consistent with the design system.
 *
 * The file under test is `frontend/src/features/workbench/common/canvas/
 * workflow-node/icon-registry.ts`, which exposes three small map lookups:
 * `getIcon(elementType)`, `getIconName(elementType)`, and
 * `getColorClass(elementType)`. The new entry must be discoverable through
 * each.
 */

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { FunctionSquare, Box } from 'lucide-react'

import {
  getIcon,
  getIconName,
  getColorClass,
} from '@/features/workbench/common/canvas/workflow-node/icon-registry'

describe("workflow-node icon-registry: 'function' element type", () => {
  it('returns FunctionSquare from getIcon', () => {
    expect(getIcon('function')).toBe(FunctionSquare)
  })

  it('returns a renderable Lucide SVG when the Function icon is rendered', () => {
    const Icon = getIcon('function')
    const { container } = render(createElement(Icon))
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('returns the emerald color class for the Function element type', () => {
    expect(getColorClass('function')).toBe('text-emerald-500')
  })

  it('returns the kebab-cased icon name for the Function element type', () => {
    expect(getIconName('function')).toBe('function-square')
  })

  it('still falls back to Box / muted / box for unknown element types', () => {
    // Sanity that adding the function entry does not break the fallback path.
    expect(getIcon('unknown-element')).toBe(Box)
    expect(getColorClass('unknown-element')).toBe('text-muted-foreground')
    expect(getIconName('unknown-element')).toBe('box')
  })
})
