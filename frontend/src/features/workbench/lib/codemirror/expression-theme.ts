/**
 * Expression Theme Module
 *
 * Shared CodeMirror 6 theme definitions used by both the inline expression
 * editor (ExpressionInput) and the modal expression editor for consistent
 * visual styling.
 *
 * The monolithic inputTheme is split into three composable pieces:
 * - expressionEditorTheme: Base editor chrome (font, cursor, selection, layout)
 * - expressionHighlightTheme: Expression highlighting and validation tooltip styles
 * - autocompleteDropdownTheme: Autocomplete popup, scrollbar, and item styles
 *
 * The autocomplete footer hint (e.g. "Esc - close | Ctrl+E - full editor")
 * is intentionally omitted here - each editor adds its own footer via a
 * separate small theme extension since the text varies by context.
 */

import { EditorView } from '@codemirror/view'

/**
 * Base editor styles: font, focus outline, scroller, content padding,
 * line padding, selection background, and cursor color.
 */
export const expressionEditorTheme = EditorView.theme({
  '&': {
    fontSize: '14px',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
    maxWidth: '100%',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    overflow: 'auto hidden',
    lineHeight: '1.5',
  },
  '.cm-content': {
    padding: '8px 12px',
    caretColor: 'hsl(var(--foreground))',
    whiteSpace: 'pre',
  },
  '.cm-line': {
    padding: '0',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    background: 'rgba(255, 255, 255, 0.15)',
  },
  '.cm-cursor': {
    borderLeftColor: '#fff',
  },
})

/** The wavy underlines of the validation marks, for every editor that draws them. */
export const validationUnderlineStyles = {
  // Unknown variables - amber wavy underline
  '.cm-unknown-variable': {
    textDecoration: 'wavy underline',
    textDecorationColor: '#f59e0b', // amber-500
    textUnderlineOffset: '2px',
  },
  // Invalid/blocked functions - red wavy underline
  '.cm-invalid-function': {
    textDecoration: 'wavy underline',
    textDecorationColor: '#ef4444', // red-500
    textUnderlineOffset: '2px',
  },
}

/** A script body is code, not a value, so it reads in the normal text color (PYRUN-13, SQL-10). */
export const scriptEditorTheme = EditorView.theme({
  '.cm-content': { caretColor: 'hsl(var(--foreground))' },
  // On the line, not the content: the string body paints .cm-content as a value and inheritance would carry it.
  '.cm-line': { color: 'hsl(var(--foreground))' },
  '.cm-cursor': { borderLeftColor: 'hsl(var(--foreground))' },
  ...validationUnderlineStyles,
})

/**
 * Expression highlighting decoration styles and validation tooltip styles.
 * Provides visual feedback for recognized expressions, unknown variables,
 * invalid/blocked functions, and hover tooltips.
 */
export const expressionHighlightTheme = EditorView.theme({
  // Expression highlighting - override nested syntax tokens (JSON/YAML/XML)
  '.cm-expression': {
    color: '#22d3ee !important', // cyan-400
  },
  '.cm-expression span': {
    color: 'inherit !important',
  },
  ...validationUnderlineStyles,
  // Validation hover tooltips
  '.cm-validation-tooltip': {
    backgroundColor: '#1c1c1c !important',
    border: '1px solid #333 !important',
    borderRadius: '4px !important',
    padding: '6px 10px !important',
    fontSize: '13px !important',
    maxWidth: '300px !important',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5) !important',
  },
  '.cm-validation-tooltip-amber': {
    borderColor: '#f59e0b !important',
    borderLeftWidth: '3px !important',
  },
  '.cm-validation-tooltip-red': {
    borderColor: '#ef4444 !important',
    borderLeftWidth: '3px !important',
  },
  '.cm-validation-tooltip-icon': {
    marginRight: '6px',
  },
  '.cm-validation-tooltip-message': {
    color: '#e5e5e5',
  },
  '.cm-validation-tooltip-suggestion': {
    color: '#22d3ee', // cyan-400
    fontWeight: '500',
  },
})

/**
 * Autocomplete dropdown styling: tooltip container, scrollable list,
 * webkit scrollbar, list items, completion labels, section headers.
 *
 * The footer hint (::after pseudo-element) is intentionally omitted.
 * Each editor should add its own context-specific footer text via a
 * separate EditorView.theme() extension.
 */
