"""The metadata and validation checks the six Helm plugin test files share.

Every Helm block carries the same family furniture: the K8s session, an
operation timeout, the Advanced namespace / Helm Path / impersonation rows, the
Failure Handling enum and the gated output core. Install and Upgrade also share
the chart row and the hook that resolves a WAVE-side chart before the argv is
built. These helpers assert that furniture once so each block's own file is only
about what makes it different.
"""

from pathlib import Path
from typing import Any
from unittest.mock import patch

from tests.connectivity.helm._helm_fixtures import CHART, FakeRunHelm, patch_run_helm
from tests.plugins.k8s._k8s_fixtures import execute_context
from wavecore.plugins import _file_paths

CHART_ARCHIVE = f"{CHART}-0.1.0.tgz"
OCI_CHART = "oci://registry.example.com/charts/wave-demo"
BARE_CHART = "bitnami/nginx"
CHART_FORMS = [
    "artifact-archive",
    "artifact-folder",
    "testdata-archive",
    "bare-name",
    "oci-reference",
    "absolute-path",
    "relative-archive",
    "relative-folder",
    "dot-relative-missing",
]

RECORD_GATE = {"field": "on_error", "values": ["record"]}
HELM_PATH_DESCRIPTION = (
    "The helm executable to run: a name looked up on the PATH where the block runs, or a "
    "path; a relative path starts at the home folder of the account the block runs as. "
    "Empty runs 'helm' from the PATH"
)
REPO_CA_CERT_DESCRIPTION = (
    "The PEM bundle that verifies the chart repository's certificate; when set, it is the "
    "only certificate trusted. Empty trusts the certificates WAVE trusts "
    "(Settings > Network > Certificates)."
)
OUTPUT_FORMATS = ["map", "table", "json", "yaml"]
FORMAT_TYPE_RULES = [
    {"when": [{"field": "output_format", "values": ["map"]}], "type": "map"},
    {"when": [{"field": "output_format", "values": ["json", "yaml"]}], "type": "string"},
]
CORE_DESCRIPTIONS = {
    "success": (
        "True when the cluster carried out the operation without error; false when "
        "On error is Record and continue and the cluster refused it"
    ),
    "error": (
        "The error message when the operation failed under Record and continue; empty otherwise"
    ),
    "reason": (
        "The cluster reason for the failure, like NotFound or Forbidden; empty when the "
        "operation succeeded"
    ),
}


def params_by_name(plugin: Any) -> dict[str, dict[str, Any]]:
    """The block's parameter declarations, keyed by wire name."""
    return {param["name"]: param for param in plugin.metadata["parameters"]}


def outputs_by_name(plugin: Any) -> dict[str, dict[str, Any]]:
    """The block's output declarations, keyed by wire name."""
    return {output["name"]: output for output in plugin.metadata["output_schema"]}


def assert_family_metadata(plugin: Any, element_id: str, name: str) -> None:
    """The identity every Helm block declares."""
    metadata = plugin.metadata

    assert metadata["id"] == element_id
    assert metadata["name"] == name
    assert metadata["version"] == "1.0.0"
    assert metadata["category"] == "helm"
    assert metadata["remotable"] is True
    assert metadata["proxy_support"] == "supported"
    assert metadata["return_type"] == "map"
    assert metadata["author"] == "WAVE Framework"


def assert_session_row(plugin: Any) -> None:
    """The session is the required secret input every Helm block reads."""
    session = params_by_name(plugin)["session"]

    assert session["type"] == "string"
    assert session["required"] is True
    assert session["secret"] is True
    assert session["trim"] is True


def assert_timeout_row(plugin: Any, default: int, *, helm_operation: bool) -> None:
    """Timeout is helm's own --timeout on every block but Status."""
    timeout = params_by_name(plugin)["timeout"]

    assert timeout["type"] == "integer"
    assert timeout["required"] is False
    assert timeout["default"] == default
    assert ("helm" in timeout["description"]) is helm_operation


def assert_release_row(plugin: Any) -> None:
    """Release Name is the one positional every Helm block requires."""
    release = params_by_name(plugin)["release"]

    assert release["type"] == "string"
    assert release["required"] is True
    assert release["trim"] is True


def assert_advanced_rows(plugin: Any) -> None:
    """Namespace, Helm Path and the impersonation pair, as the family declares them."""
    params = params_by_name(plugin)

    assert params["namespace"]["required"] is False
    assert params["namespace"]["trim"] is True
    assert "read from" not in params["namespace"]["description"]
    assert params["helm_path"]["type"] == "string"
    assert params["helm_path"]["required"] is False
    assert params["helm_path"]["trim"] is True
    assert params["helm_path"]["description"] == HELM_PATH_DESCRIPTION
    assert params["impersonate_user"]["type"] == "string"
    assert params["impersonate_groups"]["type"] == "string"


