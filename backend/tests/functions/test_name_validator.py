"""Backend tests for the Function name validator.

Contract (FN-LC-1): any printable keyboard character (letters, digits, spaces,
common punctuation), capped at 32 chars; uniqueness case-insensitive.

These tests assert the contract against the public `/functions` API surface
(`create_function`), so `_storage._validate_name` and the duplicate-name check
are exercised end-to-end.

Error messages are asserted with anchored regex.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from .conftest import make_function_payload

# Anchored regex helpers for the exact error strings.
NAME_REQUIRED_RE = re.compile(r"^Function name is required$")
NAME_TOO_LONG_RE = re.compile(r"^Function name '.+' exceeds 32 characters$")
NAME_DUPLICATE_RE = re.compile(r"^Function name '.+' is already in use$")


def _all_error_messages(body: dict) -> list[str]:
    """Collect every error string surfaced by the response."""
    err = body["error"]
    messages: list[str] = []
    if "message" in err and err["message"]:
        messages.append(err["message"])
    details = err.get("details") or []
    if isinstance(details, list):
        for item in details:
            if isinstance(item, str):
                messages.append(item)
            elif isinstance(item, dict) and "message" in item:
                messages.append(item["message"])
    return messages


# ---------------------------------------------------------------------------
# Empty / whitespace-only names are rejected
# ---------------------------------------------------------------------------


class TestNameRequired:
    def test_empty_name_returns_400(self, client: TestClient) -> None:
        payload = make_function_payload()
        payload["name"] = ""
        response = client.post("/functions", json=payload)
        assert response.status_code == 400
        assert any(NAME_REQUIRED_RE.match(m) for m in _all_error_messages(response.json()))

    def test_whitespace_only_name_returns_400(self, client: TestClient) -> None:
        payload = make_function_payload()
        payload["name"] = "   "
        response = client.post("/functions", json=payload)
        assert response.status_code == 400
        assert any(NAME_REQUIRED_RE.match(m) for m in _all_error_messages(response.json()))

    def test_tab_only_name_returns_400(self, client: TestClient) -> None:
        payload = make_function_payload()
        payload["name"] = "\t\t"
        response = client.post("/functions", json=payload)
        assert response.status_code == 400
        assert any(NAME_REQUIRED_RE.match(m) for m in _all_error_messages(response.json()))


# ---------------------------------------------------------------------------
# Any printable keyboard character is accepted
# ---------------------------------------------------------------------------


class TestRelaxedNameCharacters:
    @pytest.mark.parametrize(
        "good_name",
        [
            "Simple",
            "with space",
            "mixed CASE name",
            "name_with_under",
            "name-with-hyphen",
            "name.with.dots",
            "name (with parens)",
            "name [with brackets]",
            "name + symbol",
            "name & symbol",
            "name #1",
            "Login as 'admin'",
            "100% test",
            "a",  # one-char short name
            "X" * 32,  # exactly the cap
        ],
    )
    def test_relaxed_names_are_accepted(self, client: TestClient, good_name: str) -> None:
        payload = make_function_payload(name=good_name)
        response = client.post("/functions", json=payload)
        assert response.status_code == 201, response.text

    def test_name_starting_with_digit_is_accepted(self, client: TestClient) -> None:
        """Digits at the start of a name are fine."""
        payload = make_function_payload(name="1st function")
        response = client.post("/functions", json=payload)
        assert response.status_code == 201, response.text

    def test_name_with_only_digits_is_accepted(self, client: TestClient) -> None:
        payload = make_function_payload(name="42")
        response = client.post("/functions", json=payload)
        assert response.status_code == 201, response.text


# ---------------------------------------------------------------------------
# 32-char length cap
# ---------------------------------------------------------------------------


class TestNameLengthCap:
    def test_name_exceeding_32_chars_returns_400(self, client: TestClient) -> None:
        too_long = "X" * 33
        payload = make_function_payload(name=too_long)
        response = client.post("/functions", json=payload)
        assert response.status_code == 400
        assert any(NAME_TOO_LONG_RE.match(m) for m in _all_error_messages(response.json()))

    def test_name_far_exceeding_32_chars_returns_400(self, client: TestClient) -> None:
        too_long = "Y" * 200
        payload = make_function_payload(name=too_long)
        response = client.post("/functions", json=payload)
        assert response.status_code == 400
        assert any(NAME_TOO_LONG_RE.match(m) for m in _all_error_messages(response.json()))

    def test_name_exactly_32_chars_is_accepted(self, client: TestClient) -> None:
        exact = "Z" * 32
        payload = make_function_payload(name=exact)
        response = client.post("/functions", json=payload)
        assert response.status_code == 201, response.text


# ---------------------------------------------------------------------------
# Case-insensitive uniqueness
# ---------------------------------------------------------------------------


class TestCaseInsensitiveUniqueness:
    def test_same_case_duplicate_is_rejected(self, client: TestClient) -> None:
        client.post("/functions", json=make_function_payload(name="My Function"))
        response = client.post("/functions", json=make_function_payload(name="My Function"))
        assert response.status_code == 400
        assert any(NAME_DUPLICATE_RE.match(m) for m in _all_error_messages(response.json()))

    def test_uppercase_duplicate_is_rejected(self, client: TestClient) -> None:
        client.post("/functions", json=make_function_payload(name="my function"))
        response = client.post("/functions", json=make_function_payload(name="MY FUNCTION"))
        assert response.status_code == 400
        assert any(NAME_DUPLICATE_RE.match(m) for m in _all_error_messages(response.json()))

    def test_mixed_case_duplicate_is_rejected(self, client: TestClient) -> None:
        client.post("/functions", json=make_function_payload(name="Hello World"))
        response = client.post("/functions", json=make_function_payload(name="HELLO world"))
        assert response.status_code == 400
        assert any(NAME_DUPLICATE_RE.match(m) for m in _all_error_messages(response.json()))

    def test_distinct_names_succeed(self, client: TestClient) -> None:
        a = client.post("/functions", json=make_function_payload(name="alpha"))
        b = client.post("/functions", json=make_function_payload(name="beta"))
        assert a.status_code == 201
        assert b.status_code == 201


# ---------------------------------------------------------------------------
# Duplicate rejection answers from the summary scan alone
# ---------------------------------------------------------------------------


class TestDuplicateRejectionReadsSummariesOnly:
    """The uniqueness answer never depends on any Function definition body."""

    def _seed(self, client: TestClient, prefix: str, count: int = 3) -> list[str]:
        ids: list[str] = []
        for i in range(count):
            created = client.post("/functions", json=make_function_payload(name=f"{prefix}_{i}"))
            assert created.status_code == 201, created.text
            ids.append(created.json()["data"]["id"])
        return ids

    def test_rejection_loads_no_definitions(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.services.functions import _storage

        self._seed(client, "quiet")
        loaded: list[str] = []
        real_load_function = _storage.load_function

        def _counting_load(function_id: str) -> tuple[dict[str, Any], str]:
            loaded.append(function_id)
            return real_load_function(function_id)

        monkeypatch.setattr(_storage, "load_function", _counting_load)
        response = client.post("/functions", json=make_function_payload(name="QUIET_1"))

        assert response.status_code == 400
        assert any(NAME_DUPLICATE_RE.match(m) for m in _all_error_messages(response.json()))
        assert loaded == []

    def test_rejection_survives_an_unreadable_library_entry(
        self, client: TestClient, temp_storage_path: Path
    ) -> None:
        self._seed(client, "damaged")
        victim = client.post("/functions", json=make_function_payload(name="damaged_victim"))
        assert victim.status_code == 201, victim.text
        versions_dir = temp_storage_path / "functions" / victim.json()["data"]["id"] / "versions"
        for version_file in versions_dir.iterdir():
            version_file.unlink()

        response = client.post("/functions", json=make_function_payload(name="DAMAGED_1"))

        assert response.status_code == 400
        assert any(NAME_DUPLICATE_RE.match(m) for m in _all_error_messages(response.json()))

    def test_success_path_still_scans_the_library_once(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from wavecore.api.services.functions import _storage

        self._seed(client, "onescan")
        scans: list[int] = []
        real_summaries = _storage.list_function_summaries

        def _counting_summaries() -> list[dict[str, Any]]:
            scans.append(1)
            return real_summaries()

        monkeypatch.setattr(_storage, "list_function_summaries", _counting_summaries)
        response = client.post("/functions", json=make_function_payload(name="onescan_fresh"))

        assert response.status_code == 201, response.text
        assert len(scans) == 1


pytestmark = pytest.mark.usefixtures("temp_storage_path")
