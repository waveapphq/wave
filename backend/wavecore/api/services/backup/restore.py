"""The restore of a backup: its plan written part by part (REQ-5.2.4.9.5, REQ-5.2.4.9.6)."""

import copy
import logging
from collections.abc import Callable, Mapping, Sequence
from functools import partial
from typing import Any

from wavecore.api.exceptions import WaveException
from wavecore.api.services import shared, variable_service
from wavecore.api.services.backup._helpers import (
    _HISTORY_KEY,
    BACKUP_ENTITY_TYPES,
    RESTORE_ORDER,
    TestDataFiles,
    _list_entities,
)
from wavecore.api.services.backup.plan import (
    PlanItem,
    RestorePlan,
    reason_from_findings,
    reason_text,
)
from wavecore.api.services.environments import service as environment_service
from wavecore.api.services.functions import import_export as function_import
from wavecore.api.services.functions import service as function_service
from wavecore.api.services.network import certificates, ssh_hosts
from wavecore.api.services.profiles import import_export as profile_import
from wavecore.api.services.profiles import service as profile_service
from wavecore.api.services.profiles._common import stored_document
from wavecore.api.services.regressions import service as regression_service
from wavecore.api.services.relations import service as relation_service
from wavecore.api.services.suites import service as suite_service
from wavecore.api.services.tests import service as test_service

logger = logging.getLogger(__name__)

_WRITING = ("create", "overwrite", "rename")
_RESULT_STATUSES = ("fatal", "skipped")
_RELATION_PARTS = ("suites", "regressions")
_VARIABLE_PARTS = ("tests", "suites", "regressions")
_SECRET_PARTS = frozenset({*_VARIABLE_PARTS, "profiles"})
_NETWORK_REASONS = {
    "ssh_hosts": {"skipped": "ALREADY_HERE", "fatal": "UNREADABLE_KEY"},
    "certificates": {"skipped": "ALREADY_HERE", "fatal": "INVALID_CERTIFICATE"},
}
_SAVE_VALIDATION_ERRORS = (test_service.SaveValidationError, function_service.SaveValidationError)

_Entry = dict[str, str]
_Outcome = _Entry | None


# ---------------------------------------------------------------------------
# Result entries
# ---------------------------------------------------------------------------


def _entry(item: PlanItem, status: str, reason: str) -> _Entry:
    return {"name": item.name, "status": status, "reason": reason}


def _unwritten(item: PlanItem) -> _Entry:
    """The entry of an item the plan does not write: skipped, else fatal."""
    status = "skipped" if item.action == "skip" else "fatal"
    return _entry(item, status, item.result_reason)


def _fatal(part: str, item: PlanItem, error_text: str, reason: str) -> _Entry:
    logger.error("Restore of %s '%s' failed: %s", part, item.name, error_text)
    return _entry(item, "fatal", reason)


def _error_text(error: Exception) -> str:
    """The message of a WAVE error, else the text of the error, else its class name."""
    if isinstance(error, WaveException):
        return error.message
    return str(error) or type(error).__name__


def _not_written(error_text: str) -> str:
    return reason_text("WRITE_FAILED", {"error": error_text}, stage="result")


def _write_failed(part: str, item: PlanItem, error_text: str) -> _Entry:
    return _fatal(part, item, error_text, _not_written(error_text))


def _finding_reason(findings: Sequence[Mapping[str, Any]], document: Mapping[str, Any]) -> str:
    names = {row["id"]: row["name"] for row in function_service.library_summaries()}
    # The result text never depends on what the backup holds.
    return reason_from_findings(
        findings,
        stage="result",
        in_archive=lambda *_held: False,
        function_name=names.get,
        document=document,
    )


def _failed(part: str, item: PlanItem, error: Exception) -> _Entry:
    """The fatal entry of an item whose write raised (REQ-5.2.4.9.6)."""
    if isinstance(error, _SAVE_VALIDATION_ERRORS):
        reason = _finding_reason(error.errors, item.document or {})
        return _fatal(part, item, reason, reason)
    return _write_failed(part, item, _error_text(error))


