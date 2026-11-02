/**
 * Control/Plugin Documentation Types
 *
 * Shared interfaces for version history, changelog, and metadata
 * used by the markdown-based documentation system.
 */

/**
 * Version entry with changelog and details.
 * Details are per-version to support version-specific documentation.
 */
export interface ControlVersion {
  /** Semantic version string (e.g., '1.0.0') */
  version: string
  /** Release date in ISO format */
  releaseDate: string
  /** Changelog entries for this version */
  changelog: string[]
  /** Detailed documentation for this version (markdown supported) */
  details: string
  /** Whether this version is deprecated */
  deprecated?: boolean
  /** Deprecation message if deprecated */
  deprecationMessage?: string
}

/**
 * Complete control metadata including versions and documentation.
 */
export interface ControlMetadata {
  /** Control ID (matches control-definitions.ts) */
  id: string
  /** Short description (one line) */
  description: string
  /** Version history (newest first) */
  versions: ControlVersion[]
}
