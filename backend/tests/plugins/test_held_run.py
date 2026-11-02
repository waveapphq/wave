"""The held cancel and whole-block deadline the connecting cores share (REQ-3.4.1.6, REQ-3.4.1.15,
REQ-5.1.2, REQ-5.1.4, SQL-5, SQL-13).

Live ends a run once, by Stop or by the deadline, and cancels the one resource attached at that
moment (a SQL connection, an OpenSearch socket); a resource that arrives after the end is
canceled on arrival. held() arms the deadline timer and holds the stop on the run's groups for
as long as the core works.
"""

import contextvars
import re
import threading
from collections.abc import Callable, Iterator
from typing import Any

import pytest

from wavecore.plugins import _held_run
from wavecore.plugins._process_group import RUNNING, HeldGroups

BOUND_S = 1.0
TIMEOUT_MESSAGE = "Search timed out after 5 seconds"
CANCEL_ERROR = OSError("[Errno 107] Transport endpoint is not connected")


def exact(message: str) -> str:
    return f"^{re.escape(message)}$"


class TimedOut(Exception):
    """The failure the core's timeout factory builds."""


def timed_out() -> Exception:
    return TimedOut(TIMEOUT_MESSAGE)


class Cancels:
    """The cancel a core hands its Live; records each resource it was asked to end."""

    def __init__(self, error: BaseException | None = None) -> None:
        self.calls: list[Any] = []
        self.error = error

    def __call__(self, resource: Any) -> None:
        self.calls.append(resource)
        if self.error is not None:
            raise self.error


class FakeTimer:
    """Stands in for DEADLINE; the test fires it."""

    made: list["FakeTimer"] = []

    def __init__(self, seconds: float, callback: Callable[[], None]) -> None:
        self.seconds, self.callback = seconds, callback
        self.daemon = False
        self.started = self.canceled = False
        FakeTimer.made.append(self)

    def start(self) -> None:
        self.started = True

    def cancel(self) -> None:
        self.canceled = True

    def fire(self) -> None:
        self.callback()


@pytest.fixture
def cancels() -> Cancels:
    return Cancels()


@pytest.fixture
def deadline(monkeypatch: pytest.MonkeyPatch) -> type[FakeTimer]:
    FakeTimer.made = []
    monkeypatch.setattr(_held_run, "DEADLINE", FakeTimer)
    return FakeTimer


@pytest.fixture
def groups() -> Iterator[HeldGroups]:
    """The run's groups, as the workbench sets them for the block in progress."""
    running = HeldGroups()
    token = RUNNING.set(running)
    yield running
    RUNNING.reset(token)


def live_with(cancel: Callable[[Any], None], seconds: float = 5) -> Any:
    return _held_run.Live(seconds, cancel, timed_out)


def in_a_thread(work: Callable[[], None]) -> bool:
    """Run `work` on a daemon thread; whether it returned within the bound."""
    finished = threading.Event()

    def run() -> None:
        work()
        finished.set()

    threading.Thread(target=run, daemon=True).start()
    return finished.wait(BOUND_S)


class TestLiveRun:
    """A run neither stopped nor expired passes every check and cancels nothing."""

    def test_check_and_timed_out_pass(self, cancels: Cancels) -> None:
        live = live_with(cancels)

        live.check()
        live.timed_out()

        assert cancels.calls == []

    def test_attach_hands_over_the_resource_without_canceling_it(self, cancels: Cancels) -> None:
        live = live_with(cancels)

        live.attach("socket-1")

        assert cancels.calls == []

    def test_a_live_run_never_builds_the_timeout_failure(self, cancels: Cancels) -> None:
        built: list[Exception] = []

        def factory() -> Exception:
            built.append(TimedOut(TIMEOUT_MESSAGE))
            return built[-1]

        live = _held_run.Live(5, cancels, factory)
        live.attach("socket-1")
        live.check()
        live.timed_out()

        assert built == []

    def test_the_seconds_are_kept(self, cancels: Cancels) -> None:
        assert live_with(cancels, 12.5).seconds == 12.5


class TestStop:
    """Stop cancels the attached resource once; the run then leaves as Stopped."""

    def test_a_stop_after_attach_cancels_the_attached_resource(self, cancels: Cancels) -> None:
        live = live_with(cancels)
        live.attach("socket-1")

        live.stop()

        assert cancels.calls == ["socket-1"]

    def test_a_second_stop_cancels_nothing_more(self, cancels: Cancels) -> None:
        live = live_with(cancels)
        live.attach("socket-1")
        live.stop()

        live.stop()

        assert cancels.calls == ["socket-1"]

    def test_a_stop_before_attach_cancels_nothing(self, cancels: Cancels) -> None:
        live = live_with(cancels)

        live.stop()

        assert cancels.calls == []

    def test_a_resource_attached_after_a_stop_is_canceled_at_once(self, cancels: Cancels) -> None:
        live = live_with(cancels)
        live.stop()

        with pytest.raises(_held_run.Stopped):
            live.attach("socket-1")

        assert cancels.calls == ["socket-1"]

    def test_a_stopped_run_fails_the_check_as_stopped(self, cancels: Cancels) -> None:
        live = live_with(cancels)
        live.stop()

        with pytest.raises(_held_run.Stopped):
            live.check()

    def test_a_stopped_run_has_not_timed_out(self, cancels: Cancels) -> None:
        live = live_with(cancels)
        live.stop()

        live.timed_out()

    def test_an_expire_after_a_stop_cancels_nothing_more(self, cancels: Cancels) -> None:
        live = live_with(cancels)
        live.attach("socket-1")
        live.stop()

        live.expire()

        assert cancels.calls == ["socket-1"]


