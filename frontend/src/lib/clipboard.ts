/**
 * Clipboard copy that works in insecure contexts (plain-HTTP LAN origins),
 * where navigator.clipboard is not exposed.
 */

export async function copyText(text: string): Promise<boolean> {
  // Resolved at call time so tests stubbing the global keep working.
  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Rejection (e.g. permission denial) falls through to the legacy path.
    }
  }
  return legacyCopy(text)
}

// The legacy command API is the only copy path insecure contexts expose.
interface LegacyCommandDocument {
  execCommand(commandId: string): boolean
}

function legacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  let copied: boolean
  try {
    textarea.select()
    copied = (document as unknown as LegacyCommandDocument).execCommand('copy')
  } catch {
    copied = false
  }
  textarea.remove()
  return copied
}
