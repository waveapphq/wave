# WAVE Backend (wavecore)

Backend API server for the Workflow Automation and Validation Engine (WAVE).

**Package Name**: `wavecore` (renamed from `wave` to avoid conflict with Python's standard library `wave` module)

## Overview

The WAVE backend is a FastAPI-based REST API server that provides:
- Workflow execution engine
- Plugin system for extensible test automation
- WebSocket support for real-time updates
- File-based storage for test definitions and artifacts

## Technology Stack

- **Python**: 3.12+
- **Framework**: FastAPI
- **Server**: Uvicorn (with uvloop and httptools for performance)
- **Data Validation**: Pydantic v2
- **Testing**: pytest with 100% coverage requirement

## Quick Start

Run these commands sequentially to set up the backend:

```bash
# 1. Verify Python 3.12+ is installed
python3 --version

# 2. Install Poetry (skip if already installed)
curl -sSL https://install.python-poetry.org | python3 -
export PATH="$HOME/.local/bin:$PATH"

# 3. Navigate to backend directory
cd backend

# 4. Install all dependencies
poetry install

# 5. Fetch the prebuilt driver wheels Remote Execution carries to a remote host
../scripts/fetch-remote-wheels.sh

# Only when updating the OpenSearch editor's Query DSL vocabulary: clone
# https://github.com/opensearch-project/opensearch-api-specification, then (from the repository root)
#   node scripts/opensearch-api-spec-extract.mjs --spec-dir <clone> --commit <the clone's HEAD sha>
# It rewrites wavecore/api/services/opensearch_tools/api-spec-extract.json, which records the sha
# under "source"; put the same sha in the repository's NOTICE.

# 6. Run tests to verify setup
poetry run pytest tests/secrets/test_key_provider.py

# All set! ✅
```

The full suite runs through `./scripts/ci-backend-local.sh`, from the root of the clone, on the required host that CONTRIBUTING states. Some of its tests load the Linux wheels from step 5 for this interpreter. They fail when the wheels are missing; they never skip.

## Development Workflow

### Running Tests

```bash
# Run the tests for one area
poetry run pytest tests/<area>
```

From the root of the clone, `./scripts/ci-backend-local.sh` runs every test and fails below 100% coverage.

### Code Quality

```bash
# Format code
poetry run black wavecore/

# Lint and auto-fix
poetry run ruff check wavecore/ --fix

# Type checking
poetry run mypy wavecore/
```

### Running the Server

The server is the FastAPI app `wavecore.api.app:app`. It serves the REST API, the WebSocket endpoint at `/ws` and the API docs at `/docs`.

```bash
# Development mode (config/config.yaml, copied from config/config.example.yaml, enables CORS for
# localhost:3000). The excludes stop a Python block's script file under data/ or a test edit from
# restarting the server, which would end a Workbench run. The server stops with an error at start
# when data/ does not exist, so a fresh clone creates it first.
mkdir -p data
WAVE_ADMIN_ALLOWED=true poetry run uvicorn wavecore.api.app:app --reload --reload-exclude "$PWD/data" --reload-exclude "$PWD/tests" --port 8000

# Production mode (a config file of your own with your CORS origins, data folder and secret key)
WAVE_CONFIG_FILE=/etc/wave/config.yaml poetry run uvicorn wavecore.api.app:app --port 8000
```

WAVE does not start on a host whose encoding is not UTF-8: set `PYTHONUTF8=1` in the environment that starts WAVE.

**Running on alternate port:**

To run a second backend beside the one on port 8000, start it on port 8001. A second backend in the same clone uses the same config file and data folder:

```bash
WAVE_ADMIN_ALLOWED=true poetry run uvicorn wavecore.api.app:app --reload --reload-exclude "$PWD/data" --reload-exclude "$PWD/tests" --port 8001
```

CORS is pre-configured for ports 3000 and 3001 in `config/config.example.yaml`.

**Coverage Requirements:**
- **100% code coverage** is required for all modules
- `./scripts/ci-backend-local.sh`, run from the root of the clone, writes the coverage reports to:
  - Terminal (with missing line numbers)
  - HTML format: `htmlcov/index.html`
  - JSON format: `coverage.json`
- Tests must pass AND coverage must be 100% before committing

## Project Structure

```
wavecore/
├── api/            # FastAPI endpoints and routing
├── connectivity/   # SQL and Kubernetes clients
├── controls/       # Control flow logic
├── core/           # Business logic and domain models
├── logging/        # Logging infrastructure
├── mcp/            # MCP server and its tools
├── models/         # Data models (controls, profiles)
├── plugins/        # Plugin implementations
└── storage/        # Storage layer for persistence
```

## Configuration

Configuration is managed through hierarchical sources (later sources override earlier):

1. **Default values** - built into the application. Secure by default, except
   that `security.secret_key` and `storage.base_path` have no default at all and must be supplied
2. **The config file** - one file per WAVE: `config/config.yaml`, or the file `WAVE_CONFIG_FILE` names
3. **Environment variables** - a fixed set, listed below. Not every setting has one

### The Config File

WAVE reads `config/config.yaml` in the folder it is installed in (`backend/config/config.yaml`
in this repository). It finds that folder from where its code lives, never from the folder it
was started from. `WAVE_CONFIG_FILE` names another file and must be an absolute path.

`config/config.yaml` is not tracked. Create it from the tracked example, then make a secret key
and set it as `security.secret_key` in the new file (see Secret Encryption Key below):

```bash
cp config/config.example.yaml config/config.yaml
poetry run wave-new-secret-key
```

WAVE refuses to start when the config file is missing, cannot be read or holds an invalid
setting, and the message names the file. The startup log names the file in use, and
Settings > WAVE Server shows its path.

Settings pages save this WAVE's own settings into the config file: the log level, secret
masking, the SSH lock and default host key action, the choice of public certificate authorities,
the proxy, the MCP server and the periodic backup schedule. A Save changes only the saved settings, keeps
the file's comments and layout, and keeps any edit made to the file by hand since WAVE started.
When the file cannot be written, the Save is refused with the reason and nothing changes in the
running WAVE.

See [`config/README.md`](config/README.md) for the file format, the startup checks and the
full list of keys that take effect.

### Example: Production CORS and Data Folder

In the file `WAVE_CONFIG_FILE` names:
```yaml
security:
  cors_origins:
    - "https://wave.example.com"
storage:
  base_path: /srv/wave/data
```

### Environment Variables

Only the variables listed here are read. There is **no** generic `WAVE_*`
prefix rule, so a variable named after a config key that is not in this table
has no effect.

These nine feed the config hierarchy and are the only config keys reachable
from the environment:

| Variable | Sets | Notes |
|---|---|---|
| `WAVE_SECRET_KEY` | `security.secret_key` | Note the name: not `WAVE_SECURITY_SECRET_KEY`. Make a key with `poetry run wave-new-secret-key`; see Secret Encryption Key below |
| `WAVE_SECURITY_CORS_ORIGINS` | `security.cors_origins` | Comma-separated; each entry trimmed, empties dropped |
| `WAVE_SECURITY_CORS_ORIGIN_REGEX` | `security.cors_origin_regex` | A pattern for further browser origins; empty sets none |
| `WAVE_STORAGE_BASE_PATH` | `storage.base_path` | Overrides the data folder from the config file; must be an absolute path |
| `WAVE_SERVER_DEBUG` | `server.debug` | `true`/`1`/`yes` vs `false`/`0`/`no`. When false, API error responses are sanitized |
| `WAVE_LOG_LEVEL` | `logging.level` | Overrides `logging.level` at startup. One of `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`; an unknown level fails startup |
| `WAVE_SERVER_HOST` | `server.host` | Inert: the bind address comes from uvicorn's `--host` |
| `WAVE_SERVER_PORT` | `server.port` | Inert, but a non-numeric value fails startup |
| `WAVE_SERVER_WORKER_COUNT` | `server.worker_count` | Inert, but a value below 1 fails startup |

These are read directly, bypassing the config hierarchy entirely:

| Variable | Effect | Default when unset |
|---|---|---|
| `WAVE_CONFIG_FILE` | Names the config file to read, by its absolute path | `config/config.yaml` in the folder WAVE is installed in |
| `WAVE_ADMIN_ALLOWED` | Enables the `/admin` API; otherwise those routes return 404 | Disabled |
| `WAVE_STORAGE_ARTIFACTS_DIR` | Relocates execution artifacts | `{base_path}/artifacts` |
| `WAVE_MCP_SECRETS_DIR` | Server-side root for the recipe `value_from_file` secret mode | Falls back to `security.secrets_input_dir`; empty disables the mode |
| `WAVE_BUILD_ID` / `WAVE_BUILD_DATE` | Build info shown in Settings > About | `dev` / a placeholder date |

There is no `.env` support in the backend. Export the variables, or put settings
in the config file.

### Secret Encryption Key

Secret variables and profile credentials are encrypted at rest with a 32-byte
key resolved as `security.secret_key`. Per the precedence above, the
`WAVE_SECRET_KEY` environment variable **overrides** the config-file key, so
launching sometimes with `WAVE_SECRET_KEY` set and sometimes relying on the
config file silently swaps keys and leaves previously-sealed secrets
undecryptable.

WAVE ships no key: `config/config.example.yaml` leaves it empty. Each installation makes its
own once, in the backend folder:

```bash
poetry run wave-new-secret-key
```

The command prints a new random key (base64 of 32 bytes) as its only line. Set it as
`security.secret_key` in the config file or as `WAVE_SECRET_KEY`, and share it only with people
who should read the same secrets.

The key is locked in at install: it must stay identical for the life of an instance's data.
On startup, if the key is missing, malformed, or cannot decrypt existing sealed data, WAVE
logs the reason at FATAL and exits with a non-zero status rather than running in a state where
runs hang on undecryptable secrets; for a missing key the message names the command above. Moving data to a new key requires re-encrypting the existing envelopes
under the new key, not just changing the key.

### Log Level Control

**At Startup**: The level is `logging.level` in the config file (default: INFO). The
`WAVE_LOG_LEVEL` environment variable overrides it:
```bash
WAVE_LOG_LEVEL=DEBUG poetry run uvicorn wavecore.api.app:app --reload --reload-exclude "$PWD/data" --reload-exclude "$PWD/tests" --port 8000
```

**At Runtime**: Use the log-level endpoints. Unlike the rest of `/admin`, these
two are always available and do not need `WAVE_ADMIN_ALLOWED`. A change is written
to `logging.level` in the config file and applied at once; when `WAVE_LOG_LEVEL` is
set, it still wins at the next start.
```bash
# Get current log level
curl http://localhost:8000/admin/log-level

# Change log level
curl -X PUT http://localhost:8000/admin/log-level -H "Content-Type: application/json" -d '{"level": "DEBUG"}'
```

Supported levels: `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`

### Admin API

The Admin API provides state manipulation capabilities for testing and debugging. It uses a two-layer security model:

1. **Deployment Gate** (`WAVE_ADMIN_ALLOWED`): Controls whether admin endpoints exist
2. **Runtime Activation**: API endpoints to enable/disable admin mode with documented reason

```bash
# Enable admin API availability (disabled by default)
export WAVE_ADMIN_ALLOWED=true
```

When `WAVE_ADMIN_ALLOWED` is not set or `false`, all admin endpoints return 404 as if they don't exist.

**Endpoints** (when allowed):
- `POST /admin/enable` - Activate admin mode (requires `{"reason": "..."}`)
- `POST /admin/disable` - Deactivate admin mode
- `GET /admin/status` - Check current admin mode state

**Security Note**: Only enable `WAVE_ADMIN_ALLOWED` in development/testing environments. Production deployments should leave it disabled.

## API Documentation

When the server is running, interactive API documentation is available at:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development workflow and guidelines.

## License

See project root for license information.