class TestExpire:
    """The deadline cancels the attached resource once; the run fails with the factory's failure."""

    def test_an_expire_after_attach_cancels_the_attached_resource(self, cancels: Cancels) -> None:
        live = live_with(cancels)
        live.attach("socket-1")

        live.expire()

        assert cancels.calls == ["socket-1"]

    def test_a_second_expire_cancels_nothing_more(self, cancels: Cancels) -> None:
        live = live_with(cancels)
        live.attach("socket-1")
        live.expire()

        live.expire()

        assert cancels.calls == ["socket-1"]

    def test_an_expired_run_fails_the_check_with_the_timeout_failure(
        self, cancels: Cancels
    ) -> None:
        live = live_with(cancels)
        live.expire()

        with pytest.raises(TimedOut, match=exact(TIMEOUT_MESSAGE)):
            live.check()

    def test_an_expired_run_has_timed_out(self, cancels: Cancels) -> None:
        live = live_with(cancels)
        live.expire()

        with pytest.raises(TimedOut, match=exact(TIMEOUT_MESSAGE)):
            live.timed_out()

    def test_a_resource_attached_after_the_deadline_is_canceled_and_the_run_times_out(
        self, cancels: Cancels
    ) -> None:
        live = live_with(cancels)
        live.expire()

        with pytest.raises(TimedOut, match=exact(TIMEOUT_MESSAGE)):
            live.attach("socket-1")

        assert cancels.calls == ["socket-1"]

    def test_a_stop_after_the_deadline_cancels_nothing_more_and_the_timeout_wins(
        self, cancels: Cancels
    ) -> None:
        live = live_with(cancels)
        live.attach("socket-1")
        live.expire()

        live.stop()

        assert cancels.calls == ["socket-1"]
        with pytest.raises(TimedOut, match=exact(TIMEOUT_MESSAGE)):
            live.check()


class TestDetach:
    """A resource the core has finished with is detached; a later end no longer reaches it."""

    def test_a_detached_resource_is_not_canceled_by_a_later_stop(self, cancels: Cancels) -> None:
        live = live_with(cancels)
        live.attach("socket-1")
        live.detach("socket-1")

        live.stop()

        assert cancels.calls == []

    def test_detaching_another_resource_keeps_the_attached_one(self, cancels: Cancels) -> None:
        live = live_with(cancels)
        live.attach("socket-1")
        live.detach("socket-2")

        live.stop()

        assert cancels.calls == ["socket-1"]

    def test_the_next_attached_resource_is_the_one_an_end_cancels(self, cancels: Cancels) -> None:
        live = live_with(cancels)
        live.attach("socket-1")
        live.detach("socket-1")
        live.attach("socket-2")

        live.expire()

        assert cancels.calls == ["socket-2"]


class TestCancelErrors:
    """A cancel that raises is suppressed; the run still leaves as it would have."""

    @pytest.mark.parametrize("end", ["stop", "expire"])
    def test_the_error_of_the_first_end_is_suppressed(self, end: str) -> None:
        cancels = Cancels(CANCEL_ERROR)
        live = live_with(cancels)
        live.attach("socket-1")

        getattr(live, end)()

        assert cancels.calls == ["socket-1"]

    def test_a_stopped_run_still_leaves_as_stopped(self) -> None:
        live = live_with(Cancels(CANCEL_ERROR))
        live.attach("socket-1")
        live.stop()

        with pytest.raises(_held_run.Stopped):
            live.check()

    def test_a_late_resource_whose_cancel_raises_still_leaves_as_stopped(self) -> None:
        cancels = Cancels(CANCEL_ERROR)
        live = live_with(cancels)
        live.stop()

        with pytest.raises(_held_run.Stopped):
            live.attach("socket-1")

        assert cancels.calls == ["socket-1"]


class TestReentrantStop:
    """A remote stop arrives as a signal on the thread that holds the Live's lock."""

    def test_a_stop_from_the_thread_holding_the_lock_returns(self, cancels: Cancels) -> None:
        live = live_with(cancels)
        live.attach("socket-1")

        def signaled() -> None:
            with live.lock:
                live.stop()

        assert in_a_thread(signaled)
        assert cancels.calls == ["socket-1"]

    def test_a_cancel_that_stops_the_run_again_returns(self) -> None:
        calls: list[Any] = []
        lives: list[Any] = []

        def cancel(resource: Any) -> None:
            calls.append(resource)
            lives[0].stop()

        lives.append(live_with(cancel))
        lives[0].attach("socket-1")

        assert in_a_thread(lives[0].stop)
        assert calls == ["socket-1"]


