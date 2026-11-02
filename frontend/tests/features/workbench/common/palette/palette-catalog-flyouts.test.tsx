/**
 * ControlsFlyout - the collapsed palette's Controls flyout (REQ-5.2.1.48).
 *
 * Each control category header takes its color from the one control color source.
 */

import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { ControlsFlyout } from '@/features/workbench/common/palette/palette-catalog-flyouts'
import {
  getControlCategoryColor,
  type ControlCategory,
} from '@/features/workbench/lib/control-definitions'

const HEADERS: { label: string; category: ControlCategory; colorClass: string }[] = [
  { label: 'Conditionals', category: 'conditional', colorClass: 'text-orange-500' },
  { label: 'Loops', category: 'loop', colorClass: 'text-cyan-500' },
  { label: 'Flow', category: 'flow', colorClass: 'text-green-500' },
  { label: 'Timing', category: 'timing', colorClass: 'text-yellow-500' },
  { label: 'Misc', category: 'misc', colorClass: 'text-slate-400' },
]

describe('ControlsFlyout category headers', () => {
  it.each(HEADERS)(
    'colors the $label header with the $category category color',
    ({ label, category, colorClass }) => {
      render(<ControlsFlyout />)
      const header = within(screen.getByTestId('palette-flyout-controls')).getByText(label)

      expect(getControlCategoryColor(category)).toBe(colorClass)
      expect(header).toHaveClass(getControlCategoryColor(category))
    }
  )
})
