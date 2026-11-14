# MCP Suites: the four Suite tools

One spec per MCP tool: `create_suite`, `update_suite`, `get_suite` and
`list_suites`. Each calls its tool over the live MCP endpoint and checks the
answer against what the backend stores, as `GET /suites/<id>` (and, for
`create_suite`, the Suites page) shows it.

| Spec | Tool |
|------|------|
| `v-mcp-create-suite-functional.spec.ts` | `create_suite` |
| `v-mcp-update-suite-functional.spec.ts` | `update_suite` |
| `v-mcp-get-suite-functional.spec.ts` | `get_suite` |
| `v-mcp-list-suites-functional.spec.ts` | `list_suites` |

## Prerequisites

- Backend and frontend running (standard functional-stack ports); no
  external service
- `fixture.json` - a one-Block Log Test, the member every seeded Suite holds
- `organize-tools.ts` - seeding, cleanup and answer checks shared with
  `../mcp-regressions/`, plus a one-shot client that keeps every row a
  listing tool sends (`callTool` keeps only the first)

## Isolation on the shared stack

Each spec names its entities `zz-mcp-<tool>-<n>` and seeds what it reads
through the backend API, never through MCP. Before and after each test it
deletes every Regression, Suite and Test whose name starts with its own
prefix. The MCP listener runs until-restart on a per-stack port and is reset
in teardown. The shared variables reveal is turned on only for one read of a
secret's stored value and turned off right after.

## Steps

1. Enable the MCP listener until-restart via `PUT /mcp/settings`
2. Seed the Tests (and, outside `create_suite`, the Suite) through
   `POST /tests` and `POST /suites`
3. Call the tool with good arguments, then with an unknown reference or a
   malformed value
4. Read the result back through `GET /suites/<id>`, `GET /suites/<id>/tests`,
   the `GET /suites` list and the Suites page

## Validation

- **Writes:** what the tool was given is exactly what is stored: name,
  description, tags, Test ids in the order given (a Test named by name is
  stored by its id) and typed variables, the secret masked as `********` and
  still holding its value when revealed
- **Non-destructive update:** omitted fields stay; `remove_tests` and
  `remove_variables` remove only what they name, a Test named by its id or
  its name; a secret the merge sends back masked keeps its stored value
- **Refusals:** a duplicate name, an unknown Test, a removal of a Test that is
  not a member and a bare variable value each answer their boolean false with
  the exact finding, and nothing changes or is created
- **Unknown reference:** `get_suite` and `update_suite` raise
  `Suite '<ref>' not found`
- **Listing:** one row per Suite, each matching the stored Suite; `search`
  matches name and description case-insensitively and no match sends no
  output
