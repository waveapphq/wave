"""Helm's local run on the shared launcher (SHRUN-15, REQ-3.2.2.4).

A helm run on WAVE is started through the one launcher every local block shares,
in a process group of its own, so a Stop ends the whole group instead of leaving
helm and whatever it started running. helm itself is never executed: a scripted
stand-in on disk answers in its place.
"""

import asyncio
import os
import signal
import threading
import time
from collections.abc import Callable
from contextlib import ExitStack, suppress
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from tests.connectivity.helm._helm_fixtures import RELEASE
from tests.plugins.k8s._k8s_fixtures import RecordingLog
from wavecore.connectivity.helm import _cli
from wavecore.plugins import _process_group
from wavecore.plugins._verb_bridge import run_verb

# A loaded CI host can take seconds to start the stand-in or reap a killed one; polls end early.
WAIT_S = 5.0
POLL_S = 0.005

_WAITING_HELM = """#!/bin/sh
sleep 30 &
printf '%s %s\\n' "$$" "$!" > '{report}'
wait
"""
_QUICK_HELM = "#!/bin/sh\nexit 0\n"


def _executable(tmp_path: Path, text: str) -> str:
    """A stand-in helm on disk, ready to run."""
    home = tmp_path / "fake-helm"
    home.mkdir(exist_ok=True)
    script = home / "helm"
    script.write_text(text, encoding="utf-8")
    script.chmod(0o755)
    return str(script)


def _waiting_helm(tmp_path: Path) -> tuple[str, Path]:
    """A stand-in that leaves a job running and waits, recording both pids."""
    report = tmp_path / "pids"
    return _executable(tmp_path, _WAITING_HELM.format(report=report)), report


def _kubeconfig(tmp_path: Path) -> str:
    """A kubeconfig file inside its own workspace-shaped directory."""
    home = tmp_path / "work"
    home.mkdir(exist_ok=True)
    path = home / "kubeconfig.json"
    path.write_text("{}", encoding="utf-8")
    return str(path)


def _run(helm_path: str, kubeconfig: str, log: Any = None) -> Any:
    """One helm read through the runner under test."""
    return _cli.run_helm(
        ["status", RELEASE],
        kubeconfig=kubeconfig,
        helm_path=helm_path,
        deadline_s=30,
        log=log or RecordingLog(),
    )


def _launcher_targets() -> list[tuple[Any, str]]:
    """Every name through which helm's runner can reach the shared launcher."""
    launcher = _process_group.__name__
    return [
        (module, name)
        for module in (_process_group, _cli)
        for name, value in vars(module).items()
        if not name.startswith("__")
        and callable(value)
        and getattr(value, "__module__", None) == launcher
    ]


def _watch(used: list[str], name: str, original: Any) -> Any:
    """A stand-in that records the call and then does the real work."""

    def call(*args: Any, **kwargs: Any) -> Any:
        used.append(name)
        return original(*args, **kwargs)

    return call


def _gone(pid: int) -> bool:
    """Dead: no entry under /proc, or a zombie nobody has reaped yet."""
    try:
        with open(f"/proc/{pid}/stat", encoding="utf-8") as handle:
            state = handle.read().rsplit(") ", 1)[-1].split()[0]
    except OSError:
        # A process reaped between the open and the read reports ESRCH instead of ENOENT.
        return True
    return state == "Z"


class _HeldLaunch:
    """The real launcher, handing the process back only once the test releases it."""

    def __init__(self) -> None:
        self.release = threading.Event()
        self._launch = _process_group.launch

    def __call__(self, argv: list[str], **settings: Any) -> Any:
        process = self._launch(argv, **settings)
        self.release.wait(WAIT_S)
        return process


def _kill_group(pid: int) -> None:
    """Clean up what the test started, and only that."""
    with suppress(ProcessLookupError, PermissionError):
        group = os.getpgid(pid)
        if group not in (0, os.getpgid(0)):
            os.killpg(group, signal.SIGKILL)


