# V-REQUEST-LOGGING-FUNCTIONAL: a failed request in the server log

`v-request-logging-functional.spec.ts`: every request has its line in the server log, a failed one
included, and the request id a response carries is the id its log lines sit under
(REQ-5.2.3.4, REQ-5.2.3.5).

`v-log-safe-values-functional.spec.ts`: a value a request sends keeps its server log entry on
one line, described in its own section below (REQ-6.4.1, REQ-5.2.3.5).

## Prerequisites

- None on the stack. Each test starts its own backend with `spawnBackend`
  (`helpers/spawn-backend.ts`) on a free port, with a config file and a data folder in a new
  folder under the temp folder. What that process writes is the server log the test reads.
  `removeSpawnedBackends` stops the backend and removes the folder.

## Steps

1. **LOG-1:** GET `/environments/<a new UUID>` twice, each with its own UUID.
2. **LOG-2:** GET `/health`.

## Validation

- **Response of a failed request:** 404, error code `NOT_FOUND`, message `Environment with ID
  '<id>' not found`. `meta.request_id` in the body, `X-Request-ID` and `X-Correlation-ID` hold
  the same UUID.
- **Server log of a failed request:** under the first eight characters of that id, the error
  handler's line `ERROR [<id8>] WAVE exception for request <id>: Environment with ID '<env>' not
  found`, then the request line `WARN  [<id8>] GET /environments/<env> → 404 (<n.nn>ms)`. No
  other line carries `[<id8>]`.
- **Second failed request:** its id differs from the first, and its two lines sit under its own
  id.
- **Request that succeeds:** one line `INFO  [<id8>] GET /health → 200 (<n.nn>ms)` under the id of
  its response headers.

## V-LOG-SAFE-VALUES-FUNCTIONAL: a value a request sends keeps its log entry on one line

The same prerequisites as above: each test starts its own backend and reads what that process
writes, so admin mode never changes on the stack's backend.

### Steps

1. **Step 1:** POST `/admin/enable` with a reason that holds a CR LF and then a made-up log line,
   `12:00:00.000 INFO  [deadbeef] FORGED-ADMIN-LINE Admin mode disabled`.
2. **Step 2:** POST `/admin/enable` with a plain reason that holds spaces and punctuation.
3. **Step 3:** GET `/e2e-log-safe/a%1B%5B31mred%E2%80%AEb%E2%80%A8c?note=one`, a path that
   holds a terminal color escape, a right-to-left override and a line separator.
4. **Step 4:** GET `/environments/<id>` with an identifier that holds a LF and then a made-up
   log line, `12:00:00.000 ERROR [deadbeef] FORGED-ERROR-LINE`.

### Validation

- **Response:** 200, `enabled` true, and the reason as it was sent.
- **A reason with a line break:** no line of the server log holds `FORGED-ADMIN-LINE`. Under the
  request's short id there is one line `INFO  [<id8>] Admin mode enabled: reason=base64:<Base64
  of the reason's UTF-8 bytes>, timestamp=<enabled_at>`, where the timestamp is the response's
  `enabled_at` with its `Z` written as `+00:00`.
- **A plain reason:** the one line under its short id is `INFO  [<id8>] Admin mode enabled:
  reason=<reason>, timestamp=<enabled_at>`, the reason written as it is.
- **A path with control characters:** 404. No line of the server log holds a raw ESC, U+202E or
  U+2028. The one line under the request's short id is `WARN  [<id8>] GET base64:<Base64 of the
  decoded path and its query> → 404 (<n.nn>ms)`.
- **An identifier with a line break:** 400 with the message `Invalid UUID format for
  environment_id: '<id>'`. No line of the server log holds `FORGED-ERROR-LINE`. Under the
  request's short id there are two lines: `ERROR [<id8>] WAVE exception for request <request
  id>: base64:<Base64 of that message>`, then `WARN  [<id8>] GET base64:<Base64 of the decoded path>
  → 400 (<n.nn>ms)`.
