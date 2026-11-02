# V-REQUEST-LOGGING-FUNCTIONAL: a failed request in the server log

`v-request-logging-functional.spec.ts`: every request has its line in the server log, a failed one
included, and the request id a response carries is the id its log lines sit under
(REQ-5.2.3.4, REQ-5.2.3.5).

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
