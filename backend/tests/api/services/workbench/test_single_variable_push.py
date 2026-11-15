"""A single variable push that fails is logged, and the name it carries stays on one log line."""

import logging
from unittest.mock import AsyncMock

import pytest

from wavecore.api import app as app_module
from wavecore.api.services.workbench import _common as wb_common


class TestSingleVariablePushFailure:
    """The failure line of one variable push (REQ-6.4.1)."""

    @pytest.mark.parametrize(
        ("name", "logged_name"),
        [
            ("count", "count"),
            ("count\nWARN forged", "base64:Y291bnQKV0FSTiBmb3JnZWQ="),
        ],
    )
    async def test_a_failed_push_logs_the_name_on_one_line(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        name: str,
        logged_name: str,
    ) -> None:
        push_service = AsyncMock()
        push_service.push_variable_change.side_effect = RuntimeError("push broke")
        monkeypatch.setattr(
            app_module.app.state, "variable_push_service", push_service, raising=False
        )

        with caplog.at_level(logging.WARNING, logger=wb_common.__name__):
            await wb_common._push_single_variable_change("3f2b8c1e", name, 1, function_path=())

        push_service.push_variable_change.assert_awaited_once()
        assert [
            record.getMessage() for record in caplog.records if record.name == wb_common.__name__
        ] == [f"Failed to push variable change for '{logged_name}': push broke"]
