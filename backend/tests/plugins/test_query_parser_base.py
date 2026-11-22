"""The query parsers' shared metadata (REQ-3.4.1.16, REQ-3.4.1.11, REQ-5.2.7.3)."""

from typing import Any

import pytest

from wavecore.plugins.json_parser import JSONParserPlugin
from wavecore.plugins.xml_parser import XMLParserPlugin

INDIVIDUAL = {"field": "output_mode", "values": ["individual"]}
COMBINED = {"field": "output_mode", "values": ["combined"]}

PARSERS = [pytest.param(JSONParserPlugin, id="json"), pytest.param(XMLParserPlugin, id="xml")]


def _parameters(plugin: Any) -> dict[str, dict[str, Any]]:
    return {param["name"]: param for param in plugin().metadata["parameters"]}


def _outputs(plugin: Any) -> dict[str, dict[str, Any]]:
    return {output["name"]: output for output in plugin().metadata["output_schema"]}


@pytest.mark.parametrize("plugin", PARSERS)
class TestQueriesDeclareOutputs:
    def test_queries_declare_outputs_in_individual_mode(self, plugin: Any) -> None:
        queries = _parameters(plugin)["queries"]

        assert queries.get("declares_outputs") is True
        assert queries.get("declares_outputs_when") == INDIVIDUAL

    def test_results_is_an_output_in_combined_mode_only(self, plugin: Any) -> None:
        assert _outputs(plugin)["results"] == {
            "name": "results",
            "type": "map",
            "show_when": COMBINED,
        }

    def test_success_and_errors_are_always_outputs(self, plugin: Any) -> None:
        outputs = _outputs(plugin)

        assert outputs["success"] == {"name": "success", "type": "boolean"}
        assert outputs["errors"] == {"name": "errors", "type": "array"}

    def test_the_two_parsers_share_one_shape(self, plugin: Any) -> None:
        other = XMLParserPlugin if plugin is JSONParserPlugin else JSONParserPlugin

        assert plugin().metadata["output_schema"] == other().metadata["output_schema"]
        queries, other_queries = _parameters(plugin)["queries"], _parameters(other)["queries"]
        assert {k: v for k, v in queries.items() if k != "description"} == {
            k: v for k, v in other_queries.items() if k != "description"
        }
