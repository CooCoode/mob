"""MCP tool registration smoke (no GUI / no stdio run)."""

import asyncio

from mob_mcp.server import mcp


def test_expected_tools_registered():
    tools = asyncio.run(mcp.list_tools())
    names = sorted(t.name for t in tools)
    assert names == [
        "click",
        "key",
        "list_windows",
        "open_app",
        "screenshot",
        "type_text",
    ]
