"""General one-shot MCP client for E2E: reads JSON tool args from stdin, calls one tool, prints the envelope."""

import asyncio
import json
import os
import sys

from mcp import types
from mcp.client import Client


async def main() -> None:
    url, tool = sys.argv[1], sys.argv[2]
    raw = sys.stdin.read().strip()
    args = json.loads(raw) if raw else {}
    client_name = os.environ.get("WAVE_MCP_CLIENT_NAME", "wave-e2e-tool-client")
    async with Client(
        url,
        client_info=types.Implementation(name=client_name, version="1.0.0"),
    ) as client:
        result = await client.call_tool(tool, args)
        text = result.content[0].text if result.content else ""
        try:
            payload = json.loads(text)
        except ValueError:
            payload = {"text": text}
        print(json.dumps({"isError": bool(result.is_error), "payload": payload}))


asyncio.run(main())
