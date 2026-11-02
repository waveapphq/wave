/**
 * EntityTypeChip - colored entity-type pill shared by the Reports + Artifacts
 * surfaces (list Type column + detail headers).
 *
 * Violet regression / amber suite / green test, drawn from the shared design
 * tokens (syntax-keyword / warning / success) so it adapts to dark mode. The
 * tinted bordered pill is the badge style; uppercase + tracking matches the
 * Reports typography. The entity icon is optional (shown in list Type cells,
 * hidden in detail headers). Unknown / null types fall back to a neutral chip.
 */

import { GitBranch, FolderKanban, TestTube2, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type EntityChipType = 'regression' | 'suite' | 'test'

interface ChipConfig {
  label: string
  Icon: LucideIcon
  className: string
}

const CHIP_CONFIG: Record<EntityChipType, ChipConfig> = {
  regression: {
    label: 'Regression',
    Icon: GitBranch,
    className: 'border-syntax-keyword/30 bg-syntax-keyword/10 text-syntax-keyword',
  },
  suite: {
    label: 'Suite',
    Icon: FolderKanban,
    className: 'border-warning-border bg-warning-bg text-warning',
  },
  test: {
    label: 'Test',
    Icon: TestTube2,
    className: 'border-success-border bg-success-bg text-success',
  },
}

const BASE =
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider'

export interface EntityTypeChipProps {
  type: string | null
  showIcon?: boolean
  'data-testid'?: string
}

export function EntityTypeChip({ type, showIcon = false, ...rest }: Readonly<EntityTypeChipProps>) {
  const config = type ? CHIP_CONFIG[type as EntityChipType] : undefined
  if (!config) {
    return (
      <span className={cn(BASE, 'text-muted')} {...rest}>
        {type || '-'}
      </span>
    )
  }
  const { label, Icon, className } = config
  return (
    <span className={cn(BASE, className)} {...rest}>
      {showIcon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {label}
    </span>
  )
}
