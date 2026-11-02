/** The run seed of one Function instance: its node-id path from the root canvas and its variables (REQ-3.2.1.6). */
export interface FunctionVariablesSeed {
  function_path: string[]
  variables: Record<string, unknown>
}
