"""Unit tests for backup service module.

Tests backup creation, validation, restoration, and schedule management.
Covers all entity types (Tests, Environments, Profiles, Suites, Regressions,
trusted SSH hosts, Additional Certificates),
archive format, credential masking, compression, manifest, dependency ordering,
the periodic schedule kept in the config file, and background scheduler.
"""

import asyncio
import contextlib
import io
import json
import logging
import re
import uuid
import zipfile
from collections.abc import Awaitable, Callable, Coroutine, Generator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch

import asyncssh
import pytest
import yaml
from cryptography.hazmat.primitives import hashes

from tests.plugins.http.tls_material import Credential, make_credential
from wavecore.api.exceptions import ValidationException


@pytest.fixture(autouse=True)
def clear_all_service_caches(temp_storage_path: Path) -> None:
    """Clear all entity service caches before each test."""
    from wavecore.api.services.profiles import _common as _profile_common
    from wavecore.api.services.suites import _storage as _suite_storage
    from wavecore.api.services.tests import service as test_service

    test_service._clear_storage()
    _profile_common._clear_storage()
    _suite_storage._clear_storage()
    # regression_service and block_service use storage dir which is fresh per test


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_test(name: str = "My Test", *, test_id: str | None = None) -> dict[str, Any]:
    now = datetime.now(UTC).isoformat()
    return {
        "id": test_id or str(uuid.uuid4()),
        "name": name,
        "version": "1.0.0",
        "description": f"{name} description",
        "workflow": {"nodes": [], "edges": []},
        "variables": {},
        "metadata": {},
        "created_at": now,
        "updated_at": now,
    }


def _make_environment(name: str = "Staging", *, env_id: str | None = None) -> dict[str, Any]:
    now = datetime.now(UTC).isoformat()
    return {
        "id": env_id or str(uuid.uuid4()),
        "name": name,
        "description": f"{name} env",
        "tags": ["env"],
        "created_at": now,
        "updated_at": now,
    }


def _make_profile(
    name: str = "Default Profile", *, profile_id: str | None = None
) -> dict[str, Any]:
    now = datetime.now(UTC).isoformat()
    return {
        "id": profile_id or str(uuid.uuid4()),
        "name": name,
        "type": "custom",
        "description": f"{name} profile",
        "config": {"host": "localhost"},
        "environment_values": {},
        "tags": ["profile"],
        "created_at": now,
        "updated_at": now,
    }


def _make_suite(name: str = "Suite Alpha", *, suite_id: str | None = None) -> dict[str, Any]:
    now = datetime.now(UTC).isoformat()
    return {
        "id": suite_id or str(uuid.uuid4()),
        "name": name,
        "version": "1.0.0",
        "description": f"{name} description",
        "tests": [],
        "tags": [],
        "variables": {},
        "metadata": {},
        "created_at": now,
        "updated_at": now,
    }


def _make_regression(
    name: str = "Regression One", *, regression_id: str | None = None
) -> dict[str, Any]:
    now = datetime.now(UTC).isoformat()
    return {
        "id": regression_id or str(uuid.uuid4()),
        "name": name,
        "version": "1.0.0",
        "description": f"{name} description",
        "suites": [],
        "tags": [],
        "variables": {},
        "metadata": {},
        "created_at": now,
        "updated_at": now,
    }


def _build_backup_zip(
    entities: dict[str, list[dict[str, Any]]],
    fmt: str = "yaml",
    manifest_overrides: dict[str, Any] | None = None,
    *,
    include_manifest: bool = True,
    raw_members: list[tuple[str, bytes]] | None = None,
) -> bytes:
    """Build a backup ZIP in-memory for testing restore/validate."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        counts: dict[str, int] = {}
        for entity_type, items in entities.items():
            counts[entity_type] = len(items)
            for item in items:
                name = item.get("name", item.get("id", "unknown"))
                ext = "json" if fmt == "json" else "yaml"
                path = f"{entity_type}/{name}.{ext}"
                if fmt == "json":
                    content = json.dumps(item, indent=2)
                else:
                    content = yaml.dump(item, default_flow_style=False, sort_keys=False)
                zf.writestr(path, content)

        for member, payload in raw_members or []:
            zf.writestr(member, payload)

        if include_manifest:
            manifest: dict[str, Any] = {
                "wave_version": "1.0.0",
                "created_at": datetime.now(UTC).isoformat(),
                "entity_counts": counts,
                "compression": {"method": "deflate", "level": 6},
                "format": fmt,
                "secrets": "mask",
                "schema_version": "1.0",
            }
            if manifest_overrides:
                manifest.update(manifest_overrides)
            zf.writestr("manifest.json", json.dumps(manifest, indent=2))

    return buf.getvalue()


# The nine backup parts in display order (REQ-5.2.4.9.2).
_BACKUP_PARTS = (
    "tests",
    "environments",
    "profiles",
    "suites",
    "regressions",
    "functions",
    "system_variables",
    "ssh_hosts",
    "certificates",
)

_ALREADY_HERE = r"^Already in this WAVE$"
_NAME_IN_USE = r"^Name already in use$"
_HAS_NO_NAME = r"^Has no name$"
_CANNOT_BE_READ = r"^Cannot be read$"
_UNREADABLE_KEY = r"^Unreadable key$"
_NOT_A_CERTIFICATE = r"^Not a valid certificate$"


@pytest.fixture
def one_system_variable(temp_storage_path: Path) -> Generator[None, None, None]:
    """One stored system variable, removed again after the test."""
    from wavecore.api.services import variable_service

    variable_service.set_system_variables(
        {"api_url": {"type": "string", "value": "https://example.com"}}
    )
    yield
    variable_service.delete_all_system_variables()


def _members(zip_bytes: bytes, entity_type: str) -> list[dict[str, Any]]:
    """The YAML documents of one part of an archive, without a test's data files."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        return [
            yaml.safe_load(zf.read(name))
            for name in zf.namelist()
            if name.startswith(f"{entity_type}/") and not name.startswith("tests/testdata/")
        ]


def _seed_function(name: str) -> str:
    """One library Function with an empty body; returns its id."""
    from wavecore.api.services.functions import service as function_service

    definition, _etag = function_service.create_function(
        {"name": name, "workflow": {"nodes": [], "edges": []}}
    )
    return str(definition["id"])


def _seed_with_history(entity_type: str) -> str:
    """One stored Test, Suite or Regression with two history rows; returns its id."""
    from wavecore.api.services.regressions import service as regression_service
    from wavecore.api.services.suites import service as suite_service
    from wavecore.api.services.tests import service as test_service

    change = {"description": "Second version"}
    if entity_type == "tests":
        created = test_service.create_test(
            {"name": "History Item", "workflow": {"nodes": [], "edges": []}}
        )
        test_service.update_test(created["id"], change)
    elif entity_type == "suites":
        created = suite_service.create_suite({"name": "History Item", "tests": []})
        suite_service.update_suite(created["id"], change)
    else:
        created = regression_service.create_regression({"name": "History Item", "suites": []})
        regression_service.update_regression(created["id"], change)
    return str(created["id"])


def _stored_history(entity_type: str, entity_id: str) -> list[dict[str, Any]]:
    """The history rows in the item's own versions file."""
    from wavecore.api.services import storage_paths

    folders = {
        "tests": storage_paths.get_tests_storage_path,
        "suites": storage_paths.get_suites_storage_path,
        "regressions": storage_paths.get_regressions_storage_path,
    }
    versions_file = folders[entity_type]() / entity_id / "versions.yaml"
    rows: list[dict[str, Any]] = yaml.safe_load(versions_file.read_text(encoding="utf-8"))
    return rows


def _options_archive() -> bytes:
    """A Regression that lists a Suite of the same archive, and a profile without a type."""
    suite = _make_suite("Linked Suite")
    regression = {**_make_regression("Linked Regression"), "suites": [suite["id"]]}
    profile = _make_profile("Untyped Profile")
    del profile["type"]
    return _build_backup_zip(
        {"suites": [suite], "regressions": [regression], "profiles": [profile]}
    )


