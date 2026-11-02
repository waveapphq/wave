/** Counted noun: '1 tag', '3 tags'; pass the plural when it is not the noun plus 's'. */
export function pluralize(count: number, noun: string, plural = `${noun}s`): string {
  const label = count === 1 ? noun : plural
  return `${count} ${label}`
}
