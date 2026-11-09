"""
Shared pytest fixtures for all tests.
"""

import atexit
import logging
import os
import shutil
import sys
import tempfile
from collections.abc import Callable, Generator, Mapping
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
import yaml

# Throwaway suite key (bytes 0-31): sealing and the startup key check need no config (REQ-4.5.1).
os.environ.setdefault("WAVE_SECRET_KEY", "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")

# Suite-wide config file, so an import-time load never reads the developer's own (REQ-4.7.15).
_SESSION_CONFIG_DIR = Path(tempfile.mkdtemp(prefix="wave-test-config-"))
atexit.register(shutil.rmtree, _SESSION_CONFIG_DIR, ignore_errors=True)
_SESSION_CONFIG_FILE = _SESSION_CONFIG_DIR / "config.yaml"
_SESSION_CONFIG_FILE.write_text("{}\n", encoding="utf-8")
os.environ["WAVE_CONFIG_FILE"] = str(_SESSION_CONFIG_FILE)

EXAMPLE_CONFIG_FILE = Path(__file__).resolve().parents[1] / "config" / "config.example.yaml"


@pytest.fixture(scope="session")
def fresh_folder(tmp_path_factory: pytest.TempPathFactory) -> Callable[[str], Path]:
    """Make a new empty folder per call in constant time, unlike a numbered ``mktemp``."""
    parent = tmp_path_factory.mktemp("wave-fixtures")

    def _make(prefix: str) -> Path:
        return Path(tempfile.mkdtemp(prefix=f"{prefix}-", dir=parent))

    return _make


@pytest.fixture(autouse=True)
def config_file(
    fresh_folder: Callable[[str], Path], monkeypatch: pytest.MonkeyPatch
) -> Generator[Path, None, None]:
    """Give every test its own config file and its own running config (REQ-4.7.16).

    The file sits in a directory of its own, not ``tmp_path``, so a test that
    lists ``tmp_path`` never sees it.
    """
    from wavecore.api.config import loader

    path = fresh_folder("wave-config") / "config.yaml"
    path.write_text("{}\n", encoding="utf-8")
    monkeypatch.setenv("WAVE_CONFIG_FILE", str(path))
    original = loader._config_instance
    loader._config_instance = loader.Config(config_file=str(path))

    yield path

    loader._config_instance = original


@pytest.fixture
def load_config(config_file: Path) -> Callable[..., Any]:
    """Rewrite the test's config file (optional) and load it again, as a restart would."""
    from wavecore.api.config import loader

    def _load(content: Mapping[str, Any] | str | None = None) -> Any:
        if isinstance(content, str):
            config_file.write_text(content, encoding="utf-8")
        elif content is not None:
            config_file.write_text(
                yaml.safe_dump(dict(content), allow_unicode=True, sort_keys=False),
                encoding="utf-8",
            )
        loader._config_instance = loader.Config(config_file=str(config_file))
        return loader._config_instance

    return _load


@pytest.fixture
def example_config(config_file: Path, load_config: Callable[..., Any]) -> Path:
    """The test's config file as a loaded copy of ``config.example.yaml``."""
    load_config(EXAMPLE_CONFIG_FILE.read_text(encoding="utf-8"))
    return config_file


@pytest.fixture
def config_on_disk(config_file: Path) -> Callable[[], dict[str, Any]]:
    """Parse the test's config file as it is on disk right now."""

    def _read() -> dict[str, Any]:
        return yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}

    return _read


@pytest.fixture
def read_only_config(config_file: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Make the test's config file read-only for WAVE: ``os.access`` denies writing it."""
    real_access = os.access
    target = config_file.resolve()

    def access(path: Any, mode: int, **kwargs: Any) -> bool:
        if mode & os.W_OK and Path(os.fspath(path)).resolve() == target:
            return False
        return real_access(path, mode, **kwargs)

    monkeypatch.setattr(os, "access", access)
    return config_file


@pytest.fixture
def restore_log_levels() -> Generator[None, None, None]:
    """Put back every logger and handler level that a log level change touches."""
    names = (None, "uvicorn", "uvicorn.error", "uvicorn.asgi", "asyncssh")
    loggers = [logging.getLogger(name) for name in names]
    before = [(target, target.level) for item in loggers for target in (item, *item.handlers)]

    yield

    for target, level in before:
        target.setLevel(level)


class _RecordList(logging.Handler):
    def __init__(self) -> None:
        super().__init__(logging.DEBUG)
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@pytest.fixture
def wavecore_log() -> Generator[list[logging.LogRecord], None, None]:
    """Every record a wavecore logger emits in the test, DEBUG included."""
    # Held on the wavecore logger: the app import resets the root handlers caplog uses.
    target = logging.getLogger("wavecore")
    handler = _RecordList()
    level = target.level
    target.setLevel(logging.DEBUG)
    target.addHandler(handler)
    yield handler.records
    target.removeHandler(handler)
    target.setLevel(level)


@pytest.fixture
def non_utf8_child_env() -> dict[str, str]:
    """The environment of a child Python on a host whose encoding is not UTF-8 (REQ-4.6.9)."""
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("COV_CORE_") and key != "PYTHONIOENCODING"
    }
    env.update({"LC_ALL": "C", "PYTHONUTF8": "0", "PYTHONCOERCECLOCALE": "0"})
    return env


