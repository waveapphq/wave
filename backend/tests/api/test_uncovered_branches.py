"""Tests covering uncovered branches across multiple modules.

Targets residual coverage gaps in:
- Suite variable validation ValueError conversion
- Regression execution ValueError handler
- Backup scheduler exception handler
- Block storage _get_storage sync path
- Profile exception constructors
- Workbench try_catch node execution edge cases
- Parallel output_collection merge error paths
"""

import asyncio
from collections.abc import Callable
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

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
