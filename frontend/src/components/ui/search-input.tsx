/**
 * SearchInput Component
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 *
 * Composite search input component combining:
 * - Search icon (left)
 * - Text input with search type
 * - Clear button (when has value)
 * - Optional loading state
 */

/* v8 ignore next - COV-V8-006: V8 coverage merge non-deterministically drops this import across forks pool */
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from 'react'
import { SearchIcon, XIcon, LoaderIcon } from './icon'

export type SearchInputSize = 'xs' | 'sm' | 'md' | 'lg'

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'onSubmit'> {
  /** Size variant */
  size?: SearchInputSize
  /** Show loading spinner */
  loading?: boolean
  /** Callback when clear button is clicked */
  onClear?: () => void
  /** Debounced search callback */
  onSearch?: (value: string) => void
  /** Debounce delay in milliseconds */
  debounceMs?: number
  /** Callback when Enter is pressed */
  onSubmit?: (value: string) => void
  /** Prevent form submission on Enter */
  preventSubmit?: boolean
  /** Additional class name for wrapper */
  className?: string
  /** Additional class name for input element */
  inputClassName?: string
  /** Test id stamped on the input element itself (the wrapper takes data-testid) */
  inputTestId?: string
  /** Test id stamped on the clear button */
  clearTestId?: string
  /** Accessible name of the clear button */
  clearLabel?: string
}

const sizeClasses: Record<SearchInputSize, string> = {
  xs: 'h-8',
  sm: 'h-9',
  md: 'h-10',
  lg: 'h-12',
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      size = 'md',
      loading = false,
      onClear,
      onSearch,
      debounceMs,
      onSubmit,
      preventSubmit = false,
      className = '',
      inputClassName = '',
      inputTestId,
      clearTestId,
      clearLabel = 'Clear search',
      placeholder = 'Search…',
      disabled = false,
      value: controlledValue,
      defaultValue,
      onChange,
      onKeyDown,
      ...props
    },
    forwardedRef
  ) => {
    const inputRef = useRef<HTMLInputElement>(null)
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Track whether input has value for showing clear button
    // For controlled: use controlledValue, for uncontrolled: track in state
    const isControlled = controlledValue !== undefined
    const [hasValue, setHasValue] = useState(() => {
      if (isControlled) return (controlledValue as string).length > 0
      return defaultValue ? String(defaultValue).length > 0 : false
    })

    // Update hasValue when controlled value changes
    useEffect(() => {
      if (isControlled) {
        setHasValue((controlledValue as string).length > 0)
      }
    }, [isControlled, controlledValue])

    // Merge refs
    const handleRef = (element: HTMLInputElement | null) => {
      inputRef.current = element
      if (typeof forwardedRef === 'function') {
        forwardedRef(element)
      } else if (forwardedRef) {
        forwardedRef.current = element
      }
    }

    // Cleanup debounce timer on unmount
    useEffect(() => {
      return () => {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
        }
      }
    }, [])

    const triggerDebouncedSearch = useCallback(
      (searchValue: string) => {
        if (!onSearch || !debounceMs) return

        // Clear existing timer
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
        }

        // Set new timer
        debounceTimerRef.current = setTimeout(() => {
          onSearch(searchValue)
        }, debounceMs)
      },
      [onSearch, debounceMs]
    )

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value
      setHasValue(newValue.length > 0)
      onChange?.(e)
      triggerDebouncedSearch(newValue)
    }

    const handleClear = () => {
      if (inputRef.current) {
        // Directly update the input value
        inputRef.current.value = ''
        setHasValue(false)

        // Trigger onChange with synthetic event
        if (onChange) {
          const syntheticEvent = {
            target: inputRef.current,
            currentTarget: inputRef.current,
          } as React.ChangeEvent<HTMLInputElement>
          onChange(syntheticEvent)
        }
      }

      onClear?.()

      // Focus input after clearing
      inputRef.current?.focus()
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        handleClear()
      } else if (e.key === 'Enter') {
        if (preventSubmit) {
          e.preventDefault()
        }
        onSubmit?.(e.currentTarget.value)
      }
      onKeyDown?.(e)
    }

    const showClearButton = hasValue && !loading && !disabled

    // Extract data-testid from props to avoid spreading to input
    const { 'data-testid': dataTestId, ...inputRestProps } = props as Record<string, unknown> & typeof props

    const wrapperClasses = [
      'search-input-wrapper',
      'search-input',
      'relative',
      'inline-flex',
      'items-center',
      className,
    ]
      .filter(Boolean)
      .join(' ')

    // Line-height classes to match height for vertical text centering
    const lineHeightClasses: Record<SearchInputSize, string> = {
      xs: 'leading-8',
      sm: 'leading-9',
      md: 'leading-10',
      lg: 'leading-[48px]',
    }

    const inputClasses = [
      'w-full',
      'rounded',
      sizeClasses[size],
      lineHeightClasses[size],
      'pl-10',
      showClearButton || loading ? 'pr-10' : 'pr-3',
      'border',
      'outline-none',
      'transition-colors',
      'text-sm',
      disabled ? 'input-disabled' : '',
      inputClassName,
    ]
      .filter(Boolean)
      .join(' ')

    // Build input props based on controlled vs uncontrolled
    const inputValueProps = isControlled
      ? { value: controlledValue as string }
      : { defaultValue: defaultValue as string }

    return (
      <div
        className={wrapperClasses}
        data-testid={dataTestId}
        aria-busy={loading ? 'true' : undefined}
      >
        {/* Search icon */}
        <span
          data-search-icon
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        >
          <SearchIcon size={16} />
        </span>

        {/* Input */}
        <input
          ref={handleRef}
          type="search"
          data-testid={inputTestId}
          placeholder={placeholder}
          disabled={disabled}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className={inputClasses}
          {...inputValueProps}
          {...inputRestProps}
        />

        {/* Loading spinner */}
        {loading && (
          <span
            data-loading-spinner
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted"
          >
            <LoaderIcon size={16} />
          </span>
        )}

        {/* Clear button */}
        {showClearButton && (
          <button
            type="button"
            onClick={handleClear}
            data-testid={clearTestId}
            aria-label={clearLabel}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-default"
          >
            <XIcon size={16} />
          </button>
        )}
      </div>
    )
  }
)

SearchInput.displayName = 'SearchInput'
