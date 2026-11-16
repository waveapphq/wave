# Backend configuration

WAVE reads one config file. In this directory that file is `config.yaml`, a copy
of the tracked `config.example.yaml`.

Settings resolve in this order, later winning: built-in defaults, then the
config file, then environment variables. The variables that participate are
listed in [`../README.md`](../README.md#environment-variables); there is no
generic `WAVE_*` prefix rule.

## Where the file is

WAVE reads `config/config.yaml` in the folder it is installed in, which is
`backend/` in this repository. It finds that folder from where its own code
lives, never from the folder it was started from, so starting the server from
another directory reads the same file.

`WAVE_CONFIG_FILE` names another file by its absolute path, for a deployment
that keeps its configuration elsewhere and for test stacks that each need a
file of their own. A relative path is refused. There is one file per WAVE: no
environment name selects among several.

The startup log names the file in use (`Config file: <path>`), and
Settings > WAVE Server shows the same path.

## Creating it

`config.example.yaml` holds the settings a new WAVE needs and every setting the
Settings pages save, the data folder `../data` and the browser origins used in
local development. It holds no secret key. Copy it, then make a key and set it
as `security.secret_key` in the copy (see [The secret key](#the-secret-key)):

```bash
cp config/config.example.yaml config/config.yaml
poetry run wave-new-secret-key
```

## When WAVE refuses to start

WAVE logs one FATAL line and exits with code 1 in each of these cases. The
message names the file, and the setting when one is at fault.

| Case | Message |
|---|---|
| The file is missing | `Config file not found: {path} (set WAVE_CONFIG_FILE to use another file)` |
| `WAVE_CONFIG_FILE` is a relative path | `WAVE_CONFIG_FILE must be an absolute path: {value}` |
| The file cannot be read, or does not parse as YAML | `Config file {path} cannot be read: {reason}` |
| The top level of the file is not a mapping | `Config file {path} does not hold a YAML mapping` |
| A setting from the Settings pages holds a value WAVE cannot accept | `Config file {path}: {key} {rule}`, for example `Config file /etc/wave/config.yaml: mcp.port must be a whole number from 1024 to 65535` |
| `server.port` is not a whole number from 1 to 65535, or `server.worker_count` is not a whole number of 1 or more | `Config file {path}: {key} {rule}`, for example `Config file /etc/wave/config.yaml: server.port must be a whole number from 1 to 65535` |
| `WAVE_LOG_LEVEL` is set to an unknown level | `WAVE_LOG_LEVEL must be one of DEBUG, INFO, WARN, ERROR, FATAL: {value}` |

Only the first problem found is reported. The data folder and the secret key
have startup checks of their own; see `storage.base_path` and
`security.secret_key` below.

## File format

The file is YAML and its top level is a mapping of sections: `server`,
`storage`, `logging`, `integration`, `security`, `secret_masking`, `network`,
`mcp` and `backup`. Any other section is ignored, and WAVE logs one WARN line
for each one when it loads the file, so a typo'd section name is easy to find:
`Config file {path}: unknown section '{name}' is ignored`.

A key the file does not hold takes its default, and a section that sets only
some of its keys keeps the defaults of the others. In the sections the Settings
pages write (`secret_masking`, `network`, `mcp`, `backup`), a boolean must be
`true` or `false` (a number is refused), and an unknown key is kept in the file
and ignored.

WAVE loads the file when it starts, so an edit made by hand takes effect at the
next start.

## Saved from Settings

The Settings pages write this WAVE's own settings into the config file when the
admin saves a page: the log level, secret masking, the SSH lock and default host
key action, the choice of public certificate authorities, the proxy, the MCP
server and the periodic backup schedule. The table below names the page that
saves each key.
Shared work (tests, profiles, the trusted SSH hosts list, the Additional
Certificates and the rest) is in the data folder, never in this file.

A Save:

- changes only the settings that page saved; a saved key the file does not hold
  is added at the end of its section
- keeps only what the page shows: a setting the page hides goes back to its
  default and a password stored for it is removed. A Save of Proxy Setup with
  the proxy off resets every other `network.proxy` key; with the source `host`
  it resets `host`, `port`, `username`, `password`, `list_mode`, `entries` and
  `proxy_local_addresses`. A Save of Periodic Backup with the schedule off
  resets every `backup.schedule` key except `last_run` and `last_run_status`
- keeps the file's comments, the order of its settings, its layout and its line ends
- reads the file again just before writing, so an edit made by hand since WAVE
  started is kept
- replaces the file in one step and keeps its permissions; a config file that is
  a link is written through to the file it points at
- never writes a value the next start would refuse: the Save is answered with
  the rule, for example `mcp.port must be a whole number from 1024 to 65535`,
  and nothing is written

When the file cannot be written, the Save is refused with one of these messages,
the file is left byte for byte as it was, and nothing changes in the running
WAVE:

| Case | Message |
|---|---|
| The file is read-only for WAVE | `Settings cannot be saved: the config file {path} is read-only` |
| The file cannot be read, or does not parse as YAML | `Settings cannot be saved: the config file {path} cannot be read: {reason}` |
| The top level of the file is not a mapping | `Settings cannot be saved: the config file {path} does not hold a YAML mapping` |
| A key on the way to the saved setting holds a value, not a section | `Settings cannot be saved: {key} in the config file {path} is not a section` |
| Writing fails (the folder is not writable, the disk is full) | `Settings cannot be saved: the config file {path} cannot be written: {reason}` |

The new file is written beside the old one before it replaces it, so WAVE needs
write access to the folder as well as to the file.

## Keys that take effect

| Key | Type | Default | Effect | Saved from |
|---|---|---|---|---|
| `storage.base_path` | string | none (required) | The data folder: the shared work (tests, suites, profiles and more) and the run history. A relative path starts at the folder of the config file (`../data` in config.example.yaml is `backend/data`). `WAVE_STORAGE_BASE_PATH` overrides it and must be an absolute path. Startup fails when neither is set or the folder cannot be created; the startup log and Settings > WAVE Server name the absolute path in use | - |
| `security.cors_origins` | list of strings | `[]` | Browser origins the API accepts. Empty means no browser can call it, which is the secure default and why config.example.yaml lists the local development origins. Bound at startup: changing it needs a restart | - |
| `security.cors_origin_regex` | string | `""` | A pattern for further browser origins the API accepts. The one in config.example.yaml admits any `http` origin on a private-network address (localhost, 127.0.0.1, 10.x, 172.16-31.x, 192.168.x), any port. `WAVE_SECURITY_CORS_ORIGIN_REGEX` overrides it. Bound at startup | - |
| `security.secret_key` | string | none | Base64 of 32 bytes. Seals every stored secret and profile credential. Make one with `poetry run wave-new-secret-key`. Startup fails if it is missing, malformed, or cannot decrypt existing data | - |
| `security.secrets_input_dir` | string | `""` | Server-side directory the recipe `value_from_file` secret mode reads from. Empty disables that mode. `WAVE_MCP_SECRETS_DIR` overrides it | - |
| `server.debug` | boolean | `false` | When false, API error responses are sanitized rather than exposing internals | - |
| `logging.level` | string | `INFO` | The log level: `DEBUG`, `INFO`, `WARN`, `ERROR` or `FATAL`. `WAVE_LOG_LEVEL` overrides it at startup | General |
| `secret_masking.run_output` | boolean | `false` | `true` reveals secrets in run output (logs, console, reports, execution history). It is also the default that each block's own run-output masking choice follows | General |
| `secret_masking.test_variables` | boolean | `false` | `true` reveals a test's secret variable values in the Workbench | General |
| `secret_masking.shared_variables` | boolean | `false` | `true` reveals secret values in the global, regression and suite variable editors | General |
| `secret_masking.credential_inputs` | boolean | `false` | `true` reveals stored values in plugin credential input fields | General |
| `network.ssh_hosts.lock_trusted_hosts` | boolean | `false` | Locks the trusted SSH hosts list. While it is locked, `accept-new` acts as `strict` | SSH Hosts |
| `network.ssh_hosts.default_block_action` | string | `disabled` | `strict`, `accept-new` or `disabled`: the host key action stamped into newly placed SSH Session Open blocks. It cannot be `accept-new` while `lock_trusted_hosts` is true | SSH Hosts |
| `network.certificates.public_source` | string | `builtin` | The public certificate authorities WAVE trusts: `builtin` (WAVE's built-in list) or `host` (this WAVE host's store) | Certificates |
| `network.proxy.enabled` | boolean | `false` | Turns the proxy on for web requests (HTTP and HTTPS) made from the WAVE host | Proxy Setup |
| `network.proxy.source` | string | `host` | Where the proxy settings come from: `host` (this WAVE host's `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` variables) or `custom` (the keys below) | Proxy Setup |
| `network.proxy.host` | string | `""` | The custom proxy's IP address or host name, with no protocol and no port | Proxy Setup |
| `network.proxy.port` | integer or null | `null` | The custom proxy's port, from 1 to 65535 | Proxy Setup |
| `network.proxy.username` | string | `""` | The custom proxy's username | Proxy Setup |
| `network.proxy.password` | sealed value or null | `null` | The custom proxy's password, stored sealed. Set it from Settings > Network > Proxy; a plain value typed here fails startup | Proxy Setup |
| `network.proxy.list_mode` | string | `except` | How the custom proxy uses the address list. `except`: an address on the list connects directly and every other address goes through the proxy. `only`: an address on the list goes through the proxy and every other address connects directly | Proxy Setup |
| `network.proxy.entries` | list of entries | `[]` | The custom proxy's address list. Each entry has a `kind` (`exact` or `regex`) and an `address` | Proxy Setup |
| `network.proxy.proxy_local_addresses` | boolean | `false` | With the custom proxy, `false` connects local addresses (`localhost`, 127.0.0.0/8, `::1`) directly. `true` lets the address list decide for them too | Proxy Setup |
| `mcp.enabled` | boolean | `false` | Turns the MCP server on | MCP Server |
| `mcp.port` | integer | `8765` | The MCP server's port, from 1024 to 65535 | MCP Server |
| `mcp.bind` | string | `local` | The MCP server's bind scope: `local` or `network` | MCP Server |
| `mcp.auth_enabled` | boolean | `false` | Requires a username and password on the MCP server | MCP Server |
| `mcp.auth_username` | string | `""` | The MCP server's username | MCP Server |
| `mcp.auth_password` | sealed value or null | `null` | The MCP server's password, stored sealed. Set it from Settings > MCP Server; a plain value typed here fails startup | MCP Server |
| `backup.schedule.enabled` | boolean | `false` | Turns the periodic backup on | Periodic Backup |
| `backup.schedule.cron` | string | `""` | The cron expression of the schedule | Periodic Backup |
| `backup.schedule.entity_types` | list of strings or null | `null` | The entity types a backup holds. `null` means every backup entity type | Periodic Backup |
| `backup.schedule.max_backups` | integer | `5` | The most backups kept, 1 or more | Periodic Backup |
| `backup.schedule.save_directory` | string | `~/wave-backups` | The folder backups are written to. It must be outside the data folder. `~` and a relative path start at the home folder of the account WAVE runs under | Periodic Backup |
| `backup.schedule.format` | string | `yaml` | The backup format | Periodic Backup |
| `backup.schedule.compression_method` | string | `deflate` | The compression method | Periodic Backup |
| `backup.schedule.compression_level` | integer | `6` | The compression level, from 1 to 9 | Periodic Backup |
| `backup.schedule.secrets` | string | `mask` | How a backup holds secrets: `mask`, `encrypted` or `plaintext` | Periodic Backup |
| `backup.schedule.last_run` | timestamp or null | `null` | When the last scheduled backup ran | Written by WAVE after each scheduled run |
| `backup.schedule.last_run_status` | string or null | `null` | The result of the last scheduled backup: `success` or `failed` | Written by WAVE after each scheduled run |

The remaining declared keys (`server.host`, `server.port`,
`server.worker_count`, `server.timeout`, `storage.file_storage_path`,
`storage.backup_path`, the `logging` keys other than `level`, `integration.*`)
are accepted and returned by the config API but nothing reads them. Setting them
changes nothing, except that a `server.port` or `server.worker_count` WAVE cannot
accept stops the start. The listen address and port come from uvicorn's `--host` /
`--port`.

## The secret key

`config.example.yaml` ships no key: every installation makes its own. In the
backend folder, run:

```bash
poetry run wave-new-secret-key
```

It prints a new random key (base64 of 32 bytes) as its only line. Set it as
`security.secret_key` in the config file, or in `WAVE_SECRET_KEY`. WAVE refuses
to start without a key, and the message names this command. Share the key only
with people who should read the same secrets.

The key is made once per installation and must stay identical for the life of
that instance's data. `WAVE_SECRET_KEY` overrides the file, so alternating
between the two silently swaps keys and leaves previously sealed secrets
undecryptable. Rotating means re-encrypting the stored envelopes, not editing
this value.

## Before committing

`config.yaml` in this directory is ignored by git, so the settings and the
secret key of your own WAVE stay out of the repository. `config.example.yaml` is
tracked: it is the file every new copy starts from, so keep real secret keys out
of it.

A config file under another name in this directory, such as `production.yaml`,
is not ignored and **will be committed by default**, including the
`security.secret_key` it holds. Keep a deployment's config file outside the
repository and name it with `WAVE_CONFIG_FILE`.
