"""A terminal callback that raises is logged, and the session it names stays on one log line."""

import logging

import pytest

from wavecore.api.services.workbench import _common as wb_common


def _broken_callback(session_id: str, status: str, halt_scope: str | None = None) -> None:
    raise RuntimeError("handler broke")


class TestTerminalCallbackFailure:
    """The failure line of a terminal callback (REQ-6.4.1)."""

    @pytest.mark.parametrize(
        ("session_id", "logged_session"),
        [
            ("3f2b8c1e", "3f2b8c1e"),
            ("3f2b8c1e\nERROR forged", "base64:M2YyYjhjMWUKRVJST1IgZm9yZ2Vk"),
        ],
    )
    def test_a_failed_callback_logs_the_session_on_one_line(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        session_id: str,
        logged_session: str,
    ) -> None:
        monkeypatch.setattr(wb_common, "_terminal_callbacks", [_broken_callback])

        with caplog.at_level(logging.WARNING, logger=wb_common.__name__):
            wb_common._notify_terminal(session_id, wb_common.WorkbenchStatus.STOPPED.value)

        assert [
            record.getMessage() for record in caplog.records if record.name == wb_common.__name__
        ] == [
            f"Terminal callback failed for session {logged_session} (status=stopped): handler broke"
        ]
