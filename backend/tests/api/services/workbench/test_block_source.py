"""The Source a block's own console lines carry (EXEC-25).

The Source is the block type's palette name alone when the block's Name matches it, and
``{type} : {Name}`` when it does not. The Description never appears in it.
"""

import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from wavecore import plugins
from wavecore.api.services.workbench.block_source import (
    _PALETTE_NAMES,
    block_source,
    node_source,
    node_type_name,
)
from wavecore.controls.registry import _registry as control_registry
from wavecore.controls.registry import list_latest_control_metadata, register_all_core_controls
from wavecore.core.plugin_registry import clear_registry, list_plugins, register_plugin
from wavecore.plugins.base import PluginBase

REPO_ROOT = Path(__file__).resolve().parents[5]
PALETTE_FILES = (
    "frontend/src/features/workbench/lib/plugin-definitions.ts",
    "frontend/src/features/workbench/lib/control-definitions.ts",
)
PALETTE_ENTRY = re.compile(r"\bdef\(\s*'([^']+)',\s*'([^']+)'")

# Type id, palette name, the catalog's own name.
PALETTE_DIFFERENCES = [
    ("http-client", "HTTP", "HTTP Client"),
    ("csv-parser", "CSV", "CSV Parser"),
    ("excel-parser", "Excel", "Excel Parser"),
    ("json-parser", "JSON", "JSON Parser"),
    ("xml-parser", "XML", "XML Parser"),
    ("if-else", "If / Else", "If/Else"),
    ("switch-case", "Switch", "Switch/Case"),
    ("try-catch-finally", "Try / Catch", "Try/Catch/Finally"),
    ("variable-setter", "Var Setter", "Variable Setter"),
]
DIFFERENCE_IDS = [row[0] for row in PALETTE_DIFFERENCES]

SQL = {"name": "SQL"}
HTTP = {"name": "HTTP Client"}
LONG_DESCRIPTION = "Calls the billing procedure and keeps what it returns for the checks below"


class _ProbePlugin:
    """A registered plugin the palette table does not know."""

    def __init__(self, name: str | None = "Probe Block") -> None:
        self._name = name

    @property
    def metadata(self) -> dict[str, Any]:
        named = {"name": self._name} if self._name is not None else {}
        return {"id": "probe", "version": "2.0.0", "parameters": [], **named}


@pytest.fixture
def registries() -> Iterator[None]:
    """The core controls, the Log plugin and one plugin outside the palette table."""
    from wavecore.plugins.log import LogPlugin

    control_registry.clear()
    register_all_core_controls(control_registry)
    clear_registry()
    register_plugin(LogPlugin())
    register_plugin(_ProbePlugin())
    yield
    clear_registry()


@pytest.fixture
def shipped_blocks() -> Iterator[None]:
    """Every plugin and control WAVE ships, registered as at startup."""
    control_registry.clear()
    register_all_core_controls(control_registry)
    clear_registry()
    for exported_name in plugins.__all__:
        exported = getattr(plugins, exported_name)
        if isinstance(exported, type) and issubclass(exported, PluginBase):
            register_plugin(exported())
    yield
    clear_registry()


def _node(
    element_type: str | None,
    label: str | None = None,
    *,
    node_type: str = "plugin",
    version: str | None = "1.0.0",
    description: str | None = None,
) -> dict[str, Any]:
    data: dict[str, Any] = {"nodeType": node_type}
    for key, value in (
        ("elementType", element_type),
        ("label", label),
        ("version", version),
        ("description", description),
    ):
        if value is not None:
            data[key] = value
    return {"id": "node-1", "type": "workflowNode", "data": data}


def _palette() -> dict[str, str]:
    """Type id to palette name, read from the two frontend definition files."""
    names: dict[str, str] = {}
    for relative in PALETTE_FILES:
        text = (REPO_ROOT / relative).read_text(encoding="utf-8")
        names.update(PALETTE_ENTRY.findall(text))
    return names


def _registered_versions() -> dict[str, str]:
    versions = {str(p.metadata["id"]): str(p.metadata["version"]) for p in list_plugins()}
    for metadata in list_latest_control_metadata():
        versions[metadata["id"].value] = str(metadata["version"])
    return versions


