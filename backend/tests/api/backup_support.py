"""Store plumbing, document builders and entry points shared by the backup restore tests."""

import copy
import io
import itertools
import json
import shutil
import uuid
import zipfile
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import asyncssh
import pytest
import yaml

from tests.plugins.http.tls_material import make_credential
from wavecore.api.services import settings_file, storage_paths, variable_service
from wavecore.api.services.backup import service as backup_service
from wavecore.api.services.backup import uploads as backup_uploads
from wavecore.api.services.environments import service as environment_service
from wavecore.api.services.functions import _storage as function_storage
from wavecore.api.services.functions import service as function_service
from wavecore.api.services.network import certificate_facts, certificates
from wavecore.api.services.profiles import _common as profile_common
from wavecore.api.services.profiles import service as profile_service
from wavecore.api.services.regressions import service as regression_service
from wavecore.api.services.relations import service as relation_service
from wavecore.api.services.suites import service as suite_service
from wavecore.api.services.tests import service as test_service
from wavecore.api.services.tests import testdata_service
from wavecore.controls.registry import _registry, register_all_core_controls
from wavecore.core.plugin_registry import clear_registry, register_plugin
from wavecore.core.ssh import trusted_hosts
from wavecore.plugins.log import LogPlugin

Document = dict[str, Any]

PARTS = (
    "tests",
    "environments",
    "profiles",
    "suites",
    "regressions",
    "functions",
    "system_variables",
    "ssh_hosts",
    "certificates",
)

# Tests, Suites and Regressions stamp +00:00; Environments and Profiles Z; Functions whole seconds.
ITEM_CREATED = "2026-03-01T08:00:00.123456+00:00"
ITEM_UPDATED = "2026-03-02T09:30:00.654321+00:00"
SETTING_CREATED = "2026-03-01T08:00:00.123456Z"
SETTING_UPDATED = "2026-03-02T09:30:00.654321Z"
PUBLISHED_AT = "2026-03-01T08:00:00Z"
ADDED_AT = "2026-03-01T08:00:00+00:00"

UNREADABLE_SSH_KEY = "ssh-ed25519 AAAAnotakey"
UNKNOWN_TYPE_SSH_KEY = "ssh-unknown AAAAnotakey"
NOT_A_CERTIFICATE = (
    "-----BEGIN CERTIFICATE-----\nTm90IGEgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----\n"
)
UNPARSABLE_MEMBER = b"{not: [parsable"

ROUND_TRIP_FNB_BLOCK = "Run FnB"
ROUND_TRIP_FNA_BLOCK = "FnA step"
ROUND_TRIP_NESTED_BLOCK = "Nested FnA call"
SAMPLE_CSV = b"id,name\n1,alpha\n2,beta\n"


# ---------------------------------------------------------------------------
# Workflow blocks
# ---------------------------------------------------------------------------


def flow(*blocks: Document) -> Document:
    """A workflow that runs the blocks one after another from the start."""
    ids = ["start-node", *(block["id"] for block in blocks)]
    return {
        "nodes": list(blocks),
        "edges": [
            {"id": f"edge-{source}-{target}", "source": source, "target": target}
            for source, target in itertools.pairwise(ids)
        ],
    }


def _block(block_id: str, data: Document) -> Document:
    return {"id": block_id, "type": "workflowNode", "position": {"x": 0, "y": 0}, "data": data}


def _body(name: str, blocks: Sequence[Document]) -> Document:
    return {
        "name": name,
        "description": "",
        "tags": [],
        "inputs": [],
        "outputs": [],
        "dependencies": {"functions": [], "plugins": []},
        "workflow": flow(*blocks),
    }


def profile_binding(profile_id: str, name: str = "bk-profile", alias: str = "db") -> Document:
    """One entry of a block's ``config.profileBindings``."""
    return {"profileId": profile_id, "profileName": name, "profileType": "custom", "alias": alias}


