/**
 * String similarity helpers for expression validation.
 *
 * Provides Levenshtein distance calculation and variable name
 * suggestion for typo detection (e.g., "mssage" -> "message").
 */

// ============================================
// Similarity Helpers
// ============================================

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Find the most similar variable name from a set of available names
 * Returns the suggestion if the distance is <= 2 (allows for small typos)
 */
export function findSimilarVariable(
  unknown: string,
  availableNames: Set<string>
): string | undefined {
  let bestMatch: string | undefined
  let bestDistance = Infinity

  for (const name of availableNames) {
    const distance = levenshteinDistance(unknown.toLowerCase(), name.toLowerCase())
    if (distance < bestDistance && distance <= 2) {
      bestDistance = distance
      bestMatch = name
    }
  }

  return bestMatch
}
