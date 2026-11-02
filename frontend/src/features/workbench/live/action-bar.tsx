/**
 * LiveActionBar - live-mode wrapper over the shared `CanvasActionBar`.
 *
 * Forwards every editing / execution / validation handler the live
 * container assembles. Lives in `live/` so a reader browsing that dir
 * sees exactly which handlers the live workbench uses today; the
 * history equivalent in `history/action-bar.tsx` shows what the
 * historical canvas does instead (visibly-disabled buttons, etc.).
 */

import { CanvasActionBar } from '@/features/workbench/common/canvas/canvas-action-bar'
import type { CanvasActionBarProps } from '@/features/workbench/common/canvas/canvas-action-bar/types'

export type LiveActionBarProps = CanvasActionBarProps

export function LiveActionBar(props: Readonly<LiveActionBarProps>) {
  return <CanvasActionBar {...props} />
}
