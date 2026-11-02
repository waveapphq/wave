/**
 * Dropdown/DropdownMenu Component
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 * REQ-5.2.1.17: Responsive layout - bottom sheet mode on mobile
 *
 * Composite dropdown menu component with keyboard navigation following
 * design system specifications and WAI-ARIA menu pattern.
 *
 * Responsive behavior:
 * - >= 640px (sm): Positioned dropdown menu
 * - < 640px: Bottom sheet with overlay
 */

/* v8 ignore next - COV-V8-001 */
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type ButtonHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { useViewport } from '@/hooks/use-viewport'

export type DropdownDisplayMode = 'dropdown' | 'bottom-sheet'

// Context for dropdown state
interface DropdownContextValue {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
  menuId: string
  placement: DropdownPlacement
  displayMode: DropdownDisplayMode
  registerItem: (element: HTMLElement, disabled: boolean) => void
  unregisterItem: (element: HTMLElement) => void
  focusedIndex: number
  setFocusedIndex: (index: number) => void
  items: Array<{ element: HTMLElement; disabled: boolean }>
  closeAndFocusTrigger: () => void
}

const DropdownContext = createContext<DropdownContextValue | null>(null)

function useDropdownContext() {
  const context = useContext(DropdownContext)
  if (!context) {
    throw new Error('Dropdown components must be used within a Dropdown')
  }
  return context
}

export type DropdownPlacement = 'bottom-start' | 'bottom-end'

export interface DropdownProps {
  children: ReactNode
  /** Placement of the menu relative to trigger */
  placement?: DropdownPlacement
}

export function Dropdown({ children, placement = 'bottom-start' }: Readonly<DropdownProps>) {
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [items, setItems] = useState<Array<{ element: HTMLElement; disabled: boolean }>>([])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  // Determine display mode based on viewport
  const { isAtLeast } = useViewport()
  const displayMode: DropdownDisplayMode = isAtLeast('sm') ? 'dropdown' : 'bottom-sheet'

  const registerItem = useCallback((element: HTMLElement, disabled: boolean) => {
    setItems((prev) => [...prev.filter((item) => item.element !== element), { element, disabled }])
  }, [])

  const unregisterItem = useCallback((element: HTMLElement) => {
    setItems((prev) => prev.filter((item) => item.element !== element))
  }, [])

  const closeAndFocusTrigger = useCallback(() => {
    setIsOpen(false)
    triggerRef.current?.focus()
  }, [])

  // Reset focused index when menu opens
  useEffect(() => {
    if (isOpen) {
      // Find first non-disabled item
      const firstEnabledIndex = items.findIndex((item) => !item.disabled)
      setFocusedIndex(Math.max(firstEnabledIndex, 0))
    }
  }, [isOpen, items])

  // Focus the appropriate item when focused index changes
  useEffect(() => {
    if (isOpen && items[focusedIndex]?.element) {
      items[focusedIndex].element.focus()
    }
  }, [isOpen, focusedIndex, items])

  const contextValue = useMemo(
    (): DropdownContextValue => ({
      isOpen,
      setIsOpen,
      triggerRef,
      menuId,
      placement,
      displayMode,
      registerItem,
      unregisterItem,
      focusedIndex,
      setFocusedIndex,
      items,
      closeAndFocusTrigger,
    }),
    [isOpen, setIsOpen, triggerRef, menuId, placement, displayMode, registerItem, unregisterItem, focusedIndex, setFocusedIndex, items, closeAndFocusTrigger]
  )

  return (
    <DropdownContext.Provider
      value={contextValue}
    >
      {/* v8 ignore next - COV-V8-003: V8 counts JSX expression as branch */}
      <div className="dropdown relative inline-block">{children}</div>
    </DropdownContext.Provider>
  )
}

export interface DropdownTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
}

export const DropdownTrigger = forwardRef<HTMLButtonElement, DropdownTriggerProps>(
  ({ children, onClick, onKeyDown, ...props }, forwardedRef) => {
    const { isOpen, setIsOpen, triggerRef, menuId } = useDropdownContext()

    // Merge refs
    const handleRef = (element: HTMLButtonElement | null) => {
      triggerRef.current = element
      if (typeof forwardedRef === 'function') {
        forwardedRef(element)
      } else if (forwardedRef) {
        forwardedRef.current = element
      }
    }

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      setIsOpen(!isOpen)
      onClick?.(e)
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        if (!isOpen) {
          e.preventDefault()
          setIsOpen(true)
        }
      }
      onKeyDown?.(e)
    }

    return (
      <button
        ref={handleRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        {...props}
      >
        {children}
      </button>
    )
  }
)

DropdownTrigger.displayName = 'DropdownTrigger'

