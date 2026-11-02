"""Helm Upgrade Plugin (REQ-3.5.3.3, REQ-3.4.1.5).

Upgrades a release to a new chart or new values through the machine's own helm
executable. On top of Install's rows it carries helm's values rules - Install if
missing, and the Reuse / Reset pair that helm never accepts together - plus
Cleanup on Fail beside Atomic. The new revision's document becomes Result,
shaped by Output Format, and its status becomes the Status scalar.
"""

from typing import Any

from wavecore.connectivity.helm.verbs import upgrade
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

_BOTH_SET_MESSAGE = "Parameter 'reuse_values' and 'reset_values' cannot both be set"


class HelmUpgradePlugin(PluginBase):
    """Upgrades a Helm release to a new chart or new values."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "helm-upgrade",
            "name": "Helm Upgrade",
            "version": "1.0.0",
            "category": "helm",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Upgrades a Helm release to a new chart or new values through the machine's "
                "own helm executable, with helm's values rules, chart-repository credentials, "
                "and the Atomic and Cleanup on Fail controls."
            ),
            "parameters": [
                *connection_parameters(),
                release_parameter("Name of the release to upgrade (helm's positional RELEASE)"),
                *chart_parameters(
                    chart=(
                        "Chart to upgrade to: a repository chart name like bitnami/nginx, a "
                        "local path, or a chart reference"
                    ),
                    version=(
                        "Chart version to upgrade to (--version); empty takes the newest the "
                        "repository serves"
                    ),
                    values=(
                        "Values YAML the new revision renders with, written to a file and "
                        "passed as --values"
                    ),
                ),
                {
                    "name": "install",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": ("Install the release when it does not exist yet (--install)"),
                },
                {
                    "name": "reuse_values",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": (
                        "Keep the previous revision's values and merge the new ones on top "
                        "(--reuse-values)"
                    ),
                },
                {
                    "name": "reset_values",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": (
                        "Drop the previous revision's values and start from the chart "
                        "defaults (--reset-values)"
                    ),
                },
                output_format_parameter(),
                *auth_parameters(),
                *tail_parameters(
                    namespace=INSTALL_NAMESPACE_DESCRIPTION,
                    create_namespace=(
                        "Create the namespace when it does not exist yet "
                        "(--create-namespace); helm accepts it only together with 'install'"
                    ),
                    atomic=(
                        "Roll the release back to the previous revision when the upgrade "
                        "fails (--atomic); helm waits for readiness by its own definition"
                    ),
                    cleanup_on_fail=(
                        "Delete the resources this upgrade created when it fails "
                        "(--cleanup-on-fail)"
                    ),
                ),
            ],
            "return_type": "map",
            "output_schema": release_outputs(
                "The revision helm produced. Its type follows 'output_format': a "
                "table with one row for the release, the release document for "
                "'map', text for 'json' and 'yaml'"
            ),
            "author": "WAVE Framework",
            "tags": ["helm", "upgrade", "release", "chart", "kubernetes"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the session, the enums, the required rows, the timeouts and the values rules."""
        validate_common(
            params,
            self.metadata["parameters"],
            required=("release", "chart"),
            positive=("timeout", "cleanup_timeout"),
        )
        if params.get("reuse_values") and params.get("reset_values"):
            raise ValueError(_BOTH_SET_MESSAGE)

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Resolve a WAVE-side chart, upgrade the release and hand back the new revision."""
        return await run_verb(upgrade.run, context["parameters"], context, prepare=prepare)
