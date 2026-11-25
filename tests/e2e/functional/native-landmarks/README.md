# V-NATIVE-LANDMARKS: Native Elements on the Variable Manager and the Console

Prove in a real browser that the variable manager rows, the "No variables match
filter" line and the console entries are the native elements `fieldset`,
`output` and `article`, keep the roles group, status and article with their
names, and keep the sizes listed under Validation.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- No external service from `tests/e2e/services/`
- `fixture.json` - a Var Setter writes `nl_alpha`, `nl_count` and a variable
  whose name is far wider than the panel; three Log Blocks read them back at
  INFO, WARN and INFO

## Isolation on the shared stack

The spec imports its own Test under a unique name through `POST /tests` in
`test.beforeAll`, deletes it in `test.afterAll`, and changes no global state.

## Steps

1. Import the fixture via `POST /tests` and confirm `POST /tests/{id}/validate`
   reports zero errors
2. Open the Test in the workbench and expand the variable manager
3. Read the three rows, then filter on a name no variable has and read the no
   match line; clear the filter
4. Pick the shared environment, press Run, wait for the closing console line
5. Read the rows, the no match line and every console entry again
6. Reload and read the rows and the no match line
7. Clear the settled workbench session, start a tracked run of the Test through
   `POST /executions`, wait for it to pass, open its history page and read the
   rows, the no match line and every console entry (a Workbench run has no
   history page)

## Validation

- **Rows:** each is a `fieldset` with no `role` attribute, found by role group
  and name `Variable <name>`, 63px high and as wide as the panel within 1px;
  the wide name truncates and the panel does not scroll sideways
- **No match line:** an `output` with no `role` attribute, found by role
  status, as wide as the panel and 84px high within 1px
- **Run:** outcome passed; the console carries
  `[INFO] native-landmarks-alpha=alpha-set`, `[WARN] native-landmarks-count=7`
  and `[INFO] native-landmarks-wide=wide-set`; the rows show `alpha-set`, `7`
  and `wide-set`
- **Console entries:** each is an `article` with no `role` attribute, as wide
  as its list slot within 1px; the three Log Block entries are found by role
  article and name `<level>: <message>`, with height round(font size x 2.2) and
  line height round(font size x 1.5) within 1px
- **Tracked run:** outcome passed
- **Views:** edit view before and after the run, after a reload, and the
  read-only history page of the tracked run
