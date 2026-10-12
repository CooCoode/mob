"""Mouse and keyboard input via Quartz CGEvent (with cliclick / AppleScript fallback)."""

from __future__ import annotations

import shutil
import subprocess
import time
from typing import Literal

from mob_mcp.platform_util import require_macos

ButtonName = Literal["left", "right"]

# Common macOS virtual key codes (HIToolbox / Events.h)
_KEYCODES: dict[str, int] = {
    "a": 0,
    "s": 1,
    "d": 2,
    "f": 3,
    "h": 4,
    "g": 5,
    "z": 6,
    "x": 7,
    "c": 8,
    "v": 9,
    "b": 11,
    "q": 12,
    "w": 13,
    "e": 14,
    "r": 15,
    "y": 16,
    "t": 17,
    "1": 18,
    "2": 19,
    "3": 20,
    "4": 21,
    "6": 22,
    "5": 23,
    "=": 24,
    "9": 25,
    "7": 26,
    "-": 27,
    "8": 28,
    "0": 29,
    "]": 30,
    "o": 31,
    "u": 32,
    "[": 33,
    "i": 34,
    "p": 35,
    "l": 37,
    "j": 38,
    "'": 39,
    "k": 40,
    ";": 41,
    "\\": 42,
    ",": 43,
    "/": 44,
    "n": 45,
    "m": 46,
    ".": 47,
    "`": 50,
    "return": 36,
    "enter": 36,
    "tab": 48,
    "space": 49,
    "delete": 51,
    "backspace": 51,
    "escape": 53,
    "esc": 53,
    "command": 55,
    "cmd": 55,
    "shift": 56,
    "capslock": 57,
    "option": 58,
    "alt": 58,
    "control": 59,
    "ctrl": 59,
    "right": 124,
    "left": 123,
    "down": 125,
    "up": 126,
    "f1": 122,
    "f2": 120,
    "f3": 99,
    "f4": 118,
    "f5": 96,
    "f6": 97,
    "f7": 98,
    "f8": 100,
    "f9": 101,
    "f10": 109,
    "f11": 103,
    "f12": 111,
}

_MODIFIER_ALIASES = {
    "cmd": "command",
    "command": "command",
    "meta": "command",
    "ctrl": "control",
    "control": "control",
    "alt": "option",
    "option": "option",
    "shift": "shift",
}


def parse_hotkey(spec: str) -> tuple[str, list[str]]:
    """Parse ``cmd+c`` / ``ctrl+shift+tab`` into (key, modifiers)."""
    parts = [p.strip().lower() for p in spec.replace("-", "+").split("+") if p.strip()]
    if not parts:
        raise ValueError("empty key specification")
    modifiers: list[str] = []
    key: str | None = None
    for part in parts:
        if part in _MODIFIER_ALIASES:
            modifiers.append(_MODIFIER_ALIASES[part])
        else:
            if key is not None:
                raise ValueError(f"multiple non-modifier keys in {spec!r}")
            key = part
    if key is None:
        raise ValueError(f"no key in specification {spec!r}")
    return key, modifiers


def _quartz():
    import Quartz  # type: ignore

    return Quartz


def _click_quartz(x: float, y: float, button: ButtonName, count: int) -> None:
    Q = _quartz()
    point = Q.CGPointMake(float(x), float(y))
    if button == "left":
        down_type, up_type = Q.kCGEventLeftMouseDown, Q.kCGEventLeftMouseUp
        btn = Q.kCGMouseButtonLeft
    else:
        down_type, up_type = Q.kCGEventRightMouseDown, Q.kCGEventRightMouseUp
        btn = Q.kCGMouseButtonRight

    move = Q.CGEventCreateMouseEvent(None, Q.kCGEventMouseMoved, point, btn)
    Q.CGEventPost(Q.kCGHIDEventTap, move)

    for i in range(max(1, count)):
        down = Q.CGEventCreateMouseEvent(None, down_type, point, btn)
        up = Q.CGEventCreateMouseEvent(None, up_type, point, btn)
        Q.CGEventSetIntegerValueField(down, Q.kCGMouseEventClickState, i + 1)
        Q.CGEventSetIntegerValueField(up, Q.kCGMouseEventClickState, i + 1)
        Q.CGEventPost(Q.kCGHIDEventTap, down)
        Q.CGEventPost(Q.kCGHIDEventTap, up)
        time.sleep(0.05)


def _click_cliclick(x: float, y: float, button: ButtonName, count: int) -> None:
    cli = shutil.which("cliclick")
    if not cli:
        raise RuntimeError("cliclick not found on PATH")
    for _ in range(max(1, count)):
        if button == "left":
            subprocess.run([cli, f"c:{int(x)},{int(y)}"], check=True)
        else:
            subprocess.run([cli, f"rc:{int(x)},{int(y)}"], check=True)
        time.sleep(0.05)


