"""Pull threads of the catalog-job tests end with their test."""

import threading
from collections.abc import Iterator
from contextlib import contextmanager

JOIN_BOUND = 5.0


@contextmanager
def pull_threads_ended() -> Iterator[None]:
    """Wait at exit for every thread started inside, so no pull calls the next test's fakes."""
    before = set(threading.enumerate())
    try:
        yield
    finally:
        for thread in set(threading.enumerate()) - before:
            thread.join(JOIN_BOUND)
