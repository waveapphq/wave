"""WAVE's own file-type table: a file's content type by its extension (REQ-3.4.3.10)."""

import os

_OCTET_STREAM = "application/octet-stream"

CONTENT_TYPES = {
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".ts": "text/typescript",
    ".md": "text/markdown",
    ".py": "text/x-python",
    ".xml": "application/xml",
    ".json": "application/json",
    ".jsonl": "application/jsonl",
    ".ndjson": "application/x-ndjson",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".toml": "application/toml",
    ".sql": "application/sql",
    ".sh": "application/x-sh",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".tgz": "application/gzip",
    ".tar": "application/x-tar",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/vnd.microsoft.icon",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".wasm": "application/wasm",
    ".pem": "application/x-pem-file",
    ".crt": "application/x-x509-ca-cert",
    ".cer": "application/x-x509-ca-cert",
    ".bin": _OCTET_STREAM,
}


def content_type_for(file_name: str) -> str:
    """The table's content type for a file name's last extension, ignoring case."""
    return CONTENT_TYPES.get(os.path.splitext(file_name)[1].lower(), _OCTET_STREAM)
