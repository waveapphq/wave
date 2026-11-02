# V-PLUGIN-HTTP: the HTTP Block against real servers

End-to-end proof for the HTTP Client Block: every method, every parameter and
every output over the published `http-echo` service; the reworked auth, body
and trace surfaces; artifact containment on an upload source; and - in
`v-plugin-http-filepath.spec.ts` - where a file-mode download lands and what the
`body` output then holds. `v-http-remote-proxy-choice-functional.spec.ts` covers
what the Proxy choice of a block holds after a move into and out of a Remote
Execution body.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- The real-service stack must be running (see `tests/e2e/services/README.md`).
  `v-plugin-http-execution.spec.ts` and `v-plugin-http-filepath.spec.ts` drive
  the published `http-echo` listener through `HTTP_TARGET_HOST` +
  `HTTP_MAIN_PORT`; never hardcode the endpoint.
  `v-plugin-http-rework-functional.spec.ts` and
  `v-plugin-http-artifact-containment.spec.ts` also stand up an in-spec
  recording server, because their byte-ordering and received-bytes proofs are per-spec
  state a shared service cannot hold.
- `fixture.json` - the 55-node parameter and method matrix, plus the fail cases
  wrapped in Try/Catch
- `rework-fixture.json` - the reworked auth sections, body modes, the
  literal-vs-expression wire matrix, download, cap and trace
- `artifact-traversal.fixture.json` - a marker file planted outside the run's
  artifacts and an upload pointed at it through an `artifact://` reference
  whose `..` segments climb out of the artifacts directory
- `v-plugin-http-filepath.spec.ts` builds its workflow in TypeScript through the
  node factories in `helpers/k8s-nodes.ts`; it has no checked-in fixture
- The content-type test of `v-plugin-http-execution.spec.ts` builds its own Test
  the same way and uploads one `.yaml` and one `.xlsx` file to that Test's Test
  Data; both go up as `application/octet-stream`
- `v-http-remote-proxy-choice-functional.spec.ts` seeds SSH Session Open, a
  Remote Execution block and, linked from its `then` dot, one HTTP block with
  Proxy stored as Off; nothing is run, so no service is contacted

## Isolation on the shared stack

Every spec imports or creates its own uniquely named Test and asserts only on
that run's console, node statuses, session variables and session artifacts. The
file-path spec additionally creates its own payload Test, uploads its own data
file, writes outside the artifacts folder only under
`/tmp/wave-e2e-httpfp-<suffix>/`, removes that folder with its own last Block,
and deletes both Tests in teardown. No server state is reset.

## Steps

1. Import or build the workflow through `POST /tests` and confirm
   `POST /tests/{id}/validate` reports zero errors
2. Open the Test in the workbench, pick the shared environment, press Run
3. Read the console once the session reaches a terminal state, gated on the
   run's own bookend marker
4. Read the outputs the run bound into session variables, and the files it wrote
   through `GET /workbench/session/artifacts`

Proxy choice spec (no run):

1. Open the seeded Test, pick the shared environment, open the HTTP block and
   expand Connection
2. Move the block into the body: right-click its incoming link, Delete, then
   drag a link from the Remote Execution block's `body` dot to the block's input
3. Open the block: first case, change the name and press Save; second case,
   press Cancel, then Save the Test and read it over `GET /tests/<id>`
4. Move the block back out: delete the link again and drag one from the `then`
   dot
5. Open the block, then Save the Test and read it over `GET /tests/<id>`

## Validation

- **Methods and parameters:** every success node ends `success` and logs its
  captured outputs; every fail node is caught and logs the expected message
- **Rework surfaces:** auth composes and masks, the generated Content-Type wins,
  a manual Content-Length is refused before send, and the trace reports its hops
- **Null query entry:** a query entry given `None` is sent as empty text
  (`z=`), and so is an entry whose expression gives `''`
- **Artifact parent segments:** an `artifact://` upload source whose `..`
  segments climb out of the artifacts directory is followed: the node succeeds
  and the server receives exactly the planted bytes
- **Explicit File Path:** two downloads to the same path leave one artifact
  holding the second response, with no numbered sibling, and `body` is
  `artifact://downloads/report.json`
- **Empty File Path:** the name comes from Content-Disposition when the response
  declares one and from the URL basename otherwise; a repeat download takes the
  next free numbered name, so both artifacts exist
- **Outside the artifacts folder:** `body` is the absolute path, File I/O stats
  on that path reports the same size and sha256 the Block returned, and the run's
  artifacts never list the file
- **Session outcome:** `passed`, with the run's bookend marker closing the
  console
- **File body, Type Auto:** http-echo `/echo` answers with the request it
  received: the `.yaml` file arrived with Content-Type `application/yaml`, the
  `.xlsx` file with
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, each as a
  POST whose body is the uploaded file's content
- **Proxy row inside the body:** the block shows the R badge; the row is at 50
  percent opacity with the not-allowed cursor, disabled, and reads "Remote
  host's settings"
- **Saved inside the body:** the Test saved there holds no `proxy_mode`, the
  new name and the link from the `body` dot; moved back out, the row starts on
  its default and reads "WAVE setting", and the Test saved then still holds no
  `proxy_mode`; the next dialog Save after another field changes stores
  `wave-setting` (FIELD-8, SHELL-10) and the run uses WAVE setting
- **Not saved inside the body:** the Test saved with the block inside the body
  holds `proxy_mode: off` and the link from the `body` dot; moved back out, the
  row still reads "Off" and the Test saved again holds `proxy_mode: off` and the
  link from the `then` dot
