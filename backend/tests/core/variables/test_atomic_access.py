"""Tests for the per-variable atomic access layer (REQ-3.2.3.4).

The guarantee: a read never observes a partially written value, concurrent
reads of one variable do not block each other, a write excludes readers of
that variable for its duration, and access is per variable so work on one
variable never delays work on another.

Every assertion here is about observable ordering, so the tests fail if the
layer degrades to "the event loop happens to be single-threaded today".
"""

import asyncio
from typing import Any

import pytest


def variable_access(variables: dict[str, Any]) -> Any:
    """Build the access layer; imported lazily."""
    from wavecore.core.variables.atomic import VariableAccess

    return VariableAccess(variables)


async def _settle(rounds: int = 10) -> None:
    """Yield to the event loop enough times for a blocked waiter to run if it can."""
    for _ in range(rounds):
        await asyncio.sleep(0)


# =============================================================================
# Plain reads and writes
# =============================================================================


class TestVariableAccessBasics:
    """The layer is a facade over the live variables dict, not a copy of it."""

    async def test_read_returns_the_current_value(self) -> None:
        """Verify read returns what the dict holds."""
        variables: dict[str, Any] = {"count": 3}
        access = variable_access(variables)
        assert await access.read("count") == 3

    async def test_read_of_an_unknown_name_raises_key_error(self) -> None:
        """Verify a missing variable raises, exactly as dict access does."""
        access = variable_access({})
        with pytest.raises(KeyError, match="ghost"):
            await access.read("ghost")

    async def test_write_stores_into_the_backing_dict(self) -> None:
        """Verify a write is visible on the dict every other holder shares."""
        variables: dict[str, Any] = {}
        access = variable_access(variables)
        await access.write("count", 7)
        assert variables["count"] == 7

    async def test_write_overwrites_an_existing_value(self) -> None:
        """Verify last-write-wins on a single variable."""
        variables: dict[str, Any] = {"count": 1}
        access = variable_access(variables)
        await access.write("count", 2)
        assert variables["count"] == 2

    async def test_a_write_made_outside_the_layer_is_still_readable(self) -> None:
        """Verify the layer reads live state, never a snapshot taken at construction."""
        variables: dict[str, Any] = {"count": 1}
        access = variable_access(variables)
        variables["count"] = 9
        assert await access.read("count") == 9

    async def test_update_yields_the_live_variables_mapping(self) -> None:
        """Verify the update context manager hands back the shared dict."""
        variables: dict[str, Any] = {"rows": []}
        access = variable_access(variables)
        async with access.update(["rows"]) as held:
            held["rows"].append(1)
        assert variables["rows"] == [1]

    async def test_update_accepts_a_name_that_does_not_exist_yet(self) -> None:
        """Verify a first write through update needs no pre-existing variable."""
        variables: dict[str, Any] = {}
        access = variable_access(variables)
        async with access.update(["fresh"]) as held:
            held["fresh"] = "value"
        assert variables["fresh"] == "value"

    async def test_update_releases_its_hold_when_the_body_raises(self) -> None:
        """Verify an exception inside the block does not strand the variable."""
        variables: dict[str, Any] = {"count": 1}
        access = variable_access(variables)
        with pytest.raises(RuntimeError, match="^boom$"):
            async with access.update(["count"]):
                raise RuntimeError("boom")
        assert await asyncio.wait_for(access.read("count"), timeout=1.0) == 1


# =============================================================================
# Reader/writer semantics
# =============================================================================


class TestConcurrentReadsDoNotBlockEachOther:
    """Reads of one variable proceed together."""

    async def test_many_concurrent_reads_all_complete(self) -> None:
        """Verify ten simultaneous reads of one variable all return."""
        access = variable_access({"count": 5})
        results = await asyncio.wait_for(
            asyncio.gather(*(access.read("count") for _ in range(10))),
            timeout=1.0,
        )
        assert results == [5] * 10

    async def test_a_reader_does_not_exclude_another_reader(self) -> None:
        """Verify a read in flight never delays a second read of the same variable."""
        access = variable_access({"count": 5})
        order: list[str] = []

        async def reader(tag: str) -> None:
            order.append(f"{tag}-start")
            await access.read("count")
            order.append(f"{tag}-done")

        await asyncio.wait_for(asyncio.gather(reader("a"), reader("b")), timeout=1.0)
        assert set(order) == {"a-start", "a-done", "b-start", "b-done"}


