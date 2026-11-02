"""Server-side secret file reader, bounded to a configured input root.

Resolves a named file inside the deployment's secrets input directory for the
recipe ``value_from_file`` secret mode. Path traversal and symlink escapes are
rejected; the caller seals the returned value immediately.
"""

import os
from pathlib import Path

SECRETS_DIR_ENV = "WAVE_MCP_SECRETS_DIR"
SECRETS_DIR_SETTING = "security.secrets_input_dir"


class SecretsDirNotConfiguredError(Exception):
    """The deployment has no secrets input directory, so no file can be read."""


class SecretFileNotFoundError(Exception):
    """The referenced secret file does not exist under the configured root."""

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(name)


class SecretFileOutsideRootError(Exception):
    """The reference resolves outside the configured secrets input directory."""

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(name)


def _secrets_root() -> Path | None:
    """Env var wins, then the config setting, so a container can override a file."""
    raw = os.environ.get(SECRETS_DIR_ENV)
    if not raw:
        from wavecore.api.config.loader import get_config

        raw = get_config().get(SECRETS_DIR_SETTING, "")
    return Path(raw) if raw else None


def read_secret_file(name: str) -> str:
    """Read a secret value from a file inside the configured root, stripped.

    Raises SecretsDirNotConfiguredError when the deployment has no root,
    SecretFileOutsideRootError on traversal/symlink escape, and
    SecretFileNotFoundError when the file is missing.
    """
    root = _secrets_root()
    if root is None:
        raise SecretsDirNotConfiguredError
    root = root.resolve()
    target = (root / name).resolve()
    if not target.is_relative_to(root):
        raise SecretFileOutsideRootError(name)
    if not target.is_file():
        raise SecretFileNotFoundError(name)
    return target.read_text(encoding="utf-8").strip()
