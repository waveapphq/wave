"""Helm Uninstall Plugin (REQ-3.5.3.1 - REQ-3.5.3.5, REQ-3.4.1.5).

Removes a Helm release with the three controls K8s Delete carries where helm has
the flag - Keep History, Ignore Not Found and Cascade - and reports the shared
output core alone, because helm prints no document for an uninstall. A release
that is already gone is an error unless Ignore Not Found is ticked. Carries the
fail-or-record Failure Handling control.
"""

from typing import Any

from wavecore.connectivity.helm.verbs import uninstall
from wavecore.plugins._helm_common import (
    RELEASE_NAMESPACE_DESCRIPTION,
    connection_parameters,
    release_parameter,
    tail_parameters,
    validate_common,
)
from wavecore.plugins._k8s_common import output_core
from wavecore.plugins._verb_bridge import run_verb
from wavecore.plugins.base import PluginBase


class HelmUninstallPlugin(PluginBase):
    """Removes a release, with helm's keep-history, ignore-not-found and cascade controls."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "helm-uninstall",
            "name": "Helm Uninstall",
            "version": "1.0.0",
            "category": "helm",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Removes a Helm release and everything it installed, with helm's own "
                "keep-history, ignore-not-found and cascade controls. Nothing is left to "
                "describe, so the block reports only whether the removal succeeded."
            ),
            "parameters": [
                *connection_parameters(),
                release_parameter("Name of the release to remove"),
                {
                    "name": "keep_history",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": (
                        "Keep the release history so the name stays taken and can be rolled "
                        "back, as helm's --keep-history does"
                    ),
                },
                {
                    "name": "ignore_not_found",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": (
                        "Treat a release that is already gone as a pass instead of an error, "
                        "as helm's --ignore-not-found does"
                    ),
                },
                {
                    "name": "cascade",
                    "type": "string",
                    "required": False,
                    "default": "background",
                    "enum_values": ["background", "foreground", "orphan"],
                    "description": (
                        "How dependent objects are removed: 'background' deletes them after "
                        "the owner, 'foreground' before it, 'orphan' leaves them in place"
                    ),
                },
                *tail_parameters(
                    namespace=RELEASE_NAMESPACE_DESCRIPTION,
                ),
            ],
            "return_type": "map",
            "output_schema": [*output_core(gated=True)],
            "author": "WAVE Framework",
            "tags": ["helm", "kubernetes", "uninstall", "delete", "release"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the session, the enums, the release name, and the timeout."""
        validate_common(params, self.metadata["parameters"], enums=("cascade", "on_error"))

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Remove the release, then report the output core alone."""
        return await run_verb(uninstall.run, context["parameters"], context)
