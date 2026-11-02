"""
File-Based Storage Implementation

Implements storage using YAML/JSON files with version control support.
"""

import fcntl
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any, Literal

import yaml
from packaging import version as pkg_version

from wavecore.models.blocks import Block
from wavecore.models.entities import Regression, Suite, Test
from wavecore.models.plugins import Plugin
from wavecore.models.profiles.base import ConnectionProfile

from ..interface import StorageInterface

# Configure logger
logger = logging.getLogger(__name__)

_GLOB_YAML = "*.yaml"
_GLOB_JSON = "*.json"

PLUGIN_CATEGORIES = [
    "network",
    "remote",
    "database",
    "system",
    "kubernetes",
    "helm",
    "data",
    "custom",
]

_PERMANENT_ERRORS = (ValueError, TypeError, KeyError, AttributeError, FileExistsError)


def _resolve_entity_type(path: Path) -> str:
    """Derive a human-readable entity type from a versioned file path.

    Path structure: base_path/entity_type/entity_id/version.ext
    Exception: plugins have base_path/plugins/category/plugin_id/version.ext
    """
    entity_type = path.parent.parent.name
    if entity_type in PLUGIN_CATEGORIES:
        entity_type = path.parent.parent.parent.name
    return entity_type.rstrip("s").capitalize()


def _close_lock_fd(lock_fd: int | None) -> None:
    """Close a lock file descriptor, suppressing OSError."""
    if lock_fd is not None:
        try:
            os.close(lock_fd)
        except OSError:
            pass


def _release_and_close_lock(lock_fd: int | None) -> None:
    """Release an exclusive flock then close the file descriptor."""
    if lock_fd is not None:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
        except OSError:
            pass
        _close_lock_fd(lock_fd)


def _remove_lock_file(lock_file: Path | None) -> None:
    """Remove a lock file if it exists, suppressing OSError."""
    if lock_file is None:
        return
    try:
        if lock_file.exists():
            lock_file.unlink()
    except OSError:
        pass


def _remove_temp_file(temp_file: Path | None) -> None:
    """Remove a temporary file if it exists, logging on failure."""
    if temp_file is None:
        return
    try:
        if temp_file.exists():
            temp_file.unlink()
    except OSError as cleanup_error:
        logger.warning(f"Failed to clean up temp file {temp_file}: {cleanup_error}")


def _write_data(temp_file: Path, data: dict[str, Any], format: Literal["yaml", "json"]) -> None:
    """Serialize data to a temporary file with fsync for durability."""
    with open(temp_file, "w", encoding="utf-8") as f:
        if format == "yaml":
            yaml.dump(data, f, default_flow_style=False, sort_keys=False)
        else:
            json.dump(data, f, indent=2)
        f.flush()
        os.fsync(f.fileno())


def _atomic_link_replace(temp_file: Path, target: Path) -> None:
    """Atomically create target via hard-link, then remove temp file.

    Raises FileExistsError if target was created concurrently.
    """
    try:
        os.link(str(temp_file), str(target))
        os.unlink(str(temp_file))
    except FileExistsError as e:
        os.unlink(str(temp_file))
        raise FileExistsError(f"Version already exists: {target}") from e


def _detect_format(entity_dir: Path, version: str) -> Literal["yaml", "json"]:
    """Return the file format for a given version in a directory."""
    return "yaml" if (entity_dir / f"{version}.yaml").exists() else "json"


def _find_latest_version_in_dir(entity_dir: Path) -> tuple[str, Literal["yaml", "json"]] | None:
    """Find the latest semver version across yaml/json files in a directory.

    Returns (version, format) or None if no version files exist.
    """
    yaml_files = list(entity_dir.glob(_GLOB_YAML))
    json_files = list(entity_dir.glob(_GLOB_JSON))
    all_files = yaml_files + json_files
    if not all_files:
        return None
    versions = [f.stem for f in all_files]
    latest = sorted(versions, key=pkg_version.parse, reverse=True)[0]
    fmt = _detect_format(entity_dir, latest)
    return latest, fmt


