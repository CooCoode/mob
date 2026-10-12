"""Window listing and application launch."""

from __future__ import annotations

import json
import subprocess
from typing import Any

from mob_mcp.platform_util import require_macos

_LIST_WINDOWS_ASCRIPT = """
tell application "System Events"
  set out to {}
  repeat with p in (every process whose background only is false)
    set pname to name of p
    set ppid to unix id of p
    try
      repeat with w in (every window of p)
        set wtitle to name of w
        set {x, y} to position of w
        set {ww, wh} to size of w
        set end of out to (pname & tab & wtitle & tab & ppid & tab & x & tab & y & tab & ww & tab & wh)
      end repeat
    end try
  end repeat
  set AppleScript's text item delimiters to linefeed
  return out as text
end tell
"""


def _looks_like_bundle_id(value: str) -> bool:
    if " " in value or "/" in value:
        return False
    parts = value.split(".")
    return len(parts) >= 2 and all(parts)


def list_windows(on_screen_only: bool = True) -> list[dict[str, Any]]:
    """List windows with app name, title, bounds, and pid."""
    require_macos("list_windows")

    try:
        import Quartz  # type: ignore

        options = Quartz.kCGWindowListOptionAll
        if on_screen_only:
            options = Quartz.kCGWindowListOptionOnScreenOnly
        raw = Quartz.CGWindowListCopyWindowInfo(options, Quartz.kCGNullWindowID)
        windows: list[dict[str, Any]] = []
        for item in raw or []:
            layer = int(item.get("kCGWindowLayer", 0))
            if layer != 0:
                continue
            bounds = item.get("kCGWindowBounds") or {}
            owner = item.get("kCGWindowOwnerName") or ""
            title = item.get("kCGWindowName") or ""
            pid = int(item.get("kCGWindowOwnerPID") or 0)
            wid = int(item.get("kCGWindowNumber") or 0)
            if not owner and not title:
                continue
            windows.append(
                {
                    "id": wid,
                    "app": owner,
                    "title": title,
                    "pid": pid,
                    "bounds": {
                        "x": float(bounds.get("X", 0)),
                        "y": float(bounds.get("Y", 0)),
                        "width": float(bounds.get("Width", 0)),
                        "height": float(bounds.get("Height", 0)),
                    },
                }
            )
        return windows
    except Exception as quartz_err:
        proc = subprocess.run(
            ["osascript", "-e", _LIST_WINDOWS_ASCRIPT],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                "list_windows failed. Grant Accessibility. "
                f"Quartz: {quartz_err}; AppleScript: {(proc.stderr or '').strip()}"
            ) from quartz_err
        windows = []
        for line in (proc.stdout or "").splitlines():
            parts = line.split("\t")
            if len(parts) < 7:
                continue
            windows.append(
                {
                    "id": None,
                    "app": parts[0],
                    "title": parts[1],
                    "pid": int(parts[2]),
                    "bounds": {
                        "x": float(parts[3]),
                        "y": float(parts[4]),
                        "width": float(parts[5]),
                        "height": float(parts[6]),
                    },
                }
            )
        return windows


def open_app(name_or_bundle_id: str) -> str:
    """Launch an application by display name or bundle id."""
    require_macos("open_app")
    target = name_or_bundle_id.strip()
    if not target:
        raise ValueError("name_or_bundle_id must be non-empty")

    if _looks_like_bundle_id(target):
        attempts = [
            (["open", "-b", target], "bundle id"),
            (["open", "-a", target], "app name"),
        ]
    else:
        attempts = [
            (["open", "-a", target], "app name"),
            (["open", "-b", target], "bundle id"),
        ]

    errors: list[str] = []
    for cmd, _kind in attempts:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if proc.returncode == 0:
            return f"opened {target!r} via {' '.join(cmd)}"
        errors.append((proc.stderr or proc.stdout or f"exit {proc.returncode}").strip())

    raise RuntimeError(f"open_app failed for {target!r}: {'; '.join(errors)}")


def windows_as_json(on_screen_only: bool = True) -> str:
    return json.dumps(list_windows(on_screen_only=on_screen_only), indent=2)