def log_block(
    block_id: str = "log-1",
    label: str = "Log",
    message: str = "hello",
    bindings: Sequence[Document] = (),
) -> Document:
    """A Log block that writes ``message``; ``bindings`` are its profile bindings."""
    return _block(
        block_id,
        {
            "label": label,
            "elementType": "log",
            "nodeType": "plugin",
            "version": "1.0.0",
            "config": {
                "values": {"message": message, "level": "INFO"},
                "outputBindings": {},
                "profileBindings": list(bindings),
            },
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    )


def function_block(
    block_id: str,
    label: str,
    function_id: str,
    version: str = "1.0.0",
    *,
    values: Mapping[str, Any] | None = None,
    **data: Any,
) -> Document:
    """A library Function block pinned to one version; ``values`` are its stored inputs."""
    return _block(
        block_id,
        {
            "label": label,
            "elementType": "function",
            "nodeType": "function",
            "version": version,
            "functionLifecycle": "shared",
            "functionId": function_id,
            "functionVersion": version,
            "config": {"values": dict(values or {}), "outputBindings": {}, "profileBindings": []},
        }
        | data,
    )


def local_function_block(block_id: str, label: str, blocks: Sequence[Document] = ()) -> Document:
    """A Local Function block whose body holds ``blocks``."""
    return _block(
        block_id,
        {
            "label": label,
            "elementType": "function",
            "nodeType": "function",
            "version": "1.0.0",
            "functionLifecycle": "local",
            "localDefinition": _body(label, blocks),
            "config": {"values": {}, "outputBindings": {}, "profileBindings": []},
        },
    )


def draft_block(
    block_id: str,
    label: str,
    function_id: str,
    version: str = "1.0.0",
    blocks: Sequence[Document] = (),
) -> Document:
    """A library Function block in edit mode whose draft holds ``blocks``."""
    return function_block(
        block_id,
        label,
        function_id,
        version,
        editMode=True,
        upstreamLink={"functionId": function_id, "sourceVersion": version},
        draft=_body(label, blocks),
    )


def setter_block(
    block_id: str, label: str, values: Mapping[str, Any], secret_keys: Sequence[str] = ()
) -> Document:
    """A Variable Setter block that writes ``values``; ``secret_keys`` names its secret rows."""
    return _block(
        block_id,
        {
            "label": label,
            "elementType": "variable-setter",
            "nodeType": "control",
            "version": "1.0.0",
            "config": {
                "values": {"variables": dict(values)},
                "outputBindings": {},
                "profileBindings": [],
                "variableSecretKeys": list(secret_keys),
            },
            "expressionFields": [],
            "templateFields": [],
            "variableExpressionKeys": [],
        },
    )


# ---------------------------------------------------------------------------
# Documents in stored shape
# ---------------------------------------------------------------------------


def typed(value: Any, value_type: str = "string", *, secret: bool = False) -> Document:
    """One typed value: a ``variables`` entry or a custom profile field."""
    return {"type": value_type, "secret": secret, "value": value}


def history_row(
    version: str = "1.0.0",
    changes: str = "Initial version",
    *,
    created_at: str = ITEM_CREATED,
    snapshot: Document | None = None,
) -> Document:
    """One version history row; a Regression row carries ``snapshot``."""
    row = {"version": version, "created_at": created_at, "created_by": "system", "changes": changes}
    return row if snapshot is None else row | {"snapshot": snapshot}


def regression_snapshot(
    suites: Sequence[str] = (), description: str = "", variables: Document | None = None
) -> Document:
    """The snapshot a Regression history row carries."""
    return {"description": description, "suites": list(suites), "variables": variables or {}}


def with_history(document: Document, rows: Sequence[Document]) -> Document:
    """The document as a backup archive member holds it, with its history rows."""
    return document | {"version_history": list(rows)}


def make_test(
    name: str = "A test",
    item_id: str | None = None,
    blocks: Sequence[Document] = (),
    **fields: Any,
) -> Document:
    """A Test as ``test.yaml`` holds it; ``blocks`` become its workflow."""
    return {
        "id": item_id or str(uuid.uuid4()),
        "name": name,
        "version": "1.0.0",
        "description": "",
        "workflow": flow(*blocks),
        "variables": {},
        "metadata": {},
        "created_at": ITEM_CREATED,
        "updated_at": ITEM_UPDATED,
    } | fields


def make_suite(
    name: str = "A suite", item_id: str | None = None, tests: Sequence[str] = (), **fields: Any
) -> Document:
    """A Suite as ``suite.yaml`` holds it."""
    return {
        "id": item_id or str(uuid.uuid4()),
        "name": name,
        "version": "1.0.0",
        "description": "",
        "tests": list(tests),
        "tags": [],
        "variables": {},
        "metadata": {},
        "created_at": ITEM_CREATED,
        "updated_at": ITEM_UPDATED,
    } | fields


def make_regression(
    name: str = "A regression",
    item_id: str | None = None,
    suites: Sequence[str] = (),
    **fields: Any,
) -> Document:
    """A Regression as ``regression.yaml`` holds it."""
    return {
        "id": item_id or str(uuid.uuid4()),
        "name": name,
        "version": "1.0.0",
        "description": "",
        "suites": list(suites),
        "tags": [],
        "variables": {},
        "metadata": {},
        "created_at": ITEM_CREATED,
        "updated_at": ITEM_UPDATED,
    } | fields


def make_environment(
    name: str = "An environment", item_id: str | None = None, **fields: Any
) -> Document:
    """An Environment as ``environment.yaml`` holds it; ``description`` only when given."""
    return {
        "id": item_id or str(uuid.uuid4()),
        "name": name,
        "tags": [],
        "created_at": SETTING_CREATED,
        "updated_at": SETTING_UPDATED,
    } | fields


def make_profile(
    name: str = "A profile",
    item_id: str | None = None,
    environment_values: Mapping[str, Document] | None = None,
    *,
    profile_type: str | None = "custom",
    **fields: Any,
) -> Document:
    """A Profile as ``profile.yaml`` holds it; ``profile_type=None`` leaves the type out."""
    profile = {
        "id": item_id or str(uuid.uuid4()),
        "name": name,
        "type": profile_type,
        "environment_values": dict(environment_values or {}),
        "tags": [],
        "created_at": SETTING_CREATED,
        "updated_at": SETTING_UPDATED,
        "config": {},
    } | fields
    if profile_type is None:
        del profile["type"]
    return profile


def function_version(
    version: str = "1.0.0",
    blocks: Sequence[Document] = (),
    *,
    inputs: Sequence[Document] = (),
    outputs: Sequence[Document] = (),
    published_at: str = PUBLISHED_AT,
    **metadata: Any,
) -> Document:
    """One version record of a Function export document; ``blocks`` become its body."""
    return {
        "version": version,
        "definition": {
            "inputs": [dict(item) for item in inputs],
            "outputs": [dict(item) for item in outputs],
            "variables": [],
            "dependencies": {"functions": [], "plugins": []},
            "workflow": flow(*blocks),
        },
        "metadata": {
            "description": "",
            "tags": [],
            "changelog": "",
            "details": "",
            "published_at": published_at,
            "published_by": "wave",
        }
        | metadata,
    }


def make_function(
    name: str = "Fn",
    item_id: str | None = None,
    versions: Sequence[Document] | None = None,
    **fields: Any,
) -> Document:
    """A Function export document: the newest version on top, then every version, newest first."""
    records = list(versions or [function_version()])
    newest = copy.deepcopy(records[0])
    definition, metadata = newest["definition"], newest["metadata"]
    return {
        "id": item_id or str(uuid.uuid4()),
        "name": name,
        "version": newest["version"],
        "description": metadata["description"],
        "tags": metadata["tags"],
        "inputs": definition["inputs"],
        "outputs": definition["outputs"],
        "variables": definition["variables"],
        "dependencies": definition["dependencies"],
        "workflow": definition["workflow"],
        "changelog": metadata["changelog"],
        "details": metadata["details"],
        "available_versions": [record["version"] for record in records],
        "metadata": {
            "author": metadata["published_by"],
            "created_at": records[-1]["metadata"]["published_at"],
            "updated_at": metadata["published_at"],
            "published_at": metadata["published_at"],
            "published_by": metadata["published_by"],
            "changelog": metadata["changelog"],
            "details": metadata["details"],
        },
        "versions": records,
    } | fields


def system_variables(variables: Document | None = None) -> Document:
    """The System Variables document of a backup archive."""
    if variables is None:
        variables = {"api_url": typed("https://wave.example.test")}
    return {"variables": variables}


def ssh_key(algorithm: str = "ssh-ed25519") -> str:
    """A fresh host public key in the text WAVE's trusted hosts list stores."""
    key = asyncssh.generate_private_key(algorithm).convert_to_public()
    return trusted_hosts.public_key_text(key)


def ssh_entry(
    host: str | None = "db1", port: int = 22, public_key: str | None = None, **fields: Any
) -> Document:
    """A trusted SSH host as a backup archive holds it; ``host=None`` leaves the host out."""
    entry = {
        "id": uuid.uuid4().hex,
        "host": host,
        "port": port,
        "public_key": ssh_key() if public_key is None else public_key,
        "added": ADDED_AT,
    } | fields
    if host is None:
        del entry["host"]
    return entry


def certificate_entry(common_name: str = "Backup Lab Root", **fields: Any) -> Document:
    """A fresh CA named ``common_name`` as a backup archive holds an Additional Certificate."""
    cert = make_credential(common_name, key_kind="ec256", is_ca=True).cert
    return {
        "id": certificate_facts.certificate_id(cert),
        "pem": certificate_facts.pem_of(cert),
        "added": ADDED_AT,
    } | fields


def unreadable_certificate_entry(entry_id: str = "0" * 64) -> Document:
    """An Additional Certificate entry whose PEM block is not a certificate."""
    return {"id": entry_id, "pem": NOT_A_CERTIFICATE, "added": ADDED_AT}


MAKERS: dict[str, Callable[..., Document]] = {
    "tests": make_test,
    "environments": make_environment,
    "profiles": make_profile,
    "suites": make_suite,
    "regressions": make_regression,
    "functions": make_function,
}


# ---------------------------------------------------------------------------
# What is here: seeding and reading back
# ---------------------------------------------------------------------------


def _seed_function(document: Document) -> None:
    for record in reversed(document["versions"]):
        function_storage.save_new_version(
            document["id"],
            record["version"],
            record["definition"],
            record["metadata"],
            name=document["name"],
        )


def _seed_ssh_host(entry: Document) -> None:
    path = storage_paths.get_ssh_hosts_file_path()
    settings_file.write(path, {"hosts": [*trusted_hosts.load()["hosts"], entry]})


def _seed_certificate(entry: Document) -> None:
    path = storage_paths.get_certificates_file_path()
    settings_file.write(path, {"certificates": [*certificates.saved_entries(), entry]})


def seed(
    part: str,
    document: Document,
    history: Sequence[Document] = (),
    files: Sequence[tuple[str, bytes]] = (),
) -> None:
    """Store a copy of one document as it is; ``history`` and ``files`` where the part has them."""
    item, rows = copy.deepcopy(document), copy.deepcopy(list(history))
    if part == "tests":
        test_service.persist_test_document(item, rows, list(files), replace_files=False)
    elif part == "suites":
        suite_service.persist_suite_document(item, rows)
    elif part == "regressions":
        regression_service.persist_regression_document(item, rows)
    elif part == "environments":
        environment_service.persist_environment_document(item)
    elif part == "profiles":
        profile_service.persist_profile_document(item)
    elif part == "functions":
        _seed_function(item)
    elif part == "system_variables":
        variable_service.set_system_variables(item["variables"])
    elif part == "ssh_hosts":
        _seed_ssh_host(item)
    elif part == "certificates":
        _seed_certificate(item)
    else:
        raise KeyError(part)


def _stored_pairs(part: str) -> list[tuple[Document, list[Document]]]:
    if part == "tests":
        return list(test_service.list_test_documents())
    if part == "suites":
        return list(suite_service.list_suite_documents())
    if part == "regressions":
        return list(regression_service.list_regression_documents())
    raise KeyError(part)


def stored(part: str) -> dict[str, Document]:
    """The stored documents of an id-carrying part by id; for Functions the library index rows."""
    if part == "environments":
        documents = environment_service.list_environment_documents()
    elif part == "profiles":
        documents = profile_service.list_profile_documents()
    elif part == "functions":
        documents = function_service.library_summaries()
    else:
        documents = [document for document, _rows in _stored_pairs(part)]
    return {document["id"]: document for document in documents}


def stored_history(part: str) -> dict[str, list[Document]]:
    """The stored history rows of every Test, Suite or Regression, by id."""
    return {document["id"]: rows for document, rows in _stored_pairs(part)}


def function_versions(function_id: str) -> list[Document]:
    """The stored version records of a library Function, newest first."""
    return function_storage.list_version_records(function_id)


def data_files(test_id: str) -> dict[str, bytes]:
    """The stored data files of a Test: relative path to content."""
    return {rel: path.read_bytes() for rel, path in testdata_service.iter_files(test_id)}


def disk_state() -> dict[str, bytes]:
    """Every file of the data folder: relative path to content."""
    folder = storage_paths.get_base_path()
    return {
        path.relative_to(folder).as_posix(): path.read_bytes()
        for path in sorted(folder.rglob("*"))
        if path.is_file()
    }


def wipe_store(folder: Path) -> None:
    """Remove every item of the nine parts from the isolated data folder, caches in step."""
    if storage_paths.get_base_path() != folder:
        raise RuntimeError(f"{folder} is not the data folder in use")
    testdata_service.reset_zone()
    test_service._clear_storage()
    environment_service._clear_storage()
    profile_common._clear_storage()
    function_service._clear_in_memory_cache()
    for part_folder in (
        storage_paths.get_suites_storage_path(),
        storage_paths.get_regressions_storage_path(),
        storage_paths.get_functions_storage_path(),
    ):
        shutil.rmtree(part_folder, ignore_errors=True)
    variable_service.delete_all_system_variables()
    storage_paths.get_ssh_hosts_file_path().unlink(missing_ok=True)
    storage_paths.get_certificates_file_path().unlink(missing_ok=True)
    relation_service.rebuild()


# ---------------------------------------------------------------------------
# Archives and the pinned entry points
# ---------------------------------------------------------------------------


def _member_stem(part: str, document: Document, taken: set[str]) -> str:
    base = str(document.get("name") or document.get("id") or part.replace("_", "-"))
    stem, count = base, 1
    while stem in taken:
        count += 1
        stem = f"{base}-{count}"
    taken.add(stem)
    return stem


def archive(
    parts: Mapping[str, Sequence[Document]],
    *,
    files: Mapping[str, Sequence[tuple[str, bytes]]] | None = None,
    raw: Mapping[str, bytes] | None = None,
    fmt: str = "yaml",
) -> bytes:
    """Backup archive bytes: documents per part, data files per Test id, raw members as given."""
    manifest = {
        "wave_version": "1.0.0",
        "created_at": ITEM_CREATED,
        "entity_counts": {part: len(documents) for part, documents in parts.items()},
        "compression": {"method": "deflate", "level": 6},
        "format": fmt,
        "secrets": "mask",
        "schema_version": "1.0",
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for part, documents in parts.items():
            taken: set[str] = set()
            for document in documents:
                text = (
                    json.dumps(document, indent=2)
                    if fmt == "json"
                    else yaml.safe_dump(document, sort_keys=False)
                )
                zf.writestr(f"{part}/{_member_stem(part, document, taken)}.{fmt}", text)
        for test_id, entries in (files or {}).items():
            for rel, data in entries:
                zf.writestr(f"tests/testdata/{test_id}/{rel}", data)
        for member, data in (raw or {}).items():
            zf.writestr(member, data)
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
    return buffer.getvalue()


def backup(parts: Sequence[str] = PARTS, **options: Any) -> bytes:
    """The archive the product makes of what is stored now."""
    return backup_service.create_backup(list(parts), **options)[0]


def build_plan(
    entities: Mapping[str, list[Document]],
    *,
    unreadable: Mapping[str, list[str]] | None = None,
    selected: Sequence[str] | None = None,
    conflict_resolution: str = "skip",
    auto_repair: bool = False,
) -> Any:
    """The restore plan of the parsed parts, with the defaults of the API."""
    from wavecore.api.services.backup import plan

    return plan.build_plan(
        entities,
        unreadable=unreadable or {},
        selected=selected,
        conflict_resolution=conflict_resolution,
        auto_repair=auto_repair,
    )


def preview_of(plan: Any) -> Document:
    """The preview of a restore plan."""
    from wavecore.api.services.backup import plan as planner

    return planner.preview_of(plan)


def apply_plan(
    plan: Any, testdata_files: Mapping[str, list[tuple[str, bytes]]] | None = None
) -> Document:
    """Run a restore plan; ``testdata_files`` are the data files per backup Test id."""
    from wavecore.api.services.backup import restore

    return restore.apply_plan(plan, testdata_files or {})


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@contextmanager
def _clean_store(folder: Path) -> Iterator[Path]:
    _registry.clear()
    register_all_core_controls(_registry)
    clear_registry()
    register_plugin(LogPlugin())
    wipe_store(folder)
    try:
        yield folder
    finally:
        _registry.clear()
        clear_registry()


@pytest.fixture(name="kept_uploads_cleared", autouse=True)
def kept_uploads_cleared_fixture() -> Iterator[None]:
    """No kept backup upload outlives the test that made it."""
    yield
    backup_uploads.clear()


class FakeExpiryTimer:
    """Stands in for the expiry timer of a kept backup upload; the test fires it."""

    made: list["FakeExpiryTimer"] = []

    def __init__(self, seconds: float, callback: Callable[[], None]) -> None:
        self.seconds, self.callback = seconds, callback
        self.daemon = False
        self.started = self.canceled = False
        FakeExpiryTimer.made.append(self)

    def start(self) -> None:
        self.started = True

    def cancel(self) -> None:
        self.canceled = True

    def fire(self) -> None:
        self.callback()


@pytest.fixture(name="expiry_timers")
def expiry_timers_fixture(monkeypatch: pytest.MonkeyPatch) -> list[FakeExpiryTimer]:
    """The expiry timers the test's kept uploads arm, oldest first; none fires on its own."""
    FakeExpiryTimer.made = []
    monkeypatch.setattr(backup_uploads, "EXPIRY", FakeExpiryTimer)
    return FakeExpiryTimer.made


@pytest.fixture(name="empty_store")
def empty_store_fixture(temp_storage_path: Path, seed_test_environment: str) -> Iterator[Path]:
    """The data folder with no item of any part; the Log block and the controls are registered."""
    with _clean_store(temp_storage_path) as folder:
        yield folder


@dataclass(frozen=True)
class RoundTrip:
    """The ids of the round-trip WAVE."""

    environment: str
    profile: str
    fn_a: str
    fn_b: str
    test_fn_b: str
    test_nested: str
    test_plain: str
    suite: str
    regression: str


def _make_round_trip() -> RoundTrip:
    environment = environment_service.create_environment("bk-env", description="Round-trip target")
    profile = profile_service.create_profile(
        "bk-profile",
        "custom",
        description="Round-trip profile",
        tags=["backup"],
        environment_values={environment["id"]: {"host": typed("db.example.test")}},
    )
    fn_a, _etag = function_service.create_function(
        {
            "name": "FnA",
            "workflow": flow(log_block("say", "Say", "FnA 1.0.0")),
            "changelog": "First",
        }
    )
    function_service.add_function_version(
        fn_a["id"],
        source_version="1.0.0",
        target_version="1.1.0",
        draft_definition=_body("FnA", [log_block("say", "Say", "FnA 1.1.0")]),
        changelog="Second",
        description="",
        tags=[],
        details="",
    )
    fn_b, _etag = function_service.create_function(
        {
            "name": "FnB",
            "workflow": flow(function_block("call-a", ROUND_TRIP_FNA_BLOCK, fn_a["id"], "1.0.0")),
        }
    )
    uses_fn_b = test_service.create_test(
        {
            "name": "T uses FnB",
            "description": "Calls FnB",
            "metadata": {"tags": ["backup"], "owner": "ashley"},
            "workflow": flow(
                function_block("run-b", ROUND_TRIP_FNB_BLOCK, fn_b["id"], "1.0.0"),
                log_block("bound", "Bound log", bindings=[profile_binding(profile["id"])]),
            ),
        }
    )
    test_service.update_test(uses_fn_b["id"], {"description": "Calls FnB pinned to 1.0.0"})
    testdata_service.write_files(uses_fn_b["id"], [("sample.csv", SAMPLE_CSV)])
    inner = function_block("inner", ROUND_TRIP_NESTED_BLOCK, fn_a["id"], "1.0.0")
    nested = test_service.create_test(
        {"name": "T nested", "workflow": flow(local_function_block("local", "Local step", [inner]))}
    )
    plain = test_service.create_test({"name": "A plain test", "workflow": flow(log_block())})
    suite = suite_service.create_suite(
        {"name": "bk-suite", "tests": [uses_fn_b["id"], nested["id"], plain["id"]]}
    )
    regression = regression_service.create_regression(
        {"name": "bk-regression", "suites": [suite["id"]]}
    )
    regression_service.update_regression(regression["id"], {"description": "Second version"})
    return RoundTrip(
        environment=environment["id"],
        profile=profile["id"],
        fn_a=fn_a["id"],
        fn_b=fn_b["id"],
        test_fn_b=uses_fn_b["id"],
        test_nested=nested["id"],
        test_plain=plain["id"],
        suite=suite["id"],
        regression=regression["id"],
    )


@pytest.fixture(name="round_trip")
def round_trip_fixture(temp_storage_path: Path, seed_test_environment: str) -> Iterator[RoundTrip]:
    """The round-trip WAVE, made through the real services on an empty store; yields its ids."""
    with _clean_store(temp_storage_path):
        yield _make_round_trip()