class TestANameThatMatchesTheType:
    """An empty Name, the palette name and the catalog name all show the type alone."""

    @pytest.mark.parametrize(
        "name", [None, "", "   ", "\t\n"], ids=["none", "empty", "spaces", "tab"]
    )
    def test_an_empty_name_shows_the_type_alone(self, name: str | None) -> None:
        assert block_source("sql-client", SQL, name) == "SQL"

    def test_the_palette_name_shows_the_type_alone(self) -> None:
        assert block_source("http-client", HTTP, "HTTP") == "HTTP"

    def test_the_catalog_name_shows_the_type_alone(self) -> None:
        assert block_source("http-client", HTTP, "HTTP Client") == "HTTP"

    def test_spaces_around_a_matching_name_are_ignored(self) -> None:
        assert block_source("sql-client", SQL, "  SQL \t") == "SQL"


class TestANameThatDiffersFromTheType:
    """The Name follows the type after a colon with one space on each side."""

    def test_the_name_follows_the_type(self) -> None:
        assert block_source("sql-client", SQL, "Run PSQL Proc") == "SQL : Run PSQL Proc"

    def test_a_numbered_name_does_not_match(self) -> None:
        assert block_source("sql-client", SQL, "SQL_1") == "SQL : SQL_1"

    def test_the_match_is_case_sensitive(self) -> None:
        assert block_source("sql-client", SQL, "sql") == "SQL : sql"

    def test_a_colon_in_the_name_is_kept_as_typed(self) -> None:
        assert block_source("http-client", HTTP, "GET http://host/x") == "HTTP : GET http://host/x"

    def test_spaces_around_the_name_are_removed(self) -> None:
        assert block_source("sql-client", SQL, "  Run PSQL Proc \t") == "SQL : Run PSQL Proc"

    def test_spaces_inside_the_name_are_kept(self) -> None:
        assert block_source("sql-client", SQL, "Run  PSQL") == "SQL : Run  PSQL"


class TestTheTypeName:
    """The type shows as the palette name, else the catalog name, else the type id."""

    @pytest.mark.parametrize(
        ("type_id", "palette", "catalog"), PALETTE_DIFFERENCES, ids=DIFFERENCE_IDS
    )
    def test_an_unnamed_block_shows_the_palette_name(
        self, type_id: str, palette: str, catalog: str
    ) -> None:
        assert block_source(type_id, {"name": catalog}, None) == palette

    @pytest.mark.parametrize(
        ("type_id", "palette", "catalog"), PALETTE_DIFFERENCES, ids=DIFFERENCE_IDS
    )
    def test_a_block_named_as_the_palette_shows_the_palette_name(
        self, type_id: str, palette: str, catalog: str
    ) -> None:
        assert block_source(type_id, {"name": catalog}, palette) == palette

    @pytest.mark.parametrize(
        ("type_id", "palette", "catalog"), PALETTE_DIFFERENCES, ids=DIFFERENCE_IDS
    )
    def test_a_block_named_as_the_catalog_shows_the_palette_name(
        self, type_id: str, palette: str, catalog: str
    ) -> None:
        assert block_source(type_id, {"name": catalog}, catalog) == palette

    @pytest.mark.parametrize(
        ("type_id", "palette", "catalog"), PALETTE_DIFFERENCES, ids=DIFFERENCE_IDS
    )
    def test_a_block_with_its_own_name_shows_the_palette_name_first(
        self, type_id: str, palette: str, catalog: str
    ) -> None:
        assert block_source(type_id, {"name": catalog}, "Mine") == f"{palette} : Mine"

    def test_the_table_holds_the_nine_differences_and_the_container(self) -> None:
        expected = {type_id: palette for type_id, palette, _catalog in PALETTE_DIFFERENCES}
        expected["remote-execution"] = "Remote Execution"

        assert expected == _PALETTE_NAMES

    def test_a_type_outside_the_table_shows_its_catalog_name(self) -> None:
        assert block_source("probe", {"name": "Probe Block"}, None) == "Probe Block"

    def test_a_type_outside_the_table_matches_its_catalog_name(self) -> None:
        assert block_source("probe", {"name": "Probe Block"}, "Probe Block") == "Probe Block"

    def test_a_type_outside_the_table_is_followed_by_its_name(self) -> None:
        assert block_source("probe", {"name": "Probe Block"}, "Mine") == "Probe Block : Mine"

    @pytest.mark.parametrize("metadata", [None, {}, {"name": ""}], ids=["none", "no-name", "empty"])
    def test_a_type_with_no_catalog_name_shows_its_id(
        self, metadata: dict[str, Any] | None
    ) -> None:
        assert block_source("probe", metadata, None) == "probe"

    def test_a_type_with_no_catalog_name_is_followed_by_its_name(self) -> None:
        assert block_source("probe", None, "Mine") == "probe : Mine"

    def test_the_remote_execution_container_shows_its_palette_name(self) -> None:
        assert block_source("remote-execution", None, "Remote Execution") == "Remote Execution"

    def test_a_named_remote_execution_container(self) -> None:
        assert block_source("remote-execution", None, "On db-1") == "Remote Execution : On db-1"

    def test_a_block_with_no_type_shows_its_name_alone(self) -> None:
        assert block_source("", None, "Mine") == "Mine"

    def test_a_block_with_no_type_and_no_name_shows_nothing(self) -> None:
        assert block_source("", None, None) == ""


