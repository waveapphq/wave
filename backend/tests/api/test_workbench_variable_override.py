"""Current-edit tests (REQ-3.2.1.6, REQ-5.2.4.7).

Covers ``set_variable_override``, the scope-at-path helper and the
``PATCH /workbench/{session_id}/variables/{name}`` route: a literal (null
included), an expression or a template lands in the scope its Function path
names, after the refusals in order - session, running, exactly one source,
scope, declared name, declared type, literal type.
"""

from __future__ import annotations

import asyncio
import re
import uuid
from collections.abc import Generator
from decimal import Decimal
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from wavecore.api.exceptions import (
    ConflictException,
    UnprocessableEntityException,
    ValidationException,
)
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench import service as workbench_service
from wavecore.api.services.workbench._common import DEFAULT_USER_ID
from wavecore.api.services.workbench.functions import staged_values
from wavecore.api.services.workbench.lazy_variables import LazyVariables

_ALLOWED_STATUSES = ["paused", "stopped", "passed", "failed", "skipped"]

# Both map to a 400 VALIDATION_ERROR at the route.
_REFUSED = (ValueError, ValidationException)


@pytest.fixture(autouse=True)
def _clean_sessions() -> Generator[None, None, None]:
    _wb_common._clear_sessions_sync()
    yield
    _wb_common._clear_sessions_sync()


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


