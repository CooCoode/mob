"""Platform guards for macOS-only actuation."""

from __future__ import annotations

import platform
import sys


class UnsupportedPlatformError(RuntimeError):
    """Raised when actuation APIs are used off macOS."""


def is_macos() -> bool:
    return sys.platform == "darwin"


def require_macos(action: str = "this operation") -> None:
    """Raise a clear error if not running on macOS."""
    if is_macos():
        return
    system = platform.system() or sys.platform
    raise UnsupportedPlatformError(
        f"mob-mcp {action} requires macOS (darwin). "
        f"Current platform: {system!r} ({sys.platform!r}). "
        "Run this MCP server on the office Mac."
    )