def click(
    x: float,
    y: float,
    button: ButtonName = "left",
    count: int = 1,
) -> str:
    """Click at screen coordinates in **points** (logical pixels)."""
    require_macos("click")
    if button not in ("left", "right"):
        raise ValueError("button must be 'left' or 'right'")
    if count < 1:
        raise ValueError("count must be >= 1")

    try:
        _click_quartz(x, y, button, count)
        return f"clicked {button} x={x} y={y} count={count} via Quartz"
    except Exception as quartz_err:
        try:
            _click_cliclick(x, y, button, count)
            return f"clicked {button} x={x} y={y} count={count} via cliclick"
        except Exception as click_err:
            raise RuntimeError(
                "click failed. Grant Accessibility to the terminal/host that "
                "launches mob-mcp. Install pyobjc (pip) or cliclick (brew). "
                f"Quartz: {quartz_err}; cliclick: {click_err}"
            ) from click_err


def type_text(text: str) -> str:
    """Type Unicode text into the focused element (clipboard paste fallback)."""
    require_macos("type_text")
    if text == "":
        return "typed empty string (no-op)"

    try:
        from AppKit import NSPasteboard, NSStringPboardType  # type: ignore

        pb = NSPasteboard.generalPasteboard()
        pb.clearContents()
        pb.setString_forType_(text, NSStringPboardType)
        key("cmd+v")
        return f"typed {len(text)} characters via pasteboard"
    except Exception as err:
        escaped = text.replace("\\", "\\\\").replace('"', '\\"')
        script = f'tell application "System Events" to keystroke "{escaped}"'
        proc = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(
                "type_text failed. Grant Accessibility. "
                f"Detail: {(proc.stderr or str(err)).strip()}"
            ) from err
        return f"typed {len(text)} characters via AppleScript"


def _modifier_flags(modifiers: list[str]) -> int:
    Q = _quartz()
    flags = 0
    for m in modifiers:
        if m == "command":
            flags |= Q.kCGEventFlagMaskCommand
        elif m == "shift":
            flags |= Q.kCGEventFlagMaskShift
        elif m == "option":
            flags |= Q.kCGEventFlagMaskAlternate
        elif m == "control":
            flags |= Q.kCGEventFlagMaskControl
    return flags


def _key_quartz(key_name: str, modifiers: list[str]) -> None:
    Q = _quartz()
    if key_name not in _KEYCODES:
        raise KeyError(key_name)
    code = _KEYCODES[key_name]
    flags = _modifier_flags(modifiers)
    down = Q.CGEventCreateKeyboardEvent(None, code, True)
    up = Q.CGEventCreateKeyboardEvent(None, code, False)
    Q.CGEventSetFlags(down, flags)
    Q.CGEventSetFlags(up, flags)
    Q.CGEventPost(Q.kCGHIDEventTap, down)
    Q.CGEventPost(Q.kCGHIDEventTap, up)


def _key_osascript(key_name: str, modifiers: list[str]) -> None:
    using = [
        {
            "command": "command down",
            "shift": "shift down",
            "option": "option down",
            "control": "control down",
        }[m]
        for m in modifiers
    ]
    using_clause = f" using {{{', '.join(using)}}}" if using else ""

    if key_name in _KEYCODES and len(key_name) > 1:
        script = (
            f'tell application "System Events" to key code '
            f"{_KEYCODES[key_name]}{using_clause}"
        )
    elif len(key_name) == 1:
        ch = key_name.replace("\\", "\\\\").replace('"', '\\"')
        script = f'tell application "System Events" to keystroke "{ch}"{using_clause}'
    elif key_name in _KEYCODES:
        script = (
            f'tell application "System Events" to key code '
            f"{_KEYCODES[key_name]}{using_clause}"
        )
    else:
        raise ValueError(f"unknown key: {key_name}")

    proc = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            (proc.stderr or proc.stdout or "osascript key failed").strip()
        )


def key(combo: str) -> str:
    """Press a key or chord, e.g. ``return``, ``tab``, ``cmd+c``, ``ctrl+shift+tab``."""
    require_macos("key")
    key_name, modifiers = parse_hotkey(combo)
    try:
        _key_quartz(key_name, modifiers)
        return f"pressed {combo!r} via Quartz"
    except Exception as quartz_err:
        try:
            _key_osascript(key_name, modifiers)
            return f"pressed {combo!r} via AppleScript"
        except Exception as asa_err:
            raise RuntimeError(
                "key failed. Grant Accessibility. "
                f"Quartz: {quartz_err}; AppleScript: {asa_err}"
            ) from asa_err
