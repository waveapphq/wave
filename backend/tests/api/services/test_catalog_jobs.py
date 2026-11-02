"""The shared catalog job table behind Get Tables and Get fields.

REQ-3.4.1.6 / REQ-5.1.4 (SQL-12) and REQ-3.4.1.15 / REQ-5.1.2 (OS-13): a pull runs once per
connection key on a daemon thread; it is joined while it runs, answered from the cache once
done, replaced by a refresh or by a new start after a failure or a cancel. A cancel stops a
running pull and a late answer for a canceled job is dropped. The rows a pull reads resolve
as a run of the test would, and a row that cannot resolve is refused by its label.
"""

import re
import threading
import time
from collections.abc import Callable, Generator
from datetime import datetime
from typing import Any

import pytest

from tests.api.services._pull_threads import pull_threads_ended
from wavecore.api.exceptions import NotFoundException, UnprocessableEntityException
from wavecore.api.routes.sql_tools import CatalogBody
from wavecore.api.services import catalog_jobs
from wavecore.api.services.profiles import service as profile_service
from wavecore.api.services.tests import service as test_service
from wavecore.core.execution.plugin_executor import resolve_parameters
from wavecore.core.expressions.errors import ExpressionEvaluationError

BOUND = 1.0
KEY = "key-a"
OTHER_KEY = "key-b"
DATA: dict[str, Any] = {
    "indexes": [{"name": "logs-*", "kind": "folded", "count": 3}],
    "fields": [{"name": "@timestamp", "types": ["date"], "aggregatable": True}],
}
OTHER_DATA: dict[str, Any] = {"tables": [{"schema": "public", "name": "orders"}]}
FAILURE_MESSAGE = "Could not connect to os at os:9200: [Errno 111] Connection refused"
REQUEST_FIELDS: dict[str, Any] = {
    "expression_fields": [],
    "template_fields": [],
    "element_types": {},
    "profile_bindings": [],
    "environment_id": None,
    "test_id": None,
    "refresh": False,
}
METADATA: dict[str, Any] = {
    "parameters": [
        {"name": "url", "type": "string"},
        {"name": "index", "type": "string", "trim": True},
        {"name": "connect_timeout", "type": "integer"},
    ]
}
LABELS = {"url": "Cluster URL", "index": "Index pattern", "connect_timeout": "Connect timeout"}
# The same rows with the Connect timeout default a Block declares.
DEFAULTED_METADATA: dict[str, Any] = {
    "parameters": [
        {"name": "url", "type": "string"},
        {"name": "index", "type": "string", "trim": True},
        {"name": "connect_timeout", "type": "integer", "default": 30},
    ]
}


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


class PullFailure(Exception):
    """A failure a pull raises, carrying the message its job settles with."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class SteppedPull:
    """A pull whose connect and read each wait on a test-owned gate; it answers or raises."""

    def __init__(
        self, data: dict[str, Any] | None = None, error: BaseException | None = None
    ) -> None:
        self.data = DATA if data is None else data
        self.error = error
        self.connect_entered = threading.Event()
        self.connect_gate = threading.Event()
        self.read_entered = threading.Event()
        self.read_gate = threading.Event()
        self.jobs: list[Any] = []
        self.threads: list[threading.Thread] = []
        self.marked: list[bool] = []
        self.cancel_reads: list[Any] = []

    def pull(self, job: Any) -> dict[str, Any]:
        self.jobs.append(job)
        self.threads.append(threading.current_thread())
        self.connect_entered.set()
        self.connect_gate.wait(BOUND)
        reading = catalog_jobs.mark_reading(job)
        self.marked.append(reading)
        if reading:
            self.read_entered.set()
            self.read_gate.wait(BOUND)
        if self.error is not None:
            raise self.error
        return self.data

    def cancel_read(self, job: Any) -> None:
        self.cancel_reads.append(job)

    def open(self) -> None:
        self.connect_gate.set()
        self.read_gate.set()

    def finish(self) -> None:
        """Open both gates and wait until the pull's thread has settled its job."""
        self.open()
        for thread in self.threads:
            thread.join(BOUND)


