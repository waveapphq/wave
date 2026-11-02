# V-PROFILE-FIELDERR-FUNCTIONAL: field errors on the Create Profile modal

End-to-end proof that the Create Profile modal shows every reason that blocks
Create on the field that causes it, with the generic note under the button, and
that no profile field is ever required (FIELDERR-1, FIELDERR-2, FIELDERR-3,
K8SPROF-6; REQ-4.7.4, REQ-4.7.10). The Type used is database, whose port is its
one bounded field (1 to 65535, SQL-14).

## Prerequisites

- Backend and frontend running on the worker's stack ports.
- At least one environment: the create dialog refuses to open without one, so
  the spec calls `ensureEnvironment` first. No external service is needed.

## Steps

1. Run `./scripts/e2e-targeted-local.sh functional/profile-field-errors/v-profile-field-errors-functional.spec.ts`.
2. Name: open Create Profile, pick the database Type, then type in Name, clear
   it and press Tab to leave it; type a Name again.
3. Port: type a Name, then type `70000` into the port row, then `5432`, then
   clear the box. The input, its name field and its type select are measured
   before and after the message appears.
4. Empty profile: type only a Name, press Create, read the profile back with
   `GET /profiles/{id}`, reopen it from the Profiles list, press Cancel, and
   delete it.

## Validation

- **Name:** picking a Type shows no Name message. Typing, clearing and leaving
  Name shows `Name is required` under it and marks it invalid; typing a Name
  lifts the message.
- **Port out of range:** `70000` shows `port must be between 1 and 65535`
  under the port field at once, while the field still has focus, and marks the
  field invalid. Create is disabled and the note under it reads
  `Create is disabled: the settings have errors`.
- **The field never moves:** the port input, the row's name field and its type
  select keep their x and y; the message sits below the input and the row
  grows downward.
- **Fixed and cleared:** `5432` lifts the message and the note and enables
  Create; clearing the box shows no message and keeps Create enabled.
- **Nothing required:** a database profile with only a Name creates. The API
  returns it with type database, empty host, database, username, CA
  certificate and client certificate, a port of `null` (unset, never `0`), and
  the declared starting values `verify_ssl` true and `driver_options` `{}`.
  The password and client key read as empty or masked, as every secret field
  does. Reopened, it shows the port row as an empty Integer box, no field
  message and no note under Save.

## Isolation

- Every profile name carries a per-run unique suffix, the created profile is
  deleted in a `finally` and the spec asserts no profile of that name is left.
- The two tests that never press Create persist nothing.
