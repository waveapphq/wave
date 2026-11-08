"""Tests covering uncovered branches across multiple modules.

Targets residual coverage gaps in:
- Execution shared utilities
- Workbench endpoint WaveException re-raise paths
- Suite variable validation ValueError conversion
- Regression execution ValueError handler
- Backup scheduler exception handler
- Block storage _get_storage sync path
- Profile exception constructors
- Workbench try_catch node execution edge cases
- Parallel output_collection merge error paths
- Shared service utilities (version padding)
"""

import asyncio
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

# ===========================================================================
# 1. Execution shared: _create_error_response (line 52)
# ===========================================================================


class TestExecutionSharedErrorResponse:
    """Test _create_error_response utility in execution shared module."""

    def test_create_error_response_generates_correlation_id(self) -> None:
        """_create_error_response generates a correlation_id when none provided."""
        from wavecore.api.routes.executions.shared import _create_error_response

        response = _create_error_response(400, "BAD_REQUEST", "test message")
        assert response.status_code == 400
        import json

        body = json.loads(response.body)
        assert body["success"] is False
        assert body["error"]["code"] == "BAD_REQUEST"
        assert body["error"]["message"] == "test message"
        # Verify correlation_id was generated (UUID format)
        assert len(body["error"]["correlation_id"]) > 0


# ===========================================================================
# 4. Workbench endpoints: WaveException re-raise + _workbench_error_response
#    (lines 43, 88, 111, 152, 191, 216, 245-246)
# ===========================================================================


