# CodeQL Dismissals

This list holds every CodeQL alert that a maintainer dismissed on GitHub, one entry per cause.

This list is one of the exclusion lists in [README.md](README.md), which holds the rules for all of them.

## Correlation Rules

- **Each entry lists its CodeQL alert numbers** - GitHub keeps an alert's number on every branch, so the numbers find the alerts in the repository's code scanning list
- **Each alert number is in exactly one entry**
- **The code carries the ID** - A one-line comment at each place holds the entry's ID, for example `# CQL-LOG-001` in Python and `// CQL-XSS-001` in TypeScript
- **Find a place by searching for the ID** - For example `git grep -n "CQL-LOG-001"`
- **IDs never change** - An ID stays the same when its code moves to another file
- **Orphaned IDs are violations** - An ID in this list but not in the code, or in the code but not in this list, is a policy violation

## Exclusion Categories

| Category | Code | Description |
|----------|------|-------------|
| LOG | `CQL-LOG-*` | Log and print lines that CodeQL takes for secrets |
| REDOS | `CQL-REDOS-*` | Regular expressions that run in linear time |
| TRACE | `CQL-TRACE-*` | Error replies that carry only an error message |
| XSS | `CQL-XSS-*` | Browser parsing whose result never reaches the page |
| EVAL | `CQL-EVAL-*` | Expressions that Test authors write |
| BIND | `CQL-BIND-*` | Listeners that an admin opens to the network |
| TLS | `CQL-TLS-*` | TLS servers that only the tests run |

---

## Logging

### CQL-LOG-001: Log Lines That Hold No Secret Value

- **Kind**: False positive
- **Rule**: `py/clear-text-logging-sensitive-data`, Clear-text logging of sensitive information
- **CodeQL alerts**: 7 to 27, 253, 270 to 274

CodeQL follows data from WAVE's secret helpers to each log line that the data reaches. It does not know that WAVE's masking replaces a secret with the mask, or that WAVE's scrubbing removes every registered secret value from a line. So it flags lines whose data only passed near a secret helper. The flagged lines fall into two groups.

Run log lines that WAVE copies to the server terminal: the copy that the run logger writes, the copy that the workbench writes, and the debug line of a failed Function body. WAVE scrubs the line, or the error text, with the run's registered secrets just before it logs it, so a secret value reaches the server log as the mask. A plain value shows only where a Block or the run output setting turns reveal on, on purpose. A test pins that a Function's secret input never shows.

Lines that log labels, not values. The save check and the automatic fix of a Test log the test name, Block IDs and names, edge IDs and handles, variable names and type names, and the text of check messages. The check messages name Blocks, settings, variables and types and never quote a secret value: secret settings are text, the checks skip sealed secrets and the mask, and number problems leave the value out. Types come only from a Block's schema or from WAVE's fixed table of check types. A failed WebSocket broadcast logs its topic name, a fixed prefix and an entity ID. A failed log broadcast logs the workbench session ID, a random UUID. CodeQL reaches these lines only because the whole workflow passed through a secret masking helper first, or because a test stores a secret registry object in the same session record.

### CQL-LOG-002: The Command That Prints a New Secret Key

- **Kind**: Intended behavior
- **Rule**: `py/clear-text-logging-sensitive-data`, Clear-text logging of sensitive information
- **CodeQL alerts**: 5

The `wave-new-secret-key` command has one job: it prints a fresh random key once, to the terminal of the person who runs it, so they can put it in their config file. The server never calls it, and nothing writes the key to a log.

---

## Regular Expressions

### CQL-REDOS-001: Patterns That Read in One Linear Pass

- **Kind**: False positive
- **Rule**: `py/polynomial-redos`, Polynomial regular expression used on uncontrolled data
- **CodeQL alerts**: 28 to 30

Two readers use patterns that CodeQL takes for slow ones. Each pattern reads its input in one linear pass, so a long input takes time in proportion to its length. A million repeats of CodeQL's attack string read in well under a second.

- The JSON reader of the OpenSearch client, which accepts comments and keeps exact decimals, skips white space and comments with one pattern and reads a string with another. Each one is matched at one fixed position and scans forward once, the two branches of the string pattern never overlap, and an unterminated comment or string stops the read at once.
- The reader of known_hosts lines for the trusted SSH hosts splits a host field of the form `[host]:port`. The pattern must match the whole field, and its character class stops at the first closing bracket, so it is one pass over a field with no spaces.

---

## Error Replies

### CQL-TRACE-001: Error Replies Carry Only the Message

- **Kind**: False positive
- **Rule**: `py/stack-trace-exposure`, Information exposure through an exception
- **CodeQL alerts**: 254, 256

When the clone of a Regression, or the update of a Test or of its details, refuses a request, the reply carries the text of the error. The text of an exception is only its message, never a stack trace. The errors on these paths come from the route's own checks of IDs, names and JSON, and none of them carries a secret.

---

## Browser Parsing

### CQL-XSS-001: The XML Check Parses Text It Never Shows

- **Kind**: False positive
- **Rule**: `js/xss-through-dom`, DOM text reinterpreted as HTML
- **CodeQL alerts**: 241

Before the editor accepts a value in XML format, it checks that the text is well-formed XML. It parses the text with the browser's DOMParser as `application/xml` only for that check. The parsed document is inert and never goes into the page; only its error text shows, as plain text. CodeQL treats every DOMParser call as a place where HTML enters the page.

---

## Expressions

### CQL-EVAL-001: Expressions That Test Authors Write

- **Kind**: Intended behavior
- **Rule**: `py/code-injection`, Code injection
- **CodeQL alerts**: 1

WAVE evaluates the Python expressions that a Test author writes, a WAVE feature. The evaluation gets only a fixed set of safe builtins, refuses blocked patterns such as names with double underscores, and refuses assignments. Whoever can call the API that evaluates expressions can already run any code through the Python and Shell Blocks on the same API, so the evaluation gives no extra access.

---

## Network Listeners

### CQL-BIND-001: The MCP Listener on the Network

- **Kind**: Intended behavior
- **Rule**: `py/bind-socket-all-network-interfaces`, Binding a socket to all network interfaces
- **CodeQL alerts**: 48

The MCP listener is off by default and binds 127.0.0.1 by default. It binds all interfaces only when an admin picks the network option in Settings, so that MCP clients on other machines can reach it. That is the purpose of the option. The same bind runs for a moment when Settings checks that the chosen port is free.

---

## Test Servers

### CQL-TLS-001: Fake TLS Servers in the Backend Tests

- **Kind**: Test code only
- **Rule**: `py/insecure-protocol`, Use of insecure SSL/TLS version
- **CodeQL alerts**: 35 to 44

The backend tests start fake servers on 127.0.0.1 that speak TLS: HTTPS servers for the HTTP Block, the remote execution bundle and the Kubernetes API, a mutual TLS echo server, Kubernetes exec WebSocket servers, an OpenSearch server, and an in-memory TLS handshake for the SQL client. None of them is shipped code, and each one answers only the test's own client while the test runs.

Most of them use Python's default server context. Two allow old TLS versions on purpose. The HTTP Block fixtures have a legacy mode that allows TLS 1.0, so a test can check that a Block whose author pinned TLS 1.0 still connects. The fake server of the SQL dialect tests offers at most TLS 1.1, so a test can check that WAVE's SQL client refuses it. WAVE's own default floor is TLS 1.2.