@pytest.fixture(autouse=True)
def registry(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    monkeypatch.setattr(catalog_jobs, "_JOBS", {})
    monkeypatch.setattr(catalog_jobs, "_BY_KEY", {})
    with pull_threads_ended():
        yield


@pytest.fixture
def pulls() -> Generator[Callable[..., SteppedPull], None, None]:
    """Make stepped pulls; every gate is opened at teardown so no thread is left waiting."""
    made: list[SteppedPull] = []

    def make(**kwargs: Any) -> SteppedPull:
        stepped = SteppedPull(**kwargs)
        made.append(stepped)
        return stepped

    yield make
    for stepped in made:
        stepped.finish()


def begin(
    stepped: SteppedPull, key: str = KEY, *, refresh: bool = False, live: Any = None
) -> dict[str, Any]:
    return catalog_jobs.start_job(key, stepped.pull, stepped.cancel_read, live, refresh)


def settled(job_id: str) -> dict[str, Any]:
    """The job's status once it has left connecting and reading, polled within the bound."""
    deadline = time.monotonic() + BOUND
    answer = catalog_jobs.status(job_id)
    while answer["status"] in ("connecting", "reading") and time.monotonic() < deadline:
        answer = catalog_jobs.status(job_id)
    return answer


def pulled(stepped: SteppedPull, key: str = KEY, *, refresh: bool = False) -> str:
    """Start an ungated pull and wait for it to settle; the job id."""
    stepped.open()
    job_id = str(begin(stepped, key, refresh=refresh)["job_id"])
    settled(job_id)
    return job_id


def reading(stepped: SteppedPull) -> str:
    """Start a pull and hold it in its read; the job id."""
    job_id = str(begin(stepped)["job_id"])
    stepped.connect_gate.set()
    assert stepped.read_entered.wait(BOUND)
    return job_id


def connecting(stepped: SteppedPull) -> str:
    """Start a pull and hold it before it reads; the job id."""
    job_id = str(begin(stepped)["job_id"])
    assert stepped.connect_entered.wait(BOUND)
    return job_id


def saved_test(variables: dict[str, Any]) -> str:
    """A saved test declaring `variables`; its id."""
    return str(test_service.create_test({"name": "Catalog Carrier", "variables": variables})["id"])


class TestJobStates:
    """A pull steps from connecting to reading to done, or fails with its message."""

    def test_a_new_pull_answers_its_job_and_is_not_cached(
        self, pulls: Callable[..., SteppedPull]
    ) -> None:
        started = begin(pulls())

        assert started == {"job_id": started["job_id"], "cached": False}
        assert isinstance(started["job_id"], str) and started["job_id"]

    def test_the_job_steps_through_connecting_and_reading_to_done(
        self, pulls: Callable[..., SteppedPull]
    ) -> None:
        stepped = pulls()
        job_id = connecting(stepped)

        assert catalog_jobs.status(job_id) == {"status": "connecting"}
        stepped.connect_gate.set()
        assert stepped.read_entered.wait(BOUND)
        assert catalog_jobs.status(job_id) == {"status": "reading"}
        stepped.read_gate.set()

        assert settled(job_id) == {"status": "done", **DATA}

    def test_the_pull_is_handed_its_job_and_the_live(
        self, pulls: Callable[..., SteppedPull]
    ) -> None:
        stepped = pulls()
        live = object()

        job_id = begin(stepped, live=live)["job_id"]

        assert stepped.connect_entered.wait(BOUND)
        [job] = stepped.jobs
        assert job.id == job_id
        assert job.live is live

    def test_the_pull_runs_on_a_daemon_thread(self, pulls: Callable[..., SteppedPull]) -> None:
        stepped = pulls()

        connecting(stepped)

        [thread] = stepped.threads
        assert thread is not threading.current_thread()
        assert thread.daemon is True

    def test_a_failed_pull_settles_with_its_failure_message(
        self, pulls: Callable[..., SteppedPull]
    ) -> None:
        job_id = pulled(pulls(error=PullFailure(FAILURE_MESSAGE)))

        assert catalog_jobs.status(job_id) == {"status": "failed", "error": FAILURE_MESSAGE}


class TestJoinAndCache:
    """One pull per key: a running pull is joined, a done one answers from the cache."""

    @pytest.mark.parametrize("refresh", [False, True])
    def test_a_connecting_pull_is_joined(
        self, pulls: Callable[..., SteppedPull], refresh: bool
    ) -> None:
        first_pull, second_pull = pulls(), pulls()
        first = connecting(first_pull)

        joined = begin(second_pull, refresh=refresh)

        assert joined == {"job_id": first, "cached": False}
        first_pull.open()
        assert settled(first) == {"status": "done", **DATA}
        assert second_pull.jobs == []

    @pytest.mark.parametrize("refresh", [False, True])
    def test_a_reading_pull_is_joined(
        self, pulls: Callable[..., SteppedPull], refresh: bool
    ) -> None:
        first_pull, second_pull = pulls(), pulls()
        first = reading(first_pull)

        joined = begin(second_pull, refresh=refresh)

        assert joined == {"job_id": first, "cached": False}
        assert second_pull.jobs == []

    def test_a_done_pull_answers_from_the_cache(self, pulls: Callable[..., SteppedPull]) -> None:
        first = pulled(pulls())
        again = pulls()

        assert begin(again) == {"job_id": first, "cached": True, **DATA}
        assert again.jobs == []

    def test_refresh_on_a_done_pull_starts_a_new_one(
        self, pulls: Callable[..., SteppedPull]
    ) -> None:
        first = pulled(pulls())
        fresh = pulls(data=OTHER_DATA)
        fresh.open()

        refreshed = begin(fresh, refresh=True)

        assert refreshed == {"job_id": refreshed["job_id"], "cached": False}
        assert refreshed["job_id"] != first
        assert settled(refreshed["job_id"]) == {"status": "done", **OTHER_DATA}
        assert begin(pulls()) == {
            "job_id": refreshed["job_id"],
            "cached": True,
            **OTHER_DATA,
        }

    def test_a_refresh_replaces_the_done_job(self, pulls: Callable[..., SteppedPull]) -> None:
        first = pulled(pulls())

        refreshed = pulled(pulls(), refresh=True)

        with pytest.raises(NotFoundException, match=exact(f"Catalog job '{first}' not found")):
            catalog_jobs.status(first)
        assert list(catalog_jobs._JOBS) == [refreshed]

    def test_a_start_after_a_failure_begins_a_new_pull_that_replaces_it(
        self, pulls: Callable[..., SteppedPull]
    ) -> None:
        failed = pulled(pulls(error=PullFailure(FAILURE_MESSAGE)))

        again = pulled(pulls())

        assert again != failed
        assert catalog_jobs.status(again) == {"status": "done", **DATA}
        with pytest.raises(NotFoundException, match=exact(f"Catalog job '{failed}' not found")):
            catalog_jobs.status(failed)
        assert list(catalog_jobs._JOBS) == [again]

    def test_a_start_after_a_cancel_begins_a_new_pull_that_replaces_it(
        self, pulls: Callable[..., SteppedPull]
    ) -> None:
        canceled_pull = pulls()
        canceled = connecting(canceled_pull)
        catalog_jobs.cancel(canceled)
        canceled_pull.finish()

        again = pulled(pulls())

        assert again != canceled
        assert catalog_jobs.status(again) == {"status": "done", **DATA}
        with pytest.raises(NotFoundException, match=exact(f"Catalog job '{canceled}' not found")):
            catalog_jobs.cancel(canceled)
        assert list(catalog_jobs._JOBS) == [again]

    def test_a_different_key_is_its_own_pull(self, pulls: Callable[..., SteppedPull]) -> None:
        first = pulled(pulls())

        other = pulled(pulls(data=OTHER_DATA), OTHER_KEY)

        assert other != first
        assert catalog_jobs.status(first) == {"status": "done", **DATA}
        assert catalog_jobs.status(other) == {"status": "done", **OTHER_DATA}
        assert set(catalog_jobs._JOBS) == {first, other}


class TestCancel:
    """Cancel stops a running pull; a finished job keeps its own answer."""

    def test_cancel_while_connecting_ends_the_job_canceled(
        self, pulls: Callable[..., SteppedPull]
    ) -> None:
        job_id = connecting(pulls())

        assert catalog_jobs.cancel(job_id) == {"status": "canceled"}
        assert catalog_jobs.status(job_id) == {"status": "canceled"}

    def test_a_pull_canceled_while_connecting_is_told_not_to_read(
        self, pulls: Callable[..., SteppedPull]
    ) -> None:
        stepped = pulls()
        job_id = connecting(stepped)
        catalog_jobs.cancel(job_id)

        stepped.finish()

        assert stepped.marked == [False]
        assert catalog_jobs.status(job_id) == {"status": "canceled"}

    def test_cancel_while_reading_cancels_the_read_once(
        self, pulls: Callable[..., SteppedPull]
    ) -> None:
        stepped = pulls()
        job_id = reading(stepped)

        assert catalog_jobs.cancel(job_id) == {"status": "canceled"}

        [job] = stepped.jobs
        assert stepped.cancel_reads == [job]
        assert catalog_jobs.status(job_id) == {"status": "canceled"}

    def test_a_second_cancel_answers_canceled_again_and_cancels_nothing_more(
        self, pulls: Callable[..., SteppedPull]
    ) -> None:
        stepped = pulls()
        job_id = reading(stepped)
        catalog_jobs.cancel(job_id)

        assert catalog_jobs.cancel(job_id) == {"status": "canceled"}
        assert len(stepped.cancel_reads) == 1

    def test_cancel_of_a_done_job_keeps_it_done(self, pulls: Callable[..., SteppedPull]) -> None:
        stepped = pulls()
        job_id = pulled(stepped)

        assert catalog_jobs.cancel(job_id) == {"status": "done", **DATA}
        assert catalog_jobs.status(job_id) == {"status": "done", **DATA}
        assert stepped.cancel_reads == []

    def test_cancel_of_a_failed_job_keeps_it_failed(
        self, pulls: Callable[..., SteppedPull]
    ) -> None:
        stepped = pulls(error=PullFailure(FAILURE_MESSAGE))
        job_id = pulled(stepped)
        failed = {"status": "failed", "error": FAILURE_MESSAGE}

        assert catalog_jobs.cancel(job_id) == failed
        assert catalog_jobs.status(job_id) == failed
        assert stepped.cancel_reads == []


class TestLateAnswer:
    """A canceled job keeps no answer that arrives after the cancel."""

    def test_a_late_answer_is_dropped(self, pulls: Callable[..., SteppedPull]) -> None:
        stepped = pulls()
        job_id = reading(stepped)
        catalog_jobs.cancel(job_id)

        stepped.finish()

        assert catalog_jobs.status(job_id) == {"status": "canceled"}
        assert catalog_jobs.result(job_id) is None

    def test_a_late_failure_is_dropped(self, pulls: Callable[..., SteppedPull]) -> None:
        stepped = pulls(error=PullFailure(FAILURE_MESSAGE))
        job_id = reading(stepped)
        catalog_jobs.cancel(job_id)

        stepped.finish()

        assert catalog_jobs.status(job_id) == {"status": "canceled"}


class TestUnknownJob:
    """A job id the table does not hold answers 404; it has no result."""

    @pytest.mark.parametrize("action", ["status", "cancel"])
    def test_an_unknown_job_is_not_found(self, action: str) -> None:
        with pytest.raises(NotFoundException, match=exact("Catalog job 'abc' not found")):
            getattr(catalog_jobs, action)("abc")

    def test_an_unknown_job_has_no_result(self) -> None:
        assert catalog_jobs.result("abc") is None


class TestResult:
    """result: a done job's data, and None for every other state."""

    def test_a_done_job_answers_its_data(self, pulls: Callable[..., SteppedPull]) -> None:
        job_id = pulled(pulls())

        assert catalog_jobs.result(job_id) == DATA

    def test_a_connecting_job_has_no_result(self, pulls: Callable[..., SteppedPull]) -> None:
        assert catalog_jobs.result(connecting(pulls())) is None

    def test_a_reading_job_has_no_result(self, pulls: Callable[..., SteppedPull]) -> None:
        assert catalog_jobs.result(reading(pulls())) is None

    def test_a_failed_job_has_no_result(self, pulls: Callable[..., SteppedPull]) -> None:
        job_id = pulled(pulls(error=PullFailure(FAILURE_MESSAGE)))

        assert catalog_jobs.result(job_id) is None

    def test_a_canceled_job_has_no_result(self, pulls: Callable[..., SteppedPull]) -> None:
        job_id = connecting(pulls())
        catalog_jobs.cancel(job_id)

        assert catalog_jobs.result(job_id) is None


class TestJob:
    """A job starts connecting with no answer; each holds its own data."""

    def test_a_new_job_is_connecting_with_no_answer(self) -> None:
        live = object()

        job = catalog_jobs.Job("j1", live)

        assert (job.id, job.status, job.data, job.error) == ("j1", "connecting", {}, "")
        assert job.live is live

    def test_each_job_has_its_own_data(self) -> None:
        assert catalog_jobs.Job("a", None).data is not catalog_jobs.Job("b", None).data


class TestMarkReading:
    """A pull moves its job to reading once connected, unless it was canceled meanwhile."""

    def test_a_connecting_job_moves_to_reading(self) -> None:
        job = catalog_jobs.Job("j1", None)

        assert catalog_jobs.mark_reading(job) is True
        assert job.status == "reading"

    def test_a_job_canceled_while_connecting_stays_canceled(self) -> None:
        job = catalog_jobs.Job("j1", None, status="canceled")

        assert catalog_jobs.mark_reading(job) is False
        assert job.status == "canceled"


class TestSettle:
    """settle writes the final state; a canceled job keeps none."""

    def test_done_keeps_the_data(self) -> None:
        job = catalog_jobs.Job("j1", None, status="reading")

        catalog_jobs.settle(job, "done", data=DATA)

        assert (job.status, job.data, job.error) == ("done", DATA, "")

    def test_failed_keeps_the_error(self) -> None:
        job = catalog_jobs.Job("j1", None)

        catalog_jobs.settle(job, "failed", error=FAILURE_MESSAGE)

        assert (job.status, job.data, job.error) == ("failed", {}, FAILURE_MESSAGE)

    @pytest.mark.parametrize("final", ["done", "failed"])
    def test_a_canceled_job_keeps_no_late_answer(self, final: str) -> None:
        job = catalog_jobs.Job("j1", None, status="canceled")

        catalog_jobs.settle(job, final, data=DATA, error=FAILURE_MESSAGE)

        assert (job.status, job.data, job.error) == ("canceled", {}, "")


class TestConnectionKey:
    """connection_key: a sha256 hex digest of the rows, independent of key order."""

    ROWS: dict[str, Any] = {"url": "https://os:9200", "username": "wave", "password": "s3cret"}

    def test_equal_rows_have_equal_keys(self) -> None:
        reordered = dict(reversed(list(self.ROWS.items())))

        assert catalog_jobs.connection_key(self.ROWS) == catalog_jobs.connection_key(reordered)

    def test_a_changed_password_changes_the_key(self) -> None:
        changed = {**self.ROWS, "password": "another-pass"}

        assert catalog_jobs.connection_key(self.ROWS) != catalog_jobs.connection_key(changed)

    def test_the_key_is_a_sha256_hex_digest(self) -> None:
        assert re.fullmatch(r"[0-9a-f]{64}", catalog_jobs.connection_key(self.ROWS))

    def test_a_value_json_cannot_hold_is_keyed_by_its_text(self) -> None:
        moment = datetime(2026, 9, 26, 10, 30)

        assert catalog_jobs.connection_key({"at": moment}) == catalog_jobs.connection_key(
            {"at": str(moment)}
        )


class TestCatalogRequestBody:
    """The resolution fields every catalog route takes beside its block's connection rows."""

    def test_every_field_has_its_default(self) -> None:
        assert catalog_jobs.CatalogRequestBody().model_dump() == REQUEST_FIELDS

    def test_the_seven_resolution_fields_are_the_whole_model(self) -> None:
        assert set(catalog_jobs.CatalogRequestBody.model_fields) == set(REQUEST_FIELDS)

    def test_the_sql_route_body_adds_only_its_connection(self) -> None:
        shared = set(catalog_jobs.CatalogRequestBody.model_fields)

        assert issubclass(CatalogBody, catalog_jobs.CatalogRequestBody)
        assert set(CatalogBody.model_fields) - shared == {"connection"}


class TestStartingVariables:
    """The variables a run of the test in the Environment starts with, plus the profiles."""

    def test_an_environment_that_does_not_exist_is_refused(self) -> None:
        with pytest.raises(
            UnprocessableEntityException, match=exact("Environment with ID 'e1' not found")
        ):
            catalog_jobs.starting_variables(None, "e1", [])

    def test_the_tests_declared_variables_are_there(self) -> None:
        test_id = saved_test(
            {
                "os_host": {"type": "string", "value": "vars-host"},
                "os_index": {"type": "string", "value": "'logs' + '-v2'", "isExpression": True},
            }
        )

        variables = catalog_jobs.starting_variables(test_id, None, [])

        assert (variables["os_host"], variables["os_index"]) == ("vars-host", "logs-v2")

    @pytest.mark.parametrize(
        ("in_environment", "host"), [(True, "env-host"), (False, "profile-host")]
    )
    def test_a_profile_binding_resolves_in_the_chosen_environment(
        self, seed_test_environment: str, in_environment: bool, host: str
    ) -> None:
        profile = profile_service.create_profile(
            name="Orders DB",
            profile_type="database",
            config={"host": "profile-host", "username": "app", "password": "profile-pass"},
            environment_values={seed_test_environment: {"host": "env-host"}},
        )
        binding = {
            "profileId": profile["id"],
            "alias": "orders",
            "profileName": "Orders DB",
            "profileType": "database",
        }
        environment_id = seed_test_environment if in_environment else None

        variables = catalog_jobs.starting_variables(None, environment_id, [binding])

        assert variables["orders.host"] == host


class TestRowResolver:
    """One row resolved as the block's run would, refused by its label when it cannot resolve."""

    def test_a_literal_row_passes_through(self) -> None:
        resolve = catalog_jobs.row_resolver(METADATA, LABELS, set(), set(), {})

        assert resolve("url", "https://os:9200") == "https://os:9200"

    def test_an_expression_row_resolves_against_the_variables(self) -> None:
        variables = {"os_url": "https://vars:9200"}
        resolve = catalog_jobs.row_resolver(METADATA, LABELS, {"url"}, set(), variables)

        assert resolve("url", "os_url") == "https://vars:9200"

    def test_a_template_row_renders_against_the_variables(self) -> None:
        resolve = catalog_jobs.row_resolver(METADATA, LABELS, set(), {"url"}, {"host": "os"})

        assert resolve("url", "https://{{ host }}:9200") == "https://os:9200"

    def test_a_row_the_metadata_trims_is_trimmed(self) -> None:
        resolve = catalog_jobs.row_resolver(METADATA, LABELS, set(), set(), {})

        assert resolve("index", "  logs-*  ") == "logs-*"

    def test_an_expression_that_cannot_resolve_is_refused_by_its_label(self) -> None:
        resolve = catalog_jobs.row_resolver(METADATA, LABELS, {"url"}, set(), {})
        with pytest.raises(ExpressionEvaluationError) as original:
            resolve_parameters({"url": "missing_var"}, {"url"}, {}, {"url": "string"})

        with pytest.raises(UnprocessableEntityException) as raised:
            resolve("url", "missing_var")

        assert raised.value.message == f"Cannot resolve Cluster URL: {original.value}"
        assert raised.value.__cause__ is None
        assert raised.value.__suppress_context__ is True

    def test_a_value_of_the_wrong_type_is_refused_by_its_label(self) -> None:
        resolve = catalog_jobs.row_resolver(METADATA, LABELS, {"connect_timeout"}, set(), {})

        with pytest.raises(
            UnprocessableEntityException,
            match=exact(
                "Cannot resolve Connect timeout: "
                "Parameter 'connect_timeout' expects integer, got str"
            ),
        ):
            resolve("connect_timeout", "'30'")

    def test_digit_text_in_a_number_row_is_its_number(self) -> None:
        resolve = catalog_jobs.row_resolver(METADATA, LABELS, set(), set(), {})

        assert resolve("connect_timeout", "45") == 45

    def test_text_in_a_number_row_that_is_not_its_number_is_refused_by_its_label(self) -> None:
        resolve = catalog_jobs.row_resolver(METADATA, LABELS, set(), set(), {})

        with pytest.raises(
            UnprocessableEntityException,
            match=exact(
                "Cannot resolve Connect timeout: Setting 'connect_timeout' is not a valid integer"
            ),
        ):
            resolve("connect_timeout", "45s")

    def test_blank_text_in_a_number_row_takes_the_blocks_default(self) -> None:
        resolve = catalog_jobs.row_resolver(DEFAULTED_METADATA, LABELS, set(), set(), {})

        assert resolve("connect_timeout", "") == 30

    def test_the_label_is_the_one_the_caller_hands_in(self) -> None:
        resolve = catalog_jobs.row_resolver(METADATA, {"url": "Endpoint"}, {"url"}, set(), {})

        with pytest.raises(
            UnprocessableEntityException,
            match=exact("Cannot resolve Endpoint: Variable 'missing_var' is not defined"),
        ):
            resolve("url", "missing_var")

    def test_an_expression_row_that_resolves_to_null_is_refused_by_its_label(self) -> None:
        resolve = catalog_jobs.row_resolver(METADATA, LABELS, {"url"}, set(), {"os_url": None})

        with pytest.raises(UnprocessableEntityException) as raised:
            resolve("url", "os_url")

        assert raised.value.message == "Cannot resolve Cluster URL: 'url' is null"
        assert raised.value.__cause__ is None

    def test_a_null_piece_in_a_template_row_is_refused_by_its_label(self) -> None:
        resolve = catalog_jobs.row_resolver(METADATA, LABELS, set(), {"url"}, {"host": None})

        with pytest.raises(
            UnprocessableEntityException,
            match=exact("Cannot resolve Cluster URL: '{{ host }}' in 'url' is null"),
        ):
            resolve("url", "https://{{ host }}:9200")

    def test_a_literal_row_left_empty_is_nothing_given(self) -> None:
        resolve = catalog_jobs.row_resolver(METADATA, LABELS, set(), set(), {})

        assert resolve("url", None) is None

    def test_a_row_left_empty_takes_the_blocks_default(self) -> None:
        resolve = catalog_jobs.row_resolver(DEFAULTED_METADATA, LABELS, set(), set(), {})

        assert resolve("connect_timeout", None) == 30

    def test_a_blank_expression_row_takes_the_blocks_default(self) -> None:
        resolve = catalog_jobs.row_resolver(
            DEFAULTED_METADATA, LABELS, {"connect_timeout"}, set(), {}
        )

        assert resolve("connect_timeout", "") == 30

    def test_a_row_given_a_value_keeps_it_over_the_default(self) -> None:
        resolve = catalog_jobs.row_resolver(DEFAULTED_METADATA, LABELS, set(), set(), {})

        assert resolve("connect_timeout", 5) == 5

    def test_a_row_the_block_marks_as_taking_null_resolves_to_null(self) -> None:
        metadata = {"parameters": [{"name": "note", "type": "string", "accepts_null": True}]}
        resolve = catalog_jobs.row_resolver(
            metadata, {"note": "Note"}, {"note"}, set(), {"n": None}
        )

        assert resolve("note", "n") is None
