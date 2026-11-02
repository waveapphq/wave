"""Helm Status Plugin (REQ-3.5.3.4, REQ-3.4.1.5).

Reads one Helm release, the live revision or an older one, into the Result a
sheet renders and into the Status scalar a Wait Until block polls. helm status
has no operation timeout of its own, so this block's Timeout bounds the read
alone. Carries the family output core and the fail-or-record Failure Handling
control, under which a missing release is the existence check.
"""

from typing import Any

from wavecore.connectivity.helm._cli import STATUS_TIMEOUT
from wavecore.connectivity.helm.verbs import status
from wavecore.plugins._helm_common import (
    RELEASE_NAMESPACE_DESCRIPTION,
    connection_parameters,
    output_format_parameter,
    release_outputs,
    release_parameter,
    tail_parameters,
    validate_common,
)
from wavecore.plugins._verb_bridge import run_verb
from wavecore.plugins.base import PluginBase


class HelmStatusPlugin(PluginBase):
    """Reads one Helm release, the current revision or an older one."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "helm-status",
            "name": "Helm Status",
            "version": "1.0.0",
            "category": "helm",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Reads one Helm release through the machine's own helm executable - the "
                "current revision or an older one - as a table row, the full release "
                "document, or JSON or YAML text, with the release status as a scalar a "
                "Wait Until block can poll."
            ),
            "parameters": [
                *connection_parameters(STATUS_TIMEOUT, description=None),
                release_parameter("Name of the release to read (helm's positional RELEASE)"),
                {
                    "name": "revision",
                    "type": "integer",
                    "required": False,
                    "description": ("Revision to read (--revision); empty reads the current one"),
                },
                output_format_parameter(),
                *tail_parameters(namespace=RELEASE_NAMESPACE_DESCRIPTION),
            ],
            "return_type": "map",
            "output_schema": release_outputs(
                "The release helm read. Its type follows 'output_format': a table "
                "with one row for the release, the release document for 'map', "
                "text for 'json' and 'yaml'",
                "The release status helm reported: deployed, failed, pending-install, "
                "pending-upgrade, pending-rollback, superseded or uninstalled",
            ),
            "author": "WAVE Framework",
            "tags": ["helm", "status", "release", "read", "kubernetes"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the session, the enums, the release name and the numbers."""
        validate_common(params, self.metadata["parameters"], positive=("timeout", "revision"))

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Read the release and hand back its document and the status scalar."""
        return await run_verb(status.run, context["parameters"], context)
