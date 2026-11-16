"""Discover catalog contract: list_blocks/get_block over the registries.

The catalog reads the LIVE registries (never file storage): 39 plugins + 15
controls + the remote-execution container entry; a plugin with no settings and
no outputs carries implemented=false with guidance. Also pins the registry extensions
plugin_registry.list_plugins and controls.registry.list_latest_control_metadata.
"""

import re
from typing import Any

import pytest
import yaml

from tests.mcp.conftest import CONTROL_IDS, REAL_PLUGIN_IDS
from tests.plugins._stub_plugin import register_stub_plugin
from wavecore.api.exceptions import NotFoundException

STUB_GUIDANCE = "Not yet implemented - do not use in authored tests."

PLUGIN_ENTRY_KEYS = {
    "id",
    "name",
    "kind",
    "category",
    "version",
    "description",
    "parameters",
    "output_schema",
    "return_type",
    "remotable",
    "proxy_support",
    "implemented",
}

PROXY_SUPPORT_VALUES = {"supported", "unsupported", "not_applicable"}

PROXY_SUPPORT_BY_BLOCK = [
    ("http-client", "supported"),
    ("shell-script", "unsupported"),
    ("netcat", "not_applicable"),
]


@pytest.fixture(autouse=True)
def _registries(seed_registries: None) -> None:
    """Catalog tests always run against fully seeded live registries."""


def _blocks() -> list[dict[str, Any]]:
    from wavecore.mcp.tools import discover

    blocks: list[dict[str, Any]] = discover.list_blocks()["blocks"]
    return blocks