async def _until(check: Callable[[], bool], message: str) -> None:
    """Poll a condition to a short bound; the wait ends the moment it holds."""
    deadline = time.monotonic() + WAIT_S
    while time.monotonic() < deadline:
        if check():
            return
        await asyncio.sleep(POLL_S)
    raise AssertionError(message)


async def _recorded_pids(report: Path) -> tuple[int, int]:
    """The stand-in's own pid and the pid of the job it left running."""
    await _until(
        lambda: report.exists() and report.read_text(encoding="utf-8").endswith("\n"),
        "the helm stand-in never recorded its pid",
    )
    shell, job = report.read_text(encoding="utf-8").split()
    return int(shell), int(job)


class TestSharedLauncher:
    """A helm run on WAVE starts the way every local block starts."""

    def test_the_run_goes_through_the_shared_launcher(self, tmp_path: Path) -> None:
        helm_path = _executable(tmp_path, _QUICK_HELM)
        kubeconfig = _kubeconfig(tmp_path)
        targets = _launcher_targets()
        if not targets:
            pytest.fail("the shared launcher module defines no callable to watch")
        used: list[str] = []

        with ExitStack() as stack:
            for module, name in targets:
                spy = _watch(used, name, getattr(module, name))
                stack.enter_context(patch.object(module, name, spy))
            _run(helm_path, kubeconfig)

        assert used != []

    async def test_helm_runs_in_a_process_group_of_its_own(self, tmp_path: Path) -> None:
        helm_path, report = _waiting_helm(tmp_path)
        kubeconfig = _kubeconfig(tmp_path)
        task = asyncio.create_task(asyncio.to_thread(_run, helm_path, kubeconfig))
        child = 0
        try:
            child, _job = await _recorded_pids(report)

            assert os.getpgid(child) == child
            assert os.getpgid(child) != os.getpgid(0)
        finally:
            if child:
                _kill_group(child)
            task.cancel()
            with suppress(BaseException):
                await task


class TestCancel:
    """Canceling the awaiting task ends the whole group the run started."""

    async def _canceled(self, tmp_path: Path) -> tuple[int, int]:
        """Run helm through the verb bridge, cancel the caller, hand back both pids."""
        helm_path, report = _waiting_helm(tmp_path)
        kubeconfig = _kubeconfig(tmp_path)

        def verb_run(_params: dict[str, Any], log: Any) -> dict[str, Any]:
            _run(helm_path, kubeconfig, log)
            return {}

        task = asyncio.create_task(run_verb(verb_run, {}, {"logger": MagicMock()}))
        try:
            child, job = await _recorded_pids(report)
        except BaseException:
            task.cancel()
            raise
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return child, job

    async def test_canceling_the_run_leaves_no_helm_process(self, tmp_path: Path) -> None:
        child, job = await self._canceled(tmp_path)
        try:
            await _until(lambda: _gone(child), "helm outlived the canceled run")
        finally:
            _kill_group(child)
            _kill_group(job)

    async def test_canceling_the_run_ends_the_group_helm_started(self, tmp_path: Path) -> None:
        child, job = await self._canceled(tmp_path)
        try:
            await _until(lambda: _gone(job), "a job helm started outlived the canceled run")
        finally:
            _kill_group(child)
            _kill_group(job)

    async def test_a_cancel_that_lands_before_the_launch_returns_still_ends_helm(
        self, tmp_path: Path
    ) -> None:
        held = _HeldLaunch()
        child = job = 0
        try:
            with patch.object(_process_group, "launch", held):
                child, job = await self._canceled(tmp_path)
                held.release.set()
                await _until(
                    lambda: _gone(child) and _gone(job),
                    "helm launched while the run was being canceled outlived it",
                )
        finally:
            held.release.set()
            _kill_group(child)
            _kill_group(job)
