"""The shared route helpers: the success envelope and the list fields of a request body."""

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


class TestListField:
    """list_field() reads a body field that must be a list."""

    def test_an_absent_field_is_an_empty_list(self) -> None:
        from wavecore.api.routes.shared import list_field

        assert list_field({}, "items", "'items' must be a list") == []

    def test_a_list_is_carried_unchanged(self) -> None:
        from wavecore.api.routes.shared import list_field

        assert list_field({"items": [1, "a"]}, "items", "'items' must be a list") == [1, "a"]

    @pytest.mark.parametrize("value", [5, "abc", {"id": "x"}, None])
    def test_any_other_value_is_a_bad_request(self, value: Any) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.routes.shared import list_field

        with pytest.raises(ValidationException, match=r"^'items' must be a list$"):
            list_field({"items": value}, "items", "'items' must be a list")


class TestIdListField:
    """id_list_field() reads a body field that must be a list of ID strings."""

    def test_an_absent_field_is_an_empty_list(self) -> None:
        from wavecore.api.routes.shared import id_list_field

        assert id_list_field({}, "test_ids") == []

    def test_a_list_of_strings_is_carried_unchanged(self) -> None:
        from wavecore.api.routes.shared import id_list_field

        assert id_list_field({"test_ids": ["a", "b"]}, "test_ids") == ["a", "b"]

    @pytest.mark.parametrize("value", [5, "abc", {"id": "x"}, None, [1], ["a", None]])
    def test_any_other_value_is_a_bad_request(self, value: Any) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.routes.shared import id_list_field

        with pytest.raises(ValidationException, match=r"^'test_ids' must be a list of ID strings$"):
            id_list_field({"test_ids": value}, "test_ids")
