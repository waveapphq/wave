"""The run/assert helpers the six Helm verb test files share.

Each verb is driven through a recorder standing in for run_helm, so no helm
process is ever started; the row sets below are the "every row filled in" sheet
the argv assertions are written against.
"""

from typing import Any

from tests.connectivity.helm._helm_fixtures import FakeRunHelm, patch_run_helm
from tests.plugins.k8s._k8s_fixtures import RecordingLog

FULL_NAMESPACE: dict[str, Any] = {"namespace": "team"}
FULL_ADVANCED: dict[str, Any] = {
    "helm_path": "/opt/helm",
    "impersonate_user": "wave-reader",
    "impersonate_groups": "qa, ops",
}
FULL_IMPERSONATION = [
    "--kube-as-user",
    "wave-reader",
    "--kube-as-group",
    "qa",
    "--kube-as-group",
    "ops",
]


def _verb_name(module: Any) -> str:
    return str(module.__name__).rsplit(".", 1)[-1]


def run_verb(
    module: Any, params: dict[str, Any], results: list[Any], log: Any = None
) -> FakeRunHelm:
    """Run one verb against scripted helm results and hand back the recorder."""
    fake = FakeRunHelm(results)
    with patch_run_helm(_verb_name(module), fake):
        module.run(params, RecordingLog() if log is None else log)
    return fake


def envelope_of(
    module: Any, params: dict[str, Any], results: list[Any], log: Any = None
) -> dict[str, Any]:
    """The result envelope one verb returns."""
    fake = FakeRunHelm(results)
    with patch_run_helm(_verb_name(module), fake):
        envelope: dict[str, Any] = module.run(params, RecordingLog() if log is None else log)
    return envelope


def outputs_of(
    module: Any, params: dict[str, Any], results: list[Any], log: Any = None
) -> dict[str, Any]:
    """The block outputs one verb returns."""
    outputs: dict[str, Any] = envelope_of(module, params, results, log)["outputs"]
    return outputs


def assert_failure_outputs(outputs: dict[str, Any], message: str, reason: str) -> None:
    """The output core a recorded failure leaves behind."""
    assert outputs["success"] is False
    assert outputs["error"] == message
    assert outputs["reason"] == reason
    assert outputs["__block_warning"] is True
