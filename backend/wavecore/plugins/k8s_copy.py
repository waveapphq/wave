"""K8s Copy Plugin (REQ-5.1.1, REQ-3.4.1.5).

Copies a file or a directory between a pod and the WAVE side over the same exec
channel K8s Exec uses, the way kubectl cp does. The WAVE side is an artifact
path or an absolute or relative path; on WAVE the plugin resolves it to an
absolute path before the K8s Copy verb runs, so the verb never sees a scheme
and a bad path fails the block whatever On error says. The only unique output
is Summary, one row per file; Error and Reason are gated on Record and continue.
"""

from typing import Any

from wavecore.connectivity.k8s.verbs import cp
from wavecore.plugins._file_paths import resolve_plugin_path
from wavecore.plugins._k8s_common import (
    impersonation_parameters,
    namespace_parameters,
    on_error_parameter,
    output_core,
    require_impersonation_user,
    require_session,
    session_parameter,
    timeout_parameter,
    validate_enums,
)
from wavecore.plugins._shared_params import (
    check_limits,
    gate,
    limit_parameters,
    require_positive,
)
from wavecore.plugins._verb_bridge import run_verb
from wavecore.plugins.base import PluginBase

_ENUM_PARAMS = ("direction", "on_error")
_PATH_PARAMS = ("source_path", "target_path")

_FROM_POD = "from_pod"
_TO_POD_GATE = [{"field": "direction", "values": ["to_pod"]}]
_WAVE_SIDE = "an artifact path, or an absolute or relative path where the block runs"
_LIMIT_EFFECT = (
    "The copy stops the moment it goes over and removes what it wrote. 0 means no limit."
)


def _pulling(params: dict[str, Any]) -> bool:
    return bool(params.get("direction", _FROM_POD) == _FROM_POD)


def prepare(params: dict[str, Any], context: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Resolve the WAVE side of the copy to an absolute path; Copy has no values to mask."""
    pulling = _pulling(params)
    wave_side = "target_path" if pulling else "source_path"
    paths = {name: str(params[name]).strip() for name in _PATH_PARAMS}
    paths[wave_side] = str(
        resolve_plugin_path(
            paths[wave_side],
            context.get("artifacts_dir"),
            context.get("testdata_dirs"),
            read_only_ok=not pulling,
        )
    )
    return {**params, **paths}, []


class K8sCopyPlugin(PluginBase):
    """Moves files between a pod and the WAVE side over the exec channel."""

    @property
    def metadata(self) -> dict[str, Any]:
        """Plugin metadata declaration."""
        return {
            "id": "k8s-copy",
            "name": "K8s Copy",
            "version": "1.0.0",
            "category": "kubernetes",
            "remotable": True,
            "proxy_support": "supported",
            "description": (
                "Copies a file or a directory between a pod and the WAVE side over the exec "
                "channel, the way kubectl cp does. The WAVE side is the run's artifacts or an "
                "absolute or relative path where the block runs; directories are copied whole."
            ),
            "parameters": [
                session_parameter(),
                timeout_parameter(cp.TIMEOUT_DEFAULT),
                {
                    "name": "direction",
                    "type": "string",
                    "required": True,
                    "default": _FROM_POD,
                    "enum_values": [_FROM_POD, "to_pod"],
                    "description": (
                        "Which way the file moves: out of the pod onto the WAVE side, or "
                        "from WAVE into the pod."
                    ),
                },
                {
                    "name": "pod",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "description": "The pod to copy from or to.",
                },
                {
                    "name": "container",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "description": (
                        "Which container in the pod to use. Name it even when the pod has only one."
                    ),
                },
                {
                    "name": "source_path",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "description": "The file or directory inside the pod to copy.",
                    "description_when": [
                        {
                            "when": _TO_POD_GATE,
                            "description": (
                                f"The file or directory on the WAVE side to copy: {_WAVE_SIDE}."
                            ),
                        }
                    ],
                },
                {
                    "name": "target_path",
                    "type": "string",
                    "trim": True,
                    "required": True,
                    "description": f"Where to put it on the WAVE side: {_WAVE_SIDE}.",
                    "description_when": [
                        {"when": _TO_POD_GATE, "description": "Where to put it inside the pod."}
                    ],
                },
                {
                    "name": "no_preserve",
                    "type": "boolean",
                    "required": False,
                    "default": False,
                    "description": (
                        "Do not carry the file's permissions and ownership across. "
                        "kubectl preserves them by default."
                    ),
                },
                *namespace_parameters(all_namespaces=False),
                *impersonation_parameters(),
                *limit_parameters(
                    max_size_mib=cp.MAX_SIZE_MIB_DEFAULT,
                    max_files=cp.MAX_FILES_DEFAULT,
                    show_when=gate("direction", _FROM_POD),
                    size_description=(
                        f"Largest total a copy from the pod may write, in MiB. {_LIMIT_EFFECT}"
                    ),
                    files_description=f"Most files a copy from the pod may write. {_LIMIT_EFFECT}",
                ),
                on_error_parameter(),
            ],
            "return_type": "map",
            "output_schema": [
                {
                    "name": "summary",
                    "type": "table",
                    "description": (
                        "One row per file: where it came from, where it landed, and its size."
                    ),
                },
                *output_core(gated=True),
            ],
            "author": "WAVE Framework",
            "tags": ["kubernetes", "k8s", "cp", "copy", "file"],
        }

    async def validate(self, params: dict[str, Any]) -> None:
        """Validate the session, enums, pod and container, both paths, the timeout and limits."""
        require_session(params)
        require_impersonation_user(params)
        validate_enums(params, _ENUM_PARAMS, self.metadata["parameters"])
        if not params.get("pod"):
            raise ValueError("Missing required parameter: pod")
        if not params.get("container"):
            raise ValueError("Missing required parameter: container")
        for name in _PATH_PARAMS:
            if name not in params:
                raise ValueError(f"Missing required parameter: {name}")
            if not str(params[name] or "").strip():
                raise ValueError(f"Parameter '{name}' cannot be empty")
        require_positive(params, "timeout")
        if _pulling(params):
            check_limits(params)

    async def execute(self, context: dict[str, Any]) -> dict[str, Any]:
        """Resolve the WAVE side, then move the file the direction asks for."""
        return await run_verb(cp.run, context["parameters"], context, prepare=prepare)
