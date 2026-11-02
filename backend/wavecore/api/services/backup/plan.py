"""The restore plan of a backup: every part planned without a write (REQ-5.2.4.9.6)."""

import copy
from collections import Counter
from collections.abc import Callable, Collection, Hashable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from functools import partial
from typing import Any, Self

from wavecore.api.services import shared, variable_service
from wavecore.api.services.backup import links
from wavecore.api.services.backup._helpers import BACKUP_ENTITY_TYPES, RESTORE_ORDER
from wavecore.api.services.environments import service as environment_service
from wavecore.api.services.functions import import_export as function_import
from wavecore.api.services.functions import service as function_service
from wavecore.api.services.network import certificate_facts, certificates, ssh_hosts
from wavecore.api.services.profiles import service as profile_service
from wavecore.api.services.profiles._common import document_problem
from wavecore.api.services.regressions import service as regression_service
from wavecore.api.services.suites import service as suite_service
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.tests import testdata_service
from wavecore.core.functions.references import iter_blocks

_HISTORY_KEY = "version_history"
_STAGES = ("preview", "result")
_WRITING = ("create", "overwrite", "rename")
_TYPE_NAMES = {
    "tests": "Test",
    "environments": "Environment",
    "profiles": "Profile",
    "suites": "Suite",
    "regressions": "Regression",
    "functions": "Function",
}
_NORMALIZE: dict[str, Callable[[str], str]] = {"environments": str.strip}
_CONFLICT_CODES = {"id": "ALREADY_HERE", "both": "ALREADY_HERE", "name": "NAME_IN_USE"}
_FUNCTION_FINDING_CODES = {"STRUCTURAL": "FINDING", "INVALID_VERSION": "FINDING"}
_REPLACING_CHOICES: dict[str, tuple[str, ...]] = {
    "system_variables": ("overwrite", "rename"),
    "ssh_hosts": ("overwrite",),
    "certificates": (),
}

_NOWHERE = "in the backup or in this WAVE"
_NOT_HERE = "in this WAVE"
_SAME_RUN_WORDS = {"id": "ID", "name": "name"}
# Keyed by the code and whether the canvas item has a name.
_NAME_TEXTS = {
    ("FINDING", True): 'Block "{block}": {message}',
    ("MISSING_FUNCTION_ID", False): "Uses a Function that is not {where}",
}
_TEXTS = {
    "ALREADY_HERE": "Already in this WAVE",
    "NAME_IN_USE": "Name already in use",
    "NO_NAME": "Has no name",
    "MISSING_FUNCTION_ID": 'Uses Function "{block}", which is not {where}',
    "MISSING_FUNCTION_VERSION": 'Uses Function "{function_name}" {version}, which is not {where}',
    "MISSING_SUITE": "Uses a Suite that is not {where}",
    "RUNNING": "The {type} here is running",
    "SAME_RUN": "The backup holds another {type} with this {same}",
    "AMBIGUOUS_NAME": "Several {type}s here have this name",
    "CIRCULAR": function_import.CIRCULAR_TEXT,
    "WRITE_FAILED": "Could not be written: {error}",
    "FINDING": "{message}",
    "NO_TYPE": "Has no type",
    "NO_VARIABLES": "Holds no variables",
    "NAME_TAKEN": "Another {type} here has this name",
    "UNREADABLE_KEY": "Unreadable key",
    "INVALID_CERTIFICATE": "Not a valid certificate",
    "UNREADABLE_MEMBER": "Cannot be read",
}

_Texts = tuple[str, str]
_Check = Callable[[dict[str, Any], shared.ItemTarget], _Texts | None]


@dataclass(frozen=True)
class PlanItem:
    """One item of a backup and what a restore does with it."""

    name: str
    source_id: str | None
    status: str
    reason: str = ""
    result_reason: str = ""
    action: str = "none"
    target_id: str | None = None
    target_name: str | None = None
    document: dict[str, Any] | None = None
    history: list[dict[str, Any]] = field(default_factory=list)
    decision: function_import.EntryDecision | None = None

    def changed(self, **changes: Any) -> Self:
        """A copy of the item with the given fields changed."""
        return type(self)(**{**vars(self), **changes})


