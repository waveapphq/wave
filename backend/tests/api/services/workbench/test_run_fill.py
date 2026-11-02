"""A field the Block leaves out runs on the schema's current default (REQ-3.1.1.5).

Save stores only what the user set, so the workbench run fills every field a Block
leaves out from the field's default, read from the schema when the run starts: a
plugin, a control and a Remote Execution body Block all go through the one fill.
"""

from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest

from tests.plugins.http.httpx_fakes import make_mock_client, patch_async_client
from tests.plugins.k8s._k8s_fixtures import (
    FakeK8sClient,
    patch_verb_client,
    resource,
    session_value,
)
from wavecore.api.services.workbench import _common as _wb_common
from wavecore.api.services.workbench.node_helpers import _execute_node, _extract_node_fields
from wavecore.core import plugin_registry
from wavecore.plugins.base import PluginBase
from wavecore.plugins.csv_parser import CSVParserPlugin
from wavecore.plugins.excel_parser import ExcelParserPlugin
from wavecore.plugins.file_io import FileIOPlugin
from wavecore.plugins.http_client import HTTPClientPlugin
from wavecore.plugins.k8s_rollout import K8sRolloutPlugin

URL = "http://example.com/"
SAMPLE_WORKBOOK = (
    Path(__file__).resolve().parents[3]
    / "plugins"
    / "excel_parser"
    / "fixtures"
    / "sample_workbook.xlsx"
)
SAMPLE_SHEETS = ["People", "Offset", "Formulas", "Dates", "Empty"]
DEPLOYMENT_PATH = "/apis/apps/v1/namespaces/apps/deployments/web"
PASSING_ASSERTION = [{"type": "expression", "expression": "1 == 1"}]


@pytest.fixture(autouse=True)
def _clean_sessions() -> Generator[None, None, None]:
    _wb_common._clear_sessions_sync()
    yield
    _wb_common._clear_sessions_sync()


def _register(monkeypatch: pytest.MonkeyPatch, plugin: PluginBase) -> PluginBase:
    """The real Block, registered for this test only."""
    metadata = plugin.metadata
    monkeypatch.setitem(
        plugin_registry._registry._plugins, metadata["id"], {metadata["version"]: plugin}
    )
    return plugin


def _change_default(
    monkeypatch: pytest.MonkeyPatch, plugin: PluginBase, name: str, default: Any
) -> None:
    """The schema now declares another default for one field."""
    metadata = plugin.metadata
    metadata["parameters"] = [
        {**row, "default": default} if row["name"] == name else row
        for row in metadata["parameters"]
    ]
    monkeypatch.setattr(type(plugin), "metadata", property(lambda _self: metadata))


def _node(
    element_type: str, values: dict[str, Any], *, node_type: str = "plugin"
) -> dict[str, Any]:
    """A Block as Save stores it: only the values the user set."""
    return {
        "id": "node-1",
        "type": "workflowNode",
        "data": {
            "label": element_type,
            "elementType": element_type,
            "nodeType": node_type,
            "version": "1.0.0",
            "config": {"values": values},
            "expressionFields": [],
            "templateFields": [],
        },
    }


async def _run(node: dict[str, Any]) -> Any:
    """Run one Block the way the workbench run loop does."""
    return await _execute_node(_extract_node_fields(node), {}, "run-fill-session", node["id"])


@pytest.fixture
def http_plugin(monkeypatch: pytest.MonkeyPatch) -> PluginBase:
    return _register(monkeypatch, HTTPClientPlugin())


