"""Streaming artifact writer (REQ-3.4.1.4 file response mode).

The store gains a streaming writer - chunked write with an incremental
sha256 - so large downloads land on disk without buffering in memory:

    write_stream(directory, name, chunks, *, hash=True) -> (Path, int, str)

returning the written path, the byte count, and the hex digest (empty string
when hashing is disabled). The name is used verbatim (the HTTP plugin owns
naming and uniquifying; no extension is invented), a rewrite overwrites in
place, and re-creating a name supersedes a prior soft-delete tombstone like
the whole-bytes writers do.
"""

import hashlib
from collections.abc import Iterator
from pathlib import Path

from wavecore.core.artifacts import store


def _chunks(*parts: bytes) -> Iterator[bytes]:
    yield from parts


class TestWriteStream:
    def test_writes_all_chunks_concatenated(self, tmp_path: Path) -> None:
        path, _, _ = store.write_stream(tmp_path, "download.bin", _chunks(b"abc", b"def", b"ghi"))

        assert path == tmp_path / "download.bin"
        assert path.read_bytes() == b"abcdefghi"

    def test_returns_the_total_byte_count(self, tmp_path: Path) -> None:
        _, size, _ = store.write_stream(tmp_path, "sized.bin", _chunks(b"12345", b"678"))

        assert size == 8

    def test_digest_matches_the_hashlib_reference(self, tmp_path: Path) -> None:
        payload = (b"a" * 1024, b"b" * 4096, b"c" * 10)

        _, _, digest = store.write_stream(tmp_path, "hashed.bin", _chunks(*payload))

        assert digest == hashlib.sha256(b"".join(payload)).hexdigest()

    def test_hash_false_returns_empty_digest(self, tmp_path: Path) -> None:
        path, size, digest = store.write_stream(
            tmp_path, "nohash.bin", _chunks(b"data"), hash=False
        )

        assert path.read_bytes() == b"data"
        assert size == 4
        assert digest == ""

    def test_name_is_used_verbatim_without_invented_extension(self, tmp_path: Path) -> None:
        """The file-naming contract says `response` stays extensionless."""
        path, _, _ = store.write_stream(tmp_path, "response", _chunks(b"payload"))

        assert path == tmp_path / "response"
        assert path.read_bytes() == b"payload"

    def test_empty_stream_writes_a_zero_byte_file(self, tmp_path: Path) -> None:
        path, size, digest = store.write_stream(tmp_path, "empty.bin", _chunks())

        assert path.read_bytes() == b""
        assert size == 0
        assert digest == hashlib.sha256(b"").hexdigest()

    def test_rewrite_overwrites_in_place(self, tmp_path: Path) -> None:
        store.write_stream(tmp_path, "report.pdf", _chunks(b"first"))
        path, size, _ = store.write_stream(tmp_path, "report.pdf", _chunks(b"second-longer"))

        assert path.read_bytes() == b"second-longer"
        assert size == len(b"second-longer")
        assert sorted(p.name for p in tmp_path.iterdir()) == ["report.pdf"]

    def test_recreating_supersedes_a_soft_delete_tombstone(self, tmp_path: Path) -> None:
        tombstone = tmp_path / ("report.pdf" + store.TOMBSTONE_SUFFIX)
        tombstone.touch()

        store.write_stream(tmp_path, "report.pdf", _chunks(b"fresh"))

        assert not tombstone.exists()
        assert (tmp_path / "report.pdf").read_bytes() == b"fresh"

    def test_multi_chunk_incremental_digest_equals_whole_file_digest(self, tmp_path: Path) -> None:
        """The digest accumulates per chunk - never by re-reading the file."""
        parts = [bytes([i % 256]) * 8192 for i in range(16)]

        path, size, digest = store.write_stream(tmp_path, "large.bin", iter(parts))

        whole = b"".join(parts)
        assert size == len(whole)
        assert digest == hashlib.sha256(whole).hexdigest()
        assert path.read_bytes() == whole
