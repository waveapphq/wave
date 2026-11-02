# V-WORKBENCH-UNDO-REDO: Workbench Undo / Redo

Functional coverage for the post-state-baseline history model in
`workflow-store.ts`. Locks down the three reported bugs (click-twice off-by-one;
mutations skipping the history; drag never pushing) plus the save-bound floor.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- No fixtures required for tests 1-3 (they operate on a draft canvas).
- Test 4 imports a single-Log fixture inline via `POST /tests`.

## Steps

The spec runs four independent tests, each starting from a clean workbench
session:

1. **User 4-step scenario** - drop a Log block close to the start node so
   proximity auto-connect fires (2 history entries: add-node + add-edge),
   open the config modal, set message to `first` and Save (1 entry), set
   message to `second` and Save (1 entry). Click Undo 4 times - assert each
   click changes the canvas (msg revert, msg revert, edge gone, node gone).
   At the baseline, assert Undo is disabled. Click Redo 4 times - assert the
   canvas walks back to the fully configured `second` state.
2. **Drag undo / redo** - drag the Log node 120px right + 60px down. Click
   Undo - the node snaps back to its original position. Click Redo - the
   node returns to the dropped position. Position comparison uses the
   React Flow wrapper's `style.transform` (canvas-coords) so it is
   invariant under viewport pan or zoom.
3. **Note text undo / redo** - drop a Note, double-click to enter edit
   mode, type "hello world" and accept. Click Undo - the text reverts.
   Click Redo - the text restores.
4. **Save floors the stack** - import a single-Log fixture, navigate via
   `?editTest=...`, make 2 config-modal edits, click toolbar Save. Assert
   Undo and Redo are both disabled (the save seeded a fresh baseline). Make
   one more edit, Undo - returns to the saved baseline, Undo disabled again.

## Validation

- **Test 1**: After 4 undos, `workflow-node-*` count is 0 and
  `.react-flow__edge:not([data-id="ghost-edge"])` count is 0;
  `toolbar-undo-button` carries `disabled`. After the following 4 redos,
  the Log node is back, the auto-connect edge is back, and the message
  field reads `second`. Crucially, **every undo / redo click changes the
  canvas** - if any click is a silent no-op (the click-twice symptom),
  the matching `expect(...).toHaveCount(...)` / `readMessageValue`
  assertion fails immediately. The ghost Start->onboarding edge is
  excluded from the edge count because it is a UI hint, not a user edge.
- **Test 2**: Polled `style.transform` equality against the pre-drag and
  post-drag transforms. Bounding-box comparisons were rejected because
  they shift under viewport drift the drag may trigger.
- **Test 3**: After Undo the `note-text-display` is no longer `hello world`;
  after Redo it is `hello world` again.
- **Test 4**: `toolbar-save-button` becomes disabled after the save fires.
  `toolbar-undo-button` and `toolbar-redo-button` are both disabled
  immediately after save and after a final round-trip Undo back to the
  saved baseline.