def _by_id(blocks: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {block["id"]: block for block in blocks}


class TestListBlocks:
    def test_catalog_covers_all_55_blocks(self) -> None:
        blocks = _blocks()

        assert len(blocks) == 55
        kinds = [block["kind"] for block in blocks]
        assert kinds.count("plugin") == 39
        assert kinds.count("control") == 15
        assert kinds.count("container") == 1

    def test_all_thirty_nine_plugins_are_implemented(self) -> None:
        plugins = [block for block in _blocks() if block["kind"] == "plugin"]

        implemented = sorted(block["id"] for block in plugins if block["implemented"])
        stubs = sorted(block["id"] for block in plugins if not block["implemented"])
        assert len(implemented) == 39
        assert stubs == []

    def test_a_plugin_without_settings_or_outputs_is_the_only_stub(self) -> None:
        stub_id = register_stub_plugin()

        plugins = [block for block in _blocks() if block["kind"] == "plugin"]

        assert len(plugins) == 40
        assert sorted(block["id"] for block in plugins if not block["implemented"]) == [stub_id]

    def test_plugin_ids_match_the_live_registry(self) -> None:
        catalog = _by_id(_blocks())

        plugin_ids = {bid for bid, block in catalog.items() if block["kind"] == "plugin"}
        assert plugin_ids == REAL_PLUGIN_IDS

    def test_control_ids_match_the_live_registry(self) -> None:
        catalog = _by_id(_blocks())

        control_ids = {bid for bid, block in catalog.items() if block["kind"] == "control"}
        assert control_ids == CONTROL_IDS

    def test_plugin_entry_shape(self) -> None:
        catalog = _by_id(_blocks())

        entry = catalog["shell-script"]
        assert PLUGIN_ENTRY_KEYS.issubset(entry.keys())
        assert entry["kind"] == "plugin"
        assert entry["version"] == "1.0.0"
        assert isinstance(entry["parameters"], list)
        assert entry["parameters"], "shell-script declares parameters"
        assert isinstance(entry["output_schema"], list)
        assert entry["implemented"] is True

    def test_control_entry_shape(self) -> None:
        catalog = _by_id(_blocks())

        entry = catalog["if-else"]
        assert entry["kind"] == "control"
        assert entry["version"] == "1.0.0"
        assert isinstance(entry["parameter_schema"], list)
        assert isinstance(entry["structure_hints"], dict)
        assert entry["structure_hints"]["type"] == "branching"
        assert entry["implemented"] is True

    def test_a_stub_plugin_is_flagged_with_guidance(self) -> None:
        stub_id = register_stub_plugin()

        entry = _by_id(_blocks())[stub_id]

        assert entry["implemented"] is False
        assert entry["guidance"] == STUB_GUIDANCE

    def test_real_plugins_carry_no_guidance(self) -> None:
        catalog = _by_id(_blocks())

        for plugin_id in REAL_PLUGIN_IDS:
            entry = catalog[plugin_id]
            assert entry["implemented"] is True, plugin_id
            assert entry.get("guidance") is None, plugin_id

    def test_remote_execution_container_entry(self) -> None:
        catalog = _by_id(_blocks())

        entry = catalog["remote-execution"]
        assert entry["kind"] == "container"
        assert entry["name"] == "Remote Execution"
        assert entry["implemented"] is True
        assert entry["structure_hints"]["has_body"] is True

    def test_catalog_reads_the_live_registry_not_storage(self) -> None:
        from wavecore.core.plugin_registry import clear_registry, register_plugin
        from wavecore.plugins import LogPlugin

        clear_registry()
        register_plugin(LogPlugin())

        blocks = _blocks()

        plugin_entries = [block for block in blocks if block["kind"] == "plugin"]
        assert [entry["id"] for entry in plugin_entries] == ["log"]


SESSION_ID_DESCRIPTION = (
    "Handle identifying an open SSH session: Open produces it; Execute, Script, Close, "
    "Tunnel Open, SFTP, Remote Execution, and a chained Open's Parent Session reference it"
)
REMOTE_SESSION_ID_OUTPUT = {
    "name": "remote_session_id",
    "type": "string",
    "description": (
        "Handle to the persistent remote worker opened on the SSH session host for this container"
    ),
}


class TestRemoteExecutionEntry:
    """The container's setting and output are the ones a recipe compiles and the engine reads."""

    def test_the_entry_lists_the_session_id_setting(self) -> None:
        entry = _by_id(_blocks())["remote-execution"]

        assert entry["parameter_schema"] == [
            {
                "name": "session_id",
                "type": "string",
                "required": True,
                "default": None,
                "description": SESSION_ID_DESCRIPTION,
            }
        ]

    def test_the_entry_lists_the_remote_session_id_output(self) -> None:
        entry = _by_id(_blocks())["remote-execution"]

        assert entry["output_schema"] == [REMOTE_SESSION_ID_OUTPUT]

    def test_get_block_lists_the_same_setting_and_output(self) -> None:
        from wavecore.mcp.tools import discover

        entry = discover.get_block("remote-execution")

        assert [param["name"] for param in entry["parameter_schema"]] == ["session_id"]
        assert [out["name"] for out in entry["output_schema"]] == ["remote_session_id"]

    def test_a_recipe_written_from_the_entry_compiles_without_findings(self) -> None:
        from wavecore.core.recipes.compiler import compile_recipe
        from wavecore.mcp.tools import discover

        entry = discover.get_block("remote-execution")
        settings = {param["name"]: {"expr": "ssh_session"} for param in entry["parameter_schema"]}
        capture = {out["name"]: f"captured_{out['name']}" for out in entry["output_schema"]}
        recipe = {
            "test": {"name": "Remote From The Catalog"},
            "variables": {"ssh_session": {"type": "string", "value": "main"}},
            "flow": [
                {
                    "remote": {
                        "settings": settings,
                        "body": [{"block": "log", "settings": {"message": "hello"}}],
                        "capture": capture,
                    }
                }
            ],
        }

        result = compile_recipe(yaml.safe_dump(recipe, sort_keys=False))

        assert result["findings"] == []
        nodes = result["test_data"]["workflow"]["nodes"]
        node = next(n for n in nodes if n["id"] == "node-1")
        assert node["data"]["config"]["values"] == {"session_id": "ssh_session"}
        assert node["data"]["config"]["outputBindings"] == {
            "remote_session_id": "captured_remote_session_id"
        }

    def test_a_returned_entry_is_a_fresh_copy(self) -> None:
        from wavecore.mcp.tools import discover

        first = discover.get_block("remote-execution")
        first["parameter_schema"][0]["name"] = "changed"
        first["output_schema"].clear()

        again = discover.get_block("remote-execution")

        assert again["parameter_schema"][0]["name"] == "session_id"
        assert again["output_schema"] == [REMOTE_SESSION_ID_OUTPUT]

    def test_a_returned_output_is_a_fresh_copy(self) -> None:
        from wavecore.mcp.tools import discover

        first = discover.get_block("remote-execution")
        first["output_schema"][0]["description"] = "changed"

        again = discover.get_block("remote-execution")

        assert again["output_schema"] == [REMOTE_SESSION_ID_OUTPUT]


class TestSshSessionIdInTheCatalog:
    """Every SSH block describes session_id and the parent session as the editor does."""

    @pytest.mark.parametrize(
        "block_id",
        ["ssh-session-exec", "ssh-session-script", "ssh-session-close", "ssh-tunnel-open", "sftp"],
    )
    def test_the_session_id_setting_uses_the_editor_text(self, block_id: str) -> None:
        entry = _by_id(_blocks())[block_id]

        session_id = next(p for p in entry["parameters"] if p["name"] == "session_id")
        assert session_id["description"] == SESSION_ID_DESCRIPTION

    def test_the_open_block_session_id_output_uses_the_editor_text(self) -> None:
        entry = _by_id(_blocks())["ssh-session-open"]

        session_id = next(o for o in entry["output_schema"] if o["name"] == "session_id")
        assert session_id["description"] == SESSION_ID_DESCRIPTION

    def test_the_open_block_parent_session_setting_uses_the_editor_text(self) -> None:
        entry = _by_id(_blocks())["ssh-session-open"]

        parent = next(p for p in entry["parameters"] if p["name"] == "parent_session_id")
        assert parent["description"] == (
            "Session ID of the open parent SSH session to tunnel over. "
            "The connection fails if the parent is not open"
        )


class TestProxySupportInTheCatalog:
    """REQ-4.7.14: every catalog entry says how the block relates to the Proxy setting."""

    def test_every_entry_of_the_list_carries_the_field(self) -> None:
        without = sorted(block["id"] for block in _blocks() if "proxy_support" not in block)

        assert without == []

    def test_every_control_entry_is_not_applicable(self) -> None:
        listed = {
            block["id"]: block.get("proxy_support")
            for block in _blocks()
            if block["kind"] == "control"
        }

        assert listed == dict.fromkeys(CONTROL_IDS, "not_applicable")

    def test_every_plugin_entry_carries_one_of_the_three_values(self) -> None:
        plugins = [block for block in _blocks() if block["kind"] == "plugin"]

        outside = sorted(
            block["id"]
            for block in plugins
            if block.get("proxy_support") not in PROXY_SUPPORT_VALUES
        )
        assert outside == []

    def test_every_plugin_entry_carries_the_plugins_own_value(self) -> None:
        from wavecore.core.plugin_registry import list_plugins

        declared = {plugin.metadata["id"]: plugin.proxy_support for plugin in list_plugins()}

        listed = {
            block["id"]: block.get("proxy_support")
            for block in _blocks()
            if block["kind"] == "plugin"
        }
        assert listed == declared

    @pytest.mark.parametrize(("block_id", "expected"), PROXY_SUPPORT_BY_BLOCK)
    def test_list_blocks_carries_the_value_by_block(self, block_id: str, expected: str) -> None:
        assert _by_id(_blocks())[block_id].get("proxy_support") == expected

    @pytest.mark.parametrize(("block_id", "expected"), PROXY_SUPPORT_BY_BLOCK)
    def test_get_block_carries_the_value_by_block(self, block_id: str, expected: str) -> None:
        from wavecore.mcp.tools import discover

        assert discover.get_block(block_id).get("proxy_support") == expected

    def test_the_remote_execution_entry_is_not_applicable_in_the_list(self) -> None:
        entry = _by_id(_blocks())["remote-execution"]

        assert entry.get("proxy_support") == "not_applicable"

    def test_the_remote_execution_entry_is_not_applicable_by_id(self) -> None:
        from wavecore.mcp.tools import discover

        assert discover.get_block("remote-execution").get("proxy_support") == "not_applicable"


class TestShippedPlugins:
    """The seeded registry is the product's own plugin set, with no LDAP block in it."""

    def test_the_plugins_package_exports_exactly_the_seeded_plugins(self) -> None:
        import wavecore.plugins as shipped

        exported = {getattr(shipped, name)().metadata["id"] for name in shipped.__all__}

        assert exported == REAL_PLUGIN_IDS

    def test_the_save_checks_list_exactly_the_shipped_plugins(self) -> None:
        from wavecore.api.services.tests.service import KNOWN_PLUGIN_IDS
        from wavecore.models.plugins import ENGINE_DISPATCHED_ELEMENT_TYPES

        assert KNOWN_PLUGIN_IDS - ENGINE_DISPATCHED_ELEMENT_TYPES == REAL_PLUGIN_IDS


OPENSEARCH_CHOICES = {
    "mode": ["search", "aggregate"],
    "query_language": ["dql", "query_dsl"],
    "order": ["desc", "asc"],
    "group_by_time": ["none", "10s", "30s", "1m", "5m", "15m", "1h"],
    "on_error": ["fail", "record"],
}

SFTP_SETTINGS = [
    "session_id",
    "operation",
    "source",
    "destination",
    "path",
    "if_exists",
    "recursive",
    "missing_ok",
    "timeout",
    "max_size_mib",
    "max_files",
    "on_error",
]

SFTP_CHOICES = {
    "operation": ["upload", "download", "list", "stats", "delete", "move", "create_folder"],
    "if_exists": ["overwrite", "fail"],
    "on_error": ["fail", "record"],
}

SFTP_OUTPUTS = [
    "summary",
    "entries",
    "count",
    "exists",
    "type",
    "size",
    "modified",
    "success",
    "error",
    "reason",
]

HELM_BLOCK_IDS = [
    "helm-install",
    "helm-upgrade",
    "helm-rollback",
    "helm-uninstall",
    "helm-test",
    "helm-status",
]


class TestHelmBlocksInTheCatalog:
    """The six Helm blocks reach an MCP client as their own category."""

    def test_every_helm_block_is_listed(self) -> None:
        catalog = _by_id(_blocks())

        assert [bid for bid in HELM_BLOCK_IDS if bid in catalog] == HELM_BLOCK_IDS

    def test_every_helm_block_declares_the_helm_category(self) -> None:
        catalog = _by_id(_blocks())

        assert {catalog[bid]["category"] for bid in HELM_BLOCK_IDS} == {"helm"}

    def test_every_helm_block_is_remotable(self) -> None:
        catalog = _by_id(_blocks())

        assert [catalog[bid]["remotable"] for bid in HELM_BLOCK_IDS] == [True] * 6

    def test_the_kubernetes_category_keeps_its_twelve(self) -> None:
        catalog = _by_id(_blocks())

        kubernetes = [
            bid
            for bid, block in catalog.items()
            if block["kind"] == "plugin" and block["category"] == "kubernetes"
        ]

        assert len(kubernetes) == 12

    def test_the_controls_are_untouched(self) -> None:
        kinds = [block["kind"] for block in _blocks()]

        assert kinds.count("control") == 15


REMOTE_BLOCK_IDS = [
    "sftp",
    "ssh-session-open",
    "ssh-session-exec",
    "ssh-session-script",
    "ssh-session-close",
    "ssh-tunnel-open",
    "ssh-tunnel-close",
    "remote-execution",
]


class TestRemoteBlocksInTheCatalog:
    """SFTP-10: SFTP, the SSH blocks and Remote Execution reach an MCP client as Remote."""

    def test_every_remote_block_declares_the_remote_category(self) -> None:
        catalog = _by_id(_blocks())

        assert {bid: catalog[bid]["category"] for bid in REMOTE_BLOCK_IDS} == {
            bid: "remote" for bid in REMOTE_BLOCK_IDS
        }

    def test_the_remote_category_holds_exactly_these_blocks(self) -> None:
        remote = sorted(block["id"] for block in _blocks() if block["category"] == "remote")

        assert remote == sorted(REMOTE_BLOCK_IDS)

    def test_the_network_category_keeps_http_ping_and_netcat(self) -> None:
        network = sorted(block["id"] for block in _blocks() if block["category"] == "network")

        assert network == ["http-client", "netcat", "ping"]


class TestGetBlock:
    def test_get_block_returns_full_plugin_entry(self) -> None:
        from wavecore.mcp.tools import discover

        entry = discover.get_block("shell-script")

        assert entry["id"] == "shell-script"
        assert entry["kind"] == "plugin"
        assert entry["parameters"]

    def test_shell_script_is_not_remotable(self) -> None:
        """SHRUN-1: Shell Script runs on the WAVE server only."""
        from wavecore.mcp.tools import discover

        assert discover.get_block("shell-script")["remotable"] is False

    def test_shell_exec_is_not_remotable(self) -> None:
        """SHRUN-17: Shell Exec runs one command line on the WAVE server."""
        from wavecore.mcp.tools import discover

        assert discover.get_block("shell-exec")["remotable"] is False

    def test_ssh_tunnel_open_lists_validate_target(self) -> None:
        """SSHTUN-7: Validate Target is a boolean setting that defaults to false."""
        from wavecore.mcp.tools import discover

        entry = discover.get_block("ssh-tunnel-open")

        param = next(p for p in entry["parameters"] if p["name"] == "validate_target")
        assert param["type"] == "boolean"
        assert param["default"] is False

    def test_script_variables_carries_the_declared_outputs_marker(self) -> None:
        """SHRUN-6: the setting declares the outputs a recipe may capture."""
        from wavecore.mcp.tools import discover

        entry = discover.get_block("shell-script")

        param = next(p for p in entry["parameters"] if p["name"] == "script_variables")
        assert param["declares_outputs"] is True

    def test_python_is_remotable(self) -> None:
        """PYRUN-1: the Python block runs on a Remote Execution host too."""
        from wavecore.mcp.tools import discover

        assert discover.get_block("python")["remotable"] is True

    def test_netcat_is_remotable(self) -> None:
        """NETCAT-1: the Netcat block runs on a Remote Execution host too."""
        from wavecore.mcp.tools import discover

        assert discover.get_block("netcat")["remotable"] is True

    def test_sql_client_is_an_implemented_remotable_block(self) -> None:
        """SQL-15: the SQL block runs on a Remote Execution host too."""
        from wavecore.mcp.tools import discover

        entry = discover.get_block("sql-client")

        assert entry["remotable"] is True
        assert entry["implemented"] is True
        assert entry["version"] == "1.0.0"
        assert entry.get("guidance") is None

    def test_sql_client_lists_its_operations_and_database_types(self) -> None:
        """SQL-1: three operations against five database types."""
        from wavecore.mcp.tools import discover

        params = {p["name"]: p for p in discover.get_block("sql-client")["parameters"]}

        assert params["operation"]["enum_values"] == ["run_sql", "call_procedure", "load_table"]
        assert params["database_type"]["enum_values"] == [
            "postgresql",
            "mysql",
            "oracle",
            "mssql",
            "sqlite",
        ]

    def test_opensearch_is_an_implemented_remotable_block(self) -> None:
        """REQ-3.4.1.15, OS-14: the OpenSearch block runs on a Remote Execution host too."""
        from wavecore.mcp.tools import discover

        entry = discover.get_block("opensearch")

        assert entry["remotable"] is True
        assert entry["implemented"] is True
        assert entry["version"] == "1.0.0"
        assert entry["category"] == "database"
        assert entry.get("guidance") is None

    def test_opensearch_lists_its_choices_in_order(self) -> None:
        """OS-1, OS-5, OS-6, OS-7, OS-11: the selects reach an MCP client with their values."""
        from wavecore.mcp.tools import discover

        params = {p["name"]: p for p in discover.get_block("opensearch")["parameters"]}

        assert {name: params[name]["enum_values"] for name in OPENSEARCH_CHOICES} == (
            OPENSEARCH_CHOICES
        )

    def test_opensearch_lists_its_outputs(self) -> None:
        """OS-8: Results and Total results, plus the Record and continue outputs."""
        from wavecore.mcp.tools import discover

        outputs = [o["name"] for o in discover.get_block("opensearch")["output_schema"]]

        assert sorted(outputs) == ["error", "reason", "results", "success", "total_results"]

    def test_sftp_is_an_implemented_block_that_runs_on_wave(self) -> None:
        """REQ-3.4.1.8: SFTP is implemented and not remotable, so it always runs on WAVE."""
        from wavecore.mcp.tools import discover

        entry = discover.get_block("sftp")

        assert entry["kind"] == "plugin"
        assert entry["category"] == "remote"
        assert entry["version"] == "1.0.0"
        assert entry["implemented"] is True
        assert entry.get("guidance") is None
        assert entry["remotable"] is False

    def test_sftp_lists_its_settings_in_order(self) -> None:
        from wavecore.mcp.tools import discover

        names = [p["name"] for p in discover.get_block("sftp")["parameters"]]

        assert names == SFTP_SETTINGS

    def test_sftp_lists_its_choices_in_order(self) -> None:
        """The selects reach an MCP client with their values."""
        from wavecore.mcp.tools import discover

        params = {p["name"]: p for p in discover.get_block("sftp")["parameters"]}

        assert {name: params[name]["enum_values"] for name in SFTP_CHOICES} == SFTP_CHOICES

    def test_sftp_lists_its_outputs_in_order(self) -> None:
        from wavecore.mcp.tools import discover

        outputs = [o["name"] for o in discover.get_block("sftp")["output_schema"]]

        assert outputs == SFTP_OUTPUTS

    def test_python_script_variables_carries_the_declared_outputs_marker(self) -> None:
        """PYRUN-6: Variable Exports declare the outputs a recipe may capture."""
        from wavecore.mcp.tools import discover

        entry = discover.get_block("python")

        param = next(p for p in entry["parameters"] if p["name"] == "script_variables")
        assert param["declares_outputs"] is True

    def test_get_block_returns_control_entry(self) -> None:
        from wavecore.mcp.tools import discover

        entry = discover.get_block("try-catch-finally")

        assert entry["kind"] == "control"
        assert entry["structure_hints"]["branches"] == ["try", "catch", "finally", "then"]

    def test_get_block_returns_container_entry(self) -> None:
        from wavecore.mcp.tools import discover

        entry = discover.get_block("remote-execution")

        assert entry["kind"] == "container"

    def test_get_block_unknown_id_raises_exact_message(self) -> None:
        from wavecore.mcp.tools import discover

        with pytest.raises(NotFoundException, match=r"^Block 'nope' not found$"):
            discover.get_block("nope")

    @pytest.mark.parametrize("block_id", ["csv-parser", "excel-parser"])
    @pytest.mark.parametrize(
        ("setting", "fields"),
        [
            pytest.param("filters", ["column", "asType", "conditions"], id="filters"),
            pytest.param("sorts", ["column", "direction"], id="sorts"),
        ],
    )
    def test_the_csv_filters_setting_describes_its_item_shape(
        self, block_id: str, setting: str, fields: list[str]
    ) -> None:
        """CSV-12: a recipe writes a filter or sort the way the config window stores it."""
        from wavecore.mcp.tools import discover

        params = {p["name"]: p for p in discover.get_block(block_id)["parameters"]}
        description = params[setting]["description"]

        assert [name for name in fields if not re.search(rf"\b{name}\b", description)] == []

    @pytest.mark.parametrize(
        ("block_id", "setting"),
        [
            pytest.param("for", "count", id="for-count"),
            pytest.param("for-each", "collection", id="for-each-collection"),
        ],
    )
    def test_a_loop_setting_that_runs_zero_times_on_null_accepts_null(
        self, block_id: str, setting: str
    ) -> None:
        """REQ-3.1.3.21, REQ-3.1.3.25: a null count or collection runs the body zero times."""
        from wavecore.mcp.tools import discover

        params = {p["name"]: p for p in discover.get_block(block_id)["parameter_schema"]}

        assert params[setting]["accepts_null"] is True

    @pytest.mark.parametrize("setting", ["start", "end", "step"])
    def test_the_for_range_settings_still_refuse_null(self, setting: str) -> None:
        """REQ-3.5.1.15: range mode start, end and step given null still fail and name it."""
        from wavecore.mcp.tools import discover

        params = {p["name"]: p for p in discover.get_block("for")["parameter_schema"]}

        assert params[setting]["accepts_null"] is False


class TestPluginRegistryExtension:
    def test_list_plugins_returns_all_registered_instances(self) -> None:
        from wavecore.core.plugin_registry import list_plugins

        plugins = list_plugins()

        assert len(plugins) == 39
        assert {plugin.metadata["id"] for plugin in plugins} == REAL_PLUGIN_IDS

    def test_list_plugins_returns_latest_registration_per_id(self) -> None:
        from wavecore.core.plugin_registry import list_plugins, register_plugin
        from wavecore.plugins.log import LogPlugin

        class LogPluginV2(LogPlugin):
            @property
            def metadata(self) -> dict[str, Any]:
                return {**super().metadata, "version": "2.0.0"}

        register_plugin(LogPluginV2())

        plugins = list_plugins()

        assert len(plugins) == 39
        log_versions = [
            plugin.metadata["version"] for plugin in plugins if plugin.metadata["id"] == "log"
        ]
        assert log_versions == ["2.0.0"]


class TestControlRegistryExtension:
    def test_list_latest_control_metadata_covers_all_controls(self) -> None:
        from wavecore.controls.registry import list_latest_control_metadata

        entries = list_latest_control_metadata()

        assert len(entries) == 15
        ids = {str(entry["id"].value) for entry in entries}
        assert ids == CONTROL_IDS
        for entry in entries:
            assert "parameter_schema" in entry
            assert "structure_hints" in entry
            assert entry["version"] == "1.0.0"

    def test_list_latest_control_metadata_picks_newest_version(self) -> None:
        from wavecore.controls.registry import (
            _registry,
            list_latest_control_metadata,
        )
        from wavecore.controls.timing import DelayControl

        class DelayControlV11(DelayControl):
            @property
            def metadata(self) -> dict[str, Any]:
                return {**super().metadata, "version": "1.1.0"}

        _registry.register(DelayControlV11)

        entries = list_latest_control_metadata()

        assert len(entries) == 15
        delay = next(entry for entry in entries if str(entry["id"].value) == "delay")
        assert delay["version"] == "1.1.0"
