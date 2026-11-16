"""The shared route helpers: the success envelope and the list fields of a request body."""

import json
import re
from typing import Any, cast

import pytest
from fastapi import Request


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


class TestValidateUuid:
    """validate_uuid() refuses any value that is not a UUID string as a bad request."""

    def test_a_uuid_string_passes(self) -> None:
        from wavecore.api.routes.shared import validate_uuid

        value = "5b1f0c2e-7a3d-4c8e-9f10-2d3c4b5a6e7f"
        assert validate_uuid(value, "plugin_id") == value

    @pytest.mark.parametrize("value", ["not-a-uuid", 5, 1.5, None, ["x"], {"id": "x"}, True])
    def test_any_other_value_is_a_bad_request(self, value: Any) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.routes.shared import validate_uuid

        message = f"Invalid UUID format for plugin_id: '{value}'"
        with pytest.raises(ValidationException, match=f"^{re.escape(message)}$"):
            validate_uuid(value, "plugin_id")


class _BodyThatFails:
    """A request whose body read raises the given error."""

    def __init__(self, error: Exception) -> None:
        self._error = error

    async def json(self) -> Any:
        raise self._error


def _failing_request(error: Exception) -> Request:
    return cast(Request, _BodyThatFails(error))


class TestReadJson:
    """read_json() refuses a body that is not JSON text and lets any other fault through."""

    @pytest.mark.parametrize(
        "error",
        [
            pytest.param(json.JSONDecodeError("Expecting value", "{x", 1), id="not-json"),
            pytest.param(UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid"), id="not-utf-8"),
        ],
    )
    async def test_a_body_that_is_not_json_text_is_a_bad_request(self, error: Exception) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.routes.shared import read_json

        request = _failing_request(error)
        with pytest.raises(ValidationException, match=r"^The request body is not valid JSON$"):
            await read_json(request)

    def test_a_body_with_a_number_too_long_to_read_is_a_bad_request(self) -> None:
        from fastapi.testclient import TestClient

        from tests.api.error_reply_support import assert_error_reply
        from wavecore.api.app import app

        response = TestClient(app).post(
            "/tests",
            content='{"name": ' + "9" * 5000 + "}",
            headers={"content-type": "application/json"},
        )

        assert_error_reply(response, 400, "VALIDATION_ERROR", "The request body is not valid JSON")


class TestValidateVariableTypes:
    """validate_variable_types() refuses a declared type WAVE does not know."""

    def test_a_known_type_passes(self) -> None:
        from wavecore.api.routes.shared import validate_variable_types

        validate_variable_types({"count": {"type": "integer"}, "plain": "text"})

    def test_an_unknown_type_is_a_bad_request(self) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.routes.shared import VALID_VAR_TYPES, validate_variable_types

        message = (
            "Invalid variable type 'blob' for variable 'count'. "
            f"Allowed types: {', '.join(VALID_VAR_TYPES)}"
        )
        with pytest.raises(ValidationException, match=f"^{re.escape(message)}$"):
            validate_variable_types({"count": {"type": "blob"}})

    @pytest.mark.parametrize("variables", [["count"], "count", 5, None])
    def test_variables_that_are_not_an_object_are_a_bad_request(self, variables: Any) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.routes.shared import validate_variable_types

        with pytest.raises(ValidationException, match=r"^Field 'variables' must be an object$"):
            validate_variable_types(variables)


class TestValidateComputedExpression:
    """validate_computed_expression() refuses an expression with an unclosed template tag."""

    def test_a_balanced_expression_passes(self) -> None:
        from wavecore.api.routes.shared import validate_computed_expression

        validate_computed_expression("total", "{{ a }} and {{ b }}")

    def test_an_unclosed_tag_is_a_bad_request(self) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.routes.shared import validate_computed_expression

        with pytest.raises(
            ValidationException,
            match=(
                r"^Invalid expression syntax for computed variable 'total': "
                r"unclosed template tag$"
            ),
        ):
            validate_computed_expression("total", "{{ a ")


_IMPORT_PATHS = [
    "/tests/import",
    "/suites/import",
    "/regressions/import",
    "/profiles/import",
    "/environments/import",
    "/variables/system/import",
    "/functions/import",
]


class TestReadConflictResolutions:
    """read_conflict_resolutions() reads the import form's name-to-resolution map."""

    def test_an_empty_field_is_no_resolutions(self) -> None:
        from wavecore.api.routes.shared import read_conflict_resolutions

        assert read_conflict_resolutions("") == {}

    def test_an_object_of_strings_is_read(self) -> None:
        from wavecore.api.routes.shared import read_conflict_resolutions

        text = json.dumps({"Login": "overwrite", "Logout": "skip"})

        assert read_conflict_resolutions(text) == {"Login": "overwrite", "Logout": "skip"}

    @pytest.mark.parametrize(
        ("text", "message"),
        [
            pytest.param("{not json", "Invalid JSON in conflict_resolutions", id="not-json"),
            pytest.param("9" * 5000, "Invalid JSON in conflict_resolutions", id="huge-number"),
            pytest.param("[1, 2]", "'conflict_resolutions' must be a JSON object", id="list"),
            pytest.param('"skip"', "'conflict_resolutions' must be a JSON object", id="string"),
            pytest.param(
                '{"Login": 1}',
                "Each value in 'conflict_resolutions' must be a string",
                id="number-value",
            ),
            pytest.param(
                '{"Login": null}',
                "Each value in 'conflict_resolutions' must be a string",
                id="null-value",
            ),
        ],
    )
    def test_a_malformed_map_is_a_bad_request(self, text: str, message: str) -> None:
        from wavecore.api.exceptions import ValidationException
        from wavecore.api.routes.shared import read_conflict_resolutions

        with pytest.raises(ValidationException, match=f"^{re.escape(message)}$"):
            read_conflict_resolutions(text)

    @pytest.mark.parametrize("path", _IMPORT_PATHS)
    def test_every_import_refuses_a_map_that_is_not_an_object(self, path: str) -> None:
        from fastapi.testclient import TestClient

        from tests.api.error_reply_support import assert_error_reply
        from wavecore.api.app import app

        response = TestClient(app).post(
            path,
            files={"file": ("items.yaml", b"{}", "application/octet-stream")},
            data={"conflict_resolutions": "[1, 2]"},
        )

        assert_error_reply(
            response, 400, "VALIDATION_ERROR", "'conflict_resolutions' must be a JSON object"
        )


_STORED = {
    "id": "5b1f0c2e-7a3d-4c8e-9f10-2d3c4b5a6e7f",
    "version": "1.2.0",
    "updated_at": "2026-01-01T00:00:00Z",
}


class TestEntityEtag:
    """entity_etag() is a quoted hash of an entity's ID, version and last change."""

    def test_it_hashes_the_id_the_version_and_the_last_change(self) -> None:
        import hashlib

        from wavecore.api.routes.shared import entity_etag

        content = "5b1f0c2e-7a3d-4c8e-9f10-2d3c4b5a6e7f1.2.02026-01-01T00:00:00Z"
        assert entity_etag(_STORED) == f'"{hashlib.sha256(content.encode()).hexdigest()}"'


class TestRefuseStaleEtag:
    """refuse_stale_etag() refuses a write whose If-Match no longer matches the stored entity."""

    @pytest.mark.parametrize("if_match", [None, ""])
    def test_no_if_match_reads_nothing(self, if_match: str | None) -> None:
        from wavecore.api.routes.shared import refuse_stale_etag

        def load(_entity_id: str) -> dict[str, Any] | None:
            raise AssertionError("a write without If-Match must not read the entity")

        refuse_stale_etag(if_match, load, _STORED["id"])

    def test_a_missing_entity_is_left_to_the_write(self) -> None:
        from wavecore.api.routes.shared import refuse_stale_etag

        refuse_stale_etag('"stale"', lambda _entity_id: None, _STORED["id"])

    def test_the_current_etag_passes(self) -> None:
        from wavecore.api.routes.shared import entity_etag, refuse_stale_etag

        read: list[str] = []

        def load(entity_id: str) -> dict[str, Any] | None:
            read.append(entity_id)
            return _STORED

        refuse_stale_etag(entity_etag(_STORED), load, _STORED["id"])

        assert read == [_STORED["id"]]

    def test_a_stale_etag_is_a_failed_precondition(self) -> None:
        from wavecore.api.exceptions import PreconditionRequiredException
        from wavecore.api.routes.shared import refuse_stale_etag

        with pytest.raises(
            PreconditionRequiredException,
            match=r"^Precondition failed: resource has been modified$",
        ):
            refuse_stale_etag('"stale"', lambda _entity_id: _STORED, _STORED["id"])

    def test_an_entity_with_its_own_etag_is_checked_against_it(self) -> None:
        from wavecore.api.exceptions import PreconditionRequiredException
        from wavecore.api.routes.shared import entity_etag, refuse_stale_etag

        def own_etag(_entity: dict[str, Any]) -> str:
            return '"own"'

        refuse_stale_etag('"own"', lambda _entity_id: _STORED, _STORED["id"], own_etag)
        with pytest.raises(
            PreconditionRequiredException,
            match=r"^Precondition failed: resource has been modified$",
        ):
            refuse_stale_etag(entity_etag(_STORED), lambda _: _STORED, _STORED["id"], own_etag)
