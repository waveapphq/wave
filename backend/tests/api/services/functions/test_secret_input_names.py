"""The secret inputs of a Shared Function Block come from the version it is pinned to.

REQ-3.1.2.9, REQ-3.1.3.18: a library version's secret inputs are read from that version only,
never from the latest one; sealing and the owed-secret list get the same names.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from wavecore.api.services.functions import _storage
from wavecore.api.services.functions.service import secret_input_names
from wavecore.core.secrets.cipher import is_secret_envelope
from wavecore.core.secrets.owed import OwedSecret, owed_in_test
from wavecore.core.secrets.sealing import seal_workflow_node_secrets, unseal_all

_METADATA: dict[str, Any] = {
    "description": "sign in",
    "tags": [],
    "changelog": "initial",
    "details": "",
    "published_at": "2026-01-01T00:00:00Z",
    "published_by": "wave",
}

_OLDER_BODY: dict[str, Any] = {
    "inputs": [
        {"name": "tok", "type": "string", "required": True, "secret": True},
        {"name": "key", "type": "string", "required": True},
    ],
    "outputs": [],
    "dependencies": {"functions": [], "plugins": []},
    "workflow": {"nodes": [], "edges": []},
}

_NEWER_BODY: dict[str, Any] = {
    "inputs": [
        {"name": "tok", "type": "string", "required": True},
        {"name": "key", "type": "string", "required": True, "secret": True},
    ],
    "outputs": [],
    "dependencies": {"functions": [], "plugins": []},
    "workflow": {"nodes": [], "edges": []},
}


@pytest.fixture
def function_id() -> str:
    """A library Function whose newer version moves the secret flag from ``tok`` to ``key``."""
    new_id = str(uuid.uuid4())
    _storage.save_new_version(new_id, "1.0.0", _OLDER_BODY, _METADATA, name="sign_in")
    _storage.save_new_version(new_id, "1.1.0", _NEWER_BODY, _METADATA, name="sign_in")
    return new_id


@pytest.fixture
def latest_never_read(monkeypatch: pytest.MonkeyPatch) -> None:
    def load_function(function_id: str) -> tuple[dict[str, Any], str]:
        raise AssertionError(f"the latest version of '{function_id}' was read")

    monkeypatch.setattr(_storage, "load_function", load_function)


def _block_data(
    function_id: str, version: str | None, values: dict[str, Any] | None = None
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "label": "Sign_in_1",
        "elementType": "function",
        "nodeType": "function",
        "functionLifecycle": "shared",
        "functionId": function_id,
        "originalLibraryName": "sign_in",
        "config": {"values": values or {}, "outputBindings": {}},
    }
    if version is not None:
        data["functionVersion"] = version
    return data


def _workflow(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "nodes": [{"id": "sign-in-1", "type": "workflowNode", "data": data}],
        "edges": [{"source": "start-node", "target": "sign-in-1"}],
    }


@pytest.mark.usefixtures("latest_never_read")
class TestSecretInputNames:
    def test_block_pinned_to_an_older_version_reads_that_versions_secret_inputs(
        self, function_id: str
    ) -> None:
        assert secret_input_names(_block_data(function_id, "1.0.0")) == {"tok"}

    def test_block_pinned_to_the_newer_version_reads_its_secret_inputs(
        self, function_id: str
    ) -> None:
        assert secret_input_names(_block_data(function_id, "1.1.0")) == {"key"}

    def test_block_with_no_version_reads_no_secret_inputs(self, function_id: str) -> None:
        assert secret_input_names(_block_data(function_id, None)) == set()

    def test_block_pinned_to_a_missing_version_reads_no_secret_inputs(
        self, function_id: str
    ) -> None:
        assert secret_input_names(_block_data(function_id, "9.9.9")) == set()


@pytest.mark.usefixtures("latest_never_read")
class TestPinnedSecretInputsReachTheirReaders:
    def test_sealing_seals_the_pinned_versions_secret_input_only(self, function_id: str) -> None:
        data = _block_data(function_id, "1.0.0", {"tok": "abc", "key": "xyz"})

        sealed = seal_workflow_node_secrets(_workflow(data), secret_inputs=secret_input_names)

        values = sealed["nodes"][0]["data"]["config"]["values"]
        assert is_secret_envelope(values["tok"])
        assert unseal_all(values["tok"]) == "abc"
        assert values["key"] == "xyz"

    def test_owed_list_names_the_pinned_versions_secret_input_only(self, function_id: str) -> None:
        data = _block_data(function_id, "1.0.0", {"tok": None, "key": None})
        test_data = {"name": "Sign in", "variables": {}, "workflow": _workflow(data)}

        owed = owed_in_test(test_data, secret_inputs=secret_input_names)

        assert owed == [OwedSecret("tok", "blocks.sign-in-1.tok", field=True)]
