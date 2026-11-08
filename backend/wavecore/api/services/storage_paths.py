"""Centralized storage path configuration for API services.

Every path sits under the data folder the config names (REQ-4.7.13).
"""

import os
from pathlib import Path

from wavecore.api.config import get_config
from wavecore.api.exceptions import ValidationException

# The data folder in use: set_base_path() or the config's folder, fixed until reset_path_cache().
_base_path_cache: Path | None = None

# Cache for the artifact root (env override or {base_path}/artifacts)
_artifacts_path_cache: Path | None = None

# What one path segment can never be, or hold, on any host.
_NOT_SEGMENTS = frozenset({"", ".", ".."})
_SEPARATORS = frozenset("/\\\0")


def get_base_path() -> Path:
    """The data folder: the set_base_path() override, else the config's resolved folder."""
    global _base_path_cache
    if _base_path_cache is None:
        _base_path_cache = get_config().resolved_data_folder()
    return _base_path_cache


def is_entity_id(entity_id: str) -> bool:
    """Whether an ID is one plain path segment, the only kind that names a stored entity."""
    return entity_id not in _NOT_SEGMENTS and _SEPARATORS.isdisjoint(entity_id)


def entity_dir(root: Path, entity_id: str) -> Path:
    """A stored entity's folder under its storage root; refuses an ID is_entity_id rejects."""
    if not is_entity_id(entity_id):
        raise ValidationException(f"Invalid UUID format for id: '{entity_id}'")
    return root / entity_id


def get_tests_storage_path() -> Path:
    """Get the storage path for API tests.

    Returns:
        Path to the tests storage directory (base_path/api_tests)
    """
    return get_base_path() / "api_tests"


def get_blocks_storage_path() -> Path:
    """Get the storage path for API blocks.

    Returns:
        Path to the blocks storage directory (base_path/api_blocks)
    """
    return get_base_path() / "api_blocks"


def get_functions_storage_path() -> Path:
    """Get the storage path for Published Functions.

    Returns:
        Path to the functions storage directory (base_path/functions)
    """
    return get_base_path() / "functions"


def get_suites_storage_path() -> Path:
    """Get the storage path for API suites.

    Returns:
        Path to the suites storage directory (base_path/api_suites)
    """
    return get_base_path() / "api_suites"


def get_regressions_storage_path() -> Path:
    """Get the storage path for API regressions.

    Returns:
        Path to the regressions storage directory (base_path/api_regressions)
    """
    return get_base_path() / "api_regressions"


def get_artifacts_storage_path() -> Path:
    """Get the canonical artifact root.

    Returns:
        Path from the WAVE_STORAGE_ARTIFACTS_DIR environment override,
        otherwise base_path/artifacts. Cached until reset_path_cache().
    """
    global _artifacts_path_cache
    if _artifacts_path_cache is None:
        override = os.environ.get("WAVE_STORAGE_ARTIFACTS_DIR")
        _artifacts_path_cache = Path(override) if override else get_base_path() / "artifacts"
    return _artifacts_path_cache


def get_testdata_storage_path() -> Path:
    """The Test Data zone (base_path/testdata); it always tracks the base path (REQ-4.7.9)."""
    return get_base_path() / "testdata"


def get_test_testdata_path(test_id: str) -> Path:
    """A test's own Test Data folder (base_path/testdata/<test_id>)."""
    return entity_dir(get_testdata_storage_path(), test_id)


def get_local_process_storage_path() -> Path:
    """The private-folder root for local-process blocks (base_path/local-process)."""
    return get_base_path() / "local-process"


def get_environments_storage_path() -> Path:
    """Get the storage path for API environments.

    Returns:
        Path to the environments storage directory (base_path/api_environments)
    """
    return get_base_path() / "api_environments"


def get_profiles_storage_path() -> Path:
    """Get the storage path for API profiles.

    Returns:
        Path to the profiles storage directory (base_path/api_profiles)
    """
    return get_base_path() / "api_profiles"


def get_executions_storage_path() -> Path:
    """Get the storage path for API executions.

    Returns:
        Path to the executions storage directory (base_path/api_executions)
    """
    return get_base_path() / "api_executions"


def get_system_variables_file_path() -> Path:
    """Get the file path for persisted system variables.

    System variables have no entity file to anchor them to (unlike suite,
    regression, and test scopes whose variables live inside the entity
    yaml). This single file is the source of truth for them on disk.

    Returns:
        Path to the system variables YAML file (base_path/system_variables.yaml).
    """
    return get_base_path() / "system_variables.yaml"


def get_network_storage_path() -> Path:
    """The network settings area (base_path/network)."""
    return get_base_path() / "network"


def get_ssh_hosts_file_path() -> Path:
    """WAVE's trusted SSH hosts list (base_path/network/ssh_hosts.yaml)."""
    return get_network_storage_path() / "ssh_hosts.yaml"


def get_certificates_file_path() -> Path:
    """The Additional Certificates (base_path/network/certificates.yaml)."""
    return get_network_storage_path() / "certificates.yaml"


def reset_path_cache() -> None:
    """Reset the path caches to pick up environment changes."""
    global _base_path_cache, _artifacts_path_cache
    _base_path_cache = None
    _artifacts_path_cache = None


def set_base_path(path: str | Path) -> None:
    """Override the base path programmatically.

    Args:
        path: New base path to use
    """
    global _base_path_cache
    _base_path_cache = Path(path)
