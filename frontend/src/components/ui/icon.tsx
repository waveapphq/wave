/**
 * Icon Component
 *
 * REQ-5.2.1.11: Icon library integration
 *
 * Wraps Lucide icons with design system integration for consistent
 * sizing, colors, and accessibility.
 *
 * Icon size scale:
 * - xs: 14px (strokeWidth 1.5)
 * - sm: 16px (strokeWidth 1.5)
 * - md: 18px (strokeWidth 2) - default
 * - lg: 20px (strokeWidth 2)
 * - xl: 24px (strokeWidth 2)
 * - 2xl: 32px (strokeWidth 2)
 */

import type { ComponentType, SVGProps, HTMLAttributes } from 'react'

// Re-export commonly used Lucide icons for convenience
export {
  ChevronRight as ChevronRightIcon,
  ChevronDown as ChevronDownIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronUp as ChevronUpIcon,
  X as XIcon,
  Check as CheckIcon,
  Plus as PlusIcon,
  Minus as MinusIcon,
  Search as SearchIcon,
  Menu as MenuIcon,
  Settings as SettingsIcon,
  User as UserIcon,
  Home as HomeIcon,
  AlertCircle as AlertCircleIcon,
  Info as InfoIcon,
  AlertTriangle as AlertTriangleIcon,
  CheckCircle as CheckCircleIcon,
  Loader as LoaderIcon,
  RefreshCw as RefreshCwIcon,
  Trash as TrashIcon,
  Edit as EditIcon,
  Copy as CopyIcon,
  ExternalLink as ExternalLinkIcon,
  Download as DownloadIcon,
  Upload as UploadIcon,
  Folder as FolderIcon,
  File as FileIcon,
  Play as PlayIcon,
  Pause as PauseIcon,
  StopCircle as StopCircleIcon,
  Sun as SunIcon,
  Moon as MoonIcon,
  // Variable Manager icons
  Eye as EyeIcon,
  EyeOff as EyeOffIcon,
  Lock as LockIcon,
  Pencil as PencilIcon,
  Filter as FilterIcon,
  RefreshCcw as RefreshCcwIcon,
  // Rename/text icons
  Type as TypeIcon,
  // Editor mode toggle icons
  Code as CodeIcon,
  List as ListIcon,
  // Reorder icons
  GripVertical as GripVerticalIcon,
} from 'lucide-react'

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
export type IconVariant = 'outlined' | 'filled'
// Design system color tokens with arbitrary CSS color support
type ArbitraryColor = string & Record<never, never>
export type IconColor =
  | 'currentColor'
  | 'primary'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'muted'
  | ArbitraryColor

interface LucideIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string
  strokeWidth?: number
  stroke?: string
  fill?: string
}

export type LucideIcon = ComponentType<LucideIconProps>

export interface IconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'> {
  /** The Lucide icon component to render */
  icon: LucideIcon
  /** Icon size from the design system scale */
  size?: IconSize
  /** Icon color - can be a design token name or any valid CSS color */
  color?: IconColor
  /** Icon variant */
  variant?: IconVariant
  /** Accessibility label - when provided, icon is not decorative */
  label?: string
  /** Whether to show spinning animation */
  spin?: boolean
  /** Custom stroke width (overrides size-based default) */
  strokeWidth?: number
}

const sizeMap: Record<IconSize, number> = {
  xs: 14,
  sm: 16,
  md: 18,
  lg: 20,
  xl: 24,
  '2xl': 32,
}

const strokeWidthMap: Record<IconSize, number> = {
  xs: 1.5,
  sm: 1.5,
  md: 2,
  lg: 2,
  xl: 2,
  '2xl': 2,
}

function getColorValue(color: IconColor): string {
  switch (color) {
    case 'currentColor':
      return 'currentColor'
    case 'primary':
      return 'var(--color-primary)'
    case 'success':
      return 'var(--color-success-text)'
    case 'warning':
      return 'var(--color-warning-text)'
    case 'error':
      return 'var(--color-error-text)'
    case 'info':
      return 'var(--color-info-text)'
    case 'muted':
      return 'var(--color-text-muted)'
    default:
      return color
  }
}

export function Icon({
  icon: IconComponent,
  size = 'md',
  color = 'currentColor',
  variant = 'outlined',
  label,
  spin = false,
  strokeWidth,
  className = '',
  ...props
}: Readonly<IconProps>) {
  const pixelSize = sizeMap[size]
  const defaultStrokeWidth = strokeWidthMap[size]
  const finalStrokeWidth = strokeWidth ?? defaultStrokeWidth
  const strokeColor = getColorValue(color)

  const isDecorative = !label

  const wrapperClasses = [
    'icon',
    'inline-flex',
    variant === 'filled' ? 'icon-filled' : 'icon-outlined',
    spin ? 'animate-spin' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span
      className={wrapperClasses}
      {...(isDecorative
        ? { 'aria-hidden': 'true' }
        : { role: 'img', 'aria-label': label })}
      {...props}
    >
      <IconComponent
        size={pixelSize}
        strokeWidth={finalStrokeWidth}
        stroke={strokeColor}
        fill={variant === 'filled' ? 'currentColor' : 'none'}
        focusable="false"
      />
    </span>
  )
}
