"""Route-level tests for the new Function version endpoints (REQ-3.1.2.2).

Contract:

    GET /functions/{function_id}/versions
        200 with `{versions: [...], latest: str}`. 404 with anchored message
        `^Function '{function_id}' not found$`.

    GET /functions/{function_id}/versions/{version}
        200 with `{definition, etag}`. 404 with anchored message
        `^Function '{function_id}' not found$` OR
        `^Function '{function_id}' version '{version}' not found$`.

    GET /functions/{function_id}?version=X.Y.Z
        200 with the requested version's definition; 404 with the
        same anchored messages above.

    GET /functions (list)
        Each summary row carries `latest_version: str`.

The autouse `temp_storage_path` fixture redirects storage to a tmp dir.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient

# Anchored regex helpers for the error messages.
FUNCTION_NOT_FOUND_RE = re.compile(r"^Function '[0-9a-fA-F-]+' not found$")
VERSION_NOT_FOUND_RE = re.compile(r"^Function '[0-9a-fA-F-]+' version '[^']+' not found$")


@pytest.fixture(autouse=True)
def _register_core_plugins_and_controls() -> Generator[None, None, None]:
    try:
        from wavecore.controls.registry import _registry, register_all_core_controls
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins.log import LogPlugin
    except (ImportError, ModuleNotFoundError):
        yield
        return

    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    yield
    _registry.clear()
    clear_registry()


@pytest.fixture
def client() -> TestClient:
    from wavecore.api.app import app

    return TestClient(app)


def _all_error_messages(body: dict) -> list[str]:
    err = body.get("error") or {}
    messages: list[str] = []
    if err.get("message"):
        messages.append(err["message"])
    details = err.get("details") or []
    if isinstance(details, list):
        for item in details:
            if isinstance(item, str):
                messages.append(item)
            elif isinstance(item, dict) and "message" in item:
                messages.append(item["message"])
    return messages


def _seed_two_version_function(name: str = "greet") -> str:
    """Seed a function with two versions via the low-level storage layer.

    Returns the function id. Uses `save_new_version` directly so the test
    body is independent of the publish flow (which has its own test file).
    """
    from wavecore.api.services.functions._storage import save_new_version

    fn_id = str(uuid.uuid4())
    save_new_version(
        fn_id,
        "1.0.0",
        {
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
        },
        {
            "description": "v1 desc",
            "tags": ["v1"],
            "changelog": "initial",
            "details": "v1 details",
            "published_at": "2026-01-01T00:00:00Z",
            "published_by": "wave",
        },
        name=name,
    )
    save_new_version(
        fn_id,
        "2.0.0",
        {
            "inputs": [],
            "outputs": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": {"nodes": [], "edges": []},
        },
        {
            "description": "v2 desc",
            "tags": ["v2"],
            "changelog": "rewrite",
            "details": "v2 details",
            "published_at": "2026-03-01T00:00:00Z",
            "published_by": "wave",
        },
        name=name,
    )
    return fn_id


# ---------------------------------------------------------------------------
# GET /functions/{id}/versions
# ---------------------------------------------------------------------------


class TestListVersionsEndpoint:
    """`GET /functions/{id}/versions` returns the ordered version list + latest."""

    def test_returns_200_with_versions_and_latest(self, client: TestClient) -> None:
        fn_id = _seed_two_version_function()
        response = client.get(f"/functions/{fn_id}/versions")
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["success"] is True
        data = body["data"]
        assert data["latest"] == "2.0.0"
        versions = [entry["version"] for entry in data["versions"]]
        # Most-recent-first.
        assert versions == ["2.0.0", "1.0.0"]

    def test_version_entries_carry_metadata_fields(self, client: TestClient) -> None:
        fn_id = _seed_two_version_function()
        response = client.get(f"/functions/{fn_id}/versions")
        data = response.json()["data"]
        entry_v2 = next(e for e in data["versions"] if e["version"] == "2.0.0")
        # Response shape:
        # {version, published_at, changelog, details, description, tags}
        for key in ("version", "published_at", "changelog", "details", "description", "tags"):
            assert key in entry_v2, f"missing {key} in {entry_v2}"
        assert entry_v2["description"] == "v2 desc"
        assert entry_v2["tags"] == ["v2"]
        assert entry_v2["changelog"] == "rewrite"
        assert entry_v2["details"] == "v2 details"
        assert entry_v2["published_at"] == "2026-03-01T00:00:00Z"

    def test_unknown_function_returns_404(self, client: TestClient) -> None:
        ghost_id = str(uuid.uuid4())
        response = client.get(f"/functions/{ghost_id}/versions")
        assert response.status_code == 404
        messages = _all_error_messages(response.json())
        assert any(FUNCTION_NOT_FOUND_RE.match(m) for m in messages), messages
        assert any(m == f"Function '{ghost_id}' not found" for m in messages)


# ---------------------------------------------------------------------------
# GET /functions/{id}/versions/{version}
# ---------------------------------------------------------------------------


class TestGetSpecificVersionEndpoint:
    """`GET /functions/{id}/versions/{version}` returns the per-version payload."""

    def test_returns_200_for_known_version(self, client: TestClient) -> None:
        fn_id = _seed_two_version_function()
        response = client.get(f"/functions/{fn_id}/versions/1.0.0")
        assert response.status_code == 200, response.text
        body = response.json()
        data = body["data"]
        # {definition, etag}. Routes expose the etag via header too.
        assert "definition" in data
        # Definition for v1 carries v1's description per per-version metadata.
        assert data["definition"]["description"] == "v1 desc"
        assert response.headers.get("ETag")

    def test_returns_200_for_latest_version(self, client: TestClient) -> None:
        fn_id = _seed_two_version_function()
        response = client.get(f"/functions/{fn_id}/versions/2.0.0")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["definition"]["description"] == "v2 desc"

    def test_unknown_function_returns_404_with_function_message(self, client: TestClient) -> None:
        ghost_id = str(uuid.uuid4())
        response = client.get(f"/functions/{ghost_id}/versions/1.0.0")
        assert response.status_code == 404
        messages = _all_error_messages(response.json())
        assert any(m == f"Function '{ghost_id}' not found" for m in messages), messages

    def test_known_function_unknown_version_returns_404_with_version_message(
        self, client: TestClient
    ) -> None:
        fn_id = _seed_two_version_function()
        response = client.get(f"/functions/{fn_id}/versions/9.9.9")
        assert response.status_code == 404
        messages = _all_error_messages(response.json())
        expected = f"Function '{fn_id}' version '9.9.9' not found"
        assert any(m == expected for m in messages), messages
        assert any(VERSION_NOT_FOUND_RE.match(m) for m in messages)


# Every read of a Function definition: latest, a version by query, a version by path.
_READ_URLS = [
    pytest.param("/functions/{fn_id}", id="latest"),
    pytest.param("/functions/{fn_id}?version=1.0.0", id="version-query"),
    pytest.param("/functions/{fn_id}/versions/1.0.0", id="version-path"),
]


def _read_definition(response: Any) -> dict[str, Any]:
    data: dict[str, Any] = response.json()["data"]
    return data["definition"] if "etag" in data and "definition" in data else data


class _FnCredPlugin:
    """Stub plugin declaring a `password` credential param (the autouse fixture
    only registers LogPlugin, so the credential-reveal test registers this)."""

    @property
    def metadata(self) -> dict[str, Any]:
        return {
            "id": "stub-fn-cred",
            "version": "1.0.0",
            "parameters": [{"name": "password", "type": "string", "secret": True}],
        }


class TestGetVersionCredentialReveal:
    """A version GET returns the sealed plugin credential by default, and reveals
    its plaintext when the credential-inputs unmask is on (REQ-3.1.3.18)."""

    def _seed_credential_function(self) -> str:
        from wavecore.api.services.functions._storage import save_new_version
        from wavecore.core.plugin_registry import register_plugin
        from wavecore.core.secrets.sealing import seal_value

        register_plugin(_FnCredPlugin())  # additive; the autouse fixture clears after
        fn_id = str(uuid.uuid4())
        node = {
            "id": "c1",
            "type": "workflowNode",
            "data": {
                "elementType": "stub-fn-cred",
                "nodeType": "plugin",
                "version": "1.0.0",
                "config": {"values": {"password": seal_value("pw-classified"), "host": "h"}},
            },
        }
        save_new_version(
            fn_id,
            "1.0.0",
            {
                "inputs": [],
                "outputs": [],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {"nodes": [node], "edges": []},
            },
            {
                "description": "cred",
                "tags": [],
                "changelog": "c",
                "details": "",
                "published_at": "2026-01-01T00:00:00Z",
                "published_by": "wave",
            },
            name="cred-fn",
        )
        return fn_id

    @staticmethod
    def _password(response: Any) -> Any:
        definition = _read_definition(response)
        return definition["workflow"]["nodes"][0]["data"]["config"]["values"]["password"]

    @pytest.mark.parametrize("url", _READ_URLS)
    def test_masks_sealed_credential_when_flag_off(self, client: TestClient, url: str) -> None:
        from wavecore.core.secrets.cipher import is_secret_envelope

        fn_id = self._seed_credential_function()

        response = client.get(url.format(fn_id=fn_id))

        assert response.status_code == 200
        assert is_secret_envelope(self._password(response))

    @pytest.mark.parametrize("url", _READ_URLS)
    def test_reveals_credential_when_credential_inputs_on(
        self, client: TestClient, url: str
    ) -> None:
        from wavecore.core.secrets import masking_settings

        fn_id = self._seed_credential_function()
        masking_settings.set_reveal_settings(credential_inputs=True)
        try:
            response = client.get(url.format(fn_id=fn_id))
        finally:
            masking_settings.set_reveal_settings(credential_inputs=False)

        assert response.status_code == 200
        assert self._password(response) == "pw-classified"


class TestFunctionReadsFollowTheTestVariablesReveal:
    """A Function's own secret locals and output defaults read as a Test's secret variables
    do: masked by default, in the clear while the test-variables reveal is on (REQ-3.1.3.17)."""

    @staticmethod
    def _seed() -> str:
        from wavecore.api.services.functions import service as function_service

        created, _etag = function_service.create_function(
            {
                "name": "secret_reads",
                "description": "",
                "tags": [],
                "inputs": [],
                "outputs": [
                    {"name": "out", "type": "string", "secret": True, "default": "plain-out"}
                ],
                "variables": [
                    {"name": "token", "type": "string", "secret": True, "value": "plain-local"}
                ],
                "dependencies": {"functions": [], "plugins": []},
                "workflow": {"nodes": [], "edges": []},
            }
        )
        return str(created["id"])

    @staticmethod
    def _secrets(response: Any) -> tuple[dict[str, Any], dict[str, Any]]:
        definition = _read_definition(response)
        return definition["variables"][0], definition["outputs"][0]

    @pytest.mark.parametrize("url", _READ_URLS)
    def test_masked_while_the_reveal_is_off(self, client: TestClient, url: str) -> None:
        response = client.get(url.format(fn_id=self._seed()))

        assert response.status_code == 200
        local, output = self._secrets(response)
        assert (local["value"], local.get("masked")) == ("********", True)
        assert (output["default"], output.get("masked")) == ("********", True)

    @pytest.mark.parametrize("url", _READ_URLS)
    def test_in_the_clear_while_the_reveal_is_on(self, client: TestClient, url: str) -> None:
        from wavecore.core.secrets import masking_settings

        fn_id = self._seed()
        masking_settings.set_reveal_settings(test_variables=True)
        try:
            response = client.get(url.format(fn_id=fn_id))
        finally:
            masking_settings.set_reveal_settings(test_variables=False)

        assert response.status_code == 200
        local, output = self._secrets(response)
        assert (local["value"], "masked" in local) == ("plain-local", False)
        assert (output["default"], "masked" in output) == ("plain-out", False)

    @pytest.mark.parametrize("url", _READ_URLS)
    def test_the_credential_reveal_leaves_them_masked(self, client: TestClient, url: str) -> None:
        from wavecore.core.secrets import masking_settings

        fn_id = self._seed()
        masking_settings.set_reveal_settings(credential_inputs=True)
        try:
            response = client.get(url.format(fn_id=fn_id))
        finally:
            masking_settings.set_reveal_settings(credential_inputs=False)

        local, output = self._secrets(response)
        assert (local["value"], output["default"]) == ("********", "********")


# ---------------------------------------------------------------------------
# GET /functions/{id}?version=X.Y.Z
# ---------------------------------------------------------------------------


class TestGetFunctionWithVersionQuery:
    """`GET /functions/{id}?version=X.Y.Z` is the convenience endpoint that mirrors
    GET /functions/{id}/versions/{version}."""

    def test_returns_specific_version_when_query_present(self, client: TestClient) -> None:
        fn_id = _seed_two_version_function()
        response = client.get(f"/functions/{fn_id}?version=1.0.0")
        assert response.status_code == 200, response.text
        body = response.json()
        data = body["data"]
        # Definition for v1 carries v1's description.
        assert data["description"] == "v1 desc"

    def test_returns_latest_when_query_absent(self, client: TestClient) -> None:
        """Backward compat: omitting `version` returns the latest."""
        fn_id = _seed_two_version_function()
        response = client.get(f"/functions/{fn_id}")
        assert response.status_code == 200
        body = response.json()
        data = body["data"]
        assert data["description"] == "v2 desc"

    def test_unknown_function_returns_404(self, client: TestClient) -> None:
        ghost_id = str(uuid.uuid4())
        response = client.get(f"/functions/{ghost_id}?version=1.0.0")
        assert response.status_code == 404
        messages = _all_error_messages(response.json())
        assert any(m == f"Function '{ghost_id}' not found" for m in messages)

    def test_known_function_unknown_version_returns_404(self, client: TestClient) -> None:
        fn_id = _seed_two_version_function()
        response = client.get(f"/functions/{fn_id}?version=9.9.9")
        assert response.status_code == 404
        messages = _all_error_messages(response.json())
        expected = f"Function '{fn_id}' version '9.9.9' not found"
        assert any(m == expected for m in messages), messages


# ---------------------------------------------------------------------------
# GET /functions list includes latest_version
# ---------------------------------------------------------------------------


class TestListFunctionsLatestVersionField:
    """`GET /functions` summary rows carry `latest_version`."""

    def test_summary_row_carries_latest_version(self, client: TestClient) -> None:
        fn_id = _seed_two_version_function(name="alpha")
        response = client.get("/functions")
        assert response.status_code == 200
        body = response.json()
        row = next(r for r in body["data"] if r["id"] == fn_id)
        assert row["latest_version"] == "2.0.0"


pytestmark = pytest.mark.usefixtures("temp_storage_path")
