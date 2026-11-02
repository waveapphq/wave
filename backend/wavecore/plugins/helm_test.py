"""Helm Test Plugin (REQ-3.5.3.2, REQ-3.4.1.5).

Runs a chart's test hooks against an installed release and reports one row per
hook, read back from the release record rather than parsed out of helm's text,
plus every test pod's log when Logs is ticked. A failed run under Record and
continue still fills Result and Logs: they are what the block exists to produce.
Carries the family output core and the fail-or-record Failure Handling control.
"""

from typing import Any

from wavecore.connectivity.helm.verbs import test
from wavecore.plugins._helm_common import (
    RELEASE_NAMESPACE_DESCRIPTION,
    connection_parameters,
    output_format_parameter,
    release_parameter,
    result_output,
    tail_parameters,
    validate_common,
)
from wavecore.plugins._k8s_common import output_core
from wavecore.plugins._verb_bridge import run_verb
from wavecore.plugins.base import PluginBase


class HelmTestPlugin(PluginBase):
    """Runs a chart's test hooks and reports one row per hook, with the pod logs on request."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "helm-test",
            "name": "Helm Test",
            "version": "1.0.0",
            "category": "helm",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Runs the test hooks a chart ships against an installed release and reports "
                "one row per hook with its phase and timings, plus every test pod's log when "
                "Logs is on. A chart with no tests passes with an empty table, as in helm."
            ),
            "parameters": [
                *connection_parameters(),
                release_parameter("Name of the release whose test hooks are run"),
                {
                    "name": "logs",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": (
                        "Collect each test pod's log and hand it back in the 'logs' output, "
                        "as helm's --logs does"
                    ),
                },
                output_format_parameter(
                    "Shape of 'result': 'table' is a WAVE table with one row per test "
                    "hook, 'map' is the release document, 'json' and 'yaml' are that "
                    "document as text"
                ),
                *tail_parameters(
                    namespace=RELEASE_NAMESPACE_DESCRIPTION,
                ),
            ],
            "return_type": "map",
            "output_schema": [
                result_output(
                    "The test hooks the release records, one row each with its name, "
                    "kind, phase and start and end times. Its type follows "
                    "'output_format': the release document for 'map', text for 'json' "
                    "and 'yaml'"
                ),
                {
                    "name": "logs",
                    "type": "string",
                    "description": (
                        "Each test pod's log under helm's own 'POD LOGS:' header, in the "
                        "order helm printed them"
                    ),
                    "show_when": {"field": "logs", "values": ["true"]},
                },
                *output_core(gated=True),
            ],
            "author": "WAVE Framework",
            "tags": ["helm", "kubernetes", "test", "hook", "release"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the session, the enums, the release name, and the timeout."""
        validate_common(params, self.metadata["parameters"])

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Run the chart's test hooks, then read the release back for the hook records."""
        return await run_verb(test.run, context["parameters"], context)
