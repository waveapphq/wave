/**
 * Input Component
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 *
 * Input component following design system specifications.
 */

import {
  forwardRef,
  useId,
  useState,
  useCallback,
  useRef,
  useImperativeHandle,
  type InputHTMLAttributes,
  type ReactNode,
  type ChangeEvent,
} from 'react'

export type InputSize = 'sm' | 'md' | 'lg'

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  size?: InputSize
  error?: boolean
  errorMessage?: string
  helperText?: string
  leftIcon?: ReactNode
  rightIcon?: ReactNode
  prefix?: ReactNode
  suffix?: ReactNode
  wrapperClassName?: string
  clearable?: boolean
  showCount?: boolean
}

const sizeClasses: Record<InputSize, string> = {
  sm: 'input-sm',
  md: 'input-md',
  lg: 'input-lg',
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className = '',
      size = 'md',
      error = false,
      errorMessage,
      helperText,
      leftIcon,
      rightIcon,
      prefix,
      suffix,
      wrapperClassName = '',
      clearable = false,
      showCount = false,
      disabled = false,
      required = false,
      type = 'text',
      value,
      defaultValue,
      onChange,
      maxLength,
      id: providedId,
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref
  ) => {
    const internalRef = useRef<HTMLInputElement>(null)
    useImperativeHandle(ref, () => internalRef.current!)

    const generatedId = useId()
    const id = providedId ?? generatedId
    const errorId = `${id}-error`
    const helperId = `${id}-helper`

    // Track internal value for uncontrolled mode
    const [internalValue, setInternalValue] = useState(
      defaultValue?.toString() ?? ''
    )

    // Determine current value
    const isControlled = value !== undefined
    const currentValue = isControlled ? value.toString() : internalValue

    const handleChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        if (!isControlled) {
          setInternalValue(event.target.value)
        }
        onChange?.(event)
      },
      [isControlled, onChange]
    )

    const handleClear = useCallback(() => {
      if (!isControlled) {
        setInternalValue('')
      }
      // Create a synthetic event for controlled mode
      const input = internalRef.current
      if (input) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          globalThis.HTMLInputElement.prototype,
          'value'
        )?.set
        nativeInputValueSetter?.call(input, '')
        const event = new Event('input', { bubbles: true })
        input.dispatchEvent(event)
        input.focus()
      }
      // Call onChange with empty value
      if (onChange) {
        const syntheticEvent = {
          target: { value: '' },
          currentTarget: { value: '' },
        } as ChangeEvent<HTMLInputElement>
        onChange(syntheticEvent)
      }
    }, [isControlled, onChange])

    const inputClasses = [
      'input',
      'h-10',
      'w-full',
      'px-3',
      'text-sm',
      'transition-[border-color,box-shadow]',
      sizeClasses[size],
      error ? 'input-error' : '',
      disabled ? 'input-disabled' : '',
      leftIcon ? 'pl-10' : '',
      rightIcon || (clearable && currentValue) ? 'pr-10' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ')

    const wrapperClasses = ['input-wrapper', 'relative', wrapperClassName]
      .filter(Boolean)
      .join(' ')

    // Build aria-describedby
    const describedByParts: string[] = []
    if (ariaDescribedBy) {
      describedByParts.push(ariaDescribedBy)
    }
    if (error && errorMessage) {
      describedByParts.push(errorId)
    }
    const computedAriaDescribedBy =
      describedByParts.length > 0 ? describedByParts.join(' ') : undefined

    const showClearButton = clearable && currentValue && !disabled

    return (
      <div className={wrapperClasses}>
        <div className="relative flex items-center">
          {prefix && (
            <span className="absolute left-3 text-muted pointer-events-none">
              {prefix}
            </span>
          )}
          {leftIcon && (
            <span className="absolute left-3 text-muted pointer-events-none">
              {leftIcon}
            </span>
          )}
          <input
            ref={internalRef}
            id={id}
            type={type}
            className={inputClasses}
            disabled={disabled}
            aria-invalid={error ? 'true' : undefined}
            aria-required={required ? 'true' : undefined}
            aria-describedby={computedAriaDescribedBy}
            value={isControlled ? value : undefined}
            defaultValue={isControlled ? undefined : defaultValue}
            onChange={handleChange}
            maxLength={maxLength}
            {...props}
          />
          {suffix && (
            <span className="absolute right-3 text-muted pointer-events-none">
              {suffix}
            </span>
          )}
          {rightIcon && !showClearButton && (
            <span className="absolute right-3 text-muted pointer-events-none">
              {rightIcon}
            </span>
          )}
          {showClearButton && (
            <button
              type="button"
              className="absolute right-3 text-muted hover:text-primary focus:outline-none"
              onClick={handleClear}
              aria-label="Clear input"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {showCount && maxLength && (
          <span className="text-xs text-muted mt-1">
            {currentValue.length}/{maxLength}
          </span>
        )}

        {error && errorMessage && (
          <p id={errorId} className="text-error text-sm mt-1">
            {errorMessage}
          </p>
        )}

        {!error && helperText && (
          <p id={helperId} className="text-muted text-sm mt-1">
            {helperText}
          </p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'