class TestStopped:
    """Stopped is an ordinary exception a stopped run leaves by."""

    def test_stopped_is_an_exception(self) -> None:
        assert issubclass(_held_run.Stopped, Exception)


class TestDeadlineTimer:
    """The deadline is a threading.Timer tests can swap."""

    def test_the_timer_is_threading_timer(self) -> None:
        assert _held_run.DEADLINE is threading.Timer

    def test_the_real_timer_ends_the_run_when_the_seconds_pass(self) -> None:
        calls: list[Any] = []
        ended = threading.Event()

        def cancel(resource: Any) -> None:
            calls.append(resource)
            ended.set()

        live = live_with(cancel, 0.01)
        with _held_run.held(live):
            live.attach("socket-1")
            assert ended.wait(BOUND_S)

            with pytest.raises(TimedOut, match=exact(TIMEOUT_MESSAGE)):
                live.check()

        assert calls == ["socket-1"]


class TestHeld:
    """held() arms one daemon deadline timer and holds the stop on the run's groups."""

    def test_held_yields_the_live(self, cancels: Cancels, deadline: type[FakeTimer]) -> None:
        live = live_with(cancels)

        with _held_run.held(live) as inside:
            assert inside is live

    def test_one_daemon_timer_is_armed_for_the_lives_seconds(
        self, cancels: Cancels, deadline: type[FakeTimer]
    ) -> None:
        with _held_run.held(live_with(cancels, 5)):
            [timer] = deadline.made
            assert (timer.seconds, timer.daemon, timer.started) == (5, True, True)
            assert timer.canceled is False

    def test_the_timer_fires_the_lives_expire(
        self, cancels: Cancels, deadline: type[FakeTimer]
    ) -> None:
        live = live_with(cancels)

        with _held_run.held(live):
            live.attach("socket-1")
            deadline.made[0].fire()

            assert cancels.calls == ["socket-1"]
            with pytest.raises(TimedOut, match=exact(TIMEOUT_MESSAGE)):
                live.check()

    def test_the_timer_is_canceled_on_exit(
        self, cancels: Cancels, deadline: type[FakeTimer]
    ) -> None:
        with _held_run.held(live_with(cancels)):
            pass

        assert deadline.made[0].canceled is True

    def test_the_timer_is_canceled_when_the_work_raises(
        self, cancels: Cancels, deadline: type[FakeTimer]
    ) -> None:
        with pytest.raises(RuntimeError, match=exact("boom")):
            with _held_run.held(live_with(cancels)):
                raise RuntimeError("boom")

        assert deadline.made[0].canceled is True

    def test_the_stop_is_held_on_the_runs_groups_while_inside(
        self, cancels: Cancels, deadline: type[FakeTimer], groups: HeldGroups
    ) -> None:
        live = live_with(cancels)

        with _held_run.held(live):
            assert groups.cancels == [live.stop]

        assert groups.cancels == []

    def test_the_stop_is_released_when_the_work_raises(
        self, cancels: Cancels, deadline: type[FakeTimer], groups: HeldGroups
    ) -> None:
        with pytest.raises(RuntimeError, match=exact("boom")):
            with _held_run.held(live_with(cancels)):
                raise RuntimeError("boom")

        assert groups.cancels == []

    def test_a_stop_of_the_run_reaches_the_attached_resource(
        self, cancels: Cancels, deadline: type[FakeTimer], groups: HeldGroups
    ) -> None:
        live = live_with(cancels)

        with _held_run.held(live):
            live.attach("socket-1")
            groups.stop()

            assert cancels.calls == ["socket-1"]
            with pytest.raises(_held_run.Stopped):
                live.check()

    def test_a_run_stopped_before_it_holds_ends_the_live_at_once(
        self, cancels: Cancels, deadline: type[FakeTimer], groups: HeldGroups
    ) -> None:
        groups.stop()
        live = live_with(cancels)

        with _held_run.held(live):
            with pytest.raises(_held_run.Stopped):
                live.attach("socket-1")

        assert cancels.calls == ["socket-1"]

    def test_a_stop_after_the_exit_no_longer_reaches_the_live(
        self, cancels: Cancels, deadline: type[FakeTimer], groups: HeldGroups
    ) -> None:
        live = live_with(cancels)
        with _held_run.held(live):
            live.attach("socket-1")

        groups.stop()

        assert cancels.calls == []

    def test_without_running_groups_the_live_is_still_held(
        self, cancels: Cancels, deadline: type[FakeTimer]
    ) -> None:
        live = live_with(cancels)

        def work() -> None:
            with _held_run.held(live):
                live.attach("socket-1")
                live.check()

        contextvars.Context().run(work)

        assert deadline.made[0].canceled is True
        assert cancels.calls == []
