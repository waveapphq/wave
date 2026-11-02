"""Unit tests for the in-memory report job registry.

Jobs are keyed by (execution_id, format), live in process memory only, and
expose a JSON-safe view; asyncio task refs are tracked alongside so callers
(and tests) can await completion.
"""

import asyncio
import json
import uuid
from datetime import datetime
from typing import Any


def _jobs() -> Any:
    from wavecore.api.services.reports import jobs

    return jobs


class TestCreateJob:
    def test_create_job_returns_pending_job_with_zeroed_progress(self) -> None:
        jobs = _jobs()
        execution_id = str(uuid.uuid4())

        job = jobs.create_job(execution_id, "html", runs_total=3)

        assert job["execution_id"] == execution_id
        assert job["format"] == "html"
        assert job["status"] == "pending"
        assert job["progress"] == {"runs_processed": 0, "runs_total": 3}
        assert job["artifact_id"] is None
        assert job["error"] is None
        assert job["ended_at"] is None
        datetime.fromisoformat(job["started_at"].replace("Z", "+00:00"))

    def test_create_job_replaces_terminal_slot(self) -> None:
        jobs = _jobs()
        execution_id = str(uuid.uuid4())
        first = jobs.create_job(execution_id, "html", runs_total=2)
        first["status"] = "completed"
        first["artifact_id"] = "a/report.v1.html"

        second = jobs.create_job(execution_id, "html", runs_total=2)

        assert jobs.get_job(execution_id, "html") is second
        assert second["status"] == "pending"
        assert second["artifact_id"] is None

    def test_jobs_for_different_formats_coexist(self) -> None:
        jobs = _jobs()
        execution_id = str(uuid.uuid4())

        html_job = jobs.create_job(execution_id, "html", runs_total=2)
        json_job = jobs.create_job(execution_id, "json", runs_total=2)

        assert jobs.get_job(execution_id, "html") is html_job
        assert jobs.get_job(execution_id, "json") is json_job


class TestGetJob:
    def test_get_job_returns_registered_job(self) -> None:
        jobs = _jobs()
        execution_id = str(uuid.uuid4())
        job = jobs.create_job(execution_id, "html", runs_total=1)

        assert jobs.get_job(execution_id, "html") is job

    def test_get_job_returns_none_for_unknown_execution(self) -> None:
        assert _jobs().get_job(str(uuid.uuid4()), "html") is None

    def test_get_job_returns_none_for_other_format(self) -> None:
        jobs = _jobs()
        execution_id = str(uuid.uuid4())
        jobs.create_job(execution_id, "html", runs_total=1)

        assert jobs.get_job(execution_id, "json") is None


class TestJobView:
    def test_job_view_is_json_safe(self) -> None:
        jobs = _jobs()
        execution_id = str(uuid.uuid4())
        job = jobs.create_job(execution_id, "json", runs_total=2)

        view = jobs.job_view(job)

        json.dumps(view)
        assert view["execution_id"] == execution_id
        assert view["format"] == "json"
        assert view["status"] == "pending"
        assert view["progress"] == {"runs_processed": 0, "runs_total": 2}

    def test_job_view_mutations_do_not_leak_into_registry(self) -> None:
        jobs = _jobs()
        execution_id = str(uuid.uuid4())
        job = jobs.create_job(execution_id, "html", runs_total=2)

        view = jobs.job_view(job)
        view["status"] = "completed"
        view["progress"]["runs_processed"] = 99

        assert job["status"] == "pending"
        assert job["progress"]["runs_processed"] == 0


class TestTaskRefs:
    async def test_set_and_get_task_roundtrip(self) -> None:
        jobs = _jobs()
        execution_id = str(uuid.uuid4())

        async def _noop() -> None:
            return None

        task = asyncio.create_task(_noop())
        jobs.set_task(execution_id, "html", task)

        assert jobs.get_task(execution_id, "html") is task
        assert jobs.get_task(execution_id, "json") is None
        await task

    def test_get_task_returns_none_for_unknown_execution(self) -> None:
        assert _jobs().get_task(str(uuid.uuid4()), "html") is None


class TestClearJobs:
    async def test_clear_jobs_empties_jobs_and_tasks(self) -> None:
        jobs = _jobs()
        execution_id = str(uuid.uuid4())
        jobs.create_job(execution_id, "html", runs_total=1)

        async def _noop() -> None:
            return None

        task = asyncio.create_task(_noop())
        jobs.set_task(execution_id, "html", task)
        await task

        jobs.clear_jobs()

        assert jobs.get_job(execution_id, "html") is None
        assert jobs.get_task(execution_id, "html") is None
