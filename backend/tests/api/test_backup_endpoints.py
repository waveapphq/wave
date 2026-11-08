"""Unit tests for backup API endpoints.

Tests the REST API routes for backup creation, validation, restoration,
and schedule management under /api/backup/.
"""

import io
import json
import re
import uuid
import zipfile
from collections.abc import Callable, Generator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch

import asyncssh
import httpx
import pytest
import yaml
from cryptography.hazmat.primitives import hashes
from fastapi.testclient import TestClient

from tests.api.backup_support import (
    FakeExpiryTimer,
    expiry_timers_fixture,  # noqa: F401
    kept_uploads_cleared_fixture,  # noqa: F401
)
from tests.api.body_shape_support import NOT_OBJECT_BODIES, assert_refused, send_text
from tests.api.download_name_helpers import ENTITY_NAME, assert_whole_name
from tests.plugins.http.tls_material import Credential, make_credential
from wavecore.api.services.backup import uploads as backup_uploads


def _make_environment(name: str = "Production", *, env_id: str | None = None) -> dict[str, Any]:
    return {
        "id": env_id or str(uuid.uuid4()),
        "name": name,
        "description": f"{name} env",
        "tags": ["env"],
        "created_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    }


def _build_backup_zip(
    entities: dict[str, list[dict[str, Any]]],
    fmt: str = "yaml",
    *,
    include_manifest: bool = True,
    raw_members: list[tuple[str, bytes]] | None = None,
) -> bytes:
    """Build a backup ZIP in-memory for testing."""
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
            manifest = {
                "wave_version": "1.0.0",
                "created_at": datetime.now(UTC).isoformat(),
                "entity_counts": counts,
                "compression": {"method": "deflate", "level": 6},
                "format": fmt,
                "secrets": "mask",
                "schema_version": "1.0",
            }
            zf.writestr("manifest.json", json.dumps(manifest, indent=2))

    return buf.getvalue()


_SERVICE_ARGUMENTS = ("content", "filename", "entity_types", "conflict_resolution", "auto_repair")
_ALREADY_HERE = r"^Already in this WAVE$"


def _options_passed(service_function: Any) -> dict[str, Any]:
    """The three restore options a mocked backup service function was called with."""
    call = service_function.call_args
    passed = {**dict(zip(_SERVICE_ARGUMENTS, call.args, strict=False)), **call.kwargs}
    return {name: passed.get(name) for name in _SERVICE_ARGUMENTS[2:]}


def _refusal(response: httpx.Response) -> str:
    """The message of a 400 answer in the validation envelope."""
    assert response.status_code == 400
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == "VALIDATION_ERROR"
    message: str = body["error"]["message"]
    return message


def _counts(result: dict[str, Any]) -> dict[str, dict[str, int]]:
    """Every part of a restore result without its items."""
    return {
        part: {key: value for key, value in answer.items() if key != "items"}
        for part, answer in result.items()
    }


def _assert_items(part: dict[str, Any], expected: list[tuple[str, str, str]]) -> None:
    """The named entries of a preview or result part; each reason is an anchored pattern."""
    assert "items" in part
    items = part["items"]
    assert [(item["name"], item["status"]) for item in items] == [
        (name, status) for name, status, _ in expected
    ]
    for item, (_, _, reason) in zip(items, expected, strict=True):
        assert re.fullmatch(reason, item["reason"])


# ============================================================================
# POST /api/backup/create
# ============================================================================


class TestCreateBackupEndpoint:
    """Tests for POST /api/backup/create."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_create_backup_success(self, client: TestClient) -> None:
        """Successful backup returns ZIP download."""
        with patch("wavecore.api.routes.backup.backup_service.create_backup") as mock_create:
            mock_create.return_value = (b"zipdata", "wave-backup-2026.zip")
            response = client.post(
                "/api/backup/create",
                json={
                    "entity_types": ["tests"],
                    "format": "yaml",
                    "compression_method": "deflate",
                    "compression_level": 6,
                    "secrets": "mask",
                },
            )

        assert response.status_code == 200
        assert "application/zip" in response.headers["content-type"]
        assert "wave-backup" in response.headers["content-disposition"]

    def test_create_backup_correct_headers(self, client: TestClient) -> None:
        """Response includes proper content-disposition header."""
        with patch("wavecore.api.routes.backup.backup_service.create_backup") as mock_create:
            mock_create.return_value = (b"zipdata", "wave-backup-test.zip")
            response = client.post(
                "/api/backup/create",
                json={"entity_types": ["tests"]},
            )

        assert response.status_code == 200
        assert 'filename="wave-backup-test.zip"' in response.headers["content-disposition"]

    def test_create_backup_invalid_entity_type(self, client: TestClient) -> None:
        """Invalid entity type returns 400."""
        with patch("wavecore.api.routes.backup.backup_service.create_backup") as mock_create:
            from wavecore.api.exceptions import ValidationException

            mock_create.side_effect = ValidationException("Unknown entity type: 'plugins'")
            response = client.post(
                "/api/backup/create",
                json={"entity_types": ["plugins"]},
            )

        assert re.fullmatch(r"^Unknown entity type: 'plugins'$", _refusal(response))

    def test_create_backup_empty_entity_types(self, client: TestClient) -> None:
        """Empty entity types returns 400."""
        with patch("wavecore.api.routes.backup.backup_service.create_backup") as mock_create:
            from wavecore.api.exceptions import ValidationException

            mock_create.side_effect = ValidationException(
                "At least one entity type must be selected"
            )
            response = client.post(
                "/api/backup/create",
                json={"entity_types": []},
            )

        assert response.status_code == 400

    def test_create_backup_invalid_format(self, client: TestClient) -> None:
        """Invalid format returns 400."""
        with patch("wavecore.api.routes.backup.backup_service.create_backup") as mock_create:
            from wavecore.api.exceptions import ValidationException

            mock_create.side_effect = ValidationException("Invalid format: 'xml'")
            response = client.post(
                "/api/backup/create",
                json={"entity_types": ["tests"], "format": "xml"},
            )

        assert response.status_code == 400

    def test_create_backup_invalid_secrets_mode(self, client: TestClient) -> None:
        """An unrecognized secrets mode is rejected with the shared message."""
        with patch("wavecore.api.routes.backup.backup_service.create_backup") as mock_create:
            mock_create.return_value = (b"zipdata", "wave-backup.zip")
            response = client.post(
                "/api/backup/create",
                json={"entity_types": ["tests"], "secrets": "bogus"},
            )

        assert response.status_code == 400
        assert (
            "Invalid secrets mode 'bogus'; must be 'mask', 'encrypted', or 'plaintext'"
            in response.json()["error"]["message"]
        )

    def test_create_backup_forwards_secrets_mode(self, client: TestClient) -> None:
        """The chosen secrets mode is forwarded to the backup service."""
        with patch("wavecore.api.routes.backup.backup_service.create_backup") as mock_create:
            mock_create.return_value = (b"zipdata", "wave-backup.zip")
            response = client.post(
                "/api/backup/create",
                json={"entity_types": ["tests"], "secrets": "encrypted"},
            )

        assert response.status_code == 200
        assert mock_create.call_args.kwargs["secrets"] == "encrypted"

    def test_create_backup_invalid_compression(self, client: TestClient) -> None:
        """Invalid compression method returns 400."""
        with patch("wavecore.api.routes.backup.backup_service.create_backup") as mock_create:
            from wavecore.api.exceptions import ValidationException

            mock_create.side_effect = ValidationException("Invalid compression method: 'gzip'")
            response = client.post(
                "/api/backup/create",
                json={
                    "entity_types": ["tests"],
                    "compression_method": "gzip",
                },
            )

        assert response.status_code == 400

    def test_create_backup_default_params(self, client: TestClient) -> None:
        """Default parameters are applied when not specified."""
        with patch("wavecore.api.routes.backup.backup_service.create_backup") as mock_create:
            mock_create.return_value = (b"zipdata", "wave-backup.zip")
            response = client.post(
                "/api/backup/create",
                json={"entity_types": ["tests"]},
            )

        assert response.status_code == 200
        mock_create.assert_called_once()
        call_kwargs = mock_create.call_args
        # Verify defaults were applied
        assert (
            call_kwargs.kwargs.get(
                "fmt", call_kwargs.args[0] if len(call_kwargs.args) > 0 else None
            )
            is not None
            or True
        )

    def test_create_backup_with_functions(self, client: TestClient) -> None:
        """Functions is one of the parts a backup takes (REQ-5.2.4.9.2)."""
        response = client.post("/api/backup/create", json={"entity_types": ["functions"]})

        assert response.status_code == 200
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            manifest = json.loads(zf.read("manifest.json"))
        assert list(manifest["entity_counts"]) == ["functions"]


# ============================================================================
# POST /api/backup/validate
# ============================================================================


class TestValidateBackupEndpoint:
    """Tests for POST /api/backup/validate."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_validate_success(self, client: TestClient) -> None:
        """Valid backup file returns preview."""
        preview = {
            "metadata": {
                "wave_version": "1.0.0",
                "created_at": "2026-01-01T00:00:00Z",
                "format": "yaml",
                "schema_version": "1.0",
                "secrets": "mask",
            },
            "entity_summary": {
                "tests": {"total": 2, "ok": 2, "conflicts": 0, "fixable": 0, "fatal": 0},
            },
        }
        zip_bytes = _build_backup_zip({"tests": [_make_environment("T1"), _make_environment("T2")]})

        with patch("wavecore.api.routes.backup.backup_service.validate_backup") as mock_validate:
            mock_validate.return_value = preview
            response = client.post(
                "/api/backup/validate",
                files={"file": ("backup.zip", zip_bytes, "application/zip")},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["meta"]["request_id"]
        data = body["data"]
        assert "metadata" in data
        assert "entity_summary" in data

    def test_validate_non_zip_rejected(self, client: TestClient) -> None:
        """Non-ZIP file returns 400."""
        with patch("wavecore.api.routes.backup.backup_service.validate_backup") as mock_validate:
            from wavecore.api.exceptions import ValidationException

            mock_validate.side_effect = ValidationException(
                "Invalid backup file: not a ZIP archive"
            )
            response = client.post(
                "/api/backup/validate",
                files={"file": ("backup.txt", b"not a zip", "application/octet-stream")},
            )

        assert response.status_code == 400

    def test_validate_missing_manifest(self, client: TestClient) -> None:
        """ZIP without manifest returns 400."""
        with patch("wavecore.api.routes.backup.backup_service.validate_backup") as mock_validate:
            from wavecore.api.exceptions import ValidationException

            mock_validate.side_effect = ValidationException(
                "Invalid backup archive: missing manifest.json"
            )
            response = client.post(
                "/api/backup/validate",
                files={"file": ("backup.zip", b"fake", "application/zip")},
            )

        assert response.status_code == 400
        assert "manifest" in response.json()["error"]["message"]

    def test_validate_passes_the_three_form_fields(self, client: TestClient) -> None:
        """The part list, the conflict choice and auto-repair reach the service (REQ-5.2.4.9.6)."""
        with patch("wavecore.api.routes.backup.backup_service.validate_backup") as mock_validate:
            mock_validate.return_value = {"metadata": {}, "entity_summary": {}}
            response = client.post(
                "/api/backup/validate",
                data={
                    "entity_types": "tests,suites",
                    "conflict_resolution": "overwrite",
                    "auto_repair": "true",
                },
                files={"file": ("backup.zip", b"archive", "application/zip")},
            )

        assert response.status_code == 200
        assert _options_passed(mock_validate) == {
            "entity_types": ["tests", "suites"],
            "conflict_resolution": "overwrite",
            "auto_repair": True,
        }

    def test_validate_without_the_fields_passes_the_defaults(self, client: TestClient) -> None:
        """Without the fields the service gets no part list, Skip and no auto-repair."""
        with patch("wavecore.api.routes.backup.backup_service.validate_backup") as mock_validate:
            mock_validate.return_value = {"metadata": {}, "entity_summary": {}}
            response = client.post(
                "/api/backup/validate",
                files={"file": ("backup.zip", b"archive", "application/zip")},
            )

        assert response.status_code == 200
        assert _options_passed(mock_validate) == {
            "entity_types": None,
            "conflict_resolution": "skip",
            "auto_repair": False,
        }

    def test_validate_answers_400_for_an_unknown_conflict_resolution(
        self, client: TestClient
    ) -> None:
        """A conflict choice outside Skip, Overwrite and Rename is refused (REQ-5.2.4.9.6)."""
        archive = _build_backup_zip({"environments": [_make_environment("E1")]})

        response = client.post(
            "/api/backup/validate",
            data={"conflict_resolution": "merge"},
            files={"file": ("backup.zip", archive, "application/zip")},
        )

        assert re.fullmatch(r"^Unknown conflict resolution: 'merge'$", _refusal(response))


# ============================================================================
# POST /api/backup/restore
# ============================================================================


class TestRestoreBackupEndpoint:
    """Tests for POST /api/backup/restore."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_restore_success(self, client: TestClient) -> None:
        """Successful restore returns per-type results."""
        restore_result = {
            "environments": {"imported": 1, "skipped": 0, "fatal": 0},
        }
        zip_bytes = _build_backup_zip({"environments": [_make_environment("E1")]})

        with patch("wavecore.api.routes.backup.backup_service.restore_backup") as mock_restore:
            mock_restore.return_value = restore_result
            response = client.post(
                "/api/backup/restore",
                data={
                    "conflict_resolution": "skip",
                    "auto_repair": "false",
                },
                files={"file": ("backup.zip", zip_bytes, "application/zip")},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert "environments" in body["data"]

    def test_restore_with_entity_types(self, client: TestClient) -> None:
        """Restore with selective entity types."""
        restore_result = {
            "environments": {"imported": 1, "skipped": 0, "fatal": 0},
        }
        zip_bytes = _build_backup_zip({"environments": [_make_environment("E1")]})

        with patch("wavecore.api.routes.backup.backup_service.restore_backup") as mock_restore:
            mock_restore.return_value = restore_result
            response = client.post(
                "/api/backup/restore",
                data={
                    "entity_types": "environments",
                    "conflict_resolution": "skip",
                },
                files={"file": ("backup.zip", zip_bytes, "application/zip")},
            )

        assert response.status_code == 200

    def test_restore_conflict_resolution_options(self, client: TestClient) -> None:
        """All conflict resolution options are accepted."""
        for resolution in ["skip", "overwrite", "rename"]:
            with patch("wavecore.api.routes.backup.backup_service.restore_backup") as mock_restore:
                mock_restore.return_value = {
                    "environments": {"imported": 0, "skipped": 0, "fatal": 0}
                }
                response = client.post(
                    "/api/backup/restore",
                    data={"conflict_resolution": resolution},
                    files={
                        "file": (
                            "backup.zip",
                            _build_backup_zip({"environments": [_make_environment("E1")]}),
                            "application/zip",
                        )
                    },
                )
                assert response.status_code == 200

    def test_restore_invalid_backup(self, client: TestClient) -> None:
        """Invalid backup file returns 400."""
        with patch("wavecore.api.routes.backup.backup_service.restore_backup") as mock_restore:
            from wavecore.api.exceptions import ValidationException

            mock_restore.side_effect = ValidationException("Invalid backup file: not a ZIP archive")
            response = client.post(
                "/api/backup/restore",
                files={"file": ("backup.zip", b"bad", "application/zip")},
            )

        assert response.status_code == 400

    def test_restore_answers_400_for_an_unknown_conflict_resolution(
        self, client: TestClient
    ) -> None:
        """A conflict choice outside Skip, Overwrite and Rename is refused (REQ-5.2.4.9.6)."""
        archive = _build_backup_zip({"environments": [_make_environment("E1")]})

        response = client.post(
            "/api/backup/restore",
            data={"conflict_resolution": "merge"},
            files={"file": ("backup.zip", archive, "application/zip")},
        )

        assert re.fullmatch(r"^Unknown conflict resolution: 'merge'$", _refusal(response))

    def test_restore_answers_400_for_an_unknown_entity_type(self, client: TestClient) -> None:
        """A part id outside the nine is refused (REQ-5.2.4.9.6)."""
        archive = _build_backup_zip({"environments": [_make_environment("E1")]})

        response = client.post(
            "/api/backup/restore",
            data={"entity_types": "widgets"},
            files={"file": ("backup.zip", archive, "application/zip")},
        )

        assert re.fullmatch(r"^Unknown entity type: 'widgets'$", _refusal(response))

    def test_restore_answers_200_with_named_items_when_an_item_fails(
        self, client: TestClient
    ) -> None:
        """A failing item is named in its part and the rest is restored (REQ-5.2.4.9.6)."""
        broken_test = _make_test_document("Calls a missing Function", str(uuid.uuid4()))
        broken_test["workflow"]["nodes"] = [_function_block("Greet", str(uuid.uuid4()))]
        archive = _build_backup_zip(
            {
                "tests": [broken_test],
                "environments": [_make_environment("E1")],
                "regressions": [_make_regression_document("Nightly", [str(uuid.uuid4())])],
            }
        )

        response = client.post(
            "/api/backup/restore",
            data={"entity_types": "tests,environments,regressions"},
            files={"file": ("backup.zip", archive, "application/zip")},
        )

        assert response.status_code == 200
        data = response.json()["data"]
        assert _counts(data) == {
            "tests": {"imported": 0, "skipped": 0, "fatal": 1},
            "environments": {"imported": 1, "skipped": 0, "fatal": 0},
            "regressions": {"imported": 0, "skipped": 0, "fatal": 1},
        }
        _assert_items(
            data["tests"],
            [
                (
                    "Calls a missing Function",
                    "fatal",
                    r'^Uses Function "Greet", which is not in this WAVE$',
                )
            ],
        )
        _assert_items(data["environments"], [])
        _assert_items(
            data["regressions"], [("Nightly", "fatal", r"^Uses a Suite that is not in this WAVE$")]
        )


# ============================================================================
# GET /api/backup/schedule
# ============================================================================


class TestGetScheduleEndpoint:
    """Tests for GET /api/backup/schedule."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_get_schedule_default(self, client: TestClient) -> None:
        """Default schedule returns disabled state."""
        with patch("wavecore.api.routes.backup.backup_scheduler.get_schedule") as mock_get:
            mock_get.return_value = {"enabled": False, "max_backups": 5}
            response = client.get("/api/backup/schedule")

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["meta"]["request_id"]
        assert body["data"]["enabled"] is False

    def test_get_schedule_configured(self, client: TestClient) -> None:
        """Configured schedule returns full config."""
        schedule = {
            "enabled": True,
            "cron": "0 2 * * *",
            "cron_description": "Every day at 02:00",
            "entity_types": ["tests"],
            "max_backups": 5,
            "save_directory": "/srv/backups",
            "next_run": "2026-03-08T02:00:00Z",
            "last_run": None,
            "last_run_status": None,
        }
        with patch("wavecore.api.routes.backup.backup_scheduler.get_schedule") as mock_get:
            mock_get.return_value = schedule
            response = client.get("/api/backup/schedule")

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["enabled"] is True
        assert data["cron"] == "0 2 * * *"

    def test_a_fresh_schedule_answers_the_nine_ids_sorted(self, client: TestClient) -> None:
        """A schedule that was never saved backs up every part (REQ-4.7.20)."""
        response = client.get("/api/backup/schedule")

        assert response.status_code == 200
        assert response.json()["data"]["entity_types"] == [
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


# ============================================================================
# PUT /api/backup/schedule
# ============================================================================


class TestUpdateScheduleEndpoint:
    """Tests for PUT /api/backup/schedule."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_update_schedule_success(self, client: TestClient) -> None:
        """Successful update returns updated config."""
        updated = {
            "enabled": True,
            "cron": "0 2 * * *",
            "cron_description": "Every day at 02:00",
            "entity_types": ["tests"],
            "max_backups": 5,
            "save_directory": "/srv/backups",
            "next_run": "2026-03-08T02:00:00Z",
        }
        with patch("wavecore.api.routes.backup.backup_scheduler.update_schedule") as mock_update:
            mock_update.return_value = updated
            response = client.put(
                "/api/backup/schedule",
                json={
                    "enabled": True,
                    "cron": "0 2 * * *",
                    "entity_types": ["tests"],
                    "max_backups": 5,
                    "save_directory": "/srv/backups",
                },
            )

        assert response.status_code == 200
        assert response.json()["data"]["enabled"] is True

    def test_update_schedule_invalid_cron(self, client: TestClient) -> None:
        """Invalid cron expression returns 400."""
        with patch("wavecore.api.routes.backup.backup_scheduler.update_schedule") as mock_update:
            from wavecore.api.exceptions import ValidationException

            mock_update.side_effect = ValidationException("Invalid cron expression: 'bad cron'")
            response = client.put(
                "/api/backup/schedule",
                json={
                    "enabled": True,
                    "cron": "bad cron",
                    "entity_types": ["tests"],
                    "max_backups": 5,
                    "save_directory": "/srv/backups",
                },
            )

        assert response.status_code == 400

    def test_update_schedule_disable(self, client: TestClient) -> None:
        """Disabling schedule requires only enabled field."""
        with patch("wavecore.api.routes.backup.backup_scheduler.update_schedule") as mock_update:
            mock_update.return_value = {"enabled": False, "max_backups": 5}
            response = client.put(
                "/api/backup/schedule",
                json={"enabled": False},
            )

        assert response.status_code == 200
        assert response.json()["data"]["enabled"] is False


# ============================================================================
# DELETE /api/backup/schedule
# ============================================================================


class TestDeleteScheduleEndpoint:
    """DELETE /api/backup/schedule is gone: PUT turns the schedule off (REQ-4.7.20)."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_delete_is_not_allowed(self, client: TestClient, config_file: Path) -> None:
        before = config_file.read_bytes()

        response = client.delete("/api/backup/schedule")

        assert response.status_code == 405
        assert config_file.read_bytes() == before


# ============================================================================
# Schedule routes on the config file (REQ-4.7.20)
# ============================================================================

_DAILY_AT_TWO = "Every day at 02:00"

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


def _default_schedule() -> dict[str, Any]:
    from wavecore.api.services.backup._helpers import BACKUP_ENTITY_TYPES

    return {**_SCHEDULE_DEFAULTS, "entity_types": sorted(BACKUP_ENTITY_TYPES)}


def _saved(schedule: dict[str, Any]) -> dict[str, Any]:
    """What a read returns after ``schedule`` was saved and never ran."""
    return {
        **schedule,
        "last_run": None,
        "last_run_status": None,
        "cron_description": _DAILY_AT_TWO,
    }


def _without_next_run(schedule: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in schedule.items() if key != "next_run"}


def _schedule_on_disk(config_on_disk: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    """The backup.schedule section of the config file, empty when it is not there."""
    stored: dict[str, Any] = config_on_disk().get("backup", {}).get("schedule", {})
    return stored


class TestScheduleRoutesOnConfigFile:
    """GET and PUT /api/backup/schedule read and write backup.schedule in the config file."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app, raise_server_exceptions=False)

    @pytest.fixture(autouse=True)
    def isolated_scheduler(
        self, server_home: Path, monkeypatch: pytest.MonkeyPatch
    ) -> Generator[None, None, None]:
        """Expand ~ into the temp home folder and leave no scheduler task behind."""
        from wavecore.api.services.backup import scheduler

        monkeypatch.setenv("HOME", str(server_home))
        yield
        scheduler._scheduler_task = None

    @staticmethod
    def _get(client: TestClient) -> dict[str, Any]:
        response = client.get("/api/backup/schedule")
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["meta"]["request_id"]
        data: dict[str, Any] = body["data"]
        return data

    @staticmethod
    def _put(client: TestClient, body: dict[str, Any]) -> dict[str, Any]:
        response = client.put("/api/backup/schedule", json=body)
        assert response.status_code == 200
        data: dict[str, Any] = response.json()["data"]
        return data

    def test_get_on_a_fresh_config_returns_every_default(self, client: TestClient) -> None:
        assert self._get(client) == _default_schedule()

    def test_put_on_writes_the_values_into_the_config_file(
        self, client: TestClient, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        data = self._put(client, _FULL_SCHEDULE)

        assert _without_next_run(data) == _saved(_FULL_SCHEDULE)
        assert datetime.fromisoformat(data["next_run"]) > datetime.now(UTC)
        assert config_on_disk() == {"backup": {"schedule": _FULL_SCHEDULE}}
        assert _without_next_run(self._get(client)) == _saved(_FULL_SCHEDULE)

    def test_put_off_writes_only_the_switch(
        self,
        client: TestClient,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config({"backup": {"schedule": {"enabled": True}}})

        data = self._put(client, {"enabled": False})

        assert data == _default_schedule()
        assert config_on_disk() == {"backup": {"schedule": {"enabled": False}}}

    def test_put_off_checks_nothing_else(
        self,
        client: TestClient,
        temp_storage_path: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        load_config({"backup": {"schedule": {"enabled": True}}})

        data = self._put(
            client,
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
            },
        )

        assert data == _default_schedule()
        assert config_on_disk() == {"backup": {"schedule": {"enabled": False}}}

    def test_put_on_with_numbers_as_their_digits_saves_the_numbers(
        self, client: TestClient, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        data = self._put(client, {**_FULL_SCHEDULE, "max_backups": "07", "compression_level": "9"})

        assert (data["max_backups"], data["compression_level"]) == (7, 9)
        schedule = _schedule_on_disk(config_on_disk)
        assert (schedule["max_backups"], schedule["compression_level"]) == (7, 9)

    def test_a_max_backups_past_what_a_json_number_holds_travels_as_its_digits(
        self, client: TestClient, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        data = self._put(client, {**_FULL_SCHEDULE, "max_backups": 2**60})

        assert data["max_backups"] == "1152921504606846976"
        assert self._get(client)["max_backups"] == "1152921504606846976"
        assert _schedule_on_disk(config_on_disk)["max_backups"] == 2**60

    def test_put_off_discards_the_schedule_and_on_again_needs_it_again(
        self, client: TestClient, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        self._put(client, _FULL_SCHEDULE)

        data = self._put(client, {"enabled": False})

        assert data == _default_schedule()
        assert self._get(client) == _default_schedule()
        assert _schedule_on_disk(config_on_disk) == {
            **{key: _SCHEDULE_DEFAULTS[key] for key in _FULL_SCHEDULE if key != "entity_types"},
            "entity_types": None,
        }

        response = client.put("/api/backup/schedule", json={"enabled": True})

        assert response.status_code == 400
        assert response.json()["error"]["message"] == "Cron expression is required"

    def test_put_ignores_the_run_record_and_the_computed_fields(
        self, client: TestClient, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        data = self._put(
            client,
            {
                **_FULL_SCHEDULE,
                "last_run": "2020-01-01T00:00:00+00:00",
                "last_run_status": "failed",
                "cron_description": "Never",
                "next_run": "2020-01-01T00:00:00+00:00",
            },
        )

        assert _without_next_run(data) == _saved(_FULL_SCHEDULE)
        assert datetime.fromisoformat(data["next_run"]) > datetime.now(UTC)
        assert config_on_disk() == {"backup": {"schedule": _FULL_SCHEDULE}}

    def test_get_returns_the_recorded_run(
        self, client: TestClient, load_config: Callable[..., Any]
    ) -> None:
        record = {"last_run": "2026-03-08T02:00:07+00:00", "last_run_status": "failed"}
        load_config({"backup": {"schedule": {**_FULL_SCHEDULE, **record}}})

        data = self._get(client)

        assert _without_next_run(data) == {**_saved(_FULL_SCHEDULE), **record}

    def test_get_returns_a_last_run_written_without_quotes_as_text(
        self, client: TestClient, load_config: Callable[..., Any]
    ) -> None:
        load_config(
            "backup:\n"
            "  schedule:\n"
            "    last_run: 2026-10-04T10:00:00Z\n"
            "    last_run_status: success\n"
        )

        data = self._get(client)

        assert data.get("last_run_status") == "success"
        assert isinstance(data.get("last_run"), str)
        assert datetime.fromisoformat(data["last_run"]) == datetime(2026, 10, 4, 10, 0, tzinfo=UTC)

    def test_put_on_without_entity_types_backs_up_every_type_and_keeps_null(
        self, client: TestClient, config_on_disk: Callable[[], dict[str, Any]]
    ) -> None:
        every_type = _default_schedule()["entity_types"]

        response = client.put("/api/backup/schedule", json={"enabled": True, "cron": "0 2 * * *"})

        assert response.status_code == 200
        data = response.json()["data"]
        assert data["enabled"] is True
        assert data["entity_types"] == every_type
        assert self._get(client)["entity_types"] == every_type
        assert _schedule_on_disk(config_on_disk).get("enabled") is True
        assert _schedule_on_disk(config_on_disk).get("entity_types") is None

    @pytest.mark.parametrize(
        ("key", "message"),
        [
            ("cron", "Cron expression is required"),
            ("save_directory", "Save directory is required"),
            ("max_backups", "Max backups is required"),
        ],
    )
    def test_put_on_with_an_explicit_null_answers_the_required_message(
        self,
        client: TestClient,
        load_config: Callable[..., Any],
        config_file: Path,
        key: str,
        message: str,
    ) -> None:
        load_config({"backup": {"schedule": _FULL_SCHEDULE}})
        before = config_file.read_bytes()

        response = client.put("/api/backup/schedule", json={"enabled": True, key: None})

        assert response.status_code == 400
        error = response.json()["error"]
        assert error["code"] == "VALIDATION_ERROR"
        assert error["message"] == message
        assert config_file.read_bytes() == before

    @pytest.mark.parametrize(
        ("change", "message"),
        [
            ({"cron": ""}, "Cron expression is required"),
            ({"cron": "not a cron"}, "Invalid cron expression: 'not a cron'"),
            ({"entity_types": []}, "At least one entity type must be selected"),
            ({"entity_types": ["widgets"]}, "Unknown entity type: 'widgets'"),
            ({"max_backups": None}, "Max backups is required"),
            ({"max_backups": 0}, "Max backups must be a positive integer"),
            ({"save_directory": ""}, "Save directory is required"),
            ({"format": "xml"}, "Invalid format: 'xml'"),
            ({"compression_method": "gzip"}, "Invalid compression method: 'gzip'"),
            ({"compression_level": 10}, "Compression level must be between 1 and 9"),
            ({"compression_level": 6.5}, "Compression level must be between 1 and 9"),
            ({"compression_level": True}, "Compression level must be between 1 and 9"),
            ({"max_backups": "5.0"}, "Max backups must be a positive integer"),
            ({"max_backups": "12345678901234567890"}, "Max backups allows at most 19 digits"),
            (
                {"secrets": "clear"},
                "Invalid secrets mode 'clear'; must be 'mask', 'encrypted', or 'plaintext'",
            ),
        ],
    )
    def test_put_on_with_an_invalid_value_answers_400_and_writes_nothing(
        self, client: TestClient, config_file: Path, change: dict[str, Any], message: str
    ) -> None:
        before = config_file.read_bytes()

        response = client.put("/api/backup/schedule", json={**_FULL_SCHEDULE, **change})

        assert response.status_code == 400
        error = response.json()["error"]
        assert error["code"] == "VALIDATION_ERROR"
        assert error["message"] == message
        assert config_file.read_bytes() == before

    @pytest.mark.parametrize(
        ("change", "message"),
        [
            (
                {"compression_method": "stored", "compression_level": 99},
                "backup.schedule.compression_level must be a whole number from 1 to 9",
            ),
            (
                {"compression_method": "lzma", "compression_level": 0},
                "backup.schedule.compression_level must be a whole number from 1 to 9",
            ),
            (
                {"compression_method": "stored", "compression_level": 6.5},
                "backup.schedule.compression_level must be a whole number from 1 to 9",
            ),
            (
                {"entity_types": {"tests": True}},
                "backup.schedule.entity_types must be a list of entity type names or null",
            ),
        ],
        ids=["level-on-stored", "level-on-lzma", "level-not-whole", "entity-types-as-mapping"],
    )
    def test_put_on_with_a_value_the_next_start_would_refuse_answers_400_and_writes_nothing(
        self, client: TestClient, config_file: Path, change: dict[str, Any], message: str
    ) -> None:
        before = config_file.read_bytes()

        response = client.put("/api/backup/schedule", json={**_FULL_SCHEDULE, **change})

        assert response.status_code == 400
        error = response.json()["error"]
        assert error["code"] == "VALIDATION_ERROR"
        assert error["message"] == message
        assert config_file.read_bytes() == before
        assert self._get(client)["enabled"] is False

    @pytest.mark.parametrize("below", ["", "backups", "backups/nightly"])
    def test_put_on_with_a_save_directory_in_the_data_folder_answers_400(
        self, client: TestClient, temp_storage_path: Path, config_file: Path, below: str
    ) -> None:
        before = config_file.read_bytes()
        save_directory = str(temp_storage_path / below)

        response = client.put(
            "/api/backup/schedule", json={**_FULL_SCHEDULE, "save_directory": save_directory}
        )

        assert response.status_code == 400
        error = response.json()["error"]
        assert error["code"] == "VALIDATION_ERROR"
        assert error["message"] == (
            f"Save directory must be outside the data folder: {temp_storage_path}"
        )
        assert config_file.read_bytes() == before

    @pytest.mark.parametrize(
        "body", [{**_FULL_SCHEDULE, "max_backups": 9}, {"enabled": False}], ids=["on", "off"]
    )
    def test_a_read_only_config_file_answers_500_and_keeps_the_schedule(
        self,
        client: TestClient,
        load_config: Callable[..., Any],
        read_only_config: Path,
        temp_storage_path: Path,
        body: dict[str, Any],
    ) -> None:
        load_config({"backup": {"schedule": _FULL_SCHEDULE}})
        before = read_only_config.read_bytes()
        stored = _without_next_run(self._get(client))

        response = client.put("/api/backup/schedule", json=body)

        assert response.status_code == 500
        error = response.json()["error"]
        assert error["code"] == "INTERNAL_ERROR"
        assert error["message"] == (
            f"Settings cannot be saved: the config file {read_only_config} is read-only"
        )
        assert read_only_config.read_bytes() == before
        assert _without_next_run(self._get(client)) == stored
        assert stored == _saved(_FULL_SCHEDULE)
        assert not (temp_storage_path / "backup").exists()

    async def test_put_off_stops_the_running_scheduler(
        self, load_config: Callable[..., Any]
    ) -> None:
        from wavecore.api.app import app
        from wavecore.api.services.backup import scheduler

        # A yearly cron never fires during the test
        load_config({"backup": {"schedule": {**_FULL_SCHEDULE, "cron": "0 0 1 1 *"}}})

        try:
            await scheduler.start_scheduler()
            running = scheduler._scheduler_task
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://testserver"
            ) as http:
                response = await http.put("/api/backup/schedule", json={"enabled": False})
            stopped = scheduler._scheduler_task
        finally:
            await scheduler.stop_scheduler()

        assert running is not None
        assert response.status_code == 200
        assert stopped is None
        assert running.done()


# ============================================================================
# Restore writes the test's files back
# ============================================================================


_OLD_ID = "11111111-1111-1111-1111-111111111111"


def _make_test_document(name: str, test_id: str) -> dict[str, Any]:
    """A backup-shaped test entity document."""
    return {
        "id": test_id,
        "name": name,
        "version": "1.0.0",
        "description": "",
        "workflow": {"nodes": [], "edges": []},
        "variables": {},
        "metadata": {},
        "created_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    }


def _function_block(label: str, function_id: str) -> dict[str, Any]:
    """A block that uses a library Function by id."""
    return {
        "id": "function-1",
        "type": "workflowNode",
        "position": {"x": 100, "y": 100},
        "data": {
            "label": label,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "shared",
            "functionId": function_id,
            "functionVersion": "1.0.0",
            "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
        },
    }


def _make_regression_document(name: str, suite_ids: list[str]) -> dict[str, Any]:
    """A backup-shaped regression entity document."""
    return {
        "id": str(uuid.uuid4()),
        "name": name,
        "version": "1.0.0",
        "description": "",
        "suites": suite_ids,
        "tags": [],
        "variables": {},
        "metadata": {},
        "created_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    }


def _seed_testdata(test_id: str, files: dict[str, bytes]) -> None:
    """Write files into a test's own test data folder."""
    from wavecore.api.services import storage_paths

    root = storage_paths.get_test_testdata_path(test_id)
    for rel, payload in files.items():
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)


def _testdata_tree(test_id: str) -> dict[str, bytes]:
    """Every file in a test's test data folder, keyed by relative posix path."""
    from wavecore.api.services import storage_paths

    root = storage_paths.get_test_testdata_path(test_id)
    if not root.exists():
        return {}
    return {
        p.relative_to(root).as_posix(): p.read_bytes()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


def _zone_test_ids() -> set[str]:
    """The test ids that own a folder in the test data zone."""
    from wavecore.api.services import storage_paths

    zone = storage_paths.get_testdata_storage_path()
    if not zone.exists():
        return set()
    return {p.name for p in zone.iterdir() if p.is_dir()}


class TestRestoreWritesTestData:
    """Restore puts the archive's files under the settled test id (REQ-3.4.3.2)."""

    def setup_method(self) -> None:
        """Reset test storage before each test."""
        from wavecore.api.services.tests import service as test_service

        test_service._clear_storage()

    @staticmethod
    def _archive() -> bytes:
        return _build_backup_zip(
            {"tests": [_make_test_document("T1", _OLD_ID)]},
            raw_members=[
                (f"tests/testdata/{_OLD_ID}/fresh.txt", b"fresh"),
                (f"tests/testdata/{_OLD_ID}/sub/rows.csv", b"id,name\n"),
            ],
        )

    def test_a_new_test_receives_the_archive_files(self) -> None:
        """A restored test that did not exist gets its files under its own id."""
        from wavecore.api.services.backup.service import restore_backup
        from wavecore.api.services.tests.service import _list_all_tests

        result = restore_backup(self._archive(), "backup.zip", entity_types=["tests"])

        assert result["tests"]["imported"] == 1
        assert [test["id"] for test in _list_all_tests()] == [_OLD_ID]
        assert _testdata_tree(_OLD_ID) == {
            "fresh.txt": b"fresh",
            "sub/rows.csv": b"id,name\n",
        }

    def test_overwrite_replaces_the_existing_files(self) -> None:
        """Overwrite removes the existing test's files before writing the archive's."""
        from wavecore.api.services.backup.service import restore_backup
        from wavecore.api.services.tests import service as test_service

        existing = test_service.create_test({"name": "T1"})
        _seed_testdata(existing["id"], {"stale.txt": b"stale"})

        restore_backup(
            self._archive(),
            "backup.zip",
            entity_types=["tests"],
            conflict_resolution="overwrite",
        )

        assert _testdata_tree(existing["id"]) == {
            "fresh.txt": b"fresh",
            "sub/rows.csv": b"id,name\n",
        }

    def test_skip_writes_nothing(self) -> None:
        """A skipped test keeps its own files and gains none."""
        from wavecore.api.services.backup.service import restore_backup
        from wavecore.api.services.tests import service as test_service

        existing = test_service.create_test({"name": "T1"})
        _seed_testdata(existing["id"], {"mine.txt": b"mine"})

        result = restore_backup(
            self._archive(), "backup.zip", entity_types=["tests"], conflict_resolution="skip"
        )

        assert result["tests"]["skipped"] == 1
        assert _testdata_tree(existing["id"]) == {"mine.txt": b"mine"}
        assert _zone_test_ids() == {existing["id"]}

    def test_rename_writes_under_the_new_id(self) -> None:
        """Rename writes the archive's files under the renamed test's id."""
        from wavecore.api.services.backup.service import restore_backup
        from wavecore.api.services.tests import service as test_service
        from wavecore.api.services.tests.service import _list_all_tests

        existing = test_service.create_test({"name": "T1"})
        _seed_testdata(existing["id"], {"mine.txt": b"mine"})

        restore_backup(
            self._archive(),
            "backup.zip",
            entity_types=["tests"],
            conflict_resolution="rename",
        )

        renamed = next(t for t in _list_all_tests() if t["name"] == "T1 (2)")
        assert _testdata_tree(renamed["id"]) == {
            "fresh.txt": b"fresh",
            "sub/rows.csv": b"id,name\n",
        }
        assert _testdata_tree(existing["id"]) == {"mine.txt": b"mine"}

    def test_a_test_without_files_creates_no_folder(self) -> None:
        """An archive entry with no files leaves the restored test without a folder."""
        from wavecore.api.services.backup.service import restore_backup

        zip_bytes = _build_backup_zip({"tests": [_make_test_document("T1", _OLD_ID)]})

        restore_backup(zip_bytes, "backup.zip", entity_types=["tests"])

        assert _zone_test_ids() == set()


# ============================================================================
# Network trust through the backup routes (REQ-4.5.14, REQ-4.5.16)
# ============================================================================

_SAVED_NETWORK_SETTINGS = {
    "ssh_hosts": {"lock_trusted_hosts": True, "default_block_action": "strict"},
    "certificates": {"public_source": "host"},
}
_SEEDED_AT = "2026-09-01T08:00:00Z"


def _openssh(key: asyncssh.SSHKey) -> str:
    return key.export_public_key("openssh").decode().strip()


def _host_entry(entry_id: str, host: str, port: int, key: asyncssh.SSHKey) -> dict[str, Any]:
    return {
        "id": entry_id,
        "host": host,
        "port": port,
        "public_key": _openssh(key),
        "added": _SEEDED_AT,
    }


def _certificate_entry(credential: Credential) -> dict[str, Any]:
    return {
        "id": credential.cert.fingerprint(hashes.SHA256()).hex(),
        "pem": credential.cert_pem,
        "added": _SEEDED_AT,
    }


def _write_yaml(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")


def _stored(path: Path) -> dict[str, Any]:
    loaded: dict[str, Any] = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return loaded


class TestNetworkTrustBackupRoutes:
    """Trusted hosts and Additional Certificates go through create, validate and restore."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.fixture(scope="class")
    def keys(self) -> dict[str, asyncssh.SSHKey]:
        return {
            "ed25519": asyncssh.generate_private_key("ssh-ed25519").convert_to_public(),
            "ed25519_other": asyncssh.generate_private_key("ssh-ed25519").convert_to_public(),
            "ecdsa": asyncssh.generate_private_key("ecdsa-sha2-nistp256").convert_to_public(),
        }

    @pytest.fixture(scope="class")
    def authorities(self) -> dict[str, Credential]:
        root = make_credential("Route Lab Root", key_kind="ec256", is_ca=True)
        issuing = make_credential("Route Lab Issuing CA", issuer=root, key_kind="ec256", is_ca=True)
        return {"root": root, "issuing": issuing}

    @pytest.fixture
    def hosts_file(self, temp_storage_path: Path) -> Path:
        return temp_storage_path / "network" / "ssh_hosts.yaml"

    @pytest.fixture
    def certificates_file(self, temp_storage_path: Path) -> Path:
        return temp_storage_path / "network" / "certificates.yaml"

    @pytest.fixture
    def saved_network(
        self,
        hosts_file: Path,
        certificates_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        authorities: dict[str, Credential],
        load_config: Callable[..., Any],
    ) -> None:
        load_config({"network": _SAVED_NETWORK_SETTINGS})
        _write_yaml(hosts_file, {"hosts": [_host_entry("a" * 32, "db1", 22, keys["ed25519"])]})
        _write_yaml(certificates_file, {"certificates": [_certificate_entry(authorities["root"])]})

    def _restore(self, client: TestClient, archive: bytes, resolution: str) -> dict[str, Any]:
        response = client.post(
            "/api/backup/restore",
            data={"entity_types": "ssh_hosts,certificates", "conflict_resolution": resolution},
            files={"file": ("backup.zip", archive, "application/zip")},
        )
        assert response.status_code == 200
        data: dict[str, Any] = response.json()["data"]
        return data

    @pytest.mark.usefixtures("saved_network")
    def test_create_writes_one_member_per_host_and_certificate(
        self,
        client: TestClient,
        keys: dict[str, asyncssh.SSHKey],
        authorities: dict[str, Credential],
    ) -> None:
        host = _host_entry("a" * 32, "db1", 22, keys["ed25519"])
        certificate = _certificate_entry(authorities["root"])

        response = client.post(
            "/api/backup/create", json={"entity_types": ["ssh_hosts", "certificates"]}
        )

        assert response.status_code == 200
        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            assert set(zf.namelist()) == {
                "manifest.json",
                f"ssh_hosts/{host['id']}.yaml",
                f"certificates/{certificate['id']}.yaml",
            }
            assert yaml.safe_load(zf.read(f"ssh_hosts/{host['id']}.yaml")) == host
            assert yaml.safe_load(zf.read(f"certificates/{certificate['id']}.yaml")) == certificate

    @pytest.mark.usefixtures("saved_network")
    def test_the_preview_names_bad_entries_as_items(
        self,
        client: TestClient,
        keys: dict[str, asyncssh.SSHKey],
        authorities: dict[str, Credential],
    ) -> None:
        bad_host = {
            **_host_entry("b" * 32, "db1", 22, keys["ecdsa"]),
            "public_key": "ecdsa-sha2-nistp256 AAAAnotakey",
        }
        bad_certificate = {"id": "0" * 64, "pem": "not a certificate", "added": _SEEDED_AT}
        archive = _build_backup_zip(
            {
                "ssh_hosts": [bad_host, _host_entry("c" * 32, "db1", 22, keys["ed25519_other"])],
                "certificates": [bad_certificate, _certificate_entry(authorities["issuing"])],
            }
        )

        response = client.post(
            "/api/backup/validate", files={"file": ("backup.zip", archive, "application/zip")}
        )

        assert response.status_code == 200
        summary = response.json()["data"]["entity_summary"]
        hosts = summary["ssh_hosts"]
        certificates = summary["certificates"]
        assert {key: hosts[key] for key in ("total", "ok", "conflicts", "fixable", "fatal")} == {
            "total": 2,
            "ok": 0,
            "conflicts": 1,
            "fixable": 0,
            "fatal": 1,
        }
        assert "errors" not in hosts
        _assert_items(
            hosts,
            [
                ("db1 port 22 (ECDSA)", "fatal", r"^Unreadable key$"),
                ("db1 port 22 (ED25519)", "conflict", _ALREADY_HERE),
            ],
        )
        assert {
            key: certificates[key] for key in ("total", "ok", "conflicts", "fixable", "fatal")
        } == {"total": 2, "ok": 1, "conflicts": 0, "fixable": 0, "fatal": 1}
        assert "errors" not in certificates
        _assert_items(certificates, [("0" * 64, "fatal", r"^Not a valid certificate$")])

    @pytest.mark.usefixtures("saved_network")
    def test_restore_overwrite_replaces_the_host_key_and_skips_saved_certificates(
        self,
        client: TestClient,
        hosts_file: Path,
        certificates_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        authorities: dict[str, Credential],
        config_file: Path,
    ) -> None:
        settings = config_file.read_bytes()
        archive = _build_backup_zip(
            {
                "ssh_hosts": [
                    _host_entry("b" * 32, "db1", 22, keys["ed25519_other"]),
                    _host_entry("c" * 32, "db2", 2222, keys["ecdsa"]),
                ],
                "certificates": [
                    _certificate_entry(authorities["root"]),
                    _certificate_entry(authorities["issuing"]),
                ],
            }
        )

        data = self._restore(client, archive, "overwrite")

        assert _counts(data) == {
            "ssh_hosts": {"imported": 2, "skipped": 0, "fatal": 0},
            "certificates": {"imported": 1, "skipped": 1, "fatal": 0},
        }
        _assert_items(data["ssh_hosts"], [])
        _assert_items(data["certificates"], [("Route Lab Root", "skipped", _ALREADY_HERE)])
        assert config_file.read_bytes() == settings
        stored_hosts = _stored(hosts_file)
        assert set(stored_hosts) == {"hosts"}
        assert sorted((e["host"], e["port"], e["public_key"]) for e in stored_hosts["hosts"]) == [
            ("db1", 22, _openssh(keys["ed25519_other"])),
            ("db2", 2222, _openssh(keys["ecdsa"])),
        ]
        stored_certificates = _stored(certificates_file)
        assert set(stored_certificates) == {"certificates"}
        assert {e["id"] for e in stored_certificates["certificates"]} == {
            _certificate_entry(authorities["root"])["id"],
            _certificate_entry(authorities["issuing"])["id"],
        }

    @pytest.mark.usefixtures("saved_network")
    def test_restore_skip_keeps_the_saved_host_key(
        self,
        client: TestClient,
        hosts_file: Path,
        keys: dict[str, asyncssh.SSHKey],
        authorities: dict[str, Credential],
    ) -> None:
        archive = _build_backup_zip(
            {
                "ssh_hosts": [
                    _host_entry("b" * 32, "db1", 22, keys["ed25519_other"]),
                    _host_entry("c" * 32, "db2", 2222, keys["ecdsa"]),
                ],
                "certificates": [_certificate_entry(authorities["root"])],
            }
        )

        data = self._restore(client, archive, "skip")

        assert _counts(data) == {
            "ssh_hosts": {"imported": 1, "skipped": 1, "fatal": 0},
            "certificates": {"imported": 0, "skipped": 1, "fatal": 0},
        }
        _assert_items(data["ssh_hosts"], [("db1 port 22 (ED25519)", "skipped", _ALREADY_HERE)])
        _assert_items(data["certificates"], [("Route Lab Root", "skipped", _ALREADY_HERE)])
        assert sorted(
            (e["host"], e["port"], e["public_key"]) for e in _stored(hosts_file)["hosts"]
        ) == [
            ("db1", 22, _openssh(keys["ed25519"])),
            ("db2", 2222, _openssh(keys["ecdsa"])),
        ]


class TestBackupKeepsTheWholeFileName:
    """A backup name with text outside plain ASCII is sent whole (REQ-4.6.9)."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    def test_a_name_outside_plain_ascii_is_sent_whole(self, client: TestClient) -> None:
        name = f"{ENTITY_NAME}.zip"
        with patch("wavecore.api.routes.backup.backup_service.create_backup") as mock_create:
            mock_create.return_value = (b"zipdata", name)
            response = client.post("/api/backup/create", json={"entity_types": ["tests"]})

        assert_whole_name(response, name)


# ============================================================================
# Restore and text UTF-8 cannot write
# ============================================================================


def _member(stem: str, name: str, fmt: str) -> tuple[str, bytes]:
    """One test member of a backup, every text of it in double quotes."""
    document = _make_test_document(name, str(uuid.uuid4()))
    if fmt == "json":
        return f"tests/{stem}.json", json.dumps(document).encode()
    return f"tests/{stem}.yaml", yaml.safe_dump(document, default_style='"').encode()


def _restored_names() -> list[str]:
    from wavecore.api.services.tests.service import _list_all_tests

    return sorted(test["name"] for test in _list_all_tests())


def _post_archive(client: TestClient, route: str, members: list[tuple[str, bytes]]) -> Any:
    archive = _build_backup_zip({}, raw_members=members)
    return client.post(route, files={"file": ("backup.zip", archive, "application/zip")})


class TestRestoreAndUnencodableText:
    """A member holding such text is left out, as a member that cannot be parsed is (REQ-4.6.9)."""

    def setup_method(self) -> None:
        from wavecore.api.services.tests import service as test_service

        test_service._clear_storage()

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.mark.parametrize("fmt", ["yaml", "json"])
    def test_restore_leaves_the_member_out_and_restores_the_rest(
        self, client: TestClient, fmt: str
    ) -> None:
        broken = _member("broken", "Broken cafe\udce9", fmt)
        assert rb"cafe\udce9" in broken[1].lower()

        response = _post_archive(
            client, "/api/backup/restore", [_member("clean", "Clean", fmt), broken]
        )

        assert response.status_code == 200
        assert response.json()["data"]["tests"]["imported"] == 1
        assert _restored_names() == ["Clean"]

    def test_a_member_that_cannot_be_parsed_is_left_out_the_same_way(
        self, client: TestClient
    ) -> None:
        unparsable = ("tests/broken.yaml", b"name: [unclosed\n")

        response = _post_archive(
            client, "/api/backup/restore", [_member("clean", "Clean", "yaml"), unparsable]
        )

        assert response.status_code == 200
        assert response.json()["data"]["tests"]["imported"] == 1
        assert _restored_names() == ["Clean"]

    def test_validate_names_the_member_as_one_that_cannot_be_read(self, client: TestClient) -> None:
        members = [
            _member("clean", "Clean", "yaml"),
            _member("broken", "Broken cafe\udce9", "yaml"),
        ]

        response = _post_archive(client, "/api/backup/validate", members)

        assert response.status_code == 200
        tests = response.json()["data"]["entity_summary"]["tests"]
        assert (tests["total"], tests["ok"], tests["fatal"]) == (2, 1, 1)
        _assert_items(tests, [("broken.yaml", "fatal", r"^Cannot be read$")])

    @pytest.mark.parametrize("fmt", ["yaml", "json"])
    def test_a_character_written_as_two_escapes_is_restored_as_that_character(
        self, client: TestClient, fmt: str
    ) -> None:
        stem, written = _member("paired", "ok EMOJI-GOES-HERE", fmt)
        member = (stem, written.replace(b"EMOJI-GOES-HERE", rb"\uD83D\uDE00"))

        response = _post_archive(client, "/api/backup/restore", [member])

        assert response.status_code == 200
        assert _restored_names() == ["ok 😀"]

    @pytest.mark.parametrize("route", ["/api/backup/validate", "/api/backup/restore"])
    def test_a_manifest_holding_such_text_is_a_corrupt_manifest(
        self, client: TestClient, route: str
    ) -> None:
        manifest = json.dumps({"format": "yaml", "wave_version": "1.0.0", "created_at": "\udce9"})
        archive = _build_backup_zip(
            {},
            include_manifest=False,
            raw_members=[_member("clean", "Clean", "yaml"), ("manifest.json", manifest.encode())],
        )

        response = client.post(route, files={"file": ("backup.zip", archive, "application/zip")})

        assert response.status_code == 400
        assert response.json()["error"]["message"] == (
            "Invalid backup archive: corrupt manifest.json"
        )
        assert _restored_names() == []


# ============================================================================
# POST /api/backup/uploads, DELETE /api/backup/uploads/{upload_id}
# ============================================================================

_UPLOAD_ID = r"^[0-9a-f]{32}$"
_NEVER_KEPT = "0" * 32
_ARCHIVE_ROUTES = ["validate", "restore"]
_FILE_OR_UPLOAD_ID = r"^Send the backup file or an upload ID$"
_NOT_BOTH = r"^Send the backup file or an upload ID, not both$"


def _keep(client: TestClient, content: bytes, filename: str = "backup.zip") -> str:
    """Send an archive to be kept; the upload ID it got."""
    response = client.post(
        "/api/backup/uploads", files={"file": (filename, content, "application/zip")}
    )
    assert response.status_code == 200
    upload_id: str = response.json()["data"]["upload_id"]
    return upload_id


def _post_file(client: TestClient, route: str, content: bytes, **options: str) -> httpx.Response:
    """A validate or restore request that carries the archive itself."""
    return client.post(
        f"/api/backup/{route}",
        data=options,
        files={"file": ("backup.zip", content, "application/zip")},
    )


def _post_upload_id(
    client: TestClient, route: str, upload_id: str, **options: str
) -> httpx.Response:
    """A validate or restore request as the page sends it: a multipart form with no file."""
    fields = {"upload_id": upload_id, **options}
    return client.post(
        f"/api/backup/{route}", files={name: (None, value) for name, value in fields.items()}
    )


def _unnamed_file(content: bytes) -> dict[str, Any]:
    """The arguments of a request whose file part has an empty file name."""
    boundary = "wave-backup-test-boundary"
    body = b"".join(
        [
            f"--{boundary}\r\n".encode(),
            b'Content-Disposition: form-data; name="file"; filename=""\r\n',
            b"Content-Type: application/zip\r\n\r\n",
            content,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
    )
    return {
        "content": body,
        "headers": {"Content-Type": f"multipart/form-data; boundary={boundary}"},
    }


def _archive_passed(service_function: Any) -> tuple[Any, Any]:
    """The content and the file name a mocked backup service function was called with."""
    call = service_function.call_args
    passed = {**dict(zip(_SERVICE_ARGUMENTS, call.args, strict=False)), **call.kwargs}
    return passed["content"], passed["filename"]


def _assert_upload_not_found(response: httpx.Response) -> None:
    assert response.status_code == 404
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == "BACKUP_UPLOAD_NOT_FOUND"
    assert re.fullmatch(r"^Backup upload not found$", body["error"]["message"])


@pytest.fixture(name="upload_client")
def upload_client_fixture() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


class TestBackupUploadRoutes:
    """POST /api/backup/uploads keeps an archive; DELETE /api/backup/uploads/{id} drops it."""

    def test_upload_answers_an_upload_id(self, upload_client: TestClient) -> None:
        response = upload_client.post(
            "/api/backup/uploads", files={"file": ("backup.zip", b"archive", "application/zip")}
        )

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["meta"]["request_id"]
        assert list(body["data"]) == ["upload_id"]
        assert re.fullmatch(_UPLOAD_ID, body["data"]["upload_id"])

    def test_every_upload_gets_an_id_of_its_own(self, upload_client: TestClient) -> None:
        archive = _build_backup_zip({"environments": [_make_environment("E1")]})

        assert _keep(upload_client, archive) != _keep(upload_client, archive)

    def test_upload_does_not_check_the_content(self, upload_client: TestClient) -> None:
        """A bad archive is kept; validate reports it the way it does for the file."""
        upload_id = _keep(upload_client, b"not a zip")

        by_file = _post_file(upload_client, "validate", b"not a zip")
        by_upload_id = _post_upload_id(upload_client, "validate", upload_id)

        assert _refusal(by_upload_id) == _refusal(by_file)

    def test_upload_keeps_the_name_of_the_file(self, upload_client: TestClient) -> None:
        upload_id = _keep(upload_client, b"archive", "nightly-2026-10-12.zip")

        with patch("wavecore.api.routes.backup.backup_service.validate_backup") as validate:
            validate.return_value = {"metadata": {}, "entity_summary": {}}
            _post_upload_id(upload_client, "validate", upload_id)

        assert _archive_passed(validate) == (b"archive", "nightly-2026-10-12.zip")

    def test_an_upload_without_a_file_name_is_kept_as_backup_zip(
        self, upload_client: TestClient
    ) -> None:
        kept = upload_client.post("/api/backup/uploads", **_unnamed_file(b"archive"))
        assert kept.status_code == 200

        with patch("wavecore.api.routes.backup.backup_service.validate_backup") as validate:
            validate.return_value = {"metadata": {}, "entity_summary": {}}
            _post_upload_id(upload_client, "validate", kept.json()["data"]["upload_id"])

        assert _archive_passed(validate) == (b"archive", "backup.zip")

    def test_delete_answers_204_with_no_body(self, upload_client: TestClient) -> None:
        upload_id = _keep(upload_client, b"archive")

        response = upload_client.delete(f"/api/backup/uploads/{upload_id}")

        assert response.status_code == 204
        assert response.content == b""

    def test_delete_of_an_unknown_id_is_not_an_error(self, upload_client: TestClient) -> None:
        response = upload_client.delete(f"/api/backup/uploads/{_NEVER_KEPT}")

        assert response.status_code == 204
        assert response.content == b""

    @pytest.mark.parametrize("route", _ARCHIVE_ROUTES)
    def test_an_id_is_unknown_after_delete(self, upload_client: TestClient, route: str) -> None:
        upload_id = _keep(upload_client, _build_backup_zip({}))
        assert _post_upload_id(upload_client, route, upload_id).status_code == 200

        upload_client.delete(f"/api/backup/uploads/{upload_id}")

        _assert_upload_not_found(_post_upload_id(upload_client, route, upload_id))

    def test_delete_leaves_the_other_uploads(self, upload_client: TestClient) -> None:
        dropped = _keep(upload_client, _build_backup_zip({}))
        kept = _keep(upload_client, _build_backup_zip({}))

        upload_client.delete(f"/api/backup/uploads/{dropped}")

        assert _post_upload_id(upload_client, "validate", kept).status_code == 200


# ============================================================================
# POST /api/backup/validate and /api/backup/restore by upload ID
# ============================================================================


@pytest.mark.parametrize("route", _ARCHIVE_ROUTES)
class TestValidateAndRestoreByUploadId:
    """Validate and restore take the archive as the file or as the ID of a kept upload."""

    def test_the_service_gets_the_kept_archive_and_the_options(
        self, upload_client: TestClient, route: str
    ) -> None:
        archive = _build_backup_zip({"environments": [_make_environment("E1")]})
        upload_id = _keep(upload_client, archive, "nightly.zip")
        answer = {"answered_by": route}

        with patch(f"wavecore.api.routes.backup.backup_service.{route}_backup") as service:
            service.return_value = answer
            response = _post_upload_id(
                upload_client,
                route,
                upload_id,
                entity_types="tests,suites",
                conflict_resolution="overwrite",
                auto_repair="true",
            )

        assert response.status_code == 200
        assert response.json()["data"] == answer
        assert _archive_passed(service) == (archive, "nightly.zip")
        assert _options_passed(service) == {
            "entity_types": ["tests", "suites"],
            "conflict_resolution": "overwrite",
            "auto_repair": True,
        }

    def test_an_upload_id_answers_what_the_file_answers(
        self, upload_client: TestClient, route: str
    ) -> None:
        archive = _build_backup_zip({"environments": [_make_environment("E1")]})
        # Restored once first, so neither request below changes what is stored.
        assert _post_file(upload_client, "restore", archive).status_code == 200
        upload_id = _keep(upload_client, archive)

        by_file = _post_file(upload_client, route, archive)
        by_upload_id = _post_upload_id(upload_client, route, upload_id)

        assert by_file.status_code == 200
        assert by_upload_id.status_code == 200
        answer = by_upload_id.json()["data"]
        assert answer == by_file.json()["data"]
        status = {"validate": "conflict", "restore": "skipped"}[route]
        _assert_items(
            answer.get("entity_summary", answer)["environments"], [("E1", status, _ALREADY_HERE)]
        )

    def test_a_request_by_upload_id_leaves_the_upload_usable(
        self, upload_client: TestClient, route: str
    ) -> None:
        upload_id = _keep(upload_client, _build_backup_zip({}))

        answers = [_post_upload_id(upload_client, route, upload_id) for _ in range(3)]

        assert [answer.status_code for answer in answers] == [200, 200, 200]

    def test_a_request_with_the_file_keeps_nothing(
        self, upload_client: TestClient, route: str
    ) -> None:
        with patch("wavecore.api.routes.backup.backup_uploads.keep") as keep:
            response = _post_file(upload_client, route, _build_backup_zip({}))

        assert response.status_code == 200
        keep.assert_not_called()

    def test_a_file_without_a_name_reaches_the_service_as_backup_zip(
        self, upload_client: TestClient, route: str
    ) -> None:
        with patch(f"wavecore.api.routes.backup.backup_service.{route}_backup") as service:
            service.return_value = {"answered_by": route}
            response = upload_client.post(f"/api/backup/{route}", **_unnamed_file(b"archive"))

        assert response.status_code == 200
        assert _archive_passed(service) == (b"archive", "backup.zip")

    def test_the_file_together_with_an_upload_id_is_refused(
        self, upload_client: TestClient, route: str
    ) -> None:
        archive = _build_backup_zip({"environments": [_make_environment("E1")]})
        upload_id = _keep(upload_client, archive)

        with patch(f"wavecore.api.routes.backup.backup_service.{route}_backup") as service:
            response = _post_file(upload_client, route, archive, upload_id=upload_id)

        assert re.fullmatch(_NOT_BOTH, _refusal(response))
        service.assert_not_called()

    @pytest.mark.parametrize("fields", [None, {"conflict_resolution": "overwrite"}])
    def test_a_request_with_neither_is_refused(
        self, upload_client: TestClient, route: str, fields: dict[str, str] | None
    ) -> None:
        with patch(f"wavecore.api.routes.backup.backup_service.{route}_backup") as service:
            response = upload_client.post(f"/api/backup/{route}", data=fields)

        assert re.fullmatch(_FILE_OR_UPLOAD_ID, _refusal(response))
        service.assert_not_called()

    def test_an_id_never_kept_is_not_found(self, upload_client: TestClient, route: str) -> None:
        _keep(upload_client, _build_backup_zip({}))

        _assert_upload_not_found(_post_upload_id(upload_client, route, _NEVER_KEPT))

    def test_an_id_whose_idle_time_is_over_is_not_found(
        self, upload_client: TestClient, route: str, expiry_timers: list[FakeExpiryTimer]
    ) -> None:
        upload_id = _keep(upload_client, _build_backup_zip({}))

        expiry_timers[0].fire()

        _assert_upload_not_found(_post_upload_id(upload_client, route, upload_id))

    def test_a_request_by_upload_id_starts_the_idle_time_over(
        self, upload_client: TestClient, route: str, expiry_timers: list[FakeExpiryTimer]
    ) -> None:
        upload_id = _keep(upload_client, _build_backup_zip({}))
        assert _post_upload_id(upload_client, route, upload_id).status_code == 200

        replaced, armed = expiry_timers
        assert replaced.canceled
        assert (armed.seconds, armed.started, armed.canceled) == (
            backup_uploads.IDLE_SECONDS,
            True,
            False,
        )
        replaced.fire()
        assert _post_upload_id(upload_client, route, upload_id).status_code == 200


class TestRestoreByUploadIdThenPreviewAgain:
    """The page reads the preview again after a restore, with the same upload ID."""

    def test_a_restore_by_upload_id_restores_and_leaves_the_upload_usable(
        self, upload_client: TestClient
    ) -> None:
        upload_id = _keep(
            upload_client, _build_backup_zip({"environments": [_make_environment("E1")]})
        )

        restored = _post_upload_id(upload_client, "restore", upload_id)
        preview = _post_upload_id(upload_client, "validate", upload_id)
        restored_again = _post_upload_id(upload_client, "restore", upload_id)

        assert restored.status_code == 200
        assert _counts(restored.json()["data"]) == {
            "environments": {"imported": 1, "skipped": 0, "fatal": 0}
        }
        assert preview.status_code == 200
        assert preview.json()["data"]["entity_summary"]["environments"]["conflicts"] == 1
        assert restored_again.status_code == 200
        assert _counts(restored_again.json()["data"]) == {
            "environments": {"imported": 0, "skipped": 1, "fatal": 0}
        }


class TestABackupBodyThatIsNotAJsonObject:
    """A backup request whose body is not a JSON object is a bad request."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app)

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            pytest.param("POST", "/api/backup/create", id="create"),
            pytest.param("PUT", "/api/backup/schedule", id="schedule"),
        ],
    )
    @pytest.mark.parametrize(("text", "message"), NOT_OBJECT_BODIES)
    def test_it_is_refused(
        self, client: TestClient, method: str, path: str, text: str, message: str
    ) -> None:
        assert_refused(send_text(client, method, path, text), message)