@pytest.mark.usefixtures("registries")
class TestTheSourceOfANode:
    """A canvas node's Source: its type name from the registries, then its Name."""

    def test_a_plugin_node_named_as_its_type(self) -> None:
        assert node_source(_node("log", "Log")) == "Log"

    def test_a_plugin_node_with_its_own_name(self) -> None:
        assert node_source(_node("log", "Greet the user")) == "Log : Greet the user"

    def test_a_plugin_node_with_no_name(self) -> None:
        assert node_source(_node("log")) == "Log"

    def test_the_description_never_appears(self) -> None:
        named_as_type = _node("log", "Log", description=LONG_DESCRIPTION)
        own_name = _node("log", "Greet", description=LONG_DESCRIPTION)

        assert node_source(named_as_type) == "Log"
        assert node_source(own_name) == "Log : Greet"

    def test_a_control_node_named_as_the_catalog_names_it(self) -> None:
        node = _node("variable-setter", "Variable Setter", node_type="control")

        assert node_source(node) == "Var Setter"

    def test_a_control_node_with_a_numbered_name(self) -> None:
        node = _node("variable-setter", "Var Setter_1", node_type="control")

        assert node_source(node) == "Var Setter : Var Setter_1"

    def test_a_control_outside_the_table(self) -> None:
        assert node_source(_node("delay", "Wait for the API", node_type="control")) == (
            "Delay : Wait for the API"
        )

    def test_a_plugin_outside_the_table_reads_its_registered_version(self) -> None:
        assert node_source(_node("probe", "Mine", version="2.0.0")) == "Probe Block : Mine"

    def test_a_version_that_is_not_registered_shows_the_type_id(self) -> None:
        assert node_source(_node("probe", "Mine", version="9.9.9")) == "probe : Mine"

    def test_a_control_version_that_is_not_registered_shows_the_type_id(self) -> None:
        assert node_source(_node("delay", "Mine", node_type="control", version="9.9.9")) == (
            "delay : Mine"
        )

    def test_a_node_with_no_version_reads_the_first_version(self) -> None:
        assert node_source(_node("log", "Greet", version=None)) == "Log : Greet"

    def test_an_unknown_type_shows_its_id(self) -> None:
        assert node_source(_node("my-plugin", "Mine")) == "my-plugin : Mine"

    def test_a_registered_plugin_with_no_name_shows_its_id(self) -> None:
        clear_registry()
        register_plugin(_ProbePlugin(name=None))

        assert node_source(_node("probe", "Mine", version="2.0.0")) == "probe : Mine"

    def test_the_remote_execution_container(self) -> None:
        assert node_source(_node("remote-execution", "Remote Execution")) == "Remote Execution"

    def test_a_function_block_shows_its_type_and_its_name(self) -> None:
        node = _node("function", "Login flow", node_type="function")

        assert node_source(node) == "Function : Login flow"

    def test_a_function_block_named_as_its_type_shows_the_type_alone(self) -> None:
        node = _node("function", "Function", node_type="function")

        assert node_source(node) == "Function"

    def test_a_node_with_a_name_and_no_type_shows_the_name(self) -> None:
        assert node_source(_node(None, "N1")) == "N1"

    @pytest.mark.parametrize(
        "node",
        [{}, {"id": "n1"}, {"id": "n1", "data": None}, {"id": "n1", "data": {}}],
        ids=["empty", "no-data", "null-data", "empty-data"],
    )
    def test_a_node_with_nothing_to_name_it_shows_nothing(self, node: dict[str, Any]) -> None:
        assert node_source(node) == ""


