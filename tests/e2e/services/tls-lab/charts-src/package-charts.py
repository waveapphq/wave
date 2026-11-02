#!/usr/bin/env python3
"""Package the checked-in fixture charts into ../charts/ and write its index.yaml.

TEST-ONLY. Archives are byte-reproducible (fixed mtimes, owners and entry order),
so re-running this script leaves the checked-in .tgz files and their index.yaml
digests unchanged. Requires no helm.
"""

from __future__ import annotations

import gzip
import hashlib
import io
import tarfile
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parent
OUT_DIR = SRC_DIR.parent / "charts"
GENERATED = "2026-09-04T00:00:00Z"


def chart_fields(chart_yaml: Path) -> dict[str, str]:
    """Read the flat scalar fields of a fixture Chart.yaml without a YAML parser."""
    fields: dict[str, str] = {}
    for line in chart_yaml.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith((" ", "#")) or ":" not in line:
            continue
        key, _, value = line.partition(":")
        fields[key.strip()] = value.strip().strip('"')
    return fields


def package(source: Path, chart_name: str) -> bytes:
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.GNU_FORMAT) as tar:
        for path in sorted(p for p in source.rglob("*") if p.is_file()):
            info = tarfile.TarInfo(f"{chart_name}/{path.relative_to(source).as_posix()}")
            info.size = path.stat().st_size
            info.mtime = 0
            info.mode = 0o644
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            with path.open("rb") as handle:
                tar.addfile(info, handle)
    packed = io.BytesIO()
    with gzip.GzipFile(fileobj=packed, mode="wb", compresslevel=9, mtime=0) as gz:
        gz.write(raw.getvalue())
    return packed.getvalue()


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    entries: dict[str, list[dict[str, str]]] = {}
    for source in sorted(p for p in SRC_DIR.iterdir() if (p / "Chart.yaml").is_file()):
        fields = chart_fields(source / "Chart.yaml")
        name, version = fields["name"], fields["version"]
        archive = package(source, name)
        (OUT_DIR / f"{name}-{version}.tgz").write_bytes(archive)
        entries.setdefault(name, []).append(
            {
                "apiVersion": fields["apiVersion"],
                "appVersion": fields["appVersion"],
                "created": GENERATED,
                "description": fields["description"],
                "digest": hashlib.sha256(archive).hexdigest(),
                "name": name,
                "type": fields["type"],
                "url": f"{name}-{version}.tgz",
                "version": version,
            }
        )

    lines = ["apiVersion: v1", "entries:"]
    for name in sorted(entries):
        lines.append(f"  {name}:")
        for entry in sorted(entries[name], key=lambda e: e["version"], reverse=True):
            lines.append(f'  - apiVersion: {entry["apiVersion"]}')
            lines.append(f'    appVersion: "{entry["appVersion"]}"')
            lines.append(f'    created: "{entry["created"]}"')
            lines.append(f'    description: {entry["description"]}')
            lines.append(f'    digest: {entry["digest"]}')
            lines.append(f'    name: {entry["name"]}')
            lines.append(f'    type: {entry["type"]}')
            lines.append("    urls:")
            lines.append(f'    - {entry["url"]}')
            lines.append(f'    version: {entry["version"]}')
    lines.append(f'generated: "{GENERATED}"')
    (OUT_DIR / "index.yaml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"packaged {sum(len(v) for v in entries.values())} charts into {OUT_DIR}")


if __name__ == "__main__":
    main()