class TestWorkbenchWaveExceptionReraise:
    """Test WaveException re-raise paths in all workbench endpoints."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app, raise_server_exceptions=False)

    def test_workbench_error_response_with_wave_exception(self) -> None:
        """_workbench_error_response re-raises WaveException directly (line 43)."""
        from wavecore.api.exceptions import NotFoundException
        from wavecore.api.routes.workbench import _workbench_error_response

        with pytest.raises(NotFoundException):
            _workbench_error_response(NotFoundException("gone"))

    def test_get_session_reraises_wave_exception(self, client: TestClient) -> None:
        """GET /workbench/session re-raises WaveException (line 88)."""
        from wavecore.api.exceptions import ValidationException

        with patch("wavecore.api.routes.workbench.workbench_service.get_session_for_user") as mock:
            mock.side_effect = ValidationException("bad state")
            response = client.get("/workbench/session")
            assert response.status_code == 400

    def test_clear_session_reraises_wave_exception(self, client: TestClient) -> None:
        """DELETE /workbench/session re-raises WaveException (line 111)."""
        from wavecore.api.exceptions import ValidationException

        with patch(
            "wavecore.api.routes.workbench.workbench_service.clear_session_for_user"
        ) as mock:
            mock.side_effect = ValidationException("bad state")
            response = client.delete("/workbench/session")
            assert response.status_code == 400

    def test_start_run_reraises_wave_exception(self, client: TestClient) -> None:
        """POST /workbench/run re-raises WaveException (line 152)."""
        from wavecore.api.exceptions import NotFoundException

        with patch("wavecore.api.routes.workbench.workbench_service.start_workbench_run") as mock:
            mock.side_effect = NotFoundException("test not found")
            response = client.post(
                "/workbench/run",
                json={
                    "test_id": str(uuid.uuid4()),
                    "environment_id": str(uuid.uuid4()),
                },
            )
            assert response.status_code == 404

    def test_update_skip_reraises_wave_exception(self, client: TestClient) -> None:
        """POST /workbench/{id}/skip re-raises WaveException (line 191)."""
        from wavecore.api.exceptions import NotFoundException

        session_id = str(uuid.uuid4())
        with patch("wavecore.api.routes.workbench.workbench_service.update_skipped_nodes") as mock:
            mock.side_effect = NotFoundException("session not found")
            response = client.post(
                f"/workbench/{session_id}/skip",
                json={"skipped_node_ids": []},
            )
            assert response.status_code == 404

    def test_stop_run_reraises_wave_exception(self, client: TestClient) -> None:
        """POST /workbench/{id}/stop re-raises WaveException (line 216)."""
        from wavecore.api.exceptions import NotFoundException

        session_id = str(uuid.uuid4())
        with patch("wavecore.api.routes.workbench.workbench_service.stop_workbench_run") as mock:
            mock.side_effect = NotFoundException("session not found")
            response = client.post(f"/workbench/{session_id}/stop")
            assert response.status_code == 404

    def test_get_status_value_error_calls_error_response(self, client: TestClient) -> None:
        """GET /workbench/{id}/status ValueError triggers _workbench_error_response."""
        session_id = str(uuid.uuid4())
        with patch("wavecore.api.routes.workbench.workbench_service.get_workbench_status") as mock:
            mock.side_effect = ValueError("invalid session format")
            response = client.get(f"/workbench/{session_id}/status")
            assert response.status_code == 400
            assert "invalid session format" in response.json()["error"]["message"]


# ===========================================================================
# 5. Suites routes: ValueError->ValidationException in variable validation
#    (lines 235-236)
# ===========================================================================


class TestSuiteVariableValidationError:
    """Test that invalid variable types raise ValidationException via ValueError conversion."""

    @pytest.fixture
    def client(self) -> TestClient:
        from wavecore.api.app import app

        return TestClient(app, raise_server_exceptions=False)

    def test_create_suite_with_invalid_variable_type_returns_400(self, client: TestClient) -> None:
        """POST /suites with invalid variable type converts ValueError to 400."""
        with patch("wavecore.api.routes.suites.routes.suite_service.create_suite"):
            response = client.post(
                "/suites",
                json={
                    "name": "test-suite",
                    "variables": {
                        "my_var": {"type": "INVALID_TYPE", "value": "x"},
                    },
                },
            )

            assert response.status_code == 400
            body = response.json()
            assert "Invalid variable type" in body["error"]["message"]


# ===========================================================================
# 6. Regression import_export_routes: ValueError handler (line 274)
# ===========================================================================


# ===========================================================================
# 7. Backup scheduler: exception in _execute_scheduled_backup (lines 256-258)
# ===========================================================================


class TestSchedulerBackupFailure:
    """Test that scheduler handles backup execution failure and records status."""

    def test_scheduler_records_failed_status_on_backup_exception(
        self,
        tmp_path: Path,
        load_config: Callable[..., Any],
        config_on_disk: Callable[[], dict[str, Any]],
    ) -> None:
        """Scheduler catches exception and records the 'failed' status in the config file."""
        from wavecore.api.services.backup.scheduler import _scheduler_loop

        load_config(
            {
                "backup": {
                    "schedule": {
                        "enabled": True,
                        "cron": "* * * * *",
                        "entity_types": ["tests"],
                        "save_directory": str(tmp_path / "fail_dir"),
                        "max_backups": 5,
                    }
                }
            }
        )

        _real_sleep = asyncio.sleep
        call_count = 0
        captured_status: list[str | None] = []

        async def mock_sleep(seconds: float) -> None:
            nonlocal call_count
            call_count += 1
            if call_count >= 2:
                # Capture status BEFORE disabling (the failure handler wrote it)
                content = config_on_disk()
                captured_status.append(content["backup"]["schedule"].get("last_run_status"))
                content["backup"]["schedule"]["enabled"] = False
                load_config(content)
            await _real_sleep(0)

        def mock_execute(sd: dict[str, Any]) -> None:
            raise RuntimeError("Backup disk full")

        with (
            patch("wavecore.api.services.backup.scheduler.asyncio.sleep", mock_sleep),
            patch(
                "wavecore.api.services.backup.scheduler._execute_scheduled_backup",
                mock_execute,
            ),
        ):
            asyncio.new_event_loop().run_until_complete(_scheduler_loop())

        # Verify the status was updated to failed
        assert captured_status == ["failed"]
        assert config_on_disk()["backup"]["schedule"].get("last_run_status") == "failed"


# ===========================================================================
# 10. Workbench try_catch: return None for unknown node type (line 112)
#     and return None for missing node (line 127)
# ===========================================================================


class TestTryCatchNodeEdgeCases:
    """Test edge cases in try_catch node execution."""

    def test_execute_node_returns_none_for_unknown_type(self) -> None:
        """_execute_node returns None when node_type is neither control nor plugin."""
        from wavecore.api.services.workbench.node_helpers import _execute_node

        node_fields = {
            "node_type": "unknown_type",
            "element_type": "something",
            "version": "1.0.0",
            "config_values": {},
            "display_name": "Test",
            "expression_fields": [],
            "template_fields": [],
            "variable_expression_keys": [],
            "variable_types": {},
            "block_name": "test-block",
        }
        result = asyncio.new_event_loop().run_until_complete(
            _execute_node(node_fields, {}, "session-1", "node-1")
        )
        assert result is None

    def test_execute_single_path_node_returns_none_for_missing_node(self) -> None:
        """_execute_single_path_node returns None when node_id not in node_map."""
        from wavecore.api.services.workbench.try_catch import _execute_single_path_node

        result = asyncio.new_event_loop().run_until_complete(
            _execute_single_path_node(
                path_node_id="missing-node",
                node_map={},
                variables={},
                session={"skipped_node_ids": [], "block_states": {}},
                session_id="session-1",
                executed=set(),
                environment_id=None,
            )
        )
        assert result is None


# ===========================================================================
# 13. Shared service utils: bump_version_and_record short version padding
# ===========================================================================


class TestBumpVersionShortVersionPadding:
    """Test that bump_version_and_record pads short version strings to 3 parts."""

    def test_bump_version_pads_two_part_version(self) -> None:
        """Version '1.0' is padded to '1.0.0' then bumped to '1.1.0'."""
        from wavecore.api.services.shared import bump_version_and_record

        entity: dict[str, Any] = {"version": "1.0"}
        saved_versions: list[list[dict[str, Any]]] = []

        def save_entity(e: dict[str, Any]) -> None:
            pass

        def load_versions(_id: str) -> list[dict[str, Any]]:
            return []

        def save_versions(_id: str, v: list[dict[str, Any]]) -> None:
            saved_versions.append(v)

        bump_version_and_record(
            entity, "ent-1", "test change", save_entity, load_versions, save_versions
        )

        assert entity["version"] == "1.1.0"
        assert len(saved_versions) == 1
        assert saved_versions[0][0]["version"] == "1.1.0"
