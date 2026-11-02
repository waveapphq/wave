"""The sync verb bridge every plugin family with a synchronous core runs through.

run_verb lets a plugin's prepare hook settle the params and mask the values it
names, then runs one synchronous core off the event loop and materializes its
envelope into block outputs (REQ-5.1.1, REQ-3.4.1.5, REQ-3.4.1.10). A canceled
call ends every process the core launched and runs every cancel it holds
(REQ-3.2.2.4). log_via builds the two-argument callable a core logs through.
"""

import asyncio
from collections.abc import Callable
from contextlib import suppress
from typing import Any

from wavecore.connectivity import run_log
from wavecore.core.remote_exec.materialize import materialize
from wavecore.plugins import _process_group

VerbRun = Callable[[dict[str, Any], Callable[[str, str], None]], dict[str, Any]]
Prepare = Callable[[dict[str, Any], dict[str, Any]], tuple[dict[str, Any], list[str]]]


def log_via(logger: Any) -> Callable[[str, str], None]:
    """The verb log callable: each level writes through the matching context logger method."""

    def log(level: str, message: str) -> None:
        getattr(logger, level.lower())(message)

    return log


async def run_verb(
    verb_run: VerbRun,
    params: dict[str, Any],
    context: dict[str, Any],
    *,
    prepare: Prepare | None = None,
) -> dict[str, Any]:
    """Run one sync verb off the loop and materialize its envelope into block outputs."""
    if prepare is not None:
        params, values = prepare(params, context)
        register_secret = context.get("register_secret")
        # Masked before the thread starts, so no line the verb logs can carry a value.
        if callable(register_secret):
            for value in values:
                register_secret(value)
    loop = asyncio.get_running_loop()
    logger = context.get("logger")
    write = None if logger is None else log_via(logger)
    # to_thread is not cancelable, so a stopped block's thread keeps running.
    running = True

    def log(level: str, message: str) -> None:
        # The console stream only accepts lines written on the loop thread.
        if running and write is not None:
            with suppress(RuntimeError):
                loop.call_soon_threadsafe(write, level, message)

    processes = _process_group.HeldGroups()
    token = _process_group.RUNNING.set(processes)
    run_log_token = run_log.RUN_LOG.set(run_log.RunLog(log))
    try:
        envelope = await asyncio.to_thread(verb_run, params, log)
    except asyncio.CancelledError:
        # Silenced first: a canceled statement unwinds while the stop runs, unheard.
        running = False
        # The thread runs on, so what it launches or holds after this ends as it registers.
        processes.stop()
        raise
    finally:
        running = False
        run_log.RUN_LOG.reset(run_log_token)
        _process_group.RUNNING.reset(token)
    outputs: dict[str, Any] = materialize(envelope, context.get("register_secret"))
    return outputs
