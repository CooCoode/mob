"""Screenshot capture for the primary display."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from mob_mcp.platform_util import require_macos


def _backing_scale_factor() -> float:
    try:
        from AppKit import NSScreen  # type: ignore

        screen = NSScreen.mainScreen()
        if screen is not None:
            return float(screen.backingScaleFactor())
    except Exception:
        pass
    return 1.0


def screenshot() -> dict[str, Any]:
    """Capture the primary display as PNG bytes plus geometry metadata.

    Coordinates used by ``click`` are in **points** (logical pixels), matching
    this metadata. On Retina displays ``scale_factor`` is typically 2.0 and
    ``pixel_width`` / ``pixel_height`` are the raw PNG dimensions.
    """
    require_macos("screenshot")

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        path = Path(tmp.name)

    try:
        # -x: no shutter sound; capture main display
        proc = subprocess.run(
            ["screencapture", "-x", str(path)],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0 or not path.exists() or path.stat().st_size == 0:
            err = (proc.stderr or proc.stdout or "").strip()
            raise RuntimeError(
                "screencapture failed. Grant Screen Recording to the terminal "
                f"or host that launches mob-mcp. Detail: {err or proc.returncode}"
            )

        data = path.read_bytes()
        try:
            from PIL import Image  # type: ignore

            with Image.open(path) as im:
                pixel_width, pixel_height = im.size
        except Exception:
            # Pillow optional off-darwin; on macOS it should be installed.
            pixel_width = pixel_height = 0

        scale = _backing_scale_factor()
        point_width = int(round(pixel_width / scale)) if scale else pixel_width
        point_height = int(round(pixel_height / scale)) if scale else pixel_height

        return {
            "png": data,
            "format": "png",
            "scale_factor": scale,
            "pixel_width": pixel_width,
            "pixel_height": pixel_height,
            "point_width": point_width,
            "point_height": point_height,
            "coordinate_space": "points",
            "meta_json": json.dumps(
                {
                    "format": "png",
                    "scale_factor": scale,
                    "pixel_width": pixel_width,
                    "pixel_height": pixel_height,
                    "point_width": point_width,
                    "point_height": point_height,
                    "coordinate_space": "points",
                    "hint": "Pass click(x,y) in points (logical pixels), not raw Retina pixels.",
                }
            ),
        }
    finally:
        path.unlink(missing_ok=True)