def _split_items(part: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """One preview or result part as its counts and its items."""
    counts = dict(part)
    items = counts.pop("items", None)
    assert items is not None
    return counts, items


def _assert_items(items: list[dict[str, str]], expected: list[tuple[str, str, str]]) -> None:
    """Each item holds exactly its name, its status and a reason that matches its pattern."""
    assert [(item["name"], item["status"]) for item in items] == [
        (name, status) for name, status, _reason in expected
    ]
    for item, (_name, _status, reason) in zip(items, expected, strict=True):
        assert set(item) == {"name", "status", "reason"}
        assert re.fullmatch(reason, item["reason"])


def _names(part: dict[str, Any], status: str) -> list[str]:
    """The names of the items of one part that have the status, sorted."""
    return sorted(item["name"] for item in part.get("items", []) if item["status"] == status)


def _result_counts(imported: int = 0, skipped: int = 0, fatal: int = 0) -> dict[str, int]:
    return {"imported": imported, "skipped": skipped, "fatal": fatal}


def _result_part(imported: int = 0, skipped: int = 0, fatal: int = 0) -> dict[str, Any]:
    """One part of a restore result that names no item."""
    return {**_result_counts(imported, skipped, fatal), "items": []}


# ============================================================================
# Constants and Entity Types
# ============================================================================


class TestBackupConstants:
    """Tests for backup service constants and configuration."""

    def test_backup_entity_types(self) -> None:
        from wavecore.api.services.backup._helpers import BACKUP_ENTITY_TYPES

        assert BACKUP_ENTITY_TYPES == _BACKUP_PARTS

    def test_restore_order(self) -> None:
        from wavecore.api.services.backup._helpers import RESTORE_ORDER

        assert RESTORE_ORDER == [
            "system_variables",
            "environments",
            "profiles",
            "functions",
            "tests",
            "suites",
            "regressions",
            "ssh_hosts",
            "certificates",
        ]

    def test_compression_methods(self) -> None:
        from wavecore.api.services.backup._helpers import COMPRESSION_METHODS

        assert COMPRESSION_METHODS == {"stored", "deflate", "bzip2", "lzma"}


# ============================================================================
# Create Backup
# ============================================================================


class TestCreateBackup:
    """Tests for backup creation."""

    def test_create_backup_empty_entities(self) -> None:
        """Creating backup with no entities in storage produces ZIP with manifest only."""
        from wavecore.api.services.backup.service import create_backup

        zip_bytes, filename = create_backup(entity_types=["tests"])

        assert filename.startswith("wave-backup-")
        assert filename.endswith(".zip")
        assert len(zip_bytes) > 0

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = zf.namelist()
            assert "manifest.json" in names
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["entity_counts"]["tests"] == 0

    def test_create_backup_with_tests(self, temp_storage_path: Path) -> None:
        """Backup includes test entities serialized in the chosen format."""
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.tests import service as test_service

        # Create test entities
        test_service.create_test({"name": "Test One", "workflow": {"nodes": [], "edges": []}})
        test_service.create_test({"name": "Test Two", "workflow": {"nodes": [], "edges": []}})

        zip_bytes, _filename = create_backup(entity_types=["tests"], fmt="yaml")

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["entity_counts"]["tests"] == 2
            assert manifest["format"] == "yaml"
            # Verify test files exist under tests/ directory
            test_files = [n for n in zf.namelist() if n.startswith("tests/")]
            assert len(test_files) == 2
            # Each file should be valid YAML
            for tf in test_files:
                data = yaml.safe_load(zf.read(tf))
                assert "name" in data

    def test_create_backup_with_environments(self, temp_storage_path: Path) -> None:
        """Backup includes environment entities."""
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.environments import service as environment_service

        # Clear autouse seed environment to make count deterministic
        environment_service._clear_storage()
        environment_service.create_environment("Prod", tags=["prod"])

        zip_bytes, _ = create_backup(entity_types=["environments"])

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["entity_counts"]["environments"] == 1

    def test_create_backup_with_profiles(self, temp_storage_path: Path) -> None:
        """Backup includes profile entities."""
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.profiles import service as profile_service

        profile_service.create_profile("My Profile", "custom", config={})

        zip_bytes, _ = create_backup(entity_types=["profiles"])

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["entity_counts"]["profiles"] == 1

    def test_a_yaml_backup_writes_every_number_in_plain_digits(
        self, temp_storage_path: Path
    ) -> None:
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.profiles import service as profile_service

        profile = {
            "id": "id-rates",
            "name": "Rates",
            "type": "custom",
            "config": {"rate": {"type": "float", "value": 1e-05}, "big": 1e20},
            "environment_values": {},
        }
        profile_service.persist_profile_document(profile)

        zip_bytes, _ = create_backup(entity_types=["profiles"])

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            text = zf.read("profiles/Rates.yaml").decode("utf-8")
        assert "e-05" not in text and "e+20" not in text
        assert "value: 0.00001" in text
        assert "big: 100000000000000000000.0" in text
        assert yaml.safe_load(text)["config"] == profile["config"]

    def test_create_backup_with_suites(self, temp_storage_path: Path) -> None:
        """Backup includes suite entities."""
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.suites import service as suite_service

        suite_service.create_suite({"name": "Suite A", "tests": []})

        zip_bytes, _ = create_backup(entity_types=["suites"])

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["entity_counts"]["suites"] == 1

    def test_create_backup_with_regressions(self, temp_storage_path: Path) -> None:
        """Backup includes regression entities."""
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.regressions import service as regression_service

        regression_service.create_regression({"name": "Reg A", "suites": []})

        zip_bytes, _ = create_backup(entity_types=["regressions"])

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["entity_counts"]["regressions"] == 1

    def test_create_backup_multiple_entity_types(self, temp_storage_path: Path) -> None:
        """Backup can include multiple entity types in one archive."""
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.environments import service as environment_service
        from wavecore.api.services.tests import service as test_service

        environment_service._clear_storage()
        test_service.create_test({"name": "T1", "workflow": {"nodes": [], "edges": []}})
        environment_service.create_environment("E1", tags=[])

        zip_bytes, _ = create_backup(entity_types=["tests", "environments"])

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["entity_counts"]["tests"] == 1
            assert manifest["entity_counts"]["environments"] == 1

    def test_create_backup_json_format(self, temp_storage_path: Path) -> None:
        """Backup in JSON format serializes entities as JSON."""
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.environments import service as environment_service

        environment_service._clear_storage()
        environment_service.create_environment("JsonEnv", tags=[])

        zip_bytes, _ = create_backup(entity_types=["environments"], fmt="json")

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["format"] == "json"
            env_files = [n for n in zf.namelist() if n.startswith("environments/")]
            assert len(env_files) == 1
            assert env_files[0].endswith(".json")
            data = json.loads(zf.read(env_files[0]))
            assert data["name"] == "JsonEnv"

    def test_create_backup_manifest_structure(self, temp_storage_path: Path) -> None:
        """Manifest contains all required fields."""
        from wavecore.api.services.backup.service import create_backup

        zip_bytes, _ = create_backup(entity_types=["tests"])

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert "wave_version" in manifest
            assert "created_at" in manifest
            assert "entity_counts" in manifest
            assert "compression" in manifest
            assert "method" in manifest["compression"]
            assert "level" in manifest["compression"]
            assert "format" in manifest
            assert "secrets" in manifest
            assert "schema_version" in manifest
            assert manifest["schema_version"] == "1.0"

    def test_create_backup_default_compression(self) -> None:
        """Default compression is Deflate level 6."""
        from wavecore.api.services.backup.service import create_backup

        zip_bytes, _ = create_backup(entity_types=["tests"])

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["compression"]["method"] == "deflate"
            assert manifest["compression"]["level"] == 6

    def test_create_backup_takes_a_level_sent_as_its_digits(self) -> None:
        from wavecore.api.services.backup.service import create_backup

        zip_bytes, _ = create_backup(
            entity_types=["tests"], compression_method="bzip2", compression_level="9"
        )

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["compression"]["level"] == 9

    @pytest.mark.parametrize("level", ["abc", 5.5, True])
    def test_create_backup_refuses_a_level_that_is_not_a_whole_number(self, level: Any) -> None:
        from wavecore.api.services.backup.service import create_backup

        with pytest.raises(
            ValidationException, match="^Compression level must be between 1 and 9$"
        ):
            create_backup(entity_types=["tests"], compression_level=level)

    def test_create_backup_stored_compression(self) -> None:
        """Stored compression stores files without compression."""
        from wavecore.api.services.backup.service import create_backup

        zip_bytes, _ = create_backup(
            entity_types=["tests"],
            compression_method="stored",
            compression_level=0,
        )

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["compression"]["method"] == "stored"

    def test_create_backup_bzip2_compression(self) -> None:
        """Bzip2 compression method is supported."""
        from wavecore.api.services.backup.service import create_backup

        zip_bytes, _ = create_backup(
            entity_types=["tests"],
            compression_method="bzip2",
            compression_level=9,
        )

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["compression"]["method"] == "bzip2"
            assert manifest["compression"]["level"] == 9

    def test_create_backup_lzma_compression(self) -> None:
        """LZMA compression method is supported."""
        from wavecore.api.services.backup.service import create_backup

        zip_bytes, _ = create_backup(
            entity_types=["tests"],
            compression_method="lzma",
        )

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["compression"]["method"] == "lzma"

    def test_create_backup_invalid_compression_method(self) -> None:
        """Invalid compression method raises ValueError."""
        from wavecore.api.services.backup.service import create_backup

        with pytest.raises(ValidationException, match="^Invalid compression method: 'gzip'$"):
            create_backup(entity_types=["tests"], compression_method="gzip")

    def test_create_backup_invalid_compression_level(self) -> None:
        """Compression level outside 1-9 raises ValueError."""
        from wavecore.api.services.backup.service import create_backup

        with pytest.raises(
            ValidationException, match="^Compression level must be between 1 and 9$"
        ):
            create_backup(
                entity_types=["tests"],
                compression_method="deflate",
                compression_level=10,
            )

    def test_create_backup_invalid_format(self) -> None:
        """Invalid format raises ValueError."""
        from wavecore.api.services.backup.service import create_backup

        with pytest.raises(ValidationException, match="^Invalid format: 'xml'$"):
            create_backup(entity_types=["tests"], fmt="xml")

    def test_create_backup_unknown_entity_type(self) -> None:
        """Unknown entity types are rejected."""
        from wavecore.api.services.backup.service import create_backup

        with pytest.raises(ValidationException, match="^Unknown entity type: 'widgets'$"):
            create_backup(entity_types=["widgets"])

    def test_plugins_is_an_unknown_entity_type(self) -> None:
        from wavecore.api.services.backup.service import create_backup

        with pytest.raises(ValidationException, match="^Unknown entity type: 'plugins'$"):
            create_backup(entity_types=["plugins"])

    def test_create_backup_empty_entity_types(self) -> None:
        """Empty entity type list raises ValueError."""
        from wavecore.api.services.backup.service import create_backup

        with pytest.raises(
            ValidationException, match="^At least one entity type must be selected$"
        ):
            create_backup(entity_types=[])

    def test_create_backup_masks_secrets_by_default(self, temp_storage_path: Path) -> None:
        """Secrets are masked by default in backup."""
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.tests import service as test_service

        test_service.create_test(
            {
                "name": "Secret Test",
                "workflow": {"nodes": [], "edges": []},
                "variables": {
                    "api_key": {"value": "super-secret", "secret": True},
                    "host": {"value": "localhost", "secret": False},
                },
            }
        )

        zip_bytes, _ = create_backup(entity_types=["tests"], secrets="mask")

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["secrets"] == "mask"
            test_files = [n for n in zf.namelist() if n.startswith("tests/")]
            data = yaml.safe_load(zf.read(test_files[0]))
            variables = data.get("variables", {})
            # Secret should be masked
            assert variables["api_key"]["value"] == "********"
            # Non-secret should be preserved
            assert variables["host"]["value"] == "localhost"

    def test_create_backup_encrypted_mode_keeps_sealed_form(self, temp_storage_path: Path) -> None:
        """secrets=encrypted keeps secrets in their sealed stored form."""
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.tests import service as test_service
        from wavecore.core.secrets.cipher import is_secret_envelope
        from wavecore.core.secrets.sealing import unseal_all

        test_service.create_test(
            {
                "name": "Creds Test",
                "workflow": {"nodes": [], "edges": []},
                "variables": {
                    "api_key": {"value": "super-secret", "secret": True},
                },
            }
        )

        zip_bytes, _ = create_backup(entity_types=["tests"], secrets="encrypted")

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["secrets"] == "encrypted"
            test_files = [n for n in zf.namelist() if n.startswith("tests/")]
            data = yaml.safe_load(zf.read(test_files[0]))
            variables = data.get("variables", {})
            assert is_secret_envelope(variables["api_key"]["value"])
            assert unseal_all(variables["api_key"]["value"]) == "super-secret"

    def test_create_backup_plaintext_mode_decrypts_secrets(self, temp_storage_path: Path) -> None:
        """secrets=plaintext writes decrypted real values into the archive."""
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.tests import service as test_service

        test_service.create_test(
            {
                "name": "Plain Test",
                "workflow": {"nodes": [], "edges": []},
                "variables": {
                    "api_key": {"value": "super-secret", "secret": True},
                },
            }
        )

        zip_bytes, _ = create_backup(entity_types=["tests"], secrets="plaintext")

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["secrets"] == "plaintext"
            test_files = [n for n in zf.namelist() if n.startswith("tests/")]
            data = yaml.safe_load(zf.read(test_files[0]))
            variables = data.get("variables", {})
            assert variables["api_key"]["value"] == "super-secret"

    def test_create_backup_applies_secrets_mode_to_profile_credentials(
        self, temp_storage_path: Path
    ) -> None:
        """Backup applies the secrets mode to profile credential fields, not just variables."""
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.profiles import service as profile_service

        profile_service.create_profile(
            "DB Prod",
            "database",
            config={"host": "localhost", "password": "db-secret"},
        )

        zip_bytes, _ = create_backup(entity_types=["profiles"], secrets="mask")

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            profile_files = [n for n in zf.namelist() if n.startswith("profiles/")]
            data = yaml.safe_load(zf.read(profile_files[0]))
            assert data["config"]["password"] == "********"

    def test_create_backup_all_enabled_types(self, temp_storage_path: Path) -> None:
        """All enabled entity types can be included in one backup."""
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.environments import service as environment_service
        from wavecore.api.services.profiles import service as profile_service
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        environment_service._clear_storage()
        test_service.create_test({"name": "T1", "workflow": {"nodes": [], "edges": []}})
        environment_service.create_environment("E1", tags=[])
        profile_service.create_profile("P1", "custom", config={})
        suite_service.create_suite({"name": "S1", "tests": []})
        regression_service.create_regression({"name": "R1", "suites": []})

        zip_bytes, _ = create_backup(
            entity_types=[
                "tests",
                "environments",
                "profiles",
                "suites",
                "regressions",
            ]
        )

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["entity_counts"]["tests"] == 1
            assert manifest["entity_counts"]["environments"] == 1
            assert manifest["entity_counts"]["profiles"] == 1
            assert manifest["entity_counts"]["suites"] == 1
            assert manifest["entity_counts"]["regressions"] == 1

    @pytest.mark.usefixtures("one_system_variable")
    def test_create_backup_with_every_part(
        self,
        hosts_file: Path,
        certificates_file: Path,
        ssh_keys: dict[str, asyncssh.SSHKey],
        authorities: dict[str, Credential],
    ) -> None:
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.profiles import service as profile_service
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service
        from wavecore.api.services.tests import service as test_service

        # The Environments part holds the one environment conftest seeds.
        test_service.create_test({"name": "T1", "workflow": {"nodes": [], "edges": []}})
        profile_service.create_profile("P1", "custom", config={})
        suite_service.create_suite({"name": "S1", "tests": []})
        regression_service.create_regression({"name": "R1", "suites": []})
        _seed_function("bk_fn")
        _write_yaml(hosts_file, {"hosts": [_host_entry("a" * 32, "db1", 22, ssh_keys["ed25519"])]})
        _write_yaml(certificates_file, {"certificates": [_certificate_entry(authorities["root"])]})

        zip_bytes, _ = create_backup(entity_types=list(_BACKUP_PARTS))

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
        assert manifest["entity_counts"] == dict.fromkeys(_BACKUP_PARTS, 1)
        assert list(manifest["entity_counts"]) == list(_BACKUP_PARTS)

    @pytest.mark.parametrize("entity_type", ["tests", "suites", "regressions"])
    def test_a_member_carries_its_version_history(self, entity_type: str) -> None:
        from wavecore.api.services.backup.service import create_backup

        item_id = _seed_with_history(entity_type)
        stored = _stored_history(entity_type, item_id)

        zip_bytes, _ = create_backup(entity_types=[entity_type])

        (member,) = _members(zip_bytes, entity_type)
        assert len(stored) == 2
        assert member.get("version_history") == stored

    @pytest.mark.parametrize("mode", ["mask", "encrypted", "plaintext"])
    def test_regression_history_snapshots_follow_the_secrets_mode(self, mode: str) -> None:
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.core.secrets.cipher import is_secret_envelope

        created = regression_service.create_regression(
            {
                "name": "Secret Regression",
                "suites": [],
                "variables": {"api_key": {"value": "super-secret", "secret": True}},
            }
        )
        regression_service.update_regression(created["id"], {"description": "Second version"})
        sealed = [
            row["snapshot"]["variables"]["api_key"]["value"]
            for row in _stored_history("regressions", created["id"])
        ]
        expected = {
            "mask": ["********", "********"],
            "encrypted": sealed,
            "plaintext": ["super-secret", "super-secret"],
        }

        zip_bytes, _ = create_backup(entity_types=["regressions"], secrets=mode)

        (member,) = _members(zip_bytes, "regressions")
        assert len(sealed) == 2
        assert all(is_secret_envelope(value) for value in sealed)
        assert [
            row["snapshot"]["variables"]["api_key"]["value"]
            for row in member.get("version_history", [])
        ] == expected[mode]

    def test_an_environment_member_has_no_usage_key(self) -> None:
        from wavecore.api.services import storage_paths
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.environments import service as environment_service

        created = environment_service.create_environment(
            "Prod", description="Production", tags=["prod"]
        )
        stored = _read_yaml(
            storage_paths.get_environments_storage_path() / created["id"] / "environment.yaml"
        )

        zip_bytes, _ = create_backup(entity_types=["environments"])

        member = next(
            document
            for document in _members(zip_bytes, "environments")
            if document["id"] == created["id"]
        )
        assert stored.get("name") == "Prod"
        assert "usage" not in member
        assert member == stored

    def test_a_profile_that_appeared_after_the_cache_warmed_is_in_the_archive(self) -> None:
        from wavecore.api.services import storage_paths
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.profiles import service as profile_service

        profile_service.create_profile("Warm Profile", "custom", config={})
        assert [p["name"] for p in profile_service.list_profiles()["profiles"]] == ["Warm Profile"]
        late = _make_profile("Late Profile")
        _write_yaml(storage_paths.get_profiles_storage_path() / late["id"] / "profile.yaml", late)

        zip_bytes, _ = create_backup(entity_types=["profiles"])

        names = sorted(document["name"] for document in _members(zip_bytes, "profiles"))
        assert names == ["Late Profile", "Warm Profile"]

    def test_the_manifest_keeps_schema_version_1_0(self) -> None:
        from wavecore.api.services.backup.service import create_backup

        zip_bytes, _ = create_backup(entity_types=list(_BACKUP_PARTS))

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
        assert manifest["schema_version"] == "1.0"


# ============================================================================
# Validate Backup
# ============================================================================


class TestValidateBackup:
    """Tests for backup validation (preview before restore)."""

    def test_validate_valid_backup(self) -> None:
        """Valid backup returns metadata and entity summaries."""
        from wavecore.api.services.backup.service import validate_backup

        entities = {
            "tests": [_make_test("T1"), _make_test("T2")],
            "environments": [_make_environment("E1")],
        }
        zip_bytes = _build_backup_zip(entities)

        result = validate_backup(zip_bytes, "backup.zip")

        assert "metadata" in result
        assert result["metadata"]["format"] == "yaml"
        assert result["metadata"]["schema_version"] == "1.0"
        assert "entity_summary" in result
        assert "tests" in result["entity_summary"]
        assert result["entity_summary"]["tests"]["total"] == 2
        assert "environments" in result["entity_summary"]
        assert result["entity_summary"]["environments"]["total"] == 1

    def test_validate_shows_ok_status(self) -> None:
        """Entities with no conflicts show ok status."""
        from wavecore.api.services.backup.service import validate_backup

        entities = {"environments": [_make_environment("NewEnv")]}
        zip_bytes = _build_backup_zip(entities)

        result = validate_backup(zip_bytes, "backup.zip")

        env_summary = result["entity_summary"]["environments"]
        assert env_summary["ok"] >= 1

    def test_validate_shows_conflict_status(self, temp_storage_path: Path) -> None:
        """Entities matching existing names show conflict status."""
        from wavecore.api.services.backup.service import validate_backup
        from wavecore.api.services.environments import service as environment_service

        environment_service.create_environment("Existing", tags=[])

        entities = {"environments": [_make_environment("Existing")]}
        zip_bytes = _build_backup_zip(entities)

        result = validate_backup(zip_bytes, "backup.zip")

        env_summary = result["entity_summary"]["environments"]
        assert env_summary["conflicts"] == 1

    def test_validate_shows_fatal_status(self) -> None:
        """Entities failing validation show fatal status."""
        from wavecore.api.services.backup.service import validate_backup

        # Environment with no name is fatal
        entities = {"environments": [{"id": str(uuid.uuid4()), "tags": []}]}
        zip_bytes = _build_backup_zip(entities)

        result = validate_backup(zip_bytes, "backup.zip")

        env_summary = result["entity_summary"]["environments"]
        assert env_summary["fatal"] == 1

    def test_validate_non_zip_rejected(self) -> None:
        """Non-ZIP files are rejected."""
        from wavecore.api.services.backup.service import validate_backup

        with pytest.raises(ValidationException, match="^Invalid backup file: not a ZIP archive$"):
            validate_backup(b"not a zip", "backup.zip")

    def test_validate_missing_manifest(self) -> None:
        """ZIP without manifest.json is rejected."""
        from wavecore.api.services.backup.service import validate_backup

        entities = {"tests": [_make_test("T1")]}
        zip_bytes = _build_backup_zip(entities, include_manifest=False)

        with pytest.raises(
            ValidationException, match="^Invalid backup archive: missing manifest.json$"
        ):
            validate_backup(zip_bytes, "backup.zip")

    def test_validate_corrupt_manifest(self) -> None:
        """ZIP with corrupt manifest.json is rejected."""
        from wavecore.api.services.backup.service import validate_backup

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("manifest.json", "not valid json{{{")
        zip_bytes = buf.getvalue()

        with pytest.raises(
            ValidationException, match="^Invalid backup archive: corrupt manifest.json$"
        ):
            validate_backup(zip_bytes, "backup.zip")

    def test_validate_non_zip_filename(self) -> None:
        """Non-.zip filename is rejected."""
        from wavecore.api.services.backup.service import validate_backup

        with pytest.raises(ValidationException, match="^Invalid backup file: must be a .zip file$"):
            validate_backup(b"data", "backup.yaml")

    def test_validate_returns_metadata(self) -> None:
        """Validation result includes backup metadata."""
        from wavecore.api.services.backup.service import validate_backup

        entities = {"tests": [_make_test("T1")]}
        zip_bytes = _build_backup_zip(
            entities,
            manifest_overrides={"wave_version": "2.0.0"},
        )

        result = validate_backup(zip_bytes, "backup.zip")

        assert result["metadata"]["wave_version"] == "2.0.0"
        assert "created_at" in result["metadata"]

    def test_validate_json_format_backup(self) -> None:
        """Validation handles JSON format backups."""
        from wavecore.api.services.backup.service import validate_backup

        entities = {"environments": [_make_environment("JsonEnv")]}
        zip_bytes = _build_backup_zip(entities, fmt="json")

        result = validate_backup(zip_bytes, "backup.zip")

        assert result["entity_summary"]["environments"]["total"] == 1

    def test_validate_test_entities(self) -> None:
        """Validation processes test entities."""
        from wavecore.api.services.backup.service import validate_backup

        entities = {"tests": [_make_test("ValidTest")]}
        zip_bytes = _build_backup_zip(entities)

        result = validate_backup(zip_bytes, "backup.zip")

        assert result["entity_summary"]["tests"]["total"] == 1
        assert result["entity_summary"]["tests"]["ok"] >= 0

    def test_validate_profile_entities(self) -> None:
        """Validation processes profile entities."""
        from wavecore.api.services.backup.service import validate_backup

        entities = {"profiles": [_make_profile("ValidProfile")]}
        zip_bytes = _build_backup_zip(entities)

        result = validate_backup(zip_bytes, "backup.zip")

        assert result["entity_summary"]["profiles"]["total"] == 1

    def test_validate_suite_entities(self) -> None:
        """Validation processes suite entities."""
        from wavecore.api.services.backup.service import validate_backup

        entities = {"suites": [_make_suite("ValidSuite")]}
        zip_bytes = _build_backup_zip(entities)

        result = validate_backup(zip_bytes, "backup.zip")

        assert result["entity_summary"]["suites"]["total"] == 1

    def test_validate_regression_entities(self) -> None:
        """Validation processes regression entities."""
        from wavecore.api.services.backup.service import validate_backup

        entities = {"regressions": [_make_regression("ValidReg")]}
        zip_bytes = _build_backup_zip(entities)

        result = validate_backup(zip_bytes, "backup.zip")

        assert result["entity_summary"]["regressions"]["total"] == 1

    def test_validate_multiple_entity_types(self) -> None:
        """Validation handles multiple entity types."""
        from wavecore.api.services.backup.service import validate_backup

        entities = {
            "tests": [_make_test("T1")],
            "environments": [_make_environment("E1")],
            "profiles": [_make_profile("P1")],
        }
        zip_bytes = _build_backup_zip(entities)

        result = validate_backup(zip_bytes, "backup.zip")

        assert len(result["entity_summary"]) == 3

    def test_validate_defaults_to_every_part_skip_and_no_auto_repair(self) -> None:
        from wavecore.api.services.backup.service import validate_backup
        from wavecore.api.services.profiles import service as profile_service

        profile_service.create_profile("Untyped Profile", "custom")
        archive = _options_archive()

        preview = validate_backup(archive, "backup.zip")

        assert preview == validate_backup(
            archive, "backup.zip", entity_types=None, conflict_resolution="skip", auto_repair=False
        )
        summary = preview["entity_summary"]
        assert summary["regressions"]["fatal"] == 0
        assert (summary["profiles"]["conflicts"], summary["profiles"]["fixable"]) == (1, 0)

    def test_an_absent_or_empty_part_list_means_every_part_of_the_file(self) -> None:
        from wavecore.api.services.backup.service import validate_backup

        archive = _options_archive()

        every_part = validate_backup(
            archive, "backup.zip", entity_types=["suites", "regressions", "profiles"]
        )

        assert every_part["entity_summary"]["regressions"]["fatal"] == 0
        assert validate_backup(archive, "backup.zip") == every_part
        assert validate_backup(archive, "backup.zip", entity_types=None) == every_part
        assert validate_backup(archive, "backup.zip", entity_types=[]) == every_part

    def test_validate_follows_the_ticked_parts_the_choice_and_auto_repair(self) -> None:
        from wavecore.api.services.backup.service import validate_backup
        from wavecore.api.services.profiles import service as profile_service

        profile_service.create_profile("Untyped Profile", "custom")
        archive = _options_archive()

        default = validate_backup(archive, "backup.zip")["entity_summary"]
        unticked = validate_backup(archive, "backup.zip", entity_types=["regressions", "profiles"])[
            "entity_summary"
        ]
        overwrite = validate_backup(archive, "backup.zip", conflict_resolution="overwrite")[
            "entity_summary"
        ]
        repaired = validate_backup(
            archive, "backup.zip", conflict_resolution="overwrite", auto_repair=True
        )["entity_summary"]

        assert (default["suites"]["ok"], default["regressions"]["fatal"]) == (1, 0)
        assert (unticked["suites"]["ok"], unticked["regressions"]["fatal"]) == (1, 1)
        assert _names(unticked["regressions"], "fatal") == ["Linked Regression"]
        assert (default["profiles"]["conflicts"], default["profiles"]["fixable"]) == (1, 0)
        assert (overwrite["profiles"]["conflicts"], overwrite["profiles"]["fixable"]) == (0, 1)
        # Auto-repair moves no preview count; it decides what the restore writes.
        assert repaired == overwrite

    def test_validate_refuses_an_unknown_conflict_resolution(self) -> None:
        from wavecore.api.services.backup.service import validate_backup

        archive = _build_backup_zip({"environments": [_make_environment("E1")]})

        with pytest.raises(ValidationException, match="^Unknown conflict resolution: 'merge'$"):
            validate_backup(archive, "backup.zip", conflict_resolution="merge")

    def test_validate_refuses_an_unknown_entity_type(self) -> None:
        from wavecore.api.services.backup.service import validate_backup

        archive = _build_backup_zip({"environments": [_make_environment("E1")]})

        with pytest.raises(ValidationException, match="^Unknown entity type: 'widgets'$"):
            validate_backup(archive, "backup.zip", entity_types=["environments", "widgets"])

    def test_validate_names_a_member_that_cannot_be_parsed(self) -> None:
        from wavecore.api.services.backup.service import validate_backup

        archive = _build_backup_zip(
            {"tests": [_make_test("Good Test")]},
            raw_members=[("tests/bad.json", b"{not valid json!!!}")],
        )

        counts, items = _split_items(
            validate_backup(archive, "backup.zip")["entity_summary"]["tests"]
        )

        assert counts == {**_counts(2, ok=1, fatal=1), "testdata_files": 0}
        _assert_items(items, [("bad.json", "fatal", _CANNOT_BE_READ)])

    def test_validate_names_a_member_that_is_not_a_mapping(self) -> None:
        from wavecore.api.services.backup.service import validate_backup

        archive = _build_backup_zip(
            {"tests": [_make_test("Good Test")]},
            raw_members=[("tests/list.yaml", b"- one\n- two\n")],
        )

        counts, items = _split_items(
            validate_backup(archive, "backup.zip")["entity_summary"]["tests"]
        )

        assert counts == {**_counts(2, ok=1, fatal=1), "testdata_files": 0}
        _assert_items(items, [("list.yaml", "fatal", _CANNOT_BE_READ)])


# ============================================================================
# Restore Backup
# ============================================================================


class TestRestoreBackup:
    """Tests for backup restoration."""

    def test_restore_creates_entities(self, temp_storage_path: Path) -> None:
        """Restore creates entities in storage."""
        from wavecore.api.services.backup.service import restore_backup
        from wavecore.api.services.environments import service as environment_service

        entities = {"environments": [_make_environment("RestoreEnv")]}
        zip_bytes = _build_backup_zip(entities)

        result = restore_backup(zip_bytes, "backup.zip")

        assert result == {"environments": _result_part(imported=1)}
        # Verify environment was actually created
        envs = environment_service.list_environments()
        names = [e["name"] for e in envs["environments"]]
        assert "RestoreEnv" in names

    def test_restore_dependency_order(self, temp_storage_path: Path) -> None:
        """Restore processes entities in dependency order."""
        from wavecore.api.services.backup.service import restore_backup

        entities = {
            "tests": [_make_test("T1")],
            "environments": [_make_environment("E1")],
            "profiles": [_make_profile("P1")],
        }
        zip_bytes = _build_backup_zip(entities)

        result = restore_backup(zip_bytes, "backup.zip")

        # All should be restored
        assert result == {
            "tests": _result_part(imported=1),
            "environments": _result_part(imported=1),
            "profiles": _result_part(imported=1),
        }

    def test_restore_selective_entity_types(self, temp_storage_path: Path) -> None:
        """Restore only selected entity types."""
        from wavecore.api.services.backup.service import restore_backup

        entities = {
            "tests": [_make_test("T1")],
            "environments": [_make_environment("E1")],
        }
        zip_bytes = _build_backup_zip(entities)

        result = restore_backup(zip_bytes, "backup.zip", entity_types=["environments"])

        assert result == {"environments": _result_part(imported=1)}

    def test_restore_conflict_skip(self, temp_storage_path: Path) -> None:
        """Conflict resolution 'skip' skips conflicting entities."""
        from wavecore.api.services.backup.service import restore_backup
        from wavecore.api.services.environments import service as environment_service

        environment_service.create_environment("Existing", tags=[])

        entities = {"environments": [_make_environment("Existing")]}
        zip_bytes = _build_backup_zip(entities)

        result = restore_backup(zip_bytes, "backup.zip", conflict_resolution="skip")

        counts, items = _split_items(result["environments"])
        assert counts == _result_counts(skipped=1)
        _assert_items(items, [("Existing", "skipped", _NAME_IN_USE)])

    def test_restore_conflict_overwrite(self, temp_storage_path: Path) -> None:
        """Conflict resolution 'overwrite' replaces existing entities."""
        from wavecore.api.services.backup.service import restore_backup
        from wavecore.api.services.environments import service as environment_service

        environment_service.create_environment("Overwrite Me", tags=["old"])

        new_env = _make_environment("Overwrite Me")
        new_env["tags"] = ["new"]
        entities = {"environments": [new_env]}
        zip_bytes = _build_backup_zip(entities)

        result = restore_backup(zip_bytes, "backup.zip", conflict_resolution="overwrite")

        assert result == {"environments": _result_part(imported=1)}

    def test_restore_conflict_rename(self, temp_storage_path: Path) -> None:
        """Conflict resolution 'rename' creates entity with new name."""
        from wavecore.api.services.backup.service import restore_backup
        from wavecore.api.services.environments import service as environment_service

        environment_service.create_environment("DupeName", tags=[])

        entities = {"environments": [_make_environment("DupeName")]}
        zip_bytes = _build_backup_zip(entities)

        result = restore_backup(zip_bytes, "backup.zip", conflict_resolution="rename")

        assert result == {"environments": _result_part(imported=1)}
        # Should have original + renamed
        envs = environment_service.list_environments()
        names = [e["name"] for e in envs["environments"]]
        assert "DupeName" in names
        assert any("DupeName" in n and n != "DupeName" for n in names)

    def test_restore_fatal_entities_skipped(self, temp_storage_path: Path) -> None:
        """Entities with fatal errors are always skipped."""
        from wavecore.api.services.backup.service import restore_backup

        # Environment with no name is fatal
        nameless_id = str(uuid.uuid4())
        entities = {
            "environments": [
                _make_environment("Good"),
                {"id": nameless_id, "tags": []},
            ]
        }
        zip_bytes = _build_backup_zip(entities)

        result = restore_backup(zip_bytes, "backup.zip")

        counts, items = _split_items(result["environments"])
        assert counts == _result_counts(imported=1, fatal=1)
        _assert_items(items, [(nameless_id, "fatal", _HAS_NO_NAME)])

    def test_restore_auto_repair(self, temp_storage_path: Path) -> None:
        """Auto-repair fixes fixable entities when enabled."""
        from wavecore.api.services.backup.service import restore_backup

        # Profile with missing type is fixable
        profile = _make_profile("Fixable")
        del profile["type"]
        entities = {"profiles": [profile]}
        zip_bytes = _build_backup_zip(entities)

        result = restore_backup(zip_bytes, "backup.zip", auto_repair=True)

        assert result == {"profiles": _result_part(imported=1)}

    def test_restore_non_zip_rejected(self) -> None:
        """Non-ZIP files are rejected."""
        from wavecore.api.services.backup.service import restore_backup

        with pytest.raises(ValidationException, match="^Invalid backup file: not a ZIP archive$"):
            restore_backup(b"not a zip", "backup.zip")

    def test_restore_missing_manifest(self) -> None:
        """ZIP without manifest is rejected."""
        from wavecore.api.services.backup.service import restore_backup

        entities = {"tests": [_make_test("T1")]}
        zip_bytes = _build_backup_zip(entities, include_manifest=False)

        with pytest.raises(
            ValidationException, match="^Invalid backup archive: missing manifest.json$"
        ):
            restore_backup(zip_bytes, "backup.zip")

    def test_restore_returns_per_type_results(self, temp_storage_path: Path) -> None:
        """Restore results include per-entity-type counts."""
        from wavecore.api.services.backup.service import restore_backup

        entities = {
            "tests": [_make_test("T1")],
            "environments": [_make_environment("E1")],
        }
        zip_bytes = _build_backup_zip(entities)

        result = restore_backup(zip_bytes, "backup.zip")

        for entity_type in ["tests", "environments"]:
            assert set(result[entity_type]) == {"imported", "skipped", "fatal", "items"}

    def test_restore_suites(self, temp_storage_path: Path) -> None:
        """Restore creates suite entities."""
        from wavecore.api.services.backup.service import restore_backup
        from wavecore.api.services.suites import service as suite_service

        entities = {"suites": [_make_suite("Restored Suite")]}
        zip_bytes = _build_backup_zip(entities)

        result = restore_backup(zip_bytes, "backup.zip")

        assert result == {"suites": _result_part(imported=1)}
        suites = suite_service.list_suites()
        names = [s["name"] for s in suites["suites"]]
        assert "Restored Suite" in names

    def test_restore_keeps_suite_and_regression_variables(self, temp_storage_path: Path) -> None:
        """A restored Suite / Regression keeps its variables and their element types."""
        from wavecore.api.services.backup.service import restore_backup
        from wavecore.api.services.regressions import service as regression_service
        from wavecore.api.services.suites import service as suite_service

        typed = {"type": "map", "value": {"n": "16"}, "elementTypes": {"n": "integer"}}
        suite = {**_make_suite("Typed Suite"), "variables": {"m": typed}}
        regression = {**_make_regression("Typed Reg"), "variables": {"m": typed}}
        restore_backup(
            _build_backup_zip({"suites": [suite], "regressions": [regression]}), "backup.zip"
        )

        restored_suite = next(
            s for s in suite_service.list_suites()["suites"] if s["name"] == "Typed Suite"
        )
        assert suite_service.get_suite_variables_raw(restored_suite["id"]) == {"m": typed}
        restored_regression = next(
            r
            for r in regression_service.list_regressions()["regressions"]
            if r["name"] == "Typed Reg"
        )
        assert regression_service.get_regression(restored_regression["id"])["variables"] == {
            "m": typed
        }

    def test_restore_keeps_profile_environment_values(self, temp_storage_path: Path) -> None:
        """A restored profile keeps each environment's typed values and element types."""
        from wavecore.api.services.backup.service import restore_backup
        from wavecore.api.services.profiles import _common as profile_common
        from wavecore.api.services.profiles import service as profile_service

        typed = {
            "type": "map",
            "secret": False,
            "value": {"n": "16"},
            "elementTypes": {"n": "integer"},
        }
        profile = {"name": "Typed Profile", "type": "custom", "config": {}}
        restore_backup(
            _build_backup_zip(
                {"profiles": [{**profile, "environment_values": {"env-1": {"m": typed}}}]}
            ),
            "backup.zip",
        )
        restored = next(
            p for p in profile_service.list_profiles()["profiles"] if p["name"] == "Typed Profile"
        )
        assert profile_common._profile_storage[restored["id"]]["environment_values"] == {
            "env-1": {"m": typed}
        }

    def test_restore_overwrite_replaces_profile_environment_values(
        self, temp_storage_path: Path
    ) -> None:
        """An overwriting restore replaces the stored profile's environment values."""
        from wavecore.api.services.backup.service import restore_backup
        from wavecore.api.services.profiles import _common as profile_common
        from wavecore.api.services.profiles import service as profile_service

        existing = profile_service.create_profile(
            "Typed Profile",
            "custom",
            environment_values={"env-1": {"m": {"type": "string", "value": "old"}}},
        )
        typed = {"type": "array", "secret": False, "value": ["1"], "elementTypes": ["integer"]}
        item = {
            "name": "Typed Profile",
            "type": "custom",
            "environment_values": {"env-1": {"m": typed}},
        }
        archive = _build_backup_zip({"profiles": [item]})
        restore_backup(archive, "backup.zip", conflict_resolution="overwrite")
        assert profile_common._profile_storage[existing["id"]]["environment_values"] == {
            "env-1": {"m": typed}
        }
        restore_backup(archive, "backup.zip", conflict_resolution="rename")
        renamed = next(
            p
            for p in profile_service.list_profiles()["profiles"]
            if p["name"] == "Typed Profile (2)"
        )
        assert profile_common._profile_storage[renamed["id"]]["environment_values"] == {
            "env-1": {"m": typed}
        }

    def test_restore_regressions(self, temp_storage_path: Path) -> None:
        """Restore creates regression entities."""
        from wavecore.api.services.backup.service import restore_backup
        from wavecore.api.services.regressions import service as regression_service

        entities = {"regressions": [_make_regression("Restored Reg")]}
        zip_bytes = _build_backup_zip(entities)

        result = restore_backup(zip_bytes, "backup.zip")

        assert result == {"regressions": _result_part(imported=1)}
        regs = regression_service.list_regressions()
        names = [r["name"] for r in regs["regressions"]]
        assert "Restored Reg" in names

    def test_restore_refuses_an_unknown_conflict_resolution(self) -> None:
        from wavecore.api.services.backup.service import restore_backup
        from wavecore.api.services.environments import service as environment_service

        archive = _build_backup_zip({"environments": [_make_environment("Never Written")]})

        with pytest.raises(ValidationException, match="^Unknown conflict resolution: 'merge'$"):
            restore_backup(archive, "backup.zip", conflict_resolution="merge")

        names = [e["name"] for e in environment_service.list_environments()["environments"]]
        assert "Never Written" not in names

    def test_restore_refuses_an_unknown_entity_type(self) -> None:
        from wavecore.api.services.backup.service import restore_backup
        from wavecore.api.services.environments import service as environment_service

        archive = _build_backup_zip({"environments": [_make_environment("Never Written")]})

        with pytest.raises(ValidationException, match="^Unknown entity type: 'widgets'$"):
            restore_backup(archive, "backup.zip", entity_types=["environments", "widgets"])

        names = [e["name"] for e in environment_service.list_environments()["environments"]]
        assert "Never Written" not in names

    def test_the_preview_and_the_restore_agree(self) -> None:
        from wavecore.api.services.backup.service import restore_backup, validate_backup
        from wavecore.api.services.environments import service as environment_service

        environment_service.create_environment("Existing", tags=[])
        nameless_id = str(uuid.uuid4())
        archive = _build_backup_zip(
            {
                "tests": [_make_test("Good Test")],
                "environments": [
                    _make_environment("Fresh"),
                    _make_environment("Existing"),
                    {"id": nameless_id, "tags": []},
                ],
                "regressions": [
                    {**_make_regression("Orphan Regression"), "suites": [str(uuid.uuid4())]}
                ],
            },
            raw_members=[("tests/bad.json", b"{not valid json!!!}")],
        )

        preview = validate_backup(archive, "backup.zip")["entity_summary"]
        result = restore_backup(archive, "backup.zip")

        assert _names(preview["tests"], "fatal") == ["bad.json"]
        assert _names(preview["environments"], "fatal") == [nameless_id]
        assert _names(preview["environments"], "conflict") == ["Existing"]
        assert _names(preview["regressions"], "fatal") == ["Orphan Regression"]
        assert set(result) == set(preview)
        for part, summary in preview.items():
            assert _names(result[part], "fatal") == _names(summary, "fatal")
            assert _names(result[part], "skipped") == _names(summary, "conflict")
            assert result[part]["fatal"] == summary["fatal"]
            assert result[part]["skipped"] == summary["conflicts"]


# ============================================================================
# Schedule Management
# ============================================================================

_SCHEDULER_LOGGER = "wavecore.api.services.backup.scheduler"
_DAILY_AT_TWO = "Every day at 02:00"
_RECORDED_AT = "2026-03-08T12:00:00+00:00"

# A hand edit: the time has no quotes, so YAML reads a timestamp and not text.
_UNQUOTED_LAST_RUN_CONFIG = (
    "backup:\n"
    "  schedule:\n"
    "    last_run: 2026-10-04T10:00:00Z\n"
    "    last_run_status: success\n"
)
_UNQUOTED_LAST_RUN = datetime(2026, 10, 4, 10, 0, tzinfo=UTC)

# Every schedule default except entity_types, which the read resolves.
_SCHEDULE_DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "cron": "",
    "max_backups": 5,
    "save_directory": "~/wave-backups",
    "format": "yaml",
    "compression_method": "deflate",
    "compression_level": 6,
    "secrets": "mask",
    "last_run": None,
    "last_run_status": None,
    "cron_description": "",
    "next_run": None,
}