def _seed_session(
    session_id: str,
    *,
    variables: Any = None,
    status: str = "paused",
    secret_variable_names: list[str] | None = None,
    variable_types: dict[str, str] | None = None,
    function_scopes: dict[tuple[str, ...], Any] | None = None,
    function_scope_types: dict[tuple[str, ...], dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Insert a session dict directly into the in-memory session store."""
    session: dict[str, Any] = {
        "session_id": session_id,
        "status": status,
        "test_id": "test-1",
        "user_id": DEFAULT_USER_ID,
        "block_states": {},
    }
    if variables is not None:
        session["variables"] = variables
    if secret_variable_names is not None:
        session["secret_variable_names"] = secret_variable_names
    if variable_types is not None:
        session["variable_types"] = variable_types
    if function_scopes is not None:
        session["function_scopes"] = function_scopes
    if function_scope_types is not None:
        session["function_scope_types"] = function_scope_types
    _wb_common._workbench_sessions[session_id] = session
    return session


class TestSetVariableOverrideServiceLiteral:
    """Literal overrides: coerce, assign into the live store, push once."""

    def test_literal_override_sets_realized_value_and_returns_payload(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_session(
            session_id, variables=LazyVariables({"count": 1}), variable_types={"count": "integer"}
        )

        result = workbench_service.set_variable_override(
            session_id, "count", value="42", value_given=True, declared_type="integer"
        )

        assert result == {"name": "count", "value": 42, "pending": False}
        # The override landed in the live store the engine reads on Continue.
        assert session["variables"]["count"] == 42

    def test_literal_override_integer_digit_string_coerces_exact_beyond_2_53(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_session(
            session_id, variables=LazyVariables({}), variable_types={"big": "integer"}
        )
        big = "9007199254740993"  # 2**53 + 1, lossy as a JS Number

        result = workbench_service.set_variable_override(
            session_id, "big", value=big, value_given=True, declared_type="integer"
        )

        assert result["value"] == "9007199254740993"
        assert session["variables"]["big"] == 9007199254740993

    def test_literal_override_supersedes_pending_expression(self) -> None:
        session_id = str(uuid.uuid4())
        lazy = LazyVariables({}, expr_map={"derived": ("1 + 1", "integer")})
        _seed_session(session_id, variables=lazy, variable_types={"derived": "integer"})

        workbench_service.set_variable_override(
            session_id, "derived", value="7", value_given=True, declared_type="integer"
        )

        # The literal write removed the pending expression entirely.
        assert lazy["derived"] == 7
        assert not lazy.has_pending_expressions()

    def test_literal_override_complex_map_passes_through(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_session(
            session_id, variables=LazyVariables({}), variable_types={"config": "map"}
        )
        payload = {"host": "localhost", "port": 8000}

        result = workbench_service.set_variable_override(
            session_id, "config", value=payload, value_given=True, declared_type="map"
        )

        assert result == {"name": "config", "value": payload, "pending": False}
        assert session["variables"]["config"] == payload

    def test_literal_override_of_an_undeclared_name_is_refused(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_session(
            session_id, variables=LazyVariables({"count": 1}), variable_types={"count": "integer"}
        )

        with pytest.raises(_REFUSED, match=r"^Variable 'fresh' is not declared by this test$"):
            workbench_service.set_variable_override(
                session_id, "fresh", value="hello", value_given=True, declared_type="string"
            )

        assert "fresh" not in session["variables"]

    def test_literal_override_masks_secret_in_return_but_stores_raw(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_session(
            session_id,
            variables=LazyVariables({"token": "old"}),
            secret_variable_names=["token"],
            variable_types={"token": "string"},
        )

        result = workbench_service.set_variable_override(
            session_id, "token", value="new-secret", value_given=True, declared_type="string"
        )

        assert result == {"name": "token", "value": "********", "pending": False}
        # The live store holds the real value; only the response is masked.
        assert session["variables"]["token"] == "new-secret"

    async def test_literal_override_fires_single_variable_changed_push(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(
            session_id, variables=LazyVariables({"count": 1}), variable_types={"count": "integer"}
        )

        recorded: list[tuple[str, str, Any]] = []

        async def fake_push(sid: str, name: str, value: Any, *_path: Any, **_kw: Any) -> None:
            recorded.append((sid, name, value))

        with patch(
            "wavecore.api.services.workbench._common._push_single_variable_change",
            new=fake_push,
        ):
            workbench_service.set_variable_override(
                session_id, "count", value="42", value_given=True, declared_type="integer"
            )
            await asyncio.gather(
                *[t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
            )

        assert recorded == [(session_id, "count", 42)]


class TestSetVariableOverrideServiceExpression:
    """Expression overrides: re-arm the source, no push at override time."""

    def test_expression_override_rearms_pending_and_returns_pending_payload(self) -> None:
        session_id = str(uuid.uuid4())
        lazy = LazyVariables({})
        _seed_session(session_id, variables=lazy, variable_types={"derived": "integer"})

        result = workbench_service.set_variable_override(
            session_id, "derived", expression="1 + 2", declared_type="integer"
        )

        assert result == {"name": "derived", "value": None, "pending": True}
        assert lazy.has_pending_expressions()
        assert "derived" in set(lazy.pending_expression_names())

    def test_expression_override_reevaluates_new_source_on_next_reference(self) -> None:
        session_id = str(uuid.uuid4())
        lazy = LazyVariables({"derived": 5})
        _seed_session(session_id, variables=lazy, variable_types={"derived": "integer"})

        workbench_service.set_variable_override(
            session_id, "derived", expression="10 * 2", declared_type="integer"
        )

        # The prior realized 5 is discarded; next reference yields the new source.
        assert lazy["derived"] == 20

    async def test_expression_override_does_not_push(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(
            session_id, variables=LazyVariables({}), variable_types={"derived": "integer"}
        )

        recorded: list[tuple[str, str, Any]] = []

        async def fake_push(sid: str, name: str, value: Any) -> None:
            recorded.append((sid, name, value))

        with patch(
            "wavecore.api.services.workbench._common._push_single_variable_change",
            new=fake_push,
        ):
            workbench_service.set_variable_override(
                session_id, "derived", expression="1 + 2", declared_type="integer"
            )
            await asyncio.gather(
                *[t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
            )

        assert recorded == []


class TestSetVariableOverrideServiceGates:
    """Run-state gate, request-shape validation, and coercion failure."""

    def test_unknown_session_raises_lookup_error_exact_message(self) -> None:
        unknown_id = str(uuid.uuid4())
        with pytest.raises(LookupError, match=rf"^Workbench session '{unknown_id}' not found$"):
            workbench_service.set_variable_override(
                unknown_id, "count", value="1", declared_type="integer"
            )

    def test_running_session_raises_conflict_exact_message(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({"count": 1}), status="running")

        with pytest.raises(
            ConflictException,
            match=r"^Cannot override variable 'count' while the session is running$",
        ):
            workbench_service.set_variable_override(
                session_id, "count", value="2", declared_type="integer"
            )

    @pytest.mark.parametrize("session_status", _ALLOWED_STATUSES)
    def test_override_allowed_for_every_non_running_status(self, session_status: str) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_session(
            session_id,
            variables=LazyVariables({"count": 1}),
            status=session_status,
            variable_types={"count": "integer"},
        )

        result = workbench_service.set_variable_override(
            session_id, "count", value="5", value_given=True, declared_type="integer"
        )

        assert result == {"name": "count", "value": 5, "pending": False}
        assert session["variables"]["count"] == 5

    def test_invalid_literal_raises_unprocessable_exact_message(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({}), variable_types={"count": "integer"})

        with pytest.raises(
            UnprocessableEntityException,
            match=r"^Value for variable 'count' is not a valid integer$",
        ):
            workbench_service.set_variable_override(
                session_id, "count", value="not-a-number", value_given=True, declared_type="integer"
            )

    def test_neither_value_nor_expression_raises_value_error(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({}))

        with pytest.raises(
            ValueError,
            match=(
                r"^Override request must provide exactly one of "
                r"'value', 'expression', or 'template'$"
            ),
        ):
            workbench_service.set_variable_override(session_id, "count", declared_type="integer")

    def test_both_value_and_expression_raises_value_error(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({}))

        with pytest.raises(
            ValueError,
            match=(
                r"^Override request must provide exactly one of "
                r"'value', 'expression', or 'template'$"
            ),
        ):
            workbench_service.set_variable_override(
                session_id,
                "count",
                value="1",
                value_given=True,
                expression="1 + 1",
                declared_type="integer",
            )


_NOT_FOUND_RE = re.compile(r"^Workbench session '[0-9a-f-]{36}' not found$")


class TestVariableOverrideEndpoint:
    """PATCH /workbench/{session_id}/variables/{name} HTTP contract."""

    def test_patch_literal_returns_200_envelope_and_updates_store(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_session(
            session_id, variables=LazyVariables({"count": 1}), variable_types={"count": "integer"}
        )

        response = client.patch(
            f"/workbench/{session_id}/variables/count",
            json={"value": "42", "type": "integer"},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["data"] == {"name": "count", "value": 42, "pending": False}
        assert session["variables"]["count"] == 42

    def test_patch_expression_returns_200_pending_payload(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        lazy = LazyVariables({})
        _seed_session(session_id, variables=lazy, variable_types={"derived": "integer"})

        response = client.patch(
            f"/workbench/{session_id}/variables/derived",
            json={"expression": "1 + 2", "type": "integer"},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["data"] == {"name": "derived", "value": None, "pending": True}
        assert lazy.has_pending_expressions()

    def test_patch_unknown_session_404_exact_message(self, client: TestClient) -> None:
        unknown_id = str(uuid.uuid4())

        response = client.patch(
            f"/workbench/{unknown_id}/variables/count",
            json={"value": "1", "type": "integer"},
        )

        assert response.status_code == 404
        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "NOT_FOUND"
        assert body["error"]["message"] == f"Workbench session '{unknown_id}' not found"
        assert _NOT_FOUND_RE.match(body["error"]["message"]) is not None

    def test_patch_running_session_409_exact_message(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({"count": 1}), status="running")

        response = client.patch(
            f"/workbench/{session_id}/variables/count",
            json={"value": "2", "type": "integer"},
        )

        assert response.status_code == 409
        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "CONFLICT"
        assert (
            body["error"]["message"]
            == "Cannot override variable 'count' while the session is running"
        )

    def test_patch_invalid_literal_422_exact_message(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({}), variable_types={"count": "integer"})

        response = client.patch(
            f"/workbench/{session_id}/variables/count",
            json={"value": "not-a-number", "type": "integer"},
        )

        assert response.status_code == 422
        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "UNPROCESSABLE_ENTITY"
        assert body["error"]["message"] == "Value for variable 'count' is not a valid integer"

    def test_patch_neither_value_nor_expression_400_exact_message(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({}))

        response = client.patch(
            f"/workbench/{session_id}/variables/count",
            json={"type": "integer"},
        )

        assert response.status_code == 400
        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert (
            body["error"]["message"]
            == "Override request must provide exactly one of 'value', 'expression', or 'template'"
        )

    def test_patch_both_value_and_expression_400_exact_message(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({}))

        response = client.patch(
            f"/workbench/{session_id}/variables/count",
            json={"value": "1", "expression": "1 + 1", "type": "integer"},
        )

        assert response.status_code == 400
        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert (
            body["error"]["message"]
            == "Override request must provide exactly one of 'value', 'expression', or 'template'"
        )

    def test_patch_invalid_session_id_uuid_400_exact_message(self, client: TestClient) -> None:
        response = client.patch(
            "/workbench/not-a-uuid/variables/count",
            json={"value": "1", "type": "integer"},
        )

        assert response.status_code == 400
        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["message"] == "Invalid UUID format for session_id: 'not-a-uuid'"


class TestSetVariableOverrideFloat:
    """Float overrides arrive as exact digit-strings and coerce to Decimal,
    returning a plain decimal string (REQ-3.1.3.14)."""

    def test_float_digit_string_coerces_to_exact_decimal(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_session(
            session_id, variables=LazyVariables({}), variable_types={"rate": "float"}
        )

        result = workbench_service.set_variable_override(
            session_id,
            "rate",
            value="-2123.123213123123699999",
            value_given=True,
            declared_type="float",
        )

        assert result == {
            "name": "rate",
            "value": "-2123.123213123123699999",
            "pending": False,
        }
        assert session["variables"]["rate"] == Decimal("-2123.123213123123699999")
        assert isinstance(session["variables"]["rate"], Decimal)

    def test_literal_of_another_type_raises_unprocessable(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({}), variable_types={"flag": "boolean"})

        with pytest.raises(
            UnprocessableEntityException,
            match=r"^Value for variable 'flag' is not a valid boolean$",
        ):
            workbench_service.set_variable_override(
                session_id, "flag", value="yes", value_given=True, declared_type="boolean"
            )

    def test_invalid_float_raises_unprocessable(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({}), variable_types={"rate": "float"})

        with pytest.raises(
            UnprocessableEntityException,
            match=r"^Value for variable 'rate' is not a valid float$",
        ):
            workbench_service.set_variable_override(
                session_id, "rate", value="not-a-number", value_given=True, declared_type="float"
            )

    @pytest.mark.parametrize(
        ("declared_type", "value", "said"),
        [
            ("integer", " 30 ", "is not a valid integer"),
            ("integer", "+30", "is not a valid integer"),
            ("integer", "1_000", "is not a valid integer"),
            ("integer", "12345678901234567890", "allows at most 19 digits, got 20"),
            ("float", "1e5", "is not a valid float"),
            ("float", "Infinity", "is not a valid float"),
            (
                "float",
                "1.2345678901234567890123456789",
                "allows at most 28 significant digits, got 29",
            ),
        ],
        ids=["spaces", "plus", "underscore", "20-digits", "exponent", "infinity", "29-digits"],
    )
    def test_text_that_breaks_the_number_rule_is_refused(
        self, declared_type: str, value: str, said: str
    ) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_session(
            session_id, variables=LazyVariables({"x": 1}), variable_types={"x": declared_type}
        )

        with pytest.raises(UnprocessableEntityException, match=f"^Value for variable 'x' {said}$"):
            workbench_service.set_variable_override(
                session_id, "x", value=value, value_given=True, declared_type=declared_type
            )
        assert session["variables"]["x"] == 1

    def test_a_typed_element_is_held_to_its_declared_type(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_session(session_id, variables=LazyVariables({}), variable_types={"ids": "array"})

        with pytest.raises(
            UnprocessableEntityException,
            match=r"^Value for variable 'ids' at item 2 is not a valid integer$",
        ):
            workbench_service.set_variable_override(
                session_id,
                "ids",
                value=["1", "1e3"],
                value_given=True,
                declared_type="array",
                element_types=["integer", "integer"],
            )

    def test_patch_float_string_returns_200_plain_string(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_session(
            session_id, variables=LazyVariables({}), variable_types={"rate": "float"}
        )

        response = client.patch(
            f"/workbench/{session_id}/variables/rate",
            json={"value": "1.08", "type": "float"},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["data"] == {"name": "rate", "value": "1.08", "pending": False}
        assert session["variables"]["rate"] == Decimal("1.08")


_EXACTLY_ONE_RE = (
    r"^Override request must provide exactly one of 'value', 'expression', or 'template'$"
)
_EXACTLY_ONE = "Override request must provide exactly one of 'value', 'expression', or 'template'"

# One value of each declared type, replaced by null in the null tests.
_ONE_VALUE_OF: dict[str, Any] = {
    "string": "a",
    "integer": 1,
    "float": Decimal("1.5"),
    "boolean": True,
    "array": [1, 2],
    "map": {"k": 1},
    "table": [{"k": 1}],
}

PushRecord = tuple[str, str, Any, tuple[str, ...]]


@pytest.fixture
def pushes() -> Generator[list[PushRecord], None, None]:
    """Record each scheduled ``variable_changed`` push with its Function path."""
    recorded: list[PushRecord] = []

    def record(session_id: str, name: str, value: Any, function_path: tuple[str, ...]) -> None:
        recorded.append((session_id, name, value, tuple(function_path)))

    with patch.object(workbench_service, "_schedule_variable_change_push", new=record):
        yield recorded


def _seed_declared_session(session_id: str, *, status: str = "paused") -> dict[str, Any]:
    """A session whose Test declares the integer 'n', holding 1."""
    return _seed_session(
        session_id,
        status=status,
        variables=LazyVariables({"n": 1}),
        variable_types={"n": "integer"},
    )


def _seed_scoped_session(session_id: str, *, status: str = "paused") -> dict[str, Any]:
    """A Test variable 'x' beside Function instances fn-1 and fn-1/fn-2, each with its own 'x'."""
    return _seed_session(
        session_id,
        status=status,
        variables=LazyVariables({"x": 1}),
        variable_types={"x": "integer"},
        function_scopes={
            ("fn-1",): LazyVariables({"x": 10, "base": 4, "who": "ann", "greeting": "hi"}),
            ("fn-1", "fn-2"): LazyVariables({"x": 20}),
        },
        function_scope_types={
            ("fn-1",): {"x": "integer", "base": "integer", "who": "string", "greeting": "string"},
            ("fn-1", "fn-2"): {"x": "integer"},
        },
    )


def _seed_function_without_x(session_id: str) -> dict[str, Any]:
    """The Test declares 'x'; Function instance fn-1 declares only 'y'."""
    return _seed_session(
        session_id,
        variables=LazyVariables({"x": 1}),
        variable_types={"x": "integer"},
        function_scopes={("fn-1",): LazyVariables({"y": 2})},
        function_scope_types={("fn-1",): {"y": "integer"}},
    )


def _scope(session: dict[str, Any], *path: str) -> Any:
    return session["function_scopes"][path]


def _scope_not_found(path: str, session_id: str) -> str:
    return f"Function scope '{path}' not found in workbench session '{session_id}'"


class TestSetVariableOverrideNull:
    """A sent null is a literal of every type (REQ-3.1.3.20, REQ-3.2.1.6)."""

    @pytest.mark.parametrize("declared_type", sorted(_ONE_VALUE_OF))
    def test_null_literal_is_accepted_for_every_type(
        self, declared_type: str, pushes: list[PushRecord]
    ) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_session(
            session_id,
            variables=LazyVariables({"v": _ONE_VALUE_OF[declared_type]}),
            variable_types={"v": declared_type},
        )

        result = workbench_service.set_variable_override(
            session_id, "v", value=None, value_given=True, declared_type=declared_type
        )

        assert result == {"name": "v", "value": None, "pending": False}
        assert "v" in session["variables"]
        assert session["variables"]["v"] is None

    def test_null_literal_schedules_a_push_of_null(self, pushes: list[PushRecord]) -> None:
        session_id = str(uuid.uuid4())
        _seed_declared_session(session_id)

        workbench_service.set_variable_override(
            session_id, "n", value=None, value_given=True, declared_type="integer"
        )

        assert pushes == [(session_id, "n", None, ())]

    def test_null_literal_supersedes_a_pending_expression(self, pushes: list[PushRecord]) -> None:
        session_id = str(uuid.uuid4())
        lazy = LazyVariables({}, expr_map={"derived": ("1 + 1", "integer")})
        _seed_session(session_id, variables=lazy, variable_types={"derived": "integer"})

        workbench_service.set_variable_override(
            session_id, "derived", value=None, value_given=True, declared_type="integer"
        )

        assert not lazy.has_pending_expressions()
        assert lazy["derived"] is None

    def test_null_literal_clears_an_earlier_source_and_marks_its_readers(
        self, pushes: list[PushRecord]
    ) -> None:
        session_id = str(uuid.uuid4())
        lazy = LazyVariables(
            {}, expr_map={"n": ("0 + 1", "integer"), "twice": ("n * 2", "integer")}
        )
        session = _seed_session(
            session_id, variables=lazy, variable_types={"n": "integer", "twice": "integer"}
        )
        session["given_expressions"] = {"n": ("0 + 1", "integer")}
        assert lazy["twice"] == 2

        workbench_service.set_variable_override(
            session_id, "n", value=None, value_given=True, declared_type="integer"
        )

        assert session["given_expressions"] == {}
        assert lazy.stale_names() == frozenset({"twice"})

    def test_null_literal_of_a_secret_replies_null(self, pushes: list[PushRecord]) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_session(
            session_id,
            variables=LazyVariables({"token": "old"}),
            variable_types={"token": "string"},
            secret_variable_names=["token"],
        )

        result = workbench_service.set_variable_override(
            session_id, "token", value=None, value_given=True, declared_type="string"
        )

        assert result == {"name": "token", "value": None, "pending": False}
        assert session["variables"]["token"] is None

    def test_null_beside_an_expression_is_refused_as_two_sources(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_declared_session(session_id)

        with pytest.raises(ValueError, match=_EXACTLY_ONE_RE):
            workbench_service.set_variable_override(
                session_id,
                "n",
                value=None,
                value_given=True,
                expression="1 + 1",
                declared_type="integer",
            )

        assert session["variables"]["n"] == 1

    def test_no_value_given_is_refused(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_declared_session(session_id)

        with pytest.raises(ValueError, match=_EXACTLY_ONE_RE):
            workbench_service.set_variable_override(
                session_id, "n", value=None, value_given=False, declared_type="integer"
            )

        assert session["variables"]["n"] == 1


class TestSetVariableOverrideDeclaredTestScope:
    """A Test-scope Current edit must name a declared variable of its declared type."""

    def test_declared_literal_is_applied_and_pushed(self, pushes: list[PushRecord]) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_declared_session(session_id)

        result = workbench_service.set_variable_override(
            session_id, "n", value="5", value_given=True, declared_type="integer"
        )

        assert result == {"name": "n", "value": 5, "pending": False}
        assert session["variables"]["n"] == 5
        assert pushes == [(session_id, "n", 5, ())]

    def test_expression_of_an_undeclared_name_is_refused(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_declared_session(session_id)

        with pytest.raises(_REFUSED, match=r"^Variable 'fresh' is not declared by this test$"):
            workbench_service.set_variable_override(
                session_id, "fresh", expression="1 + 1", declared_type="integer"
            )

        assert "fresh" not in session["variables"]

    def test_template_of_an_undeclared_name_is_refused(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_declared_session(session_id)

        with pytest.raises(_REFUSED, match=r"^Variable 'fresh' is not declared by this test$"):
            workbench_service.set_variable_override(
                session_id, "fresh", template="Hi {{n}}", declared_type="string"
            )

        assert "fresh" not in session["variables"]

    def test_null_of_an_undeclared_name_is_refused(self, pushes: list[PushRecord]) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_declared_session(session_id)

        with pytest.raises(_REFUSED, match=r"^Variable 'fresh' is not declared by this test$"):
            workbench_service.set_variable_override(
                session_id, "fresh", value=None, value_given=True, declared_type="string"
            )

        assert "fresh" not in session["variables"]
        assert pushes == []

    def test_type_mismatch_is_refused_and_the_value_kept(self, pushes: list[PushRecord]) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_declared_session(session_id)

        with pytest.raises(
            _REFUSED, match=r"^Type mismatch for variable 'n': expected 'integer', got 'string'$"
        ):
            workbench_service.set_variable_override(
                session_id, "n", value="5", value_given=True, declared_type="string"
            )

        assert session["variables"]["n"] == 1
        assert pushes == []

    def test_type_mismatch_of_an_expression_is_refused(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_declared_session(session_id)

        with pytest.raises(
            _REFUSED, match=r"^Type mismatch for variable 'n': expected 'integer', got 'string'$"
        ):
            workbench_service.set_variable_override(
                session_id, "n", expression="'five'", declared_type="string"
            )

        assert not session["variables"].has_pending_expressions()
        assert session["variables"]["n"] == 1

    def test_null_of_another_type_is_a_type_mismatch(self, pushes: list[PushRecord]) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_declared_session(session_id)

        with pytest.raises(
            _REFUSED, match=r"^Type mismatch for variable 'n': expected 'integer', got 'string'$"
        ):
            workbench_service.set_variable_override(
                session_id, "n", value=None, value_given=True, declared_type="string"
            )

        assert session["variables"]["n"] == 1
        assert pushes == []

    def test_invalid_literal_of_the_declared_type_is_unprocessable(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_declared_session(session_id)

        with pytest.raises(
            UnprocessableEntityException, match=r"^Value for variable 'n' is not a valid integer$"
        ):
            workbench_service.set_variable_override(
                session_id, "n", value="not-a-number", value_given=True, declared_type="integer"
            )


class TestSetVariableOverrideRefusalOrder:
    """Refusals apply in order: session, running, exactly one, scope, name, type, literal."""

    def test_an_unknown_session_is_refused_first(self) -> None:
        unknown_id = str(uuid.uuid4())

        with pytest.raises(LookupError, match=rf"^Workbench session '{unknown_id}' not found$"):
            workbench_service.set_variable_override(
                unknown_id, "ghost", declared_type="string", function_path=("fn-9",)
            )

    def test_running_is_refused_before_the_request_shape(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id, status="running")

        with pytest.raises(
            ConflictException, match=r"^Cannot override variable 'n' while the session is running$"
        ):
            workbench_service.set_variable_override(
                session_id, "n", declared_type="string", function_path=("fn-9",)
            )

    def test_two_sources_are_refused_before_the_scope(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        with pytest.raises(ValueError, match=_EXACTLY_ONE_RE):
            workbench_service.set_variable_override(
                session_id,
                "ghost",
                value=None,
                value_given=True,
                expression="1 + 1",
                declared_type="integer",
                function_path=("fn-9",),
            )

    def test_an_unknown_scope_is_refused_before_the_name(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        with pytest.raises(
            LookupError, match=rf"^{re.escape(_scope_not_found('fn-9', session_id))}$"
        ):
            workbench_service.set_variable_override(
                session_id,
                "ghost",
                value="1",
                value_given=True,
                declared_type="boolean",
                function_path=("fn-9",),
            )

    def test_an_undeclared_name_is_refused_before_its_type_and_value(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_declared_session(session_id)

        with pytest.raises(_REFUSED, match=r"^Variable 'fresh' is not declared by this test$"):
            workbench_service.set_variable_override(
                session_id, "fresh", value="not-a-number", value_given=True, declared_type="integer"
            )

    def test_a_type_mismatch_is_refused_before_the_literal_check(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_declared_session(session_id)

        with pytest.raises(
            _REFUSED, match=r"^Type mismatch for variable 'n': expected 'integer', got 'boolean'$"
        ):
            workbench_service.set_variable_override(
                session_id, "n", value="xyz", value_given=True, declared_type="boolean"
            )


class TestSetVariableOverrideFunctionScope:
    """A Current edit of a Function's own value lands in that instance's scope (REQ-3.2.1.6)."""

    def test_literal_lands_in_the_instance_scope_and_leaves_the_test_variable(
        self, pushes: list[PushRecord]
    ) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        result = workbench_service.set_variable_override(
            session_id,
            "x",
            value="5",
            value_given=True,
            declared_type="integer",
            function_path=("fn-1",),
        )

        assert result == {"name": "x", "value": 5, "pending": False}
        assert _scope(session, "fn-1")["x"] == 5
        assert _scope(session, "fn-1", "fn-2")["x"] == 20
        assert session["variables"]["x"] == 1

    def test_literal_lands_in_a_nested_instance_scope(self, pushes: list[PushRecord]) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        workbench_service.set_variable_override(
            session_id,
            "x",
            value="5",
            value_given=True,
            declared_type="integer",
            function_path=("fn-1", "fn-2"),
        )

        assert _scope(session, "fn-1", "fn-2")["x"] == 5
        assert _scope(session, "fn-1")["x"] == 10
        assert session["variables"]["x"] == 1

    def test_literal_push_carries_the_function_path(self, pushes: list[PushRecord]) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        workbench_service.set_variable_override(
            session_id,
            "x",
            value="5",
            value_given=True,
            declared_type="integer",
            function_path=("fn-1", "fn-2"),
        )

        assert pushes == [(session_id, "x", 5, ("fn-1", "fn-2"))]

    def test_null_literal_lands_in_the_instance_scope(self, pushes: list[PushRecord]) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        result = workbench_service.set_variable_override(
            session_id,
            "x",
            value=None,
            value_given=True,
            declared_type="integer",
            function_path=("fn-1",),
        )

        assert result == {"name": "x", "value": None, "pending": False}
        assert "x" in _scope(session, "fn-1")
        assert _scope(session, "fn-1")["x"] is None
        assert session["variables"]["x"] == 1
        assert pushes == [(session_id, "x", None, ("fn-1",))]

    def test_expression_rearms_in_the_instance_scope(self, pushes: list[PushRecord]) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        result = workbench_service.set_variable_override(
            session_id,
            "x",
            expression="base * 2",
            declared_type="integer",
            function_path=("fn-1",),
        )

        assert result == {"name": "x", "value": None, "pending": True}
        scope = _scope(session, "fn-1")
        assert "x" in set(scope.pending_expression_names())
        assert scope["x"] == 8
        assert not session["variables"].has_pending_expressions()
        assert session["variables"]["x"] == 1
        assert pushes == []

    def test_template_rearms_in_the_instance_scope(self, pushes: list[PushRecord]) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        result = workbench_service.set_variable_override(
            session_id,
            "greeting",
            template="Hi {{who}}",
            declared_type="string",
            function_path=("fn-1",),
        )

        assert result == {"name": "greeting", "value": None, "pending": True}
        assert _scope(session, "fn-1")["greeting"] == "Hi ann"
        assert "greeting" not in session["variables"]

    def test_empty_path_addresses_the_test_scope(self, pushes: list[PushRecord]) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        workbench_service.set_variable_override(
            session_id, "x", value="5", value_given=True, declared_type="integer", function_path=()
        )

        assert session["variables"]["x"] == 5
        assert _scope(session, "fn-1")["x"] == 10
        assert pushes == [(session_id, "x", 5, ())]

    def test_a_declared_name_the_scope_has_not_written_yet_is_accepted(
        self, pushes: list[PushRecord]
    ) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)
        session["function_scope_types"][("fn-1",)]["result"] = "string"

        workbench_service.set_variable_override(
            session_id,
            "result",
            value="done",
            value_given=True,
            declared_type="string",
            function_path=("fn-1",),
        )

        assert _scope(session, "fn-1")["result"] == "done"
        assert "result" not in session["variables"]

    def test_edit_leaves_the_test_scope_source_and_readers_of_the_same_name(
        self, pushes: list[PushRecord]
    ) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)
        test_scope = LazyVariables(
            {}, expr_map={"x": ("0 + 1", "integer"), "twice": ("x * 2", "integer")}
        )
        session["variables"] = test_scope
        session["given_expressions"] = {"x": ("0 + 1", "integer")}
        assert test_scope["twice"] == 2

        workbench_service.set_variable_override(
            session_id,
            "x",
            value="5",
            value_given=True,
            declared_type="integer",
            function_path=("fn-1",),
        )

        assert session["given_expressions"] == {"x": ("0 + 1", "integer")}
        assert test_scope.stale_names() == frozenset()
        assert test_scope["x"] == 1

    def test_secret_in_the_instance_scope_is_masked_in_the_reply(
        self, pushes: list[PushRecord]
    ) -> None:
        from wavecore.core.secrets.registry import SecretRegistry

        registry = SecretRegistry()
        registry.mark_name("tok")
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)
        session["secret_registry"] = registry
        session["function_scope_types"][("fn-1",)]["tok"] = "string"

        result = workbench_service.set_variable_override(
            session_id,
            "tok",
            value="fn-s3cret-77",
            value_given=True,
            declared_type="string",
            function_path=("fn-1",),
        )

        assert result == {"name": "tok", "value": "********", "pending": False}
        assert _scope(session, "fn-1")["tok"] == "fn-s3cret-77"

    def test_a_name_only_the_test_declares_is_refused_in_the_function(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_function_without_x(session_id)

        with pytest.raises(_REFUSED, match=r"^Variable 'x' is not declared by this Function$"):
            workbench_service.set_variable_override(
                session_id,
                "x",
                value="5",
                value_given=True,
                declared_type="integer",
                function_path=("fn-1",),
            )

        assert "x" not in _scope(session, "fn-1")
        assert session["variables"]["x"] == 1

    def test_expression_of_an_undeclared_function_name_is_refused(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_function_without_x(session_id)

        with pytest.raises(_REFUSED, match=r"^Variable 'x' is not declared by this Function$"):
            workbench_service.set_variable_override(
                session_id,
                "x",
                expression="y + 1",
                declared_type="integer",
                function_path=("fn-1",),
            )

        assert "x" not in _scope(session, "fn-1")

    def test_type_mismatch_in_the_instance_scope_is_refused(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        with pytest.raises(
            _REFUSED, match=r"^Type mismatch for variable 'x': expected 'integer', got 'string'$"
        ):
            workbench_service.set_variable_override(
                session_id,
                "x",
                value="5",
                value_given=True,
                declared_type="string",
                function_path=("fn-1",),
            )

        assert _scope(session, "fn-1")["x"] == 10

    def test_invalid_literal_in_the_instance_scope_is_unprocessable(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        with pytest.raises(
            UnprocessableEntityException, match=r"^Value for variable 'x' is not a valid integer$"
        ):
            workbench_service.set_variable_override(
                session_id,
                "x",
                value="not-a-number",
                value_given=True,
                declared_type="integer",
                function_path=("fn-1",),
            )

        assert _scope(session, "fn-1")["x"] == 10

    def test_unknown_path_raises_lookup_error_exact_message(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        with pytest.raises(
            LookupError, match=rf"^{re.escape(_scope_not_found('fn-9', session_id))}$"
        ):
            workbench_service.set_variable_override(
                session_id,
                "x",
                value="5",
                value_given=True,
                declared_type="integer",
                function_path=("fn-9",),
            )

        assert session["variables"]["x"] == 1

    def test_unknown_two_level_path_is_joined_with_a_slash(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)
        del session["function_scopes"][("fn-1", "fn-2")]
        del session["function_scope_types"][("fn-1", "fn-2")]

        with pytest.raises(
            LookupError, match=rf"^{re.escape(_scope_not_found('fn-1/fn-2', session_id))}$"
        ):
            workbench_service.set_variable_override(
                session_id,
                "x",
                value="5",
                value_given=True,
                declared_type="integer",
                function_path=("fn-1", "fn-2"),
            )

        assert _scope(session, "fn-1")["x"] == 10


_STANDALONE_DEFINITION: dict[str, Any] = {
    "name": "standalone_fn",
    "inputs": [{"name": "who", "type": "string", "required": False, "default": "hi"}],
    "outputs": [],
    "variables": [{"name": "count", "type": "integer", "value": 1}],
    "workflow": {"nodes": [], "edges": []},
}


async def _finished_standalone_session() -> dict[str, Any]:
    """A library-View session whose run of the Function on its own has finished."""
    started = workbench_service.start_standalone_function_run(
        function_def=dict(_STANDALONE_DEFINITION),
        function_name="standalone_fn",
        function_id=str(uuid.uuid4()),
        environment_id=str(uuid.uuid4()),
    )
    session_id = started["session_id"]
    await asyncio.wait_for(_wb_common._active_tasks[session_id], timeout=10.0)
    session = _wb_common._workbench_sessions[session_id]
    assert session["status"] == "passed", session.get("error")
    return session


def _standalone_scope(session: dict[str, Any]) -> Any:
    return _scope(session, workbench_service._STANDALONE_FUNCTION_NODE_ID)


@pytest.mark.usefixtures("pushes")
class TestSetVariableOverrideStandaloneSession:
    """In a library-View session the empty path is the Function's own scope."""

    async def test_empty_path_edits_the_functions_own_local(self, pushes: list[PushRecord]) -> None:
        session = await _finished_standalone_session()
        assert _standalone_scope(session)["count"] == 1
        pushed_by_the_run = len(pushes)

        result = workbench_service.set_variable_override(
            session["session_id"], "count", value="7", value_given=True, declared_type="integer"
        )

        assert result == {"name": "count", "value": 7, "pending": False}
        assert _standalone_scope(session)["count"] == 7
        assert "count" not in session["variables"]
        # The event builder strips the internal id; the scheduler gets the full path.
        assert pushes[pushed_by_the_run:] == [
            (session["session_id"], "count", 7, (workbench_service._STANDALONE_FUNCTION_NODE_ID,))
        ]

    async def test_empty_path_edits_the_functions_own_input(self) -> None:
        session = await _finished_standalone_session()
        assert _standalone_scope(session)["who"] == "hi"

        workbench_service.set_variable_override(
            session["session_id"], "who", value="ann", value_given=True, declared_type="string"
        )

        assert _standalone_scope(session)["who"] == "ann"
        assert "who" not in session["variables"]

    async def test_an_undeclared_name_is_refused_as_not_declared_by_this_function(self) -> None:
        session = await _finished_standalone_session()

        with pytest.raises(_REFUSED, match=r"^Variable 'ghost' is not declared by this Function$"):
            workbench_service.set_variable_override(
                session["session_id"], "ghost", value="1", value_given=True, declared_type="string"
            )

        assert "ghost" not in _standalone_scope(session)
        assert "ghost" not in session["variables"]

    async def test_unknown_path_names_only_the_path_that_was_sent(self) -> None:
        session = await _finished_standalone_session()
        session_id = session["session_id"]

        with pytest.raises(
            LookupError, match=rf"^{re.escape(_scope_not_found('fn-9', session_id))}$"
        ):
            workbench_service.set_variable_override(
                session_id,
                "count",
                value="7",
                value_given=True,
                declared_type="integer",
                function_path=("fn-9",),
            )

        assert _standalone_scope(session)["count"] == 1

    async def test_a_nested_path_is_read_inside_the_standalone_instance(
        self, pushes: list[PushRecord]
    ) -> None:
        session = await _finished_standalone_session()
        session_id = session["session_id"]
        nested = (workbench_service._STANDALONE_FUNCTION_NODE_ID, "inner")
        session["function_scopes"][nested] = LazyVariables({"depth": 2})
        session.setdefault("function_scope_types", {})[nested] = {"depth": "integer"}
        pushed_by_the_run = len(pushes)

        workbench_service.set_variable_override(
            session_id,
            "depth",
            value="3",
            value_given=True,
            declared_type="integer",
            function_path=("inner",),
        )

        assert session["function_scopes"][nested]["depth"] == 3
        assert "depth" not in _standalone_scope(session)
        assert pushes[pushed_by_the_run:] == [(session_id, "depth", 3, nested)]


class TestScopeAt:
    """One place maps a Function path to its live store, declared types and kind."""

    def test_empty_path_is_the_test_scope(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        scope = workbench_service._scope_at(session, ())

        assert scope.variables is session["variables"]
        assert scope.declared_types == {"x": "integer"}
        assert scope.kind == "test"

    def test_a_path_is_that_instance_scope(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        scope = workbench_service._scope_at(session, ("fn-1", "fn-2"))

        assert scope.variables is _scope(session, "fn-1", "fn-2")
        assert scope.declared_types == {"x": "integer"}
        assert scope.kind == "function"

    def test_an_unknown_path_raises_the_not_found_text(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        with pytest.raises(
            LookupError, match=rf"^{re.escape(_scope_not_found('fn-1/fn-9', session_id))}$"
        ):
            workbench_service._scope_at(session, ("fn-1", "fn-9"))

    async def test_standalone_empty_path_is_the_functions_own_scope(self) -> None:
        session = await _finished_standalone_session()

        scope = workbench_service._scope_at(session, ())

        assert scope.variables is _standalone_scope(session)
        assert scope.declared_types == {"who": "string", "count": "integer"}
        assert scope.kind == "function"


class TestVariableOverrideEndpointNullAndDeclared:
    """PATCH: a JSON null is a value; undeclared names and other types are refused."""

    def test_patch_null_value_returns_200_and_the_scope_holds_null(
        self, client: TestClient
    ) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_declared_session(session_id)

        response = client.patch(
            f"/workbench/{session_id}/variables/n", json={"value": None, "type": "integer"}
        )

        assert response.status_code == 200, response.text
        assert response.json()["data"] == {"name": "n", "value": None, "pending": False}
        assert "n" in session["variables"]
        assert session["variables"]["n"] is None

    def test_patch_without_a_value_key_is_still_400(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_declared_session(session_id)

        response = client.patch(f"/workbench/{session_id}/variables/n", json={"type": "integer"})

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["message"] == _EXACTLY_ONE
        assert session["variables"]["n"] == 1

    def test_patch_null_value_beside_an_expression_is_400(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_declared_session(session_id)

        response = client.patch(
            f"/workbench/{session_id}/variables/n",
            json={"value": None, "expression": "1 + 1", "type": "integer"},
        )

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["message"] == _EXACTLY_ONE
        assert not session["variables"].has_pending_expressions()

    def test_patch_undeclared_name_400_exact_message(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_declared_session(session_id)

        response = client.patch(
            f"/workbench/{session_id}/variables/fresh", json={"value": "hello", "type": "string"}
        )

        assert response.status_code == 400
        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["message"] == "Variable 'fresh' is not declared by this test"
        assert "fresh" not in session["variables"]

    def test_patch_type_mismatch_400_exact_message(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_declared_session(session_id)

        response = client.patch(
            f"/workbench/{session_id}/variables/n", json={"value": "5", "type": "string"}
        )

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert (
            body["error"]["message"]
            == "Type mismatch for variable 'n': expected 'integer', got 'string'"
        )
        assert session["variables"]["n"] == 1

    def test_patch_invalid_literal_of_the_declared_type_422(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_declared_session(session_id)

        response = client.patch(
            f"/workbench/{session_id}/variables/n", json={"value": "abc", "type": "integer"}
        )

        assert response.status_code == 422
        body = response.json()
        assert body["error"]["code"] == "UNPROCESSABLE_ENTITY"
        assert body["error"]["message"] == "Value for variable 'n' is not a valid integer"

    def test_patch_running_409_before_the_scope_is_checked(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_declared_session(session_id, status="running")

        response = client.patch(
            f"/workbench/{session_id}/variables/n",
            json={"value": None, "type": "integer", "function_path": ["fn-9"]},
        )

        assert response.status_code == 409
        body = response.json()
        assert body["error"]["code"] == "CONFLICT"
        assert (
            body["error"]["message"] == "Cannot override variable 'n' while the session is running"
        )

    def test_patch_without_a_type_is_400(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_declared_session(session_id)

        response = client.patch(f"/workbench/{session_id}/variables/n", json={"value": None})

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["message"] == "Validation error for 'type': Field required"
        assert session["variables"]["n"] == 1

    def test_patch_with_an_unknown_key_is_400(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_declared_session(session_id)

        response = client.patch(
            f"/workbench/{session_id}/variables/n",
            json={"value": "5", "type": "integer", "scope": "function"},
        )

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert (
            body["error"]["message"]
            == "Validation error for 'scope': Extra inputs are not permitted"
        )
        assert session["variables"]["n"] == 1


class TestVariableOverrideEndpointFunctionScope:
    """PATCH with ``function_path``: the instance node ids from the root canvas inward."""

    def test_patch_with_function_path_lands_in_the_instance_scope(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        response = client.patch(
            f"/workbench/{session_id}/variables/x",
            json={"value": "5", "type": "integer", "function_path": ["fn-1"]},
        )

        assert response.status_code == 200, response.text
        assert response.json()["data"] == {"name": "x", "value": 5, "pending": False}
        assert _scope(session, "fn-1")["x"] == 5
        assert session["variables"]["x"] == 1

    def test_patch_with_a_two_level_function_path(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        response = client.patch(
            f"/workbench/{session_id}/variables/x",
            json={"value": "5", "type": "integer", "function_path": ["fn-1", "fn-2"]},
        )

        assert response.status_code == 200, response.text
        assert _scope(session, "fn-1", "fn-2")["x"] == 5
        assert _scope(session, "fn-1")["x"] == 10
        assert session["variables"]["x"] == 1

    def test_patch_null_value_with_function_path(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        response = client.patch(
            f"/workbench/{session_id}/variables/x",
            json={"value": None, "type": "integer", "function_path": ["fn-1"]},
        )

        assert response.status_code == 200, response.text
        assert response.json()["data"] == {"name": "x", "value": None, "pending": False}
        assert _scope(session, "fn-1")["x"] is None
        assert session["variables"]["x"] == 1

    def test_patch_expression_with_function_path_rearms_there(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        response = client.patch(
            f"/workbench/{session_id}/variables/x",
            json={"expression": "base * 2", "type": "integer", "function_path": ["fn-1"]},
        )

        assert response.status_code == 200, response.text
        assert response.json()["data"] == {"name": "x", "value": None, "pending": True}
        assert _scope(session, "fn-1")["x"] == 8
        assert not session["variables"].has_pending_expressions()
        assert session["variables"]["x"] == 1

    def test_patch_empty_function_path_addresses_the_test_scope(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_scoped_session(session_id)

        response = client.patch(
            f"/workbench/{session_id}/variables/x",
            json={"value": "5", "type": "integer", "function_path": []},
        )

        assert response.status_code == 200, response.text
        assert session["variables"]["x"] == 5
        assert _scope(session, "fn-1")["x"] == 10

    def test_patch_unknown_function_path_404_exact_message(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        response = client.patch(
            f"/workbench/{session_id}/variables/x",
            json={"value": "5", "type": "integer", "function_path": ["fn-9"]},
        )

        assert response.status_code == 404
        body = response.json()
        assert body["success"] is False
        assert body["error"]["code"] == "NOT_FOUND"
        assert body["error"]["message"] == _scope_not_found("fn-9", session_id)

    def test_patch_unknown_two_level_function_path_404_joined(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        response = client.patch(
            f"/workbench/{session_id}/variables/x",
            json={"value": "5", "type": "integer", "function_path": ["fn-1", "fn-9"]},
        )

        assert response.status_code == 404
        assert response.json()["error"]["message"] == _scope_not_found("fn-1/fn-9", session_id)

    def test_patch_undeclared_function_name_400_exact_message(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_function_without_x(session_id)

        response = client.patch(
            f"/workbench/{session_id}/variables/x",
            json={"value": "5", "type": "integer", "function_path": ["fn-1"]},
        )

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["message"] == "Variable 'x' is not declared by this Function"
        assert "x" not in _scope(session, "fn-1")

    def test_patch_unknown_session_404_before_the_scope_is_checked(
        self, client: TestClient
    ) -> None:
        unknown_id = str(uuid.uuid4())

        response = client.patch(
            f"/workbench/{unknown_id}/variables/x",
            json={"value": None, "type": "integer", "function_path": ["fn-9"]},
        )

        assert response.status_code == 404
        body = response.json()
        assert body["error"]["code"] == "NOT_FOUND"
        assert body["error"]["message"] == f"Workbench session '{unknown_id}' not found"

    def test_patch_no_value_is_400_before_the_scope_is_checked(self, client: TestClient) -> None:
        session_id = str(uuid.uuid4())
        _seed_scoped_session(session_id)

        response = client.patch(
            f"/workbench/{session_id}/variables/x",
            json={"type": "integer", "function_path": ["fn-9"]},
        )

        assert response.status_code == 400
        body = response.json()
        assert body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["message"] == _EXACTLY_ONE


_DRILLED_ENVIRONMENT_ID = "10000000-0000-0000-0000-000000000073"

_COUNTER_FUNCTION: dict[str, Any] = {
    "name": "counter",
    "description": "",
    "tags": [],
    "inputs": [{"name": "who", "type": "string", "required": False, "default": "hi"}],
    "outputs": [],
    "variables": [{"name": "count", "type": "integer", "value": 1}],
    "dependencies": {"functions": [], "plugins": []},
    "workflow": {"nodes": [], "edges": []},
}

_COUNTER_NODE: dict[str, Any] = {
    "id": "fn-1",
    "type": "workflowNode",
    "position": {"x": 0, "y": 0},
    "data": {
        "label": "fn-1",
        "elementType": "function",
        "nodeType": "function",
        "version": "1.0.0",
        "functionLifecycle": "local",
        "localDefinition": _COUNTER_FUNCTION,
        "config": {"values": {}, "profileBindings": [], "outputBindings": {}},
        "displayName": "fn-1",
    },
}

_COUNTER_WORKFLOW: dict[str, Any] = {
    "nodes": [_COUNTER_NODE],
    "edges": [{"source": "start-node", "target": "fn-1"}],
}


def _seed_drilled_environment() -> str:
    from wavecore.api.services.environments import service as environment_service

    environment = {
        "id": _DRILLED_ENVIRONMENT_ID,
        "name": "Current Edit Environment",
        "tags": [],
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }
    environment_service._save_environment(environment)
    environment_service._environments.setdefault(_DRILLED_ENVIRONMENT_ID, environment)
    return _DRILLED_ENVIRONMENT_ID


class TestCurrentEditAfterADrilledInRun:
    """A real Run Scope session: the Test scope and the Function's scope each take their own."""

    @pytest.fixture
    def live_client(self) -> Generator[TestClient, None, None]:
        from wavecore.api.app import app

        with TestClient(app) as test_client:
            yield test_client

    @pytest.fixture
    def session(self, live_client: TestClient) -> dict[str, Any]:
        created = live_client.post(
            "/tests",
            json={
                "id": str(uuid.uuid4()),
                "name": "Current Edit Container",
                "version": "1.0.0",
                "description": "",
                "tags": [],
                "variables": {"limit": {"type": "integer", "value": 3}},
                "workflow": _COUNTER_WORKFLOW,
            },
        )
        assert created.status_code in (200, 201), created.text
        started = live_client.post(
            "/workbench/run",
            json={
                "test_id": created.json()["data"]["id"],
                "environment_id": _seed_drilled_environment(),
                "scope_mode": "function",
                "scoped_function_node_id": "fn-1",
                "workflow": _COUNTER_WORKFLOW,
            },
        )
        assert started.status_code == 200, started.text
        session_id = started.json()["data"]["session_id"]
        task = _wb_common._active_tasks.get(session_id)
        if task is not None and not task.done():
            live_client.portal.call(lambda: asyncio.wait_for(task, timeout=10.0))
        session = _wb_common._workbench_sessions[session_id]
        assert session["status"] == "passed", session.get("error")
        assert _scope(session, "fn-1")["count"] == 1
        return session

    def test_a_declared_test_variable_takes_its_edit_in_the_test_scope(
        self, live_client: TestClient, session: dict[str, Any]
    ) -> None:
        response = live_client.patch(
            f"/workbench/{session['session_id']}/variables/limit",
            json={"value": "4", "type": "integer"},
        )

        assert response.status_code == 200, response.text
        assert session["variables"]["limit"] == 4
        assert "limit" not in _scope(session, "fn-1")

    def test_the_functions_local_takes_its_edit_in_the_instance_scope(
        self, live_client: TestClient, session: dict[str, Any]
    ) -> None:
        response = live_client.patch(
            f"/workbench/{session['session_id']}/variables/count",
            json={"value": "7", "type": "integer", "function_path": ["fn-1"]},
        )

        assert response.status_code == 200, response.text
        assert _scope(session, "fn-1")["count"] == 7
        assert "count" not in session["variables"]

    def test_a_test_variable_is_not_declared_by_the_function(
        self, live_client: TestClient, session: dict[str, Any]
    ) -> None:
        response = live_client.patch(
            f"/workbench/{session['session_id']}/variables/limit",
            json={"value": "4", "type": "integer", "function_path": ["fn-1"]},
        )

        assert response.status_code == 400
        assert response.json()["error"]["message"] == (
            "Variable 'limit' is not declared by this Function"
        )
        assert "limit" not in _scope(session, "fn-1")
        assert "limit" not in session["variables"]


def _local_function_node(node_id: str, **body: Any) -> dict[str, Any]:
    """A Local Function Block whose definition declares ``body`` (inputs, outputs, variables)."""
    definition = {"name": node_id, "inputs": [], "outputs": [], "variables": [], **body}
    definition.setdefault("workflow", {"nodes": [], "edges": []})
    return {
        "id": node_id,
        "type": "workflowNode",
        "data": {
            "nodeType": "function",
            "functionLifecycle": "local",
            "localDefinition": definition,
        },
    }


def _seed_unstarted_session(session_id: str, **session_fields: Any) -> dict[str, Any]:
    """A paused run whose body holds Function fn-1 (local 'n', secret local 'tok', input 'who')
    and has not started it yet."""
    inner = _local_function_node("fn-2", variables=[{"name": "k", "type": "integer", "value": 0}])
    function = _local_function_node(
        "fn-1",
        inputs=[{"name": "who", "type": "string"}],
        variables=[
            {"name": "n", "type": "integer", "value": 1},
            {"name": "tok", "type": "string", "value": "abc", "secret": True},
        ],
        workflow={"nodes": [inner], "edges": []},
    )
    session = _seed_session(
        session_id,
        variables=LazyVariables({"x": 1}),
        variable_types={"x": "integer"},
        function_scopes={},
        function_scope_types={},
    )
    session["run_body"] = {"nodes": [function], "edges": []}
    session["function_seed"] = {}
    session.update(session_fields)
    return session


class TestSetVariableOverrideUnstartedFunction:
    """A Current edit of a Function the run has not started waits for its start (REQ-3.2.1.6)."""

    def test_a_literal_is_held_for_the_instance_start(self, pushes: list[PushRecord]) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_unstarted_session(session_id)

        result = workbench_service.set_variable_override(
            session_id,
            "n",
            value="5",
            value_given=True,
            declared_type="integer",
            function_path=("fn-1",),
        )

        assert result == {"name": "n", "value": 5, "pending": False}
        assert session["function_seed"] == {("fn-1",): {"n": {"type": "integer", "value": "5"}}}
        assert staged_values(session_id, ("fn-1",)) == {"n": {"type": "integer", "value": "5"}}
        assert pushes == []
        assert session["variables"]["x"] == 1

    def test_a_nested_instance_is_reached_through_its_parent(
        self, pushes: list[PushRecord]
    ) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_unstarted_session(session_id)

        workbench_service.set_variable_override(
            session_id,
            "k",
            value=None,
            value_given=True,
            declared_type="integer",
            function_path=("fn-1", "fn-2"),
        )

        assert session["function_seed"] == {
            ("fn-1", "fn-2"): {"k": {"type": "integer", "value": None}}
        }

    def test_a_list_keeps_its_element_types(self, pushes: list[PushRecord]) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_unstarted_session(session_id)
        session["run_body"]["nodes"][0]["data"]["localDefinition"]["variables"].append(
            {"name": "items", "type": "array", "value": []}
        )

        workbench_service.set_variable_override(
            session_id,
            "items",
            value=["1", "a"],
            value_given=True,
            declared_type="array",
            element_types=["integer", "string"],
            function_path=("fn-1",),
        )

        assert session["function_seed"][("fn-1",)]["items"] == {
            "type": "array",
            "value": ["1", "a"],
            "elementTypes": ["integer", "string"],
        }

    @pytest.mark.parametrize(
        ("source", "entry"),
        [
            pytest.param(
                {"expression": "who.upper()"},
                {"type": "string", "value": "who.upper()", "isExpression": True},
                id="expression",
            ),
            pytest.param(
                {"template": "Hi {{who}}"},
                {"type": "string", "value": "Hi {{who}}", "isTemplate": True},
                id="template",
            ),
        ],
    )
    def test_a_source_is_held_for_the_instance_start(
        self, source: dict[str, str], entry: dict[str, Any], pushes: list[PushRecord]
    ) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_unstarted_session(session_id)

        result = workbench_service.set_variable_override(
            session_id, "who", declared_type="string", function_path=("fn-1",), **source
        )

        assert result == {"name": "who", "value": None, "pending": True}
        assert session["function_seed"] == {("fn-1",): {"who": entry}}

    def test_a_secret_is_held_masked_and_registered(self, pushes: list[PushRecord]) -> None:
        from wavecore.core.secrets.registry import SecretRegistry

        session_id = str(uuid.uuid4())
        registry = SecretRegistry()
        session = _seed_unstarted_session(session_id, secret_registry=registry)

        result = workbench_service.set_variable_override(
            session_id,
            "tok",
            value="s3cr3t-v4lue",
            value_given=True,
            declared_type="string",
            function_path=("fn-1",),
        )

        assert result == {"name": "tok", "value": "********", "pending": False}
        assert session["function_seed"][("fn-1",)]["tok"] == {
            "type": "string",
            "value": "s3cr3t-v4lue",
            "secret": True,
        }
        assert registry.is_secret_name("tok") is True
        assert "s3cr3t-v4lue" in registry.scan_values()

    def test_a_name_the_function_does_not_declare_is_refused(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_unstarted_session(session_id)

        with pytest.raises(
            ValidationException, match=r"^Variable 'x' is not declared by this Function$"
        ):
            workbench_service.set_variable_override(
                session_id,
                "x",
                value="5",
                value_given=True,
                declared_type="integer",
                function_path=("fn-1",),
            )
        assert session["function_seed"] == {}

    def test_another_type_than_the_declared_one_is_refused(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_unstarted_session(session_id)

        with pytest.raises(
            ValidationException,
            match=r"^Type mismatch for variable 'n': expected 'integer', got 'string'$",
        ):
            workbench_service.set_variable_override(
                session_id,
                "n",
                value="5",
                value_given=True,
                declared_type="string",
                function_path=("fn-1",),
            )

    def test_a_literal_that_is_not_the_declared_type_is_unprocessable(self) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_unstarted_session(session_id)

        with pytest.raises(
            UnprocessableEntityException, match=r"^Value for variable 'n' is not a valid integer$"
        ):
            workbench_service.set_variable_override(
                session_id,
                "n",
                value="abc",
                value_given=True,
                declared_type="integer",
                function_path=("fn-1",),
            )
        assert session["function_seed"] == {}

    def test_an_instance_this_run_started_takes_the_value_live(
        self, pushes: list[PushRecord]
    ) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_unstarted_session(
            session_id,
            function_scopes={("fn-1",): LazyVariables({"n": 1})},
            function_scope_types={("fn-1",): {"n": "integer"}},
            started_scopes={("fn-1",)},
        )

        workbench_service.set_variable_override(
            session_id,
            "n",
            value="5",
            value_given=True,
            declared_type="integer",
            function_path=("fn-1",),
        )

        assert _scope(session, "fn-1")["n"] == 5
        assert session["function_seed"] == {}
        assert pushes == [(session_id, "n", 5, ("fn-1",))]

    def test_a_path_the_run_body_does_not_hold_is_not_found(self) -> None:
        session_id = str(uuid.uuid4())
        _seed_unstarted_session(session_id)

        with pytest.raises(
            LookupError, match=f"^{re.escape(_scope_not_found('fn-9', session_id))}$"
        ):
            workbench_service.set_variable_override(
                session_id,
                "n",
                value="5",
                value_given=True,
                declared_type="integer",
                function_path=("fn-9",),
            )

    def test_a_library_view_run_reaches_an_inner_instance_under_its_root(
        self, pushes: list[PushRecord]
    ) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_unstarted_session(session_id)
        root = session["run_body"]["nodes"][0]
        session["run_body"] = {"nodes": [root], "edges": []}
        session["root_path"] = ("fn-1",)
        session["function_scopes"] = {("fn-1",): LazyVariables({"n": 1})}

        workbench_service.set_variable_override(
            session_id,
            "k",
            value="3",
            value_given=True,
            declared_type="integer",
            function_path=("fn-2",),
        )

        assert session["function_seed"] == {
            ("fn-1", "fn-2"): {"k": {"type": "integer", "value": "3"}}
        }

    def test_a_scope_an_earlier_run_left_takes_the_value_and_so_does_the_next_start(
        self, pushes: list[PushRecord]
    ) -> None:
        session_id = str(uuid.uuid4())
        session = _seed_unstarted_session(
            session_id,
            function_scopes={("fn-1",): LazyVariables({"n": 1})},
            function_scope_types={("fn-1",): {"n": "integer"}},
        )

        result = workbench_service.set_variable_override(
            session_id,
            "n",
            value="5",
            value_given=True,
            declared_type="integer",
            function_path=("fn-1",),
        )

        assert result == {"name": "n", "value": 5, "pending": False}
        assert _scope(session, "fn-1")["n"] == 5
        assert session["function_seed"] == {("fn-1",): {"n": {"type": "integer", "value": "5"}}}
        assert pushes == [(session_id, "n", 5, ("fn-1",))]


_BODY = {
    "nodes": [
        _local_function_node(
            "fn-1",
            variables=[
                {"name": "n", "type": "integer", "value": 1},
                {"name": "tok", "type": "string", "value": "abc", "secret": True},
            ],
        )
    ],
    "edges": [],
}


class TestTheSeedARunStartsWith:
    """A run starts from the values staged for it, over the values an ad-hoc run carries for
    instances the session it starts from never started (REQ-3.2.1.6)."""

    def test_only_the_values_of_an_instance_never_started_are_carried(self) -> None:
        previous = {
            "started_scopes": {("fn-1",)},
            "function_scopes": {("fn-1",): LazyVariables({"n": 1}), ("fn-3",): LazyVariables()},
            "function_seed": {
                ("fn-1",): {"n": {"type": "integer", "value": 5}},
                ("fn-3",): {"m": {"type": "integer", "value": 7}},
            },
        }

        assert workbench_service._unstarted_seed(previous) == {
            ("fn-3",): {"m": {"type": "integer", "value": 7}}
        }

    def test_a_full_run_carries_nothing(self) -> None:
        assert workbench_service._unstarted_seed(None) == {}

    def test_a_staged_value_wins_over_the_carried_one(self) -> None:
        carried = {("fn-1",): {"n": {"type": "integer", "value": 7}}}
        staged = {("fn-1",): {"n": {"type": "integer", "value": 9}}}

        seed = workbench_service._run_seed(_BODY, staged, carried, "test-1")

        assert seed == {("fn-1",): {"n": {"type": "integer", "value": 9}}}

    def test_a_carried_value_reads_its_secrecy_again(self) -> None:
        carried = {
            ("fn-1",): {
                "tok": {"type": "string", "value": "s3cr3t"},
                "n": {"type": "integer", "value": 7, "secret": True},
            }
        }

        seed = workbench_service._run_seed(_BODY, {}, carried, "test-1")

        assert seed == {
            ("fn-1",): {
                "tok": {"type": "string", "value": "s3cr3t", "secret": True},
                "n": {"type": "integer", "value": 7},
            }
        }

    def test_a_carried_value_whose_declaration_changed_or_left_is_dropped(self) -> None:
        carried = {
            ("fn-1",): {
                "n": {"type": "string", "value": "seven"},
                "gone": {"type": "integer", "value": 1},
            },
            ("fn-9",): {"m": {"type": "integer", "value": 7}},
        }

        assert workbench_service._run_seed(_BODY, {}, carried, "test-1") == {}