@dataclass(frozen=True)
class RestorePlan:
    """Every part of a backup as planned, the id maps and the ticked parts."""

    parts: dict[str, list[PlanItem]]
    id_maps: dict[str, dict[str, str]]
    selected: list[str]


# ---------------------------------------------------------------------------
# Reasons
# ---------------------------------------------------------------------------


def reason_text(code: str, parts: Mapping[str, Any], *, stage: str) -> str:
    """The text of one reason, from its code, its keys and the stage (BACKUP-6)."""
    template = _NAME_TEXTS.get((code, bool(parts.get("block"))), _TEXTS[code])
    here_only = stage == "result" or parts.get("in_archive")
    return template.format(
        **parts,
        where=_NOT_HERE if here_only else _NOWHERE,
        same=_SAME_RUN_WORDS.get(parts.get("match", "")),
        circle=" -> ".join(parts.get("path", ())),
    )


def _own_name(finding: Mapping[str, Any], document: Mapping[str, Any]) -> str | None:
    """The label of a finding when its block carries that name in the document."""
    label, node_id = finding.get("node_label"), finding.get("node_id")
    if not isinstance(label, str) or not label.strip():
        return None
    for block in iter_blocks(document.get("workflow")):
        data = block.get("data")
        if block.get("id") == node_id and isinstance(data, dict) and data.get("label") == label:
            return label
    return None


def _missing_function_reason(
    finding: Mapping[str, Any],
    stage: str,
    in_archive: Callable[..., bool],
    function_name: Callable[[str], str | None],
    document: Mapping[str, Any],
) -> str:
    function_id, version = finding.get("function_id", ""), finding.get("function_version")
    parts: dict[str, Any] = {"block": _own_name(finding, document)}
    known = finding["code"] == "MISSING_FUNCTION_VERSION" and function_name(function_id)
    if known:
        parts.update(function_name=known, version=version)
        parts["in_archive"] = in_archive(function_id, version)
        return reason_text("MISSING_FUNCTION_VERSION", parts, stage=stage)
    parts["in_archive"] = in_archive(function_id)
    return reason_text("MISSING_FUNCTION_ID", parts, stage=stage)


def reason_from_findings(
    findings: Sequence[Mapping[str, Any]],
    *,
    stage: str,
    in_archive: Callable[..., bool],
    function_name: Callable[[str], str | None],
    document: Mapping[str, Any],
) -> str:
    """The reason of an item that fails its save validation, read off its first finding."""
    finding = findings[0]
    if finding.get("code") in ("MISSING_FUNCTION_ID", "MISSING_FUNCTION_VERSION"):
        return _missing_function_reason(finding, stage, in_archive, function_name, document)
    parts = {"message": finding.get("message", ""), "block": finding.get("node_label")}
    return reason_text("FINDING", parts, stage=stage)


def _texts(code: str, parts: Mapping[str, Any] | None = None) -> _Texts:
    preview, result = (reason_text(code, parts or {}, stage=stage) for stage in _STAGES)
    return preview, result


# ---------------------------------------------------------------------------
# Plan state
# ---------------------------------------------------------------------------


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _label(position: int, *names: str | None) -> str:
    """The first name an item has, else its position in its part, counted from 1."""
    return next(filter(None, names), f"Entry {position}")


def _id_map(items: Iterable[PlanItem]) -> dict[str, str]:
    ids: dict[str, str] = {}
    for item in items:
        if item.source_id and item.target_id:
            ids.setdefault(item.source_id, item.target_id)
    return ids


@dataclass
class _Run:
    """The options of one plan and the parts planned so far."""

    entities: Mapping[str, Sequence[dict[str, Any]]]
    selected: Collection[str]
    resolution: str
    auto_repair: bool
    items: dict[str, list[PlanItem]] = field(default_factory=dict)
    id_maps: dict[str, dict[str, str]] = field(default_factory=dict)

    def add(self, part: str, items: list[PlanItem]) -> None:
        self.items[part] = items
        self.id_maps[part] = _id_map(items)

    def ids(self, part: str) -> dict[str, str]:
        """The id map of a part planned earlier; empty when that part is not ticked."""
        return self.id_maps.get(part, {}) if part in self.selected else {}

    def written(self, part: str) -> list[tuple[str, PlanItem]]:
        """The id each written item of a ticked part gets, with the item."""
        return [
            (item.target_id, item)
            for item in self.items.get(part, ())
            if part in self.selected and item.target_id and item.action in _WRITING
        ]


