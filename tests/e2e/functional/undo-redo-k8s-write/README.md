# V-UNDO-K8S-WRITE: Change History over the K8s Write Blocks

Functional coverage for the change history (REQ-5.2.1.24) as it applies to the
four K8s write Blocks - Apply, Delete, Scale and Rollout - and to the gated
parameter shapes they introduce (REQ-5.1.1, REQ-3.4.1.5). Undo and redo have to
carry a mode row, the rows that mode reveals, and the values those rows held.

The generic history model itself (click-twice, drag, note text, the save floor)
lives in `workbench-undo-redo/`; drill reconciliation, lifecycle pick-out surgery
and execution gating live in `undo-redo-drill/`, `undo-redo-lifecycle/` and
`undo-redo-integrity/`. This suite adds only the write-Block axis.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- No cluster and no service stack: nothing here runs a workflow.
- No pre-existing fixtures. KUR-a works on a draft canvas; every other test
  imports its own Test through `helpers/fixture-import.ts`, built by the node
  factories in `helpers/k8s-nodes.ts`.

## Seeded Test

One chain, `start -> K8s Connect -> K8s Apply -> K8s Delete -> K8s Scale ->
K8s Rollout`, with every required parameter filled so the import passes
validation with zero errors and every sheet opens save-able. The Session is an
expression on a secret Test variable the Connect Block binds. Only the Apply
Block's values vary per test; Delete, Scale and Rollout are seeded the same way
every time.

## Case ids

| Id | What it holds the product to |
|---|---|
| KUR-a | Each of the four write Blocks survives a palette drop, an undo and a redo: it leaves the canvas last-first and comes back in drop order with its own icon and name, and the stack floors on the empty canvas |
| KUR-b | Undoing an Apply Define with switch restores Manifest mode and the manifest it showed, with Kind and Name gone; redo returns Form with the typed Name (K8SWRITE-1) |
| KUR-c | Undoing an Apply Kind switch restores ConfigMap with its own Data map intact; redo restores Secret with its own. Neither Data field ever reads the other's keys (K8SWRITE-3) |
| KUR-d | Undoing a Job from switch brings Image and Command back with the values the switch hid; redo returns CronJob Name (HTTP-8) |
| KUR-e | Undoing a Delete by switch restores Name and the Ignore not found tick the switch cleared; redo returns the Label Selector (K8SWRITE-5) |
| KUR-f | Undoing a Rollout Operation switch restores the operation, the To revision row and the Status output that operation offers, one entry per save (K8SWRITE-7, K8SWRITE-8) |
| KUR-g | Deleting a configured Scale Block and undoing brings back the Block, its two chain edges and its configuration, and a second undo walks back to the imported replica count |

## Steps

1. **Drop round trip (KUR-a)** - on a clean draft canvas, drag all four write
   Blocks from the palette, spread far enough apart that none lands in
   auto-connect reach (asserted: zero edges). Undo four times, last-first, then
   redo four times. Identity is read off the Block's own icon and type label.
2. **Apply Define with (KUR-b)** - open the seeded Manifest-mode Apply, switch
   to Form, type a Name, Save. Undo, reopen: Manifest is back with its text and
   the form rows are gone. Redo, reopen: Form with Kind ConfigMap and the Name.
3. **Apply Kind and the two Data fields (KUR-c)** - the seeded ConfigMap carries
   one Data entry. Switch Kind to Secret, add a different entry to the Secret's
   own Data, Save. Undo, reopen: ConfigMap, no Secret rows, and the ConfigMap
   entry read back key and value. Redo, reopen: Secret, no ConfigMap Data row,
   and the Secret entry read back key and value.
4. **Apply Job from (KUR-d)** - the seeded Job runs an Image with a Command.
   Switch to CronJob, name the CronJob, Save. Undo, reopen: Image and Command
   are back with their values and CronJob Name is gone. Redo returns CronJob.
5. **Delete by (KUR-e)** - the seeded Delete targets a Name with Ignore not
   found ticked. Switch to Selector, type a Label Selector, Save. Undo, reopen:
   Name is back, the tick is back, the selector row is gone.
6. **Rollout Operation (KUR-f)** - two saves walk Restart to Status to Undo with
   a revision. Undo twice, reopen at each step: the operation, the To revision
   row and the Status output all follow. Undo floors the stack; two redos
   return.
7. **Delete a configured Block (KUR-g)** - configure Scale to a new replica
   count, Save, then delete the Block through its kebab. Undo restores the
   Block, the two edges the delete took with it, and the saved replica count.

## Validation

- Mode state is read off the enum trigger's text, never off stored values.
- A hidden row is asserted with `toHaveCount(0)`: gating unmounts the row, so
  `not.toBeVisible()` would pass for the wrong reason.
- A Data map is proven by opening its editor and reading key and value back,
  which is the only assertion that can catch one field's value appearing under
  the other's name.
- Every undo chain ends on `toolbar-undo-button` disabled, which is what proves
  a config-sheet Save is exactly one history entry.
- Node identity after a redo is the Block's `data-icon` plus its type label, so
  a Block that came back as the wrong kind fails.
