# V-FN-PUBLISH-VERSION-GATE (functional)

Regression guards for the edit-mode publish dialog's version handling:

- **Bump target re-sync** - the bump target re-syncs to the lowest ALLOWED level once
  allowed-bumps resolves, and the blocked levels are disabled (no misleading
  PATCH chip, no server round-trip to discover the rejection).
- **Blocked-bump info icon** - the blocked-bump `(i)` info icon is hoverable with its own
  `cursor-help` cursor and carries no native `title` (the reason rides the
  shared `ConditionalTooltip`); a renamed input's blocked reason reads
  "renamed", not "removed".
- **Strict semver** - both the version-dropdown Custom field and the from-Local publish
  dialog reject `1.0.0-01` (one strict `isValidSemver` helper).

## Prerequisites

- Backend with `WAVE_ADMIN_ALLOWED=true` for the seed endpoints.
- Shared canvas helpers: `clickNodeKebabItem`, `waitForCanvasLoad`.

## Seeding notes

- The edit-mode tests seed the Shared instance ALREADY in edit mode with a
  draft that RENAMES the source input (`msg` -> `message`). A rename is a
  breaking change, so PATCH + MINOR are blocked and only MAJOR (v2.0.0) is
  allowed - which is exactly what exercises the re-sync, the disabled options,
  and the "renamed" wording.
- The "renamed" wording is asserted directly against
  `POST /functions/{id}/validate-bumps` (the BE half of the blocked-bump guard).
- The from-Local strict-semver test seeds a local Function and opens the `PublishDialog`.

## Validation

- Each `test()` carries an inline `// regression guard: ...` comment naming the
  issue. Library entries are name-stamped so parallel workers never collide.

# V-FN-PUBLISH-BUMP-DEFAULT-KIND (functional)

Spec: `v-fn-publish-bump-default-kind-functional.spec.ts`. A change to a parameter's default or to
an output's Kind is a minor change, so the edit-mode publish dialog suggests 1.1.0 with the minor
chip, never a patch (REQ-3.1.2.2, REQ-3.1.2.8).

## Prerequisites

- Seeds (API): a `zz-` library Function at 1.0.0 with the optional string input `msg` (default
  `a`) read by a body Log, or with the string output `res` (Literal, default `x`), and a `zz-` Test
  holding its instance already in edit mode with a draft equal to 1.0.0.

## Steps

1. Drill into the instance and make one draft change:
   - `msg` default `a` → `b` in its Edit window (row pencil);
   - `msg` default set to null with Set to null in its Edit window;
   - `res` default `x` → `y` in its Edit window;
   - `res` Kind changed to Expression in its Edit window (Change kind).
2. Pop to the Test and open kebab → Publish.

## Validation

- Each change: the version trigger shows `1.1.0` with `bump-chip-minor`.