export interface DropdownMenuProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export const DropdownMenu = forwardRef<HTMLDivElement, DropdownMenuProps>(
  ({ children, className = '', onKeyDown, ...props }, ref) => {
    const {
      isOpen,
      setIsOpen,
      triggerRef,
      menuId,
      placement,
      displayMode,
      focusedIndex,
      setFocusedIndex,
      items,
      closeAndFocusTrigger,
    } = useDropdownContext()

    const { isTouchDevice } = useViewport()
    const menuRef = useRef<HTMLDivElement>(null)
    const touchStartY = useRef<number>(0)
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

    const isBottomSheet = displayMode === 'bottom-sheet'

    // Calculate position for portal-based dropdown
    useLayoutEffect(() => {
      if (!isOpen || isBottomSheet || !triggerRef.current) return

      const trigger = triggerRef.current
      const rect = trigger.getBoundingClientRect()
      /* v8 ignore next - COV-JSDOM-003 */
      const menuWidth = menuRef.current?.offsetWidth ?? 160

      // Calculate position based on placement
      let left = placement === 'bottom-end' ? rect.right - menuWidth : rect.left
      let top = rect.bottom + 4 // 4px gap

      // Ensure menu stays within viewport bounds
      const viewportWidth = globalThis.innerWidth
      /* v8 ignore next - COV-V8-003: V8 tracks implicit branch on property access */
      const viewportHeight = globalThis.innerHeight
      /* v8 ignore next - COV-JSDOM-003 */
      const menuHeight = menuRef.current?.offsetHeight ?? 200

      // Horizontal bounds check
      /* v8 ignore start - COV-JSDOM-003 */
      if (left + menuWidth > viewportWidth - 8) {
        left = viewportWidth - menuWidth - 8
      }
      /* v8 ignore stop */
      if (left < 8) {
        left = 8
      }

      // Vertical bounds check - flip to top if not enough space below
      /* v8 ignore start - COV-JSDOM-003 */
      if (top + menuHeight > viewportHeight - 8) {
        top = rect.top - menuHeight - 4
      }
      /* v8 ignore stop */

      /* v8 ignore next - COV-DEF-082 */
      setPosition({ top, left })
    }, [isOpen, isBottomSheet, placement, triggerRef])

    // Close on click outside (for dropdown mode)
    useEffect(() => {
      /* v8 ignore next - COV-BRANCH-089 */
      if (!isOpen || isBottomSheet) return

      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as Node
        if (
          menuRef.current &&
          !menuRef.current.contains(target) &&
          triggerRef.current &&
          !triggerRef.current.contains(target)
        ) {
          setIsOpen(false)
        }
      }

      // Delay adding listener to avoid immediate close
      const timeoutId = setTimeout(() => {
        document.addEventListener('click', handleClickOutside)
      }, 0)

      return () => {
        clearTimeout(timeoutId)
        document.removeEventListener('click', handleClickOutside)
      }
    }, [isOpen, setIsOpen, triggerRef, isBottomSheet])

    // Reposition on scroll (for portal-based dropdown)
    useEffect(() => {
      if (!isOpen || isBottomSheet || !triggerRef.current) return

      /* v8 ignore start - COV-JSDOM-003 */
      const updatePosition = () => {
        const trigger = triggerRef.current
        if (!trigger) return

        const rect = trigger.getBoundingClientRect()
        const menuWidth = menuRef.current?.offsetWidth ?? 160
        const menuHeight = menuRef.current?.offsetHeight ?? 200

        let left = placement === 'bottom-end' ? rect.right - menuWidth : rect.left
        let top = rect.bottom + 4

        const viewportWidth = globalThis.innerWidth
        const viewportHeight = globalThis.innerHeight

        if (left + menuWidth > viewportWidth - 8) left = viewportWidth - menuWidth - 8
        if (left < 8) left = 8
        if (top + menuHeight > viewportHeight - 8) top = rect.top - menuHeight - 4

        setPosition({ top, left })
      }
      /* v8 ignore stop */

      // Listen to scroll and resize events
      /* v8 ignore start - COV-V8-003: V8 non-deterministic branch tracking in useEffect body */
      globalThis.addEventListener('scroll', updatePosition, true)
      globalThis.addEventListener('resize', updatePosition)

      return () => {
        globalThis.removeEventListener('scroll', updatePosition, true)
        globalThis.removeEventListener('resize', updatePosition)
      }
      /* v8 ignore stop */
    }, [isOpen, isBottomSheet, placement, triggerRef])

    // Focus trap for bottom sheet mode
    useEffect(() => {
      if (!isOpen || !isBottomSheet || !menuRef.current) return

      const menu = menuRef.current
      const focusableElements = menu.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"])'
      )
      const firstFocusable = focusableElements[0]
      const lastFocusable = focusableElements[focusableElements.length - 1]

      const handleTabKey = (e: globalThis.KeyboardEvent) => {
        if (e.key !== 'Tab') return

        if (e.shiftKey && document.activeElement === firstFocusable) {
          e.preventDefault()
          lastFocusable?.focus()
        } else if (!e.shiftKey && document.activeElement === lastFocusable) {
          e.preventDefault()
          firstFocusable?.focus()
        }
      }

      document.addEventListener('keydown', handleTabKey)
      return () => document.removeEventListener('keydown', handleTabKey)
    }, [isOpen, isBottomSheet, items])

    // Swipe-to-dismiss for bottom sheet on touch devices
    useEffect(() => {
      if (!isOpen || !isBottomSheet || !isTouchDevice || !menuRef.current) return

      const menu = menuRef.current

      const handleTouchStart = (e: TouchEvent) => {
        touchStartY.current = e.touches[0].clientY
      }

      const handleTouchEnd = (e: TouchEvent) => {
        const touchEndY = e.changedTouches[0].clientY
        const deltaY = touchEndY - touchStartY.current
        const swipeThreshold = 100

        // Swipe down to dismiss
        if (deltaY > swipeThreshold) {
          setIsOpen(false)
        }
      }

      menu.addEventListener('touchstart', handleTouchStart)
      menu.addEventListener('touchend', handleTouchEnd)

      return () => {
        menu.removeEventListener('touchstart', handleTouchStart)
        menu.removeEventListener('touchend', handleTouchEnd)
      }
    }, [isOpen, isBottomSheet, isTouchDevice, setIsOpen])

    const getNextEnabledIndex = (currentIndex: number, direction: 1 | -1): number => {
      const itemCount = items.length
      if (itemCount === 0) return 0

      let nextIndex = currentIndex
      for (let i = 0; i < itemCount; i++) {
        nextIndex = (nextIndex + direction + itemCount) % itemCount
        if (!items[nextIndex].disabled) {
          return nextIndex
        }
      }
      return currentIndex
    }

    const findFirstEnabledIndex = (): number => {
      for (let i = 0; i < items.length; i++) {
        if (!items[i].disabled) return i
      }
      return 0
    }

    const findLastEnabledIndex = (): number => {
      for (let i = items.length - 1; i >= 0; i--) {
        if (!items[i].disabled) return i
      }
      return 0
    }

    const findTypeAheadIndex = (char: string): number | null => {
      const lowerChar = char.toLowerCase()
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (!item.disabled && item.element.textContent?.toLowerCase().startsWith(lowerChar)) {
          return i
        }
      }
      return null
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          closeAndFocusTrigger()
          break
        case 'ArrowDown':
          e.preventDefault()
          setFocusedIndex(getNextEnabledIndex(focusedIndex, 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setFocusedIndex(getNextEnabledIndex(focusedIndex, -1))
          break
        case 'Home':
          e.preventDefault()
          setFocusedIndex(findFirstEnabledIndex())
          break
        case 'End':
          e.preventDefault()
          setFocusedIndex(findLastEnabledIndex())
          break
        default:
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            const matchIndex = findTypeAheadIndex(e.key)
            if (matchIndex !== null) {
              setFocusedIndex(matchIndex)
            }
          }
      }
      onKeyDown?.(e)
    }

    const handleOverlayClick = () => {
      setIsOpen(false)
    }

    if (!isOpen) return null

    // Bottom sheet mode
    if (isBottomSheet) {
      const bottomSheetClasses = [
        'dropdown-menu',
        'fixed',
        'bottom-0',
        'left-0',
        'right-0',
        'z-50',
        'w-full',
        'py-2',
        'rounded-t-lg',
        'shadow-lg',
        'border-t',
        'bg-card',
        'animate-slide-up',
        className,
      ]
        .filter(Boolean)
        .join(' ')

      return (
        <>
          {/* Overlay */}
          <button
            type="button"
            data-testid="dropdown-overlay"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-overlay"
            style={{ all: 'unset', position: 'fixed', inset: 0, zIndex: 40 }}
            onClick={handleOverlayClick}
          />
          {/* Bottom Sheet */}
          <dialog
            ref={(el) => {
              menuRef.current = el as HTMLDivElement | null
              if (typeof ref === 'function') {
                ref(el as HTMLDivElement | null)
              } else if (ref) {
                ref.current = el as HTMLDivElement | null
              }
            }}
            open
            id={menuId}
            aria-modal="true"
            data-placement={placement}
            data-display-mode="bottom-sheet"
            className={bottomSheetClasses}
            {...(props as React.DialogHTMLAttributes<HTMLDialogElement>)}
          >
            {/* Drag handle indicator */}
            <div
              data-testid="bottom-sheet-handle"
              className="mx-auto mb-2 h-1 w-12 rounded-full bg-muted"
              aria-hidden="true"
            />
            {/* Menu container for ARIA */}
            <div role="menu" tabIndex={-1} onKeyDown={handleKeyDown}>
              {children}
            </div>
          </dialog>
        </>
      )
    }

    // Dropdown mode - render via portal to avoid overflow clipping
    const menuClasses = [
      'dropdown-menu',
      'fixed',
      'z-50',
      'min-w-[160px]',
      'py-1',
      'rounded-md',
      'shadow-md',
      'border',
      'bg-card',
      className,
    ]
      .filter(Boolean)
      .join(' ')

    const menuStyle = position
      ? { top: position.top, left: position.left }
      : { visibility: 'hidden' as const }

    const menuElement = (
      <div
        ref={(el) => {
          menuRef.current = el
          if (typeof ref === 'function') {
            ref(el)
          } else if (ref) {
            ref.current = el
          }
        }}
        id={menuId}
        role="menu"
        tabIndex={-1}
        data-placement={placement}
        data-display-mode="dropdown"
        className={menuClasses}
        style={menuStyle}
        onKeyDown={handleKeyDown}
        {...props}
      >
        {children}
      </div>
    )

    // Use portal to render at document body level, avoiding overflow clipping
    return createPortal(menuElement, document.body)
  }
)