class TestAWriteExcludesReaders:
    """A write to a variable excludes readers of that variable for its duration."""

    async def test_a_read_issued_during_a_write_waits_for_it(self) -> None:
        """Verify a read started mid-write does not return before the write ends."""
        access = variable_access({"count": 0})
        order: list[str] = []
        release = asyncio.Event()

        async def writer() -> None:
            async with access.update(["count"]) as held:
                order.append("write-start")
                await release.wait()
                held["count"] = 42
                order.append("write-end")

        async def reader() -> None:
            value = await access.read("count")
            order.append(f"read-{value}")

        writer_task = asyncio.create_task(writer())
        await _settle()
        reader_task = asyncio.create_task(reader())
        await _settle()

        assert order == ["write-start"], order
        release.set()
        await asyncio.wait_for(asyncio.gather(writer_task, reader_task), timeout=1.0)
        assert order == ["write-start", "write-end", "read-42"], order

    async def test_a_read_never_observes_a_half_written_compound_value(self) -> None:
        """Verify a table replaced row by row is read whole or not at all."""
        # Guard: REQ-3.2.3.4 covers compound values, not just scalars.
        access = variable_access({"rows": []})
        observed: list[list[int]] = []

        async def writer() -> None:
            async with access.update(["rows"]) as held:
                held["rows"] = []
                for row in (1, 2, 3):
                    held["rows"].append(row)
                    await asyncio.sleep(0)

        async def reader() -> None:
            observed.append(list(await access.read("rows")))

        writer_task = asyncio.create_task(writer())
        await _settle(2)
        readers = [asyncio.create_task(reader()) for _ in range(3)]
        await asyncio.wait_for(asyncio.gather(writer_task, *readers), timeout=1.0)

        assert observed == [[1, 2, 3]] * 3, observed

    async def test_two_writes_to_one_variable_do_not_interleave(self) -> None:
        """Verify a second write waits for the first to finish."""
        access = variable_access({"count": 0})
        order: list[str] = []

        async def writer(tag: str) -> None:
            async with access.update(["count"]) as held:
                order.append(f"{tag}-in")
                await asyncio.sleep(0)
                held["count"] = tag
                order.append(f"{tag}-out")

        await asyncio.wait_for(asyncio.gather(writer("a"), writer("b")), timeout=1.0)
        assert order in (
            ["a-in", "a-out", "b-in", "b-out"],
            ["b-in", "b-out", "a-in", "a-out"],
        ), order

    async def test_write_uses_the_same_exclusion_as_update(self) -> None:
        """Verify the single-value write helper is held off by an open update."""
        access = variable_access({"count": 0})
        release = asyncio.Event()
        order: list[str] = []

        async def holder() -> None:
            async with access.update(["count"]):
                order.append("held")
                await release.wait()

        async def writer() -> None:
            await access.write("count", 99)
            order.append("written")

        holder_task = asyncio.create_task(holder())
        await _settle()
        writer_task = asyncio.create_task(writer())
        await _settle()

        assert order == ["held"], order
        release.set()
        await asyncio.wait_for(asyncio.gather(holder_task, writer_task), timeout=1.0)
        assert order == ["held", "written"], order


class TestAccessIsPerVariable:
    """Activity on one variable never delays work on another."""

    async def test_a_write_to_one_variable_does_not_delay_a_read_of_another(self) -> None:
        """Verify a held write on 'a' lets a read of 'b' finish first."""
        access = variable_access({"a": 1, "b": 2})
        order: list[str] = []
        release = asyncio.Event()

        async def hold_a() -> None:
            async with access.update(["a"]):
                order.append("a-held")
                await release.wait()
                order.append("a-released")

        async def read_b() -> None:
            value = await access.read("b")
            order.append(f"b-read-{value}")

        hold_task = asyncio.create_task(hold_a())
        await _settle()
        read_task = asyncio.create_task(read_b())
        await asyncio.wait_for(read_task, timeout=1.0)

        assert order == ["a-held", "b-read-2"], order
        release.set()
        await asyncio.wait_for(hold_task, timeout=1.0)

    async def test_two_writes_to_different_variables_overlap(self) -> None:
        """Verify concurrent writes to distinct variables are not serialized."""
        access = variable_access({"a": 0, "b": 0})
        both_inside = asyncio.Event()
        inside = 0

        async def writer(name: str) -> None:
            nonlocal inside
            async with access.update([name]) as held:
                inside += 1
                if inside == 2:
                    both_inside.set()
                await asyncio.wait_for(both_inside.wait(), timeout=1.0)
                held[name] = name

        await asyncio.wait_for(asyncio.gather(writer("a"), writer("b")), timeout=2.0)
        assert both_inside.is_set()

    async def test_a_multi_name_update_holds_every_named_variable(self) -> None:
        """Verify update over several names excludes readers of each of them."""
        access = variable_access({"a": 1, "b": 2, "c": 3})
        release = asyncio.Event()
        finished: list[str] = []

        async def holder() -> None:
            async with access.update(["a", "b"]) as held:
                await release.wait()
                held["a"] = 10
                held["b"] = 20

        async def reader(name: str) -> None:
            await access.read(name)
            finished.append(name)

        holder_task = asyncio.create_task(holder())
        await _settle()
        blocked = [asyncio.create_task(reader(name)) for name in ("a", "b")]
        free = asyncio.create_task(reader("c"))
        await asyncio.wait_for(free, timeout=1.0)

        assert finished == ["c"], finished
        release.set()
        await asyncio.wait_for(asyncio.gather(holder_task, *blocked), timeout=1.0)
        assert sorted(finished) == ["a", "b", "c"], finished

    async def test_two_multi_name_updates_sharing_a_variable_do_not_deadlock(self) -> None:
        """Verify overlapping name sets acquired in opposite author order still settle."""
        # Guard: a fixed acquisition order is what keeps two branches from deadlocking.
        variables: dict[str, Any] = {"a": 0, "b": 0}
        access = variable_access(variables)

        async def writer(names: list[str], value: int) -> None:
            async with access.update(names) as held:
                await asyncio.sleep(0)
                for name in names:
                    held[name] = value

        await asyncio.wait_for(
            asyncio.gather(writer(["a", "b"], 1), writer(["b", "a"], 2)),
            timeout=2.0,
        )
        assert variables["a"] == variables["b"]