def _attempt(part: str, item: PlanItem, write: Callable[[PlanItem], None]) -> _Outcome:
    """Write one item; an error makes that item fatal and the restore goes on."""
    if item.action not in _WRITING:
        return _unwritten(item)
    try:
        write(item)
    except Exception as error:
        return _failed(part, item, error)
    return None


def _part_result(outcomes: Sequence[_Outcome]) -> dict[str, Any]:
    entries = {
        status: [entry for entry in outcomes if entry and entry["status"] == status]
        for status in _RESULT_STATUSES
    }
    return {
        "imported": sum(1 for entry in outcomes if entry is None),
        "skipped": len(entries["skipped"]),
        "fatal": len(entries["fatal"]),
        "items": [entry for status in _RESULT_STATUSES for entry in entries[status]],
    }


# ---------------------------------------------------------------------------
# Tests, Suites, Regressions, Environments, Profiles
# ---------------------------------------------------------------------------


def _overwritten_here(part: str, items: Sequence[PlanItem]) -> dict[str, dict[str, Any]]:
    """The stored documents an Overwrite replaces, by id, where a secret can be masked."""
    targets = {item.target_id for item in items if item.action == "overwrite"}
    if part not in _SECRET_PARTS or not targets:
        return {}
    return {
        document["id"]: document for document in _list_entities(part) if document["id"] in targets
    }


def _settle_secrets(part: str, document: dict[str, Any], here: Mapping[str, Any]) -> None:
    """A placeholder keeps the secret stored at its place here; it, and a secret another
    WAVE sealed, are otherwise stored as null and stay secret (REQ-4.5.19, EXPORT-7)."""
    if part in _VARIABLE_PARTS and "variables" in document:
        document["variables"] = shared.settle_imported_secret_variables(
            document["variables"], here.get("variables")
        )
    if part == "tests" and "workflow" in document:
        document["workflow"] = shared.settle_imported_workflow_secrets(
            document["workflow"], here.get("workflow")
        )
    if part == "profiles":
        profile_import.settle_imported_profile_secrets(document, dict(here))


def _settled_row(row: dict[str, Any], kept: Mapping[str, Any]) -> dict[str, Any]:
    """A history row whose snapshot variables keep the secrets the same row stores here."""
    snapshot = row.get("snapshot")
    if not isinstance(snapshot, dict) or "variables" not in snapshot:
        return row
    here = (kept.get("snapshot") or {}).get("variables")
    variables = shared.settle_imported_secret_variables(snapshot["variables"], here)
    return {**row, "snapshot": {**snapshot, "variables": variables}}


def _settled_history(
    history: Sequence[dict[str, Any]], here: Mapping[str, Any]
) -> list[dict[str, Any]]:
    kept = {row.get("version"): row for row in here.get(_HISTORY_KEY) or []}
    return [_settled_row(row, kept.get(row.get("version")) or {}) for row in history]


def _write_document(
    part: str, stored: Mapping[str, dict[str, Any]], files: TestDataFiles, item: PlanItem
) -> None:
    here = stored.get(item.target_id or "", {}) if item.action == "overwrite" else {}
    document = copy.deepcopy(item.document or {})
    document["id"], document["name"] = item.target_id, item.target_name
    _settle_secrets(part, document, here)
    history = _settled_history(copy.deepcopy(item.history), here)
    if part == "tests":
        test_service.persist_test_document(
            document,
            history,
            list(files.get(item.source_id or "", ())),
            replace_files=item.action == "overwrite",
        )
    elif part == "suites":
        suite_service.persist_suite_document(document, history)
    elif part == "regressions":
        regression_service.persist_regression_document(document, history)
    elif part == "environments":
        environment_service.persist_environment_document(document)
    else:
        profile_type = str(document.get("type") or "custom")
        profile_service.persist_profile_document(stored_document(document, profile_type))


def _apply_documents(part: str, items: Sequence[PlanItem], files: TestDataFiles) -> list[_Outcome]:
    write = partial(_write_document, part, _overwritten_here(part, items), files)
    return [_attempt(part, item, write) for item in items]


