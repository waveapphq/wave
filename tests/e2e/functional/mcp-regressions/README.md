# MCP Regressions: the four Regression tools

One spec per MCP tool: `create_regression`, `update_regression`,
`get_regression` and `list_regressions`. Each calls its tool over the live MCP
endpoint and checks the answer against what the backend stores, as
`GET /regressions/<id>` (and, for `create_regression`, the Regressions page)
shows it.

| Spec | Tool |
|------|------|
| `v-mcp-create-regression-functional.spec.ts` | `create_regression` |
| `v-mcp-update-regression-functional.spec.ts` | `update_regression` |
| `v-mcp-get-regression-functional.spec.ts` | `get_regression` |
| `v-mcp-list-regressions-functional.spec.ts` | `list_regressions` |

## Prerequisites

- Backend and frontend running (standard functional-stack ports); no
  external service
- `../mcp-suites/organize-tools.ts` and `../mcp-suites/fixture.json` - the
  seeding, cleanup and answer checks the Suite specs use, and the one-Block
  Log Test the member Suites of `create_regression` hold

## Isolation on the shared stack

Each spec names its entities `zz-mcp-<tool>-<n>` and seeds what it reads
through the backend API, never through MCP. Before and after each test it
deletes every Regression, Suite and Test whose name starts with its own
prefix. The MCP listener runs until-restart on a per-stack port and is reset
in teardown. The shared variables reveal is turned on only for one read of a
secret's stored value and turned off right after.

## Steps

1. Enable the MCP listener until-restart via `PUT /mcp/settings`
2. Seed the Suites (and, outside `create_regression`, the Regression) through
   `POST /suites` and `POST /regressions`
3. Call the tool with good arguments, then with an unknown reference or a
   malformed value
4. Read the result back through `GET /regressions/<id>`,
   `GET /regressions/<id>/suites`, the `GET /regressions` list and the
   Regressions page

## Validation

- **Writes:** what the tool was given is exactly what is stored: name,
  description, tags, Suite ids in the order given (a Suite named by name is
  stored by its id) and typed variables, the secret masked as `********` and
  still holding its value when revealed
- **Non-destructive update:** omitted fields stay; `remove_suites` and
  `remove_variables` remove only what they name, a Suite named by its id or
  its name; a secret the merge sends back masked keeps its stored value
- **Refusals:** a duplicate name, an unknown Suite, a removal of a Suite that
  is not a member and a bare variable value each answer their boolean false
  with the exact finding, and nothing changes or is created
- **Unknown reference:** `get_regression` and `update_regression` raise
  `Regression '<ref>' not found`
- **Listing:** one row per Regression, each the row the `GET /regressions`
  list holds; `search` matches name and description case-insensitively and no
  match sends no output
