"""Helm Rollback Plugin (REQ-3.5.3.5, REQ-3.4.1.5).

Rolls a Helm release back to an earlier revision, or to the one before the
current when Revision is empty, exactly as helm does. helm prints only text for
a rollback, so the landed release is read back with helm status and shaped into
Result and Status. Carries the family output core and the fail-or-record Failure
Handling control.
"""

from typing import Any

from wavecore.connectivity.helm.verbs import rollback
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


class HelmRollbackPlugin(PluginBase):
    """Rolls a release back to an earlier revision and reports what helm left behind."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "helm-rollback",
            "name": "Helm Rollback",
            "version": "1.0.0",
            "category": "helm",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Rolls a Helm release back to an earlier revision, or to the one before "
                "the current when Revision is empty, then reports the release helm left "
                "behind as a WAVE table, the release document, or JSON or YAML text."
            ),
            "parameters": [
                *connection_parameters(),
                release_parameter("Name of the release to roll back"),
                {
                    "name": "revision",
                    "type": "integer",
                    "required": False,
                    "description": (
                        "Revision number to roll back to; empty rolls back to the revision "
                        "before the current one, as helm does"
                    ),
                },
                output_format_parameter(),
                *tail_parameters(
                    namespace=RELEASE_NAMESPACE_DESCRIPTION,
                    cleanup_on_fail=(
                        "Delete the resources this rollback created when it fails, as "
                        "helm's --cleanup-on-fail does"
                    ),
                ),
            ],
            "return_type": "map",
            "output_schema": release_outputs(
                "The release helm reports once the rollback has landed. Its type "
                "follows 'output_format': a table for 'table', the release document "
                "for 'map', text for 'json' and 'yaml'",
                "The release status after the rollback, like deployed or failed",
            ),
            "author": "WAVE Framework",
            "tags": ["helm", "kubernetes", "rollback", "release"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the session, the enums, the release name, and the three numbers."""
        validate_common(
            params,
            self.metadata["parameters"],
            positive=("timeout", "revision", "cleanup_timeout"),
        )

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Roll the release back, then read the landed release with helm status."""
        return await run_verb(rollback.run, context["parameters"], context)
