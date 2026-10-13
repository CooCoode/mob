"""Input tools must not report success when macOS drops synthetic events."""

import pytest

from mob_mcp.tools import input as input_tools


class _DeniedQuartz:
    @staticmethod
    def CGPreflightPostEventAccess():
        return False


@pytest.mark.parametrize(
    "operation",
    [
        lambda: input_tools._click_quartz(10, 20, "left", 1),
        lambda: input_tools._key_quartz("return", []),
    ],
)
def test_quartz_input_fails_before_posting_without_accessibility(
    monkeypatch, operation
):
    monkeypatch.setattr(input_tools, "_quartz", lambda: _DeniedQuartz)

    with pytest.raises(PermissionError, match="Accessibility permission"):
        operation()
