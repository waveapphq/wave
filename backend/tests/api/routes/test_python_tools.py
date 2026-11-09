"""The python-tools completion and rename endpoints (REQ-3.4.2.2, PYRUN-19).

Both endpoints introspect a script and never run it:

    POST /python-tools/complete -> {"items": [{label, kind, signature, doc}]}
    POST /python-tools/rename   -> {"edits": [{from_line, from_column, to_line, to_column, text}]}
    POST /python-tools/check    -> {"issues": [{line, column, message}]}

Lines are 1-based and columns 0-based in the request and in the answer alike.
An interpreter that is an existing executable file path is introspected; any
other row (empty, a command line, an unresolved expression, a path that is not
a file) falls back to WAVE's own interpreter.
"""

import re
import sys
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from httpx import Response

from wavecore.api.services.python_tools import service as python_tools_service

COMPLETE_PATH = "/python-tools/complete"
RENAME_PATH = "/python-tools/rename"
CHECK_PATH = "/python-tools/check"
ENDPOINTS = [COMPLETE_PATH, RENAME_PATH]

KINDS = {"variable", "function", "class", "module", "member", "keyword"}
ITEM_KEYS = {"label", "kind", "signature", "doc"}
EDIT_KEYS = {"from_line", "from_column", "to_line", "to_column", "text"}
ISSUE_KEYS = {"line", "column", "message"}

MEMBER_SCRIPT = "import os\nos."
PREFIX_SCRIPT = "import os\nos.g"
TWO_MODULE_SCRIPT = "import os\nimport json\nos.getcwd\njson.dumps\n"
BUILTIN_SCRIPT = "memo"
SHORT_SCRIPT = "value = 1\n"
COMMENT_SCRIPT = "# just a comment\nvalue = 1\n"
OVERSIZED_SCRIPT = "value = 1\n" * 30000
UNCLOSED_SCRIPT = "value = (1\n"
MISSING_COLON_SCRIPT = "value = 1\nif True\n    pass\n"
NULL_BYTE_SCRIPT = "value = 1\x00\n"
EXITING_SCRIPT = "raise SystemExit(3)\n"

SCOPE_SCRIPT = (
    "def totals():\n"
    "    count = 1\n"
    "    count += 1\n"
    "    return count\n"
    "\n"
    "\n"
    "def others():\n"
    "    count = 99\n"
    "    return count\n"
)

FALLBACK_INTERPRETERS = ["", "   ", "uv run --project /opt/lab-env", "{{py}}", "/no/such/python3"]


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


@pytest.fixture
def foreign_interpreter(tmp_path: Path) -> str:
    """A second path to WAVE's own interpreter, so an honored row is never sys.executable."""
    link = tmp_path / "python3"
    link.symlink_to(sys.executable)
    return str(link)


def body_for(
    path: str, script: str, line: int, column: int, interpreter: str = ""
) -> dict[str, Any]:
    """The request body of either endpoint at one position."""
    body: dict[str, Any] = {
        "script": script,
        "line": line,
        "column": column,
        "interpreter": interpreter,
    }
    if path == RENAME_PATH:
        body["new_name"] = "renamed"
    return body


def post_complete(
    client: TestClient, script: str, line: int, column: int, interpreter: str = ""
) -> Response:
    """Ask for completions at one position."""
    body = body_for(COMPLETE_PATH, script, line, column, interpreter)
    return client.post(COMPLETE_PATH, json=body)


def post_rename(
    client: TestClient, script: str, line: int, column: int, new_name: str, interpreter: str = ""
) -> Response:
    """Ask for the edits that rename the symbol at one position."""
    body = body_for(RENAME_PATH, script, line, column, interpreter)
    body["new_name"] = new_name
    return client.post(RENAME_PATH, json=body)


def items_of(response: Response) -> list[dict[str, Any]]:
    """The completion items of a 200 answer."""
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["success"] is True
    assert set(body["data"]) == {"items"}
    result: list[dict[str, Any]] = body["data"]["items"]
    return result


def edits_of(response: Response) -> list[dict[str, Any]]:
    """The rename edits of a 200 answer."""
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["success"] is True
    assert set(body["data"]) == {"edits"}
    result: list[dict[str, Any]] = body["data"]["edits"]
    return result