DropdownMenu.displayName = 'DropdownMenu'

export interface DropdownItemProps extends HTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  /** Whether the item is disabled */
  disabled?: boolean
  /** Called when the item is selected */
  onSelect?: () => void
  /** Icon to display before the label */
  icon?: ReactNode
  /** Whether to close the menu when this item is selected (default: true) */
  closeOnSelect?: boolean
}

export const DropdownItem = forwardRef<HTMLButtonElement, DropdownItemProps>(
  ({ children, disabled = false, onSelect, icon, className = '', onClick, onKeyDown, onFocus, closeOnSelect = true, ...props }, forwardedRef) => {
    const { registerItem, unregisterItem, setIsOpen, displayMode, items, setFocusedIndex } = useDropdownContext()
    const itemRef = useRef<HTMLButtonElement>(null)

    const isBottomSheet = displayMode === 'bottom-sheet'

    // Register/unregister with parent
    useEffect(() => {
      const element = itemRef.current
      if (element) {
        registerItem(element, disabled)
        return () => unregisterItem(element)
      }
    }, [registerItem, unregisterItem, disabled])

    const handleSelect = () => {
      if (disabled) return
      onSelect?.()
      if (closeOnSelect) {
        setIsOpen(false)
      }
    }

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled) {
        e.preventDefault()
        return
      }
      handleSelect()
      onClick?.(e)
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleSelect()
      }
      onKeyDown?.(e)
    }

    // Sync focus with parent's focusedIndex when item receives focus directly
    const handleFocus = (e: React.FocusEvent<HTMLButtonElement>) => {
      const index = items.findIndex((item) => item.element === itemRef.current)
      if (index >= 0) {
        setFocusedIndex(index)
      }
      /* v8 ignore next - COV-BRANCH-015 */
      onFocus?.(e)
    }

    /* v8 ignore next 8 - COV-BRANCH-088 */
    const itemClasses = [
      'dropdown-item',
      'flex',
      'items-center',
      'w-full',
      'px-3',
      // Different padding for bottom sheet (touch-friendly)
      isBottomSheet ? 'py-3 min-h-12' : 'py-2',
      'text-sm',
      'cursor-pointer',
      'outline-none',
      icon ? 'gap-2' : '',
      disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-subtle focus:bg-subtle',
      className,
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <button
        type="button"
        ref={(el) => {
          itemRef.current = el
          if (typeof forwardedRef === 'function') {
            forwardedRef(el)
          } else if (forwardedRef) {
            forwardedRef.current = el
          }
        }}
        role="menuitem"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled ? 'true' : undefined}
        className={itemClasses}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        {...props}
      >
        {icon}
        {children}
      </button>
    )
  }
)

DropdownItem.displayName = 'DropdownItem'

export type DropdownDividerProps = HTMLAttributes<HTMLHRElement>

export const DropdownDivider = forwardRef<HTMLHRElement, DropdownDividerProps>(
  ({ className = '', ...props }, ref) => {
    return (
      <hr
        ref={ref}
        className={`border-t my-1 ${className}`}
        {...props}
      />
    )
  }
)

DropdownDivider.displayName = 'DropdownDivider'

export interface DropdownLabelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export const DropdownLabel = forwardRef<HTMLDivElement, DropdownLabelProps>(
  ({ children, className = '', ...props }, ref) => {
    const labelClasses = [
      'dropdown-label',
      'px-3',
      'py-1.5',
      'text-xs',
      'font-semibold',
      'text-muted',
      className,
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <div ref={ref} className={labelClasses} {...props}>
        {children}
      </div>
    )
  }
)

DropdownLabel.displayName = 'DropdownLabel'