export const autocompleteDropdownTheme = EditorView.theme({
  '.cm-tooltip': {
    zIndex: '99999 !important',
    pointerEvents: 'auto !important',
  },
  // The list is dark in both themes, so its rows never inherit the page's text color.
  '.cm-tooltip-autocomplete': {
    backgroundColor: '#1c1c1c !important',
    color: '#e5e5e5 !important',
    border: '1px solid #333 !important',
    borderRadius: '6px !important',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5) !important',
    pointerEvents: 'auto !important',
    display: 'flex !important',
    flexDirection: 'column !important',
    overflow: 'visible !important',
  },
  // Scrollable list container
  '.cm-tooltip-autocomplete > ul': {
    maxHeight: '200px !important',
    overflowY: 'scroll !important',
    overflowX: 'hidden !important',
    pointerEvents: 'auto !important',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    fontSize: '13px',
    margin: '0 !important',
    padding: '4px 0 !important',
    scrollbarWidth: 'thin',
    scrollbarColor: '#444 #1c1c1c',
    touchAction: 'pan-y',
    overscrollBehavior: 'contain',
  },
  // Webkit scrollbar styling for Chrome/Safari
  '.cm-tooltip-autocomplete > ul::-webkit-scrollbar': {
    width: '8px',
  },
  '.cm-tooltip-autocomplete > ul::-webkit-scrollbar-track': {
    background: '#1c1c1c',
  },
  '.cm-tooltip-autocomplete > ul::-webkit-scrollbar-thumb': {
    background: '#444',
    borderRadius: '4px',
  },
  '.cm-tooltip-autocomplete > ul::-webkit-scrollbar-thumb:hover': {
    background: '#555',
  },
  '.cm-tooltip-autocomplete li': {
    padding: '6px 10px !important',
    cursor: 'pointer !important',
    pointerEvents: 'auto !important',
  },
  // Real completion items (those carrying a label span): flex layout so the
  // label can truncate while the type detail stays visible. Section headers
  // (no .cm-completionLabel child) are left alone.
  '.cm-tooltip-autocomplete li:has(.cm-completionLabel)': {
    display: 'flex !important',
    alignItems: 'center !important',
    gap: '12px !important',
    minWidth: '0 !important',
  },
  '.cm-tooltip-autocomplete li[aria-selected]': {
    backgroundColor: '#2d2d2d !important',
    color: '#fff !important',
  },
  '.cm-tooltip-autocomplete li:hover': {
    backgroundColor: '#252525 !important',
  },
  '.cm-completionLabel': {
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    flex: '1 !important',
    minWidth: '0 !important',
    whiteSpace: 'nowrap !important',
    overflow: 'hidden !important',
    textOverflow: 'ellipsis !important',
  },
  '.cm-completionDetail': {
    marginLeft: '0 !important',
    flexShrink: '0 !important',
    opacity: '0.6',
    fontSize: '12px',
  },
  // Info panel (documentation tooltip shown beside the selected completion)
  '.cm-completionInfo': {
    backgroundColor: '#1c1c1c !important',
    border: '1px solid #333 !important',
    borderRadius: '6px !important',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5) !important',
    padding: '8px 12px !important',
    fontSize: '13px !important',
    color: '#d4d4d4 !important',
    maxWidth: '400px !important',
    maxHeight: '200px !important',
    overflowY: 'auto !important',
    lineHeight: '1.5 !important',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  // Section headers
  '.cm-completionSection': {
    padding: '4px 10px',
    fontSize: '11px',
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    borderBottom: '1px solid #333',
    backgroundColor: '#1a1a1a',
  },
})

/** Collapses the <div> CodeMirror appends to <body> for a body-parented tooltip. */
// It carries the editor's theme classes but is not .cm-editor, so an editor
// height rule would otherwise make it a full-viewport block in the page's flow.
export const tooltipHostReset = EditorView.theme({
  '&:not(.cm-editor)': {
    height: '0 !important',
    minHeight: '0 !important',
    background: 'transparent !important',
    border: 'none !important',
  },
})
