# V-VAR-UNUSED-BADGE-02: Amber Unused Badge

Verify the Unused badge on every kind of Variable Manager row is amber, in the same tone as the
run-state badge of a Skipped block, and keeps its tooltip (VMGR-105). Spec:
`tests/e2e/visual/canvas/v-var-unused-badge-02.spec.ts`.

## Prerequisites

None - the spec clears the workbench session, opens the empty draft at `/workbench` and builds
everything through the UI. No API seed.

## Steps

1. Drop a Log on the canvas and Skip it from its context menu: its run-state badge is the reference.
2. Create a Test variable `plain_var` that nothing reads.
3. Drop a Local Function, open it, and add an input `in_p`, an output `out_p` and a local `loc_v`.
4. Hover each Unused badge.

## Validation

- **Reference:** the Skipped Log's badge reads `SKIP` (`data-state="skip"`) on a translucent amber tint
- **Tone:** each Unused badge's text color and background equal the reference badge's, on the variable,
  the input, the output and the local
- **Text:** each badge reads `Unused`
- **Tooltip:** exactly "Not referenced by any block or other variable.", no browser `title`
