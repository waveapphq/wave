/**
 * Field length constants and validation patterns shared across the frontend.
 *
 * `MAX_ELEMENT_NAME_LENGTH` matches `MAX_VARIABLE_NAME_LENGTH` so the two
 * always evolve together; bumping one without the other is a bug.
 *
 * `MAX_ENTITY_NAME_LENGTH` covers identifier-shaped names (suite, regression,
 * environment, profile). `MAX_TEST_NAME_LENGTH` is intentionally larger because
 * test names double as long descriptive titles.
 */

/** Regex pattern for valid variable names (Python identifier). */
export const VARIABLE_NAME_PATTERN = /^[a-zA-Z_]\w*$/

export const VARIABLE_NAME_REQUIRED_MESSAGE = 'Name is required'

/** Describes VARIABLE_NAME_PATTERN in words. */
export const VARIABLE_NAME_RULE_MESSAGE =
  'Name must start with a letter or underscore, and contain only letters, numbers, and underscores'

/** Maximum length for variable names (Python identifiers). */
export const MAX_VARIABLE_NAME_LENGTH = 64

/** Maximum length for canvas-element display names. Tied to MAX_VARIABLE_NAME_LENGTH. */
export const MAX_ELEMENT_NAME_LENGTH = 64

/** Maximum length for entity names: suite, regression, environment, profile. */
export const MAX_ENTITY_NAME_LENGTH = 64

/** Maximum length for test names. Larger than entity caps because tests double as descriptive titles. */
export const MAX_TEST_NAME_LENGTH = 255

/** Maximum length for canvas block (plugin / control / Function) names.
 *
 * Capped tighter than entity names so the canvas-node header reads cleanly
 * (badges + name + status icons all fit on one row). Used by every canvas
 * block's config modal as the shared rename limit. */
export const MAX_BLOCK_NAME_LENGTH = 32

/** Maximum length for a Function version string. Global cap, sibling of
 * MAX_BLOCK_NAME_LENGTH; mirrors the backend `_versioning.MAX_VERSION_LENGTH`. */
export const MAX_VERSION_LENGTH = 32
