"""The shared route helpers: the success envelope every WAVE endpoint answers with."""

from typing import Any

import pytest


class TestEnvelope:
    """envelope() wraps a payload as the success response body."""

    def test_a_payload_is_wrapped_as_success_data(self) -> None:
        from wavecore.api.routes.shared import envelope

        assert envelope({"a": 1}) == {"success": True, "data": {"a": 1}}

    @pytest.mark.parametrize("payload", [{}, {"issues": []}, {"job_id": "j", "cached": False}])
    def test_the_payload_is_carried_unchanged(self, payload: dict[str, Any]) -> None:
        from wavecore.api.routes.shared import envelope

        assert envelope(payload) == {"success": True, "data": payload}
