# HTTP TLS matrix - functional E2E

Proves the HTTP plugin's TLS behavior on the real wire against the `tls-lab` nginx
matrix (`tests/e2e/services/tls-lab/`). The plugin runs locally on WAVE; every
listener echoes the negotiated protocol, cipher and (for mTLS) the verified
client DN as JSON, so each test carries DUAL proof: the server-received fact (the
listener JSON in the response body, bound to a variable and logged) AND the
UI-side fact (the DEBUG connect trace, harvested via `data-copy-text`).

## Pre-requisites
- Backend + frontend E2E stacks up; real-service stack up
  (`scripts/e2e-stack.sh up --wait`): the `tls-lab` service (listeners 9451-9457).
- Shared env `E2E Execution Env`.
- The console is switched to DEBUG in each spec so the connect trace renders.

## Specs

### `v-http-tls-versions-functional.spec.ts` (`fixture-versions.json`)
- PERM-6: `min=max=X` against the X-only listener negotiates X (1.0, 1.1, 1.2, 1.3);
  the listener JSON reports `ssl_protocol` and the connect entry reads
  `TLS TLSv1.X, cipher TLS_...`.
- The connect entry renders IANA cipher names.
- HTTP-13: the request runs over HTTP/1.1 (a 200 from an HTTP/1.1-only
  `listen ssl` nginx listener is the server-side proof).
- PERM-7: pinning max 1.2 against the 1.3-only listener fails the handshake
  (caught by try-catch); the bound status stays 0 - no request reached the server.
- Second test (validation API only): a stored inverted `min/max` +
  an unknown cipher is refused before any byte leaves WAVE, with the exact
  `Min TLS Version cannot exceed Max TLS Version` / `Unknown cipher suite "..."`
  messages - the same sentences the pre-send runtime guard raises.
- Save check (third test, save API only): a stored `http2` key is refused with
  `UNKNOWN_SETTING` `Block 'http-client' has no setting 'http2'` (there is no
  HTTP/2, HTTP-13) and nothing is stored.

### `v-http-tls-ciphers-functional.spec.ts` (`fixture-ciphers.json`)
- PERM-13: a single-suite pin matching the single-cipher listener (9456)
  negotiates it; a disjoint pin fails the handshake (caught).
- PERM-14: against the client-preference listener (9457, `ssl_prefer_server_ciphers
  off`), pin `[256,128]` negotiates 256 and `[128,256]` negotiates 128.
- PERM-15: a single TLS 1.3 AEAD pin vs the 1.3-only listener negotiates it.
- PERM-16: an explicit-zero cipher list fails the handshake; the bound
  status stays 0 - no request reached the server.
- FIELD-10: a list given by an expression carrying one out-of-range (1.3) suite
  drops it at run time and keeps the in-range subset in family order (the
  negotiated 1.2 suite is the first in-range entry, client preference winning).
- Save check (second test): the same list typed is refused with
  `TLS_CIPHER_OUT_OF_RANGE` `Cipher suite "TLS_AES_256_GCM_SHA384" is not
  available in TLS 1.2 to 1.2` (HTTP-13, FIELD-10) and nothing is stored.

### `v-http-tls-mtls-functional.spec.ts` (`fixture-mtls.json`)
Client identity + key material come from `helpers/config.ts`
(`TLS_LAB_CLIENT_*`), signed by the same WAVE Test CA the server trusts.
- PERM-1: TLS 1.2 with a PEM client cert, server verified via the WAVE CA; the
  listener echoes the client DN (`wave-e2e-client`); the client key masks in the
  DEBUG Inputs echo and never renders in cleartext.
- PERM-2: pinning max 1.3 with a client cert negotiates TLS 1.3.
- PERM-3: pinned 1.0 and 1.1 client auth negotiate.
- Missing client identity to 9451 is rejected in the handshake (caught).

## Isolation
The listeners are read-only (no per-request state), so no per-run keying is
needed. Container-shard mode reaches the published ports through the slirp
gateway; the `injectHttp` import option rewrites the `127.0.0.1:945x` URLs.