@dataclass
class _Present:
    """The names of one part by id: what is here plus what the plan wrote earlier in the run."""

    names: dict[str, str]
    written: set[str] = field(default_factory=set)

    def add(self, item: PlanItem) -> None:
        if item.target_id and item.target_name and item.action in _WRITING:
            self.names[item.target_id] = item.target_name
            self.written.add(item.target_id)


def _unwritten(item: PlanItem, status: str, texts: _Texts) -> PlanItem:
    return item.changed(
        status=status,
        reason=texts[0],
        result_reason=texts[1],
        action="none",
        target_id=None,
        target_name=None,
    )


def _matched(item: PlanItem, target: shared.ItemTarget | function_import.EntryDecision) -> PlanItem:
    """The item as its match and the conflict choice leave it, before its checks."""
    code = _CONFLICT_CODES.get(target.conflict or "")
    reason, result_reason = _texts(code) if code else ("", "")
    return item.changed(
        status="conflict" if code else "ok",
        reason=reason,
        result_reason=result_reason,
        action=target.action or "none",
        target_id=target.target_id,
        target_name=target.target_name,
    )


# ---------------------------------------------------------------------------
# Tests, Suites, Regressions, Environments, Profiles
# ---------------------------------------------------------------------------


def _documents_here(part: str) -> list[dict[str, Any]]:
    if part == "environments":
        return environment_service.list_environment_documents()
    if part == "profiles":
        return profile_service.list_profile_documents()
    with_history = {
        "tests": test_service.list_test_documents,
        "suites": suite_service.list_suite_documents,
        "regressions": regression_service.list_regression_documents,
    }[part]()
    return [document for document, _rows in with_history]


def _names_here(part: str) -> dict[str, str]:
    return {document["id"]: document.get("name", "") for document in _documents_here(part)}


def _linked_document(run: _Run, part: str, document: dict[str, Any]) -> dict[str, Any]:
    if part == "tests":
        function_ids, profile_ids = run.ids("functions"), run.ids("profiles")
        return links.remap_test(document, function_ids=function_ids, profile_ids=profile_ids)
    if part == "suites":
        return links.remap_suite(document, test_ids=run.ids("tests"))
    if part == "profiles":
        return links.remap_profile(document, environment_ids=run.ids("environments"))
    return copy.deepcopy(document)


