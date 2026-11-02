/**
 * HistoryPalette - history-mode wrapper over `PalettePanel`.
 *
 * Collapsed + disabled: the icon strip renders but all interactions
 * are suppressed (no flyouts, no clicks, no expand).
 */

import { PalettePanel } from '@/features/workbench/common/palette'

export function HistoryPalette() {
  return <PalettePanel disabled />
}