def issues_of(response: Response) -> list[dict[str, Any]]:
    """The syntax issues of a 200 answer."""
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["success"] is True
    assert set(body["data"]) == {"issues"}
    result: list[dict[str, Any]] = body["data"]["issues"]
    return result


def labels_of(response: Response) -> list[str]:
    """Completion labels in the order the server returned them."""
    return [str(item["label"]) for item in items_of(response)]


def item_named(response: Response, label: str) -> dict[str, Any]:
    """The one completion item carrying that label."""
    matches = [item for item in items_of(response) if item["label"] == label]
    assert len(matches) == 1, f"expected exactly one {label!r} item, got {labels_of(response)}"
    return matches[0]


def executable_of(environment: Any) -> str:
    """PYRUN-19 pin: the resolved environment names the interpreter jedi introspects."""
    executable = getattr(environment, "executable", None)
    assert isinstance(executable, str), f"no executable path on {environment!r}"
    return executable


def assert_error(response: Response, *, status_code: int, code: str, message: str) -> None:
    """Assert the WAVE error envelope with an anchored, escaped message match."""
    assert response.status_code == status_code, response.text
    body = response.json()
    assert body["error"]["code"] == code
    assert re.match(rf"^{re.escape(message)}$", body["error"]["message"]) is not None


def assert_validation_error(response: Response, message: str) -> None:
    """Assert a 400 carrying one exact message."""
    assert_error(response, status_code=400, code="VALIDATION_ERROR", message=message)


class TestCompletionItems:
    """Members, builtins and the shape of every item."""

    def test_members_after_a_dot_carry_a_signature_and_a_doc(self, client: TestClient) -> None:
        response = post_complete(client, MEMBER_SCRIPT, 2, 3)

        item = item_named(response, "getcwd")
        assert item["kind"] == "function"
        assert "getcwd(" in item["signature"]
        assert item["doc"]

    def test_every_item_carries_the_full_shape(self, client: TestClient) -> None:
        items = items_of(post_complete(client, MEMBER_SCRIPT, 2, 3))

        assert items
        for item in items:
            assert set(item) == ITEM_KEYS
            assert isinstance(item["label"], str) and item["label"]
            assert item["kind"] in KINDS
            assert item["signature"] is None or isinstance(item["signature"], str)
            assert item["doc"] is None or isinstance(item["doc"], str)

    def test_a_builtin_with_no_catalog_entry_still_comes_back_with_a_doc(
        self, client: TestClient
    ) -> None:
        response = post_complete(client, BUILTIN_SCRIPT, 1, 4)

        item = item_named(response, "memoryview")
        assert item["kind"] in KINDS
        assert item["doc"]


class TestCompletionPosition:
    """Line is 1-based and column 0-based on the way in."""

    @pytest.mark.parametrize(
        ("line", "column", "expected", "absent"),
        [
            (3, 3, "getcwd", "dumps"),
            (4, 5, "dumps", "getcwd"),
        ],
    )
    def test_the_line_number_is_1_based(
        self, client: TestClient, line: int, column: int, expected: str, absent: str
    ) -> None:
        labels = labels_of(post_complete(client, TWO_MODULE_SCRIPT, line, column))

        assert expected in labels
        assert absent not in labels

    def test_the_column_number_is_0_based(self, client: TestClient) -> None:
        labels = labels_of(post_complete(client, PREFIX_SCRIPT, 2, 4))

        assert "getcwd" in labels
        assert [label for label in labels if label[:1].lower() != "g"] == []