_FULL_SCHEDULE: dict[str, Any] = {
    "enabled": True,
    "cron": "0 2 * * *",
    "entity_types": ["tests", "environments"],
    "max_backups": 7,
    "save_directory": "/srv/wave-backups",
    "format": "json",
    "compression_method": "bzip2",
    "compression_level": 9,
    "secrets": "encrypted",
}

_VALID_SCHEDULE: dict[str, Any] = {
    "enabled": True,
    "cron": "0 2 * * *",
    "entity_types": ["tests"],
    "max_backups": 5,
    "save_directory": "/srv/backups",
}

# One schedule as a scheduled run receives it.
_RUN_SCHEDULE: dict[str, Any] = {
    "enabled": True,
    "cron": "* * * * *",
    "entity_types": ["tests"],
    "max_backups": 5,
    "format": "yaml",
    "compression_method": "deflate",
    "compression_level": 6,
    "secrets": "mask",
    "last_run": None,
    "last_run_status": None,
}


@pytest.fixture
def wave_home(server_home: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point HOME at the temp home folder, so ~ expands where a relative path starts."""
    monkeypatch.setenv("HOME", str(server_home))
    return server_home


@pytest.fixture
def switch_schedule_off(
    load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
) -> Callable[[], None]:
    """Turn the schedule off in the config file and load it again, keeping every other value."""

    def _switch() -> None:
        content = config_on_disk()
        content["backup"]["schedule"]["enabled"] = False
        load_config(content)

    return _switch


def _default_schedule() -> dict[str, Any]:
    from wavecore.api.services.backup._helpers import BACKUP_ENTITY_TYPES

    return {**_SCHEDULE_DEFAULTS, "entity_types": sorted(BACKUP_ENTITY_TYPES)}


def _schedule_on_disk(config_on_disk: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    """The backup.schedule section of the config file, empty when it is not there."""
    stored: dict[str, Any] = config_on_disk().get("backup", {}).get("schedule", {})
    return stored


def _without_next_run(schedule: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in schedule.items() if key != "next_run"}


def _saved(schedule: dict[str, Any]) -> dict[str, Any]:
    """What a read returns after ``schedule`` was saved and never ran."""
    return {
        **schedule,
        "last_run": None,
        "last_run_status": None,
        "cron_description": _DAILY_AT_TWO,
    }


def _only(schedule: dict[str, Any], keys: dict[str, Any]) -> dict[str, Any]:
    return {key: schedule.get(key) for key in keys}


def _refused_inside(data_folder: Path) -> str:
    return f"^Save directory must be outside the data folder: {re.escape(str(data_folder))}$"


def _read_only_refusal(config_file: Path) -> str:
    return f"Settings cannot be saved: the config file {config_file} is read-only"


def _scheduler_warnings(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if record.name == _SCHEDULER_LOGGER and record.levelno == logging.WARNING
    ]


def _run(coroutine: Coroutine[Any, Any, Any]) -> Any:
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coroutine)
    finally:
        loop.close()


def _sleep_then(stop: Callable[[], None]) -> Callable[[float], Awaitable[None]]:
    """A sleep that returns at once and calls ``stop`` from its second call on."""
    real_sleep = asyncio.sleep
    calls = 0

    async def fake_sleep(_seconds: float) -> None:
        nonlocal calls
        calls += 1
        if calls >= 2:
            stop()
        await real_sleep(0)

    return fake_sleep


class TestScheduleManagement:
    """Tests for periodic backup schedule CRUD."""

    def test_get_schedule_default(self, temp_storage_path: Path) -> None:
        """Get schedule returns default (disabled) when no schedule exists."""
        from wavecore.api.services.backup.scheduler import get_schedule

        result = get_schedule()

        assert result["enabled"] is False

    def test_update_schedule(self, temp_storage_path: Path) -> None:
        """Update schedule persists configuration."""
        from wavecore.api.services.backup.scheduler import get_schedule, update_schedule

        config = {
            "enabled": True,
            "cron": "0 2 * * *",
            "entity_types": ["tests", "environments"],
            "max_backups": 5,
            "save_directory": "/srv/backups",
            "format": "yaml",
            "compression_method": "deflate",
            "compression_level": 6,
            "secrets": "mask",
        }

        result = update_schedule(config)
        assert result["enabled"] is True
        assert result["cron"] == "0 2 * * *"

        # Verify persistence
        loaded = get_schedule()
        assert loaded["enabled"] is True
        assert loaded["cron"] == "0 2 * * *"
        assert loaded["entity_types"] == ["tests", "environments"]
        assert loaded["max_backups"] == 5

    def test_update_schedule_validates_cron(self, temp_storage_path: Path) -> None:
        """Invalid cron expression is rejected."""
        from wavecore.api.services.backup.scheduler import update_schedule

        with pytest.raises(ValidationException, match="^Invalid cron expression"):
            update_schedule(
                {
                    "enabled": True,
                    "cron": "invalid cron",
                    "entity_types": ["tests"],
                    "max_backups": 5,
                    "save_directory": "/srv/backups",
                }
            )

    def test_update_schedule_missing_cron(self, temp_storage_path: Path) -> None:
        """Missing cron expression when enabled raises error."""
        from wavecore.api.services.backup.scheduler import update_schedule

        with pytest.raises(ValidationException, match="^Cron expression is required$"):
            update_schedule(
                {
                    "enabled": True,
                    "entity_types": ["tests"],
                    "max_backups": 5,
                    "save_directory": "/srv/backups",
                }
            )

    def test_update_schedule_missing_entity_types(self, temp_storage_path: Path) -> None:
        """Missing entity types when enabled raises error."""
        from wavecore.api.services.backup.scheduler import update_schedule

        with pytest.raises(
            ValidationException, match="^At least one entity type must be selected$"
        ):
            update_schedule(
                {
                    "enabled": True,
                    "cron": "0 2 * * *",
                    "entity_types": [],
                    "max_backups": 5,
                    "save_directory": "/srv/backups",
                }
            )

    def test_update_schedule_missing_max_backups(self, temp_storage_path: Path) -> None:
        """A cleared max_backups when enabled raises error."""
        from wavecore.api.services.backup.scheduler import update_schedule

        with pytest.raises(ValidationException, match="^Max backups is required$"):
            update_schedule(
                {
                    "enabled": True,
                    "cron": "0 2 * * *",
                    "entity_types": ["tests"],
                    "max_backups": None,
                    "save_directory": "/srv/backups",
                }
            )

    def test_update_schedule_missing_save_directory(self, temp_storage_path: Path) -> None:
        """A blank save_directory when enabled raises error."""
        from wavecore.api.services.backup.scheduler import update_schedule

        with pytest.raises(ValidationException, match="^Save directory is required$"):
            update_schedule(
                {
                    "enabled": True,
                    "cron": "0 2 * * *",
                    "entity_types": ["tests"],
                    "max_backups": 5,
                    "save_directory": "",
                }
            )

    def test_update_schedule_cron_human_readable(self, temp_storage_path: Path) -> None:
        """Schedule includes human-readable cron description."""
        from wavecore.api.services.backup.scheduler import update_schedule

        result = update_schedule(
            {
                "enabled": True,
                "cron": "0 2 * * *",
                "entity_types": ["tests"],
                "max_backups": 5,
                "save_directory": "/srv/backups",
            }
        )

        assert "cron_description" in result
        assert len(result["cron_description"]) > 0

    def test_update_schedule_next_run(self, temp_storage_path: Path) -> None:
        """Schedule includes next run time."""
        from wavecore.api.services.backup.scheduler import update_schedule

        result = update_schedule(
            {
                "enabled": True,
                "cron": "0 2 * * *",
                "entity_types": ["tests"],
                "max_backups": 5,
                "save_directory": "/srv/backups",
            }
        )

        assert "next_run" in result
        assert result["next_run"] is not None

    def test_schedule_persistence_file(self, config_on_disk: Callable[[], dict[str, Any]]) -> None:
        """Schedule is persisted in the config file."""
        from wavecore.api.services.backup.scheduler import update_schedule

        update_schedule(
            {
                "enabled": True,
                "cron": "0 2 * * *",
                "entity_types": ["tests"],
                "max_backups": 5,
                "save_directory": "/srv/backups",
            }
        )

        data = _schedule_on_disk(config_on_disk)
        assert data.get("enabled") is True
        assert data.get("cron") == "0 2 * * *"

    def test_update_disabled_schedule(self, temp_storage_path: Path) -> None:
        """Disabling schedule does not require all fields."""
        from wavecore.api.services.backup.scheduler import update_schedule

        result = update_schedule({"enabled": False})

        assert result["enabled"] is False

    def test_max_backups_positive(self, temp_storage_path: Path) -> None:
        """Max backups must be a positive integer."""
        from wavecore.api.services.backup.scheduler import update_schedule

        with pytest.raises(ValidationException, match="^Max backups must be a positive integer$"):
            update_schedule(
                {
                    "enabled": True,
                    "cron": "0 2 * * *",
                    "entity_types": ["tests"],
                    "max_backups": 0,
                    "save_directory": "/srv/backups",
                }
            )

    def test_get_schedule_cron_parse_error(self, load_config: Callable[..., Any]) -> None:
        """get_schedule handles invalid cron in saved schedule."""
        from wavecore.api.services.backup.scheduler import get_schedule

        load_config({"backup": {"schedule": {"enabled": True, "cron": "INVALID"}}})

        result = get_schedule()
        assert result.get("cron") == "INVALID"
        assert result["next_run"] is None

    def test_update_schedule_invalid_cron_croniter(self, temp_storage_path: Path) -> None:
        """update_schedule rejects syntactically invalid cron via croniter."""
        from wavecore.api.services.backup.scheduler import update_schedule

        with pytest.raises(ValidationException, match="^Invalid cron expression"):
            update_schedule(
                {
                    "enabled": True,
                    "cron": "NOTACRON",
                    "entity_types": ["tests"],
                    "max_backups": 5,
                    "save_directory": "/srv/backups",
                }
            )

    def test_update_schedule_croniter_get_next_error(self, temp_storage_path: Path) -> None:
        """update_schedule handles croniter get_next failure gracefully."""
        from wavecore.api.services.backup.scheduler import update_schedule

        # Patch croniter to succeed on init but fail on get_next
        with patch("wavecore.api.services.backup.scheduler.croniter") as mock_croniter:
            # First call: validation (line 739) - succeeds
            # Second call: get_next (line 771) - fails
            instance = mock_croniter.return_value
            instance.get_next.side_effect = ValueError("boom")

            result = update_schedule(
                {
                    "enabled": True,
                    "cron": "0 2 * * *",
                    "entity_types": ["tests"],
                    "max_backups": 5,
                    "save_directory": "/srv/backups",
                }
            )

        assert result["next_run"] is None


class TestScheduleInConfigFile:
    """The schedule is read from backup.schedule in the config file (REQ-4.7.20)."""

    def test_a_fresh_config_returns_every_default(self) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule

        assert get_schedule() == _default_schedule()

    @pytest.mark.usefixtures("example_config")
    def test_the_example_config_holds_the_same_defaults(self) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule

        assert get_schedule() == _default_schedule()

    def test_null_entity_types_mean_every_enabled_type(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule

        load_config({"backup": {"schedule": {"entity_types": None}}})

        assert get_schedule().get("entity_types") == _default_schedule()["entity_types"]
        assert _schedule_on_disk(config_on_disk) == {"entity_types": None}

    def test_a_fresh_schedule_answers_the_nine_ids_sorted(self) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule

        assert get_schedule().get("entity_types") == [
            "certificates",
            "environments",
            "functions",
            "profiles",
            "regressions",
            "ssh_hosts",
            "suites",
            "system_variables",
            "tests",
        ]

    def test_a_saved_explicit_list_is_kept_as_saved(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule, update_schedule

        eight = [part for part in _BACKUP_PARTS if part != "functions"]

        saved = update_schedule({**_VALID_SCHEDULE, "entity_types": eight})

        assert saved.get("entity_types") == eight
        assert get_schedule().get("entity_types") == eight
        assert _schedule_on_disk(config_on_disk).get("entity_types") == eight

    def test_one_stored_value_is_merged_over_the_defaults(
        self, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule

        stored = {"enabled": True, "cron": "0 2 * * *", "max_backups": 12}
        load_config({"backup": {"schedule": stored}})

        assert _without_next_run(get_schedule()) == _without_next_run(
            {**_default_schedule(), **stored, "cron_description": _DAILY_AT_TWO}
        )

    def test_stored_values_are_returned(self, load_config: Callable[..., Any]) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule

        stored = {**_FULL_SCHEDULE, "last_run": _RECORDED_AT, "last_run_status": "success"}
        load_config({"backup": {"schedule": stored}})

        schedule = get_schedule()

        assert _without_next_run(schedule) == {**stored, "cron_description": _DAILY_AT_TWO}
        assert datetime.fromisoformat(schedule["next_run"]) > datetime.now(UTC)

    def test_a_schedule_that_is_off_has_no_next_run_and_no_description(
        self, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule

        # What the file holds while the switch is off is hidden by the page, so it is not read.
        load_config({"backup": {"schedule": {**_FULL_SCHEDULE, "enabled": False}}})

        assert get_schedule() == _default_schedule()

    def test_a_last_run_written_without_quotes_is_returned_as_text(
        self, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule

        load_config(_UNQUOTED_LAST_RUN_CONFIG)

        last_run = get_schedule().get("last_run")

        assert isinstance(last_run, str)
        assert datetime.fromisoformat(last_run) == _UNQUOTED_LAST_RUN

    def test_a_schedule_file_left_in_the_data_folder_is_ignored(
        self, temp_storage_path: Path
    ) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule

        leftover = temp_storage_path / "backup" / "schedule.yaml"
        leftover.parent.mkdir(parents=True, exist_ok=True)
        leftover.write_text(yaml.safe_dump(_FULL_SCHEDULE), encoding="utf-8")

        assert get_schedule() == _default_schedule()

    def test_the_old_schedule_file_helpers_are_gone(self) -> None:
        from wavecore.api.services.backup import _helpers, scheduler

        assert not hasattr(scheduler, "delete_schedule")
        assert not hasattr(scheduler, "_get_schedule_path")
        assert not hasattr(_helpers, "_get_schedule_path")


class TestSaveSchedule:
    """Save writes backup.schedule; turning it off keeps every other value (REQ-4.7.20)."""

    def test_save_on_writes_every_value(self, config_on_disk: Callable[[], dict[str, Any]]) -> None:
        from wavecore.api.services.backup.scheduler import update_schedule

        result = update_schedule(dict(_FULL_SCHEDULE))

        assert _without_next_run(result) == _saved(_FULL_SCHEDULE)
        assert datetime.fromisoformat(result["next_run"]) > datetime.now(UTC)
        assert config_on_disk() == {"backup": {"schedule": _FULL_SCHEDULE}}

    def test_save_on_writes_nothing_into_the_data_folder(self, temp_storage_path: Path) -> None:
        from wavecore.api.services.backup.scheduler import update_schedule

        update_schedule(dict(_FULL_SCHEDULE))
        update_schedule({"enabled": False})

        assert not (temp_storage_path / "backup").exists()

    def test_save_off_writes_only_the_switch(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import update_schedule

        load_config({"backup": {"schedule": {"enabled": True}}})

        result = update_schedule({"enabled": False})

        assert result == _default_schedule()
        assert config_on_disk() == {"backup": {"schedule": {"enabled": False}}}

    def test_save_off_on_a_fresh_config_writes_nothing_but_the_switch(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import update_schedule

        result = update_schedule({"enabled": False})

        assert result == _default_schedule()
        assert config_on_disk() in ({}, {"backup": {"schedule": {"enabled": False}}})

    def test_save_off_checks_and_writes_nothing_else(
        self,
        temp_storage_path: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule, update_schedule

        load_config({"backup": {"schedule": {"enabled": True}}})

        update_schedule(
            {
                "enabled": False,
                "cron": "not a cron",
                "entity_types": ["plugins"],
                "max_backups": 0,
                "save_directory": str(temp_storage_path),
                "format": "xml",
                "compression_method": "gzip",
                "compression_level": 10,
                "secrets": "clear",
            }
        )

        assert config_on_disk() == {"backup": {"schedule": {"enabled": False}}}
        assert get_schedule() == _default_schedule()

    def test_save_off_discards_the_schedule_the_page_hides(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule, update_schedule

        update_schedule(dict(_FULL_SCHEDULE))

        result = update_schedule({"enabled": False})

        assert result == _default_schedule()
        assert get_schedule() == _default_schedule()
        assert _schedule_on_disk(config_on_disk) == {
            **{key: _SCHEDULE_DEFAULTS[key] for key in _FULL_SCHEDULE if key != "entity_types"},
            "entity_types": None,
        }

    def test_save_on_again_needs_the_schedule_again(self) -> None:
        from wavecore.api.services.backup.scheduler import update_schedule

        update_schedule(dict(_FULL_SCHEDULE))
        update_schedule({"enabled": False})

        with pytest.raises(ValidationException, match="^Cron expression is required$"):
            update_schedule({"enabled": True})

    def test_save_off_keeps_the_run_record(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import update_schedule

        ran = {"last_run": "2026-10-01T02:00:00+00:00", "last_run_status": "success"}
        load_config({"backup": {"schedule": {**_FULL_SCHEDULE, **ran}}})

        result = update_schedule({"enabled": False})

        assert _only(result, ran) == ran
        assert _only(_schedule_on_disk(config_on_disk), ran) == ran

    def test_turning_on_keeps_null_entity_types_in_the_file(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule, update_schedule

        load_config({"backup": {"schedule": {"entity_types": None}}})
        every_type = _default_schedule()["entity_types"]

        result = update_schedule({"enabled": True, "cron": "0 2 * * *"})

        assert result.get("enabled") is True
        assert result.get("entity_types") == every_type
        assert get_schedule().get("entity_types") == every_type
        on_disk = _schedule_on_disk(config_on_disk)
        assert on_disk.get("enabled") is True
        assert "entity_types" in on_disk
        assert on_disk["entity_types"] is None

    @pytest.mark.usefixtures("wave_home")
    def test_turning_on_a_fresh_config_without_entity_types_backs_up_every_type(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule, update_schedule

        every_type = _default_schedule()["entity_types"]

        result = update_schedule({"enabled": True, "cron": "0 2 * * *"})

        assert result.get("enabled") is True
        assert result.get("entity_types") == every_type
        assert get_schedule().get("entity_types") == every_type
        on_disk = _schedule_on_disk(config_on_disk)
        assert on_disk.get("enabled") is True
        assert on_disk.get("cron") == "0 2 * * *"
        assert on_disk.get("entity_types") is None

    def test_a_partial_save_on_merges_over_the_stored_values(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import update_schedule

        update_schedule(dict(_FULL_SCHEDULE))

        result = update_schedule({"enabled": True, "max_backups": 3})

        assert result.get("max_backups") == 3
        assert _schedule_on_disk(config_on_disk) == {**_FULL_SCHEDULE, "max_backups": 3}

    @pytest.mark.usefixtures("wave_home")
    def test_a_home_folder_path_is_stored_as_typed(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import update_schedule

        result = update_schedule({**_VALID_SCHEDULE, "save_directory": "~/nightly"})

        assert result["save_directory"] == "~/nightly"
        assert _schedule_on_disk(config_on_disk).get("save_directory") == "~/nightly"

    def test_the_saved_schedule_survives_a_restart(self, load_config: Callable[..., Any]) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule, update_schedule

        update_schedule(dict(_FULL_SCHEDULE))
        load_config()

        assert _without_next_run(get_schedule()) == _saved(_FULL_SCHEDULE)

    def test_the_run_record_and_the_computed_fields_in_a_save_are_ignored(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import update_schedule

        result = update_schedule(
            {
                **_FULL_SCHEDULE,
                "last_run": "2020-01-01T00:00:00+00:00",
                "last_run_status": "failed",
                "cron_description": "Never",
                "next_run": "2020-01-01T00:00:00+00:00",
                "color": "blue",
            }
        )

        assert _without_next_run(result) == _saved(_FULL_SCHEDULE)
        assert datetime.fromisoformat(result["next_run"]) > datetime.now(UTC)
        assert config_on_disk() == {"backup": {"schedule": _FULL_SCHEDULE}}

    def test_a_save_keeps_the_last_run_record(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import update_schedule

        record = {"last_run": _RECORDED_AT, "last_run_status": "success"}
        load_config({"backup": {"schedule": record}})

        result = update_schedule(dict(_FULL_SCHEDULE))

        assert _schedule_on_disk(config_on_disk) == {**_FULL_SCHEDULE, **record}
        assert _only(result, record) == record

    @pytest.mark.parametrize(
        "change", [{**_VALID_SCHEDULE, "max_backups": 9}, {"enabled": False}], ids=["on", "off"]
    )
    def test_a_refused_save_changes_nothing(
        self,
        change: dict[str, Any],
        load_config: Callable[..., Any],
        read_only_config: Path,
        temp_storage_path: Path,
    ) -> None:
        from wavecore.api.config import get_config
        from wavecore.api.config.write_back import ConfigWriteError
        from wavecore.api.services.backup.scheduler import update_schedule

        load_config({"backup": {"schedule": dict(_VALID_SCHEDULE)}})
        before = read_only_config.read_bytes()

        with pytest.raises(
            ConfigWriteError, match=f"^{re.escape(_read_only_refusal(read_only_config))}$"
        ):
            update_schedule(change)

        assert read_only_config.read_bytes() == before
        assert get_config().get("backup.schedule.enabled") is True
        assert get_config().get("backup.schedule.max_backups") == 5
        assert not (temp_storage_path / "backup").exists()


@pytest.mark.usefixtures("wave_home")
class TestScheduleSaveMessages:
    """Each refusal of an enabled Save carries its exact message (REQ-4.7.20)."""

    @pytest.mark.parametrize(
        ("change", "message"),
        [
            ({"cron": ""}, "Cron expression is required"),
            ({"cron": None}, "Cron expression is required"),
            ({"cron": "not a cron"}, "Invalid cron expression: 'not a cron'"),
            ({"entity_types": []}, "At least one entity type must be selected"),
            ({"entity_types": ["widgets"]}, "Unknown entity type: 'widgets'"),
            ({"max_backups": None}, "Max backups is required"),
            ({"max_backups": 0}, "Max backups must be a positive integer"),
            ({"max_backups": "5.0"}, "Max backups must be a positive integer"),
            ({"max_backups": True}, "Max backups must be a positive integer"),
            ({"max_backups": 10**19}, "Max backups allows at most 19 digits"),
            ({"save_directory": ""}, "Save directory is required"),
            ({"save_directory": None}, "Save directory is required"),
            ({"format": "xml"}, "Invalid format: 'xml'"),
            ({"compression_method": "gzip"}, "Invalid compression method: 'gzip'"),
            ({"compression_level": 10}, "Compression level must be between 1 and 9"),
            ({"compression_level": 0}, "Compression level must be between 1 and 9"),
            (
                {"secrets": "clear"},
                "Invalid secrets mode 'clear'; must be 'mask', 'encrypted', or 'plaintext'",
            ),
        ],
    )
    def test_an_invalid_value_is_refused_and_nothing_is_written(
        self, change: dict[str, Any], message: str, config_file: Path
    ) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule, update_schedule

        before = config_file.read_bytes()

        with pytest.raises(ValidationException, match=f"^{re.escape(message)}$"):
            update_schedule({**_VALID_SCHEDULE, **change})

        assert config_file.read_bytes() == before
        assert get_schedule()["enabled"] is False

    @pytest.mark.parametrize(
        ("key", "message"),
        [
            ("cron", "Cron expression is required"),
            ("save_directory", "Save directory is required"),
            ("max_backups", "Max backups is required"),
        ],
    )
    def test_an_explicit_null_is_an_empty_value_even_when_one_is_stored(
        self, key: str, message: str, load_config: Callable[..., Any], config_file: Path
    ) -> None:
        from wavecore.api.services.backup.scheduler import update_schedule

        load_config({"backup": {"schedule": _FULL_SCHEDULE}})
        before = config_file.read_bytes()

        with pytest.raises(ValidationException, match=f"^{re.escape(message)}$"):
            update_schedule({"enabled": True, key: None})

        assert config_file.read_bytes() == before

    def test_a_value_the_file_holds_while_off_is_not_used_when_the_schedule_is_turned_on(
        self, load_config: Callable[..., Any], config_file: Path
    ) -> None:
        from wavecore.api.services.backup.scheduler import update_schedule

        load_config({"backup": {"schedule": {"cron": "0 2 * * *", "entity_types": ["tests"]}}})
        before = config_file.read_bytes()

        with pytest.raises(ValidationException, match=r"^Cron expression is required$"):
            update_schedule({"enabled": True})

        assert config_file.read_bytes() == before

    def test_the_request_value_wins_over_the_stored_one(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import update_schedule

        load_config({"backup": {"schedule": {"cron": "not a cron", "entity_types": ["tests"]}}})

        result = update_schedule({"enabled": True, "cron": "0 2 * * *"})

        assert result.get("cron_description") == _DAILY_AT_TWO
        assert _schedule_on_disk(config_on_disk).get("cron") == "0 2 * * *"
        assert _schedule_on_disk(config_on_disk).get("enabled") is True


@pytest.mark.usefixtures("wave_home")
class TestSaveDirectoryOutsideDataFolder:
    """A save folder that is the data folder or inside it is refused (REQ-4.7.20)."""

    @staticmethod
    def _assert_refused(save_directory: str, data_folder: Path, config_file: Path) -> None:
        from wavecore.api.services.backup.scheduler import update_schedule

        before = config_file.read_bytes()
        with pytest.raises(ValidationException, match=_refused_inside(data_folder)):
            update_schedule({**_VALID_SCHEDULE, "save_directory": save_directory})
        assert config_file.read_bytes() == before

    @staticmethod
    def _assert_saved(save_directory: str, config_on_disk: Callable[[], dict[str, Any]]) -> None:
        from wavecore.api.services.backup.scheduler import update_schedule

        update_schedule({**_VALID_SCHEDULE, "save_directory": save_directory})
        assert _schedule_on_disk(config_on_disk).get("save_directory") == save_directory

    def test_the_data_folder_itself_is_refused(
        self, temp_storage_path: Path, config_file: Path
    ) -> None:
        self._assert_refused(str(temp_storage_path), temp_storage_path, config_file)

    def test_a_folder_inside_the_data_folder_is_refused(
        self, temp_storage_path: Path, config_file: Path
    ) -> None:
        inside = temp_storage_path / "backups" / "nightly"

        self._assert_refused(str(inside), temp_storage_path, config_file)

    def test_parent_segments_that_lead_back_inside_are_refused(
        self, temp_storage_path: Path, config_file: Path
    ) -> None:
        roundabout = f"{temp_storage_path}/../{temp_storage_path.name}/backups"

        self._assert_refused(roundabout, temp_storage_path, config_file)

    def test_a_link_into_the_data_folder_is_refused(
        self, temp_storage_path: Path, tmp_path: Path, config_file: Path
    ) -> None:
        target = temp_storage_path / "linked"
        target.mkdir()
        link = tmp_path / "backups-link"
        link.symlink_to(target, target_is_directory=True)

        self._assert_refused(str(link), temp_storage_path, config_file)

    @pytest.mark.parametrize("save_directory", ["wave-data/backups", "~/wave-data/backups"])
    def test_a_home_folder_path_that_lands_inside_is_refused(
        self, save_directory: str, wave_home: Path, config_file: Path
    ) -> None:
        from wavecore.api.services import storage_paths

        data_folder = wave_home / "wave-data"
        storage_paths.set_base_path(data_folder)

        self._assert_refused(save_directory, data_folder, config_file)

    def test_the_check_follows_the_data_folder_in_use(
        self,
        temp_storage_path: Path,
        tmp_path: Path,
        config_file: Path,
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        from wavecore.api.services import storage_paths

        other = tmp_path / "other-data"
        storage_paths.set_base_path(other)

        self._assert_refused(str(other / "backups"), other, config_file)
        self._assert_saved(str(temp_storage_path / "backups"), config_on_disk)

    def test_a_sibling_folder_sharing_the_name_prefix_is_accepted(
        self, temp_storage_path: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        self._assert_saved(f"{temp_storage_path}-backups", config_on_disk)

    def test_the_folder_holding_the_data_folder_is_accepted(
        self, temp_storage_path: Path, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        self._assert_saved(str(temp_storage_path.parent), config_on_disk)

    def test_the_default_folder_is_accepted(self) -> None:
        from wavecore.api.services.backup.scheduler import get_schedule, update_schedule

        update_schedule({"enabled": True, "cron": "0 2 * * *", "entity_types": ["tests"]})

        schedule = get_schedule()
        assert schedule["enabled"] is True
        assert schedule.get("save_directory") == "~/wave-backups"

    def test_the_check_passes_a_folder_outside(self) -> None:
        from wavecore.api.services.backup.scheduler import _check_outside_data_folder

        _check_outside_data_folder(Path("/srv/wave-backups"))

    def test_the_check_refuses_the_data_folder_and_a_folder_inside(
        self, temp_storage_path: Path
    ) -> None:
        from wavecore.api.services.backup.scheduler import _check_outside_data_folder

        for folder in (temp_storage_path, temp_storage_path / "backups"):
            with pytest.raises(ValidationException, match=_refused_inside(temp_storage_path)):
                _check_outside_data_folder(folder)


class TestResolveSaveDirectory:
    """A save folder starts at the home folder of the account WAVE runs under (REQ-4.7.20)."""

    @pytest.mark.parametrize(
        ("value", "below_home"),
        [
            ("~/wave-backups", "wave-backups"),
            ("~", ""),
            ("wave-backups", "wave-backups"),
            ("nightly/wave", "nightly/wave"),
            ("nightly/../weekly", "weekly"),
        ],
    )
    def test_a_home_or_relative_path_starts_at_the_home_folder(
        self, value: str, below_home: str, wave_home: Path
    ) -> None:
        from wavecore.api.services.backup.scheduler import resolve_save_directory

        assert resolve_save_directory(value) == wave_home / below_home

    @pytest.mark.parametrize(
        ("value", "resolved"),
        [("/srv/x", "/srv/x"), ("/srv/a/../b", "/srv/b"), ("/srv/a/./b/", "/srv/a/b")],
    )
    @pytest.mark.usefixtures("wave_home")
    def test_an_absolute_path_stays_with_parent_segments_collapsed(
        self, value: str, resolved: str
    ) -> None:
        from wavecore.api.services.backup.scheduler import resolve_save_directory

        result = resolve_save_directory(value)

        assert isinstance(result, Path)
        assert result == Path(resolved)

    def test_the_launch_folder_is_never_the_start(
        self, wave_home: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.services.backup.scheduler import resolve_save_directory

        monkeypatch.chdir(tmp_path)

        assert resolve_save_directory("wave-backups") == wave_home / "wave-backups"


class TestSharedBackupBounds:
    """The backup checks share their bounds with the startup checks (REQ-4.7.20)."""

    def test_the_bounds_match_the_messages(self) -> None:
        from wavecore.api.config import instance_settings

        assert instance_settings.COMPRESSION_LEVEL_MIN == 1
        assert instance_settings.COMPRESSION_LEVEL_MAX == 9
        assert instance_settings.MAX_BACKUPS_MIN == 1

    def test_a_compression_level_outside_the_bounds_is_refused(self) -> None:
        from wavecore.api.config import instance_settings
        from wavecore.api.services.backup.service import _validate_backup_options

        for level in (
            instance_settings.COMPRESSION_LEVEL_MIN - 1,
            instance_settings.COMPRESSION_LEVEL_MAX + 1,
        ):
            with pytest.raises(
                ValidationException, match=r"^Compression level must be between 1 and 9$"
            ):
                _validate_backup_options("yaml", "deflate", level)

    def test_a_compression_level_on_a_bound_is_accepted(self) -> None:
        from wavecore.api.config import instance_settings
        from wavecore.api.services.backup.service import _validate_backup_options

        _validate_backup_options("yaml", "deflate", instance_settings.COMPRESSION_LEVEL_MIN)
        _validate_backup_options("yaml", "bzip2", instance_settings.COMPRESSION_LEVEL_MAX)

    @pytest.mark.parametrize("level", ["6", "06"])
    def test_a_compression_level_sent_as_its_digits_is_the_number(self, level: str) -> None:
        from wavecore.api.services.backup.service import _validate_backup_options

        assert _validate_backup_options("yaml", "deflate", level) == 6

    @pytest.mark.parametrize("level", [5.5, True, "abc", "6.0", None])
    def test_a_compression_level_that_is_not_a_whole_number_is_refused(self, level: Any) -> None:
        from wavecore.api.services.backup.service import _validate_backup_options

        with pytest.raises(
            ValidationException, match=r"^Compression level must be between 1 and 9$"
        ):
            _validate_backup_options("yaml", "deflate", level)

    def test_a_level_that_a_method_does_not_use_is_passed_on_as_sent(self) -> None:
        from wavecore.api.services.backup.service import _validate_backup_options

        assert _validate_backup_options("yaml", "stored", "abc") == "abc"

    def test_max_backups_below_the_minimum_is_refused(self) -> None:
        from wavecore.api.config import instance_settings
        from wavecore.api.services.backup.scheduler import update_schedule

        with pytest.raises(ValidationException, match=r"^Max backups must be a positive integer$"):
            update_schedule(
                {**_VALID_SCHEDULE, "max_backups": instance_settings.MAX_BACKUPS_MIN - 1}
            )

    def test_max_backups_on_the_minimum_is_saved(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.config import instance_settings
        from wavecore.api.services.backup.scheduler import update_schedule

        update_schedule({**_VALID_SCHEDULE, "max_backups": instance_settings.MAX_BACKUPS_MIN})

        stored = _schedule_on_disk(config_on_disk)
        assert stored.get("max_backups") == instance_settings.MAX_BACKUPS_MIN

    @pytest.mark.parametrize("bound", ["COMPRESSION_LEVEL_MIN", "COMPRESSION_LEVEL_MAX"])
    def test_a_schedule_compression_level_on_a_bound_is_saved(
        self, bound: str, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.config import instance_settings
        from wavecore.api.services.backup.scheduler import update_schedule

        level = getattr(instance_settings, bound)

        update_schedule({**_VALID_SCHEDULE, "compression_level": level})

        assert _schedule_on_disk(config_on_disk).get("compression_level") == level


class TestDescribeCron:
    """Tests for _describe_cron helper."""

    def test_daily_midnight(self) -> None:
        from wavecore.api.services.backup.scheduler import _describe_cron

        assert _describe_cron("0 0 * * *") == "Every day at 00:00"

    def test_daily_at_time(self) -> None:
        from wavecore.api.services.backup.scheduler import _describe_cron

        assert _describe_cron("30 14 * * *") == "Every day at 14:30"

    def test_weekly(self) -> None:
        from wavecore.api.services.backup.scheduler import _describe_cron

        assert _describe_cron("0 9 * * 1") == "Every Monday at 09:00"

    def test_every_n_minutes(self) -> None:
        from wavecore.api.services.backup.scheduler import _describe_cron

        assert _describe_cron("*/10 * * * *") == "Every 10 minutes"

    def test_every_n_hours(self) -> None:
        from wavecore.api.services.backup.scheduler import _describe_cron

        # minute=*, hour=*/3 => "Every 3 hours" pattern
        assert _describe_cron("* */3 * * *") == "Every 3 hours"

    def test_minute_zero_hourly(self) -> None:
        from wavecore.api.services.backup.scheduler import _describe_cron

        # minute=0, hour=*/3 falls into "daily at hour:00" pattern
        result = _describe_cron("0 */3 * * *")
        assert "*/3" in result

    def test_non_standard_fallback(self) -> None:
        from wavecore.api.services.backup.scheduler import _describe_cron

        result = _describe_cron("15 10 1 6 *")
        assert "Cron:" in result

    def test_not_five_fields(self) -> None:
        from wavecore.api.services.backup.scheduler import _describe_cron

        assert _describe_cron("0 0 *") == "0 0 *"


class TestListEntitiesUnknownType:
    """Test _list_entities with unknown entity type."""

    def test_unknown_type_returns_empty(self) -> None:
        from wavecore.api.services.backup._helpers import _list_entities

        assert _list_entities("unknown_type") == []


class TestParseBackupEdgeCases:
    """Tests for edge cases in _parse_backup_zip."""

    def test_skips_root_level_files(self) -> None:
        """Files not in entity_type/filename format are skipped."""
        from wavecore.api.services.backup._helpers import _parse_backup_zip

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            manifest = {
                "wave_version": "1.0.0",
                "format": "yaml",
                "schema_version": "1.0",
            }
            zf.writestr("manifest.json", json.dumps(manifest))
            zf.writestr("rootfile.yaml", "key: value")
            zf.writestr("tests/", "")  # directory entry - no filename part

        _manifest, entities, files, unreadable = _parse_backup_zip(buf.getvalue(), "test.zip")
        assert len(entities) == 0
        assert files == {}
        assert unreadable == {}

    def test_a_member_that_cannot_be_parsed_is_returned_as_unreadable(self) -> None:
        from wavecore.api.services.backup._helpers import _parse_backup_zip

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            manifest = {
                "wave_version": "1.0.0",
                "format": "json",
                "schema_version": "1.0",
            }
            zf.writestr("manifest.json", json.dumps(manifest))
            zf.writestr("tests/bad.json", "{not valid json!!!}")

        _manifest, entities, _files, unreadable = _parse_backup_zip(buf.getvalue(), "test.zip")
        assert unreadable == {"tests": ["bad.json"]}
        assert entities.get("tests", []) == []

    @pytest.mark.parametrize(
        ("member", "payload"),
        [
            ("tests/odd.yaml", b""),
            ("tests/odd.yaml", b"- one\n- two\n"),
            ("tests/odd.yaml", b"plain\n"),
            ("tests/odd.json", b"[1, 2]"),
        ],
        ids=["an empty file", "a list", "a bare word", "a JSON list"],
    )
    def test_a_member_that_is_not_a_mapping_is_returned_as_unreadable(
        self, member: str, payload: bytes
    ) -> None:
        from wavecore.api.services.backup._helpers import _parse_backup_zip

        archive = _build_backup_zip(
            {"tests": [_make_test("Good Test")]}, raw_members=[(member, payload)]
        )

        _manifest, entities, _files, unreadable = _parse_backup_zip(archive, "test.zip")

        assert unreadable == {"tests": [member.split("/", 1)[1]]}
        assert [document["name"] for document in entities["tests"]] == ["Good Test"]


class TestCreateBackupEdgeCases:
    """Tests for edge cases in create_backup."""

    def test_filename_deduplication(self) -> None:
        """Duplicate entity names produce unique filenames in the ZIP."""
        from wavecore.api.services.backup.service import create_backup

        # Mock _list_entities to return two tests with the same name
        dupes = [_make_test("Same Name"), _make_test("Same Name")]

        with patch(
            "wavecore.api.services.backup.service._list_entities",
            return_value=dupes,
        ):
            zip_bytes, _ = create_backup(["tests"])

        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
        test_files = [n for n in zf.namelist() if n.startswith("tests/")]
        assert len(test_files) == 2
        # All filenames should be unique
        assert len(test_files) == len(set(test_files))
        zf.close()


# ---------------------------------------------------------------------------
# Scheduler Tests
# ---------------------------------------------------------------------------


class TestExecuteScheduledBackup:
    """Tests for _execute_scheduled_backup."""

    def test_creates_backup_file(self, tmp_path: Path) -> None:
        """Backup file is written to save_directory."""
        from wavecore.api.services.backup.scheduler import _execute_scheduled_backup

        save_dir = tmp_path / "scheduled_backups"
        schedule = {
            "save_directory": str(save_dir),
            "entity_types": ["tests"],
            "format": "yaml",
            "compression_method": "deflate",
            "compression_level": 6,
            "secrets": "mask",
            "max_backups": 5,
        }

        _execute_scheduled_backup(schedule)

        backups = list(save_dir.glob("wave-backup-*.zip"))
        assert len(backups) == 1

    def test_creates_save_directory(self, tmp_path: Path) -> None:
        """Save directory is created if it doesn't exist."""
        from wavecore.api.services.backup.scheduler import _execute_scheduled_backup

        save_dir = tmp_path / "new" / "nested" / "dir"
        schedule = {
            "save_directory": str(save_dir),
            "entity_types": ["tests"],
            "max_backups": 5,
        }

        _execute_scheduled_backup(schedule)

        assert save_dir.exists()

    def test_retention_deletes_oldest(self, tmp_path: Path) -> None:
        """Retention policy deletes oldest backups when exceeding max_backups."""
        from wavecore.api.services.backup.scheduler import _execute_scheduled_backup

        save_dir = tmp_path / "retention_test"
        save_dir.mkdir(parents=True)

        # Pre-create 3 backup files
        for i in range(3):
            (save_dir / f"wave-backup-2026010{i}-000000.zip").write_bytes(b"old")

        schedule = {
            "save_directory": str(save_dir),
            "entity_types": ["tests"],
            "max_backups": 2,
        }

        _execute_scheduled_backup(schedule)

        backups = sorted(save_dir.glob("wave-backup-*.zip"))
        # max_backups=2, so after creating 1 new (total 4), should trim to 2
        assert len(backups) == 2

    def test_retention_no_delete_under_limit(self, tmp_path: Path) -> None:
        """No deletion when under max_backups."""
        from wavecore.api.services.backup.scheduler import _execute_scheduled_backup

        save_dir = tmp_path / "no_delete"
        save_dir.mkdir(parents=True)

        schedule = {
            "save_directory": str(save_dir),
            "entity_types": ["tests"],
            "max_backups": 10,
        }

        _execute_scheduled_backup(schedule)

        backups = list(save_dir.glob("wave-backup-*.zip"))
        assert len(backups) == 1

    @pytest.mark.parametrize(
        ("save_directory", "below_home"),
        [("~/wave-backups", "wave-backups"), ("nightly/wave", "nightly/wave")],
    )
    def test_a_home_or_relative_save_directory_is_written_under_the_home_folder(
        self,
        save_directory: str,
        below_home: str,
        wave_home: Path,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from wavecore.api.services.backup.scheduler import _execute_scheduled_backup

        monkeypatch.chdir(tmp_path)

        _execute_scheduled_backup({**_RUN_SCHEDULE, "save_directory": save_directory})

        assert len(list((wave_home / below_home).glob("wave-backup-*.zip"))) == 1
        assert list(tmp_path.iterdir()) == []

    def test_null_entity_types_back_up_every_part(
        self, tmp_path: Path, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.api.services.backup.scheduler import _execute_scheduled_backup, get_schedule

        function_id = _seed_function("bk_fn")
        save_dir = tmp_path / "every_part"
        stored = {
            "enabled": True,
            "cron": "0 2 * * *",
            "entity_types": None,
            "save_directory": str(save_dir),
        }
        load_config({"backup": {"schedule": stored}})
        schedule = get_schedule()
        assert schedule.get("save_directory") == str(save_dir)

        _execute_scheduled_backup(schedule)

        archives = list(save_dir.glob("wave-backup-*.zip"))
        assert len(archives) == 1
        zip_bytes = archives[0].read_bytes()
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
        assert set(manifest["entity_counts"]) == set(_BACKUP_PARTS)
        assert [member.get("id") for member in _members(zip_bytes, "functions")] == [function_id]

    @pytest.mark.parametrize("below", ["", "backups", "backups/nightly"])
    def test_a_save_directory_in_the_data_folder_fails_the_run(
        self, below: str, temp_storage_path: Path
    ) -> None:
        from wavecore.api.services.backup.scheduler import _execute_scheduled_backup

        save_directory = str(temp_storage_path / below)

        with pytest.raises(ValidationException, match=_refused_inside(temp_storage_path)):
            _execute_scheduled_backup({**_RUN_SCHEDULE, "save_directory": save_directory})

        assert list(temp_storage_path.rglob("wave-backup-*.zip")) == []


class TestUpdateScheduleStatus:
    """The scheduler records each run in backup.schedule in the config file (REQ-4.7.20)."""

    def test_records_the_status_and_the_time(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import _update_schedule_status, get_schedule

        _update_schedule_status("success", _RECORDED_AT)

        assert config_on_disk() == {
            "backup": {"schedule": {"last_run_status": "success", "last_run": _RECORDED_AT}}
        }
        assert get_schedule() == {
            **_default_schedule(),
            "last_run_status": "success",
            "last_run": _RECORDED_AT,
        }

    def test_a_status_without_a_time_records_the_status(
        self, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import _update_schedule_status

        _update_schedule_status("failed")

        stored = _schedule_on_disk(config_on_disk)
        assert stored.get("last_run_status") == "failed"
        assert stored.get("last_run") is None

    def test_a_status_without_a_time_keeps_the_earlier_time(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import _update_schedule_status, get_schedule

        load_config(
            {"backup": {"schedule": {"last_run": _RECORDED_AT, "last_run_status": "success"}}}
        )

        _update_schedule_status("failed")

        assert _schedule_on_disk(config_on_disk) == {
            "last_run": _RECORDED_AT,
            "last_run_status": "failed",
        }
        schedule = get_schedule()
        assert schedule.get("last_run") == _RECORDED_AT
        assert schedule.get("last_run_status") == "failed"

    def test_the_record_keeps_every_other_schedule_value(
        self, load_config: Callable[..., Any], config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        from wavecore.api.services.backup.scheduler import _update_schedule_status

        load_config({"backup": {"schedule": dict(_FULL_SCHEDULE)}})

        _update_schedule_status("failed", _RECORDED_AT)

        assert _schedule_on_disk(config_on_disk) == {
            **_FULL_SCHEDULE,
            "last_run_status": "failed",
            "last_run": _RECORDED_AT,
        }

    def test_the_record_survives_a_restart(self, load_config: Callable[..., Any]) -> None:
        from wavecore.api.services.backup.scheduler import _update_schedule_status, get_schedule

        _update_schedule_status("success", _RECORDED_AT)
        load_config()

        schedule = get_schedule()
        assert schedule.get("last_run") == _RECORDED_AT
        assert schedule.get("last_run_status") == "success"

    def test_the_record_writes_nothing_into_the_data_folder(self, temp_storage_path: Path) -> None:
        from wavecore.api.services.backup.scheduler import _update_schedule_status, get_schedule

        _update_schedule_status("success", _RECORDED_AT)

        assert get_schedule().get("last_run_status") == "success"
        assert not (temp_storage_path / "backup").exists()

    @pytest.mark.parametrize("status", ["success", "failed"])
    def test_a_refused_record_is_a_warning_and_never_an_error(
        self, status: str, read_only_config: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        from wavecore.api.services.backup.scheduler import _update_schedule_status

        before = read_only_config.read_bytes()

        with caplog.at_level(logging.WARNING, logger=_SCHEDULER_LOGGER):
            _update_schedule_status(status, _RECORDED_AT)

        assert _scheduler_warnings(caplog) == [
            f"Periodic backup result not recorded: {_read_only_refusal(read_only_config)}"
        ]
        assert read_only_config.read_bytes() == before


class TestSchedulerLoop:
    """Tests for _scheduler_loop async background task."""

    def test_exits_when_disabled(self, temp_storage_path: Path) -> None:
        """Scheduler loop exits immediately if schedule is disabled."""
        from wavecore.api.services.backup.scheduler import _scheduler_loop

        # A fresh config holds a disabled schedule
        asyncio.new_event_loop().run_until_complete(_scheduler_loop())

    def test_exits_on_invalid_cron(self, load_config: Callable[..., Any]) -> None:
        """Scheduler loop exits on invalid cron expression."""
        from wavecore.api.services.backup.scheduler import _scheduler_loop

        load_config({"backup": {"schedule": {"enabled": True, "cron": "not valid cron"}}})

        _run(_scheduler_loop())

    def test_executes_backup_and_loops(
        self,
        tmp_path: Path,
        load_config: Callable[..., Any],
        switch_schedule_off: Callable[[], None],
    ) -> None:
        """Scheduler executes backup when cron fires, then continues."""
        from wavecore.api.services.backup.scheduler import _scheduler_loop

        save_dir = tmp_path / "sched_loop"
        load_config({"backup": {"schedule": {**_RUN_SCHEDULE, "save_directory": str(save_dir)}}})

        with patch(
            "wavecore.api.services.backup.scheduler.asyncio.sleep", _sleep_then(switch_schedule_off)
        ):
            _run(_scheduler_loop())

        # Should have created at least one backup
        backups = list(save_dir.glob("wave-backup-*.zip"))
        assert len(backups) >= 1

    def test_a_run_writes_into_the_resolved_folder_and_records_success(
        self,
        wave_home: Path,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
        switch_schedule_off: Callable[[], None],
    ) -> None:
        from wavecore.api.services.backup.scheduler import _scheduler_loop

        monkeypatch.chdir(tmp_path)
        load_config({"backup": {"schedule": {**_RUN_SCHEDULE, "save_directory": "~/wave-backups"}}})
        started = datetime.now(UTC)

        with patch(
            "wavecore.api.services.backup.scheduler.asyncio.sleep", _sleep_then(switch_schedule_off)
        ):
            _run(_scheduler_loop())

        assert len(list((wave_home / "wave-backups").glob("wave-backup-*.zip"))) == 1
        assert list(tmp_path.iterdir()) == []
        recorded = _schedule_on_disk(config_on_disk)
        assert recorded.get("last_run_status") == "success"
        assert started <= datetime.fromisoformat(recorded["last_run"]) <= datetime.now(UTC)

    def test_handles_backup_failure(
        self,
        tmp_path: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
        switch_schedule_off: Callable[[], None],
    ) -> None:
        """Scheduler records failure status when backup raises."""
        from wavecore.api.services.backup.scheduler import _scheduler_loop

        save_dir = tmp_path / "fail_test"
        load_config({"backup": {"schedule": {**_RUN_SCHEDULE, "save_directory": str(save_dir)}}})
        started = datetime.now(UTC)

        def mock_execute(sd: dict[str, Any]) -> None:
            raise RuntimeError("Simulated backup failure")

        with (
            patch(
                "wavecore.api.services.backup.scheduler.asyncio.sleep",
                _sleep_then(switch_schedule_off),
            ),
            patch(
                "wavecore.api.services.backup.scheduler._execute_scheduled_backup",
                mock_execute,
            ),
        ):
            _run(_scheduler_loop())

        recorded = _schedule_on_disk(config_on_disk)
        assert recorded.get("last_run_status") == "failed"
        assert started <= datetime.fromisoformat(recorded["last_run"]) <= datetime.now(UTC)

    @pytest.mark.parametrize("below", ["", "backups"])
    def test_a_run_into_the_data_folder_writes_no_archive_and_records_failed(
        self,
        below: str,
        temp_storage_path: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
        switch_schedule_off: Callable[[], None],
    ) -> None:
        from wavecore.api.services.backup.scheduler import _scheduler_loop

        save_directory = str(temp_storage_path / below)
        load_config({"backup": {"schedule": {**_RUN_SCHEDULE, "save_directory": save_directory}}})
        started = datetime.now(UTC)

        with patch(
            "wavecore.api.services.backup.scheduler.asyncio.sleep", _sleep_then(switch_schedule_off)
        ):
            _run(_scheduler_loop())

        assert list(temp_storage_path.rglob("wave-backup-*.zip")) == []
        recorded = _schedule_on_disk(config_on_disk)
        assert recorded.get("last_run_status") == "failed"
        assert started <= datetime.fromisoformat(recorded["last_run"]) <= datetime.now(UTC)

    def test_a_refused_record_still_writes_the_archive(
        self,
        tmp_path: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
        switch_schedule_off: Callable[[], None],
        read_only_config: Path,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        from wavecore.api.services.backup.scheduler import _scheduler_loop

        save_dir = tmp_path / "refused_record"
        load_config({"backup": {"schedule": {**_RUN_SCHEDULE, "save_directory": str(save_dir)}}})

        with (
            caplog.at_level(logging.WARNING, logger=_SCHEDULER_LOGGER),
            patch(
                "wavecore.api.services.backup.scheduler.asyncio.sleep",
                _sleep_then(switch_schedule_off),
            ),
        ):
            _run(_scheduler_loop())

        assert len(list(save_dir.glob("wave-backup-*.zip"))) == 1
        assert _scheduler_warnings(caplog) == [
            f"Periodic backup result not recorded: {_read_only_refusal(read_only_config)}"
        ]
        recorded = _schedule_on_disk(config_on_disk)
        assert recorded.get("last_run") is None
        assert recorded.get("last_run_status") is None

    def test_cancellation(self, tmp_path: Path, load_config: Callable[..., Any]) -> None:
        """Scheduler loop handles cancellation gracefully."""
        from wavecore.api.services.backup.scheduler import _scheduler_loop

        # A yearly cron never fires during the test
        load_config(
            {
                "backup": {
                    "schedule": {
                        **_RUN_SCHEDULE,
                        "cron": "0 0 1 1 *",
                        "save_directory": str(tmp_path / "cancel_test"),
                    }
                }
            }
        )

        loop = asyncio.new_event_loop()
        task = loop.create_task(_scheduler_loop())

        async def cancel_after_brief() -> bool:
            await asyncio.sleep(0.05)
            waiting = not task.done()
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            return waiting

        waiting = loop.run_until_complete(cancel_after_brief())
        loop.close()

        assert waiting is True
        assert task.cancelled()


class TestStartStopScheduler:
    """Tests for start_scheduler and stop_scheduler."""

    def test_start_scheduler_when_enabled(
        self, tmp_path: Path, load_config: Callable[..., Any]
    ) -> None:
        """start_scheduler creates a task when schedule is enabled."""
        from wavecore.api.services.backup import scheduler as _scheduler_mod
        from wavecore.api.services.backup.scheduler import start_scheduler, stop_scheduler

        load_config(
            {
                "backup": {
                    "schedule": {
                        **_RUN_SCHEDULE,
                        "cron": "0 0 1 1 *",
                        "save_directory": str(tmp_path / "start_test"),
                    }
                }
            }
        )

        loop = asyncio.new_event_loop()
        loop.run_until_complete(start_scheduler())

        assert _scheduler_mod._scheduler_task is not None
        assert not _scheduler_mod._scheduler_task.done()

        # Cleanup
        loop.run_until_complete(stop_scheduler())
        assert _scheduler_mod._scheduler_task is None

    def test_start_scheduler_when_disabled(self, temp_storage_path: Path) -> None:
        """start_scheduler does nothing when schedule is disabled."""
        from wavecore.api.services.backup import scheduler as _scheduler_mod
        from wavecore.api.services.backup.scheduler import start_scheduler

        # No schedule file
        loop = asyncio.new_event_loop()
        loop.run_until_complete(start_scheduler())

        assert _scheduler_mod._scheduler_task is None

    def test_stop_scheduler_noop_when_not_running(self, temp_storage_path: Path) -> None:
        """stop_scheduler is a no-op when no task is running."""
        from wavecore.api.services.backup import scheduler as _scheduler_mod
        from wavecore.api.services.backup.scheduler import stop_scheduler

        _scheduler_mod._scheduler_task = None

        loop = asyncio.new_event_loop()
        loop.run_until_complete(stop_scheduler())

        assert _scheduler_mod._scheduler_task is None

    def test_start_stops_existing_before_starting(
        self, tmp_path: Path, load_config: Callable[..., Any]
    ) -> None:
        """start_scheduler stops an existing task before creating a new one."""
        from wavecore.api.services.backup import scheduler as _scheduler_mod
        from wavecore.api.services.backup.scheduler import start_scheduler, stop_scheduler

        load_config(
            {
                "backup": {
                    "schedule": {
                        **_RUN_SCHEDULE,
                        "cron": "0 0 1 1 *",
                        "save_directory": str(tmp_path / "restart_test"),
                    }
                }
            }
        )

        loop = asyncio.new_event_loop()
        loop.run_until_complete(start_scheduler())
        first_task = _scheduler_mod._scheduler_task

        loop.run_until_complete(start_scheduler())
        second_task = _scheduler_mod._scheduler_task

        assert first_task is not second_task
        assert first_task is not None
        assert first_task.cancelled() or first_task.done()

        # Cleanup
        loop.run_until_complete(stop_scheduler())


# ============================================================================
# Global Variables Backup/Restore
# ============================================================================


class TestSystemVariablesBackup:
    """Tests for system variables backup and restore integration."""

    def _reset_system_vars(self) -> None:
        """Reset system variable storage for test isolation."""
        from wavecore.api.services import variable_service

        variable_service._variable_storage.clear()

    def setup_method(self) -> None:
        self._reset_system_vars()

    def test_create_backup_with_system_variables(self) -> None:
        """Test that system variables are included in backup."""
        from wavecore.api.services import variable_service
        from wavecore.api.services.backup.service import create_backup

        variable_service.set_system_variables(
            {"api_url": {"type": "string", "value": "https://example.com"}}
        )

        zip_bytes, filename = create_backup(entity_types=["system_variables"])

        assert filename.endswith(".zip")
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
        names = zf.namelist()
        system_files = [n for n in names if n.startswith("system_variables/")]
        assert len(system_files) == 1
        assert "system-variables" in system_files[0]
        zf.close()

    def test_create_backup_system_variables_empty(self) -> None:
        """Test that backup with no system variables creates no entity files."""
        from wavecore.api.services.backup.service import create_backup

        zip_bytes, _ = create_backup(entity_types=["system_variables"])

        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
        names = zf.namelist()
        system_files = [n for n in names if n.startswith("system_variables/")]
        assert len(system_files) == 0
        zf.close()

    def test_create_backup_masks_system_secrets(self) -> None:
        """Test that secret system variables are masked in backup."""
        from wavecore.api.services import variable_service
        from wavecore.api.services.backup.service import create_backup

        variable_service.set_system_variables(
            {"api_key": {"type": "string", "value": "secret123", "secret": True}}
        )

        zip_bytes, _ = create_backup(entity_types=["system_variables"], secrets="mask")

        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
        system_files = [n for n in zf.namelist() if n.startswith("system_variables/")]
        content = yaml.safe_load(zf.read(system_files[0]))
        assert content["variables"]["api_key"]["value"] == "********"
        zf.close()

    def test_validate_backup_with_system_variables(self) -> None:
        """Test validation of backup containing system variables."""
        from wavecore.api.services.backup.service import validate_backup

        zip_bytes = _build_backup_zip(
            {"system_variables": [{"variables": {"x": {"type": "string"}}}]}
        )

        result = validate_backup(zip_bytes, "test.zip")

        assert "system_variables" in result["entity_summary"]
        summary = result["entity_summary"]["system_variables"]
        assert summary["total"] == 1

    def test_validate_backup_system_variables_conflict(self) -> None:
        """Test validation detects conflict when system vars already exist."""
        from wavecore.api.services import variable_service
        from wavecore.api.services.backup.service import validate_backup

        variable_service.set_system_variables({"existing": {"type": "string", "value": "val"}})

        zip_bytes = _build_backup_zip(
            {"system_variables": [{"variables": {"new": {"type": "string"}}}]}
        )

        result = validate_backup(zip_bytes, "test.zip")

        summary = result["entity_summary"]["system_variables"]
        assert summary["conflicts"] == 1

    def test_validate_backup_system_variables_empty_fatal(self) -> None:
        """Test validation counts empty system variables as fatal."""
        from wavecore.api.services.backup.service import validate_backup

        zip_bytes = _build_backup_zip({"system_variables": [{"variables": {}}]})

        result = validate_backup(zip_bytes, "test.zip")

        summary = result["entity_summary"]["system_variables"]
        assert summary["fatal"] == 1

    def test_restore_backup_system_variables_merge(self) -> None:
        """Test that restore merges system variables."""
        from wavecore.api.services import variable_service
        from wavecore.api.services.backup.service import restore_backup

        variable_service.set_system_variables(
            {
                "existing": {"type": "string", "value": "old_value"},
                "keep_me": {"type": "integer", "value": 42},
            }
        )

        zip_bytes = _build_backup_zip(
            {
                "system_variables": [
                    {
                        "variables": {
                            "existing": {"type": "string", "value": "new_value"},
                            "brand_new": {"type": "boolean", "value": True},
                        }
                    }
                ]
            }
        )

        result = restore_backup(
            zip_bytes,
            "test.zip",
            entity_types=["system_variables"],
            conflict_resolution="overwrite",
        )

        assert result["system_variables"]["imported"] == 1

        # Verify merged state
        system_result = variable_service.get_system_variables()
        variables = system_result["variables"]
        assert variables["existing"]["value"] == "new_value"
        assert variables["keep_me"]["value"] == 42
        assert variables["brand_new"]["value"] is True

    def test_restore_backup_system_variables_skip(self) -> None:
        """Test that restore with skip skips when system vars exist."""
        from wavecore.api.services import variable_service
        from wavecore.api.services.backup.service import restore_backup

        variable_service.set_system_variables({"existing": {"type": "string", "value": "keep"}})

        zip_bytes = _build_backup_zip(
            {"system_variables": [{"variables": {"new_var": {"type": "string", "value": "new"}}}]}
        )

        result = restore_backup(
            zip_bytes,
            "test.zip",
            entity_types=["system_variables"],
            conflict_resolution="skip",
        )

        assert result["system_variables"]["skipped"] == 1
        assert result["system_variables"]["imported"] == 0

    def test_restore_backup_system_variables_empty_skipped(self) -> None:
        """Test that restore with empty variables is counted as fatal."""
        from wavecore.api.services.backup.service import restore_backup

        zip_bytes = _build_backup_zip({"system_variables": [{"variables": {}}]})

        result = restore_backup(
            zip_bytes,
            "test.zip",
            entity_types=["system_variables"],
            conflict_resolution="overwrite",
        )

        assert result["system_variables"]["fatal"] == 1


# ============================================================================
# Test Data inside the tests entity
# ============================================================================


def _seed_testdata(test_id: str) -> None:
    """Give a test two files in its own test data folder."""
    from wavecore.api.services import storage_paths

    root = storage_paths.get_test_testdata_path(test_id)
    (root / "sub").mkdir(parents=True, exist_ok=True)
    (root / "rows.csv").write_bytes(b"id,name\n")
    (root / "sub" / "notes.txt").write_bytes(b"notes")


class TestCreateBackupCarriesTestData:
    """Each test's files ride inside the existing tests entity (REQ-3.4.3.2)."""

    def test_backup_writes_the_raw_test_data_entries(self) -> None:
        """The archive carries tests/testdata/<test_id>/<rel> with the raw bytes."""
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.tests import service as test_service

        created = test_service.create_test({"name": "Rich Test"})
        _seed_testdata(created["id"])

        zip_bytes, _filename = create_backup(entity_types=["tests"])

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = set(zf.namelist())
            assert f"tests/testdata/{created['id']}/rows.csv" in names
            assert f"tests/testdata/{created['id']}/sub/notes.txt" in names
            assert zf.read(f"tests/testdata/{created['id']}/rows.csv") == b"id,name\n"

    def test_the_manifest_count_is_unchanged(self) -> None:
        """Files do not change the tests count and add no entity type."""
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.tests import service as test_service

        created = test_service.create_test({"name": "Rich Test"})
        _seed_testdata(created["id"])

        zip_bytes, _filename = create_backup(entity_types=["tests"])

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["entity_counts"] == {"tests": 1}

    def test_a_test_without_files_adds_nothing(self) -> None:
        """Only the test that has a folder contributes raw entries."""
        from wavecore.api.services.backup.service import create_backup
        from wavecore.api.services.tests import service as test_service

        plain = test_service.create_test({"name": "Plain Test"})
        rich = test_service.create_test({"name": "Rich Test"})
        _seed_testdata(rich["id"])

        zip_bytes, _filename = create_backup(entity_types=["tests"])

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            raw = [n for n in zf.namelist() if n.startswith("tests/testdata/")]
            assert all(n.startswith(f"tests/testdata/{rich['id']}/") for n in raw)
            assert f"tests/testdata/{plain['id']}/" not in "".join(raw)
            assert len(raw) == 2


class TestParseBackupPartitionsTestData:
    """tests/testdata members are routed out before the entity parse."""

    def test_a_fixture_with_a_document_extension_is_never_an_entity(self) -> None:
        """A YAML fixture under tests/testdata does not become a test entity."""
        from wavecore.api.services.backup._helpers import _parse_backup_zip

        zip_bytes = _build_backup_zip(
            {"tests": [_make_test("Real Test", test_id="old-1")]},
            raw_members=[
                ("tests/testdata/old-1/conf.yaml", b"just: a fixture\n"),
                ("tests/testdata/old-1/rows.json", b'{"name": "Sneaky"}'),
                ("tests/testdata/old-1/notes.txt", b"plain text"),
            ],
        )

        _manifest, entities, files, _unreadable = _parse_backup_zip(zip_bytes, "backup.zip")

        assert [e["name"] for e in entities["tests"]] == ["Real Test"]
        assert dict(files["old-1"]) == {
            "conf.yaml": b"just: a fixture\n",
            "rows.json": b'{"name": "Sneaky"}',
            "notes.txt": b"plain text",
        }

    def test_a_text_fixture_never_becomes_a_string_entity(self) -> None:
        """A plain-text fixture is not appended to the tests entity list."""
        from wavecore.api.services.backup._helpers import _parse_backup_zip

        zip_bytes = _build_backup_zip(
            {"tests": [_make_test("Real Test", test_id="old-1")]},
            raw_members=[("tests/testdata/old-1/notes.txt", b"plain text")],
        )

        _manifest, entities, _files, _unreadable = _parse_backup_zip(zip_bytes, "backup.zip")

        assert all(isinstance(e, dict) for e in entities["tests"])
        assert len(entities["tests"]) == 1

    def test_nested_paths_and_several_tests_stay_apart(self) -> None:
        """Files are keyed by test id and keep their relative posix path."""
        from wavecore.api.services.backup._helpers import _parse_backup_zip

        zip_bytes = _build_backup_zip(
            {
                "tests": [
                    _make_test("One", test_id="old-1"),
                    _make_test("Two", test_id="old-2"),
                ]
            },
            raw_members=[
                ("tests/testdata/old-1/sub/a.txt", b"a"),
                ("tests/testdata/old-2/b.txt", b"b"),
            ],
        )

        _manifest, _entities, files, _unreadable = _parse_backup_zip(zip_bytes, "backup.zip")

        assert dict(files["old-1"]) == {"sub/a.txt": b"a"}
        assert dict(files["old-2"]) == {"b.txt": b"b"}

    def test_directory_entries_are_not_files(self) -> None:
        """A directory member under tests/testdata is ignored."""
        from wavecore.api.services.backup._helpers import _parse_backup_zip

        zip_bytes = _build_backup_zip(
            {"tests": [_make_test("One", test_id="old-1")]},
            raw_members=[
                ("tests/testdata/old-1/sub/", b""),
                ("tests/testdata/old-1/sub/a.txt", b"a"),
            ],
        )

        _manifest, _entities, files, _unreadable = _parse_backup_zip(zip_bytes, "backup.zip")

        assert dict(files["old-1"]) == {"sub/a.txt": b"a"}


class TestValidateBackupCountsTestData:
    """The validation preview reports one total for the archive's files."""

    def test_the_preview_reports_one_total(self) -> None:
        """entity_summary.tests.testdata_files counts every file in the archive."""
        from wavecore.api.services.backup.service import validate_backup

        zip_bytes = _build_backup_zip(
            {
                "tests": [
                    _make_test("One", test_id="old-1"),
                    _make_test("Two", test_id="old-2"),
                ]
            },
            raw_members=[
                ("tests/testdata/old-1/a.txt", b"a"),
                ("tests/testdata/old-1/sub/b.txt", b"b"),
                ("tests/testdata/old-2/c.txt", b"c"),
            ],
        )

        result = validate_backup(zip_bytes, "backup.zip")

        assert result["entity_summary"]["tests"]["testdata_files"] == 3

    def test_zero_when_no_test_carries_files(self) -> None:
        """An archive without test data reports zero."""
        from wavecore.api.services.backup.service import validate_backup

        zip_bytes = _build_backup_zip({"tests": [_make_test("One", test_id="old-1")]})

        result = validate_backup(zip_bytes, "backup.zip")

        assert result["entity_summary"]["tests"]["testdata_files"] == 0


# ============================================================================
# Network trust: trusted SSH hosts and Additional Certificates
# ============================================================================

_SAVED_NETWORK_SETTINGS = {
    "ssh_hosts": {"lock_trusted_hosts": True, "default_block_action": "strict"},
    "certificates": {"public_source": "host"},
}
_SEEDED_AT = "2026-09-01T08:00:00Z"
_ARCHIVED_AT = "2026-03-15T10:30:00Z"
_HOST_FIELDS = {"id", "host", "port", "public_key", "added"}
_CERTIFICATE_FIELDS = {"id", "pem", "added"}
_BAD_PEM_BLOCK = (
    "-----BEGIN CERTIFICATE-----\nTm90IGEgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----\n"
)


@pytest.fixture(scope="module")
def ssh_keys() -> dict[str, asyncssh.SSHKey]:
    return {
        "ed25519": asyncssh.generate_private_key("ssh-ed25519").convert_to_public(),
        "ed25519_other": asyncssh.generate_private_key("ssh-ed25519").convert_to_public(),
        "ecdsa": asyncssh.generate_private_key("ecdsa-sha2-nistp256").convert_to_public(),
    }


@pytest.fixture(scope="module")
def authorities() -> dict[str, Credential]:
    root = make_credential("Backup Lab Root", key_kind="ec256", is_ca=True)
    issuing = make_credential("Backup Lab Issuing CA", issuer=root, key_kind="ec256", is_ca=True)
    return {"root": root, "issuing": issuing}


@pytest.fixture
def hosts_file(temp_storage_path: Path) -> Path:
    return temp_storage_path / "network" / "ssh_hosts.yaml"


@pytest.fixture
def certificates_file(temp_storage_path: Path) -> Path:
    return temp_storage_path / "network" / "certificates.yaml"


def _openssh(key: asyncssh.SSHKey) -> str:
    return key.export_public_key("openssh").decode().strip()


def _host_entry(
    entry_id: str, host: str, port: int, key: asyncssh.SSHKey, added: str = _SEEDED_AT
) -> dict[str, Any]:
    return {"id": entry_id, "host": host, "port": port, "public_key": _openssh(key), "added": added}


def _certificate_id(credential: Credential) -> str:
    return credential.cert.fingerprint(hashes.SHA256()).hex()


def _certificate_entry(credential: Credential, added: str = _SEEDED_AT) -> dict[str, Any]:
    return {"id": _certificate_id(credential), "pem": credential.cert_pem, "added": added}


def _write_yaml(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
    return loaded or {}


def _saved_hosts(path: Path) -> list[dict[str, Any]]:
    """The hosts in the hosts file, none when the file is not there."""
    hosts: list[dict[str, Any]] = _read_yaml(path).get("hosts") or []
    return hosts


def _saved_certificates(path: Path) -> list[dict[str, Any]]:
    """The certificates in the certificates file, none when the file is not there."""
    certificates: list[dict[str, Any]] = _read_yaml(path).get("certificates") or []
    return certificates


def _host_keys(path: Path) -> list[tuple[str, int, str]]:
    return sorted((e["host"], e["port"], e["public_key"]) for e in _saved_hosts(path))


def _certificate_pems(path: Path) -> dict[str, str]:
    return {e["id"]: e["pem"] for e in _saved_certificates(path)}


def _preview(
    result: dict[str, Any], entity_type: str
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Split one preview row into its counts and its items."""
    return _split_items(result["entity_summary"][entity_type])


def _counts(total: int, ok: int = 0, conflicts: int = 0, fatal: int = 0) -> dict[str, int]:
    return {"total": total, "ok": ok, "conflicts": conflicts, "fixable": 0, "fatal": fatal}


class TestListNetworkTrustEntities:
    """The trusted hosts and the Additional Certificates are listed as stored (REQ-4.5.14)."""

    def test_trusted_hosts_are_listed_as_stored(
        self, hosts_file: Path, ssh_keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        from wavecore.api.services.backup._helpers import _list_entities

        hosts = [
            _host_entry("a" * 32, "db1", 22, ssh_keys["ed25519"]),
            _host_entry("b" * 32, "jump-02", 2222, ssh_keys["ecdsa"]),
        ]
        _write_yaml(hosts_file, {"hosts": hosts})

        assert _list_entities("ssh_hosts") == hosts

    def test_additional_certificates_are_listed_as_stored(
        self, certificates_file: Path, authorities: dict[str, Credential]
    ) -> None:
        from wavecore.api.services.backup._helpers import _list_entities

        entries = [
            _certificate_entry(authorities["root"]),
            _certificate_entry(authorities["issuing"]),
        ]
        _write_yaml(certificates_file, {"certificates": entries})

        assert _list_entities("certificates") == entries

    def test_no_saved_files_list_nothing(self) -> None:
        from wavecore.api.services.backup._helpers import _list_entities

        assert _list_entities("ssh_hosts") == []
        assert _list_entities("certificates") == []


class TestCreateBackupNetworkTrust:
    """Each trusted host and each Additional Certificate is one archive member (REQ-4.5.16)."""

    def test_each_trusted_host_is_one_member(
        self, hosts_file: Path, ssh_keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        from wavecore.api.services.backup.service import create_backup

        first = _host_entry("a" * 32, "db1", 22, ssh_keys["ed25519"])
        second = _host_entry("b" * 32, "jump-02", 2222, ssh_keys["ecdsa"])
        _write_yaml(hosts_file, {"hosts": [first, second]})

        zip_bytes, _filename = create_backup(entity_types=["ssh_hosts"])

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            assert set(zf.namelist()) == {
                "manifest.json",
                f"ssh_hosts/{first['id']}.yaml",
                f"ssh_hosts/{second['id']}.yaml",
            }
            assert yaml.safe_load(zf.read(f"ssh_hosts/{first['id']}.yaml")) == first
            assert yaml.safe_load(zf.read(f"ssh_hosts/{second['id']}.yaml")) == second
            assert json.loads(zf.read("manifest.json"))["entity_counts"] == {"ssh_hosts": 2}

    def test_each_additional_certificate_is_one_member(
        self, certificates_file: Path, authorities: dict[str, Credential]
    ) -> None:
        from wavecore.api.services.backup.service import create_backup

        root = _certificate_entry(authorities["root"])
        issuing = _certificate_entry(authorities["issuing"])
        _write_yaml(certificates_file, {"certificates": [root, issuing]})

        zip_bytes, _filename = create_backup(entity_types=["certificates"])

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            assert set(zf.namelist()) == {
                "manifest.json",
                f"certificates/{root['id']}.yaml",
                f"certificates/{issuing['id']}.yaml",
            }
            assert yaml.safe_load(zf.read(f"certificates/{root['id']}.yaml")) == root
            assert yaml.safe_load(zf.read(f"certificates/{issuing['id']}.yaml")) == issuing
            assert json.loads(zf.read("manifest.json"))["entity_counts"] == {"certificates": 2}

    def test_json_members_carry_the_same_entries(
        self,
        hosts_file: Path,
        certificates_file: Path,
        ssh_keys: dict[str, asyncssh.SSHKey],
        authorities: dict[str, Credential],
    ) -> None:
        from wavecore.api.services.backup.service import create_backup

        host = _host_entry("a" * 32, "db1", 22, ssh_keys["ed25519"])
        certificate = _certificate_entry(authorities["root"])
        _write_yaml(hosts_file, {"hosts": [host]})
        _write_yaml(certificates_file, {"certificates": [certificate]})

        zip_bytes, _filename = create_backup(entity_types=["ssh_hosts", "certificates"], fmt="json")

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            assert json.loads(zf.read(f"ssh_hosts/{host['id']}.json")) == host
            assert json.loads(zf.read(f"certificates/{certificate['id']}.json")) == certificate

    def test_the_policy_and_the_public_source_are_not_backed_up(
        self,
        hosts_file: Path,
        certificates_file: Path,
        ssh_keys: dict[str, asyncssh.SSHKey],
        authorities: dict[str, Credential],
        load_config: Callable[..., Any],
    ) -> None:
        from wavecore.api.services.backup.service import create_backup

        load_config({"network": _SAVED_NETWORK_SETTINGS})
        _write_yaml(hosts_file, {"hosts": [_host_entry("a" * 32, "db1", 22, ssh_keys["ed25519"])]})
        _write_yaml(certificates_file, {"certificates": [_certificate_entry(authorities["root"])]})

        zip_bytes, _filename = create_backup(entity_types=["ssh_hosts", "certificates"])

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            members = [name for name in zf.namelist() if name != "manifest.json"]
            assert len(members) == 2
            for name in members:
                entity_type = name.split("/", 1)[0]
                fields = _HOST_FIELDS if entity_type == "ssh_hosts" else _CERTIFICATE_FIELDS
                assert set(yaml.safe_load(zf.read(name))) == fields
            archive_text = b"".join(zf.read(name) for name in zf.namelist())
        for setting in (b"lock_trusted_hosts", b"default_block_action", b"public_source"):
            assert setting not in archive_text

    def test_no_saved_files_write_only_the_manifest(self) -> None:
        from wavecore.api.services.backup.service import create_backup

        zip_bytes, _filename = create_backup(entity_types=["ssh_hosts", "certificates"])

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            assert zf.namelist() == ["manifest.json"]
            assert json.loads(zf.read("manifest.json"))["entity_counts"] == {
                "ssh_hosts": 0,
                "certificates": 0,
            }


class TestValidateBackupNetworkTrust:
    """The restore preview classifies trusted hosts and certificates (REQ-4.5.14, REQ-4.5.16)."""

    def test_a_new_host_is_ok(self, ssh_keys: dict[str, asyncssh.SSHKey]) -> None:
        from wavecore.api.services.backup.service import validate_backup

        archive = _build_backup_zip(
            {"ssh_hosts": [_host_entry("b" * 32, "db1", 22, ssh_keys["ed25519"])]}
        )

        counts, items = _preview(validate_backup(archive, "backup.zip"), "ssh_hosts")

        assert counts == _counts(1, ok=1)
        assert items == []

    def test_the_same_host_port_and_key_type_is_a_conflict(
        self, hosts_file: Path, ssh_keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        from wavecore.api.services.backup.service import validate_backup

        _write_yaml(hosts_file, {"hosts": [_host_entry("a" * 32, "db1", 22, ssh_keys["ed25519"])]})
        archive = _build_backup_zip(
            {"ssh_hosts": [_host_entry("b" * 32, "db1", 22, ssh_keys["ed25519_other"])]}
        )

        counts, items = _preview(validate_backup(archive, "backup.zip"), "ssh_hosts")

        assert counts == _counts(1, conflicts=1)
        _assert_items(items, [("db1 port 22 (ED25519)", "conflict", _ALREADY_HERE)])

    @pytest.mark.parametrize(
        ("host", "port", "key_name"),
        [("db1", 22, "ecdsa"), ("db1", 2222, "ed25519_other"), ("db2", 22, "ed25519_other")],
        ids=["other-key-type", "other-port", "other-host"],
    )
    def test_a_different_conflict_key_is_ok(
        self,
        hosts_file: Path,
        ssh_keys: dict[str, asyncssh.SSHKey],
        host: str,
        port: int,
        key_name: str,
    ) -> None:
        from wavecore.api.services.backup.service import validate_backup

        _write_yaml(hosts_file, {"hosts": [_host_entry("a" * 32, "db1", 22, ssh_keys["ed25519"])]})
        archive = _build_backup_zip(
            {"ssh_hosts": [_host_entry("b" * 32, host, port, ssh_keys[key_name])]}
        )

        counts, items = _preview(validate_backup(archive, "backup.zip"), "ssh_hosts")

        assert counts == _counts(1, ok=1)
        assert items == []

    @pytest.mark.parametrize(
        ("public_key", "name"),
        [
            (lambda keys: "ssh-ed25519 AAAAnotakey", "db1 port 22 (ED25519)"),
            (lambda keys: "ssh-ed25519 !!!", "db1 port 22 (ED25519)"),
            (lambda keys: "ssh-rsa " + _openssh(keys["ed25519"]).split()[1], "db1 port 22 (RSA)"),
            (lambda keys: "ssh-dss AAAAnotakey", "db1 port 22"),
        ],
        ids=["undecodable", "not-base64", "type-mismatch", "unknown-key-type"],
    )
    def test_an_unreadable_host_key_is_fatal_and_named(
        self,
        ssh_keys: dict[str, asyncssh.SSHKey],
        public_key: Callable[[dict[str, asyncssh.SSHKey]], str],
        name: str,
    ) -> None:
        from wavecore.api.services.backup.service import validate_backup

        item = {
            **_host_entry("b" * 32, "db1", 22, ssh_keys["ed25519"]),
            "public_key": public_key(ssh_keys),
        }

        counts, items = _preview(
            validate_backup(_build_backup_zip({"ssh_hosts": [item]}), "backup.zip"), "ssh_hosts"
        )

        assert counts == _counts(1, fatal=1)
        _assert_items(items, [(name, "fatal", _UNREADABLE_KEY)])

    def test_host_counts_add_up_over_the_items(
        self, hosts_file: Path, ssh_keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        from wavecore.api.services.backup.service import validate_backup

        _write_yaml(hosts_file, {"hosts": [_host_entry("a" * 32, "db1", 22, ssh_keys["ed25519"])]})
        broken = {
            **_host_entry("d" * 32, "db1", 22, ssh_keys["ecdsa"]),
            "public_key": "ecdsa-sha2-nistp256 AAAAnotakey",
        }
        archive = _build_backup_zip(
            {
                "ssh_hosts": [
                    _host_entry("b" * 32, "db1", 22, ssh_keys["ed25519_other"]),
                    _host_entry("c" * 32, "db2", 22, ssh_keys["ecdsa"]),
                    broken,
                ]
            }
        )

        counts, items = _preview(validate_backup(archive, "backup.zip"), "ssh_hosts")

        assert counts == _counts(3, ok=1, conflicts=1, fatal=1)
        _assert_items(
            items,
            [
                ("db1 port 22 (ECDSA)", "fatal", _UNREADABLE_KEY),
                ("db1 port 22 (ED25519)", "conflict", _ALREADY_HERE),
            ],
        )

    def test_a_new_certificate_is_ok(self, authorities: dict[str, Credential]) -> None:
        from wavecore.api.services.backup.service import validate_backup

        archive = _build_backup_zip({"certificates": [_certificate_entry(authorities["root"])]})

        counts, items = _preview(validate_backup(archive, "backup.zip"), "certificates")

        assert counts == _counts(1, ok=1)
        assert items == []

    def test_a_saved_certificate_is_a_conflict(
        self, certificates_file: Path, authorities: dict[str, Credential]
    ) -> None:
        from wavecore.api.services.backup.service import validate_backup

        _write_yaml(certificates_file, {"certificates": [_certificate_entry(authorities["root"])]})
        archive = _build_backup_zip(
            {"certificates": [_certificate_entry(authorities["root"], added=_ARCHIVED_AT)]}
        )

        counts, items = _preview(validate_backup(archive, "backup.zip"), "certificates")

        assert counts == _counts(1, conflicts=1)
        _assert_items(items, [("Backup Lab Root", "conflict", _ALREADY_HERE)])

    @pytest.mark.parametrize(
        "pem",
        [
            lambda cas: "not a certificate",
            lambda cas: _BAD_PEM_BLOCK,
            lambda cas: cas["root"].cert_pem + cas["issuing"].cert_pem,
        ],
        ids=["plain-text", "bad-block", "two-certificates"],
    )
    def test_an_item_that_is_not_one_certificate_is_fatal_and_named(
        self,
        authorities: dict[str, Credential],
        pem: Callable[[dict[str, Credential]], str],
    ) -> None:
        from wavecore.api.services.backup.service import validate_backup

        item = {"id": "0" * 64, "pem": pem(authorities), "added": _ARCHIVED_AT}

        counts, items = _preview(
            validate_backup(_build_backup_zip({"certificates": [item]}), "backup.zip"),
            "certificates",
        )

        assert counts == _counts(1, fatal=1)
        _assert_items(items, [("0" * 64, "fatal", _NOT_A_CERTIFICATE)])

    def test_certificate_counts_add_up_over_the_items(
        self, certificates_file: Path, authorities: dict[str, Credential]
    ) -> None:
        from wavecore.api.services.backup.service import validate_backup

        _write_yaml(certificates_file, {"certificates": [_certificate_entry(authorities["root"])]})
        archive = _build_backup_zip(
            {
                "certificates": [
                    _certificate_entry(authorities["root"]),
                    _certificate_entry(authorities["issuing"]),
                    {"id": "0" * 64, "pem": _BAD_PEM_BLOCK, "added": _ARCHIVED_AT},
                ]
            }
        )

        counts, items = _preview(validate_backup(archive, "backup.zip"), "certificates")

        assert counts == _counts(3, ok=1, conflicts=1, fatal=1)
        _assert_items(
            items,
            [
                ("0" * 64, "fatal", _NOT_A_CERTIFICATE),
                ("Backup Lab Root", "conflict", _ALREADY_HERE),
            ],
        )


class TestRestoreBackupNetworkTrust:
    """Restore merges hosts and certificates into the saved lists (REQ-4.5.14, REQ-4.5.16)."""

    @pytest.mark.parametrize(
        ("resolution", "expected", "named", "db1_key"),
        [
            (
                "skip",
                {"imported": 1, "skipped": 1, "fatal": 0},
                [("db1 port 22 (ED25519)", "skipped", _ALREADY_HERE)],
                "ed25519",
            ),
            (
                "rename",
                {"imported": 1, "skipped": 1, "fatal": 0},
                [("db1 port 22 (ED25519)", "skipped", _ALREADY_HERE)],
                "ed25519",
            ),
            ("overwrite", {"imported": 2, "skipped": 0, "fatal": 0}, [], "ed25519_other"),
        ],
    )
    def test_hosts_conflict_on_host_port_and_key_type(
        self,
        hosts_file: Path,
        ssh_keys: dict[str, asyncssh.SSHKey],
        resolution: str,
        expected: dict[str, int],
        named: list[tuple[str, str, str]],
        db1_key: str,
    ) -> None:
        from wavecore.api.services.backup.service import restore_backup

        _write_yaml(hosts_file, {"hosts": [_host_entry("a" * 32, "db1", 22, ssh_keys["ed25519"])]})
        archive = _build_backup_zip(
            {
                "ssh_hosts": [
                    _host_entry("b" * 32, "db1", 22, ssh_keys["ed25519_other"]),
                    _host_entry("c" * 32, "db2", 2222, ssh_keys["ecdsa"]),
                ]
            }
        )

        result = restore_backup(archive, "backup.zip", conflict_resolution=resolution)

        assert set(result) == {"ssh_hosts"}
        counts, items = _split_items(result["ssh_hosts"])
        assert counts == expected
        _assert_items(items, named)
        assert _host_keys(hosts_file) == sorted(
            [("db1", 22, _openssh(ssh_keys[db1_key])), ("db2", 2222, _openssh(ssh_keys["ecdsa"]))]
        )

    def test_a_host_with_an_unreadable_key_is_fatal_and_not_stored(
        self, hosts_file: Path, ssh_keys: dict[str, asyncssh.SSHKey]
    ) -> None:
        from wavecore.api.services.backup.service import restore_backup

        broken = {
            **_host_entry("b" * 32, "db1", 22, ssh_keys["ed25519"]),
            "public_key": "ssh-ed25519 AAAAnotakey",
        }

        result = restore_backup(
            _build_backup_zip({"ssh_hosts": [broken]}),
            "backup.zip",
            conflict_resolution="overwrite",
        )

        assert set(result) == {"ssh_hosts"}
        counts, items = _split_items(result["ssh_hosts"])
        assert counts == _result_counts(fatal=1)
        _assert_items(items, [("db1 port 22 (ED25519)", "fatal", _UNREADABLE_KEY)])
        assert _host_keys(hosts_file) == []

    @pytest.mark.parametrize("resolution", ["skip", "overwrite", "rename"])
    def test_saved_certificates_are_skipped_in_every_mode(
        self, certificates_file: Path, authorities: dict[str, Credential], resolution: str
    ) -> None:
        from wavecore.api.services.backup.service import restore_backup

        kept = _certificate_entry(authorities["root"])
        _write_yaml(certificates_file, {"certificates": [kept]})
        archive = _build_backup_zip(
            {
                "certificates": [
                    _certificate_entry(authorities["root"], added=_ARCHIVED_AT),
                    _certificate_entry(authorities["issuing"], added=_ARCHIVED_AT),
                ]
            }
        )

        result = restore_backup(archive, "backup.zip", conflict_resolution=resolution)

        assert set(result) == {"certificates"}
        counts, items = _split_items(result["certificates"])
        assert counts == _result_counts(imported=1, skipped=1)
        _assert_items(items, [("Backup Lab Root", "skipped", _ALREADY_HERE)])
        entries = _saved_certificates(certificates_file)
        assert [e for e in entries if e["id"] == kept["id"]] == [kept]
        assert _certificate_pems(certificates_file) == {
            kept["id"]: authorities["root"].cert_pem,
            _certificate_id(authorities["issuing"]): authorities["issuing"].cert_pem,
        }

    def test_an_item_that_is_not_a_certificate_is_fatal_and_not_stored(
        self, certificates_file: Path
    ) -> None:
        from wavecore.api.services.backup.service import restore_backup

        item = {"id": "0" * 64, "pem": _BAD_PEM_BLOCK, "added": _ARCHIVED_AT}

        result = restore_backup(
            _build_backup_zip({"certificates": [item]}), "backup.zip", conflict_resolution="skip"
        )

        assert set(result) == {"certificates"}
        counts, items = _split_items(result["certificates"])
        assert counts == _result_counts(fatal=1)
        _assert_items(items, [("0" * 64, "fatal", _NOT_A_CERTIFICATE)])
        assert _certificate_pems(certificates_file) == {}

    def test_restore_keeps_the_policy_and_the_public_source(
        self,
        hosts_file: Path,
        certificates_file: Path,
        ssh_keys: dict[str, asyncssh.SSHKey],
        authorities: dict[str, Credential],
        load_config: Callable[..., Any],
        config_file: Path,
    ) -> None:
        from wavecore.api.services.backup.service import restore_backup

        load_config({"network": _SAVED_NETWORK_SETTINGS})
        settings = config_file.read_bytes()
        _write_yaml(hosts_file, {"hosts": []})
        _write_yaml(certificates_file, {"certificates": []})
        archive = _build_backup_zip(
            {
                "ssh_hosts": [_host_entry("b" * 32, "db1", 22, ssh_keys["ed25519"])],
                "certificates": [_certificate_entry(authorities["root"])],
            }
        )

        restore_backup(archive, "backup.zip", conflict_resolution="overwrite")

        assert config_file.read_bytes() == settings
        assert set(_read_yaml(hosts_file)) == {"hosts"}
        assert set(_read_yaml(certificates_file)) == {"certificates"}
        assert _host_keys(hosts_file) == [("db1", 22, _openssh(ssh_keys["ed25519"]))]
        assert set(_certificate_pems(certificates_file)) == {_certificate_id(authorities["root"])}

    def test_a_backup_restores_both_lists_into_empty_stores(
        self,
        hosts_file: Path,
        certificates_file: Path,
        ssh_keys: dict[str, asyncssh.SSHKey],
        authorities: dict[str, Credential],
    ) -> None:
        from wavecore.api.services.backup.service import create_backup, restore_backup

        hosts = [
            _host_entry("a" * 32, "db1", 22, ssh_keys["ed25519"]),
            _host_entry("b" * 32, "jump-02", 2222, ssh_keys["ecdsa"]),
        ]
        certificates = [
            _certificate_entry(authorities["root"]),
            _certificate_entry(authorities["issuing"]),
        ]
        _write_yaml(hosts_file, {"hosts": hosts})
        _write_yaml(certificates_file, {"certificates": certificates})
        zip_bytes, filename = create_backup(entity_types=["ssh_hosts", "certificates"])
        hosts_file.unlink()
        certificates_file.unlink()

        result = restore_backup(zip_bytes, filename)

        assert result == {
            "ssh_hosts": _result_part(imported=2),
            "certificates": _result_part(imported=2),
        }
        assert _host_keys(hosts_file) == sorted(
            (e["host"], e["port"], e["public_key"]) for e in hosts
        )
        assert _certificate_pems(certificates_file) == {e["id"]: e["pem"] for e in certificates}

    def test_only_the_selected_types_are_restored(
        self,
        hosts_file: Path,
        certificates_file: Path,
        ssh_keys: dict[str, asyncssh.SSHKey],
        authorities: dict[str, Credential],
    ) -> None:
        from wavecore.api.services.backup.service import restore_backup

        archive = _build_backup_zip(
            {
                "ssh_hosts": [_host_entry("b" * 32, "db1", 22, ssh_keys["ed25519"])],
                "certificates": [_certificate_entry(authorities["root"])],
            }
        )

        result = restore_backup(archive, "backup.zip", entity_types=["certificates"])

        assert result == {"certificates": _result_part(imported=1)}
        assert _host_keys(hosts_file) == []
        assert set(_certificate_pems(certificates_file)) == {_certificate_id(authorities["root"])}
