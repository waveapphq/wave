# V-MCP-LIST-*: the MCP listing tools

One spec per listing tool. Each spec seeds what it lists through the backend API, calls the tool
over the live MCP endpoint, and checks the answer against what the Tests page, Settings >
Environments or the `GET` routes show for the same entities (REQ-5.2.7.8).

| Spec | Tool | What it proves |
|---|---|---|
| `v-mcp-list-tests-functional.spec.ts` | `list_tests` | Rows hold the stored name, description, tags, version and last-run status, and the Tests page shows the same; `search` matches name or description in any case; `tag` filters; no match answers nothing; a tag sent as a list is refused |
| `v-mcp-list-blocks-functional.spec.ts` | `list_blocks` | One `{blocks: [...]}` object holds every Block the palette offers, with its kind; HTTP, If/Else and Variable Setter equal `get_block`; an unknown id is refused; an undeclared argument is refused with the error that names it |
| `v-mcp-list-environments-functional.spec.ts` | `list_environments` | The seeded environment's row matches Settings > Environments and `GET /environments/{id}`; an undeclared argument is refused with the error that names it; credentials keyed by an unknown environment id get the `UNKNOWN_ENVIRONMENT` finding and nothing is created |
| `v-mcp-list-executions-functional.spec.ts` | `list_executions` | Runs are newest first and match `GET /executions/{id}`; `status`, `entity_type` and `limit` filter; the MCP-started run reads `mcp:<client name>`; an unknown status or type and a limit of 0 are refused |
| `v-mcp-list-functions-functional.spec.ts` | `list_functions` | A Function published twice is one card of its latest version, matching `GET /functions`; the secret output default is masked; `search` filters; no match answers nothing; a search sent as a number is refused |
| `v-mcp-list-profiles-functional.spec.ts` | `list_profiles` | The seeded profile is listed with its `profile_type` and fields, the secret masked, as `GET /profiles/{id}` answers; an undeclared argument is refused with the error that names it; an unknown profile is refused by `update_profile` |
| `v-mcp-list-variables-functional.spec.ts` | `list_variables` | `system` and `global` list the seeded System variables by name with their declarations, the secret masked, as `GET /variables/system` answers; an unknown scope is refused |
| `v-mcp-get-block-functional.spec.ts` | `get_block` | Ping's Minimum replies carries `maximum_field: count`; the JSON Parser's and XML Parser's `queries` declare outputs while Output Mode is `individual`, and their `results` output shows only in `combined` mode; `list_blocks` serves the same entries |

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- The shared execution environment (`ensureEnvironment` creates it if absent)
- No external service
- `list-client.ts`: a one-shot MCP client that keeps every text item of an answer (a listing tool
  answers one item per row), run through the backend poetry env, plus the Test seeds the specs share

## Isolation on the shared stack

Every entity a spec makes is named `zz-mcp-<tool>-<n>` (System variables `zz_mcp_list_variables_<n>`,
since a variable name takes no hyphen). A spec deletes its own leftovers by that prefix before it
starts and everything it made after it ends, runs included. It never asserts that a list holds only
its rows: it reads the rows under its own prefix, or checks a property every row must have. System
variables are added next to whatever the shared store holds and removed one by one. The MCP listener
runs until-restart on a per-stack port and is reset in teardown.

## Validation

- **Rows, not keys:** each check reads the stored value of a row (a status after a real run, a version
  after a save, a masked secret) and compares it with the UI or the `GET` route for the same entity
- **Refusals:** a refused call is an error answer whose only text is
  `Error executing tool <tool>: <message>`, with the exact message the tool raises; a value of the
  wrong type gets the type error that names the argument
- **No output:** a filter that matches nothing answers no text item at all and no error
