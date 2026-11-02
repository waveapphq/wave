/**
 * Tree-sitter WASM Initialization Module
 *
 * Provides lazy initialization of tree-sitter runtime and Python grammar.
 * Implements caching for efficient subsequent validations.
 */

import Parser from 'web-tree-sitter'

// ============================================
// Types
// ============================================

/**
 * Tree-sitter parser interface wrapping the web-tree-sitter Parser.
 * Provides a simplified interface for parsing Python expressions.
 */
export interface TreeSitterParser {
  /**
   * Parse a Python expression and return the syntax tree.
   * @param input The Python expression to parse
   * @returns The parsed syntax tree
   */
  parse(input: string): Parser.Tree
}

/**
 * Custom error class for tree-sitter initialization failures.
 */
export class TreeSitterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TreeSitterError'
  }
}

// ============================================
// Module State
// ============================================

let parser: Parser | null = null
let language: Parser.Language | null = null
let initializationPromise: Promise<TreeSitterParser> | null = null
let cachedWrapper: TreeSitterParser | null = null

// ============================================
// Public API
// ============================================

/**
 * Initialize tree-sitter WASM runtime and load Python language grammar.
 * Returns a cached parser on subsequent calls (lazy loading).
 *
 * @throws TreeSitterError if WASM loading fails
 */
export async function initializeTreeSitter(): Promise<TreeSitterParser> {
  // Return cached wrapper if available
  if (parser && language && cachedWrapper) {
    return cachedWrapper
  }

  // Return existing initialization promise to prevent concurrent loads
  if (initializationPromise) {
    return initializationPromise
  }

  // Start new initialization
  initializationPromise = doInitialize()

  try {
    return await initializationPromise
  /* v8 ignore next 5 - COV-ERR-002: Error recovery path when WASM initialization fails */
  } catch (error) {
    // Reset promise on failure so retry is possible
    initializationPromise = null
    throw error
  }
}

/**
 * Get the current parser instance, or null if not initialized.
 */
export function getParser(): TreeSitterParser | null {
  if (!parser || !language || !cachedWrapper) {
    return null
  }
  return cachedWrapper
}

/**
 * Check if tree-sitter is initialized.
 */
export function isInitialized(): boolean {
  return parser !== null && language !== null
}

/**
 * Reset the parser state. Used primarily for testing.
 */
export function resetParser(): void {
  if (parser) {
    parser.delete()
  }
  parser = null
  language = null
  initializationPromise = null
  cachedWrapper = null
}

// ============================================
// Internal Implementation
// ============================================

/**
 * Detect if we're running in a test environment (vitest/jsdom).
 */
function isTestEnvironment(): boolean {
  // Check for vitest environment variable
  if (typeof process !== 'undefined' && process.env?.VITEST) {
    return true
  /* v8 ignore next - COV-ENV-004: Closing brace branch of environment check */
  }
  /* v8 ignore next 5 - COV-ENV-001: jsdom check only runs when VITEST env var is not set */
  if (typeof navigator !== 'undefined' && navigator.userAgent?.includes('jsdom')) {
    return true
  }
  return false
}

/**
 * Detect if we're running in a real browser environment.
 */
function isBrowser(): boolean {
  return (
    globalThis.window?.location !== undefined &&
    globalThis.window.location.protocol !== '' &&
    !isTestEnvironment()
  )
}

/**
 * Perform the actual initialization.
 */
async function doInitialize(): Promise<TreeSitterParser> {
  try {
    // Initialize the tree-sitter WASM runtime
    // Configure locateFile to find WASM files in the correct location
    await Parser.init({
      locateFile(scriptName: string) {
        /* v8 ignore next 4 - COV-ENV-002: Browser path only runs in real browser, not jsdom */
        if (isBrowser()) {
          return `/wasm/${scriptName}`
        }
        // In test/Node.js environments, use relative path from cwd
        return `./public/wasm/${scriptName}`
      },
    })

    // Create parser instance
    parser = new Parser()

    // Load Python language grammar
    /* v8 ignore next 3 - COV-ENV-003: Browser path only runs in real browser */
    const pythonWasmPath = isBrowser()
      ? '/wasm/tree-sitter-python.wasm'
      : './public/wasm/tree-sitter-python.wasm'

    language = await Parser.Language.load(pythonWasmPath)
    parser.setLanguage(language)

    cachedWrapper = createParserWrapper(parser)
    return cachedWrapper
  /* v8 ignore start - COV-ERR-001: WASM load failure path cannot be triggered in tests */
  } catch (error) {
    // Clean up on failure
    if (parser) {
      parser.delete()
      parser = null
    }
    language = null

    const message = error instanceof Error ? error.message : String(error)
    throw new TreeSitterError(`Tree-sitter failed to load: ${message}`)
  }
  /* v8 ignore stop */
}

/**
 * Create a wrapper around the Parser that exposes our TreeSitterParser interface.
 */
function createParserWrapper(p: Parser): TreeSitterParser {
  return {
    parse(input: string): Parser.Tree {
      return p.parse(input)
    },
  }
}
