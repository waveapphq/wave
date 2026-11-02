"""Helm Install Plugin (REQ-3.5.3.1, REQ-3.4.1.5).

Installs a chart as a new release through the machine's own helm executable,
carrying helm's chart source, values, chart-repository credentials and Atomic
controls. The release document helm prints becomes Result, shaped by Output
Format, and its status becomes the Status scalar. Carries the family output
core and the fail-or-record Failure Handling control.
"""

from typing import Any

from wavecore.connectivity.helm.verbs import install
from wavecore.plugins._helm_common import (
    INSTALL_NAMESPACE_DESCRIPTION,
    auth_parameters,
    chart_parameters,
    connection_parameters,
    output_format_parameter,
    prepare,
    release_outputs,
    release_parameter,
    tail_parameters,
    validate_common,
)
from wavecore.plugins._verb_bridge import run_verb
from wavecore.plugins.base import PluginBase


class HelmInstallPlugin(PluginBase):
    """Installs a chart as a new Helm release."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "helm-install",
            "name": "Helm Install",
            "version": "1.0.0",
            "category": "helm",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Installs a Helm chart as a new release through the machine's own helm "
                "executable, with the chart source, values, chart-repository credentials "
                "and Atomic controls helm itself carries."
            ),
            "parameters": [
                *connection_parameters(),
                release_parameter("Name the release is created under (helm's positional RELEASE)"),
                *chart_parameters(
                    chart=(
                        "Chart to install: a repository chart name like bitnami/nginx, a "
                        "local path, or a chart reference"
                    ),
                    version=(
                        "Chart version to install (--version); empty takes the newest the "
                        "repository serves"
                    ),
                    values=(
                        "Values YAML the chart renders with, written to a file and passed "
                        "as --values"
                    ),
                ),
                output_format_parameter(),
                *auth_parameters(),
                *tail_parameters(
                    namespace=INSTALL_NAMESPACE_DESCRIPTION,
                    create_namespace=(
                        "Create the namespace when it does not exist yet (--create-namespace)"
                    ),
                    atomic=(
                        "Delete the release when the install fails so the name stays free "
                        "(--atomic); helm waits for readiness by its own definition"
                    ),
                ),
            ],
            "return_type": "map",
            "output_schema": release_outputs(
                "The release helm installed. Its type follows 'output_format': a "
                "table with one row for the release, the release document for "
                "'map', text for 'json' and 'yaml'"
            ),
            "author": "WAVE Framework",
            "tags": ["helm", "install", "release", "chart", "kubernetes"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the session, the enums, the required rows and the two timeouts."""
        validate_common(
            params,
            self.metadata["parameters"],
            required=("release", "chart"),
            positive=("timeout", "cleanup_timeout"),
        )

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Resolve a WAVE-side chart, install it and hand back the release document."""
        return await run_verb(install.run, context["parameters"], context, prepare=prepare)