def _linked(
    run: _Run, part: str, raw: Mapping[str, Any]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """A copy of an archive document with its links rewritten, and its history rows."""
    document = {key: value for key, value in raw.items() if key != _HISTORY_KEY}
    history = raw.get(_HISTORY_KEY) or []
    if part == "regressions":
        return links.remap_regression(document, history, suite_ids=run.ids("suites"))
    return _linked_document(run, part, document), copy.deepcopy(history)


def _versions_of(document: Mapping[str, Any] | None) -> dict[str, Mapping[str, Any]]:
    """Version -> definition of every version the import writes for an archive Function."""
    records = function_import.entry_version_records(document or {})
    return {version: definition for version, definition, _metadata in records}


@dataclass(frozen=True)
class _Library:
    """The Function library as it stands after the planned restore (REQ-5.2.4.9.5)."""

    registry: dict[str, dict[str, Any]]
    contracts: dict[tuple[str, str], dict[str, Any]]
    held: dict[str, set[str]]
    reference_index: dict[str, set[str]]

    def contract(self, function_id: str, version: str) -> dict[str, Any] | None:
        planned = self.contracts.get((function_id, version))
        return planned or function_service.resolve_version_contract(function_id, version)

    def in_archive(self, function_id: str, version: str | None = None) -> bool:
        versions = self.held.get(function_id)
        return versions is not None and (version is None or version in versions)

    def function_name(self, function_id: str) -> str | None:
        return _text(self.registry.get(function_id, {}).get("name"))

    def reasons(self, findings: Sequence[Mapping[str, Any]], document: Mapping[str, Any]) -> _Texts:
        preview, result = (
            reason_from_findings(
                findings,
                stage=stage,
                in_archive=self.in_archive,
                function_name=self.function_name,
                document=document,
            )
            for stage in _STAGES
        )
        return preview, result


def _held_versions(run: _Run) -> dict[str, set[str]]:
    """Function id -> the versions the backup holds, under its backup id and its planned id."""
    ticked = "functions" in run.selected
    held: dict[str, set[str]] = {}
    for item in run.items.get("functions", ()):
        for function_id in filter(None, (item.source_id, item.target_id if ticked else None)):
            held.setdefault(function_id, set()).update(_versions_of(item.document))
    return held


def _planned_library(run: _Run) -> _Library:
    registry = function_service.load_library_index()
    contracts: dict[tuple[str, str], dict[str, Any]] = {}
    for function_id, item in run.written("functions"):
        versions = _versions_of(item.document)
        stored = registry.get(function_id, {}).get("available_versions") or []
        registry[function_id] = {
            **(item.document or {}),
            "id": function_id,
            "name": item.target_name,
            "available_versions": list(dict.fromkeys([*versions, *stored])),
        }
        for version, definition in versions.items():
            contracts[function_id, version] = {
                "inputs": definition.get("inputs") or [],
                "outputs": definition.get("outputs") or [],
            }
    return _Library(
        registry, contracts, _held_versions(run), function_service.load_reference_index()
    )


def _check_test(
    library: _Library, document: dict[str, Any], target: shared.ItemTarget
) -> _Texts | None:
    findings = test_service.validate_test_data_for_create(
        document,
        check_name=False,
        function_registry=library.registry,
        contract_loader=library.contract,
        reference_index=library.reference_index,
    )
    if findings:
        return library.reasons(findings, document)
    if target.action == "overwrite" and testdata_service.is_running(str(target.target_id)):
        return _texts("RUNNING", {"type": _TYPE_NAMES["tests"]})
    return None


def _variables_problem(variables: Any) -> str | None:
    """The first variable value a save refuses, in the save's words (REQ-3.1.3.14)."""
    errors = shared.variable_value_errors(variables)
    return errors[0]["message"] if errors else None


def _check_variables(document: dict[str, Any], _target: shared.ItemTarget) -> _Texts | None:
    problem = _variables_problem(document.get("variables"))
    return None if problem is None else _texts("FINDING", {"message": problem})


def _check_regression(
    after: Collection[str],
    backed_up: Collection[str | None],
    document: dict[str, Any],
    target: shared.ItemTarget,
) -> _Texts | None:
    for suite_id in document.get("suites") or []:
        if suite_id not in after:
            return _texts("MISSING_SUITE", {"in_archive": suite_id in backed_up})
    return _check_variables(document, target)


def _check_profile(document: dict[str, Any], _target: shared.ItemTarget) -> _Texts | None:
    problem = document_problem(document, str(document.get("type") or "custom"))
    return None if problem is None else _texts("FINDING", {"message": problem})


def _no_check(_document: dict[str, Any], _target: shared.ItemTarget) -> None:
    return None


def _check_of(run: _Run, part: str) -> _Check:
    if part == "tests":
        return partial(_check_test, _planned_library(run))
    if part == "regressions":
        after = {*_names_here("suites"), *(suite_id for suite_id, _item in run.written("suites"))}
        backed_up = {item.source_id for item in run.items.get("suites", ())}
        return partial(_check_regression, after, backed_up)
    if part == "suites":
        return _check_variables
    if part == "profiles":
        return _check_profile
    return _no_check


def _repaired(run: _Run, item: PlanItem, document: dict[str, Any]) -> PlanItem:
    """A profile without a type: written as `custom` with auto-repair, else left out."""
    if not run.auto_repair:
        return _unwritten(item, "fixable", _texts("NO_TYPE"))
    repaired = {**document, "type": "custom"}
    return item.changed(status="fixable", reason="", result_reason="", document=repaired)


def _document_item(
    run: _Run, part: str, present: _Present, check: _Check, position: int, raw: Mapping[str, Any]
) -> PlanItem:
    document, history = _linked(run, part, raw)
    source_id, name = _text(raw.get("id")), _text(raw.get("name"))
    label = _label(position, name, source_id)
    item = PlanItem(label, source_id, "fatal", document=document, history=history)
    if name is None:
        return _unwritten(item, "fatal", _texts("NO_NAME"))
    target = shared.decide_item_target(
        source_id=source_id,
        name=name,
        resolution=run.resolution,
        names_by_id=dict(sorted(present.names.items())),
        written_ids=present.written,
        normalize=_NORMALIZE.get(part),
    )
    if target.blocked:
        match = "name" if target.conflict == "name" else "id"
        refusal = _texts(target.blocked, {"type": _TYPE_NAMES[part], "match": match})
        return _unwritten(item, "fatal", refusal)
    item = _matched(item, target)
    if target.action == "skip":
        return item
    failure = check(document, target)
    if failure:
        return _unwritten(item, "fatal", failure)
    if part == "profiles" and not document.get("type"):
        return _repaired(run, item, document)
    return item


def _plan_documents(run: _Run, part: str, documents: Sequence[dict[str, Any]]) -> list[PlanItem]:
    present = _Present(_names_here(part))
    check = _check_of(run, part)
    items: list[PlanItem] = []
    for position, raw in enumerate(documents, 1):
        item = _document_item(run, part, present, check, position, raw)
        present.add(item)
        items.append(item)
    return items


# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------


def _function_item(position: int, decision: function_import.EntryDecision) -> PlanItem:
    name = _text(decision.entry.get("name"))
    label = _label(position, name, decision.source_id)
    item = PlanItem(label, decision.source_id, "fatal", document=decision.entry, decision=decision)
    code, parts = (decision.finding or ("", {})) if name else ("NO_NAME", {})
    if code:
        return _unwritten(item, "fatal", _texts(_FUNCTION_FINDING_CODES.get(code, code), parts))
    return _matched(item, decision)


def _plan_functions(run: _Run, _part: str, documents: Sequence[dict[str, Any]]) -> list[PlanItem]:
    profile_ids = run.ids("profiles")
    entries = [
        links.remap_function_document(document, profile_ids=profile_ids) for document in documents
    ]
    decisions = function_import.decide_entries(entries, lambda _name: run.resolution)
    return [_function_item(position, decision) for position, decision in enumerate(decisions, 1)]


# ---------------------------------------------------------------------------
# System Variables, SSH Hosts, Additional Certificates
# ---------------------------------------------------------------------------


def _already_here(run: _Run, part: str, item: PlanItem) -> PlanItem:
    reason, result_reason = _texts("ALREADY_HERE")
    action = run.resolution if run.resolution in _REPLACING_CHOICES[part] else "skip"
    return item.changed(
        status="conflict", reason=reason, result_reason=result_reason, action=action
    )


def _plan_system_variables(
    run: _Run, part: str, documents: Sequence[dict[str, Any]]
) -> list[PlanItem]:
    here = bool(variable_service.get_system_variables().get("variables"))
    items: list[PlanItem] = []
    for document in documents:
        item = PlanItem("System variables", None, "ok", action="create", document=document)
        problem = _variables_problem(document.get("variables"))
        if not document.get("variables"):
            item = _unwritten(item, "fatal", _texts("NO_VARIABLES"))
        elif problem is not None:
            item = _unwritten(item, "fatal", _texts("FINDING", {"message": problem}))
        elif here:
            item = _already_here(run, part, item)
        items.append(item)
    return items


@dataclass(frozen=True)
class _NetworkPart:
    """How the entries of one network part are named, checked and matched."""

    label: Callable[[Mapping[str, Any]], str]
    problem: Callable[[Mapping[str, Any]], str | None]
    conflict_key: Callable[[Mapping[str, Any]], Hashable]
    saved_keys: Collection[Hashable]
    fatal_code: str


def _certificate_label(entry: Mapping[str, Any]) -> str:
    """The name the Certificates page shows, else the stored id."""
    try:
        certificate = certificate_facts.single_ca_certificate(str(entry.get("pem", "")))
    except ValueError:
        return _text(entry.get("id")) or ""
    return str(certificate_facts.row_of(certificate)["name"])


def _network_part(part: str) -> _NetworkPart:
    if part == "ssh_hosts":
        return _NetworkPart(
            label=ssh_hosts.entry_label,
            problem=ssh_hosts.backup_entry_problem,
            conflict_key=ssh_hosts.conflict_key,
            saved_keys={ssh_hosts.conflict_key(entry) for entry in ssh_hosts.saved_entries()},
            fatal_code="UNREADABLE_KEY",
        )
    return _NetworkPart(
        label=_certificate_label,
        problem=certificates.backup_entry_problem,
        conflict_key=certificates.conflict_key,
        saved_keys={entry["id"] for entry in certificates.saved_entries()},
        fatal_code="INVALID_CERTIFICATE",
    )


def _plan_network(run: _Run, part: str, entries: Sequence[dict[str, Any]]) -> list[PlanItem]:
    kind = _network_part(part)
    # An earlier entry of the archive with the same key counts as saved here.
    taken = set(kind.saved_keys)
    items: list[PlanItem] = []
    for position, entry in enumerate(entries, 1):
        label = _label(position, kind.label(entry))
        item = PlanItem(label, None, "ok", action="create", document=entry)
        if kind.problem(entry) is not None:
            item = _unwritten(item, "fatal", _texts(kind.fatal_code))
        elif (key := kind.conflict_key(entry)) in taken:
            item = _already_here(run, part, item)
        else:
            taken.add(key)
        items.append(item)
    return items


# ---------------------------------------------------------------------------
# The plan and its preview
# ---------------------------------------------------------------------------

_PLANNERS: dict[str, Callable[[_Run, str, Sequence[dict[str, Any]]], list[PlanItem]]] = {
    "functions": _plan_functions,
    "system_variables": _plan_system_variables,
    "ssh_hosts": _plan_network,
    "certificates": _plan_network,
}


def _unreadable_items(member_names: Iterable[str]) -> list[PlanItem]:
    reason, result_reason = _texts("UNREADABLE_MEMBER")
    return [PlanItem(name, None, "fatal", reason, result_reason) for name in sorted(member_names)]


def build_plan(
    entities: Mapping[str, Sequence[dict[str, Any]]],
    *,
    unreadable: Mapping[str, Sequence[str]],
    selected: Collection[str] | None,
    conflict_resolution: str,
    auto_repair: bool,
) -> RestorePlan:
    """Plan the restore of a parsed backup across its parts; nothing is written."""
    held = [part for part in BACKUP_ENTITY_TYPES if part in entities or part in unreadable]
    ticked = [part for part in held if selected is None or part in selected]
    run = _Run(entities, ticked, conflict_resolution, auto_repair)
    for part in RESTORE_ORDER:
        if part in held:
            planner = _PLANNERS.get(part, _plan_documents)
            run.add(part, planner(run, part, entities.get(part, ())))
    return RestorePlan(
        parts={
            part: [*run.items[part], *_unreadable_items(unreadable.get(part, ()))] for part in held
        },
        id_maps={part: run.id_maps[part] for part in held if part in _TYPE_NAMES},
        selected=ticked,
    )


def _part_preview(items: Sequence[PlanItem]) -> dict[str, Any]:
    counts = Counter(item.status for item in items)
    listed = [item for status in ("fatal", "conflict") for item in items if item.status == status]
    return {
        "total": len(items),
        "ok": counts["ok"],
        "conflicts": counts["conflict"],
        "fixable": counts["fixable"],
        "fatal": counts["fatal"],
        "items": [
            {"name": item.name, "status": item.status, "reason": item.reason} for item in listed
        ],
    }


def preview_of(plan: RestorePlan) -> dict[str, Any]:
    """The preview of a restore: counts and the entries to look at, per part in display order."""
    return {part: _part_preview(items) for part, items in plan.parts.items()}