def assert_on_error_row(plugin: Any) -> None:
    """Failure Handling is the family's own enum, unchanged."""
    on_error = params_by_name(plugin)["on_error"]

    assert on_error["default"] == "fail"
    assert on_error["enum_values"] == ["fail", "record"]


def assert_output_format_row(plugin: Any) -> None:
    """Output Format keeps the family's values and defaults to Table."""
    output_format = params_by_name(plugin)["output_format"]

    assert output_format["enum_values"] == OUTPUT_FORMATS
    assert output_format["default"] == "table"
    assert output_format["required"] is False


def assert_output_core(plugin: Any) -> None:
    """Success is always shown; Error and Reason only under Record and continue."""
    outputs = outputs_by_name(plugin)

    assert outputs["success"]["type"] == "boolean"
    assert "show_when" not in outputs["success"]
    assert outputs["error"]["show_when"] == RECORD_GATE
    assert outputs["reason"]["show_when"] == RECORD_GATE
    assert {name: outputs[name]["description"] for name in CORE_DESCRIPTIONS} == CORE_DESCRIPTIONS


def assert_result_output(plugin: Any) -> None:
    """Result is a table by default and follows Output Format from there."""
    result = outputs_by_name(plugin)["result"]

    assert result["type"] == "table"
    assert result["type_when"] == FORMAT_TYPE_RULES


def assert_no_wait_row(plugin: Any) -> None:
    """HELM-2: no Helm block carries a wait row under any name."""
    names = [param["name"] for param in plugin.metadata["parameters"]]

    assert [name for name in names if "wait" in name or "poll" in name] == []


async def execute_verb(
    plugin: Any, verb: str, params: dict[str, Any], results: list[Any], **context: Any
) -> tuple[Any, FakeRunHelm]:
    """Run the block end to end with helm replaced by the recorder."""
    fake = FakeRunHelm(results)
    with patch_run_helm(verb, fake):
        outputs = await plugin.execute(execute_context(params, **context))
    return outputs, fake


def assert_chart_row(plugin: Any) -> None:
    """Chart is the required single argument."""
    chart = params_by_name(plugin)["chart"]

    assert chart["type"] == "string"
    assert chart["required"] is True
    assert chart["trim"] is True
    assert "remote_host_path_only" not in chart


def seed_chart(root: Path, form: str) -> tuple[str, str, dict[str, Any]]:
    """One chart form on disk: (the reference, the argument helm must run, context keys)."""
    artifacts = root / "artifacts"
    testdata = root / "testdata"
    if form == "artifact-archive":
        target = artifacts / "charts" / CHART_ARCHIVE
        target.parent.mkdir(parents=True)
        target.write_bytes(b"chart archive")
        return f"artifact://charts/{CHART_ARCHIVE}", str(target), {"artifacts_dir": str(artifacts)}
    if form == "artifact-folder":
        target = artifacts / "charts" / CHART
        target.mkdir(parents=True)
        (target / "Chart.yaml").write_text(f"name: {CHART}\n", encoding="utf-8")
        return f"artifact://charts/{CHART}", str(target), {"artifacts_dir": str(artifacts)}
    if form == "testdata-archive":
        target = testdata / CHART_ARCHIVE
        target.parent.mkdir(parents=True)
        target.write_bytes(b"chart archive")
        return f"testdata://{CHART_ARCHIVE}", str(target), {"testdata_dirs": [str(testdata)]}
    if form == "bare-name":
        return BARE_CHART, BARE_CHART, {}
    if form == "oci-reference":
        return OCI_CHART, OCI_CHART, {}
    home = _file_paths.home_folder()
    if form == "relative-archive":
        target = home / "charts" / CHART_ARCHIVE
        target.parent.mkdir(parents=True)
        target.write_bytes(b"chart archive")
        return f"charts/{CHART_ARCHIVE}", str(target), {}
    if form == "relative-folder":
        (home / "charts" / CHART).mkdir(parents=True)
        return f"charts/x/../{CHART}", str(home / "charts" / CHART), {}
    if form == "dot-relative-missing":
        return f"./charts/{CHART}", str(home / "charts" / CHART), {}
    target = root / "local" / CHART_ARCHIVE
    target.parent.mkdir(parents=True)
    target.write_bytes(b"chart archive")
    return str(target), str(target), {}


async def captured_prepare(module: Any, plugin: Any, params: dict[str, Any]) -> Any:
    """The prepare hook the block hands the verb bridge on one execute()."""
    seen: dict[str, Any] = {}

    async def _bridge(
        verb_run: Any,
        verb_params: dict[str, Any],
        context: dict[str, Any],
        *,
        prepare: Any = None,
    ) -> dict[str, Any]:
        seen["prepare"] = prepare
        return {}

    with patch.object(module, "run_verb", _bridge):
        await plugin.execute(execute_context(params))
    return seen["prepare"]