@pytest.fixture(autouse=True)
def temp_storage_path(fresh_folder: Callable[[str], Path]) -> Generator[Path, None, None]:
    """Set up a temporary storage path for all API service tests.

    This fixture runs automatically for all tests and ensures that
    API services use an isolated temporary directory instead of
    the production ./data directory.

    It is a directory of its own, not ``tmp_path``, so a test that writes into
    ``tmp_path`` directly never sees the product's storage directories there.
    """
    from wavecore.api.services import storage_paths
    from wavecore.api.services.tests.service import _clear_in_memory_cache

    # Reset and set the storage path to temp directory
    base_path = fresh_folder("wave-data")
    storage_paths.reset_path_cache()
    storage_paths.set_base_path(str(base_path))
    # Clear test cache so it reloads from the new temp path
    _clear_in_memory_cache()

    yield base_path

    # Reset after test
    storage_paths.reset_path_cache()
    _clear_in_memory_cache()


@pytest.fixture(autouse=True)
def server_home(fresh_folder: Callable[[str], Path], monkeypatch: pytest.MonkeyPatch) -> Path:
    """Where a relative WAVE-side path starts: a temp folder, never the real home folder."""
    from wavecore.plugins import _file_paths

    home = fresh_folder("server-home")
    monkeypatch.setattr(_file_paths, "home_folder", lambda: home)
    return home


@pytest.fixture(autouse=True)
def reset_trust_store() -> Generator[None, None, None]:
    """Clear WAVE's trust resolver and the request trust spec once the trust store is loaded."""
    yield
    trust_store = sys.modules.get("wavecore.connectivity.trust_store")
    if trust_store is not None:
        trust_store.set_resolver(None)
        trust_store.ACTIVE_SPEC.set(None)


@pytest.fixture(autouse=True)
def reset_proxy_resolver() -> Generator[None, None, None]:
    """Clear WAVE's proxy resolver once the proxy module is loaded."""
    yield
    proxy = sys.modules.get("wavecore.connectivity.proxy")
    if proxy is not None:
        proxy.set_resolver(None)


def _keep_registered_plugins() -> Generator[None, None, None]:
    """Give back the plugins registered before, so what a test registers never reaches the next."""
    from wavecore.core.plugin_registry import _registry

    kept = {plugin_id: dict(versions) for plugin_id, versions in _registry._plugins.items()}
    yield
    _registry._plugins.clear()
    _registry._plugins.update(kept)


@pytest.fixture(autouse=True, scope="module")
def restore_plugin_registry_per_file() -> Generator[None, None, None]:
    """A file's module and class fixtures register plugins for that file only."""
    yield from _keep_registered_plugins()


@pytest.fixture(autouse=True)
def restore_plugin_registry() -> Generator[None, None, None]:
    """A test, its fixtures and the app startup it runs register plugins for that test only."""
    yield from _keep_registered_plugins()


@pytest.fixture(autouse=True)
def clear_config_cache() -> Generator[None, None, None]:
    """Clear configuration cache between tests.

    This ensures tests that mock config functions are isolated
    from each other and don't inherit cached values.
    """
    from wavecore.api.services import config_service

    config_service.invalidate_config_cache()

    yield

    # Clear after test as well
    config_service.invalidate_config_cache()


@pytest.fixture(autouse=True)
def clear_dashboard_cache() -> Generator[None, None, None]:
    """Clear dashboard cache between tests.

    This ensures tests that mock dashboard functions are isolated
    from each other and don't inherit cached values.
    """
    from wavecore.api.routes import dashboard

    dashboard.invalidate_dashboard_cache()

    yield

    # Clear after test as well
    dashboard.invalidate_dashboard_cache()


@pytest.fixture(autouse=True)
def clear_environment_storage(temp_storage_path: Path) -> Generator[None, None, None]:
    """Clear environment storage between tests.

    This ensures tests for environment service are isolated
    from each other and don't share state.

    Note: Depends on temp_storage_path to ensure the temp directory
    is configured before we try to clear storage.

    Important: We only clear storage in setup, NOT in teardown.
    Teardown clearing is risky because if the temp_storage_path fixture
    resets the path cache before this teardown runs, the _clear_storage()
    call would use the default ./data path and delete real user data.
    """
    from wavecore.api.services.environments import service as environment_service

    environment_service._clear_storage()

    yield
    # Note: No teardown clearing - next test's setup will handle it


# Shared test environment ID used across execution tests
TEST_ENVIRONMENT_ID = "env-test-00000000-0000-0000-0000-000000000001"


