# V-VMGR-PANEL: Variable Manager Demo Variables

Test definition consumed by `tests/e2e/visual/canvas/v-vmgr-01.spec.ts`
and `v-vmgr-02.spec.ts`. Carries every Variable Manager row state:
each of the 7 variable types, an Output-bound row (`retry_count`,
receiving the For loop's `index` output - integer-to-integer per the
backend's `INVALID_OUTPUT_BINDING_TYPE` validator), an expression row
(`api_url`), and a secret row (`password`).

## Prerequisites

None - the spec imports this fixture via `POST /tests` per V-VMGR-01 / V-VMGR-02
test runners, then navigates `/workbench?editTest={id}`. No seed script.

## Steps

The visual specs do not run the workflow. They only assert the panel's
idle-mode rendering: header, toolbar, action cluster, type colors,
flag badges, secret masking, and the idle eye-disabled state.

## Validation

- **Header**: uppercase `VARIABLE MANAGER` title plus `+ Add` button. No count badge.
- **Toolbar**: filter input with placeholder `Filter variables...` and sort
  dropdown defaulting to `Name A-Z`.
- **Rows**: 9 rows for `user_name`, `retry_count`, `timeout_secs`,
  `debug_log`, `items`, `headers`, `results`, `api_url`, `password`.
- **Type badge**: rightmost on every row.
- **Type color palette**: sky / violet / pink / orange / amber / emerald / blue.
- **Expression row** (`api_url`): `{x}` flag badge, expression text shown
  in idle mode (not the `<not evaluated yet>` placeholder).
- **Secret row** (`password`): `SECRET` flag badge, value masked to
  `********`, eye disabled with `aria-disabled='true'` plus opacity-50
  and cursor-not-allowed (visual disabled policy).
- **OUT row** (`retry_count`): `OUT` flag badge.
- **Idle eye**: every non-secret eye is `aria-disabled='true'` with
  opacity-50 and cursor-not-allowed.
