/**
 * The glide of a watched change: in its first step every staying
 * Block that moves eases from where the canvas shows it to its new place, all
 * together, before any new Block appears.
 */

export const GLIDE_MS = 300

interface Point {
  x: number
  y: number
}

interface GlideNode {
  id: string
  position: Point
}

export interface GlideMove {
  from: Point
  to: Point
}

export type GlideMoves = ReadonlyMap<string, GlideMove>

export interface MirrorGlide {
  moves: GlideMoves
  /** The frame time the Blocks set off, or null while the view still frames the finished test. */
  startedAt: number | null
  /** The animation frame that takes the next step. */
  frame: number
}

export type GlidePhase = 'framing' | 'moving'

/** Each Block of `next` that the canvas already shows at another place, with where it shows and where it goes. */
export function glideMoves(shown: readonly GlideNode[], next: readonly GlideNode[]): Map<string, GlideMove> {
  const shownAt = new Map(shown.map((node) => [node.id, node.position]))
  const moves = new Map<string, GlideMove>()
  for (const node of next) {
    const from = shownAt.get(node.id)
    if (from && (from.x !== node.position.x || from.y !== node.position.y)) {
      moves.set(node.id, { from, to: node.position })
    }
  }
  return moves
}

/** How far a glide has gone after `elapsed` ms, from 0 to 1, eased out so the Blocks settle softly. */
export function glideProgress(elapsed: number): number {
  const t = Math.min(Math.max(elapsed / GLIDE_MS, 0), 1)
  return 1 - (1 - t) ** 3
}

/** The nodes with every moving Block placed `progress` of the way to its new place, and exactly on it at 1. */
export function placeGliding<T extends GlideNode>(nodes: readonly T[], moves: GlideMoves, progress: number): T[] {
  return nodes.map((node) => {
    const move = moves.get(node.id)
    if (!move) return node
    const position =
      progress >= 1
        ? move.to
        : {
            x: move.from.x + (move.to.x - move.from.x) * progress,
            y: move.from.y + (move.to.y - move.from.y) * progress,
          }
    return { ...node, position }
  })
}

interface GlideFrame {
  watch_kind?: string | null
  final_bounds?: unknown
  active_node_id?: string | null
  test_id?: string | null
}

/** Only the first step of a watched change glides, and only over the test the canvas already shows. */
export function glidesFrame(frame: GlideFrame, shownTestId: string | null): boolean {
  return (
    frame.watch_kind === 'change' &&
    Boolean(frame.final_bounds) &&
    !frame.active_node_id &&
    Boolean(frame.test_id) &&
    frame.test_id === shownTestId
  )
}

/** What the canvas names while Blocks glide: still framing the finished test, or moving. */
export function glidePhase(glide: MirrorGlide | null): GlidePhase | undefined {
  if (!glide) return undefined
  return glide.startedAt === null ? 'framing' : 'moving'
}