@pytest.fixture(autouse=True)
def seed_test_environment(
    clear_environment_storage: None,
) -> Generator[str, None, None]:
    """Seed a default test environment for execution tests.

    Many execution tests call start_execution(), which requires
    a valid environment_id. This fixture creates a real environment
    in the temp storage so that environment validation passes.
    """
    from wavecore.api.services.environments import service as environment_service

    # Write the file too: the storage directory is the record, and a listing
    # reconciles against it, so a cache-only environment would not survive one.
    environment = {
        "id": TEST_ENVIRONMENT_ID,
        "name": "Test Environment",
        "tags": [],
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }
    environment_service._save_environment(environment)
    environment_service._environments[TEST_ENVIRONMENT_ID] = environment

    yield TEST_ENVIRONMENT_ID

    # Cleanup happens via clear_environment_storage on next test


_WORKBENCH_START_MOCK_FILES = {
    "test_execution_service.py",
    "test_execution_persistence.py",
    "test_execution_endpoints.py",
}


@pytest.fixture(autouse=True)
def mock_workbench_start_for_executions(
    request: pytest.FixtureRequest,
) -> Generator[Any, None, None]:
    """No-op `workbench_service.start_workbench_run` for execution unit tests
    so they do not require a seeded workbench test record.

    Tracked executions delegate to the workbench engine, which refuses to start
    without a real Test in storage. Most execution unit tests stub `_get_entity`
    only, so without this mock they all blow up inside the workbench call.
    Scoped to the three execution test files so workbench-service tests keep
    exercising the real function.
    """
    test_file = request.node.fspath.basename if hasattr(request.node, "fspath") else ""
    if test_file not in _WORKBENCH_START_MOCK_FILES:
        yield None
        return

    from wavecore.api.services.workbench import service as workbench_service

    with patch.object(workbench_service, "start_workbench_run") as mock_start:
        mock_start.return_value = {
            "session_id": "mock-session",
            "status": "running",
            "websocket_topic": "workbench:mock-session",
            "warnings": [],
        }
        yield mock_start


@pytest.fixture
def mock_ssh_session():
    """Mock asyncssh module for SSH session plugin tests."""
    with patch("wavecore.plugins.ssh_session_open.AsyncSSH") as mock:
        yield mock


def create_test_plugin(**kwargs):
    """Helper to create a test Plugin with proper metadata structure.

    Args:
        **kwargs: Plugin fields. If flat fields (name, description, etc.) are provided,
                 they will be converted to nested metadata structure.
    """
    from wavecore.models.plugins import Plugin, PluginMetadata

    # Extract flat fields if provided
    name = kwargs.pop("name", "Test Plugin")
    description = kwargs.pop("description", "Test description")
    author = kwargs.pop("author", "Test Author")
    category = kwargs.pop("category", "system")
    tags = kwargs.pop("tags", [])

    # Create metadata if not provided
    if "metadata" not in kwargs:
        kwargs["metadata"] = PluginMetadata(
            name=name,
            description=description,
            author=author,
            category=category,
            tags=tags,
        )

    # Set defaults for required fields
    kwargs.setdefault("id", "test-plugin")
    kwargs.setdefault("version", "1.0.0")
    kwargs.setdefault("parameters", [])

    return Plugin(**kwargs)


def create_test_block(**kwargs):
    """Helper to create a test Block with proper metadata structure.

    Args:
        **kwargs: Block fields. If flat fields (name, description, etc.) are provided,
                 they will be converted to nested metadata structure.
    """
    from wavecore.models.blocks import Block
    from wavecore.models.controls.reference import ControlReference
    from wavecore.models.enums import ControlId
    from wavecore.models.plugins import BlockMetadata

    # Extract flat fields if provided
    name = kwargs.pop("name", "Test Block")
    description = kwargs.pop("description", "Test description")
    author = kwargs.pop("author", "Test Author")
    tags = kwargs.pop("tags", [])
    created_at = kwargs.pop("created_at", None)
    updated_at = kwargs.pop("updated_at", None)

    # Create metadata if not provided
    if "metadata" not in kwargs:
        metadata_kwargs = {
            "name": name,
            "description": description,
            "author": author,
            "tags": tags,
        }
        if created_at is not None:
            metadata_kwargs["created_at"] = created_at
        if updated_at is not None:
            metadata_kwargs["updated_at"] = updated_at

        kwargs["metadata"] = BlockMetadata(**metadata_kwargs)

    # Set defaults for required fields
    kwargs.setdefault("id", "test-block")
    kwargs.setdefault("version", "1.0.0")
    kwargs.setdefault("type", "action")
    kwargs.setdefault("plugin_id", "test-plugin")

    # Add control_reference for control type blocks (REQ-3.5.0.6)
    if kwargs.get("type") == "control" and "control_reference" not in kwargs:
        kwargs["control_reference"] = ControlReference(
            control_id=ControlId.IF_ELSE,
            control_version="1.0.0",
        )

    return Block(**kwargs)
