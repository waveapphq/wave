/** Joins failed-read labels: 'a', 'a and b', 'a, b and c'. */
export function joinLabels(labels: string[]): string {
  if (labels.length === 1) return labels[0]
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}
