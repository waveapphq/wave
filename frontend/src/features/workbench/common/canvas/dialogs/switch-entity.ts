/**
 * Derive the switch-confirm dialog's entity label from the open workbench state.
 * A library Function in edit mode (`functionViewMode`) is named as a function;
 * otherwise the open Test (or untitled draft) is named.
 */
export function deriveSwitchEntity(
  functionViewMode: { name?: string } | null,
  editingTestName: string | null,
): { entityKind: 'test' | 'function'; currentName: string | null } {
  if (functionViewMode) {
    return { entityKind: 'function', currentName: functionViewMode.name ?? null }
  }
  return { entityKind: 'test', currentName: editingTestName }
}