@pytest.mark.usefixtures("shipped_blocks")
class TestTheTypeNameOfANode:
    """One answer to what a block's type is called, for the Source and the default Name."""

    @pytest.mark.parametrize(
        ("element_type", "node_type", "name"),
        [
            pytest.param("for", "control", "For Loop", id="for"),
            pytest.param("csv-parser", "plugin", "CSV", id="csv-parser"),
            pytest.param("ssh-session-exec", "plugin", "SSH Session Exec", id="ssh-session-exec"),
            pytest.param("try-catch-finally", "control", "Try / Catch", id="try-catch-finally"),
            pytest.param("http-client", "plugin", "HTTP", id="http-client"),
            pytest.param("function", "function", "Function", id="function-block"),
            pytest.param("my-plugin", "plugin", "my-plugin", id="unknown-to-the-catalog"),
            pytest.param(None, "plugin", "", id="no-type"),
        ],
    )
    def test_the_name_is_what_an_unnamed_block_shows_as_its_source(
        self, element_type: str | None, node_type: str, name: str
    ) -> None:
        node = _node(element_type, node_type=node_type)

        assert node_type_name(node) == name
        assert node_source(node) == name

    def test_a_node_with_no_version_reads_the_first_version(self) -> None:
        assert node_type_name(_node("for", node_type="control", version=None)) == "For Loop"

    def test_a_version_that_is_not_registered_gives_the_type_id(self) -> None:
        assert node_type_name(_node("for", node_type="control", version="9.9.9")) == "for"


@pytest.mark.usefixtures("shipped_blocks")
class TestThePaletteNamesStayInStep:
    """The backend's type names equal the names the frontend palette shows."""

    def test_the_definition_files_list_the_nine_differences(self) -> None:
        palette = _palette()

        listed = {type_id: palette.get(type_id) for type_id in DIFFERENCE_IDS}
        assert listed == {type_id: name for type_id, name, _catalog in PALETTE_DIFFERENCES}

    def test_every_palette_type_shows_its_palette_name(self) -> None:
        palette = _palette()
        versions = _registered_versions()

        shown = {
            type_id: node_source(_node(type_id, version=versions.get(type_id, "1.0.0")))
            for type_id in palette
        }
        assert shown == palette

    def test_every_registered_plugin_and_control_has_a_palette_entry(self) -> None:
        assert sorted(set(_registered_versions()) - set(_palette())) == []

    def test_every_palette_type_but_the_container_is_registered(self) -> None:
        assert sorted(set(_palette()) - set(_registered_versions())) == ["remote-execution"]

    def test_the_catalog_names_of_the_nine_differ_from_the_palette(self) -> None:
        catalog = {str(p.metadata["id"]): p.metadata["name"] for p in list_plugins()}
        catalog.update(
            {metadata["id"].value: metadata["name"] for metadata in list_latest_control_metadata()}
        )

        differing = {type_id: catalog.get(type_id) for type_id in DIFFERENCE_IDS}
        assert differing == {type_id: name for type_id, _palette_name, name in PALETTE_DIFFERENCES}

    def test_the_table_holds_no_name_the_catalog_already_gives(self) -> None:
        catalog = {str(p.metadata["id"]): p.metadata["name"] for p in list_plugins()}
        catalog.update(
            {metadata["id"].value: metadata["name"] for metadata in list_latest_control_metadata()}
        )

        redundant = sorted(t for t, name in _PALETTE_NAMES.items() if catalog.get(t) == name)
        assert redundant == []