class TestPluginFieldsLeftOut:
    """Each of these Blocks runs with a defaulted field left out."""

    async def test_an_http_request_with_method_left_out_sends_get(
        self, http_plugin: PluginBase
    ) -> None:
        client, _ = make_mock_client(text="OK", url=URL)

        with patch_async_client(client):
            result = await _run(_node("http-client", {"url": URL}))

        assert client.request.call_args.kwargs["method"] == "GET"
        assert result["status_code"] == 200

    async def test_file_io_with_operation_left_out_reads_the_file(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        _register(monkeypatch, FileIOPlugin())
        target = tmp_path / "note.txt"
        target.write_text("hello world", encoding="utf-8")

        result = await _run(_node("file-io", {"path": str(target)}))

        assert result["content"] == "hello world"

    async def test_excel_with_operation_left_out_reads_the_workbook(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _register(monkeypatch, ExcelParserPlugin())

        result = await _run(_node("excel-parser", {"workbook": str(SAMPLE_WORKBOOK)}))

        assert result["sheets"] == SAMPLE_SHEETS

    async def test_k8s_rollout_with_kind_left_out_rolls_a_deployment(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _register(monkeypatch, K8sRolloutPlugin())
        fake = FakeK8sClient(
            resources={"Deployment": resource("Deployment", "deployments", group_version="apps/v1")}
        )

        with patch_verb_client("rollout", fake):
            await _run(_node("k8s-rollout", {"session": session_value(), "name": "web"}))

        assert fake.discoveries == ["Deployment"]
        assert [(request.method, request.path) for request in fake.calls] == [
            ("GET", DEPLOYMENT_PATH),
            ("PATCH", DEPLOYMENT_PATH),
        ]

    async def test_csv_with_operation_left_out_parses_the_text(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        _register(monkeypatch, CSVParserPlugin())

        result = await _run(_node("csv-parser", {"csv_content": "id,name\n1,Ada\n2,Grace\n"}))

        assert result["row_count"] == 2
        assert result["table"].to_list() == [{"id": 1, "name": "Ada"}, {"id": 2, "name": "Grace"}]


class TestTheCurrentDefault:
    """The fill reads the schema when the run starts, never a copy taken earlier."""

    async def test_a_changed_schema_default_is_used_by_the_next_run(
        self, http_plugin: PluginBase, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        client, _ = make_mock_client(text="OK", url=URL)
        node = _node("http-client", {"url": URL})

        with patch_async_client(client):
            await _run(node)
            _change_default(monkeypatch, http_plugin, "method", "PUT")
            await _run(node)

        sent = [request.kwargs["method"] for request in client.request.call_args_list]
        assert sent == ["GET", "PUT"]

    async def test_a_value_the_block_holds_wins_over_the_default(
        self, http_plugin: PluginBase
    ) -> None:
        client, _ = make_mock_client(text="OK", url=URL)

        with patch_async_client(client):
            await _run(_node("http-client", {"url": URL, "method": "DELETE"}))

        assert client.request.call_args.kwargs["method"] == "DELETE"

    async def test_the_stored_block_keeps_only_what_the_user_set(
        self, http_plugin: PluginBase
    ) -> None:
        client, _ = make_mock_client(text="OK", url=URL)
        node = _node("http-client", {"url": URL})

        with patch_async_client(client):
            await _run(node)

        assert node["data"]["config"]["values"] == {"url": URL}


@pytest.fixture
def core_controls() -> None:
    from wavecore.controls.registry import _registry, register_all_core_controls

    register_all_core_controls(_registry)


@pytest.mark.usefixtures("core_controls")
class TestControlFieldsLeftOut:
    async def test_an_assert_with_mode_left_out_runs_split(self) -> None:
        node = _node("assert", {"assertions": PASSING_ASSERTION}, node_type="control")

        result = await _run(node)

        assert result == {"passed": True, "__branch": "pass"}


class TestRemoteBodyFieldsLeftOut:
    async def test_a_body_block_with_method_left_out_resolves_get(
        self, http_plugin: PluginBase
    ) -> None:
        from wavecore.api.services.workbench.remote_exec import _resolve_remote_params

        fields = _extract_node_fields(_node("http-client", {"url": URL}))

        resolved = _resolve_remote_params(fields, {}, "run-fill-session")

        assert resolved["method"] == "GET"
        assert resolved["url"] == URL