# ---------------------------------------------------------------------------
# System Variables, Functions, SSH Hosts, Additional Certificates
# ---------------------------------------------------------------------------


def _merge_system_variables(item: PlanItem) -> None:
    here = variable_service.get_system_variables().get("variables", {})
    stored = variable_service.get_system_variables_raw()["variables"]
    incoming = shared.settle_imported_secret_variables((item.document or {})["variables"], stored)
    variable_service.set_system_variables({**here, **incoming})


def _apply_system_variables(
    part: str, items: Sequence[PlanItem], _files: TestDataFiles
) -> list[_Outcome]:
    return [_attempt(part, item, _merge_system_variables) for item in items]


def _function_outcome(part: str, item: PlanItem, outcome: function_import.EntryOutcome) -> _Outcome:
    if outcome.action == "failed":
        return _write_failed(part, item, outcome.reason or "")
    return _unwritten(item) if outcome.action == "skipped" else None


def _apply_functions(part: str, items: Sequence[PlanItem], _files: TestDataFiles) -> list[_Outcome]:
    decisions = [item.decision for item in items if item.decision is not None]
    outcomes = function_import.commit_decisions(decisions)
    return [
        _function_outcome(part, item, outcome)
        for item, outcome in zip(items, outcomes, strict=True)
    ]


def _network_outcomes(part: str, items: Sequence[PlanItem]) -> list[str]:
    """One outcome per entry, from one call of the part's own restore."""
    entries = [item.document for item in items if item.document is not None]
    if part == "certificates":
        return list(certificates.restore_certificates(entries)["outcomes"])
    choice = "overwrite" if any(item.action == "overwrite" for item in items) else "skip"
    return list(ssh_hosts.restore_entries(entries, choice)["outcomes"])


def _network_outcome(part: str, item: PlanItem, outcome: str) -> _Outcome:
    code = _NETWORK_REASONS[part].get(outcome)
    return _entry(item, outcome, reason_text(code, {}, stage="result")) if code else None


def _network_failed(part: str, items: Sequence[PlanItem], error: Exception) -> list[_Outcome]:
    """Every entry of a part whose one call raised is fatal; a planned fatal keeps its reason."""
    error_text = _error_text(error)
    logger.error("Restore of %s failed: %s", part, error_text)
    reason = _not_written(error_text)
    return [
        _unwritten(item) if item.status == "fatal" else _entry(item, "fatal", reason)
        for item in items
    ]


def _apply_network(part: str, items: Sequence[PlanItem], _files: TestDataFiles) -> list[_Outcome]:
    try:
        outcomes = _network_outcomes(part, items)
    except Exception as error:
        return _network_failed(part, items, error)
    return [
        _network_outcome(part, item, outcome) for item, outcome in zip(items, outcomes, strict=True)
    ]


# ---------------------------------------------------------------------------
# The plan applied
# ---------------------------------------------------------------------------

_APPLIERS: dict[str, Callable[[str, Sequence[PlanItem], TestDataFiles], list[_Outcome]]] = {
    "system_variables": _apply_system_variables,
    "functions": _apply_functions,
    "ssh_hosts": _apply_network,
    "certificates": _apply_network,
}


def _apply_part(part: str, items: Sequence[PlanItem], files: TestDataFiles) -> dict[str, Any]:
    parsed = [item for item in items if item.document is not None]
    applier = _APPLIERS.get(part, _apply_documents)
    unreadable = [_unwritten(item) for item in items if item.document is None]
    return _part_result([*applier(part, parsed, files), *unreadable])


def apply_plan(plan: RestorePlan, testdata_files: TestDataFiles) -> dict[str, Any]:
    """Write the ticked parts of a plan in restore order; one result per part, in display order."""
    results: dict[str, dict[str, Any]] = {}
    for part in RESTORE_ORDER:
        if part in plan.selected:
            results[part] = _apply_part(part, plan.parts[part], testdata_files)
    if any(results[part]["imported"] for part in _RELATION_PARTS if part in results):
        relation_service.rebuild()
    return {part: results[part] for part in BACKUP_ENTITY_TYPES if part in results}
