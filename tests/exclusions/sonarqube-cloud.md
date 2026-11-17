# SonarQube Cloud False Positives

This list holds every issue that a maintainer marked as a false positive in SonarQube Cloud, one entry per cause.

This list is one of the exclusion lists in [README.md](README.md), which holds the rules for all of them.

## Correlation Rules

- **Each entry names its rule key** - SonarQube Cloud gives an issue a new key on each branch, so entries never list issue keys
- **The code carries the ID** - A one-line comment at each place holds the entry's ID, for example `# SonarQube exclusion: SQ-HASH-001`
- **Find a place by searching for the ID** - For example `git grep -n "SQ-HASH-001"`
- **IDs never change** - An ID stays the same when its code moves to another file
- **Orphaned IDs are violations** - An ID in this list but not in the code, or in the code but not in this list, is a policy violation

## Exclusion Categories

| Category | Code | Description |
|----------|------|-------------|
| XSS | `SQ-XSS-*` | Cross-site scripting reports on files that WAVE serves to the browser |
| HASH | `SQ-HASH-*` | Hashes that a wire protocol sets |
| HTTP | `SQ-HTTP-*` | Plain HTTP addresses that WAVE uses on purpose |
| TLS | `SQ-TLS-*` | Certificate checks that a Test author turns off |
| CMD | `SQ-CMD-*` | Programs that WAVE starts on purpose |
| PATH | `SQ-PATH-*` | Files that WAVE opens on purpose |
| ASYNC | `SQ-ASYNC-*` | Hooks that a library requires to be async |

---

## Cross-Site Scripting

### SQ-XSS-001: Saved Web Pages Open in a Sandbox

- **Kind**: False positive
- **Rule**: `pythonsecurity:S5131`, Endpoints should not be vulnerable to reflected cross-site scripting (XSS) attacks

The artifact download sends the bytes of a file that a run saved, with the file's own content type, so a web page that a run saved, such as WAVE's own HTML report, opens in the browser as a page. Every page type goes out with the content security policy `sandbox allow-scripts`. The browser gives such a page an origin of its own, apart from WAVE, so its scripts run but cannot reach WAVE. The download also tells the browser not to guess the content type and not to cache the file.

SonarQube Cloud accepts only plain text for such content. That would stop WAVE's HTML report from opening as a report.

---

## Hashes

### SQ-HASH-001: SHA-1 Set by a Wire Protocol

- **Kind**: False positive
- **Rule**: `python:S4790`, Weak hashing algorithms should not be used

Two places use SHA-1 because the protocol they speak sets it. Neither uses it where a collision matters.

- The Kubernetes exec connection opens a WebSocket. RFC 6455, section 4.2.2, defines the handshake's accept value as the SHA-1 of the client's key joined to a fixed GUID that the RFC publishes. Any other hash makes the handshake fail. The input is a fresh random key and a public constant, so there is nothing secret to recover, and a collision gains nothing.
- The MySQL login can send the password encrypted with the server's RSA key. The MySQL server decrypts it with RSA OAEP padding built on SHA-1, so WAVE pads with SHA-1 too. OAEP uses the hash to mask the padding, not as a fingerprint, so collisions play no part. Three lines there use the hash: the hash length, the mask stream and the padding block.

---

## Plain HTTP

### SQ-HTTP-001: The Address of an HTTP Proxy

- **Kind**: False positive
- **Rule**: `python:S5332`, Clear-text protocols should not be used

Two places write the address of the HTTP proxy that WAVE goes through: the proxy setting that WAVE hands to helm, and the transport of the HTTP Block. The address comes from Settings > Network > Proxy or from the WAVE host's proxy variables. WAVE supports plain HTTP proxies only.

A request to an https target is not sent in clear. WAVE, or helm, asks the proxy for a CONNECT tunnel, then does TLS with the target through it and checks the target's certificate as it does without a proxy. The proxy sees only the target's host and port, and the proxy login when one is set.

### SQ-HTTP-002: The MCP Address for Local Tools

- **Kind**: False positive
- **Rule**: `python:S5332`, Clear-text protocols should not be used

The MCP status in Settings lists the addresses where MCP clients reach WAVE's MCP listener. The listener speaks plain HTTP, so an AI tool on the same machine connects to it without a certificate. The listener is off by default and binds only 127.0.0.1 by default. It listens on other interfaces only when an admin picks the network option in Settings, as CQL-BIND-001 in [codeql.md](codeql.md) says.

---

## Certificate Checks

### SQ-TLS-001: SQL Server Certificate Check Turned Off by the Author

- **Kind**: False positive
- **Rule**: `python:S4830`, Server certificates should be verified during SSL/TLS connections

The SQL Block has a setting to verify the server certificate, and it is on by default. When it is on, WAVE checks the certificate against the Block's CA certificate, or against the certificates WAVE trusts, and checks the server's name. A Test author turns it off on purpose, for a database whose certificate WAVE cannot check. Only then does the SQL Server connection skip the check, and the connection still uses TLS 1.2 or later.

---

## Programs and Files

### SQ-CMD-001: The Watchdog Starts the Block's Program

- **Kind**: False positive
- **Rule**: `pythonsecurity:S8705`, Agentic workflows should not be vulnerable to argument injection attacks

The Shell command, Shell script and Python Blocks run their program on the WAVE host under a small watchdog, which ends the program and its children when WAVE goes away. The watchdog runs the program that the Test asks for. Only WAVE starts the watchdog, and WAVE puts the program and its arguments on the watchdog's command line. Nothing from a web request or an outside user reaches them. Allowing only safe characters would break those Blocks.

### SQ-PATH-001: The Python Block Opens Its Script

- **Kind**: False positive
- **Rule**: `pythonsecurity:S2083`, I/O function calls should not be vulnerable to path injection attacks

The Python Block runs its script through a small helper inside the interpreter that the author names. The helper opens the script that WAVE names in the helper's own input file, which WAVE writes to a private folder before the run. In File mode the script is the Test author's own file and may be anywhere, so a folder check would break the Block. Nothing from a web request reaches this path.

---

## Async Hooks

### SQ-ASYNC-001: The HTTP Block's Trace Hook

- **Kind**: False positive
- **Rule**: `python:S7503`, Async functions should use async features

The HTTP Block records when the connect and TLS steps of each request start and end, for its trace output. The HTTP library reports these steps to a hook that WAVE hands it. WAVE sends requests through the library's async interface, and that interface accepts only an async hook: it awaits what the hook returns, and it fails the request when the hook is a plain function. The hook only records each step, so it has nothing to await.
