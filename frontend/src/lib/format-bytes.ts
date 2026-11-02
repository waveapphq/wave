/**
 * Human-readable byte size formatter ("14.2 KB").
 */

const KB = 1024
const MB = KB * 1024
const GB = MB * 1024

/** Format a byte count: integer bytes below 1 KB, one decimal for KB and above. */
export function formatBytes(bytes: number): string {
  if (bytes < KB) {
    return `${bytes} B`
  }
  if (bytes < MB) {
    return `${(bytes / KB).toFixed(1)} KB`
  }
  if (bytes < GB) {
    return `${(bytes / MB).toFixed(1)} MB`
  }
  return `${(bytes / GB).toFixed(1)} GB`
}