class TestCompletionInterpreter:
    """PYRUN-19: an executable path is introspected, anything else falls back."""

    def test_an_existing_executable_path_is_used(
        self, client: TestClient, foreign_interpreter: str
    ) -> None:
        response = post_complete(client, MEMBER_SCRIPT, 2, 3, foreign_interpreter)

        item = item_named(response, "getcwd")
        assert "getcwd(" in item["signature"]
        assert item["doc"]

    def test_the_interpreter_row_is_what_gets_resolved(
        self, client: TestClient, foreign_interpreter: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        resolve = python_tools_service.resolve_environment
        asked: list[str] = []

        def record(interpreter: str) -> Any:
            asked.append(interpreter)
            return resolve(interpreter)

        monkeypatch.setattr(python_tools_service, "resolve_environment", record)

        labels = labels_of(post_complete(client, MEMBER_SCRIPT, 2, 3, foreign_interpreter))

        assert set(asked) == {foreign_interpreter}
        assert "getcwd" in labels

    @pytest.mark.parametrize("interpreter", FALLBACK_INTERPRETERS)
    def test_an_interpreter_that_is_not_a_file_returns_waves_own_items(
        self, client: TestClient, interpreter: str
    ) -> None:
        own = labels_of(post_complete(client, MEMBER_SCRIPT, 2, 3, sys.executable))

        assert labels_of(post_complete(client, MEMBER_SCRIPT, 2, 3, interpreter)) == own

    def test_resolve_environment_honors_an_existing_executable_path(
        self, foreign_interpreter: str
    ) -> None:
        environment = python_tools_service.resolve_environment(foreign_interpreter)

        assert executable_of(environment) == foreign_interpreter
        assert executable_of(environment) != sys.executable

    @pytest.mark.parametrize("interpreter", FALLBACK_INTERPRETERS)
    def test_resolve_environment_falls_back_for_anything_else(
        self, interpreter: str, foreign_interpreter: str
    ) -> None:
        fallback = python_tools_service.resolve_environment(interpreter)
        honored = python_tools_service.resolve_environment(foreign_interpreter)

        assert executable_of(fallback) == sys.executable
        assert executable_of(fallback) != executable_of(honored)


class TestCompletionFailure:
    """A failed introspection degrades to the catalog, it never 500s."""

    def test_a_failure_answers_200_with_no_items(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def boom(interpreter: str) -> Any:
            raise RuntimeError("introspection is unavailable")

        monkeypatch.setattr(python_tools_service, "resolve_environment", boom)

        response = post_complete(client, MEMBER_SCRIPT, 2, 3)

        assert response.status_code == 200, response.text
        assert response.json() == {"success": True, "data": {"items": []}}


class TestScriptLimits:
    """The size cap and the line range, on both endpoints."""

    @pytest.mark.parametrize("path", ENDPOINTS)
    def test_a_script_over_the_cap_is_refused(self, client: TestClient, path: str) -> None:
        response = client.post(path, json=body_for(path, OVERSIZED_SCRIPT, 1, 0))

        assert_validation_error(response, "Script exceeds 200 KB")

    @pytest.mark.parametrize("path", ENDPOINTS)
    @pytest.mark.parametrize("line", [99, 0, -1])
    def test_a_line_outside_the_script_is_refused(
        self, client: TestClient, path: str, line: int
    ) -> None:
        response = client.post(path, json=body_for(path, SHORT_SCRIPT, line, 0))

        assert_validation_error(response, f"Line {line} is outside the script")


class TestRename:
    """Scope-aware rename and its two refusals."""

    def test_renaming_a_local_edits_every_use_in_its_scope(self, client: TestClient) -> None:
        edits = edits_of(post_rename(client, SCOPE_SCRIPT, 2, 4, "total"))

        assert edits == [
            {"from_line": 2, "from_column": 4, "to_line": 2, "to_column": 9, "text": "total"},
            {"from_line": 3, "from_column": 4, "to_line": 3, "to_column": 9, "text": "total"},
            {"from_line": 4, "from_column": 11, "to_line": 4, "to_column": 16, "text": "total"},
        ]

    def test_the_edits_are_sorted_by_position_and_never_overlap(self, client: TestClient) -> None:
        edits = edits_of(post_rename(client, SCOPE_SCRIPT, 2, 4, "total"))

        assert len(edits) > 1
        for edit in edits:
            assert set(edit) == EDIT_KEYS
        starts = [(edit["from_line"], edit["from_column"]) for edit in edits]
        assert starts == sorted(starts)
        for index in range(1, len(edits)):
            previous = edits[index - 1]
            current = edits[index]
            assert (previous["to_line"], previous["to_column"]) <= (
                current["from_line"],
                current["from_column"],
            )

    def test_a_name_of_the_same_spelling_in_another_scope_is_left_alone(
        self, client: TestClient
    ) -> None:
        edits = edits_of(post_rename(client, SCOPE_SCRIPT, 8, 4, "total"))

        assert [edit["from_line"] for edit in edits] == [8, 9]

    def test_no_symbol_at_the_cursor_is_refused(self, client: TestClient) -> None:
        response = post_rename(client, COMMENT_SCRIPT, 1, 5, "total")

        assert_validation_error(response, "Cannot rename: no symbol at the cursor")

    @pytest.mark.parametrize("new_name", ["1bad", "class", "__1-bad"])
    def test_an_invalid_new_name_is_refused(self, client: TestClient, new_name: str) -> None:
        response = post_rename(client, SCOPE_SCRIPT, 2, 4, new_name)

        assert_validation_error(response, f"Invalid variable name: '{new_name}'")

    @pytest.mark.parametrize("new_name", ["__secret", "__"])
    def test_a_new_name_with_a_double_underscore_is_refused(
        self, client: TestClient, new_name: str
    ) -> None:
        response = post_rename(client, SCOPE_SCRIPT, 2, 4, new_name)

        assert_validation_error(response, f"Variable names may not start with __: '{new_name}'")


class TestSyntaxCheck:
    """The script is parsed in WAVE's own interpreter and never run."""

    def test_a_clean_script_has_no_issues(self, client: TestClient) -> None:
        response = client.post(CHECK_PATH, json={"script": SHORT_SCRIPT})

        assert response.status_code == 200, response.text
        assert response.json() == {"success": True, "data": {"issues": []}}

    def test_an_unclosed_bracket_carries_the_interpreter_wording(self, client: TestClient) -> None:
        issues = issues_of(client.post(CHECK_PATH, json={"script": UNCLOSED_SCRIPT}))

        assert issues == [{"line": 1, "column": 8, "message": "'(' was never closed"}]

    def test_the_line_is_1_based_and_the_column_0_based(self, client: TestClient) -> None:
        issues = issues_of(client.post(CHECK_PATH, json={"script": MISSING_COLON_SCRIPT}))

        assert issues == [{"line": 2, "column": 7, "message": "expected ':'"}]

    def test_every_issue_carries_the_full_shape(self, client: TestClient) -> None:
        issues = issues_of(client.post(CHECK_PATH, json={"script": UNCLOSED_SCRIPT}))

        assert issues
        for issue in issues:
            assert set(issue) == ISSUE_KEYS
            assert isinstance(issue["line"], int) and issue["line"] >= 1
            assert isinstance(issue["column"], int) and issue["column"] >= 0
            assert isinstance(issue["message"], str) and issue["message"]

    def test_an_error_with_no_position_lands_on_the_first_line(self, client: TestClient) -> None:
        issues = issues_of(client.post(CHECK_PATH, json={"script": NULL_BYTE_SCRIPT}))

        assert issues == [
            {"line": 1, "column": 0, "message": "source code string cannot contain null bytes"}
        ]

    def test_a_script_that_would_stop_the_server_is_only_parsed(self, client: TestClient) -> None:
        response = client.post(CHECK_PATH, json={"script": EXITING_SCRIPT})

        assert response.status_code == 200, response.text
        assert response.json() == {"success": True, "data": {"issues": []}}

    def test_a_script_over_the_cap_is_refused(self, client: TestClient) -> None:
        response = client.post(CHECK_PATH, json={"script": OVERSIZED_SCRIPT})

        assert_validation_error(response, "Script exceeds 200 KB")


class TestSharedEnvelope:
    """The endpoints answer through the shared route envelope, not a private copy."""

    def test_python_tools_has_no_private_envelope(self) -> None:
        from wavecore.api.routes import python_tools

        assert not hasattr(python_tools, "_envelope")

    def test_python_tools_answers_through_the_shared_envelope(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.routes import python_tools, shared

        assert python_tools.envelope is shared.envelope
        wrapped: list[dict[str, Any]] = []

        def recording(payload: dict[str, Any]) -> dict[str, Any]:
            wrapped.append(payload)
            return shared.envelope(payload)

        monkeypatch.setattr(python_tools, "envelope", recording)

        response = client.post(CHECK_PATH, json={"script": SHORT_SCRIPT})

        assert response.json() == {"success": True, "data": {"issues": []}}
        assert wrapped == [{"issues": []}]


class TestRouterRegistration:
    """The router is included in the app beside the workbench router."""

    def test_both_endpoints_are_registered(self) -> None:
        from wavecore.api.app import app

        paths = app.openapi()["paths"]

        assert COMPLETE_PATH in paths
        assert RENAME_PATH in paths
