import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    // Guard against SSR and test environments where matchMedia may not work
    if (globalThis.window === undefined || typeof globalThis.window.matchMedia !== 'function') {
      setIsMobile(false) // Default to desktop in non-browser environments
      return
    }

    const mql = globalThis.window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)

    // Guard against malformed matchMedia result
    if (!mql || typeof mql.addEventListener !== 'function') {
      setIsMobile(globalThis.window.innerWidth < MOBILE_BREAKPOINT)
      return
    }

    const onChange = () => {
      setIsMobile(globalThis.window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(globalThis.window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