class FileBasedStorage(StorageInterface):
    """
    File-based storage implementation (REQ-6.1.1, REQ-6.1.2).

    Directory structure:
    base_path/
        plugins/
            {category}/
                {plugin_id}/
                    {version}.yaml
        blocks/
            {block_id}/
                {version}.yaml
        tests/
            {test_id}/
                {version}.yaml
        suites/
            {suite_id}/
                {version}.yaml
        regressions/
            {regression_id}/
                {version}.yaml
        artifacts/
            {timestamp}-{execution_id}/
        config/
            global.yaml
            environments/
                {env_name}.yaml
    """

    def __init__(self, base_path: Path | None = None, root_dir: str | None = None):
        """Initialize file-based storage."""
        if root_dir is not None:
            self.base_path = Path(root_dir)
        elif base_path is not None:
            self.base_path = base_path
        else:
            raise ValueError("Either base_path or root_dir must be provided")
        self._initialize_directories()

    def _initialize_directories(self) -> None:
        """Create directory structure (REQ-6.1.4)."""
        directories = [
            "plugins",
            "blocks",
            "tests",
            "suites",
            "regressions",
            "profiles",
            "artifacts",
            "config",
            "config/environments",
        ]

        for dir_name in directories:
            (self.base_path / dir_name).mkdir(parents=True, exist_ok=True)

    def _get_latest_version(self, versions: list[str]) -> str:
        """Get the latest semantic version from a list."""
        if not versions:
            raise ValueError("No versions available")

        sorted_versions = sorted(versions, key=pkg_version.parse, reverse=True)
        return sorted_versions[0]

    def _check_immutability(self, path: Path, allow_overwrite: bool) -> None:
        """Raise FileExistsError if the path exists and overwrite is disallowed."""
        if path.exists() and not allow_overwrite:
            entity_type = _resolve_entity_type(path)
            raise FileExistsError(f"{entity_type} version already exists: {path}")

    def _execute_save_attempt(
        self,
        path: Path,
        data: dict[str, Any],
        format: Literal["yaml", "json"],
        allow_overwrite: bool,
    ) -> None:
        """Execute a single atomic save attempt with locking.

        Acquires an exclusive file lock, writes to a temp file, then atomically
        links to the target path. Cleans up all resources on success or failure.
        """
        temp_file: Path | None = None
        lock_file: Path | None = None
        lock_fd: int | None = None

        try:
            temp_suffix = f".tmp-{uuid.uuid4().hex}"
            temp_file = path.parent / f"{path.name}{temp_suffix}"

            lock_file = path.parent / f".{path.name}.lock"
            lock_fd = os.open(str(lock_file), os.O_CREAT | os.O_RDWR)

            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)

            self._check_immutability(path, allow_overwrite)

            _write_data(temp_file, data, format)
            _atomic_link_replace(temp_file, path)

            temp_file = None  # Prevent cleanup - rename succeeded

            _release_and_close_lock(lock_fd)
            lock_fd = None
            _remove_lock_file(lock_file)

        except KeyboardInterrupt:
            _remove_temp_file(temp_file)
            _close_lock_fd(lock_fd)
            _remove_lock_file(lock_file)
            raise

        except Exception:
            _remove_temp_file(temp_file)
            _release_and_close_lock(lock_fd)
            _remove_lock_file(lock_file)
            raise

    @staticmethod
    def _should_retry_save(path: Path, attempt: int, max_retries: int, base_delay: float) -> bool:
        """Log retry warning and sleep if more attempts remain. Returns True if retrying."""
        if attempt >= max_retries - 1:
            return False
        delay = base_delay * (2**attempt)
        logger.warning(
            f"Temporary failure for {path}, retry attempt {attempt + 1}/{max_retries}, "
            f"waiting {delay:.2f}s"
        )
        time.sleep(delay)
        return True

    def _save_file[
        T: (Plugin, Block, Test, Suite, Regression, ConnectionProfile)
    ](
        self, path: Path, model: T, format: Literal["yaml", "json"], allow_overwrite: bool = True
    ) -> None:
        """
        Save model to file in specified format with transaction support (REQ-4.3.5).

        Implements atomic write-then-rename pattern with:
        - File locking for concurrent access coordination
        - Retry mechanism with exponential backoff for temporary failures
        - Temp file cleanup on success and failure
        - Diagnostic logging
        - Version immutability enforcement
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        data = model.model_dump(mode="json")

        max_retries = 5
        base_delay = 0.1
        last_error: Exception | None = None

        for attempt in range(max_retries):
            try:
                self._execute_save_attempt(path, data, format, allow_overwrite)
                return
            except KeyboardInterrupt:
                raise
            except Exception as e:
                last_error = e
                if isinstance(e, _PERMANENT_ERRORS):
                    raise
                if not isinstance(e, BlockingIOError):
                    logger.error(
                        f"Transaction failed for {path}: {type(e).__name__}: {e}. "
                        f"Rolling back transaction and cleaning up temporary files."
                    )
                if not self._should_retry_save(path, attempt, max_retries, base_delay):
                    break

        self._check_immutability(path, allow_overwrite)

        if last_error:
            raise last_error
        raise BlockingIOError("Resource temporarily unavailable")  # pragma: no cover

    def _load_file[
        T: (Plugin, Block, Test, Suite, Regression, ConnectionProfile)
    ](self, path: Path, model_class: type[T], format: Literal["yaml", "json"]) -> T:
        """Load model from file."""
        if not path.exists():
            raise FileNotFoundError(f"File not found: {path}")

        if format == "yaml":
            with open(path, encoding="utf-8") as f:
                data = yaml.safe_load(f)
        else:  # json
            with open(path, encoding="utf-8") as f:
                data = json.load(f)

        return model_class(**data)

    # Plugin operations
    def save_plugin(
        self, plugin: Plugin, format: Literal["yaml", "json"] = "yaml", allow_overwrite: bool = True
    ) -> None:
        """Save plugin to storage."""
        plugin_dir = self.base_path / "plugins" / plugin.category / plugin.id
        file_path = plugin_dir / f"{plugin.version}.{format}"

        self._save_file(file_path, plugin, format, allow_overwrite)

    def load_plugin(
        self,
        plugin_id: str,
        version: str | None = None,
        format: Literal["yaml", "json"] = "yaml",
    ) -> Plugin:
        """Load plugin from storage."""
        # Search for plugin in all categories
        for category in PLUGIN_CATEGORIES:
            plugin_dir = self.base_path / "plugins" / category / plugin_id

            if not plugin_dir.exists():
                continue

            if version:
                file_path = plugin_dir / f"{version}.{format}"
                if file_path.exists():
                    return self._load_file(file_path, Plugin, format)
            else:
                # Load latest version
                versions = [f.stem for f in plugin_dir.glob(f"*.{format}")]
                if versions:
                    latest = self._get_latest_version(versions)
                    file_path = plugin_dir / f"{latest}.{format}"
                    return self._load_file(file_path, Plugin, format)

        raise FileNotFoundError(f"Plugin not found: {plugin_id}")

    def list_plugins(self, category: str | None = None) -> list[Plugin]:
        """List all plugins, optionally filtered by category."""
        plugins: list[Plugin] = []
        categories = [category] if category else PLUGIN_CATEGORIES

        for cat in categories:
            cat_dir = self.base_path / "plugins" / cat
            if not cat_dir.exists():
                continue

            for plugin_dir in cat_dir.iterdir():
                if not plugin_dir.is_dir():
                    continue
                result = _find_latest_version_in_dir(plugin_dir)
                if result is not None:
                    latest, fmt = result
                    plugins.append(self.load_plugin(plugin_dir.name, version=latest, format=fmt))

        return plugins

    def delete_plugin(self, plugin_id: str, version: str) -> None:
        """Delete a specific plugin version."""
        for category in PLUGIN_CATEGORIES:
            plugin_dir = self.base_path / "plugins" / category / plugin_id

            for format in ["yaml", "json"]:
                file_path = plugin_dir / f"{version}.{format}"
                if file_path.exists():
                    file_path.unlink()
                    return

        raise FileNotFoundError(f"Plugin version not found: {plugin_id} v{version}")

    # Block operations
    def save_block(
        self, block: Block, format: Literal["yaml", "json"] = "yaml", allow_overwrite: bool = True
    ) -> None:
        """Save block to storage."""
        block_dir = self.base_path / "blocks" / block.id
        file_path = block_dir / f"{block.version}.{format}"

        self._save_file(file_path, block, format, allow_overwrite)

    def load_block(
        self, block_id: str, version: str | None = None, format: Literal["yaml", "json"] = "yaml"
    ) -> Block:
        """Load block from storage."""
        block_dir = self.base_path / "blocks" / block_id

        if not block_dir.exists():
            raise FileNotFoundError(f"Block not found: {block_id}")

        if version:
            file_path = block_dir / f"{version}.{format}"
            if file_path.exists():
                return self._load_file(file_path, Block, format)
            raise FileNotFoundError(f"Block version not found: {block_id} v{version}")
        else:
            versions = [f.stem for f in block_dir.glob(f"*.{format}")]
            if not versions:
                raise FileNotFoundError(f"No versions found for block: {block_id}")

            latest = self._get_latest_version(versions)
            file_path = block_dir / f"{latest}.{format}"
            return self._load_file(file_path, Block, format)

    def list_blocks(self) -> list[Block]:
        """List all blocks."""
        blocks: list[Block] = []
        blocks_dir = self.base_path / "blocks"

        if not blocks_dir.exists():
            return blocks

        for block_dir in blocks_dir.iterdir():
            if not block_dir.is_dir():
                continue
            result = _find_latest_version_in_dir(block_dir)
            if result is not None:
                latest, fmt = result
                blocks.append(self.load_block(block_dir.name, version=latest, format=fmt))

        return blocks

    def delete_block(self, block_id: str, version: str) -> None:
        """Delete a specific block version."""
        block_dir = self.base_path / "blocks" / block_id

        for format in ["yaml", "json"]:
            file_path = block_dir / f"{version}.{format}"
            if file_path.exists():
                file_path.unlink()
                return

        raise FileNotFoundError(f"Block version not found: {block_id} v{version}")

    # Test operations
    def save_test(
        self,
        test: Test,
        format: Literal["yaml", "json"] = "yaml",
        allow_overwrite: bool = True,
    ) -> None:
        """Save test to storage."""
        test_dir = self.base_path / "tests" / test.id
        file_path = test_dir / f"{test.version}.{format}"

        self._save_file(file_path, test, format, allow_overwrite)

    def load_test(
        self,
        test_id: str,
        version: str | None = None,
        format: Literal["yaml", "json"] = "yaml",
    ) -> Test:
        """Load test from storage."""
        test_dir = self.base_path / "tests" / test_id

        if not test_dir.exists():
            raise FileNotFoundError(f"Test not found: {test_id}")

        if version:
            file_path = test_dir / f"{version}.{format}"
            if file_path.exists():
                return self._load_file(file_path, Test, format)
            raise FileNotFoundError(f"Test version not found: {test_id} v{version}")
        else:
            versions = [f.stem for f in test_dir.glob(f"*.{format}")]
            if not versions:
                raise FileNotFoundError(f"No versions found for test: {test_id}")

            latest = self._get_latest_version(versions)
            file_path = test_dir / f"{latest}.{format}"
            return self._load_file(file_path, Test, format)

    def list_tests(self) -> list[Test]:
        """List all tests."""
        tests: list[Test] = []
        tests_dir = self.base_path / "tests"

        if not tests_dir.exists():
            return tests

        for test_dir in tests_dir.iterdir():
            if not test_dir.is_dir():
                continue
            result = _find_latest_version_in_dir(test_dir)
            if result is not None:
                latest, fmt = result
                tests.append(self.load_test(test_dir.name, version=latest, format=fmt))

        return tests

    def delete_test(self, test_id: str, version: str) -> None:
        """Delete a specific test version."""
        test_dir = self.base_path / "tests" / test_id

        for format in ["yaml", "json"]:
            file_path = test_dir / f"{version}.{format}"
            if file_path.exists():
                file_path.unlink()
                return

        raise FileNotFoundError(f"Test version not found: {test_id} v{version}")

    # Suite operations
    def save_suite(
        self, suite: Suite, format: Literal["yaml", "json"] = "yaml", allow_overwrite: bool = True
    ) -> None:
        """Save suite to storage."""
        suite_dir = self.base_path / "suites" / suite.id
        file_path = suite_dir / f"{suite.version}.{format}"

        self._save_file(file_path, suite, format, allow_overwrite)

    def load_suite(
        self, suite_id: str, version: str | None = None, format: Literal["yaml", "json"] = "yaml"
    ) -> Suite:
        """Load suite from storage."""
        suite_dir = self.base_path / "suites" / suite_id

        if not suite_dir.exists():
            raise FileNotFoundError(f"Suite not found: {suite_id}")

        if version:
            file_path = suite_dir / f"{version}.{format}"
            if file_path.exists():
                return self._load_file(file_path, Suite, format)
            raise FileNotFoundError(f"Suite version not found: {suite_id} v{version}")
        else:
            versions = [f.stem for f in suite_dir.glob(f"*.{format}")]
            if not versions:
                raise FileNotFoundError(f"No versions found for suite: {suite_id}")

            latest = self._get_latest_version(versions)
            file_path = suite_dir / f"{latest}.{format}"
            return self._load_file(file_path, Suite, format)

    def list_suites(self) -> list[Suite]:
        """List all suites."""
        suites: list[Suite] = []
        suites_dir = self.base_path / "suites"

        if not suites_dir.exists():
            return suites

        for suite_dir in suites_dir.iterdir():
            if not suite_dir.is_dir():
                continue
            result = _find_latest_version_in_dir(suite_dir)
            if result is not None:
                latest, fmt = result
                suites.append(self.load_suite(suite_dir.name, version=latest, format=fmt))

        return suites

    def delete_suite(self, suite_id: str, version: str) -> None:
        """Delete a specific suite version."""
        suite_dir = self.base_path / "suites" / suite_id

        for format in ["yaml", "json"]:
            file_path = suite_dir / f"{version}.{format}"
            if file_path.exists():
                file_path.unlink()
                return

        raise FileNotFoundError(f"Suite version not found: {suite_id} v{version}")

    # Regression operations
    def save_regression(
        self,
        regression: Regression,
        format: Literal["yaml", "json"] = "yaml",
        allow_overwrite: bool = True,
    ) -> None:
        """Save regression to storage."""
        regression_dir = self.base_path / "regressions" / regression.id
        file_path = regression_dir / f"{regression.version}.{format}"

        self._save_file(file_path, regression, format, allow_overwrite)

    def load_regression(
        self,
        regression_id: str,
        version: str | None = None,
        format: Literal["yaml", "json"] = "yaml",
    ) -> Regression:
        """Load regression from storage."""
        regression_dir = self.base_path / "regressions" / regression_id

        if not regression_dir.exists():
            raise FileNotFoundError(f"Regression not found: {regression_id}")

        if version:
            file_path = regression_dir / f"{version}.{format}"
            if file_path.exists():
                return self._load_file(file_path, Regression, format)
            raise FileNotFoundError(f"Regression version not found: {regression_id} v{version}")
        else:
            versions = [f.stem for f in regression_dir.glob(f"*.{format}")]
            if not versions:
                raise FileNotFoundError(f"No versions found for regression: {regression_id}")

            latest = self._get_latest_version(versions)
            file_path = regression_dir / f"{latest}.{format}"
            return self._load_file(file_path, Regression, format)

    def list_regressions(self) -> list[Regression]:
        """List all regressions."""
        regressions: list[Regression] = []
        regressions_dir = self.base_path / "regressions"

        if not regressions_dir.exists():
            return regressions

        for regression_dir in regressions_dir.iterdir():
            if not regression_dir.is_dir():
                continue
            result = _find_latest_version_in_dir(regression_dir)
            if result is not None:
                latest, fmt = result
                regressions.append(
                    self.load_regression(regression_dir.name, version=latest, format=fmt)
                )

        return regressions

    def delete_regression(self, regression_id: str, version: str) -> None:
        """Delete a specific regression version."""
        regression_dir = self.base_path / "regressions" / regression_id

        for format in ["yaml", "json"]:
            file_path = regression_dir / f"{version}.{format}"
            if file_path.exists():
                file_path.unlink()
                return

        raise FileNotFoundError(f"Regression version not found: {regression_id} v{version}")

    # Connection Profile operations
    def save_profile(
        self,
        profile: ConnectionProfile,
        format: Literal["yaml", "json"] = "yaml",
        allow_overwrite: bool = True,
    ) -> None:
        """Save connection profile to storage."""
        profile_dir = self.base_path / "profiles" / profile.id
        file_path = profile_dir / f"{profile.id}.{format}"

        if file_path.exists() and not allow_overwrite:
            raise FileExistsError(f"Profile already exists: {file_path}")

        self._save_file(file_path, profile, format)

    def load_profile(
        self, profile_id: str, format: Literal["yaml", "json"] = "yaml"
    ) -> ConnectionProfile:
        """Load connection profile from storage."""
        profile_dir = self.base_path / "profiles" / profile_id

        if not profile_dir.exists():
            raise FileNotFoundError(f"Profile not found: {profile_id}")

        # Try specified format first, then the other format
        file_path = profile_dir / f"{profile_id}.{format}"
        if file_path.exists():
            return self._load_file(file_path, ConnectionProfile, format)

        # Try alternate format
        alt_format: Literal["yaml", "json"] = "json" if format == "yaml" else "yaml"
        file_path = profile_dir / f"{profile_id}.{alt_format}"
        if file_path.exists():
            return self._load_file(file_path, ConnectionProfile, alt_format)

        raise FileNotFoundError(f"Profile not found: {profile_id}")

    def list_profiles(self) -> list[str]:
        """List all profile IDs."""
        profiles = []
        profiles_dir = self.base_path / "profiles"

        if profiles_dir.exists():
            for profile_dir in profiles_dir.iterdir():
                if profile_dir.is_dir():
                    profiles.append(profile_dir.name)

        return sorted(profiles)

    def delete_profile(self, profile_id: str) -> None:
        """Delete a connection profile."""
        profile_dir = self.base_path / "profiles" / profile_id

        deleted = False
        for format in ["yaml", "json"]:
            file_path = profile_dir / f"{profile_id}.{format}"
            if file_path.exists():
                file_path.unlink()
                deleted = True

        if not deleted:
            raise FileNotFoundError(f"Profile not found: {profile_id}")

        # Remove directory if empty
        if profile_dir.exists() and not any(profile_dir.iterdir()):
            profile_dir.rmdir()

    def profile_exists(self, profile_id: str) -> bool:
        """Check if a connection profile exists."""
        profile_dir = self.base_path / "profiles" / profile_id
        if not profile_dir.exists():
            return False

        yaml_path = profile_dir / f"{profile_id}.yaml"
        json_path = profile_dir / f"{profile_id}.json"
        return yaml_path.exists() or json_path.exists()

    # Configuration operations
    def save_config(self, config_path: str, config: dict[str, Any]) -> None:
        """Save configuration to specified path (REQ-6.1.5)."""
        file_path = self.base_path / "config" / f"{config_path}.yaml"
        file_path.parent.mkdir(parents=True, exist_ok=True)

        with open(file_path, "w", encoding="utf-8") as f:
            yaml.dump(config, f, default_flow_style=False, sort_keys=False)

    def load_config(self, config_path: str) -> dict[str, Any]:
        """Load configuration from specified path."""
        file_path = self.base_path / "config" / f"{config_path}.yaml"

        if not file_path.exists():
            raise FileNotFoundError(f"Config not found: {config_path}")

        with open(file_path, encoding="utf-8") as f:
            result: dict[str, Any] = yaml.safe_load(f)
            return result

    def resolve_config(self, config_path: str) -> dict[str, Any]:
        """Resolve configuration with hierarchy (merge with parent configs)."""
        # Load global config as base
        try:
            merged = self.load_config("global")
        except FileNotFoundError:
            merged = {}

        # Load and merge specific config
        try:
            specific = self.load_config(config_path)
            merged.update(specific)
        except FileNotFoundError:
            pass

        return merged
